import * as THREE from "three";
import { CanvasManager } from "../core/CanvasManager.js?v=20261111-neutral-dye-v1";
import { MandalaRenderer } from "../core/MandalaRenderer.js?v=20261111-inspiration-batch-v6";
import { PatternDrawer } from "../drawing/PatternDrawer.js?v=20261111-motif-counts-v5";
import { TemplateComposer } from "../features/TemplateComposer.js?v=20261111-empty-start-v10";
import { ArtworkGalleryStore } from "../features/ArtworkGalleryStore.js?v=20261111-gallery-color-v5";
import { ControlManager } from "../ui/ControlManager.js?v=20261111-motif-inspiration-v8";
import { MOTIF_LIBRARY } from "../drawing/MotifLibrary.js?v=20261111-motif-counts-v5";

const INK_PRESETS = {
  // Dry presets inject pigment only. The shader keeps their edges crisp;
  // texture adds fiber grain without enabling water diffusion.
  // Keep the watercolor preset unchanged. The remaining presets use visibly
  // different body, edge and speed response so each mark identifies its tool.
  soft:    { size: 0.46, opacity: 0.82, water: 0.16, grain: 0.018, flow: 0 },
  texture: { size: 0.86, opacity: 0.9, water: 0, grain: 0.72, flow: 0.012 },
  clean:   { size: 0.34, opacity: 1.00, water: 0, grain: 0, flow: 0 },
  fluid:   { size: 1.12, opacity: 1.00, water: 1.00, grain: 0.095, flow: 0.055 }
};

