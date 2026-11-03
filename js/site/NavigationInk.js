import * as THREE from "three";

const VERTEX_SHADER = `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform float uTime;
  uniform vec4 uItems[8];
  uniform float uLevels[8];
  uniform vec4 uBurstRect;
  uniform vec2 uBurstMotion;

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += noise(p) * amplitude;
      p = p * 2.03 + vec2(13.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }
  void main() {
    vec2 pixel = gl_FragCoord.xy;
    float alpha = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 item = uItems[i];
      if (item.z > 0.0 && item.w > 0.0 && uLevels[i] > 0.001) {
        vec2 q = (pixel - item.xy) / vec2(item.z, item.w);
        float paperFlow = fbm(q * vec2(3.7, 7.4) + vec2(float(i) * 8.3, uTime * 0.045));
        float radial = length(q * vec2(0.98, 1.08));
        float edgeWarp = (paperFlow - 0.5) * 0.34 + sin(q.x * 8.4 + paperFlow * 5.0) * 0.035;
        float body = 1.0 - smoothstep(0.76 + edgeWarp, 1.1 + edgeWarp, radial);
        float wetEdge = exp(-pow((radial - (0.94 + edgeWarp)) / 0.17, 2.0));
        float pigment = fbm(q * vec2(15.0, 27.0) + vec2(uTime * 0.018, float(i) * 12.0));
        float wash = body * (0.19 + pigment * 0.09) + wetEdge * (0.025 + pigment * 0.025);
        float itemAlpha = uLevels[i] * wash;
        alpha = itemAlpha + alpha * (1.0 - itemAlpha);
      }
    }

    if (uBurstMotion.y > 0.001) {
      vec2 burstQ = (pixel - uBurstRect.xy) / max(uBurstRect.zw, vec2(1.0));
      float distanceToCenter = length(burstQ);
      float ringRadius = mix(0.06, 1.35, uBurstMotion.x);
      float pigment = fbm(burstQ * vec2(7.0, 13.0) + uTime * 0.04);
      float ringWarp = (pigment - 0.5) * 0.18;
      float spreadingRim = exp(-pow((distanceToCenter - ringRadius - ringWarp) / 0.17, 2.0));
      float diffusedCore = 1.0 - smoothstep(ringRadius - 0.12, ringRadius + 0.12, distanceToCenter);
      float burstAlpha = uBurstMotion.y * (spreadingRim * 0.085 + diffusedCore * 0.055);
      alpha = burstAlpha + alpha * (1.0 - burstAlpha);
    }

    gl_FragColor = vec4(0.12, 0.23, 0.18, alpha);
  }
`;

/** Draws noise-edged ink directly into one small transparent Three.js canvas. */
export class NavigationInk {
  constructor(nav) {
    if (!nav) throw new Error("Missing heritage navigation");
    this.nav = nav;
    this.links = [...nav.querySelectorAll("a[data-route], button[data-ink-nav]")];
    this.activeIndex = -1;
    this.hoverIndex = -1;
    this.visible = false;
    this.bleed = 42;
    this.elapsed = 0;
    this.lastFrame = 0;
    this.burstElapsed = Number.POSITIVE_INFINITY;
    this.burstIndex = -1;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = "heritage-nav-ink-canvas navigation-ink-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    nav.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
    this.camera.position.z = 1;
    // Keep the shader arrays fixed-size; gallery navs can have five controls.
    this.items = Array.from({ length: 8 }, () => new THREE.Vector4());
    this.levels = new Float32Array(8);
    this.targets = new Float32Array(8);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uItems: { value: this.items },
        uLevels: { value: this.levels },
        uBurstRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uBurstMotion: { value: new THREE.Vector2(0, 0) }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: false
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(nav);
    this.handleWindowResize = () => this.resize();
    window.addEventListener("resize", this.handleWindowResize, { passive: true });
    this.links.forEach((link, index) => {
      link.addEventListener("pointerenter", () => this.setHover(index));
      link.addEventListener("pointerleave", () => this.setHover(-1));
      link.addEventListener("focus", () => this.setHover(index));
      link.addEventListener("blur", () => this.setHover(-1));
    });
  }

