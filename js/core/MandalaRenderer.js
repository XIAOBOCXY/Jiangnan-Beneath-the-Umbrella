// MandalaRenderer 同时渲染平滑的放射笔迹和独立可编辑的纹样对象。
import { ArtworkDocument } from "./ArtworkDocument.js?v=20261111-inspiration-batch-v2";
import { CompositionZones } from "./CompositionZones.js";

const uid = () => `motif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const cloneData = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export class MandalaRenderer {
  constructor(canvasManager, patternDrawer) {
    this.canvasManager = canvasManager;
    this.patternDrawer = patternDrawer;
    this.document = new ArtworkDocument();
    this.zones = new CompositionZones(canvasManager.center, canvasManager.radius);
    this.showGuides = true;
    this.reveal = new Map();
    this.selectedInstanceIndex = 0;
    this.inkWash = null;
    this.dirty = { strokes: true, patterns: true };
    this.render();
  }

  invalidate() { this.dirty.strokes = true; this.dirty.patterns = true; }

  withBatch(callback) {
    const wasBatching = this.isBatching;
    const wasSuspended = this.document.suspendHistory;
    this.isBatching = true;
    this.document.suspendHistory = true;
    try { return callback(); }
    finally { this.isBatching = wasBatching; this.document.suspendHistory = wasSuspended; }
  }

  beginStroke(point, settings) {
    this.document.commit();
    // All freehand presets share the same live GPU ink head. Source points and
    // UV segments remain in the document so history can rebuild the pigment.
    const stroke = {
      id: uid(),
      points: [{ ...point, pressure: settings.pressureFactor || 1 }],
      settings: { ...settings, gpuInk: settings.gpuInk !== false }
    };
    if (stroke.settings.gpuInk || settings.brushStyle === "fluid") stroke.fluidSplats = [];
    this.document.strokes.push(stroke);
    this.dirty.strokes = true;
    this.render({ markTexture: !stroke.settings.gpuInk && settings.brushStyle !== "fluid" });
    return stroke;
  }

  appendFluidSplats(strokeId, splats) {
    const stroke = this.document.strokes.find((item) => item.id === strokeId);
    if (!stroke || (!stroke.settings.gpuInk && stroke.settings.brushStyle !== "fluid")) return;
    stroke.fluidSplats ||= [];
    stroke.fluidSplats.push(...splats.map((splat) => ({
      uv: { x: splat.uv.x, y: splat.uv.y },
      fromUv: { x: (splat.fromUv || splat.uv).x, y: (splat.fromUv || splat.uv).y },
      force: { x: splat.force?.x || 0, y: splat.force?.y || 0 },
      color: splat.color,
      radius: splat.radius,
      widthStart: splat.widthStart ?? 1,
      widthEnd: splat.widthEnd ?? 1,
      opacity: splat.opacity,
      water: splat.water,
      grain: splat.grain,
      speed: splat.speed || 0,
      pressure: splat.pressure ?? 0.5,
      seed: splat.seed
    })));
  }

  extendStroke(point, settings = {}) {
    const stroke = this.document.strokes[this.document.strokes.length - 1];
    if (!stroke) return;
    const previous = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .8) return;
    stroke.points.push({ ...point, pressure: settings.pressureFactor || 1 });
    this.dirty.strokes = true;
    this.render({ markTexture: !stroke.settings.gpuInk && stroke.settings.brushStyle !== "fluid" });
  }

  endStroke() {
    const stroke = this.document.strokes[this.document.strokes.length - 1];
    if (!stroke?.settings.gpuInk && stroke?.settings.brushStyle !== "fluid") {
      if (stroke) this.animateInkWash(stroke.id);
      this.render();
      return;
    }
    this.render({ markTexture: false });
  }

  animateInkWash(strokeId) {
    const wash = { strokeId, startedAt: performance.now(), duration: 620, lastFrame: 0 };
    this.inkWash = wash;
    const frame = (now) => {
      if (this.inkWash !== wash) return;
      if (now - wash.lastFrame >= 1000 / 30 || now - wash.startedAt >= wash.duration) {
        wash.lastFrame = now;
        this.dirty.strokes = true;
        this.render();
      }
      if (now - wash.startedAt < wash.duration) requestAnimationFrame(frame);
      else {
        this.inkWash = null;
        this.dirty.strokes = true;
        this.render();
      }
    };
    requestAnimationFrame(frame);
  }

  addPattern(patternId, point, settings = {}) {
    const asset = this.patternDrawer.getAsset(patternId);
    if (!asset) return null;

    const detectedZone = this.zones.getZone(point);
    const allowedZones = asset.applicableZones?.length ? asset.applicableZones : [detectedZone.name];
    const pointRatio = Math.hypot(point.x - this.zones.center.x, point.y - this.zones.center.y) / this.zones.radius;
    const insideCanopy = pointRatio <= 1;
    const zone = !insideCanopy || allowedZones.includes(detectedZone.name)
      ? detectedZone
      : allowedZones
        .map((name) => this.zones.getByName(name))
        .reduce((closest, candidate) => {
          const candidateMiddle = (candidate.min + candidate.max) / 2;
          const closestMiddle = (closest.min + closest.max) / 2;
          return Math.abs(candidateMiddle - pointRatio) < Math.abs(closestMiddle - pointRatio) ? candidate : closest;
        });
    // 伞面内仍按纹样适用区域自动吸附；伞缘外保留落点，允许纹样自然跨出伞面。
    const position = insideCanopy && settings.snap ? this.zones.snap(point, zone) : point;
    const baseSize = asset.recommendedSize;
    const scale = insideCanopy ? this.zones.limitScale(1, zone, baseSize) : 1;
    this.document.commit();
    const object = {
      id: uid(), patternId, x: position.x, y: position.y,
      scale, rotation: 0, repeatCount: asset.defaultRepeatCount, repeatRadius: 0,
      repeatMode: "single", repeatAngle: 0, repeatOrientation: "original",
      opacity: .88, zone: zone.name, baseSize
    };
    this.constrainSingleObject(object, position);
    this.document.patterns.push(object);
    this.document.selectedId = object.id;
    this.selectedInstanceIndex = 0;
    this.dirty.patterns = true;
    this.render();
    this.animateReveal(object.id, "bloom");
    return object;
  }

  getSelected() {
    return this.document.patterns.find((item) => item.id === this.document.selectedId) || null;
  }

  changeSelectedPattern(patternId) {
    const object = this.getSelected();
    const asset = this.patternDrawer.getAsset(patternId);
    if (!object || !asset || object.patternId === patternId) return false;
    this.document.commit();
    const displayedSize = object.baseSize * object.scale;
    object.patternId = patternId;
    object.baseSize = asset.recommendedSize;
    object.scale = Math.max(.06, Math.min(displayedSize / object.baseSize, this.getMaxScale(object)));
    this.reveal.delete(object.id);
    this.dirty.patterns = true;
    this.render();
    this.animateReveal(object.id, "bloom");
    return true;
  }

  getSelectedInstance(object = this.getSelected()) {
    if (!object) return null;
    const instances = this.getInstances(object);
    return instances[Math.min(this.selectedInstanceIndex || 0, instances.length - 1)] || null;
  }

  selectAt(point) {
    const objects = [...this.document.patterns].reverse();
    for (const object of objects) {
      for (const instance of this.getInstances(object)) {
        if (this.hitInstance(point, object, instance)) {
          this.document.selectedId = object.id;
          this.selectedInstanceIndex = instance.index;
          this.render();
          return object;
        }
      }
    }
    this.document.selectedId = null;
    this.selectedInstanceIndex = 0;
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
    return Math.abs(localX) <= width * .5 + 4 && Math.abs(localY) <= height * .5 + 4;
  }

  getPatternDimensions(object, scale = object.scale) {
    const image = this.patternDrawer.getImage(object.patternId);
    const ratio = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
    const size = object.baseSize * scale;
    return { width: ratio >= 1 ? size : size * ratio, height: ratio >= 1 ? size / ratio : size };
  }

  getHalfDiagonal(object, scale = object.scale, padding = 4) {
    const { width, height } = this.getPatternDimensions(object, scale);
    return Math.hypot(width, height) * .5 + padding;
  }

  getWorkspaceRadius() { return this.canvasManager.size / 2 - 10; }

  getMaxOrbitRadius(object) {
    // The artwork is clipped to the silk, but its center may travel right to
    // the workspace edge, even when most of a large motif lies off the canopy.
    return this.getWorkspaceRadius();
  }

  getMaxCenterDistance(object, direction, boundary = this.getWorkspaceRadius()) {
    const { width, height } = this.getPatternDimensions(object);
    const cos = Math.cos(object.rotation || 0), sin = Math.sin(object.rotation || 0);
    const rayX = Math.cos(direction), rayY = Math.sin(direction);
    let limit = boundary;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const localX = sx * (width * .5 + 4), localY = sy * (height * .5 + 4);
      const cornerX = localX * cos - localY * sin;
      const cornerY = localX * sin + localY * cos;
      const projection = rayX * cornerX + rayY * cornerY;
      const perpendicularSquared = Math.max(0, cornerX * cornerX + cornerY * cornerY - projection * projection);
      if (perpendicularSquared >= boundary * boundary) return 0;
      limit = Math.min(limit, -projection + Math.sqrt(boundary * boundary - perpendicularSquared));
    }
    return Math.max(0, limit);
  }

  constrainSingleObject(object, requestedPoint) {
    const center = this.canvasManager.center;
    const dx = requestedPoint.x - center.x, dy = requestedPoint.y - center.y;
    const direction = Math.atan2(dy, dx);
    const distance = Math.min(this.getWorkspaceRadius(), Math.hypot(dx, dy));
    object.x = center.x + Math.cos(direction) * distance;
    object.y = center.y + Math.sin(direction) * distance;
  }

  getInstances(object, countOverride = null) {
    if (object.repeatMode !== "radial" || object.repeatCount <= 1) {
      return [{ x: object.x, y: object.y, rotation: object.rotation, index: 0 }];
    }
    const center = this.canvasManager.center;
    const count = countOverride ?? object.repeatCount;
    const baseAngle = -Math.PI / 2 + object.repeatAngle;
    return Array.from({ length: count }, (_, index) => {
      const angle = baseAngle + index * Math.PI * 2 / object.repeatCount;
      // 环形重复始终以伞心为旋转中心；对象的拖动只改变环半径和起始角。
      const x = center.x + Math.cos(angle) * object.repeatRadius;
      const y = center.y + Math.sin(angle) * object.repeatRadius;
      // 以纹样当前相对伞心的起始角为基准，位置和朝向都按相同角增量
      // 绕伞心重复。这样每个副本与起始纹样的相对朝向保持一致。
      const rotation = object.rotation + angle - baseAngle;
      return { x, y, rotation, index };
    });
  }

  moveSelected(dx, dy) {
    const object = this.getSelected();
    if (!object) return;
    if (object.repeatMode === "radial") {
      const center = this.canvasManager.center;
      const index = Math.min(this.selectedInstanceIndex || 0, object.repeatCount - 1);
      const instance = this.getInstances(object)[index];
      const targetX = instance.x + dx - center.x;
      const targetY = instance.y + dy - center.y;
      const targetAngle = Math.atan2(targetY, targetX);
      object.repeatRadius = this.zones.clampOrbit(Math.hypot(targetX, targetY), object.zone, this.getMaxOrbitRadius(object));
      object.repeatAngle = targetAngle + Math.PI / 2 - index * Math.PI * 2 / object.repeatCount;
      object.x = 0;
      object.y = 0;
    } else {
      object.x += dx; object.y += dy;
      const center = this.canvasManager.center;
      let angle = Math.atan2(object.y - center.y, object.x - center.x);
      let distance = Math.hypot(object.x - center.x, object.y - center.y);
      // Limit the anchor, not the entire bounding box: a large motif can be
      // dragged mostly outside the silk while its selection remains editable.
      const max = this.getWorkspaceRadius();
      distance = Math.min(max, distance);
      object.x = center.x + Math.cos(angle) * distance;
      object.y = center.y + Math.sin(angle) * distance;
    }
    this.dirty.patterns = true;
    this.render();
  }

  setRepeat(count, radius = null, { commit = true, animate = true } = {}) {
    const object = this.getSelected();
    if (!object) return false;
    const requestedCount = Math.max(1, Math.min(16, Math.round(Number(count) || 1)));
    if (requestedCount === 1) {
      if (object.repeatMode !== "radial") return false;
      // Keep the selected copy exactly where it is when returning to one.
      const instance = this.getSelectedInstance(object);
      if (!instance) return false;
      if (commit) this.document.commit();
      object.x = instance.x;
      object.y = instance.y;
      object.rotation = instance.rotation;
      object.repeatMode = "single";
      object.repeatCount = 1;
      object.repeatRadius = 0;
      this.selectedInstanceIndex = 0;
      this.reveal.delete(object.id);
      this.dirty.patterns = true;
      this.render();
      return true;
    }
    // 伞心上的单个纹样重复时，进入主装饰带；其他区域保留原半径，
    // 让整圈始终以伞心为轴，而不是跳到区域中点或围绕纹样本身偏移。
    if (object.repeatMode !== "radial" && object.zone === "伞心") object.zone = "中部";
    const zone = this.zones.getByName(object.zone);
    const zoneMiddle = (zone.min + zone.max) * .5 * this.canvasManager.radius;
    const center = this.canvasManager.center;
    const dx = object.x - center.x;
    const dy = object.y - center.y;
    const initialRadius = Math.hypot(dx, dy);
    const maxOrbit = this.getMaxOrbitRadius(object);
    const requestedRadius = radius === null
      ? this.zones.clampOrbit(object.repeatMode === "radial" ? object.repeatRadius : (initialRadius > 1 ? initialRadius : zoneMiddle), object.zone, maxOrbit)
      : this.zones.clampOrbit(object.repeatMode !== "radial" && Number(radius) === 0 ? zoneMiddle : radius, object.zone, maxOrbit);
    const changed = object.repeatMode !== "radial" || object.repeatCount !== requestedCount || object.repeatRadius !== requestedRadius;
    if (changed && commit) this.document.commit();
    if (object.repeatMode !== "radial") {
      object.x = 0;
      object.y = 0;
      object.repeatRadius = requestedRadius;
      object.repeatAngle = Math.atan2(dy, dx) + Math.PI / 2;
      object.repeatMode = "radial";
    } else if (radius !== null) object.repeatRadius = this.zones.clampOrbit(radius, object.zone, this.getMaxOrbitRadius(object));
    object.x = 0;
    object.y = 0;
    object.repeatCount = requestedCount;
    this.selectedInstanceIndex = 0;
    this.constrainGroupSize(object);
    this.dirty.patterns = true;
    if (animate) this.animateReveal(object.id, "ring");
    else this.reveal.delete(object.id);
    this.render();
    return true;
  }

  getMaxMotifSize(object) {
    const center = this.canvasManager.center;
    const radius = this.getWorkspaceRadius();
    const baseSize = Math.max(1, object.baseSize);
    if (object.repeatMode === "radial" && object.repeatCount > 1 && object.repeatRadius > 0) {
      let maxSize = Number.POSITIVE_INFINITY;
      const chord = 2 * object.repeatRadius * Math.sin(Math.PI / object.repeatCount) * .96;
      const image = this.patternDrawer.getImage(object.patternId);
      const ratio = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
      const unitWidth = ratio >= 1 ? 1 : ratio;
      const unitHeight = ratio >= 1 ? 1 / ratio : 1;
      const baseAngle = -Math.PI / 2 + object.repeatAngle;
      const angles = Array.from({ length: object.repeatCount }, (_, index) => baseAngle + index * Math.PI * 2 / object.repeatCount);
      const tangentFactor = Math.max(...angles.map((angle) => {
        const rotation = object.rotation + angle - baseAngle;
        const tangentAngle = angle + Math.PI / 2;
        return Math.abs(Math.cos(rotation - tangentAngle)) * unitWidth + Math.abs(Math.sin(rotation - tangentAngle)) * unitHeight;
      }));
      maxSize = Math.min(maxSize, chord / Math.max(.1, tangentFactor));
      // 分区用于排布提示，不限制纹样大小；只按伞缘留白计算可用空间。
      const radialRoom = Math.max(0, radius - object.repeatRadius - 4);
      const radialFactor = Math.max(...angles.map((angle) => {
        const rotation = object.rotation + angle - baseAngle;
        return Math.abs(Math.cos(rotation - angle)) * unitWidth + Math.abs(Math.sin(rotation - angle)) * unitHeight;
      }));
      maxSize = Math.min(maxSize, radialRoom * 2 / Math.max(.1, radialFactor));
      return Math.max(0, maxSize);
    }

    // 单个纹样按实际位置、长宽比和旋转角度计算能完整留在伞面内的最大尺寸。
    // 通过二分查找复用边界几何，避免不同形状被固定分区尺寸过度压小。
    const dx = object.x - center.x;
    const dy = object.y - center.y;
    const distance = Math.hypot(dx, dy);
    const direction = Math.atan2(dy, dx);
    const originalScale = object.scale;
    let lower = .06;
    let upper = Math.max(lower, radius * 2 / baseSize);
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const candidate = (lower + upper) * .5;
      object.scale = candidate;
      if (distance <= this.getMaxCenterDistance(object, direction, radius)) lower = candidate;
      else upper = candidate;
    }
    object.scale = originalScale;
    return baseSize * lower;
  }

  getMaxScale(object) {
    return Math.max(.06, this.canvasManager.size * 2 / Math.max(1, object.baseSize));
  }

  animateReveal(id, kind = "ring") {
    if (this.isBatching) return;
    const object = this.document.patterns.find((item) => item.id === id);
    if (!object) return;
    const state = {
      kind, startedAt: performance.now(), lastFrame: 0,
      stagger: kind === "bloom" ? 0 : 74,
      fade: kind === "bloom" ? 520 : 210,
      target: kind === "bloom" ? 1 : object.repeatCount
    };
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
    else if (property === "repeatRadius") object.repeatRadius = this.zones.clampOrbit(number, object.zone, this.getMaxOrbitRadius(object));
    else if (property === "scale") object.scale = Math.max(.06, Math.min(number, this.getMaxScale(object)));
    else if (property === "rotation") object.rotation = number * Math.PI / 180;
    else if (property === "repeatOrientation") object.repeatOrientation = value;
    if (property === "repeatCount") this.reveal.delete(object.id);
    if (object.repeatMode === "radial") this.constrainGroupSize(object);
    this.dirty.patterns = true;
    this.render();
  }

  constrainGroupSize(object) {
    if (object.repeatMode === "radial") {
      object.x = 0;
      object.y = 0;
    }
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
      ctx.lineWidth = size * .52;
      ctx.globalAlpha = opacity * .12;
      ctx.shadowColor = settings.color;
      ctx.shadowBlur = size * .08;
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
    ctx.lineWidth = settings.brushStyle === "clean"
      ? Math.max(.7, size * .42)
      : settings.brushStyle === "texture" || settings.brushStyle === "soft" ? size * .52 : size;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawStroke(ctx, stroke) {
    const center = this.canvasManager.center;
    const sourceSettings = stroke.settings;
    // GPU ink is the visible artwork for every brush preset. Canvas keeps the
    // editable path/history, but must not paint a duplicate vector stroke.
    if (sourceSettings.gpuInk === true || sourceSettings.brushStyle === "fluid") return;
    const settings = sourceSettings;
    const count = Math.max(1, Number(settings.segments) || 8);
    const mirrorCount = count > 1 && settings.mirror ? 2 : 1;
    const wash = this.inkWash?.strokeId === stroke.id ? this.inkWash : null;
    const washProgress = wash ? Math.min(1, (performance.now() - wash.startedAt) / wash.duration) : 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(center.x, center.y, this.canvasManager.radius - 1, 0, Math.PI * 2); ctx.clip();
    for (let index = 0; index < count; index += 1) {
      for (let mirror = 0; mirror < mirrorCount; mirror += 1) {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(index * Math.PI * 2 / count);
        if (mirror) ctx.scale(1, -1);
        ctx.translate(-center.x, -center.y);
        if (washProgress < 1) {
          const washOpacity = (1 - washProgress) * .14;
          this.drawSmoothPath(ctx, stroke.points, {
            ...settings,
            brushSize: settings.brushSize * 1.65,
            opacity: settings.opacity * washOpacity,
            brushStyle: "soft"
          });
        }
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
      if (reveal.kind === "bloom") {
        const image = this.patternDrawer.getImage(object.patternId);
        if (!image) return;
        const size = object.baseSize * object.scale;
        const ratio = image.naturalWidth / image.naturalHeight;
        const width = ratio >= 1 ? size : size * ratio;
        const height = ratio >= 1 ? size / ratio : size;
        // 圆形遮罩从纹样中心向外舒展，并同步淡入，避免像图标瞬间弹出。
        ctx.save();
        ctx.beginPath();
        ctx.arc(instance.x, instance.y, Math.hypot(width, height) * .5 * eased, 0, Math.PI * 2);
        ctx.clip();
        this.patternDrawer.drawObject(ctx, object, { ...instance, opacity: eased, scale: .94 + .06 * eased });
        ctx.restore();
        return;
      }
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
    const selectedInstance = this.getSelectedInstance(object);
    const dark = document.getElementById("studioPage")?.classList.contains("is-dark-studio");
    ctx.save();
    ctx.strokeStyle = dark ? "rgba(219,242,222,.8)" : "rgba(38,63,58,.72)";
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 4]);
    instances.forEach((instance) => {
      ctx.save(); ctx.translate(instance.x, instance.y); ctx.rotate(instance.rotation);
      ctx.strokeRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8);
      ctx.restore();
    });
    ctx.restore();
    if (!selectedInstance) return;

    const controls = this.getSelectionControls(object);
    const { halfWidth, halfHeight, uiScale } = controls;
    ctx.save();
    ctx.translate(selectedInstance.x, selectedInstance.y);
    ctx.rotate(selectedInstance.rotation);
    ctx.strokeStyle = dark ? "rgba(224, 244, 225, .96)" : "rgba(31, 82, 68, .92)";
    ctx.fillStyle = "rgba(249, 246, 234, .94)";
    ctx.lineWidth = 1.35 * uiScale;
    ctx.setLineDash([]);
    ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
    ctx.beginPath();
    ctx.moveTo(0, -halfHeight);
    ctx.lineTo(0, controls.rotate.localY + 5 * uiScale);
    ctx.stroke();
    for (const handle of controls.corners) {
      ctx.fillRect(handle.localX - 5 * uiScale, handle.localY - 5 * uiScale, 10 * uiScale, 10 * uiScale);
      ctx.strokeRect(handle.localX - 5 * uiScale, handle.localY - 5 * uiScale, 10 * uiScale, 10 * uiScale);
    }
    ctx.beginPath();
    ctx.arc(controls.rotate.localX, controls.rotate.localY, 7.5 * uiScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(controls.rotate.localX, controls.rotate.localY, 3.2 * uiScale, -.9, Math.PI * 1.3);
    ctx.stroke();
    ctx.fillStyle = "rgba(145, 61, 53, .94)";
    ctx.beginPath();
    ctx.arc(controls.remove.localX, controls.remove.localY, 8 * uiScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 1.4 * uiScale;
    ctx.beginPath();
    ctx.moveTo(controls.remove.localX - 4 * uiScale, controls.remove.localY - 4 * uiScale);
    ctx.lineTo(controls.remove.localX + 4 * uiScale, controls.remove.localY + 4 * uiScale);
    ctx.moveTo(controls.remove.localX + 4 * uiScale, controls.remove.localY - 4 * uiScale);
    ctx.lineTo(controls.remove.localX - 4 * uiScale, controls.remove.localY + 4 * uiScale);
    ctx.stroke();
    ctx.fillStyle = "rgba(45, 105, 86, .9)";
    for (const handle of [controls.repeatMinus, controls.repeatPlus]) {
      ctx.beginPath();
      ctx.arc(handle.localX, handle.localY, 8 * uiScale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#fbf7e9";
    ctx.font = `600 ${10 * uiScale}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("−", controls.repeatMinus.localX, controls.repeatMinus.localY);
    ctx.fillText("+", controls.repeatPlus.localX, controls.repeatPlus.localY);
    ctx.fillStyle = dark ? "rgba(235, 250, 232, .98)" : "rgba(36, 75, 62, .9)";
    ctx.font = `500 ${9 * uiScale}px 'Chill HuoKai', serif`;
    ctx.fillText(`环绕 ×${object.repeatMode === "radial" ? object.repeatCount : 1}`, 0, controls.repeatPlus.localY);
    ctx.restore();
  }

  getSelectionControls(object = this.getSelected()) {
    if (!object) return null;
    const image = this.patternDrawer.getImage(object.patternId);
    const size = object.baseSize * object.scale;
    const ratio = image?.naturalWidth / image?.naturalHeight || 1;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    const uiScale = Math.max(.8, Math.min(1.65, Math.sqrt(Math.max(width, height) / 180)));
    const halfWidth = width * .5 + 6 * uiScale;
    const halfHeight = height * .5 + 6 * uiScale;
    return {
      width,
      height,
      halfWidth,
      halfHeight,
      uiScale,
      corners: [
        { name: "resize-nw", localX: -halfWidth, localY: -halfHeight },
        { name: "resize-ne", localX: halfWidth, localY: -halfHeight },
        { name: "resize-sw", localX: -halfWidth, localY: halfHeight },
        { name: "resize-se", localX: halfWidth, localY: halfHeight }
      ],
      rotate: { name: "rotate", localX: 0, localY: -halfHeight - 33 * uiScale },
      repeatMinus: { name: "repeat-minus", localX: -38 * uiScale, localY: halfHeight + 18 * uiScale },
      repeatPlus: { name: "repeat-plus", localX: 38 * uiScale, localY: halfHeight + 18 * uiScale },
      remove: { name: "delete", localX: halfWidth + 10 * uiScale, localY: -halfHeight - 10 * uiScale }
    };
  }

  hitSelectionControl(point, object = this.getSelected()) {
    if (!object || !point) return null;
    const instance = this.getSelectedInstance(object);
    const controls = this.getSelectionControls(object);
    if (!instance || !controls) return null;
    const dx = point.x - instance.x;
    const dy = point.y - instance.y;
    const cosine = Math.cos(instance.rotation);
    const sine = Math.sin(instance.rotation);
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    const tolerance = 13 * controls.uiScale;
    const candidates = [...controls.corners, controls.rotate, controls.repeatMinus, controls.repeatPlus, controls.remove];
    const hit = candidates.find((handle) =>
      Math.hypot(localX - handle.localX, localY - handle.localY) <= tolerance
    );
    return hit?.name || null;
  }

  render({ markTexture = true } = {}) {
    if (this.isBatching) return;
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
    const selectionCtx = this.canvasManager.selectionCtx || overlayCtx;
    if (selectionCtx !== overlayCtx) selectionCtx.clearRect(-this.canvasManager.size, -this.canvasManager.size, this.canvasManager.size * 3, this.canvasManager.size * 3);
    this.drawSelection(selectionCtx, this.getSelected());
    this.canvasManager.renderScene();
    if (artworkChanged && markTexture) this.canvasManager.markTextureDirty();
  }

}
