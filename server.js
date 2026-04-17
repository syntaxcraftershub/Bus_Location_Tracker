require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const path = require('path');
const cors = require('cors');

const gpsService = require('./services/gps');
const { calculateETAs } = require('./services/eta');
const subscriptionService = require('./services/subscriptions');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./routes/api'));

// Redirect root to tracker
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bus-tracker.html'));
});

// ─── WebSocket clients ───────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Frontend client connected');

  // Send current full state
  ws.send(JSON.stringify({
    type: 'FULL_STATE',
    buses: gpsService.getAllBuses(),
    mode: gpsService.getMode(),
    timestamp: Date.now(),
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'SUBSCRIBE_STOP') {
        subscriptionService.subscribeWebSocket(ws, msg.stopId, msg.routeId);
        console.log(`WS subscription: stop=${msg.stopId} route=${msg.routeId||'any'}`);
      }
    } catch(e) {}
  });

  ws.on('error', () => {});
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ─── GPS position updates → broadcast + check alerts ────────────
gpsService.on('position', (busId, position) => {
  const etas = calculateETAs(busId, position);

  broadcast({ type: 'BUS_UPDATE', busId, position, etas, timestamp: Date.now() });
  subscriptionService.checkAndNotify(busId, position, etas);
});

// ─── MQTT bridge — SIM7600 / Neo-6M GPS devices ─────────────────
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const mqttOptions = {};
if (process.env.MQTT_USERNAME) mqttOptions.username = process.env.MQTT_USERNAME;
if (process.env.MQTT_PASSWORD) mqttOptions.password = process.env.MQTT_PASSWORD;

const mqttClient = mqtt.connect(MQTT_BROKER, {
  ...mqttOptions,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
});

mqttClient.on('connect', () => {
  console.log(`MQTT connected to ${MQTT_BROKER}`);
  // Subscribe to GPS updates from all buses
  // Expected topic: buses/{busId}/gps
  // Payload: {"lat":11.0168,"lng":76.9758,"speed":35.2,"heading":45.0,"accuracy":8}
  mqttClient.subscribe('buses/+/gps', (err) => {
    if (err) console.error('MQTT subscribe error:', err.message);
    else console.log('Subscribed to buses/+/gps');
  });
});

mqttClient.on('message', (topic, payload) => {
  try {
    const parts = topic.split('/');
    if (parts[0] !== 'buses' || parts[2] !== 'gps') return;
    const busId = parts[1];
    const data = JSON.parse(payload.toString());
    gpsService.updateFromMQTT(busId, data);
  } catch(e) {
    console.error('MQTT message parse error:', e.message);
  }
});

mqttClient.on('error', (err) => {
  // Non-fatal — system works in simulation mode without MQTT
  if (err.code !== 'ECONNREFUSED') console.warn('MQTT error:', err.message);
});

// ─── Broadcast mode updates every 10s ───────────────────────────
setInterval(() => {
  broadcast({
    type: 'MODE_UPDATE',
    mode: gpsService.getMode(),
    timestamp: Date.now(),
  });
}, 10000);

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║        CityBus Live — Coimbatore         ║
║  http://localhost:${PORT}                   ║
║  WebSocket: ws://localhost:${PORT}           ║
║  MQTT: ${MQTT_BROKER.padEnd(32)}  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
