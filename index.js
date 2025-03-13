// Main application entry point
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Import your services (adjust paths if needed)
const dbService = require('./database-service-improved');
const conversationService = require('./llm-conversation-service-improved');

// Middleware
app.use(cors());
app.use(express.json());

// Basic routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// Search route
app.get('/api/search', (req, res) => {
  res.status(200).json({ 
    videos: [], 
    pagination: { total: 0, page: 1, limit: 10, pages: 0 } 
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
