import { CanvasManager } from "../core/CanvasManager.js";
import { MandalaRenderer } from "../core/MandalaRenderer.js";
import { PatternDrawer } from "../drawing/PatternDrawer.js";
import { ShareManager } from "../features/ShareManager.js";
import { TemplateComposer } from "../features/TemplateComposer.js";
import { ControlManager } from "../ui/ControlManager.js";

// App 负责模式切换、Pointer Events、控件状态和功能模块编排。
export class App {
  constructor() {
    this.canvasManager = new CanvasManager(document.getElementById("umbrellaCanvas"));
    this.controls = new ControlManager();
    this.patternDrawer = new PatternDrawer((drawer) => this.controls.setAssetStates(drawer));
    this.renderer = new MandalaRenderer(this.canvasManager, this.patternDrawer);
    this.canvasManager.onResize = () => { this.renderer.invalidate(); this.renderer.render(); };
    this.templateComposer = new TemplateComposer(this.canvasManager, this.patternDrawer);
    this.share = new ShareManager(() => {
      if (this.threePreview) this.canvasManager.setFluidSnapshot(this.threePreview.captureFluidSnapshot());
      return this.canvasManager.createExportCanvas();
    }, (message) => this.showMessage(message));
    this.mode = "brush";
    this.viewMode = "2d";
    this.threePreview = null;
    this.fluidInitPromise = null;
    this.bundledModelPromise = null;
    this.pendingFluidSplats = [];
    this.lastFluidPoint = null;
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
    this.canvasContainer.addEventListener("pointerleave", () => { if (!this.gesture) this.canvasManager.setPointerLight(null); });
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
      this.syncBrushStyleUI();
      // Load the shared WebGL renderer while the user is choosing a brush,
      // instead of making the first stroke wait for Three.js and GPU setup.
      if (button.dataset.brushStyle === "fluid" && this.isReady) this.warmFluidPreview();
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
    const pointerX = Math.max(-stageRect.width * 0.5, Math.min(stageRect.width * 0.5, event.clientX - (stageRect.left + stageRect.width * 0.5)));
    const pointerY = Math.max(-stageRect.height * 0.5, Math.min(stageRect.height * 0.5, event.clientY - (stageRect.top + stageRect.height * 0.5)));
    const previousZoom = this.canvasManager.viewZoom;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.max(0.6, Math.min(3.2, previousZoom * zoomFactor));
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
      this.renderer.clear(); this.threePreview?.clearFluid(); this.threePreview?.setInkOpacity(1); this.canvasManager.setFluidSnapshot(null); this.updateSelectionControls(); this.showMessage("已留白，可以开始创作");
    });
    elements.templateBtn.addEventListener("click", async () => {
      if (!this.isReady) return;
      await this.templateComposer.applyDefault(this.renderer);
      this.threePreview?.clearFluid(); this.threePreview?.setInkOpacity(1); this.canvasManager.setFluidSnapshot(null);
      this.updateSelectionControls(); this.showMessage("荷韵西湖示例已恢复");
    });
    elements.saveBtn.addEventListener("click", async () => {
      if (this.viewMode !== "3d" || !this.threePreview) {
        if (this.viewMode === "2d" && this.threePreview) {
          this.canvasManager.setFluidSnapshot(this.threePreview.captureFluidSnapshot());
        }
        await this.share.saveCanvas();
        return;
      }
      try {
        const title = (elements.designName.value.trim() || "jiangnan-umbrella").replace(/[\\/:*?"<>|]/g, "-");
        await this.threePreview.savePNG(`${title}-3D.png`);
        this.showMessage("3D 赏伞图已保存");
      } catch (error) {
        this.showMessage(error.message || "3D 图片保存失败");
      }
    });
    elements.shareBtn.addEventListener("click", () => this.share.open());
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
    document.getElementById("closeShareBtn").addEventListener("click", () => this.share.close());
    document.getElementById("downloadPosterBtn").addEventListener("click", () => this.share.savePoster());
    document.getElementById("sharePosterBtn").addEventListener("click", () => this.share.sharePoster());
    this.share.overlay.addEventListener("click", (event) => { if (event.target === this.share.overlay) this.share.close(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.share.close();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); this.redo(); }
      if ((event.key === "Delete" || event.key === "Backspace") && this.mode === "pattern" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        this.renderer.deleteSelected(); this.updateSelectionControls();
      }
    });
  }

  setMode(mode) {
    this.mode = mode;
    const isBrush = mode === "brush";
    this.controls.elements.brushTools.hidden = !isBrush;
    document.querySelector(".symmetry-group").hidden = !isBrush;
    document.getElementById("brushModeBtn").classList.toggle("is-active", isBrush);
    document.getElementById("patternModeBtn").classList.toggle("is-active", !isBrush);
    this.canvasManager.canvas.classList.toggle("pattern-mode", !isBrush);
    if (this.viewMode === "2d") document.querySelector(".status-hint").textContent = isBrush
      ? "伞面绘画 · 空白处拖动旋转 · 滚轮缩放"
      : "伞面放置纹样 · 空白处拖动旋转 · 滚轮缩放";
    if (isBrush) { this.renderer.document.selectedId = null; this.renderer.render(); }
    this.updateSelectionControls();
    this.syncBrushStyleUI();
  }

  async ensureThreePreview() {
    if (this.threePreview) return this.threePreview;
    if (!this.fluidInitPromise) {
      this.fluidInitPromise = import("../rendering/ThreeUmbrellaPreview.js?v=20261023-ink-fluid-v3").then(({ ThreeUmbrellaPreview }) => {
        const preview = new ThreeUmbrellaPreview(document.getElementById("threeHost"));
        preview.onFoldProgress = (progress) => this.updateFoldControls(progress);
        this.threePreview = preview;
        const fluidHost = document.getElementById("fluidHost");
        const threeHost = document.getElementById("threeHost");
        preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", this.viewMode === "3d" ? threeHost : fluidHost);
        preview.setFluidDebugMode(document.getElementById("fluidDebugMode").value);
        this.pendingFluidSplats.splice(0).forEach((splat) => preview.injectInk(splat));
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
      if (this.viewMode !== "2d" || this.controls.getSettings().brushStyle !== "fluid") return;
      preview.setPresentation("fluid", document.getElementById("fluidHost"));
      preview.setActive(true);
    }).catch((error) => {
      console.warn("GPU 墨彩初始化失败：", error);
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
      document.getElementById("saveBtn").textContent = "保存 3D";
    } else {
      document.getElementById("canvasStage").hidden = false;
      viewer.hidden = true;
      if (this.threePreview) {
        this.threePreview.setPresentation("fluid", document.getElementById("fluidHost"));
        this.threePreview.setActive(true);
      }
      document.querySelector(".canvas-container").classList.remove("is-3d");
      document.getElementById("saveBtn").textContent = "保存";
    }
    this.viewMode = viewMode;
    document.querySelector(".status-hint").textContent = viewMode === "3d"
      ? "拖动旋转 · 双指或滚轮缩放"
      : (this.mode === "brush" ? "伞面绘画 · 空白处拖动旋转 · 滚轮缩放" : "伞面放置纹样 · 空白处拖动旋转 · 滚轮缩放");
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      const active = button.dataset.viewMode === viewMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.syncBrushStyleUI();
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
    this.canvasManager.setPointerLight(point);
    if (this.mode === "brush") {
      const settings = this.settingsForPointer(this.controls.getSettings(), event);
      // Lock the last wet stroke before the next one starts. The new stroke
      // gets a clean local velocity field instead of carrying old momentum.
      if (settings.brushStyle === "fluid") {
        this.threePreview?.sealFluidMotion();
        this.pendingFluidSplats.forEach((splat) => { splat.force = { x: 0, y: 0 }; });
      }
      const stroke = this.renderer.beginStroke(point, settings);
      this.gesture = { type: "brush", brushStyle: settings.brushStyle, strokeId: stroke?.id, pointerId: event.pointerId, lastPoint: point };
      this.injectFluidSegment(point, point, settings);
      return;
    }
    const selected = this.renderer.selectAt(point);
    if (selected) {
      this.renderer.document.commit();
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
    this.canvasManager.setPointerLight(this.canvasManager.containsPoint(point) ? point : null);
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
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
    if (this.gesture.type === "brush") this.renderer.endStroke();
    if (this.gesture.type === "rotate-view") this.canvasContainer.classList.remove("is-view-rotating");
    this.gesture = null;
    this.lastFluidPoint = null;
    this.updateSelectionControls();
  }

  injectFluidSegment(from, to, settings) {
    if (settings.brushStyle !== "fluid") return;
    const diameter = this.canvasManager.radius * 2;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    // GPU splats overlap naturally; avoid flooding the render-target queue on
    // fast pointer events while keeping enough samples for a continuous mark.
    const spacing = Math.max(3, (settings.brushSize || 8) * 0.9);
    const sampleCount = Math.max(1, Math.min(5, Math.ceil(distance / spacing)));
    const now = performance.now();
    const seconds = Math.max(1 / 120, (now - (this.lastFluidPoint?.time || now - 16)) / 1000);
    const rawForce = this.lastFluidPoint
      ? { x: (to.x - this.lastFluidPoint.point.x) / diameter / seconds, y: -(to.y - this.lastFluidPoint.point.y) / diameter / seconds }
      : { x: 0, y: 0 };
    // Keep the user's local stroke direction, while avoiding a long one-way
    // plume that drags the complete pigment mark after pointer-up.
    const forceScale = Math.min(0.72, 3.2 / Math.max(0.001, Math.hypot(rawForce.x, rawForce.y)));
    const force = { x: rawForce.x * forceScale, y: rawForce.y * forceScale };
    const input = [];
    for (let index = 1; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      input.push({
        uv: { x: 0.5 + (x - this.canvasManager.center.x) / diameter, y: 0.5 - (y - this.canvasManager.center.y) / diameter },
        force,
        color: settings.color || "#537c7e",
        radius: Math.max(0.008, Math.min(0.09, (settings.brushSize || 8) / diameter * 1.45)),
        opacity: Math.max(0.05, Math.min(0.85, settings.opacity || 0.45))
      });
    }
    this.renderer.appendFluidSplats(this.gesture?.strokeId, input);
    this.lastFluidPoint = { point: { ...to }, time: now };
    if (this.threePreview) {
      this.threePreview.setBrushSettings(settings);
      input.forEach((splat) => this.threePreview.injectInk(splat));
      return;
    }
    this.pendingFluidSplats.push(...input);
    if (this.pendingFluidSplats.length > 8192) this.pendingFluidSplats.splice(0, this.pendingFluidSplats.length - 8192);
    if (!this.fluidInitPromise) {
      this.ensureThreePreview().then((preview) => {
        preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", document.getElementById(this.viewMode === "3d" ? "threeHost" : "fluidHost"));
        preview.setFluidDebugMode(document.getElementById("fluidDebugMode").value);
        preview.setBrushSettings(settings);
        this.pendingFluidSplats.splice(0).forEach((splat) => preview.injectInk(splat));
        preview.setActive(true);
      }).catch((error) => {
        this.pendingFluidSplats.length = 0;
        console.warn("GPU 墨彩初始化失败：", error);
        this.showMessage("水墨模块未能启动，请检查网络或 WebGL 支持");
      });
    }
  }

  rebuildFluidArtwork() {
    // Fluid pigment is the visible artwork. Rebuild it from stored stroke
    // splats after history changes so undo/redo never swaps it for a Canvas line.
    this.pendingFluidSplats.length = 0;
    const strokes = this.renderer.document.strokes
      .filter((stroke) => stroke.settings?.brushStyle === "fluid")
      .filter((stroke) => stroke.fluidSplats?.length);
    this.canvasManager.setFluidSnapshot(null);
    if (this.threePreview) {
      this.threePreview.clearFluid();
      this.threePreview.setInkOpacity(1);
      // History replay restores the artwork as settled pigment. Replaying old
      // velocity would make every completed stroke drift in the same direction.
      strokes.forEach((stroke) => (stroke.fluidSplats || []).forEach((splat) => {
        this.threePreview.injectInk({ ...splat, force: { x: 0, y: 0 } });
      }));
      if (strokes.length) this.threePreview.setActive(true);
    } else {
      strokes.forEach((stroke) => (stroke.fluidSplats || []).forEach((splat) => {
        this.pendingFluidSplats.push({ ...splat, force: { x: 0, y: 0 } });
      }));
    }
  }

  syncBrushStyleUI() {
    const fluidMode = this.controls.getSettings().brushStyle === "fluid";
    const symmetry = document.querySelector(".symmetry-group");
    const hint = document.getElementById("brushStyleHint");
    this.controls.elements.segments.disabled = fluidMode;
    this.controls.elements.mirror.disabled = fluidMode;
    symmetry?.classList.toggle("is-disabled", fluidMode);
    if (hint) hint.hidden = !fluidMode;
    if (this.viewMode === "2d" && this.mode === "brush") {
      document.querySelector(".status-hint").textContent = fluidMode
        ? "水墨生成 · 单笔湿墨，松手后流动并定形 · 滚轮缩放"
        : "伞面绘画 · 空白处拖动旋转 · 滚轮缩放";
    }
  }

  settingsForPointer(settings, event) {
    const result = { ...settings };
    result.pressureFactor = event.pointerType === "pen" && event.pressure > 0 ? .62 + event.pressure * .76 : 1;
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
