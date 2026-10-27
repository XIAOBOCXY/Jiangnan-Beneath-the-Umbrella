const TARGET_FPS = 60;
const TRAIL_LIFETIME = 2.7;
const BASE_TRAIL_WIDTH = 0.004;
const PRESSED_TRAIL_PRESSURE = 0.02;
const ACTIVE_TRAIL_WIDTH = BASE_TRAIL_WIDTH + PRESSED_TRAIL_PRESSURE;

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// The backdrop follows Yakudoo's BufferSim structure: one smoothed UV segment
// enters a ping-pong texture every frame, then noise steers four directional
// diffusion samples before one transparent foreground trail is composited.
const TRAIL_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uPrevious;
uniform sampler2D uNoise;
uniform vec2 uResolution;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uSpeed;
uniform float uThickness;
uniform float uTime;
uniform float uWaterQuantity;
uniform float uWaterDiffusion;
uniform float uPersistence;
uniform float uGravity;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
  return length(p - (a + ab * h));
}
vec4 blurField(vec2 uv, vec2 spread, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 offset1 = vec2(0.013846153846) * direction;
  vec2 offset2 = vec2(0.032307692308) * direction;
  color += texture2D(uPrevious, uv) * 0.2270270270;
  color += texture2D(uPrevious, uv + offset1 * spread) * 0.3162162162;
  color += texture2D(uPrevious, uv - offset1 * spread) * 0.3162162162;
  color += texture2D(uPrevious, uv + offset2 * spread) * 0.0702702703;
  color += texture2D(uPrevious, uv - offset2 * spread) * 0.0702702703;
  return color;
}

void main() {
  vec4 noise1 = texture2D(uNoise, vUv * 4.0 + vec2(uTime * 0.1, 0.0));
  vec4 noise2 = texture2D(uNoise, vUv * 8.0 + vec2(0.0, uTime * 0.1) + noise1.rg * 0.5);
  vec4 noise3 = texture2D(uNoise, vUv * 16.0 + vec2(-uTime * 0.05, 0.0) + noise2.rg * 0.5);
  vec4 flowNoise = (noise1 + noise2 * 0.5 + noise3 * 0.25) / 1.75;
  float directionX = (-0.5 + flowNoise.g) * flowNoise.r * 10.0;
  float directionY = (-0.5 + flowNoise.b) * flowNoise.r * 10.0;

  vec4 oldInk = texture2D(uPrevious, vUv);
  float brightness = 1.0 - (oldInk.r + oldInk.g + oldInk.b) / 3.0;
  vec4 ink = oldInk * (1.0 - uWaterDiffusion);
  float quarterDiffusion = uWaterDiffusion * 0.25;
  // Match Yakudoo's gravity stretch in the feedback buffer. With screen-space
  // UVs this samples upward, so the retained pigment travels down the page.
  vec2 stretchedUv = vUv * vec2(1.0, 1.0 + uGravity);
  vec2 spread = vec2(uWaterQuantity * brightness);
  ink += blurField(stretchedUv, spread, vec2(directionX, directionY)) * quarterDiffusion;
  ink += blurField(stretchedUv, spread, vec2(directionY, directionX)) * quarterDiffusion;
  ink += blurField(stretchedUv, spread, vec2(-directionX, -directionY)) * quarterDiffusion;
  ink += blurField(stretchedUv, spread, vec2(-directionY, -directionX)) * quarterDiffusion;
  ink.rgb *= uPersistence;

  if (uSpeed > 0.000001) {
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    float thickness = clamp(uThickness + uSpeed * 0.3, 0.0001, 0.1);
    float distanceToLine = segmentDistance(vUv * aspect, uFrom * aspect, uTo * aspect);
    float line = 1.0 - smoothstep(thickness * 0.54, thickness, distanceToLine);
    // Fade the deposit as the smoothed pointer settles. This preserves the
    // source's motion-driven line while preventing a stationary endpoint from
    // accumulating into a dark round stamp.
    float deposition = line * smoothstep(0.000006, 0.00010, uSpeed);
    // Store one monochrome ink-density field. The reference cycles RGB hues;
    // this version keeps its transport and diffusion but renders as ink wash.
    vec3 pigment = vec3(1.0);
    ink.rgb = mix(ink.rgb, pigment, deposition);
  }
  gl_FragColor = vec4(ink.rgb, 0.0);
}`;

const BACKGROUND_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTrail;
void main() {
  vec4 trail = texture2D(uTrail, vUv);
  float density = clamp(max(max(trail.r, trail.g), trail.b), 0.0, 1.0);
  float core = smoothstep(0.06, 0.88, density);
  vec3 softInk = vec3(0.47, 0.48, 0.45); // smoke gray at the feathered edge
  vec3 deepInk = vec3(0.20, 0.22, 0.21); // charcoal center
  vec3 color = mix(softInk, deepInk, core);
  float opacity = pow(density, 0.74) * 0.78;
  // A single neutral ink layer sits over the independent paper/landscape layers.
  gl_FragColor = vec4(color, opacity);
}`;

