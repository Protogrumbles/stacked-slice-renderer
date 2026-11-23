#!/usr/bin/env node
// Headless tests for the slice maths in index.html.
// No dependencies, no browser, no network.
// Strategy: read index.html, extract the single <script> block,
// syntax-check it with `node --check` (done by the shell wrapper, or
// run: node --check on the extracted file), then execute it in a VM
// with `module` stubbed and no `document`, and assert on the pure
// functions. The render loop never starts headlessly because the
// script guards all DOM access behind `typeof document`.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// 1. Zero network requests: no src=, href= to http, no @import, no fetch/XHR.
for (const pattern of [/src\s*=\s*["']https?:/, /href\s*=\s*["']https?:/,
                       /@import/i, /\bfetch\s*\(/, /XMLHttpRequest/]) {
  assert(!pattern.test(html), `index.html must make zero network requests (matched ${pattern})`);
}
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.strictEqual(scripts.length, 1, "expected exactly one inline <script> block");
const js = scripts[0][1];

// 2. Syntax check is done by the caller via node --check on a temp file;
//    here we just need it to parse.
const moduleStub = { exports: {} };
const sandbox = { module: moduleStub, console };
vm.createContext(sandbox);
vm.runInContext(js, sandbox, { filename: "index.html <script>" });
const m = moduleStub.exports;
assert(m.sliceDepth, "exports missing — script did not run headlessly");

// 3. sliceDepth: 0 at horizon, 1 at bottom, clamped outside.
assert.strictEqual(m.sliceDepth(70, 70, 180), 0);
assert.strictEqual(m.sliceDepth(180, 70, 180), 1);
assert.strictEqual(m.sliceDepth(125, 70, 180), 0.5);
assert.strictEqual(m.sliceDepth(0, 70, 180), 0);
assert.strictEqual(m.sliceDepth(999, 70, 180), 1);

// 4. sliceOffset: near slices move more than far ones (parallax), and
//    the offset is a finite number that changes with time.
const chase = m.CAMERA_PARAMS.chase;
const far = Math.abs(m.sliceOffset(72, 1.0, chase));
const near = Math.abs(m.sliceOffset(178, 1.0, chase));
assert(Number.isFinite(far) && Number.isFinite(near));
assert(near > far, `near slice should swing more than far slice (${near} vs ${far})`);
assert.notStrictEqual(m.sliceOffset(150, 1.0, chase), m.sliceOffset(150, 2.0, chase));

// 5. sliceTextureOffset: wraps to [0,16), near scrolls faster than far.
for (const t of [0, 0.5, 3.7, 100]) {
  const o = m.sliceTextureOffset(150, t, 1.0, chase);
  assert(o >= 0 && o < 16, `texture offset out of range: ${o}`);
}
const texFar = m.sliceTextureOffset(72, 1.0, 1.0, chase);
const texNear = m.sliceTextureOffset(178, 1.0, 1.0, chase);
assert(texNear > texFar, "near texture should have scrolled further than far");

// 6. oceanColor: bright blue at horizon, brighter near; returns valid RGB.
const deep = m.oceanColor(0), shallow = m.oceanColor(1);
assert.deepEqual(deep, [16, 96, 180]);
assert(shallow[1] > deep[1] && shallow[0] > deep[0], "shallow water should be brighter");
for (const c of [m.oceanColor(0), m.oceanColor(0.5), m.oceanColor(1)]) {
  assert(c.length === 3 && c.every((v) => v >= 0 && v <= 255));
}

// 7. projectIsland: far island near the horizon and small; near island
//    low on screen and large; out-of-range islands not visible.
const farI = m.projectIsland({ x: 0, z: 95, r: 16, h: 14 }, chase);
const nearI = m.projectIsland({ x: 0, z: 5, r: 16, h: 14 }, chase);
assert(farI.visible && nearI.visible);
assert(farI.y < nearI.y, "far island should sit higher (nearer horizon)");
assert(farI.r < nearI.r && farI.h < nearI.h, "far island should be smaller");
assert.strictEqual(m.projectIsland({ x: 0, z: 0, r: 16, h: 14 }, chase).visible, false);
assert.strictEqual(m.projectIsland({ x: 0, z: 150, r: 16, h: 14 }, chase).visible, false);
assert(Math.abs(nearI.x - 160) < 1, "centred island should project to screen centre");

// 8. Camera cycle: chase -> overhead -> cockpit -> chase.
assert.strictEqual(m.nextCamera("chase"), "overhead");
assert.strictEqual(m.nextCamera("overhead"), "cockpit");
assert.strictEqual(m.nextCamera("cockpit"), "chase");

// 9. hash01: deterministic and in [0,1).
assert.strictEqual(m.hash01(42), m.hash01(42));
assert(m.hash01(42) >= 0 && m.hash01(42) < 1);
assert.notStrictEqual(m.hash01(1), m.hash01(2));

// 10. step() advances time and moves islands forward, headlessly
//     (no canvas: step returns after updating state).
const zBefore = m.ISLANDS[0].z;
const tBefore = m.state.time;
m.step(0.5);
assert(m.state.time > tBefore, "step should advance time");
assert(m.ISLANDS[0].z < zBefore, "step should move islands towards the camera");

// 11. Camera params: all three cameras present with distinct horizons.
assert.deepEqual(m.CAMERAS, ["chase", "overhead", "cockpit"]);
assert.strictEqual(Object.keys(m.CAMERA_PARAMS).length, 3);
assert(m.CAMERA_PARAMS.overhead.horizonY < m.CAMERA_PARAMS.chase.horizonY);

// 12. Render path with a stubbed DOM: step() must draw without throwing
//     for every camera, and cycleCamera() must change the rendered view.
{
  const calls = [];
  const ctxStub = new Proxy({}, { get: (t, k) => {
    if (k === "fillStyle") { return t.fillStyle; }
    return (...a) => { calls.push(String(k)); };
  }, set: (t, k, v) => { t[k] = v; return true; } });
  const canvasStub = { getContext: () => ctxStub };
  const labelStub = { textContent: "" };
  const listeners = {};
  const docStub = {
    getElementById: (id) => (id === "scene" ? canvasStub : labelStub),
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  const rafCalls = [];
  const module2 = { exports: {} };
  const sandbox2 = { module: module2, console, document: docStub,
                     requestAnimationFrame: (fn) => { rafCalls.push(fn); } };
  vm.createContext(sandbox2);
  vm.runInContext(js, sandbox2, { filename: "index.html <script> (DOM stub)" });
  const m2 = module2.exports;
  assert.strictEqual(rafCalls.length, 1, "animation loop should have started once");
  for (const cam of ["chase", "overhead", "cockpit"]) {
    assert.strictEqual(m2.state.camera, cam);
    calls.length = 0;
    m2.step(0.1);
    assert(calls.includes("fillRect"), `step() should draw in ${cam} camera`);
    assert(m2.state.time > 0);
    m2.cycleCamera();
  }
  assert.strictEqual(m2.state.camera, "chase", "three cycles should return to chase");
  // Space key cycles the camera via the registered listener.
  listeners.keydown({ code: "Space", preventDefault: () => {} });
  assert.strictEqual(m2.state.camera, "overhead");
  // ArrowUp now dives (reference control scheme), it no longer
  // changes speed; W is the thrust key.
  const altBefore = m2.state.altitude;
  listeners.keydown({ code: "ArrowUp", preventDefault: () => {} });
  m2.step(0.1);
  assert(m2.state.altitude < altBefore, "ArrowUp should dive (altitude down)");
  listeners.keyup({ code: "ArrowUp", preventDefault: () => {} });
  listeners.keydown({ code: "KeyW", preventDefault: () => {} });
  const speedBefore = m2.state.speed;
  m2.step(0.5);
  assert(m2.state.speed > speedBefore, "holding W should increase speed (thrust)");
  listeners.keyup({ code: "KeyW", preventDefault: () => {} });
}

// 13. Reference params: the published values are present and exact.
assert.strictEqual(m.REF.thrusterBoost, 1.8);
assert.strictEqual(m.REF.bankMaxDeg, 52);
assert.strictEqual(m.REF.ceiling, 300);
assert.strictEqual(m.REF.cruiseAltitude, 110);
assert.strictEqual(m.REF.groundClearance, 7);
assert.strictEqual(m.REF.viewChangeS, 1.4);
assert.strictEqual(m.REF.chaseDistance, 2.6);
assert.strictEqual(m.REF.chaseHeightDeg, 12);
assert.strictEqual(m.REF.cloudDensity, 0.45);
assert.strictEqual(m.REF.islandDensity, 0.33);
assert.deepEqual(m.REF.jetColours,
  { body: "#545969", accent: "#f0580e", canopy: "#1e8ca0" });

// 14. Jet width: ~2-3% of screen width (reference: ~2-3%).
{
  const w = m.jetWidthPx();
  const pct = (w / m.CANVAS_WIDTH) * 100;
  assert(pct >= 2 && pct <= 3, `chase jet width ${w}px = ${pct.toFixed(1)}% of screen (want 2-3%)`);
  assert.strictEqual(m.JET_SLICES.length, 13, "voxel jet has 13 slices");
  assert(m.JET_SLICES.some((s) => s.role === "canopy"), "jet has canopy slices");
  assert(m.JET_SLICES.some((s) => s.role === "engine"), "jet has an engine slice");
  assert(m.JET_SLICES.some((s) => s.wing > 0), "jet has wing slices");
}

// 15. Clouds exist, are density-gated, and advance with step().
{
  const active = m.CLOUDS.filter((c) => c.active).length;
  assert(active > 0 && active < m.CLOUDS.length,
    `some but not all cloud slots active (density 0.45): ${active}/${m.CLOUDS.length}`);
  const zBefore = m.CLOUDS[0].z;
  m.step(0.5);
  assert(m.CLOUDS[0].z < zBefore, "clouds should advance toward the camera");
}

// 16. Altitude: clamps to ground clearance / ceiling; sky darkens
//     above ~120 and stars appear.
assert.strictEqual(m.skyDarkness(110), 0);
assert(m.skyDarkness(119) === 0, "no darkening below 120");
assert(m.skyDarkness(220) >= 0.7 - 1e-9, "full darkening by 220");
assert(m.skyDarkness(170) > 0 && m.skyDarkness(170) < 0.7, "partial darkening at 170");
assert.strictEqual(m.altScale(110) > 0.5 && m.altScale(110) <= 1.15, true);

// 17. Camera transitions: 1.4 s blend; params blend between cameras.
{
  m.state.camera = "chase"; m.state.camFrom = "chase";
  m.state.camTo = "chase"; m.state.camT = 1;
  m.cycleCamera();
  assert.strictEqual(m.state.camTo, "overhead");
  assert.strictEqual(m.state.camT, 0);
  const mid = m.currentCameraParams();
  // At t=0 the effective camera is still the "from" view.
  assert.strictEqual(mid.camera, "chase");
  m.step(0.7);   // halfway through the 1.4 s transition
  const half = m.currentCameraParams();
  assert(half.horizonY > m.CAMERA_PARAMS.chase.horizonY ||
         half.horizonY < m.CAMERA_PARAMS.chase.horizonY,
    "horizon should be blending mid-transition");
  m.step(0.8);   // past 1.4 s total
  assert.strictEqual(m.state.camT, 1);
  assert.strictEqual(m.currentCameraParams().camera, "overhead");
}

// 18. Pixel size: default 3 (as published), settable 1..6.
assert.strictEqual(m.getPixelSize(), 3);
assert.strictEqual(m.setPixelSize(6), 6);
assert.strictEqual(m.setPixelSize(99), 6, "pixel size clamps at 6");
assert.strictEqual(m.setPixelSize(0), 1, "pixel size clamps at 1");
assert.strictEqual(m.setPixelSize(3), 3);

// 19. Flight model: steering changes heading and bank; roll starts.
{
  m.state.heading = 0; m.state.bank = 0; m.state.rollT = 0;
  m.keys["ArrowRight"] = true;
  m.step(0.5);
  assert(m.state.heading > 0, "ArrowRight should turn the jet (heading increases)");
  assert(m.state.bank > 0, "turning right should bank right");
  m.keys["ArrowRight"] = false;
  m.startRoll();
  assert.strictEqual(m.state.rollT, 0.5, "roll should last 0.5 s");
  m.step(0.6);
  assert.strictEqual(m.state.rollT, 0, "roll should finish");
  // Afterburner multiplies effective speed by 1.8.
  m.state.speed = 1.0; m.state.afterburner = false;
  const base = m.effectiveSpeed();
  m.state.afterburner = true;
  assert.strictEqual(m.effectiveSpeed(), base * 1.8);
  m.state.afterburner = false;
}

// 20. Render probe: record what step() actually draws, per camera.
//     A recording stub context captures every fillRect/fillText with
//     its fillStyle, so the probe measures the picture, not the code.
function probeRender(opts) {
  opts = opts || {};  const rects = [];   // {x, y, w, h, style}
  const texts = [];   // {text, style}
  let currentStyle = "";
  const ctxProbe = {
    get fillStyle() { return currentStyle; },
    set fillStyle(v) { currentStyle = v; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, style: currentStyle }); },
    clearRect() {},
    fillText(text) { texts.push({ text, style: currentStyle }); },
    beginPath() {}, closePath() {}, fill() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {},
    arc() {}, clip() {}, moveTo() {}, lineTo() {},
  };
  const canvasStub = { getContext: () => ctxProbe, style: {} };
  const labelStub = { textContent: "" };
  const listeners = {};
  const docStub = {
    getElementById: (id) => (id === "scene" ? canvasStub : labelStub),
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  const module3 = { exports: {} };
  const sandbox3 = { module: module3, console, document: docStub,
                     requestAnimationFrame: () => {}, Date };
  vm.createContext(sandbox3);
  vm.runInContext(js, sandbox3, { filename: "index.html <script> (probe)" });
  const p = module3.exports;
  const out = {};
  for (const cam of ["chase", "overhead", "cockpit"]) {
    // Force the camera (bypass the 1.4 s transition for measurement).
    p.state.camera = cam; p.state.camFrom = cam; p.state.camTo = cam; p.state.camT = 1;
    p.state.altitude = (opts.altitude === undefined) ? 110 : opts.altitude;
    p.state.bank = (opts.bank === undefined) ? 0 : opts.bank;
    p.state.thrust = (opts.thrust === undefined) ? true : opts.thrust;
    // step() derives thrust from input, so hold W to keep it.
    p.keys["KeyW"] = (opts.thrust === undefined) ? true : !!opts.thrust;
    p.state.speed = 1.0; p.state.afterburner = false; p.state.time = 5;
    rects.length = 0; texts.length = 0;
    p.step(0.016);   // one frame: bank/transition barely decay, so the
                     // probe measures the state it was given
    out[cam] = { rects: rects.slice(), texts: texts.slice() };
  }
  return { p, out };
}
{
  const { p, out } = probeRender();
  // Chase: the voxel jet must be drawn in the reference colours and
  // at ~2-3% of screen width.
  const chase = out.chase.rects;
  // The jet occupies rows base-26..base (base = 162); its colours are
  // body, wing grey, accent tips and canopy — measure the full extent
  // including wings, not just the hull.
  const JET_COLOURS = new Set(["#545969", "#3f424e", "#f0580e", "#1e8ca0", "#33363f"]);
  const jetRects = chase.filter((r) => JET_COLOURS.has(r.style) && r.y >= 136 && r.y <= 162);
  assert(jetRects.length > 0, "chase view should draw the voxel jet");
  const xs = jetRects.map((r) => r.x);
  const jetW = Math.max(...xs.map((x, i) => x + jetRects[i].w)) - Math.min(...xs);
  const jetPct = (jetW / p.CANVAS_WIDTH) * 100;
  assert(jetPct >= 2 && jetPct <= 4, `drawn jet width ${jetW}px = ${jetPct.toFixed(1)}% (want ~2-3%)`);
  const bodyRects = chase.filter((r) => r.style === "#545969");
  assert(bodyRects.length > 0, "chase view should draw the jet in reference body colour #545969");
  const flameRects = chase.filter((r) => r.style === "#f0580e");
  assert(flameRects.length > 0, "chase view should draw the orange flame layer");
  // Ocean rows present in chase view.
  const oceanRows = chase.filter((r) => r.style.startsWith("rgb(") && r.y >= 70);
  assert(oceanRows.length >= 20, `chase ocean should have 20+ rows (got ${oceanRows.length})`);
  // Clouds drawn (white slices) in chase view.
  const cloudRects = chase.filter((r) => r.style === "#f4f8ff");
  assert(cloudRects.length > 0, "chase view should draw white cloud slices");
  // Overhead: top-down world — ocean fills the screen, jet centred.
  const over = out.overhead.rects;
  const oceanFill = over.find((r) => r.y === 0 && r.w >= p.CANVAS_WIDTH);
  assert(oceanFill, "overhead view should fill the screen with ocean");
  const overJet = over.filter((r) => r.style === "#545969");
  assert(overJet.length > 0, "overhead view should draw the jet (top-down, same size)");
  // Cockpit: HUD text (ALT/SPD/HDG) must be drawn.
  const cockpitTexts = out.cockpit.texts.map((t) => t.text).join(" ");
  assert(/ALT 110/.test(cockpitTexts), `cockpit HUD should show altitude (got: ${cockpitTexts})`);
  assert(/SPD/.test(cockpitTexts), "cockpit HUD should show speed");
  assert(/HDG/.test(cockpitTexts), "cockpit HUD should show heading");
  // Contrails: banking hard while thrusting draws white wingtip
  // contrails behind the jet (below the jet, fading alphas).
  {
    const banked = probeRender({ bank: 0.8, thrust: true });
    const trails = banked.out.chase.rects.filter(
      (r) => r.style === "rgba(255,255,255,0.50)" && r.y > 162);
    assert(trails.length > 0,
      `banking at 0.8 with thrust should draw contrails (got ${trails.length})`);
    const level = probeRender({ bank: 0, thrust: true });
    const levelTrails = level.out.chase.rects.filter(
      (r) => r.style === "rgba(255,255,255,0.50)" && r.y > 162);
    assert.strictEqual(levelTrails.length, 0,
      "level flight should draw no contrails");
  }
  // High altitude: stars appear above the horizon (white 1-2 px
  // rects with the dark-sky alpha), none at cruise altitude.
  {
    const high = probeRender({ altitude: 250 });
    const stars = high.out.chase.rects.filter(
      (r) => r.style === "rgba(255,255,255,0.70)" && r.w <= 2 && r.y < 70);
    assert(stars.length >= 20,
      `altitude 250 should draw 20+ stars (got ${stars.length})`);
    const low = probeRender({ altitude: 110 });
    const lowStars = low.out.chase.rects.filter(
      (r) => r.style === "rgba(255,255,255,0.70)");
    assert.strictEqual(lowStars.length, 0, "no stars at cruise altitude 110");
    console.log(`  probe: stars at alt 250 = ${stars.length}`);
  }
  console.log(`  probe: chase rects=${out.chase.rects.length} overhead rects=${out.overhead.rects.length} cockpit texts=${out.cockpit.texts.length}`);
  console.log(`  probe: drawn jet width=${jetW}px (${jetPct.toFixed(1)}% of screen), flame rects=${flameRects.length}, cloud rects=${cloudRects.length}`);
}

console.log("test_slice_math.js: all assertions passed");
console.log(`  sliceDepth(125)=${m.sliceDepth(125, 70, 180)} oceanColor(1)=${m.oceanColor(1)}`);
console.log(`  projectIsland far y=${farI.y.toFixed(1)} r=${farI.r.toFixed(1)} | near y=${nearI.y.toFixed(1)} r=${nearI.r.toFixed(1)}`);
