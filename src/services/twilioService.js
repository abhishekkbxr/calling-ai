const twilio = require('twilio');
const logger = require('../utils/logger');

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  /**
   * Initiate an outbound call
   * @param {string} toNumber - Phone number to call
   * @param {string} webhookUrl - URL for Twilio to send webhooks
   * @param {Object} customData - Custom data to pass to webhook
   * @returns {Promise<Object>} Call object
   */
  async makeCall(toNumber, webhookUrl, customData = {}) {
    try {
      logger.info(`Initiating call to ${toNumber}`, { toNumber, webhookUrl });

      const call = await this.client.calls.create({
        to: toNumber,
        from: this.fromNumber,
        url: webhookUrl,
        method: 'POST',
        record: true,
        recordingStatusCallback: `${process.env.BASE_URL}/api/webhooks/twilio/recording`,
        recordingStatusCallbackMethod: 'POST',
        timeout: 30, // Ring timeout in seconds
        // Pass custom data as URL parameters
        url: `${webhookUrl}?${new URLSearchParams(customData).toString()}`
      });

      logger.info(`Call initiated successfully`, { 
        callSid: call.sid, 
        status: call.status,
        toNumber 
      });

      return {
        callSid: call.sid,
        status: call.status,
        direction: call.direction,
        to: call.to,
        from: call.from,
        startTime: call.startTime
      };

    } catch (error) {
      logger.error('Failed to initiate call', { 
        error: error.message, 
        toNumber,
        code: error.code 
      });
      throw error;
    }
  }

  /**
   * Generate TwiML for voice response
   * @param {string} message - Message to speak
   * @param {Object} options - Voice options
   * @returns {string} TwiML XML
   */
  generateTwiML(message, options = {}) {
    const {
      voice = 'alice',
      language = 'en-US',
      pauseAfter = 1,
      continueUrl = null,
      gatherInput = false,
      gatherOptions = {}
    } = options;

    const twiml = new twilio.twiml.VoiceResponse();

    if (gatherInput) {
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 3,
        speechModel: 'experimental_conversations',
        enhanced: true,
        action: gatherOptions.action || continueUrl,
        method: 'POST',
        timeout: gatherOptions.timeout || 5,
        ...gatherOptions
      });

      gather.say({
        voice,
        language
      }, message);

      // Fallback if no input received
      if (gatherOptions.noInputMessage) {
        twiml.say({
          voice,
          language
        }, gatherOptions.noInputMessage);
      }

    } else {
      twiml.say({
        voice,
        language
      }, message);
    }

    // Add pause
    if (pauseAfter > 0) {
      twiml.pause({ length: pauseAfter });
    }

    // Continue to next URL if provided
    if (continueUrl && !gatherInput) {
      twiml.redirect(continueUrl);
    }

    const twimlString = twiml.toString();
    logger.debug('Generated TwiML', { twiml: twimlString });

    return twimlString;
  }

  /**
   * Generate TwiML to end call
   * @param {string} message - Final message before hanging up
   * @returns {string} TwiML XML
   */
  generateHangupTwiML(message = 'Thank you for your time. Goodbye!') {
    const twiml = new twilio.twiml.VoiceResponse();
    
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, message);
    
    twiml.hangup();
    
    return twiml.toString();
  }

  /**
   * Get call details from Twilio
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Call details
   */
  async getCallDetails(callSid) {
    try {
      const call = await this.client.calls(callSid).fetch();
      
      return {
        sid: call.sid,
        status: call.status,
        direction: call.direction,
        from: call.from,
        to: call.to,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        price: call.price,
        priceUnit: call.priceUnit
      };
    } catch (error) {
      logger.error('Failed to fetch call details', { 
        error: error.message, 
        callSid 
      });
      throw error;
    }
  }

  /**
   * Update an ongoing call
   * @param {string} callSid - Twilio call SID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated call
   */
  async updateCall(callSid, updates) {
    try {
      const call = await this.client.calls(callSid).update(updates);
      
      logger.info('Call updated successfully', { 
        callSid, 
        updates,
        newStatus: call.status 
      });
      
      return call;
    } catch (error) {
      logger.error('Failed to update call', { 
        error: error.message, 
        callSid,
        updates 
      });
      throw error;
    }
  }

  /**
   * Hangup an ongoing call
   * @param {string} callSid - Twilio call SID
   * @returns {Promise<Object>} Call status
   */
  async hangupCall(callSid) {
    try {
      return await this.updateCall(callSid, { status: 'completed' });
    } catch (error) {
      logger.error('Failed to hangup call', { 
        error: error.message, 
        callSid 
      });
      throw error;
    }
  }

  /**
   * Get recording details
   * @param {string} recordingSid - Twilio recording SID
   * @returns {Promise<Object>} Recording details
   */
  async getRecording(recordingSid) {
    try {
      const recording = await this.client.recordings(recordingSid).fetch();
      
      return {
        sid: recording.sid,
        accountSid: recording.accountSid,
        callSid: recording.callSid,
        status: recording.status,
        startTime: recording.startTime,
        duration: recording.duration,
        price: recording.price,
        uri: recording.uri
      };
    } catch (error) {
      logger.error('Failed to fetch recording', { 
        error: error.message, 
        recordingSid 
      });
      throw error;
    }
  }

  /**
   * Validate webhook request from Twilio
   * @param {string} url - The webhook URL
   * @param {Object} params - Request parameters
   * @param {string} signature - Twilio signature header
   * @returns {boolean} Is valid webhook
   */
  validateWebhook(url, params, signature) {
    try {
      return twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        signature,
        url,
        params
      );
    } catch (error) {
      logger.error('Webhook validation failed', { 
        error: error.message,
        url 
      });
      return false;
    }
  }

  /**
   * Format phone number for Twilio
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');
    
    // Add country code if missing (assumes US/Canada)
    if (digits.length === 10) {
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    } else if (digits.length > 11) {
      return `+${digits}`;
    }
    
    return phoneNumber; // Return as-is if format is unclear
  }

  /**
   * Check if service is properly configured
   * @returns {boolean} Is configured
   */
  isConfigured() {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    );
  }
}

module.exports = new TwilioService();
