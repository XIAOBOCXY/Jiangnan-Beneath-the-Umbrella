import { CanvasManager } from "../core/CanvasManager.js?v=20261026-ui-zoom-v4";
import { MandalaRenderer } from "../core/MandalaRenderer.js";
import { PatternDrawer } from "../drawing/PatternDrawer.js";
import { TemplateComposer } from "../features/TemplateComposer.js";
import { ControlManager } from "../ui/ControlManager.js?v=20261027-uiverse-webawesome-v11";

const INK_PRESETS = {
  // Dry presets inject pigment only. The shader keeps their edges crisp;
  // texture adds fiber grain without enabling water diffusion.
  soft:    { size: 1.3, opacity: 0.76, water: 0.2, grain: 0.025, flow: 0.008 },
  texture: { size: 0.62, opacity: 0.96, water: 0, grain: 0.24, flow: 0 },
  clean:   { size: 0.78, opacity: 0.94, water: 0, grain: 0, flow: 0 },
  fluid:   { size: 1.12, opacity: 1.00, water: 1.00, grain: 0.095, flow: 0.055 }
};

// App 负责模式切换、Pointer Events、控件状态和功能模块编排。
export class App {
  constructor(inkWashBackground = null) {
    this.inkWashBackground = inkWashBackground;
    this.inkWashBackground?.setSceneMode("drawing");
    this.canvasManager = new CanvasManager(document.getElementById("umbrellaCanvas"));
    this.controls = new ControlManager();
    this.patternDrawer = new PatternDrawer((drawer) => this.controls.setAssetStates(drawer));
    this.renderer = new MandalaRenderer(this.canvasManager, this.patternDrawer);
    this.canvasManager.onResize = () => { this.renderer.invalidate(); this.renderer.render(); };
    this.templateComposer = new TemplateComposer(this.canvasManager, this.patternDrawer);
    this.mode = "brush";
    this.viewMode = "2d";
    this.threePreview = null;
    this.fluidInitPromise = null;
    this.bundledModelPromise = null;
    this.pendingFluidSplats = [];
    this.lastFluidPoint = null;
    this.fluidSealTimer = 0;
    this.canvasManager.onTextureDirty = () => this.refreshThreeTexture();
    this.gesture = null;
    this.controlEdits = new Set();
    this.toastTimer = null;
    this.isReady = false;
    this.updateReadouts();
    this.bindCanvasEvents();
    this.bindControlEvents();
    this.bindActionEvents();
    this.setMode("brush");
    this.canvasManager.canvas.classList.add("is-loading");
    this.templateComposer.applyDefault(this.renderer).then(() => {
      this.isReady = true;
      this.canvasManager.canvas.classList.remove("is-loading");
      this.updateReadouts();
      this.showMessage("荷韵西湖示例已载入");
      this.warmFluidPreview();
    });
  }

  bindCanvasEvents() {
    this.canvasStage = this.canvasManager.canvas.closest(".canvas-stage");
    this.canvasContainer = this.canvasStage.closest(".canvas-container");
    this.canvasContainer.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvasContainer.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvasContainer.addEventListener("pointerup", (event) => this.onPointerEnd(event));
    this.canvasContainer.addEventListener("pointercancel", (event) => this.onPointerEnd(event));
    this.canvasContainer.addEventListener("lostpointercapture", (event) => this.onPointerEnd(event));
    this.canvasContainer.addEventListener("wheel", (event) => this.onCanvasWheel(event), { passive: false });
  }

