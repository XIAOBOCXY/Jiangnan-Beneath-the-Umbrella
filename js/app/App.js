import { CanvasManager } from "../core/CanvasManager.js";
import { MandalaRenderer } from "../core/MandalaRenderer.js";
import { PatternDrawer } from "../drawing/PatternDrawer.js";
import { ShareManager } from "../features/ShareManager.js";
import { TemplateComposer } from "../features/TemplateComposer.js";
import { AnimationManager } from "../ui/AnimationManager.js";
import { ControlManager } from "../ui/ControlManager.js";

// App 负责模式切换、Pointer Events、控件状态和功能模块编排。
export class App {
  constructor() {
    this.canvasManager = new CanvasManager(document.getElementById("umbrellaCanvas"));
    this.controls = new ControlManager();
    this.patternDrawer = new PatternDrawer();
    this.renderer = new MandalaRenderer(this.canvasManager, this.patternDrawer);
    this.canvasManager.onResize = () => { this.renderer.invalidate(); this.renderer.render(); };
    this.templateComposer = new TemplateComposer(this.canvasManager, this.patternDrawer);
    this.animation = new AnimationManager(() => this.renderer.advanceAnimation());
    this.share = new ShareManager(() => this.canvasManager.createExportCanvas(), (message) => this.showMessage(message));
    this.mode = "brush";
    this.viewMode = "2d";
    this.threePreview = null;
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
    const canvas = this.canvasManager.canvas;
    canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.onPointerEnd(event));
    canvas.addEventListener("pointercancel", (event) => this.onPointerEnd(event));
    canvas.addEventListener("lostpointercapture", (event) => this.onPointerEnd(event));
    canvas.addEventListener("pointerleave", () => { if (!this.gesture) this.canvasManager.setPointerLight(null); });
  }

  bindControlEvents() {
    const { elements } = this.controls;
    [elements.colorPicker, elements.brushSize, elements.opacity, elements.segments, elements.mirror, elements.animate].forEach((element) => {
      element.addEventListener("input", () => this.onControlChange(element.id));
      element.addEventListener("change", () => this.onControlChange(element.id, true));
    });
    [elements.repeatCount, elements.repeatRadius, elements.patternScale, elements.patternRotation].forEach((element) => {
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
    document.querySelectorAll("[data-pattern]").forEach((card) => card.addEventListener("click", () => {
      this.controls.setPattern(card.dataset.pattern); this.setMode("pattern");
      this.showMessage("点击伞面放置一个纹样");
    }));
    document.querySelectorAll("[data-fabric-style]").forEach((button) => button.addEventListener("click", () => {
      this.controls.setFabricStyle(button.dataset.fabricStyle); this.refreshBase();
    }));
    document.querySelectorAll("[data-carousel]").forEach((button) => button.addEventListener("click", () => {
      const carousel = document.getElementById("patternCarousel");
      carousel.scrollBy({ left: (button.dataset.carousel === "next" ? 1 : -1) * carousel.clientWidth * .72, behavior: "smooth" });
    }));
  }

  bindActionEvents() {
    const { elements } = this.controls;
    elements.randomBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      this.controls.randomize(); this.refreshAllSettings(); this.showMessage("灵感已更新");
    });
    elements.clearBtn.addEventListener("click", () => {
      if (!this.isReady) return;
      this.renderer.clear(); this.updateSelectionControls(); this.showMessage("已留白，可以开始创作");
    });
    elements.templateBtn.addEventListener("click", async () => {
      if (!this.isReady) return;
      await this.templateComposer.applyDefault(this.renderer);
      this.updateSelectionControls(); this.showMessage("荷韵西湖示例已恢复");
    });
    elements.saveBtn.addEventListener("click", async () => {
      if (this.viewMode !== "3d" || !this.threePreview) { await this.share.saveCanvas(); return; }
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
        this.showMessage(`已载入伞模 · ${result.meshes} 个绸面网格`);
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
      this.showMessage("已恢复程序伞体");
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
    if (this.viewMode === "2d") document.querySelector(".status-hint").textContent = isBrush ? "在伞面上拖动画笔" : "点击放置 · 拖动已选纹样";
    if (isBrush) { this.renderer.document.selectedId = null; this.renderer.render(); }
    this.updateSelectionControls();
  }

  async setViewMode(viewMode) {
    const canvas = this.canvasManager.canvas;
    const viewer = document.getElementById("threeViewer");
    const error = document.getElementById("threeError");
    if (viewMode === "3d") {
      canvas.hidden = true;
      viewer.hidden = false;
      if (!this.threePreview) {
        error.hidden = true;
        try {
          const { ThreeUmbrellaPreview } = await import("../rendering/ThreeUmbrellaPreview.js");
          this.threePreview = new ThreeUmbrellaPreview(document.getElementById("threeHost"));
        } catch (loadError) {
          canvas.hidden = false;
          viewer.hidden = true;
          const reason = loadError?.message || "Three.js 模块无法加载";
          error.textContent = `3D 预览暂不可用：${reason}`;
          error.hidden = false;
          this.showMessage("Three.js 加载失败，请检查网络连接后重试");
          return false;
        }
      }
      this.refreshThreeTexture(true);
      this.threePreview.setActive(true);
      document.querySelector(".canvas-container").classList.add("is-3d");
      document.getElementById("saveBtn").textContent = "保存 3D";
    } else {
      canvas.hidden = false;
      viewer.hidden = true;
      this.threePreview?.setActive(false);
      document.querySelector(".canvas-container").classList.remove("is-3d");
      document.getElementById("saveBtn").textContent = "保存";
    }
    this.viewMode = viewMode;
    document.querySelector(".status-hint").textContent = viewMode === "3d"
      ? "拖动旋转 · 双指或滚轮缩放"
      : (this.mode === "brush" ? "在伞面上拖动画笔" : "点击放置 · 拖动已选纹样");
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

  onPointerDown(event) {
    if (!this.isReady || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = this.canvasManager.getPoint(event);
    if (!this.canvasManager.containsPoint(point)) return;
    event.preventDefault();
    this.canvasManager.canvas.setPointerCapture(event.pointerId);
    this.canvasManager.setPointerLight(point);
    if (this.mode === "brush") {
      this.renderer.beginStroke(point, this.settingsForPointer(this.controls.getSettings(), event));
      this.gesture = { type: "brush", pointerId: event.pointerId };
      this.refreshAnimation();
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
    const point = this.canvasManager.getPoint(event);
    this.canvasManager.setPointerLight(point);
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault();
    if (this.gesture.type === "brush") this.renderer.extendStroke(point, this.settingsForPointer(this.controls.getSettings(), event));
    else if (this.gesture.type === "move" && this.canvasManager.containsPoint(point)) {
      this.renderer.moveSelected(point.x - this.gesture.lastPoint.x, point.y - this.gesture.lastPoint.y);
      this.gesture.lastPoint = point;
    }
  }

  onPointerEnd(event) {
    if (!this.gesture || (event.pointerId !== undefined && event.pointerId !== this.gesture.pointerId)) return;
    if (this.gesture.type === "brush") this.renderer.endStroke();
    this.gesture = null;
    this.updateSelectionControls();
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
    if (id === "patternScale") this.controls.elements[id].value = String(selected.scale);
    if (id === "repeatRadius") this.controls.elements[id].value = String(selected.repeatRadius);
    this.controls.updatePatternValues();
  }

  updateSelectionControls() {
    const selected = this.renderer.getSelected(), panel = this.controls.elements.patternTools;
    panel.hidden = !selected || this.mode !== "pattern";
    if (!selected) return;
    const controls = this.controls.elements;
    const orbitZoneName = selected.repeatMode === "radial" ? selected.zone : (selected.zone === "伞心" ? "中部" : selected.zone);
    controls.repeatCount.max = ["外圈", "伞缘"].includes(orbitZoneName) ? "16" : "12";
    controls.repeatCount.value = String(Math.min(Number(controls.repeatCount.max), selected.repeatMode === "radial" ? selected.repeatCount : 8));
    const selectedZone = this.renderer.zones.getByName(orbitZoneName);
    const defaultOrbit = (selectedZone.min + selectedZone.max) * .5 * this.canvasManager.radius;
    controls.repeatRadius.value = String(Math.round(selected.repeatMode === "radial" ? selected.repeatRadius : defaultOrbit));
    controls.patternScale.value = String(selected.scale);
    controls.patternRotation.value = String(Math.round(selected.rotation * 180 / Math.PI));
    document.getElementById("selectedZone").textContent = selected.zone;
    document.querySelectorAll("[data-orientation]").forEach((button) => button.classList.toggle("is-active", button.dataset.orientation === selected.repeatOrientation));
    this.controls.updatePatternValues();
  }

  onControlChange(id, commit = false) {
    if (id === "segments" && commit) this.controls.snapSegmentValue();
    this.updateReadouts(); this.controls.updateSwatches();
    if (id === "animate") {
      if (this.controls.getSettings().animate) this.refreshAnimation();
      else this.animation.stop();
    }
  }

  undo() { if (this.renderer.undo()) { this.updateSelectionControls(); this.showMessage("已撤销"); } }
  redo() { if (this.renderer.redo()) { this.updateSelectionControls(); this.showMessage("已重做"); } }
  refreshBase() { this.canvasManager.renderBase(this.controls.getSettings()); this.renderer.render(); }
  refreshAllSettings() { this.refreshBase(); this.refreshAnimation(); }
  refreshAnimation() { if (this.controls.getSettings().animate) this.animation.start(); else this.animation.stop(); }
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
