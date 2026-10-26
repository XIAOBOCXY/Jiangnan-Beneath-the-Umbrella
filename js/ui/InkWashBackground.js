const MARK_LIMIT = 24;
const MARK_LIFETIME = 2.2;
const TARGET_FPS = 30;
const MARK_SPACING = 8;

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform int uMarkCount;
uniform vec4 uMarks[24];
uniform float uMarkAges[24];
uniform vec3 uInkColor;
uniform vec3 uLakeColor;
uniform vec3 uDeepInk;
uniform float uSceneIntensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  value += noise(p) * amplitude; p *= 2.03; amplitude *= 0.5;
  value += noise(p) * amplitude; p *= 2.01; amplitude *= 0.5;
  value += noise(p) * amplitude; p *= 2.02; amplitude *= 0.5;
  value += noise(p) * amplitude; p *= 2.04; amplitude *= 0.5;
  value += noise(p) * amplitude;
  return value / 0.96875;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float intensity = uSceneIntensity;
  float t = uTime * mix(0.008, 0.019, intensity);

  // Distant lake mist drifts almost imperceptibly behind the editor.
  vec2 drift = vec2(t * 0.52, -t * 0.31);
  float broad = fbm(p * 1.34 + drift);
  float detail = fbm(p * 3.45 - drift * 1.18);
  vec2 curl = vec2(
    fbm(p * 2.25 + drift + vec2(7.2, 1.3)),
    fbm(p * 2.25 - drift + vec2(2.1, 9.4))
  ) - 0.5;
  vec2 q = p + curl * mix(0.045, 0.082, intensity);

  // Two soft ridges and a broken waterline suggest a misty West Lake horizon.
  float farRidge = 0.035 + (noise(vec2(p.x * 1.35 + drift.x * 0.12, 1.7)) - 0.5) * 0.17;
  float middleRidge = -0.12 + (noise(vec2(p.x * 1.8 - drift.x * 0.09, 3.9)) - 0.5) * 0.14;
  float nearRidge = -0.28 + (noise(vec2(p.x * 2.15 - drift.x * 0.08, 5.3)) - 0.5) * 0.12;
  float farDistance = (p.y - farRidge) * 6.2;
  float middleDistance = (p.y - middleRidge) * 7.0;
  float nearDistance = (p.y - nearRidge) * 7.4;
  float farLand = exp(-farDistance * farDistance);
  float middleLand = exp(-middleDistance * middleDistance);
  float nearLand = exp(-nearDistance * nearDistance);
  float vaporNoise = fbm(vec2(p.x * 2.2, p.y * 3.1) + drift * 0.22);
  float vaporBand = exp(-pow(abs(p.y - farRidge - 0.08) * 5.5, 2.0)) * smoothstep(0.39, 0.72, vaporNoise);
  float waterCenter = -0.37 + (noise(vec2(p.x * 1.65 + drift.x * 0.08, 6.1)) - 0.5) * 0.045;
  float waterDistance = (p.y - waterCenter) * 8.0;
  float waterBand = exp(-waterDistance * waterDistance);
  float waterRipple = 0.5 + 0.5 * sin(p.x * 31.0 + p.y * 5.0 + t * 2.1 + detail * 2.0);
  float waterLines = smoothstep(0.91, 0.99, waterRipple) * waterBand;

  float localInk = 0.0;
  vec2 mouseForce = vec2(0.0);
  for (int i = 0; i < 24; i++) {
    if (i < uMarkCount) {
      vec4 mark = uMarks[i];
      float age = uMarkAges[i];
      vec2 center = (mark.xy - 0.5) * vec2(aspect, 1.0);
      vec2 delta = q - center;
      float distanceToMark = length(delta);
      // A soft core feeds an asymmetric tail; it never blooms into a single drop.
      float radius = 0.026 + (1.0 - exp(-age * 1.55)) * 0.014;
      float decay = exp(-age * 1.18);
      vec2 velocity = mark.zw * vec2(aspect, 1.0);
      float speed = length(velocity);
      vec2 direction = speed > 0.0005 ? velocity / speed : vec2(1.0, 0.0);
      vec2 normal = vec2(-direction.y, direction.x);
      float tailLength = radius * (1.2 + min(speed * 25.0, 1.55));
      float angle = atan(delta.y, delta.x);
      float edgeGrain = 0.5 + 0.25 * sin(angle * 3.0 + age * 2.7 + mark.x * 9.0)
        + 0.25 * sin(angle * 5.0 - age * 1.9 + mark.y * 7.0);
      float headRadius = radius * (0.82 + edgeGrain * 0.34);
      float head = exp(-pow(distanceToMark / headRadius, 2.05) * 1.25);
      float behind = -dot(delta, direction);
      float lateral = dot(delta, normal);
      float tailProgress = clamp(behind / max(tailLength, 0.001), 0.0, 1.0);
      float tailWidth = radius * mix(0.78, 0.34, tailProgress);
      float tail = exp(-pow(max(behind, 0.0) / max(tailLength, 0.001) * 1.65, 2.0)
        - pow(lateral / max(tailWidth, 0.001), 2.0) * 1.2);
      tail *= step(0.0, behind) * (1.0 - smoothstep(tailLength * 0.58, tailLength, behind));
      tail *= smoothstep(0.0008, 0.008, speed);
      float plume = clamp(head + tail * 0.58, 0.0, 1.0);
      float influence = plume * decay;
      vec2 radial = delta / max(distanceToMark, 0.001);

      mouseForce += (radial * 0.012 + normal * min(speed * 0.42, 0.018)) * influence * intensity;
      localInk += influence * (0.62 + min(speed * 1.5, 0.18));
    }
  }

  q += mouseForce;
  float wash = broad * 0.62 + fbm(q * 2.1 + drift * 0.36) * 0.25 + fbm(q * 3.7 - drift) * 0.13;
  float cloud = smoothstep(0.56, 0.76, wash) * (1.0 - smoothstep(0.82, 0.96, wash));
  float haze = farLand * 0.19 + middleLand * 0.14 + nearLand * 0.105
    + vaporBand * 0.15 + waterBand * (0.045 + waterRipple * 0.04 + waterLines * 0.045);
  float alpha = (cloud * 0.105 + haze) * intensity + localInk * 0.44;
  alpha = clamp(alpha, 0.0, 0.28);

  float coolShift = clamp(detail * 0.34 + haze * 0.3, 0.0, 0.38);
  vec3 ambientInk = mix(uInkColor, uLakeColor, coolShift);
  vec3 ink = mix(ambientInk, uDeepInk, smoothstep(0.08, 0.42, localInk) * 0.78);
  gl_FragColor = vec4(ink, alpha);
}`;

/**
 * A quiet, independent page background. It never captures pointer events, so
 * drawing, sliders, and Three.js controls continue to receive their input.
 */
export class InkWashBackground {
  constructor(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.marks = [];
    this.lastPointer = null;
    this.lastMarkAt = 0;
    this.pointerFadeTimer = 0;
    this.sceneIntensity = 0.4;
    this.targetSceneIntensity = 0.4;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.frameRequest = 0;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.colors = this.readThemeColors();

    try {
      this.gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        depth: false,
        premultipliedAlpha: false,
        powerPreference: "low-power"
      });
      if (!this.gl) throw new Error("WebGL unavailable");
      this.initializeWebGL();
    } catch (error) {
      console.info("水墨背景切换为兼容绘制模式：", error.message);
      this.activateCanvasFallback();
    }

    this.onPointerMove = (event) => {
      this.updatePointerHalo(event);
      this.addMark(event, false);
    };
    this.onPointerDown = (event) => {
      this.updatePointerHalo(event);
      this.addMark(event, true);
    };
    this.onPointerLeave = () => {
      window.clearTimeout(this.pointerFadeTimer);
      this.pointerFadeTimer = window.setTimeout(() => document.documentElement.style.setProperty("--ink-pointer-alpha", "0"), 1000);
      this.lastPointer = null;
    };
    this.onResize = () => this.resize();
    this.onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = 0;
      } else {
        this.lastFrameAt = 0;
        this.requestFrame();
      }
    };
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    window.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resize();
    this.requestFrame();
  }

  readThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      ink: this.parseColor(style.getPropertyValue("--color-ink-wash").trim(), [76, 85, 80]),
      lake: this.parseColor(style.getPropertyValue("--color-ink-wash-water").trim(), [128, 148, 141]),
      deepInk: this.parseColor(style.getPropertyValue("--color-ink-wash-deep").trim(), [52, 57, 54])
    };
  }

  parseColor(value, fallback) {
    const match = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) return fallback.map((channel) => channel / 255);
    const hex = match[1].length === 3 ? [...match[1]].map((n) => n + n).join("") : match[1];
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }

  updatePointerHalo(event) {
    const root = document.documentElement;
    root.style.setProperty("--ink-pointer-x", `${event.clientX / Math.max(window.innerWidth, 1) * 100}%`);
    root.style.setProperty("--ink-pointer-y", `${event.clientY / Math.max(window.innerHeight, 1) * 100}%`);
    root.style.setProperty("--ink-pointer-alpha", "1");
    window.clearTimeout(this.pointerFadeTimer);
    this.pointerFadeTimer = window.setTimeout(() => root.style.setProperty("--ink-pointer-alpha", "0"), 1800);
  }

  setSceneMode(mode) {
    this.targetSceneIntensity = mode === "viewing" ? 0.78 : 0.6;
    document.documentElement.dataset.inkScene = mode === "viewing" ? "viewing" : "drawing";
    if (this.reducedMotion) {
      this.sceneIntensity = this.targetSceneIntensity;
      this.draw(0);
    }
  }

  initializeWebGL() {
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Unable to link ink wash shader");
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.buffer = buffer;
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      resolution: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
      markCount: gl.getUniformLocation(program, "uMarkCount"),
      marks: gl.getUniformLocation(program, "uMarks[0]"),
      markAges: gl.getUniformLocation(program, "uMarkAges[0]"),
      inkColor: gl.getUniformLocation(program, "uInkColor"),
      lakeColor: gl.getUniformLocation(program, "uLakeColor"),
      deepInk: gl.getUniformLocation(program, "uDeepInk"),
      sceneIntensity: gl.getUniformLocation(program, "uSceneIntensity")
    };

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) || "Unable to compile ink wash shader";
      this.gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  activateCanvasFallback() {
    // A canvas that already acquired a WebGL context cannot switch to 2D.
    if (this.gl) {
      const replacement = this.canvas.cloneNode(false);
      this.canvas.replaceWith(replacement);
      this.canvas = replacement;
    }
    this.gl = null;
    this.context = this.canvas.getContext("2d", { alpha: true });
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.35) * 0.62;
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gl) this.gl.viewport(0, 0, width, height);
  }

  addMark(event, pressed) {
    if (event.pointerType === "mouse" && event.buttons && !pressed) {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }
    const now = performance.now();
    const x = event.clientX / Math.max(window.innerWidth, 1);
    const y = 1 - event.clientY / Math.max(window.innerHeight, 1);
    const previous = pressed ? null : this.lastPointer;
    const distance = previous
      ? Math.hypot(event.clientX - previous.x, event.clientY - previous.y)
      : Number.POSITIVE_INFINITY;
    if (!pressed && now - this.lastMarkAt < 16 && distance < 4) {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    const deltaX = previous ? event.clientX - previous.x : 0;
    const deltaY = previous ? previous.y - event.clientY : 0;
    const velocityX = deltaX / Math.max(window.innerWidth, 1);
    const velocityY = deltaY / Math.max(window.innerHeight, 1);
    // Interpolate faster than the plume radius so quick pointer events overlap.
    const steps = previous ? Math.min(MARK_LIMIT, Math.max(1, Math.ceil(distance / MARK_SPACING))) : 1;
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      this.marks.unshift({
        x: previous ? (previous.x + deltaX * progress) / Math.max(window.innerWidth, 1) : x,
        y: previous ? 1 - (previous.y - deltaY * progress) / Math.max(window.innerHeight, 1) : y,
        vx: velocityX,
        vy: velocityY,
        age: 0
      });
    }
    this.marks.length = Math.min(this.marks.length, MARK_LIMIT);
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.lastMarkAt = now;
    if (this.reducedMotion) this.draw(0);
  }

  requestFrame() {
    if (this.frameRequest || document.hidden) return;
    this.frameRequest = requestAnimationFrame((time) => {
      this.frameRequest = 0;
      this.draw(time);
      if (!this.reducedMotion) this.requestFrame();
    });
  }

  draw(now) {
    const frameInterval = 1000 / TARGET_FPS;
    if (!this.reducedMotion && this.lastFrameAt && now - this.lastFrameAt < frameInterval) return;
    const elapsed = this.reducedMotion ? 0 : (now - this.startedAt) / 1000;
    const ageStep = this.lastFrameAt ? Math.max(0, (now - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = now;
    this.marks.forEach((mark) => { mark.age += ageStep; });
    this.marks = this.marks.filter((mark) => mark.age < MARK_LIFETIME);
    this.sceneIntensity += (this.targetSceneIntensity - this.sceneIntensity) * 0.045;
    if (this.gl) this.drawWebGL(elapsed);
    else this.drawCanvasFallback(elapsed);
  }

  drawWebGL(time) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform1f(this.uniforms.sceneIntensity, this.sceneIntensity);
    gl.uniform1i(this.uniforms.markCount, this.marks.length);
    gl.uniform3fv(this.uniforms.inkColor, this.colors.ink);
    gl.uniform3fv(this.uniforms.lakeColor, this.colors.lake);
    gl.uniform3fv(this.uniforms.deepInk, this.colors.deepInk);

    const marks = new Float32Array(MARK_LIMIT * 4);
    const ages = new Float32Array(MARK_LIMIT);
    this.marks.forEach((mark, index) => {
      const offset = index * 4;
      marks[offset] = mark.x;
      marks[offset + 1] = mark.y;
      marks[offset + 2] = mark.vx;
      marks[offset + 3] = mark.vy;
      ages[index] = mark.age;
    });
    gl.uniform4fv(this.uniforms.marks, marks);
    gl.uniform1fv(this.uniforms.markAges, ages);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawCanvasFallback(time) {
    const ctx = this.context;
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    const colors = this.colors;
    const rgb = (color) => color.map((channel) => Math.round(channel * 255)).join(",");
    ctx.save();
    ctx.globalAlpha = this.sceneIntensity;
    ctx.filter = `blur(${Math.max(12, width * 0.009)}px)`;
    for (let i = 0; i < 4; i++) {
      const phase = time * 0.035 + i * 1.71;
      const x = (0.18 + ((i * 0.29) % 0.7) + Math.sin(phase) * 0.06) * width;
      const y = (0.2 + ((i * 0.37) % 0.65) + Math.cos(phase * 0.8) * 0.05) * height;
      const radius = Math.min(width, height) * (0.1 + (i % 2) * 0.035);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${rgb(colors.ink)},0.06)`);
      gradient.addColorStop(0.54, `rgba(${rgb(colors.lake)},0.035)`);
      gradient.addColorStop(1, `rgba(${rgb(colors.ink)},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalAlpha = 0.62 + this.sceneIntensity * 0.38;
    for (const mark of this.marks) {
      const x = mark.x * width;
      const y = (1 - mark.y) * height;
      const radius = Math.min(width, height) * (0.026 + (1 - Math.exp(-mark.age * 1.55)) * 0.014);
      const alpha = Math.exp(-mark.age * 1.1) * 0.34;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${rgb(colors.ink)},${alpha})`);
      gradient.addColorStop(0.58, `rgba(${rgb(colors.lake)},${alpha * 0.5})`);
      gradient.addColorStop(1, `rgba(${rgb(colors.ink)},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }
}
