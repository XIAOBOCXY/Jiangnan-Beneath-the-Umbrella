import * as THREE from "three";

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HOME_DROP_HISTORY = 160;
const HOME_DROP_SHADER_SAMPLES = 48;

const DISPLAY_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uInkField;
  uniform vec2 uResolution;
  uniform vec2 uParallax;
  uniform float uTime;
  uniform vec4 uDropData[48];
  uniform vec2 uLivePointer;
  uniform vec2 uPointerVelocity;
  uniform float uLivePointerStrength;
  uniform float uLivePointerAge;
  uniform float uSceneMode;
  uniform vec3 uPaperColor;
  uniform vec3 uMistColor;
  uniform vec3 uLakeColor;
  uniform vec3 uInkColor;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
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
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime;
    vec2 uv = vUv + uParallax * 0.0018;
    vec2 p = vec2(uv.x * aspect, uv.y);

    float modeHome = 1.0 - step(0.5, uSceneMode);
    float modeStudio = step(0.5, uSceneMode) * (1.0 - step(1.5, uSceneMode));
    float modeHeritage = step(1.5, uSceneMode) * (1.0 - step(2.5, uSceneMode));

    vec2 liveRadial = (uv - uLivePointer) * vec2(aspect, 1.0);
    float liveDistance = length(liveRadial);
    float liveLife = uLivePointerStrength * exp(-uLivePointerAge * 2.7)
      * (1.0 - smoothstep(0.62, 0.9, uLivePointerAge));
    float liveEdgeNoise = fbm(p * vec2(18.0, 15.0) + vec2(t * 0.16, -t * 0.12)) - 0.5;
    // Keep a visible disturbance under the pointer on the very first frame;
    // the expanding lip then follows it without waiting for a click sample.
    float liveRadius = 0.018 + uLivePointerAge * 0.08 + liveEdgeNoise * 0.004;
    float liveWave = exp(-pow((liveDistance - liveRadius) * 30.0, 2.0)) * liveLife;
    float liveCore = exp(-liveDistance * 27.0) * exp(-uLivePointerAge * 7.0) * uLivePointerStrength;
    vec2 pointerTangent = normalize(uPointerVelocity + vec2(0.0001));
    vec2 pointerNormal = vec2(-pointerTangent.y, pointerTangent.x);
    float localSwirl = exp(-liveDistance * 24.0) * liveLife;
    uv += (pointerNormal * liveDistance + pointerTangent * liveCore) * localSwirl * 0.01 * (1.0 - modeStudio);
    // Studio background is an existing pigment field: the pointer bends its
    // flow briefly but never injects dye or leaves a cursor trail.
    float studioTouch = exp(-liveDistance * 12.0) * liveLife * modeStudio;
    uv += (pointerNormal * exp(-liveDistance * 7.5) + pointerTangent * liveCore * 0.7)
      * studioTouch * 0.024;
    p = vec2(uv.x * aspect, uv.y);

    vec2 cloudA = p * vec2(1.55, 2.7) + vec2(-t * 0.018, t * 0.006);
    vec2 cloudWarp = vec2(
      fbm(p * vec2(2.1, 2.8) + vec2(t * 0.008, -t * 0.004)),
      fbm(p * vec2(2.5, 3.2) + vec2(-t * 0.006, t * 0.005))
    );
    float cloudNoise = fbm(cloudA + (cloudWarp - vec2(0.5)) * 0.74);
    float distantFog = smoothstep(0.42, 0.7, cloudNoise)
      * smoothstep(0.26, 0.48, uv.y) * (1.0 - smoothstep(0.72, 0.92, uv.y));
    float nearNoise = fbm(p * vec2(2.2, 3.7) + cloudWarp * 0.52 + vec2(t * 0.013, -t * 0.007));
    float nearFog = smoothstep(0.40, 0.71, nearNoise)
      * exp(-pow((uv.y - (0.46 + (nearNoise - 0.5) * 0.22)) * 4.8, 2.0));
    float lowMistNoise = fbm(p * vec2(1.8, 4.7) + cloudWarp * 0.34 + vec2(-t * 0.009, t * 0.005));
    float lowMist = smoothstep(0.42, 0.74, lowMistNoise)
      * exp(-pow((uv.y - (0.29 + (lowMistNoise - 0.5) * 0.17)) * 5.8, 2.0));

    vec2 rippleOffset = vec2(0.0);
    float rippleSheen = 0.0;
    float dropImprint = 0.0;
    float rippleWeight = 0.0;
    for (int i = 0; i < 48; i++) {
      vec2 dropPoint = uDropData[i].xy;
      vec2 radial = (uv - dropPoint) * vec2(aspect, 1.0);
      float distanceToDrop = length(radial);
      float age = uDropData[i].z;
      float life = exp(-age * 0.74) * (1.0 - smoothstep(1.08, 1.68, age));
      float strength = uDropData[i].w * life;
      float edgeNoise = hash(dropPoint * vec2(91.7, 137.1) + floor(age * 6.0)) - 0.5;
      float expandingRadius = 0.009 + age * 0.052 + edgeNoise * 0.0025;
      float softWave = exp(-pow((distanceToDrop - expandingRadius) * 17.0, 2.0));
      float centerTouch = exp(-distanceToDrop * 30.0) * exp(-age * 7.2);
      float phase = distanceToDrop * 68.0 - age * 7.2 + edgeNoise * 1.8;
      vec2 direction = radial / max(distanceToDrop, 0.0001);
      // Keep the path as overlapping thin wakes: use a local maximum for the
      // visible wave and normalize displacement when several samples overlap.
      float wave = sin(phase) * softWave * strength;
      rippleOffset += direction * (wave + centerTouch * strength * 0.16) * 0.16;
      rippleWeight += softWave * strength;
      // Accumulate neighboring samples into one continuous wake instead of
      // taking only the strongest individual ring (which left gaps on fast moves).
      rippleSheen += softWave * strength * 0.14 + centerTouch * uDropData[i].w * 0.08;
      dropImprint += softWave * strength * 0.025 + centerTouch * uDropData[i].w * 0.015;
    }
    rippleOffset /= max(1.0, rippleWeight * 1.25);
    float homePointerWater = liveWave * 0.96 + liveCore * 0.58;
    vec2 liveDirection = normalize(liveRadial + vec2(0.0001));
    vec2 liveDisplacement = liveDirection * (liveWave * 0.052 + liveCore * 0.038)
      + pointerTangent * liveCore * 0.01;
    vec2 disturbedUv = uv + rippleOffset + liveDisplacement;
    vec2 disturbedP = vec2(disturbedUv.x * aspect, disturbedUv.y);
    vec2 waterUv = disturbedP * vec2(2.6, 8.2) + vec2(t * 0.014, -t * 0.0035);
    float waterNoise = fbm(waterUv + vec2(0.0, fbm(waterUv * 0.47) * 0.34));
    float waterMask = 1.0 - smoothstep(0.32, 0.64, disturbedUv.y);
    float waterSurface = smoothstep(0.30, 0.76, waterNoise) * waterMask;
    float reflection = smoothstep(0.71, 0.98, sin(disturbedUv.y * 54.0 + waterNoise * 5.7 + sin(disturbedUv.x * 9.0 + t * 0.065) * 0.72)) * waterMask;
    // Keep path ripples visible as the cursor crosses the whole scene. Over
    // distant hills and mist they read as a weaker refractive wake; across the
    // lake they retain their full strength.
    rippleSheen = clamp(rippleSheen * mix(0.34, 1.0, waterMask) + homePointerWater, 0.0, 1.0);
    float dropWake = clamp(rippleSheen * 0.72, 0.0, 0.72);
    dropImprint = clamp(dropImprint, 0.0, 1.0);
    waterSurface = clamp(waterSurface + dropWake * 0.58, 0.0, 1.0);
    reflection = clamp(reflection + dropWake * 0.5, 0.0, 1.0);

    vec3 atmosphereColor = mix(uLakeColor, uMistColor, clamp(reflection * 0.62, 0.0, 1.0));
    atmosphereColor = mix(atmosphereColor, uLakeColor, dropWake * 0.52);
    atmosphereColor = mix(atmosphereColor, uPaperColor, distantFog * 0.72 + nearFog * 0.55 + lowMist * 0.28);
    vec3 dropColor = mix(uLakeColor, uInkColor, 0.14);
    atmosphereColor = mix(atmosphereColor, dropColor, dropImprint * 0.44 * modeHome);
    float fogAlpha = distantFog * 0.34 + nearFog * 0.28 + lowMist * 0.2;
    float waterAlpha = waterSurface * 0.19 + reflection * 0.16 + dropWake * 0.46;
    float atmosphereAlpha = (fogAlpha + waterAlpha) * modeHome
      + (fogAlpha * 0.12 + waterAlpha * 0.06) * modeStudio;
    atmosphereAlpha += dropImprint * 0.16 * modeHome;

    vec2 studioFlow = vec2(
      fbm(p * vec2(0.78, 1.48) + vec2(-t * 0.062, t * 0.036)),
      fbm(p * vec2(1.08, 1.82) + vec2(t * 0.052, -t * 0.046))
    );
    vec2 studioWarp = (studioFlow - vec2(0.5)) * 0.72;
    float studioCloudBase = fbm(p * vec2(0.78, 1.42) + studioWarp + vec2(-t * 0.088, t * 0.061));
    float studioCloudDetail = fbm(p * vec2(1.28, 2.08) + studioWarp * 0.72 + vec2(t * 0.052, -t * 0.043));
    // Blend broad cloud forms with a small amount of detail so the wash reads
    // as one continuous moving ink field instead of separated water spots.
    float studioCloud = mix(studioCloudBase, studioCloudDetail, 0.16);
    // Keep the pigment forms broad and visibly connected on the warm paper.
    float studioInkMass = smoothstep(0.31, 0.55, studioCloud)
      * (0.78 + smoothstep(0.28, 0.72, fbm(p * 1.12 + studioWarp * 0.52)) * 0.16);
    float studioInkEdge = smoothstep(0.25, 0.6, studioCloud) - studioInkMass * 0.62;
    float studioDetail = fbm(p * vec2(2.0, 2.9) + studioWarp * 1.08 + vec2(t * 0.041, -t * 0.032));
    studioInkMass *= 0.94 + studioDetail * 0.08;
    studioInkMass = clamp(studioInkMass * 1.08, 0.0, 0.78);
    studioInkEdge = clamp((smoothstep(0.23, 0.59, studioCloud + (studioDetail - 0.5) * 0.055) - studioInkMass * 0.54) * 0.14, 0.0, 0.085);
    // Smooth thresholding preserves broad pigment gradients without isolated
    // hard-edged splashes. The old bitmap textures remain unused.
    float studioWashAlpha = min(0.045 + studioInkMass * 1.22 + studioInkEdge * 0.24, 0.7) * modeStudio;

    float inkDensity = texture2D(uInkField, uv).r;
    float inkVisible = smoothstep(0.012, 0.23, inkDensity);
    vec3 inkColor = mix(uInkColor, vec3(0.25, 0.29, 0.27), smoothstep(0.2, 0.88, inkDensity));
    float inkAlpha = pow(max(inkDensity, 0.0), 0.74) * (0.23 * modeStudio);
    inkAlpha *= inkVisible;

    vec3 color = mix(atmosphereColor, inkColor, inkAlpha / max(atmosphereAlpha + inkAlpha, 0.0001));
    vec3 studioInkColor = mix(uPaperColor, uInkColor, 0.55 + studioInkMass * 0.3);
    color = mix(color, studioInkColor, studioWashAlpha / max(atmosphereAlpha + inkAlpha + studioWashAlpha, 0.0001));
    float alpha = clamp(atmosphereAlpha + inkAlpha + studioWashAlpha, 0.0, 0.66);
    if (modeHome < 0.5 && modeStudio < 0.5 && modeHeritage < 0.5) alpha = 0.0;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Shared Three.js atmosphere for the home lake and the studio's ambient ink wash. */
