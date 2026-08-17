// parse.js — turn a Schedule of Property (the chauhaddi / butt-and-bound
// recital) into structured boundary calls.
//
// Every extracted value keeps a pointer back to the line it came from, so the
// verification screen can show the lawyer the source text beside the number.
// Nothing in this file is allowed to invent a measurement.

import { LENGTH_UNITS, AREA_UNITS, STATE_VARIABLE_AREA_UNITS, toMetres, toSqMetres } from './units.js';

/* ------------------------------------------------------------------ *
 * Direction lexicon
 * Includes the transliterations that turn up in deeds drafted in or
 * translated from Hindi, Marathi, Punjabi and the southern languages.
 * ------------------------------------------------------------------ */
const DIR_WORDS = [
  // 8 points, longest-first inside each group so "north east" beats "north"
  { key: 'NE', deg: 45,  words: ['north-east', 'north east', 'northeast', 'uttar-purv', 'uttar purv', 'ne'] },
  { key: 'SE', deg: 135, words: ['south-east', 'south east', 'southeast', 'dakshin-purv', 'dakshin purv', 'se'] },
  { key: 'SW', deg: 225, words: ['south-west', 'south west', 'southwest', 'dakshin-paschim', 'dakshin paschim', 'sw'] },
  { key: 'NW', deg: 315, words: ['north-west', 'north west', 'northwest', 'uttar-paschim', 'uttar paschim', 'nw'] },
  { key: 'N',  deg: 0,   words: ['north', 'northern', 'northwards', 'uttar', 'uttari', 'utter', 'vadak', 'vadakku', 'n'] },
  { key: 'E',  deg: 90,  words: ['east', 'eastern', 'eastwards', 'purv', 'poorv', 'purab', 'poorab', 'purvi', 'kizhakku', 'e'] },
  { key: 'S',  deg: 180, words: ['south', 'southern', 'southwards', 'dakshin', 'dakshini', 'dachhin', 'therku', 's'] },
  { key: 'W',  deg: 270, words: ['west', 'western', 'westwards', 'paschim', 'pashchim', 'pachhim', 'merku', 'w'] },
];

export const CARDINALS = ['N', 'E', 'S', 'W'];
export const DIR_DEG = Object.fromEntries(DIR_WORDS.map(d => [d.key, d.deg]));
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };

/* ------------------------------------------------------------------ *
 * Length recognition
 * ------------------------------------------------------------------ */

// unit word -> LENGTH_UNITS key
const LEN_ALIASES = {
  ft: 'ft', foot: 'ft', feet: 'ft', fts: 'ft', "'": 'ft',
  in: 'in', inch: 'in', inches: 'in', '"': 'in',
  m: 'm', mt: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  cm: 'cm',
  yd: 'yd', yds: 'yd', yard: 'yd', yards: 'yd', gaj: 'yd', guz: 'yd', gaz: 'yd',
  link: 'link', links: 'link',
  karam: 'karam', karm: 'karam', kadam: 'karam',
};
const LEN_UNIT_RE = Object.keys(LEN_ALIASES)
  .filter(k => /^[a-z]+$/.test(k))
  .sort((a, b) => b.length - a.length)
  .join('|');

const NUM = String.raw`\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?`;

// Ordered most-specific-first. Each returns { metres, text }.
const LENGTH_PATTERNS = [
  // 40'-6"  |  40' 6"  |  40'6"
  {
    re: new RegExp(String.raw`(${NUM})\s*'\s*[-–]?\s*(${NUM})\s*"`, 'i'),
    take: (m) => ({ metres: toMetres(num(m[1]), 'ft') + toMetres(num(m[2]), 'in'), text: m[0] }),
  },
  // 40 feet 6 inches
  {
    re: new RegExp(String.raw`(${NUM})\s*(?:ft|feet|foot)\s*(?:and\s*)?(${NUM})\s*(?:in|inch|inches)`, 'i'),
    take: (m) => ({ metres: toMetres(num(m[1]), 'ft') + toMetres(num(m[2]), 'in'), text: m[0] }),
  },
  // 40 ft | 12.5 metres | 30 gaj | 22 links
  {
    re: new RegExp(String.raw`(${NUM})\s*(${LEN_UNIT_RE})\b`, 'i'),
    take: (m) => {
      const key = LEN_ALIASES[m[2].toLowerCase()];
      return key ? { metres: toMetres(num(m[1]), key), text: m[0] } : null;
    },
  },
  // 40'  (bare feet mark)
  {
    re: new RegExp(String.raw`(${NUM})\s*'`, 'i'),
    take: (m) => ({ metres: toMetres(num(m[1]), 'ft'), text: m[0] }),
  },
];

