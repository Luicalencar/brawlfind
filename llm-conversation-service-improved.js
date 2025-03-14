// llm-conversation-service.js
// Enhanced LLM-based conversation service for Brawl Stars content search

const { Configuration, OpenAIApi } = require('openai');
const dbService = require('./database-service-improved');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');
require('dotenv').config();

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

// OpenAI Configuration
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// LLM model selection
const LLM_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// Brawl Stars game information
const BRAWLERS = require('./youtube-service-improved').BRAWLERS;
const GAME_MODES = require('./youtube-service-improved').GAME_MODES;

// Constants for the conversation
const CONVERSATION_CONTEXT_LENGTH = 12; // Increased from 10 to provide more context
const DEFAULT_SEARCH_LIMIT = 12; // Increased from 10 to show more results
const CACHE_TTL = 3600; // Cache TTL in seconds (1 hour)

// Setup cache
const promptCache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: 120 // Check for expired entries every 2 minutes
});

/**
 * Generate search parameters from a natural language query with caching
 * @param {string} query User's natural language query
 * @param {Object} conversationHistory Previous messages in the conversation
 * @param {Object} userPreferences User preferences and context
 * @returns {Promise<Object>} Structured search parameters
 */
async function generateSearchParams(query, conversationHistory = [], userPreferences = {}) {
  try {
    logger.debug({ query }, 'Generating search parameters');
    
    // Create a cache key based on the query and recent conversation context
    const recentHistory = conversationHistory.slice(-3).map(m => m.content).join('');
    const cacheKey = `search_params_${Buffer.from(query + recentHistory).toString('base64')}`;
    
    // Check cache first
    const cachedParams = promptCache.get(cacheKey);
    if (cachedParams) {
      logger.debug({ query, cacheKey }, 'Using cached search parameters');
      return cachedParams;
    }
    
    // Format conversation history for the prompt
    const formattedHistory = conversationHistory
      .slice(-CONVERSATION_CONTEXT_LENGTH)
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n');
    
    // Build the prompt for the LLM
    const prompt = buildSearchParamsPrompt(query, formattedHistory, userPreferences);
    
    // Attempt to call the LLM with retries
    const response = await callLLMWithRetry(async () => {
      return await openai.createChatCompletion({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: prompt
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0.1, // Low temperature for more consistent outputs
        max_tokens: 1000
      });
    }, 3);
    
    // Extract and parse the JSON response
    const responseText = response.data.choices[0].message.content;
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
    
    if (jsonMatch && jsonMatch[1]) {
      try {
        // Parse the JSON
        const searchParams = JSON.parse(jsonMatch[1]);
        logger.debug({ query, searchParams }, 'Generated search parameters');
        
        // Cache the result
        promptCache.set(cacheKey, searchParams);
        
        return searchParams;
      } catch (error) {
        logger.error({ error, responseText }, 'Failed to parse JSON from LLM response');
      }
    } else {
      logger.error({ responseText }, 'Failed to extract JSON from LLM response');
    }
    
    // Fallback to a simple search
    const fallbackParams = {
      query: query,
      brawlers: [],
      gameModes: [],
      contentType: [],
      skillLevel: '',
      sortBy: 'relevance',
      intent: 'general',
      rephrased: query
    };
    
    // Attempt basic entity extraction for the fallback
    extractBasicEntities(query, fallbackParams);
    
    return fallbackParams;
  } catch (error) {
    logger.error({ error, query }, 'Error generating search parameters');
    // Fallback to a simple search
    return {
      query: query,
      brawlers: [],
      gameModes: [],
      contentType: [],
      skillLevel: '',
      sortBy: 'relevance'
    };
  }
}

/**
 * Extract basic entities from a query for fallback search parameters
 * @param {string} query User's query
 * @param {Object} params Search parameters object to modify
 */
