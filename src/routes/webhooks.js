const express = require('express');
const twilioService = require('../services/twilioService');
const conversationService = require('../services/conversationService');
const logger = require('../utils/logger');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');

const router = express.Router();

/**
 * Twilio webhook handler for incoming calls
 */
router.post('/twilio/voice', async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus, Direction } = req.body;
    
    // Extract custom data from URL parameters
    const { campaignId, leadId } = req.query;

    logger.info('Twilio voice webhook received', {
      callSid: CallSid,
      from: From,
      to: To,
      status: CallStatus,
      direction: Direction,
      campaignId,
      leadId
    });

    // Validate webhook (optional but recommended for security)
    const signature = req.headers['x-twilio-signature'];
    if (signature && !twilioService.validateWebhook(req.url, req.body, signature)) {
      logger.warn('Invalid Twilio webhook signature', { callSid: CallSid });
      return res.status(403).send('Invalid signature');
    }

    // Get lead and campaign information
    const lead = await Lead.findById(leadId);
    const campaign = await Campaign.findById(campaignId);

    if (!lead || !campaign) {
      logger.error('Lead or campaign not found for webhook', { 
        callSid: CallSid, 
        leadId, 
        campaignId 
      });
      
      const twiml = twilioService.generateHangupTwiML('I apologize, there was an error. Goodbye!');
      return res.type('text/xml').send(twiml);
    }

    // Initialize conversation
    const conversation = await conversationService.initializeConversation(CallSid, lead, campaign);

    // Create initial call record
    const callData = {
      callSid: CallSid,
      campaignId: campaign._id,
      leadId: lead._id,
      phoneNumber: lead.phoneNumber,
      direction: Direction || 'outbound',
      status: 'in-progress',
      startedAt: new Date(),
      attemptNumber: lead.totalCalls + 1
    };

    const call = new Call(callData);
    await call.save();

    // Generate opening message
    const twiml = await conversationService.generateOpeningMessage(conversation);

    logger.info('Opening TwiML generated for call', { 
      callSid: CallSid,
      leadName: lead.fullName 
    });

    res.type('text/xml').send(twiml);

  } catch (error) {
    logger.error('Error in Twilio voice webhook', {
      error: error.message,
      callSid: req.body.CallSid,
      stack: error.stack
    });

    // Return error TwiML
    const twiml = twilioService.generateHangupTwiML('I apologize, there was an error. Goodbye!');
    res.type('text/xml').send(twiml);
  }
});

/**
 * Twilio webhook handler for speech gathering
 */
router.post('/twilio/gather', async (req, res) => {
  try {
    const { CallSid, SpeechResult, Confidence } = req.body;
    const { callSid } = req.query;

    logger.info('Twilio gather webhook received', {
      callSid: CallSid || callSid,
      speechResult: SpeechResult,
      confidence: Confidence
    });

    const finalCallSid = CallSid || callSid;

    if (!SpeechResult) {
      // No speech detected, ask customer to repeat
      const twiml = twilioService.generateTwiML(
        "I didn't hear anything. Could you please say something?",
        {
          gatherInput: true,
          gatherOptions: {
            action: `${process.env.BASE_URL}/api/webhooks/twilio/gather?callSid=${finalCallSid}`,
            timeout: 5,
            noInputMessage: "I'm having trouble hearing you. Let me transfer you to someone who can help."
          }
        }
      );
      
      return res.type('text/xml').send(twiml);
    }

    // Handle customer speech
    const twiml = await conversationService.handleCustomerSpeech(finalCallSid, SpeechResult);

    logger.debug('Response TwiML generated', { 
      callSid: finalCallSid,
      speechResult: SpeechResult 
    });

    res.type('text/xml').send(twiml);

  } catch (error) {
    logger.error('Error in Twilio gather webhook', {
      error: error.message,
      callSid: req.body.CallSid || req.query.callSid,
      stack: error.stack
    });

    // Return error handling TwiML
    const twiml = twilioService.generateTwiML(
      "I apologize, I'm having technical difficulties. Let me end this call.",
      { gatherInput: false }
    );
    
    res.type('text/xml').send(twiml);
  }
});

/**
 * Twilio webhook handler for call status updates
 */
