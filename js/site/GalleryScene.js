import * as THREE from "three";

const galleryLayerUrl = (name) => new URL("../../assets/gallery/layers/" + name, import.meta.url).href;
const BRIDGE_RAIL_PROFILE = Object.freeze([
  0.65, 0.65, 0.645, 0.62, 0.585, 0.545, 0.495, 0.438, 0.381,
  0.345, 0.334, 0.343, 0.373, 0.43, 0.487, 0.54, 0.582, 0.615,
  0.644, 0.65, 0.65
]);
const BRIDGE_DECK_PROFILE = Object.freeze(BRIDGE_RAIL_PROFILE.map((y) => y + 0.009));
// Reveal enough of the near parapet to hide shoe soles and the lowest hem,
// while keeping most of each walking silhouette visible above the bridge.
const BRIDGE_FRONT_LIP_DEPTH = 0.018;

function bridgeLipClipPath() {
  // The bridge plate contains the rail and stone wall in one image. Reveal
  // only a narrow strip around the walkable deck in front of each sole; a
  // taller cutout buried the characters' skirts inside the stone wall.
  const top = BRIDGE_DECK_PROFILE.map((y, index) => {
    const x = index / (BRIDGE_DECK_PROFILE.length - 1) * 100;
    return `${x.toFixed(2)}% ${((y - 0.006) * 100).toFixed(2)}%`;
  });
  const lower = BRIDGE_DECK_PROFILE.map((y, index) => {
    const x = index / (BRIDGE_DECK_PROFILE.length - 1) * 100;
    return `${x.toFixed(2)}% ${((y + BRIDGE_FRONT_LIP_DEPTH) * 100).toFixed(2)}%`;
  }).reverse();
  return `polygon(${top.concat(lower).join(",")})`;
}

/**
 * Fixed-frame rainy West Lake scene.
 * Water sits behind the bridge and walkers. The near parapet is layered over
 * the figures so they read as walking on the deck behind the bridge rail.
 */
export class GalleryScene {
  static poseForIndex(index = 0) {
    const even = index % 2 === 0;
    return {
      yaw: even ? 0.035 : -0.055,
      roll: even ? 0 : 0.012,
      // Normalized to the raised hand in each row of the supplied sprite sheet.
      grip: even ? [71, 33] : [71, 28],
      character: even ? "woman" : "man"
    };
  }

