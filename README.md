# AI-Powered Calling Agent

An intelligent Node.js application that automatically calls multiple users and handles sales conversations using OpenAI for conversation intelligence and Twilio for voice calling capabilities.

## Features

- **Automated Calling**: Bulk calling with intelligent conversation management
- **AI-Powered Conversations**: OpenAI GPT-4 integration for natural sales dialogues
- **Campaign Management**: Create, manage, and monitor calling campaigns
- **Lead Management**: Import leads via CSV and track engagement
- **Real-time Dashboard**: Live monitoring with analytics and call status
- **Speech Processing**: Text-to-speech and speech-to-text capabilities
- **Sentiment Analysis**: Real-time conversation sentiment tracking
- **Call Recording**: Automatic call recording and storage
- **Lead Scoring**: AI-powered lead qualification and scoring

## Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose
- **AI**: OpenAI GPT-4 API
- **Telephony**: Twilio Voice API
- **Real-time**: Socket.IO
- **Frontend**: HTML, CSS, JavaScript
- **Logging**: Winston

## Prerequisites

Before running this application, ensure you have:

1. **Node.js** (v16 or higher)
2. **MongoDB** (local or cloud instance)
3. **Twilio Account** with Voice API enabled
4. **OpenAI API Key** with GPT-4 access

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/abhishekkbxr/calling-ai.git
   cd calling-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

4. **Edit the `.env` file with your credentials**
   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # MongoDB Configuration
   MONGODB_URI=mongodb://localhost:27017/calling-ai

   # Twilio Configuration
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=+1234567890

   # OpenAI Configuration
   OPENAI_API_KEY=your_openai_api_key

   # Application URLs
   BASE_URL=http://localhost:3000
   ```

## Configuration

### Twilio Setup

1. **Create a Twilio Account**: Sign up at [twilio.com](https://www.twilio.com)
2. **Get Phone Number**: Purchase a Twilio phone number with voice capabilities
3. **Configure Webhooks**: Set up webhook URLs in your Twilio console:
   - Voice URL: `http://your-domain.com/webhooks/voice`
   - Status Callback URL: `http://your-domain.com/webhooks/status`

### OpenAI Setup

