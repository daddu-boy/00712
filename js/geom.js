// geom.js — the reconciliation engine.
//
// Coordinates are plain {x, y} in METRES, with +y = North and +x = East.
// Polygons are arrays of points, counter-clockwise, first point not repeated.

import { CARDINALS, OPPOSITE, DIR_DEG } from './parse.js';

/* ---------------------------- basics ---------------------------- */

export function shoelaceArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ensureCCW(pts) {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

export function perimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function centroid(pts) {
  // area centroid, not vertex average — matters when sides are uneven
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  a *= 3;
  return { x: cx / a, y: cy / a };
}

export function bbox(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function isConvex(pts) {
  if (pts.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Apply offset, rotation (degrees clockwise, i.e. a compass rotation) and scale about a pivot. */
export function transformPoly(pts, { dx = 0, dy = 0, rotDeg = 0, scale = 1, pivot = null } = {}) {
  const c = pivot || centroid(pts);
  const r = -rotDeg * Math.PI / 180; // clockwise compass rotation -> CCW math rotation
  const cos = Math.cos(r), sin = Math.sin(r);
  return pts.map(p => {
    const x0 = (p.x - c.x) * scale, y0 = (p.y - c.y) * scale;
    return { x: c.x + x0 * cos - y0 * sin + dx, y: c.y + x0 * sin + y0 * cos + dy };
  });
}

/* --------------------- chauhaddi reconstruction --------------------- *
 *
 * A chauhaddi states the LENGTH OF EACH SIDE, not a walking direction:
 * "North: 40 feet" means the northern boundary is 40 ft long, running
 * east-west. Four side lengths do not determine a quadrilateral — the figure
 * is over-determined — and that is exactly the point. Where the recital is
 * internally inconsistent, the inconsistency is the finding.
 *
 * The reconstruction below is the least-assumption reading: a symmetric
 * trapezoid with the north and south sides parallel and centred, separated by
 * the mean of the stated east and west lengths. It is Tier D throughout.
 */
export function reconstructChauhaddi(sides, { statedAreaSqm = null } = {}) {
  const { N, E, S, W } = sides;
  const present = CARDINALS.filter(c => sides[c] != null && sides[c] > 0);
  const findings = [];
  const assumptions = [];

  if (present.length < 3) {
    return { ok: false, reason: `Only ${present.length} of 4 sides have a length. At least three are needed.`, findings, assumptions, polygon: null };
  }

  // Fill a single missing side from its opposite, and say so out loud.
  const s = { N, E, S, W };
  for (const c of CARDINALS) {
    if (s[c] == null || s[c] <= 0) {
      s[c] = s[OPPOSITE[c]];
      assumptions.push(`The ${nameOf(c)} boundary has no stated length. It has been assumed equal to the ${nameOf(OPPOSITE[c])} boundary. This is an assumption, not a recital.`);
    }
  }

  const h = (s.E + s.W) / 2;                       // north-south separation
  const polygon = ensureCCW([
    { x: -s.S / 2, y: 0 },                          // SW
    { x:  s.S / 2, y: 0 },                          // SE
    { x:  s.N / 2, y: h },                          // NE
    { x: -s.N / 2, y: h },                          // NW
  ]);

  const computedArea = shoelaceArea(polygon);

  // --- finding 1: opposite-side mismatch -------------------------------
  const nsGap = Math.abs(s.N - s.S);
  const ewGap = Math.abs(s.E - s.W);
  const nsRef = Math.max(s.N, s.S), ewRef = Math.max(s.E, s.W);

  if (nsGap > 1e-4) {
    findings.push({
      code: 'OPPOSITE_MISMATCH_NS',
      severity: sev(nsGap / nsRef),
      title: 'North and south boundaries differ in length',
      deltaM: nsGap, ratio: nsGap / nsRef,
      detail: `The recital gives the north boundary as one length and the south boundary as another, differing by ${nsGap.toFixed(4)} m. The plot therefore cannot be the rectangle it is usually assumed to be.`,
    });
  }
  if (ewGap > 1e-4) {
    findings.push({
      code: 'OPPOSITE_MISMATCH_EW',
      severity: sev(ewGap / ewRef),
      title: 'East and west boundaries differ in length',
      deltaM: ewGap, ratio: ewGap / ewRef,
      detail: `The east and west boundaries differ by ${ewGap.toFixed(4)} m.`,
    });
  }
  if (nsGap <= 1e-4 && ewGap <= 1e-4) {
    findings.push({
      code: 'RECTANGULAR',
      severity: 'ok',
      title: 'Recital is internally consistent as a rectangle',
      detail: 'Opposite sides are equal. The description closes as a rectangle without any assumption.',
    });
  }

  // --- finding 2: the slant side check ---------------------------------
  // With N != S the east and west boundaries cannot be perpendicular to both.
  // Their true length in this reconstruction is the slant distance. If the
  // recital states a shorter figure, the recital is geometrically impossible.
  const slant = Math.hypot((s.N - s.S) / 2, h);
  for (const side of ['E', 'W']) {
    if (sides[side] == null) continue;
    const gap = slant - sides[side];
    if (Math.abs(gap) > 0.01) {
      findings.push({
        code: `SLANT_${side}`,
        severity: sev(Math.abs(gap) / sides[side]),
        title: `${nameOf(side)} boundary cannot be the stated length`,
        deltaM: Math.abs(gap), ratio: Math.abs(gap) / sides[side],
        detail: `Because the north and south boundaries are unequal, the ${nameOf(side).toLowerCase()} boundary must run at a slant. In this reconstruction its true length is ${slant.toFixed(4)} m against a recited ${sides[side].toFixed(4)} m — a discrepancy of ${Math.abs(gap).toFixed(4)} m that the recital does not disclose.`,
      });
    }
  }

  // --- finding 3: area reconciliation ---------------------------------
  let areaCheck = null;
  if (statedAreaSqm != null && statedAreaSqm > 0) {
    const delta = computedArea - statedAreaSqm;
    const ratio = delta / statedAreaSqm;
    areaCheck = { statedSqm: statedAreaSqm, computedSqm: computedArea, deltaSqm: delta, ratio };
    findings.push({
      code: 'AREA_RECONCILIATION',
      severity: Math.abs(ratio) < 0.005 ? 'ok' : sev(Math.abs(ratio)),
      title: Math.abs(ratio) < 0.005 ? 'Stated area agrees with the dimensions' : 'Stated area does not follow from the stated dimensions',
      deltaSqm: delta, ratio,
      detail: Math.abs(ratio) < 0.005
        ? 'The area recited in the schedule is consistent with the boundary lengths recited in the same schedule.'
        : `The boundary lengths compute to an area that differs from the area recited in the same document by ${Math.abs(delta).toFixed(3)} m². A schedule that contradicts itself on area is a defect on the face of the title deed.`,
    });
  }

  assumptions.push('The north and south boundaries have been taken as parallel and centred on one another, and separated by the mean of the east and west lengths. A chauhaddi does not state angles, so some such assumption is unavoidable; a different one produces a different figure of the same area.');

  return {
    ok: true, polygon, computedArea, sides: s, statedSides: sides,
    slantSide: slant, findings, assumptions, areaCheck,
    method: 'chauhaddi-trapezoid', tier: 'D',
  };
}

const nameOf = (c) => ({ N: 'North', E: 'East', S: 'South', W: 'West' })[c] || c;
const sev = (r) => r >= 0.05 ? 'high' : r >= 0.01 ? 'medium' : 'low';

/* ------------------------- traverse mode ------------------------- *
 * For descriptions that give a direction (or bearing) and a distance to be
 * walked in sequence. Reports a true closure error and a precision ratio,
 * the metric a surveyor would recognise.
 */
export function computeTraverse(calls) {
  const legs = calls.filter(c => c.lengthM != null && c.lengthM > 0);
  if (legs.length < 3) return { ok: false, reason: 'A traverse needs at least three legs with lengths.' };

  const pts = [{ x: 0, y: 0 }];
  const walked = [];
  for (const c of legs) {
    const deg = c.bearingDeg != null ? c.bearingDeg : (DIR_DEG[c.dir] ?? 0);
    const r = deg * Math.PI / 180;            // clockwise from north
    const dx = c.lengthM * Math.sin(r);
    const dy = c.lengthM * Math.cos(r);
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + dx, y: last.y + dy });
    walked.push({ ...c, deg, dx, dy });
  }

  const start = pts[0], end = pts[pts.length - 1];
  const closure = { dx: end.x - start.x, dy: end.y - start.y };
  const closureError = Math.hypot(closure.dx, closure.dy);
  const per = legs.reduce((s, c) => s + c.lengthM, 0);
  const precision = closureError > 1e-9 ? per / closureError : Infinity;

  // Balance by Bowditch (compass rule) so the figure closes for display.
  const balanced = [];
  let run = 0;
  balanced.push({ x: 0, y: 0 });
  walked.forEach((leg) => {
    run += leg.lengthM;
    const share = run / per;
    const raw = pts[balanced.length];
    balanced.push({ x: raw.x - closure.dx * share, y: raw.y - closure.dy * share });
  });
  balanced.pop(); // last balanced point coincides with the start

  const polygon = ensureCCW(balanced);
  const findings = [{
    code: 'TRAVERSE_CLOSURE',
    severity: closureError < 0.03 ? 'ok' : closureError < 0.3 ? 'low' : closureError < 1 ? 'medium' : 'high',
    title: closureError < 0.03 ? 'Traverse closes' : 'Traverse does not close',
    deltaM: closureError,
    detail: `Walking the recited bearings and distances in sequence ends ${closureError.toFixed(4)} m away from where it started. Perimeter ${per.toFixed(3)} m gives a precision of 1:${Number.isFinite(precision) ? Math.round(precision).toLocaleString('en-IN') : '∞'}. A cadastral survey would normally be expected to close better than 1:1,000; a description that closes worse than 1:200 is not describing a measured figure.`,
  }];

  return {
    ok: true, polygon, rawPoints: pts, computedArea: shoelaceArea(polygon),
    closure, closureError, precision, perimeterM: per,
    findings, assumptions: ['The figure shown has been balanced by the compass (Bowditch) rule so that it closes. The unbalanced traverse is drawn as a dashed line.'],
    method: 'traverse-bowditch', tier: 'D',
  };
}

/* -------------------- polygon intersection -------------------- *
 * Sutherland–Hodgman. Exact for a convex clip polygon, which covers every
 * figure this app reconstructs (all quads). Non-convex inputs are flagged
 * rather than silently mis-measured.
 */
export function clipConvex(subject, clip) {
  let output = [...subject];
  const c = ensureCCW(clip);
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pIn = side(a, b, p) >= 0, qIn = side(a, b, q) >= 0;
      if (pIn) output.push(p);
      if (pIn !== qIn) {
        const ip = lineIntersect(a, b, p, q);
        if (ip) output.push(ip);
      }
    }
  }
  return output;
}
const side = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function lineIntersect(a, b, p, q) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: q.x - p.x, y: q.y - p.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p.x - a.x) * s.y - (p.y - a.y) * s.x) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/**
 * Compare two parcel outlines: overlap, and the area each holds that the
 * other does not. This is the "how much land is actually in dispute" number.
 */
