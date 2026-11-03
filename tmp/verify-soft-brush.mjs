import assert from 'node:assert/strict';
import { App } from '../js/app/App.js';
import { MandalaRenderer } from '../js/core/MandalaRenderer.js';
import { InkFluidSystem } from '../js/rendering/InkFluidSystem.js';

// Exercise input -> stored stroke -> mirrored copies -> GPU queue -> replay.
const output = [];
const app = Object.create(App.prototype);
app.canvasManager = { radius: 246, center: { x: 360, y: 360 }, setFluidSnapshot() {} };
app.renderer = {
  document: { strokes: [{ id: 'test', settings: { gpuInk: true, brushStyle: 'soft', segments: 1 }, fluidSplats: [] }] },
  appendFluidSplats: MandalaRenderer.prototype.appendFluidSplats,
  endStroke() {}
};
app.threePreview = { injectInks: splats => output.push(...structuredClone(splats)), clearFluid() { output.length = 0; }, setInkOpacity() {}, setActive() {} };
app.pendingFluidSplats = [];
app.gesture = { type: 'brush', strokeId: 'test', pointerId: 1 };
app.canvasContainer = { classList: { remove() {} } };
app.scheduleFluidSeal = () => {};
app.updateSelectionControls = () => {};
const settings = { gpuInk: true, brushStyle: 'soft', brushSize: 8, pointerPressure: 0.5, opacity: 0.45, segments: 1 };
app.injectFluidSegment({ x: 230, y: 300 }, { x: 242, y: 302 }, settings);
assert.equal(output.length, 0, 'Last segment remains editable until another sample or release');
app.injectFluidSegment({ x: 242, y: 302 }, { x: 258, y: 308 }, settings);
app.onPointerEnd({ pointerId: 1 });
assert.equal(output.length, 2, 'Release flushes the tail exactly once');
assert.equal(output[0].widthStart, 0.08);
assert.equal(output[0].widthEnd, output[1].widthStart, 'Widths are continuous at segment joins');
assert.equal(output[1].widthEnd, 0.06, 'Release leaves a pointed tail');
assert.ok(output[0].radius * 492 * 2 < 11, 'Default brush is about 10px, below the old ~42px base diameter');
const original = structuredClone(output);
app.rebuildFluidArtwork();
assert.deepEqual(JSON.parse(JSON.stringify(output)), JSON.parse(JSON.stringify(original)), 'History rebuild retains start/end widths');
const copies = app.expandInkSplat(original[0], { segments: 8, mirror: true });
assert.equal(copies.length, 16);
assert.ok(copies.every(copy => copy.widthStart === original[0].widthStart && copy.widthEnd === original[0].widthEnd));

const gpu = Object.create(InkFluidSystem.prototype);
gpu.THREE = {
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  Color: class { constructor() { this.r = this.g = this.b = 0.5; } },
  MathUtils: { clamp: (n, min, max) => Math.max(min, Math.min(max, n)) }
};
gpu.pendingSplats = [];
gpu.velocityRange = 6;
gpu.addSplat({ ...original[0], radius: 0.002 });
assert.equal(gpu.pendingSplats[0].radius, 0.002, 'Fine soft strokes bypass the old 0.006 radius floor');
gpu.addSplat({ uv: { x: 0.5, y: 0.5 }, radius: 0.002, water: 1 });
assert.equal(gpu.pendingSplats[1].radius, 0.006, 'Other brushes retain their radius limits');
const batch = { uniforms: {
  uSplatPath: { value: new Float32Array(128) }, uSplatInk: { value: new Float32Array(128) },
  uSplatFlow: { value: new Float32Array(128) }, uSplatAux: { value: new Float32Array(128) },
  uSplatTip: { value: new Float32Array(64) }, uSplatCount: { value: 0 }
} };
gpu.setBatchUniforms(batch, gpu.pendingSplats);
assert.ok(Math.abs(batch.uniforms.uSplatTip.value[0] - 0.08) < 1e-6);
assert.equal(batch.uniforms.uSplatTip.value[2], 1, 'Legacy splats use a neutral tip profile');
console.log('PASS: pointed tips, continuous joins, radius limits, radial copies, history replay, GPU upload');
