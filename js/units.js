// units.js — canonical internal units are METRES and SQUARE METRES.
// Metres because WebXR is metric: a 1:1 VR walkthrough then needs no scaling.
// Everything a lawyer reads is converted back to feet at the display layer.

export const FT = 0.3048;          // 1 foot in metres (exact)
export const IN = 0.0254;          // 1 inch in metres (exact)

export const LENGTH_UNITS = {
  m:      { f: 1,          label: 'metres' },
  cm:     { f: 0.01,       label: 'centimetres' },
  ft:     { f: FT,         label: 'feet' },
  in:     { f: IN,         label: 'inches' },
  yd:     { f: 0.9144,     label: 'yards / gaj' },
  link:   { f: 0.201168,   label: "Gunter's links" },
  karam:  { f: 1.6764,     label: 'karam (5.5 ft)' },
};

// Area units. The fixed ones are nationally standard. Bigha, katha, biswa and
// their relatives vary by state and often by district, so they are NOT listed
// here — the UI exposes a user-supplied factor for those instead. Guessing a
// bigha is how you lose an argument.
export const AREA_UNITS = {
  sqm:      { f: 1,            label: 'sq metres' },
  sqft:     { f: 0.09290304,   label: 'sq feet' },
  sqyd:     { f: 0.83612736,   label: 'sq yards / gaj' },
  acre:     { f: 4046.8564224, label: 'acres' },
  hectare:  { f: 10000,        label: 'hectares' },
  guntha:   { f: 101.171,      label: 'guntha (1089 sq ft)' },
  cent:     { f: 40.4686,      label: 'cents (435.6 sq ft)' },
  kanal:    { f: 505.857,      label: 'kanal (5445 sq ft)' },
  marla:    { f: 25.2929,      label: 'marla (272.25 sq ft)' },
  ground:   { f: 222.967,      label: 'ground (2400 sq ft)' },
  ankanam:  { f: 5.01676,      label: 'ankanam (6 sq yd)' },
};

export const STATE_VARIABLE_AREA_UNITS = ['bigha', 'biswa', 'biswansi', 'katha', 'kattha', 'dhur', 'chatak'];

export function toMetres(value, unitKey) {
  const u = LENGTH_UNITS[unitKey];
  return u ? value * u.f : value;
}
export function toSqMetres(value, unitKey) {
  const u = AREA_UNITS[unitKey];
  return u ? value * u.f : value;
}

/** Metres -> feet (number). */
export const m2ft = (m) => m / FT;
/** Square metres -> square feet (number). */
export const sqm2sqft = (a) => a / 0.09290304;

/**
 * Format a length in metres as feet-and-inches, e.g. 12.1920 -> `40'-0"`.
 * This is the notation Indian deeds and sanctioned plans actually use.
 */
export function fmtFtIn(metres, { signed = false } = {}) {
  const sign = metres < 0 ? '-' : (signed ? '+' : '');
  const totalIn = Math.abs(metres) / IN;
  let ft = Math.floor(totalIn / 12);
  let inch = totalIn - ft * 12;
  // round to nearest 1/4 inch, the finest a deed ever bothers with
  inch = Math.round(inch * 4) / 4;
  if (inch >= 12) { ft += 1; inch -= 12; }
  const inStr = Number.isInteger(inch) ? String(inch) : inch.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${sign}${ft}'-${inStr}"`;
}

/** Decimal feet, e.g. 40.25 */
export function fmtFt(metres, dp = 2) {
  return `${m2ft(metres).toFixed(dp)} ft`;
}

/** Square feet with thousands separators. */
export function fmtSqFt(sqMetres, dp = 0) {
  return `${sqm2sqft(sqMetres).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })} sq ft`;
}

/** Square metres, for the states that record in metric. */
export function fmtSqM(sqMetres, dp = 2) {
  return `${sqMetres.toFixed(dp)} m²`;
}

/** Percentage, signed. */
export function fmtPct(ratio, dp = 2) {
  const v = ratio * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

/** Convert a square-metre area into the most human unit for its size. */
export function fmtAreaSmart(sqMetres) {
  const sqft = sqm2sqft(sqMetres);
  if (sqft >= 43560 * 2) return `${(sqMetres / 4046.8564224).toFixed(3)} acres  (${fmtSqFt(sqMetres)})`;
  return fmtSqFt(sqMetres);
}
