// main.js — application wiring.

import * as THREE from 'three';
import { Viewport, TIER_COLOR } from './scene3d.js';
import { parseSchedule, callsByCardinal, CARDINALS } from './parse.js';
import { reconstructChauhaddi, computeTraverse, shoelaceArea, centroid, bbox, transformPoly, insetPolygon } from './geom.js';
import { AREA_UNITS, FT, toSqMetres, m2ft, fmtFtIn, fmtSqFt, fmtPct } from './units.js';
import { emptyProject, migrate, saveLocal, loadLocal, clearLocal, recordFile, uid, downloadBlob,
         buildManifest, s63CertificateDraft, TIERS } from './store.js';
import { compareLayers, buildReportHTML, buildCSV } from './report.js';
import { Relay } from './relay.js';
import { solarPosition, istDate, sunriseSunset, daySamples, KEY_DATES, CITY_PRESETS,
         fmtClock, fmtDuration } from './sun.js';

/* ============================== state ============================== */

let project = loadLocal() || emptyProject();
let parsed = null;                 // last parseSchedule() result
let selectedLayerId = null;
let selectedStructureId = null;
let lastComparison = null;
let lastSunResult = null;
let vp = null;
let relay = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ============================== boot ============================== */

function boot() {
  vp = new Viewport($('#canvas'));
  $('#stage').appendChild(vp.vrButton);
  bindXrHandoff();

  applyStoredTheme();
  fillSelects();
  bindTopbar();
  bindStage();
  bindTabs();
  bindParsePanel();
  bindComparePanel();
  bindBuildPanel();
  bindSunPanel();
  bindFilesPanel();
  bindExportPanel();
  bindTierBanner();

  // Sensible defaults for the sun panel before anything is loaded.
  const d = new Date();
  $('#sunDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  hydrateFromProject();
  renderAll();

  // Inert unless this page came from relay.py — see js/relay.js.
  let framedFromBroadcast = false;
  relay = new Relay({
    getProject: () => project,
    getSelected: () => selectedLayerId,
    applyState: (incoming, selId) => {
      project = migrate(incoming);
      selectedLayerId = selId && project.layers.some(l => l.id === selId)
        ? selId : (project.layers[0]?.id || null);
      selectedStructureId = null;
      lastComparison = null; lastSunResult = null;
      hydrateFromProject();
      renderAll();
      // Frame the site on the first broadcast received, then leave the camera
      // alone: a viewer looking at one corner should not be yanked back every
      // time the host nudges something.
      if (!framedFromBroadcast) { frameAll(); framedFromBroadcast = true; }
    },
    toast,
  });
  relay.init();

  if (!project.layers.length) toast('Press “Example” for a worked matter with a real discrepancy in it.', 5200);
}

function applyStoredTheme() {
  const saved = localStorage.getItem('chauhaddi.theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  syncSceneTheme();
}
function syncSceneTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  const dark = attr === 'dark' || (!attr && matchMedia('(prefers-color-scheme: dark)').matches);
  vp?.setTheme(dark);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncSceneTheme);

function fillSelects() {
  const areaSel = $('#statedAreaUnit');
  Object.entries(AREA_UNITS).forEach(([k, v]) => areaSel.append(new Option(v.label, k)));
  areaSel.value = 'sqft';

  const tierSel = $('#newLayerTier');
  Object.values(TIERS).forEach(t => tierSel.append(new Option(`${t.key} — ${t.label}`, t.key)));
  tierSel.value = 'D';

  const city = $('#cityPreset');
  city.append(new Option('— custom —', ''));
  CITY_PRESETS.forEach(c => city.append(new Option(c.name, c.name)));
}

/* ============================== topbar ============================== */

function bindTopbar() {
  $('#matterTitle').addEventListener('input', (e) => {
    project.matter.title = e.target.value;
    persist();
  });

  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('chauhaddi.theme', next);
    syncSceneTheme();
  });

  $('#btnSample').addEventListener('click', loadSample);

  $('#btnSave').addEventListener('click', () => {
    const name = (project.matter.title || 'matter').replace(/[^\w\-]+/g, '_').slice(0, 48);
    downloadBlob(`chauhaddi_${name}.json`, JSON.stringify(project, null, 2), 'application/json');
    toast('Saved to your downloads folder.');
  });

  $('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
  $('#fileOpen').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const raw = await f.text();
      if (!raw.trim()) {
        toast(`${f.name} read as empty. Some headset browsers accept a file and then refuse the page its contents — paste the project text instead (Export tab).`, 9000);
        e.target.value = '';
        return;
      }
      project = migrate(JSON.parse(raw));
      selectedLayerId = project.layers[0]?.id || null;
      selectedStructureId = null;
      lastComparison = null; lastSunResult = null;
      hydrateFromProject();
      renderAll();
      frameAll();
      toast(`Opened “${project.matter.title || f.name}”.`);
    } catch (err) {
      toast('That file could not be read as a Chauhaddi project.');
      console.error(err);
    }
    e.target.value = '';
  });
}

function hydrateFromProject() {
  $('#matterTitle').value = project.matter.title || '';
  $('#mCourt').value = project.matter.court || '';
  $('#mSuit').value = project.matter.suitNo || '';
  $('#mParties').value = project.matter.parties || '';
  $('#mBy').value = project.matter.preparedBy || '';
  $('#siteLat').value = project.site.latDeg;
  $('#siteLon').value = project.site.lonDeg;
  $('#northOffset').value = project.site.northOffsetDeg || 0;
  $('#cityPreset').value = project.site.place || '';
  if (!selectedLayerId) selectedLayerId = project.layers[0]?.id || null;
  syncUnderlayControls();
}

function persist() {
  relay?.schedulePush();
  const ok = saveLocal(project);
  $('#stSaved').textContent = ok ? `held in this browser · ${new Date().toLocaleTimeString('en-IN')}` : 'too large for browser storage — use Save';
}

/* ============================== stage ============================== */

function bindStage() {
  $$('#viewTools [data-view]').forEach(b => b.addEventListener('click', () => {
    $$('#viewTools [data-view]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    vp.view(b.dataset.view, allPoints());
  }));

  $('#btnFrame').addEventListener('click', frameAll);

  // Three states rather than two: dimensioning every outline at once is what
  // made the picture unreadable, so "selected only" is the default.
  const LABEL_MODES = [
    { key: 'selected', text: 'Labels: selected', title: 'Dimension and name only the outline you have selected' },
    { key: 'all',      text: 'Labels: all',      title: 'Name every visible outline as well' },
    { key: 'off',      text: 'Labels: off',      title: 'No labels at all' },
  ];
  $('#btnLabels').addEventListener('click', (e) => {
    const i = LABEL_MODES.findIndex(m => m.key === vp.labelMode);
    const next = LABEL_MODES[(i + 1) % LABEL_MODES.length];
    vp.labelMode = next.key;
    const b = e.currentTarget;
    b.textContent = next.text;
    b.title = next.title;
    b.classList.toggle('on', next.key !== 'off');
    renderScene();
  });

  const scales = [1, 20, 50, 100];
  let si = 0;
  $('#btnVrScale').addEventListener('click', (e) => {
    si = (si + 1) % scales.length;
    vp.setVrScale(scales[si]);
    e.currentTarget.textContent = scales[si] === 1 ? 'VR 1:1' : `VR 1:${scales[si]}`;
    e.currentTarget.title = scales[si] === 1
      ? 'Walk the site at true size — the thing a screen cannot do'
      : `Tabletop model at 1:${scales[si]}`;
  });

  $('#btnSnap').addEventListener('click', () => {
    downloadBlob(`chauhaddi_view_${stamp()}.png`, dataUrlToBlob(vp.snapshotPNG()));
    toast('View saved as PNG.');
  });
}

/* ---------------------- getting documents in, and VR ---------------------- *
 *
 * A file picker is 2D system UI. It cannot be composited into an immersive
 * WebXR session, and the WebXR DOM Overlay module that would allow HTML during
 * a session is an AR feature that Quest Browser does not offer for immersive
 * VR. So there is no way to drop a PDF while wearing the headset, and pretending
 * otherwise would just produce a dead button.
 *
 * What works instead: ingest in the flat page, then enter VR. And from inside
 * VR, Y or B leaves the session, brings you back to this page with the drop
 * zone waiting, and offers to put you straight back in once the outline exists.
 */
let wantReenterVR = false;

function bindXrHandoff() {
  vp.onExitForFile = () => {
    wantReenterVR = true;
    vp.endXR();
    // Give the session a moment to tear down before moving the page around.
    setTimeout(() => {
      showTab('parse');
      const dz = $('#dropDoc');
      dz.classList.add('over');
      dz.scrollIntoView({ block: 'center', behavior: 'smooth' });
      dz.focus();
      setTimeout(() => dz.classList.remove('over'), 2200);
      toast('Left VR so you can add a document — a file picker cannot open inside a headset. Build the outline, then tap ENTER VR again.', 7000);
    }, 260);
  };

  // Entering VR with nothing loaded drops you into an empty grid, which reads
  // as a broken app rather than an empty matter.
  vp.vrButton.addEventListener('click', () => {
    if (!project.layers.some(l => !l.hidden && l.polygon)) {
      toast('Nothing to look at yet. Parse a schedule (or press Example) before entering VR.', 6000);
    }
  }, true);
}

function offerReenterVR() {
  if (!wantReenterVR) return;
  wantReenterVR = false;
  toast('Outline added. Tap ENTER VR to go back in.', 6000);
  vp.vrButton.classList.add('pulse');
  setTimeout(() => vp.vrButton.classList.remove('pulse'), 6000);
}

function showTab(name) {
  $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  $$('.tabpanel').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
}

const allPoints = () => project.layers.filter(l => !l.hidden && l.polygon).flatMap(l => l.polygon);
function frameAll() {
  const p = allPoints();
  if (p.length) vp.frame(p);
  else vp.view('iso', null);
}

function bindTabs() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => {
    $$('#tabs button').forEach(x => x.classList.remove('on'));
    $$('.tabpanel').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    $(`.tabpanel[data-tab="${b.dataset.tab}"]`).classList.add('on');
  }));
}

