const openaiService = require('./openaiService');
const twilioService = require('./twilioService');
const logger = require('../utils/logger');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');

class ConversationService {
  constructor() {
    this.activeConversations = new Map(); // Store active conversation states
  }

  /**
   * Initialize a new conversation
   * @param {string} callSid - Twilio call SID
   * @param {Object} lead - Lead information
   * @param {Object} campaign - Campaign information
   * @returns {Object} Conversation context
   */
  async initializeConversation(callSid, lead, campaign) {
    try {
      const conversationContext = {
        callSid,
        leadId: lead._id,
        campaignId: campaign._id,
        lead,
        campaign,
        conversationHistory: [],
        currentStep: 'opening',
        startTime: new Date(),
        callContext: {
          callNumber: lead.totalCalls + 1,
          timeOfDay: this.getTimeOfDay()
        }
      };

      this.activeConversations.set(callSid, conversationContext);

      logger.info('Conversation initialized', {
        callSid,
        leadId: lead._id,
        campaignId: campaign._id,
        leadName: lead.fullName
      });

      return conversationContext;

    } catch (error) {
      logger.error('Failed to initialize conversation', {
        error: error.message,
        callSid,
        leadId: lead._id
      });
      throw error;
    }
  }

  /**
   * Handle incoming speech from customer
   * @param {string} callSid - Twilio call SID
   * @param {string} customerSpeech - What customer said
   * @returns {Promise<string>} TwiML response
   */
  async handleCustomerSpeech(callSid, customerSpeech) {
    try {
      const conversation = this.activeConversations.get(callSid);
      if (!conversation) {
        logger.error('No active conversation found', { callSid });
        return twilioService.generateHangupTwiML('Thank you for calling. Goodbye!');
      }

      // Add customer speech to conversation history
      conversation.conversationHistory.push({
        speaker: 'customer',
        message: customerSpeech,
        timestamp: new Date()
      });

      logger.info('Customer speech received', {
        callSid,
        customerSpeech,
        conversationLength: conversation.conversationHistory.length
      });

      // Check for call termination requests
      if (this.shouldEndCall(customerSpeech)) {
        await this.endConversation(callSid, 'customer-requested');
        return twilioService.generateHangupTwiML(
          conversation.campaign.script?.closing || 'Thank you for your time. Goodbye!'
        );
      }

      // Generate AI response
      const aiResponse = await this.generateAIResponse(conversation, customerSpeech);
      
      // Add AI response to conversation history
      conversation.conversationHistory.push({
        speaker: 'agent',
        message: aiResponse,
        timestamp: new Date()
      });

      // Update conversation step based on response
      this.updateConversationStep(conversation, aiResponse);

      // Generate TwiML with AI response
      const continueUrl = `${process.env.BASE_URL}/api/webhooks/twilio/gather?callSid=${callSid}`;
      
      const twiml = twilioService.generateTwiML(aiResponse, {
        voice: conversation.campaign.voiceSettings?.voice || 'alice',
        language: conversation.campaign.voiceSettings?.language || 'en-US',
        gatherInput: true,
        continueUrl,
        gatherOptions: {
          action: continueUrl,
          timeout: 5,
          noInputMessage: "I didn't hear anything. Are you still there?"
        }
      });

      // Save conversation state to database
      await this.saveConversationState(conversation);

      return twiml;

    } catch (error) {
      logger.error('Failed to handle customer speech', {
        error: error.message,
        callSid,
        customerSpeech
      });

      // Return error handling TwiML
      return twilioService.generateTwiML(
        "I apologize, I didn't quite catch that. Could you please repeat?",
        {
          gatherInput: true,
          gatherOptions: {
            action: `${process.env.BASE_URL}/api/webhooks/twilio/gather?callSid=${callSid}`,
            timeout: 5
          }
        }
      );
    }
  }

  /**
   * Generate opening message for conversation
   * @param {Object} conversation - Conversation context
   * @returns {Promise<string>} TwiML response
   */
  async generateOpeningMessage(conversation) {
    try {
      const { lead, campaign } = conversation;
      
      // Use campaign script or generate personalized opening
      let openingMessage = campaign.script?.opening || 
        `Hello, this is an automated sales call. Am I speaking with ${lead.firstName}?`;

      // Replace placeholders
      openingMessage = this.replacePlaceholders(openingMessage, lead);

      // Add to conversation history
      conversation.conversationHistory.push({
        speaker: 'agent',
        message: openingMessage,
        timestamp: new Date()
      });

      logger.info('Opening message generated', {
        callSid: conversation.callSid,
        openingMessage
      });

      // Generate TwiML
      const continueUrl = `${process.env.BASE_URL}/api/webhooks/twilio/gather?callSid=${conversation.callSid}`;
      
      return twilioService.generateTwiML(openingMessage, {
        voice: campaign.voiceSettings?.voice || 'alice',
        language: campaign.voiceSettings?.language || 'en-US',
        gatherInput: true,
        continueUrl,
        gatherOptions: {
          action: continueUrl,
          timeout: 5,
          noInputMessage: "Hello? Are you there?"
        }
      });

    } catch (error) {
      logger.error('Failed to generate opening message', {
        error: error.message,
        callSid: conversation.callSid
      });
      throw error;
    }
  }

