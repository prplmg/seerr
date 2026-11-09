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

it('accepts the exact receipt-reconciliation payload emitted by the real Python client', async () => {
 const {execFileSync}=await import('node:child_process');
 const path=await import('node:path');
 const python=`import tempfile,pathlib,sys,json,time
sys.path.insert(0,sys.argv[1])
from queue_store import Queue,INSTANCE
from catalogue_client import CatalogueClient
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);q=Queue(root/'queue.sqlite');config=root/'catalogue.json'
 config.write_text(json.dumps({'token':'test','instances':[INSTANCE],'accounts':{INSTANCE:'prplmg'}}))
 ident='33865693-277a-47b2-b291-27ef100ba1b3'
 with q.db:
  q.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?)',(ident,INSTANCE,'media_write','unknown',time.time(),time.time(),'{}'))
  q.db.execute('INSERT INTO write_payloads VALUES(?,?)',(ident,json.dumps({'account':'prplmg','film':'jaws','kind':'diary'})))
 client=CatalogueClient(q,config)
 client.request=lambda token,payload,**kwargs: (print(json.dumps(payload)),{'action':'idle','reconciled':[]})[1]
 client.reconcile_writes(INSTANCE,'prplmg',json.loads(config.read_text()))
`;
 const payload=JSON.parse(execFileSync('python3',['-c',python,path.resolve('tools/letterboxd-weekly')],{encoding:'utf8'}));
 const validator=await import('express-openapi-validator');const app=express();installLetterboxdBodyParsers(app);
 app.use(validator.middleware({apiSpec:'seerr-api.yml',validateRequests:true,validateResponses:false,validateSecurity:false}));
 app.post('/api/v1/letterboxd-worker/writes',(_req,res)=>res.json({action:'idle'}));
 await request(app).post('/api/v1/letterboxd-worker/writes').send(payload).expect(200);
 await request(app).post('/api/v1/letterboxd-worker/writes').send({...payload,reconcileIds:Array(11).fill(payload.reconcileIds[0])}).expect(400);
});