/* ============================== schedule tab ============================== */

function bindParsePanel() {
  wireDrop($('#dropDoc'), $('#fileDoc'), handleDocFile);

  $('#btnParse').addEventListener('click', doParse);
  $('#btnClearParse').addEventListener('click', () => {
    $('#scheduleText').value = '';
    parsed = null;
    $('#verifyBlock').hidden = true;
    $('#buildBlock').hidden = true;
  });

  $('#reconMode').addEventListener('change', updateReconPreview);
  $('#statedArea').addEventListener('input', updateReconPreview);
  $('#statedAreaUnit').addEventListener('change', updateReconPreview);
  $('#btnBuildLayer').addEventListener('click', buildLayerFromParse);

  $('#btnAddManual').addEventListener('click', addManualLayer);
}

async function handleDocFile(file) {
  const { record, buffer } = await recordFile(file, { role: 'source document' });
  if (!buffer || buffer.byteLength === 0) {
    toast(`${file.name} read as zero bytes. On Quest Browser this happens with some file extensions — the picker accepts the file but will not hand the bytes to the page. Paste the schedule text instead.`, 9000);
    return;
  }
  project.files.push(record);
  renderFiles();
  persist();

  if (/pdf$/i.test(file.name) || file.type === 'application/pdf') {
    toast('Reading the PDF…');
    const text = await extractPdfText(buffer);
    if (!text || text.trim().length < 20) {
      toast('No text layer in that PDF — it is a scan. Retype the schedule below.', 6000);
    } else {
      const sched = isolateSchedule(text);
      $('#scheduleText').value = sched;
      pendingSource = { name: record.name, page: null };
      toast('Text extracted. Check it against the document, then parse.', 4200);
      doParse();
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    $('#scheduleText').value = isolateSchedule(text);
    pendingSource = { name: record.name, page: null };
    doParse();
  }
}

let pendingSource = null;

async function extractPdfText(buffer) {
  try {
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(it => it.str).join(' '));
    }
    return pages.join('\n\n');
  } catch (err) {
    console.warn('PDF text extraction unavailable', err);
    toast('PDF reader could not load. Paste the schedule text instead.', 5000);
    return '';
  }
}

