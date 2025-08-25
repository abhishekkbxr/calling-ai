const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  // Campaign reference
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  
  // Contact information
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  
  // Additional contact details
  company: {
    type: String,
    trim: true
  },
  jobTitle: {
    type: String,
    trim: true
  },
  industry: {
    type: String,
    trim: true
  },
  
  // Geographic information
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: {
      type: String,
      default: 'US'
    }
  },
  timezone: {
    type: String,
    default: 'America/New_York'
  },
  
  // Lead status and scoring
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'interested', 'not-interested', 'callback', 'converted', 'do-not-call'],
    default: 'new'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  score: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  
  // Call history tracking
  totalCalls: {
    type: Number,
    default: 0
  },
  lastCallDate: Date,
  nextCallDate: Date,
  bestTimeToCall: {
    start: {
      type: String,
      default: '09:00'
    },
    end: {
      type: String,
      default: '17:00'
    }
  },
  
  // Conversation context and preferences
  preferences: {
    language: {
      type: String,
      default: 'en'
    },
    communicationStyle: {
      type: String,
      enum: ['formal', 'casual', 'direct'],
      default: 'formal'
    },
    topics: [String], // Topics of interest
    objections: [String] // Previously raised objections
  },
  
  // Custom fields for personalization
  customFields: {
    type: Map,
    of: String
  },
  
  // Lead source and attribution
  source: {
    type: String,
    enum: ['website', 'referral', 'advertisement', 'cold-outreach', 'social-media', 'other'],
    default: 'other'
  },
  sourceDetails: String,
  
  // Qualification information
  budget: {
    min: Number,
    max: Number,
    currency: {
      type: String,
      default: 'USD'
    }
  },
  decisionMaker: {
    type: Boolean,
    default: false
  },
  timeframe: {
    type: String,
    enum: ['immediate', '1-3-months', '3-6-months', '6-12-months', 'no-timeline'],
    default: 'no-timeline'
  },
  
  // Notes and tags
  notes: [{
    content: String,
    addedBy: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [String],
  
  // GDPR and compliance
  consent: {
    marketing: {
      type: Boolean,
      default: false
    },
    calls: {
      type: Boolean,
      default: true
    },
    dataProcessing: {
      type: Boolean,
      default: true
    },
    consentDate: Date
  },
  doNotCall: {
    type: Boolean,
    default: false
  },
  doNotCallReason: String,
  
  // System fields
  imported: {
    batchId: String,
    importDate: Date,
    originalData: Object
  }
}, {
  timestamps: true
});

// Indexes for performance
leadSchema.index({ campaignId: 1, status: 1 });
leadSchema.index({ phoneNumber: 1 });
leadSchema.index({ email: 1 });
leadSchema.index({ status: 1, priority: 1 });
leadSchema.index({ nextCallDate: 1 });
leadSchema.index({ score: -1 });

// Virtual for full name
leadSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});

// Virtual to check if lead is callable
leadSchema.virtual('isCallable').get(function() {
  if (this.doNotCall) return false;
  if (this.status === 'do-not-call') return false;
  if (this.status === 'converted') return false;
  return true;
});

// Method to check if lead should be called now
leadSchema.methods.shouldBeCalledNow = function(campaignWorkingHours, campaignWorkingDays) {
  if (!this.isCallable) return false;
  
  const now = new Date();
  
  // Check if we have a scheduled next call date
  if (this.nextCallDate && now < this.nextCallDate) {
    return false;
  }
  
  // Check lead's best time to call (in their timezone)
  // For simplicity, we'll use the campaign's working hours
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  const startHour = parseInt(this.bestTimeToCall.start.split(':')[0]);
  const endHour = parseInt(this.bestTimeToCall.end.split(':')[0]);
  
  if (currentHour < startHour || currentHour >= endHour) {
    return false;
  }
  
  // Check if today is a working day
  if (campaignWorkingDays && !campaignWorkingDays.includes(currentDay)) {
    return false;
  }
  
  return true;
};

// Method to update lead score based on call outcome
leadSchema.methods.updateScore = function(callOutcome, sentiment) {
  let scoreChange = 0;
  
  switch (callOutcome) {
    case 'sale':
      scoreChange = 30;
      this.status = 'converted';
      break;
    case 'interested':
      scoreChange = 20;
      this.status = 'interested';
      break;
    case 'callback':
      scoreChange = 10;
      this.status = 'callback';
      break;
    case 'not-interested':
      scoreChange = -15;
      this.status = 'not-interested';
      break;
    case 'wrong-number':
      scoreChange = -30;
      this.status = 'do-not-call';
      this.doNotCall = true;
      this.doNotCallReason = 'Wrong number';
      break;
    default:
      scoreChange = -5;
  }
  
  // Adjust based on sentiment
  if (sentiment) {
    if (sentiment.overall === 'positive') scoreChange += 5;
    else if (sentiment.overall === 'negative') scoreChange -= 5;
  }
  
  // Update score with bounds checking
  this.score = Math.max(0, Math.min(100, this.score + scoreChange));
  
  // Update call tracking
  this.totalCalls += 1;
  this.lastCallDate = new Date();
  
  return this.save();
};

// Method to schedule next call
leadSchema.methods.scheduleNextCall = function(retryDelayHours = 24) {
  if (this.status === 'callback') {
    // Schedule for next business day
    const nextCall = new Date();
    nextCall.setDate(nextCall.getDate() + 1);
    nextCall.setHours(9, 0, 0, 0); // 9 AM next day
    this.nextCallDate = nextCall;
  } else if (this.status === 'new' || this.status === 'contacted') {
    // Schedule retry based on campaign settings
    const nextCall = new Date();
    nextCall.setHours(nextCall.getHours() + retryDelayHours);
    this.nextCallDate = nextCall;
  }
  
  return this.save();
};

// Static method to find leads ready for calling
leadSchema.statics.findCallableLeads = function(campaignId, limit = 10) {
  return this.find({
    campaignId,
    doNotCall: false,
    status: { $nin: ['do-not-call', 'converted'] },
    $or: [
      { nextCallDate: { $exists: false } },
      { nextCallDate: { $lte: new Date() } }
    ]
  })
  .sort({ priority: -1, score: -1, updatedAt: 1 })
  .limit(limit);
};

module.exports = mongoose.model('Lead', leadSchema);
