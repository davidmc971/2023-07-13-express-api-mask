import { readFileSync, writeFileSync } from "fs";
import { createClient } from "redis";
import * as dotenv from "dotenv";
dotenv.config();

export const CACHE_TTL_SECONDS = process.env.CACHE_TTL_SECONDS
  ? parseInt(process.env.CACHE_TTL_SECONDS)
  : 1800;

export interface CacheEntry {
  data: any | null;
  timeStored: number;
  status: number;
}

export interface ApiCache {
  contains(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  persist(): Promise<void>;
}

// Very helpful for serializing Map:
// https://stackoverflow.com/questions/29085197/how-do-you-json-stringify-an-es6-map

export class LocalCache implements ApiCache {
  private map: Map<string, CacheEntry>;

  public constructor() {
    this.map = LocalCache.tryLoadFromJson();
  }

  contains(key: string) {
    return Promise.resolve(this.map.has(key));
  }
  delete(key: string) {
    return Promise.resolve(this.map.delete(key));
  }
  get(key: string) {
    return Promise.resolve(this.map.get(key));
  }
  set(key: string, entry: CacheEntry) {
    this.map.set(key, entry);
    return Promise.resolve();
  }
  persist() {
    LocalCache.saveCache(this.map);
    return Promise.resolve();
  }

  private static tryLoadFromJson(): Map<string, CacheEntry> {
    return JSON.parse(readFileSync("cache.json").toString(), (_, value) => {
      if (typeof value === "object" && value !== null) {
        if (value.dataType === "Map") {
          return new Map<string, CacheEntry>(value.value);
        }
      }
      return new Map<string, CacheEntry>();
    });
  }

  private static saveCache(cache: Map<string, CacheEntry>) {
    writeFileSync(
      "cache.json",
      JSON.stringify(cache, (_, value) => {
        if (value instanceof Map) {
          return {
            dataType: "Map",
            value: Array.from(value.entries()), // or with spread: value: [...value]
          };
        } else {
          return value;
        }
      })
    );
  }
}

export class RedisCache implements ApiCache {
  private redis = createClient({
    url: process.env.REDIS_URL,
  });

  private constructor() {}

  public static async new(): Promise<RedisCache> {
    return new Promise<RedisCache>(async (resolve, reject) => {
      const cache = new RedisCache();
      try {
        const client = cache.redis;
        await client.connect();
        resolve(cache);
      } catch (error) {
        reject(error);
      }
    });
  }

  async contains(key: string) {
    return (await this.redis.EXISTS(key)) > 0;
  }
  async delete(key: string) {
    return (await this.redis.DEL(key)) === 1;
  }
  async get(key: string) {
    return new Promise<CacheEntry | undefined>(async (resolve, reject) => {
      try {
        const value = await this.redis.GET(key);
        if (value != null) {
          const entry: CacheEntry = JSON.parse(value);
          entry != null ? resolve(entry) : reject("entry not parsed correctly");
        } else {
          resolve(undefined);
        }
      } catch (error) {
        reject(error);
      }
    });
  }
  async set(key: string, entry: CacheEntry) {
    this.redis.SETEX(key, CACHE_TTL_SECONDS, JSON.stringify(entry));
  }
  async persist() {
    this.redis.SAVE();
  }
}
