'use strict';
const fs = require('node:fs');
class RemotifyClient {
  constructor(credentials, fetcher = globalThis.fetch) {
    this.credentials = credentials;
    this.fetch = fetcher;
    this.cookies = new Map();
    this.loggedIn = false;
  }
  async request(path, method = 'GET', data) {
    const headers = { Accept: 'application/json', Tenant: this.credentials.tenant,
      Origin: 'https://app.remotify.mx', Referer: 'https://app.remotify.mx/' };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k,v]) => `${k}=${v}`).join('; ');
    const csrf = this.cookies.get('XSRF-TOKEN');
    if (csrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(csrf);
    if (data) headers['Content-Type'] = 'application/json';
    const res = await this.fetch(`https://remotify.mx/api/${path}`, {
      method, headers, body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const at = pair.indexOf('=');
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 419) this.loggedIn = false;
      throw new Error(`Remotify ${path} returned HTTP ${res.status}`);
    }
    if (res.status === 204) return {};
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
  async login() {
    await this.request('csrf-cookie');
    await this.request('login', 'POST', {email:this.credentials.email,password:this.credentials.password});
    this.loggedIn = true;
  }
  async devices() {
    if (!this.loggedIn) await this.login();
    try { return await this.request('devices'); }
    catch (e) {
      if (this.loggedIn) throw e;
      await this.login(); return this.request('devices');
    }
  }
  async activate(deviceId) {
    const result = await this.devices();
    const device = result.devices?.find(d => String(d.id) === String(deviceId));
    if (!result.client_enabled || !device?.enabled) throw new Error('Remotify device is unavailable');
    // Deliberately never retry: a timeout may mean the physical pulse already happened.
    await this.request('access', 'POST', {device_id: device.id});
  }
}
function readCredentials(path) {
  const c = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!c.tenant || !c.email || !c.password) throw new Error('Missing Remotify login fields');
  return c;
}
module.exports = {RemotifyClient, readCredentials};
