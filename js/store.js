// store.js — project state, file provenance, and the evidence bundle.
//
// Two non-negotiables from the feasibility study are implemented here:
//
//  1. Nothing leaves the browser. There is no server, no upload, no analytics.
//     Client documents are privileged and contain personal data under the DPDP
//     Act 2023; the only safe architecture is one that cannot transmit them.
//
//  2. Every file is hashed on ingest. BSA 2023 s.63(4) requires the certificate
//     accompanying an electronic record to state its hash value, and requires
//     signature by both the person in charge of the device and an expert.
//     Provenance cannot be retrofitted, so it is recorded from the first click.

export const TIERS = {
  A: { key: 'A', label: 'Instrument survey',        blurb: 'Total station, DGPS or CORS. Centimetre-level, sworn by a licensed surveyor. The only tier that may be presented as measurement.' },
  B: { key: 'B', label: 'Plan or FMB, georeferenced', blurb: 'Sanctioned plan or FMB sketch fitted to control points. Sub-metre in principle, but scanned sheets warp — report the residual.' },
  C: { key: 'C', label: 'Cadastral portal parcel',  blurb: 'Bhu-Naksha and equivalents. Indicative only; the portals themselves disclaim positional accuracy. Never argue a boundary from Tier C.' },
  D: { key: 'D', label: 'Deed recital reconstruction', blurb: 'Geometry inferred from words. Finds contradictions; is not a statement about where the line runs.' },
  E: { key: 'E', label: 'Satellite or drone imagery', blurb: 'Strong for change over time. Weak for boundaries — Kerala courts have cautioned expressly against treating it as conclusive.' },
};

export const SCHEMA_VERSION = 3;

export function emptyProject() {
  return {
    schemaVersion: SCHEMA_VERSION,
    matter: {
      title: 'Untitled matter',
      court: '',
      suitNo: '',
      parties: '',
      preparedBy: '',
      notes: '',
      createdISO: new Date().toISOString(),
    },
    site: { latDeg: 28.6139, lonDeg: 77.2090, place: 'Delhi', northOffsetDeg: 0 },
    layers: [],        // parcel outlines
    structures: [],    // buildings, floors, allotments
    files: [],         // provenance records
    underlay: null,    // georeferenced raster
    sunStudy: null,
    assertions: [],    // whose case each layer belongs to
  };
}

/* ----------------------------- hashing ----------------------------- */

export async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Record a file's provenance. The bytes are hashed but not retained beyond the
 * session unless the caller keeps them (images are kept as data URLs so the
 * underlay survives a save; documents are not).
 */
export async function recordFile(file, { role = 'source document', keepDataUrl = false } = {}) {
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  const rec = {
    id: uid('file'),
    name: file.name,
    role,
    bytes: file.size,
    mime: file.type || guessMime(file.name),
    sha256: hash,
    ingestedISO: new Date().toISOString(),
    lastModifiedISO: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    dataUrl: null,
  };
  if (keepDataUrl) rec.dataUrl = await bufToDataUrl(buf, rec.mime);
  return { record: rec, buffer: buf };
}

const bufToDataUrl = (buf, mime) => new Promise((res, rej) => {
  const blob = new Blob([buf], { type: mime || 'application/octet-stream' });
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = rej;
  fr.readAsDataURL(blob);
});

function guessMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', txt: 'text/plain', json: 'application/json', csv: 'text/csv' })[ext] || '';
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/* -------------------------- save and load -------------------------- */

const LS_KEY = 'chauhaddi.project.v3';

