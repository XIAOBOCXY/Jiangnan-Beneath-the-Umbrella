import * as THREE from "three";

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// A coherent brush front and fine bristle marks sweep across the page; the
// brief fully covered frame hides the route change.
const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uProgress;
  uniform float uStage;

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
    float sum = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += noise(p) * weight;
      p = p * 2.03 + vec2(13.7, 9.2);
      weight *= 0.5;
    }
    return sum * 1.0714;
  }
  void main() {
    if (uStage > 0.5 && uStage < 1.5) {
      gl_FragColor = vec4(0.23, 0.25, 0.23, 1.0);
      return;
    }

    float progress = smoothstep(0.0, 1.0, clamp(uProgress, 0.0, 1.0));
    float boundary = mix(1.14, -0.14, progress);
    float direction = uStage < 0.5 ? 1.0 : -1.0;
    float distanceToFront = direction * (vUv.x - boundary);
    // Most of the screen is either clear or fully covered. Avoid running the
    // turbulence calculation there, especially on lower-powered devices.
    if (distanceToFront > 0.16) {
      gl_FragColor = vec4(0.23, 0.25, 0.23, 1.0);
      return;
    }
    if (distanceToFront < -0.16) {
      gl_FragColor = vec4(0.0);
      return;
    }
    // A continuous, gently curved brush front with fine longitudinal bristles;
    // no detached flecks or rapidly changing turbulence at either end.
    float curve = sin(vUv.y * 3.7 + 0.5) * 0.036
      + sin(vUv.y * 8.2 + 1.7) * 0.014;
    float fibers = noise(vec2(vUv.y * 62.0, 3.2)) - 0.5;
    float edge = direction * (vUv.x - boundary + curve + fibers * 0.018);
    float body = smoothstep(-0.045, 0.027, edge);
    float depth = smoothstep(0.025, 0.12, edge);
    float bristle = smoothstep(-0.09, -0.02, edge) * (1.0 - body)
      * smoothstep(0.2, 0.8, noise(vec2(vUv.y * 110.0, 4.6))) * 0.22;
    float alpha = mix(max(body * 0.96, bristle), 1.0, depth);
    float wetRim = (1.0 - smoothstep(0.0, 0.11, abs(edge))) * 0.45;
    vec3 ink = mix(vec3(0.23, 0.25, 0.23), vec3(0.36, 0.39, 0.36), wetRim);
    gl_FragColor = vec4(ink, clamp(alpha, 0.0, 1.0));
  }