/** Pull out the part of a long document that looks like the Schedule of Property. */
function isolateSchedule(text) {
  const t = String(text).replace(/\r/g, '');
  const start = t.search(/(schedule\s+of\s+(the\s+)?property|SCHEDULE|butted\s+and\s+bounded|boundaries\s*:|chauhaddi|chau\s*haddi)/i);
  if (start < 0) return t.trim().slice(0, 4000);
  const slice = t.slice(start, start + 2400);
  // Break the run-on registered-deed paragraph into one boundary per line.
  return slice
    .replace(/\s*\b(north|south|east|west|uttar|dakshin|purv|poorv|paschim)\b/gi, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n')
    .trim();
}

function doParse() {
  const raw = $('#scheduleText').value;
  if (!raw.trim()) { toast('Nothing to parse.'); return; }
  parsed = parseSchedule(raw);
  renderCallList();
  $('#verifyBlock').hidden = false;
  $('#buildBlock').hidden = false;

  if (parsed.statedArea?.sqm != null) {
    $('#statedArea').value = round(parsed.statedArea.value, 4);
    $('#statedAreaUnit').value = parsed.statedArea.unit;
  }
  if (!$('#newLayerName').value) {
    const id = parsed.identifiers[0];
    $('#newLayerName').value = id ? `${id.kind} ${id.value}` : 'Outline from schedule';
  }
  updateReconPreview();
  showTab('parse');
  toast(`${parsed.calls.length} boundary call${parsed.calls.length === 1 ? '' : 's'} found. Verify each one.`);
}

function renderCallList() {
  const host = $('#callList');
  host.innerHTML = '';
  if (!parsed) return;

  parsed.calls.forEach((c, i) => {
    const row = el('div', 'callrow');

    const dirSel = el('select');
    ['N', 'E', 'S', 'W', 'NE', 'SE', 'SW', 'NW'].forEach(d => dirSel.append(new Option(d, d)));
    dirSel.value = c.dir;
    dirSel.addEventListener('change', () => { c.dir = dirSel.value; updateReconPreview(); });

    const adj = el('input');
    adj.type = 'text';
    adj.value = c.adjoiner || '';
    adj.placeholder = 'adjoining…';
    adj.addEventListener('input', () => { c.adjoiner = adj.value; });

    const len = el('input');
    len.type = 'number'; len.step = 'any';
    len.value = c.lengthM != null ? round(m2ft(c.lengthM), 4) : '';
    len.placeholder = 'ft';
    len.title = 'Length of this boundary, in feet';
    len.addEventListener('input', () => {
      const v = parseFloat(len.value);
      c.lengthM = Number.isFinite(v) ? v * FT : null;
      updateReconPreview();
    });

    const del = el('button', 'eye', '✕');
    del.title = 'Remove this call';
    del.addEventListener('click', () => { parsed.calls.splice(i, 1); renderCallList(); updateReconPreview(); });

    row.append(dirSel, adj, len, del);

    const src = el('div', 'src');
    src.textContent = `line ${c.line}: “${c.raw}”${c.lengthText ? `   →  read as ${c.lengthText}` : ''}`;
    row.append(src);

    if (c.issues?.length) {
      const iss = el('div', 'src');
      iss.style.borderLeftColor = 'var(--brick)';
      iss.style.color = 'var(--brick)';
      iss.textContent = c.issues.join(' ');
      row.append(iss);
    }
    host.append(row);
  });

  const add = el('button', 'tiny', '+ Add a call by hand');
  add.style.marginTop = '8px';
  add.addEventListener('click', () => {
    parsed.calls.push({ dir: 'N', deg: 0, lengthM: null, adjoiner: '', raw: 'entered by hand', line: 0, issues: [], confidence: 'manual' });
    renderCallList(); updateReconPreview();
  });
  host.append(add);

  const warnHost = $('#parseWarnings');
  warnHost.innerHTML = '';
  (parsed.warnings || []).forEach(w => warnHost.append(el('div', 'callout brick', esc(w))));
  if (parsed.unparsedLines?.length) {
    warnHost.append(el('div', 'callout',
      `<b>${parsed.unparsedLines.length} line${parsed.unparsedLines.length === 1 ? '' : 's'} not recognised as a boundary.</b> ` +
      parsed.unparsedLines.slice(0, 4).map(u => `<br><span style="font-family:var(--mono);font-size:10.5px">line ${u.line}: ${esc(u.text.slice(0, 90))}</span>`).join('')));
  }
  if (parsed.identifiers?.length) {
    warnHost.append(el('div', 'callout',
      `<b>Identifiers found.</b> ${parsed.identifiers.map(i => `${esc(i.kind)} ${esc(i.value)}`).join(' · ')}`));
  }
}

function currentStatedAreaSqm() {
  const v = parseFloat($('#statedArea').value);
  if (!Number.isFinite(v)) return null;
  return toSqMetres(v, $('#statedAreaUnit').value);
}

function reconstructNow() {
  if (!parsed?.calls?.length) return null;
  const mode = $('#reconMode').value;
  const statedAreaSqm = currentStatedAreaSqm();
  if (mode === 'traverse') return computeTraverse(parsed.calls);
  return reconstructChauhaddi(callsByCardinal(parsed.calls), { statedAreaSqm });
}

function updateReconPreview() {
  const r = reconstructNow();
  const out = $('#reconPreview');
  if (!r) { out.textContent = ''; $('#btnBuildLayer').disabled = true; return; }
  if (!r.ok) { out.innerHTML = `<span class="bad">${esc(r.reason)}</span>`; $('#btnBuildLayer').disabled = true; return; }
  $('#btnBuildLayer').disabled = false;
  const worst = (r.findings || []).filter(f => f.severity !== 'ok').length;
  out.innerHTML = `Computes to <b>${esc(fmtSqFt(r.computedArea))}</b> enclosed. `
    + (worst ? `<span class="bad">${worst} contradiction${worst === 1 ? '' : 's'} found.</span>` : `<span class="good">No internal contradiction.</span>`);
}

function buildLayerFromParse() {
  const r = reconstructNow();
  if (!r?.ok) { toast('Nothing to build.'); return; }
  const layer = {
    id: uid('layer'),
    name: $('#newLayerName').value.trim() || `Outline ${project.layers.length + 1}`,
    tier: $('#newLayerTier').value,
    asOf: $('#newLayerAsOf').value.trim() || null,
    hidden: false,
    polygon: r.polygon,
    computedArea: r.computedArea,
    statedAreaSqm: currentStatedAreaSqm(),
    findings: r.findings || [],
    assumptions: r.assumptions || [],
    method: r.method,
    sides: r.sides || null,
    statedSides: r.statedSides || null,
    sourceFileName: pendingSource?.name || null,
    sourcePage: pendingSource?.page || null,
    rawSchedule: $('#scheduleText').value.slice(0, 4000),
    xform: { dx: 0, dy: 0, rotDeg: 0 },
  };
  project.layers.push(layer);
  selectedLayerId = layer.id;
  pendingSource = null;
  persist();
  renderAll();
  frameAll();
  $('#newLayerName').value = '';
  toast(`“${layer.name}” added at tier ${layer.tier}.`);
  offerReenterVR();
}

function addManualLayer() {
  const txt = prompt(
    'Enter the corners as east,north pairs in feet, one per line — anticlockwise.\n\nFor example:\n0,0\n40,0\n40,25\n0,25',
    '0,0\n40,0\n40,25\n0,25');
  if (!txt) return;
  const pts = txt.split(/[\n;]+/).map(l => l.trim()).filter(Boolean).map(l => {
    const [a, b] = l.split(/[,\s]+/).map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? { x: a * FT, y: b * FT } : null;
  }).filter(Boolean);
  if (pts.length < 3) { toast('At least three corners are needed.'); return; }
  const layer = {
    id: uid('layer'), name: prompt('Name this outline', 'Surveyed outline') || 'Surveyed outline',
    tier: 'A', asOf: null, hidden: false, polygon: pts,
    computedArea: shoelaceArea(pts), statedAreaSqm: null,
    findings: [], assumptions: ['Corner coordinates entered by hand.'],
    method: 'manual-coordinates', sourceFileName: null, rawSchedule: null,
    xform: { dx: 0, dy: 0, rotDeg: 0 },
  };
  project.layers.push(layer);
  selectedLayerId = layer.id;
  persist(); renderAll(); frameAll();
}

/* ============================== layers ============================== */

function renderLayerList() {
  const host = $('#layerList');
  host.innerHTML = '';
  if (!project.layers.length) {
    host.append(el('div', 'empty', 'No outlines yet.<br>Parse a schedule, or press <b>Example</b> above.'));
    return;
  }
  project.layers.forEach(l => {
    const item = el('div', 'layer-item' + (l.id === selectedLayerId ? ' sel' : ''));
    item.style.borderLeftColor = '#' + new THREE.Color(TIER_COLOR[l.tier] ?? 0x6b6f73).getHexString();

    const top = el('div', 'lrow');
    top.append(el('span', 'lname', esc(l.name)));
    top.append(el('span', 'spacer'));
    top.append(el('span', `tier-badge tier-${l.tier}`, l.tier));

    const eye = el('button', 'eye' + (l.hidden ? ' off' : ''), l.hidden ? '◌' : '●');
    eye.title = l.hidden ? 'Show' : 'Hide';
    eye.addEventListener('click', (e) => { e.stopPropagation(); l.hidden = !l.hidden; persist(); renderAll(); });
    top.append(eye);
    item.append(top);

    const bits = [
      l.asOf ? `as at ${l.asOf}` : null,
      l.computedArea != null ? fmtSqFt(l.computedArea) : null,
      (l.findings || []).some(f => f.severity === 'high' || f.severity === 'medium')
        ? `⚑ ${(l.findings || []).filter(f => f.severity !== 'ok').length} finding(s)` : null,
    ].filter(Boolean);
    item.append(el('div', 'lmeta', esc(bits.join('  ·  '))));

    item.addEventListener('click', () => {
      selectedLayerId = l.id;
      renderAll();
      relay?.schedulePush();
    });
    host.append(item);
  });
}

function renderLayerEditor() {
  const host = $('#layerEditor');
  host.innerHTML = '';
  const l = project.layers.find(x => x.id === selectedLayerId);
  if (!l) { host.append(el('div', 'empty', 'Select an outline to edit it.')); return; }

  const nameF = field('Name', inputText(l.name, v => { l.name = v; persist(); renderLayerList(); }));
  const tierSel = el('select');
  Object.values(TIERS).forEach(t => tierSel.append(new Option(`${t.key} — ${t.label}`, t.key)));
  tierSel.value = l.tier;
  tierSel.addEventListener('change', () => { l.tier = tierSel.value; persist(); renderAll(); });
  const asOfF = field('As at', inputText(l.asOf || '', v => { l.asOf = v || null; persist(); renderLayerList(); }));

  host.append(nameF, field('Accuracy tier', tierSel), asOfF);
  host.append(el('p', 'hint', esc(TIERS[l.tier]?.blurb || '')));

  // stats
  const strip = el('div', 'stat-strip');
  strip.append(stat(fmtSqFt(l.computedArea ?? 0), 'computed area'));
  if (l.statedAreaSqm != null) {
    const d = (l.computedArea ?? 0) - l.statedAreaSqm;
    strip.append(stat(fmtSqFt(l.statedAreaSqm), 'stated in document'));
    const s = stat(fmtSqFt(d), 'difference');
    if (Math.abs(d) / l.statedAreaSqm > 0.005) s.querySelector('.big-number').classList.add('bad');
    strip.append(s);
  }
  host.append(strip);

  // nudge controls — for fitting an outline onto a shared monument
  const nudge = el('div');
  nudge.append(el('div', 'lab', 'Position (ft east / ft north / ° clockwise)'));
  const r = el('div', 'row tight');
  const mk = (key, step) => {
    const i = el('input'); i.type = 'number'; i.step = String(step);
    i.value = key === 'rotDeg' ? (l.xform?.rotDeg || 0) : round(m2ft((l.xform?.[key] || 0)), 4);
    i.addEventListener('input', () => {
      l.xform ||= { dx: 0, dy: 0, rotDeg: 0 };
      const v = parseFloat(i.value) || 0;
      l.xform[key] = key === 'rotDeg' ? v : v * FT;
      persist(); renderScene(); renderCompare();
    });
    return i;
  };
  r.append(mk('dx', 0.25), mk('dy', 0.25), mk('rotDeg', 0.5));
  nudge.append(r);
  host.append(nudge);

  if (l.sides) {
    const t = el('table', 'grid');
    t.innerHTML = `<thead><tr><th>Side</th><th class="num">As recited</th><th class="num">Used</th></tr></thead><tbody>`
      + CARDINALS.map(c => {
          const recited = l.statedSides?.[c] ?? l.sides[c];
          const used = l.sides[c];
          const diff = Math.abs((recited ?? 0) - (used ?? 0)) > 1e-6;
          return `<tr><td>${c}</td><td class="num mono">${recited != null ? esc(fmtFtIn(recited)) : '—'}</td><td class="num mono ${diff ? 'bad' : ''}">${used != null ? esc(fmtFtIn(used)) : '—'}</td></tr>`;
        }).join('')
      + `</tbody>`;
    const tw2 = el('div', 'tw'); tw2.append(t); host.append(tw2);
  }

  if (l.assumptions?.length) {
    host.append(el('div', 'callout',
      `<b>Assumptions relied on.</b><br>` + l.assumptions.map(a => `• ${esc(a)}`).join('<br>')));
  }

  if (l.sourceFileName) {
    host.append(el('p', 'hint', `Source: ${esc(l.sourceFileName)}${l.sourcePage ? `, p.${l.sourcePage}` : ''}`));
  }

  const dup = el('button', 'tiny', 'Duplicate');
  dup.addEventListener('click', () => {
    const copy = structuredClone(l);
    copy.id = uid('layer'); copy.name = l.name + ' (copy)';
    project.layers.push(copy); selectedLayerId = copy.id; persist(); renderAll();
  });
  const del = el('button', 'tiny danger', 'Delete');
  del.addEventListener('click', () => {
    if (!confirm(`Delete “${l.name}”? Any structure built on it will lose its footprint.`)) return;
    project.layers = project.layers.filter(x => x.id !== l.id);
    selectedLayerId = project.layers[0]?.id || null;
    persist(); renderAll();
  });
  const acts = el('div', 'row auto');
  acts.style.marginTop = '10px';
  acts.append(dup, del);
  host.append(acts);
}

/** A layer's polygon after its own nudge transform. */
function effectivePolygon(l) {
  if (!l?.polygon) return null;
  const x = l.xform;
  if (!x || (!x.dx && !x.dy && !x.rotDeg)) return l.polygon;
  return transformPoly(l.polygon, { dx: x.dx || 0, dy: x.dy || 0, rotDeg: x.rotDeg || 0 });
}
const effLayers = () => project.layers.map(l => ({ ...l, polygon: effectivePolygon(l) }));

/* ============================== findings ============================== */

function renderFindings() {
  const host = $('#findingsList');
  host.innerHTML = '';
  const rows = project.layers.flatMap(l => (l.findings || []).map(f => ({ ...f, layerName: l.name, tier: l.tier })));
  if (!rows.length) { host.append(el('div', 'empty', 'No outlines parsed yet, so nothing to report.')); return; }

  const rank = { high: 3, medium: 2, low: 1, ok: 0 };
  rows.sort((a, b) => rank[b.severity] - rank[a.severity]);

  const real = rows.filter(r => r.severity !== 'ok');
  host.append(el('div', 'callout' + (real.length ? ' brick' : ''),
    real.length
      ? `<b>${real.length} contradiction${real.length === 1 ? '' : 's'} found</b> across ${project.layers.length} outline(s). Each one is internal to a document — it does not depend on any survey.`
      : `<b>No contradictions found.</b> That is itself worth recording: the schedules are internally consistent as parsed.`));

  rows.forEach(f => {
    const card = el('div', `finding ${f.severity}`);
    const mag = f.deltaM != null ? fmtFtIn(f.deltaM) : f.deltaSqm != null ? fmtSqFt(f.deltaSqm) : '';
    card.innerHTML =
      `<div class="ftitle"><span class="sev-chip">${esc(f.severity)}</span>${esc(f.title)}</div>`
      + `<div class="fmag">${esc(f.layerName)}${mag ? ` · ${esc(mag)}` : ''}${f.ratio != null ? ` · ${esc(fmtPct(f.ratio))}` : ''}</div>`
      + `<div class="fdetail">${esc(f.detail)}</div>`;
    host.append(card);
  });
}

/* ============================== compare ============================== */

function bindComparePanel() {
  ['#cmpA', '#cmpB', '#cmpAlign', '#cmpCorner'].forEach(s => $(s).addEventListener('change', renderCompare));
}

function renderCompare() {
  const layers = effLayers();
  const selA = $('#cmpA'), selB = $('#cmpB');
  const keepA = selA.value, keepB = selB.value;
  selA.innerHTML = ''; selB.innerHTML = '';
  layers.forEach(l => { selA.append(new Option(`${l.name} [${l.tier}]`, l.id)); selB.append(new Option(`${l.name} [${l.tier}]`, l.id)); });
  if (layers.length) {
    selA.value = layers.some(l => l.id === keepA) ? keepA : layers[0].id;
    selB.value = layers.some(l => l.id === keepB) ? keepB : (layers[1]?.id || layers[0].id);
    // With one outline both selects necessarily point at it. Once a second
    // arrives, B has to move off A by itself, or the panel reports that a second
    // outline is needed while two are sitting in the list — which is exactly the
    // moment the tool is supposed to pay off.
    if (selA.value === selB.value && layers.length > 1) {
      const other = [...layers].reverse().find(l => l.id !== selA.value);
      if (other) selB.value = other.id;
    }
  }
  $('#cmpCorner').disabled = $('#cmpAlign').value !== 'corner';

  const host = $('#compareOut');
  host.innerHTML = '';
  const a = layers.find(l => l.id === selA.value);
  const b = layers.find(l => l.id === selB.value);
  if (!a || !b || a.id === b.id) {
    lastComparison = null;
    vp.setDispute(null);
    host.append(el('div', 'empty', 'Two different outlines are needed. Add a second one — the point of this tool is the disagreement between documents.'));
    return;
  }

  const cmp = compareLayers(a, b, { align: $('#cmpAlign').value, corner: $('#cmpCorner').value });
  lastComparison = cmp;

  const strip = el('div', 'stat-strip');
  const s1 = stat(fmtSqFt(cmp.symDiff), 'total in dispute');
  s1.querySelector('.big-number').classList.add('bad');
  strip.append(s1);
  strip.append(stat(fmtSqFt(cmp.overlap), 'common to both'));
  strip.append(stat(fmtPct(cmp.symDiff / (cmp.areaA || 1)), 'of outline A'));
  host.append(strip);

  host.append(el('div', 'callout brick', `<b>${cmp.headline}</b>`));
  if (!cmp.exact) host.append(el('div', 'callout', `<b>Approximate.</b> ${esc(cmp.note)}`));

  const t1 = el('table', 'grid');
  t1.innerHTML = `<thead><tr><th>Measure</th><th class="num">${esc(a.name)}</th><th class="num">${esc(b.name)}</th><th class="num">Diff.</th></tr></thead><tbody>`
    + `<tr><td>Enclosed area</td><td class="num mono">${esc(fmtSqFt(cmp.areaA))}</td><td class="num mono">${esc(fmtSqFt(cmp.areaB))}</td><td class="num mono bad">${esc(fmtSqFt(cmp.deltaArea))}</td></tr>`
    + (cmp.sideLengthRows.length ? `<tr><td colspan="4" style="color:var(--ink-3);padding-top:10px">Boundary lengths as recited</td></tr>` : '')
    + cmp.sideLengthRows.map(d => `<tr><td>${esc(d.name)}</td><td class="num mono">${esc(fmtFtIn(d.aM))}</td><td class="num mono">${esc(fmtFtIn(d.bM))}</td><td class="num mono ${Math.abs(d.deltaM) > 0.01 ? 'bad' : ''}">${esc(fmtFtIn(d.deltaM, { signed: true }))}</td></tr>`).join('')
    + `<tr><td colspan="4" style="color:var(--ink-3);padding-top:10px">Overall extents</td></tr>`
    + cmp.dims.map(d => `<tr><td>${esc(d.name)}</td><td class="num mono">${esc(fmtFtIn(d.aM))}</td><td class="num mono">${esc(fmtFtIn(d.bM))}</td><td class="num mono ${Math.abs(d.deltaM) > 0.03 ? 'bad' : ''}">${esc(fmtFtIn(d.deltaM, { signed: true }))}</td></tr>`).join('')
    + `<tr><td>Within A only</td><td class="num mono bad">${esc(fmtSqFt(cmp.onlyA))}</td><td class="num"></td><td class="num"></td></tr>`
    + `<tr><td>Within B only</td><td class="num"></td><td class="num mono bad">${esc(fmtSqFt(cmp.onlyB))}</td><td class="num"></td></tr>`
    + `<tr class="total"><td>Total in dispute</td><td class="num"></td><td class="num"></td><td class="num mono bad">${esc(fmtSqFt(cmp.symDiff))}</td></tr>`
    + `</tbody>`;
  const twCmp = el('div', 'tw'); twCmp.append(t1); host.append(twCmp);

  // draw the disagreement, and the moved outline, in the scene
  renderScene();
  const onlyLabel = cmp.symDiff > 0.05 ? `${fmtSqFt(cmp.symDiff)} in dispute` : null;
  vp.setDispute(cmp.intersection?.length >= 3 ? cmp.intersection : null, { label: onlyLabel });
}

/* ============================== building ============================== */

function bindBuildPanel() {
  $('#btnAddStructure').addEventListener('click', () => {
    if (!project.layers.length) { toast('Add an outline first — a structure needs a footprint.'); return; }
    const st = {
      id: uid('st'), name: `Structure ${project.structures.length + 1}`,
      sourceLayerId: selectedLayerId || project.layers[0].id,
      insetM: 0, baseM: 0, hidden: false, isObstruction: false, transparent: false,
      floors: [{ name: 'Ground floor', heightM: 3, allottedTo: '' }],
    };
    project.structures.push(st);
    selectedStructureId = st.id;
    persist(); renderStructures(); renderScene();
  });
}

function structureFootprint(st) {
  const l = project.layers.find(x => x.id === st.sourceLayerId);
  const poly = effectivePolygon(l);
  if (!poly) return null;
  return st.insetM > 0 ? insetPolygon(poly, st.insetM) : poly;
}

function renderStructures() {
  const host = $('#structureList');
  host.innerHTML = '';
  if (!project.structures.length) {
    host.append(el('div', 'empty', 'No structures. Add one to model a house, a floor split, or a neighbour&rsquo;s wall.'));
    populateWindowStructureSelect();
    return;
  }

  project.structures.forEach(st => {
    const card = el('section', 'block');
    const head = el('div', 'row auto');
    head.style.marginBottom = '8px';
    const nm = inputText(st.name, v => { st.name = v; persist(); renderScene(); populateWindowStructureSelect(); });
    nm.style.fontFamily = 'var(--serif)';
    const rm = el('button', 'tiny danger', 'Delete');
    rm.addEventListener('click', () => {
      project.structures = project.structures.filter(x => x.id !== st.id);
      persist(); renderStructures(); renderScene();
    });
    head.append(nm); head.append(rm);
    card.append(head);

    // footprint source
    const fpSel = el('select');
    project.layers.forEach(l => fpSel.append(new Option(`${l.name} [${l.tier}]`, l.id)));
    fpSel.value = st.sourceLayerId;
    fpSel.addEventListener('change', () => { st.sourceLayerId = fpSel.value; persist(); renderScene(); });
    card.append(field('Footprint follows', fpSel));

    const inset = el('input'); inset.type = 'number'; inset.step = '0.5';
    inset.value = round(m2ft(st.insetM || 0), 3);
    inset.addEventListener('input', () => { st.insetM = (parseFloat(inset.value) || 0) * FT; persist(); renderScene(); });
    card.append(field('Set back from the boundary (ft)', inset));

    const flags = el('div');
    flags.append(checkbox(`obstruction — this mass blocks the light`, st.isObstruction, v => { st.isObstruction = v; persist(); renderScene(); }));
    flags.append(checkbox('draw as translucent', st.transparent, v => { st.transparent = v; persist(); renderScene(); }));
    flags.append(checkbox('hide', st.hidden, v => { st.hidden = v; persist(); renderScene(); }));
    card.append(flags);

    // floors
    card.append(el('div', 'lab', 'Floors, bottom upwards'));
    const tw = el('div', 'tw');
    const t = el('table', 'grid');
    t.innerHTML = `<thead><tr><th>Floor</th><th class="num">Height ft</th><th>Allotted to</th><th></th></tr></thead>`;
    const tb = el('tbody');
    (st.floors || []).forEach((fl, i) => {
      const tr = el('tr');
      const c1 = el('td'), c2 = el('td', 'num'), c3 = el('td'), c4 = el('td');
      c1.append(inputText(fl.name, v => { fl.name = v; persist(); renderScene(); }));
      const hi = el('input'); hi.type = 'number'; hi.step = '0.25';
      hi.value = round(m2ft(fl.heightM || 3), 3);
      hi.addEventListener('input', () => { fl.heightM = (parseFloat(hi.value) || 3) * FT; persist(); renderScene(); });
      c2.append(hi);
      c3.append(inputText(fl.allottedTo || '', v => { fl.allottedTo = v; persist(); renderScene(); }));
      const x = el('button', 'eye', '✕');
      x.addEventListener('click', () => { st.floors.splice(i, 1); persist(); renderStructures(); renderScene(); });
      c4.append(x);
      tr.append(c1, c2, c3, c4);
      tb.append(tr);
    });
    t.append(tb);
    tw.append(t);
    card.append(tw);

    const addFl = el('button', 'tiny', '+ Floor');
    addFl.style.marginTop = '6px';
    addFl.addEventListener('click', () => {
      const n = st.floors.length;
      st.floors.push({ name: n === 0 ? 'Ground floor' : ordinal(n) + ' floor', heightM: 3, allottedTo: '' });
      persist(); renderStructures(); renderScene();
    });
    card.append(addFl);

    const totalH = (st.floors || []).reduce((s, f) => s + (f.heightM || 0), 0);
    card.append(el('p', 'hint', `Overall height ${esc(fmtFtIn(totalH))} over ${st.floors.length} floor(s). Colour follows the allottee, so a partition reads at a glance.`));

    host.append(card);
  });
  populateWindowStructureSelect();
}

const ordinal = (n) => ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'][n] || `${n}th`;

/* ============================== sun ============================== */

function bindSunPanel() {
  $('#cityPreset').addEventListener('change', (e) => {
    const c = CITY_PRESETS.find(x => x.name === e.target.value);
    if (!c) return;
    project.site.place = c.name; project.site.latDeg = c.lat; project.site.lonDeg = c.lon;
    $('#siteLat').value = c.lat; $('#siteLon').value = c.lon;
    persist(); updateSunReadout();
  });
  $('#siteLat').addEventListener('input', () => { project.site.latDeg = parseFloat($('#siteLat').value) || 0; project.site.place = ''; $('#cityPreset').value = ''; persist(); updateSunReadout(); });
  $('#siteLon').addEventListener('input', () => { project.site.lonDeg = parseFloat($('#siteLon').value) || 0; project.site.place = ''; $('#cityPreset').value = ''; persist(); updateSunReadout(); });
  $('#northOffset').addEventListener('input', () => {
    project.site.northOffsetDeg = parseFloat($('#northOffset').value) || 0;
    vp.setNorthOffset(project.site.northOffsetDeg);
    persist();
  });
  $('#sunDate').addEventListener('change', updateSunReadout);
  $('#sunTime').addEventListener('input', updateSunReadout);
  $$('#tabpanels [data-keydate]').forEach(b => b.addEventListener('click', () => {
    const kd = KEY_DATES.find(k => k.key === b.dataset.keydate);
    const y = new Date().getFullYear();
    $('#sunDate').value = `${y}-${String(kd.month).padStart(2, '0')}-${String(kd.day).padStart(2, '0')}`;
    updateSunReadout();
    toast(kd.why, 4800);
  }));
  $('#btnSunStudy').addEventListener('click', runSunStudy);
}

function currentSunDate() {
  const [y, m, d] = ($('#sunDate').value || '2026-03-21').split('-').map(Number);
  const mins = parseInt($('#sunTime').value, 10) || 0;
  return { y, m, d, mins };
}

function updateSunReadout() {
  const { y, m, d, mins } = currentSunDate();
  const lat = project.site.latDeg, lon = project.site.lonDeg;
  $('#sunTimeLabel').textContent = fmtClock(mins);
  const pos = solarPosition(istDate(y, m, d, Math.floor(mins / 60), mins % 60), lat, lon);
  const rs = sunriseSunset({ year: y, month: m, day: d, latDeg: lat, lonDeg: lon });

  vp.setSun(pos.altitude, pos.azimuth);

  $('#sunReadout').innerHTML =
    `<dt>Altitude</dt><dd>${pos.altitude.toFixed(2)}°${pos.altitude <= 0 ? '  (below the horizon)' : ''}</dd>`
    + `<dt>Azimuth</dt><dd>${pos.azimuth.toFixed(2)}° from true north</dd>`
    + `<dt>Sunrise</dt><dd>${fmtClock(rs.riseMinutes)} IST</dd>`
    + `<dt>Sunset</dt><dd>${fmtClock(rs.setMinutes)} IST</dd>`
    + `<dt>Shadow length</dt><dd>${pos.altitude > 0.5 ? `${(1 / Math.tan(pos.altitude * Math.PI / 180)).toFixed(2)} × height` : '—'}</dd>`;
}

function populateWindowStructureSelect() {
  const sel = $('#winStructure');
  const keep = sel.value;
  sel.innerHTML = '';
  const eligible = project.structures.filter(s => !s.isObstruction);
  if (!eligible.length) { sel.append(new Option('— no structure —', '')); return; }
  eligible.forEach(s => sel.append(new Option(s.name, s.id)));
  if (eligible.some(s => s.id === keep)) sel.value = keep;
}

function runSunStudy() {
  const stId = $('#winStructure').value;
  const st = project.structures.find(s => s.id === stId);
  if (!st) { toast('Add a structure to put the opening on.'); return; }
  const fp = structureFootprint(st);
  if (!fp) { toast('That structure has no footprint.'); return; }
  const obstructions = project.structures.filter(s => s.isObstruction && !s.hidden);
  if (!obstructions.length) {
    toast('No obstruction is marked, so nothing can block the light. Mark the neighbour’s mass as an obstruction first.', 6000);
  }

  // Make sure the scene holds current meshes — the raycast is against them.
  renderScene();

  const facing = $('#winFacing').value;
  const heightM = (parseFloat($('#winHeight').value) || 4) * FT;
  const b = bbox(fp), c = centroid(fp);
  const out = 0.15;
  const pt = {
    North: { x: c.x, y: heightM, z: -(b.maxY + out) },
    South: { x: c.x, y: heightM, z: -(b.minY - out) },
    East:  { x: b.maxX + out, y: heightM, z: -c.y },
    West:  { x: b.minX - out, y: heightM, z: -c.y },
  }[facing];
  const normalAz = { North: 0, East: 90, South: 180, West: 270 }[facing];

  const stepMinutes = 10;
  const { y, m, d } = currentSunDate();
  const dates = [
    ...KEY_DATES.map(k => ({ label: k.label, month: k.month, day: k.day, year: y })),
    { label: `Selected date — ${$('#sunDate').value}`, month: m, day: d, year: y },
  ];

  const rows = dates.map(dt => {
    const rs = sunriseSunset({ year: dt.year, month: dt.month, day: dt.day, latDeg: project.site.latDeg, lonDeg: project.site.lonDeg });
    const samples = daySamples({ year: dt.year, month: dt.month, day: dt.day, latDeg: project.site.latDeg, lonDeg: project.site.lonDeg, stepMinutes });
    let free = 0, unblocked = 0;
    samples.forEach(s => {
      if (s.altitude <= 0) return;
      // A wall only receives sun from the half-space it faces.
      const rel = Math.abs(((s.azimuth - normalAz + 540) % 360) - 180);
      if (rel >= 88) return;
      free += stepMinutes;
      if (vp.isSunVisibleFrom(pt, s.altitude, s.azimuth)) unblocked += stepMinutes;
    });
    return {
      label: dt.label, riseMinutes: rs.riseMinutes, setMinutes: rs.setMinutes,
      freeMinutes: free, blockedMinutes: unblocked, lostMinutes: free - unblocked,
    };
  });

  lastSunResult = { rows, stepMinutes, window: { facing, heightM }, obstructionCount: obstructions.length };
  project.sunStudy = lastSunResult;
  persist();

  const host = $('#sunStudyOut');
  host.innerHTML = '';

  // Which date is the worst case depends on the orientation of the opening
  // relative to the obstruction, so it has to be computed rather than assumed.
  const keyRows = rows.slice(0, KEY_DATES.length);
  const worst = keyRows.reduce((a, b) => (b.lostMinutes > a.lostMinutes ? b : a), keyRows[0]);
  lastSunResult.worstLabel = worst.label;

  const strip = el('div', 'stat-strip');
  const s1 = stat(fmtDuration(worst.lostMinutes), `lost — ${worst.label.replace(/^.*— /, '')}`);
  if (worst.lostMinutes > 0) s1.querySelector('.big-number').classList.add('bad');
  strip.append(s1);
  strip.append(stat(fmtDuration(worst.blockedMinutes), 'remaining that day'));
  strip.append(stat(worst.freeMinutes ? fmtPct(-worst.lostMinutes / worst.freeMinutes) : '—', 'reduction'));
  host.append(strip);

  const t = el('table', 'grid');
  t.innerHTML = `<thead><tr><th>Date</th><th class="num">Unobstructed</th><th class="num">With obstruction</th><th class="num">Lost</th></tr></thead><tbody>`
    + rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num mono">${esc(fmtDuration(r.freeMinutes))}</td><td class="num mono">${esc(fmtDuration(r.blockedMinutes))}</td><td class="num mono ${r.lostMinutes > 0 ? 'bad' : ''}"><b>${esc(fmtDuration(r.lostMinutes))}</b></td></tr>`).join('')
    + `</tbody>`;
  const twSun = el('div', 'tw'); twSun.append(t); host.append(twSun);
  host.append(el('div', 'callout brick',
    `<b>On these masses the worst case is ${esc(worst.label)}</b>, not necessarily the date you would expect. `
    + `A south-facing opening is usually hurt most at the winter solstice, when the sun sits lowest. But an east or `
    + `west opening can lose more in summer, because the sun rises and sets further north and therefore passes behind `
    + `an obstruction on that side for longer. Plead the date the geometry actually gives you.`));
  host.append(el('div', 'callout',
    `Computed from the modelled masses, sampled every ${stepMinutes} minutes, counting only the half-space the `
    + `${esc(facing.toLowerCase())} elevation can see. Not a measurement taken at the site, and only as good as the `
    + `height and position you have given the obstruction.`));

  toast(`Worst case: ${worst.label}. Included in the discrepancy schedule.`, 5000);
}

/* ============================== files & underlay ============================== */

function bindFilesPanel() {
  wireDrop($('#dropAny'), $('#fileAny'), async (file) => {
    const { record } = await recordFile(file, { role: 'exhibit / reference' });
    project.files.push(record);
    persist(); renderFiles();
    toast(`${file.name} hashed.`);
  });

  wireDrop($('#dropImg'), $('#fileImg'), async (file) => {
    const { record } = await recordFile(file, { role: 'underlay raster', keepDataUrl: true });
    project.files.push(record);
    project.underlay = { dataUrl: record.dataUrl, fileName: record.name, sha256: record.sha256,
                         widthM: 30, rotDeg: 0, dx: 0, dy: 0, opacity: 0.6 };
    persist(); renderFiles(); syncUnderlayControls(); vp.setUnderlay(project.underlay);
    toast('Underlay placed. Fit it against a boundary you trust.');
  });

  const ul = (id, key, fmt) => {
    $(id).addEventListener('input', () => {
      if (!project.underlay) return;
      const v = parseFloat($(id).value);
      project.underlay[key] = key === 'widthM' ? v * FT : v;
      syncUnderlayLabels();
      vp.setUnderlay(project.underlay);
      persist();
    });
  };
  ul('#ulWidth', 'widthM'); ul('#ulRot', 'rotDeg'); ul('#ulOpacity', 'opacity');
  ['#ulDx', '#ulDy'].forEach((id, i) => $(id).addEventListener('input', () => {
    if (!project.underlay) return;
    project.underlay[i === 0 ? 'dx' : 'dy'] = (parseFloat($(id).value) || 0) * FT;
    vp.setUnderlay(project.underlay); persist();
  }));
  $('#btnRemoveUnderlay').addEventListener('click', () => {
    project.underlay = null; persist(); syncUnderlayControls(); vp.setUnderlay(null);
  });
}

function syncUnderlayControls() {
  const has = !!project.underlay;
  $('#underlayControls').hidden = !has;
  if (!has) return;
  $('#ulWidth').value = round(m2ft(project.underlay.widthM || 9.144), 2);
  $('#ulRot').value = project.underlay.rotDeg || 0;
  $('#ulOpacity').value = project.underlay.opacity ?? 0.6;
  $('#ulDx').value = round(m2ft(project.underlay.dx || 0), 3);
  $('#ulDy').value = round(m2ft(project.underlay.dy || 0), 3);
  syncUnderlayLabels();
}
function syncUnderlayLabels() {
  if (!project.underlay) return;
  $('#ulWLabel').textContent = `${round(m2ft(project.underlay.widthM), 1)} ft`;
  $('#ulRLabel').textContent = `${round(project.underlay.rotDeg, 1)}°`;
  $('#ulOLabel').textContent = `${Math.round((project.underlay.opacity ?? 0.6) * 100)}%`;
}

function renderFiles() {
  const host = $('#fileList');
  host.innerHTML = '';
  if (!project.files.length) {
    host.append(el('div', 'empty', 'No files recorded. A schedule typed in by hand is perfectly usable &mdash; but say so expressly rather than leaving it to inference.'));
  }
  project.files.forEach((f, i) => {
    const row = el('div', 'filerow');
    row.innerHTML = `<span class="fname"><b>${esc(f.name)}</b><br><span style="color:var(--ink-3)">${esc(f.role)} · ${f.bytes.toLocaleString('en-IN')} bytes</span><br><span class="fhash">${esc(f.sha256)}</span></span>`;
    const x = el('button', 'eye', '✕');
    x.title = 'Remove this record';
    x.addEventListener('click', () => { project.files.splice(i, 1); persist(); renderFiles(); });
    row.append(x);
    host.append(row);
  });
  $('#stFiles').textContent = `${project.files.length} source file${project.files.length === 1 ? '' : 's'}`;
}

/* ============================== export ============================== */

function bindExportPanel() {
  const bind = (id, key) => $(id).addEventListener('input', (e) => { project.matter[key] = e.target.value; persist(); });
  bind('#mCourt', 'court'); bind('#mSuit', 'suitNo'); bind('#mParties', 'parties'); bind('#mBy', 'preparedBy');

  $('#btnReport').addEventListener('click', () => {
    const layers = effLayers();
    if (!layers.length) { toast('Nothing to report yet.'); return; }
    const manifest = buildManifest(project, { comparison: comparisonSummary(), sunStudy: lastSunResult });
    const html = buildReportHTML({
      project, layers, comparison: lastComparison, sunResult: lastSunResult, manifest,
      snapshotDataUrl: $('#incSnapshot').checked ? vp.snapshotPNG() : null,
    });
    const w = window.open('', '_blank');
    if (!w) { downloadBlob(`discrepancy_schedule_${stamp()}.html`, html, 'text/html'); toast('Pop-up blocked — downloaded instead.'); return; }
    w.document.write(html);
    w.document.close();
  });

  $('#btnCSV').addEventListener('click', () => {
    downloadBlob(`chauhaddi_figures_${stamp()}.csv`, buildCSV({ layers: effLayers(), comparison: lastComparison }), 'text/csv');
  });

  $('#btnManifest').addEventListener('click', () => {
    const manifest = buildManifest(project, { comparison: comparisonSummary(), sunStudy: lastSunResult });
    downloadBlob(`chauhaddi_manifest_${stamp()}.json`, JSON.stringify(manifest, null, 2), 'application/json');
  });

  $('#btnCert').addEventListener('click', () => {
    const manifest = buildManifest(project, { comparison: comparisonSummary(), sunStudy: lastSunResult });
    downloadBlob(`s63_certificate_DRAFT_${stamp()}.txt`, s63CertificateDraft(project, manifest), 'text/plain');
    toast('Draft only — it needs two signatures and a read-through before it is filed.', 5000);
  });

  $('#btnPNG').addEventListener('click', () => {
    downloadBlob(`chauhaddi_view_${stamp()}.png`, dataUrlToBlob(vp.snapshotPNG()));
  });

  $('#btnCopyProject').addEventListener('click', async () => {
    const text = JSON.stringify(project);
    $('#projectPaste').value = text;
    try {
      await navigator.clipboard.writeText(text);
      toast(`Matter copied — ${(text.length / 1024).toFixed(1)} KB. Paste it into the same box on the other device.`, 6000);
    } catch {
      $('#projectPaste').select();
      toast('Clipboard blocked by the browser. The text is selected in the box — copy it by hand.', 7000);
    }
  });

  $('#btnPasteProject').addEventListener('click', () => {
    const raw = $('#projectPaste').value.trim();
    if (!raw) { toast('Nothing pasted.'); return; }
    try {
      project = migrate(JSON.parse(raw));
      selectedLayerId = project.layers[0]?.id || null;
      selectedStructureId = null;
      lastComparison = null; lastSunResult = null;
      hydrateFromProject();
      renderAll();
      frameAll();
      $('#projectPaste').value = '';
      toast(`Loaded “${project.matter.title || 'matter'}” — ${project.layers.length} outline(s).`, 5000);
    } catch (err) {
      toast('That is not a saved Chauhaddi matter. Paste the whole text, from the first { to the last }.', 7000);
      console.warn(err);
    }
  });

  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Discard this matter entirely? Anything not saved as a .json is gone.')) return;
    clearLocal();
    project = emptyProject();
    parsed = null; selectedLayerId = null; lastComparison = null; lastSunResult = null;
    $('#scheduleText').value = '';
    $('#verifyBlock').hidden = true; $('#buildBlock').hidden = true;
    hydrateFromProject(); renderAll(); vp.setUnderlay(null); vp.setDispute(null);
  });
}