  /**
   * Generate AI response based on conversation context
   * @param {Object} conversation - Conversation context
   * @param {string} customerInput - Latest customer input
   * @returns {Promise<string>} AI response
   */
  async generateAIResponse(conversation, customerInput) {
    try {
      const context = {
        lead: conversation.lead,
        campaign: conversation.campaign,
        callContext: conversation.callContext
      };

      const options = {
        model: conversation.campaign.aiSettings?.model || 'gpt-4',
        temperature: conversation.campaign.aiSettings?.temperature || 0.7,
        maxTokens: conversation.campaign.aiSettings?.maxTokens || 150,
        systemPrompt: conversation.campaign.aiSettings?.systemPrompt
      };

      const response = await openaiService.generateResponse(
        conversation.conversationHistory,
        context,
        options
      );

      logger.debug('AI response generated', {
        callSid: conversation.callSid,
        inputLength: customerInput.length,
        responseLength: response.length
      });

      return response;

    } catch (error) {
      logger.error('Failed to generate AI response', {
        error: error.message,
        callSid: conversation.callSid
      });

      // Return fallback response
      return "I understand. Can you tell me more about that?";
    }
  }

  /**
   * End conversation and perform cleanup
   * @param {string} callSid - Twilio call SID
   * @param {string} reason - Reason for ending
   * @returns {Promise<Object>} Call summary
   */
  async endConversation(callSid, reason = 'completed') {
    try {
      const conversation = this.activeConversations.get(callSid);
      if (!conversation) {
        logger.warn('Attempted to end non-existent conversation', { callSid });
        return null;
      }

      const endTime = new Date();
      const duration = Math.round((endTime - conversation.startTime) / 1000);

      // Analyze conversation
      const sentiment = await openaiService.analyzeSentiment(conversation.conversationHistory);
      const extractedInfo = await openaiService.extractInformation(conversation.conversationHistory);
      
      // Determine call outcome
      const outcome = this.determineCallOutcome(conversation.conversationHistory, extractedInfo, reason);

      // Create call record
      const callData = {
        callSid,
        campaignId: conversation.campaignId,
        leadId: conversation.leadId,
        phoneNumber: conversation.lead.phoneNumber,
        status: 'completed',
        startedAt: conversation.startTime,
        endedAt: endTime,
        duration,
        conversation: conversation.conversationHistory,
        sentiment,
        outcome,
        notes: await openaiService.generateCallSummary(conversation.conversationHistory, { outcome, duration })
      };

      // Save call to database
      const call = new Call(callData);
      await call.save();

      // Update lead information
      await this.updateLeadFromConversation(conversation.lead, extractedInfo, outcome, sentiment);

      // Update campaign statistics
      await conversation.campaign.updateStats();

      // Clean up active conversation
      this.activeConversations.delete(callSid);

      logger.info('Conversation ended successfully', {
        callSid,
        reason,
        outcome,
        duration,
        sentimentScore: sentiment.score
      });

      return {
        callId: call._id,
        outcome,
        duration,
        sentiment,
        extractedInfo
      };

    } catch (error) {
      logger.error('Failed to end conversation', {
        error: error.message,
        callSid,
        reason
      });
      throw error;
    }
  }

  /**
   * Check if call should be terminated based on customer input
   * @param {string} customerSpeech - Customer's speech
   * @returns {boolean} Should end call
   */
  shouldEndCall(customerSpeech) {
    const terminationPhrases = [
      'remove me',
      'take me off',
      'do not call',
      'not interested',
      'stop calling',
      'unsubscribe',
      'wrong number',
      'goodbye',
      'hang up',
      'end call'
    ];

    const lowerSpeech = customerSpeech.toLowerCase();
    return terminationPhrases.some(phrase => lowerSpeech.includes(phrase));
  }