export function saveLocal(project) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(project));
    return true;
  } catch (e) {
    console.warn('Local save failed (the underlay image is probably too large for localStorage).', e);
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

export function clearLocal() { localStorage.removeItem(LS_KEY); }

export function migrate(p) {
  if (!p || typeof p !== 'object') return emptyProject();
  const base = emptyProject();
  const out = { ...base, ...p, matter: { ...base.matter, ...(p.matter || {}) }, site: { ...base.site, ...(p.site || {}) } };
  out.schemaVersion = SCHEMA_VERSION;
  out.layers ||= []; out.structures ||= []; out.files ||= []; out.assertions ||= [];
  return out;
}

export function downloadBlob(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --------------------- the evidence bundle --------------------- */

/**
 * A manifest of every input, every derived output, and the assumptions that got
 * from one to the other. This is what an expert would need in order to be able
 * to certify the record rather than guess at it.
 */
export function buildManifest(project, derived = {}) {
  return {
    tool: { name: 'Chauhaddi', version: '0.1.0', url: location.href.split('?')[0], schemaVersion: SCHEMA_VERSION },
    generatedISO: new Date().toISOString(),
    matter: project.matter,
    site: project.site,
    inputs: project.files.map(f => ({
      name: f.name, role: f.role, bytes: f.bytes, mime: f.mime,
      sha256: f.sha256, ingestedISO: f.ingestedISO, lastModifiedISO: f.lastModifiedISO,
    })),
    layers: project.layers.map(l => ({
      id: l.id, name: l.name, tier: l.tier, asOf: l.asOf,
      sourceFile: l.sourceFileName || null, sourcePage: l.sourcePage || null,
      method: l.method || null,
      statedAreaSqm: l.statedAreaSqm ?? null,
      computedAreaSqm: l.computedArea ?? null,
      vertexCount: l.polygon?.length ?? 0,
      polygonMetres: l.polygon || null,
      assumptions: l.assumptions || [],
      quotedSchedule: l.rawSchedule || null,
    })),
    structures: project.structures.map(s => ({
      id: s.id, name: s.name, floors: s.floors?.length ?? 0, tier: s.tier || 'D',
      floors_detail: (s.floors || []).map(f => ({ name: f.name, heightM: f.heightM, allottedTo: f.allottedTo || null })),
    })),
    derived,
    limitations: [
      'Every figure produced by this tool is demonstrative. It illustrates evidence; it is not itself evidence of a boundary.',
      'Reconstructions at Tier D are inferred from the words of a document. They do not state where a line runs on the ground.',
      'No output of this tool is a survey. Only a licensed surveyor may certify a measurement.',
      'Overlay alignment is disclosed per layer. A different alignment produces a different overlap.',
    ],
  };
}

/**
 * Draft the s.63 certificate. It is a DRAFT: the two signatures the section
 * requires cannot be supplied by software, and the blanks are left visible on
 * purpose so nobody files it without reading it.
 */
export function s63CertificateDraft(project, manifest) {
  const files = manifest.inputs;
  const lines = [];
  const L = (s = '') => lines.push(s);

  L('CERTIFICATE UNDER SECTION 63(4)(c) OF THE BHARATIYA SAKSHYA ADHINIYAM, 2023');
  L('(Part A and Part B of the Schedule)');
  L('');
  L('*** DRAFT — NOT VALID UNTIL COMPLETED AND SIGNED ***');
  L('');
  L(`Matter        : ${project.matter.title || '[matter]'}`);
  L(`Court         : ${project.matter.court || '[court]'}`);
  L(`Suit / Case No: ${project.matter.suitNo || '[number]'}`);
  L(`Parties       : ${project.matter.parties || '[parties]'}`);
  L(`Generated on  : ${manifest.generatedISO}`);
  L('');
  L('PART A — to be signed by the person in charge of the computer or communication device');
  L('');
  L('I, ____________________________________ [name], ____________________________________ [designation],');
  L('do hereby state on solemn affirmation that:');
  L('');
  L('1. I am the person in lawful control of the device on which the electronic records');
  L('   described in the Schedule below were produced.');
  L('2. The said records were produced in the ordinary course of the preparation of this matter.');
  L('3. The device was operating properly at the material time, and to the best of my knowledge');
  L('   the contents of the said records have not been altered since they were produced.');
  L('4. The hash values set out in the Schedule were computed by the SHA-256 algorithm.');
  L('');
  L('PART B — to be signed by an expert');
  L('');
  L('I, ____________________________________ [name], ____________________________________ [qualification],');
  L('having examined the electronic records described in the Schedule, certify that the hash values');
  L('stated therein correspond to those records.');
  L('');
  L('SCHEDULE — ELECTRONIC RECORDS AND HASH VALUES');
  L('');

  if (!files.length) {
    L('  (No source files were ingested. Records prepared wholly from typed input —');
    L('   this must be stated expressly rather than left blank.)');
  } else {
    files.forEach((f, i) => {
      L(`  ${i + 1}. ${f.name}`);
      L(`     Role        : ${f.role}`);
      L(`     Size        : ${f.bytes} bytes`);
      L(`     Media type  : ${f.mime || 'unknown'}`);
      L(`     SHA-256     : ${f.sha256}`);
      L(`     Ingested    : ${f.ingestedISO}`);
      L('');
    });
  }

  L('DERIVED OUTPUTS');
  L('');
  manifest.layers.forEach((l, i) => {
    L(`  ${String.fromCharCode(97 + i)}) ${l.name}  [accuracy tier ${l.tier}]`);
    L(`     Method            : ${l.method || 'manual entry'}`);
    L(`     Source            : ${l.sourceFile ? `${l.sourceFile}${l.sourcePage ? `, page ${l.sourcePage}` : ''}` : 'typed input'}`);
    L(`     Computed area     : ${l.computedAreaSqm != null ? l.computedAreaSqm.toFixed(4) + ' m²' : '—'}`);
    if (l.assumptions?.length) {
      L('     Assumptions relied on:');
      l.assumptions.forEach(a => L(`       - ${wrap(a, 74, '         ')}`));
    }
    L('');
  });

  L('LIMITATIONS RECORDED BY THE TOOL');
  L('');
  manifest.limitations.forEach(x => L(`  - ${wrap(x, 76, '    ')}`));
  L('');
  L('Signed at ______________________ on ______________________');
  L('');
  L('Part A: ____________________          Part B: ____________________');
  L('        (person in charge)                    (expert)');
  L('');

  return lines.join('\n');
}

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const out = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n' + indent);
}
