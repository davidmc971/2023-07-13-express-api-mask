import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import {
  ApiCache,
  CACHE_TTL_SECONDS,
  LocalCache,
  RedisCache,
} from "./apiCache";
dotenv.config();

const EXPRESS_PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

const { SPOONACULAR_API_KEY } = process.env;
if (SPOONACULAR_API_KEY == null) {
  console.error("API Key not provided in .env");
  process.exit(1);
}

const SPOONACULAR_API_BASE_URL = "https://api.spoonacular.com";
const spoonacularAxios = axios.create({
  baseURL: SPOONACULAR_API_BASE_URL,
  headers: {
    "x-api-key": SPOONACULAR_API_KEY,
  },
});

let cache: ApiCache;

RedisCache.new()
  .then((redisCache) => {
    console.log("Setting Redis Cache");
    cache = redisCache;
  })
  .catch((error) => {
    console.error(error);
    console.log("Setting Local Cache");
    cache = new LocalCache();
  });

process.on("exit", async () => {
  console.log("process exiting");
  await cache.persist();
});

const getTimestamp = () =>
  "[" + new Date().toISOString().replace("T", " ").split(".")[0] + " UTC]";

const parseParams = (query: { [key: string]: any }) =>
  new URLSearchParams(query);

const sanitizeParams = (params: URLSearchParams, toDelete: string[]) => {
  toDelete.forEach(
    (paramName) => params.has(paramName) && params.delete(paramName)
  );
};

const app = express();
app.use(cors());

app.use(async (req, res) => {
  let url = req.url.split("?")[0];
  if (Object.keys(req.query).length > 0) {
    const params = parseParams(req.query);
    sanitizeParams(params, ["apiKey"]);
    url += "?" + params.toString();
  }
  console.log(getTimestamp(), "IN", req.method, url);
  const cacheKey = `${req.method} ${req.url}`;
  const item = await cache.get(cacheKey);
  if (item != null) {
    if (Date.now() - item.timeStored < CACHE_TTL_SECONDS * 1000) {
      if (item.data === null) {
        res.sendStatus(item.status);
      } else {
        res.status(item.status).json(item.data);
      }
      return;
    } else {
      cache.delete(cacheKey);
    }
  }

  console.log(
    getTimestamp(),
    "OUT",
    req.method,
    SPOONACULAR_API_BASE_URL + url
  );

  spoonacularAxios
    .request({
      method: req.method,
      url: req.url,
    })
    .then((response) => {
      cache.set(cacheKey, {
        data: response.data,
        status: response.status,
        timeStored: Date.now(),
      });
      res.status(response.status).json(response.data);
    })
    .catch((error) => {
      if (error.response) {
        cache.set(cacheKey, {
          data: error.response.data,
          status: error.response.status,
          timeStored: Date.now(),
        });
        res.status(error.response.status).json(error.response.data);
      } else if (error.request) {
        cache.set(cacheKey, {
          data: null,
          status: 500,
          timeStored: Date.now(),
        });
        console.error(error.request);
        res.sendStatus(500);
      } else {
        cache.set(cacheKey, {
          data: null,
          status: 500,
          timeStored: Date.now(),
        });
        console.error(error.message);
        res.sendStatus(500);
      }
    });
});

app.listen(EXPRESS_PORT, () => {
  console.log("Express listening on port " + EXPRESS_PORT);
});
