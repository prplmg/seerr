import PlexTvAPI, {
  WATCHLIST_METADATA_CONCURRENCY,
  type PlexWatchlistCache,
} from '@server/api/plextv';
import cacheManager from '@server/lib/cache';
import type {
  AxiosAdapter,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

class TestPlexTvAPI extends PlexTvAPI {
  public installAdapter(adapter: AxiosAdapter): void {
    this.axios.defaults.adapter = adapter;
  }
}

function getAxios(api: PlexTvAPI): AxiosInstance {
  return (api as unknown as { axios: AxiosInstance }).axios;
}

function watchlistCache() {
  return cacheManager.getCache('plexwatchlist').data;
}

function axiosResponse<T>(
  config: InternalAxiosRequestConfig,
  data: T,
  headers: Record<string, string> = {}
): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers,
    config,
    request: {},
  };
}

function watchlistResponse(count: number) {
  return {
    MediaContainer: {
      totalSize: count,
      Metadata: Array.from({ length: count }, (_, index) => ({
        ratingKey: `rk-${index + 1}`,
      })),
    },
  };
}

function metadataResponse(ratingKey: string) {
  const id = ratingKey.replace('rk-', '');

  return {
    MediaContainer: {
      Metadata: [
        {
          ratingKey,
          type: 'movie' as const,
          title: `Movie ${id}`,
          Guid: [{ id: `tmdb://${id}` as const }],
        },
      ],
    },
  };
}

function isMetadataRequest(url: string | undefined): boolean {
  return !!url?.includes('/library/metadata/');
}

function isWatchlistRequest(url: string | undefined): boolean {
  return !!url?.includes('/library/sections/watchlist/all');
}

