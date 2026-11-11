import { getMotifAsset, getMotifAssetURL, MOTIF_CATEGORIES, MOTIF_LIBRARY } from "../drawing/MotifLibrary.js?v=20261111-motif-counts-v5";

// ControlManager 维护界面控件与显示值，不直接操作 Canvas。
export class ControlManager {
  constructor() {
    const ids = [
      "colorPicker", "brushSize", "opacity", "segments", "mirror",
      "brushSizeValue", "opacityValue", "segmentsValue", "clearBtn", "saveBtn", "randomBtn",
      "undoBtn", "redoBtn", "repeatBtn", "deletePatternBtn", "repeatCount", "patternScale", "patternRotation",
      "repeatCountValue", "patternScaleValue", "patternRotationValue", "brushTools", "patternTools",
      "patternCategoryTabs", "patternCarousel", "patternStory", "patternStoryCategory", "patternStoryTitle",
      "patternStoryWindow", "patternStoryCopy", "patternStoryMeaning"
    ];
    this.elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.patternStoryHomeParent = this.elements.patternStory?.parentElement || null;
    this.fabricColor = "#8aa79b";
    this.fabricMaterial = "georgette";
    this.pattern = "";
    this.activePatternCategory = MOTIF_CATEGORIES[0].id;
    this.patternPage = 0;
    this.patternPageSize = 15;
    this.patternStoryAnimation = null;
    this.patternStoryToken = 0;
    this.patternStoryDistance = 0;
    this.assetStates = new Map(MOTIF_LIBRARY.map((asset) => [asset.id, "loading"]));
    this.rangeInputs = [...document.querySelectorAll('input[type="range"]')];
    this.enhanceSteppedRanges();
    this.rangeInputs.forEach((input) => {
      input.addEventListener("input", () => this.updateRangeProgress(input));
      input.addEventListener("change", () => this.updateRangeProgress(input));
    });
    this.renderPatternCategories();
    this.bindPatternStory();
    this.renderPatternCards();
    this.enablePatternCarouselDrag();
    this.updateValueDisplays();
    this.updateSwatches();
    this.updatePatternSelection();
    this.updateFabricMaterials();
  }

  enhanceSteppedRanges() {
    this.rangeInputs.forEach((input) => {
      const minimum = Number(input.min) || 0;
      const maximum = Number(input.max) || 100;
      const step = Number(input.step) || 1;
      const count = Math.ceil((maximum - minimum) / step - 1e-9) + 1;
      if (count > 16) return; // Keep markers for short stepped controls, avoid crowding longer ranges.

      const wrapper = document.createElement("span");
      wrapper.className = "range-control";
      input.parentElement.insertBefore(wrapper, input);
      wrapper.append(input);
      const ticks = document.createElement("span");
      ticks.className = "range-ticks";
      ticks.setAttribute("aria-hidden", "true");
      for (let index = 0; index < count; index += 1) {
        const dot = document.createElement("span");
        dot.className = "range-tick";
        const value = index === count - 1 ? maximum : minimum + index * step;
        dot.dataset.value = String(value);
        ticks.append(dot);
      }
      wrapper.append(ticks);
      input.dataset.rangeTicks = "true";
    });
  }