/** Full-page, pointer-reactive ink wash; the canvas never captures input. */
export class InkWashBackground {
  constructor(canvas) {
    if (!canvas) return;
    this.canvas = canvas;
    this.pointerTarget = null;
    this.pointerCurrent = null;
    this.lastRawPointer = null;
    this.fallbackPoints = [];
    this.hasTrailPixels = false;
    this.startedAt = performance.now();
    this.lastFrameAt = 0;
    this.frameRequest = 0;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.colors = this.readThemeColors();

    try {
      this.gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: "low-power" });
      if (!this.gl) throw new Error("WebGL unavailable");
      this.initializeWebGL();
    } catch (error) {
      console.info("水墨背景切换为兼容绘制模式：", error.message);
      this.activateCanvasFallback();
    }

    this.onPointerMove = (event) => this.handlePointer(event, false);
    this.onPointerDown = (event) => this.handlePointer(event, true);
    this.onPointerLeave = () => this.resetPointer();
    this.onResize = () => this.resize();
    this.onVisibilityChange = () => {
      if (document.hidden) { cancelAnimationFrame(this.frameRequest); this.frameRequest = 0; }
      else { this.lastFrameAt = 0; this.requestFrame(); }
    };
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    window.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    try {
      this.resize();
    } catch (error) {
      console.info("水墨背景帧缓冲不可用，切换为兼容绘制模式：", error.message);
      this.activateCanvasFallback();
      this.resize();
    }
    this.requestFrame();
  }

  readThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      deepInk: this.parseColor(style.getPropertyValue("--color-ink-wash-deep").trim(), [52, 57, 54])
    };
  }

  parseColor(value, fallback) {
    const match = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) return fallback.map((channel) => channel / 255);
    const hex = match[1].length === 3 ? [...match[1]].map((part) => part + part).join("") : match[1];
    return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }

  isPointerExcluded(event) {
    const editor = document.querySelector(".canvas-container");
    if (editor?.classList.contains("is-brush-drawing") || editor?.classList.contains("is-pattern-moving")) return true;
    if (!(event.target instanceof Element)) return false;
    if (event.target.closest("#umbrellaCanvas, #threeHost canvas")) return false;
    return Boolean(event.target.closest(".app-header, .controls, .viewer-toolbar, .viewer-fold-control, .viewer-hint, .viewer-error, .canvas-status, .modal-overlay, button, input, select, textarea, [contenteditable='true']"));
  }

  handlePointer(event, pressed) {
    if (this.isPointerExcluded(event)) { this.resetPointer(); this.clearTrailHistory(); return; }
    if (pressed) {
      this.pointerTarget = null;
      this.pointerCurrent = null;
      this.lastRawPointer = null;
      this.lastSimulatedPointer = null;
    }

    const now = performance.now();
    const point = { x: event.clientX / Math.max(window.innerWidth, 1), y: 1 - event.clientY / Math.max(window.innerHeight, 1) };
    const previous = pressed ? null : this.lastRawPointer;
    // Keep the reference pen in its fully pressed/thick state without requiring
    // a mouse button; the background itself remains hover-driven.
    const width = ACTIVE_TRAIL_WIDTH;

    if (!this.gl && previous) this.appendFallbackSegment(previous, event, width, now);
    if (this.gl && previous && !this.pointerCurrent && !this.lastSimulatedPointer) {
      this.pointerCurrent = { x: previous.x, y: previous.y, width: previous.width };
      this.lastSimulatedPointer = { x: previous.x, y: previous.y };
    }
    this.pointerTarget = { ...point, width };
    this.lastRawPointer = { clientX: event.clientX, clientY: event.clientY, x: point.x, y: point.y, width, time: now };
    if (this.reducedMotion) this.draw(now);
  }

  appendFallbackSegment(previous, event, width, now) {
    const dx = event.clientX - previous.clientX;
    const dy = event.clientY - previous.clientY;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.fallbackPoints.push({
        x: (previous.clientX + dx * t) / Math.max(window.innerWidth, 1),
        y: (previous.clientY + dy * t) / Math.max(window.innerHeight, 1),
        width: previous.width + (width - previous.width) * t,
        time: now
      });
    }
    this.hasTrailPixels = true;
    this.fallbackPoints = this.fallbackPoints.slice(-900);
  }

  resetPointer() {
    this.pointerTarget = null;
    this.pointerCurrent = null;
    this.lastRawPointer = null;
    this.lastSimulatedPointer = null;
  }

  clearTrailHistory() {
    if (!this.hasTrailPixels && this.fallbackPoints.length === 0) return;
    this.fallbackPoints.length = 0;
    this.hasTrailPixels = false;
    if (!this.gl || !this.trailTargets) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    this.trailTargets.forEach((target) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.trailIndex = 0;
  }

  setSceneMode(mode) {
    document.documentElement.dataset.inkScene = mode === "viewing" ? "viewing" : "drawing";
  }

  createProgram(fragmentSource) {
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Unable to link ink wash shader");
    return program;
  }

  initializeWebGL() {
    const gl = this.gl;
    this.trailProgram = this.createProgram(TRAIL_SHADER);
    this.backgroundProgram = this.createProgram(BACKGROUND_SHADER);
    this.noiseTexture = this.createNoiseTexture();
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.trailUniforms = this.getUniforms(this.trailProgram, ["uPrevious", "uNoise", "uResolution", "uFrom", "uTo", "uSpeed", "uThickness", "uTime", "uWaterQuantity", "uWaterDiffusion", "uPersistence", "uGravity"]);
    this.backgroundUniforms = this.getUniforms(this.backgroundProgram, ["uTrail"]);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  createNoiseTexture() {
    const gl = this.gl;
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    let state = 0x6d2b79f5;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[offset] = state & 255;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[offset + 1] = state & 255;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[offset + 2] = state & 255;
      pixels[offset + 3] = 255;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return texture;
  }

  getUniforms(program, names) {
    const gl = this.gl;
    const result = { program, position: gl.getAttribLocation(program, "aPosition") };
    for (const name of names) result[name] = gl.getUniformLocation(program, name);
    return result;
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
    if (this.gl) {
      const replacement = this.canvas.cloneNode(false);
      this.canvas.replaceWith(replacement);
      this.canvas = replacement;
    }
    this.gl = null;
    this.context = this.canvas.getContext("2d", { alpha: true });
  }

  createTrailTargets() {
    const gl = this.gl;
    if (!gl) return;
    this.deleteTrailTargets();
    this.trailTargets = [0, 1].map(() => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Ink trail framebuffer is incomplete");
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { texture, framebuffer };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.trailIndex = 0;
  }

  deleteTrailTargets() {
    if (!this.gl || !this.trailTargets) return;
    for (const target of this.trailTargets) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.framebuffer);
    }
    this.trailTargets = null;
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.35) * 0.62;
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
      this.createTrailTargets();
    }
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
    const dt = this.lastFrameAt ? Math.min(0.04, Math.max(0, (now - this.lastFrameAt) / 1000)) : 1 / TARGET_FPS;
    this.lastFrameAt = now;
    const elapsed = (now - this.startedAt) / 1000;
    if (this.gl) this.drawWebGL(elapsed, dt, now);
    else this.drawCanvasFallback(elapsed, now);
  }

  bindQuad(programInfo) {
    const gl = this.gl;
    gl.useProgram(programInfo.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(programInfo.position);
    gl.vertexAttribPointer(programInfo.position, 2, gl.FLOAT, false, 0, 0);
  }

  drawWebGL(time, dt, now) {
    const gl = this.gl;
    if (!this.trailTargets) this.createTrailTargets();
    if (!this.trailTargets) return;

    const target = this.pointerTarget;
    if (target) {
      if (!this.pointerCurrent) this.pointerCurrent = { ...target };
      else {
        const follow = Math.min(1, dt * 5);
        this.pointerCurrent.x += (target.x - this.pointerCurrent.x) * follow;
        this.pointerCurrent.y += (target.y - this.pointerCurrent.y) * follow;
        this.pointerCurrent.width += (target.width - this.pointerCurrent.width) * follow;
      }
    }
    const to = this.pointerCurrent ?? target ?? { x: 0.5, y: 0.5, width: BASE_TRAIL_WIDTH };
    const from = this.lastSimulatedPointer ?? to;
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    const movement = Math.hypot((to.x - from.x) * aspect, to.y - from.y);
    // Inject only while the smoothed cursor advances. This mirrors the source
    // pen's speed gate and stops a stationary endpoint from being stamped each
    // frame into a dark circular blot.
    const activeSpeed = target && movement > 0.000008 ? Math.min(0.0035, movement) : 0;
    const nextIndex = 1 - this.trailIndex;
    const previousTarget = this.trailTargets[this.trailIndex];
    const nextTarget = this.trailTargets[nextIndex];

    gl.bindFramebuffer(gl.FRAMEBUFFER, nextTarget.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const trail = this.trailUniforms;
    this.bindQuad(trail);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, previousTarget.texture);
    gl.uniform1i(trail.uPrevious, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
    gl.uniform1i(trail.uNoise, 1);
    gl.uniform2f(trail.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(trail.uFrom, from.x, from.y);
    gl.uniform2f(trail.uTo, to.x, to.y);
    gl.uniform1f(trail.uSpeed, activeSpeed);
    gl.uniform1f(trail.uThickness, to.width ?? BASE_TRAIL_WIDTH);
    gl.uniform1f(trail.uTime, time);
    gl.uniform1f(trail.uWaterQuantity, 0.3);
    gl.uniform1f(trail.uWaterDiffusion, 0.1);
    gl.uniform1f(trail.uPersistence, Math.pow(0.98, dt * 10));
    gl.uniform1f(trail.uGravity, 0.5 * dt);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (activeSpeed > 0) this.hasTrailPixels = true;
    this.trailIndex = nextIndex;
    if (target) this.lastSimulatedPointer = { x: to.x, y: to.y };
    else this.lastSimulatedPointer = null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const background = this.backgroundUniforms;
    this.bindQuad(background);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTargets[this.trailIndex].texture);
    gl.uniform1i(background.uTrail, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawCanvasFallback(_time, now) {
    const ctx = this.context;
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    const ink = this.colors.deepInk.map((channel) => Math.round(channel * 255));
    this.fallbackPoints = this.fallbackPoints.filter((point) => now - point.time < TRAIL_LIFETIME * 1000);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < this.fallbackPoints.length; i++) {
      const a = this.fallbackPoints[i - 1];
      const b = this.fallbackPoints[i];
      const age = (now - b.time) / 1000;
      ctx.strokeStyle = `rgba(${ink.join(",")},${Math.exp(-age * 0.58) * 0.76})`;
      ctx.lineWidth = Math.max(1.2, Math.min(width, height) * b.width * 2);
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
      ctx.stroke();
    }
  }
}
