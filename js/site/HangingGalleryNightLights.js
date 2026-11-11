import * as THREE from "three";

const BACKGROUND_WIDTH = 1672;
const BACKGROUND_HEIGHT = 941;

// Coordinates are normalized against the original room painting. The layer
// reproduces the painting's cover crop, so the lights stay on the lanterns and
// windows at every viewport aspect instead of drifting as decorative overlays.
const LIGHTS = Object.freeze([
  { type: "lamp", u: .244, v: .472, width: 94, height: 118, color: "#ffd18b", opacity: .72, phase: .4 },
  { type: "lamp", u: .292, v: .492, width: 70, height: 94, color: "#ffd18a", opacity: .58, phase: 1.3 },
  { type: "lamp", u: .900, v: .437, width: 94, height: 118, color: "#ffd18b", opacity: .7, phase: 3.7 },
  { type: "window", u: .267, v: .485, width: 105, height: 140, color: "#ffd89d", opacity: .25, phase: 5.1 },
  { type: "window", u: .925, v: .476, width: 95, height: 150, color: "#ffd38d", opacity: .24, phase: 2.8 }
]);

export class HangingGalleryNightLights {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.intensity = 0;
    this.frame = 0;
    this.time = 0;
    this.lastFrame = 0;
    this.width = 1;
    this.height = 1;
    if (!host) return;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power"
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.glowTexture = this.createGlowTexture();
    this.windowTexture = this.createWindowTexture();
    this.lights = LIGHTS.map((config, index) => {
      const material = new THREE.SpriteMaterial({
        map: config.type === "window" ? this.windowTexture : this.glowTexture,
        color: new THREE.Color(config.color),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `hanging-night-light-${index + 1}`;
      sprite.renderOrder = 5;
      this.scene.add(sprite);
      return { config, sprite, material };
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  createGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    const glow = context.createRadialGradient(128, 128, 2, 128, 128, 126);
    glow.addColorStop(0, "rgba(255,255,244,1)");
    glow.addColorStop(.055, "rgba(255,238,194,.98)");
    glow.addColorStop(.17, "rgba(255,191,105,.62)");
    glow.addColorStop(.4, "rgba(255,153,62,.2)");
    glow.addColorStop(.7, "rgba(255,132,48,.045)");
    glow.addColorStop(1, "rgba(255,120,36,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  createWindowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    context.save();
    context.shadowColor = "rgba(255,177,78,.72)";
    context.shadowBlur = 30;
    const pane = context.createLinearGradient(0, 28, 0, 292);
    pane.addColorStop(0, "rgba(255,230,167,.12)");
    pane.addColorStop(.22, "rgba(255,214,135,.82)");
    pane.addColorStop(.68, "rgba(255,190,94,.72)");
    pane.addColorStop(1, "rgba(255,167,67,.08)");
    context.fillStyle = pane;
    context.beginPath();
    if (typeof context.roundRect === "function") context.roundRect(40, 26, 112, 268, 10);
    else context.rect(40, 26, 112, 268);
    context.fill();
    context.shadowBlur = 16;
    context.strokeStyle = "rgba(255,225,163,.42)";
    context.lineWidth = 3;
    context.stroke();
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0,0,0,.55)";
    context.fillRect(56, 105, 80, 5);
    context.fillRect(56, 190, 80, 5);
    context.fillRect(93, 39, 6, 242);
    context.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  setActive(active) {
    this.active = Boolean(active);
    this.syncLoop();
  }

  setNight(night) {
    this.setIntensity(night ? 1 : 0);
  }

  setIntensity(intensity) {
    this.intensity = Math.max(0, Math.min(1, Number(intensity) || 0));
    this.host?.style.setProperty("--hanging-lamps", this.intensity.toFixed(3));
    this.syncLoop();
  }

  syncLoop() {
    const shouldRender = this.active && this.intensity > .002;
    if (!shouldRender) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.lastFrame = 0;
      return;
    }
    if (!this.frame) this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  resize() {
    if (!this.renderer || !this.host) return;
    const bounds = this.host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.width = bounds.width;
    this.height = bounds.height;
    this.renderer.setSize(Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)), false);
    const coverScale = Math.max(bounds.width / BACKGROUND_WIDTH, bounds.height / BACKGROUND_HEIGHT);
    const paintedWidth = BACKGROUND_WIDTH * coverScale;
    const paintedHeight = BACKGROUND_HEIGHT * coverScale;
    const offsetX = (bounds.width - paintedWidth) * .5;
    const offsetY = (bounds.height - paintedHeight) * .54;

    this.lights.forEach(({ config, sprite }) => {
      const paintedX = offsetX + config.u * paintedWidth;
      const paintedY = offsetY + config.v * paintedHeight;
      sprite.position.set(
        paintedX / bounds.width * 2 - 1,
        1 - paintedY / bounds.height * 2,
        0
      );
      sprite.scale.set(
        config.width * coverScale / bounds.width * 2,
        config.height * coverScale / bounds.height * 2,
        1
      );
    });
  }

  tick(now) {
    if (!this.active || this.intensity <= .002) {
      this.frame = 0;
      return;
    }
    const delta = this.lastFrame ? Math.min(50, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.time += delta * .001;
    this.lights.forEach(({ config, material }) => {
      const slow = Math.sin(this.time * 1.42 + config.phase) * .055;
      const quick = Math.sin(this.time * 4.7 + config.phase * 1.73) * .018;
      const gust = Math.sin(this.time * .37 + config.phase * .5) * .025;
      material.opacity = Math.max(0, config.opacity * this.intensity * (1 + slow + quick + gust));
    });
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  destroy() {
    this.setActive(false);
    this.resizeObserver?.disconnect();
    this.glowTexture?.dispose();
    this.windowTexture?.dispose();
    this.lights?.forEach(({ material }) => material.dispose());
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
