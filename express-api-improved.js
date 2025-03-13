// app.js - Enhanced Express API server for Brawl Stars Content Navigator

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');
const pino = require('pino');
const expressPino = require('express-pino-logger');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const dbService = require('./database-service');
const conversationService = require('./llm-conversation-service');
const contentCollector = require('./data-collector');
const youtubeService = require('./youtube-service');

require('dotenv').config();

// Configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000');
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '604800000');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL;

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  } : undefined
});

// Create Express app
const app = express();

// Express-Pino-Logger middleware
const expressLogger = expressPino({ logger });

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Response compression
app.use(express.json({ limit: '1mb' })); // Parse JSON bodies with size limit
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // Parse URL-encoded bodies
app.use(cookieParser()); // Parse cookies
app.use(expressLogger); // Request logging
app.use(morgan('dev')); // Additional detailed request logging for development

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With']
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS, // Default: 15 minutes
  max: RATE_LIMIT_MAX_REQUESTS, // Default: 100 requests per window
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable the X-RateLimit headers
  message: { error: 'Too many requests, please try again later.' },
  skip: (req, res) => {
    // Skip rate limiting for admin endpoints with valid API key
    return req.path.startsWith('/api/admin') && 
           req.headers['x-api-key'] === ADMIN_API_KEY;
  }
});

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'brawlstars-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE, // Default: 1 week
    sameSite: 'lax'
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/brawlstars_content',
    collectionName: 'sessions',
    ttl: SESSION_MAX_AGE / 1000, // Convert ms to seconds
    autoRemove: 'interval',
    autoRemoveInterval: 60 // In minutes
  })
}));

// Performance monitoring middleware
app.use((req, res, next) => {
  if (process.env.ENABLE_PERFORMANCE_METRICS === 'true') {
    const start = Date.now();
    
    // Record metrics after response
    res.on('finish', () => {
      const duration = Date.now() - start;
      dbService.recordMetric('api_request', {
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('user-agent'),
        ip: req.ip
      }).catch(err => logger.error(err, 'Failed to record API metrics'));
    });
  }
  next();
});

// Initialize user preferences in session
app.use((req, res, next) => {
  if (!req.session.userPreferences) {
    req.session.userPreferences = {
      sessionId: req.sessionID,
      preferredBrawlers: [],
      preferredGameModes: [],
      preferredContentTypes: [],
      conversationHistory: []
    };
  }
  
  // Add unique user ID if not present
  if (!req.session.userId) {
    req.session.userId = uuidv4();
  }
  
  next();
});

// ------- Helper Functions -------

/**
 * Validate API key
 * @param {string} apiKey API key from request
 * @returns {boolean} Whether the API key is valid
 */
function validateApiKey(apiKey) {
  return apiKey === ADMIN_API_KEY;
}

/**
 * Generate a JWT token
 * @param {Object} payload Payload to include in token
 * @returns {string} JWT token
 */
