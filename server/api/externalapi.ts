import { isBackgroundWork } from '@server/lib/backgroundContext';
import { backgroundWork } from '@server/lib/backgroundWork';
import logger from '@server/logger';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import type NodeCache from 'node-cache';

// 5 minute default TTL (in seconds)
const DEFAULT_TTL = 300;

// 10 seconds default rolling buffer (in ms)
const DEFAULT_ROLLING_BUFFER = 10000;

export interface ExternalAPIOptions {
  nodeCache?: NodeCache;
  headers?: Record<string, unknown>;
  timeout?: number;
  rateLimit?: {
    maxRPS: number;
    maxRequests: number;
  };
}

class ExternalAPI {
  protected axios: AxiosInstance;
  private baseUrl: string;
  private cache?: NodeCache;

  constructor(
    baseUrl: string,
    params: Record<string, unknown>,
    options: ExternalAPIOptions = {}
  ) {
    this.axios = axios.create({
      baseURL: baseUrl,
      params,
      timeout: options.timeout,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });
    this.axios.interceptors.request.use(proxyRequestInterceptor);
    // Keep authenticated/proxy-aware I/O and cache ownership here, but decode
    // potentially large scan/download responses away from HTTP request handling.
    // This context also covers manually invoked scheduler jobs.
    this.axios.interceptors.request.use((config) => {
      const transforms = Array.isArray(config.transformResponse)
        ? config.transformResponse
        : [config.transformResponse];
      const defaults = Array.isArray(axios.defaults.transformResponse)
        ? axios.defaults.transformResponse
        : [axios.defaults.transformResponse];
      if (
        isBackgroundWork() &&
        !config.responseType &&
        !config.parseReviver &&
        config.transitional?.forcedJSONParsing !== false &&
        config.transitional?.silentJSONParsing !== false &&
        transforms.length === defaults.length &&
        transforms.every((fn, i) => fn === defaults[i])
      ) {
        config.responseType = 'text';
        config.transformResponse = [(text: string) => text];
        (
          config as typeof config & { backgroundJson?: boolean }
        ).backgroundJson = true;
      }
      return config;
    });
    const decodeBackground = async (response: AxiosResponse) => {
      if (
        (
          response.config as typeof response.config & {
            backgroundJson?: boolean;
          }
        ).backgroundJson &&
        typeof response.data === 'string' &&
        response.data.trim()
      ) {
        // Small payloads cost less to decode than an IPC round trip. Keep the
        // worker for the large scan responses that can stall the request loop.
        if (response.data.length < 128 * 1024) {
          try {
            response.data = JSON.parse(response.data);
          } catch {
            /* Axios default: retain text. */
          }
        } else
          response.data = await backgroundWork.run({
            kind: 'json',
            text: response.data,
            silent: true,
          });
      }
      return response;
    };
    this.axios.interceptors.response.use(decodeBackground, async (error) => {
      if (error.response) {
        try {
          await decodeBackground(error.response);
        } catch {
          /* Preserve HTTP failure. */
        }
      }
      throw error;
    });

    if (options.rateLimit) {
      this.axios = rateLimit(this.axios, {
        maxRequests: options.rateLimit.maxRequests,
        maxRPS: options.rateLimit.maxRPS,
      });
    }

    this.baseUrl = baseUrl;
    this.cache = options.nodeCache;
  }

  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
      headers: config?.headers,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    const response = await this.axios.get<T>(endpoint, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected async post<T>(
    endpoint: string,
    data?: Record<string, unknown>,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      config: config?.params,
      ...(data ? { data } : {}),
    });

    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    const response = await this.axios.post<T>(endpoint, data, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected async getRolling<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
      headers: config?.headers,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);

    if (cachedItem) {
      const keyTtl = this.cache?.getTtl(cacheKey) ?? 0;

      // If the item has passed our rolling check, fetch again in background
      if (
        keyTtl - (ttl ?? DEFAULT_TTL) * 1000 <
        Date.now() - DEFAULT_ROLLING_BUFFER
      ) {
        this.axios
          .get<T>(endpoint, config)
          .then((response) => {
            this.cache?.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
          })
          .catch(() => {
            logger.warn(
              'Background API cache refresh failed; retaining cached value',
              { label: 'API' }
            );
          });
      }
      return cachedItem;
    }

    const response = await this.axios.get<T>(endpoint, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected removeCache(endpoint: string, options?: Record<string, unknown>) {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...options,
    });
    this.cache?.del(cacheKey);
  }

  private serializeCacheKey(
    endpoint: string,
    options?: Record<string, unknown>
  ) {
    if (!options) {
      return `${this.baseUrl}${endpoint}`;
    }

    return `${this.baseUrl}${endpoint}${JSON.stringify(options)}`;
  }
}

export default ExternalAPI;