  setActive(route) {
    this.activeIndex = this.links.findIndex((link) => link.dataset.route === route);
    this.updateTargets();
  }

  setHover(index) {
    this.hoverIndex = index;
    this.updateTargets();
  }

  updateTargets() {
    this.targets.fill(0);
    if (this.activeIndex >= 0) this.targets[this.activeIndex] = 0.5;
    if (this.hoverIndex >= 0) this.targets[this.hoverIndex] = 0.9;
    if (this.visible && this.motionQuery.matches) {
      this.levels.set(this.targets);
      this.renderFrame(performance.now());
    }
  }

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.hoverIndex = -1;
      this.updateTargets();
      this.renderer.setAnimationLoop(null);
      this.lastFrame = 0;
      return;
    }
    this.resize();
    this.renderer.setAnimationLoop(this.motionQuery.matches ? null : this.renderFrame);
    if (this.motionQuery.matches) this.renderFrame(performance.now());
  }

  resize() {
    const rect = this.nav.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.renderer.setSize(rect.width + this.bleed * 2, rect.height, false);
    const ratio = this.renderer.getPixelRatio();
    this.material.uniforms.uItems.value = this.items;
    this.links.forEach((link, index) => {
      const item = this.items[index];
      const bounds = link.getBoundingClientRect();
      const centerX = (bounds.left - rect.left + bounds.width * 0.5 + this.bleed) * ratio;
      const centerY = (rect.bottom - bounds.top - bounds.height * 0.5) * ratio;
      item.set(centerX, centerY, (bounds.width * 0.56 + 9) * ratio, (bounds.height * 0.5 + 7) * ratio);
    });
    this.items.slice(this.links.length).forEach((item) => item.set(0, 0, 0, 0));
    if (this.visible && this.motionQuery.matches) this.renderFrame(performance.now());
  }

  burst(link) {
    const index = this.links.indexOf(link);
    if (index < 0) return Promise.resolve();
    this.burstIndex = index;
    this.burstElapsed = 0;
    this.hoverIndex = index;
    this.updateTargets();
    if (this.motionQuery.matches) {
      this.burstElapsed = Number.POSITIVE_INFINITY;
      return Promise.resolve();
    }
    return new Promise((resolve) => window.setTimeout(resolve, 155));
  }

  renderFrame = (timestamp = performance.now()) => {
    if (!this.visible) return;
    const now = Number.isFinite(timestamp) ? timestamp : performance.now();
    const delta = Math.min(this.lastFrame ? Math.max(0, (now - this.lastFrame) / 1000) : 1 / 60, 0.05);
    this.lastFrame = now;
    this.elapsed += delta;
    this.material.uniforms.uTime.value = this.elapsed;
    if (!this.motionQuery.matches) {
      const blend = 1 - Math.exp(-delta * 10.5);
      this.levels.forEach((level, index) => { this.levels[index] = level + (this.targets[index] - level) * blend; });
    }
    if (this.burstIndex >= 0 && Number.isFinite(this.burstElapsed)) {
      this.burstElapsed += delta;
      const progress = Math.min(1, this.burstElapsed / 0.48);
      const strength = (1 - progress) ** 1.35;
      const item = this.items[this.burstIndex];
      this.material.uniforms.uBurstRect.value.set(item.x, item.y, item.z, item.w);
      this.material.uniforms.uBurstMotion.value.set(progress, strength);
      if (progress >= 1) this.burstIndex = -1;
    } else {
      this.material.uniforms.uBurstRect.value.set(0, 0, 1, 1);
      this.material.uniforms.uBurstMotion.value.set(0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.setVisible(false);
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.handleWindowResize);
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