function generateToken(payload) {
  return jwt.sign(
    payload,
    process.env.SESSION_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Verify a JWT token
 * @param {string} token JWT token
 * @returns {Object|null} Decoded token or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.SESSION_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Handle async route functions
 * @param {Function} fn Route handler function
 * @returns {Function} Express middleware function
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ------- Middleware Functions -------

/**
 * Middleware to check API key
 */
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey || !validateApiKey(apiKey)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  
  next();
}

/**
 * Middleware to check JWT authentication
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.user = decoded;
  next();
}

// ------- API Routes -------

// Health check endpoint
app.get('/api/health', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    apiVersion: '1.0.0',
    mongoConnection: dbService.connected ? 'connected' : 'disconnected'
  };
  
  res.status(200).json(status);
});

// Conversation endpoint - Process messages and return responses
app.post('/api/conversation', asyncHandler(async (req, res) => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  // Start timer for performance monitoring
  const startTime = Date.now();
  
  // Process the message
  const response = await conversationService.processMessage(
    message,
    req.session.userPreferences.conversationHistory || [],
    {
      ...req.session.userPreferences,
      userId: req.session.userId
    }
  );
  
  // Update conversation history
  req.session.userPreferences.conversationHistory = [
    ...(req.session.userPreferences.conversationHistory || []),
    { role: 'user', content: message },
    { role: 'assistant', content: response.message }
  ].slice(-20); // Keep only the last 20 messages
  
  // Update user preferences based on search
  if (response.searchParams.brawlers && response.searchParams.brawlers.length > 0) {
    // Add to preferred brawlers if not already present
    response.searchParams.brawlers.forEach(brawler => {
      if (!req.session.userPreferences.preferredBrawlers.includes(brawler)) {
        req.session.userPreferences.preferredBrawlers.push(brawler);
        // Keep only top 10
        if (req.session.userPreferences.preferredBrawlers.length > 10) {
          req.session.userPreferences.preferredBrawlers.shift();
        }
      }
    });
  }
  
  if (response.searchParams.gameModes && response.searchParams.gameModes.length > 0) {
    // Add to preferred game modes if not already present
    response.searchParams.gameModes.forEach(gameMode => {
      if (!req.session.userPreferences.preferredGameModes.includes(gameMode)) {
        req.session.userPreferences.preferredGameModes.push(gameMode);
        // Keep only top 5
        if (req.session.userPreferences.preferredGameModes.length > 5) {
          req.session.userPreferences.preferredGameModes.shift();
        }
      }
    });
  }
  
  if (response.searchParams.contentType && response.searchParams.contentType.length > 0) {
    // Add to preferred content types if not already present
    response.searchParams.contentType.forEach(type => {
      if (!req.session.userPreferences.preferredContentTypes.includes(type)) {
        req.session.userPreferences.preferredContentTypes.push(type);
        // Keep only top 5
        if (req.session.userPreferences.preferredContentTypes.length > 5) {
          req.session.userPreferences.preferredContentTypes.shift();
        }
      }
    });
  }
  
  // Save updated preferences to database asynchronously
  dbService.saveUserPreferences(
    req.session.userId,
    req.sessionID,
    req.session.userPreferences
  ).catch(err => logger.error(err, 'Failed to save user preferences'));
  
  // Record performance metrics
  const processingTime = Date.now() - startTime;
  dbService.recordMetric('conversation_processing', {
    userId: req.session.userId,
    processingTime,
    messageLength: message.length,
    responseLength: response.message.length,
    resultsCount: response.results?.length || 0
  }).catch(err => logger.error(err, 'Failed to record metrics'));
  
  res.status(200).json({
    ...response,
    processingTime
  });
}));

// Search endpoint - Direct search for videos
app.get('/api/search', asyncHandler(async (req, res) => {
  // Parse query parameters
  const {
    query,
    brawlers,
    gameModes,
    contentType,
    skillLevel,
    sortBy,
    page = 1,
    limit = 10,
    minViews,
    maxDuration,
    dateFrom,
    dateTo,
    channelId
  } = req.query;
  
  // Parse array parameters
  const parsedBrawlers = brawlers ? (Array.isArray(brawlers) ? brawlers : [brawlers]) : [];
  const parsedGameModes = gameModes ? (Array.isArray(gameModes) ? gameModes : [gameModes]) : [];
  const parsedContentType = contentType ? (Array.isArray(contentType) ? contentType : [contentType]) : [];
  
  // Start timer for performance monitoring
  const startTime = Date.now();
  
  // Search the database
  const searchResults = await dbService.searchVideos({
    query,
    brawlers: parsedBrawlers,
    gameModes: parsedGameModes,
    contentType: parsedContentType,
    skillLevel,
    sortBy,
    page: parseInt(page),
    limit: parseInt(limit),
    minViews: parseInt(minViews || 0),
    maxDuration: parseInt(maxDuration || 0),
    dateFrom,
    dateTo,
    channelId
  });
  
  // Save search for analytics
  if (query) {
    await dbService.saveSearchQuery(
      query,
      {
        brawlers: parsedBrawlers,
        gameModes: parsedGameModes,
        contentType: parsedContentType,
        skillLevel,
        sortBy,
        minViews,
        maxDuration,
        dateFrom,
        dateTo,
        channelId
      },
      req.session.userId,
      req.sessionID
    );
  }
  
  // Record performance metrics
  const processingTime = Date.now() - startTime;
  dbService.recordMetric('search_processing', {
    userId: req.session.userId,
    processingTime,
    resultsCount: searchResults.videos.length,
    totalResults: searchResults.pagination.total,
    queryParams: {
      query,
      brawlersCount: parsedBrawlers.length,
      gameModesCount: parsedGameModes.length,
      contentTypeCount: parsedContentType.length
    }
  }).catch(err => logger.error(err, 'Failed to record metrics'));
  
  res.status(200).json({
    ...searchResults,
    processingTime
  });
}));

// Video details endpoint
app.get('/api/videos/:youtubeId', asyncHandler(async (req, res) => {
  const { youtubeId } = req.params;
  
  if (!youtubeId) {
    return res.status(400).json({ error: 'YouTube ID is required' });
  }
  
  // Get video details from the database
  const video = await dbService.getVideoByYoutubeId(youtubeId);
  
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  // Get video recommendations
  const recommendations = await dbService.getVideoRecommendations(
    youtubeId, 
    6, 
    req.session.userPreferences
  );
  
  res.status(200).json({
    video,
    recommendations
  });
}));

// Feedback endpoint
app.post('/api/feedback', asyncHandler(async (req, res) => {
  const { youtubeId, feedbackType, comment } = req.body;
  
  if (!youtubeId || !feedbackType) {
    return res.status(400).json({ error: 'YouTube ID and feedback type are required' });
  }
  
  // Handle the feedback
  const result = await conversationService.handleVideoFeedback(
    youtubeId,
    feedbackType,
    {
      ...req.session.userPreferences,
      userId: req.session.userId
    },
    comment
  );
  
  res.status(200).json(result);
}));

// Recommendations endpoint
app.get('/api/recommendations', asyncHandler(async (req, res) => {
  // Get personalized recommendations
  const recommendations = await conversationService.getPersonalizedRecommendations(
    {
      ...req.session.userPreferences,
      userId: req.session.userId
    },
    parseInt(req.query.limit || 10)
  );
  
  res.status(200).json(recommendations);
}));

// Filters endpoint - Get available filters (brawlers, game modes, etc.)
app.get('/api/filters', asyncHandler(async (req, res) => {
  // Get all brawlers from the database
  const brawlers = await dbService.getAllBrawlers();
  
  // Get all game modes from the database
  const gameModes = await dbService.getAllGameModes();
  
  // Define content types
  const contentTypes = [
    { id: 'tutorial', name: 'Tutorials' },
    { id: 'gameplay', name: 'Gameplay' },
    { id: 'entertainment', name: 'Entertainment' },
    { id: 'pro', name: 'Pro Play' },
    { id: 'esports', name: 'Esports' },
    { id: 'tips', name: 'Tips & Tricks' },
    { id: 'funny', name: 'Funny Moments' },
    { id: 'highlights', name: 'Highlights' },
    { id: 'strategy', name: 'Strategy' }
  ];
  
  // Define skill levels
  const skillLevels = [
    { id: 'beginner', name: 'Beginner' },
    { id: 'intermediate', name: 'Intermediate' },
    { id: 'advanced', name: 'Advanced' }
  ];
  
  // Define sort options
  const sortOptions = [
    { id: 'relevance', name: 'Most Relevant' },
    { id: 'recent', name: 'Most Recent' },
    { id: 'popular', name: 'Most Popular' },
    { id: 'trending', name: 'Trending' },
    { id: 'viewCount', name: 'Most Viewed' }
  ];
  
  res.status(200).json({
    brawlers: brawlers.map(brawler => ({ id: brawler, name: brawler })),
    gameModes: gameModes.map(gameMode => ({ id: gameMode, name: gameMode })),
    contentTypes,
    skillLevels,
    sortOptions
  });
}));

// Statistics endpoint
app.get('/api/stats', asyncHandler(async (req, res) => {
  // Get database statistics
  const stats = await dbService.getDatabaseStats();
  
  // Get trending brawlers
  const trendingBrawlers = await dbService.getTrendingBrawlers(10);
  
  // Get popular content creators with pagination
  const popularCreators = await dbService.getPopularContentCreators(
    10,
    parseInt(req.query.page || 1)
  );
  
  // Get popular search queries with pagination
  const popularSearches = await dbService.getPopularSearchQueries(
    10,
    30, // 30 days
    parseInt(req.query.page || 1)
  );
  
  // Get quota status
  const quotaStatus = youtubeService.getQuotaStatus();
  
  res.status(200).json({
    stats,
    trendingBrawlers,
    popularCreators,
    popularSearches,
    quotaStatus
  });
}));

// User preferences endpoint - Get current user preferences
app.get('/api/preferences', (req, res) => {
  // Return user preferences from session
  res.status(200).json(req.session.userPreferences || {});
});

// User preferences update endpoint
app.put('/api/preferences', asyncHandler(async (req, res) => {
  const { preferredBrawlers, preferredGameModes, preferredContentTypes } = req.body;
  
  // Update user preferences in session
  if (preferredBrawlers) {
    req.session.userPreferences.preferredBrawlers = preferredBrawlers;
  }
  
  if (preferredGameModes) {
    req.session.userPreferences.preferredGameModes = preferredGameModes;
  }
  
  if (preferredContentTypes) {
    req.session.userPreferences.preferredContentTypes = preferredContentTypes;
  }
  
  // Save updated preferences to database
  await dbService.saveUserPreferences(
    req.session.userId,
    req.sessionID,
    req.session.userPreferences
  );
  
  res.status(200).json(req.session.userPreferences);
}));

// Clear conversation history endpoint
app.delete('/api/conversation/history', (req, res) => {
  // Clear conversation history in session
  req.session.userPreferences.conversationHistory = [];
  
  res.status(200).json({ message: 'Conversation history cleared' });
});

// ======== Admin API Routes ========
// These routes are protected by the API key middleware

// Admin status endpoint
app.get('/api/admin/status', requireApiKey, asyncHandler(async (req, res) => {
  const dbStats = await dbService.getDatabaseStats();
  const collectionStatus = contentCollector.getCollectionStatus();
  const quotaStatus = youtubeService.getQuotaStatus();
  
  res.status(200).json({
    dbStats,
    collectionStatus,
    quotaStatus,
    serverTime: new Date().toISOString(),
    nodeEnv: NODE_ENV,
    memory: process.memoryUsage()
  });
}));

// Admin endpoint to trigger content collection
app.post('/api/admin/collect', requireApiKey, asyncHandler(async (req, res) => {
  const options = req.body || {};
  
  // Trigger content collection in the background
  contentCollector.collectBrawlStarsContent(options)
    .then((result) => {
      logger.info({ result }, 'Content collection triggered successfully');
      
      // Send webhook notification if configured
      if (ADMIN_WEBHOOK_URL) {
        fetch(ADMIN_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'collection_complete',
            data: result,
            timestamp: new Date().toISOString()
          })
        }).catch(err => logger.error(err, 'Failed to send webhook notification'));
      }
    })
    .catch(error => {
      logger.error(error, 'Error during content collection');
    });
  
  res.status(202).json({ 
    message: 'Content collection triggered',
    options
  });
}));

// Admin endpoint to schedule content collection
app.post('/api/admin/schedule', requireApiKey, asyncHandler(async (req, res) => {
  const { intervalHours, options } = req.body;
  
  if (!intervalHours || isNaN(intervalHours) || intervalHours < 1) {
    return res.status(400).json({ error: 'Valid intervalHours parameter is required' });
  }
  
  const schedulerInfo = contentCollector.scheduleCollection(
    parseInt(intervalHours),
    options || {}
  );
  
  res.status(200).json({
    message: `Content collection scheduled every ${intervalHours} hours`,
    schedulerInfo: {
      intervalHours: schedulerInfo.intervalHours,
      intervalMs: schedulerInfo.intervalMs,
      options: schedulerInfo.options
    }
  });
}));

// Admin endpoint to clear API cache
app.post('/api/admin/clear-cache', requireApiKey, (req, res) => {
  const clearedCount = youtubeService.clearApiCache();
  
  res.status(200).json({
    message: 'API cache cleared',
    clearedCount
  });
});

// YouTube API proxy for debugging
if (NODE_ENV === 'development') {
  app.use('/api/youtube-proxy', requireApiKey, createProxyMiddleware({
    target: 'https://www.googleapis.com',
    changeOrigin: true,
    pathRewrite: {
      '^/api/youtube-proxy': '/youtube/v3'
    },
    onProxyReq: (proxyReq, req, res) => {
      // Add API key to the query
      const url = new URL(proxyReq.path, 'https://www.googleapis.com');
      url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
      proxyReq.path = url.pathname + url.search;
      
      logger.info(`Proxying YouTube API request: ${proxyReq.path}`);
    }
  }));
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  
  // Send appropriate error response
  const statusCode = err.statusCode || 500;
  const message = NODE_ENV === 'production' && statusCode === 500 
    ? 'Internal server error' 
    : err.message;
  
  res.status(statusCode).json({ 
    error: message,
    requestId: req.id
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the server
async function startServer() {
  try {
    // Connect to the database
    await dbService.connectToDatabase();
    
    // Start collection scheduling if enabled
    if (process.env.COLLECTION_SCHEDULE_ENABLED === 'true') {
      const intervalHours = parseInt(process.env.COLLECTION_INTERVAL_HOURS || '24');
      contentCollector.scheduleCollection(intervalHours);
      logger.info(`Scheduled content collection every ${intervalHours} hours`);
    }
    
    // Start listening
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

// Handle graceful shutdown
function handleShutdown() {
  logger.info('Shutting down gracefully...');
  dbService.closeDatabaseConnection()
    .then(() => {
      logger.info('Closed database connection');
      process.exit(0);
    })
    .catch(error => {
      logger.error(error, 'Error closing database connection');
      process.exit(1);
    });
}

// Listen for shutdown signals
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = app;
