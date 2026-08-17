// scene3d.js — the viewport.
//
// Deliberately plain: flat grey masses, hairline outlines, no textures, no sky,
// no camera swoops. A model that looks like an architect's marketing render is
// a liability in cross-examination. Everything carries a dimension label and a
// tier badge instead.
//
// Scene axes:  +x East,  +y Up,  +z South.
// A plan point {x: east, y: north} in metres maps to (x, height, -y).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { fmtFtIn, fmtSqFt } from './units.js';
import { centroid, bbox, dist } from './geom.js';

export const TIER_COLOR = {
  A: 0x2f6f4e,   // instrument survey — green
  B: 0x2a4c63,   // plan / FMB — survey blue
  C: 0x7e7038,   // cadastral portal — brass
  D: 0x6b6f73,   // deed reconstruction — neutral grey
  E: 0x7a5a86,   // imagery — muted violet
};
export const DISPUTE_COLOR = 0xa33a2c;

const P = (p, h = 0) => new THREE.Vector3(p.x, h, -p.y);

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe6e9e4);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
    this.camera.position.set(24, 20, 30);

    // The camera lives inside a player group so that VR locomotion can move
    // the whole rig without fighting the XR pose.
    this.player = new THREE.Group();
    this.player.add(this.camera);
    this.scene.add(this.player);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // lighting: one sun plus a flat ambient. No fill lights, no rim light.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9aa39c, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 400;
    const S = 80;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = this.#buildGround();
    this.scene.add(this.ground);

    // Everything that represents the matter lives inside `world`. Rotating it
    // applies a magnetic-north offset without touching a single stored
    // coordinate; scaling it gives the tabletop VR mode.
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.northArrow = this.#buildNorthArrow();
    this.world.add(this.northArrow);

    // content groups, cleared and rebuilt on every state change
    this.layerGroup = new THREE.Group();
    this.structureGroup = new THREE.Group();
    this.disputeGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.underlayGroup = new THREE.Group();
    this.world.add(this.layerGroup, this.structureGroup, this.disputeGroup, this.labelGroup, this.underlayGroup);

    this.raycaster = new THREE.Raycaster();
    this.showLabels = true;
    this.labelMode = 'selected';   // 'selected' | 'all' | 'off'
    this.labelScale = 1;       // set from the content extent — see setContentScale
    this.vrScale = 1;          // 1 = walk it at full size; 50 = tabletop model
    this.xrControllers = [];
    this.#initXR();

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    this.resize();

    this.renderer.setAnimationLoop((t, frame) => this.#tick(t, frame));
  }

  /* ------------------------------ chrome ------------------------------ */

  #buildGround() {
    const g = new THREE.Group();
    const grid = new THREE.GridHelper(400, 400, 0xb9c0b7, 0xd2d7cf);  // 1 m cells
    grid.position.y = -0.005;
    g.add(grid);
    const coarse = new THREE.GridHelper(400, 40, 0x8d968c, 0x8d968c);  // 10 m cells
    coarse.position.y = -0.004;
    g.add(coarse);

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    g.add(plane);
    return g;
  }

  #buildNorthArrow() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a4c63 });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 3.2), mat);
    shaft.position.set(0, 0.02, -1.6);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.0, 4), mat);
    head.position.set(0, 0.02, -3.6);
    head.rotation.x = -Math.PI / 2;
    g.add(shaft, head);
    g.add(makeLabel('N', { size: 44, color: '#2a4c63' }, 1.1).translateY(0.5).translateZ(-4.6));
    return g;
  }

  setNorthOffset(deg) {
    // Rotating the world instead of the data keeps every stored coordinate true.
    this.world.rotation.y = -(deg || 0) * Math.PI / 180;
  }

  /**
   * Sprite labels are sized in world units, so a fixed height that reads well
   * on a 200 m field buries a 12 m urban plot. Derive the size from the content
   * before drawing anything, and park the north arrow clear of the geometry.
   */
  setContentScale(points) {
    if (!points?.length) {
      this.labelScale = 1;
      this._contentSpan = 20;
      this.northArrow.scale.setScalar(1);
      this.northArrow.position.set(0, 0, 0);
      return;
    }
    const b = bbox(points);
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 2);
    this._contentSpan = span;
    this.labelScale = clamp(span / 52, 0.05, 3);
    this.northArrow.scale.setScalar(clamp(span / 18, 0.15, 3));
    this.northArrow.position.set(b.maxX + span * 0.14, 0, -(b.maxY + span * 0.02));
  }

  /* ------------------------------ parcels ------------------------------ */

  setLayers(layers, { selectedId = null } = {}) {
    clearGroup(this.layerGroup);
    clearGroup(this.labelGroup);
    if (!layers?.length) return;

    layers.forEach((layer, i) => {
      if (layer.hidden || !layer.polygon || layer.polygon.length < 3) return;
      const color = TIER_COLOR[layer.tier] ?? 0x6b6f73;
      const isSel = layer.id === selectedId;
      const pts = layer.polygon;
      const y = 0.002 + i * 0.004;      // stack so coincident edges stay visible

      // fill
      const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.y)));
      const fillGeo = new THREE.ShapeGeometry(shape);
      fillGeo.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: isSel ? 0.20 : 0.10,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      fill.position.y = y;
      this.layerGroup.add(fill);

      // outline — dashed for the inferred tiers, solid for measured ones
      const inferred = layer.tier === 'D' || layer.tier === 'C';
      const loop = [...pts, pts[0]].map(p => P(p, y + 0.001));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(loop);
      let line;
      if (inferred) {
        line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({
          color, dashSize: 0.6, gapSize: 0.35, linewidth: 1,
          transparent: true, opacity: isSel ? 1 : 0.75,
        }));
        line.computeLineDistances();   // a Line method, not a geometry one
      } else {
        line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
          color, transparent: true, opacity: isSel ? 1 : 0.8,
        }));
      }
      this.layerGroup.add(line);

      // vertex markers on the selected layer only
      if (isSel) {
        pts.forEach(p => {
          const m = new THREE.Mesh(
            new THREE.SphereGeometry(Math.max(0.04, 0.16 * this.labelScale), 12, 8),
            new THREE.MeshBasicMaterial({ color }),
          );
          m.position.copy(P(p, y + 0.02));
          this.layerGroup.add(m);
        });
      }

      if (this.labelMode !== 'off') this.#addEdgeLabels(pts, y, color, isSel, layer, i);
    });
  }

  #addEdgeLabels(pts, y, color, isSel, layer, index = 0) {
    const hex = '#' + new THREE.Color(color).getHexString();
    const s = this.labelScale;
    const c = centroid(pts);
    const b = bbox(pts);

    // Dimensions belong to the outline you are working on. Four overlapping
    // outlines dimensioned at once is sixteen labels fighting over the same
    // few metres of screen.
    if (isSel) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], q = pts[(i + 1) % pts.length];
        const len = dist(a, q);
        if (len < 0.4) continue;
        const mid = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 };
        // push the label clear of the boundary, away from the centroid
        const ox = mid.x - c.x, oy = mid.y - c.y;
        const on = Math.hypot(ox, oy) || 1;
        const off = s * 2.6;
        const pos = { x: mid.x + (ox / on) * off, y: mid.y + (oy / on) * off };
        const sprite = makeLabel(fmtFtIn(len), { size: 30, color: hex, bg: 'rgba(236,238,234,0.86)' }, 1.0 * s);
        sprite.position.copy(P(pos, y + 0.35 * s));
        this.labelGroup.add(sprite);
      }
    }

    // Name only the selected outline, and put the name outside the plot rather
    // than over the middle of it, where the building and every other label sit.
    // The sidebar already names all of them with their tiers.
    if (this.labelMode === 'all' || isSel) {
      const nm = makeLabel(`${layer.name} · ${layer.tier}`,
        { size: 30, color: hex, bg: 'rgba(236,238,234,0.9)', bold: true }, 1.15 * s);
      nm.position.copy(P({ x: c.x, y: b.minY - s * (4.2 + index * 2.2) }, y + 0.4 * s));
      this.labelGroup.add(nm);
    }
  }

  /** Shade the area two outlines disagree about. */
  setDispute(intersectionPoly, { label = null } = {}) {
    clearGroup(this.disputeGroup);
    if (!intersectionPoly || intersectionPoly.length < 3) return;
    const shape = new THREE.Shape(intersectionPoly.map(p => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: DISPUTE_COLOR, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false,
    }));
    mesh.position.y = 0.05;
    this.disputeGroup.add(mesh);

    const loop = [...intersectionPoly, intersectionPoly[0]].map(p => P(p, 0.052));
    this.disputeGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(loop),
      new THREE.LineBasicMaterial({ color: DISPUTE_COLOR }),
    ));

    if (label) {
      const db = bbox(intersectionPoly);
      const lab = makeLabel(label, { size: 34, color: '#a33a2c', bg: 'rgba(239,223,219,0.94)', bold: true }, 1.4 * this.labelScale);
      lab.position.copy(P(
        { x: db.minX - this.labelScale * 5.5, y: (db.minY + db.maxY) / 2 },
        0.9 * this.labelScale,
      ));
      this.disputeGroup.add(lab);
    }
  }

  /* ---------------------------- structures ---------------------------- */

  /**
   * Each structure is a footprint plus a stack of floors. This is what carries
   * a partition of a multi-storey house, or the floor-sharing in a JDA.
   */
  setStructures(structures, { selectedId = null, hideObstructions = false } = {}) {
    clearGroup(this.structureGroup);
    this.obstructionMeshes = [];
    if (!structures?.length) return;

    structures.forEach((st) => {
      if (st.hidden) return;
      if (hideObstructions && st.isObstruction) return;
      if (!st.footprint || st.footprint.length < 3) return;

      const shape = new THREE.Shape(st.footprint.map(p => new THREE.Vector2(p.x, p.y)));
      let base = st.baseM || 0;

      (st.floors || []).forEach((fl, fi) => {
        const h = Math.max(0.1, fl.heightM || 3);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, base, 0);

        const isSel = st.id === selectedId;
        const col = fl.color != null ? fl.color
          : st.isObstruction ? 0x8f8f93
          : shadeFor(fl.allottedTo, fi);

        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
          color: col, transparent: !!st.transparent, opacity: st.transparent ? 0.5 : 1,
        }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { structureId: st.id, floorIndex: fi, isObstruction: !!st.isObstruction };
        this.structureGroup.add(mesh);
        if (st.isObstruction) this.obstructionMeshes.push(mesh);

        // hairline edges — this is what keeps it reading as a drawing
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo, 25),
          new THREE.LineBasicMaterial({ color: isSel ? 0x151a17 : 0x4a534d, transparent: true, opacity: isSel ? 0.95 : 0.6 }),
        );
        this.structureGroup.add(edges);

        // Floor labels sit off the east face at each floor's mid-height, so they
        // read like a section annotation instead of hovering inside the mass.
        // Always shown unless labels are off: in a partition, who holds which
        // floor is the entire question. An obstruction's internal floors are not
        // the question, so it gets no per-floor labels — only its overall mass.
        if (this.labelMode !== 'off' && !st.isObstruction && (fl.name || fl.allottedTo)) {
          const txt = [fl.name, fl.allottedTo ? `→ ${fl.allottedTo}` : null].filter(Boolean).join('   ');
          const fb = bbox(st.footprint);
          const lab = makeLabel(txt, { size: 28, color: '#151a17', bg: 'rgba(236,238,234,0.9)' }, 1.05 * this.labelScale);
          // Offset by half the label's own width so the whole of it clears the
          // wall. Guessing a fixed distance left long names half-buried, because
          // a sprite is centred on its position and these vary a lot in width.
          lab.position.copy(P(
            { x: fb.maxX + lab.scale.x / 2 + this.labelScale * 1.1, y: (fb.minY + fb.maxY) / 2 },
            base + h / 2,
          ));
          this.structureGroup.add(lab);
        }
        base += h;
      });

      if (st.isObstruction && this.labelMode !== 'off') {
        const c = centroid(st.footprint);
        const lab = makeLabel(`${st.name} (obstruction)`, { size: 28, color: '#a33a2c', bg: 'rgba(239,223,219,0.92)', bold: true }, 1.3 * this.labelScale);
        lab.position.copy(P(c, base + 2.2 * this.labelScale));
        this.structureGroup.add(lab);
      }
    });
  }

  /* ----------------------------- underlay ----------------------------- */

  /** An FMB sketch, sanctioned plan or cadastral extract, fitted by hand. */
  setUnderlay(underlay) {
    clearGroup(this.underlayGroup);
    if (!underlay?.dataUrl) return;
    const loader = new THREE.TextureLoader();
    loader.load(underlay.dataUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = (tex.image?.width || 1) / (tex.image?.height || 1);
      const w = underlay.widthM || 30;
      const h = w / aspect;
      const geo = new THREE.PlaneGeometry(w, h);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: underlay.opacity ?? 0.6,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -(underlay.rotDeg || 0) * Math.PI / 180;
      mesh.position.set(underlay.dx || 0, 0.001, -(underlay.dy || 0));
      clearGroup(this.underlayGroup);
      this.underlayGroup.add(mesh);
    }, undefined, () => console.warn('Underlay image failed to load.'));
  }

  /* -------------------------------- sun -------------------------------- */

  setSun(altitudeDeg, azimuthDeg, { distance = 120 } = {}) {
    const alt = altitudeDeg * Math.PI / 180, az = azimuthDeg * Math.PI / 180;
    const horiz = Math.cos(alt);
    const v = new THREE.Vector3(horiz * Math.sin(az), Math.sin(alt), -horiz * Math.cos(az));
    this.sunDir = v.clone();
    this.sun.position.copy(v.multiplyScalar(distance));
    this.sun.target.position.set(0, 0, 0);
    const up = Math.max(0, Math.sin(alt));
    this.sun.intensity = altitudeDeg > 0 ? 0.35 + 1.15 * up : 0;
    this.hemi.intensity = altitudeDeg > 0 ? 0.55 + 0.35 * up : 0.35;
  }

  /**
   * Is the sun visible from a point, or is an obstruction in the way?
   * Used to count minutes of direct sunlight at a window for a s.15 claim.
   */
  isSunVisibleFrom(pointLocal, altitudeDeg, azimuthDeg) {
    if (altitudeDeg <= 0) return false;
    const targets = (this.obstructionMeshes || []);
    if (!targets.length) return true;

    const alt = altitudeDeg * Math.PI / 180, az = azimuthDeg * Math.PI / 180;
    const horiz = Math.cos(alt);
    const dir = new THREE.Vector3(horiz * Math.sin(az), Math.sin(alt), -horiz * Math.cos(az)).normalize();

    // The point arrives in data space (+x East, +y Up, +z South, pre-rotation);
    // the meshes are raycast in world space, so push it through `world` first.
    this.world.updateMatrixWorld(true);
    const origin = new THREE.Vector3(pointLocal.x, pointLocal.y, pointLocal.z)
      .applyMatrix4(this.world.matrixWorld)
      .add(dir.clone().multiplyScalar(0.08));   // step off the surface

    this.raycaster.set(origin, dir);
    this.raycaster.far = 500;
    return this.raycaster.intersectObjects(targets, false).length === 0;
  }

  /* ------------------------------ cameras ------------------------------ */

  frame(points, { pad = 1.5 } = {}) {
    if (!points?.length) return;
    const b = bbox(points);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 8) * pad;
    this._contentSpan = span;
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx + span * 0.7, span * 0.85, -cy + span * 0.9);
    this.controls.update();
  }

  view(preset, points) {
    const b = points?.length ? bbox(points) : { minX: -15, maxX: 15, minY: -15, maxY: 15 };
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10);
    this.controls.target.set(cx, 0, -cy);
    if (preset === 'plan') {
      this.camera.position.set(cx, span * 1.9, -cy + 0.01);
    } else if (preset === 'eye') {
      this.camera.position.set(cx + span * 0.9, 1.65, -cy + span * 0.9);
      this.controls.target.set(cx, 1.65, -cy);
    } else if (preset === 'north') {
      this.camera.position.set(cx, span * 0.5, -cy - span * 1.7);
    } else {
      this.camera.position.set(cx + span * 0.8, span * 0.8, -cy + span * 1.0);
    }
    this.controls.update();
  }

  /* -------------------------------- XR -------------------------------- */

  #initXR() {
    const btn = VRButton.createButton(this.renderer);
    btn.classList.add('vr-button');
    this.vrButton = btn;

    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x2a4c63 }),
      );
      ray.scale.z = 4;
      c.add(ray);
      this.player.add(c);
      this.xrControllers.push(c);
    }

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.inXR = true;
      this.player.rotation.y = 0;
      this.#applyVrScale();
      this.#showXrHint();
      document.body.classList.add('in-xr');
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.inXR = false;
      if (this._xrHint) { this.player.remove(this._xrHint); this._xrHint = null; }
      this.player.position.set(0, 0, 0);
      this.player.rotation.y = 0;
      this.world.scale.setScalar(1);
      this.world.position.y = 0;
      this.ground.visible = true;
      document.body.classList.remove('in-xr');
    });
  }

  /**
   * A control hint that lives in the scene, because in an immersive session
   * there is no DOM to put it in. Sits at eye height ahead of the player and
   * fades after a few seconds so it does not clutter the picture.
   */
  #showXrHint() {
    if (this._xrHint) { this.player.remove(this._xrHint); this._xrHint = null; }
    const hint = makeLabel(
      'left stick move  ·  right stick turn  ·  Y / B add a document (leaves VR)',
      { size: 26, color: '#151a17', bg: 'rgba(236,238,234,0.94)' }, 0.09);
    hint.position.set(0, -0.22, -1.1);
    this.player.add(hint);
    this._xrHint = hint;
    const started = performance.now();
    const fade = () => {
      if (this._xrHint !== hint) return;
      const t = (performance.now() - started) / 1000;
      if (t > 9) { this.player.remove(hint); this._xrHint = null; return; }
      hint.material.opacity = t > 6 ? Math.max(0, 1 - (t - 6) / 3) : 1;
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  /**
   * 1:1 puts you inside the parcel at true size — the reason to own a headset,
   * and the thing a screen genuinely cannot do. Any other denominator shrinks
   * the whole matter onto a table you can lean over.
   */
  setVrScale(denominator) {
    this.vrScale = Math.max(1, denominator || 1);
    this.#applyVrScale();
  }

  #applyVrScale() {
    // Scale the content, not the player: scaling the player would put your eyes
    // 80 m above a 1:50 model instead of comfortably over a table.
    const s = 1 / this.vrScale;
    this.world.scale.setScalar(s);
    this.world.position.y = this.vrScale > 1 ? 0.95 : 0;   // table height
    this.ground.visible = this.vrScale === 1;
    if (this.vrScale > 1) {
      // stand back from the table rather than inside the model
      const span = this._contentSpan || 20;
      this.player.position.set(0, 0, (span * s) * 0.9 + 0.6);
    } else {
      this.player.position.set(0, 0, 0);
    }
  }

  #xrLocomotion(dt) {
    const session = this.renderer.xr.getSession?.();
    if (!session) return;
    let moveX = 0, moveZ = 0, turn = 0, upperFace = false;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      // Y on the left controller, B on the right. Nothing else in this app uses
      // it, and it is hard to hit by accident while driving a thumbstick.
      if (gp.buttons?.[5]?.pressed) upperFace = true;
      if (gp.axes.length < 4) continue;
      const [, , ax, ay] = gp.axes;
      if (src.handedness === 'left') { moveX += dz(ax); moveZ += dz(ay); }
      else { turn += dz(ax); }
    }

    // A file picker is 2D system UI and cannot be composited into an immersive
    // session, so the only honest way to add a document from inside VR is to
    // leave, pick it, and come back. Edge-triggered so a held button fires once.
    if (upperFace && !this._upperFaceWas) this.onExitForFile?.();
    this._upperFaceWas = upperFace;

    if (!moveX && !moveZ && !turn) return;

    const speed = 2.2 * this.vrScale * dt;   // walk faster when the world is bigger
    if (turn) this.player.rotation.y -= turn * 1.6 * dt;
    if (moveX || moveZ) {
      const xrCam = this.renderer.xr.getCamera();
      const fwd = new THREE.Vector3();
      xrCam.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      this.player.position.addScaledVector(fwd, -moveZ * speed);
      this.player.position.addScaledVector(right, moveX * speed);
    }
  }

  /* ------------------------------ plumbing ------------------------------ */

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #tick(time, frame) {
    const dt = Math.min(0.05, (time - (this._last || time)) / 1000) || 0.016;
    this._last = time;
    if (this.inXR) this.#xrLocomotion(dt);
    else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** End the immersive session, if one is running. */
  endXR() {
    try { this.renderer.xr.getSession?.()?.end(); } catch { /* already gone */ }
  }

  snapshotPNG() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  setTheme(dark) {
    this.scene.background = new THREE.Color(dark ? 0x161b18 : 0xe6e9e4);
  }

  dispose() {
    removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}

const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function shadeFor(allottedTo, i) {
  if (!allottedTo) return [0x9aa39c, 0xa8b0a8, 0x8f9890][i % 3];
  let h = 0;
  for (const ch of String(allottedTo)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const c = new THREE.Color();
  c.setHSL(h / 360, 0.24, 0.56);
  return c.getHex();
}

function clearGroup(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    g.remove(c);
    c.geometry?.dispose?.();
    if (c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
    }
  }
}

/** A text sprite drawn on a canvas — cheap, sharp, and always faces the camera. */
function makeLabel(text, { size = 32, color = '#151a17', bg = null, bold = false } = {}, worldHeight = 1.4) {
  const pad = Math.round(size * 0.35);
  const font = `${bold ? '600 ' : ''}${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const w = Math.ceil(meas.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.45);

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  // depthTest stays ON so a label behind a wall is hidden by the wall. With it
  // off, every label in the scene printed over every solid, which is what made
  // the picture look like a pile of floating stickers.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
  }));
  sprite.scale.set((w / h) * worldHeight, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}
