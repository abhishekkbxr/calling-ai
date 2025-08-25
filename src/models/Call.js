const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  // Call identification
  callSid: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // Campaign and lead information
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  
  // Call details
  phoneNumber: {
    type: String,
    required: true
  },
  direction: {
    type: String,
    enum: ['outbound', 'inbound'],
    default: 'outbound'
  },
  
  // Call status and timing
  status: {
    type: String,
    enum: ['queued', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled'],
    default: 'queued'
  },
  startedAt: Date,
  answeredAt: Date,
  endedAt: Date,
  duration: Number, // in seconds
  
  // Conversation data
  conversation: [{
    speaker: {
      type: String,
      enum: ['agent', 'customer'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    audioUrl: String, // URL to recorded audio segment
    confidence: Number // Speech recognition confidence
  }],
  
  // AI Analysis
  sentiment: {
    overall: {
      type: String,
      enum: ['positive', 'neutral', 'negative']
    },
    score: Number // -1 to 1
  },
  
  // Call outcome
  outcome: {
    type: String,
    enum: ['sale', 'interested', 'not-interested', 'callback', 'voicemail', 'wrong-number', 'no-answer'],
    default: 'no-answer'
  },
  leadScore: {
    type: Number,
    min: 0,
    max: 100
  },
  
  // Recording and transcription
  recordingUrl: String,
  transcription: String,
  
  // Cost tracking
  cost: {
    type: Number,
    default: 0
  },
  
  // Metadata
  notes: String,
  tags: [String],
  
  // Retry information
  attemptNumber: {
    type: Number,
    default: 1
  },
  isRetry: {
    type: Boolean,
    default: false
  },
  originalCallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call'
  }
}, {
  timestamps: true
});

// Indexes for performance
callSchema.index({ campaignId: 1, status: 1 });
callSchema.index({ phoneNumber: 1 });
callSchema.index({ createdAt: -1 });
callSchema.index({ leadId: 1, attemptNumber: 1 });

// Virtual for call duration in minutes
callSchema.virtual('durationMinutes').get(function() {
  return this.duration ? Math.round(this.duration / 60 * 100) / 100 : 0;
});

// Pre-save middleware to calculate duration
callSchema.pre('save', function(next) {
  if (this.answeredAt && this.endedAt) {
    this.duration = Math.round((this.endedAt - this.answeredAt) / 1000);
  }
  next();
});

module.exports = mongoose.model('Call', callSchema);