const num = (s) => parseFloat(String(s).replace(/,/g, ''));

/**
 * Find the first length expression in a string.
 * @returns {{metres:number, text:string, index:number}|null}
 */
export function findLength(text) {
  let best = null;
  for (const p of LENGTH_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const got = p.take(m);
    if (!got) continue;
    // prefer the earliest match; ties go to the more specific (earlier) pattern
    if (!best || m.index < best.index) best = { ...got, index: m.index };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Bearing recognition — for surveyed descriptions rather than chauhaddi
 * e.g. "N 45° 30' E", "S12°W", "bearing 137°"
 * ------------------------------------------------------------------ */
const QUAD_BEARING_RE = /\b([NS])\s*(\d{1,2}(?:\.\d+)?)\s*(?:°|deg|d)?\s*(?:(\d{1,2})\s*(?:'|min|m)\s*)?\s*([EW])\b/i;
const WHOLE_CIRCLE_RE = /\bbearing\s*(?:of\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:°|deg)?/i;

export function findBearing(text) {
  let m = QUAD_BEARING_RE.exec(text);
  if (m) {
    const ns = m[1].toUpperCase(), ew = m[4].toUpperCase();
    const ang = parseFloat(m[2]) + (m[3] ? parseFloat(m[3]) / 60 : 0);
    // quadrantal -> whole-circle bearing measured clockwise from north
    let deg;
    if (ns === 'N' && ew === 'E') deg = ang;
    else if (ns === 'S' && ew === 'E') deg = 180 - ang;
    else if (ns === 'S' && ew === 'W') deg = 180 + ang;
    else deg = 360 - ang;
    return { deg: deg % 360, text: m[0], kind: 'quadrantal' };
  }
  m = WHOLE_CIRCLE_RE.exec(text);
  if (m) {
    const deg = parseFloat(m[1]);
    if (deg >= 0 && deg <= 360) return { deg: deg % 360, text: m[0], kind: 'whole-circle' };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Direction recognition
 * ------------------------------------------------------------------ */
function findDirection(text) {
  const lower = ' ' + text.toLowerCase().replace(/[.,:;()\[\]]/g, ' ') + ' ';
  let best = null;
  for (const d of DIR_WORDS) {
    for (const w of d.words) {
      // single letters must stand alone (avoid matching the "n" in "and")
      const pattern = w.length <= 2
        ? new RegExp(`(?:^|\\s)${escapeRe(w)}(?=\\s)`, 'i')
        : new RegExp(`(?:^|\\s)${escapeRe(w)}`, 'i');
      const m = pattern.exec(lower);
      if (m && (!best || m.index < best.index)) {
        best = { key: d.key, deg: d.deg, text: w, index: m.index };
      }
    }
    // longest-first ordering means an 8-point hit at position 0 wins outright
    if (best && best.index <= 1 && best.key.length === 2) break;
  }
  return best;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------ *
 * Area recognition
 * ------------------------------------------------------------------ */
const AREA_ALIASES = {
  'sq ft': 'sqft', 'sq. ft': 'sqft', 'sqft': 'sqft', 'square feet': 'sqft', 'square foot': 'sqft', 'sq feet': 'sqft', 'sft': 'sqft',
  'sq m': 'sqm', 'sq. m': 'sqm', 'sqm': 'sqm', 'square metres': 'sqm', 'square meters': 'sqm', 'sq metres': 'sqm', 'sq mtr': 'sqm', 'sq.mtrs': 'sqm',
  'sq yd': 'sqyd', 'sq. yd': 'sqyd', 'sqyd': 'sqyd', 'square yards': 'sqyd', 'sq yards': 'sqyd', 'gaj': 'sqyd', 'sq gaj': 'sqyd',
  'acre': 'acre', 'acres': 'acre',
  'hectare': 'hectare', 'hectares': 'hectare', 'ha': 'hectare',
  'guntha': 'guntha', 'gunthas': 'guntha', 'gunta': 'guntha',
  'cent': 'cent', 'cents': 'cent',
  'kanal': 'kanal', 'kanals': 'kanal',
  'marla': 'marla', 'marlas': 'marla',
  'ground': 'ground', 'grounds': 'ground',
  'ankanam': 'ankanam', 'ankanams': 'ankanam',
};
const AREA_UNIT_RE = Object.keys(AREA_ALIASES).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const AREA_RE = new RegExp(String.raw`(${NUM})\s*(${AREA_UNIT_RE})\b`, 'i');
const STATE_VAR_RE = new RegExp(String.raw`(${NUM})\s*(${STATE_VARIABLE_AREA_UNITS.join('|')})\b`, 'i');

export function findArea(text) {
  // Indian areas are routinely compound — "2 kanal 3 marla", "1 acre 20 guntha",
  // "3 grounds 400 sq ft". Chain consecutive terms and sum them; stop as soon as
  // anything other than a separator sits between two terms, so a later unrelated
  // figure elsewhere in the document is not swept in.
  const re = new RegExp(String.raw`(${NUM})\s*(${AREA_UNIT_RE})\b`, 'gi');
  const parts = [];
  let m, lastEnd = -1;
  while ((m = re.exec(text)) !== null) {
    const key = AREA_ALIASES[m[2].toLowerCase().replace(/\s+/g, ' ')];
    if (!key) continue;
    if (parts.length) {
      const gap = text.slice(lastEnd, m.index);
      if (!/^[\s,\-–&]*(?:and)?[\s,\-–&]*$/i.test(gap)) break;
      if (parts.some(p => p.unit === key)) break;      // "1000 sq ft … 40 sq ft" is not compound
    }
    parts.push({ value: num(m[1]), unit: key, text: m[0], sqm: toSqMetres(num(m[1]), key) });
    lastEnd = m.index + m[0].length;
  }
  if (parts.length) {
    const sqm = parts.reduce((s, p) => s + p.sqm, 0);
    if (parts.length === 1) {
      return { sqm, value: parts[0].value, unit: parts[0].unit, text: parts[0].text, parts };
    }
    // No single unit describes a compound, so hand the UI square feet.
    return {
      sqm, value: sqm / 0.09290304, unit: 'sqft',
      text: parts.map(p => p.text).join(' '),
      parts, compound: true,
    };
  }
  const sv = STATE_VAR_RE.exec(text);
  if (sv) {
    return {
      sqm: null, value: num(sv[1]), unit: sv[2].toLowerCase(), text: sv[0],
      stateVariable: true,
      note: `"${sv[2]}" varies by state and often by district. Supply the local conversion factor before this area can be used.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Identifiers — survey / khasra / plot numbers
 * ------------------------------------------------------------------ */
const ID_RE = /\b((?:khasra|khata|khatauni|survey|sy|s|gat|group|plot|cts|c\.?t\.?s|final plot|f\.?p|hissa|revenue survey|r\.?s|new survey|old survey|municipal|door|house|plan)\s*(?:no|nos|number|#)?\.?\s*[:\-]?\s*)([0-9]+(?:\s*\/\s*[0-9A-Za-z]+)*(?:\s*\/\s*[0-9A-Za-z]+)?)/gi;

export function findIdentifiers(text) {
  const out = [];
  let m;
  ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(text)) !== null) {
    out.push({ kind: m[1].replace(/[\s:.\-]+$/, '').trim(), value: m[2].replace(/\s+/g, ''), text: m[0].trim() });
  }
  return dedupeBy(out, (o) => o.kind.toLowerCase() + '|' + o.value);
}

const dedupeBy = (arr, k) => { const s = new Set(); return arr.filter(x => { const key = k(x); if (s.has(key)) return false; s.add(key); return true; }); };

/* ------------------------------------------------------------------ *
 * The main entry point
 * ------------------------------------------------------------------ */

const AREA_LINE_HINT = /(admeasur|total|area|extent|aggregat|containing|measuring)/i;

/**
 * Parse a Schedule of Property.
 *
 * @param {string} raw  the schedule text, as typed or extracted from a PDF
 * @returns {{
 *   calls: Array<{dir:string, deg:number, lengthM:number|null, bearingDeg:number|null,
 *                 adjoiner:string, raw:string, line:number, confidence:string, issues:string[]}>,
 *   statedArea: object|null,
 *   identifiers: Array<object>,
 *   unparsedLines: Array<{line:number, text:string}>,
 *   warnings: string[]
 * }}
 */
export function parseSchedule(raw) {
  const warnings = [];
  const calls = [];
  const unparsedLines = [];

  // A schedule is often one run-on paragraph. Split on line breaks first, then
  // on semicolons and on the boundary between one direction clause and the next.
  const lines = splitIntoClauses(raw);

  lines.forEach((entry) => {
    const { text, line } = entry;
    if (!text.trim()) return;

    const dir = findDirection(text);
    const len = findLength(text);
    const bearing = findBearing(text);

    // Area/total lines are not boundary calls.
    if (!dir && AREA_LINE_HINT.test(text) && findArea(text)) return;

    if (!dir) { if (len || text.trim().length > 3) unparsedLines.push({ line, text: text.trim() }); return; }

    const issues = [];
    if (!len) issues.push('No length found on this boundary — the recital may omit it, or it may be phrased in a way the parser missed.');

    // Adjoiner = the text after whichever of direction/length ends later.
    let adjoiner = text;
    const cut = Math.max(
      dir ? dir.index + dir.text.length : 0,
      len ? len.index + len.text.length : 0,
    );
    adjoiner = text.slice(cut).replace(/^[\s:,;.\-–—]*(?:adjoining|adjacent to|abutting|bounded by|by|is|belonging to|of|property of|land of|towards)?[\s:,;.\-–—]*/i, '').trim();
    adjoiner = adjoiner.replace(/[.;,]\s*$/, '');

    calls.push({
      dir: dir.key,
      deg: bearing ? bearing.deg : dir.deg,
      lengthM: len ? len.metres : null,
      lengthText: len ? len.text : null,
      bearingDeg: bearing ? bearing.deg : null,
      bearingText: bearing ? bearing.text : null,
      adjoiner,
      raw: text.trim(),
      line,
      confidence: len && dir ? (bearing ? 'high' : 'medium') : 'low',
      issues,
    });
  });

  // Stated area: prefer a line that looks like a total.
  let statedArea = null;
  for (const { text } of lines) {
    if (!AREA_LINE_HINT.test(text)) continue;
    const a = findArea(text);
    if (a) { statedArea = { ...a, sourceText: text.trim() }; break; }
  }
  if (!statedArea) {
    const a = findArea(raw);
    if (a) statedArea = { ...a, sourceText: 'found in schedule body', weak: true };
  }
  if (statedArea?.stateVariable) warnings.push(statedArea.note);

  const identifiers = findIdentifiers(raw);

  // Structural warnings — these are the findings, not errors.
  const dirs = calls.map(c => c.dir);
  const dupes = dirs.filter((d, i) => dirs.indexOf(d) !== i);
  if (dupes.length) warnings.push(`More than one call on the same side (${[...new Set(dupes)].join(', ')}). The boundary is probably stepped rather than straight — switch to Traverse mode.`);
  const missing = CARDINALS.filter(c => !dirs.includes(c));
  if (calls.length && missing.length && calls.length < 5) {
    warnings.push(`No call found for: ${missing.join(', ')}. An incomplete chauhaddi cannot be reconstructed without an assumption — record which one you make.`);
  }
  if (!calls.length) warnings.push('No boundary calls recognised. Check that each boundary is on its own line, or enter the calls by hand.');
  if (!statedArea) warnings.push('No stated area found, so the area reconciliation check cannot run.');

  return { calls, statedArea, identifiers, unparsedLines, warnings };
}

/**
 * Break a schedule into clause-sized pieces. Handles both the tidy
 * one-boundary-per-line layout and the single run-on paragraph that
 * registered deeds actually use.
 */
function splitIntoClauses(raw) {
  const out = [];
  const physicalLines = String(raw || '').split(/\r?\n/);

  physicalLines.forEach((pl, i) => {
    const lineNo = i + 1;
    // Split a long line on semicolons, and before any direction word that is
    // preceded by a separator — "…Ram Lal, East: 25 ft…"
    const pieces = pl
      .split(/;+/)
      .flatMap(seg => seg.split(/(?=(?:^|[,.—–-]\s*)(?:on\s+the\s+|towards\s+the\s+)?(?:north|south|east|west|uttar|dakshin|purv|poorv|paschim)\b)/i));
    const kept = pieces.map(p => p.trim()).filter(Boolean);
    if (kept.length <= 1) out.push({ text: pl, line: lineNo });
    else kept.forEach(p => out.push({ text: p, line: lineNo }));
  });
  return out;
}

/**
 * Group parsed calls by cardinal direction, summing where a side has been
 * described in more than one segment.
 * @returns {{N:number|null, E:number|null, S:number|null, W:number|null, segmented:string[]}}
 */
export function callsByCardinal(calls) {
  const out = { N: null, E: null, S: null, W: null, segmented: [] };
  for (const c of CARDINALS) {
    const hits = calls.filter(k => k.dir === c && k.lengthM != null);
    if (!hits.length) continue;
    out[c] = hits.reduce((s, h) => s + h.lengthM, 0);
    if (hits.length > 1) out.segmented.push(c);
  }
  return out;
}
