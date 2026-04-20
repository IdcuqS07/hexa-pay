'use strict';

const Redis = require('ioredis');

let sharedClient = null;

function createRedisClientFromEnv() {
  const url = process.env.MOCK_RECEIPT_REDIS_URL || 'redis://127.0.0.1:6379';
  const lazyConnect = process.env.MOCK_RECEIPT_REDIS_LAZY_CONNECT === '1';

  const client = new Redis(url, {
    lazyConnect,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (err) => {
    console.error('[mock-receipt][redis] client error:', err && err.message ? err.message : err);
  });

  return client;
}

function getSharedRedisClient() {
  if (!sharedClient) {
    sharedClient = createRedisClientFromEnv();
  }
  return sharedClient;
}

async function closeSharedRedisClient() {
  if (sharedClient) {
    const client = sharedClient;
    sharedClient = null;
    await client.quit();
  }
}

module.exports = {
  createRedisClientFromEnv,
  getSharedRedisClient,
  closeSharedRedisClient,
};
