import { getMotifAsset, getMotifAssetURL, MOTIF_CATEGORIES, MOTIF_LIBRARY } from "../drawing/MotifLibrary.js";

// ControlManager 维护界面控件与显示值，不直接操作 Canvas。
export class ControlManager {
  constructor() {
    const ids = [
      "colorPicker", "brushSize", "opacity", "segments", "segmentTicks", "mirror",
      "brushSizeValue", "opacityValue", "segmentsValue", "clearBtn", "saveBtn", "templateBtn", "randomBtn", "shareBtn", "designName",
      "undoBtn", "redoBtn", "repeatBtn", "deletePatternBtn", "repeatCount", "repeatRadius", "patternScale", "patternRotation",
      "repeatCountValue", "repeatRadiusValue", "patternScaleValue", "patternRotationValue", "guideToggle", "zoneSnap", "brushTools", "patternTools",
      "patternCategories", "patternCarousel"
    ];
    this.elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.fabricColor = "#f1eee5";
    this.fabricStyle = "silk";
    this.pattern = "lotus";
    this.activePatternCategory = getMotifAsset(this.pattern)?.categoryId || MOTIF_CATEGORIES[0].id;
    this.assetStates = new Map(MOTIF_LIBRARY.map((asset) => [asset.id, "loading"]));
    this.createSegmentTicks();
    this.renderPatternCategories();
    this.renderPatternCards();
    this.updateValueDisplays();
    this.updateSwatches();
    this.updatePatternSelection();
    this.updateFabricStyles();
  }

  createSegmentTicks() {
    const minimum = Number(this.elements.segments.min), maximum = Number(this.elements.segments.max);
    this.elements.segmentTicks.replaceChildren();
    // 范围保留完整步进；刻度只提示起点、中点和终点，避免 1–14 全部挤在滑轨下。
    const midpoint = Math.round((minimum + maximum) / 2);
    const options = [...new Set([minimum, midpoint, maximum])];
    options.forEach((value) => {
      const tick = document.createElement("button");
      tick.type = "button"; tick.className = "range-tick"; tick.dataset.value = String(value);
      tick.style.left = `${(value - minimum) / (maximum - minimum) * 100}%`;
      tick.setAttribute("aria-label", `设为 ${value} 重`); tick.title = `${value} 重`;
      const label = document.createElement("span"); label.textContent = String(value); tick.append(label);
      tick.addEventListener("click", () => {
        this.elements.segments.value = String(value);
        this.elements.segments.dispatchEvent(new Event("input", { bubbles: true }));
        this.elements.segments.dispatchEvent(new Event("change", { bubbles: true }));
      });
      this.elements.segmentTicks.append(tick);
    });
  }

