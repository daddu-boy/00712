// sun.js — solar geometry for easement of light and air claims.
//
// Section 15 of the Indian Easements Act 1882 gives an absolute right to light
// and air after twenty years' peaceable enjoyment. Whether an obstruction
// actually interferes is a question about the sun's path, which is arithmetic.
// This module supplies that arithmetic; the app turns it into minutes of lost
// direct sunlight at a stated window.
//
// Algorithm: the standard low-precision solar position (accurate to about
// 0.01°, which is far finer than any building outline you will model).

const RAD = Math.PI / 180;

/**
 * @param {Date} dateUTC
 * @param {number} latDeg  north positive
 * @param {number} lonDeg  east positive
 * @returns {{altitude:number, azimuth:number, declination:number}} degrees;
 *          azimuth measured clockwise from true north
 */
export function solarPosition(dateUTC, latDeg, lonDeg) {
  const jd = dateUTC.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;

  const L = mod360(280.460 + 0.9856474 * n);            // mean longitude
  const g = mod360(357.528 + 0.9856003 * n) * RAD;      // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;           // obliquity

  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(eps) * Math.sin(lambda));

  const gmstHours = mod(18.697374558 + 24.06570982441908 * n, 24);
  const lmst = (gmstHours * 15 + lonDeg) * RAD;
  const H = lmst - alpha;                                // hour angle

  const lat = latDeg * RAD;
  const altitude = Math.asin(Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.cos(H));
  let azimuth = Math.atan2(
    -Math.cos(delta) * Math.sin(H),
    Math.sin(delta) * Math.cos(lat) - Math.cos(delta) * Math.sin(lat) * Math.cos(H),
  );

  return {
    altitude: altitude / RAD,
    azimuth: mod360(azimuth / RAD),
    declination: delta / RAD,
  };
}

const mod = (a, b) => ((a % b) + b) % b;
const mod360 = (a) => mod(a, 360);

/** Unit vector pointing FROM the ground TOWARDS the sun, in scene axes (+x East, +y Up, +z South). */
export function sunVector(altitudeDeg, azimuthDeg) {
  const alt = altitudeDeg * RAD, az = azimuthDeg * RAD;
  const horiz = Math.cos(alt);
  return {
    x: horiz * Math.sin(az),     // east component
    y: Math.sin(alt),            // up
    z: -horiz * Math.cos(az),    // north is -z in the scene, so +z is south
  };
}

/**
 * Build an Indian Standard Time instant. IST is UTC+05:30 with no daylight
 * saving, so the conversion is a fixed offset.
 */
export function istDate(year, month1to12, day, hour = 12, minute = 0) {
  return new Date(Date.UTC(year, month1to12 - 1, day, hour, minute) - 5.5 * 3600 * 1000);
}

/** Sample the sun's position across a day in IST, at a given step. */
export function daySamples({ year, month, day, latDeg, lonDeg, stepMinutes = 10 }) {
  const out = [];
  for (let t = 0; t < 24 * 60; t += stepMinutes) {
    const h = Math.floor(t / 60), mi = t % 60;
    const d = istDate(year, month, day, h, mi);
    const pos = solarPosition(d, latDeg, lonDeg);
    out.push({ minutes: t, hour: h, minute: mi, ...pos });
  }
  return out;
}

/** Sunrise / sunset in IST minutes, by scanning for the altitude zero crossing. */
export function sunriseSunset({ year, month, day, latDeg, lonDeg }) {
  const s = daySamples({ year, month, day, latDeg, lonDeg, stepMinutes: 2 });
  let rise = null, set = null;
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].altitude < 0 && s[i].altitude >= 0 && rise === null) rise = s[i].minutes;
    if (s[i - 1].altitude >= 0 && s[i].altitude < 0 && rise !== null && set === null) set = s[i].minutes;
  }
  return { riseMinutes: rise, setMinutes: set, samples: s };
}

export const KEY_DATES = [
  { key: 'winter',  label: 'Winter solstice — 21 Dec', month: 12, day: 21, why: 'The worst case. The sun is lowest, so obstruction is greatest. This is the date to plead.' },
  { key: 'equinox', label: 'Equinox — 21 Mar',         month: 3,  day: 21, why: 'The mean condition, and the fairest single date for a comparison.' },
  { key: 'summer',  label: 'Summer solstice — 21 Jun', month: 6,  day: 21, why: 'The best case. Useful to pre-empt the defence that there is no interference at all.' },
];

/** Convert IST minutes-from-midnight to a readable clock time. */
export function fmtClock(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Format a duration in minutes as "3h 40m". */
export function fmtDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Rough city coordinates, so the user is not hunting for a latitude. */
export const CITY_PRESETS = [
  { name: 'Delhi',      lat: 28.6139, lon: 77.2090 },
  { name: 'Mumbai',     lat: 19.0760, lon: 72.8777 },
  { name: 'Bengaluru',  lat: 12.9716, lon: 77.5946 },
  { name: 'Chennai',    lat: 13.0827, lon: 80.2707 },
  { name: 'Kolkata',    lat: 22.5726, lon: 88.3639 },
  { name: 'Hyderabad',  lat: 17.3850, lon: 78.4867 },
  { name: 'Pune',       lat: 18.5204, lon: 73.8567 },
  { name: 'Ahmedabad',  lat: 23.0225, lon: 72.5714 },
  { name: 'Jaipur',     lat: 26.9124, lon: 75.7873 },
  { name: 'Lucknow',    lat: 26.8467, lon: 80.9462 },
  { name: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'Kochi',      lat: 9.9312,  lon: 76.2673 },
  { name: 'Guwahati',   lat: 26.1445, lon: 91.7362 },
];
