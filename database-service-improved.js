// database-service.js
// Enhanced service for managing Brawl Stars content in MongoDB

const { MongoClient, ObjectId } = require('mongodb');
const pino = require('pino');
require('dotenv').config();

// MongoDB Connection URI and options
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'brawlstars_content';
const DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || '10');
const DB_CONNECT_TIMEOUT_MS = parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '30000');

// Collections
const COLLECTIONS = {
  VIDEOS: 'videos',
  CHANNELS: 'channels',
  BRAWLERS: 'brawlers',
  GAME_MODES: 'gameModes',
  SEARCH_HISTORY: 'searchHistory',
  USER_FEEDBACK: 'userFeedback',
  USER_PREFERENCES: 'userPreferences',
  METRICS: 'metrics'
};

// Collection schemas for validation
const SCHEMAS = {
  videos: {
    bsonType: 'object',
    required: ['youtubeId', 'title', 'creator', 'publishedAt', 'duration', 'lastUpdated'],
    properties: {
      youtubeId: { bsonType: 'string' },
      title: { bsonType: 'string' },
      creator: { 
        bsonType: 'object',
        required: ['id', 'name'],
        properties: {
          id: { bsonType: 'string' },
          name: { bsonType: 'string' },
          url: { bsonType: 'string' }
        }
      },
      publishedAt: { bsonType: 'string' },
      duration: { bsonType: 'int' },
      viewCount: { bsonType: 'int' },
      likeCount: { bsonType: 'int' },
      commentCount: { bsonType: ['int', 'null'] },
      brawlers: { bsonType: 'array', items: { bsonType: 'string' } },
      gameModes: { bsonType: 'array', items: { bsonType: 'string' } },
      contentType: { bsonType: 'array', items: { bsonType: 'string' } },
      skillLevel: { bsonType: 'string' },
      popularity: { bsonType: 'double' },
      recency: { bsonType: 'double' },
      transcript: { bsonType: ['string', 'null'] },
      timestamps: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['time', 'title'],
          properties: {
            time: { bsonType: 'int' },
            title: { bsonType: 'string' }
          }
        }
      },
      lastUpdated: { bsonType: 'string' }
    }
  },
  channels: {
    bsonType: 'object',
    required: ['channelId', 'name', 'lastUpdated'],
    properties: {
      channelId: { bsonType: 'string' },
      name: { bsonType: 'string' },
      url: { bsonType: 'string' },
      lastUpdated: { bsonType: 'string' }
    }
  }
};

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  } : undefined
});

let client;
let db;
let connected = false;

/**
 * Initialize database connection with retry logic
 * @param {number} retries Number of retries
 * @param {number} delay Delay between retries in ms
 * @returns {Promise<void>}
 */