router.post('/twilio/status', async (req, res) => {
  try {
    const { 
      CallSid, 
      CallStatus, 
      CallDuration, 
      RecordingUrl,
      From,
      To 
    } = req.body;

    logger.info('Twilio status webhook received', {
      callSid: CallSid,
      status: CallStatus,
      duration: CallDuration,
      recordingUrl: RecordingUrl
    });

    // Update call record in database
    const updateData = { status: CallStatus };
    
    if (CallStatus === 'completed') {
      updateData.endedAt = new Date();
      if (CallDuration) {
        updateData.duration = parseInt(CallDuration);
      }
      if (RecordingUrl) {
        updateData.recordingUrl = RecordingUrl;
      }
    } else if (CallStatus === 'in-progress') {
      updateData.answeredAt = new Date();
    }

    await Call.findOneAndUpdate(
      { callSid: CallSid },
      updateData,
      { new: true }
    );

    // End conversation if call completed
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
      await conversationService.endConversation(CallSid, CallStatus);
    }

    // Emit real-time update via WebSocket
    if (req.io) {
      req.io.emit('callStatusUpdate', {
        callSid: CallSid,
        status: CallStatus,
        duration: CallDuration,
        timestamp: new Date()
      });
    }

    res.status(200).send('OK');

  } catch (error) {
    logger.error('Error in Twilio status webhook', {
      error: error.message,
      callSid: req.body.CallSid,
      stack: error.stack
    });
    
    res.status(500).send('Error processing status update');
  }
});

/**
 * Twilio webhook handler for recording notifications
 */
router.post('/twilio/recording', async (req, res) => {
  try {
    const { 
      CallSid, 
      RecordingSid, 
      RecordingUrl, 
      RecordingStatus,
      RecordingDuration 
    } = req.body;

    logger.info('Twilio recording webhook received', {
      callSid: CallSid,
      recordingSid: RecordingSid,
      recordingUrl: RecordingUrl,
      status: RecordingStatus,
      duration: RecordingDuration
    });

    // Update call record with recording information
    await Call.findOneAndUpdate(
      { callSid: CallSid },
      {
        recordingUrl: RecordingUrl,
        recordingSid: RecordingSid
      },
      { new: true }
    );

    // Emit real-time update via WebSocket
    if (req.io) {
      req.io.emit('recordingReady', {
        callSid: CallSid,
        recordingUrl: RecordingUrl,
        duration: RecordingDuration,
        timestamp: new Date()
      });
    }

    res.status(200).send('OK');

  } catch (error) {
    logger.error('Error in Twilio recording webhook', {
      error: error.message,
      callSid: req.body.CallSid,
      stack: error.stack
    });
    
    res.status(500).send('Error processing recording notification');
  }
});

/**
 * Generic webhook handler for testing
 */
router.post('/test', (req, res) => {
  logger.info('Test webhook received', {
    headers: req.headers,
    body: req.body,
    query: req.query
  });
  
  res.json({ 
    message: 'Webhook received successfully',
    timestamp: new Date(),
    data: req.body 
  });
});

/**
 * Webhook handler for external integrations (CRM, etc.)
 */
router.post('/integration/:service', async (req, res) => {
  try {
    const { service } = req.params;
    
    logger.info('Integration webhook received', {
      service,
      headers: req.headers,
      body: req.body
    });

    // Handle different service integrations
    switch (service.toLowerCase()) {
      case 'salesforce':
        // Handle Salesforce webhook
        await handleSalesforceWebhook(req.body);
        break;
        
      case 'hubspot':
        // Handle HubSpot webhook
        await handleHubSpotWebhook(req.body);
        break;
        
      case 'zapier':
        // Handle Zapier webhook
        await handleZapierWebhook(req.body);
        break;
        
      default:
        logger.warn('Unknown integration service', { service });
        return res.status(400).json({ error: 'Unknown service' });
    }

    res.json({ 
      message: 'Integration webhook processed successfully',
      service,
      timestamp: new Date()
    });

  } catch (error) {
    logger.error('Error in integration webhook', {
      error: error.message,
      service: req.params.service,
      stack: error.stack
    });
    
    res.status(500).json({ error: 'Error processing integration webhook' });
  }
});

// Placeholder functions for integration handlers
async function handleSalesforceWebhook(data) {
  // TODO: Implement Salesforce integration
  logger.info('Salesforce webhook data', { data });
}

async function handleHubSpotWebhook(data) {
  // TODO: Implement HubSpot integration
  logger.info('HubSpot webhook data', { data });
}

async function handleZapierWebhook(data) {
  // TODO: Implement Zapier integration
  logger.info('Zapier webhook data', { data });
}

module.exports = router;