  renderPatternCategories() {
    const container = this.elements.patternCategories;
    if (!container) return;
    container.replaceChildren();
    MOTIF_CATEGORIES.forEach((category) => {
      const count = MOTIF_LIBRARY.filter((asset) => asset.categoryId === category.id).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pattern-category";
      button.dataset.category = category.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(category.id === this.activePatternCategory));
      button.textContent = `${category.name} · ${count}`;
      button.addEventListener("click", () => this.setPatternCategory(category.id));
      container.append(button);
    });
  }

  setPatternCategory(categoryId) {
    if (!MOTIF_CATEGORIES.some((category) => category.id === categoryId)) return;
    this.activePatternCategory = categoryId;
    this.renderPatternCategories();
    this.renderPatternCards();
    this.updatePatternSelection();
  }

  renderPatternCards() {
    const container = this.elements.patternCarousel;
    if (!container) return;
    container.replaceChildren();
    const assets = MOTIF_LIBRARY.filter((asset) => asset.categoryId === this.activePatternCategory);
    assets.forEach((asset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pattern-card";
      button.dataset.pattern = asset.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(asset.id === this.pattern));
      const repeatLabel = asset.defaultRepeatCount > 1 ? `${asset.defaultRepeatCount} 重` : "单幅";
      const zoneLabel = asset.applicableZones.join(" / ");
      button.title = `${asset.name} · 建议尺寸 ${asset.recommendedSize}px · ${repeatLabel} · ${zoneLabel}`;
      button.setAttribute("aria-label", button.title);

      const imageFrame = document.createElement("span");
      imageFrame.className = "pattern-image";
      const image = document.createElement("img");
      image.src = getMotifAssetURL(asset);
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      imageFrame.append(image);

      const name = document.createElement("span");
      name.className = "pattern-name";
      name.textContent = asset.name;
      const meta = document.createElement("span");
      meta.className = "pattern-meta";
      meta.textContent = `${repeatLabel} · ${asset.applicableZones[0]}`;
      button.append(imageFrame, name, meta);

      const state = this.assetStates.get(asset.id);
      if (state === "missing" || state === "invalid") {
        button.disabled = true;
        button.classList.add("is-unavailable");
        button.title += ` · ${state === "missing" ? "文件缺失" : "配置无效"}`;
      }
      container.append(button);
    });
  }

  setAssetStates(drawer) {
    this.assetStates = new Map(drawer.assetStates);
    this.renderPatternCards();
    this.updatePatternSelection();
  }

  snapSegmentValue() {
    const minimum = Number(this.elements.segments.min), maximum = Number(this.elements.segments.max);
    const current = Math.round(Number(this.elements.segments.value));
    this.elements.segments.value = String(Math.max(minimum, Math.min(maximum, current)));
  }

  updateValueDisplays() {
    this.elements.brushSizeValue.textContent = this.elements.brushSize.value;
    this.elements.opacityValue.textContent = `${this.elements.opacity.value}%`;
    this.elements.segmentsValue.textContent = `${this.elements.segments.value} 重`;
    const minimum = Number(this.elements.segments.min), maximum = Number(this.elements.segments.max);
    const progress = maximum === minimum ? 100 : (Number(this.elements.segments.value) - minimum) / (maximum - minimum) * 100;
    this.elements.segments.style.setProperty("--range-progress", `${progress}%`);
    this.elements.segmentTicks.querySelectorAll("[data-value]").forEach((tick) => tick.classList.toggle("is-selected", tick.dataset.value === this.elements.segments.value));
    this.updatePatternValues();
  }

  updatePatternValues() {
    if (!this.elements.repeatCount) return;
    this.elements.repeatCountValue.textContent = this.elements.repeatCount.value;
    this.elements.repeatRadiusValue.textContent = `${this.elements.repeatRadius.value}px`;
    this.elements.patternScaleValue.textContent = `${Math.round(Number(this.elements.patternScale.value) * 100)}%`;
    this.elements.patternRotationValue.textContent = `${this.elements.patternRotation.value}°`;
  }

  updatePatternReadout() {
    const readout = document.getElementById("patternReadout");
    if (readout) readout.textContent = getMotifAsset(this.pattern)?.name || "纹样";
  }

  updatePatternSelection() {
    document.querySelectorAll("[data-pattern]").forEach((card) => {
      const selected = card.dataset.pattern === this.pattern;
      card.classList.toggle("is-active", selected);
      card.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll("[data-category]").forEach((button) => {
      const selected = button.dataset.category === this.activePatternCategory;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    this.updatePatternReadout();
  }

  updateSwatches() {
    const color = this.elements.colorPicker.value.toLowerCase();
    document.querySelectorAll("[data-brush-color]").forEach((button) => button.classList.toggle("is-active", button.dataset.brushColor.toLowerCase() === color));
    document.querySelectorAll("[data-fabric-color]").forEach((button) => button.classList.toggle("is-active", button.dataset.fabricColor.toLowerCase() === this.fabricColor.toLowerCase()));
  }

  updateFabricStyles() { document.querySelectorAll("[data-fabric-style]").forEach((button) => button.classList.toggle("is-active", button.dataset.fabricStyle === this.fabricStyle)); }
  setBrushColor(color) { this.elements.colorPicker.value = color; this.updateSwatches(); }
  setFabricColor(color) { this.fabricColor = color; this.updateSwatches(); }

  setPattern(pattern) {
    const asset = getMotifAsset(pattern);
    if (!asset || ["missing", "invalid"].includes(this.assetStates.get(pattern))) return false;
    this.pattern = pattern;
    if (asset.categoryId !== this.activePatternCategory) this.setPatternCategory(asset.categoryId);
    this.updatePatternSelection();
    return true;
  }

  setFabricStyle(style) { this.fabricStyle = style; this.updateFabricStyles(); }

  getSettings() {
    return {
      color: this.elements.colorPicker.value,
      brushSize: Number(this.elements.brushSize.value),
      opacity: Number(this.elements.opacity.value) / 100,
      segments: Number(this.elements.segments.value),
      mirror: this.elements.mirror.checked,
      brushStyle: document.querySelector("[data-brush-style].is-active")?.dataset.brushStyle || "soft",
      pattern: this.pattern,
      fabricColor: this.fabricColor,
      fabricStyle: this.fabricStyle
    };
  }

  randomize() {
    const colors = ["#b96e68", "#537c7e", "#bfa37a", "#263f3a", "#f1eee5"];
    const fabricColors = ["#f1eee5", "#d5e5dd", "#537c7e", "#d7b0a4"];
    const available = MOTIF_LIBRARY.filter((asset) => this.assetStates.get(asset.id) === "ready");
    const patterns = (available.length ? available : MOTIF_LIBRARY).map((asset) => asset.id);
    const styles = ["silk", "gauze", "indigo"];
    const pick = (items) => items[Math.floor(Math.random() * items.length)];
    this.setBrushColor(pick(colors)); this.setFabricColor(pick(fabricColors));
    this.elements.brushSize.value = String(Math.floor(Math.random() * 5) + 6);
    this.elements.opacity.value = String(Math.floor(Math.random() * 21) + 40);
    this.elements.segments.value = String([6, 8, 12][Math.floor(Math.random() * 3)]);
    this.elements.mirror.checked = true;
    this.setPattern(pick(patterns)); this.setFabricStyle(pick(styles)); this.updateValueDisplays();
  }
}