`;

/** One-shot liquid wash; renders the opaque cover before changing the page. */
export class InkTransition {
  constructor(host) {
    if (!host) throw new Error("Missing transition host");
    this.host = host;
    this.root = host.closest("#inkTransition") || host;
    this.renderer = null;
    this.coverDuration = 0.52;
    this.holdDuration = 0.01;
    this.revealDuration = 0.55;
    this.phase = "idle";
    this.phaseElapsed = 0;
    this.elapsed = 0;
    this.lastFrameAt = 0;
    this.coverCallback = null;
    this.resolvePlay = null;
    this.rejectPlay = null;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Creating the WebGL context and compiling during the first click caused
    // a long first frame. Warm it while the current page is idle instead.
    this.warmUp = () => {
      this.warmUpId = null;
      try { this.initialize(); } catch (error) { console.warn("水墨转场预热失败：", error); }
    };
    this.warmUpUsesIdle = "requestIdleCallback" in window;
    this.warmUpId = this.warmUpUsesIdle
      ? window.requestIdleCallback(this.warmUp, { timeout: 1800 })
      : window.setTimeout(this.warmUp, 600);
  }

  initialize() {
    if (this.renderer) return;
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      // This soft wash looks the same at a lower render resolution and avoids
      // competing with the page's other WebGL scenes during navigation.
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1) * 0.5);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.domElement.setAttribute("aria-hidden", "true");
      this.host.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3);
      this.camera.position.z = 1;
      this.material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uStage: { value: 0 }
        },
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      this.geometry = new THREE.PlaneGeometry(2, 2);
      this.scene.add(new THREE.Mesh(this.geometry, this.material));
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
      this.resize();
      this.renderer.compile(this.scene, this.camera);
    } catch (error) {
      this.disposeRenderer();
      throw error;
    }
  }

  resize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.host.clientWidth || innerWidth);
    const height = Math.max(1, this.host.clientHeight || innerHeight);
    this.renderer.setSize(width, height, false);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  play(onCovered = () => {}) {
    this.initialize();
    window.dispatchEvent(new CustomEvent("site:ink-transition", { detail: { active: true } }));
    this.root.classList.add("is-active");
    this.root.setAttribute("aria-hidden", "false");
    this.phase = this.motionQuery.matches ? "covered" : "cover";
    this.phaseElapsed = 0;
    this.elapsed = 0;
    this.lastFrameAt = 0;
    this.coverCallback = onCovered;
    this.material.uniforms.uProgress.value = 0;
    this.material.uniforms.uStage.value = this.motionQuery.matches ? 1 : 0;
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => {
      this.resolvePlay = resolve;
      this.rejectPlay = reject;
      this.renderer.setAnimationLoop(this.renderFrame);
    });
  }

  renderFrame = (timestamp = performance.now()) => {
    const frameAt = Number.isFinite(timestamp) ? timestamp : performance.now();
    const delta = this.lastFrameAt ? Math.max(0, (frameAt - this.lastFrameAt) / 1000) : 1 / 60;
    this.lastFrameAt = frameAt;

    if (this.phase === "covered") {
      // The previous frame was already opaque and composited; route work can
      // now run without exposing an unfinished frame or skipping the reveal.
      if (this.coverCallback) {
        try { this.coverCallback(); } catch (error) { this.fail(error); return; }
        this.coverCallback = null;
        this.phaseElapsed = 0;
      }
      if (this.motionQuery.matches) { this.finish(); return; }
      this.phaseElapsed += delta;
      if (this.phaseElapsed < this.holdDuration) {
        this.renderer.render(this.scene, this.camera);
        return;
      }
      this.phase = "reveal";
      this.phaseElapsed = 0;
      this.lastFrameAt = 0;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.phaseElapsed += delta;
    this.elapsed += delta;
    this.material.uniforms.uTime.value = this.elapsed;
    const duration = this.phase === "cover" ? this.coverDuration : this.revealDuration;
    const progress = Math.min(1, this.phaseElapsed / duration);
    this.material.uniforms.uProgress.value = progress;
    this.material.uniforms.uStage.value = this.phase === "cover" ? 0 : 2;
    if (this.phase === "cover" && progress >= 1) {
      this.material.uniforms.uStage.value = 1;
      this.phase = "covered";
    }
    this.renderer.render(this.scene, this.camera);
    if (this.phase === "reveal" && progress >= 1) this.finish();
  };

  fail(error) {
    const reject = this.rejectPlay;
    this.resolvePlay = null;
    this.rejectPlay = null;
    this.finish();
    reject?.(error);
  }

  finish() {
    this.renderer?.setAnimationLoop(null);
    this.phase = "idle";
    this.lastFrameAt = 0;
    this.root.classList.remove("is-active");
    this.root.setAttribute("aria-hidden", "true");
    window.dispatchEvent(new CustomEvent("site:ink-transition", { detail: { active: false } }));
    this.resolvePlay?.();
    this.resolvePlay = null;
    this.rejectPlay = null;
    this.coverCallback = null;
  }

  disposeRenderer() {
    this.resizeObserver?.disconnect();
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }

  destroy() {
    if (this.warmUpId != null) {
      if (this.warmUpUsesIdle) window.cancelIdleCallback(this.warmUpId);
      else window.clearTimeout(this.warmUpId);
    }
    this.finish();
    this.disposeRenderer();
  }
}