function extractBasicEntities(query, params) {
  const lowerQuery = query.toLowerCase();
  
  // Extract brawlers
  BRAWLERS.forEach(brawler => {
    if (lowerQuery.includes(brawler.toLowerCase())) {
      params.brawlers.push(brawler);
    }
  });
  
  // Extract game modes
  GAME_MODES.forEach(mode => {
    if (lowerQuery.includes(mode.toLowerCase())) {
      params.gameModes.push(mode);
    }
  });
  
  // Extract content types
  const contentTypeKeywords = {
    tutorial: ['tutorial', 'how to', 'guide', 'learn'],
    tips: ['tips', 'tricks', 'advice'],
    gameplay: ['gameplay', 'playing', 'matches'],
    pro: ['pro', 'professional', 'competitive'],
    entertainment: ['funny', 'fun', 'entertaining', 'entertainment'],
    highlights: ['highlights', 'moments', 'best']
  };
  
  Object.entries(contentTypeKeywords).forEach(([type, keywords]) => {
    if (keywords.some(keyword => lowerQuery.includes(keyword))) {
      params.contentType.push(type);
    }
  });
  
  // Extract skill level
  if (lowerQuery.includes('beginner') || lowerQuery.includes('new') || lowerQuery.includes('start')) {
    params.skillLevel = 'beginner';
  } else if (lowerQuery.includes('advanced') || lowerQuery.includes('pro') || lowerQuery.includes('expert')) {
    params.skillLevel = 'advanced';
  } else if (lowerQuery.includes('intermediate')) {
    params.skillLevel = 'intermediate';
  }
  
  // Determine intent
  if (params.contentType.includes('tutorial') || params.contentType.includes('tips')) {
    params.intent = 'educational';
  } else if (params.contentType.includes('entertainment') || params.contentType.includes('highlights')) {
    params.intent = 'entertainment';
  } else if (params.brawlers.length > 0 || params.gameModes.length > 0) {
    params.intent = 'specific';
  }
}

/**
 * Call the LLM API with retry logic
 * @param {Function} apiCall Function that returns a promise for the API call
 * @param {number} maxRetries Maximum number of retry attempts
 * @returns {Promise<Object>} API response
 */
