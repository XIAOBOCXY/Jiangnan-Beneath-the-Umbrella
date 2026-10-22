// CanvasManager 合成高分屏绸伞图层，并在导出时省略编辑辅助层。
const SIZE = 720;
const CENTER = SIZE / 2;
// 伞面占编辑画布直径约 68%，让作品四周保留可见留白。
const CANOPY_RADIUS = 246;
const ART_RADIUS = 238;
const TEXTURE_SIZE = 1024;
const RIB_COUNT = 24;
const CLOTH_SOURCE = new URL("../../assets/umbrella-cloth.png", import.meta.url).href;
const DEFAULT_SETTINGS = { fabricColor: "#f1eee5", fabricStyle: "silk" };

export class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.layers = {};
    this.textureCanvas = document.createElement("canvas");
    this.textureCanvas.width = TEXTURE_SIZE;
    this.textureCanvas.height = TEXTURE_SIZE;
    this.textureDirty = true;
    this.textureVersion = 0;
    this.lastSettings = { ...DEFAULT_SETTINGS };
    this.clothImage = { complete: false };
    this.createLayers();
    this.clothImage = new Image();
    this.clothImage.onload = () => this.renderBase(this.lastSettings);
    this.clothImage.src = CLOTH_SOURCE;
    this.pointerLight = null;
    this.renderBase(DEFAULT_SETTINGS);
    this.resizeObserver = new ResizeObserver(() => this.updatePixelRatio());
    this.resizeObserver.observe(canvas);
    window.addEventListener("resize", () => this.updatePixelRatio());
  }

  createLayers() {
    ["base", "art", "pattern", "relief", "atmosphere", "light", "structure", "sheen", "overlay"].forEach((name) => {
      const canvasLayer = document.createElement("canvas");
      const ctx = canvasLayer.getContext("2d");
      this.layers[name] = { canvas: canvasLayer, ctx };
      this[`${name}Layer`] = canvasLayer;
      this[`${name}Ctx`] = ctx;
    });
    this.updatePixelRatio(true);
  }

  updatePixelRatio(force = false) {
    // 多张离屏画布并行合成，限制到 2x 以控制 iPad Safari 的显存占用。
    const next = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (!force && next === this.dpr) return;
    this.dpr = next;
    [this.canvas, ...Object.values(this.layers).map((layer) => layer.canvas)].forEach((layer) => {
      layer.width = Math.round(SIZE * this.dpr);
      layer.height = Math.round(SIZE * this.dpr);
      const context = layer.getContext("2d");
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    });
    this.ctx = this.canvas.getContext("2d");
    Object.entries(this.layers).forEach(([name, layer]) => { this[`${name}Ctx`] = layer.canvas.getContext("2d"); });
    this.renderBase(this.lastSettings);
    if (this.onResize) this.onResize();
  }

  get size() { return SIZE; }
  get center() { return { x: CENTER, y: CENTER }; }
  get radius() { return ART_RADIUS; }

  getPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * SIZE / rect.width, y: (event.clientY - rect.top) * SIZE / rect.height };
  }

  containsPoint(point) { return Math.hypot(point.x - CENTER, point.y - CENTER) <= ART_RADIUS - 2; }

  renderBase(settings = DEFAULT_SETTINGS) {
    this.lastSettings = { ...this.lastSettings, ...settings };
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const paper = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    paper.addColorStop(0, "#f5f2e9"); paper.addColorStop(.55, "#eee9dd"); paper.addColorStop(1, "#e6e0d2");
    ctx.fillStyle = paper; ctx.fillRect(0, 0, SIZE, SIZE);
    this.drawPaperGrain(ctx);
    ctx.save();
    ctx.shadowColor = "rgba(38,63,58,.16)"; ctx.shadowBlur = 15;
    ctx.fillStyle = "#fbf8ef"; ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (this.clothImage.complete && this.clothImage.naturalWidth) this.drawClothImage(ctx);
    else this.drawClothFallback(ctx);
    this.applyFabricTint(ctx, this.lastSettings.fabricColor || DEFAULT_SETTINGS.fabricColor);
    this.drawPanelLight(ctx);
    this.drawSilkWeave(ctx);
    this.drawFabricTexture(ctx, this.lastSettings.fabricStyle || "silk");
    this.renderReliefLayer();
    this.renderAtmosphereLayer();
    this.renderSilkSheenLayer();
    this.renderStructure();
    this.renderScene();
    this.markTextureDirty();
  }

  drawClothImage(ctx) {
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 5, 0, Math.PI * 2); ctx.clip();
    const diameter = CANOPY_RADIUS * 2;
    ctx.drawImage(this.clothImage, CENTER - CANOPY_RADIUS, CENTER - CANOPY_RADIUS, diameter, diameter);
    ctx.restore();
  }

  applyFabricTint(ctx, color) {
    if (!color || color.toLowerCase() === "#f1eee5") return;
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 5, 0, Math.PI * 2); ctx.clip();
    ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = color.toLowerCase() === "#d5e5dd" ? .11 : .2;
    ctx.fillStyle = color; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore();
  }

  drawPaperGrain(ctx) {
    let seed = 7281;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    ctx.save(); ctx.fillStyle = "rgba(67,78,66,.05)";
    for (let index = 0; index < 650; index += 1) ctx.fillRect(random() * SIZE, random() * SIZE, .8, .8);
    ctx.restore();
  }

  drawClothFallback(ctx) {
    const cloth = ctx.createRadialGradient(CENTER - 95, CENTER - 120, 18, CENTER, CENTER, CANOPY_RADIUS);
    cloth.addColorStop(0, "#fffdf8"); cloth.addColorStop(.72, "#f1eee5"); cloth.addColorStop(1, "#d8d0c0");
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS, 0, Math.PI * 2); ctx.fillStyle = cloth; ctx.fill();
    ctx.clip();
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const step = Math.PI * 2 / RIB_COUNT;
      ctx.fillStyle = panel % 2 ? "rgba(83,124,126,.025)" : "rgba(255,255,255,.10)";
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER); ctx.arc(CENTER, CENTER, CANOPY_RADIUS, -Math.PI / 2 + panel * step, -Math.PI / 2 + (panel + 1) * step); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawPanelLight(ctx) {
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 8, 0, Math.PI * 2); ctx.clip();
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const angle = Math.PI * 2 / RIB_COUNT;
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, CANOPY_RADIUS, -Math.PI / 2 + panel * angle, -Math.PI / 2 + (panel + 1) * angle);
      ctx.closePath(); ctx.fillStyle = panel % 2 ? "rgba(76,91,72,.024)" : "rgba(255,255,255,.045)"; ctx.fill();
    }
    const sheen = ctx.createRadialGradient(CENTER - 92, CENTER - 132, 10, CENTER - 35, CENTER - 24, CANOPY_RADIUS * .92);
    sheen.addColorStop(0, "rgba(255,255,255,.16)"); sheen.addColorStop(.48, "rgba(255,255,255,.025)"); sheen.addColorStop(1, "rgba(81,83,64,.055)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore();
  }

  drawSilkWeave(ctx) {
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 8, 0, Math.PI * 2); ctx.clip();
    ctx.lineWidth = .38; ctx.strokeStyle = "rgba(113,101,78,.045)";
    for (let offset = 26; offset < SIZE; offset += 5) {
      ctx.beginPath(); ctx.moveTo(offset, 22); ctx.lineTo(offset - 20, 698); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    for (let offset = 20; offset < SIZE; offset += 7) {
      ctx.beginPath(); ctx.moveTo(18, offset); ctx.lineTo(702, offset + 14); ctx.stroke();
    }
    ctx.restore();
  }

  drawFabricTexture(ctx, style) {
    if (style === "silk") return;
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx.clip();
    if (style === "gauze") {
      ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = .55;
      for (let offset = -360; offset < 760; offset += 18) { ctx.beginPath(); ctx.moveTo(offset, 25); ctx.lineTo(offset + 240, 700); ctx.stroke(); }
    } else if (style === "indigo") {
      ctx.fillStyle = "rgba(38,63,58,.11)";
      for (let row = 0; row < 22; row += 1) for (let column = 0; column < 22; column += 1) {
        if ((row * 7 + column * 11) % 4 === 0) { ctx.beginPath(); ctx.arc(94 + column * 24, 94 + row * 24, 1.2, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  renderReliefLayer() {
    const ctx = this.reliefCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx.clip();

    // 向伞缘轻微收暗，并在伞骨两侧留出凹影，模拟绸面的张力起伏。
    const edgeShade = ctx.createRadialGradient(CENTER - 26, CENTER - 34, 22, CENTER, CENTER, CANOPY_RADIUS);
    edgeShade.addColorStop(0, "rgba(48,58,48,0)");
    edgeShade.addColorStop(.62, "rgba(48,58,48,.012)");
    edgeShade.addColorStop(.86, "rgba(48,58,48,.045)");
    edgeShade.addColorStop(1, "rgba(48,58,48,.13)");
    ctx.fillStyle = edgeShade; ctx.fillRect(0, 0, SIZE, SIZE);

    const step = Math.PI * 2 / RIB_COUNT;
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const start = -Math.PI / 2 + panel * step;
      const shade = ctx.createRadialGradient(CENTER, CENTER, 28, CENTER, CENTER, CANOPY_RADIUS);
      shade.addColorStop(0, "rgba(255,255,255,0)");
      shade.addColorStop(.72, panel % 2 ? "rgba(45,55,48,.008)" : "rgba(255,255,255,.008)");
      shade.addColorStop(1, panel % 2 ? "rgba(45,55,48,.035)" : "rgba(255,255,255,.026)");
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, CANOPY_RADIUS, start, start + step); ctx.closePath();
      ctx.fillStyle = shade; ctx.fill();

      const outerX = CENTER + Math.cos(start) * (CANOPY_RADIUS - 8);
      const outerY = CENTER + Math.sin(start) * (CANOPY_RADIUS - 8);
      ctx.beginPath();
      ctx.moveTo(CENTER + Math.cos(start) * 18, CENTER + Math.sin(start) * 18);
      ctx.lineTo(outerX, outerY);
      ctx.lineWidth = 3.2; ctx.strokeStyle = "rgba(62,49,35,.045)";
      ctx.shadowColor = "rgba(57,46,35,.07)"; ctx.shadowBlur = 3; ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  renderAtmosphereLayer() {
    const ctx = this.atmosphereCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 4, 0, Math.PI * 2); ctx.clip();
    const vignette = ctx.createRadialGradient(CENTER - 38, CENTER - 50, 40, CENTER, CENTER, CANOPY_RADIUS);
    vignette.addColorStop(0, "rgba(55,49,39,0)");
    vignette.addColorStop(.72, "rgba(55,49,39,.006)");
    vignette.addColorStop(.91, "rgba(55,49,39,.035)");
    vignette.addColorStop(1, "rgba(55,49,39,.105)");
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();
  }

  renderSilkSheenLayer() {
    const ctx = this.sheenCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx.clip();

    // 宽而柔的斜向反光叠在最上层，不形成硬边或霓虹光圈。
    const sheen = ctx.createLinearGradient(145, 120, 580, 565);
    sheen.addColorStop(0, "rgba(255,255,246,0)");
    sheen.addColorStop(.31, "rgba(255,255,246,.025)");
    sheen.addColorStop(.43, "rgba(255,255,246,.115)");
    sheen.addColorStop(.49, "rgba(255,255,246,.045)");
    sheen.addColorStop(.66, "rgba(255,255,246,.012)");
    sheen.addColorStop(1, "rgba(255,255,246,0)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, SIZE, SIZE);

    // 少量纤维高光沿伞骨方向延伸，提示扇面张开的弧度。
    ctx.lineWidth = .55; ctx.strokeStyle = "rgba(255,252,238,.12)";
    for (let rib = 1; rib < RIB_COUNT; rib += 3) {
      const angle = -Math.PI / 2 + rib * Math.PI * 2 / RIB_COUNT;
      const startX = CENTER + Math.cos(angle) * 26, startY = CENTER + Math.sin(angle) * 26;
      const endX = CENTER + Math.cos(angle) * (CANOPY_RADIUS - 13), endY = CENTER + Math.sin(angle) * (CANOPY_RADIUS - 13);
      const bend = angle + Math.PI / 2;
      const controlX = CENTER + Math.cos(angle) * (CANOPY_RADIUS * .48) + Math.cos(bend) * 3;
      const controlY = CENTER + Math.sin(angle) * (CANOPY_RADIUS * .48) + Math.sin(bend) * 3;
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.quadraticCurveTo(controlX, controlY, endX, endY); ctx.stroke();
    }
    ctx.restore();
  }

  renderStructure() {
    const ctx = this.structureCtx; ctx.clearRect(0, 0, SIZE, SIZE);
    // 底图提供竹骨纹理，顶层只压一条细微高光，让笔迹仍能被伞骨分隔。
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 3, 0, Math.PI * 2); ctx.clip(); this.drawBambooRibs(ctx); ctx.restore();
    this.drawUmbrellaHub(ctx); this.drawCanopyHem(ctx);
  }

  drawBambooRibs(ctx) {
    const step = Math.PI * 2 / RIB_COUNT;
    for (let rib = 0; rib < RIB_COUNT; rib += 1) {
      const angle = -Math.PI / 2 + rib * step;
      const endX = CENTER + Math.cos(angle) * (CANOPY_RADIUS - 10);
      const endY = CENTER + Math.sin(angle) * (CANOPY_RADIUS - 10);
      const startX = CENTER + Math.cos(angle) * 15;
      const startY = CENTER + Math.sin(angle) * 15;
      const normalX = -Math.sin(angle), normalY = Math.cos(angle);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY);
      ctx.lineWidth = 1.1; ctx.strokeStyle = "rgba(91,67,44,.26)"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(startX + normalX * .65, startY + normalY * .65);
      ctx.lineTo(endX + normalX * .65, endY + normalY * .65);
      ctx.lineWidth = .45; ctx.strokeStyle = "rgba(255,238,202,.42)"; ctx.stroke();
    }
  }

  drawUmbrellaHub(ctx) {
    ctx.save(); const wood = ctx.createRadialGradient(CENTER - 3, CENTER - 4, 1, CENTER, CENTER, 15);
    wood.addColorStop(0, "#f0d69f"); wood.addColorStop(.55, "#b88a55"); wood.addColorStop(1, "#765638");
    ctx.beginPath(); ctx.arc(CENTER, CENTER, 15, 0, Math.PI * 2); ctx.fillStyle = wood; ctx.fill();
    ctx.strokeStyle = "rgba(94,64,39,.72)"; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.beginPath(); ctx.arc(CENTER, CENTER, 10.5, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,240,204,.72)"; ctx.lineWidth = .8; ctx.stroke();
    ctx.beginPath(); ctx.arc(CENTER, CENTER, 5, 0, Math.PI * 2); ctx.fillStyle = "#815d3c"; ctx.fill();
    ctx.restore();
  }

  drawCanopyHem(ctx) {
    const ctx2 = ctx; ctx2.save();
    ctx2.beginPath(); ctx2.arc(CENTER, CENTER, CANOPY_RADIUS - 3, 0, Math.PI * 2); ctx2.strokeStyle = "rgba(83,124,126,.35)"; ctx2.lineWidth = 1.1; ctx2.stroke();
    ctx2.beginPath(); ctx2.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx2.strokeStyle = "rgba(191,163,122,.44)"; ctx2.lineWidth = .8; ctx2.stroke();
    ctx2.fillStyle = "rgba(191,163,122,.72)";
    for (let stitch = 0; stitch < 72; stitch += 1) { const angle = stitch * Math.PI * 2 / 72; ctx2.beginPath(); ctx2.arc(CENTER + Math.cos(angle) * (CANOPY_RADIUS - 5), CENTER + Math.sin(angle) * (CANOPY_RADIUS - 5), .85, 0, Math.PI * 2); ctx2.fill(); }
    ctx2.restore();
  }

  setPointerLight(point) { this.pointerLight = point; this.renderLight(); this.renderScene(); }
  renderLight() {
    const ctx = this.lightCtx; ctx.clearRect(0, 0, SIZE, SIZE);
    if (!this.pointerLight) return;
    const { x, y } = this.pointerLight; const gradient = ctx.createRadialGradient(x, y, 0, x, y, 138);
    gradient.addColorStop(0, "rgba(255,255,255,.16)"); gradient.addColorStop(.5, "rgba(255,255,255,.055)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 6, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = gradient; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore();
  }

  renderScene(includeOverlay = true) {
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(this.baseLayer, 0, 0, SIZE, SIZE);
    this.ctx.drawImage(this.artLayer, 0, 0, SIZE, SIZE);
    this.ctx.save(); this.ctx.globalCompositeOperation = "multiply"; this.ctx.globalAlpha = .88;
    this.ctx.drawImage(this.patternLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    this.ctx.save(); this.ctx.globalCompositeOperation = "multiply"; this.ctx.globalAlpha = .5;
    this.ctx.drawImage(this.reliefLayer, 0, 0, SIZE, SIZE);
    this.ctx.globalAlpha = .56; this.ctx.drawImage(this.atmosphereLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    this.ctx.save(); this.ctx.globalCompositeOperation = "screen"; this.ctx.globalAlpha = .72;
    this.ctx.drawImage(this.lightLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    this.ctx.drawImage(this.structureLayer, 0, 0, SIZE, SIZE);
    this.ctx.save(); this.ctx.globalCompositeOperation = "screen"; this.ctx.globalAlpha = .46;
    this.ctx.drawImage(this.sheenLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    if (includeOverlay) this.ctx.drawImage(this.overlayLayer, 0, 0, SIZE, SIZE);
  }

  markTextureDirty() {
    this.textureDirty = true;
    if (this.onTextureDirty) this.onTextureDirty();
  }

  // 只在切换到 3D 或作品有改动后合成一次；调用方复用同一张 CanvasTexture 源。
  getUmbrellaTextureCanvas() {
    if (!this.textureDirty) return this.textureCanvas;
    const source = this.createExportCanvas({ includeStructure: false });
    const sourceInset = CENTER - CANOPY_RADIUS;
    const sourceDiameter = CANOPY_RADIUS * 2;
    const context = this.textureCanvas.getContext("2d");
    context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    context.drawImage(
      source,
      sourceInset * this.dpr, sourceInset * this.dpr,
      sourceDiameter * this.dpr, sourceDiameter * this.dpr,
      0, 0, TEXTURE_SIZE, TEXTURE_SIZE
    );
    this.textureDirty = false;
    this.textureVersion += 1;
    return this.textureCanvas;
  }

  createExportCanvas(options = {}) {
    const output = document.createElement("canvas"); output.width = Math.round(SIZE * this.dpr); output.height = Math.round(SIZE * this.dpr);
    const context = output.getContext("2d"); context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const layerNames = ["baseLayer", "artLayer", "patternLayer", "reliefLayer", "atmosphereLayer"];
    if (options.includeStructure !== false) layerNames.push("structureLayer");
    layerNames.push("sheenLayer");
    layerNames.forEach((name) => {
      context.save();
      if (name === "patternLayer") { context.globalCompositeOperation = "multiply"; context.globalAlpha = .88; }
      if (name === "reliefLayer") { context.globalCompositeOperation = "multiply"; context.globalAlpha = .5; }
      if (name === "atmosphereLayer") { context.globalCompositeOperation = "multiply"; context.globalAlpha = .56; }
      if (name === "sheenLayer") { context.globalCompositeOperation = "screen"; context.globalAlpha = .46; }
      context.drawImage(this[name], 0, 0, SIZE, SIZE); context.restore();
    });
    return output;
  }

  clearArt() { this.artCtx.clearRect(0, 0, SIZE, SIZE); this.patternCtx.clearRect(0, 0, SIZE, SIZE); this.renderScene(); }
}