describe('PlexTvAPI.getWatchlist', () => {
  beforeEach(() => {
    cacheManager.getCache('plexwatchlist').flush();
    cacheManager.getCache('plextv').flush();
  });

  afterEach(() => {
    mock.restoreAll();
    cacheManager.getCache('plexwatchlist').flush();
    cacheManager.getCache('plextv').flush();
  });

  it('does not cache or crash on a 2xx body without MediaContainer', async () => {
    const api = new PlexTvAPI('token-empty');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"poison"' },
      data: { errors: [{ code: 1001, message: 'Unavailable' }] },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-empty:0:20'), undefined);
  });

  it('keeps a valid cached watchlist when Discover returns a 2xx without MediaContainer', async () => {
    const api = new PlexTvAPI('token-stale');
    watchlistCache().set<PlexWatchlistCache>('token-stale:0:20', {
      etag: '"good"',
      response: {
        MediaContainer: { totalSize: 4, Metadata: [] },
      },
    });
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"poison"' },
      data: '<html>error</html>',
    }));

    const result = await api.getWatchlist();

    assert.equal(result.totalSize, 4);
    assert.equal(
      watchlistCache().get<PlexWatchlistCache>('token-stale:0:20')?.etag,
      '"good"'
    );
  });

  it('drops a poisoned cache entry and does not send If-None-Match', async () => {
    const api = new PlexTvAPI('token-poisoned');
    watchlistCache().set('token-poisoned:0:20', {
      etag: '"bad"',
      response: { errors: ['nope'] },
    });

    let requestConfig: AxiosRequestConfig | undefined;
    mock.method(
      getAxios(api),
      'get',
      async (_url: string, config?: AxiosRequestConfig) => {
        requestConfig = config;
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: { MediaContainer: { totalSize: 0 } },
        };
      }
    );

    const result = await api.getWatchlist();

    assert.equal(result.totalSize, 0);
    assert.equal(requestConfig?.headers?.['If-None-Match'], undefined);
    assert.equal(
      watchlistCache().get<PlexWatchlistCache>('token-poisoned:0:20')?.etag,
      '"fresh"'
    );
  });

  it('does not cache a 2xx body whose MediaContainer is an array', async () => {
    const api = new PlexTvAPI('token-array');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"array"' },
      data: { MediaContainer: [] },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-array:0:20'), undefined);
  });

  it('does not cache a 2xx body whose totalSize is not a number', async () => {
    const api = new PlexTvAPI('token-bad-size');
    mock.method(getAxios(api), 'get', async () => ({
      status: 200,
      headers: { etag: '"bad-size"' },
      data: { MediaContainer: { totalSize: 'invalid' } },
    }));

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
    assert.equal(watchlistCache().get('token-bad-size:0:20'), undefined);
  });

  it('returns an empty watchlist when the watchlist fetch fails', async () => {
    const api = new PlexTvAPI('token-fetch-error');
    mock.method(getAxios(api), 'get', async () => {
      throw new Error('network down');
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 0,
      items: [],
    });
  });

  it('propagates cache manager failures instead of returning an empty watchlist', async () => {
    const api = new PlexTvAPI('token-cache-error');
    const cacheError = new Error('cache unavailable');
    mock.method(cacheManager, 'getCache', () => {
      throw cacheError;
    });

    await assert.rejects(() => api.getWatchlist(), cacheError);
  });

  it('isolates cached pages by token, offset and size and reuses each page on 304', async () => {
    const cases = [
      { token: 'page-token', offset: 0, size: 20, id: 1 },
      { token: 'page-token', offset: 20, size: 20, id: 2 },
      { token: 'page-token', offset: 0, size: 5, id: 3 },
      { token: 'other-token', offset: 0, size: 20, id: 4 },
    ];
    const seen = new Set<string>();
    for (let pass = 0; pass < 2; pass++) {
      for (const { token, offset, size, id } of cases) {
        const key = `${token}:${offset}:${size}`;
        const etag = `"page-${id}"`;
        const api = new TestPlexTvAPI(token);
        api.installAdapter(async (config) => {
          if (isWatchlistRequest(config.url)) {
            assert.equal(config.params['X-Plex-Container-Start'], offset);
            assert.equal(config.params['X-Plex-Container-Size'], size);
            if (seen.has(key)) {
              assert.equal(config.headers['If-None-Match'], etag);
              return {
                ...axiosResponse(config, ''),
                status: 304,
                statusText: 'Not Modified',
              };
            }
            assert.equal(config.headers['If-None-Match'], undefined);
            seen.add(key);
            return axiosResponse(
              config,
              {
                MediaContainer: {
                  totalSize: 40,
                  Metadata: [{ ratingKey: `rk-${id}` }],
                },
              },
              { etag }
            );
          }
          if (isMetadataRequest(config.url)) {
            return axiosResponse(config, metadataResponse(`rk-${id}`));
          }
          throw new Error(`Unexpected request: ${config.url}`);
        });
        const result = await api.getWatchlist({ offset, size, strict: true });
        assert.equal(result.offset, offset);
        assert.equal(result.size, size);
        assert.equal(result.totalSize, 40);
        assert.deepEqual(
          result.items.map((item) => item.tmdbId),
          [id]
        );
        assert.equal(watchlistCache().get<PlexWatchlistCache>(key)?.etag, etag);
      }
    }
    assert.equal(watchlistCache().get('page-token'), undefined);
  });

  it('evicts only the poisoned page and leaves another page available for 304', async () => {
    const api = new TestPlexTvAPI('poison-pages');
    watchlistCache().set('poison-pages:20:20', {
      etag: '"bad"',
      response: { errors: ['unavailable'] },
    });
    const valid: PlexWatchlistCache = {
      etag: '"good"',
      response: { MediaContainer: { totalSize: 40, Metadata: [] } },
    };
    watchlistCache().set('poison-pages:0:20', valid);
    api.installAdapter(async (config) => {
      assert.equal(config.params['X-Plex-Container-Start'], 20);
      assert.equal(config.headers['If-None-Match'], undefined);
      assert.equal(watchlistCache().get('poison-pages:20:20'), undefined);
      return axiosResponse(
        config,
        { MediaContainer: { totalSize: 40 } },
        {
          etag: '"repaired"',
        }
      );
    });
    await api.getWatchlist({ offset: 20 });
    assert.deepEqual(watchlistCache().get('poison-pages:0:20'), valid);
    assert.equal(
      watchlistCache().get<PlexWatchlistCache>('poison-pages:20:20')?.etag,
      '"repaired"'
    );
    api.installAdapter(async (config) => {
      assert.equal(config.headers['If-None-Match'], '"good"');
      return { ...axiosResponse(config, ''), status: 304 };
    });
    assert.equal((await api.getWatchlist()).totalSize, 40);
  });

  for (const code of ['ETIMEDOUT', 'ENETUNREACH']) {
    for (const failureAt of ['watchlist', 'metadata']) {
      it(`rejects strict ${failureAt} ${code} instead of returning an empty or partial list`, async () => {
        const api = new TestPlexTvAPI(`strict-${failureAt}-${code}`);
        api.installAdapter(async (config) => {
          if (isWatchlistRequest(config.url)) {
            if (failureAt === 'watchlist') {
              throw Object.assign(new Error('network unavailable'), { code });
            }
            return axiosResponse(config, watchlistResponse(2));
          }
          if (config.url === '/library/metadata/rk-1') {
            return axiosResponse(config, metadataResponse('rk-1'));
          }
          if (config.url === '/library/metadata/rk-2') {
            throw Object.assign(new Error('network unavailable'), { code });
          }
          throw new Error(`Unexpected request: ${config.url}`);
        });
        await assert.rejects(() => api.getWatchlist({ strict: true }), {
          message: 'Plex watchlist unavailable',
        });
      });
    }
  }

  it('still skips confirmed 404 deletions in strict mode', async () => {
    const api = new TestPlexTvAPI('strict-404');
    api.installAdapter(async (config) => {
      if (isWatchlistRequest(config.url)) {
        return axiosResponse(config, watchlistResponse(2));
      }
      if (config.url === '/library/metadata/rk-1') {
        throw Object.assign(new Error('not found'), {
          response: { status: 404 },
        });
      }
      if (config.url === '/library/metadata/rk-2') {
        return axiosResponse(config, metadataResponse('rk-2'));
      }
      throw new Error(`Unexpected request: ${config.url}`);
    });
    const result = await api.getWatchlist({ strict: true });
    assert.equal(result.totalSize, 2);
    assert.deepEqual(
      result.items.map((item) => item.tmdbId),
      [2]
    );
  });

  it('limits concurrent metadata requests', async () => {
    const itemCount = 12;
    let inFlight = 0;
    let maxInFlight = 0;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;

        const ratingKey = url?.split('/library/metadata/')[1] ?? '';
        return axiosResponse(config, metadataResponse(ratingKey));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.strictEqual(result.items.length, itemCount);
    assert.ok(
      maxInFlight <= WATCHLIST_METADATA_CONCURRENCY,
      `expected at most ${WATCHLIST_METADATA_CONCURRENCY} concurrent metadata requests, saw ${maxInFlight}`
    );
  });

  it('returns partial results when individual metadata requests fail', async () => {
    const itemCount = 8;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        const ratingKey = url?.split('/library/metadata/')[1] ?? '';

        if (Number(ratingKey.replace('rk-', '')) % 2 === 0) {
          const error = new Error('connect ETIMEDOUT') as Error & {
            code: string;
          };
          error.code = 'ETIMEDOUT';
          throw error;
        }

        return axiosResponse(config, metadataResponse(ratingKey));
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.strictEqual(result.items.length, 4);
    assert.ok(
      result.items.every((item) => Number(item.tmdbId) % 2 === 1),
      'only odd-numbered watchlist items should be returned'
    );
  });

  it('fails the sync when metadata requests return auth errors', async () => {
    const itemCount = 3;

    const api = new TestPlexTvAPI('test-token');
    api.installAdapter(async (config) => {
      const url = config.url;

      if (isWatchlistRequest(url)) {
        return axiosResponse(config, watchlistResponse(itemCount), {
          etag: 'test-etag',
        });
      }

      if (isMetadataRequest(url)) {
        const error = new Error(
          'Request failed with status code 401'
        ) as Error & {
          response: { status: number };
        };
        error.response = { status: 401 };
        throw error;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await api.getWatchlist({ size: itemCount });

    assert.deepStrictEqual(result, {
      offset: 0,
      size: itemCount,
      totalSize: 0,
      items: [],
    });
  });

  it('skips items whose metadata request returns 404', async () => {
    const api = new PlexTvAPI('token-404');
    mock.method(getAxios(api), 'get', async (url: string) => {
      if (url === '/library/sections/watchlist/all') {
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: {
            MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: 'abc' }] },
          },
        };
      }

      if (url === '/library/metadata/abc') {
        throw Object.assign(new Error('not found'), {
          response: { status: 404 },
        });
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 1,
      items: [],
    });
  });

  it('skips items whose metadata response contains no metadata', async () => {
    const api = new PlexTvAPI('token-no-meta');
    mock.method(getAxios(api), 'get', async (url: string) => {
      if (url === '/library/sections/watchlist/all') {
        return {
          status: 200,
          headers: { etag: '"fresh"' },
          data: {
            MediaContainer: {
              totalSize: 2,
              Metadata: [{ ratingKey: 'empty' }, { ratingKey: 'good' }],
            },
          },
        };
      }

      if (url === '/library/metadata/empty') {
        return { status: 200, data: { MediaContainer: {} } };
      }

      if (url === '/library/metadata/good') {
        return {
          status: 200,
          data: {
            MediaContainer: {
              Metadata: [
                {
                  ratingKey: 'good',
                  type: 'movie',
                  title: 'Good Movie',
                  Guid: [{ id: 'tmdb://550' }],
                },
              ],
            },
          },
        };
      }

      throw new Error(`unexpected url: ${url}`);
    });

    const result = await api.getWatchlist();

    assert.deepEqual(result, {
      offset: 0,
      size: 20,
      totalSize: 2,
      items: [
        {
          ratingKey: 'good',
          tmdbId: 550,
          tvdbId: undefined,
          title: 'Good Movie',
          type: 'movie',
        },
      ],
    });
  });
});
