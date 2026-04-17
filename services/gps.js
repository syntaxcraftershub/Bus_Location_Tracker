const EventEmitter = require('events');

class GPSService extends EventEmitter {
  constructor() {
    super();
    this.buses = new Map();
    this.mode = 'simulation';
    this.lastLiveUpdate = null;
  }

  updateFromMQTT(busId, data) {
    this.mode = 'live';
    this.lastLiveUpdate = Date.now();

    const position = {
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lng),
      spd: parseFloat(data.speed) || 0,
      hdg: parseFloat(data.heading) || 0,
      accuracy: parseFloat(data.accuracy) || 10,
      timestamp: data.timestamp || Date.now(),
      gpsSource: true,
    };

    if (isNaN(position.lat) || isNaN(position.lng)) return;

    const prev = this.buses.get(busId) || {};
    this.buses.set(busId, { ...prev, ...position, id: busId });
    this.emit('position', busId, this.buses.get(busId));
  }

  updateFromSimulation(busId, data) {
    if (this.mode === 'live') return;
    const prev = this.buses.get(busId) || {};
    this.buses.set(busId, { ...prev, ...data, gpsSource: false });
  }

  getMode() {
    // Fall back to simulation if no live update in 30s
    if (this.mode === 'live' && this.lastLiveUpdate && Date.now() - this.lastLiveUpdate > 30000) {
      this.mode = 'simulation';
    }
    return this.mode;
  }

  getAllBuses() {
    return Object.fromEntries(this.buses);
  }

  getBus(busId) {
    return this.buses.get(busId);
  }
}

module.exports = new GPSService();