// App 负责模式切换、Pointer Events、控件状态和功能模块编排。
export class App {
  constructor(inkWashBackground = null) {
    this.inkWashBackground = inkWashBackground;
    this.inkWashBackground?.setSceneMode("studio");
    this.canvasManager = new CanvasManager(document.getElementById("umbrellaCanvas"));
    this.galleryStore = new ArtworkGalleryStore();
    this.controls = new ControlManager();
    this.patternDrawer = new PatternDrawer((drawer) => this.controls.setAssetStates(drawer));
    this.renderer = new MandalaRenderer(this.canvasManager, this.patternDrawer);
    this.canvasManager.onResize = () => {
      this.renderer.invalidate();
      this.renderer.render();
    };
    this.templateComposer = new TemplateComposer(this.canvasManager, this.patternDrawer);
    this.mode = "fabric";
    this.viewMode = "2d";
    this.threePreview = null;
    this.studioAutoRotateSpeed = null;
    this.studioCameraSnapshot = null;
    this.studioInitial3dViewApplied = false;
    this.showcaseRequestToken = 0;
    this.fluidInitPromise = null;
    this.bundledModelPromise = null;
    this.pendingFluidSplats = [];
    this.lastFluidPoint = null;
    this.fluidSealTimer = 0;
    this.canvasManager.onTextureDirty = () => this.refreshThreeTexture();
    // Keep the selected material swatch, 2D silk base and WebGL UV texture on
    // one initial color; otherwise the first 3D preview can inherit stale cloth.
    this.refreshBase();
    this.gesture = null;
    this.controlEdits = new Set();
    this.toastTimer = null;
    this.isReady = false;
    this.updateReadouts();
    this.bindCanvasEvents();
    this.bindControlEvents();
    this.bindActionEvents();
    this.setMode("fabric");
    this.canvasManager.canvas.classList.add("is-loading");
    this.ready = this.templateComposer.applyDefault(this.renderer).then(() => {
      this.isReady = true;
      this.canvasManager.canvas.classList.remove("is-loading");
      this.updateReadouts();
      this.showMessage("新作已准备好");
      this.warmFluidPreview();
      return this;
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
    [elements.repeatCount, elements.patternScale, elements.patternRotation].filter(Boolean).forEach((element) => {
      element.addEventListener("input", () => this.updateSelectedFromControl(element.id, true));
      element.addEventListener("change", () => {
        this.controlEdits.delete(element.id);
        this.updateSelectedFromControl(element.id, false);
      });
    });
    document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => this.setMode(button.dataset.mode)));
    document.querySelectorAll("[data-view-mode]").forEach((button) => button.addEventListener("click", () => {
      this.setViewMode(button.dataset.viewMode);
    }));
    document.querySelectorAll("[data-brush-style]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-brush-style]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
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
      this.controls.setFabricColor(button.dataset.fabricColor); this.refreshBase(); this.refreshThreeTexture(true);
    }));
    document.getElementById("fabricColorPicker")?.addEventListener("input", (event) => {
      this.controls.setFabricColor(event.target.value); this.refreshBase(); this.refreshThreeTexture(true);
    });
    this.controls.elements.patternCarousel?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-pattern]");
      if (!card || card.disabled || !this.controls.setPattern(card.dataset.pattern)) return;
      this.controls.showPatternStory(card.dataset.pattern);
      this.setMode("pattern");
      this.showMessage("点击伞面放置一个纹样");
    });
    document.querySelectorAll("[data-fabric-material]").forEach((button) => button.addEventListener("click", () => {
      this.controls.setFabricMaterial(button.dataset.fabricMaterial);
      this.threePreview?.setFabricMaterial(button.dataset.fabricMaterial);
      // The 2D cloth relief may update, but the motif artwork stays untouched.
      this.refreshBase();
    }));
    document.querySelectorAll("[data-carousel]").forEach((button) => button.addEventListener("click", () => {
      const carousel = document.getElementById("patternCarousel");
      carousel.scrollBy({ left: (button.dataset.carousel === "next" ? 1 : -1) * carousel.clientWidth * .72, behavior: "smooth" });
    }));
  }

  onCanvasWheel(event) {
    if (this.viewMode !== "2d") return;
    cancelAnimationFrame(this.viewFitFrame);
    event.preventDefault();
    const stageRect = this.canvasStage.getBoundingClientRect();
    const pointerX = event.clientX - (stageRect.left + stageRect.width * 0.5);
    const pointerY = event.clientY - (stageRect.top + stageRect.height * 0.5);
    const previousZoom = this.canvasManager.viewZoom;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.max(0.35, Math.min(18, previousZoom * zoomFactor));
    const ratio = nextZoom / previousZoom;
    // Keep the point under the pointer in place while zooming, so users can
    // inspect any part of the umbrella instead of only enlarging its center.
    const panX = pointerX - (pointerX - this.canvasManager.viewPanX) * ratio;
    const panY = pointerY - (pointerY - this.canvasManager.viewPanY) * ratio;
    this.canvasManager.setViewTransform(nextZoom, this.canvasManager.viewRotation, panX, panY);
  }

  bindActionEvents() {
    const { elements } = this.controls;
    const studioPage = document.getElementById("studioPage");
    const panel = document.getElementById("studioControls");
    const panelToggle = document.getElementById("studioPanelToggle");
    panelToggle?.addEventListener("click", () => {
      const collapsed = studioPage.classList.toggle("is-panel-collapsed");
      panel.inert = collapsed;
      panelToggle.setAttribute("aria-expanded", String(!collapsed));
      panelToggle.setAttribute("aria-label", collapsed ? "展开创作工具" : "收起创作工具");
      panelToggle.querySelector("span").textContent = collapsed ? "展卷" : "收卷";
      this.threePreview?.setStudioPanelCollapsed(collapsed);
      if (collapsed && this.viewMode === "2d") this.animateCanvasView(this.canvasManager.viewZoom, 0, 0);
    });
    studioPage.classList.remove("is-dark-studio");
    document.documentElement.classList.remove("studio-dark-background");
    try { localStorage.removeItem("studio-theme"); } catch (_) {}
    this.renderer.render({ markTexture: false });
    elements.randomBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      this.generateInspiration();
    });
    elements.clearBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      window.clearTimeout(this.fluidSealTimer);
      this.renderer.clear(); this.threePreview?.clearFluid(); this.threePreview?.setInkOpacity(1); this.canvasManager.setFluidSnapshot(null); this.updateSelectionControls(); this.showMessage("画布已清空");
    });
    elements.saveBtn.addEventListener("click", async () => {
      if (!this.isReady) return;
      try {
        const artwork = this.saveCurrentArtwork();
        window.dispatchEvent(new CustomEvent("gallery:updated", { detail: artwork }));
        this.showMessage("作品已存入悬伞画廊");
      } catch (error) {
        this.showMessage(error.message || "作品保存失败");
      }
    });
    elements.undoBtn.addEventListener("click", () => this.undo());
    elements.redoBtn.addEventListener("click", () => this.redo());
    const audioButton = document.getElementById("audioReactiveBtn");
    audioButton.addEventListener("click", async () => {
      try {
        const preview = await this.ensureThreePreview();
        const playing = await preview.toggleAmbientMusic();
        audioButton.querySelector(".audio-button-label").textContent = playing ? "暂停响应" : "声光响应";
        audioButton.title = playing ? "暂停内置音乐与绸面声光响应" : "点击开启内置音乐与绸面声光响应";
        audioButton.setAttribute("aria-pressed", String(playing));
        preview.setActive(true);
        this.showMessage(playing ? "内置音乐与绸面声光响应已开启" : "内置音乐与声光响应已暂停");
      } catch (audioError) {
        this.showMessage(audioError.message || "内置音乐暂不可用");
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

  generateInspiration() {
    window.clearTimeout(this.fluidSealTimer);
    // Record one undo checkpoint; individual marks in this transaction do not
    // serialize the growing artwork or start their own reveal animations.
    this.renderer.document.commit();
    const pattern = this.controls.randomize();
    const primary = MOTIF_LIBRARY.find((asset) => asset.id === pattern);
    const candidates = MOTIF_LIBRARY.filter((asset) => !asset.legacy && asset.id !== pattern && asset.categoryId === primary?.categoryId && this.controls.assetStates.get(asset.id) === "ready");
    const update = () => {
      this.renderer.withBatch(() => {
        this.renderer.clear();
        this.pendingFluidSplats.length = 0;
        this.threePreview?.clearFluid();
        this.threePreview?.setInkOpacity(1);
        this.canvasManager.setFluidSnapshot(null);
        const chosen = [pattern];
        if (candidates.length && Math.random() > .25) chosen.push(candidates[Math.floor(Math.random() * candidates.length)].id);
        const layoutAngle = Math.random() * Math.PI * 2;
        chosen.forEach((id, index) => {
          const angle = layoutAngle + (index ? 0 : Math.PI);
          const distance = this.canvasManager.radius * (index ? .53 : .10);
          const point = { x: this.canvasManager.center.x + Math.cos(angle) * distance, y: this.canvasManager.center.y + Math.sin(angle) * distance };
          const object = this.renderer.addPattern(id, point, { snap: false });
          if (object) {
            object.scale *= index ? .46 + Math.random() * .15 : .85 + Math.random() * .18;
            object.rotation = (Math.random() - .5) * .32;
          }
        });
        const settings = { ...this.controls.getSettings(), gpuInk: true, brushStyle: "fluid", segments: 1, mirror: false };
        const splats = [];
        for (let line = 0; line < 5; line += 1) {
          const angle = layoutAngle + line * Math.PI * 2 / 5 + (Math.random() - .5) * .25;
          const startRadius = .22 + Math.random() * .07;
          const pointAt = (t) => ({ x: .5 + Math.cos(angle + t * .38) * (startRadius + t * .10), y: .5 + Math.sin(angle + t * .38) * (startRadius + t * .10) });
          let previous = pointAt(0);
          const point = { x: this.canvasManager.center.x + (previous.x - .5) * this.canvasManager.radius * 2, y: this.canvasManager.center.y - (previous.y - .5) * this.canvasManager.radius * 2 };
          const stroke = this.renderer.beginStroke(point, settings);
          const lineSplats = [];
          for (let step = 1; step <= 6; step += 1) {
            const uv = pointAt(step / 6);
            lineSplats.push({ uv, fromUv: previous, force: { x: 0, y: 0 }, color: settings.color, radius: .015 + Math.random() * .01, opacity: .48, water: .45, grain: .08, seed: Math.random() });
            this.renderer.extendStroke({ x: this.canvasManager.center.x + (uv.x - .5) * this.canvasManager.radius * 2, y: this.canvasManager.center.y - (uv.y - .5) * this.canvasManager.radius * 2 }, settings);
            previous = uv;
          }
          this.renderer.appendFluidSplats(stroke.id, lineSplats);
          this.renderer.endStroke();
          splats.push(...lineSplats);
        }
        const paint = splats.flatMap((splat) => this.expandInkSplat(splat, settings));
        if (this.threePreview) this.threePreview.injectInks(paint);
        else {
          this.pendingFluidSplats.push(...paint);
          // Initialization already drains the pending marks and sets up the
          // current host. Repeating those steps forced another render/resize.
          void this.ensureThreePreview().catch((error) => {
            console.warn("灵感水墨初始化失败", error);
            this.showMessage("水墨模块未能启动");
          });
        }
        this.threePreview?.setFabricMaterial(settings.fabricMaterial);
      });
      this.renderer.document.selectedId = null;
      this.renderer.selectedInstanceIndex = 0;
      this.refreshBase();
    };
    if (this.threePreview) this.threePreview.withRenderBatch(update);
    else update();
    this.updateSelectionControls({ render: false });
    this.showMessage("已生成新的伞面、纹样与水墨组合");
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
    const isPattern = mode === "pattern";
    const isFabric = mode === "fabric";
    this.controls.elements.brushTools.hidden = !isBrush;
    document.querySelector(".symmetry-group").hidden = !isBrush;
    document.querySelector(".pattern-group").hidden = !isPattern;
    document.getElementById("fabricTools").hidden = !isFabric;
    document.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    this.canvasManager.canvas.classList.toggle("pattern-mode", isPattern);
    if (!isPattern && this.renderer.document.selectedId) { this.renderer.document.selectedId = null; this.renderer.render(); }
    this.updateSelectionControls();
  }

  async ensureThreePreview() {
    if (this.threePreview) return this.threePreview;
    if (!this.fluidInitPromise) {
      this.fluidInitPromise = import("../rendering/ThreeUmbrellaPreview.js?v=20261111-lantern-default-v1").then(({ ThreeUmbrellaPreview }) => {
        const preview = new ThreeUmbrellaPreview(document.getElementById("threeHost"));
        preview.setFabricMaterial(this.controls.getSettings().fabricMaterial);
        preview.onFoldProgress = (progress) => this.updateFoldControls(progress);
        this.threePreview = preview;
        const fluidHost = document.getElementById("fluidHost");
        const threeHost = document.getElementById("threeHost");
      preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", this.viewMode === "3d" ? threeHost : fluidHost);
        preview.setFluidDebugMode("composite");
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
    const bundledModelUrl = new URL("../../assets/models/west-lake-umbrella.glb?v=20261105-silk-linkage-v2", import.meta.url);
    // Bust the browser cache when the bundled Blender model is regenerated;
    // otherwise a reload can keep showing the old rib-only fold animation.
    bundledModelUrl.searchParams.set("v", "20261105-silk-linkage-v2");
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

  saveCurrentArtwork() {
    const settings = { ...this.controls.getSettings() };
    if (this.threePreview) this.canvasManager.setFluidSnapshot(this.threePreview.captureFluidSnapshot());
    return this.galleryStore.saveCanvas(
      this.createGalleryTextureCanvas(settings),
      this.renderer.getDocument(),
      settings.fabricMaterial,
      settings
    );
  }

  createGalleryTextureCanvas(settings = this.controls.getSettings()) {
    // Synchronize the source with the current editor before saving. A cached
    // UV canvas or the shared home/gallery preview can still hold an older dye.
    this.renderer.reveal.clear();
    this.renderer.invalidate();
    this.refreshBase(settings);
    const current = this.canvasManager.getUmbrellaTextureCanvas();
    // Freeze the base now: the shared renderer and mutable editor canvas must
    // not select the background color of the saved work.
    const source = document.createElement("canvas");
    source.width = current.width;
    source.height = current.height;
    source.getContext("2d").drawImage(current, 0, 0);
    if (this.threePreview?.inkFluid) {
      try {
        const composed = this.threePreview.captureStudioArtworkTexture(source);
        if (composed) return composed;
      } catch (error) { console.warn("三维伞面纹理合成失败，使用备用快照", error); }
    }
    const texture = document.createElement("canvas");
    texture.width = source.width;
    texture.height = source.height;
    const context = texture.getContext("2d");
    context.drawImage(source, 0, 0);
    if (this.canvasManager.fluidSnapshotCanvas) {
      context.globalAlpha = .78;
      context.drawImage(this.canvasManager.fluidSnapshotCanvas, 0, 0, texture.width, texture.height);
    }
    return texture;
  }

  async presentShowcase(host, artworkCanvas, revision = `showcase-${Date.now()}`, galleryPose = null, fabricMaterial = null) {
    if (!host?.isConnected) throw new Error("赏伞展示区域不存在，请关闭后重新打开。");
    if (!(artworkCanvas instanceof HTMLCanvasElement) || !artworkCanvas.width || !artworkCanvas.height) {
      throw new Error("伞面纹理未能生成，请重新保存或选择这把伞。");
    }
    const requestToken = ++this.showcaseRequestToken;
    const preview = await this.ensureBundledUmbrella();
    if (requestToken !== this.showcaseRequestToken) return null;
    if (!preview?.renderer || !preview?.modelRoot || !preview?.canopyMesh || !preview?.controls) {
      throw new Error("三维伞模或伞面网格未准备好，请重试。");
    }
    // The focus layer is revealed immediately before this call. Wait for its
    // real layout box instead of failing during the same task as `hidden=false`.
    let stableFrames = 0;
    for (let frame = 0; frame < 36 && stableFrames < 2; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (requestToken !== this.showcaseRequestToken) return null;
      const rect = host.getBoundingClientRect();
      const visible = rect.width > 32 && rect.height > 32
        && getComputedStyle(host).display !== "none"
        && getComputedStyle(host).visibility !== "hidden";
      stableFrames = visible ? stableFrames + 1 : 0;
    }
    if (requestToken !== this.showcaseRequestToken) return null;
    if (!host.clientWidth || !host.clientHeight) {
      throw new Error("3D 展示区域仍未完成布局。请关闭赏伞层后重试；如果持续出现，请检查窗口布局或浏览器缩放。");
    }
    preview.setActive(false);
    if (!this.studioCameraSnapshot) {
      this.studioCameraSnapshot = {
        position: preview.camera.position.clone(),
        up: preview.camera.up.clone(),
        target: preview.controls.target.clone(),
        fov: preview.camera.fov
      };
    }
    const isHomeShowcase = host?.id === "homeUmbrellaHost";
    const isGalleryFocusShowcase = host?.id === "galleryFocusHost";
    preview.setFabricMaterial(fabricMaterial || this.controls.getSettings().fabricMaterial);
    preview.setPresentation("3d", host);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (requestToken !== this.showcaseRequestToken) return null;
    preview.resize();
    // Gallery thumbnails use Euler (roll, yaw, 0). Match those axes in the
    // focused model so the first 3D frame has the same pattern orientation.
    preview.modelRoot?.rotation.set(
      isHomeShowcase || isGalleryFocusShowcase ? 0 : galleryPose?.roll || 0,
      isHomeShowcase || isGalleryFocusShowcase ? 0 : galleryPose?.yaw || 0,
      isHomeShowcase ? -0.54 : 0
    );
    if (preview.modelRoot && preview.baseModelScale) {
      // Home stays composed in its hero layout; the full-screen gallery uses
      // the same model scale and silk-facing pose as the studio 3D view.
      preview.modelRoot.scale.copy(preview.baseModelScale).multiplyScalar(isHomeShowcase ? .64 : 1);
    }
    preview.modelRoot?.updateMatrixWorld(true);
    preview.camera.fov = isHomeShowcase ? 30 : 34;
    preview.camera.up.set(0, 1, 0);
    preview.setFoldProgress(0);
    preview.camera.position.set(...(isHomeShowcase ? [0.12, 3.4, 4.3] : [0.15, 4.8, 4.4]));
    if ((isHomeShowcase || host?.id === "galleryFocusHost") && preview.modelRoot) {
      // The 2D capture targets the posed model bounds. A fixed Y target shifted
      // the canopy in the focus viewer and made its UV artwork look mismatched.
      preview.controls.target.copy(new THREE.Box3().setFromObject(preview.modelRoot, true).getCenter(new THREE.Vector3()));
      if (isHomeShowcase) preview.camera.position.add(preview.controls.target);
      else {
        const bounds = new THREE.Box3().setFromObject(preview.canopyMesh || preview.modelRoot, true);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const diameter = Math.max(size.x, size.z, .1);
        const distance = diameter / (2 * Math.tan(THREE.MathUtils.degToRad(preview.camera.fov * .5))) * 1.12;
        const elevation = THREE.MathUtils.degToRad(39);
        const azimuth = THREE.MathUtils.degToRad(14);
        preview.controls.target.copy(center);
        preview.camera.position.set(
          center.x + distance * Math.cos(elevation) * Math.sin(azimuth),
          center.y + distance * Math.sin(elevation),
          center.z + distance * Math.cos(elevation) * Math.cos(azimuth)
        );
        // Leave more room below the canopy for the gallery's bottom rail.
        const framingOffset = diameter * .16;
        preview.camera.position.y -= framingOffset;
        preview.controls.target.y -= framingOffset;
      }
    } else {
      preview.controls.target.set(0, 0.03, 0);
    }
    preview.camera.updateProjectionMatrix();
    preview.controls.update();
    preview.setArtworkCanvas(artworkCanvas, revision);
    if (preview.controls) {
      this.studioAutoRotateSpeed ??= preview.controls.autoRotateSpeed;
      preview.controls.autoRotateSpeed = isHomeShowcase ? 0.44 : 2;
      // Preserve the preview-matched entry angle; the user can rotate directly.
      preview.controls.autoRotate = isHomeShowcase;
    }
    preview.setActive(true);
    return preview;
  }

  suspendShowcase() {
    this.showcaseRequestToken += 1;
    this.threePreview?.setActive(false);
  }

  resumeStudioPresentation() {
    this.showcaseRequestToken += 1;
    this.canvasManager.updateZoomLayout?.();
    this.renderer.invalidate();
    this.renderer.render();
    if (!this.threePreview) return;
    if (this.threePreview.modelRoot) {
      this.threePreview.modelRoot.rotation.set(0, 0, 0);
      if (this.threePreview.baseModelScale) this.threePreview.modelRoot.scale.copy(this.threePreview.baseModelScale);
    }
    this.threePreview.setFabricMaterial(this.controls.getSettings().fabricMaterial);
    const host = this.viewMode === "3d" ? document.getElementById("threeHost") : document.getElementById("fluidHost");
    this.threePreview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", host);
    if (this.studioCameraSnapshot) {
      this.threePreview.camera.position.copy(this.studioCameraSnapshot.position);
      if (this.studioCameraSnapshot.up) this.threePreview.camera.up.copy(this.studioCameraSnapshot.up);
      this.threePreview.controls.target.copy(this.studioCameraSnapshot.target);
      this.threePreview.camera.fov = this.studioCameraSnapshot.fov ?? 34;
      this.threePreview.camera.updateProjectionMatrix();
      this.threePreview.controls.update();
      this.studioCameraSnapshot = null;
    }
    this.threePreview.controls.autoRotate = false;
    this.refreshThreeTexture(this.viewMode === "3d");
    if (this.studioAutoRotateSpeed !== null && this.threePreview.controls) this.threePreview.controls.autoRotateSpeed = this.studioAutoRotateSpeed;
    this.threePreview.resize();
    this.threePreview.setActive(true);
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
        preview.controls.autoRotate = false;
        if (entering3d && !this.studioInitial3dViewApplied) {
          preview.fitStudioInitialView();
          this.studioInitial3dViewApplied = true;
        }
        preview.setStudioPanelCollapsed(document.getElementById("studioPage").classList.contains("is-panel-collapsed"));
        this.updateFoldControls(preview.foldProgress || 0);
      } catch (loadError) {
        const reason = loadError?.message || "Three.js 模块无法加载";
        error.textContent = `3D 预览暂不可用：${reason}`;
        error.hidden = false;
        this.showMessage(`3D 预览暂不可用：${reason}`);
        return false;
      }
      // Finish any in-progress placement/repetition reveal before composing the
      // UV map, so a quick switch cannot capture an empty intermediate frame.
      this.renderer.reveal.clear();
      this.renderer.dirty.patterns = true;
      this.renderer.render();
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
    document.getElementById("audioReactiveBtn").hidden = viewMode !== "3d";
    document.getElementById("viewerFoldControl").setAttribute("aria-hidden", String(viewMode !== "3d"));
    this.inkWashBackground?.setSceneMode("studio");
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
      value.textContent = "此模型不支持开合";
      value.title = "当前伞模没有可驱动的开合动画";
      button.textContent = "收拢";
      button.setAttribute("aria-label", "收拢绸伞");
      return;
    }
    value.title = "拖动滑块，查看绸伞从完全展开到完全收拢";
    value.textContent = progress < 0.02
      ? "完全展开"
      : progress > 0.98
        ? "完全收拢"
        : `开合 ${Math.round(progress * 100)}%`;
    button.textContent = this.threePreview.getFoldTarget() >= 0.5 ? "展开" : "收拢";
    button.setAttribute("aria-label", button.textContent);
  }

  onPointerDown(event) {
    if (event.target.closest("#patternStory")) return;
    if (this.viewMode !== "2d" || !this.isReady || event.target.closest("button, input, select, textarea, [contenteditable='true']") || (event.pointerType === "mouse" && event.button !== 0)) return;
    cancelAnimationFrame(this.viewFitFrame);
    const point = this.canvasManager.getPoint(event);
    const insideCanopy = this.canvasManager.containsPoint(point);
    const canPlacePattern = this.mode === "pattern" && this.canvasManager.containsWorkspacePoint(point);
    const activeObject = this.mode === "pattern" ? this.renderer.getSelected() : null;
    const activeControl = this.renderer.hitSelectionControl(point, activeObject);
    const hitsSelectedPattern = Boolean(activeObject && this.renderer.getInstances(activeObject)
      .some((instance) => this.renderer.hitInstance(point, activeObject, instance)));
    if (!insideCanopy && !canPlacePattern && !activeControl && !hitsSelectedPattern) {
      event.preventDefault();
      this.canvasContainer.setPointerCapture(event.pointerId);
      this.canvasContainer.classList.add("is-view-rotating");
      this.gesture = { type: "rotate-view", pointerId: event.pointerId, lastAngle: this.canvasManager.getStageAngle(event) };
      return;
    }
    if (this.mode === "fabric" && !insideCanopy) return;
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
      return;
    }
    if (this.mode !== "pattern") return;
    if (activeControl) {
      event.preventDefault();
      if (activeControl === "delete") {
        this.renderer.deleteSelected();
        this.updateSelectionControls();
        this.showMessage("纹样已删除");
        return;
      }
      if (activeControl === "repeat-plus" || activeControl === "repeat-minus") {
        const current = activeObject.repeatMode === "radial" ? activeObject.repeatCount : 1;
        if (activeObject.repeatMode !== "radial" && activeControl === "repeat-minus") {
          this.showMessage("当前为单枚纹样");
          return;
        }
        const next = Math.max(1, Math.min(16, current + (activeControl === "repeat-plus" ? 1 : -1)));
        if (activeControl === "repeat-plus" && activeObject.repeatMode !== "radial") {
          this.renderer.setRepeat(2);
        } else if (activeObject.repeatMode === "radial") {
          this.renderer.setRepeat(next);
        }
        this.updateSelectionControls();
        this.showMessage(next === 1 ? "已恢复单枚纹样" : `环形重复 ${next} 次`);
        return;
      }
      const instance = this.renderer.getSelectedInstance(activeObject);
      if (!instance) return;
      this.renderer.document.commit();
      const pointerAngle = Math.atan2(point.y - instance.y, point.x - instance.x);
      const pointerDistance = Math.max(1, Math.hypot(point.x - instance.x, point.y - instance.y));
      if (activeControl === "rotate") {
        this.gesture = {
          type: "rotate-pattern",
          pointerId: event.pointerId,
          startAngle: pointerAngle,
          startRotation: activeObject.rotation
        };
        this.canvasContainer.setPointerCapture(event.pointerId);
        this.canvasContainer.classList.add("is-pattern-rotating");
      } else {
        this.gesture = {
          type: "resize-pattern",
          pointerId: event.pointerId,
          startDistance: pointerDistance,
          startScale: activeObject.scale
        };
        this.canvasContainer.setPointerCapture(event.pointerId);
        this.canvasContainer.classList.add("is-pattern-resizing");
      }
      this.updateSelectionControls();
      return;
    }
    const selected = this.renderer.selectAt(point);
    if (selected) {
      this.renderer.document.commit();
      this.canvasContainer.classList.add("is-pattern-moving");
      this.gesture = { type: "move", pointerId: event.pointerId, lastPoint: point };
    } else {
      const object = this.renderer.addPattern(this.controls.pattern, point, { snap: true });
      this.gesture = { type: "placed", pointerId: event.pointerId, objectId: object.id };
    }
    this.updateSelectionControls();
  }

  onPointerMove(event) {
    if (this.viewMode !== "2d") return;
    const point = this.canvasManager.getPoint(event);
    if (!this.gesture) {
      if (this.mode !== "pattern") return;
      const selected = this.renderer.getSelected();
      const control = this.renderer.hitSelectionControl(point, selected);
      const instance = this.renderer.getSelectedInstance(selected);
      let cursor = "";
      if (control?.startsWith("resize-nw") || control?.startsWith("resize-se")) cursor = "nwse-resize";
      else if (control?.startsWith("resize")) cursor = "nesw-resize";
      else if (control === "rotate") cursor = "grab";
      else if (control === "delete") cursor = "pointer";
      else if (control?.startsWith("repeat")) cursor = "pointer";
      else if (selected && instance && this.renderer.hitInstance(point, selected, instance)) cursor = "move";
      this.canvasManager.canvas.style.cursor = cursor;
      return;
    }
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
    if (this.gesture.type === "resize-pattern") {
      const selected = this.renderer.getSelected();
      const instance = this.renderer.getSelectedInstance(selected);
      if (!selected || !instance) return;
      const distance = Math.max(1, Math.hypot(point.x - instance.x, point.y - instance.y));
      this.renderer.setSelectedProperty("scale", this.gesture.startScale * distance / this.gesture.startDistance, false);
      return;
    }
    if (this.gesture.type === "rotate-pattern") {
      const selected = this.renderer.getSelected();
      const instance = this.renderer.getSelectedInstance(selected);
      if (!selected || !instance) return;
      const angle = Math.atan2(point.y - instance.y, point.x - instance.x);
      let delta = angle - this.gesture.startAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.renderer.setSelectedProperty("rotation", (this.gesture.startRotation + delta) * 180 / Math.PI, false);
      return;
    }
    if (this.gesture.type === "brush") {
      // Pointer events can repeat while the pointer is stationary. Those
      // zero-length samples must not become round stamps.
      if (Math.hypot(point.x - this.gesture.lastPoint.x, point.y - this.gesture.lastPoint.y) < 2) return;
      const settings = this.settingsForPointer(this.controls.getSettings(), event);
      this.renderer.extendStroke(point, settings);
      this.injectFluidSegment(this.gesture.lastPoint, point, settings);
      this.gesture.lastPoint = point;
    }
    else if (this.gesture.type === "move") {
      this.renderer.moveSelected(point.x - this.gesture.lastPoint.x, point.y - this.gesture.lastPoint.y);
      this.gesture.lastPoint = point;
    }
  }

  onPointerEnd(event) {
    if (!this.gesture || (event.pointerId !== undefined && event.pointerId !== this.gesture.pointerId)) return;
    if (this.gesture.type === "brush") {
      // Hold the final soft segment for one sample so release can finish it
      // with a pointed tip without painting over an existing round cap.
      if (this.gesture.pendingSoftSplat) {
        const tail = this.gesture.pendingSoftSplat;
        if (!this.gesture.softSubmitted && this.gesture.softDistance > 6) {
          // A fast swipe may contain only one input sample. Give it a belly
          // between the two pointed ends instead of thinning the entire mark.
          const middle = { x: (tail.fromUv.x + tail.uv.x) / 2, y: (tail.fromUv.y + tail.uv.y) / 2 };
          this.submitFluidSegment({ ...tail, uv: middle }, this.gesture.softSettings);
          tail.fromUv = middle;
          tail.widthStart = tail.widthEnd;
        }
        tail.widthEnd = 0.06;
        this.submitFluidSegment(tail, this.gesture.softSettings);
        this.gesture.pendingSoftSplat = null;
      }
      this.renderer.endStroke();
      this.canvasContainer.classList.remove("is-brush-drawing");
      this.scheduleFluidSeal();
    }
    if (this.gesture.type === "rotate-view") this.canvasContainer.classList.remove("is-view-rotating");
    if (this.gesture.type === "move") this.canvasContainer.classList.remove("is-pattern-moving");
    if (this.gesture.type === "resize-pattern") this.canvasContainer.classList.remove("is-pattern-resizing");
    if (this.gesture.type === "rotate-pattern") this.canvasContainer.classList.remove("is-pattern-rotating");
    this.gesture = null;
    this.lastFluidPoint = null;
    this.canvasManager.canvas.style.cursor = "";
    this.updateSelectionControls();
  }

  animateCanvasView(zoom, panX, panY) {
    cancelAnimationFrame(this.viewFitFrame);
    const manager = this.canvasManager;
    const start = { zoom: manager.viewZoom, x: manager.viewPanX, y: manager.viewPanY };
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
    const started = performance.now();
    const frame = (now) => {
      const t = duration ? Math.min(1, (now - started) / duration) : 1;
      const ease = 1 - Math.pow(1 - t, 3);
      manager.setViewTransform(start.zoom + (zoom - start.zoom) * ease, manager.viewRotation,
        start.x + (panX - start.x) * ease, start.y + (panY - start.y) * ease);
      if (t < 1) this.viewFitFrame = requestAnimationFrame(frame);
      else this.viewFitFrame = 0;
    };
    this.viewFitFrame = requestAnimationFrame(frame);
  }

  injectFluidSegment(from, to, settings) {
    if (settings.gpuInk === false) return;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1.5) return;
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
    const soft = settings.brushStyle === "soft";
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
      radius: Math.max(soft ? 0.0009 : 0.006, Math.min(0.18, (settings.brushSize || 8) * (soft ? 1 : settings.pressureFactor || 1) * preset.size / diameter * 1.45)),
      opacity: Math.max(0, Math.min(0.92, (settings.opacity ?? 0.45) * preset.opacity)),
      water: settings.brushStyle === "texture" || settings.brushStyle === "clean" ? 0 : preset.water,
      grain: preset.grain,
      seed: Math.random()
    };
    if (soft && this.gesture) {
      const previous = this.gesture.pendingSoftSplat;
      const distance = Math.hypot(clipped.to.x - clipped.from.x, clipped.to.y - clipped.from.y);
      const speed = this.gesture.softSpeed === undefined ? source.speed : this.gesture.softSpeed * 0.65 + source.speed * 0.35;
      this.gesture.softSpeed = speed;
      this.gesture.softDistance = (this.gesture.softDistance || 0) + distance;
      // Faster strokes lift the tip; pen pressure fills out the brush belly.
      // Adjacent segments share their endpoint width to avoid bead-like joins.
      const body = (1.05 - speed * 0.65) * (0.55 + source.pressure * 0.9);
      source.widthStart = previous?.widthEnd ?? 0.08;
      const target = body * Math.min(1, this.gesture.softDistance / Math.max(8, settings.brushSize * 1.2));
      source.widthEnd = Math.max(0.08, previous ? previous.widthEnd * 0.4 + target * 0.6 : target);
      if (previous) {
        this.submitFluidSegment(previous, this.gesture.softSettings);
        this.gesture.softSubmitted = true;
      }
      this.gesture.pendingSoftSplat = source;
      this.gesture.softSettings = { ...settings };
      return;
    }
    this.submitFluidSegment(source, settings);
  }

  submitFluidSegment(source, settings) {
    // Keep only source segments in history. Copies are derived with the same
    // radial/mirror transform as the visible 2D drawing coordinate system.
    this.renderer.appendFluidSplats(this.gesture?.strokeId, [source]);
    const input = this.expandInkSplat(source, settings);
    if (this.threePreview) {
      this.threePreview.injectInks(input);
      return;
    }
    this.pendingFluidSplats.push(...input);
    if (this.pendingFluidSplats.length > 8192) this.pendingFluidSplats.splice(0, this.pendingFluidSplats.length - 8192);
    if (!this.fluidInitPromise) {
      this.ensureThreePreview().then((preview) => {
        preview.setPresentation(this.viewMode === "3d" ? "3d" : "fluid", document.getElementById(this.viewMode === "3d" ? "threeHost" : "fluidHost"));
        preview.setFluidDebugMode("composite");
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
    // The crisp brush is drawn as one continuously connected smooth path.
    // Keeping it out of the fluid renderer avoids round per-event stamps and
    // makes its line visibly different from the dry fiber brush.
    result.gpuInk = this.gpuInkUnavailable !== true && result.brushStyle !== "clean";
    if (!result.gpuInk && result.brushStyle === "fluid") result.brushStyle = "soft";
    return result;
  }

  updateSelectionControls({ render = true } = {}) {
    const selected = this.renderer.getSelected();
    this.canvasContainer.classList.toggle("has-pattern-selection", Boolean(selected && this.mode === "pattern"));
    if (render) this.renderer.render();
  }

  onControlChange(id, commit = false) {
    if (id === "segments" && commit) this.controls.snapSegmentValue();
    this.updateReadouts(); this.controls.updateSwatches();
  }

  undo() { if (this.renderer.undo()) { this.rebuildFluidArtwork(); this.updateSelectionControls(); this.showMessage("已撤销"); } }
  redo() { if (this.renderer.redo()) { this.rebuildFluidArtwork(); this.updateSelectionControls(); this.showMessage("已重做"); } }
  refreshBase(settings = this.controls.getSettings()) {
    this.canvasManager.renderBase(settings, { deferRender: true });
    this.renderer.render({ markTexture: false });
    // Upload only after both the new cloth and motifs are ready.
    this.canvasManager.markTextureDirty();
  }
  updateReadouts() {
    this.controls.updateValueDisplays(); this.controls.updatePatternReadout();
    const segmentReadout = document.getElementById("segmentReadout");
    if (segmentReadout) segmentReadout.textContent = String(this.controls.getSettings().segments);
  }
  showMessage(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message; toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
  }
}
