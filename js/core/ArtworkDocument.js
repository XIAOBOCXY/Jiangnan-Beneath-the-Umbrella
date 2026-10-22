// ArtworkDocument 保存可编辑的逻辑作品，与 Canvas 像素缓存分离。
export class ArtworkDocument {
  constructor() {
    this.strokes = [];
    this.patterns = [];
    this.selectedId = null;
    this.history = [];
    this.future = [];
  }

  snapshot() {
    return JSON.stringify({ strokes: this.strokes, patterns: this.patterns });
  }

  commit() {
    this.history.push(this.snapshot());
    if (this.history.length > 40) this.history.shift();
    this.future.length = 0;
  }

  restore(state) {
    const data = JSON.parse(state);
    this.strokes = data.strokes || [];
    this.patterns = data.patterns || [];
    this.selectedId = null;
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
    return true;
  }

  clear() {
    this.commit();
    this.strokes = [];
    this.patterns = [];
    this.selectedId = null;
  }
}
