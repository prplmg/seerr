import TheMovieDb from '@server/api/themoviedb';
import { listLoginDestination } from '@server/interfaces/api/listShare';
import * as store from '@server/lib/discoveryLists';
import {
  listPreview,
  listPreviewHtml,
  listPreviewImage,
} from '@server/lib/listSharePreview';
import axios from 'axios';
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import router from './listShare';
const id = 'catalogue-11111111-1111-1111-1111-111111111111';
const fixture = (): store.ListStore => ({
  version: 1,
  saved: {},
  liked: {},
  availability: {},
  lists: [
    {
      id,
      title: 'Late-night science fiction',
      description: 'Not exposed',
      creator: 'prplmg',
      source: 'catalogue',
      visibility: 'public',
      ownerId: 1,
      checkedAt: 123,
      history: [],
      items: [
        { type: 'movie', tmdbId: 1 },
        { type: 'movie', tmdbId: 2 },
      ],
    },
  ],
});
it('public previews escape metadata; private/deleted lists and login targets stay protected', () => {
  const s = fixture();
  s.lists[0].title = '<script>alert("x")</script>';
  assert(!listPreviewHtml(listPreview(s, id)!).includes('<script>'));
  s.lists[0].visibility = 'private';
  const p = listPreview(s, id)!;
  assert.equal(p.films.length, 0);
  assert(!JSON.stringify(p).includes('prplmg'));
  assert(!JSON.stringify(p).includes('alert'));
  s.lists[0].deletedAt = 10;
  assert.equal(listPreview(s, id), null);
  assert.equal(listLoginDestination('/lists/' + id), '/lists/' + id);
  for (const value of [
    'https://evil.com',
    '//evil.com',
    '/lists/' + id + '?next=https://evil.com',
    '/settings',
    undefined,
  ])
    assert.equal(listLoginDestination(value), '/');
});
it('anonymous HTML and PNG, signed-in redirect, current privacy, cached image and local preview artifacts', async (t) => {
  const s = fixture();
  t.mock.method(store, 'readListStore', () => s);
  let metadataReads = 0,
    imageReads = 0;
  t.mock.method(
    TheMovieDb.prototype as unknown as { get: (url: string) => unknown },
    'get',
    async (url: string) => {
      const id = Number(url.split('/').pop());
      metadataReads++;
      return { id, title: 'Mock', poster_path: `/${id}.jpg` };
    }
  );
  t.mock.method(axios, 'get', async () => {
    imageReads++;
    return {
      data: process.env.LIST_PREVIEW_ARTIFACTS
        ? fs.readFileSync(
            path.resolve(
              '../outputs/find-to-watch-20261108',
              imageReads % 2 ? 'arrival.jpg' : 'moon.jpg'
            )
          )
        : await sharp({
            create: {
              width: 228,
              height: 342,
              channels: 3,
              background: '#786594',
            },
          })
            .png()
            .toBuffer(),
    };
  });
  const app = express();
  app.use((req, _res, next) => {
    if (req.header('test-user')) req.user = { id: 2 } as typeof req.user;
    next();
  });
  app.use('/share/lists', router);
  const url = '/share/lists/' + id;
  const page = await request(app).get(url).set('Host', 'untrusted.example');
  assert.equal(page.status, 200);
  assert.match(page.text, /og:image/);
  assert.match(page.text, /Late-night science fiction/);
  assert.match(page.text, /catalogue.prpl.com.mx/);
  assert(!page.text.includes('untrusted.example'));
  assert.match(page.text, /next=%2Flists%2Fcatalogue-/);
  assert.match(page.headers['cache-control'], /no-store/);
  const signed = await request(app).get(url).set('test-user', '2');
  assert.equal(signed.status, 307);
  assert.equal(signed.headers.location, '/lists/' + id);
  const image = await listPreviewImage(listPreview(s, id)!);
  assert.equal((await sharp(image).metadata()).width, 1200);
  assert.equal(metadataReads, 2);
  await listPreviewImage(listPreview(s, id)!);
  assert.equal(metadataReads, 2);
  const out = process.env.LIST_PREVIEW_ARTIFACTS;
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'public.png'), image);
    fs.writeFileSync(
      path.join(out, 'public.html'),
      page.text.replaceAll(`${url}/image?v=123`, '/public.png')
    );
  }
  s.lists[0].visibility = 'private';
  s.lists[0].checkedAt++;
  const privatePage = await request(app).get(url);
  assert(!privatePage.text.includes('prplmg'));
  assert(!privatePage.text.includes('science fiction'));
  assert(!privatePage.text.includes('2 movies'));
  const privateImage = await request(app).get(url + '/image?v=123');
  assert.equal(privateImage.status, 200);
  assert.equal(metadataReads, 2);
  assert.equal(imageReads, 2);
  if (out) {
    fs.writeFileSync(path.join(out, 'private.png'), privateImage.body);
    fs.writeFileSync(
      path.join(out, 'private.html'),
      privatePage.text.replaceAll(`${url}/image?v=124`, '/private.png')
    );
  }
  s.lists[0].deletedAt = 555;
  assert.equal((await request(app).get(url)).status, 404);
  assert.equal((await request(app).get(url + '/image')).status, 404);
});

it('changing public visibility during image generation never returns the old collage', async (t) => {
  const s = fixture();
  s.lists[0].id += '-race';
  t.mock.method(store, 'readListStore', () => s);
  t.mock.method(
    TheMovieDb.prototype as unknown as { get: (url: string) => unknown },
    'get',
    async () => {
      s.lists[0].visibility = 'private';
      s.lists[0].checkedAt++;
      return { id: 1, poster_path: null };
    }
  );
  const app = express();
  app.use('/share/lists', router);
  const result = await request(app).get(
    '/share/lists/' + s.lists[0].id + '/image'
  );
  assert.equal(result.status, 409);
  assert(!result.headers['content-type'].includes('image'));
});
