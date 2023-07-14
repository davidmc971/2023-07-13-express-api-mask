import express, { response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
dotenv.config();

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

const CACHE_TTL_SECONDS = 1800;

interface CacheEntry {
  data: any | null;
  timeStored: number;
  status: number;
}

// Very helpful for serializing Map:
// https://stackoverflow.com/questions/29085197/how-do-you-json-stringify-an-es6-map

const cacheJson = JSON.parse(
  readFileSync("cache.json").toString(),
  (_, value) => {
    if (typeof value === "object" && value !== null) {
      if (value.dataType === "Map") {
        return new Map(value.value);
      }
    }
    return value;
  }
);

const cache =
  cacheJson instanceof Map ? cacheJson : new Map<string, CacheEntry>();

process.on("exit", () => {
  console.log("process exiting");
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
  if (cache.has(cacheKey)) {
    const item = cache.get(cacheKey)!;
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

app.listen(8080, () => {
  console.log("Express listening on port 8080");
});
