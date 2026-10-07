/**
 * Caching layer with Redis support and in-memory fallback
 *
 * Installation (optional, for production):
 * npm install ioredis
 *
 * Set REDIS_URL environment variable to enable Redis caching.
 * Falls back to in-memory cache if Redis is not available.
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

// In-memory cache fallback
const memoryCache = new Map<string, CacheEntry>();

// Redis client (lazy-loaded)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;
let redisAvailable = false;

// Initialize Redis client if available
async function getRedisClient() {
  if (redisClient !== null) {
    return redisAvailable ? redisClient : null;
  }

  try {
    // Try to import ioredis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Redis = await import('ioredis' as string).then((m: any) => m.default).catch(() => null);

    if (!Redis || !process.env.REDIS_URL) {
      console.log('Cache: Using in-memory cache (Redis not configured)');
      redisAvailable = false;
      redisClient = false; // Mark as checked
      return null;
    }

    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.warn('Redis connection failed, falling back to memory cache');
          redisAvailable = false;
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    redisAvailable = true;
    console.log('Cache: Connected to Redis');
    return redisClient;
  } catch (error) {
    console.warn('Redis initialization failed, using memory cache:', error);
    redisAvailable = false;
    redisClient = false;
    return null;
  }
}

// Clean up expired entries from memory cache
function cleanMemoryCache() {
  const now = Date.now();
  const entries = Array.from(memoryCache.entries());
  for (const [key, entry] of entries) {
    if (entry.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}

// Run cleanup every 5 minutes (server-side only)
if (typeof window === 'undefined') {
  setInterval(cleanMemoryCache, 5 * 60 * 1000);
}

export const cache = {
  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const redis = await getRedisClient();

    if (redis) {
      try {
        const value = await redis.get(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error('Redis get error:', error);
        // Fall through to memory cache
      }
    }

    // Memory cache
    const entry = memoryCache.get(key);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      memoryCache.delete(key);
      return null;
    }

    return JSON.parse(entry.value);
  },

  /**
   * Set a value in cache with TTL in seconds
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const redis = await getRedisClient();

    if (redis) {
      try {
        await redis.setex(key, ttlSeconds, serialized);
        return;
      } catch (error) {
        console.error('Redis set error:', error);
        // Fall through to memory cache
      }
    }

    // Memory cache
    memoryCache.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  },

  /**
   * Delete a value from cache
   */
  async del(key: string): Promise<void> {
    const redis = await getRedisClient();

    if (redis) {
      try {
        await redis.del(key);
        return;
      } catch (error) {
        console.error('Redis del error:', error);
        // Fall through to memory cache
      }
    }

    // Memory cache
    memoryCache.delete(key);
  },

  /**
   * Delete multiple keys matching a pattern
   */
  async delPattern(pattern: string): Promise<void> {
    const redis = await getRedisClient();

    if (redis) {
      try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        return;
      } catch (error) {
        console.error('Redis delPattern error:', error);
        // Fall through to memory cache
      }
    }

    // Memory cache - simple pattern matching
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keys = Array.from(memoryCache.keys());
    for (const key of keys) {
      if (regex.test(key)) {
        memoryCache.delete(key);
      }
    }
  },

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return redisAvailable;
  },
};