export class HomeLakeScene {
  constructor(host) {
    if (!host) throw new Error("Missing atmospheric background host");
    this.host = host;
    this.active = true;
    this.destroyed = false;
    this.sceneMode = "home";
    this.elapsed = 0;
    this.parallax = new THREE.Vector2();
    this.livePointer = new THREE.Vector2(-2, -2);
    this.livePointerVelocity = new THREE.Vector2();
    this.livePointerAt = -Infinity;
    this.dropRipples = [];
    this.lastWaterPointer = null;
    this.lastWaterPointerAt = 0;
    this.umbrellaHitTest = null;
    this.dropDataUniform = Array.from({ length: HOME_DROP_SHADER_SAMPLES }, () => new THREE.Vector4(-2, -2, 10, 0));
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.motionQuery.matches;
    this.lastFrameAt = 0;
    this.loopRunning = false;

    const tokenColor = (name, fallback) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return new THREE.Color(value || fallback);
    };
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3);
    this.camera.position.z = 1;
    this.displayMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: DISPLAY_SHADER,
      uniforms: {
        uInkField: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat) },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uParallax: { value: this.parallax },
        uDropData: { value: this.dropDataUniform },
        uLivePointer: { value: this.livePointer },
        uPointerVelocity: { value: this.livePointerVelocity },
        uLivePointerStrength: { value: 0 },
        uLivePointerAge: { value: 10 },
        uSceneMode: { value: 0 },
        uPaperColor: { value: tokenColor("--color-paper", "#f5f1e8") },
        uMistColor: { value: tokenColor("--color-mist", "#d5e5dd") },
        uLakeColor: { value: tokenColor("--color-lake", "#537c7e") },
        uInkColor: { value: tokenColor("--color-ink-wash-deep", "#343936") }
      },
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    this.displayMaterial.uniforms.uInkField.value.needsUpdate = true;
    this.displayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.displayMaterial);
    this.scene.add(this.displayQuad);

    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerOut = (event) => {
      if (event.relatedTarget == null) this.clearPointer();
    };
    this.onVisibility = () => this.syncLoop();
    this.onMotionPreference = (event) => {
      this.reducedMotion = event.matches;
      this.syncLoop();
    };
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
    window.addEventListener("pointerout", this.onPointerOut, { passive: true });
    window.addEventListener("blur", this.clearPointer);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.motionQuery.addEventListener?.("change", this.onMotionPreference);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  isPointerExcluded(event) {
    if (this.sceneMode === "off" || this.sceneMode === "gallery") return true;
    if (!(event.target instanceof Element)) return false;
    if (this.sceneMode === "home") {
      // Copy sits in front of the lake but should not interrupt the water wake.
      // Only controls and the masthead take pointer input on the home page.
      if (event.target.closest(".home-actions, .site-masthead, a, button")) return true;
      if (event.target.closest("#homeUmbrellaHost canvas")) return Boolean(this.umbrellaHitTest?.(event.clientX, event.clientY));
      return false;
    }
    if (this.sceneMode === "studio") {
      return Boolean(event.target.closest("#umbrellaCanvas, #threeHost canvas, #homeUmbrellaHost canvas, #galleryFocusHost canvas, .controls, .app-header, .viewer-toolbar, .viewer-fold-control, button, input, select, textarea, a"));
    }
    if (this.sceneMode === "heritage") return false;
    return Boolean(event.target.closest(".site-masthead, .heritage-book-controls, .heritage-workshop-link, button, a, input, select, textarea"));
  }

  handlePointerMove(event) {
    if (this.isPointerExcluded(event) || event.pointerType === "touch") {
      this.clearPointer();
      return;
    }
    if (this.sceneMode === "studio") {
      const bounds = this.host.getBoundingClientRect();
      const point = new THREE.Vector2(
        THREE.MathUtils.clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1),
        1 - THREE.MathUtils.clamp((event.clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1)
      );
      this.updateLivePointer(point, performance.now());
      if (this.reducedMotion) this.renderOnce();
      return;
    }
    if (this.sceneMode !== "home") return;
    const bounds = this.host.getBoundingClientRect();
    const frameNow = performance.now();
    let samples = [];
    try {
      samples = event.getCoalescedEvents?.() || [];
    } catch {
      samples = [];
    }
    if (!samples.length) samples = [event];
    samples.push(event);
    let lastNow = frameNow;
    for (const sample of samples) {
      const sampleNow = Number.isFinite(sample.timeStamp) && Math.abs(frameNow - sample.timeStamp) < 1000
        ? Math.min(frameNow, sample.timeStamp)
        : frameNow;
      const point = new THREE.Vector2(
        THREE.MathUtils.clamp((sample.clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1),
        1 - THREE.MathUtils.clamp((sample.clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1)
      );
      this.updateLivePointer(point, sampleNow);
      this.stampPointerPath(point, bounds, sampleNow);
      lastNow = sampleNow;
    }
    this.lastPointerTime = lastNow;
    // The animation loop already renders the next frame. Rendering again for
    // every pointer event doubled the full-screen shader cost and made ripples
    // appear to lag behind fast cursor movement.
    if (this.reducedMotion) this.renderOnce();
  }

  stampPointerPath(point, bounds, now = performance.now()) {
    if (!this.lastWaterPointer) {
      this.addWaterDrop(point, 0.42);
      this.lastWaterPointer = point.clone();
      this.lastWaterPointerAt = now;
      return;
    }
    const aspect = Math.max(bounds.width, 1) / Math.max(bounds.height, 1);
    const dx = (point.x - this.lastWaterPointer.x) * aspect;
    const dy = point.y - this.lastWaterPointer.y;
    const distance = Math.hypot(dx, dy);
    // Keep a one-second path visible while the pointer is moving. The looser
    // sampling still overlaps because each water drop expands into a broad rim.
    const spacing = 0.0055;
    if (distance < spacing * 0.42) return;
    // Even large pointer events sample the complete segment. Capping the
    // sample count must never leave the newest end of the path unstamped.
    const steps = THREE.MathUtils.clamp(Math.ceil(distance / spacing), 1, 128);
    const strength = THREE.MathUtils.clamp(0.42 + this.livePointerVelocity.length() * 0.15, 0.38, 0.76);
    const previousAt = this.lastWaterPointerAt || now;
    const samples = [];
    for (let step = 1; step <= steps; step++) {
      const amount = step / steps;
      samples.push({
        point: new THREE.Vector2(
          THREE.MathUtils.lerp(this.lastWaterPointer.x, point.x, amount),
          THREE.MathUtils.lerp(this.lastWaterPointer.y, point.y, amount)
        ),
        // Reconstruct the time at which the pointer crossed each point. Giving
        // the whole segment one timestamp made synchronized rings stack into
        // a broad, layered blot during fast movement.
        at: THREE.MathUtils.lerp(previousAt, now, amount)
      });
    }
    this.addWaterDropBatch(samples, strength);
    this.lastWaterPointer.copy(point);
    this.lastWaterPointerAt = now;
  }

  handlePointerDown(event) {
    if (this.sceneMode !== "home" || this.isPointerExcluded(event) || event.pointerType === "touch") return;
    const bounds = this.host.getBoundingClientRect();
    const point = new THREE.Vector2(
      THREE.MathUtils.clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1),
      1 - THREE.MathUtils.clamp((event.clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1)
    );
    this.addWaterDrop(point, 0.56, performance.now());
    this.lastWaterPointer = point.clone();
    this.lastWaterPointerAt = performance.now();
    this.renderOnce();
  }

  setUmbrellaHitTest(hitTest) {
    this.umbrellaHitTest = typeof hitTest === "function" ? hitTest : null;
  }

  addWaterDrop(point, strength, now = performance.now()) {
    this.dropRipples.unshift({ point: point.clone(), at: now, strength });
    this.dropRipples.length = Math.min(this.dropRipples.length, HOME_DROP_HISTORY);
    this.syncDropUniforms(now);
  }

  addWaterDropBatch(points, strength, now = performance.now()) {
    const newestFirst = [...points].reverse().map((sample) => ({
      point: sample.point,
      at: Number.isFinite(sample.at) ? sample.at : now,
      strength
    }));
    this.dropRipples.unshift(...newestFirst);
    this.dropRipples.length = Math.min(this.dropRipples.length, HOME_DROP_HISTORY);
    this.syncDropUniforms(now);
  }

  updateLivePointer(point, now = performance.now()) {
    const previous = this.livePointer.clone();
    if (previous.x < 0 || previous.x > 1 || previous.y < 0 || previous.y > 1) previous.copy(point);
    const elapsed = Math.max(8, now - (this.lastPointerTime || now - 16)) / 1000;
    this.livePointerVelocity.set((point.x - previous.x) / elapsed, (point.y - previous.y) / elapsed).clampLength(0, 2.2);
    this.livePointer.copy(point);
    this.livePointerAt = now;
    this.lastPointerTime = now;
    this.displayMaterial.uniforms.uLivePointer.value = this.livePointer;
    this.displayMaterial.uniforms.uPointerVelocity.value = this.livePointerVelocity;
    this.displayMaterial.uniforms.uLivePointerStrength.value = 1;
    this.displayMaterial.uniforms.uLivePointerAge.value = 0;
  }

  syncLivePointer(now = performance.now()) {
    const age = Math.max(0, (now - this.livePointerAt) / 1000);
    this.displayMaterial.uniforms.uLivePointer.value = this.livePointer;
    this.displayMaterial.uniforms.uPointerVelocity.value = this.livePointerVelocity;
    this.displayMaterial.uniforms.uLivePointerStrength.value = age < 0.85 ? 1 : 0;
    this.displayMaterial.uniforms.uLivePointerAge.value = Math.min(age, 10);
  }

  syncDropUniforms(now = performance.now()) {
    // The array is newest-first. Sampling all 64 slots made the shader spend
    // most of its samples on expired drops, so a fast cursor looked active only
    // at its final position. Keep only the visible wake before downsampling it.
    this.dropRipples = this.dropRipples.filter((ripple) => now - ripple.at < 1520);
    const historyCount = this.dropRipples.length;
    const sampleCount = Math.min(historyCount, HOME_DROP_SHADER_SAMPLES);
    for (let index = 0; index < HOME_DROP_SHADER_SAMPLES; index++) {
      if (index >= sampleCount) {
        this.dropDataUniform[index].set(-2, -2, 10, 0);
        continue;
      }
      // Keep points spread across the whole recent stroke. Sending only the
      // newest samples made a fast pointer path collapse into a single blob.
      const sourceIndex = sampleCount === 1
        ? 0
        : Math.round(index * (historyCount - 1) / (sampleCount - 1));
      const ripple = this.dropRipples[sourceIndex];
      this.dropDataUniform[index].set(
        ripple.point.x,
        ripple.point.y,
        Math.min(10, Math.max(0, (now - ripple.at) / 1000)),
        ripple.strength
      );
    }
    this.displayMaterial.uniforms.uDropData.value = this.dropDataUniform;
  }

  clearPointer = () => {
    this.livePointer.set(-2, -2);
    this.livePointerVelocity.set(0, 0);
    this.livePointerAt = -Infinity;
    this.lastWaterPointer = null;
    this.lastWaterPointerAt = 0;
    this.lastPointerTime = 0;
    if (this.displayMaterial) {
      this.displayMaterial.uniforms.uLivePointer.value = this.livePointer;
      this.displayMaterial.uniforms.uPointerVelocity.value = this.livePointerVelocity;
      this.displayMaterial.uniforms.uLivePointerStrength.value = 0;
      this.displayMaterial.uniforms.uLivePointerAge.value = 10;
    }
  };

  resize() {
    const width = Math.max(1, this.host.clientWidth || window.innerWidth);
    const height = Math.max(1, this.host.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.displayMaterial.uniforms.uResolution.value.set(width, height);
    this.renderOnce();
  }

  renderFrame = (timestamp = performance.now()) => {
    const frameAt = Number.isFinite(timestamp) ? timestamp : performance.now();
    const delta = Math.min(this.lastFrameAt ? Math.max(0, (frameAt - this.lastFrameAt) / 1000) : 0.016, 0.05);
    this.lastFrameAt = frameAt;
    if (!this.reducedMotion) this.elapsed += delta;
    this.displayMaterial.uniforms.uTime.value = this.elapsed;
    this.syncLivePointer(frameAt);
    this.syncDropUniforms();
    this.renderer.render(this.scene, this.camera);
  };

  renderOnce() {
    if (!this.renderer || !this.host.clientWidth || !this.host.clientHeight) return;
    this.displayMaterial.uniforms.uTime.value = this.elapsed;
    this.syncLivePointer();
    this.syncDropUniforms();
    this.renderer.render(this.scene, this.camera);
  }

  setSceneMode(mode) {
    const modes = { home: 0, studio: 1, heritage: 2, gallery: 3, off: 3 };
    this.sceneMode = Object.hasOwn(modes, mode) ? mode : "studio";
    this.displayMaterial.uniforms.uSceneMode.value = modes[this.sceneMode];
    this.host.dataset.scene = this.sceneMode;
    document.documentElement.dataset.inkScene = this.sceneMode;
    this.clearPointer();
    this.dropRipples.length = 0;
    this.syncDropUniforms();
    this.elapsed = 0;
    this.syncLoop();
  }

  setActive(active) {
    this.active = Boolean(active);
    this.syncLoop();
  }

  setParallax(x = 0, y = 0) {
    this.parallax.set(x, y);
    this.displayMaterial.uniforms.uParallax.value = this.parallax;
  }

  syncLoop() {
    if (!this.renderer) return;
    const enabledMode = this.sceneMode !== "off" && this.sceneMode !== "gallery";
    const shouldAnimate = this.active && enabledMode && !document.hidden && !this.reducedMotion;
    if (shouldAnimate) {
      if (!this.loopRunning) this.lastFrameAt = 0;
      this.loopRunning = true;
      this.renderer.setAnimationLoop(this.renderFrame);
    } else {
      this.renderer.setAnimationLoop(null);
      this.loopRunning = false;
      this.lastFrameAt = 0;
      this.renderOnce();
    }
  }

  destroy() {
    this.active = false;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.loopRunning = false;
    this.resizeObserver.disconnect();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerout", this.onPointerOut);
    window.removeEventListener("blur", this.clearPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motionQuery.removeEventListener?.("change", this.onMotionPreference);
    this.displayQuad.geometry.dispose();
    this.displayMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.renderer = null;
  }
}
