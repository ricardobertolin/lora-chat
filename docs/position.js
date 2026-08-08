// Position sharing, done entirely in the app so the firmware stays a dumb pipe.
//
// A position is just a chat message with a marker prefix:
//   !POS -23.550520 -46.633308 12
// which the board relays like any other text. The receiving app recognises the
// prefix and renders a peer update instead of a chat bubble. No firmware change,
// so nothing has to be reflashed.

export const POS_PREFIX = '!POS';

// Above this the fix is not worth plotting. Desktop browsers with no GPS fall
// back to WiFi/IP lookup, which lands kilometres out - see setManual() callers.
export const MAX_ACCURACY_M = 100;

const EARTH_RADIUS_M = 6371000;
const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function encodePosition({ lat, lon, accuracy }) {
  const acc = Math.max(0, Math.round(Number(accuracy) || 0));
  return `${POS_PREFIX} ${lat.toFixed(6)} ${lon.toFixed(6)} ${acc}`;
}

// Returns null for anything that is not a well-formed position, so a chat
// message that merely starts with !POS cannot corrupt the peer list.
export function decodePosition(text) {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(/\s+/);
  if (parts[0] !== POS_PREFIX || parts.length < 4) return null;

  const lat = Number(parts[1]);
  const lon = Number(parts[2]);
  const accuracy = Number(parts[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(accuracy)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || accuracy < 0) return null;

  return { lat, lon, accuracy };
}

export function isPosition(text) {
  return typeof text === 'string' && text.trim().startsWith(POS_PREFIX);
}

// Great-circle distance in metres. Haversine is accurate to ~0.5% at these
// ranges, far tighter than LoRa positioning needs.
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Initial great-circle bearing, degrees clockwise from true north.
export function bearingDeg(a, b) {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function compassPoint(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '?';
  if (metres < 1000) return `${Math.round(metres)} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.round(metres / 1000)} km`;
}

export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// One-line summary of where a peer is relative to us.
export function describeRelative(mine, theirs) {
  if (!mine || !theirs) return null;
  const d = distanceM(mine, theirs);
  const b = bearingDeg(mine, theirs);
  return `${formatDistance(d)} ${compassPoint(b)}`;
}
