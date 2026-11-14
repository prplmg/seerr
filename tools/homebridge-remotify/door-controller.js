'use strict';
const fs = require('node:fs');
const { RemotifyClient, readCredentials } = require('./client');
const controllers = new Map();
// HAP CurrentDoorState: open=0, closed=1, opening=2, closing=3, stopped=4.
class DoorController {
  constructor(config, deps = {}) {
    this.client = deps.client || new RemotifyClient(readCredentials(config.credentialsFile));
    this.now = deps.now || Date.now;
    this.schedule = deps.schedule || setTimeout;
    this.cancel = deps.cancel || clearTimeout;
    this.deviceId = config.deviceId;
    this.openMs = Number(config.openSeconds ?? config.travelSeconds) * 1000;
    this.closeMs = Number(config.closeSeconds ?? config.travelSeconds) * 1000;
    if (![this.openMs, this.closeMs].every(ms => ms >= 3000 && ms <= 180000)) throw Error('Set openSeconds and closeSeconds (3–180 seconds)');
    this.file = config.stateFile;
    this.listeners = new Set();
    this.busy = false; this.lastPress = -Infinity; this.timer = null;
    this.position = config.initialState === 'open' ? 1 : 0;
    this.current = this.position ? 0 : 1;
    this.target = this.current;
    this.lastDirection = this.position ? 1 : -1;
    this.uncertain = !['open', 'closed'].includes(config.initialState);
    if (this.file && fs.existsSync(this.file)) {
      // Anything could have moved while offline. Require a fresh position correction.
      try {
        const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Number.isFinite(state.position)) this.position = Math.max(0, Math.min(1, state.position));
        this.lastDirection = state.lastDirection === 1 ? 1 : -1;
      } catch (_) { /* invalid persisted state remains uncertain */ }
      this.current = 4; this.uncertain = true;
    }
  }
  subscribe(fn) { this.listeners.add(fn); fn(this); return () => this.listeners.delete(fn); }
  publish() {
    if (this.file) {
      try {
        fs.writeFileSync(this.file + '.tmp', JSON.stringify({ position: this.position, lastDirection: this.lastDirection }), { mode: 0o600 });
        fs.renameSync(this.file + '.tmp', this.file);
      } catch (_) { this.uncertain = true; }
    }
    for (const fn of this.listeners) fn(this);
  }
  sample() {
    if (this.current !== 2 && this.current !== 3) return;
    this.position = Math.max(0, Math.min(1, this.startPosition + this.lastDirection * (this.now() - this.startedAt) / (this.lastDirection === 1 ? this.openMs : this.closeMs)));
  }
  clearTimer() { if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
  correct(open) {
    if (this.busy) throw Error('Wait for the current request to finish');
    this.clearTimer(); this.position = open ? 1 : 0; this.current = open ? 0 : 1;
    this.target = this.current; this.lastDirection = open ? 1 : -1; this.uncertain = false; this.publish();
  }
  async setTarget(target) {
    if (target !== 0 && target !== 1) throw Error('Invalid door target');
    if (this.uncertain) throw Error('Correct the estimated garage position first');
    if (this.busy) throw Error('Garage command already in progress');
    if (this.current === target || (this.current === 2 && target === 0) || (this.current === 3 && target === 1)) return;
    // Do not synthesize unattended stop/reverse sequences from unverified closing behavior.
    if (this.current === 2 || this.current === 3) throw Error('Use Garage remote to interrupt movement, then correct position if needed');
    if (this.current === 4 && (target === 0 ? 1 : -1) !== -this.lastDirection) throw Error('Next press would move in the opposite direction; use Garage remote');
    await this.press();
  }
  async press() {
    if (this.busy || this.now() - this.lastPress < 1500) throw Error('Wait 1.5 seconds between garage presses');
    this.busy = true;
    try {
      const result = await this.client.devices();
      const device = result.devices?.find(d => String(d.id) === String(this.deviceId));
      if (!result.client_enabled || !device?.enabled) throw Error('Garage unavailable');
      this.lastPress = this.now();
      try {
        await this.client.request('access', 'POST', { device_id: device.id });
      } catch (_) {
        this.sample(); this.clearTimer(); this.current = 4; this.uncertain = true; this.publish();
        throw Error('Garage request outcome uncertain; no retry. Correct position before Open/Close');
      }
      this.sample(); this.clearTimer();
      if (this.uncertain) { this.current = 4; this.publish(); return; }
      if (this.current === 2 || this.current === 3) {
        // Closing may reverse on this motor. Do not assert a stopped position in that case.
        if (this.current === 3) this.uncertain = true;
        this.current = 4;
      } else {
        this.lastDirection = this.current === 1 ? 1 : this.current === 0 ? -1 : -this.lastDirection;
        this.current = this.lastDirection === 1 ? 2 : 3;
        this.target = this.lastDirection === 1 ? 0 : 1;
        this.startedAt = this.now(); this.startPosition = this.position;
        const remaining = this.lastDirection === 1 ? 1 - this.position : this.position;
        this.timer = this.schedule(() => {
          this.timer = null; this.position = this.lastDirection === 1 ? 1 : 0;
          this.current = this.target; this.publish();
        }, Math.max(1, remaining * (this.lastDirection === 1 ? this.openMs : this.closeMs)));
        this.timer?.unref?.();
      }
      this.publish();
    } finally { this.busy = false; }
  }
}
function controllerFor(config) {
  const key = `${config.credentialsFile}:${config.deviceId}`;
  if (!controllers.has(key)) controllers.set(key, new DoorController(config));
  return controllers.get(key);
}
module.exports = { DoorController, controllerFor };
