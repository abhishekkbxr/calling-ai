const OpenAI = require('openai');
const logger = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate AI response for conversation
   * @param {Array} conversationHistory - Previous conversation messages
   * @param {Object} context - Call context (lead info, campaign settings, etc.)
   * @param {Object} options - Generation options
   * @returns {Promise<string>} AI response
   */
  async generateResponse(conversationHistory, context, options = {}) {
    try {
      const {
        model = 'gpt-4',
        temperature = 0.7,
        maxTokens = 150,
        systemPrompt = null
      } = options;

      // Build system prompt
      const systemMessage = this.buildSystemPrompt(context, systemPrompt);

      // Format conversation history
      const messages = [
        { role: 'system', content: systemMessage },
        ...conversationHistory.map(msg => ({
          role: msg.speaker === 'agent' ? 'assistant' : 'user',
          content: msg.message
        }))
      ];

      logger.debug('Generating AI response', { 
        model, 
        temperature, 
        maxTokens,
        messagesCount: messages.length 
      });

      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        presence_penalty: 0.3,
        frequency_penalty: 0.3
      });

      const response = completion.choices[0].message.content.trim();
      
      logger.info('AI response generated', { 
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        responseLength: response.length
      });

      return response;

    } catch (error) {
      logger.error('Failed to generate AI response', { 
        error: error.message,
        model: options.model,
        conversationLength: conversationHistory.length
      });
      
      // Return fallback response
      return this.getFallbackResponse(conversationHistory, context);
    }
  }

  /**
   * Build system prompt based on context
   * @param {Object} context - Call context
   * @param {string} customPrompt - Custom system prompt
   * @returns {string} System prompt
   */
  buildSystemPrompt(context, customPrompt = null) {
    const { lead, campaign, callContext } = context;

    let prompt = customPrompt || campaign?.aiSettings?.systemPrompt || `
You are a professional sales agent conducting a phone call. Your goal is to:
1. Build rapport with the prospect
2. Understand their needs and pain points
3. Present your solution effectively
4. Handle objections professionally
5. Move the conversation toward a positive outcome

Keep your responses:
- Natural and conversational
- Concise (under 50 words when possible)
- Professional but friendly
- Focused on the prospect's needs
`;

    // Add lead-specific context
    if (lead) {
      prompt += `\n\nProspect Information:`;
      prompt += `\n- Name: ${lead.firstName} ${lead.lastName || ''}`;
      if (lead.company) prompt += `\n- Company: ${lead.company}`;
      if (lead.jobTitle) prompt += `\n- Job Title: ${lead.jobTitle}`;
      if (lead.industry) prompt += `\n- Industry: ${lead.industry}`;
      
      // Add previous conversation context
      if (lead.preferences?.objections?.length > 0) {
        prompt += `\n- Previous objections: ${lead.preferences.objections.join(', ')}`;
      }
      
      if (lead.preferences?.topics?.length > 0) {
        prompt += `\n- Topics of interest: ${lead.preferences.topics.join(', ')}`;
      }
    }

    // Add campaign-specific context
    if (campaign) {
      if (campaign.script?.objectionHandling?.length > 0) {
        prompt += `\n\nObjection Handling:`;
        campaign.script.objectionHandling.forEach(oh => {
          prompt += `\n- If prospect says "${oh.objection}": ${oh.response}`;
        });
      }

      if (campaign.script?.qualification?.length > 0) {
        prompt += `\n\nQualification Questions:`;
        campaign.script.qualification.forEach((q, index) => {
          prompt += `\n${index + 1}. ${q.question}`;
          if (q.expectedResponses?.length > 0) {
            prompt += ` (Look for: ${q.expectedResponses.join(', ')})`;
          }
        });
      }
    }

    // Add call-specific context
    if (callContext) {
      if (callContext.callNumber > 1) {
        prompt += `\n\nThis is follow-up call #${callContext.callNumber}. Reference previous conversations appropriately.`;
      }
      
      if (callContext.timeOfDay) {
        prompt += `\n\nCurrent time context: ${callContext.timeOfDay}`;
      }
    }

    prompt += `\n\nIMPORTANT: 
- Keep responses under 50 words
- Ask one question at a time
- Listen actively and respond to what the prospect actually says
- If the prospect asks to be removed from calls, respect their request immediately
- If the prospect is not interested, politely end the call`;

    return prompt;
  }

  /**
   * Analyze conversation sentiment
   * @param {Array} conversationHistory - Conversation messages
   * @returns {Promise<Object>} Sentiment analysis
   */
  async analyzeSentiment(conversationHistory) {
    try {
      const conversationText = conversationHistory
        .filter(msg => msg.speaker === 'customer')
        .map(msg => msg.message)
        .join(' ');

      if (!conversationText.trim()) {
        return { overall: 'neutral', score: 0, confidence: 0 };
      }

      const completion = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Analyze the sentiment of this customer's responses in a sales call. 
            Respond with a JSON object containing:
            - overall: "positive", "neutral", or "negative"
            - score: number between -1 (very negative) and 1 (very positive)
            - confidence: number between 0 and 1
            - reasons: array of key phrases that influenced the sentiment`
          },
          {
            role: 'user',
            content: conversationText
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      });

      const response = completion.choices[0].message.content;
      const sentiment = JSON.parse(response);

      logger.debug('Sentiment analysis completed', { 
        sentiment,
        textLength: conversationText.length 
      });

      return sentiment;

    } catch (error) {
      logger.error('Failed to analyze sentiment', { 
        error: error.message,
        conversationLength: conversationHistory.length
      });
      
      // Return neutral sentiment as fallback
      return { overall: 'neutral', score: 0, confidence: 0 };
    }
  }

  /**
   * Extract key information from conversation
   * @param {Array} conversationHistory - Conversation messages
   * @param {Object} extractionGoals - What information to extract
   * @returns {Promise<Object>} Extracted information
   */
  async extractInformation(conversationHistory, extractionGoals = {}) {
    try {
      const conversationText = conversationHistory
        .map(msg => `${msg.speaker}: ${msg.message}`)
        .join('\n');

      const defaultGoals = {
        budget: 'Extract any budget information mentioned',
        timeline: 'Extract purchase timeline or urgency',
        decisionMaker: 'Determine if this person makes purchasing decisions',
        painPoints: 'Identify customer pain points or challenges',
        interests: 'Note topics or features the customer showed interest in',
        objections: 'List any objections or concerns raised',
        nextSteps: 'Identify any requested follow-up actions'
      };

      const goals = { ...defaultGoals, ...extractionGoals };

      const completion = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Extract key information from this sales call conversation. 
            Return a JSON object with the following fields: ${Object.keys(goals).join(', ')}.
            For each field, provide either the extracted information or null if not mentioned.
            
            Extraction goals:
            ${Object.entries(goals).map(([key, goal]) => `- ${key}: ${goal}`).join('\n')}`
          },
          {
            role: 'user',
            content: conversationText
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      });

      const response = completion.choices[0].message.content;
      const extractedInfo = JSON.parse(response);

      logger.debug('Information extraction completed', { 
        extractedInfo,
        conversationLength: conversationHistory.length 
      });

      return extractedInfo;

    } catch (error) {
      logger.error('Failed to extract information', { 
        error: error.message,
        conversationLength: conversationHistory.length
      });
      
      return {};
    }
  }

  /**
   * Generate call summary
   * @param {Array} conversationHistory - Conversation messages
   * @param {Object} callOutcome - Call outcome details
   * @returns {Promise<string>} Call summary
   */
  async generateCallSummary(conversationHistory, callOutcome) {
    try {
      const conversationText = conversationHistory
        .map(msg => `${msg.speaker}: ${msg.message}`)
        .join('\n');

      const completion = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Generate a concise summary of this sales call conversation. Include:
            - Key discussion points
            - Customer's response and sentiment
            - Any objections or concerns raised
            - Next steps or follow-up required
            - Overall call outcome assessment
            
            Keep the summary under 200 words and professional in tone.`
          },
          {
            role: 'user',
            content: `Conversation:\n${conversationText}\n\nCall Outcome: ${callOutcome.outcome || 'Unknown'}`
          }
        ],
        temperature: 0.3,
        max_tokens: 250
      });

      const summary = completion.choices[0].message.content.trim();

      logger.debug('Call summary generated', { 
        summaryLength: summary.length,
        conversationLength: conversationHistory.length 
      });

      return summary;

    } catch (error) {
      logger.error('Failed to generate call summary', { 
        error: error.message,
        conversationLength: conversationHistory.length
      });
      
      return `Call completed with outcome: ${callOutcome.outcome || 'Unknown'}. Duration: ${callOutcome.duration || 0} seconds.`;
    }
  }

  /**
   * Get fallback response when AI generation fails
   * @param {Array} conversationHistory - Conversation history
   * @param {Object} context - Call context
   * @returns {string} Fallback response
   */
  getFallbackResponse(conversationHistory, context) {
    const fallbackResponses = [
      "I understand. Can you tell me more about that?",
      "That's interesting. What's most important to you in this area?",
      "I appreciate you sharing that with me. How can I help you with this?",
      "Thank you for that information. What would you like to know about our solution?",
      "I see. What challenges are you currently facing with this?"
    ];

    // Return a random fallback response
    const randomIndex = Math.floor(Math.random() * fallbackResponses.length);
    return fallbackResponses[randomIndex];
  }

  /**
   * Check if service is properly configured
   * @returns {boolean} Is configured
   */
  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }
}

module.exports = new OpenAIService();
