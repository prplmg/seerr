'use strict';
const { controllerFor } = require('./door-controller');
class GarageDoor {
  constructor(log, config, api) {
    const { Service, Characteristic: C, HapStatusError, HAPStatus } = api.hap;
    this.controller = controllerFor(config);
    this.info = new Service.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Remotify')
      .setCharacteristic(C.Model, 'Estimated garage door')
      .setCharacteristic(C.SerialNumber, `remotify-door-${config.deviceId}`);
    this.door = new Service.GarageDoorOpener(config.name || 'Garage door');
    this.door.getCharacteristic(C.CurrentDoorState).onGet(() => {
      if (this.controller.uncertain) throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return this.controller.current;
    });
    this.door.getCharacteristic(C.TargetDoorState)
      .onGet(() => this.controller.target).onSet(value => this.controller.setTarget(value));
    // No obstruction sensor is connected; never claim a measured sensor reading.
    this.door.getCharacteristic(C.ObstructionDetected).onGet(() => false);
    const correction = (name, open) => {
      const service = new Service.Switch(name, open ? 'correct-open' : 'correct-closed');
      service.getCharacteristic(C.On).onGet(() => false).onSet(value => {
        if (!value) return;
        this.controller.correct(open);
        setTimeout(() => service.updateCharacteristic(C.On, false), 100).unref();
      });
      return service;
    };
    this.services = [this.info, this.door,
      correction('Garage Mark open', true), correction('Garage Mark closed', false)];
    this.door.setPrimaryService(true);
    this.unsubscribe = this.controller.subscribe(state => {
      this.door.updateCharacteristic(C.CurrentDoorState, state.uncertain
        ? new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE) : state.current);
      this.door.updateCharacteristic(C.TargetDoorState, state.target);
    });
    api.on('shutdown', () => { this.unsubscribe(); this.controller.clearTimer(); });
    log.info('Garage door uses estimated position; Mark open/closed corrects state without activation');
  }
  getServices() { return this.services; }
}
module.exports = { GarageDoor };
