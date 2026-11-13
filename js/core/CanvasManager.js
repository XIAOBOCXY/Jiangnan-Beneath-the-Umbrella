// CanvasManager 合成高分屏绸伞图层，并在导出时省略编辑辅助层。
const SIZE = 720;
const CENTER = SIZE / 2;
// 伞面占编辑画布直径约 68%，让作品四周保留可见留白。
const CANOPY_RADIUS = 246;
const ART_RADIUS = 238;
const TEXTURE_SIZE = 1024;
// Use the documented 36-rib example so the 2D canopy matches the 3D model.
const RIB_COUNT = 36;
const MAX_VIEW_ZOOM = 18;
const CLOTH_SOURCE = new URL("../../assets/umbrella-cloth.png", import.meta.url).href;
// 以馆藏常见的青绿染色乔其纱作为初始伞面，避免新作品默认呈现成白纸面。
const DEFAULT_SETTINGS = { fabricColor: "#8aa79b", fabricMaterial: "georgette" };

export class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.selectionCanvas = document.getElementById("selectionOverlay");
    this.dpr = 1;
    // The canopy nearly fills the available square editor area by default.
    this.viewZoom = 1;
    this.viewRotation = 0;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.layers = {};
    this.textureCanvas = document.createElement("canvas");
    this.textureCanvas.width = TEXTURE_SIZE;
    this.textureCanvas.height = TEXTURE_SIZE;
    this.textureDirty = true;
    this.textureVersion = 0;
    this.fluidSnapshotCanvas = null;
    this.lastSettings = { ...DEFAULT_SETTINGS };
    this.clothImage = { complete: false };
    this.createLayers();
    this.clothImage = new Image();
    this.clothImage.onload = () => this.renderBase(this.lastSettings);
    this.clothImage.src = CLOTH_SOURCE;
    this.renderBase(DEFAULT_SETTINGS);
    this.resizeObserver = new ResizeObserver(() => this.updatePixelRatio());
    this.resizeObserver.observe(canvas);
    this.updateZoomLayout();
    window.addEventListener("resize", () => {
      this.updatePixelRatio();
      this.updateZoomLayout();
    });
  }

  createLayers() {
    ["base", "art", "artSurface", "pattern", "patternSurface", "relief", "atmosphere", "structure", "sheen", "overlay"].forEach((name) => {
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
    if (this.selectionCanvas) {
      // Give the selection layer room beyond the artwork; it is never exported.
      const overlayDpr = Math.min(this.dpr, 1.5);
      this.selectionCanvas.width = Math.round(SIZE * 3 * overlayDpr);
      this.selectionCanvas.height = Math.round(SIZE * 3 * overlayDpr);
      this.selectionCtx = this.selectionCanvas.getContext("2d");
      this.selectionCtx.setTransform(overlayDpr, 0, 0, overlayDpr, SIZE * overlayDpr, SIZE * overlayDpr);
    }
    Object.entries(this.layers).forEach(([name, layer]) => { this[`${name}Ctx`] = layer.canvas.getContext("2d"); });
    this.renderBase(this.lastSettings);
    if (this.onResize) this.onResize();
  }

  get size() { return SIZE; }
  get center() { return { x: CENTER, y: CENTER }; }
  get radius() { return ART_RADIUS; }

  getPoint(event) {
    const stage = this.canvas.closest(".canvas-stage");
    const rect = stage?.getBoundingClientRect() || this.canvas.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width * 0.5);
    const dy = event.clientY - (rect.top + rect.height * 0.5);
    // Invert the centered CSS view transform. Keeping this tied to view state
    // ensures drawing remains registered while zoom and rotation are active.
    const cosine = Math.cos(this.viewRotation);
    const sine = Math.sin(this.viewRotation);
    const translatedX = dx - this.viewPanX;
    const translatedY = dy - this.viewPanY;
    const localX = (cosine * translatedX + sine * translatedY) / this.viewZoom;
    const localY = (-sine * translatedX + cosine * translatedY) / this.viewZoom;
    // View zoom/rotation never modifies the drawing data or the 3D UV map.
    return {
      x: (localX / rect.width + 0.5) * SIZE,
      y: (localY / rect.height + 0.5) * SIZE
    };
  }

  getStageAngle(event) {
    const stage = this.canvas.closest(".canvas-stage");
    const rect = stage?.getBoundingClientRect() || this.canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5 + this.viewPanX;
    const centerY = rect.top + rect.height * 0.5 + this.viewPanY;
    return Math.atan2(event.clientY - centerY, event.clientX - centerX);
  }

  setViewTransform(zoom = this.viewZoom, rotation = this.viewRotation, panX = this.viewPanX, panY = this.viewPanY) {
    const stage = this.canvas.closest(".canvas-stage");
    const before = stage?.getBoundingClientRect();
    // Detailed inspection extends beyond the original square editor viewport.
    this.viewZoom = Math.max(0.35, Math.min(MAX_VIEW_ZOOM, zoom));
    this.viewRotation = rotation;
    this.viewPanX = panX;
    this.viewPanY = panY;
    const viewports = [document.getElementById("canvasArtworkViewport"), document.getElementById("selectionOverlayViewport")].filter(Boolean);
    const updateViewports = () => viewports.forEach((viewport) => { viewport.style.transform = `translate(${this.viewPanX}px, ${this.viewPanY}px) scale(${this.viewZoom}) rotate(${this.viewRotation}rad)`; });
    updateViewports();
    this.updateZoomLayout();
    // Reserving mobile scroll space can move the square stage in document
    // layout. Counter that layout shift in the canvas pan so the artwork's
    // screen-space center stays stable across repeated zoom in/out cycles.
    const after = stage?.getBoundingClientRect();
    if (before && after) {
      const centerShiftY = (after.top + after.height * 0.5) - (before.top + before.height * 0.5);
      if (Math.abs(centerShiftY) > 0.1) {
        this.viewPanY -= centerShiftY;
        updateViewports();
      }
    }
  }

  updateZoomLayout() {
    const stage = this.canvas.closest(".canvas-stage");
    if (!stage) return;
    if (!window.matchMedia("(max-width: 980px)").matches) {
      stage.style.removeProperty("--zoom-reserve-top");
      stage.style.removeProperty("--zoom-reserve-bottom");
      return;
    }

    const rect = stage.getBoundingClientRect();
    // The artwork is circular, so rotating it does not increase its visible
    // height. Reserve space for zoom only, keeping the controls stationary.
    const verticalSpan = this.viewZoom * Math.max(rect.width, rect.height);
    const extra = Math.max(0, (verticalSpan - rect.height) * 0.5);
    // Symmetric reserve prevents the stage center from drifting with panY.
    stage.style.setProperty("--zoom-reserve-top", `${extra}px`);
    stage.style.setProperty("--zoom-reserve-bottom", `${extra}px`);
  }

  containsPoint(point) { return Math.hypot(point.x - CENTER, point.y - CENTER) <= ART_RADIUS - 2; }
  containsWorkspacePoint(point) { return Math.hypot(point.x - CENTER, point.y - CENTER) <= SIZE / 2 - 10; }

  renderBase(settings = DEFAULT_SETTINGS, { deferRender = false } = {}) {
    this.surfaceVersion = (this.surfaceVersion || 0) + 1;
    this.lastSettings = { ...this.lastSettings, ...settings };
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Do not paint the editor's square paper into the exported umbrella. The
    // old full-canvas fill left a pale disc and a thin white halo outside the
    // real cloth edge even when CSS clipped the viewport to a circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 5, 0, Math.PI * 2);
    ctx.clip();
    // The selected dye owns the hue. An ivory undercoat mixed with a partial
    // tint made greens yellow and made neutral fabric look cream.
    ctx.fillStyle = this.lastSettings.fabricColor || DEFAULT_SETTINGS.fabricColor;
    ctx.fillRect(0, 0, SIZE, SIZE);
    this.drawPaperGrain(ctx);
    ctx.restore();
    // The photograph supplies fine cloth detail; its baked directional light
    // must not turn adjacent panels into different dye colors.
    ctx.save();
    ctx.globalAlpha = .28;
    ctx.globalCompositeOperation = "multiply";
    if (this.clothImage.complete && this.clothImage.naturalWidth) this.drawClothImage(ctx);
    else this.drawClothFallback(ctx);
    ctx.restore();
    this.drawPanelLight(ctx);
    this.drawSilkWeave(ctx, this.lastSettings.fabricMaterial || DEFAULT_SETTINGS.fabricMaterial);
    // The editor shows the same light-transmitting cloth as the 3D viewer.
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const opacity = { georgette: .80, plainSilk: .91, denseSilk: .97 }[this.lastSettings.fabricMaterial] || .80;
    ctx.fillStyle = `rgba(0,0,0,${opacity})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
    this.applyGauzeWeave(ctx, this.lastSettings.fabricMaterial);
    ctx.restore();
    this.renderReliefLayer();
    this.renderAtmosphereLayer();
    this.renderSilkSheenLayer();
    this.renderStructure();
    this.onBaseChange?.();
    if (!deferRender) {
      this.renderScene();
      this.markTextureDirty();
    }
  }

  drawClothImage(ctx) {
    if (this.neutralClothSource !== this.clothImage || this.neutralClothSrc !== this.clothImage.currentSrc) {
      const canvas = document.createElement("canvas");
      canvas.width = this.clothImage.naturalWidth;
      canvas.height = this.clothImage.naturalHeight;
      const detail = canvas.getContext("2d", { willReadFrequently: true });
      detail.drawImage(this.clothImage, 0, 0);
      const image = detail.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < image.data.length; index += 4) {
        const luminance = Math.round(image.data[index] * .2126 + image.data[index + 1] * .7152 + image.data[index + 2] * .0722);
        image.data[index] = image.data[index + 1] = image.data[index + 2] = luminance;
      }
      detail.putImageData(image, 0, 0);
      this.neutralClothImage = canvas;
      this.neutralClothSource = this.clothImage;
      this.neutralClothSrc = this.clothImage.currentSrc;
    }
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 5, 0, Math.PI * 2); ctx.clip();
    const diameter = CANOPY_RADIUS * 2;
    ctx.drawImage(this.neutralClothImage, CENTER - CANOPY_RADIUS, CENTER - CANOPY_RADIUS, diameter, diameter);
    ctx.restore();
  }

  drawPaperGrain(ctx) {
    let seed = 7281;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    ctx.save(); ctx.fillStyle = "rgba(73,73,73,.05)";
    for (let index = 0; index < 650; index += 1) ctx.fillRect(random() * SIZE, random() * SIZE, .8, .8);
    ctx.restore();
  }

  drawClothFallback(ctx) {
    const cloth = ctx.createRadialGradient(CENTER - 95, CENTER - 120, 18, CENTER, CENTER, CANOPY_RADIUS);
    cloth.addColorStop(0, "#f9f9f9"); cloth.addColorStop(.72, "#efefef"); cloth.addColorStop(1, "#d0d0d0");
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS, 0, Math.PI * 2); ctx.fillStyle = cloth; ctx.fill();
    ctx.clip();
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const step = Math.PI * 2 / RIB_COUNT;
      ctx.fillStyle = panel % 2 ? "rgba(105,105,105,.025)" : "rgba(255,255,255,.10)";
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER); ctx.arc(CENTER, CENTER, CANOPY_RADIUS, -Math.PI / 2 + panel * step, -Math.PI / 2 + (panel + 1) * step); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawPanelLight(ctx) {
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 8, 0, Math.PI * 2); ctx.clip();
    // A neutral broad highlight and soft rim give the editable 2D silk a
    // rounded canopy without adding yellow to the selected fabric colour.
    const dome = ctx.createRadialGradient(CENTER - 52, CENTER - 65, 12, CENTER, CENTER, CANOPY_RADIUS);
    dome.addColorStop(0, "rgba(255,255,255,.14)");
    dome.addColorStop(.48, "rgba(255,255,255,.055)");
    dome.addColorStop(.78, "rgba(255,255,255,0)");
    dome.addColorStop(1, "rgba(35,45,42,.09)");
    ctx.fillStyle = dome; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const angle = Math.PI * 2 / RIB_COUNT;
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, CANOPY_RADIUS, -Math.PI / 2 + panel * angle, -Math.PI / 2 + (panel + 1) * angle);
      ctx.closePath(); ctx.fillStyle = panel % 2 ? "rgba(65,65,65,.035)" : "rgba(255,255,255,.026)"; ctx.fill();
    }
    ctx.restore();
  }

  drawSilkWeave(ctx, material = "georgette") {
    const profiles = {
      georgette: { warp: 4.8, weft: 6.2, alpha: 0.095, tint: "92,92,92" },
      plainSilk: { warp: 5.2, weft: 5.8, alpha: 0.07, tint: "87,87,87" },
      denseSilk: { warp: 4.2, weft: 5.0, alpha: 0.076, tint: "78,78,78" }
    };
    const profile = profiles[material] || profiles.georgette;
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 8, 0, Math.PI * 2); ctx.clip();
    ctx.lineWidth = .54; ctx.strokeStyle = `rgba(${profile.tint},${profile.alpha})`;
    for (let offset = 26; offset < SIZE; offset += profile.warp) {
      ctx.beginPath(); ctx.moveTo(offset, 22); ctx.bezierCurveTo(offset - 4, 220, offset - 15, 506, offset - 20, 698); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(255,255,255,${profile.alpha * 1.1})`;
    for (let offset = 20; offset < SIZE; offset += profile.weft) {
      ctx.beginPath(); ctx.moveTo(18, offset); ctx.bezierCurveTo(228, offset - 2, 494, offset + 12, 702, offset + 14); ctx.stroke();
    }
    ctx.restore();
  }

  applyGauzeWeave(ctx, material = "georgette") {
    const strength = { georgette: 1, plainSilk: .3, denseSilk: 0 }[material] ?? 1;
    if (!strength) return;
    this.gauzeTiles ||= new Map();
    let tile = this.gauzeTiles.get(material);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.width = tile.height = 128;
      const fiber = tile.getContext("2d");
      // Fine openings transmit a little more of the scene behind the silk;
      // the original overall fabric opacity remains the starting point.
      fiber.fillStyle = `rgba(0,0,0,${1 - .045 * strength})`;
      fiber.fillRect(0, 0, 128, 128);
      fiber.lineWidth = .8;
      fiber.strokeStyle = "#000";
      for (let offset = 0; offset < 128; offset += 4) {
        fiber.beginPath();
        fiber.moveTo(offset + .5, 0); fiber.lineTo(offset + .5, 128);
        fiber.moveTo(0, offset + .5); fiber.lineTo(128, offset + .5);
        fiber.stroke();
      }
      this.gauzeTiles.set(material, tile);
    }
    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();
  }

  drawTextureSilkWeave(ctx, material = "georgette") {
    // A fine, translucent warp/weft tile keeps the 3D UV texture from turning
    // into a flat color field. It contains no radial ribs, so the actual model
    // remains responsible for the umbrella structure.
    const profiles = {
      georgette: { spacingX: 7.4, spacingY: 8.2, alpha: 0.34, strand: 0.022 },
      plainSilk: { spacingX: 6.9, spacingY: 7.7, alpha: 0.36, strand: 0.024 },
      denseSilk: { spacingX: 6.3, spacingY: 7.1, alpha: 0.39, strand: 0.027 }
    };
    const style = Object.hasOwn(profiles, material) ? material : "georgette";
    const profile = profiles[style];
    this.textureWeaveTiles ||= new Map();
    let tile = this.textureWeaveTiles.get(style);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.width = 128; tile.height = 128;
      const fiber = tile.getContext("2d");
      fiber.lineWidth = 0.34;
      for (let y = 2; y < tile.height; y += profile.spacingY) {
        fiber.beginPath();
        for (let x = 0; x <= tile.width; x += 4) {
          const waviness = Math.sin(x * 0.24 + y * 0.7) * 0.28 + Math.sin(x * 0.08 - y) * 0.12;
          if (x === 0) fiber.moveTo(x, y + waviness);
          else fiber.lineTo(x, y + waviness);
        }
      fiber.strokeStyle = `rgba(132,132,132,${profile.strand})`; fiber.stroke();
        fiber.beginPath();
        for (let x = 0; x <= tile.width; x += 4) {
          const waviness = Math.sin(x * 0.24 + y * 0.7) * 0.28 + Math.sin(x * 0.08 - y) * 0.12;
          if (x === 0) fiber.moveTo(x, y + 0.58 + waviness);
          else fiber.lineTo(x, y + 0.58 + waviness);
        }
        fiber.strokeStyle = "rgba(255,255,255,.045)"; fiber.stroke();
      }
      for (let x = 3; x < tile.width; x += profile.spacingX) {
        fiber.beginPath();
        for (let y = 0; y <= tile.height; y += 4) {
          const waviness = Math.sin(y * 0.22 + x * 0.6) * 0.26 + Math.sin(y * 0.07 - x) * 0.12;
          if (y === 0) fiber.moveTo(x + waviness, y);
          else fiber.lineTo(x + waviness, y);
        }
        fiber.strokeStyle = `rgba(132,132,132,${profile.strand * 0.82})`; fiber.stroke();
        fiber.beginPath();
        for (let y = 0; y <= tile.height; y += 4) {
          const waviness = Math.sin(y * 0.22 + x * 0.6) * 0.26 + Math.sin(y * 0.07 - x) * 0.12;
          if (y === 0) fiber.moveTo(x + 0.58 + waviness, y);
          else fiber.lineTo(x + 0.58 + waviness, y);
        }
        fiber.strokeStyle = "rgba(255,255,255,.04)"; fiber.stroke();
      }
      this.textureWeaveTiles.set(style, tile);
    }
    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) return;
    ctx.save();
    ctx.globalAlpha = profile.alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    ctx.restore();
  }

  renderReliefLayer() {
    const ctx = this.reliefCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx.clip();

    // Keep the edge transition soft; silk does not have a painted dark rim.
    const edgeShade = ctx.createRadialGradient(CENTER - 26, CENTER - 34, 22, CENTER, CENTER, CANOPY_RADIUS);
    edgeShade.addColorStop(0, "rgba(48,58,48,0)");
    edgeShade.addColorStop(.62, "rgba(48,58,48,.003)");
    edgeShade.addColorStop(.86, "rgba(48,58,48,.008)");
    edgeShade.addColorStop(1, "rgba(48,58,48,.018)");
    ctx.fillStyle = edgeShade; ctx.fillRect(0, 0, SIZE, SIZE);

    const step = Math.PI * 2 / RIB_COUNT;
    for (let panel = 0; panel < RIB_COUNT; panel += 1) {
      const start = -Math.PI / 2 + panel * step;
      const shade = ctx.createRadialGradient(CENTER, CENTER, 28, CENTER, CENTER, CANOPY_RADIUS);
      shade.addColorStop(0, "rgba(255,255,255,0)");
      shade.addColorStop(.72, panel % 2 ? "rgba(45,55,48,.005)" : "rgba(255,255,255,.01)");
      shade.addColorStop(1, panel % 2 ? "rgba(45,55,48,.012)" : "rgba(255,255,255,.022)");
      ctx.beginPath(); ctx.moveTo(CENTER, CENTER);
      ctx.arc(CENTER, CENTER, CANOPY_RADIUS, start, start + step); ctx.closePath();
      ctx.fillStyle = shade; ctx.fill();

      const outerX = CENTER + Math.cos(start) * (CANOPY_RADIUS - 8);
      const outerY = CENTER + Math.sin(start) * (CANOPY_RADIUS - 8);
      ctx.beginPath();
      ctx.moveTo(CENTER + Math.cos(start) * 18, CENTER + Math.sin(start) * 18);
      ctx.lineTo(outerX, outerY);
      ctx.lineWidth = 3.2; ctx.strokeStyle = "rgba(62,49,35,.018)";
      ctx.shadowColor = "rgba(57,46,35,.025)"; ctx.shadowBlur = 2; ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  renderAtmosphereLayer() {
    const ctx = this.atmosphereCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 4, 0, Math.PI * 2); ctx.clip();
    const vignette = ctx.createRadialGradient(CENTER - 38, CENTER - 50, 40, CENTER, CENTER, CANOPY_RADIUS);
    vignette.addColorStop(0, "rgba(55,49,39,0)");
    vignette.addColorStop(.72, "rgba(55,49,39,.003)");
    vignette.addColorStop(.91, "rgba(55,49,39,.007)");
    vignette.addColorStop(1, "rgba(55,49,39,.015)");
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.restore();
  }

  renderSilkSheenLayer() {
    const ctx = this.sheenCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS - 7, 0, Math.PI * 2); ctx.clip();

    // 宽而柔的斜向反光叠在最上层，不形成硬边或霓虹光圈。
    const sheen = ctx.createLinearGradient(145, 120, 580, 565);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    const finish = { georgette: .016, plainSilk: .11, denseSilk: .18 }[this.lastSettings.fabricMaterial] || .016;
    sheen.addColorStop(.31, `rgba(255,255,255,${finish * .3})`);
    sheen.addColorStop(.43, `rgba(255,255,255,${finish})`);
    sheen.addColorStop(.49, `rgba(255,255,255,${finish * .55})`);
    sheen.addColorStop(.66, "rgba(255,255,255,.003)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, SIZE, SIZE);

    // 少量纤维高光沿伞骨方向延伸，提示扇面张开的弧度。
    ctx.lineWidth = .35; ctx.strokeStyle = "rgba(255,255,255,.022)";
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
    ctx.save(); ctx.beginPath(); ctx.arc(CENTER, CENTER, CANOPY_RADIUS + 5, 0, Math.PI * 2); ctx.clip(); this.drawBambooRibs(ctx); ctx.restore();
    this.drawUmbrellaHub(ctx); this.drawCanopyHem(ctx);
  }

  drawBambooRibs(ctx) {
    const step = Math.PI * 2 / RIB_COUNT;
    for (let rib = 0; rib < RIB_COUNT; rib += 1) {
      const angle = -Math.PI / 2 + rib * step;
      const endX = CENTER + Math.cos(angle) * (CANOPY_RADIUS + 4);
      const endY = CENTER + Math.sin(angle) * (CANOPY_RADIUS + 4);
      const startX = CENTER + Math.cos(angle) * 15;
      const startY = CENTER + Math.sin(angle) * 15;
      const normalX = -Math.sin(angle), normalY = Math.cos(angle);
      ctx.lineCap = "round";
      // Fine shadow, bamboo body and highlight form a rounded rib rather than
      // a flat line. The geometry stays aligned with the 36-rib 3D model.
      ctx.beginPath(); ctx.moveTo(startX + normalX * 1.2, startY + normalY * 1.2);
      ctx.lineTo(endX + normalX * 1.2, endY + normalY * 1.2);
      ctx.lineWidth = 2.3; ctx.strokeStyle = "rgba(53,48,39,.14)"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY);
      ctx.lineWidth = 1.65; ctx.strokeStyle = "rgba(145,112,70,.64)"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(startX - normalX * .4, startY - normalY * .4);
      ctx.lineTo(endX - normalX * .4, endY - normalY * .4);
      ctx.lineWidth = .65; ctx.strokeStyle = "rgba(255,240,205,.83)"; ctx.stroke();
      ctx.beginPath(); ctx.arc(endX, endY, 1.55, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(157,119,72,.72)"; ctx.fill();
    }
  }

  drawUmbrellaHub(ctx) {
    ctx.save();
    ctx.shadowColor = "rgba(51,42,31,.28)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    const wood = ctx.createRadialGradient(CENTER - 4, CENTER - 5, 1, CENTER, CENTER, 18);
    wood.addColorStop(0, "#f9e9c5"); wood.addColorStop(.42, "#d7b886"); wood.addColorStop(.78, "#b18b5e"); wood.addColorStop(1, "#806344");
    ctx.beginPath(); ctx.arc(CENTER, CENTER, 17, 0, Math.PI * 2); ctx.fillStyle = wood; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(100,76,49,.72)"; ctx.lineWidth = 1; ctx.stroke();
    for (const radius of [13, 9, 5]) {
      ctx.beginPath(); ctx.arc(CENTER, CENTER, radius, 0, Math.PI * 2);
      ctx.strokeStyle = radius === 9 ? "rgba(113,83,49,.48)" : "rgba(255,245,218,.72)";
      ctx.lineWidth = .9; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2); ctx.fillStyle = "#896746"; ctx.fill();
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

  preparePatternSurface() {
    const ctx = this.patternSurfaceCtx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.patternLayer, 0, 0, SIZE, SIZE);
    // Let the base cloth, weave and canopy relief tint the motif pixels so
    // the artwork reads as dye on silk instead of a separate sticker layer.
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = .2;
    ctx.drawImage(this.baseLayer, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = .3;
    ctx.drawImage(this.reliefLayer, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = .18;
    ctx.drawImage(this.atmosphereLayer, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = .2;
    ctx.drawImage(this.sheenLayer, 0, 0, SIZE, SIZE);
    ctx.restore();
  }

  renderScene(includeOverlay = true) {
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(this.baseLayer, 0, 0, SIZE, SIZE);
    this.ctx.drawImage(this.artSurfaceLayer, 0, 0, SIZE, SIZE);
    this.ctx.save(); this.ctx.globalAlpha = .48;
    this.ctx.globalCompositeOperation = "source-atop";
    this.drawSilkWeave(this.ctx, this.lastSettings.fabricMaterial || DEFAULT_SETTINGS.fabricMaterial);
    this.ctx.restore();
    this.ctx.save(); this.ctx.globalCompositeOperation = "multiply"; this.ctx.globalAlpha = .5;
    this.ctx.drawImage(this.reliefLayer, 0, 0, SIZE, SIZE);
    this.ctx.globalAlpha = .56; this.ctx.drawImage(this.atmosphereLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    this.ctx.save(); this.ctx.globalCompositeOperation = "screen"; this.ctx.globalAlpha = .18;
    this.ctx.drawImage(this.sheenLayer, 0, 0, SIZE, SIZE); this.ctx.restore();
    this.ctx.drawImage(this.structureLayer, 0, 0, SIZE, SIZE);
    if (includeOverlay) this.ctx.drawImage(this.overlayLayer, 0, 0, SIZE, SIZE);
  }

  markTextureDirty() {
    this.textureDirty = true;
    if (this.onTextureDirty) this.onTextureDirty();
  }

  // 只在切换到 3D 或作品有改动后合成一次；调用方复用同一张 CanvasTexture 源。
  getUmbrellaTextureCanvas() {
    if (!this.textureDirty) return this.textureCanvas;
    const sourceInset = CENTER - CANOPY_RADIUS;
    const sourceDiameter = CANOPY_RADIUS * 2;
    const context = this.textureCanvas.getContext("2d");
    context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    // 3D UV receives only the cloth color and artwork. The 2D illustration's
    // radial lighting, painted ribs, vignette and sheen stay in the editor;
    // the 3D model provides its own curved silk, bamboo and scene lighting.
    context.fillStyle = this.lastSettings.fabricColor || DEFAULT_SETTINGS.fabricColor;
    context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    context.save();
    context.beginPath();
    context.arc(TEXTURE_SIZE * 0.5, TEXTURE_SIZE * 0.5, TEXTURE_SIZE * 0.5, 0, Math.PI * 2);
    context.clip();
    this.drawTextureSilkDyeVariation(context);
    this.drawTextureSilkWeave(context, this.lastSettings.fabricMaterial || DEFAULT_SETTINGS.fabricMaterial);
    const drawArtworkLayer = (layer) => context.drawImage(
      layer,
      sourceInset * this.dpr, sourceInset * this.dpr,
      sourceDiameter * this.dpr, sourceDiameter * this.dpr,
      0, 0, TEXTURE_SIZE, TEXTURE_SIZE
    );
    drawArtworkLayer(this.artLayer);
    // The fiber passes over pigment as well as untouched silk. Keeping the
    // pigment in source-over mode also preserves white painted petals.
    this.drawTextureSilkWeave(context, this.lastSettings.fabricMaterial || DEFAULT_SETTINGS.fabricMaterial);
    context.restore();
    this.textureDirty = false;
    this.textureVersion += 1;
    return this.textureCanvas;
  }

  drawTextureSilkDyeVariation(context) {
    // Georgette's dye should read across the whole canopy, not as separate
    // round stains. A deterministic, low-contrast woven field gives the cloth
    // subtle unevenness while keeping the rim free of a vignette.
    const size = 192;
    const base = this.lastSettings.fabricColor || DEFAULT_SETTINGS.fabricColor;
    if (this.textureDyeColor === base && this.textureDyeCanvas) {
      context.drawImage(this.textureDyeCanvas, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      return;
    }
    const baseRgb = [1, 3, 5].map((offset) => Number.parseInt(base.slice(offset, offset + 2), 16));
    let seed = 43127;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const makeGrid = (columns, rows) => Array.from({ length: rows }, () => Array.from({ length: columns }, random));
    const grids = [makeGrid(6, 5), makeGrid(15, 13), makeGrid(34, 29)];
    const sample = (grid, u, v) => {
      const rows = grid.length;
      const columns = grid[0].length;
      const gx = u * (columns - 1);
      const gy = v * (rows - 1);
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const x1 = Math.min(columns - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
      const tx0 = gx - x0, ty0 = gy - y0;
      const tx = tx0 * tx0 * (3 - 2 * tx0), ty = ty0 * ty0 * (3 - 2 * ty0);
      const top = grid[y0][x0] * (1 - tx) + grid[y0][x1] * tx;
      const bottom = grid[y1][x0] * (1 - tx) + grid[y1][x1] * tx;
      return top * (1 - ty) + bottom * ty;
    };
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / (size - 1), v = y / (size - 1);
        const coarse = sample(grids[0], u, v);
        const medium = sample(grids[1], u, v);
        const fine = sample(grids[2], u, v);
        const variation = (coarse - 0.5) * 0.66 + (medium - 0.5) * 0.27 + (fine - 0.5) * 0.07;
        // A trace of uneven dye keeps the fabric alive without cloudy patches
        // or large changes in hue between adjacent parts of the canopy.
        const brightness = 1 + variation * 0.06;
        const index = (y * size + x) * 4;
        image.data[index] = Math.max(0, Math.min(255, Math.round(baseRgb[0] * brightness)));
        image.data[index + 1] = Math.max(0, Math.min(255, Math.round(baseRgb[1] * brightness)));
        image.data[index + 2] = Math.max(0, Math.min(255, Math.round(baseRgb[2] * brightness)));
        image.data[index + 3] = 255;
      }
    }
    const dye = this.textureDyeCanvas ||= document.createElement("canvas");
    dye.width = size; dye.height = size;
    dye.getContext("2d").putImageData(image, 0, 0);
    this.textureDyeColor = base;
    context.drawImage(dye, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }

  createExportCanvas(options = {}) {
    const output = document.createElement("canvas"); output.width = Math.round(SIZE * this.dpr); output.height = Math.round(SIZE * this.dpr);
    const context = output.getContext("2d"); context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const layerNames = ["baseLayer", "artSurfaceLayer", "reliefLayer", "atmosphereLayer", "sheenLayer"];
    if (options.includeStructure !== false) layerNames.push("structureLayer");
    layerNames.forEach((name) => {
      context.save();
      if (name === "reliefLayer") { context.globalCompositeOperation = "multiply"; context.globalAlpha = .34; }
      if (name === "atmosphereLayer") { context.globalCompositeOperation = "multiply"; context.globalAlpha = .34; }
      if (name === "sheenLayer") { context.globalCompositeOperation = "screen"; context.globalAlpha = .22; }
      context.drawImage(this[name], 0, 0, SIZE, SIZE); context.restore();
    });
    context.save(); context.globalAlpha = .48;
    this.drawSilkWeave(context, this.lastSettings.fabricMaterial || DEFAULT_SETTINGS.fabricMaterial);
    context.restore();
    if (options.includeFluid !== false && this.fluidSnapshotCanvas) {
      context.save();
      context.beginPath(); context.arc(CENTER, CENTER, CANOPY_RADIUS - 2, 0, Math.PI * 2); context.clip();
      context.drawImage(this.fluidSnapshotCanvas, CENTER - CANOPY_RADIUS, CENTER - CANOPY_RADIUS, CANOPY_RADIUS * 2, CANOPY_RADIUS * 2);
      context.restore();
    }
    return output;
  }

  setFluidSnapshot(source) {
    if (!source) { this.fluidSnapshotCanvas = null; return; }
    if (!this.fluidSnapshotCanvas) {
      this.fluidSnapshotCanvas = document.createElement("canvas");
      this.fluidSnapshotCanvas.width = 512;
      this.fluidSnapshotCanvas.height = 512;
    }
    const context = this.fluidSnapshotCanvas.getContext("2d");
    context.clearRect(0, 0, 512, 512);
    context.drawImage(source, 0, 0, 512, 512);
  }

  clearArt() { this.artCtx.clearRect(0, 0, SIZE, SIZE); this.artSurfaceCtx.clearRect(0, 0, SIZE, SIZE); this.patternCtx.clearRect(0, 0, SIZE, SIZE); this.renderScene(); }
}
