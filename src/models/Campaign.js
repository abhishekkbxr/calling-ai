const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  // Basic campaign information
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  
  // Campaign status
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  
  // Scheduling
  scheduledStart: Date,
  scheduledEnd: Date,
  actualStart: Date,
  actualEnd: Date,
  
  // Time restrictions
  workingHours: {
    start: {
      type: String,
      default: '09:00'
    },
    end: {
      type: String,
      default: '17:00'
    },
    timezone: {
      type: String,
      default: 'America/New_York'
    }
  },
  workingDays: {
    type: [Number], // 0 = Sunday, 1 = Monday, etc.
    default: [1, 2, 3, 4, 5] // Monday to Friday
  },
  
  // Call configuration
  maxAttemptsPerLead: {
    type: Number,
    default: 3
  },
  retryDelay: {
    type: Number,
    default: 24 // hours between retries
  },
  concurrentCalls: {
    type: Number,
    default: 1,
    max: 10
  },
  
  // Conversation configuration
  script: {
    opening: {
      type: String,
      required: true,
      default: "Hello, this is an automated sales call. Am I speaking with {firstName}?"
    },
    qualification: [{
      question: String,
      expectedResponses: [String]
    }],
    objectionHandling: [{
      objection: String,
      response: String
    }],
    closing: {
      type: String,
      default: "Thank you for your time. Have a great day!"
    }
  },
  
  // AI Configuration
  aiSettings: {
    model: {
      type: String,
      default: 'gpt-4'
    },
    temperature: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 2
    },
    maxTokens: {
      type: Number,
      default: 150
    },
    systemPrompt: {
      type: String,
      default: "You are a professional sales agent. Be polite, helpful, and persuasive. Keep responses concise and natural."
    }
  },
  
  // Voice settings
  voiceSettings: {
    voice: {
      type: String,
      default: 'alice'
    },
    speed: {
      type: Number,
      default: 1.0,
      min: 0.5,
      max: 2.0
    },
    language: {
      type: String,
      default: 'en-US'
    }
  },
  
  // Goals and metrics
  goals: {
    totalCalls: Number,
    conversionRate: Number, // target conversion rate percentage
    avgCallDuration: Number // target average call duration in seconds
  },
  
  // Statistics (calculated)
  stats: {
    totalLeads: {
      type: Number,
      default: 0
    },
    totalCalls: {
      type: Number,
      default: 0
    },
    completedCalls: {
      type: Number,
      default: 0
    },
    successfulCalls: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    avgCallDuration: {
      type: Number,
      default: 0
    },
    totalCost: {
      type: Number,
      default: 0
    }
  },
  
  // Lead management
  leadSource: {
    type: String,
    enum: ['upload', 'api', 'manual', 'import'],
    default: 'upload'
  },
  
  // Tags and categorization
  tags: [String],
  
  // User who created the campaign
  createdBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Indexes
campaignSchema.index({ status: 1 });
campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ scheduledStart: 1 });

// Virtual for conversion rate calculation
campaignSchema.virtual('currentConversionRate').get(function() {
  if (this.stats.completedCalls === 0) return 0;
  return Math.round((this.stats.successfulCalls / this.stats.completedCalls) * 100 * 100) / 100;
});

// Method to check if campaign should be running
campaignSchema.methods.shouldBeRunning = function() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  // Check if within working hours
  const startHour = parseInt(this.workingHours.start.split(':')[0]);
  const endHour = parseInt(this.workingHours.end.split(':')[0]);
  
  if (currentHour < startHour || currentHour >= endHour) {
    return false;
  }
  
  // Check if within working days
  if (!this.workingDays.includes(currentDay)) {
    return false;
  }
  
  // Check campaign schedule
  if (this.scheduledStart && now < this.scheduledStart) {
    return false;
  }
  
  if (this.scheduledEnd && now > this.scheduledEnd) {
    return false;
  }
  
  return this.status === 'running';
};

// Method to update campaign statistics
campaignSchema.methods.updateStats = async function() {
  const Call = mongoose.model('Call');
  const Lead = mongoose.model('Lead');
  
  // Get total leads
  this.stats.totalLeads = await Lead.countDocuments({ campaignId: this._id });
  
  // Get call statistics
  const callStats = await Call.aggregate([
    { $match: { campaignId: this._id } },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        completedCalls: {
          $sum: {
            $cond: [{ $in: ['$status', ['completed']] }, 1, 0]
          }
        },
        successfulCalls: {
          $sum: {
            $cond: [{ $in: ['$outcome', ['sale', 'interested']] }, 1, 0]
          }
        },
        avgDuration: { $avg: '$duration' },
        totalCost: { $sum: '$cost' }
      }
    }
  ]);
  
  if (callStats.length > 0) {
    const stats = callStats[0];
    this.stats.totalCalls = stats.totalCalls || 0;
    this.stats.completedCalls = stats.completedCalls || 0;
    this.stats.successfulCalls = stats.successfulCalls || 0;
    this.stats.avgCallDuration = Math.round(stats.avgDuration || 0);
    this.stats.totalCost = Math.round((stats.totalCost || 0) * 100) / 100;
    this.stats.conversionRate = this.stats.completedCalls > 0 
      ? Math.round((this.stats.successfulCalls / this.stats.completedCalls) * 100 * 100) / 100 
      : 0;
  }
  
  await this.save();
};

module.exports = mongoose.model('Campaign', campaignSchema);