function comparisonSummary() {
  if (!lastComparison) return null;
  const c = lastComparison;
  return {
    outlineA: c.a.name, outlineB: c.b.name, alignment: c.align,
    areaASqm: c.areaA, areaBSqm: c.areaB, overlapSqm: c.overlap,
    onlyASqm: c.onlyA, onlyBSqm: c.onlyB, symmetricDifferenceSqm: c.symDiff,
    exact: c.exact,
  };
}

/* ============================== render ============================== */

function renderScene() {
  const layers = effLayers();
  // Hiding an outline hides whatever is built on it. Two independent switches for
  // one visible thing is a surprise: hide the neighbour's parcel and you expect
  // the neighbour's block to go with it. The Building tab's own hide still works.
  const structures = project.structures.map(st => {
    const src = project.layers.find(l => l.id === st.sourceLayerId);
    return { ...st, hidden: st.hidden || !!src?.hidden, footprint: structureFootprint(st) };
  });
  // Label and marker sizes are derived from the extent, so this has to run first.
  vp.setContentScale([
    ...layers.filter(l => !l.hidden && l.polygon).flatMap(l => l.polygon),
    ...structures.filter(s => !s.hidden && s.footprint).flatMap(s => s.footprint),
  ]);
  vp.setNorthOffset(project.site.northOffsetDeg || 0);
  vp.setLayers(layers, { selectedId: selectedLayerId });
  vp.setStructures(structures, { selectedId: selectedStructureId });
  vp.setUnderlay(project.underlay);
}