  constructor(host, onSelect = () => {}) {
    if (!host) throw new Error("Missing gallery host");
    this.host = host;
    this.onSelect = onSelect;
    this.works = [];
    this.walkers = [];
    this.bridgeMetrics = { top: 0, left: 0, width: 0, height: 0 };
    this.active = false;
    this.focused = false;
    this.destroyed = false;
    this.frameRequest = 0;
    this.lastFrameTime = 0;
    this.waterTime = 0;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
    this.walkerSheetUrl = galleryLayerUrl("walkers-sprite-v2.png");
    this.mountainUrl = galleryLayerUrl("rainy-mountains.png");
    this.bridgeUrl = galleryLayerUrl("ink-stone-bridge.png");
    this.lotusUrl = galleryLayerUrl("foreground-lotus.png");

    this.host.classList.add("gallery-scroll-host");
    this.host.setAttribute("role", "region");
    this.host.setAttribute("aria-label", "雨中西湖分层场景，人物沿拱桥行走，点击绸伞进入三维欣赏");
    this.host.tabIndex = 0;
    this.host.innerHTML = [
      '<div class="gallery-rain-bridge-scene">',
      '<img class="gallery-layer gallery-layer--mountains" alt="" draggable="false" aria-hidden="true">',
      '<div class="gallery-layer gallery-layer--mist-back" aria-hidden="true"></div>',
      '<div class="gallery-layer gallery-layer--mist-range" aria-hidden="true"></div>',
      '<canvas class="gallery-water-webgl" aria-hidden="true"></canvas>',
      '<img class="gallery-layer gallery-layer--bridge gallery-layer--bridge-back" alt="" draggable="false" aria-hidden="true">',
      '<div class="gallery-walk-layer" aria-label="桥上行走的绸伞作品"></div>',
      '<img class="gallery-layer gallery-layer--bridge gallery-layer--bridge-front" alt="" draggable="false" aria-hidden="true">',
      '<img class="gallery-layer gallery-layer--lotus" alt="" draggable="false" aria-hidden="true">',
      '<div class="gallery-layer gallery-layer--mist-front" aria-hidden="true"></div>',
      '<div class="gallery-rain-layer gallery-rain-layer--distant" aria-hidden="true"></div>',
      '<div class="gallery-rain-layer gallery-rain-layer--near" aria-hidden="true"></div>',
      '<div class="gallery-scene-grain" aria-hidden="true"></div>',
      '</div>'
    ].join("");

    this.scene = this.host.querySelector(".gallery-rain-bridge-scene");
    this.walkLayer = this.host.querySelector(".gallery-walk-layer");
    this.waterCanvas = this.host.querySelector(".gallery-water-webgl");
    this.mountain = this.host.querySelector(".gallery-layer--mountains");
    this.bridge = this.host.querySelector(".gallery-layer--bridge-back");
    this.bridgeFront = this.host.querySelector(".gallery-layer--bridge-front");
    this.mountain.src = this.mountainUrl;
    this.bridge.src = this.bridgeUrl;
    this.bridgeFront.src = this.bridgeUrl;
    this.bridgeFront.style.clipPath = bridgeLipClipPath();
    this.bridgeFront.style.webkitClipPath = bridgeLipClipPath();
    this.host.querySelector(".gallery-layer--lotus").src = this.lotusUrl;

    this.onPointerOver = (event) => this.handleFigureHover(event, true);
    this.onPointerOut = (event) => this.handleFigureHover(event, false);
    this.host.addEventListener("pointerover", this.onPointerOver);
    this.host.addEventListener("pointerout", this.onPointerOut);
    this.pan = 0;
    this.draggedRecently = false;
    this.onPointerDown = (event) => {
      if (event.button !== 0 || event.target.closest(".gallery-floating-nav, .gallery-works-panel")) return;
      this.dragStart = { x: event.clientX, pan: this.pan };
      // Keep the umbrella button as the pointer target so a tap still opens it.
      // Movement on that same button is tracked by the host and suppresses its click.
      if (!event.target.closest(".gallery-scroll-umbrella-hit")) {
        this.host.setPointerCapture(event.pointerId);
      }
    };
    this.onPointerMove = (event) => {
      if (!this.dragStart) return;
      const movement = event.clientX - this.dragStart.x;
      if (Math.abs(movement) > 5) this.draggedRecently = true;
      this.pan = Math.max(-this.host.clientWidth * .055, Math.min(this.host.clientWidth * .055, this.dragStart.pan + movement * .28));
      this.scene.style.setProperty("--gallery-pan", `${this.pan}px`);
    };
    this.onPointerUp = () => {
      this.dragStart = null;
      window.setTimeout(() => { this.draggedRecently = false; }, 120);
    };
    this.host.addEventListener("pointerdown", this.onPointerDown);
    this.host.addEventListener("pointermove", this.onPointerMove);
    this.host.addEventListener("pointerup", this.onPointerUp);
    this.host.addEventListener("pointercancel", this.onPointerUp);

    this.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => this.resize())
      : null;
    this.resizeObserver?.observe(this.host);
    this.onWindowResize = () => this.resize();
    window.addEventListener("resize", this.onWindowResize, { passive: true });

