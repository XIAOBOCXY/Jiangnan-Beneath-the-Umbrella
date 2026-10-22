// ControlManager 维护界面控件与显示值，不直接操作 Canvas。
export class ControlManager {
  constructor() {
    const ids = [
      "colorPicker", "brushSize", "opacity", "segments", "segmentTicks", "mirror", "animate",
      "brushSizeValue", "opacityValue", "segmentsValue", "clearBtn", "saveBtn", "templateBtn", "randomBtn", "shareBtn", "designName",
      "undoBtn", "redoBtn", "repeatBtn", "deletePatternBtn", "repeatCount", "repeatRadius", "patternScale", "patternRotation",
      "repeatCountValue", "repeatRadiusValue", "patternScaleValue", "patternRotationValue", "guideToggle", "zoneSnap", "brushTools", "patternTools"
    ];
    this.elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.fabricColor = "#f1eee5";
    this.fabricStyle = "silk";
    this.pattern = "lotus";
    this.patternNames = { lotus: "西湖荷花", westLake: "雷峰湖山", koi: "锦鲤戏水", bamboo: "风竹", cloud: "如意云纹", water: "西湖水纹" };
    this.createSegmentTicks();
    this.updateValueDisplays();
    this.updateSwatches();
    this.updatePatternSelection();
    this.updateFabricStyles();
  }

  createSegmentTicks() {
    const minimum = Number(this.elements.segments.min), maximum = Number(this.elements.segments.max);
    this.elements.segmentTicks.replaceChildren();
    const options = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
    options.forEach((value) => {
      const tick = document.createElement("button");
      tick.type = "button"; tick.className = "range-tick"; tick.dataset.value = String(value);
      tick.style.left = `${(value - minimum) / (maximum - minimum) * 100}%`;
      tick.setAttribute("aria-label", `${value} 重纹`); tick.title = `${value} 重纹`;
      const label = document.createElement("span"); label.textContent = String(value); tick.append(label);
      tick.addEventListener("click", () => {
        this.elements.segments.value = String(value);
        this.elements.segments.dispatchEvent(new Event("input", { bubbles: true }));
        this.elements.segments.dispatchEvent(new Event("change", { bubbles: true }));
      });
      this.elements.segmentTicks.append(tick);
    });
  }

  snapSegmentValue() {
    const minimum = Number(this.elements.segments.min), maximum = Number(this.elements.segments.max);
    const current = Math.round(Number(this.elements.segments.value));
    this.elements.segments.value = String(Math.max(minimum, Math.min(maximum, current)));
  }

  updateValueDisplays() {
    this.elements.brushSizeValue.textContent = this.elements.brushSize.value;
    this.elements.opacityValue.textContent = `${this.elements.opacity.value}%`;
    this.elements.segmentsValue.textContent = this.elements.segments.value;
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
    if (readout) readout.textContent = this.patternNames[this.pattern] || "纹样";
  }

  updatePatternSelection() {
    document.querySelectorAll("[data-pattern]").forEach((card) => {
      const selected = card.dataset.pattern === this.pattern;
      card.classList.toggle("is-active", selected); card.setAttribute("aria-selected", String(selected));
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
  setPattern(pattern) { if (!this.patternNames[pattern]) return; this.pattern = pattern; this.updatePatternSelection(); }
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
      animate: this.elements.animate.checked,
      fabricColor: this.fabricColor,
      fabricStyle: this.fabricStyle
    };
  }

  randomize() {
    const colors = ["#b96e68", "#537c7e", "#bfa37a", "#263f3a", "#f1eee5"];
    const fabricColors = ["#f1eee5", "#d5e5dd", "#537c7e", "#d7b0a4"];
    const patterns = Object.keys(this.patternNames), styles = ["silk", "gauze", "indigo"];
    const pick = (items) => items[Math.floor(Math.random() * items.length)];
    this.setBrushColor(pick(colors)); this.setFabricColor(pick(fabricColors));
    this.elements.brushSize.value = String(Math.floor(Math.random() * 5) + 6);
    this.elements.opacity.value = String(Math.floor(Math.random() * 21) + 40);
    this.elements.segments.value = String([6, 8, 12][Math.floor(Math.random() * 3)]);
    this.elements.mirror.checked = true; this.elements.animate.checked = false;
    this.setPattern(pick(patterns)); this.setFabricStyle(pick(styles)); this.updateValueDisplays();
  }
}
