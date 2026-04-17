require('dotenv').config();

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('Twilio SMS/WhatsApp client initialized');
  } catch(e) {
    console.warn('Twilio not available:', e.message);
  }
}

const THRESHOLD = parseInt(process.env.ALERT_THRESHOLD_MINUTES || '5', 10);

class SubscriptionService {
  constructor() {
    this.subs = new Map();   // stopId -> [{ phone, routeId, channel, subId }]
    this.notified = new Set(); // "busId:stopId" already notified (30-min cooldown)
  }

  subscribe(phone, stopId, routeId, channel = 'sms') {
    if (!this.subs.has(stopId)) this.subs.set(stopId, []);
    const list = this.subs.get(stopId);

    // Deduplicate by phone+stopId
    const exists = list.find(s => s.phone === phone && s.routeId === (routeId||null));
    if (!exists) {
      list.push({ phone, stopId, routeId: routeId||null, channel, subId: `${phone}:${stopId}` });
    }
    return { success: true };
  }

  unsubscribe(phone, stopId) {
    if (!this.subs.has(stopId)) return;
    this.subs.set(stopId, this.subs.get(stopId).filter(s => s.phone !== phone));
  }

  subscribeWebSocket(ws, stopId, routeId) {
    // Track WS clients for push notification (in-browser)
    if (!this.subs.has(stopId)) this.subs.set(stopId, []);
    const list = this.subs.get(stopId);
    list.push({ ws, stopId, routeId: routeId||null, channel: 'websocket', subId: `ws:${stopId}:${Date.now()}` });
    ws.on('close', () => {
      this.subs.set(stopId, (this.subs.get(stopId)||[]).filter(s => s.ws !== ws));
    });
  }

  async checkAndNotify(busId, position, etas) {
    for (const [stopId, eta] of Object.entries(etas)) {
      if (eta.minutes > THRESHOLD || eta.minutes < 0) continue;

      const key = `${busId}:${stopId}`;
      if (this.notified.has(key)) continue;

      const subs = (this.subs.get(stopId) || []).filter(
        s => !s.routeId || s.routeId === eta.routeId
      );
      if (!subs.length) continue;

      this.notified.add(key);
      setTimeout(() => this.notified.delete(key), 30 * 60 * 1000);

      for (const sub of subs) {
        await this._send(sub, busId, eta).catch(err =>
          console.error('Alert send failed:', err.message)
        );
      }
    }
  }

  async _send(sub, busId, eta) {
    const text = `🚌 CityBus Alert: Bus ${busId} (Route ${eta.routeNum}) arrives at ${eta.stopName} in ~${eta.minutes} min (${eta.arrivalTime}). Reply STOP to unsubscribe.`;

    if (sub.channel === 'websocket' && sub.ws) {
      const { WebSocket } = require('ws');
      if (sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(JSON.stringify({ type:'ALERT', text }));
      }
      return;
    }

    if (!twilioClient) {
      console.log(`[SMS Mock] → ${sub.phone}: ${text}`);
      return;
    }

    const from = sub.channel === 'whatsapp'
      ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`
      : process.env.TWILIO_FROM_NUMBER;
    const to = sub.channel === 'whatsapp' ? `whatsapp:${sub.phone}` : sub.phone;

    await twilioClient.messages.create({ body: text, from, to });
    console.log(`Alert sent to ${sub.phone} [${sub.channel}] for stop ${eta.stopName}`);
  }

  getAll() {
    const result = {};
    this.subs.forEach((list, stopId) => {
      result[stopId] = list.filter(s => s.channel !== 'websocket');
    });
    return result;
  }
}

module.exports = new SubscriptionService();
