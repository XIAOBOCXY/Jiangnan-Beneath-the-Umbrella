// MandalaRenderer 同时渲染平滑的放射笔迹和独立可编辑的纹样对象。
import { ArtworkDocument } from "./ArtworkDocument.js";
import { CompositionZones } from "./CompositionZones.js";

const uid = () => `motif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const cloneData = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export class MandalaRenderer {
  constructor(canvasManager, patternDrawer) {
    this.canvasManager = canvasManager;
    this.patternDrawer = patternDrawer;
    this.document = new ArtworkDocument();
    this.zones = new CompositionZones(canvasManager.center, canvasManager.radius);
    this.rotationAngle = 0;
    this.showGuides = false;
    this.reveal = new Map();
    this.dirty = { strokes: true, patterns: true };
    this.render();
  }

  invalidate() { this.dirty.strokes = true; this.dirty.patterns = true; }

  beginStroke(point, settings) {
    this.document.commit();
    this.document.strokes.push({ id: uid(), points: [{ ...point, pressure: settings.pressureFactor || 1 }], settings: { ...settings } });
    this.dirty.strokes = true;
    this.render();
  }

  extendStroke(point, settings = {}) {
    const stroke = this.document.strokes[this.document.strokes.length - 1];
    if (!stroke) return;
    const previous = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .8) return;
    stroke.points.push({ ...point, pressure: settings.pressureFactor || 1 });
    this.dirty.strokes = true;
    this.render();
  }

  endStroke() { this.render(); }

  addPattern(patternId, point, settings = {}) {
    const zone = this.zones.getZone(point);
    const position = settings.snap ? this.zones.snap(point, zone) : point;
    const baseSize = 68;
    const scale = this.zones.limitScale(1, zone, baseSize);
    this.document.commit();
    const object = {
      id: uid(), patternId, x: position.x, y: position.y,
      scale, rotation: 0, repeatCount: 1, repeatRadius: 0,
      repeatMode: "single", repeatAngle: 0, repeatOrientation: "original",
      opacity: .94, zone: zone.name, baseSize
    };
    this.document.patterns.push(object);
    this.document.selectedId = object.id;
    this.dirty.patterns = true;
    this.render();
    return object;
  }

  getSelected() {
    return this.document.patterns.find((item) => item.id === this.document.selectedId) || null;
  }

  selectAt(point) {
    const objects = [...this.document.patterns].reverse();
    for (const object of objects) {
      for (const instance of this.getInstances(object)) {
        if (this.hitInstance(point, object, instance)) {
          this.document.selectedId = object.id;
          this.render();
          return object;
        }
      }
    }
    this.document.selectedId = null;
    this.render();
    return null;
  }

  hitInstance(point, object, instance) {
    const image = this.patternDrawer.getImage(object.patternId);
    if (!image) return false;
    const size = object.baseSize * object.scale;
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    const angle = instance.rotation;
    const dx = point.x - instance.x;
    const dy = point.y - instance.y;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(localX) <= width * .58 && Math.abs(localY) <= height * .58;
  }

  getInstances(object, countOverride = null) {
    if (object.repeatMode !== "radial" || object.repeatCount <= 1) {
      return [{ x: object.x, y: object.y, rotation: object.rotation, index: 0 }];
    }
    const center = this.canvasManager.center;
    const count = countOverride ?? object.repeatCount;
    return Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + object.repeatAngle + index * Math.PI * 2 / object.repeatCount;
      const x = center.x + object.x + Math.cos(angle) * object.repeatRadius;
      const y = center.y + object.y + Math.sin(angle) * object.repeatRadius;
      let direction = object.rotation;
      if (object.repeatOrientation === "radial") direction += angle;
      if (object.repeatOrientation === "tangent") direction += angle + Math.PI / 2;
      return { x, y, rotation: direction, index };
    });
  }

  moveSelected(dx, dy) {
    const object = this.getSelected();
    if (!object) return;
    const zone = this.zones.getByName(object.zone);
    if (object.repeatMode === "radial") {
      object.x += dx; object.y += dy;
      const pad = object.baseSize * object.scale / 2 + 3;
      const available = Math.max(0, Math.min(
        object.repeatRadius - zone.min * this.canvasManager.radius - pad,
        zone.max * this.canvasManager.radius - object.repeatRadius - pad
      ));
      const offset = Math.hypot(object.x, object.y);
      if (offset > available && offset > 0) { object.x *= available / offset; object.y *= available / offset; }
    } else {
      object.x += dx; object.y += dy;
      const center = this.canvasManager.center;
      let angle = Math.atan2(object.y - center.y, object.x - center.x);
      let distance = Math.hypot(object.x - center.x, object.y - center.y);
      const pad = object.baseSize * object.scale / 2 + 3;
      const min = zone.min === 0 ? 0 : zone.min * this.canvasManager.radius + pad;
      const max = Math.max(min, zone.max * this.canvasManager.radius - pad);
      distance = Math.max(min, Math.min(max, distance));
      object.x = center.x + Math.cos(angle) * distance;
      object.y = center.y + Math.sin(angle) * distance;
    }
    this.dirty.patterns = true;
    this.render();
  }

  setRepeat(count, radius = null) {
    const object = this.getSelected();
    if (!object) return false;
    const requestedCount = Math.max(2, Number(count) || 8);
    // 伞心主体切换为环形排列时，默认进入主装饰带，避免纹样挤在伞心。
    if (object.repeatMode !== "radial" && object.zone === "伞心") object.zone = "中部";
    const zone = this.zones.getByName(object.zone);
    const zoneMiddle = (zone.min + zone.max) * .5 * this.canvasManager.radius;
    const requestedRadius = radius === null
      ? this.zones.clampOrbit(object.repeatMode === "radial" ? object.repeatRadius : zoneMiddle, object.zone)
      : this.zones.clampOrbit(object.repeatMode !== "radial" && Number(radius) === 0 ? zoneMiddle : radius, object.zone);
    const changed = object.repeatMode !== "radial" || object.repeatCount !== requestedCount || object.repeatRadius !== requestedRadius;
    if (changed) this.document.commit();
    const center = this.canvasManager.center;
    if (object.repeatMode !== "radial") {
      const dx = object.x - center.x;
      const dy = object.y - center.y;
      object.x = 0;
      object.y = 0;
      object.repeatRadius = requestedRadius;
      object.repeatAngle = Math.atan2(dy, dx) + Math.PI / 2;
      object.repeatMode = "radial";
    } else if (radius !== null) object.repeatRadius = this.zones.clampOrbit(radius, object.zone);
    object.repeatCount = requestedCount;
    this.constrainGroupSize(object);
    this.dirty.patterns = true;
    this.animateReveal(object.id);
    this.render();
    return true;
  }

  animateReveal(id) {
    const object = this.document.patterns.find((item) => item.id === id);
    if (!object) return;
    const state = { startedAt: performance.now(), lastFrame: 0, stagger: 74, fade: 210, target: object.repeatCount };
    this.reveal.set(id, state);
    const next = () => {
      if (this.reveal.get(id) !== state) return;
      const now = performance.now();
      const duration = (state.target - 1) * state.stagger + state.fade;
      if (now - state.lastFrame >= 1000 / 30 || now - state.startedAt >= duration) {
        state.lastFrame = now;
        this.dirty.patterns = true;
        this.render();
      }
      if (now - state.startedAt < duration) requestAnimationFrame(next);
      else {
        this.reveal.delete(id);
        this.dirty.patterns = true;
        this.render();
      }
    };
    requestAnimationFrame(next);
  }

  setSelectedProperty(property, value, record = true) {
    const object = this.getSelected();
    if (!object) return;
    const number = Number(value);
    if (record) this.document.commit();
    if (property === "repeatCount") object.repeatCount = Math.max(2, number);
    else if (property === "repeatRadius") object.repeatRadius = this.zones.clampOrbit(number, object.zone);
    else if (property === "scale") object.scale = this.zones.limitScale(number, this.zones.getByName(object.zone), object.baseSize);
    else if (property === "rotation") object.rotation = number * Math.PI / 180;
    else if (property === "repeatOrientation") object.repeatOrientation = value;
    if (property === "repeatCount") this.reveal.delete(object.id);
    if (object.repeatMode === "radial") this.constrainGroupSize(object);
    this.dirty.patterns = true;
    this.render();
  }

  constrainGroupSize(object) {
    const zone = this.zones.getByName(object.zone);
    let maxSize = zone.maxMotif;
    if (object.repeatCount > 1 && object.repeatRadius > 0) {
      const chord = 2 * object.repeatRadius * Math.sin(Math.PI / object.repeatCount);
      maxSize = Math.min(maxSize, chord * .72);
    }
    object.scale = Math.max(.06, Math.min(object.scale, maxSize / Math.max(1, object.baseSize)));
  }

  deleteSelected() {
    const id = this.document.selectedId;
    if (!id) return false;
    this.document.commit();
    this.document.patterns = this.document.patterns.filter((item) => item.id !== id);
    this.document.selectedId = null;
    this.dirty.patterns = true;
    this.render();
    return true;
  }

  setDocument(data, record = true) {
    if (record) this.document.commit();
    this.reveal.clear();
    this.document.strokes = cloneData(data.strokes || []);
    this.document.patterns = cloneData(data.patterns || []);
    this.document.selectedId = null;
    this.invalidate();
    this.render();
  }

  getDocument() {
    return { strokes: cloneData(this.document.strokes), patterns: cloneData(this.document.patterns) };
  }

  undo() { const changed = this.document.undo(); if (changed) { this.reveal.clear(); this.invalidate(); this.render(); } return changed; }
  redo() { const changed = this.document.redo(); if (changed) { this.reveal.clear(); this.invalidate(); this.render(); } return changed; }

  clear() {
    this.document.clear();
    this.reveal.clear();
    this.invalidate();
    this.render();
  }

  drawSmoothPath(ctx, points, settings) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      ctx.lineTo(points[0].x + .1, points[0].y + .1);
    } else {
      for (let index = 1; index < points.length - 1; index += 1) {
        const midX = (points[index].x + points[index + 1].x) / 2;
        const midY = (points[index].y + points[index + 1].y) / 2;
        ctx.quadraticCurveTo(points[index].x, points[index].y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    const opacity = Math.max(.08, Math.min(1, settings.opacity || .8));
    const pressure = points.reduce((sum, point) => sum + (point.pressure || 1), 0) / points.length;
    const size = Math.max(1, (settings.brushSize || 12) * pressure);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = opacity;
    if (settings.brushStyle === "soft") {
      ctx.save();
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = size * .9;
      ctx.globalAlpha = opacity * .20;
      ctx.shadowColor = settings.color;
      ctx.shadowBlur = size * .65;
      ctx.stroke();
      ctx.restore();
    } else if (settings.brushStyle === "texture") {
      ctx.strokeStyle = settings.color;
      ctx.lineWidth = size * .48;
      ctx.setLineDash([size * 1.4, size * .32]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.brushStyle === "texture" ? size * .52 : size;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawStroke(ctx, stroke) {
    const center = this.canvasManager.center;
    const settings = stroke.settings;
    const count = Math.max(1, Number(settings.segments) || 8);
    const mirrorCount = settings.mirror ? 2 : 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(center.x, center.y, this.canvasManager.radius - 1, 0, Math.PI * 2); ctx.clip();
    for (let index = 0; index < count; index += 1) {
      for (let mirror = 0; mirror < mirrorCount; mirror += 1) {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(index * Math.PI * 2 / count + (settings.animate ? this.rotationAngle : 0));
        if (mirror) ctx.scale(1, -1);
        ctx.translate(-center.x, -center.y);
        this.drawSmoothPath(ctx, stroke.points, settings);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawPattern(ctx, object) {
    const instances = this.getInstances(object);
    const reveal = this.reveal.get(object.id);
    if (!reveal) {
      instances.forEach((instance) => this.patternDrawer.drawObject(ctx, object, instance));
      return;
    }

    const elapsed = performance.now() - reveal.startedAt;
    instances.forEach((instance) => {
      const progress = Math.max(0, Math.min(1, (elapsed - instance.index * reveal.stagger) / reveal.fade));
      if (progress <= 0) return;
      const eased = 1 - Math.pow(1 - progress, 3);
      this.patternDrawer.drawObject(ctx, object, { ...instance, opacity: eased, scale: .92 + .08 * eased });
    });
  }

  drawSelection(ctx, object) {
    if (!object || this.reveal.has(object.id)) return;
    const instances = this.getInstances(object);
    const image = this.patternDrawer.getImage(object.patternId);
    const size = object.baseSize * object.scale;
    const ratio = image?.naturalWidth / image?.naturalHeight || 1;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    ctx.save();
    ctx.strokeStyle = "rgba(38,63,58,.72)";
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 4]);
    instances.forEach((instance) => {
      ctx.save(); ctx.translate(instance.x, instance.y); ctx.rotate(instance.rotation);
      ctx.strokeRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8);
      ctx.restore();
    });
    ctx.restore();
  }

  render() {
    const { artCtx, patternCtx, overlayCtx } = this.canvasManager;
    const artworkChanged = this.dirty.strokes || this.dirty.patterns;
    if (this.dirty.strokes) {
      artCtx.clearRect(0, 0, this.canvasManager.size, this.canvasManager.size);
      this.document.strokes.forEach((stroke) => this.drawStroke(artCtx, stroke));
      this.dirty.strokes = false;
    }
    if (this.dirty.patterns) {
      patternCtx.clearRect(0, 0, this.canvasManager.size, this.canvasManager.size);
      this.document.patterns.forEach((object) => {
        this.drawPattern(patternCtx, object);
      });
      this.dirty.patterns = false;
    }
    overlayCtx.clearRect(0, 0, this.canvasManager.size, this.canvasManager.size);
    if (this.showGuides) this.zones.drawGuides(overlayCtx);
    this.drawSelection(overlayCtx, this.getSelected());
    this.canvasManager.renderScene();
    if (artworkChanged) this.canvasManager.markTextureDirty();
  }

  advanceAnimation() {
    this.rotationAngle += .02;
    if (this.document.strokes.some((stroke) => stroke.settings.animate)) { this.dirty.strokes = true; this.render(); }
  }
}
