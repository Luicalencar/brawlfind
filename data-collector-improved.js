// Simple mock implementation of data collector

function collectBrawlStarsContent(options) {
  return Promise.resolve({
    status: "success",
    collected: 0,
    options
  });
}

function scheduleCollection(intervalHours, options = {}) {
  return {
    intervalHours,
    intervalMs: intervalHours * 60 * 60 * 1000,
    options
  };
}

function getCollectionStatus() {
  return {
    lastRun: null,
    nextRun: null,
    isRunning: false,
    stats: {
      videosCollected: 0,
      channelsProcessed: 0
    }
  };
}

module.exports = {
  collectBrawlStarsContent,
  scheduleCollection,
  getCollectionStatus
};