const BANNER_HIDDEN_KEY = 'chauhaddi.bannerHidden';

/**
 * The notice can be put away, because it was covering the model it is about.
 * It collapses to a chip rather than vanishing, and the warning it carries is
 * printed on every export regardless of what is on screen — so hiding it costs
 * nothing that matters.
 */
function bindTierBanner() {
  const banner = $('#tierBanner');
  const chip = $('#tierChip');
  const paint = (visible) => {
    banner.hidden = !visible;
    chip.hidden = visible;
  };
  $('#btnDismissBanner').addEventListener('click', () => {
    localStorage.setItem(BANNER_HIDDEN_KEY, '1');
    paint(false);
  });
  chip.addEventListener('click', () => {
    localStorage.removeItem(BANNER_HIDDEN_KEY);
    paint(true);
  });
  paint(localStorage.getItem(BANNER_HIDDEN_KEY) !== '1');
}

function renderStatus() {
  const layers = project.layers;
  const tiers = [...new Set(layers.map(l => l.tier))].sort();
  $('#stTier').textContent = layers.length
    ? `${layers.length} outline${layers.length === 1 ? '' : 's'} · tier ${tiers.join('/')}`
    : 'no outlines';
  const sel = layers.find(l => l.id === selectedLayerId);
  $('#stArea').textContent = sel?.computedArea != null ? `${sel.name}: ${fmtSqFt(sel.computedArea)}` : '—';

  // Only the text is rewritten — the dismiss button must survive a re-render.
  const worstTier = tiers.includes('A') ? 'A' : tiers[0];
  const text = $('#tierBannerText');
  if (layers.length && worstTier === 'A') {
    text.innerHTML = '<b>Instrument survey present</b>Tier A geometry may be spoken to as measurement — but only by the licensed surveyor who took it.';
  } else {
    text.innerHTML = '<b>Demonstrative only</b>This is an illustration of evidence, not evidence of a boundary. No figure here is a survey.';
  }
}

