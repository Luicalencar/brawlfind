// Standalone server with no dependencies on other project files
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: 'GET,POST,PUT,DELETE',
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Brawl Stars Content API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Filters endpoint
app.get('/api/filters', (req, res) => {
  res.status(200).json({
    brawlers: ['Shelly', 'Colt', 'Brock', 'Spike', 'Bo', 'El Primo', 'Mortis'].map(brawler => ({ id: brawler, name: brawler })),
    gameModes: ['Gem Grab', 'Showdown', 'Brawl Ball', 'Heist'].map(mode => ({ id: mode, name: mode })),
    contentTypes: [
      { id: 'tutorial', name: 'Tutorials' },
      { id: 'gameplay', name: 'Gameplay' },
      { id: 'tips', name: 'Tips & Tricks' },
      { id: 'funny', name: 'Funny Moments' }
    ],
    skillLevels: [
      { id: 'beginner', name: 'Beginner' },
      { id: 'intermediate', name: 'Intermediate' },
      { id: 'advanced', name: 'Advanced' }
    ],
    sortOptions: [
      { id: 'relevance', name: 'Most Relevant' },
      { id: 'recent', name: 'Most Recent' },
      { id: 'popular', name: 'Most Popular' }
    ]
  });
});

// Recommendations endpoint
app.get('/api/recommendations', (req, res) => {
  res.status(200).json({
    videos: getSampleVideos(),
    trendingBrawlers: [
      { name: 'Shelly', count: 120 },
      { name: 'Colt', count: 95 },
      { name: 'Bo', count: 80 }
    ],
    popularQueries: [
      { query: 'brawl ball tips', count: 50 },
      { query: 'best shelly build', count: 45 },
      { query: 'how to use mortis', count: 40 }
    ]
  });
});

// Video details endpoint
app.get('/api/videos/:youtubeId', (req, res) => {
  const { youtubeId } = req.params;
  const sampleVideo = getSampleVideos().find(video => video.youtubeId === youtubeId) || getSampleVideos()[0];
  
  res.status(200).json({
    video: {
      ...sampleVideo,
      description: 'This is a detailed description of the video with tips and strategies.',
      timestamps: [
        { time: 30, title: 'Introduction' },
        { time: 60, title: 'Strategy overview' },
        { time: 120, title: 'Gameplay example' }
      ]
    },
    recommendations: getSampleVideos()
  });
});

// User preferences endpoint
app.get('/api/preferences', (req, res) => {
  res.status(200).json({
    preferredBrawlers: ['Shelly', 'Spike'],
    preferredGameModes: ['Gem Grab'],
    preferredContentTypes: ['tips', 'gameplay']
  });
});

// Feedback endpoint
app.post('/api/feedback', (req, res) => {
  const { youtubeId, feedbackType, comment } = req.body;
  
  res.status(200).json({
    success: true,
    message: 'Feedback received, thank you!'
  });
});

// Sample conversation endpoint
app.post('/api/conversation', (req, res) => {
  const { message } = req.body;
  
  res.status(200).json({
    message: `You said: "${message}". This is a demo response from the API. The full implementation will be connected soon.`,
    results: getSampleVideos(),
    suggestedActions: [
      {
        type: 'refine_search',
        label: 'Show Shelly videos',
        parameters: { brawlers: ['Shelly'] }
      },
      {
        type: 'refine_search',
        label: 'Show Brawl Ball videos',
        parameters: { gameModes: ['Brawl Ball'] }
      }
    ],
    pagination: { 
      page: 1, 
      total: 1, 
      limit: 10, 
      pages: 1 
    }
  });
});

// Sample search endpoint
app.get('/api/search', (req, res) => {
  res.status(200).json({
    videos: getSampleVideos(),
    pagination: { 
      total: 10, 
      page: 1, 
      limit: 10, 
      pages: 1 
    }
  });
});

// Helper function for sample data
function getSampleVideos() {
  return [
    {
      youtubeId: 'dQw4w9WgXcQ',
      title: 'Amazing Brawl Stars Gameplay with Shelly',
      creator: { name: 'Brawl Stars Official', id: 'UC123' },
      viewCount: 1500000,
      publishedAt: '2023-01-01T00:00:00Z',
      duration: 180,
      brawlers: ['Shelly', 'Colt'],
      gameModes: ['Gem Grab'],
      contentType: ['gameplay', 'tutorial']
    },
    {
      youtubeId: 'xvFZjo5PgG0',
      title: 'Pro Tips for Brawl Ball',
      creator: { name: 'Brawl Tips', id: 'UC456' },
      viewCount: 750000,
      publishedAt: '2023-02-15T00:00:00Z',
      duration: 240,
      brawlers: ['Mortis', 'El Primo'],
      gameModes: ['Brawl Ball'],
      contentType: ['tips', 'pro']
    }
  ];
}

// Clear conversation history endpoint
app.delete('/api/conversation/history', (req, res) => {
  res.status(200).json({ message: 'Conversation history cleared' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
