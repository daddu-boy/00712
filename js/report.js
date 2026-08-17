// report.js — the discrepancy schedule.
//
// This, not the 3D view, is the thing that goes in the file. A boring table
// saying the 1974 deed and the 2019 deed disagree by three feet three inches
// is worth more than any walkthrough. The 3D view exists to explain the table.

import { fmtFtIn, fmtFt, fmtSqFt, fmtPct, m2ft, sqm2sqft } from './units.js';
import { comparePolygons, compareExtents, shoelaceArea, alignByCentroid, alignByCorner, centroid } from './geom.js';
import { TIERS } from './store.js';
import { fmtClock, fmtDuration } from './sun.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --------------------- per-layer internal findings --------------------- */

export function layerFindingRows(layer) {
  return (layer.findings || []).map(f => ({
    layer: layer.name,
    severity: f.severity,
    title: f.title,
    magnitude: f.deltaM != null ? fmtFtIn(f.deltaM)
      : f.deltaSqm != null ? fmtSqFt(f.deltaSqm)
      : '—',
    ratio: f.ratio != null ? fmtPct(f.ratio) : '—',
    detail: f.detail,
    code: f.code,
  }));
}

/* ------------------------- pairwise comparison ------------------------- */

/**
 * Compare two parcel outlines and return every number a boundary dispute
 * actually turns on. Alignment is a choice, so it is returned alongside the
 * result rather than hidden inside it.
 */
export function compareLayers(a, b, { align = 'centroid', corner = 'SW' } = {}) {
  if (!a?.polygon || !b?.polygon) return null;
  const target = a.polygon;
  let moved = b.polygon;
  if (align === 'centroid') moved = alignByCentroid(b.polygon, target);
  else if (align === 'corner') moved = alignByCorner(b.polygon, target, corner);
  // align === 'none' keeps stored coordinates, which is right when both layers
  // are already on a common grid.

  const cmp = comparePolygons(target, moved);
  const ext = compareExtents(target, moved);

  const sideRows = [];
  const sides = [
    ['North boundary', ext.northExtent],
    ['South boundary', ext.southExtent],
    ['East boundary',  ext.eastExtent],
    ['West boundary',  ext.westExtent],
  ];
  for (const [name, e] of sides) {
    sideRows.push({ name, aM: e.a, bM: e.b, deltaM: e.delta });
  }

  const dims = [
    { name: 'Overall width (E–W)', aM: ext.widthA, bM: ext.widthB, deltaM: ext.widthB - ext.widthA },
    { name: 'Overall depth (N–S)', aM: ext.depthA, bM: ext.depthB, deltaM: ext.depthB - ext.depthA },
  ];

  // Where both outlines came from a chauhaddi, compare the recited boundary
  // lengths directly. This is the row that matters: a bounding box cannot show
  // that one deed's north boundary is shorter than the other's, because a
  // trapezoid and a rectangle can share the same overall extents.
  const sideLengthRows = [];
  if (a.sides && b.sides) {
    for (const [key, name] of [['N', 'North boundary'], ['E', 'East boundary'], ['S', 'South boundary'], ['W', 'West boundary']]) {
      const av = a.sides[key], bv = b.sides[key];
      if (av == null || bv == null) continue;
      sideLengthRows.push({ name, aM: av, bM: bv, deltaM: bv - av });
    }
  }

  return {
    a, b, align, corner, moved,
    areaA: cmp.areaA, areaB: cmp.areaB, deltaArea: cmp.deltaArea,
    overlap: cmp.overlap, onlyA: cmp.onlyA, onlyB: cmp.onlyB, symDiff: cmp.symDiff,
    intersection: cmp.intersection, exact: cmp.exact, note: cmp.note,
    sideRows, dims, sideLengthRows,
    headline: headlineFor(cmp, a, b, sideLengthRows),
  };
}