function renderLegend() {
  const used = [...new Set(project.layers.map(l => l.tier))].sort();
  const host = $('#tierLegend');
  if (!used.length) { host.innerHTML = '<span style="color:var(--ink-3)">no outlines</span>'; return; }
  host.innerHTML = used.map(t => {
    const hex = '#' + new THREE.Color(TIER_COLOR[t] ?? 0x6b6f73).getHexString();
    const dashed = t === 'C' || t === 'D';
    return `<div><span class="sw" style="background:${dashed
      ? `repeating-linear-gradient(90deg,${hex} 0 5px,transparent 5px 9px)`
      : hex}"></span><span class="k">${t}</span>${esc(TIERS[t]?.label || '')}</div>`;
  }).join('') + `<div style="margin-top:4px;color:var(--ink-3)">dashed = inferred · solid = measured</div>`;
}

function renderAll() {
  renderLayerList();
  renderLayerEditor();
  renderFindings();
  renderStructures();
  renderFiles();
  renderCompare();     // also calls renderScene()
  renderLegend();
  renderStatus();
  updateSunReadout();
}

/* ============================== the worked example ============================== */

/**
 * A real pattern, not a toy: a 1974 deed and a 2019 deed for the same plot,
 * where the north boundary has quietly lost three feet three inches between
 * them, and a 2026 survey that agrees with neither.
 */