1. **Get API Key**: Create an account at [platform.openai.com](https://platform.openai.com)
2. **Enable GPT-4**: Ensure you have access to GPT-4 models
3. **Set Usage Limits**: Configure appropriate usage limits for your needs

### MongoDB Setup

1. **Local Installation**: Install MongoDB locally or use MongoDB Atlas
2. **Database Name**: The application will create a database named `calling-ai`
3. **Collections**: Collections will be automatically created when data is added

## Running the Application

1. **Start MongoDB** (if running locally)
   ```bash
   mongod
   ```

2. **Start the application**
   ```bash
   npm start
   ```

3. **Access the dashboard**
   Open your browser and navigate to `http://localhost:3000`

## Usage Guide

### 1. Creating a Campaign

1. Navigate to the **Campaigns** tab in the dashboard
2. Click **"Create New Campaign"**
3. Fill in campaign details:
   - **Name**: Campaign identifier
   - **Description**: Campaign purpose
   - **Script**: Initial conversation script for AI
   - **Max Call Duration**: Maximum call length in seconds
   - **Voice**: Twilio voice selection (alice, man, woman)

### 2. Adding Leads

1. Select your campaign
2. Click **"Upload Leads (CSV)"**
3. Upload a CSV file with the following format:
   ```csv
   name,phone,email,company
   John Doe,+1234567890,john@example.com,Example Corp
   Jane Smith,+1987654321,jane@example.com,Smith Industries
   ```

### 3. Starting a Campaign

1. Ensure your campaign has leads
2. Click **"Start Campaign"**
3. Monitor real-time progress in the dashboard
4. View call analytics and conversation summaries

### 4. Monitoring Calls

- **Real-time Updates**: Dashboard shows live call status
- **Call History**: View completed calls with transcripts
- **Analytics**: Campaign performance metrics
- **Lead Scoring**: AI-generated lead quality scores

## API Reference

### Campaigns

#### Create Campaign
```http
POST /api/campaigns
Content-Type: application/json

{
  "name": "Q1 Sales Campaign",
  "description": "Targeting new prospects",
  "script": "Hi, this is Sarah from TechCorp...",
  "maxCallDuration": 300,
  "voice": "alice"
}
```

#### Upload Leads
```http
POST /api/campaigns/:id/upload-leads
Content-Type: multipart/form-data

file: leads.csv
```

#### Start Campaign
```http
POST /api/campaigns/:id/start
```

### Calls

#### Get Call History
```http
GET /api/calls?campaignId=:id&page=1&limit=50
```

#### Get Call Details
```http
GET /api/calls/:id
```

#### Manual Call Initiation
```http
POST /api/calls
Content-Type: application/json

{
  "phoneNumber": "+1234567890",
  "campaignId": "campaign_id",
  "leadId": "lead_id"
}
```

## Configuration Options

### AI Conversation Settings

Customize AI behavior in campaign creation:

```javascript
{
  "aiSettings": {
    "model": "gpt-4",
    "temperature": 0.7,
    "maxTokens": 150,
    "systemPrompt": "You are a professional sales representative..."
  }
}
```

### Voice Settings

Available Twilio voices:
- `alice` (default)
- `man`
- `woman`

### Call Flow Configuration

Modify conversation flow in `src/services/conversationService.js`:

```javascript
const conversationFlow = {
  greeting: "Hi, this is Sarah from TechCorp. How are you today?",
  qualification: "I'm calling to discuss how we can help improve your business operations.",
  presentation: "Based on what you've told me, I think our solution would be perfect for you.",
  closing: "Would you be interested in scheduling a brief demo?"
};
```

## Troubleshooting

### Common Issues

1. **Twilio Webhook Errors**
   - Ensure your server is publicly accessible
   - Use ngrok for local development: `ngrok http 3000`
   - Update webhook URLs in Twilio console

2. **OpenAI Rate Limits**
   - Check your API usage limits
   - Implement exponential backoff for rate-limited requests
   - Consider upgrading your OpenAI plan

3. **MongoDB Connection Issues**
   - Verify MongoDB is running
   - Check connection string in `.env`
   - Ensure network connectivity for cloud databases

4. **Audio Quality Issues**
   - Test with different Twilio voices
   - Adjust speaking rate in TwiML generation
   - Check network latency and quality

### Logging

Application logs are stored in:
- `logs/combined.log` - All log levels
- `logs/error.log` - Error logs only
- Console output for development

Enable debug logging:
```bash
NODE_ENV=development npm start
```

## Compliance and Legal

⚠️ **Important**: Ensure compliance with local regulations:

- **TCPA Compliance**: Obtain proper consent before calling
- **Do Not Call Lists**: Check against DNC registries
- **GDPR/Privacy**: Handle personal data appropriately
- **Recording Laws**: Comply with call recording regulations
- **Business Hours**: Respect time zones and calling windows

## Development

### Project Structure

```
calling-ai/
├── src/
│   ├── config/         # Database and app configuration
│   ├── models/         # MongoDB schemas
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   └── utils/          # Utility functions
├── public/             # Frontend assets
├── logs/              # Application logs
└── package.json       # Dependencies and scripts
```

### Adding New Features

1. **New Routes**: Add to `src/routes/`
2. **Database Models**: Create in `src/models/`
3. **Business Logic**: Implement in `src/services/`
4. **Frontend**: Update `public/` files

### Testing

```bash
# Run tests (when implemented)
npm test

# Run in development mode
npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Review the troubleshooting section
- Check Twilio and OpenAI documentation

## Changelog

### v1.0.0
- Initial release with core calling functionality
- AI-powered conversation management
- Real-time dashboard and analytics
- Campaign and lead management
- Twilio and OpenAI integration
