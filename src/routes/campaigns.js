const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const Campaign = require('../models/Campaign');
const Lead = require('../models/Lead');
const Call = require('../models/Call');
const twilioService = require('../services/twilioService');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * Get all campaigns
 */
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    const query = {};
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
    };

    const campaigns = await Campaign.find(query)
      .sort(options.sort)
      .limit(options.limit)
      .skip((options.page - 1) * options.limit)
      .select('-script.qualification -script.objectionHandling'); // Exclude large fields

    const total = await Campaign.countDocuments(query);

    res.json({
      campaigns,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching campaigns', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/**
 * Get single campaign
 */
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(campaign);

  } catch (error) {
    logger.error('Error fetching campaign', { error: error.message, campaignId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

/**
 * Create new campaign
 */
router.post('/', async (req, res) => {
  try {
    const campaignData = {
      ...req.body,
      createdBy: req.user?.id || 'system'
    };

    const campaign = new Campaign(campaignData);
    await campaign.save();

    logger.info('Campaign created', { 
      campaignId: campaign._id, 
      name: campaign.name,
      createdBy: campaign.createdBy 
    });

    res.status(201).json(campaign);

  } catch (error) {
    logger.error('Error creating campaign', { error: error.message, data: req.body });
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: Object.values(error.errors).map(e => e.message) 
      });
    }
    
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

/**
 * Update campaign
 */
router.put('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    logger.info('Campaign updated', { 
      campaignId: campaign._id, 
      name: campaign.name 
    });

    res.json(campaign);

  } catch (error) {
    logger.error('Error updating campaign', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: Object.values(error.errors).map(e => e.message) 
      });
    }
    
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

/**
 * Delete campaign
 */
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if campaign has active calls
    const activeCalls = await Call.countDocuments({
      campaignId: req.params.id,
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    });

    if (activeCalls > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete campaign with active calls',
        activeCalls 
      });
    }

    await Campaign.findByIdAndDelete(req.params.id);

    logger.info('Campaign deleted', { 
      campaignId: req.params.id, 
      name: campaign.name 
    });

    res.json({ message: 'Campaign deleted successfully' });

  } catch (error) {
    logger.error('Error deleting campaign', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

/**
 * Upload leads CSV to campaign
 */
router.post('/:id/leads/upload', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const leads = [];
    const errors = [];
    let processedCount = 0;
    const batchId = Date.now().toString();

    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(file.path)
        .pipe(csv())
        .on('data', (row) => {
          try {
            processedCount++;
            
            // Validate required fields
            if (!row.firstName || !row.phoneNumber) {
              errors.push(`Row ${processedCount}: firstName and phoneNumber are required`);
              return;
            }

            // Format phone number
            const formattedPhone = twilioService.formatPhoneNumber(row.phoneNumber);

            const leadData = {
              campaignId: id,
              firstName: row.firstName?.trim(),
              lastName: row.lastName?.trim(),
              phoneNumber: formattedPhone,
              email: row.email?.trim(),
              company: row.company?.trim(),
              jobTitle: row.jobTitle?.trim(),
              industry: row.industry?.trim(),
              source: 'upload',
              imported: {
                batchId,
                importDate: new Date(),
                originalData: row
              }
            };

            // Add address if provided
            if (row.street || row.city || row.state || row.zipCode) {
              leadData.address = {
                street: row.street?.trim(),
                city: row.city?.trim(),
                state: row.state?.trim(),
                zipCode: row.zipCode?.trim(),
                country: row.country?.trim() || 'US'
              };
            }

            // Add custom fields
            const customFields = {};
            Object.keys(row).forEach(key => {
              if (!['firstName', 'lastName', 'phoneNumber', 'email', 'company', 'jobTitle', 'industry', 'street', 'city', 'state', 'zipCode', 'country'].includes(key)) {
                customFields[key] = row[key];
              }
            });
            
            if (Object.keys(customFields).length > 0) {
              leadData.customFields = customFields;
            }

            leads.push(leadData);

          } catch (error) {
            errors.push(`Row ${processedCount}: ${error.message}`);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    if (leads.length === 0) {
      return res.status(400).json({ 
        error: 'No valid leads found in CSV',
        errors 
      });
    }

    // Insert leads in batches
    const batchSize = 100;
    let insertedCount = 0;
    const insertErrors = [];

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      
      try {
        await Lead.insertMany(batch, { ordered: false });
        insertedCount += batch.length;
      } catch (error) {
        // Handle duplicate key errors and other issues
        if (error.writeErrors) {
          error.writeErrors.forEach(writeError => {
            insertErrors.push(`Lead ${writeError.getOperation().firstName}: ${writeError.errmsg}`);
          });
          insertedCount += (batch.length - error.writeErrors.length);
        } else {
          insertErrors.push(error.message);
        }
      }
    }

    // Update campaign statistics
    await campaign.updateStats();

    logger.info('Leads uploaded to campaign', {
      campaignId: id,
      totalProcessed: processedCount,
      insertedCount,
      errorsCount: errors.length + insertErrors.length,
      batchId
    });

    res.json({
      message: 'Leads uploaded successfully',
      summary: {
        totalProcessed: processedCount,
        inserted: insertedCount,
        errors: errors.length + insertErrors.length,
        batchId
      },
      errors: [...errors, ...insertErrors].slice(0, 10) // Limit error responses
    });

  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    logger.error('Error uploading leads', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to upload leads' });
  }
});

/**
 * Get campaign leads
 */
router.get('/:id/leads', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = { campaignId: id };
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
    };

    const leads = await Lead.find(query)
      .sort(options.sort)
      .limit(options.limit)
      .skip((options.page - 1) * options.limit)
      .select('-notes -imported.originalData'); // Exclude large fields

    const total = await Lead.countDocuments(query);

    res.json({
      leads,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching campaign leads', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

/**
 * Start campaign
 */
router.post('/:id/start', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status === 'running') {
      return res.status(400).json({ error: 'Campaign is already running' });
    }

    // Check if campaign has leads
    const leadCount = await Lead.countDocuments({ campaignId: req.params.id });
    if (leadCount === 0) {
      return res.status(400).json({ error: 'Campaign has no leads' });
    }

    // Validate Twilio configuration
    if (!twilioService.isConfigured()) {
      return res.status(400).json({ error: 'Twilio is not properly configured' });
    }

    // Update campaign status
    campaign.status = 'running';
    campaign.actualStart = new Date();
    await campaign.save();

    logger.info('Campaign started', { 
      campaignId: req.params.id, 
      name: campaign.name,
      leadCount 
    });

    // Emit real-time update
    if (req.io) {
      req.io.emit('campaignStarted', {
        campaignId: req.params.id,
        name: campaign.name,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Campaign started successfully',
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        actualStart: campaign.actualStart
      }
    });

  } catch (error) {
    logger.error('Error starting campaign', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

/**
 * Stop campaign
 */
router.post('/:id/stop', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'running') {
      return res.status(400).json({ error: 'Campaign is not running' });
    }

    // Update campaign status
    campaign.status = 'paused';
    await campaign.save();

    logger.info('Campaign stopped', { 
      campaignId: req.params.id, 
      name: campaign.name 
    });

    // Emit real-time update
    if (req.io) {
      req.io.emit('campaignStopped', {
        campaignId: req.params.id,
        name: campaign.name,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Campaign stopped successfully',
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status
      }
    });

  } catch (error) {
    logger.error('Error stopping campaign', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to stop campaign' });
  }
});

/**
 * Get campaign analytics
 */
router.get('/:id/analytics', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get detailed analytics
    const analytics = await Call.aggregate([
      { $match: { campaignId: campaign._id } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          answeredCalls: {
            $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] }
          },
          avgDuration: { $avg: '$duration' },
          totalDuration: { $sum: '$duration' },
          totalCost: { $sum: '$cost' },
          outcomes: {
            $push: '$outcome'
          }
        }
      }
    ]);

    const stats = analytics[0] || {
      totalCalls: 0,
      completedCalls: 0,
      answeredCalls: 0,
      avgDuration: 0,
      totalDuration: 0,
      totalCost: 0,
      outcomes: []
    };

    // Calculate outcome breakdown
    const outcomeBreakdown = {};
    stats.outcomes.forEach(outcome => {
      outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] || 0) + 1;
    });

    // Calculate rates
    const answerRate = stats.totalCalls > 0 ? (stats.answeredCalls / stats.totalCalls * 100) : 0;
    const completionRate = stats.totalCalls > 0 ? (stats.completedCalls / stats.totalCalls * 100) : 0;
    const conversionRate = campaign.stats.conversionRate || 0;

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status
      },
      stats: {
        ...stats,
        answerRate: Math.round(answerRate * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        avgDurationMinutes: Math.round((stats.avgDuration / 60) * 100) / 100,
        totalDurationHours: Math.round((stats.totalDuration / 3600) * 100) / 100,
        costPerCall: stats.totalCalls > 0 ? Math.round((stats.totalCost / stats.totalCalls) * 10000) / 10000 : 0
      },
      outcomeBreakdown,
      leadStats: {
        total: campaign.stats.totalLeads,
        contacted: await Lead.countDocuments({ campaignId: req.params.id, status: { $ne: 'new' } }),
        interested: await Lead.countDocuments({ campaignId: req.params.id, status: 'interested' }),
        converted: await Lead.countDocuments({ campaignId: req.params.id, status: 'converted' })
      }
    });

  } catch (error) {
    logger.error('Error fetching campaign analytics', { 
      error: error.message, 
      campaignId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
