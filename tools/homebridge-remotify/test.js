const {test} = require('node:test');
const assert = require('node:assert/strict');
const {RemotifyClient} = require('./client');
const {GarageRemote} = require('./index');
const credentials = {tenant:'test',email:'test@example.invalid',password:'test'};
function harness(handler) {
  const calls=[];
  const client = new RemotifyClient(credentials,async (url,options)=>{
    const path=url.split('/').pop();calls.push({path,...options});
    return handler(path,options,calls);
  });return {client,calls};
}
const response = (data,status=200,headers={}) => new Response(data===null?null:JSON.stringify(data),{status,headers});
test('read-only discovery authenticates without activation; forwards cookies and CSRF',async()=>{
  const {client,calls}=harness((path,opts)=>{
    if(path==='csrf-cookie')return response(null,204,{'Set-Cookie':'XSRF-TOKEN=abc%3D; Path=/; Secure'});
    if(path==='login'){assert.equal(opts.headers['X-XSRF-TOKEN'],'abc=');return response({});}
    return response({devices:[{id:1,enabled:true}],client_enabled:true});
  });await client.devices();assert.deepEqual(calls.map(c=>c.path),['csrf-cookie','login','devices']);
});
test('activation failure is never retried',async()=>{
  const {client,calls}=harness(path=>{
    if(path==='access')throw Error('timeout');
    return response(path==='devices'?{client_enabled:true,devices:[{id:1,enabled:true}]}:{});
  });await assert.rejects(client.activate(1));assert.equal(calls.filter(c=>c.path==='access').length,1);
});
test('unavailable device cannot be activated',async()=>{
  const {client,calls}=harness(path=>response(path==='devices'?{client_enabled:true,devices:[{id:1,enabled:false}]}:{}));
  await assert.rejects(client.activate(1));assert.equal(calls.some(c=>c.path==='access'),false);
});
test('expired session reauthenticates before activation, never retries activation',async()=>{
  let reads=0;const {client,calls}=harness(path=>{
    if(path==='devices'&&reads++===0)return response({},401);
    if(path==='devices')return response({client_enabled:true,devices:[{id:1,enabled:true}]});
    return response({});
  });client.loggedIn=true;await client.activate(1);assert.equal(calls.filter(c=>c.path==='access').length,1);
  assert.equal(calls.filter(c=>c.path==='login').length,1);
});
test('off does nothing; duplicate press blocked; reset is local only',async()=>{
  let activations=0, reset;
  const fake={busy:false,cooldownUntil:0,deviceId:1,client:{activate:async()=>{activations++;}},log:{info(){},error(){}},api:{hap:{Characteristic:{On:'On'}}},switch:{updateCharacteristic:(key,value)=>{reset=value;}}};
  await GarageRemote.prototype.press.call(fake,false);assert.equal(activations,0);
  await GarageRemote.prototype.press.call(fake,true);
  await assert.rejects(GarageRemote.prototype.press.call(fake,true));
  await new Promise(r=>setTimeout(r,1100));assert.equal(reset,false);assert.equal(activations,1);
});