    this.initializeWater();
    this.animate = (time) => this.animateScene(time);
    this.resize();
  }

  initializeWater() {
    try {
      this.waterRenderer = new THREE.WebGLRenderer({
        canvas: this.waterCanvas,
        alpha: true,
        antialias: false,
        powerPreference: "low-power"
      });
      this.waterRenderer.setClearColor(0x000000, 0);
      this.waterRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.waterRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.waterScene = new THREE.Scene();
      this.waterCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.waterMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
          uFocus: { value: 0 },
          uAspect: { value: 1 }
        },
        vertexShader: [
          "varying vec2 vUv;",
          "void main() {",
          "  vUv = uv;",
          "  gl_Position = vec4(position.xy, 0.0, 1.0);",
          "}"
        ].join("\n"),
        fragmentShader: [
          "varying vec2 vUv;",
          "uniform float uTime;",
          "uniform float uReducedMotion;",
          "uniform float uFocus;",
          "uniform float uAspect;",
          "float hash21(vec2 p) {",
          "  p = fract(p * vec2(123.34, 456.21));",
          "  p += dot(p, p + vec2(45.32));",
          "  return fract(p.x * p.y);",
          "}",
          "float noise21(vec2 p) {",
          "  vec2 i = floor(p);",
          "  vec2 f = fract(p);",
          "  f = f * f * (3.0 - 2.0 * f);",
          "  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),",
          "    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);",
          "}",
          "float rainRing(vec2 point, vec2 center, float time, float seed) {",
          "  float phase = fract(time * 0.17 + seed);",
          "  float radius = mix(0.006, 0.050, phase);",
          "  float distanceToRing = length(vec2((point.x - center.x) * uAspect, point.y - center.y));",
          "  float ring = 1.0 - smoothstep(0.0025, 0.0065, abs(distanceToRing - radius));",
          "  float life = smoothstep(0.015, 0.15, phase) * (1.0 - smoothstep(0.46, 0.74, phase));",
          "  return ring * life;",
          "}",
          "void main() {",
          "  float t = uTime * (1.0 - uReducedMotion) * mix(1.0, 0.42, uFocus);",
          "  float x = vUv.x;",
          "  float y = 1.0 - vUv.y;",
          "  float shore = 0.575 + 0.004 * sin(x * 6.4 + t * 0.08);",
          "  float waterMask = smoothstep(shore - 0.025, shore + 0.10, y);",
          "  float broad = sin(y * 38.0 - x * 6.0 + sin(x * 9.0 + t * 0.11) * 1.1 + t * 0.19);",
          "  float fine = sin(y * 112.0 - x * 19.0 + sin(x * 17.0 - t * 0.16) * 1.2 + t * 0.29);",
          "  float brokenWave = sin(y * 205.0 - x * 34.0 + sin(x * 24.0 + t * 0.1) + t * 0.42);",
          "  float glint = pow(max(0.0, sin(y * 137.0 - x * 21.0 + broad * 0.8 + t * 0.4)), 12.0);",
          "  float reflection = exp(-pow((x - 0.52 - 0.02 * sin(t * 0.12)) * 4.2, 2.0));",
          "  float ripples = rainRing(vec2(x, y), vec2(0.40, 0.73), t, 0.08)",
          "    + rainRing(vec2(x, y), vec2(0.51, 0.78), t, 0.43)",
          "    + rainRing(vec2(x, y), vec2(0.62, 0.71), t, 0.71);",
          "  float archShade = (1.0 - smoothstep(0.035, 0.24, abs(x - 0.5)))",
          "    * smoothstep(0.45, 0.58, y) * (1.0 - smoothstep(0.70, 0.81, y));",
          "  float depth = smoothstep(shore + 0.035, 0.98, y);",
          "  float cloud = noise21(vec2(x * 13.0 + t * 0.012, y * 8.0)) - 0.5;",
          "  float grain = noise21(vec2(x * 110.0, y * 180.0)) - 0.5;",
          "  float reflectionBands = (0.5 + 0.5 * sin(y * 57.0 - x * 8.0 + t * 0.16 + broad)) * reflection;",
          "  float ribbon = sin(y * 155.0 + 1.8 * sin(x * 12.0 + t * 0.09) - x * 8.0 + t * 0.22);",
          "  float ribbonBreak = smoothstep(0.35, 0.77, noise21(vec2(x * 20.0 + t * 0.035, y * 15.0)));",
          "  float smallStreaks = pow(max(0.0, sin(y * 310.0 + x * 16.0 + t * 0.31)), 9.0) * ribbonBreak;",
          "  float surfaceNoise = noise21(vec2(x * 68.0 + t * 0.018 + broad * 0.12, y * 27.0 - t * 0.038));",
          "  float rippleNoise = noise21(vec2(x * 42.0 + t * 0.012, y * 82.0 + sin(x * 8.0 + t * 0.05) * 0.8));",
          "  float brokenRipples = pow(max(0.0, sin(y * 188.0 - x * 25.0 + sin(x * 13.0 + t * 0.07) * 1.6 + t * 0.24)), 10.0)",
          "    * smoothstep(0.42, 0.72, rippleNoise);",
          "  vec3 deep = vec3(0.055, 0.255, 0.275);",
          "  vec3 shallows = vec3(0.21, 0.48, 0.485);",
          "  vec3 water = mix(shallows, deep, clamp(depth * 0.72 + 0.055 * broad - 0.06 * cloud, 0.0, 0.82));",
          "  float current = 0.075 * ribbon * ribbonBreak + 0.048 * fine + 0.04 * brokenWave;",
          "  float shimmer = (surfaceNoise - 0.48) * 0.9 + (rippleNoise - 0.5) * 0.24;",
          "  water += vec3(0.12, 0.20, 0.19) * (current + 0.32 * smallStreaks + 0.18 * reflectionBands + 0.3 * glint * reflection + 0.055 * ripples + 0.17 * brokenRipples);",
          "  water += vec3(0.025, 0.052, 0.048) * shimmer;",
          "  water *= 1.0 - 0.08 * archShade;",
          "  water += vec3(0.025, 0.034, 0.032) * grain;",
          // The broad translucent shore joins the mountain plate to the lake
          // without exposing a hard horizontal edge or cutting off the arch.
          "  float alpha = waterMask * clamp(0.96 + 0.02 * glint * reflection + 0.02 * ripples, 0.94, 1.0);",
          "  alpha *= mix(1.0, 0.96, uFocus);",
          "  gl_FragColor = vec4(water, alpha);",
          "}"
        ].join("\n")
      });
      this.waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.waterMaterial);
      this.waterScene.add(this.waterMesh);
    } catch (error) {
      console.warn("画廊 WebGL 水面不可用，使用静态湖色：", error);
      this.waterCanvas.classList.add("is-unavailable");
    }
  }

  createWork(work, index, route) {
    const pose = GalleryScene.poseForIndex(index);
    const group = document.createElement("div");
    group.className = "gallery-scroll-work gallery-walker gallery-walker--" + (index + 1) + " gallery-walker--" + pose.character;
    group.dataset.workId = work.id;
    group.dataset.character = pose.character;
    group.dataset.direction = String(route.direction);
    group.style.setProperty("--figure-height", route.height + "%");
    group.style.setProperty("--walk-delay", route.delay + "s");
    group.style.setProperty("--walk-duration", route.walkDuration + "s");
    group.style.setProperty("animation", "none", "important");
    group.style.setProperty("--grip-x", pose.grip[0] + "%");
    group.style.setProperty("--grip-y", pose.grip[1] + "%");
    work.galleryPose = { yaw: pose.yaw, roll: pose.roll };

    const figure = document.createElement("div");
    figure.className = "gallery-person-sprite";
    figure.setAttribute("aria-hidden", "true");
    figure.style.setProperty("--sprite-url", 'url("' + this.walkerSheetUrl + '")');
    // walkers-sprite-v2 is a 4×4 sheet (four walk frames and four planted
    // poses for each character). Set this inline as well as in CSS so older
    // gallery cascade rules cannot crop the standing row into another person.
    figure.style.setProperty("background-size", "400% 400%", "important");
    // The 4x4 sheet separates walk cycles from planted idle poses. Start on
    // the standing row so a newly mounted character never freezes mid-step.
    figure.style.setProperty("--sprite-row", pose.character === "man" ? "100%" : "33.3333%");
    figure.style.setProperty("animation", "none", "important");

    const parasol = document.createElement("img");
    parasol.className = "gallery-parasol-preview gallery-scroll-silk-art";
    parasol.alt = "";
    parasol.setAttribute("aria-hidden", "true");
    parasol.draggable = false;
    const preview = work.parasolPreview;
    parasol.style.setProperty("animation", "none", "important");
    if (preview?.src) {
      const widthPercent = route.umbrellaScale;
      const aspect = preview.width / Math.max(preview.height, 1);
      const heightPercent = widthPercent / Math.max(aspect, 0.01);
      parasol.src = preview.src;
      parasol.style.setProperty("--parasol-grip-x", preview.gripX * 100 + "%");
      parasol.style.setProperty("--parasol-grip-y", preview.gripY * 100 + "%");
      parasol.style.setProperty("--parasol-canopy-bottom", (preview.canopyBottom || 0.48) * 100 + "%");
      // Older gallery rules mark canopy geometry as !important. Keep the
      // artwork-derived handle anchor authoritative over those legacy rules.
      parasol.style.setProperty("left", (pose.grip[0] - preview.gripX * widthPercent) + "%", "important");
      parasol.style.setProperty("top", (pose.grip[1] - preview.gripY * heightPercent) + "%", "important");
      parasol.style.setProperty("width", widthPercent + "%", "important");
      parasol.style.setProperty("height", heightPercent + "%", "important");
    }

    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "gallery-scroll-umbrella-hit";
    hit.setAttribute("aria-label", "三维欣赏绸伞作品 " + (index + 1));
    if (preview?.src) {
      const widthPercent = route.umbrellaScale;
      const aspect = preview.width / Math.max(preview.height, 1);
      const heightPercent = widthPercent / Math.max(aspect, 0.01);
      hit.style.setProperty("left", (pose.grip[0] - preview.gripX * widthPercent) + "%", "important");
      hit.style.setProperty("top", (pose.grip[1] - preview.gripY * heightPercent) + "%", "important");
      hit.style.setProperty("width", widthPercent + "%", "important");
      hit.style.setProperty("height", heightPercent + "%", "important");
    }
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.draggedRecently) return;
      this.selectedWalkerIndex = index;
      this.onSelect(work, { x: event.clientX, y: event.clientY });
    });

    // The transparent sprite already contains the hand. A second clipped copy
    // of the full atlas used to create a doubled sleeve/hand at the grip.
    // The shaft stays behind the hand, while the canopy sits in front of the
    // hair where the two silhouettes overlap. Both copies share one grip.
    const canopy = parasol.cloneNode(false);
    canopy.classList.add("gallery-parasol-canopy");
    canopy.setAttribute("aria-hidden", "true");
    canopy.style.setProperty("animation", "none", "important");
    group.append(parasol, figure, canopy, hit);
    return {
      element: group,
      figure,
      parasol,
      canopy,
      direction: route.direction,
      x: route.x,
      speed: route.speed,
      route,
      workId: work.id,
      pauseRemaining: route.startPause,
      walkDistance: 0,
      idleTime: route.idleFrameOffset * route.idleFrameSeconds,
      turnAfterPause: false
    };
  }

  setWorks(works = []) {
    this.works = Array.isArray(works) ? works.filter(Boolean) : [];
    const count = this.works.length;
    const routes = [
      { direction: 1, speed: .019, height: 10.1, umbrellaScale: 91, delay: -.25, walkDuration: 1.7, lane: 0, startPause: .3, pauseChance: .09, stridePhase: 0, idleFrameOffset: 0, idleFrameSeconds: 1.35 },
      { direction: -1, speed: .017, height: 9.7, umbrellaScale: 88, delay: -1.05, walkDuration: 1.6, lane: .001, startPause: 1.8, pauseChance: .08, stridePhase: 1.1, idleFrameOffset: 1, idleFrameSeconds: 1.55 },
      { direction: 1, speed: .021, height: 10.3, umbrellaScale: 94, delay: -1.6, walkDuration: 1.8, lane: -.001, startPause: .9, pauseChance: .085, stridePhase: 2.2, idleFrameOffset: 2, idleFrameSeconds: 1.25 },
      { direction: -1, speed: .016, height: 9.5, umbrellaScale: 87, delay: -.75, walkDuration: 1.65, lane: .0015, startPause: 3.1, pauseChance: .08, stridePhase: .6, idleFrameOffset: 3, idleFrameSeconds: 1.7 },
      { direction: 1, speed: .018, height: 10, umbrellaScale: 90, delay: -1.35, walkDuration: 1.72, lane: -.0015, startPause: 2.4, pauseChance: .075, stridePhase: 1.7, idleFrameOffset: 1.5, idleFrameSeconds: 1.45 },
      { direction: -1, speed: .02, height: 9.8, umbrellaScale: 89, delay: -.5, walkDuration: 1.68, lane: .002, startPause: 4.1, pauseChance: .085, stridePhase: 2.7, idleFrameOffset: .5, idleFrameSeconds: 1.6 },
      { direction: 1, speed: .016, height: 9.6, umbrellaScale: 86, delay: -.9, walkDuration: 1.75, lane: .0006, startPause: 5.3, pauseChance: .08, stridePhase: 3.2, idleFrameOffset: 2.5, idleFrameSeconds: 1.3 },
      { direction: -1, speed: .018, height: 9.9, umbrellaScale: 90, delay: -.35, walkDuration: 1.62, lane: -.0007, startPause: 6.2, pauseChance: .09, stridePhase: 1.4, idleFrameOffset: 3.5, idleFrameSeconds: 1.5 }
    ];
    // Keep a readable cast even when the work library grows. Repeated parasol
    // designs are fine; overlapping actors are not.
    const walkerCount = Math.min(count, routes.length);
    const routeMin = 0.065;
    const routeMax = 0.935;
    this.walkers = Array.from({ length: walkerCount }, (_, index) => {
      const spacing = walkerCount > 1 ? (routeMax - routeMin) / (walkerCount - 1) : 0;
      const route = { ...routes[index], x: routeMin + spacing * index, minX: 0.075, maxX: 0.925, priority: index };
      return this.createWork(this.works[index % this.works.length], index, route);
    });
    this.walkLayer.replaceChildren(...this.walkers.map((walker) => walker.element));
    this.host.classList.toggle("has-works", count > 0);
    this.host.classList.toggle("has-no-works", count === 0);
    this.updateWalkerPositions();
    if (this.active) this.startMotion();
  }

  setActive(active) {
    this.active = Boolean(active);
    this.host.classList.toggle("is-active", this.active);
    if (this.active) {
      this.renderWater();
      this.startMotion();
    } else this.stopMotion();
  }

  setFocused(focused) {
    this.focused = Boolean(focused);
    this.host.classList.toggle("is-focused", this.focused);
    if (this.waterMaterial) this.waterMaterial.uniforms.uFocus.value = this.focused ? 1 : 0;
  }

  startMotion() {
    if (this.frameRequest || !this.active || this.destroyed) return;
    this.lastFrameTime = 0;
    if (this.reducedMotion) {
      this.updateWalkerPositions();
      this.renderWater();
      return;
    }
    this.frameRequest = requestAnimationFrame(this.animate);
  }

  stopMotion() {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.lastFrameTime = 0;
  }

  resize() {
    if (!this.host.clientWidth || !this.host.clientHeight) return;
    const hostRect = this.host.getBoundingClientRect();
    const sceneRect = this.scene.getBoundingClientRect();
    const bridgeRect = this.bridge.getBoundingClientRect();
    this.bridgeMetrics = {
      // Store bridge and scene geometry in the same local coordinate system.
      // The scene is wider than the viewport and can be panned; measuring the
      // child relative to its moving parent keeps both values aligned.
      sceneOffsetLeft: sceneRect.left - hostRect.left - this.pan,
      sceneWidth: sceneRect.width,
      sceneHeight: sceneRect.height,
      bridgeTop: bridgeRect.top - sceneRect.top,
      bridgeLeft: bridgeRect.left - sceneRect.left,
      bridgeWidth: bridgeRect.width,
      bridgeHeight: bridgeRect.height
    };
    this.waterRenderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.waterRenderer?.setSize(this.host.clientWidth, this.host.clientHeight, false);
    if (this.waterMaterial) this.waterMaterial.uniforms.uAspect.value = this.host.clientWidth / this.host.clientHeight;
    this.updateWalkerPositions();
    this.renderWater();
  }

  updateWalkerPositions() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    if (!this.bridgeMetrics.bridgeHeight) {
      const hostRect = this.host.getBoundingClientRect();
      const sceneRect = this.scene.getBoundingClientRect();
      const bridgeRect = this.bridge.getBoundingClientRect();
      const mobile = window.matchMedia?.("(max-width: 680px)").matches;
      this.bridgeMetrics = {
        sceneOffsetLeft: sceneRect.width ? sceneRect.left - hostRect.left - this.pan : width * -0.06,
        sceneWidth: sceneRect.width || width * 1.12,
        sceneHeight: sceneRect.height || height,
        bridgeTop: bridgeRect.height ? bridgeRect.top - sceneRect.top : height * 0.23,
        bridgeLeft: bridgeRect.width ? bridgeRect.left - sceneRect.left : (sceneRect.width || width * 1.12) * (mobile ? -0.30 : -0.01),
        bridgeWidth: bridgeRect.width || (sceneRect.width || width * 1.12) * (mobile ? 1.60 : 1.02),
        bridgeHeight: bridgeRect.height || height * (mobile ? 0.55 : 0.60)
      };
    }
    const { sceneOffsetLeft, sceneWidth, sceneHeight, bridgeTop, bridgeLeft, bridgeWidth, bridgeHeight } = this.bridgeMetrics;
    for (const walker of this.walkers) {
      const clampedX = Math.min(1, Math.max(0, walker.x));
      // The art stage is 112% viewport width. Convert the walker's viewport
      // world position into that stage before sampling the bridge arc; using
      // walker.x directly for CSS left made characters drift off the deck on
      // the sloped sides even though their feet sampled the correct arc point.
      const sceneX = (clampedX * width - sceneOffsetLeft) / sceneWidth;
      const bridgeX = Math.min(1, Math.max(0, (sceneX * sceneWidth - bridgeLeft) / bridgeWidth));
      const position = bridgeX * (BRIDGE_DECK_PROFILE.length - 1);
      const segment = Math.min(BRIDGE_DECK_PROFILE.length - 2, Math.floor(position));
      const blend = position - segment;
      const sourceDeckY = THREE.MathUtils.lerp(BRIDGE_DECK_PROFILE[segment], BRIDGE_DECK_PROFILE[segment + 1], blend);
      const deckTopPx = bridgeTop + sourceDeckY * bridgeHeight + (walker.route.lane || 0) * sceneHeight;
      const figureHeight = sceneHeight * walker.route.height / 100;
      // The square atlas cells leave a small transparent baseline below the
      // shoes. Keep the planted-foot anchor on the deck under both walk and
      // idle poses; the near parapet masks only the sole edge.
      const transparentShoeInset = figureHeight * (16 / 320);
      const shoeOcclusion = Math.max(2, Math.min(5, sceneHeight * 0.005));
      walker.element.style.setProperty("left", sceneX * 100 + "%", "important");
      walker.element.style.setProperty("bottom", (sceneHeight - deckTopPx - transparentShoeInset - shoeOcclusion) + "px", "important");
      walker.element.style.setProperty("transform", "translateX(-50%) scaleX(" + (walker.direction < 0 ? -1 : 1) + ")", "important");
      walker.element.style.setProperty("z-index", String(10 + Math.round((deckTopPx / height) * 100)), "important");
      const paused = walker.pauseRemaining > 0;
      const strideLength = Math.max(7, figureHeight * .15);
      const stridePhase = (walker.walkDistance / strideLength + walker.route.stridePhase) % 4;
      const frame = paused
        ? Math.floor(walker.idleTime / walker.route.idleFrameSeconds) % 4
        : Math.floor(stridePhase) % 4;
      const frameX = [0, 33.3333, 66.6667, 100][frame];
      const isMan = walker.element.dataset.character === "man";
      const rowIndex = paused ? (isMan ? 3 : 1) : (isMan ? 2 : 0);
      const rowY = [0, 33.3333, 66.6667, 100][rowIndex];
      // Keep the standing feet planted. Small upper-body motion is conveyed
      // by alternate idle drawings and a restrained parasol sway instead of
      // translating the whole sprite and making the person appear to hover.
      const bob = paused ? 0 : Math.sin(stridePhase * Math.PI / 2) * .32;
      const sway = paused
        ? Math.sin(walker.idleTime * .82 + walker.route.stridePhase) * .28
        : Math.sin(stridePhase * Math.PI / 2) * 1.05 * walker.direction;
      walker.figure.style.setProperty("background-position", frameX + "% " + rowY + "%", "important");
      walker.figure.style.setProperty("transform", "translateY(" + -bob + "% )", "important");
      walker.parasol.style.setProperty("transform", "rotate(" + sway.toFixed(2) + "deg)", "important");
      walker.canopy.style.setProperty("transform", "rotate(" + sway.toFixed(2) + "deg)", "important");
    }
  }

  renderWater() {
    if (!this.waterRenderer || !this.active || this.destroyed) return;
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = this.waterTime;
      this.waterMaterial.uniforms.uFocus.value = this.focused ? 1 : 0;
    }
    this.waterRenderer.render(this.waterScene, this.waterCamera);
  }

  animateScene(time) {
    this.frameRequest = 0;
    if (!this.active || this.destroyed) return;
    const delta = this.lastFrameTime ? Math.min(50, time - this.lastFrameTime) : 0;
    this.lastFrameTime = time;
    const travel = delta / 1000;
    const pace = this.focused ? 0.36 : 1;
    this.waterTime += travel * pace;

    const moving = [];
    for (const walker of this.walkers) {
      if (walker.pauseRemaining > 0) {
        walker.idleTime += travel * pace;
        walker.pauseRemaining = Math.max(0, walker.pauseRemaining - travel * pace);
        continue;
      }
      if (walker.turnAfterPause) {
        walker.direction *= -1;
        walker.turnAfterPause = false;
      }
      moving.push({ walker, from: walker.x, to: walker.x + walker.direction * walker.speed * travel * pace });
    }

    const separation = this.minimumWalkerSeparation();
    const moveByWalker = new Map(moving.map((move) => [move.walker, move]));
    const orderedWalkers = [...this.walkers].sort((a, b) => a.x - b.x);
    // Resolve each neighboring pair in world order. A stationary person is a
    // blocker; followers slow down; opposing walkers take turns. The previous
    // rule could select an undefined move for a paused character and then use
    // the wrong person's X coordinate as the obstacle, allowing sprites to
    // cross and stack at the bridge crest.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let index = 0; index < orderedWalkers.length - 1; index += 1) {
        const left = orderedWalkers[index];
        const right = orderedWalkers[index + 1];
        const leftMove = moveByWalker.get(left);
        const rightMove = moveByWalker.get(right);
        const leftNext = leftMove?.to ?? left.x;
        const rightNext = rightMove?.to ?? right.x;
        if (rightNext - leftNext >= separation) continue;

        if (!leftMove && rightMove) {
          rightMove.to = Math.max(rightMove.to, left.x + separation);
        } else if (leftMove && !rightMove) {
          leftMove.to = Math.min(leftMove.to, right.x - separation);
        } else if (leftMove && rightMove && left.direction === right.direction) {
          if (left.direction > 0) leftMove.to = Math.min(leftMove.to, rightMove.to - separation);
          else rightMove.to = Math.max(rightMove.to, leftMove.to + separation);
        } else if (leftMove && rightMove) {
          const yielding = left.route.priority < right.route.priority ? leftMove : rightMove;
          const passing = yielding === leftMove ? rightMove : leftMove;
          yielding.to = yielding.from;
          yielding.walker.pauseRemaining = Math.max(yielding.walker.pauseRemaining, 0.9 + Math.random() * 0.55);
          yielding.walker.turnAfterPause = true;
          yielding.walker.idleTime += travel * pace;
          if (yielding === leftMove) passing.to = Math.max(passing.to, left.x + separation);
          else passing.to = Math.min(passing.to, right.x - separation);
        }
      }
    }

    for (const { walker, from, to } of moving) {
      const previousX = walker.x;
      walker.x = Math.min(walker.route.maxX, Math.max(walker.route.minX, to));
      walker.walkDistance += Math.abs(walker.x - previousX) * this.host.clientWidth;
      if (walker.direction < 0 && walker.x <= walker.route.minX) {
        walker.pauseRemaining = 1.2 + Math.random() * 2.1;
        walker.turnAfterPause = true;
      } else if (walker.direction > 0 && walker.x >= walker.route.maxX) {
        walker.pauseRemaining = 1.2 + Math.random() * 2.1;
        walker.turnAfterPause = true;
      } else if (Math.random() < travel * walker.route.pauseChance) {
        walker.pauseRemaining = 1.15 + Math.random() * 2.0;
      }
    }
    this.updateWalkerPositions();
    this.renderWater();
    this.frameRequest = requestAnimationFrame(this.animate);
  }

  minimumWalkerSeparation() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.scene.clientHeight);
    const maxHeight = Math.max(...this.walkers.map((walker) => walker.route.height || 10));
    const projectedBodyWidth = height * (maxHeight / 100) * (418 / 470) / width;
    return THREE.MathUtils.clamp(projectedBodyWidth * 1.35 + 0.025, 0.078, 0.12);
  }

  handleFigureHover(event, hovering) {
    const figure = event.target instanceof Element ? event.target.closest(".gallery-scroll-work") : null;
    if (!figure) return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".gallery-scroll-work") : null;
    if (related === figure) return;
    figure.classList.toggle("is-hovered", hovering);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopMotion();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.host.removeEventListener("pointerover", this.onPointerOver);
    this.host.removeEventListener("pointerout", this.onPointerOut);
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    this.host.removeEventListener("pointermove", this.onPointerMove);
    this.host.removeEventListener("pointerup", this.onPointerUp);
    this.host.removeEventListener("pointercancel", this.onPointerUp);
    this.waterMesh?.geometry?.dispose();
    this.waterMaterial?.dispose();
    this.waterRenderer?.dispose();
    this.host.replaceChildren();
  }
}