export function comparePolygons(a, b) {
  const areaA = shoelaceArea(a), areaB = shoelaceArea(b);
  const convex = isConvex(a) && isConvex(b);
  const inter = clipConvex(a, b);
  const overlap = inter.length >= 3 ? shoelaceArea(inter) : 0;
  return {
    areaA, areaB, overlap,
    onlyA: Math.max(0, areaA - overlap),
    onlyB: Math.max(0, areaB - overlap),
    symDiff: Math.max(0, areaA - overlap) + Math.max(0, areaB - overlap),
    deltaArea: areaB - areaA,
    intersection: inter,
    exact: convex,
    note: convex ? null : 'One or both outlines are non-convex. The overlap figure is approximate — split them into convex parts before relying on it.',
  };
}

/** Per-side extent comparison, the way a boundary dispute is actually argued. */
export function compareExtents(a, b) {
  const ba = bbox(a), bb = bbox(b);
  return {
    northExtent: { a: ba.maxY, b: bb.maxY, delta: bb.maxY - ba.maxY },
    southExtent: { a: ba.minY, b: bb.minY, delta: bb.minY - ba.minY },
    eastExtent:  { a: ba.maxX, b: bb.maxX, delta: bb.maxX - ba.maxX },
    westExtent:  { a: ba.minX, b: bb.minX, delta: bb.minX - ba.minX },
    widthA: ba.maxX - ba.minX, widthB: bb.maxX - bb.minX,
    depthA: ba.maxY - ba.minY, depthB: bb.maxY - bb.minY,
  };
}

/** Align b onto a by area centroid. The default, and always disclosed. */
export function alignByCentroid(poly, target) {
  const c1 = centroid(poly), c2 = centroid(target);
  return transformPoly(poly, { dx: c2.x - c1.x, dy: c2.y - c1.y, pivot: c1 });
}

/** Align by a named corner of the bounding box — for a shared fixed monument. */
export function alignByCorner(poly, target, corner = 'SW') {
  const p = bbox(poly), t = bbox(target);
  const px = corner.includes('W') ? p.minX : p.maxX;
  const py = corner.includes('S') ? p.minY : p.maxY;
  const tx = corner.includes('W') ? t.minX : t.maxX;
  const ty = corner.includes('S') ? t.minY : t.maxY;
  return poly.map(q => ({ x: q.x + (tx - px), y: q.y + (ty - py) }));
}

/** Inset a polygon by d metres — a crude setback / plinth footprint helper. */
export function insetPolygon(pts, d) {
  const c = centroid(pts);
  return pts.map(p => {
    const vx = p.x - c.x, vy = p.y - c.y;
    const len = Math.hypot(vx, vy) || 1;
    const k = Math.max(0.05, (len - d) / len);
    return { x: c.x + vx * k, y: c.y + vy * k };
  });
}
