// Pixel caches are derived from editable source splats, never copied into undo
// snapshots or localStorage. Only the newest stroke owns the live simulation.
export class InkArtworkLayers {
  constructor({ getPreview, replayStroke, clearPending, maxCachedLayers = 32 }) {
    this.getPreview = getPreview;
    this.replayStroke = replayStroke;
    this.clearPending = clearPending;
    this.maxCachedLayers = maxCachedLayers;
    this.cache = new Map();
    this.active = null;
  }

  key(stroke) { return `${stroke.id}:${stroke.fluidSplats?.length || 0}`; }

  remember(stroke, canvas) {
    this.rememberKey(this.key(stroke), canvas);
  }

  rememberKey(key, canvas) {
    if (!canvas) return;
    this.cache.delete(key);
    this.cache.set(key, canvas);
    while (this.cache.size > this.maxCachedLayers) this.cache.delete(this.cache.keys().next().value);
  }

  freeze() {
    if (!this.active) return false;
    const preview = this.getPreview();
    this.remember(this.active, preview?.captureFluidSnapshot());
    this.active = null;
    this.clearPending();
    preview?.clearFluid();
    return true;
  }

  begin(stroke) {
    this.active = stroke;
    this.getPreview()?.setInkOpacity(1);
  }

  getCanvas(stroke) {
    if (stroke === this.active) return null;
    const key = this.key(stroke);
    if (this.cache.has(key)) {
      const canvas = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, canvas);
      return canvas;
    }
    const preview = this.getPreview();
    if (!preview || !stroke.fluidSplats?.length) return null;
    const canvas = preview.captureReplayedInk(this.replayStroke(stroke));
    this.remember(stroke, canvas);
    return canvas;
  }

  getRunCanvas(strokes) {
    const frozen = strokes.filter((stroke) => stroke !== this.active && stroke.fluidSplats?.length);
    if (frozen.length < 2) return frozen.length ? this.getCanvas(frozen[0]) : null;
    const keys = frozen.map((stroke) => this.key(stroke));
    const runKey = (count) => `run:${keys.slice(0, count).join('|')}`;
    // Consecutive ink strokes have no editable motif between them. Cache their
    // source-over prefix so a long drawing doesn't replay every evicted stroke
    // on each pointer event or motif animation frame.
    const key = runKey(frozen.length);
    if (this.cache.has(key)) {
      const canvas = this.cache.get(key);
      this.rememberKey(key, canvas);
      return canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    let count = frozen.length - 1;
    while (count > 1 && !this.cache.has(runKey(count))) count--;
    if (count > 1) ctx.drawImage(this.cache.get(runKey(count)), 0, 0);
    else count = 0;
    for (; count < frozen.length; count++) {
      const source = this.getCanvas(frozen[count]);
      if (!source) return null;
      ctx.drawImage(source, 0, 0);
    }
    this.rememberKey(key, canvas);
    return canvas;
  }
}