function headlineFor(cmp, a, b, sideLengthRows) {
  // A changed boundary length is the more useful headline when there is one:
  // it points at a specific side of a specific plot, which is how the dispute
  // will actually be pleaded.
  const moved = (sideLengthRows || []).filter(r => Math.abs(r.deltaM) > 0.01)
    .sort((x, y) => Math.abs(y.deltaM) - Math.abs(x.deltaM));
  if (moved.length) {
    const m = moved[0];
    const dir = m.deltaM < 0 ? 'shorter' : 'longer';
    const rest = moved.length > 1 ? ` (and ${moved.length - 1} other boundar${moved.length === 2 ? 'y' : 'ies'} differ too)` : '';
    return `The ${m.name.toLowerCase()} is recited as ${fmtFtIn(Math.abs(m.deltaM))} ${dir} in ${esc(b.name)} `
      + `than in ${esc(a.name)}${rest} — a difference of ${fmtSqFt(Math.abs(cmp.deltaArea))} in enclosed area.`;
  }
  if (cmp.symDiff < 0.05) return `${esc(a.name)} and ${esc(b.name)} describe the same figure to within a twentieth of a square metre.`;
  const worse = cmp.onlyA > cmp.onlyB ? a : b;
  return `${fmtSqFt(cmp.symDiff)} is described by one document and not the other. `
    + `${esc(worse.name)} claims ${fmtSqFt(Math.max(cmp.onlyA, cmp.onlyB))} that the other does not.`;
}

/* ---------------------------- the HTML report ---------------------------- */

