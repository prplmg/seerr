'use strict';
const {RemotifyClient, readCredentials} = require('./client');
class GarageRemote {
  constructor(log, config, api) {
    this.log = log; this.api = api; this.name = config.name || 'Garage remote';
    this.deviceId = config.deviceId; this.busy = false; this.cooldownUntil = 0;
    this.controller = config.estimatedDoor ? require('./door-controller').controllerFor(config) : null;
    this.client = this.controller ? null : new RemotifyClient(readCredentials(config.credentialsFile));
    if (this.deviceId === undefined) throw new Error('Remotify deviceId is required');
    this.info = new api.hap.Service.AccessoryInformation()
      .setCharacteristic(api.hap.Characteristic.Manufacturer, 'Remotify')
      .setCharacteristic(api.hap.Characteristic.Model, 'Momentary remote')
      .setCharacteristic(api.hap.Characteristic.SerialNumber, `remotify-${this.deviceId}`);
    this.switch = new api.hap.Service.Switch(this.name);
    this.switch.getCharacteristic(api.hap.Characteristic.On)
      .onGet(() => this.busy).onSet(value => this.press(value));
    // No network calls or activation on startup, GET, reset, or shutdown.
  }
  async press(value) {
    if (!value) return;
    if (this.busy || Date.now() < this.cooldownUntil) throw new Error('Remote is already processing a press');
    this.busy = true;
    try {
      if (this.controller) await this.controller.press();
      else await this.client.activate(this.deviceId);
      this.log.info('Garage remote activation acknowledged');
    } catch (_) {
      this.log.error('Garage remote request failed; not retried. Check the gate before pressing again.');
      throw new Error('Remote request failed; outcome may be uncertain');
    } finally {
      this.cooldownUntil = this.controller ? 0 : Date.now() + 2000;
      setTimeout(() => {
        this.busy = false;
        this.switch.updateCharacteristic(this.api.hap.Characteristic.On, false);
      }, this.controller ? 100 : 1000).unref();
    }
  }
  getServices() { return [this.info, this.switch]; }
}
module.exports = api => {
  api.registerAccessory('homebridge-remotify-remote', 'RemotifyRemote', GarageRemote);
  api.registerAccessory('homebridge-remotify-remote', 'RemotifyGarageDoor', require('./garage-door').GarageDoor);
  api.registerAccessory('homebridge-remotify-remote', 'RemotifyGarageCorrection', require('./garage-door').GarageCorrection);
};
module.exports.GarageRemote = GarageRemote;
