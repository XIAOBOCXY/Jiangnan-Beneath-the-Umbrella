import { ArtworkDocument } from '../js/core/ArtworkDocument.js?v=20261112-artwork-order-v1';
import { InkArtworkLayers } from '../js/core/InkArtworkLayers.js?v=20261112-artwork-order-v1';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function runDocumentChecks() {
  const doc = new ArtworkDocument();
  doc.strokes = [{ id: 'ink', settings: { gpuInk: true } }, { id: 'clean', settings: { gpuInk: false } }];
  doc.patterns = [{ id: 'motif' }];
  check(equal(doc.getLayers().map(({ item }) => item.id), ['clean', 'motif', 'ink']), 'Legacy documents retain their old stack');
  doc.commit();
  doc.patterns.push({ id: 'new', order: doc.nextOrder() });
  check(doc.getLayers().at(-1).item.id === 'new', 'New work follows migrated work');
  const snapshot = doc.snapshot();
  doc.undo(); doc.redo();
  check(doc.snapshot() === snapshot, 'Undo/redo retains order metadata');
  const cache = new InkArtworkLayers({ getPreview: () => null, replayStroke: () => [], clearPending() {}, maxCachedLayers: 2 });
  [0, 1, 2].forEach((id) => cache.remember({ id, fluidSplats: [] }, { id }));
  check(cache.cache.size === 2 && !cache.cache.has('0:0'), 'Pixel cache has a memory bound');
  return ['legacy migration', 'chronological append', 'history metadata', 'bounded pixel cache'];
}