  bindControlEvents() {
    const { elements } = this.controls;
    // Some controls are optional across editor variants. A missing optional
    // control must not abort App construction (which would disable drawing).
    [elements.colorPicker, elements.brushSize, elements.opacity, elements.segments, elements.mirror].filter(Boolean).forEach((element) => {
      element.addEventListener("input", () => this.onControlChange(element.id));
      element.addEventListener("change", () => this.onControlChange(element.id, true));
    });
    [elements.repeatCount, elements.repeatRadius, elements.patternScale, elements.patternRotation].filter(Boolean).forEach((element) => {
      element.addEventListener("input", () => this.updateSelectedFromControl(element.id, true));
      element.addEventListener("change", () => {
        this.controlEdits.delete(element.id);
        this.updateSelectedFromControl(element.id, false);
      });
    });
    document.getElementById("brushModeBtn").addEventListener("click", () => this.setMode("brush"));
    document.getElementById("patternModeBtn").addEventListener("click", () => this.setMode("pattern"));
    document.querySelectorAll("[data-view-mode]").forEach((button) => button.addEventListener("click", () => {
      this.setViewMode(button.dataset.viewMode);
    }));
    document.querySelectorAll("[data-brush-style]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-brush-style]").forEach((item) => item.classList.toggle("is-active", item === button));
      // Load the shared WebGL renderer while the user is choosing a brush,
      // instead of making the first stroke wait for Three.js and GPU setup.
      if (this.isReady) this.warmFluidPreview();
    }));
    document.querySelectorAll("[data-orientation]").forEach((button) => button.addEventListener("click", () => {
      if (!this.renderer.getSelected()) return;
      document.querySelectorAll("[data-orientation]").forEach((item) => item.classList.toggle("is-active", item === button));
      this.renderer.setSelectedProperty("repeatOrientation", button.dataset.orientation);
    }));
    document.querySelectorAll("[data-brush-color]").forEach((button) => button.addEventListener("click", () => this.controls.setBrushColor(button.dataset.brushColor)));
    document.querySelectorAll("[data-fabric-color]").forEach((button) => button.addEventListener("click", () => {
      this.controls.setFabricColor(button.dataset.fabricColor); this.refreshBase();
    }));
    this.controls.elements.patternCarousel?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-pattern]");
      if (!card || card.disabled || !this.controls.setPattern(card.dataset.pattern)) return;
      this.setMode("pattern");
      this.showMessage("点击伞面放置一个纹样");
    });
    document.querySelectorAll("[data-fabric-style]").forEach((button) => button.addEventListener("click", () => {
      this.controls.setFabricStyle(button.dataset.fabricStyle); this.refreshBase();
    }));
    document.querySelectorAll("[data-carousel]").forEach((button) => button.addEventListener("click", () => {
      const carousel = document.getElementById("patternCarousel");
      carousel.scrollBy({ left: (button.dataset.carousel === "next" ? 1 : -1) * carousel.clientWidth * .72, behavior: "smooth" });
    }));
  }

  onCanvasWheel(event) {
    if (this.viewMode !== "2d") return;
    event.preventDefault();
    const stageRect = this.canvasStage.getBoundingClientRect();
    const pointerX = event.clientX - (stageRect.left + stageRect.width * 0.5);
    const pointerY = event.clientY - (stageRect.top + stageRect.height * 0.5);
    const previousZoom = this.canvasManager.viewZoom;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.max(0.6, Math.min(10, previousZoom * zoomFactor));
    const ratio = nextZoom / previousZoom;
    // Keep the point under the pointer in place while zooming, so users can
    // inspect any part of the umbrella instead of only enlarging its center.
    const panX = pointerX - (pointerX - this.canvasManager.viewPanX) * ratio;
    const panY = pointerY - (pointerY - this.canvasManager.viewPanY) * ratio;
    this.canvasManager.setViewTransform(nextZoom, this.canvasManager.viewRotation, panX, panY);
  }

  bindActionEvents() {
    const { elements } = this.controls;
    elements.randomBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      this.controls.randomize(); this.refreshBase(); this.showMessage("灵感已更新");
    });
    elements.clearBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      window.clearTimeout(this.fluidSealTimer);
      this.renderer.clear(); this.threePreview?.clearFluid(); this.threePreview?.setInkOpacity(1); this.canvasManager.setFluidSnapshot(null); this.updateSelectionControls(); this.showMessage("画布已清空");
    });
    elements.templateBtn.addEventListener("click", async () => {
      if (!this.isReady) return;
      await this.templateComposer.applyDefault(this.renderer);
      window.clearTimeout(this.fluidSealTimer);
      this.threePreview?.clearFluid(); this.threePreview?.setInkOpacity(1); this.canvasManager.setFluidSnapshot(null);
      this.updateSelectionControls(); this.showMessage("荷韵西湖示例已恢复");
    });
    elements.saveBtn.addEventListener("click", async () => {
      if (this.viewMode !== "3d" || !this.threePreview) {
        if (this.viewMode === "2d" && this.threePreview) {
          this.canvasManager.setFluidSnapshot(this.threePreview.captureFluidSnapshot());
        }
        const downloaded = await this.downloadCanvas(this.canvasManager.createExportCanvas(), "jiangnan-umbrella.png");
        if (downloaded) this.showMessage("画廊暂未启用，作品 PNG 已下载");
        return;
      }
      try {
        await this.threePreview.savePNG("jiangnan-umbrella-3D.png");
        this.showMessage("画廊暂未启用，3D 作品 PNG 已下载");
      } catch (error) {
        this.showMessage(error.message || "3D 图片保存失败");
      }
    });
    elements.undoBtn.addEventListener("click", () => this.undo());
    elements.redoBtn.addEventListener("click", () => this.redo());
    elements.repeatBtn.addEventListener("click", () => {
      if (!this.renderer.getSelected()) return;
      this.renderer.setRepeat(Number(elements.repeatCount.value), Number(elements.repeatRadius.value));
      this.updateSelectionControls(); this.showMessage("环形纹样已生成");
    });
    elements.deletePatternBtn.addEventListener("click", () => {
      this.renderer.deleteSelected(); this.updateSelectionControls();
    });
    elements.guideToggle.addEventListener("click", () => {
      this.renderer.showGuides = !this.renderer.showGuides;
      elements.guideToggle.setAttribute("aria-pressed", String(this.renderer.showGuides));
      elements.guideToggle.classList.toggle("is-active", this.renderer.showGuides);
      this.renderer.render();
    });
    document.getElementById("importModelBtn").addEventListener("click", () => {
      document.getElementById("umbrellaModelInput").click();
    });
    document.getElementById("umbrellaModelInput").addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file || !this.threePreview) return;
      const error = document.getElementById("threeError");
      error.hidden = true;
      try {
        const result = await this.threePreview.loadGLB(file);
        document.getElementById("resetModelBtn").hidden = false;
        this.updateFoldControls();
        const details = [];
        if (result.generatedUV) details.push("缺少有效 UV，已用水平投影临时映射，建议在 Blender 制作伞面 UV");
        if (result.usedFallback) details.push("未识别到命名伞面，已按网格尺寸自动选择");
        if (result.meshes > 1) details.push(`${result.meshes} 个伞面网格共用整幅纹理`);
        if (!result.animatedFold) details.push("模型未含开合动画");
        const summary = `已载入${result.animatedFold ? "含开合动画的" : ""}伞模 · ${result.meshes} 个绸面网格`;
        this.showMessage(details.length ? `${summary}；${details.join("；")}` : summary);
      } catch (loadError) {
        error.textContent = loadError.message || "伞模读取失败";
        error.hidden = false;
        this.showMessage(error.textContent);
      } finally {
        event.currentTarget.value = "";
      }
    });
    document.getElementById("resetModelBtn").addEventListener("click", () => {
      this.threePreview?.resetProceduralModel();
      document.getElementById("resetModelBtn").hidden = true;
      this.updateFoldControls(0);
      this.showMessage("已恢复程序伞体");
    });
    document.getElementById("fluidDebugMode").addEventListener("change", (event) => {
      this.threePreview?.setFluidDebugMode(event.currentTarget.value);
    });
    document.getElementById("fluidTestBtn").addEventListener("click", async () => {
      try {
        const preview = await this.ensureThreePreview();
        if (this.viewMode === "2d") preview.setPresentation("fluid", document.getElementById("fluidHost"));
        preview.setFluidDebugMode(document.getElementById("fluidDebugMode").value);
        preview.injectFluidTest();
        preview.setActive(true);
        this.showMessage("GPU 墨彩已注入 · 可切换查看速度、颜料与湿度场");
      } catch (error) {
        this.showMessage(`GPU 流场不可用：${error.message || "WebGL 初始化失败"}`);
      }
    });
    const audioButton = document.getElementById("audioReactiveBtn");
    audioButton.addEventListener("click", async () => {
      try {
        const preview = await this.ensureThreePreview();
        const playing = await preview.toggleAmbientMusic();
        audioButton.querySelector(".audio-button-label").textContent = playing ? "暂停声光" : "声光响应";
        audioButton.setAttribute("aria-pressed", String(playing));
        preview.setActive(true);
        this.showMessage(playing ? "内置江南音乐已开启 · 绸面声光响应同步运行" : "背景音乐与声光响应已暂停");
      } catch (audioError) {
        this.showMessage(audioError.message || "音频无法播放");
      }
    });
    document.getElementById("umbrellaFoldRange").addEventListener("input", (event) => {
      const progress = Number(event.currentTarget.value) / 100;
      this.threePreview?.setFoldProgress(progress);
      this.updateFoldControls(progress);
    });
    document.getElementById("foldToggleBtn").addEventListener("click", () => {
      if (!this.threePreview?.supportsFolding) return;
      const target = this.threePreview.getFoldTarget() >= 0.5 ? 0 : 1;
      this.threePreview.animateFoldTo(target);
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); this.redo(); }
      if ((event.key === "Delete" || event.key === "Backspace") && this.mode === "pattern" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        this.renderer.deleteSelected(); this.updateSelectionControls();
      }
    });
  }

  async downloadCanvas(canvas, filename) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      this.showMessage("图片生成失败，请再试一次");
      return false;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    const isBrush = mode === "brush";
    this.controls.elements.brushTools.hidden = !isBrush;
    document.querySelector(".symmetry-group").hidden = !isBrush;
    document.querySelector(".pattern-group").hidden = isBrush;
    document.getElementById("brushModeBtn").classList.toggle("is-active", isBrush);
    document.getElementById("patternModeBtn").classList.toggle("is-active", !isBrush);
    this.canvasManager.canvas.classList.toggle("pattern-mode", !isBrush);
    if (isBrush) { this.renderer.document.selectedId = null; this.renderer.render(); }
    this.updateSelectionControls();
  }

  async ensureThreePreview() {
    if (this.threePreview) return this.threePreview;
    if (!this.fluidInitPromise) {
      this.fluidInitPromise = import("../rendering/ThreeUmbrellaPreview.js?v=20261026-brush-ui-v10").then(({ ThreeUmbrellaPreview }) => {
        const preview = new ThreeUmbrellaPreview(document.getElementById("threeHost"));
        preview.onFoldProgress = (progress) => this.updateFoldControls(progress);
        this.threePreview = preview;
        const fluidHost = document.getElementById("fluidHost");
        const threeHost = document.getElementById("threeHost");
        preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", this.viewMode === "3d" ? threeHost : fluidHost);
        preview.setFluidDebugMode(document.getElementById("fluidDebugMode").value);
        preview.injectInks(this.pendingFluidSplats.splice(0));
        preview.setActive(true);
        this.refreshThreeTexture(true);
        return preview;
      }).catch((error) => {
        this.fluidInitPromise = null;
        throw error;
      });
    }
    return this.fluidInitPromise;
  }

  warmFluidPreview() {
    this.ensureThreePreview().then((preview) => {
      if (this.viewMode !== "2d") return;
      preview.setPresentation("fluid", document.getElementById("fluidHost"));
      preview.setActive(true);
    }).catch((error) => {
      console.warn("GPU 墨彩初始化失败：", error);
      this.disableGpuInkFallback();
      this.showMessage("水墨模块未能启动，请检查网络或 WebGL 支持");
    });
  }

  async ensureBundledUmbrella() {
    const preview = await this.ensureThreePreview();
    if (preview.modelKind === "glb" || this.bundledModelPromise) return this.bundledModelPromise || preview;
    const bundledModelUrl = new URL("../../assets/models/west-lake-umbrella.glb", import.meta.url);
    // Bust the browser cache when the bundled Blender model is regenerated;
    // otherwise a reload can keep showing the old rib-only fold animation.
    bundledModelUrl.searchParams.set("v", "20261022-folded-bamboo-bundle-v2");
    this.bundledModelPromise = preview.loadGLBURL(bundledModelUrl.href)
      .then((result) => {
        console.info("Blender 绸伞模型已载入", result);
        return preview;
      })
      .catch((error) => {
        console.warn("内置 Blender 伞模未载入，继续使用交互原型：", error);
        return preview;
      });
    return this.bundledModelPromise;
  }

  async setViewMode(viewMode) {
    const entering3d = viewMode === "3d" && this.viewMode !== "3d";
    const viewer = document.getElementById("threeViewer");
    const error = document.getElementById("threeError");
    if (viewMode === "3d") {
      error.hidden = true;
      try {
        const preview = await this.ensureBundledUmbrella();
        this.canvasManager.setFluidSnapshot(preview.captureFluidSnapshot());
        document.getElementById("canvasStage").hidden = true;
        viewer.hidden = false;
        preview.setPresentation("3d", document.getElementById("threeHost"));
        this.updateFoldControls(preview.foldProgress || 0);
      } catch (loadError) {
        const reason = loadError?.message || "Three.js 模块无法加载";
        error.textContent = `3D 预览暂不可用：${reason}`;
        error.hidden = false;
        this.showMessage("Three.js 加载失败，请检查网络连接后重试");
        return false;
      }
      this.refreshThreeTexture(true);
      this.threePreview.setActive(true);
      if (entering3d) this.threePreview.playViewTransition();
      document.querySelector(".canvas-container").classList.add("is-3d");
      document.getElementById("saveBtn").textContent = "存入画廊";
    } else {
      document.getElementById("canvasStage").hidden = false;
      viewer.hidden = true;
      if (this.threePreview) {
        this.threePreview.setPresentation("fluid", document.getElementById("fluidHost"));
        this.threePreview.setActive(true);
      }
      document.querySelector(".canvas-container").classList.remove("is-3d");
      document.getElementById("saveBtn").textContent = "存入画廊";
    }
    this.viewMode = viewMode;
    this.inkWashBackground?.setSceneMode(viewMode === "3d" ? "viewing" : "drawing");
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      const active = button.dataset.viewMode === viewMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    return true;
  }

  refreshThreeTexture(force = false) {
    if (!this.threePreview || (!force && this.viewMode !== "3d")) return;
    const textureCanvas = this.canvasManager.getUmbrellaTextureCanvas();
    this.threePreview.setArtworkCanvas(textureCanvas, this.canvasManager.textureVersion);
  }

  updateFoldControls(progress = this.threePreview?.foldProgress ?? 0) {
    const range = document.getElementById("umbrellaFoldRange");
    const value = document.getElementById("umbrellaFoldValue");
    const button = document.getElementById("foldToggleBtn");
    const supported = Boolean(this.threePreview?.supportsFolding);
    range.disabled = !supported;
    button.disabled = !supported;
    range.value = String(Math.round(progress * 100));
    if (!supported) {
      value.textContent = "无开合动画";
      value.title = "当前模型没有可驱动的开合动画；可恢复程序伞或导入带开合动画的 GLB";
      button.textContent = "收伞";
      button.setAttribute("aria-label", "收伞");
      return;
    }
    value.title = "拖动以控制伞面的收拢程度";
    value.textContent = progress < 0.02
      ? "展开"
      : progress > 0.98
        ? "收拢"
        : `半合 ${Math.round(progress * 100)}%`;
    button.textContent = this.threePreview.getFoldTarget() >= 0.5 ? "开伞" : "收伞";
    button.setAttribute("aria-label", button.textContent);
  }

  onPointerDown(event) {
    if (this.viewMode !== "2d" || !this.isReady || event.target.closest("button, input, select, textarea, [contenteditable='true']") || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = this.canvasManager.getPoint(event);
    if (!this.canvasManager.containsPoint(point)) {
      event.preventDefault();
      this.canvasContainer.setPointerCapture(event.pointerId);
      this.canvasContainer.classList.add("is-view-rotating");
      this.gesture = { type: "rotate-view", pointerId: event.pointerId, lastAngle: this.canvasManager.getStageAngle(event) };
      return;
    }
    if (!this.canvasManager.containsPoint(point)) return;
    event.preventDefault();
    this.canvasContainer.setPointerCapture(event.pointerId);
    if (this.mode === "brush") {
      const settings = this.settingsForPointer(this.controls.getSettings(), event);
      // Keep old pigment fixed before a new stroke starts, so its velocity
      // field cannot pull earlier marks across the silk.
      window.clearTimeout(this.fluidSealTimer);
      this.threePreview?.sealFluidMotion();
      this.canvasContainer.classList.add("is-brush-drawing");
      const stroke = this.renderer.beginStroke(point, settings);
      this.gesture = { type: "brush", brushStyle: settings.brushStyle, strokeId: stroke?.id, pointerId: event.pointerId, lastPoint: point };
      this.injectFluidSegment(point, point, settings);
      return;
    }
    const selected = this.renderer.selectAt(point);
    if (selected) {
      this.renderer.document.commit();
      this.canvasContainer.classList.add("is-pattern-moving");
      this.gesture = { type: "move", pointerId: event.pointerId, lastPoint: point };
    } else {
      const object = this.renderer.addPattern(this.controls.pattern, point, { snap: this.controls.elements.zoneSnap.checked });
      this.gesture = { type: "placed", pointerId: event.pointerId, objectId: object.id };
    }
    this.updateSelectionControls();
  }

  onPointerMove(event) {
    if (this.viewMode !== "2d") return;
    const point = this.canvasManager.getPoint(event);
    if (!this.gesture) return;
    if (event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault();
    if (this.gesture.type === "rotate-view") {
      const angle = this.canvasManager.getStageAngle(event);
      let delta = angle - this.gesture.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      else if (delta < -Math.PI) delta += Math.PI * 2;
      this.canvasManager.setViewTransform(this.canvasManager.viewZoom, this.canvasManager.viewRotation + delta);
      this.gesture.lastAngle = angle;
      return;
    }
    if (this.gesture.type === "brush") {
      const settings = this.settingsForPointer(this.controls.getSettings(), event);
      this.renderer.extendStroke(point, settings);
      this.injectFluidSegment(this.gesture.lastPoint, point, settings);
      this.gesture.lastPoint = point;
    }
    else if (this.gesture.type === "move" && this.canvasManager.containsPoint(point)) {
      this.renderer.moveSelected(point.x - this.gesture.lastPoint.x, point.y - this.gesture.lastPoint.y);
      this.gesture.lastPoint = point;
    }
  }

  onPointerEnd(event) {
    if (!this.gesture || (event.pointerId !== undefined && event.pointerId !== this.gesture.pointerId)) return;
    if (this.gesture.type === "brush") {
      this.renderer.endStroke();
      this.canvasContainer.classList.remove("is-brush-drawing");
      this.scheduleFluidSeal();
    }
    if (this.gesture.type === "rotate-view") this.canvasContainer.classList.remove("is-view-rotating");
    if (this.gesture.type === "move") this.canvasContainer.classList.remove("is-pattern-moving");
    this.gesture = null;
    this.lastFluidPoint = null;
    this.updateSelectionControls();
  }

  injectFluidSegment(from, to, settings) {
    if (settings.gpuInk === false) return;
    const diameter = this.canvasManager.radius * 2;
    const now = performance.now();
    const seconds = Math.max(1 / 120, (now - (this.lastFluidPoint?.time || now - 16)) / 1000);
    const clipped = this.clipSegmentToCanopy(from, to, this.canvasManager.radius - 2);
    this.lastFluidPoint = { point: { ...to }, time: now };
    if (!clipped) return;
    const rawForce = {
      x: (clipped.to.x - clipped.from.x) / diameter / seconds,
      y: -(clipped.to.y - clipped.from.y) / diameter / seconds
    };
    const preset = INK_PRESETS[settings.brushStyle] || INK_PRESETS.soft;
    const rawSpeed = Math.hypot(rawForce.x, rawForce.y);
    const forceScale = rawSpeed > preset.flow ? preset.flow / Math.max(0.001, rawSpeed) : 1;
    const source = {
      fromUv: this.pointToCanopyUV(clipped.from, diameter),
      uv: this.pointToCanopyUV(clipped.to, diameter),
      force: { x: rawForce.x * forceScale, y: rawForce.y * forceScale },
      // Yakudoo's brush line gains a little body as the tip moves faster;
      // keep that signal separate from the capped fluid-force vector.
      speed: Math.max(0, Math.min(1, rawSpeed / 2.2)),
      pressure: Math.max(0, Math.min(1, settings.pointerPressure ?? 0.5)),
      color: settings.color || "#537c7e",
      radius: Math.max(0.006, Math.min(0.09, (settings.brushSize || 8) * (settings.pressureFactor || 1) * preset.size / diameter * 1.45)),
      opacity: Math.max(0, Math.min(0.92, (settings.opacity ?? 0.45) * preset.opacity)),
      water: settings.brushStyle === "texture" || settings.brushStyle === "clean" ? 0 : preset.water,
      grain: preset.grain,
      seed: Math.random()
    };
    // Keep only source segments in history. Copies are derived with the same
    // radial/mirror transform as the visible 2D drawing coordinate system.
    this.renderer.appendFluidSplats(this.gesture?.strokeId, [source]);
    const input = this.expandInkSplat(source, settings, diameter);
    if (this.threePreview) {
      this.threePreview.injectInks(input);
      return;
    }
    this.pendingFluidSplats.push(...input);
    if (this.pendingFluidSplats.length > 8192) this.pendingFluidSplats.splice(0, this.pendingFluidSplats.length - 8192);
    if (!this.fluidInitPromise) {
      this.ensureThreePreview().then((preview) => {
        preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", document.getElementById(this.viewMode === "3d" ? "threeHost" : "fluidHost"));
        preview.setFluidDebugMode(document.getElementById("fluidDebugMode").value);
        preview.injectInks(this.pendingFluidSplats.splice(0));
        preview.setActive(true);
      }).catch((error) => {
        this.pendingFluidSplats.length = 0;
        console.warn("GPU 墨彩初始化失败：", error);
        this.disableGpuInkFallback();
        this.showMessage("水墨模块未能启动，请检查网络或 WebGL 支持");
      });
    }
  }

  rebuildFluidArtwork() {
    // GPU pigment is the visible artwork for every preset. Rebuild from the
    // recorded source segments after undo/redo, without old stroke momentum.
    this.pendingFluidSplats.length = 0;
    const strokes = this.renderer.document.strokes
      .filter((stroke) => stroke.settings?.gpuInk === true || stroke.settings?.brushStyle === "fluid")
      .filter((stroke) => stroke.fluidSplats?.length);
    const replay = [];
    const diameter = this.canvasManager.radius * 2;
    strokes.forEach((stroke) => (stroke.fluidSplats || []).forEach((splat) => {
      const settled = { ...splat, force: { x: 0, y: 0 } };
      const copies = stroke.settings?.gpuInk === true
        ? this.expandInkSplat(settled, stroke.settings, diameter)
        : [settled];
      copies.forEach((copy) => replay.push({ ...copy, force: { x: 0, y: 0 } }));
    }));
    this.canvasManager.setFluidSnapshot(null);
    if (this.threePreview) {
      this.threePreview.clearFluid();
      this.threePreview.setInkOpacity(1);
      this.threePreview.injectInks(replay);
      if (strokes.length) this.threePreview.setActive(true);
    } else {
      this.pendingFluidSplats.push(...replay);
    }
  }

  pointToCanopyUV(point, diameter) {
    return {
      x: 0.5 + (point.x - this.canvasManager.center.x) / diameter,
      y: 0.5 - (point.y - this.canvasManager.center.y) / diameter
    };
  }

  clipSegmentToCanopy(from, to, radius) {
    const center = this.canvasManager.center;
    const px = from.x - center.x, py = from.y - center.y;
    const dx = to.x - from.x, dy = to.y - from.y;
    const a = dx * dx + dy * dy;
    const c = px * px + py * py - radius * radius;
    if (a < 1e-8) return c <= 0 ? { from: { ...from }, to: { ...to } } : null;
    const b = 2 * (px * dx + py * dy);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return c <= 0 ? { from: { ...from }, to: { ...to } } : null;
    const root = Math.sqrt(discriminant);
    const start = Math.max(0, (-b - root) / (2 * a));
    const end = Math.min(1, (-b + root) / (2 * a));
    if (start > end) return null;
    return {
      from: { x: from.x + dx * start, y: from.y + dy * start },
      to: { x: from.x + dx * end, y: from.y + dy * end }
    };
  }

  expandInkSplat(splat, settings = {}, diameter = this.canvasManager.radius * 2) {
    const center = this.canvasManager.center;
    const startUv = splat.fromUv || splat.uv;
    const start = {
      x: center.x + (startUv.x - 0.5) * diameter,
      y: center.y - (startUv.y - 0.5) * diameter
    };
    const end = {
      x: center.x + (splat.uv.x - 0.5) * diameter,
      y: center.y - (splat.uv.y - 0.5) * diameter
    };
    const count = Math.max(1, Math.min(14, Number(settings.segments) || 1));
    const mirrorCount = count > 1 && settings.mirror ? 2 : 1;
    const copies = [];
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / count;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      for (let mirror = 0; mirror < mirrorCount; mirror += 1) {
        const transform = (point) => {
          const x = point.x - center.x, y = point.y - center.y;
          const rotatedX = cosine * x - sine * y;
          let rotatedY = sine * x + cosine * y;
          if (mirror) rotatedY = -rotatedY;
          return { x: center.x + rotatedX, y: center.y + rotatedY };
        };
        const from = transform(start), to = transform(end);
        const fromUv = this.pointToCanopyUV(from, diameter);
        const uv = this.pointToCanopyUV(to, diameter);
        // Convert the stored UV velocity back into the drawing plane, apply
        // the identical transform, then return it to UV's upward Y axis.
        const forceX = splat.force?.x || 0, forceScreenY = -(splat.force?.y || 0);
        const rotatedForceX = cosine * forceX - sine * forceScreenY;
        let rotatedForceY = sine * forceX + cosine * forceScreenY;
        if (mirror) rotatedForceY = -rotatedForceY;
        copies.push({ ...splat, fromUv, uv, force: { x: rotatedForceX, y: -rotatedForceY } });
      }
    }
    return copies;
  }

  scheduleFluidSeal() {
    window.clearTimeout(this.fluidSealTimer);
    // Allow a short wet-ink bloom after pointer-up, then freeze its movement.
    this.fluidSealTimer = window.setTimeout(() => this.threePreview?.sealFluidMotion(), 900);
  }

  disableGpuInkFallback() {
    this.gpuInkUnavailable = true;
    this.pendingFluidSplats.length = 0;
    this.renderer.document.strokes.forEach((stroke) => {
      if (stroke.settings?.gpuInk !== true) return;
      stroke.settings.gpuInk = false;
      if (stroke.settings.brushStyle === "fluid") stroke.settings.brushStyle = "soft";
    });
    this.renderer.invalidate();
    this.renderer.render();
  }

  settingsForPointer(settings, event) {
    const result = { ...settings };
    result.pressureFactor = event.pointerType === "pen" && event.pressure > 0 ? .62 + event.pressure * .76 : 1;
    result.pointerPressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
    result.gpuInk = this.gpuInkUnavailable !== true;
    if (!result.gpuInk && result.brushStyle === "fluid") result.brushStyle = "soft";
    return result;
  }

  updateSelectedFromControl(id, live) {
    if (!this.renderer.getSelected()) return;
    if (live && !this.controlEdits.has(id)) {
      this.renderer.document.commit();
      this.controlEdits.add(id);
    }
    const map = { repeatCount: "repeatCount", repeatRadius: "repeatRadius", patternScale: "scale", patternRotation: "rotation" };
    this.renderer.setSelectedProperty(map[id], Number(this.controls.elements[id].value), false);
    const selected = this.renderer.getSelected();
    if (id === "repeatRadius") this.controls.elements[id].value = String(selected.repeatRadius);
    this.controls.elements.patternScale.max = String(this.renderer.getMaxScale(selected));
    this.controls.elements.patternScale.value = String(selected.scale);
    this.controls.updatePatternValues();
  }

  updateSelectionControls() {
    const selected = this.renderer.getSelected(), panel = this.controls.elements.patternTools;
    panel.hidden = !selected || this.mode !== "pattern";
    if (!selected) return;
    const controls = this.controls.elements;
    const orbitZoneName = selected.repeatMode === "radial" ? selected.zone : (selected.zone === "伞心" ? "中部" : selected.zone);
    controls.repeatCount.max = ["外圈", "伞缘"].includes(orbitZoneName) ? "16" : "12";
    const selectedAsset = this.patternDrawer.getAsset(selected.patternId);
    const defaultRepeatCount = selectedAsset?.defaultRepeatCount || 8;
    controls.repeatCount.value = String(Math.min(Number(controls.repeatCount.max), selected.repeatMode === "radial" ? selected.repeatCount : defaultRepeatCount));
    const selectedZone = this.renderer.zones.getByName(orbitZoneName);
    const defaultOrbit = (selectedZone.min + selectedZone.max) * .5 * this.canvasManager.radius;
    controls.repeatRadius.value = String(Math.round(selected.repeatMode === "radial" ? selected.repeatRadius : defaultOrbit));
    controls.patternScale.max = String(this.renderer.getMaxScale(selected));
    controls.patternScale.value = String(selected.scale);
    controls.patternRotation.value = String(Math.round(selected.rotation * 180 / Math.PI));
    document.getElementById("selectedZone").textContent = selected.zone;
    document.querySelectorAll("[data-orientation]").forEach((button) => button.classList.toggle("is-active", button.dataset.orientation === selected.repeatOrientation));
    this.controls.updatePatternValues();
  }

  onControlChange(id, commit = false) {
    if (id === "segments" && commit) this.controls.snapSegmentValue();
    this.updateReadouts(); this.controls.updateSwatches();
  }

  undo() { if (this.renderer.undo()) { this.rebuildFluidArtwork(); this.updateSelectionControls(); this.showMessage("已撤销"); } }
  redo() { if (this.renderer.redo()) { this.rebuildFluidArtwork(); this.updateSelectionControls(); this.showMessage("已重做"); } }
  refreshBase() { this.canvasManager.renderBase(this.controls.getSettings()); this.renderer.render(); }
  updateReadouts() {
    this.controls.updateValueDisplays(); this.controls.updatePatternReadout();
    document.getElementById("segmentReadout").textContent = String(this.controls.getSettings().segments);
  }
  showMessage(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message; toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
  }
}