async function callLLMWithRetry(apiCall, maxRetries = 3) {
  let retries = 0;
  let lastError;
  
  while (retries <= maxRetries) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      retries++;
      
      logger.warn({ error, retries, maxRetries }, 'LLM API call failed, retrying');
      
      if (retries <= maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(1000 * Math.pow(2, retries), 10000) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Build the prompt for generating search parameters
 * @param {string} query User's query
 * @param {string} conversationHistory Formatted conversation history
 * @param {Object} userPreferences User preferences
 * @returns {string} Prompt for the LLM
 */
function buildSearchParamsPrompt(query, conversationHistory, userPreferences) {
  return `You are an AI assistant that helps users find Brawl Stars gaming content. 
Your task is to convert natural language queries into structured search parameters.

BRAWL STARS INFORMATION:
- Brawlers: ${BRAWLERS.join(', ')}
- Game Modes: ${GAME_MODES.join(', ')}
- Content Types: gameplay, tutorial, entertainment, pro, esports, funny, highlights, tips, strategy
- Skill Levels: beginner, intermediate, advanced

USER PREFERENCES:
${JSON.stringify(userPreferences, null, 2)}

PREVIOUS CONVERSATION:
${conversationHistory}

INSTRUCTIONS:
1. Convert the user's query into search parameters for finding Brawl Stars videos.
2. Extract mentions of specific brawlers, game modes, content types, and skill levels.
3. Determine if the user is looking for educational content (tutorials, tips) or entertainment (funny moments, highlights).
4. Take into account the conversation history to maintain context.
5. Consider the user's preferences to personalize the search parameters.
6. Respond with a JSON object containing the extracted parameters.

Your response should be a JSON object in the following format:
\`\`\`json
{
  "query": "The search text to use",
  "brawlers": ["Brawler1", "Brawler2"],
  "gameModes": ["GameMode1", "GameMode2"],
  "contentType": ["tutorial", "gameplay", "entertainment", "pro"],
  "skillLevel": "beginner/intermediate/advanced",
  "sortBy": "relevance/recent/popular/trending",
  "intent": "educational/entertainment/specific/general",
  "rephrased": "A rephrased version of the query for better search results"
}
\`\`\`

Only include parameters that are relevant to the query. If a parameter isn't mentioned, leave its array empty or field blank.
If the user is looking for specific brawlers but doesn't mention any by name, consider suggesting popular or trending brawlers.
If the query is ambiguous or open-ended, prioritize the most relevant content based on user preferences.`;
}

/**
 * Generate a conversational response based on search results
 * @param {Object} searchParams Structured search parameters
 * @param {Object[]} searchResults Search results from the database
 * @param {Object} conversationHistory Previous messages in the conversation
 * @returns {Promise<Object>} Response object with message and suggested actions
 */
async function generateResponse(searchParams, searchResults, conversationHistory = []) {
  try {
    logger.debug('Generating response for search results');
    
    // Format conversation history for the prompt
    const formattedHistory = conversationHistory
      .slice(-CONVERSATION_CONTEXT_LENGTH)
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n');
    
    // Format search results for the prompt
    const formattedResults = searchResults.map((result, index) => {
      const keyMoment = result.timestamps && result.timestamps.length > 0 ? 
        `${result.timestamps[0].title || 'Highlight'} at ${formatTimestamp(result.timestamps[0].time)}` : 
        'None';
      
      return `${index + 1}. "${result.title}" by ${result.creator.name}
   - Brawlers: ${result.brawlers.join(', ') || 'None'}
   - Game Mode: ${result.gameModes.join(', ') || 'None'}
   - Content Type: ${result.contentType.join(', ') || 'General'}
   - Views: ${formatNumber(result.viewCount)}
   - Duration: ${formatDuration(result.duration)}
   - Published: ${formatDate(result.publishedAt)}
   - Key Moment: ${keyMoment}`;
    }).join('\n\n');
    
    // Build the prompt for the LLM
    const prompt = buildResponsePrompt(searchParams, formattedResults, formattedHistory);
    
    // Call the LLM with retry
    const response = await callLLMWithRetry(async () => {
      return await openai.createChatCompletion({
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: prompt
          },
          {
            role: 'user',
            content: `Query: "${searchParams.query}"\nPlease provide a helpful response based on the search results.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });
    });
    
    // Extract the response text
    const responseText = response.data.choices[0].message.content;
    
    // Extract suggested actions if they exist
    const actionsMatch = responseText.match(/SUGGESTED_ACTIONS:\s*```json\n([\s\S]*?)\n```/);
    let suggestedActions = [];
    
    if (actionsMatch && actionsMatch[1]) {
      try {
        suggestedActions = JSON.parse(actionsMatch[1]);
      } catch (error) {
        logger.error({ error, actionsText: actionsMatch[1] }, 'Error parsing suggested actions');
      }
    }
    
    // Extract the main message (excluding the suggested actions part)
    let message = responseText;
    if (actionsMatch) {
      message = responseText.replace(/SUGGESTED_ACTIONS:\s*```json\n[\s\S]*?```/, '').trim();
    }
    
    return {
      message,
      suggestedActions
    };
  } catch (error) {
    logger.error({ error }, 'Error generating response');
    return {
      message: "I found some Brawl Stars videos that might interest you. Let me know if you'd like me to refine the search or if you want more specific content.",
      suggestedActions: []
    };
  }
}

/**
 * Build the prompt for generating conversational responses
 * @param {Object} searchParams Structured search parameters
 * @param {string} formattedResults Formatted search results
 * @param {string} conversationHistory Formatted conversation history
 * @returns {string} Prompt for the LLM
 */
function buildResponsePrompt(searchParams, formattedResults, conversationHistory) {
  return `You are an AI assistant that helps users find Brawl Stars gaming content.
Your task is to provide helpful and conversational responses based on search results.

SEARCH PARAMETERS:
${JSON.stringify(searchParams, null, 2)}

SEARCH RESULTS:
${formattedResults || "No results found for this query."}

PREVIOUS CONVERSATION:
${conversationHistory}

INSTRUCTIONS:
1. Provide a conversational response that highlights the most relevant videos from the search results.
2. Mention specific brawlers, game modes, or content types that were found.
3. If the results seem to match what the user was looking for, highlight the best matches.
4. If the results don't seem relevant, suggest ways to refine the search.
5. Maintain a friendly, helpful tone appropriate for Brawl Stars players.
6. Include 3-5 suggested follow-up actions the user might want to take.
7. If there are timestamps or key moments mentioned, highlight those as they might be particularly useful.
8. Be specific about what makes videos interesting (views, content type, creator reputation, etc.)

The generated response should be engaging, informative, and personalized. Focus on providing value by:
- Pointing out patterns or trends in the search results
- Mentioning popular creators or high-view videos
- Highlighting the most recent content if relevant
- Suggesting related brawlers or game modes the user might be interested in
- Offering refinement options if results are too broad or narrow

Your response should be structured as follows:
1. A conversational message addressing the user's query and highlighting key results
2. (Optional) A section for suggested actions, formatted as JSON

Example response format:
I found some great Mortis gameplay videos! The most popular one is "Pro Mortis Tips" by BrawlStarsGuide with over 500K views. There's also a recent tutorial from KairosTime that shows how to use Mortis effectively in Brawl Ball.

Would you like me to show you more tutorials, or are you interested in seeing funny Mortis moments instead?

SUGGESTED_ACTIONS: \`\`\`json
[
  {"type": "refine_search", "label": "Show me more Mortis tutorials", "parameters": {"brawlers": ["Mortis"], "contentType": ["tutorial"]}},
  {"type": "refine_search", "label": "Funny Mortis moments", "parameters": {"brawlers": ["Mortis"], "contentType": ["entertainment"]}},
  {"type": "filter_by_mode", "label": "Mortis in Brawl Ball", "parameters": {"brawlers": ["Mortis"], "gameModes": ["Brawl Ball"]}}
]
\`\`\`

Remember to make your response natural and conversational, focusing on being helpful to the user.`;
}

/**
 * Process a message in a conversation
 * @param {string} message User's message
 * @param {Object[]} conversationHistory Previous messages in the conversation
 * @param {Object} userPreferences User preferences
 * @returns {Promise<Object>} Response with message, results, and suggested actions
 */
async function processMessage(message, conversationHistory = [], userPreferences = {}) {
  // Build a prompt that instructs the AI to return ONLY a JSON object with specific keys.
  const prompt = `
You are an AI assistant that helps users find Brawl Stars content.
Convert the following natural language query into a JSON object with exactly these keys:
- "query": the search text to use
- "brawlers": an array of brawler names (if mentioned, otherwise an empty array)
- "gameModes": an array of game mode names (if mentioned, otherwise an empty array)
- "contentType": an array of content types (e.g., "tutorial", "gameplay", "entertainment"; if none, return an empty array)
- "skillLevel": one of "beginner", "intermediate", "advanced" or an empty string if not specified
- "sortBy": one of "relevance", "recent", "popular", "trending"
- "intent": a brief description of the user's intent
- "rephrased": a rephrased version of the query

Return only the JSON object with no extra explanation or text.
For example:
{"query": "show me gameplay of Mortis", "brawlers": ["Mortis"], "gameModes": [], "contentType": ["gameplay"], "skillLevel": "", "sortBy": "relevance", "intent": "gameplay", "rephrased": "gameplay of Mortis"}

Here is the conversation history:
${conversationHistory.map(m => m.role + ": " + m.content).join("\n")}

User query: "${message}"
  `.trim();

  try {
    const response = await openai.createChatCompletion({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        { role: "system", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 150
    });
    
    const responseText = response.data.choices[0].message.content.trim();
    console.log("OpenAI raw response:", responseText);
    
    let parsedJSON;
    try {
      // Attempt to parse the response directly as JSON
      parsedJSON = JSON.parse(responseText);
    } catch (e) {
      // If that fails, try to extract JSON between markdown triple backticks
      const match = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        parsedJSON = JSON.parse(match[1].trim());
      } else {
        throw new Error("Failed to parse JSON from OpenAI response: " + responseText);
      }
    }
    
    // Return a response object that matches your app's expected format.
    return {
      message: "Chat processed successfully.",
      results: [], // Video results will be fetched by your backend search after parameters are generated.
      suggestedActions: [],
      searchParams: parsedJSON,
      pagination: { total: 0, page: 1, limit: 12, pages: 0 },
      metrics: { totalTime: 0 }
    };
  } catch (error) {
    console.error("Error in processMessage:", error);
    throw error;
  }
}


/**
 * Handle user feedback on a video
 * @param {string} youtubeId YouTube video ID
 * @param {string} feedbackType Type of feedback (e.g., 'like', 'dislike', 'irrelevant')
 * @param {Object} userPreferences User preferences
 * @param {string} comment Optional user comment
 * @returns {Promise<Object>} Response indicating success
 */
async function handleVideoFeedback(youtubeId, feedbackType, userPreferences = {}, comment = null) {
  try {
    logger.info({ youtubeId, feedbackType, userId: userPreferences.userId }, 'Handling video feedback');
    
    // Record the feedback in the database
    await dbService.recordVideoFeedback(
      youtubeId,
      feedbackType,
      userPreferences.userId,
      userPreferences.sessionId,
      comment
    );
    
    // Generate a thank you message based on feedback type
    let message = "Thanks for your feedback!";
    
    if (feedbackType === 'like') {
      message = "Thanks for the like! I'll try to recommend more content like this in the future.";
    } else if (feedbackType === 'dislike') {
      message = "Thanks for letting me know this wasn't helpful. I'll try to improve my recommendations.";
    } else if (feedbackType === 'irrelevant') {
      message = "I appreciate you letting me know this wasn't relevant. This helps me improve my search results.";
    }
    
    // Get the video details
    const video = await dbService.getVideoByYoutubeId(youtubeId);
    
    // If video has brawlers, add them to user preferences
    if (video && video.brawlers && video.brawlers.length > 0 && feedbackType === 'like') {
      // Update user preferences for future recommendations
      if (!userPreferences.preferredBrawlers) {
        userPreferences.preferredBrawlers = [];
      }
      
      video.brawlers.forEach(brawler => {
        if (!userPreferences.preferredBrawlers.includes(brawler)) {
          userPreferences.preferredBrawlers.push(brawler);
        }
      });
      
      // Keep preferred brawlers list manageable
      if (userPreferences.preferredBrawlers.length > 10) {
        userPreferences.preferredBrawlers = userPreferences.preferredBrawlers.slice(-10);
      }
      
      // Save updated preferences
      await dbService.saveUserPreferences(
        userPreferences.userId,
        userPreferences.sessionId,
        userPreferences
      );
    }
    
    return {
      success: true,
      message
    };
  } catch (error) {
    logger.error({ error, youtubeId, feedbackType }, 'Error handling video feedback');
    return {
      success: false,
      message: "I couldn't process your feedback at the moment. Please try again later."
    };
  }
}

/**
 * Get personalized recommendations for a user
 * @param {Object} userPreferences User preferences
 * @param {number} limit Maximum number of recommendations
 * @returns {Promise<Object>} Recommendations with explanation
 */
async function getPersonalizedRecommendations(userPreferences = {}, limit = 6) {
  try {
    logger.info({ userId: userPreferences.userId }, 'Getting personalized recommendations');
    
    // Get trending brawlers and content
    const trendingBrawlers = await dbService.getTrendingBrawlers(5);
    const popularQueries = await dbService.getPopularSearchQueries(5);
    
    // Combine user preferences with trending data
    const userBrawlers = userPreferences.preferredBrawlers || [];
    const userGameModes = userPreferences.preferredGameModes || [];
    
    // Determine which brawlers to search for
    let targetBrawlers = [];
    
    if (userBrawlers.length > 0) {
      // Prioritize user preferences
      targetBrawlers = userBrawlers.slice(0, 3);
    } else {
      // Fall back to trending brawlers
      targetBrawlers = trendingBrawlers.map(b => b.brawler).slice(0, 3);
    }
    
    // Build search parameters with a blend of trending and user preferences
    const searchParams = {
      brawlers: targetBrawlers,
      gameModes: userGameModes.slice(0, 2),
      contentType: userPreferences.preferredContentTypes || ['gameplay', 'tutorial'],
      sortBy: 'trending',
      limit
    };
    
    // Search for videos
    const { videos } = await dbService.searchVideos(searchParams);
    
    // Generate explanation for recommendations
    let explanation = "Here are some Brawl Stars videos you might enjoy";
    
    if (targetBrawlers.length > 0) {
      explanation += ` featuring ${targetBrawlers.join(' and ')}`;
    }
    
    if (userGameModes.length > 0) {
      explanation += ` in ${userGameModes.join(' and ')}`;
    }
    
    explanation += ".";
    
    // If user has watched videos before, add a personalized message
    if (userPreferences.preferredBrawlers && userPreferences.preferredBrawlers.length > 0) {
      explanation += ` These recommendations are based on your interest in ${userPreferences.preferredBrawlers.slice(0, 3).join(', ')}.`;
    }
    
    return {
      videos,
      explanation,
      trendingBrawlers,
      popularQueries
    };
  } catch (error) {
    logger.error({ error }, 'Error getting personalized recommendations');
    return {
      videos: [],
      explanation: "I couldn't generate personalized recommendations at the moment. Please try searching for specific content instead.",
      trendingBrawlers: [],
      popularQueries: []
    };
  }
}

/**
 * Format duration in seconds to a human-readable string
 * @param {number} durationInSeconds Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(durationInSeconds) {
  const minutes = Math.floor(durationInSeconds / 60);
  const seconds = Math.floor(durationInSeconds % 60);
  
  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Format timestamp in seconds to a human-readable string
 * @param {number} timestampInSeconds Timestamp in seconds
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(timestampInSeconds) {
  const minutes = Math.floor(timestampInSeconds / 60);
  const seconds = Math.floor(timestampInSeconds % 60);
  
  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Format date to a human-readable string
 * @param {string} dateString Date string
 * @returns {string} Formatted date string
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format a number with internationalization
 * @param {number} num Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  } else {
    return num.toString();
  }
}

/**
 * Clear the prompt cache
 * @returns {number} Number of cache entries cleared
 */
function clearPromptCache() {
  return promptCache.flushAll();
}

module.exports = {
  processMessage,
  handleVideoFeedback,
  getPersonalizedRecommendations,
  generateSearchParams,
  generateResponse,
  clearPromptCache
};
