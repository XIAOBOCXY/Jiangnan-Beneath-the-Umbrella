// Three.js 只负责 3D 展示；Canvas 中的 ArtworkDocument 仍是唯一作品数据源。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { InkFluidSystem } from "./InkFluidSystem.js?v=20261026-yakudoo-brush-head-v6";
import { AmbientMusic } from "../features/AmbientMusic.js";

const RADIUS = 1.78;
// The 32-bone layout matches a common West Lake silk umbrella construction.
const RIBS = 32;
const CANOPY_HEIGHT = 0.58;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export class ThreeUmbrellaPreview {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.frameHandle = 0;
    this.canvasTexture = null;
    this.textureRevision = -1;
    this.normalTexture = this.createSilkNormalTexture();
    this.roughnessTexture = this.createSilkRoughnessTexture();
    this.modelRoot = null;
    this.modelKind = "procedural";
    this.supportsFolding = false;
    this.mixer = null;
    this.foldAction = null;
    this.foldClip = null;
    this.dynamicMaterials = [];
    this.audioContext = null;
    this.audioAnalyser = null;
    this.audioData = null;
    this.ambientMusic = null;
    this.audioLevel = 0;
    this.audioPulse = 0;
    this.audioFloor = 0;
    this.audioTime = 0;
    this.audioBands = [0, 0, 0, 0];
    this.audioMeterBars = [...document.querySelectorAll("#audioReactiveBtn .audio-meter i")];
    this.canopyMesh = null;
    this.ribPivots = [];
    this.braceLinks = [];
    this.bracePins = [];
    this.runner = null;
    this.hem = null;
    this.closedBundleTies = [];
    this.foldableRibs = [];
    this.modelMeshes = [];
    this.modelTextures = new Set();
    this.foldProgress = 0;
    this.foldTween = null;
    this.onFoldProgress = () => {};
    this.cameraTween = null;
    this.autoRotateTimer = 0;
    this.scanStartedAt = 0;
    this.displayMode = "3d";
    this.inkFluid = null;
    this.inkOpacity = 1;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const clothAnisotropy = Math.min(6, this.renderer.capabilities.getMaxAnisotropy());
    this.normalTexture.anisotropy = clothAnisotropy;
    this.roughnessTexture.anisotropy = clothAnisotropy;
    this.renderer.domElement.setAttribute("aria-label", "可旋转的西湖绸伞三维预览");
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    this.camera.position.set(0.15, 6.2, 0.2);
    // 柔和的下方反射光避免从伞下观察时双面绸料发黑。
    this.ambientLight = new THREE.HemisphereLight(0xf7f3e8, 0xc9c0ae, 1.55);
    this.scene.add(this.ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff3dc, 2.15);
    keyLight.position.set(-3.8, 6.4, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -3.4;
    keyLight.shadow.camera.right = 3.4;
    keyLight.shadow.camera.top = 3.4;
    keyLight.shadow.camera.bottom = -3.4;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.bias = -0.0003;
    keyLight.shadow.radius = 4;
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xd7e8e0, 0.68);
    fillLight.position.set(4, 2.4, -3.5);
    this.audioFillLight = fillLight;
    this.scene.add(fillLight);
    const undersideFill = new THREE.DirectionalLight(0xe9e4d8, 0.9);
    undersideFill.position.set(2.2, -3.4, 1.8);
    this.scene.add(undersideFill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.03, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    // Let users move close enough to inspect cloth and bamboo details while
    // retaining a safe distance that avoids entering the umbrella geometry.
    this.controls.minDistance = 2;
    this.controls.maxDistance = 10;
    this.controls.minPolarAngle = 0.32;
    this.controls.maxPolarAngle = Math.PI - 0.32;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 1.15;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.24;
    this.controls.update();
    this.controls.addEventListener("start", () => {
      window.clearTimeout(this.autoRotateTimer);
      this.controls.autoRotate = false;
    });
    this.controls.addEventListener("end", () => {
      window.clearTimeout(this.autoRotateTimer);
      this.autoRotateTimer = window.setTimeout(() => { this.controls.autoRotate = true; }, 4200);
    });
    this.createFlowField();
    this.createProceduralUmbrella();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.observedHost = host;
    this.resizeObserver.observe(host);
    this.resize();
  }

  createFlowField() {
    // 速度、染料、湿度共用当前 WebGLRenderer 的双缓冲目标。
    this.inkFluid = new InkFluidSystem(THREE, this.renderer);
  }

  setPresentation(mode, host = this.host) {
    this.displayMode = mode === "fluid" ? "fluid" : "3d";
    if (this.observedHost !== host) {
      if (this.observedHost) this.resizeObserver?.unobserve(this.observedHost);
      this.observedHost = host;
      this.resizeObserver?.observe(host);
    }
    this.host = host;
    if (this.renderer.domElement.parentElement !== host) host.appendChild(this.renderer.domElement);
    this.resize();
    if (this.displayMode === "fluid") {
      this.inkFluid?.renderOverlay();
    }
    return this;
  }

  injectInk(splat = {}) {
    this.inkFluid?.addSplat(splat);
    if (this.displayMode === "fluid" && !this.frameHandle) this.setActive(true);
  }
  injectInks(splats = []) {
    this.inkFluid?.addSplats(splats);
    if (splats.length && this.displayMode === "fluid" && !this.frameHandle) this.setActive(true);
  }
  setFluidDebugMode(mode) {
    this.inkFluid?.setDebugMode(mode);
    this.renderOnce();
  }
  setInkOpacity(opacity) {
    this.inkOpacity = clamp01(opacity);
    this.inkFluid?.setDisplayOpacity(this.inkOpacity);
    this.syncInkMaterials();
    this.renderOnce();
  }
  sealFluidMotion() { this.inkFluid?.sealMotion(); }
  injectFluidTest() { this.inkFluid?.injectTestSplat(); if (!this.frameHandle) this.setActive(true); }

  captureFluidSnapshot() {
    if (!this.inkFluid) return null;
    const mode = this.displayMode;
    const debugMode = this.inkFluid.debugMode;
    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const snapshot = document.createElement("canvas");
    snapshot.width = 512;
    snapshot.height = 512;
    try {
      // Capture in the square canopy UV domain even when the visible 3D host
      // is a wide viewport; this keeps PNG/share snapshots from stretching.
      this.renderer.setSize(512, 512, false);
      this.inkFluid.aspect = 1;
      this.inkFluid.setDebugMode("composite");
      this.inkFluid.renderOverlay();
      snapshot.getContext("2d").drawImage(this.renderer.domElement, 0, 0, 512, 512);
    } finally {
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.inkFluid.setDebugMode(debugMode);
      this.displayMode = mode;
      this.renderOnce();
    }
    return snapshot;
  }

  clearFluid() {
    this.inkFluid?.clear();
    this.renderOnce();
  }

  updateFlowField(now) {
    if (!this.inkFluid || !this.active) return;
    // Fluid inputs and render targets live in the square canopy UV domain;
    // camera aspect must not stretch circular pigment splats in 3D mode.
    this.inkFluid.aspect = 1;
    this.inkFluid.step(now);
    this.dynamicMaterials.forEach((material) => {
      const uniforms = material?.userData?.dynamicUniforms;
      if (!uniforms) return;
      const age = Math.max(0, now - this.scanStartedAt);
      uniforms.uScanAngle.value = (age * 0.00062) % (Math.PI * 2);
      uniforms.uScanIntensity.value = age < 4200 ? 0.32 * (1 - age / 4200) : 0;
    });
    this.syncInkMaterials();
  }

  syncInkMaterials() {
    if (!this.inkFluid) return;
    this.dynamicMaterials.forEach((material) => {
      const uniforms = material?.userData?.dynamicUniforms;
      if (uniforms?.uInkDye) uniforms.uInkDye.value = this.inkFluid.dyeTexture;
      if (uniforms?.uInkOpacity) uniforms.uInkOpacity.value = this.inkOpacity;
    });
  }

  createSilkNormalTexture() {
    // 以可重复的细小经纬起伏生成法线图，提供轻微丝线高光而非噪点滤镜。
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    const weave = (x, y) => 0.06 * Math.sin(x * Math.PI / 4) * Math.cos(y * Math.PI / 4)
      + 0.025 * Math.sin((x + y) * Math.PI / 2);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (weave(x + 1, y) - weave(x - 1, y)) * 0.5;
        const dy = (weave(x, y + 1) - weave(x, y - 1)) * 0.5;
        const length = Math.hypot(dx, dy, 1);
        const index = (y * size + x) * 4;
        pixels[index] = Math.round(((-dx / length) * 0.42 + 0.5) * 255);
        pixels[index + 1] = Math.round(((-dy / length) * 0.42 + 0.5) * 255);
        pixels[index + 2] = Math.round((1 / length) * 255);
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  createSilkRoughnessTexture() {
    // 低反差粗糙度变化让丝面反光有织物颗粒，而不是塑料亮斑。
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const thread = Math.sin(x * Math.PI / 4) * Math.sin(y * Math.PI / 5);
        const grain = Math.sin((x * 13 + y * 7) * 0.37) * 0.5;
        const value = Math.round(218 + thread * 7 + grain * 3);
        const index = (y * size + x) * 4;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  getCanopyPoint(radius, angle, normalOffset = 0) {
    const r = radius;
    const ribVariation = 0.021 + Math.sin(angle * 2.3 + 0.6) * 0.0022 + Math.cos(angle * 5.1) * 0.0012;
    const pleat = Math.cos(angle * RIBS) * ribVariation * Math.pow(r, 1.72);
    const rolledEdge = -0.038 * smoothstep(0.86, 1, r);
    const y = CANOPY_HEIGHT * (1 - r * r) + pleat + rolledEdge + normalOffset;
    const edgeRipple = 0.004 * Math.cos(angle * RIBS) * Math.pow(r, 8);
    const distance = RADIUS * r + edgeRipple;
    return new THREE.Vector3(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
  }

  createCanopyGeometry() {
    const radialSegments = 96;
    const angularSegments = 192;
    const positions = [];
    const uvs = [];
    const indices = [];
    const foldCos = new Float32Array((radialSegments + 1) * (angularSegments + 1));
    const foldSin = new Float32Array(foldCos.length);
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const r = radial / radialSegments;
      for (let angular = 0; angular <= angularSegments; angular += 1) {
        const angle = angular / angularSegments * Math.PI * 2 - Math.PI / 2;
        const point = this.getCanopyPoint(r, angle);
        const ribIndex = Math.round(angular / angularSegments * RIBS) % RIBS;
        const ribAngle = -Math.PI / 2 + ribIndex * Math.PI * 2 / RIBS;
        const vertexIndex = radial * (angularSegments + 1) + angular;
        positions.push(point.x, point.y, point.z);
        foldCos[vertexIndex] = Math.cos(ribAngle);
        foldSin[vertexIndex] = Math.sin(ribAngle);
        // Canvas 的顶部映射到 UV 上端，角度与 2D 伞心坐标保持一致。
        uvs.push(0.5 + 0.5 * r * Math.cos(angle), 0.5 - 0.5 * r * Math.sin(angle));
      }
    }
    const row = angularSegments + 1;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      for (let angular = 0; angular < angularSegments; angular += 1) {
        const a = radial * row + angular;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.foldRestPositions = new Float32Array(positions);
    geometry.userData.foldCos = foldCos;
    geometry.userData.foldSin = foldSin;
    // 折叠后伞面会延伸到伞柄附近；固定宽包围球，避免动画中被视锥裁切。
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.45, 0), 2.45);
    return geometry;
  }

  attachFoldAxes(geometry) {
    const positions = geometry.attributes.position.array;
    const count = geometry.attributes.position.count;
    const uv = geometry.attributes.uv;
    const foldCos = new Float32Array(count);
    const foldSin = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      // TubeGeometry 的 U 沿伞缘路径递增；用路径角度取骨位，
      // 不让管线横截面的小顶点偏移把金色收边分配到相邻折叠扇区。
      const angle = uv ? uv.getX(index) * Math.PI * 2 : Math.atan2(positions[offset + 2], positions[offset]);
      const ribIndex = Math.round((angle + Math.PI / 2) / (Math.PI * 2 / RIBS)) % RIBS;
      const ribAngle = -Math.PI / 2 + ribIndex * Math.PI * 2 / RIBS;
      foldCos[index] = Math.cos(ribAngle);
      foldSin[index] = Math.sin(ribAngle);
    }
    geometry.userData.foldRestPositions = new Float32Array(positions);
    geometry.userData.foldCos = foldCos;
    geometry.userData.foldSin = foldSin;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.45, 0), 2.45);
  }

  createCanopyMaterial() {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.canvasTexture,
      normalMap: this.normalTexture,
      normalScale: new THREE.Vector2(0.1, 0.1),
      roughnessMap: this.roughnessTexture,
      roughness: 0.72,
      metalness: 0,
      sheen: 0.48,
      sheenRoughness: 0.82,
      sheenColor: new THREE.Color("#e7d6ba"),
      clearcoat: 0.035,
      clearcoatRoughness: 0.82,
      side: THREE.DoubleSide
    });
    const dynamicUniforms = {
      uScanAngle: { value: 0 },
      uScanIntensity: { value: 0 },
      uAudioLevel: { value: 0 },
      uAudioTime: { value: 0 },
      uInkDye: { value: this.inkFluid?.dyeTexture || null },
      uInkOpacity: { value: this.inkOpacity }
    };
    material.userData.dynamicUniforms = dynamicUniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, dynamicUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uAudioLevel;\nuniform float uAudioTime;\nvarying vec2 vCanopyUv;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCanopyUv = uv;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float canopyRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
          float audioCrease = sin(uAudioTime * 5.0 - canopyRadius * 13.0) * uAudioLevel * 0.018;
          transformed += objectNormal * audioCrease;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uScanAngle;\nuniform float uScanIntensity;\nuniform float uAudioLevel;\nuniform float uAudioTime;\nuniform sampler2D uInkDye;\nuniform float uInkOpacity;\nvarying vec2 vCanopyUv;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec4 wetInk = texture2D(uInkDye, vCanopyUv);
          float wetInkAlpha = clamp(wetInk.a * uInkOpacity * 1.42, 0.0, 0.92);
          diffuseColor.rgb = mix(diffuseColor.rgb, wetInk.rgb, wetInkAlpha);`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          if (!gl_FrontFacing) diffuseColor.rgb *= vec3(1.12, 1.10, 1.04);
          float scanAngle = atan(vCanopyUv.y - 0.5, vCanopyUv.x - 0.5);
          float scanDelta = abs(mod(scanAngle - uScanAngle + 3.14159265, 6.2831853) - 3.14159265);
          float scanBand = exp(-scanDelta * scanDelta * 720.0) * uScanIntensity;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.39, 0.54, 0.48), scanBand * 0.10);
          float audioRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
          float audioRingDelta = (audioRadius - (0.18 + uAudioLevel * 0.42)) * 19.0;
          float audioRing = exp(-audioRingDelta * audioRingDelta);
          float waveRadius = 0.08 + fract(uAudioTime * 0.34) * 0.78;
          float waveDelta = (audioRadius - waveRadius) * 24.0;
          float travelingWave = exp(-waveDelta * waveDelta) * uAudioLevel;
          float audioTint = clamp(uAudioLevel * (0.28 + audioRing * 0.42) + travelingWave * 0.34, 0.0, 0.58);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.61, 0.54), audioTint);
          diffuseColor.rgb += vec3(0.09, 0.11, 0.085) * uAudioLevel + vec3(0.08, 0.12, 0.095) * travelingWave;`);
    };
    material.customProgramCacheKey = () => "jiangnan-canopy-gpu-ink-v6-audio";
    return material;
  }

  createProceduralUmbrella() {
    this.removeModel();
    this.foldProgress = 0;
    this.foldTween = null;
    this.ribPivots = [];
    this.braceLinks = [];
    this.bracePins = [];
    const root = new THREE.Group();
    const canopy = new THREE.Mesh(this.createCanopyGeometry(), this.createCanopyMaterial());
    canopy.name = "silk-canopy";
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    root.add(canopy);
    this.canopyMesh = canopy;
    this.createClosedBundleTies(root);
    this.dynamicMaterials = [canopy.material];

    const bamboo = new THREE.MeshPhysicalMaterial({
      color: "#94764e", roughness: 0.7, metalness: 0,
      clearcoat: 0.035, clearcoatRoughness: 0.88
    });
    const bambooLight = new THREE.MeshStandardMaterial({ color: "#c3aa7c", roughness: 0.76 });
    const seamMaterial = new THREE.MeshStandardMaterial({ color: "#a8936d", roughness: 0.88 });
    for (let rib = 0; rib < RIBS; rib += 1) {
      const angle = -Math.PI / 2 + rib * Math.PI * 2 / RIBS;
      const radialAxis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
      const frame = new THREE.Group();
      frame.position.y = CANOPY_HEIGHT;
      frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(radialAxis, new THREE.Vector3(0, 1, 0), tangent));
      const foldPivot = new THREE.Group();
      frame.add(foldPivot);
      this.ribPivots.push({ fold: foldPivot });
      root.add(frame);
      const anchor = new THREE.Vector3(0, CANOPY_HEIGHT, 0);
      const supportPoints = [];
      const seamPoints = [];
      const toRibLocal = (point) => {
        const delta = point.sub(anchor);
        return new THREE.Vector3(delta.dot(radialAxis), delta.y, delta.dot(tangent));
      };
      for (let step = 0; step <= 28; step += 1) {
        const radius = 0.045 + step / 28 * 0.93;
        // 承力竹骨放在绸面内侧；外侧只留极细的缝线提示骨位。
        supportPoints.push(toRibLocal(this.getCanopyPoint(radius, angle, -0.019)));
        seamPoints.push(toRibLocal(this.getCanopyPoint(radius, angle, 0.0018)));
      }
      const supportCurve = new THREE.CatmullRomCurve3(supportPoints);
      const supportRib = new THREE.Mesh(new THREE.TubeGeometry(supportCurve, 56, rib % 3 === 0 ? 0.008 : 0.0065, 6, false), bamboo);
      supportRib.name = `bamboo-rib-under-${rib + 1}`;
      foldPivot.add(supportRib);

      const seamCurve = new THREE.CatmullRomCurve3(seamPoints);
      const seam = new THREE.Mesh(new THREE.TubeGeometry(seamCurve, 56, 0.0014, 4, false), seamMaterial);
      seam.name = `silk-rib-seam-${rib + 1}`;
      foldPivot.add(seam);
    }

    // 每根短骨都从伞巢耳轴接到一根主骨。短骨长度保持不变，
    // 伞巢下行时由连杆约束反求主骨转角，避免各零件独立飘动。
    const braceRadius = 0.48;
    const hingeRadius = 0.065;
    const initialRunnerY = -0.17;
    const pinGeometry = new THREE.SphereGeometry(0.013, 10, 8);
    for (let rib = 0; rib < RIBS; rib += 1) {
      const angle = -Math.PI / 2 + rib * Math.PI * 2 / RIBS;
      const axis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const supportPoint = this.getCanopyPoint(braceRadius, angle, -0.025);
      const restRadial = supportPoint.x * axis.x + supportPoint.z * axis.z;
      const restLocalY = supportPoint.y - CANOPY_HEIGHT;
      const restLength = Math.hypot(restRadial - hingeRadius, supportPoint.y - initialRunnerY);
      const link = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0065, 0.008, 1, 8, 1, false),
        bambooLight
      );
      link.name = `bamboo-short-rib-${rib + 1}`;
      link.castShadow = true;
      root.add(link);
      const pin = new THREE.Mesh(pinGeometry, bambooLight);
      pin.name = `short-rib-joint-${rib + 1}`;
      root.add(pin);
      this.braceLinks.push({ angle, axis, link, pin, restRadial, restLocalY, restLength, hingeRadius });
      this.bracePins.push(pin);
    }

    const hemPoints = Array.from({ length: 193 }, (_, index) => this.getCanopyPoint(1, index / 192 * Math.PI * 2, 0.003));
    const hemGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPoints), 384, 0.0055, 7, false);
    this.attachFoldAxes(hemGeometry);
    const hem = new THREE.Mesh(
      hemGeometry,
      new THREE.MeshStandardMaterial({ color: "#a9936b", roughness: 0.82 })
    );
    hem.name = "stitched-canopy-hem";
    root.add(hem);
    this.hem = hem;

    // 伞滑套沿伞柄下行，撑条与主骨同步转动，形成收伞的结构提示。
    const runner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.071, 0.071, 0.052, 20),
      bambooLight
    );
    runner.position.y = -0.17;
    runner.name = "umbrella-runner";
    root.add(runner);
    this.runner = runner;

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.072, 0.11, 20), bamboo);
    hub.position.y = CANOPY_HEIGHT + 0.014;
    hub.name = "umbrella-hub";
    root.add(hub);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.048, 18, 12), bambooLight);
    finial.position.y = CANOPY_HEIGHT + 0.085;
    finial.name = "umbrella-finial";
    root.add(finial);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.023, 1.86, 12), bamboo);
    shaft.position.y = -0.55;
    shaft.name = "bamboo-shaft";
    root.add(shaft);
    // 竹节以浅色细箍表示真实竹材的段落，伞巢沿这根竹杆滑动。
    [-0.34, -0.69, -1.04, -1.31].forEach((y, index) => {
      const node = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0036, 6, 18), bambooLight);
      node.rotation.x = Math.PI / 2;
      node.position.y = y;
      node.name = `bamboo-internode-${index + 1}`;
      root.add(node);
    });
    // 西湖绸伞的原型采用连续直竹柄，不再让另一个弯钩零件从主杆末端悬出。
    const straightGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.029, 0.56, 14), bamboo);
    straightGrip.position.y = -1.72;
    straightGrip.name = "straight-bamboo-grip";
    root.add(straightGrip);
    [-1.53, -1.91].forEach((y, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.003, 6, 20), bambooLight);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      ring.name = `handle-grip-ring-${index + 1}`;
      root.add(ring);
    });

    root.name = "procedural-west-lake-umbrella";
    this.prepareFoldableRibs(root);
    this.scene.add(root);
    this.modelRoot = root;
    this.modelKind = "procedural";
    this.supportsFolding = true;
    this.captureModelVisualState(root);
    this.applyFoldProgress(0, false);
    this.resetCamera();
    this.renderOnce();
  }

  captureModelVisualState(root) {
    this.modelMeshes = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const originalVisibility = object.visible;
      materials.forEach((material) => {
        if (!material || material.userData.modelOriginal) return;
        material.userData.modelOriginal = {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite
        };
      });
      this.modelMeshes.push({ object, materials, originalVisibility });
    });
  }

  restoreModelVisualState() {
    this.modelMeshes.forEach(({ object, materials, originalVisibility }) => {
      object.visible = originalVisibility;
      materials.forEach((material) => {
        if (!material) return;
        const original = material.userData.modelOriginal;
        if (!original) return;
        material.opacity = original.opacity;
        material.transparent = original.transparent;
        material.depthWrite = original.depthWrite;
      });
    });
  }
  createClosedBundleTies(root) {
    // Subtle silk bindings help the closing pose read as a held bamboo bundle,
    // not a ring of exposed ribs. They are hidden while open and tighten near
    // the end of the fold animation.
    const material = new THREE.MeshStandardMaterial({
      color: 0x9f6d5b,
      roughness: 0.78,
      metalness: 0.02
    });
    this.closedBundleTies = [0.25, 0.5, 0.75].map((radius, index) => {
      const foldedRadius = (0.046 + radius * 0.085) * 0.68;
      const tie = new THREE.Mesh(new THREE.TorusGeometry(foldedRadius, 0.008, 8, 48), material);
      tie.name = `closed-silk-binding-${index + 1}`;
      tie.rotation.x = Math.PI / 2;
      tie.position.y = CANOPY_HEIGHT - RADIUS * radius;
      tie.scale.setScalar(0.001);
      tie.visible = false;
      root.add(tie);
      return tie;
    });
  }

  updateClosedBundleTies(fold) {
    const tightness = smoothstep(0.76, 0.96, fold);
    this.closedBundleTies.forEach((tie) => {
      tie.visible = tightness > 0.002;
      tie.scale.setScalar(Math.max(0.001, tightness));
    });
  }

  prepareFoldableRibs(root) {
    this.foldableRibs = [];
    root.traverse((object) => {
      if (!object.isMesh || !/^(?:bamboo-main-rib|bamboo-rib-under|silk-rib-seam)/i.test(object.name)) return;
      const position = object.geometry?.attributes?.position;
      if (!position) return;
      const originalY = new Float32Array(position.count);
      const canopyCurveY = new Float32Array(position.count);
      for (let index = 0; index < position.count; index += 1) {
        const x = Math.max(0, position.getX(index));
        originalY[index] = position.getY(index);
        // The rib's open canopy bow becomes a sideways flare when its pivot
        // turns toward the shaft. Flatten only that centerline curve as it
        // folds, while preserving the tube's small cross-section thickness.
        canopyCurveY[index] = -CANOPY_HEIGHT * (x / RADIUS) ** 2;
      }
      this.foldableRibs.push({ object, originalY, canopyCurveY });
    });
  }

  applyRibStraightening(fold) {
    this.foldableRibs.forEach(({ object, originalY, canopyCurveY }) => {
      const position = object.geometry.attributes.position;
      for (let index = 0; index < position.count; index += 1) {
        position.setY(index, originalY[index] - canopyCurveY[index] * fold);
      }
      position.needsUpdate = true;
      object.geometry.computeVertexNormals();
    });
  }

  async toggleAmbientMusic() {
    if (!this.ambientMusic) this.ambientMusic = new AmbientMusic();
    const playing = await this.ambientMusic.toggle();
    this.audioContext = this.ambientMusic.context;
    this.audioAnalyser = this.ambientMusic.analyser;
    this.audioData = this.ambientMusic.frequencyData;
    this.setActive(true);
    return playing;
  }

  updateAudioReactive() {
    if (this.audioAnalyser && this.audioData && this.ambientMusic?.playing) {
      this.audioAnalyser.getByteFrequencyData(this.audioData);
      const count = Math.max(3, Math.min(18, Math.floor(this.audioData.length * 0.08)));
      let energy = 0;
      let peak = 0;
      for (let index = 1; index < count; index += 1) {
        const value = this.audioData[index] / 255;
        energy += value * value;
        peak = Math.max(peak, value);
      }
      const bassRms = Math.sqrt(energy / (count - 1));
      const target = THREE.MathUtils.clamp(Math.max((bassRms - 0.055) * 4.3, (peak - 0.065) * 1.9), 0, 1);
      this.audioLevel += (target - this.audioLevel) * (target > this.audioLevel ? 0.32 : 0.12);
      this.audioFloor += (bassRms - this.audioFloor) * 0.018;
      const transient = THREE.MathUtils.clamp((peak - Math.max(this.audioFloor * 1.55, 0.11)) * 2.8, 0, 1);
      this.audioPulse = Math.max(transient, this.audioPulse * 0.91);
      [[1, 3], [4, 7], [8, 13], [14, 21]].forEach(([start, end], band) => {
        let bandPeak = 0;
        for (let index = start; index <= end; index += 1) bandPeak = Math.max(bandPeak, this.audioData[index] / 255);
        const bandTarget = THREE.MathUtils.clamp((bandPeak - 0.04) * 2.2, 0.08, 1);
        this.audioBands[band] += (bandTarget - this.audioBands[band]) * (bandTarget > this.audioBands[band] ? 0.48 : 0.2);
      });
    } else {
      this.audioLevel *= 0.9;
      this.audioPulse *= 0.86;
      this.audioBands = this.audioBands.map((value) => value * 0.86);
    }
    this.audioTime = performance.now() * 0.001;
    const visualLevel = THREE.MathUtils.clamp(this.audioLevel * 0.68 + this.audioPulse * 0.76, 0, 1);
    this.audioMeterBars.forEach((bar, index) => { bar.style.transform = `scaleY(${0.18 + this.audioBands[index] * 0.82})`; });
    this.audioFillLight.intensity = 0.58 + visualLevel * 1.2;
    this.ambientLight.intensity = 1.45 + visualLevel * 0.38;
    const mist = document.querySelector(".scenery-mist");
    if (mist) mist.style.opacity = String(0.34 + visualLevel * 0.34);
    const backdrop = document.querySelector(".scenery-backdrop");
    if (backdrop) backdrop.style.setProperty("--audio-response", String(this.ambientMusic?.playing ? visualLevel : 0));
    this.dynamicMaterials.forEach((material) => {
      const uniforms = material?.userData?.dynamicUniforms;
      if (uniforms?.uAudioLevel) uniforms.uAudioLevel.value = visualLevel;
      if (uniforms?.uAudioTime) uniforms.uAudioTime.value = this.audioTime;
      // Let sound gently change the silk sheen and roughness under real lights.
      if (material?.isMeshPhysicalMaterial) {
        const baseRoughness = material.userData.audioBaseRoughness ?? 0.72;
        const baseSheen = material.userData.audioBaseSheen ?? 0.48;
        material.roughness = baseRoughness - visualLevel * 0.2;
        material.sheen = baseSheen + visualLevel * 0.42;
      }
    });
  }

  async dispose() {
    this.active = false;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    await this.ambientMusic?.dispose();
    this.removeModel();
    this.inkFluid?.dispose();
    this.canvasTexture?.dispose();
    this.normalTexture?.dispose();
    this.roughnessTexture?.dispose();
    this.renderer.dispose();
  }

  removeModel() {
    if (!this.modelRoot) return;
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.foldAction = null;
    this.foldClip = null;
    this.scene.remove(this.modelRoot);
    const geometries = new Set();
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      if (!object.userData.sharedGeometry && object.geometry) geometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // dispose() 只释放材质程序；共享的 CanvasTexture 与法线图由预览器统一持有。
      materials.forEach((material) => material?.dispose());
    });
    geometries.forEach((geometry) => geometry.dispose());
    this.modelTextures.forEach((texture) => texture.dispose());
    this.modelTextures.clear();
    this.modelRoot = null;
    this.dynamicMaterials = [];
    this.canopyMesh = null;
    this.ribPivots = [];
    this.braceLinks = [];
    this.bracePins = [];
    this.runner = null;
    this.hem = null;
    this.modelMeshes = [];
    this.closedBundleTies = [];
    this.foldableRibs = [];
  }

  solveBraceAngle(runnerY) {
    const brace = this.braceLinks[0];
    if (!brace) return -Math.PI / 2;
    const gapAt = (magnitude) => {
      const angle = -magnitude;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const radial = brace.restRadial * cosine - brace.restLocalY * sine;
      const localY = brace.restRadial * sine + brace.restLocalY * cosine;
      const worldY = CANOPY_HEIGHT + localY;
      return Math.hypot(radial - brace.hingeRadius, worldY - runnerY) - brace.restLength;
    };
    if (gapAt(0) <= 0.0001) return 0;
    let lower = 0;
    let upper = Math.PI / 2;
    let found = false;
    for (let step = 1; step <= 48; step += 1) {
      const candidate = (Math.PI / 2) * step / 48;
      if (gapAt(candidate) <= 0) {
        upper = candidate;
        lower = (Math.PI / 2) * (step - 1) / 48;
        found = true;
        break;
      }
    }
    if (!found) return -upper;
    for (let step = 0; step < 20; step += 1) {
      const middle = (lower + upper) * 0.5;
      if (gapAt(middle) > 0) lower = middle;
      else upper = middle;
    }
    return -(lower + upper) * 0.5;
  }

  deformFoldGeometry(geometry, angle, radialFactor, tangentFactor) {
    if (!geometry) return;
    const position = geometry.attributes.position;
    const rest = geometry.userData.foldRestPositions;
    const foldCos = geometry.userData.foldCos;
    const foldSin = geometry.userData.foldSin;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      const x = rest[offset];
      const y = rest[offset + 1] - CANOPY_HEIGHT;
      const z = rest[offset + 2];
      const axisCos = foldCos[index];
      const axisSin = foldSin[index];
      const radial = x * axisCos + z * axisSin;
      const tangent = -x * axisSin + z * axisCos;
      const foldedRadial = (radial * cosAngle - y * sinAngle) * radialFactor;
      const foldedTangent = tangent * tangentFactor;
      const foldedY = radial * sinAngle + y * cosAngle;
      position.array[offset] = foldedRadial * axisCos - foldedTangent * axisSin;
      position.array[offset + 1] = CANOPY_HEIGHT + foldedY;
      position.array[offset + 2] = foldedRadial * axisSin + foldedTangent * axisCos;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  applyFoldProgress(progress, render = true) {
    this.foldProgress = clamp01(progress);
    const fold = smoothstep(0, 1, this.foldProgress);
    this.updateClosedBundleTies(fold);
    // Keep the runner inside the short ribs' travel range. The previous 1.22 m
    // displacement exceeded the linkage reach and forced ribs to their limit.
    const runnerY = -0.17 - fold * 0.545;
    // 伞体从展开的大伞面变为细长竹节束时，视线跟随作品重心缓慢下移。
    this.controls.target.y = -0.12 - fold * 0.34;
    if (this.modelKind === "glb" && this.foldAction && this.foldClip) {
      this.foldAction.time = this.foldClip.duration * this.foldProgress;
      this.mixer?.update(0);
      this.restoreModelVisualState();
      this.onFoldProgress?.(this.foldProgress);
      if (render) this.renderOnce();
      return;
    }
    const angle = this.solveBraceAngle(runnerY);
    // 竹制主骨保持长度，只绕伞心转动；绸面在相邻骨位之间向内收褶。
    const radialFactor = 1;
    const tangentFactor = 1 - fold * 0.93;
    this.currentFoldAngle = angle;
    this.currentTangentFactor = tangentFactor;
    if (this.modelKind !== "glb") this.applyRibStraightening(fold);
    this.ribPivots.forEach(({ fold: foldPivot }) => { foldPivot.rotation.z = angle; });
    this.deformFoldGeometry(this.canopyMesh?.geometry, angle, radialFactor, tangentFactor);

    if (this.runner) {
      this.runner.position.y = runnerY;
      this.runner.scale.setScalar(1 + fold * 0.04);
    }
    this.deformFoldGeometry(this.hem?.geometry, angle, radialFactor, tangentFactor);

    this.braceLinks.forEach((brace) => {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const radial = brace.restRadial * cosine - brace.restLocalY * sine;
      const localY = brace.restRadial * sine + brace.restLocalY * cosine;
      const end = new THREE.Vector3(
        brace.axis.x * radial,
        CANOPY_HEIGHT + localY,
        brace.axis.z * radial
      );
      const start = new THREE.Vector3(
        brace.axis.x * brace.hingeRadius,
        runnerY,
        brace.axis.z * brace.hingeRadius
      );
      const direction = end.clone().sub(start);
      const length = Math.max(0.001, direction.length());
      brace.link.position.copy(start).add(end).multiplyScalar(0.5);
      brace.link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      brace.link.scale.set(1, length, 1);
      brace.pin.position.copy(end);
    });

    this.restoreModelVisualState();

    this.onFoldProgress?.(this.foldProgress);
    if (render) this.renderOnce();
  }

  setFoldProgress(progress) {
    if (!this.supportsFolding) return;
    this.foldTween = null;
    this.applyFoldProgress(progress);
  }

  animateFoldTo(progress, duration = 1800) {
    if (!this.supportsFolding) return;
    this.foldTween = {
      from: this.foldProgress,
      to: clamp01(progress),
      startedAt: performance.now(),
      duration: Math.max(1, duration)
    };
  }

  getFoldTarget() {
    return this.foldTween?.to ?? this.foldProgress;
  }

  updateFoldTween(now) {
    if (!this.foldTween) return;
    const tween = this.foldTween;
    const linear = clamp01((now - tween.startedAt) / tween.duration);
    const eased = linear * linear * (3 - 2 * linear);
    this.applyFoldProgress(tween.from + (tween.to - tween.from) * eased, false);
    if (linear >= 1) this.foldTween = null;
  }

  setArtworkCanvas(canvas, revision = null) {
    if (this.canvasTexture && revision !== null && revision === this.textureRevision) return;
    if (!this.canvasTexture) {
      this.canvasTexture = new THREE.CanvasTexture(canvas);
      this.canvasTexture.colorSpace = THREE.SRGBColorSpace;
      this.canvasTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.canvasTexture.flipY = true;
      this.canvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.canvasTexture.magFilter = THREE.LinearFilter;
      this.canvasTexture.generateMipmaps = true;
      this.bindCanopyTexture();
    } else {
      this.canvasTexture.image = canvas;
      this.canvasTexture.needsUpdate = true;
    }
    this.textureRevision = revision;
    this.renderOnce();
  }

  bindCanopyTexture() {
    if (!this.modelRoot || !this.canvasTexture) return;
    this.modelRoot.traverse((object) => {
      if (object.name === "silk-canopy" && object.material) {
        object.material.map = this.canvasTexture;
        object.material.needsUpdate = true;
      }
    });
  }

  async loadGLB(file) {
    if (!file || !file.name.toLowerCase().endsWith(".glb")) throw new Error("请选择 Blender 导出的 .glb 文件。");
    const buffer = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, "", resolve, (error) => reject(error || new Error("GLB 读取失败。")));
    });
    return this.installGLTF(gltf);
  }

  async loadGLBURL(url) {
    const loader = new GLTFLoader();
    return this.installGLTF(await loader.loadAsync(url));
  }

  installGLTF(gltf) {
    const root = gltf.scene;
    if (!root) throw new Error("GLB 中没有可显示的场景。");
    const foldClip = (gltf.animations || []).find((clip) => /fold|open|close|umbrella|伞|开|合/i.test(clip.name))
      || (gltf.animations?.length === 1 ? gltf.animations[0] : null);
    const mixer = foldClip ? new THREE.AnimationMixer(root) : null;
    const foldAction = foldClip ? mixer.clipAction(foldClip) : null;
    if (foldAction) {
      foldAction.setLoop(THREE.LoopOnce, 1);
      foldAction.clampWhenFinished = true;
      foldAction.play();
      foldAction.paused = true;
      foldAction.time = 0;
      mixer.update(0);
    }
    root.updateMatrixWorld(true);

    const candidates = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      const size = box.getSize(new THREE.Vector3());
      // Match the mesh object name, not the material name. A shared "silk"
      // material is also used on rib seams and must not make those ribs canopy targets.
      const label = object.name.toLowerCase();
      const namedCanopy = /canopy|cloth|fabric|silk[-_ ]?canopy|umbrella[-_ ]?fabric|伞面|伞布|绸面/.test(label)
        && !/rib|seam|hem|edge|trim/.test(label);
      const uv = object.geometry.attributes.uv;
      const hasUV = Boolean(uv && uv.itemSize >= 2 && uv.count === object.geometry.attributes.position.count);
      candidates.push({ object, box, size, namedCanopy, hasUV, score: size.x * size.z });
    });
    if (!candidates.length) throw new Error("GLB 中没有可用的伞面网格。");

    const named = candidates.filter((item) => item.namedCanopy);
    const fallback = candidates
      .filter((item) => item.score > 0.4 && item.size.y < Math.min(item.size.x, item.size.z) * 0.48)
      .sort((a, b) => b.score - a.score)
      .slice(0, 1);
    const targets = named.length ? named : fallback;
    if (!targets.length) throw new Error("未找到可识别的伞面网格。请在 Blender 将伞面命名为 canopy、cloth 或 fabric 后导出 GLB。");
    let generatedUV = false;
    const usedFallback = named.length === 0;
    // Missing UVs get a horizontal planar projection as a fallback, not a
    // radial unwrap. Report this so artists know when the GLB needs real UVs.
    targets.forEach(({ object, box, hasUV }) => {
      if (hasUV) return;
      generatedUV = true;
      const position = object.geometry.attributes.position;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.z) * 0.5 || 1;
      const values = new Float32Array(position.count * 2);
      const point = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        values[index * 2] = THREE.MathUtils.clamp(0.5 + (point.x - center.x) / (radius * 2), 0, 1);
        values[index * 2 + 1] = THREE.MathUtils.clamp(0.5 + (point.z - center.z) / (radius * 2), 0, 1);
      }
      object.geometry.setAttribute("uv", new THREE.BufferAttribute(values, 2));
      object.geometry.attributes.uv.needsUpdate = true;
    });

    const importedTextures = new Set();
    const originalCanopyMaterials = new Set();
    root.traverse((object) => {
      if (!object.isMesh) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      sourceMaterials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => { if (value?.isTexture) importedTextures.add(value); });
      });
    });

    // 选取按名称标记的伞面；未命名时，使用最大水平网格作为纹理接收面。
    const loaderMaterial = this.createCanopyMaterial();
    targets.forEach(({ object }) => {
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      sourceMaterials.forEach((material) => { if (material) originalCanopyMaterials.add(material); });
      const replacement = sourceMaterials.map((sourceMaterial) => {
        const material = loaderMaterial.clone();
        material.map = this.canvasTexture;
        // Keep useful artist-authored cloth detail maps, while the editor's
        // shared silk response remains the fallback for untextured GLBs.
        if (sourceMaterial?.normalMap) material.normalMap = sourceMaterial.normalMap;
        if (sourceMaterial?.roughnessMap) material.roughnessMap = sourceMaterial.roughnessMap;
        if (sourceMaterial?.normalScale) material.normalScale.copy(sourceMaterial.normalScale);
        if (Number.isFinite(sourceMaterial?.roughness)) {
          material.roughness = THREE.MathUtils.clamp(sourceMaterial.roughness, 0.5, 0.92);
        }
        material.userData.audioBaseRoughness = material.roughness;
        material.userData.audioBaseSheen = material.sheen;
        material.metalness = 0;
        material.userData.dynamicUniforms = loaderMaterial.userData.dynamicUniforms;
        material.onBeforeCompile = loaderMaterial.onBeforeCompile;
        material.customProgramCacheKey = loaderMaterial.customProgramCacheKey;
        material.needsUpdate = true;
        return material;
      });
      object.material = Array.isArray(object.material) ? replacement : replacement[0];
    });
    loaderMaterial.dispose();
    const retainedMaterials = new Set();
    root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => { if (material) retainedMaterials.add(material); });
    });
    originalCanopyMaterials.forEach((material) => { if (!retainedMaterials.has(material)) material.dispose(); });

    this.removeModel();
    this.modelTextures = importedTextures;
    this.prepareFoldableRibs(root);
    this.createClosedBundleTies(root);
    const wrapper = new THREE.Group();
    wrapper.name = "imported-blender-umbrella";
    wrapper.add(root);
    wrapper.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wrapper);
    const size = bounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    wrapper.scale.setScalar(3.45 / maxDimension);
    wrapper.updateMatrixWorld(true);
    const centered = new THREE.Box3().setFromObject(wrapper);
    const center = centered.getCenter(new THREE.Vector3());
    wrapper.position.sub(center);
    this.scene.add(wrapper);
    this.modelRoot = wrapper;
    this.modelKind = "glb";
    this.canopyMesh = targets[0]?.object || null;
    this.mixer = mixer;
    this.foldClip = foldClip;
    this.foldAction = foldAction;
    this.supportsFolding = Boolean(foldClip);
    this.foldProgress = 0;
    this.foldTween = null;
    this.dynamicMaterials = [];
    wrapper.traverse((object) => {
      if (!targets.some((target) => target.object === object) || !object.material) return;
      this.dynamicMaterials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
    });
    this.captureModelVisualState(wrapper);
    this.applyFoldProgress(0, false);
    this.syncInkMaterials();
    this.resetCamera();
    this.renderOnce();
    return {
      meshes: targets.length,
      animatedFold: Boolean(foldClip),
      generatedUV,
      usedFallback,
      canopyNames: targets.map(({ object }) => object.name || "未命名网格")
    };
  }

  resetCamera() {
    // Start close to top-down so the round silk canopy reads as a circle;
    // users can still orbit to inspect its curvature and underside.
    this.camera.position.set(0.15, 6.2, 0.2);
    this.controls.target.set(0, -0.12, 0);
    this.controls.update();
  }

  playViewTransition(duration = 920) {
    // Restore the original 3D reveal: the camera glides down from above the
    // umbrella to its current viewing angle whenever the user enters 3D.
    const target = this.controls.target.clone();
    const destination = this.camera.position.clone();
    const from = new THREE.Vector3(target.x, target.y + 7.4, target.z + 0.05);
    this.camera.position.copy(from);
    this.camera.lookAt(target);
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.cameraTween = { startedAt: performance.now(), duration, target, from, destination };
  }

  resetProceduralModel() {
    this.createProceduralUmbrella();
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderOnce();
  }

  renderOnce() {
    if (!this.renderer || !this.host.clientWidth || !this.host.clientHeight) return;
    if (this.displayMode === "fluid") {
      this.inkFluid?.renderOverlay();
    }
    else { this.syncInkMaterials(); this.renderer.render(this.scene, this.camera); }
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.lastFrameAt = 0;
      window.clearTimeout(this.autoRotateTimer);
      this.controls.autoRotate = true;
      return;
    }
    this.resize();
    this.scanStartedAt = performance.now();
    if (this.frameHandle) return;
    const frame = () => {
      if (!this.active) { this.frameHandle = 0; return; }
      const now = performance.now();
      const deltaSeconds = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.05) : 1 / 60;
      this.lastFrameAt = now;
      this.updateFoldTween(now);
      this.updateFlowField(now);
      this.updateAudioReactive();
      if (this.displayMode === "fluid") {
        this.inkFluid?.renderOverlay();
        if (this.inkFluid?.isSettled(now) && !this.foldTween) { this.frameHandle = 0; return; }
        this.frameHandle = requestAnimationFrame(frame);
        return;
      }
      if (this.cameraTween) {
        const tween = this.cameraTween;
        const linear = clamp01((performance.now() - tween.startedAt) / tween.duration);
        const eased = linear * linear * (3 - 2 * linear);
        this.camera.position.lerpVectors(tween.from, tween.destination, eased);
        this.camera.lookAt(tween.target);
        if (linear >= 1) {
          this.cameraTween = null;
          this.controls.enabled = true;
          this.controls.autoRotate = true;
          this.controls.update();
        }
      } else this.controls.update(deltaSeconds);
      this.mixer?.update(0);
      this.renderer.render(this.scene, this.camera);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  async savePNG(filename = "jiangnan-umbrella-3d.png") {
    this.renderOnce();
    const source = this.renderer.domElement;
    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    const backdrop = context.createLinearGradient(0, 0, 0, output.height);
    backdrop.addColorStop(0, "#edf1e9");
    backdrop.addColorStop(0.58, "#edf0e7");
    backdrop.addColorStop(1, "#e0e8df");
    context.fillStyle = backdrop;
    context.fillRect(0, 0, output.width, output.height);
    context.save();
    context.globalAlpha = 0.22;
    context.fillStyle = "#bdcfc1";
    context.beginPath();
    context.moveTo(0, output.height * 0.72);
    context.bezierCurveTo(output.width * 0.12, output.height * 0.61, output.width * 0.17, output.height * 0.69, output.width * 0.3, output.height * 0.58);
    context.bezierCurveTo(output.width * 0.42, output.height * 0.47, output.width * 0.49, output.height * 0.71, output.width * 0.62, output.height * 0.59);
    context.bezierCurveTo(output.width * 0.77, output.height * 0.46, output.width * 0.84, output.height * 0.68, output.width, output.height * 0.55);
    context.lineTo(output.width, output.height);
    context.lineTo(0, output.height);
    context.closePath();
    context.fill();
    context.restore();
    context.drawImage(source, 0, 0);
    const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("3D 图片生成失败，请再试一次。");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}
