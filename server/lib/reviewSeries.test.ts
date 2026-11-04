import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
import * as parser from './letterboxdImport';
import { scopedReviewId } from './reviewEntrySelection';
import { episodeReviewScope } from './episodeReviewScope';

it('series reviews use TV metadata and cannot overwrite or delete the same-number movie review', async () => {
  let latestViewing: any = null;
  const rows = new Map<string, any>(),
    routes = new Map<string, any>(),
    metadata: string[] = [];
  const repo = {
    find: async ({where}:any) => [...rows.values()].filter(r=>r.userId===where.userId&&r.tmdbId===where.tmdbId&&r.mediaType===where.mediaType),
    findOneBy: async ({ id }: any) => rows.get(id),
    create: (value: any) => value,
    save: async (value: any) => {
      rows.set(value.id, value);
      return value;
    },
    delete: async ({ id }: any) => {
      rows.delete(id);
    },
  };
  const router = Object.fromEntries(
    ['get', 'put', 'post', 'delete', 'use'].map((method) => [
      method,
      (url: any, ...handlers: any[]) =>
        routes.set(`${method} ${url}`, handlers.at(-1)),
    ])
  );
  const code = ts.transpileModule(
    readFileSync(path.join(__dirname, '../routes/reviews.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'express') return { Router: () => router };
    if (name === 'express-rate-limit') return () => () => {};
    if (name === '@server/lib/letterboxdImport') return parser;
    if (name === '@server/lib/reviewEntrySelection') return {scopedReviewId,latestReviewViewing:async()=>latestViewing};
    if (name === '@server/lib/episodeReviewScope') return {episodeReviewScope};
    if (name === 'typeorm') return {IsNull:()=>null};
    if (name === '@server/lib/reviews') return {withReviewLock:async (_:unknown,fn:any)=>fn()};
    if (name === '@server/lib/letterboxdWriteQueue') return {readWriteState:()=>({settings:{}}),updateWriteState:(fn:any)=>fn({intents:[]})};
    if (name === '@server/lib/reviewPublishingPolicy') return {reviewPublishingEnabled:()=>false,reviewPublishingPreference:()=>false,cancelQueuedReviewWrites:()=>{}};
    if (name === '@server/lib/letterboxdPublicationSchedule') return {publicationSchedule:()=>({})};
    if (name === '@server/lib/settings') return {getSettings:()=>({jobs:{}})};
    if (name === './letterboxdExportPolicy') return {exportAllowsImport:async()=>true};
    if (name === '@server/datasource') return { getRepository: () => repo };
    if (name === '@server/api/themoviedb')
      return class {
        async getMovie() {
          metadata.push('movie');
        }
        async getTvShow() {
          metadata.push('tv');
        }
      };
    return {};
  }, {});
  let status = 200,
    result: any;
  const res: any = {
    json: (v: any) => {
      result = v;
    },
    sendStatus: (v: number) => {
      status = v;
    },
    status: (v: number) => {
      status = v;
      return res;
    },
  };
  const base = {
    params: { movieId: '15' },
    user: { id: 1 },
    body: { text: '', rating: 4.5, spoiler: false },
  };
  for (const mediaType of ['movie', 'tv'])
    await routes.get('put /mine/:movieId')(
      { ...base, query: { mediaType } },
      res
    );
  assert.equal(status, 200);
  assert.deepEqual(metadata, ['movie', 'tv']);
  assert.equal(rows.size, 2);
  assert.equal(rows.get('local:1:15').mediaType, 'movie');
  assert.equal(rows.get('local:1:tv:15').mediaType, 'tv');
  await routes.get('get /mine/:movieId')(
    { ...base, query: { mediaType: 'tv' } },
    res
  );
  assert.equal(result.review.rating, 4.5);
  assert.equal(result.review.text, '');
  await routes.get('delete /mine/:movieId')(
    { ...base, query: { mediaType: 'tv' } },
    res
  );
  assert.equal(rows.size, 1);
  assert.ok(rows.has('local:1:15'));
  await routes.get('get /mine/:movieId')(
    { ...base, user: { id: 2 }, query: { mediaType: 'movie' } },
    res
  );
  assert.equal(result.review, null);
  status=200;
  latestViewing={id:'playback-session:one',date:'2026-11-04',source:'catalogue',entryId:null,inProgress:true};
  await routes.get('put /mine/:movieId')({...base,query:{mediaType:'movie'},body:{...base.body,viewingId:latestViewing.id}},res);
  assert.equal(status,200);
  assert.equal(rows.get('local:1:15').viewingEventId,'playback-session:one');
  assert.equal(rows.get('local:1:15').watchedDate,'2026-11-04');
  // Completion arriving between opening and saving retains the exact session.
  latestViewing={...latestViewing,id:'tautulli:completed',sessionId:'playback-session:one'};
  await routes.get('put /mine/:movieId')({...base,query:{mediaType:'movie'},body:{...base.body,viewingId:'playback-session:one'}},res);
  assert.equal(status,200);
  assert.equal(rows.get('local:1:15').viewingEventId,'tautulli:completed');
});
