# API Configuration
PORT=3000
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:3001

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/brawlstars_content
DB_NAME=brawlstars_content
DB_POOL_SIZE=10
DB_CONNECT_TIMEOUT_MS=30000

# Session Configuration
SESSION_SECRET=your_session_secret_change_this_in_production
SESSION_MAX_AGE=604800000  # 1 week in milliseconds

# YouTube API Configuration
YOUTUBE_API_KEY=your_youtube_api_key
YOUTUBE_DAILY_QUOTA=10000
YOUTUBE_CACHE_TTL=3600  # Cache time in seconds
MAX_CONCURRENT_REQUESTS=5

# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo  # or 'gpt-4' if available

# Content Collection Configuration
MAX_VIDEOS_PER_RUN=50
COLLECTION_INTERVAL_HOURS=24
COLLECTION_SCHEDULE_ENABLED=true

# API Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# Admin API Configuration
ADMIN_API_KEY=your_admin_api_key_for_protected_endpoints
ADMIN_WEBHOOK_URL=https://your-monitoring-service.com/hooks/brawlstars

# Logging Configuration
LOG_LEVEL=info  # debug, info, warn, error
LOG_TO_FILE=false
LOG_FILE_PATH=./logs/app.log

# Performance Monitoring
ENABLE_PERFORMANCE_METRICS=true
