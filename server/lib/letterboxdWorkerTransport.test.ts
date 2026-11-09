import express from 'express';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import request from 'supertest';
import { installLetterboxdBodyParsers } from './letterboxdWorkerTransport';
it('accepts retained 120KB list envelopes through actual HTTP parser, keeping a finite ceiling', async () => {
  const app = express();
  installLetterboxdBodyParsers(app);
  app.use(express.json());
  app.post('/api/v1/letterboxd-worker/lists', (req, res) =>
    res.json({ length: req.body.report.snapshot.description.length })
  );
  const result = await request(app)
    .post('/api/v1/letterboxd-worker/lists')
    .send({
      version: 1,
      report: { snapshot: { description: 'x'.repeat(120399) } },
    });
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 120399);
  const oversized = await request(app)
    .post('/api/v1/letterboxd-worker/lists')
    .send({
      report: { snapshot: { description: 'x'.repeat(16 * 1024 * 1024) } },
    });
  assert.equal(oversized.status, 413);
});

it('accepts negotiated capabilities through the real OpenAPI request schema', async () => {
 const validator=await import('express-openapi-validator');
 const app=express();installLetterboxdBodyParsers(app);
 app.use(validator.middleware({apiSpec:'seerr-api.yml',validateRequests:true,validateResponses:false,validateSecurity:false}));
 app.post('/api/v1/letterboxd-worker/writes',(_req,res)=>res.json({action:'idle'}));
 await request(app).post('/api/v1/letterboxd-worker/writes').send({version:1,instance:'7cb664cd-13ca-4d8e-ae8a-c3882547643c',supported:['rating','review','watched','diary','diary-content','subject-holds'],durableDelivery:1}).expect(200);
});
