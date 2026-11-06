const assert=require('node:assert/strict');
const express=require('express');
const validator=require('express-openapi-validator');
const request=require('supertest');
const path=require('node:path');
(async()=>{
const app=express();app.use(validator.middleware({apiSpec:path.resolve('seerr-api.yml'),validateRequests:true,validateSecurity:false}));
app.get('/api/v1/discovery-lists/media/:type/:id',(req,res)=>res.json({type:req.params.type,id:Number(req.params.id),results:[]}));
app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
for(const type of ['movie','tv']){const r=await request(app).get('/api/v1/discovery-lists/media/'+type+'/843');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.id,843);}
for(const url of ['movie/invalid','movie/0','invalid/843']){const r=await request(app).get('/api/v1/discovery-lists/media/'+url);assert.equal(r.status,400);}
console.log('PASS actual OpenAPI middleware: movie/series dispatch; invalid IDs/types rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