function loadSample() {
  if (project.layers.length && !confirm('Replace the current matter with the worked example?')) return;
  $('#cmpAlign').value = 'none';

  project = emptyProject();
  project.matter = {
    title: 'Sharma v. Verma — partition & boundary',
    court: 'District Court',
    suitNo: 'CS 214/2026',
    parties: 'Ram Prakash Sharma v. Suresh Verma',
    preparedBy: '',
    notes: '',
    createdISO: new Date().toISOString(),
  };
  project.site = { latDeg: 28.6139, lonDeg: 77.2090, place: 'Delhi', northOffsetDeg: 0 };

  const mk = (name, tier, asOf, schedule, statedSqFt) => {
    const p = parseSchedule(schedule);
    const r = reconstructChauhaddi(callsByCardinal(p.calls), { statedAreaSqm: statedSqFt ? toSqMetres(statedSqFt, 'sqft') : null });
    return {
      id: uid('layer'), name, tier, asOf, hidden: false,
      polygon: r.polygon, computedArea: r.computedArea,
      statedAreaSqm: statedSqFt ? toSqMetres(statedSqFt, 'sqft') : null,
      findings: r.findings, assumptions: r.assumptions, method: r.method,
      sides: r.sides, statedSides: r.statedSides,
      sourceFileName: null, rawSchedule: schedule,
      xform: { dx: 0, dy: 0, rotDeg: 0 },
    };
  };

  const deed1974 = `Schedule of Property
North : 40 feet, adjoining property of Ram Lal
East  : 25 feet, adjoining 20 ft wide municipal road
South : 40 feet, adjoining property of Sita Devi
West  : 25 feet, adjoining common passage
Total admeasuring 1000 sq ft, Khasra No. 412/2`;

  const deed2019 = `Schedule of Property
North : 36'-9", adjoining property of Mohan Lal
East  : 25 feet, adjoining 20 ft wide municipal road
South : 40 feet, adjoining property of Kamla Devi
West  : 25 feet, adjoining common passage
Total admeasuring 1000 sq ft, Khasra No. 412/2`;

  project.layers = [
    mk('Sale deed, 1974', 'D', '1974-03-12', deed1974, 1000),
    mk('Sale deed, 2019', 'D', '2019-11-04', deed2019, 1000),
  ];

  // A survey that agrees with neither document — the usual outcome.
  const surveyPts = [
    { x: 0, y: 0 }, { x: 11.20, y: 0.06 }, { x: 11.14, y: 7.58 }, { x: 0.05, y: 7.64 },
  ];
  project.layers.push({
    id: uid('layer'), name: 'Total station survey, 2026', tier: 'A', asOf: '2026-02-18',
    hidden: false, polygon: surveyPts, computedArea: shoelaceArea(surveyPts),
    statedAreaSqm: null, findings: [], method: 'instrument-survey',
    assumptions: ['Coordinates as reduced by the licensed surveyor. Local site grid, not georeferenced.'],
    sourceFileName: null, rawSchedule: null, xform: { dx: 0, dy: 0, rotDeg: 0 },
  });

  // A house on the plot, partitioned by floor, and the neighbour's wall.
  const houseLayer = project.layers[0].id;
  project.structures = [
    {
      id: uid('st'), name: 'Dwelling house', sourceLayerId: houseLayer,
      insetM: 0.9, baseM: 0, hidden: false, isObstruction: false, transparent: false,
      floors: [
        { name: 'Ground floor', heightM: 3.05, allottedTo: 'Ram Prakash Sharma' },
        { name: 'First floor', heightM: 3.05, allottedTo: 'Suresh Verma' },
        { name: 'Barsati', heightM: 2.6, allottedTo: 'held in common' },
      ],
    },
  ];

  // The neighbour's four-storey block on the east, which is what shades the window.
  const eastBlock = {
    id: uid('layer'), name: "Neighbour's block (east)", tier: 'C', asOf: '2026',
    hidden: true,
    polygon: [{ x: 13.5, y: -1 }, { x: 22, y: -1 }, { x: 22, y: 9 }, { x: 13.5, y: 9 }],
    computedArea: 0, statedAreaSqm: null, findings: [],
    assumptions: ['Outline taken from the cadastral portal extract. Indicative position only.'],
    method: 'cadastral-portal', sourceFileName: null, rawSchedule: null,
    xform: { dx: 0, dy: 0, rotDeg: 0 },
  };
  eastBlock.computedArea = shoelaceArea(eastBlock.polygon);
  project.layers.push(eastBlock);
  project.structures.push({
    id: uid('st'), name: "Neighbour's block", sourceLayerId: eastBlock.id,
    insetM: 0, baseM: 0, hidden: false, isObstruction: true, transparent: false,
    floors: Array.from({ length: 4 }, (_, i) => ({ name: `${ordinal(i)} floor`, heightM: 3.1, allottedTo: '' })),
  });

  selectedLayerId = project.layers[0].id;
  parsed = null;
  lastComparison = null; lastSunResult = null;
  $('#scheduleText').value = deed2019;
  $('#verifyBlock').hidden = true; $('#buildBlock').hidden = true;

  persist();
  hydrateFromProject();
  renderAll();
  frameAll();

  $('#cmpA').value = project.layers[0].id;
  $('#cmpB').value = project.layers[1].id;
  renderCompare();
  showTab('compare');

  toast('Two deeds for one plot, 45 years apart. Look at what the north boundary did.', 6500);
}

/* ============================== small helpers ============================== */

function field(label, control) {
  const w = el('div', 'field');
  w.append(el('div', 'lab', esc(label)));
  w.append(control);
  return w;
}
function inputText(value, onInput) {
  const i = el('input'); i.type = 'text'; i.value = value ?? '';
  i.addEventListener('input', () => onInput(i.value));
  return i;
}
function checkbox(label, checked, onChange) {
  const w = el('label', 'checkline');
  const c = el('input'); c.type = 'checkbox'; c.checked = !!checked;
  c.addEventListener('change', () => onChange(c.checked));
  w.append(c, document.createTextNode(label));
  return w;
}
function stat(big, caption) {
  const s = el('div', 'stat');
  s.append(el('div', 'big-number', esc(big)));
  s.append(el('div', 'big-caption', esc(caption)));
  return s;
}
function wireDrop(zone, input, handler) {
  const run = async (files) => {
    for (const f of files) { try { await handler(f); } catch (e) { console.error(e); toast(`Could not read ${f.name}.`); } }
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', (e) => { run([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => run([...(e.dataTransfer?.files || [])]));
}
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ============================== go ============================== */

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