async function connectToDatabase(retries = 5, delay = 5000) {
  let lastError;
  
  // Already connected
  if (connected && client && db) {
    return;
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Connecting to MongoDB (attempt ${attempt}/${retries})...`);
      
      // Connection options
      const options = {
        maxPoolSize: DB_POOL_SIZE,
        connectTimeoutMS: DB_CONNECT_TIMEOUT_MS,
        retryWrites: true,
        retryReads: true,
        writeConcern: { w: 'majority' }
      };
      
      client = new MongoClient(MONGODB_URI, options);
      await client.connect();
      logger.info('Connected to MongoDB');
      
      db = client.db(DB_NAME);
      connected = true;
      
      // Create collections with validation
      await initializeCollections();
      
      // Create indexes for better performance
      await createIndexes();
      
      logger.info('Database initialization complete');
      return;
    } catch (error) {
      lastError = error;
      logger.error({ err: error }, `Error connecting to MongoDB (attempt ${attempt}/${retries})`);
      
      if (attempt < retries) {
        logger.info(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Exponential backoff
        delay *= 1.5;
      }
    }
  }
  
  throw new Error(`Failed to connect to MongoDB after ${retries} attempts: ${lastError.message}`);
}

/**
 * Initialize collections with schema validation
 * @returns {Promise<void>}
 */
async function initializeCollections() {
  try {
    // Get list of existing collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    // Create each collection with validation if it doesn't exist
    for (const [name, collectionName] of Object.entries(COLLECTIONS)) {
      if (!collectionNames.includes(collectionName)) {
        logger.info(`Creating collection: ${collectionName}`);
        
        // If we have a schema for this collection, add validation
        if (SCHEMAS[collectionName]) {
          await db.createCollection(collectionName, {
            validator: {
              $jsonSchema: SCHEMAS[collectionName]
            },
            validationLevel: 'moderate', // moderate is more forgiving than strict
            validationAction: 'warn' // warn vs error to avoid breaking changes
          });
        } else {
          await db.createCollection(collectionName);
        }
      } else if (SCHEMAS[collectionName]) {
        // Update validation schema for existing collection
        logger.info(`Updating validation schema for ${collectionName}`);
        await db.command({
          collMod: collectionName,
          validator: {
            $jsonSchema: SCHEMAS[collectionName]
          },
          validationLevel: 'moderate',
          validationAction: 'warn'
        });
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error initializing collections');
    throw error;
  }
}

/**
 * Create indexes for collections
 * @returns {Promise<void>}
 */
async function createIndexes() {
  try {
    // Videos collection indexes
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ youtubeId: 1 }, { unique: true });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ brawlers: 1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ gameModes: 1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ contentType: 1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ "creator.id": 1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ popularity: -1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ recency: -1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ publishedAt: -1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ skillLevel: 1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ lastUpdated: -1 });
    
    // Compound indexes for common query patterns
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ brawlers: 1, popularity: -1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ gameModes: 1, popularity: -1 });
    await db.collection(COLLECTIONS.VIDEOS).createIndex({ contentType: 1, recency: -1 });
    
    // Create text index for search
    await db.collection(COLLECTIONS.VIDEOS).createIndex(
      { title: "text", description: "text", transcript: "text" },
      { 
        weights: { title: 10, description: 5, transcript: 1 }, 
        default_language: "english",
        name: "content_text_index"
      }
    );
    
    // Channels collection index
    await db.collection(COLLECTIONS.CHANNELS).createIndex({ channelId: 1 }, { unique: true });
    await db.collection(COLLECTIONS.CHANNELS).createIndex({ name: "text" });
    
    // Search history index
    await db.collection(COLLECTIONS.SEARCH_HISTORY).createIndex({ timestamp: -1 });
    await db.collection(COLLECTIONS.SEARCH_HISTORY).createIndex({ query: 1 });
    await db.collection(COLLECTIONS.SEARCH_HISTORY).createIndex({ userId: 1 });
    await db.collection(COLLECTIONS.SEARCH_HISTORY).createIndex({ sessionId: 1 });
    
    // User feedback index
    await db.collection(COLLECTIONS.USER_FEEDBACK).createIndex({ youtubeId: 1 });
    await db.collection(COLLECTIONS.USER_FEEDBACK).createIndex({ userId: 1 });
    await db.collection(COLLECTIONS.USER_FEEDBACK).createIndex({ sessionId: 1 });
    await db.collection(COLLECTIONS.USER_FEEDBACK).createIndex({ feedbackType: 1 });
    await db.collection(COLLECTIONS.USER_FEEDBACK).createIndex({ timestamp: -1 });
    
    // User preferences index
    await db.collection(COLLECTIONS.USER_PREFERENCES).createIndex({ userId: 1 }, { unique: true });
    await db.collection(COLLECTIONS.USER_PREFERENCES).createIndex({ sessionId: 1 });
    
    // Metrics index
    await db.collection(COLLECTIONS.METRICS).createIndex({ timestamp: -1 });
    await db.collection(COLLECTIONS.METRICS).createIndex({ metricType: 1 });
    
    logger.info('Indexes created successfully');
  } catch (error) {
    logger.error({ err: error }, 'Error creating indexes');
    throw error;
  }
}

/**
 * Close database connection
 * @returns {Promise<void>}
 */
async function closeDatabaseConnection() {
  if (client) {
    await client.close();
    connected = false;
    logger.info('Disconnected from MongoDB');
  }
}

/**
 * Ensure database connection is active
 * @returns {Promise<void>}
 */
async function ensureConnection() {
  if (!connected || !client || !db) {
    await connectToDatabase();
  }
}

/**
 * Save a processed video to the database
 * @param {Object} videoData Processed video data
 * @returns {Promise<string>} ID of the inserted/updated document
 */
async function saveVideo(videoData) {
  try {
    await ensureConnection();
    
    // Format any non-string fields to match schema
    const formattedVideo = {
      ...videoData,
      duration: parseInt(videoData.duration) || 0,
      viewCount: parseInt(videoData.viewCount) || 0,
      likeCount: parseInt(videoData.likeCount) || 0,
      commentCount: parseInt(videoData.commentCount) || 0,
      brawlers: Array.isArray(videoData.brawlers) ? videoData.brawlers : [],
      gameModes: Array.isArray(videoData.gameModes) ? videoData.gameModes : [],
      contentType: Array.isArray(videoData.contentType) ? videoData.contentType : [],
      popularity: parseFloat(videoData.popularity) || 0,
      recency: parseFloat(videoData.recency) || 0,
      timestamps: Array.isArray(videoData.timestamps) ? videoData.timestamps.map(t => ({
        time: parseInt(t.time) || 0,
        title: String(t.title) || ''
      })) : []
    };
    
    // Check if video already exists
    const existingVideo = await db.collection(COLLECTIONS.VIDEOS).findOne({ 
      youtubeId: videoData.youtubeId 
    });
    
    if (existingVideo) {
      // Update existing video
      const result = await db.collection(COLLECTIONS.VIDEOS).findOneAndUpdate(
        { youtubeId: videoData.youtubeId },
        { 
          $set: {
            ...formattedVideo,
            lastUpdated: new Date().toISOString()
          },
          // Keep existing timestamps if available and new ones aren't provided
          $setOnInsert: {
            timestamps: existingVideo.timestamps && 
                       (!formattedVideo.timestamps || formattedVideo.timestamps.length === 0) ? 
                       existingVideo.timestamps : formattedVideo.timestamps
          }
        },
        { returnDocument: 'after' }
      );
      
      logger.debug(`Updated video ${videoData.youtubeId}`);
      return result.value._id.toString();
    } else {
      // Insert new video
      const result = await db.collection(COLLECTIONS.VIDEOS).insertOne({
        ...formattedVideo,
        lastUpdated: new Date().toISOString()
      });
      
      logger.debug(`Inserted new video ${videoData.youtubeId}`);
      return result.insertedId.toString();
    }
  } catch (error) {
    logger.error({ err: error, videoId: videoData.youtubeId }, 'Error saving video');
    throw error;
  }
}

/**
 * Get a video by its YouTube ID
 * @param {string} youtubeId YouTube video ID
 * @returns {Promise<Object>} Video data
 */
async function getVideoByYoutubeId(youtubeId) {
  try {
    await ensureConnection();
    return await db.collection(COLLECTIONS.VIDEOS).findOne({ youtubeId });
  } catch (error) {
    logger.error({ err: error, videoId: youtubeId }, 'Error getting video');
    throw error;
  }
}

/**
 * Update video timestamps
 * @param {string} youtubeId YouTube video ID
 * @param {Array} timestamps Array of timestamp objects
 * @returns {Promise<boolean>} Success indicator
 */
async function updateVideoTimestamps(youtubeId, timestamps) {
  try {
    await ensureConnection();
    
    // Format timestamps to match schema
    const formattedTimestamps = timestamps.map(t => ({
      time: parseInt(t.time) || 0,
      title: String(t.title) || ''
    }));
    
    const result = await db.collection(COLLECTIONS.VIDEOS).updateOne(
      { youtubeId },
      { 
        $set: { 
          timestamps: formattedTimestamps,
          lastUpdated: new Date().toISOString()
        } 
      }
    );
    
    logger.debug(`Updated timestamps for video ${youtubeId}`);
    return result.modifiedCount > 0;
  } catch (error) {
    logger.error({ err: error, videoId: youtubeId }, 'Error updating timestamps');
    throw error;
  }
}

/**
 * Save a channel to the database
 * @param {Object} channelData Channel data
 * @returns {Promise<string>} ID of the inserted/updated document
 */
async function saveChannel(channelData) {
  try {
    await ensureConnection();
    
    // Check if channel already exists
    const existingChannel = await db.collection(COLLECTIONS.CHANNELS).findOne({ 
      channelId: channelData.channelId 
    });
    
    if (existingChannel) {
      // Update existing channel
      const result = await db.collection(COLLECTIONS.CHANNELS).findOneAndUpdate(
        { channelId: channelData.channelId },
        { 
          $set: {
            ...channelData,
            lastUpdated: new Date().toISOString()
          }
        },
        { returnDocument: 'after' }
      );
      
      logger.debug(`Updated channel ${channelData.channelId}`);
      return result.value._id.toString();
    } else {
      // Insert new channel
      const result = await db.collection(COLLECTIONS.CHANNELS).insertOne({
        ...channelData,
        lastUpdated: new Date().toISOString()
      });
      
      logger.debug(`Inserted new channel ${channelData.channelId}`);
      return result.insertedId.toString();
    }
  } catch (error) {
    logger.error({ err: error, channelId: channelData.channelId }, 'Error saving channel');
    throw error;
  }
}

/**
 * Search for videos based on query parameters with pagination and improved filtering
 * @param {Object} params Search parameters
 * @returns {Promise<Object>} Search results and pagination info
 */
async function searchVideos(params) {
  try {
    await ensureConnection();
    
    const {
      query = '',
      brawlers = [],
      gameModes = [],
      contentType = [],
      skillLevel = '',
      sortBy = 'relevance',
      limit = 20,
      page = 1,
      minViews = 0,
      maxDuration = 0,
      dateFrom = '',
      dateTo = '',
      channelId = ''
    } = params;
    
    // Build the query
    const dbQuery = {};
    
    // Text search if query is provided
    if (query && query.trim() !== '') {
      dbQuery.$text = { $search: query };
    }
    
    // Filter by brawlers if provided
    if (Array.isArray(brawlers) && brawlers.length > 0) {
      dbQuery.brawlers = { $in: brawlers };
    }
    
    // Filter by game modes if provided
    if (Array.isArray(gameModes) && gameModes.length > 0) {
      dbQuery.gameModes = { $in: gameModes };
    }
    
    // Filter by content type if provided
    if (Array.isArray(contentType) && contentType.length > 0) {
      dbQuery.contentType = { $in: contentType };
    }
    
    // Filter by skill level if provided
    if (skillLevel) {
      dbQuery.skillLevel = skillLevel;
    }
    
    // Filter by channel ID if provided
    if (channelId) {
      dbQuery['creator.id'] = channelId;
    }
    
    // Filter by view count if provided
    if (minViews > 0) {
      dbQuery.viewCount = { $gte: parseInt(minViews) };
    }
    
    // Filter by duration if provided
    if (maxDuration > 0) {
      dbQuery.duration = { $lte: parseInt(maxDuration) };
    }
    
    // Filter by date range if provided
    if (dateFrom || dateTo) {
      dbQuery.publishedAt = {};
      if (dateFrom) {
        dbQuery.publishedAt.$gte = dateFrom;
      }
      if (dateTo) {
        dbQuery.publishedAt.$lte = dateTo;
      }
    }
    
    // Determine sort order
    let sortOptions = {};
    switch (sortBy) {
      case 'relevance':
        // If we have a text query, sort by text score
        if (query && query.trim() !== '') {
          sortOptions = { score: { $meta: 'textScore' } };
        } else {
          // Otherwise sort by popularity
          sortOptions = { popularity: -1 };
        }
        break;
      case 'recent':
        sortOptions = { publishedAt: -1 };
        break;
      case 'popular':
        sortOptions = { viewCount: -1 };
        break;
      case 'trending':
        // Combination of recency and popularity
        sortOptions = { recency: -1, popularity: -1 };
        break;
      default:
        sortOptions = { popularity: -1 };
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Execute query
    let cursor = db.collection(COLLECTIONS.VIDEOS).find(dbQuery);
    
    // Add sort if needed
    if (Object.keys(sortOptions).length > 0) {
      cursor = cursor.sort(sortOptions);
    }
    
    // Add projection to include text score if relevant
    if (query && query.trim() !== '' && sortBy === 'relevance') {
      cursor = cursor.project({ score: { $meta: 'textScore' }, ...cursor.projection });
    }
    
    // Get the total count for pagination
    const total = await db.collection(COLLECTIONS.VIDEOS).countDocuments(dbQuery);
    
    // Add pagination
    cursor = cursor.skip(skip).limit(parseInt(limit));
    
    // Get the results
    const videos = await cursor.toArray();
    
    return {
      videos,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    };
  } catch (error) {
    logger.error({ err: error, params }, 'Error searching videos');
    throw error;
  }
}

/**
 * Get videos by brawler with caching
 * @param {string} brawler Brawler name
 * @param {number} limit Maximum number of results
 * @returns {Promise<Object[]>} Videos featuring the specified brawler
 */
async function getVideosByBrawler(brawler, limit = 10) {
  try {
    await ensureConnection();
    
    return await db.collection(COLLECTIONS.VIDEOS)
      .find({ brawlers: brawler })
      .sort({ popularity: -1 })
      .limit(parseInt(limit))
      .toArray();
  } catch (error) {
    logger.error({ err: error, brawler }, 'Error getting videos for brawler');
    throw error;
  }
}

/**
 * Get videos by game mode with caching
 * @param {string} gameMode Game mode name
 * @param {number} limit Maximum number of results
 * @returns {Promise<Object[]>} Videos featuring the specified game mode
 */
async function getVideosByGameMode(gameMode, limit = 10) {
  try {
    await ensureConnection();
    
    return await db.collection(COLLECTIONS.VIDEOS)
      .find({ gameModes: gameMode })
      .sort({ popularity: -1 })
      .limit(parseInt(limit))
      .toArray();
  } catch (error) {
    logger.error({ err: error, gameMode }, 'Error getting videos for game mode');
    throw error;
  }
}

/**
 * Save search query to history
 * @param {string} query Search query
 * @param {Object} filters Search filters applied
 * @param {string} userId User ID if available
 * @param {string} sessionId Session ID if available
 * @returns {Promise<void>}
 */
async function saveSearchQuery(query, filters = {}, userId = null, sessionId = null) {
  try {
    await ensureConnection();
    
    await db.collection(COLLECTIONS.SEARCH_HISTORY).insertOne({
      query,
      filters,
      userId,
      sessionId,
      timestamp: new Date().toISOString()
    });
    
    logger.debug({ query, userId, sessionId }, 'Saved search query');
  } catch (error) {
    logger.error({ err: error, query }, 'Error saving search query');
    // Don't throw error to prevent disrupting the user experience
  }
}

/**
 * Get popular search queries with pagination
 * @param {number} limit Maximum number of results
 * @param {number} days Number of days to look back
 * @param {number} page Page number
 * @returns {Promise<Object>} Popular search queries with counts and pagination
 */
async function getPopularSearchQueries(limit = 10, days = 30, page = 1) {
  try {
    await ensureConnection();
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const pipeline = [
      { 
        $match: { 
          timestamp: { $gte: startDate.toISOString() } 
        } 
      },
      { 
        $group: { 
          _id: "$query", 
          count: { $sum: 1 } 
        } 
      },
      { 
        $sort: { count: -1 } 
      },
      {
        $facet: {
          metadata: [
            { $count: "total" }
          ],
          data: [
            { $skip: skip },
            { $limit: parseInt(limit) },
            {
              $project: {
                _id: 0,
                query: "$_id",
                count: 1
              }
            }
          ]
        }
      }
    ];
    
    const result = await db.collection(COLLECTIONS.SEARCH_HISTORY)
      .aggregate(pipeline)
      .toArray();
    
    const total = result[0].metadata[0]?.total || 0;
    
    return {
      queries: result[0].data,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    };
  } catch (error) {
    logger.error({ err: error }, 'Error getting popular search queries');
    throw error;
  }
}

/**
 * Get trending brawlers based on search and view history
 * @param {number} limit Maximum number of results
 * @param {number} days Number of days to look back
 * @returns {Promise<Object[]>} Trending brawlers with counts
 */
async function getTrendingBrawlers(limit = 10, days = 30) {
  try {
    await ensureConnection();
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return await db.collection(COLLECTIONS.VIDEOS)
      .aggregate([
        {
          $match: {
            publishedAt: { $gte: startDate.toISOString() }
          }
        },
        { $unwind: "$brawlers" },
        { 
          $group: { 
            _id: "$brawlers", 
            count: { $sum: 1 },
            totalViews: { $sum: "$viewCount" }
          } 
        },
        {
          $addFields: {
            score: { 
              $add: [
                { $multiply: ["$count", 1] },  // Weight for video count
                { $multiply: [{ $log10: { $add: ["$totalViews", 1] } }, 2] }  // Weight for views (log scale)
              ]
            }
          }
        },
        { $sort: { score: -1 } },
        { $limit: parseInt(limit) },
        {
          $project: {
            _id: 0,
            brawler: "$_id",
            count: 1,
            totalViews: 1,
            score: 1
          }
        }
      ])
      .toArray();
  } catch (error) {
    logger.error({ err: error }, 'Error getting trending brawlers');
    throw error;
  }
}

/**
 * Record user feedback for a video
 * @param {string} youtubeId YouTube video ID
 * @param {string} feedbackType Type of feedback (e.g., 'like', 'dislike', 'irrelevant')
 * @param {string} userId User ID if available
 * @param {string} sessionId Session ID if available
 * @param {string} comment Optional user comment
 * @returns {Promise<void>}
 */
async function recordVideoFeedback(youtubeId, feedbackType, userId = null, sessionId = null, comment = null) {
  try {
    await ensureConnection();
    
    await db.collection(COLLECTIONS.USER_FEEDBACK).insertOne({
      youtubeId,
      feedbackType,
      userId,
      sessionId,
      comment,
      timestamp: new Date().toISOString()
    });
    
    // Update video stats based on feedback
    if (feedbackType === 'like') {
      await db.collection(COLLECTIONS.VIDEOS).updateOne(
        { youtubeId },
        { 
          $inc: { userLikes: 1 },
          $set: { lastUpdated: new Date().toISOString() }
        }
      );
    } else if (feedbackType === 'dislike') {
      await db.collection(COLLECTIONS.VIDEOS).updateOne(
        { youtubeId },
        { 
          $inc: { userDislikes: 1 },
          $set: { lastUpdated: new Date().toISOString() }
        }
      );
    } else if (feedbackType === 'irrelevant') {
      await db.collection(COLLECTIONS.VIDEOS).updateOne(
        { youtubeId },
        { 
          $inc: { irrelevantReports: 1 },
          $set: { lastUpdated: new Date().toISOString() }
        }
      );
    }
    
    logger.debug({ youtubeId, feedbackType, userId }, 'Recorded video feedback');
  } catch (error) {
    logger.error({ err: error, youtubeId, feedbackType }, 'Error recording video feedback');
    throw error;
  }
}

/**
 * Get video recommendations based on a video with improved algorithm
 * @param {string} youtubeId YouTube video ID
 * @param {number} limit Maximum number of recommendations
 * @param {Object} userPreferences User preferences for personalization
 * @returns {Promise<Object[]>} Recommended videos
 */
async function getVideoRecommendations(youtubeId, limit = 6, userPreferences = {}) {
  try {
    await ensureConnection();
    
    // Get the source video
    const sourceVideo = await getVideoByYoutubeId(youtubeId);
    
    if (!sourceVideo) {
      throw new Error(`Video ${youtubeId} not found`);
    }
    
    // Build recommendation query based on source video's attributes
    const recommendationQuery = {
      youtubeId: { $ne: youtubeId }, // Exclude the source video
    };
    
    // Add filter conditions with scores
    const pipeline = [
      { $match: recommendationQuery },
      {
        $addFields: {
          // Calculate similarity score based on matching attributes
          similarityScore: {
            $add: [
              // Brawler match score (3 points per matching brawler)
              {
                $multiply: [
                  {
                    $size: {
                      $setIntersection: ["$brawlers", sourceVideo.brawlers || []]
                    }
                  },
                  3
                ]
              },
              // Game mode match score (2 points per matching mode)
              {
                $multiply: [
                  {
                    $size: {
                      $setIntersection: ["$gameModes", sourceVideo.gameModes || []]
                    }
                  },
                  2
                ]
              },
              // Content type match score (1 point per matching type)
              {
                $multiply: [
                  {
                    $size: {
                      $setIntersection: ["$contentType", sourceVideo.contentType || []]
                    }
                  },
                  1
                ]
              },
              // Creator match bonus (4 points if same creator)
              {
                $cond: [
                  { $eq: ["$creator.id", sourceVideo.creator.id] },
                  4,
                  0
                ]
              }
            ]
          }
        }
      }
    ];
    
    // Add user preference boosts if available
    if (userPreferences && userPreferences.preferredBrawlers && userPreferences.preferredBrawlers.length > 0) {
      pipeline.push({
        $addFields: {
          // Add preference boost to similarityScore (1 point per preferred brawler)
          preferenceBoost: {
            $multiply: [
              {
                $size: {
                  $setIntersection: ["$brawlers", userPreferences.preferredBrawlers]
                }
              },
              1
            ]
          }
        }
      });
      
      pipeline.push({
        $addFields: {
          similarityScore: { $add: ["$similarityScore", "$preferenceBoost"] }
        }
      });
    }
    
    // Add base metrics weighting and final sorting
    pipeline.push(
      {
        $addFields: {
          // Add popularity and recency to final score
          finalScore: {
            $add: [
              "$similarityScore",
              { $multiply: ["$popularity", 5] },  // 0-5 points for popularity
              { $multiply: ["$recency", 3] }      // 0-3 points for recency
            ]
          }
        }
      },
      { $sort: { finalScore: -1, publishedAt: -1 } },
      { $limit: parseInt(limit) }
    );
    
    // Get recommendations
    return await db.collection(COLLECTIONS.VIDEOS)
      .aggregate(pipeline)
      .toArray();
  } catch (error) {
    logger.error({ err: error, youtubeId }, 'Error getting recommendations');
    throw error;
  }
}

/**
 * Get all available brawlers in the database
 * @returns {Promise<string[]>} List of brawler names
 */
async function getAllBrawlers() {
  try {
    await ensureConnection();
    
    const brawlers = await db.collection(COLLECTIONS.VIDEOS)
      .aggregate([
        { $unwind: "$brawlers" },
        { $group: { _id: "$brawlers" } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    return brawlers.map(b => b._id);
  } catch (error) {
    logger.error({ err: error }, 'Error getting all brawlers');
    throw error;
  }
}

/**
 * Get all available game modes in the database
 * @returns {Promise<string[]>} List of game mode names
 */
async function getAllGameModes() {
  try {
    await ensureConnection();
    
    const gameModes = await db.collection(COLLECTIONS.VIDEOS)
      .aggregate([
        { $unwind: "$gameModes" },
        { $group: { _id: "$gameModes" } },
        { $sort: { _id: 1 } }
      ])
      .toArray();
    
    return gameModes.map(m => m._id);
  } catch (error) {
    logger.error({ err: error }, 'Error getting all game modes');
    throw error;
  }
}

/**
 * Get popular content creators with pagination
 * @param {number} limit Maximum number of results
 * @param {number} page Page number
 * @returns {Promise<Object>} Popular content creators with video counts and pagination
 */
async function getPopularContentCreators(limit = 10, page = 1) {
  try {
    await ensureConnection();
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const pipeline = [
      { 
        $group: { 
          _id: "$creator.id", 
          name: { $first: "$creator.name" },
          url: { $first: "$creator.url" },
          videoCount: { $sum: 1 },
          totalViews: { $sum: "$viewCount" }
        } 
      },
      {
        $facet: {
          metadata: [
            { $count: "total" }
          ],
          data: [
            { $sort: { totalViews: -1 } },
            { $skip: skip },
            { $limit: parseInt(limit) },
            {
              $project: {
                _id: 0,
                id: "$_id",
                name: 1,
                url: 1,
                videoCount: 1,
                totalViews: 1
              }
            }
          ]
        }
      }
    ];
    
    const result = await db.collection(COLLECTIONS.VIDEOS)
      .aggregate(pipeline)
      .toArray();
    
    const total = result[0].metadata[0]?.total || 0;
    
    return {
      creators: result[0].data,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    };
  } catch (error) {
    logger.error({ err: error }, 'Error getting popular content creators');
    throw error;
  }
}

/**
 * Save or update user preferences
 * @param {string} userId User ID
 * @param {string} sessionId Session ID
 * @param {Object} preferences User preferences
 * @returns {Promise<Object>} Updated user preferences
 */
async function saveUserPreferences(userId, sessionId, preferences) {
  try {
    await ensureConnection();
    
    const result = await db.collection(COLLECTIONS.USER_PREFERENCES).findOneAndUpdate(
      { 
        $or: [
          { userId },
          { sessionId }
        ]
      },
      {
        $set: {
          ...preferences,
          lastUpdated: new Date().toISOString()
        },
        $setOnInsert: {
          userId,
          sessionId,
          createdAt: new Date().toISOString()
        }
      },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );
    
    logger.debug({ userId, sessionId }, 'Saved user preferences');
    return result.value;
  } catch (error) {
    logger.error({ err: error, userId, sessionId }, 'Error saving user preferences');
    throw error;
  }
}

/**
 * Get user preferences
 * @param {string} userId User ID
 * @param {string} sessionId Session ID
 * @returns {Promise<Object>} User preferences
 */
async function getUserPreferences(userId, sessionId) {
  try {
    await ensureConnection();
    
    return await db.collection(COLLECTIONS.USER_PREFERENCES).findOne({
      $or: [
        { userId },
        { sessionId }
      ]
    });
  } catch (error) {
    logger.error({ err: error, userId, sessionId }, 'Error getting user preferences');
    throw error;
  }
}

/**
 * Record a performance metric
 * @param {string} metricType Type of metric
 * @param {Object} metricData Metric data
 * @returns {Promise<void>}
 */
async function recordMetric(metricType, metricData) {
  try {
    if (!process.env.ENABLE_PERFORMANCE_METRICS) {
      return;
    }
    
    await ensureConnection();
    
    await db.collection(COLLECTIONS.METRICS).insertOne({
      metricType,
      ...metricData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error, metricType }, 'Error recording metric');
    // Don't throw error to prevent disrupting normal operation
  }
}

/**
 * Get database statistics with cache
 * @returns {Promise<Object>} Database statistics
 */
async function getDatabaseStats() {
  try {
    await ensureConnection();
    
    const videoCount = await db.collection(COLLECTIONS.VIDEOS).countDocuments();
    const channelCount = await db.collection(COLLECTIONS.CHANNELS).countDocuments();
    const userCount = await db.collection(COLLECTIONS.USER_PREFERENCES).countDocuments();
    const feedbackCount = await db.collection(COLLECTIONS.USER_FEEDBACK).countDocuments();
    
    const brawlerStats = await db.collection(COLLECTIONS.VIDEOS)
      .aggregate([
        { $unwind: "$brawlers" },
        { $group: { _id: null, count: { $sum: 1 }, unique: { $addToSet: "$brawlers" } } },
        { $project: { _id: 0, count: 1, unique: { $size: "$unique" } } }
      ])
      .toArray();
    
    const gameModeStats = await db.collection(COLLECTIONS.VIDEOS)
      .aggregate([
        { $unwind: "$gameModes" },
        { $group: { _id: null, count: { $sum: 1 }, unique: { $addToSet: "$gameModes" } } },
        { $project: { _id: 0, count: 1, unique: { $size: "$unique" } } }
      ])
      .toArray();
    
    // Get the most recent videos
    const recentVideos = await db.collection(COLLECTIONS.VIDEOS)
      .find()
      .sort({ publishedAt: -1 })
      .limit(1)
      .toArray();
    
    const mostRecentVideo = recentVideos.length > 0 ? recentVideos[0].publishedAt : null;
    
    return {
      videoCount,
      channelCount,
      userCount,
      feedbackCount,
      brawlerStats: brawlerStats[0] || { count: 0, unique: 0 },
      gameModeStats: gameModeStats[0] || { count: 0, unique: 0 },
      mostRecentVideo,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    logger.error({ err: error }, 'Error getting database stats');
    throw error;
  }
}

module.exports = {
  connectToDatabase,
  closeDatabaseConnection,
  ensureConnection,
  saveVideo,
  getVideoByYoutubeId,
  updateVideoTimestamps,
  saveChannel,
  searchVideos,
  getVideosByBrawler,
  getVideosByGameMode,
  saveSearchQuery,
  getPopularSearchQueries,
  getTrendingBrawlers,
  recordVideoFeedback,
  getVideoRecommendations,
  getAllBrawlers,
  getAllGameModes,
  getPopularContentCreators,
  saveUserPreferences,
  getUserPreferences,
  recordMetric,
  getDatabaseStats
};
