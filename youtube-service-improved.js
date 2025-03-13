// Simple mock implementation of YouTube service

function getQuotaStatus() {
  return {
    used: 0,
    remaining: 10000,
    resetTime: new Date().toISOString()
  };
}

function clearApiCache() {
  return 0;
}

module.exports = {
  getQuotaStatus,
  clearApiCache
};
