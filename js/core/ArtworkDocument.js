// ArtworkDocument 保存可编辑的逻辑作品，与 Canvas 像素缓存分离。
const MAX_HISTORY_STEPS = 40;
// Fluid strokes include replay samples; bound snapshots so undo does not keep
// many full copies of a long wet-ink drawing in memory.
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const estimateBytes = (snapshot) => snapshot.length * 2;

export const isGpuStroke = (stroke) => stroke.settings?.gpuInk === true || stroke.settings?.brushStyle === "fluid";

export class ArtworkDocument {
  constructor() {
    this.strokes = [];
    this.patterns = [];
    this.selectedId = null;
    this.history = [];
    this.future = [];
    this.historyBytes = 0;
    this.futureBytes = 0;
  }

  snapshot() {
    this.normalizeOrder();
    return JSON.stringify({ strokes: this.strokes, patterns: this.patterns });
  }

  normalizeOrder() {
    const items = [...this.strokes, ...this.patterns];
    const ordered = items.filter((item) => Number.isFinite(item.order));
    // Old documents never recorded interleaving. Retain their former stack:
    // Canvas paths, motifs, then GPU pigment, before appending new work.
    const missing = ordered.length ? items : [
      ...this.strokes.filter((stroke) => !isGpuStroke(stroke)),
      ...this.patterns,
      ...this.strokes.filter(isGpuStroke)
    ];
    let order = ordered.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    missing.forEach((item) => { if (!Number.isFinite(item.order)) item.order = order++; });
  }

  nextOrder() {
    this.normalizeOrder();
    return [...this.strokes, ...this.patterns].reduce((max, item) => Math.max(max, item.order), -1) + 1;
  }

  getLayers() {
    this.normalizeOrder();
    return [
      ...this.strokes.map((item) => ({ kind: isGpuStroke(item) ? "ink" : "stroke", item })),
      ...this.patterns.map((item) => ({ kind: "pattern", item }))
    ].sort((a, b) => a.item.order - b.item.order);
  }

  commit() {
    if (this.suspendHistory) return;
    this.pushHistory(this.snapshot());
    this.future.length = 0;
    this.futureBytes = 0;
    this.trimHistory();
  }

  pushHistory(snapshot) {
    this.history.push(snapshot);
    this.historyBytes += estimateBytes(snapshot);
    while (this.history.length > MAX_HISTORY_STEPS) {
      this.historyBytes -= estimateBytes(this.history.shift());
    }
  }

  trimHistory() {
    while (this.historyBytes + this.futureBytes > MAX_HISTORY_BYTES) {
      // Preserve the nearest undo and redo states; evict older checkpoints first.
      if (this.history.length > 1 && (this.future.length <= 1 || this.historyBytes >= this.futureBytes)) {
        this.historyBytes -= estimateBytes(this.history.shift());
      } else if (this.future.length > 1) {
        this.futureBytes -= estimateBytes(this.future.shift());
      } else if (this.history.length > 1) {
        this.historyBytes -= estimateBytes(this.history.shift());
      } else {
        // Keep a single oversized checkpoint so one-step undo remains available.
        break;
      }
    }
  }

  restore(state) {
    const data = JSON.parse(state);
    this.strokes = data.strokes || [];
    this.patterns = data.patterns || [];
    this.normalizeOrder();
    this.selectedId = null;
  }

  undo() {
    if (!this.history.length) return false;
    const current = this.snapshot();
    this.future.push(current);
    this.futureBytes += estimateBytes(current);
    const previous = this.history.pop();
    this.historyBytes -= estimateBytes(previous);
    this.restore(previous);
    this.trimHistory();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    const next = this.future.pop();
    this.futureBytes -= estimateBytes(next);
    this.pushHistory(this.snapshot());
    this.restore(next);
    this.trimHistory();
    return true;
  }

  clear() {
    this.commit();
    this.strokes = [];
    this.patterns = [];
    this.selectedId = null;
  }
}
