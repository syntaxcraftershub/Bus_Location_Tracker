const ROUTES = require('../data/routes');

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Calculate ETA from a bus's current position to each upcoming stop.
 * Returns a map of stopId -> { minutes, arrivalTime, busId, routeId }
 */
function calculateETAs(busId, busState) {
  const { lat, lng, spd, route: routeId, nsi } = busState;
  const rt = ROUTES.find(r => r.id === routeId);
  if (!rt || nsi === undefined) return {};

  const etas = {};
  const speed = Math.max(spd || 20, 5);
  const stopIdx = nsi;

  let cumKm = haversine(lat, lng, rt.stops[stopIdx].lat, rt.stops[stopIdx].lng);

  for (let i = stopIdx; i < rt.stops.length; i++) {
    if (i > stopIdx) {
      cumKm += haversine(rt.stops[i-1].lat, rt.stops[i-1].lng, rt.stops[i].lat, rt.stops[i].lng);
    }
    const etaMin = Math.round((cumKm / speed) * 60);
    etas[rt.stops[i].sid] = {
      minutes: etaMin,
      arrivalTime: new Date(Date.now() + etaMin * 60 * 1000)
        .toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      busId,
      routeId,
      routeNum: rt.num,
      stopName: rt.stops[i].name,
    };
  }

  return etas;
}

/**
 * Get all upcoming arrivals at a specific stop, sorted by ETA.
 */
function getArrivalsAtStop(stopId, allBusStates) {
  const arrivals = [];

  Object.entries(allBusStates).forEach(([busId, state]) => {
    const etas = calculateETAs(busId, state);
    if (etas[stopId]) {
      arrivals.push({ busId, ...etas[stopId] });
    }
  });

  return arrivals.sort((a, b) => a.minutes - b.minutes).slice(0, 8);
}

module.exports = { calculateETAs, getArrivalsAtStop, haversine };