  /**
   * Update conversation step based on AI response
   * @param {Object} conversation - Conversation context
   * @param {string} response - AI response
   */
  updateConversationStep(conversation, response) {
    const stepKeywords = {
      'qualification': ['qualify', 'budget', 'timeline', 'decision'],
      'presentation': ['solution', 'product', 'service', 'benefit'],
      'objection': ['concern', 'but', 'however', 'objection'],
      'closing': ['next step', 'schedule', 'sign up', 'purchase']
    };

    const lowerResponse = response.toLowerCase();
    
    for (const [step, keywords] of Object.entries(stepKeywords)) {
      if (keywords.some(keyword => lowerResponse.includes(keyword))) {
        conversation.currentStep = step;
        break;
      }
    }
  }

  /**
   * Determine call outcome based on conversation analysis
   * @param {Array} conversationHistory - Conversation messages
   * @param {Object} extractedInfo - Extracted information
   * @param {string} reason - End reason
   * @returns {string} Call outcome
   */
  determineCallOutcome(conversationHistory, extractedInfo, reason) {
    if (reason === 'customer-requested') {
      return 'not-interested';
    }

    // Check for positive indicators
    if (extractedInfo.nextSteps || extractedInfo.interests) {
      return 'interested';
    }

    // Check for callback requests
    if (extractedInfo.nextSteps && extractedInfo.nextSteps.includes('callback')) {
      return 'callback';
    }

    // Check conversation length and engagement
    const customerMessages = conversationHistory.filter(msg => msg.speaker === 'customer');
    
    if (customerMessages.length < 2) {
      return 'no-answer';
    }

    if (customerMessages.length > 5) {
      return 'interested';
    }

    return 'not-interested';
  }

  /**
   * Update lead information based on conversation
   * @param {Object} lead - Lead object
   * @param {Object} extractedInfo - Extracted information
   * @param {string} outcome - Call outcome
   * @param {Object} sentiment - Sentiment analysis
   */
  async updateLeadFromConversation(lead, extractedInfo, outcome, sentiment) {
    try {
      // Update lead score and status
      await lead.updateScore(outcome, sentiment);

      // Update extracted information
      if (extractedInfo.budget) {
        lead.budget = { min: extractedInfo.budget };
      }

      if (extractedInfo.timeline) {
        lead.timeframe = extractedInfo.timeline;
      }

      if (extractedInfo.decisionMaker !== null) {
        lead.decisionMaker = extractedInfo.decisionMaker;
      }

      // Update preferences
      if (extractedInfo.interests) {
        lead.preferences.topics = lead.preferences.topics || [];
        lead.preferences.topics.push(...extractedInfo.interests.split(',').map(t => t.trim()));
      }

      if (extractedInfo.objections) {
        lead.preferences.objections = lead.preferences.objections || [];
        lead.preferences.objections.push(...extractedInfo.objections.split(',').map(o => o.trim()));
      }

      // Schedule next call if needed
      if (outcome === 'callback') {
        await lead.scheduleNextCall(24); // 24 hours
      } else if (outcome === 'interested') {
        await lead.scheduleNextCall(72); // 3 days
      }

      await lead.save();

      logger.debug('Lead updated from conversation', {
        leadId: lead._id,
        outcome,
        newScore: lead.score,
        newStatus: lead.status
      });

    } catch (error) {
      logger.error('Failed to update lead from conversation', {
        error: error.message,
        leadId: lead._id
      });
    }
  }

  /**
   * Save conversation state to database
   * @param {Object} conversation - Conversation context
   */
  async saveConversationState(conversation) {
    try {
      // Update or create call record with current conversation state
      await Call.findOneAndUpdate(
        { callSid: conversation.callSid },
        {
          conversation: conversation.conversationHistory,
          status: 'in-progress'
        },
        { upsert: true }
      );

    } catch (error) {
      logger.error('Failed to save conversation state', {
        error: error.message,
        callSid: conversation.callSid
      });
    }
  }

  /**
   * Replace placeholders in text with lead information
   * @param {string} text - Text with placeholders
   * @param {Object} lead - Lead object
   * @returns {string} Text with replaced placeholders
   */
  replacePlaceholders(text, lead) {
    return text
      .replace(/\{firstName\}/g, lead.firstName)
      .replace(/\{lastName\}/g, lead.lastName || '')
      .replace(/\{fullName\}/g, lead.fullName)
      .replace(/\{company\}/g, lead.company || '')
      .replace(/\{jobTitle\}/g, lead.jobTitle || '');
  }

  /**
   * Get time of day context
   * @returns {string} Time of day
   */
  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  /**
   * Get active conversation count
   * @returns {number} Number of active conversations
   */
  getActiveConversationCount() {
    return this.activeConversations.size;
  }

  /**
   * Get conversation by call SID
   * @param {string} callSid - Twilio call SID
   * @returns {Object|null} Conversation context
   */
  getConversation(callSid) {
    return this.activeConversations.get(callSid) || null;
  }
}

module.exports = new ConversationService();
