import * as THREE from "three";

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

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
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * amplitude;
      p = p * 2.01 + vec2(13.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }
  void main() {
    float p = clamp(uProgress, 0.0, 1.0);
    float cover = smoothstep(0.0, 0.40, p);
    float reveal = smoothstep(0.43, 1.0, p);
    float boundary = uStage < 0.5
      ? mix(1.16, -0.16, cover)
      : mix(1.16, -0.16, reveal);
    float turbulence = fbm(vec2(vUv.y * 5.2, vUv.x * 2.0) + vec2(uTime * 0.035, -uTime * 0.02));
    float undulation = (turbulence - 0.5) * 0.17 + sin(vUv.y * 24.0 + uTime * 0.6) * 0.013;
    float edge = boundary + undulation;
    float coverage = uStage > 0.5 && uStage < 1.5
      ? 1.0
      : uStage < 0.5
        ? smoothstep(edge - 0.018, edge + 0.018, vUv.x)
        : 1.0 - smoothstep(edge - 0.018, edge + 0.018, vUv.x);

    float edgeDistance = abs(vUv.x - edge);
    float wetRim = exp(-edgeDistance * 34.0) * smoothstep(0.1, 0.8, turbulence);
    float feather = exp(-edgeDistance * 10.0) * (1.0 - smoothstep(0.0, 0.25, edgeDistance));
    vec3 ink = vec3(0.004, 0.005, 0.004);
    float alpha = coverage;
    gl_FragColor = vec4(ink, alpha);
  }
`;

/** One-shot, shader-based liquid ink wipe. No 2D canvas or SVG mask is used. */
export class InkTransition {
  constructor(host) {
    if (!host) throw new Error("Missing transition host");
    this.host = host;
    this.root = host.closest("#inkTransition") || host;
    this.renderer = null;
    this.elapsed = 0;
    // One second felt sluggish; keep the right-to-left ink wipe to half that.
    this.duration = 0.5;
    this.covered = false;
    this.coverCallback = null;
    this.resolvePlay = null;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.lastFrameAt = 0;
  }

  initialize() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1));
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
    this.root.classList.add("is-active");
    this.root.setAttribute("aria-hidden", "false");
    this.elapsed = 0;
    this.covered = false;
    this.coverCallback = onCovered;
    this.lastFrameAt = 0;
    if (this.motionQuery.matches) {
      this.material.uniforms.uStage.value = 1;
      this.material.uniforms.uProgress.value = 0.415;
      this.renderer.render(this.scene, this.camera);
      this.covered = true;
      this.coverCallback?.();
      return new Promise((resolve) => {
        this.resolvePlay = resolve;
        window.setTimeout(() => this.finish(), 45);
      });
    }
    this.renderer.setAnimationLoop(this.renderFrame);
    return new Promise((resolve) => { this.resolvePlay = resolve; });
  }

  renderFrame = (timestamp = performance.now()) => {
    const frameAt = Number.isFinite(timestamp) ? timestamp : performance.now();
    const delta = Math.min(this.lastFrameAt ? Math.max(0, (frameAt - this.lastFrameAt) / 1000) : 0.016, 0.05);
    this.lastFrameAt = frameAt;
    this.elapsed += delta;
    const progress = Math.min(1, this.elapsed / this.duration);
    const stage = progress < 0.40 ? 0 : progress < 0.43 ? 1 : 2;
    this.material.uniforms.uProgress.value = progress;
    this.material.uniforms.uStage.value = stage;
    this.material.uniforms.uTime.value = this.elapsed;
    if (!this.covered && progress >= 0.415) {
      this.covered = true;
      this.coverCallback?.();
    }
    this.renderer.render(this.scene, this.camera);
    if (progress >= 1) this.finish();
  };

  finish() {
    this.renderer?.setAnimationLoop(null);
    this.lastFrameAt = 0;
    this.root.classList.remove("is-active");
    this.root.setAttribute("aria-hidden", "true");
    this.resolvePlay?.();
    this.resolvePlay = null;
    this.coverCallback = null;
  }

  destroy() {
    this.finish();
    this.resizeObserver?.disconnect();
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }
}

