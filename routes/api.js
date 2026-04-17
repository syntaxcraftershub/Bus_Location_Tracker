const router = require('express').Router();
const gpsService = require('../services/gps');
const { calculateETAs, getArrivalsAtStop } = require('../services/eta');
const subscriptionService = require('../services/subscriptions');
const ROUTES = require('../data/routes');

// GET /api/status
router.get('/status', (req, res) => {
  res.json({
    mode: gpsService.getMode(),
    activeBuses: Object.keys(gpsService.getAllBuses()).length,
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
  });
});

// GET /api/buses  — all bus positions + ETAs
router.get('/buses', (req, res) => {
  const buses = gpsService.getAllBuses();
  const result = {};
  Object.entries(buses).forEach(([busId, state]) => {
    result[busId] = {
      ...state,
      etas: calculateETAs(busId, state),
    };
  });
  res.json({ buses: result, mode: gpsService.getMode(), timestamp: Date.now() });
});

// GET /api/buses/:busId
router.get('/buses/:busId', (req, res) => {
  const state = gpsService.getBus(req.params.busId);
  if (!state) return res.status(404).json({ error: 'Bus not found' });
  res.json({ ...state, etas: calculateETAs(req.params.busId, state) });
});

// GET /api/stops/:stopId/arrivals — next buses at a stop
router.get('/stops/:stopId/arrivals', (req, res) => {
  const buses = gpsService.getAllBuses();
  const arrivals = getArrivalsAtStop(req.params.stopId, buses);
  res.json({ stopId: req.params.stopId, arrivals, timestamp: Date.now() });
});

// GET /api/routes
router.get('/routes', (req, res) => {
  res.json(ROUTES);
});

// POST /api/subscribe
router.post('/subscribe', (req, res) => {
  const { phone, stopId, routeId, channel } = req.body;

  if (!phone || !stopId) {
    return res.status(400).json({ error: 'phone and stopId are required' });
  }
  if (!/^\+?[\d\s\-().]{7,16}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  const stopExists = ROUTES.some(rt => rt.stops.some(s => s.sid === stopId));
  if (!stopExists) {
    return res.status(400).json({ error: 'Unknown stopId' });
  }

  subscriptionService.subscribe(phone, stopId, routeId || null, channel || 'sms');
  res.json({ success: true, message: `Subscribed to alerts for stop ${stopId}` });
});

// DELETE /api/subscribe
router.delete('/subscribe', (req, res) => {
  const { phone, stopId } = req.body;
  if (!phone || !stopId) return res.status(400).json({ error: 'phone and stopId required' });
  subscriptionService.unsubscribe(phone, stopId);
  res.json({ success: true });
});

// GET /api/subscriptions (admin view)
router.get('/subscriptions', (req, res) => {
  res.json(subscriptionService.getAll());
});

module.exports = router;