export async function runArtworkOrderChecks(app) {
  await app.ready;
  const preview = await app.ensureThreePreview();
  const r = app.renderer, cm = app.canvasManager, drawer = app.patternDrawer;
  const documentBefore = r.getDocument();
  const original = { getAsset: drawer.getAsset, drawObject: drawer.drawObject, getImage: drawer.getImage,
    animateReveal: r.animateReveal, animateInkWash: r.animateInkWash, saveCanvas: app.galleryStore.saveCanvas,
    history: r.document.history, future: r.document.future, historyBytes: r.document.historyBytes, futureBytes: r.document.futureBytes };
  const passed = runDocumentChecks();
  const point = { x: 450, y: 350 };
  const pixel = () => Array.from(cm.artCtx.getImageData(point.x * cm.dpr, point.y * cm.dpr, 1, 1).data);
  const render = () => { r.document.selectedId = null; r.invalidate(); r.render(); };
  const reset = () => {
    r.setDocument({ strokes: [], patterns: [] }, false);
    r.document.history = []; r.document.future = [];
    r.document.historyBytes = r.document.futureBytes = 0;
  };
  const motif = () => { const item = r.addPattern('blue', point, { snap: false }); render(); return item; };
  const stroke = (gpu = false, color = '#ff0000') => {
    const settings = { gpuInk: gpu, color, brushStyle: gpu ? 'texture' : 'clean', brushSize: 120,
      opacity: .65, segments: 1, mirror: false, symmetryVersion: 2 };
    const item = r.beginStroke({ x: 420, y: 350 }, settings);
    r.extendStroke({ x: 480, y: 350 }, settings);
    if (gpu) {
      const splat = { fromUv: app.pointToCanopyUV({ x: 420, y: 350 }, cm.radius * 2),
        uv: app.pointToCanopyUV({ x: 480, y: 350 }, cm.radius * 2), color, radius: .055,
        opacity: .88, water: 0, grain: 0, seed: .5, force: { x: 0, y: 0 } };
      r.appendFluidSplats(item.id, [splat]);
      preview.injectInks(app.expandInkSplat(splat, settings));
    }
    r.endStroke(); return item;
  };
  try {
    drawer.getAsset = () => ({ recommendedSize: 100, defaultRepeatCount: 1 });
    drawer.getImage = () => null;
    drawer.drawObject = (ctx, object, instance) => {
      ctx.save(); ctx.globalAlpha = object.opacity * (instance.opacity ?? 1);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(instance.x - 40, instance.y - 40, 80, 80); ctx.restore();
    };
    r.animateReveal = r.animateInkWash = () => {};

    reset(); stroke(); motif(); const strokeThenPattern = pixel();
    check(strokeThenPattern[2] > strokeThenPattern[0] + 80, 'Later motif covers clean stroke');
    reset(); const firstMotif = motif(); stroke(); const patternThenStroke = pixel();
    check(patternThenStroke[0] > patternThenStroke[2] + 60, 'Later clean stroke covers motif');
    passed.push('clean stroke ↔ motif pixels');
    const order = firstMotif.order;
    r.document.selectedId = firstMotif.id; r.moveSelected(-5, 0);
    check(firstMotif.order === order && pixel()[0] > pixel()[2], 'Editing retains motif layer');
    passed.push('motif edits retain order');
    r.undo(); check(pixel()[2] > pixel()[0], 'Undo removes the top stroke');
    r.redo(); check(pixel()[0] > pixel()[2], 'Redo restores top stroke');
    const data = r.getDocument(), beforeReload = pixel();
    r.setDocument(data, false); check(equal(pixel(), beforeReload), 'Document reload retains pixels');
    passed.push('Canvas undo/redo and document reload');

    reset(); stroke(true); motif(); const inkThenPattern = pixel();
    check(inkThenPattern[2] > inkThenPattern[0] + 40, 'Later motif covers GPU ink');
    check(preview.inkFluid.pendingSplats.length === 0, 'Freezing drains pending GPU splats');
    reset(); motif(); stroke(true);
    // The real save path freezes the top ink layer before composing UVs.
    app.galleryStore.saveCanvas = (canvas, document, material, settings) => ({ canvas, document, material, settings });
    const saved = app.saveCurrentArtwork();
    const patternThenInk = pixel();
    check(patternThenInk[0] > patternThenInk[2] + 40, 'Later GPU ink covers motif');
    check(saved.document.strokes[0].order > saved.document.patterns[0].order, 'Save retains chronological data');
    const uv = (point.x - 114) / 492, vv = (point.y - 114) / 492;
    const savedPixel = Array.from(saved.canvas.getContext('2d').getImageData(Math.floor(uv * 1024), Math.floor(vv * 1024), 1, 1).data);
    app.refreshThreeTexture(true);
    const texture = preview.canvasTexture.image;
    const texturePixel = Array.from(texture.getContext('2d').getImageData(Math.floor(uv * 1024), Math.floor(vv * 1024), 1, 1).data);
    check(equal(savedPixel, texturePixel), 'Saved artwork and 3D texture contain identical pixels');
    passed.push('GPU ink ↔ motif pixels', 'queued ink capture', 'save/3D texture parity');

    r.undo(); check(pixel()[2] > pixel()[0], 'Undo removes GPU top layer');
    r.redo(); check(equal(pixel(), patternThenInk), 'Redo restores exact cached pigment');
    app.inkLayers.cache.clear(); r.invalidate(); r.render();
    check(pixel()[0] > pixel()[2] + 40, 'Evicted GPU cache replays at original layer');
    passed.push('GPU undo/redo and cache replay');

    for (const style of ['soft', 'texture', 'fluid']) {
      reset(); motif();
      const settings = app.settingsForPointer({ brushStyle: style, color: '#ff0000', brushSize: 100,
        opacity: .8, segments: 3, mirror: true, symmetryVersion: 2 }, { pointerType: 'pen', pressure: .7 });
      const item = r.beginStroke({ x: 420, y: 350 }, settings);
      app.gesture = { type: 'brush', strokeId: item.id, pointerId: 123 };
      app.injectFluidSegment({ x: 420, y: 350 }, { x: 450, y: 350 }, settings);
      app.injectFluidSegment({ x: 450, y: 350 }, { x: 480, y: 350 }, settings);
      app.onPointerEnd({ pointerId: 123 });
      app.saveCurrentArtwork();
      const region = cm.artCtx.getImageData(420 * cm.dpr, 340 * cm.dpr, 60 * cm.dpr, 20 * cm.dpr).data;
      let red = 0;
      for (let index = 0; index < region.length; index += 4) red = Math.max(red, region[index]);
      check(item.fluidSplats.length > 0 && red > 50, `${style} input is retained above the motif`);
      check(app.expandInkSplat(item.fluidSplats[0], settings).length === 3, `${style} mirror keeps three copies`);
      if (style === 'soft') check(item.fluidSplats.at(-1).widthEnd === .06, 'Soft ink keeps its pointed tail');
    }
    passed.push('soft/texture/fluid pen input', 'three-copy mirror', 'soft release tip');

    reset(); stroke(true); motif(); stroke(); stroke(true, '#00ff00'); motif();
    app.saveCurrentArtwork(); const mixed = pixel();
    check(mixed[2] > mixed[0] && mixed[2] > mixed[1], 'Mixed sequence keeps the final motif above all brushes');
    check(equal(r.document.getLayers().map(({ item }) => item.order), [0, 1, 2, 3, 4]), 'Mixed layer sequence is stable');
    r.clear(); check(pixel()[3] === 0, 'Clear removes frozen and Canvas layers');
    r.undo(); check(equal(pixel(), mixed), 'Undo clear restores interleaved pixels');
    passed.push('mixed ink/motif/clean/ink/motif', 'undo clear');

    reset();
    // More strokes than the cache budget must remain usable without replaying
    // every old stroke for every pointer sample.
    let snapshots = 0;
    const replay = preview.captureReplayedInk;
    preview.captureReplayedInk = function(...args) { snapshots++; return replay.apply(this, args); };
    try {
      for (let count = 0; count < 36; count++) stroke(true);
      app.saveCurrentArtwork(); const warm = snapshots;
      r.invalidate(); r.render();
      check(snapshots === warm && app.inkLayers.cache.size <= 32, 'Long ink runs use a bounded composite cache');
    } finally { preview.captureReplayedInk = replay; }
    passed.push('long ink run cache');
    return { passed, pixels: { strokeThenPattern, patternThenStroke, inkThenPattern, patternThenInk, savedPixel, texturePixel, mixed } };
  } finally {
    drawer.getAsset = original.getAsset; drawer.drawObject = original.drawObject; drawer.getImage = original.getImage;
    r.animateReveal = original.animateReveal; r.animateInkWash = original.animateInkWash;
    app.galleryStore.saveCanvas = original.saveCanvas;
    r.setDocument(documentBefore, false);
    for (const key of ['history', 'future', 'historyBytes', 'futureBytes']) r.document[key] = original[key];
  }
}

if (typeof window === 'undefined') console.log(JSON.stringify({ passed: runDocumentChecks() }));