export function buildReportHTML({ project, layers, comparison, sunResult, manifest, snapshotDataUrl }) {
  const m = project.matter;
  const now = new Date();

  const tierLegendRows = [...new Set(layers.map(l => l.tier))]
    .sort()
    .map(t => `<tr><td class="mono">${esc(t)}</td><td><b>${esc(TIERS[t]?.label || '')}</b></td><td class="sm">${esc(TIERS[t]?.blurb || '')}</td></tr>`)
    .join('');

  const layerRows = layers.map(l => `
    <tr>
      <td><b>${esc(l.name)}</b></td>
      <td class="mono">${esc(l.tier)}</td>
      <td class="sm">${esc(l.asOf || '—')}</td>
      <td class="sm">${esc(l.sourceFileName ? l.sourceFileName + (l.sourcePage ? `, p.${l.sourcePage}` : '') : 'typed input')}</td>
      <td class="mono num">${l.statedAreaSqm != null ? esc(fmtSqFt(l.statedAreaSqm)) : '—'}</td>
      <td class="mono num">${l.computedArea != null ? esc(fmtSqFt(l.computedArea)) : '—'}</td>
      <td class="mono num ${l.statedAreaSqm && Math.abs(l.computedArea - l.statedAreaSqm) / l.statedAreaSqm > 0.005 ? 'bad' : ''}">${
        l.statedAreaSqm != null && l.computedArea != null
          ? esc(fmtSqFt(l.computedArea - l.statedAreaSqm)) + ` (${esc(fmtPct((l.computedArea - l.statedAreaSqm) / l.statedAreaSqm))})`
          : '—'}</td>
    </tr>`).join('');

  const allFindings = layers.flatMap(layerFindingRows)
    .filter(f => f.severity !== 'ok')
    .sort((x, y) => rank(y.severity) - rank(x.severity));

  const findingRows = allFindings.length ? allFindings.map((f, i) => `
    <tr>
      <td class="mono">${i + 1}</td>
      <td><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span></td>
      <td class="sm">${esc(f.layer)}</td>
      <td><b>${esc(f.title)}</b><div class="sm detail">${esc(f.detail)}</div></td>
      <td class="mono num">${esc(f.magnitude)}</td>
      <td class="mono num">${esc(f.ratio)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="sm">No internal inconsistency was found in the schedules as parsed. That is a finding in itself, and should be recorded as such.</td></tr>`;

  const cmpBlock = comparison ? `
    <h2>4 &nbsp; Comparison of outlines</h2>
    <p class="lead">${comparison.headline}</p>
    <p class="sm">Alignment: <b>${esc(alignLabel(comparison))}</b>. A different alignment produces a different overlap; the alignment relied on must be stated whenever these figures are used.
    ${comparison.exact ? '' : ' <b>' + esc(comparison.note) + '</b>'}</p>
    <table>
      <thead><tr><th>Measure</th><th class="num">${esc(comparison.a.name)}</th><th class="num">${esc(comparison.b.name)}</th><th class="num">Difference</th></tr></thead>
      <tbody>
        <tr><td>Enclosed area</td><td class="mono num">${esc(fmtSqFt(comparison.areaA))}</td><td class="mono num">${esc(fmtSqFt(comparison.areaB))}</td><td class="mono num bad">${esc(fmtSqFt(comparison.deltaArea))}</td></tr>
        ${comparison.sideLengthRows.length ? `<tr><td colspan="4" class="sm" style="padding-top:12px"><b>Boundary lengths as recited</b> — a bounding box cannot show these, because a trapezoid and a rectangle can share the same overall extents.</td></tr>` : ''}
        ${comparison.sideLengthRows.map(d => `<tr><td>${esc(d.name)}</td><td class="mono num">${esc(fmtFtIn(d.aM))}</td><td class="mono num">${esc(fmtFtIn(d.bM))}</td><td class="mono num ${Math.abs(d.deltaM) > 0.01 ? 'bad' : ''}">${esc(fmtFtIn(d.deltaM, { signed: true }))}</td></tr>`).join('')}
        <tr><td colspan="4" class="sm" style="padding-top:12px"><b>Overall extents</b></td></tr>
        ${comparison.dims.map(d => `<tr><td>${esc(d.name)}</td><td class="mono num">${esc(fmtFtIn(d.aM))}</td><td class="mono num">${esc(fmtFtIn(d.bM))}</td><td class="mono num ${Math.abs(d.deltaM) > 0.03 ? 'bad' : ''}">${esc(fmtFtIn(d.deltaM, { signed: true }))}</td></tr>`).join('')}
      </tbody>
    </table>
    <table>
      <thead><tr><th>Land in issue</th><th class="num">Area</th><th class="num">As % of ${esc(comparison.a.name)}</th></tr></thead>
      <tbody>
        <tr><td>Common to both outlines</td><td class="mono num">${esc(fmtSqFt(comparison.overlap))}</td><td class="mono num">${esc(fmtPct(comparison.overlap / (comparison.areaA || 1)))}</td></tr>
        <tr><td>Within ${esc(comparison.a.name)} only</td><td class="mono num bad">${esc(fmtSqFt(comparison.onlyA))}</td><td class="mono num">${esc(fmtPct(comparison.onlyA / (comparison.areaA || 1)))}</td></tr>
        <tr><td>Within ${esc(comparison.b.name)} only</td><td class="mono num bad">${esc(fmtSqFt(comparison.onlyB))}</td><td class="mono num">${esc(fmtPct(comparison.onlyB / (comparison.areaA || 1)))}</td></tr>
        <tr class="total"><td><b>Total in dispute</b></td><td class="mono num bad"><b>${esc(fmtSqFt(comparison.symDiff))}</b></td><td class="mono num"><b>${esc(fmtPct(comparison.symDiff / (comparison.areaA || 1)))}</b></td></tr>
      </tbody>
    </table>` : '';

  const sunBlock = sunResult ? `
    <h2>5 &nbsp; Light and air &mdash; direct sunlight at the stated opening</h2>
    <p class="sm">Site ${esc(project.site.place || '')} at ${project.site.latDeg.toFixed(4)}&deg;N, ${project.site.lonDeg.toFixed(4)}&deg;E.
    Opening at ${esc(fmtFtIn(sunResult.window.heightM))} above ground on the ${esc(sunResult.window.facing)} elevation.
    Times are Indian Standard Time. Sampled every ${sunResult.stepMinutes} minutes.</p>
    <table>
      <thead><tr><th>Date</th><th class="num">Sunrise</th><th class="num">Sunset</th><th class="num">Direct sun<br>without obstruction</th><th class="num">Direct sun<br>with obstruction</th><th class="num">Lost</th></tr></thead>
      <tbody>
        ${sunResult.rows.map(r => `<tr>
          <td>${esc(r.label)}</td>
          <td class="mono num">${esc(fmtClock(r.riseMinutes))}</td>
          <td class="mono num">${esc(fmtClock(r.setMinutes))}</td>
          <td class="mono num">${esc(fmtDuration(r.freeMinutes))}</td>
          <td class="mono num">${esc(fmtDuration(r.blockedMinutes))}</td>
          <td class="mono num bad"><b>${esc(fmtDuration(r.lostMinutes))}</b>${r.freeMinutes ? ` (${esc(fmtPct(-r.lostMinutes / r.freeMinutes))})` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="sm"><b>How to read this.</b> ${sunResult.worstLabel
      ? `On these masses the greatest loss falls on <b>${esc(sunResult.worstLabel)}</b>, and that is the date to plead.`
      : 'Plead whichever date shows the greatest loss.'}
      Which date is worst depends on the orientation of the opening: a south-facing opening is usually hurt most at the
      winter solstice, when the sun sits lowest, but an east or west opening can lose more in summer, because the sun
      rises and sets further north and so passes behind an obstruction on that side for longer.
      Only the half-space the ${esc(sunResult.window.facing.toLowerCase())} elevation can see is counted.
      This is a computed geometric result from the modelled masses. It is not a measurement taken at the site, and it is
      only as reliable as the height and position given to the obstruction.</p>` : '';

  const assumptionItems = [...new Set(layers.flatMap(l => l.assumptions || []))];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discrepancy schedule — ${esc(m.title || 'Untitled matter')}</title>
<style>
  :root { --ink:#151a17; --ink2:#4a534d; --ink3:#6e776f; --rule:#c6ccc4; --rule2:#e0e4de;
          --blue:#2a4c63; --brick:#a33a2c; --brass:#7e7038; --paper:#fff; }
  * { box-sizing:border-box; }
  body { font:15px/1.6 "Iowan Old Style", Palatino, Georgia, serif; color:var(--ink);
         background:var(--paper); margin:0; padding:40px 32px 80px; }
  .sheet { max-width:960px; margin:0 auto; }
  .mono, .num { font-family:"SF Mono", Menlo, Consolas, monospace; font-variant-numeric:tabular-nums; }
  .num { text-align:right; white-space:nowrap; }
  h1 { font-size:30px; line-height:1.15; margin:0 0 6px; font-weight:400; }
  h2 { font-size:19px; margin:38px 0 12px; padding-bottom:6px; border-bottom:1.5px solid var(--ink); font-weight:400; }
  h3 { font-family:"Avenir Next Condensed","Arial Narrow",sans-serif; text-transform:uppercase;
       letter-spacing:.11em; font-size:12px; color:var(--blue); margin:24px 0 8px; }
  .eyebrow { font-family:"Avenir Next Condensed","Arial Narrow",sans-serif; text-transform:uppercase;
             letter-spacing:.16em; font-size:11px; color:var(--blue); margin:0 0 14px; }
  .tb { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); border-top:1px solid var(--rule);
        border-bottom:2px solid var(--ink); margin:18px 0 26px; }
  .tb div { padding:10px 14px 12px 0; border-right:1px solid var(--rule2); }
  .tb div:last-child { border-right:none; }
  .tb span { display:block; font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;
             text-transform:uppercase; letter-spacing:.13em; font-size:10px; color:var(--ink3); margin-bottom:3px; }
  .tb b { font-family:"SF Mono",Menlo,monospace; font-size:12.5px; font-weight:400; }
  p { max-width:74ch; margin:0 0 12px; }
  .lead { font-size:18px; color:var(--ink); border-left:3px solid var(--brick); padding-left:16px; }
  .sm { font-size:13px; color:var(--ink2); }
  .detail { margin-top:4px; max-width:62ch; }
  table { border-collapse:collapse; width:100%; margin:14px 0 22px; font-size:14px; }
  th { font-family:"Avenir Next Condensed","Arial Narrow",sans-serif; text-transform:uppercase;
       letter-spacing:.1em; font-size:10px; color:var(--ink3); text-align:left; font-weight:600;
       padding:8px 12px 8px 0; border-bottom:1px solid var(--rule); vertical-align:bottom; }
  th.num { text-align:right; }
  td { padding:9px 12px 9px 0; border-bottom:1px solid var(--rule2); vertical-align:top; }
  tr.total td { border-top:1.5px solid var(--ink); border-bottom:2px solid var(--ink); }
  .bad { color:var(--brick); }
  .sev { font-family:"SF Mono",Menlo,monospace; font-size:10px; text-transform:uppercase;
         padding:2px 6px; border:1px solid; border-radius:2px; white-space:nowrap; }
  .sev-high { color:var(--brick); border-color:var(--brick); background:#f7ebe8; }
  .sev-medium { color:var(--brass); border-color:var(--brass); background:#f6f4e8; }
  .sev-low { color:var(--ink2); border-color:var(--rule); background:#f2f4f1; }
  .warn { border:1px solid var(--brick); background:#faf0ee; padding:14px 18px; margin:20px 0; }
  .warn b { color:var(--brick); }
  figure { margin:20px 0; }
  figure img { max-width:100%; border:1px solid var(--rule); display:block; }
  figcaption { font-size:12px; color:var(--ink3); margin-top:6px; }
  ol.asm { max-width:74ch; font-size:13.5px; color:var(--ink2); }
  footer { margin-top:44px; border-top:1px solid var(--rule); padding-top:16px; font-size:12px; color:var(--ink3); }
  .hash { word-break:break-all; font-size:10.5px; }
  @media print {
    body { padding:0; font-size:11pt; }
    h2 { page-break-after:avoid; }
    table, figure { page-break-inside:avoid; }
    .noprint { display:none; }
  }
</style></head><body><div class="sheet">

<p class="eyebrow">Demonstrative &mdash; prepared for the conduct of the matter</p>
<h1>Discrepancy schedule</h1>
<div class="tb">
  <div><span>Matter</span><b>${esc(m.title || '—')}</b></div>
  <div><span>Court</span><b>${esc(m.court || '—')}</b></div>
  <div><span>Suit / case no.</span><b>${esc(m.suitNo || '—')}</b></div>
  <div><span>Prepared by</span><b>${esc(m.preparedBy || '—')}</b></div>
  <div><span>Generated</span><b>${now.toISOString().slice(0, 16).replace('T', ' ')}</b></div>
</div>

<div class="warn">
  <p style="margin:0"><b>This document is demonstrative, not substantive.</b> It illustrates evidence about land; it is
  not itself evidence of a boundary. Nothing in it is a survey, and no figure in it may be presented as a measurement
  unless it derives from a Tier A instrument survey and is spoken to by the licensed surveyor who took it. Reconstructions
  at Tier D are inferred from the words of a document and state only what those words imply — not where any line runs
  on the ground.</p>
</div>

${snapshotDataUrl ? `<figure><img src="${snapshotDataUrl}" alt="Overlay of the parcel outlines described in this schedule"><figcaption>Overlay as at generation. Dashed outlines are inferred reconstructions (Tier C&ndash;D); solid outlines derive from a plan or an instrument survey (Tier A&ndash;B). Shading marks the area the outlines disagree about.</figcaption></figure>` : ''}

<h2>1 &nbsp; Outlines relied on</h2>
<table>
  <thead><tr><th>Outline</th><th>Tier</th><th>As at</th><th>Source</th><th class="num">Area stated<br>in document</th><th class="num">Area computed<br>from dimensions</th><th class="num">Difference</th></tr></thead>
  <tbody>${layerRows || '<tr><td colspan="7" class="sm">No outlines recorded.</td></tr>'}</tbody>
</table>
<h3>Accuracy tiers used</h3>
<table><tbody>${tierLegendRows}</tbody></table>

<h2>2 &nbsp; Findings</h2>
<p class="sm">Ordered by severity. Every finding below is a contradiction internal to the documents as parsed &mdash; that is, the document disagrees with itself. Such a finding does not depend on any survey.</p>
<table>
  <thead><tr><th>#</th><th>Severity</th><th>Outline</th><th>Finding</th><th class="num">Magnitude</th><th class="num">Relative</th></tr></thead>
  <tbody>${findingRows}</tbody>
</table>

<h2>3 &nbsp; Assumptions relied on</h2>
${assumptionItems.length
  ? `<ol class="asm">${assumptionItems.map(a => `<li>${esc(a)}</li>`).join('')}</ol>`
  : '<p class="sm">None recorded.</p>'}
<p class="sm">A chauhaddi states the length of each boundary but no angles. Some assumption about the shape of the figure is therefore unavoidable, and a different assumption yields a different figure of the same area. The assumption relied on must be disclosed whenever a reconstruction is put to a witness.</p>

${cmpBlock}
${sunBlock}

<h2>${sunResult ? 6 : comparison ? 5 : 4} &nbsp; Provenance of source records</h2>
<p class="sm">SHA-256 computed at ingest, in the browser. Section 63(4) of the Bharatiya Sakshya Adhiniyam 2023 requires the certificate accompanying an electronic record to state its hash value and to be signed both by the person in charge of the device and by an expert. The certificate itself is exported separately and is a draft until completed and signed.</p>
<table>
  <thead><tr><th>File</th><th>Role</th><th class="num">Bytes</th><th>SHA-256</th></tr></thead>
  <tbody>${(manifest?.inputs || []).length
    ? manifest.inputs.map(f => `<tr><td class="sm">${esc(f.name)}</td><td class="sm">${esc(f.role)}</td><td class="mono num">${f.bytes.toLocaleString('en-IN')}</td><td class="mono hash">${esc(f.sha256)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="sm">No files were ingested. Every figure in this schedule derives from text typed into the tool, which must be stated expressly rather than left to inference.</td></tr>'}</tbody>
</table>

<footer>
  Generated by Chauhaddi, a client-side property geometry workbench. No document processed by this tool
  left the browser it was opened in. Tool version 0.1.0. Regenerate this schedule after any change to the
  underlying outlines &mdash; a stale schedule with a fresh date is worse than none.
</footer>
</div></body></html>`;
}

const rank = (s) => ({ high: 3, medium: 2, low: 1, ok: 0 }[s] ?? 0);

function alignLabel(c) {
  if (c.align === 'centroid') return 'outlines centred on one another (area centroid)';
  if (c.align === 'corner') return `outlines pinned at their ${c.corner} corner`;
  return 'stored coordinates, no alignment applied';
}

/* ------------------------------- CSV ------------------------------- */

export function buildCSV({ layers, comparison }) {
  const rows = [['section', 'item', 'value_ft_or_sqft', 'value_metric', 'note']];
  layers.forEach(l => {
    rows.push(['outline', `${l.name} — tier`, l.tier, '', l.sourceFileName || 'typed input']);
    if (l.statedAreaSqm != null) rows.push(['outline', `${l.name} — area stated in document`, sqm2sqft(l.statedAreaSqm).toFixed(2) + ' sq ft', l.statedAreaSqm.toFixed(4) + ' m2', '']);
    if (l.computedArea != null) rows.push(['outline', `${l.name} — area computed from dimensions`, sqm2sqft(l.computedArea).toFixed(2) + ' sq ft', l.computedArea.toFixed(4) + ' m2', '']);
    (l.findings || []).filter(f => f.severity !== 'ok').forEach(f => {
      rows.push(['finding', `${l.name} — ${f.title}`,
        f.deltaM != null ? m2ft(f.deltaM).toFixed(3) + ' ft' : f.deltaSqm != null ? sqm2sqft(f.deltaSqm).toFixed(2) + ' sq ft' : '',
        f.deltaM != null ? f.deltaM.toFixed(4) + ' m' : f.deltaSqm != null ? f.deltaSqm.toFixed(4) + ' m2' : '',
        f.severity]);
    });
  });
  if (comparison) {
    rows.push(['comparison', 'total area in dispute', sqm2sqft(comparison.symDiff).toFixed(2) + ' sq ft', comparison.symDiff.toFixed(4) + ' m2', `alignment: ${comparison.align}`]);
    rows.push(['comparison', `within ${comparison.a.name} only`, sqm2sqft(comparison.onlyA).toFixed(2) + ' sq ft', comparison.onlyA.toFixed(4) + ' m2', '']);
    rows.push(['comparison', `within ${comparison.b.name} only`, sqm2sqft(comparison.onlyB).toFixed(2) + ' sq ft', comparison.onlyB.toFixed(4) + ' m2', '']);
    (comparison.sideLengthRows || []).forEach(d => rows.push(['comparison', d.name + ' — as recited', m2ft(d.deltaM).toFixed(3) + ' ft', d.deltaM.toFixed(4) + ' m', 'difference']));
    comparison.dims.forEach(d => rows.push(['comparison', d.name, m2ft(d.deltaM).toFixed(3) + ' ft', d.deltaM.toFixed(4) + ' m', 'difference']));
  }
  return rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}