  renderPatternCategories() {
    const container = this.elements.patternCategoryTabs;
    if (!container) return;
    container.replaceChildren();
    const availableCategories = MOTIF_CATEGORIES.filter((category) =>
      MOTIF_LIBRARY.some((asset) => !asset.legacy && asset.categoryId === category.id)
    );
    container.style.setProperty("--pattern-category-count", String(availableCategories.length));
    availableCategories.forEach((category) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "pattern-category";
      tab.dataset.category = category.id;
      tab.setAttribute("aria-label", category.name);
      tab.setAttribute("aria-controls", "patternCarousel");
      tab.title = category.name;
      tab.textContent = category.tabName || category.name;
      container.append(tab);
    });
    container.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-category]");
      if (tab && this.setPatternCategory(tab.dataset.category)) tab.focus();
    });
    container.addEventListener("keydown", (event) => {
      const tab = event.target.closest("[data-category]");
      if (!tab) return;
      const index = availableCategories.findIndex((category) => category.id === tab.dataset.category);
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % availableCategories.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + availableCategories.length) % availableCategories.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = availableCategories.length - 1;
      else return;
      event.preventDefault();
      const nextCategory = availableCategories[nextIndex];
      this.setPatternCategory(nextCategory.id);
      container.querySelector(`[data-category="${nextCategory.id}"]`)?.focus();
    });
    this.updatePatternCategoryTabs();
  }

  updatePatternCategoryTabs() {
    this.elements.patternCategoryTabs?.querySelectorAll("[data-category]").forEach((tab) => {
      const active = tab.dataset.category === this.activePatternCategory;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
  }

  bindPatternStory() {
    this.elements.patternStory?.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    window.addEventListener("resize", () => this.placePatternStory());
  }

  placePatternStory() {
    const { patternStory } = this.elements;
    if (!patternStory) return;
    if (this.patternStoryHomeParent && patternStory.parentElement !== this.patternStoryHomeParent) {
      const canvasStage = this.patternStoryHomeParent.querySelector("#canvasStage");
      this.patternStoryHomeParent.insertBefore(patternStory, canvasStage || null);
    }
  }

  showPatternStory(patternId) {
    const asset = getMotifAsset(patternId);
    const { patternStory, patternStoryCategory, patternStoryTitle, patternStoryWindow, patternStoryCopy, patternStoryMeaning } = this.elements;
    if (!asset || !patternStory || !patternStoryWindow) return false;

    this.patternStoryToken += 1;
    window.clearTimeout(this.patternStoryDismissTimer);
    window.clearTimeout(this.patternStoryHideTimer);
    this.patternStoryAnimation?.cancel();
    this.patternStoryAnimation = null;
    this.patternStoryDistance = 0;
    this.placePatternStory();
    patternStoryWindow.classList.remove("is-scrolling");
    patternStory.classList.remove("is-visible", "is-leaving");
    patternStory.hidden = false;
    patternStoryCategory.textContent = MOTIF_CATEGORIES.find((category) => category.id === asset.categoryId)?.name || "纹样";
    patternStoryTitle.textContent = asset.name;
    const passages = [asset.description, asset.meaning, asset.knowledge].filter(Boolean);
    patternStoryMeaning.textContent = [...new Set(passages)].join("\n") + "\n在伞面上，可以调整纹样的大小、方向与位置；将它靠近伞心可形成视觉重心，沿外圈排列则能与伞骨和圆形伞缘相互呼应。";

    const token = this.patternStoryToken;
    const prefersReducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    requestAnimationFrame(() => {
      if (token !== this.patternStoryToken || patternStory.hidden) return;
      patternStory.classList.add("is-visible");
      const distance = patternStoryCopy.scrollHeight - patternStoryWindow.clientHeight;
      if (!prefersReducedMotion && distance > 8) {
        this.patternStoryDistance = distance;
        patternStoryWindow.classList.add("is-scrolling");
        this.startPatternStoryMotion();
      } else this.schedulePatternStoryDismiss(token, prefersReducedMotion ? 4800 : 7200);
    });
    return true;
  }

  startPatternStoryMotion() {
    const { patternStoryCopy } = this.elements;
    if (!patternStoryCopy || typeof patternStoryCopy.animate !== "function" || this.patternStoryDistance <= 0) return;
    this.patternStoryAnimation?.cancel();
    const animation = patternStoryCopy.animate([
      { transform: "translateY(0px)" },
      { transform: `translateY(-${this.patternStoryDistance}px)` }
    ], {
      duration: Math.min(52000, Math.max(16000, this.patternStoryDistance / 12 * 1000)),
      delay: 900,
      easing: "linear",
      fill: "forwards"
    });
    animation.onfinish = () => {
      if (this.patternStoryAnimation !== animation) return;
      this.schedulePatternStoryDismiss(this.patternStoryToken, 1900);
    };
    this.patternStoryAnimation = animation;
  }

  schedulePatternStoryDismiss(token, delay) {
    window.clearTimeout(this.patternStoryDismissTimer);
    this.patternStoryDismissTimer = window.setTimeout(() => {
      if (token !== this.patternStoryToken) return;
      const story = this.elements.patternStory;
      story?.classList.remove("is-visible");
      story?.classList.add("is-leaving");
      this.patternStoryHideTimer = window.setTimeout(() => {
        if (token !== this.patternStoryToken) return;
        if (story) {
          story.hidden = true;
          story.classList.remove("is-leaving");
        }
        this.elements.patternStoryWindow?.classList.remove("is-scrolling");
      }, 1050);
    }, delay);
  }

  hidePatternStory() {
    this.patternStoryToken += 1;
    window.clearTimeout(this.patternStoryDismissTimer);
    window.clearTimeout(this.patternStoryHideTimer);
    this.patternStoryAnimation?.cancel();
    this.patternStoryAnimation = null;
    const story = this.elements.patternStory;
    if (story) {
      story.hidden = true;
      story.classList.remove("is-visible", "is-leaving");
    }
    this.elements.patternStoryWindow?.classList.remove("is-scrolling");
  }

  // Let desktop users drag the motif strip; touch devices keep native panning.
  enablePatternCarouselDrag() {
    const rail = this.elements.patternCarousel;
    if (!rail) return;
    let start = null;
    let suppressClick = false;
    rail.addEventListener("pointerdown", (event) => { start = { x: event.clientX, y: event.clientY, id: event.pointerId }; });
    rail.addEventListener("pointerup", (event) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return;
      suppressClick = true;
      this.setPatternPage(this.patternPage + (dx < 0 ? 1 : -1));
      window.setTimeout(() => { suppressClick = false; }, 0);
    });
    rail.addEventListener("click", (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }, true);
  }

  setPatternCategory(categoryId) {
    if (!MOTIF_CATEGORIES.some((category) => category.id === categoryId)) return false;
    this.activePatternCategory = categoryId;
    this.patternPage = 0;
    this.updatePatternCategoryTabs();
    this.renderPatternCards();
    if (this.elements.patternCarousel) this.elements.patternCarousel.scrollLeft = 0;
    this.updatePatternSelection();
    return true;
  }

  renderPatternCards() {
    const container = this.elements.patternCarousel;
    if (!container) return;
    container.replaceChildren();
    const assets = MOTIF_LIBRARY.filter((asset) => !asset.legacy && asset.categoryId === this.activePatternCategory);
    const pages = Math.max(1, Math.ceil(assets.length / this.patternPageSize));
    this.patternPage = Math.min(this.patternPage, pages - 1);
    assets.slice(this.patternPage * this.patternPageSize, (this.patternPage + 1) * this.patternPageSize).forEach((asset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pattern-card";
      button.dataset.pattern = asset.id;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(asset.id === this.pattern));
      button.title = asset.name;
      button.setAttribute("aria-label", `${asset.name}，查看纹样并开始放置`);

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
      button.append(imageFrame, name);

      const state = this.assetStates.get(asset.id);
      if (state === "missing" || state === "invalid") {
        button.disabled = true;
        button.classList.add("is-unavailable");
        button.title += ` · ${state === "missing" ? "文件缺失" : "配置无效"}`;
      }
      container.append(button);
    });
    const indicators = document.getElementById("patternPageIndicators");
    if (indicators) {
      indicators.replaceChildren();
      indicators.hidden = pages <= 1;
      for (let index = 0; index < pages; index += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pattern-page-indicator";
        button.setAttribute("aria-label", `第 ${index + 1} 页，共 ${pages} 页`);
        button.setAttribute("aria-current", index === this.patternPage ? "page" : "false");
        button.addEventListener("click", () => this.setPatternPage(index));
        indicators.append(button);
      }
    }
  }

  setPatternPage(page) {
    const count = MOTIF_LIBRARY.filter((asset) => !asset.legacy && asset.categoryId === this.activePatternCategory).length;
    const next = Math.max(0, Math.min(Math.max(0, Math.ceil(count / this.patternPageSize) - 1), page));
    if (next === this.patternPage) return;
    this.patternPage = next;
    this.renderPatternCards();
    this.updatePatternSelection();
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
    this.elements.opacityValue.textContent = this.elements.opacity.value;
    this.elements.segmentsValue.textContent = `${this.elements.segments.value} 重`;
    const mirrorDisabled = Number(this.elements.segments.value) <= 1;
    this.elements.mirror.disabled = mirrorDisabled;
    this.elements.mirror.closest(".check-row")?.classList.toggle("is-disabled", mirrorDisabled);
    this.elements.mirror.title = mirrorDisabled ? "1 重为单笔绘制，镜像仅在重复数大于 1 时可用" : "镜像笔迹";
    this.updatePatternValues();
    this.rangeInputs?.forEach((input) => this.updateRangeProgress(input));
  }

  updateRangeProgress(input) {
    if (!input) return;
    const minimum = Number(input.min) || 0;
    const maximum = Number(input.max) || 100;
    const value = Number(input.value) || 0;
    const progress = maximum === minimum ? 100 : (value - minimum) / (maximum - minimum) * 100;
    input.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
    input.closest(".range-control")?.querySelectorAll(".range-tick").forEach((dot) => {
      dot.classList.toggle("is-passed", Number(dot.dataset.value) <= value);
      dot.classList.toggle("is-current", Number(dot.dataset.value) === value);
    });
  }

  updatePatternValues() {
    if (!this.elements.repeatCount) return;
    this.elements.repeatCountValue.textContent = this.elements.repeatCount.value;
    this.elements.patternScaleValue.textContent = `${Math.round(Number(this.elements.patternScale.value) * 100)}%`;
    this.elements.patternRotationValue.textContent = `${this.elements.patternRotation.value}°`;
    [this.elements.repeatCount, this.elements.patternScale, this.elements.patternRotation]
      .forEach((input) => this.updateRangeProgress(input));
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
    this.updatePatternReadout();
  }

  updateSwatches() {
    const color = this.elements.colorPicker.value.toLowerCase();
    document.querySelectorAll("[data-brush-color]").forEach((button) => button.classList.toggle("is-active", button.dataset.brushColor.toLowerCase() === color));
    const currentColor = document.getElementById("currentBrushColor");
    if (currentColor) {
      currentColor.style.setProperty("--current-brush-color", color);
      currentColor.title = `当前颜色 ${color}`;
      currentColor.setAttribute("aria-label", `当前颜色 ${color}`);
    }
    document.querySelectorAll("[data-fabric-color]").forEach((button) => button.classList.toggle("is-active", button.dataset.fabricColor.toLowerCase() === this.fabricColor.toLowerCase()));
    const currentFabric = document.getElementById("currentFabricColor");
    if (currentFabric) {
      currentFabric.style.setProperty("--current-brush-color", this.fabricColor);
      currentFabric.title = `当前伞面颜色 ${this.fabricColor}`;
    }
    const picker = document.getElementById("fabricColorPicker");
    if (picker && picker.value.toLowerCase() !== this.fabricColor.toLowerCase()) picker.value = this.fabricColor;
  }

  updateFabricMaterials() {
    document.querySelectorAll("[data-fabric-material]").forEach((button) => { const selected = button.dataset.fabricMaterial === this.fabricMaterial; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
    const description = document.getElementById("fabricMaterialDescription");
    if (description) description.textContent = {
      georgette: "乔其纱轻盈微皱，透光柔和，呈现薄纱的朦胧感。",
      plainSilk: "电力纺以平纹织成，绸面细滑，光线下带有温润丝光。",
      denseSilk: "密织真丝组织紧密、触感柔韧，反光更集中，透光较少。"
    }[this.fabricMaterial];
  }
  setBrushColor(color) { this.elements.colorPicker.value = color; this.updateSwatches(); }
  setFabricColor(color) { this.fabricColor = color; this.updateSwatches(); }

  setPattern(pattern) {
    const asset = getMotifAsset(pattern);
    if (!asset || ["missing", "invalid"].includes(this.assetStates.get(pattern))) return false;
    this.pattern = pattern;
    if (asset.categoryId !== this.activePatternCategory) this.setPatternCategory(asset.categoryId);
    const index = MOTIF_LIBRARY.filter((item) => !item.legacy && item.categoryId === this.activePatternCategory).findIndex((item) => item.id === pattern);
    if (index >= 0 && Math.floor(index / this.patternPageSize) !== this.patternPage) this.setPatternPage(Math.floor(index / this.patternPageSize));
    this.updatePatternSelection();
    return true;
  }

  setFabricMaterial(material) {
    const legacyMaterials = {
      scenery: "georgette", painting: "plainSilk", embroidery: "denseSilk",
      silk: "plainSilk", gauze: "georgette", indigo: "denseSilk", blueCloth: "denseSilk", satin: "plainSilk", damask: "denseSilk"
    };
    const normalized = legacyMaterials[material] || material;
    this.fabricMaterial = ["georgette", "plainSilk", "denseSilk"].includes(normalized) ? normalized : "georgette";
    this.updateFabricMaterials();
  }

  getSettings() {
    return {
      color: this.elements.colorPicker.value,
      // UI steps are perceptual, while the document keeps physical brush sizes
      // so existing saved strokes and their replay remain unchanged.
      brushSize: 4 + (Number(this.elements.brushSize.value) - 1) * 10,
      opacity: Number(this.elements.opacity.value) / 10,
      segments: Number(this.elements.segments.value),
      mirror: this.elements.mirror.checked,
      brushStyle: document.querySelector("[data-brush-style].is-active")?.dataset.brushStyle || "soft",
      pattern: this.pattern,
      fabricColor: this.fabricColor,
      fabricMaterial: this.fabricMaterial
    };
  }

  randomize(excludedPatterns = []) {
    const colors = ["#b96e68", "#537c7e", "#bfa37a", "#263f3a", "#f1eee5"];
    const fabricColors = ["#8aa79b", "#d9cdb8", "#91acb8", "#9caf8e", "#d0a0a5", "#d6bb83", "#73867d"];
    const selectable = MOTIF_LIBRARY.filter((asset) => !asset.legacy);
    const available = selectable.filter((asset) => this.assetStates.get(asset.id) === "ready");
    const patterns = (available.length ? available : selectable).map((asset) => asset.id);
    const materials = ["georgette", "plainSilk", "denseSilk"];
    const pick = (items) => items[Math.floor(Math.random() * items.length)];
    const excluded = new Set([this.pattern, ...excludedPatterns]);
    const alternatives = patterns.filter((pattern) => !excluded.has(pattern));
    const nextPattern = pick(alternatives.length ? alternatives : patterns);
    this.setBrushColor(pick(colors)); this.setFabricColor(pick(fabricColors));
    this.elements.brushSize.value = String(Math.floor(Math.random() * 3) + 1);
    this.elements.opacity.value = String(Math.floor(Math.random() * 3) + 4);
    this.elements.segments.value = String([6, 8, 12][Math.floor(Math.random() * 3)]);
    this.elements.mirror.checked = true;
    this.setPattern(nextPattern); this.setFabricMaterial(pick(materials)); this.updateValueDisplays();
    return nextPattern;
  }
}
