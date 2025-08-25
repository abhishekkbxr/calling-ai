const express = require('express');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');
const twilioService = require('../services/twilioService');
const conversationService = require('../services/conversationService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get all calls with pagination and filtering
 */
router.get('/', async (req, res) => {
  try {
    const { 
      campaignId, 
      status, 
      outcome, 
      page = 1, 
      limit = 10, 
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      startDate,
      endDate 
    } = req.query;

    // Build query
    const query = {};
    if (campaignId) query.campaignId = campaignId;
    if (status) query.status = status;
    if (outcome) query.outcome = outcome;
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
    };

    const calls = await Call.find(query)
      .populate('campaignId', 'name status')
      .populate('leadId', 'firstName lastName phoneNumber company')
      .sort(options.sort)
      .limit(options.limit)
      .skip((options.page - 1) * options.limit)
      .select('-conversation'); // Exclude conversation details for list view

    const total = await Call.countDocuments(query);

    res.json({
      calls,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching calls', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch calls' });
  }
});

/**
 * Get single call with full details
 */
router.get('/:id', async (req, res) => {
  try {
    const call = await Call.findById(req.params.id)
      .populate('campaignId')
      .populate('leadId');

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    res.json(call);

  } catch (error) {
    logger.error('Error fetching call', { error: error.message, callId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch call' });
  }
});

/**
 * Initiate a new call manually
 */
router.post('/initiate', async (req, res) => {
  try {
    const { leadId, campaignId } = req.body;

    if (!leadId || !campaignId) {
      return res.status(400).json({ error: 'leadId and campaignId are required' });
    }

    // Get lead and campaign
    const lead = await Lead.findById(leadId);
    const campaign = await Campaign.findById(campaignId);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if lead is callable
    if (!lead.isCallable) {
      return res.status(400).json({ 
        error: 'Lead is not callable',
        reason: lead.doNotCall ? 'Do not call list' : 'Invalid status'
      });
    }

    // Check campaign status
    if (campaign.status !== 'running' && campaign.status !== 'draft') {
      return res.status(400).json({ error: 'Campaign is not active' });
    }

    // Validate Twilio configuration
    if (!twilioService.isConfigured()) {
      return res.status(500).json({ error: 'Twilio is not properly configured' });
    }

    // Format phone number
    const phoneNumber = twilioService.formatPhoneNumber(lead.phoneNumber);

    // Create webhook URL with campaign and lead data
    const webhookUrl = `${process.env.BASE_URL}/api/webhooks/twilio/voice`;
    const webhookParams = {
      campaignId: campaign._id.toString(),
      leadId: lead._id.toString()
    };

    // Initiate call via Twilio
    const callResult = await twilioService.makeCall(
      phoneNumber,
      webhookUrl,
      webhookParams
    );

    // Create call record
    const callData = {
      callSid: callResult.callSid,
      campaignId: campaign._id,
      leadId: lead._id,
      phoneNumber: lead.phoneNumber,
      direction: 'outbound',
      status: 'queued',
      startedAt: new Date(),
      attemptNumber: lead.totalCalls + 1
    };

    const call = new Call(callData);
    await call.save();

    logger.info('Call initiated manually', {
      callSid: callResult.callSid,
      leadId: lead._id,
      campaignId: campaign._id,
      phoneNumber: lead.phoneNumber
    });

    // Emit real-time update
    if (req.io) {
      req.io.emit('callInitiated', {
        callId: call._id,
        callSid: callResult.callSid,
        leadName: lead.fullName,
        phoneNumber: lead.phoneNumber,
        campaignName: campaign.name,
        timestamp: new Date()
      });
    }

    res.status(201).json({
      message: 'Call initiated successfully',
      call: {
        id: call._id,
        callSid: callResult.callSid,
        status: callResult.status,
        phoneNumber: lead.phoneNumber,
        leadName: lead.fullName,
        campaignName: campaign.name
      }
    });

  } catch (error) {
    logger.error('Error initiating call', { 
      error: error.message, 
      leadId: req.body.leadId,
      campaignId: req.body.campaignId 
    });
    
    if (error.code === 21212) { // Twilio invalid phone number
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    res.status(500).json({ error: 'Failed to initiate call' });
  }
});

/**
 * Hangup an active call
 */
router.post('/:id/hangup', async (req, res) => {
  try {
    const call = await Call.findById(req.params.id);

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (call.status === 'completed') {
      return res.status(400).json({ error: 'Call is already completed' });
    }

    if (!call.callSid) {
      return res.status(400).json({ error: 'Call SID not available' });
    }

    // Hangup call via Twilio
    await twilioService.hangupCall(call.callSid);

    // End conversation
    await conversationService.endConversation(call.callSid, 'manual-hangup');

    logger.info('Call hung up manually', {
      callId: call._id,
      callSid: call.callSid
    });

    // Emit real-time update
    if (req.io) {
      req.io.emit('callHungUp', {
        callId: call._id,
        callSid: call.callSid,
        timestamp: new Date()
      });
    }

    res.json({ message: 'Call hung up successfully' });

  } catch (error) {
    logger.error('Error hanging up call', { 
      error: error.message, 
      callId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to hangup call' });
  }
});

/**
 * Update call outcome manually
 */
router.put('/:id/outcome', async (req, res) => {
  try {
    const { outcome, notes, leadScore } = req.body;

    const validOutcomes = ['sale', 'interested', 'not-interested', 'callback', 'voicemail', 'wrong-number', 'no-answer'];
    
    if (outcome && !validOutcomes.includes(outcome)) {
      return res.status(400).json({ 
        error: 'Invalid outcome',
        validOutcomes 
      });
    }

    const call = await Call.findById(req.params.id)
      .populate('leadId')
      .populate('campaignId');

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    // Update call
    if (outcome) call.outcome = outcome;
    if (notes) call.notes = notes;
    if (leadScore !== undefined) call.leadScore = leadScore;

    await call.save();

    // Update lead if outcome changed
    if (outcome && call.leadId) {
      await call.leadId.updateScore(outcome, call.sentiment);
    }

    // Update campaign statistics
    if (call.campaignId) {
      await call.campaignId.updateStats();
    }

    logger.info('Call outcome updated', {
      callId: call._id,
      outcome,
      leadId: call.leadId?._id
    });

    // Emit real-time update
    if (req.io) {
      req.io.emit('callOutcomeUpdated', {
        callId: call._id,
        outcome,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Call outcome updated successfully',
      call: {
        id: call._id,
        outcome: call.outcome,
        leadScore: call.leadScore,
        notes: call.notes
      }
    });

  } catch (error) {
    logger.error('Error updating call outcome', { 
      error: error.message, 
      callId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to update call outcome' });
  }
});

/**
 * Get call conversation transcript
 */
router.get('/:id/transcript', async (req, res) => {
  try {
    const call = await Call.findById(req.params.id)
      .populate('leadId', 'firstName lastName')
      .populate('campaignId', 'name');

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    res.json({
      call: {
        id: call._id,
        callSid: call.callSid,
        duration: call.duration,
        outcome: call.outcome,
        sentiment: call.sentiment,
        lead: call.leadId,
        campaign: call.campaignId
      },
      conversation: call.conversation || [],
      transcription: call.transcription,
      notes: call.notes
    });

  } catch (error) {
    logger.error('Error fetching call transcript', { 
      error: error.message, 
      callId: req.params.id 
    });
    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

/**
 * Get call analytics/statistics
 */
router.get('/analytics/summary', async (req, res) => {
  try {
    const { campaignId, startDate, endDate } = req.query;

    // Build match query
    const matchQuery = {};
    if (campaignId) matchQuery.campaignId = campaignId;
    
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
    }

    const analytics = await Call.aggregate([
      { $match: matchQuery },
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
          avgLeadScore: { $avg: '$leadScore' },
          outcomeBreakdown: {
            $push: '$outcome'
          },
          sentimentBreakdown: {
            $push: '$sentiment.overall'
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
      avgLeadScore: 0,
      outcomeBreakdown: [],
      sentimentBreakdown: []
    };

    // Process outcome breakdown
    const outcomeStats = {};
    stats.outcomeBreakdown.forEach(outcome => {
      if (outcome) {
        outcomeStats[outcome] = (outcomeStats[outcome] || 0) + 1;
      }
    });

    // Process sentiment breakdown
    const sentimentStats = {};
    stats.sentimentBreakdown.forEach(sentiment => {
      if (sentiment) {
        sentimentStats[sentiment] = (sentimentStats[sentiment] || 0) + 1;
      }
    });

    // Calculate rates
    const answerRate = stats.totalCalls > 0 ? (stats.answeredCalls / stats.totalCalls * 100) : 0;
    const completionRate = stats.totalCalls > 0 ? (stats.completedCalls / stats.totalCalls * 100) : 0;
    const successfulOutcomes = (outcomeStats.sale || 0) + (outcomeStats.interested || 0);
    const conversionRate = stats.completedCalls > 0 ? (successfulOutcomes / stats.completedCalls * 100) : 0;

    res.json({
      summary: {
        totalCalls: stats.totalCalls,
        completedCalls: stats.completedCalls,
        answeredCalls: stats.answeredCalls,
        answerRate: Math.round(answerRate * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        avgDuration: Math.round(stats.avgDuration || 0),
        avgDurationMinutes: Math.round((stats.avgDuration / 60) * 100) / 100,
        totalDurationHours: Math.round((stats.totalDuration / 3600) * 100) / 100,
        totalCost: Math.round((stats.totalCost || 0) * 10000) / 10000,
        costPerCall: stats.totalCalls > 0 ? Math.round((stats.totalCost / stats.totalCalls) * 10000) / 10000 : 0,
        avgLeadScore: Math.round((stats.avgLeadScore || 0) * 100) / 100
      },
      outcomeBreakdown: outcomeStats,
      sentimentBreakdown: sentimentStats
    });

  } catch (error) {
    logger.error('Error fetching call analytics', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * Get active conversations
 */
router.get('/active/conversations', async (req, res) => {
  try {
    const activeCount = conversationService.getActiveConversationCount();
    
    // Get active calls from database
    const activeCalls = await Call.find({
      status: { $in: ['queued', 'ringing', 'in-progress'] }
    })
      .populate('leadId', 'firstName lastName phoneNumber')
      .populate('campaignId', 'name')
      .sort({ startedAt: -1 })
      .limit(20);

    res.json({
      activeConversations: activeCount,
      activeCalls: activeCalls.map(call => ({
        id: call._id,
        callSid: call.callSid,
        status: call.status,
        startedAt: call.startedAt,
        duration: call.startedAt ? Math.round((new Date() - call.startedAt) / 1000) : 0,
        lead: call.leadId,
        campaign: call.campaignId
      }))
    });

  } catch (error) {
    logger.error('Error fetching active conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch active conversations' });
  }
});

module.exports = router;
