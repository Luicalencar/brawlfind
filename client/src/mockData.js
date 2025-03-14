// mockData.js - Temporary fallback data
export const mockFilters = {
  brawlers: ['Shelly', 'Colt', 'Brock', 'Spike', 'Bo', 'El Primo', 'Mortis'].map(name => ({ id: name, name })),
  gameModes: ['Gem Grab', 'Showdown', 'Brawl Ball', 'Heist'].map(name => ({ id: name, name })),
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
};

export const mockRecommendations = {
  videos: [
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
  ],
  explanation: "Here are some recommended videos",
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
};

export const mockConversationResponse = {
  message: "I found some great Brawl Stars videos for you! Check out the recommendations below.",
  results: mockRecommendations.videos,
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
  },
  metrics: {
    totalTime: 250,
    searchParamsTime: 50,
    searchTime: 100,
    responseTime: 100
  }
};
