// Three.js 只负责 3D 展示；Canvas 中的 ArtworkDocument 仍是唯一作品数据源。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { InkFluidSystem } from "./InkFluidSystem.js?v=20261030-calligraphy-soft-v15";
import { AmbientMusic } from "../features/AmbientMusic.js";

const RADIUS = 1.78;
// Keep the canopy folds aligned to the 36-bone layout used by the artwork.
const RIBS = 36;
const CANOPY_HEIGHT = 0.4;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const LEGACY_FABRIC_MATERIALS = Object.freeze({
  scenery: "georgette", painting: "plainSilk", embroidery: "denseSilk",
  silk: "plainSilk", gauze: "georgette", indigo: "denseSilk", blueCloth: "denseSilk", satin: "plainSilk", damask: "denseSilk"
});
const normalizeFabricMaterial = (material) => {
  const normalized = LEGACY_FABRIC_MATERIALS[material] || material;
  return Object.hasOwn(FABRIC_PROFILES, normalized) ? normalized : "georgette";
};
const FABRIC_PROFILES = Object.freeze({
  georgette: {
    // Light georgette: softly matte, with a restrained weave and dye color that
    // remains visible from both sides of the canopy.
    crown: 0.014, pleat: 0.0022, edge: -0.005, panelTension: 0.001,
    roughness: 0.92, sheen: 0.13, sheenRoughness: 0.97, specular: 0.035, normal: 0.18, anisotropy: 0,
    relief: 0.11, roughMap: 250, roughContrast: 3, transmission: 0.92,
    studioRoughness: 0.91, studioSheen: 0.075, studioNormal: 0.075, studioSpecular: 0.018, studioWeave: 0.038
  },
  plainSilk: {
    // Plain silk has a gentle broad sheen, without satin-like highlights.
    crown: 0.014, pleat: 0.0026, edge: -0.007, panelTension: 0.0015,
    roughness: 0.90, sheen: 0.16, sheenRoughness: 0.96, specular: 0.042, normal: 0.20, anisotropy: 0,
    relief: 0.14, roughMap: 249, roughContrast: 4, transmission: 0.85,
    studioRoughness: 0.90, studioSheen: 0.085, studioNormal: 0.08, studioSpecular: 0.02, studioWeave: 0.042
  },
  denseSilk: {
    // Dense silk keeps the quietest highlights and a more legible woven grain.
    crown: 0.017, pleat: 0.0034, edge: -0.010, panelTension: 0.0024,
    roughness: 0.94, sheen: 0.11, sheenRoughness: 0.98, specular: 0.03, normal: 0.17, anisotropy: 0,
    relief: 0.10, roughMap: 251, roughContrast: 3, transmission: 0.78,
    studioRoughness: 0.94, studioSheen: 0.06, studioNormal: 0.09, studioSpecular: 0.016, studioWeave: 0.048
  }
});
const PRESENTATION_LIGHTING = Object.freeze({
  // Keep the homepage's original exposure and mood. Its umbrella is part of
  // the lake scene, so it should not inherit the brighter studio treatment.
  home: Object.freeze({
    ambient: 1.2, sky: "#fffdf7", ground: "#d1ddd5",
    keyColor: "#fff3dc", key: 0.82,
    fillColor: "#d7e8e0", fill: 0.32,
    undersideColor: "#e9e4d8", underside: 0.18
  }),
  // The studio needs enough neutral bounce to show the actual selected dye on
  // both sides of the thin canopy. The homepage preset above remains untouched.
  studio: Object.freeze({
    ambient: 2.55, sky: "#fffefa", ground: "#ece9df",
    keyColor: "#fffdf8", key: 0.86,
    fillColor: "#edf4f0", fill: 0.96,
    undersideColor: "#fffdf7", underside: 2.25,
    // Georgette is thin enough to show a soft transmitted-light response.
    // Keep it as a diffuse bounce, not a glossy highlight.
    fabricLift: 1
  })
});

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
    this.fabricMaterial = "georgette";
    this.canopyShapeTargets = [];
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
    // The artwork already uses display-referred sRGB colors. ACES remaps the
    // painted reds and greens, so preserve the authored color values.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const clothAnisotropy = Math.min(6, this.renderer.capabilities.getMaxAnisotropy());
    this.normalTexture.anisotropy = clothAnisotropy;
    this.roughnessTexture.anisotropy = clothAnisotropy;
    this.renderer.domElement.setAttribute("aria-label", "可旋转的西湖绸伞三维预览");
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);
    this.pointerRaycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.backgroundPointerHandler = null;
    this.activeUmbrellaPointerId = null;
    this.onCanvasPointerDown = (event) => {
      // The full-size transparent canvas sits over the home lake. Only the
      // actual umbrella should capture a gesture; empty canvas space belongs
      // to the water interaction underneath it.
      if (this.host?.id !== "homeUmbrellaHost" || event.pointerType === "touch" || event.button !== 0) return;
      if (this.hitTestClientPoint(event.clientX, event.clientY)) {
        this.activeUmbrellaPointerId = event.pointerId;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.backgroundPointerHandler?.(event);
    };
    this.onUmbrellaPointerEnd = (event) => {
      if (event.pointerId === this.activeUmbrellaPointerId) this.activeUmbrellaPointerId = null;
    };
    this.renderer.domElement.addEventListener("pointerdown", this.onCanvasPointerDown, true);
    window.addEventListener("pointerup", this.onUmbrellaPointerEnd, true);
    window.addEventListener("pointercancel", this.onUmbrellaPointerEnd, true);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    this.camera.position.set(0.01, 5.5, 0.76);
    // Restore broad diffuse fill for pale silk. Gloss remains suppressed by the
    // canopy's roughness/specular settings, so brighter cloth does not become shiny.
    this.ambientLight = new THREE.HemisphereLight(
      PRESENTATION_LIGHTING.home.sky,
      PRESENTATION_LIGHTING.home.ground,
      PRESENTATION_LIGHTING.home.ambient
    );
    this.scene.add(this.ambientLight);

    const keyLight = new THREE.DirectionalLight(PRESENTATION_LIGHTING.home.keyColor, PRESENTATION_LIGHTING.home.key);
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
    this.keyLight = keyLight;
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(PRESENTATION_LIGHTING.home.fillColor, PRESENTATION_LIGHTING.home.fill);
    fillLight.position.set(4, 2.4, -3.5);
    this.audioFillLight = fillLight;
    this.audioFillBaseIntensity = PRESENTATION_LIGHTING.home.fill;
    this.scene.add(fillLight);
    const undersideFill = new THREE.DirectionalLight(PRESENTATION_LIGHTING.home.undersideColor, PRESENTATION_LIGHTING.home.underside);
    undersideFill.position.set(2.2, -3.4, 1.8);
    this.undersideFillLight = undersideFill;
    this.scene.add(undersideFill);
    this.activeLighting = PRESENTATION_LIGHTING.home;
    this.applyPresentationLighting(host);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.03, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    // Let users move close enough to inspect cloth and bamboo details while
    // retaining a safe distance that avoids entering the umbrella geometry.
    this.controls.minDistance = 2;
    this.controls.maxDistance = 10;
    this.controls.minPolarAngle = 0.14;
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
      this.autoRotateTimer = window.setTimeout(() => {
        this.controls.autoRotate = this.displayMode === "3d" && this.host?.id !== "threeHost";
      }, 4200);
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
    this.applyPresentationLighting(host);
    if (this.renderer.domElement.parentElement !== host) host.appendChild(this.renderer.domElement);
    this.resize();
    if (this.displayMode === "fluid") {
      this.inkFluid?.renderOverlay();
    }
    return this;
  }

  applyPresentationLighting(host = this.host) {
    const studio = this.displayMode === "3d" && host?.id === "threeHost";
    const preset = studio ? PRESENTATION_LIGHTING.studio : PRESENTATION_LIGHTING.home;
    this.activeLighting = preset;
    this.ambientLight.intensity = preset.ambient;
    this.ambientLight.color.set(preset.sky);
    this.ambientLight.groundColor.set(preset.ground);
    this.keyLight.color.set(preset.keyColor);
    this.keyLight.intensity = preset.key;
    this.audioFillLight.color.set(preset.fillColor);
    this.audioFillBaseIntensity = preset.fill;
    this.audioFillLight.intensity = preset.fill;
    this.undersideFillLight.color.set(preset.undersideColor);
    this.undersideFillLight.intensity = preset.underside;
    this.dynamicMaterials.forEach((material) => {
      const uniform = material?.userData?.dynamicUniforms?.uStudioFabricLift;
      if (uniform) uniform.value = studio ? preset.fabricLift : 0;
      const profile = FABRIC_PROFILES[this.fabricMaterial] || FABRIC_PROFILES.georgette;
      if (material?.normalScale) {
        const normal = studio ? profile.studioNormal : profile.normal;
        material.normalScale.set(normal, normal);
      }
      if (material?.isMeshPhysicalMaterial) {
        material.roughness = studio ? profile.studioRoughness : profile.roughness;
        material.sheen = studio ? profile.studioSheen : profile.sheen;
        material.specularIntensity = studio ? profile.studioSpecular : profile.specular;
      }
      const transmission = material?.userData?.dynamicUniforms?.uStudioFabricTransmission;
      if (transmission) transmission.value = studio ? profile.transmission : 0;
      const weave = material?.userData?.dynamicUniforms?.uStudioWeaveStrength;
      if (weave) weave.value = studio ? profile.studioWeave : 0;
    });
    // In the studio the canopy is a display surface, not a shadow receiver.
    // Keep self-shadowing from ribs and the double-sided cloth from muddying
    // the selected silk color; preserve the original homepage lighting.
    if (this.canopyMesh) {
      this.canopyMesh.castShadow = !studio;
      this.canopyMesh.receiveShadow = false;
    }
    this.syncCanopyPresentationUniforms(host);
  }

  syncCanopyPresentationUniforms(host = this.host) {
    const studio = this.displayMode === "3d" && host?.id === "threeHost";
    const profile = FABRIC_PROFILES[this.fabricMaterial] || FABRIC_PROFILES.georgette;
    this.dynamicMaterials.forEach((material) => {
      const uniforms = material?.userData?.dynamicUniforms;
      if (!uniforms) return;
      if (uniforms.uStudioFabricLift) uniforms.uStudioFabricLift.value = studio ? 1 : 0;
      if (uniforms.uStudioFabricTransmission) uniforms.uStudioFabricTransmission.value = studio ? profile.transmission : 0;
      if (uniforms.uStudioWeaveStrength) uniforms.uStudioWeaveStrength.value = studio ? profile.studioWeave : 0;
    });
  }

  setFabricMaterial(material) {
    const style = normalizeFabricMaterial(material);
    this.fabricMaterial = style;
    const profile = FABRIC_PROFILES[style];
    this.updateFabricDetailMaps(style);
    this.applyCanopyCraftShape(profile);
    this.dynamicMaterials.forEach((material) => {
      if (!material?.isMeshPhysicalMaterial) return;
      material.normalMap = this.normalTexture;
      material.roughnessMap = this.roughnessTexture;
      material.metalness = 0;
      material.envMap = null;
      material.envMapIntensity = 0;
      material.roughness = profile.roughness;
      material.sheen = profile.sheen;
      material.sheenRoughness = profile.sheenRoughness;
      material.sheenColor?.set("#e0e9e2");
      material.specularIntensity = profile.specular;
      material.specularColor?.set("#d5dfd8");
      material.anisotropy = profile.anisotropy;
      material.anisotropyRotation = 0;
      material.clearcoat = 0;
      material.clearcoatRoughness = 1;
      material.transmission = 0;
      material.thickness = 0;
      material.ior = 1.25;
      const studio = this.displayMode === "3d" && this.host?.id === "threeHost";
      const normal = studio ? profile.studioNormal : profile.normal;
      material.normalScale?.set(normal, normal);
      material.roughness = studio ? profile.studioRoughness : profile.roughness;
      material.sheen = studio ? profile.studioSheen : profile.sheen;
      material.specularIntensity = studio ? profile.studioSpecular : profile.specular;
      const uniforms = material.userData?.dynamicUniforms;
      if (uniforms?.uStudioFabricLift) uniforms.uStudioFabricLift.value = studio ? 1 : 0;
      if (uniforms?.uStudioFabricTransmission) uniforms.uStudioFabricTransmission.value = studio ? profile.transmission : 0;
      if (uniforms?.uStudioWeaveStrength) uniforms.uStudioWeaveStrength.value = studio ? profile.studioWeave : 0;
      material.userData.audioBaseRoughness = profile.roughness;
      material.userData.audioBaseSheen = profile.sheen;
      material.userData.audioMaxSheen = profile.sheen + 0.001;
      material.needsUpdate = true;
    });
    this.syncCanopyPresentationUniforms();
    if (this.modelKind === "procedural" && this.foldProgress > 0) this.applyFoldProgress(this.foldProgress, false);
    this.renderOnce();
    return true;
  }

  // Compatibility for older integrations that used the previous selector name.
  setFabricStyle(style) { return this.setFabricMaterial(style); }

  updateFabricDetailMaps(style) {
    const size = this.normalTexture.image.width;
    const normalPixels = this.normalTexture.image.data;
    const roughPixels = this.roughnessTexture.image.data;
    const profile = FABRIC_PROFILES[normalizeFabricMaterial(style)];
    // Shared fine silk weave: alternating warp/weft, without large decorative relief.
    // Avoid a conspicuous regular checker/weave. Fine, low-amplitude crossing
    // fibers and a sparse slub component read as silk instead of old canvas.
    const relief = (x, y) => Math.sin(x * Math.PI / 4.8 + Math.sin(y * 0.11) * 0.16)
        * Math.sin(y * Math.PI / 5.7 + Math.sin(x * 0.13) * 0.14) * 0.16
      + Math.sin((x * 0.71 + y * 0.39) * Math.PI / 9.5) * 0.025
      + Math.sin((x * 13 + y * 7) * 0.37) * 0.012
      + (normalizeFabricMaterial(style) === "denseSilk" ? Math.sin(x * Math.PI / 3.1 + Math.sin(y * 0.18)) * 0.008 : 0);
    const samples = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) samples[y * size + x] = relief(x, y);
    const at = (x, y) => samples[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * profile.relief;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * profile.relief;
        const length = Math.hypot(dx, dy, 1);
        const index = (y * size + x) * 4;
        normalPixels[index] = Math.round(((-dx / length) * 0.56 + 0.5) * 255);
        normalPixels[index + 1] = Math.round(((-dy / length) * 0.56 + 0.5) * 255);
        normalPixels[index + 2] = Math.round((1 / length) * 255);
        normalPixels[index + 3] = 255;
        const textureVariation = samples[y * size + x];
        const value = Math.max(0, Math.min(255, profile.roughMap + textureVariation * profile.roughContrast));
        roughPixels[index] = value;
        roughPixels[index + 1] = value;
        roughPixels[index + 2] = value;
        roughPixels[index + 3] = 255;
      }
    }
    this.normalTexture.needsUpdate = true;
    this.roughnessTexture.needsUpdate = true;
  }

  captureCanopyShapeTargets(meshes) {
    this.canopyShapeTargets = [];
    const targets = meshes.filter((mesh) => mesh?.isMesh && !mesh.isSkinnedMesh);
    targets.forEach((mesh) => {
      // Isolate the canopy from any shared GLB geometry before adding the
      // small construction-specific tension profile.
      mesh.geometry = mesh.geometry.clone();
      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      const rest = geometry.userData.foldRestPositions || position.array;
      this.canopyShapeTargets.push({
        mesh,
        geometry,
        rest: new Float32Array(rest),
        hasFoldRest: Boolean(geometry.userData.foldRestPositions)
      });
    });
    this.applyCanopyCraftShape();
  }

  applyCanopyCraftShape(profile = FABRIC_PROFILES[this.fabricMaterial] || FABRIC_PROFILES.georgette) {
    if (!this.canopyShapeTargets?.length) return;
    const bounds = new THREE.Box3();
    const worldPoint = new THREE.Vector3();
    this.canopyShapeTargets.forEach(({ mesh, rest }) => {
      mesh.updateWorldMatrix(true, false);
      for (let index = 0; index < rest.length; index += 3) {
        worldPoint.set(rest[index], rest[index + 1], rest[index + 2]).applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(worldPoint);
      }
    });
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.5 || RADIUS;
    const inverse = new THREE.Matrix4();
    const shapedWorld = new THREE.Vector3();
    const position = new THREE.Vector3();

    this.canopyShapeTargets.forEach(({ mesh, geometry, rest, hasFoldRest }) => {
      mesh.updateWorldMatrix(true, false);
      inverse.copy(mesh.matrixWorld).invert();
      const attribute = geometry.attributes.position;
      for (let index = 0; index < attribute.count; index += 1) {
        const offset = index * 3;
        position.set(rest[offset], rest[offset + 1], rest[offset + 2]).applyMatrix4(mesh.matrixWorld);
        const dx = position.x - center.x;
        const dz = position.z - center.z;
        const radial = THREE.MathUtils.clamp(Math.hypot(dx, dz) / radius, 0, 1.08);
        const angle = Math.atan2(dz, dx);
        // Preserve the construction axis: every cloth pleat stays aligned to
        // its bamboo rib instead of rotating between craft presets.
        const foldWave = Math.cos(angle * RIBS) * Math.pow(radial, 1.85);
        const crown = profile.crown * (1 - radial * radial);
        const radialPleat = foldWave * (profile.pleat * 0.34 + profile.panelTension * smoothstep(0.36, 1, radial));
        const hemTurn = profile.edge * smoothstep(0.92, 1.035, radial);
        const panelSag = -(1 - Math.abs(foldWave)) * profile.panelTension * smoothstep(0.62, 1, radial);
        shapedWorld.set(
          center.x + dx + Math.cos(angle) * radialPleat,
          position.y + crown + foldWave * profile.pleat * 2.65 + panelSag + hemTurn,
          center.z + dz + Math.sin(angle) * radialPleat
        ).applyMatrix4(inverse);
        attribute.setXYZ(index, shapedWorld.x, shapedWorld.y, shapedWorld.z);
      }
      attribute.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      if (hasFoldRest) geometry.userData.foldRestPositions = new Float32Array(attribute.array);
    });
  }

  setBackgroundPointerHandler(handler) {
    this.backgroundPointerHandler = typeof handler === "function" ? handler : null;
  }

  hitTestClientPoint(clientX, clientY) {
    if (this.host?.id === "homeUmbrellaHost" && this.activeUmbrellaPointerId !== null) return true;
    if (!this.modelRoot || !this.renderer?.domElement || !this.camera) return false;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height || clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return false;
    this.pointerNdc.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    this.camera.updateMatrixWorld();
    this.modelRoot.updateMatrixWorld(true);
    this.pointerRaycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.pointerRaycaster.intersectObject(this.modelRoot, true).length > 0;
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
    // Fine, slightly irregular warp/weft relief. Keep the variation textile-like
    // so the cloth catches broad light without a plastic highlight or noise.
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    const weave = (x, y) => {
      const warp = Math.sin((x + 0.45 * Math.sin(y * 0.17)) * Math.PI / 4.8);
      const weft = Math.sin((y + 0.38 * Math.sin(x * 0.15)) * Math.PI / 5.6);
      const slub = Math.sin((x * 0.73 + y * 0.41) * Math.PI / 11);
      return 0.19 * warp * weft + 0.045 * slub;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (weave(x + 1, y) - weave(x - 1, y)) * 0.5;
        const dy = (weave(x, y + 1) - weave(x, y - 1)) * 0.5;
        const length = Math.hypot(dx, dy, 1);
        const index = (y * size + x) * 4;
        pixels[index] = Math.round(((-dx / length) * 0.64 + 0.5) * 255);
        pixels[index + 1] = Math.round(((-dy / length) * 0.64 + 0.5) * 255);
        pixels[index + 2] = Math.round((1 / length) * 255);
        pixels[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 10);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  createSilkRoughnessTexture() {
    // Keep the roughness map close to white: Three.js multiplies it by the
    // scalar roughness, so darker values would quietly turn the cloth glossy.
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const thread = Math.sin(x * Math.PI / 4.8) * Math.sin(y * Math.PI / 5.6);
        const grain = Math.sin((x * 13 + y * 7) * 0.37) * 0.5;
        const value = Math.round(247 + thread * 2.2 + grain * 1.4);
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
    texture.repeat.set(10, 10);
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
    const profile = FABRIC_PROFILES[this.fabricMaterial] || FABRIC_PROFILES.georgette;
    const material = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      map: this.canvasTexture,
      normalMap: this.normalTexture,
      normalScale: new THREE.Vector2(profile.normal, profile.normal),
      roughnessMap: this.roughnessTexture,
      roughness: profile.roughness,
      metalness: 0,
      envMap: null,
      envMapIntensity: 0,
      sheen: profile.sheen,
      sheenRoughness: profile.sheenRoughness,
      sheenColor: new THREE.Color("#e0e9e2"),
      specularIntensity: profile.specular,
      specularColor: new THREE.Color("#d5dfd8"),
      anisotropy: profile.anisotropy,
      anisotropyRotation: 0,
      clearcoat: 0,
      clearcoatRoughness: 1,
      transmission: 0,
      thickness: 0,
      ior: 1.25,
      side: THREE.DoubleSide
    });
    const dynamicUniforms = {
      uAudioLevel: { value: 0 },
      uAudioTime: { value: 0 },
      uInkDye: { value: this.inkFluid?.dyeTexture || null },
      uInkOpacity: { value: this.inkOpacity },
      uStudioFabricLift: { value: this.displayMode === "3d" && this.host?.id === "threeHost" ? PRESENTATION_LIGHTING.studio.fabricLift : 0 },
      uStudioFabricTransmission: { value: this.displayMode === "3d" && this.host?.id === "threeHost" ? profile.transmission : 0 },
      uStudioWeaveStrength: { value: this.displayMode === "3d" && this.host?.id === "threeHost" ? profile.studioWeave : 0 }
    };
    material.userData.dynamicUniforms = dynamicUniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, dynamicUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uAudioLevel;\nuniform float uAudioTime;\nvarying vec2 vCanopyUv;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCanopyUv = uv;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float canopyRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
          float audioCrease = sin(uAudioTime * 5.0 - canopyRadius * 13.0) * uAudioLevel * 0.002;
          transformed += objectNormal * audioCrease;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uAudioLevel;\nuniform float uAudioTime;\nuniform sampler2D uInkDye;\nuniform float uInkOpacity;\nuniform float uStudioFabricLift;\nuniform float uStudioFabricTransmission;\nuniform float uStudioWeaveStrength;\nvarying vec2 vCanopyUv;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          vec4 wetInk = texture2D(uInkDye, vCanopyUv);
          // Lower the 3D overlay gain evenly so a single stroke does not show
          // exaggerated wet/dry concentration changes on the curved canopy.
          float wetInkAlpha = clamp(wetInk.a * uInkOpacity * 0.78, 0.0, 0.76);
          diffuseColor.rgb = mix(diffuseColor.rgb, wetInk.rgb, wetInkAlpha);
          // Keep the dyed fabric color intact. Studio brightness is supplied
          // as a neutral display floor below rather than tinting the cloth.
        `)
        // Always compile the studio branch. The preview is first created in
        // fluid mode and later moved to #threeHost, so a creation-time host
        // check can leave the 3D canopy stuck on its dark physical-light shader.
        shader.fragmentShader = shader.fragmentShader.replace("#include <colorspace_fragment>", `#include <colorspace_fragment>
          if (uStudioFabricLift > 0.001) {
          const float STUDIO_TAU = 6.28318530718;
          // Use one display conversion from the actual dyed canvas. A soft
          // value curve restores light silk on the underside while preserving
          // the chosen hue and the gentle variations in the artwork.
          float studioWarp = sin((vCanopyUv.x * 74.0 + 0.10 * sin(vCanopyUv.y * 13.0)) * STUDIO_TAU);
          float studioWeft = sin((vCanopyUv.y * 70.0 + 0.08 * sin(vCanopyUv.x * 16.0)) * STUDIO_TAU);
          float studioSlub = sin((vCanopyUv.x * 0.71 + vCanopyUv.y * 0.43) * STUDIO_TAU * 19.0);
          float studioGrain = 1.0 + uStudioWeaveStrength * (0.26 * studioWarp + 0.24 * studioWeft + 0.18 * studioWarp * studioWeft + 0.08 * studioSlub);
          float studioRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
          // Keep the edge softly shaded, never vignetted to a dark outline.
          float studioDome = 1.005 - 0.018 * smoothstep(0.08, 1.0, studioRadius);
          vec3 studioSilk = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.78));
          studioSilk = studioSilk * 1.035 + vec3(0.010, 0.009, 0.006);
          studioSilk = studioSilk * studioGrain * studioDome;
            vec3 studioDisplayColor = linearToOutputTexel(vec4(clamp(studioSilk, 0.0, 1.0), diffuseColor.a)).rgb;
            // A restrained physical contribution keeps the dome readable;
            // no metallic, clearcoat or hard specular shine is added.
            gl_FragColor.rgb = mix(studioDisplayColor, gl_FragColor.rgb, 0.08);
          }
        `);
    };
    material.customProgramCacheKey = () => "jiangnan-canopy-gpu-ink-v35-soft-silk-display";
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
    canopy.castShadow = this.host?.id !== "threeHost";
    canopy.receiveShadow = false;
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
        const radius = 0.045 + step / 28 * 0.98;
        // 淡竹骨压在绸面外侧，并越过伞缘一点；骨位与丝面纹理保持连续。
        supportPoints.push(toRibLocal(this.getCanopyPoint(radius, angle, 0.012)));
        seamPoints.push(toRibLocal(this.getCanopyPoint(radius, angle, 0.018)));
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
    this.baseModelScale = root.scale.clone();
    this.modelKind = "procedural";
    this.captureCanopyShapeTargets([canopy]);
    this.setFabricMaterial(this.fabricMaterial);
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
    const now = performance.now() * 0.001;
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
      const target = THREE.MathUtils.clamp(Math.max((bassRms - 0.04) * 5.2, (peak - 0.05) * 2.5), 0, 1);
      this.audioLevel += (target - this.audioLevel) * (target > this.audioLevel ? 0.36 : 0.14);
      this.audioFloor += (bassRms - this.audioFloor) * 0.018;
      const transient = THREE.MathUtils.clamp((peak - Math.max(this.audioFloor * 1.45, 0.09)) * 3.2, 0, 1);
      this.audioPulse = Math.max(transient, this.audioPulse * 0.91);
      [[1, 3], [4, 7], [8, 13], [14, 21]].forEach(([start, end], band) => {
        let bandPeak = 0;
        for (let index = start; index <= end; index += 1) bandPeak = Math.max(bandPeak, this.audioData[index] / 255);
        const bandTarget = THREE.MathUtils.clamp((bandPeak - 0.035) * 2.8, 0.08, 1);
        this.audioBands[band] += (bandTarget - this.audioBands[band]) * (bandTarget > this.audioBands[band] ? 0.48 : 0.2);
      });
    } else {
      this.audioLevel *= 0.9;
      this.audioPulse *= 0.86;
      this.audioBands = this.audioBands.map((value) => value * 0.86);
    }
    this.audioTime = now;
    const visualLevel = THREE.MathUtils.clamp(this.audioLevel * 0.76 + this.audioPulse * 0.92, 0, 1);
    this.audioMeterBars.forEach((bar, index) => { bar.style.transform = `scaleY(${0.18 + this.audioBands[index] * 0.82})`; });
    // Keep audio response atmospheric. Large fill values wash out the silk weave
    // and make the canopy look polished or reflective.
    this.audioFillLight.intensity = this.audioFillBaseIntensity + visualLevel * 0.01;
    this.audioFillLight.position.set(4, 2.4, -3.5);
    this.ambientLight.intensity = this.activeLighting.ambient + visualLevel * 0.02;
    this.dynamicMaterials.forEach((material) => {
      const uniforms = material?.userData?.dynamicUniforms;
      if (uniforms?.uAudioLevel) uniforms.uAudioLevel.value = visualLevel;
      if (uniforms?.uAudioTime) uniforms.uAudioTime.value = this.audioTime;
      // Music may tint the artwork shader, but never changes the fabric BRDF.
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
    this.renderer.domElement.removeEventListener("pointerdown", this.onCanvasPointerDown, true);
    window.removeEventListener("pointerup", this.onUmbrellaPointerEnd, true);
    window.removeEventListener("pointercancel", this.onUmbrellaPointerEnd, true);
    this.backgroundPointerHandler = null;
    this.activeUmbrellaPointerId = null;
    this.renderer.dispose();
  }

  removeModel() {
    this.canopyShapeTargets = [];
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
    this.artworkCanvas = canvas;
    this.textureRevision = revision;
    this.renderOnce();
  }

  /**
   * Render the current real umbrella model into a transparent handscroll sprite.
   * The returned grip anchor lets the 2D character rig attach its hand to the
   * exact rendered shaft; the same pose is reused by the 3D focus viewer.
   */
  captureGalleryParasolPreview(artworkCanvas, revision, pose = {}) {
    if (!this.modelRoot || !this.canopyMesh || !artworkCanvas) throw new Error("绸伞模型或作品纹理尚未准备好。");

    const renderer = this.renderer;
    const camera = this.camera;
    const root = this.modelRoot;
    const oldTextureCanvas = this.artworkCanvas || this.canvasTexture?.image || null;
    const oldTextureRevision = this.textureRevision;
    const oldPosition = root.position.clone();
    const oldRotation = root.rotation.clone();
    const oldScale = root.scale.clone();
    const oldCameraPosition = camera.position.clone();
    const oldCameraQuaternion = camera.quaternion.clone();
    const oldCameraUp = camera.up.clone();
    const oldCameraAspect = camera.aspect;
    const oldCameraFov = camera.fov;
    const oldTarget = this.controls.target.clone();
    const oldControlsEnabled = this.controls.enabled;
    const oldAutoRotate = this.controls.autoRotate;
    const oldAutoRotateSpeed = this.controls.autoRotateSpeed;
    const oldFoldProgress = this.foldProgress;
    const oldFoldTween = this.foldTween;
    const oldCameraTween = this.cameraTween;
    const wasActive = this.active;
    const previousTarget = renderer.getRenderTarget();
    const previousSize = renderer.getSize(new THREE.Vector2());
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const previousClearAlpha = renderer.getClearAlpha();
    const savedInkOpacities = this.dynamicMaterials.map((material) => material.userData?.dynamicUniforms?.uInkOpacity?.value);
    const savedMode = this.displayMode;
    const size = 768;
    const captureTarget = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0
    });
    captureTarget.texture.colorSpace = THREE.SRGBColorSpace;
    captureTarget.texture.minFilter = THREE.LinearFilter;
    captureTarget.texture.magFilter = THREE.LinearFilter;
    try {
      this.setActive(false);
      this.displayMode = "3d";
      this.cameraTween = null;
      this.foldTween = null;
      root.scale.copy(this.baseModelScale || new THREE.Vector3(1, 1, 1));
      root.rotation.set(pose.roll || 0, pose.yaw || 0, 0);
      this.applyFoldProgress(0, false);
      camera.fov = 28;
      camera.aspect = 1;
      camera.up.set(0, 1, 0);
      camera.position.set(0.15, 3.15, 4.8);
      root.updateMatrixWorld(true);
      const modelBounds = new THREE.Box3().setFromObject(root);
      const modelCenter = modelBounds.getCenter(new THREE.Vector3());
      this.controls.target.copy(modelCenter);
      camera.lookAt(modelCenter);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      this.controls.enabled = false;
      this.controls.autoRotate = false;
      this.setArtworkCanvas(artworkCanvas, revision);
      this.dynamicMaterials.forEach((material) => {
        const opacity = material.userData?.dynamicUniforms?.uInkOpacity;
        if (opacity) opacity.value = 0;
      });
      this.syncInkMaterials();

      renderer.setClearColor(0x000000, 0);
      renderer.setSize(size, size, false);
      renderer.setViewport(0, 0, size, size);
      renderer.setScissorTest(false);
      renderer.setRenderTarget(captureTarget);
      renderer.clear(true, true, true);
      root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      renderer.render(this.scene, camera);

      const raw = document.createElement("canvas");
      raw.width = size;
      raw.height = size;
      const rawContext = raw.getContext("2d", { willReadFrequently: true });
      const imageData = rawContext.createImageData(size, size);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(captureTarget, 0, 0, size, size, pixels);
      let left = size, top = size, right = 0, bottom = 0;
      let maxAlpha = 0, maxColor = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const pixel = (y * size + x) * 4;
          const flippedPixel = ((size - 1 - y) * size + x) * 4;
          imageData.data[pixel] = pixels[flippedPixel];
          imageData.data[pixel + 1] = pixels[flippedPixel + 1];
          imageData.data[pixel + 2] = pixels[flippedPixel + 2];
          imageData.data[pixel + 3] = pixels[flippedPixel + 3];
          maxAlpha = Math.max(maxAlpha, imageData.data[pixel + 3]);
          maxColor = Math.max(maxColor, imageData.data[pixel], imageData.data[pixel + 1], imageData.data[pixel + 2]);
          if (imageData.data[pixel + 3] < 14) continue;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      rawContext.putImageData(imageData, 0, 0);
      if (right <= left || bottom <= top) {
        throw new Error(`绸伞透明预览为空（alpha=${maxAlpha}, color=${maxColor}, model=${root.visible}, canopy=${this.canopyMesh.visible}, bounds=${modelBounds.getSize(new THREE.Vector3()).toArray().join(",")}, camera=${camera.position.toArray().join(",")}）。`);
      }

      const canopyBounds = new THREE.Box3().setFromObject(this.canopyMesh);
      const canopyCenter = canopyBounds.getCenter(new THREE.Vector3());
      // Project the real canopy's lower silhouette into the captured sprite so
      // the foreground duplicate can cover the character only with the canopy,
      // without bringing a second shaft/hand over the original character.
      let canopyBottomPx = 0;
      const canopyPosition = this.canopyMesh.geometry?.attributes?.position;
      if (canopyPosition?.count) {
        // The world AABB corners overestimate a tilted umbrella canopy and can
        // make the foreground copy cover hair, face, and shoulders. Project the
        // actual canopy vertices instead so the split follows its real outline.
        const canopyVertex = new THREE.Vector3();
        for (let vertex = 0; vertex < canopyPosition.count; vertex += 1) {
          canopyVertex.fromBufferAttribute(canopyPosition, vertex)
            .applyMatrix4(this.canopyMesh.matrixWorld)
            .project(camera);
          canopyBottomPx = Math.max(canopyBottomPx, (0.5 - canopyVertex.y * 0.5) * size);
        }
      } else {
        for (const x of [canopyBounds.min.x, canopyBounds.max.x]) {
          for (const y of [canopyBounds.min.y, canopyBounds.max.y]) {
            for (const z of [canopyBounds.min.z, canopyBounds.max.z]) {
              const corner = new THREE.Vector3(x, y, z).project(camera);
              canopyBottomPx = Math.max(canopyBottomPx, (0.5 - corner.y * 0.5) * size);
            }
          }
        }
      }
      // Locate the actual shaft meshes where possible. The canopy center is not
      // a safe proxy for the pole center on imported Blender assets; even a
      // small X/Z mismatch becomes visible once the sprite is pinned to a hand.
      const shaftBounds = new THREE.Box3();
      let hasShaftBounds = false;
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        const name = object.name.toLowerCase();
        if (!/(bamboo[-_ ]?shaft|straight[-_ ]?bamboo[-_ ]?grip|umbrella[-_ ]?(shaft|handle)|伞柄|伞杆)/i.test(name)) return;
        if (/(ring|internode)/i.test(name)) return;
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) return;
        if (!hasShaftBounds) {
          shaftBounds.copy(bounds);
          hasShaftBounds = true;
        } else shaftBounds.union(bounds);
      });
      const shaftCenter = hasShaftBounds ? shaftBounds.getCenter(new THREE.Vector3()) : canopyCenter.clone();
      const shaftBottom = hasShaftBounds ? shaftBounds.min.y : modelBounds.min.y;
      const gripPointWorld = new THREE.Vector3(
        shaftCenter.x,
        canopyCenter.y + (shaftBottom - canopyCenter.y) * 0.28,
        shaftCenter.z
      );
      const gripPoint = gripPointWorld.project(camera);
      const gripPx = (gripPoint.x * 0.5 + 0.5) * size;
      const gripPy = (0.5 - gripPoint.y * 0.5) * size;
      // The grip point may extend below visible canopy/rib pixels. Extend the
      // crop to include the handle endpoint; taking min() clipped it away.
      bottom = Math.max(bottom, Math.round(gripPy + size * 0.018));
      const padding = Math.round(Math.max(right - left, bottom - top) * 0.035);
      left = Math.max(0, left - padding); top = Math.max(0, top - padding);
      right = Math.min(size - 1, right + padding); bottom = Math.min(size - 1, bottom + padding);

      const output = document.createElement("canvas");
      output.width = right - left + 1;
      output.height = bottom - top + 1;
      const outputContext = output.getContext("2d");
      outputContext.drawImage(raw, left, top, output.width, output.height, 0, 0, output.width, output.height);

      // The imported model's fine bamboo and seam meshes become almost
      // invisible at the small 2D gallery scale. Re-ink the actual projected
      // rib directions and the upper shaft over the render, then clip those
      // strokes to the model's alpha so the preview stays a clean cutout.
      const projectPoint = (point) => {
        const projected = point.clone().project(camera);
        return { x: (projected.x * .5 + .5) * size, y: (.5 - projected.y * .5) * size };
      };
      const hubWorld = new THREE.Vector3(canopyCenter.x, canopyBounds.max.y, canopyCenter.z);
      let hubObject = null;
      root.traverse((object) => {
        if (!hubObject && object.name.toLowerCase() === "umbrella-hub") hubObject = object;
      });
      if (hubObject) {
        hubObject.getWorldPosition(hubWorld);
        // Put the spoke origin at the canopy apex instead of the lower hub
        // center so it aligns with the visible radial silk panels.
        hubWorld.y = canopyBounds.max.y;
      }
      const hub = projectPoint(hubWorld);
      const spokeEnds = [];
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry || !/^(?:bamboo-main-rib|bamboo-rib-under)/i.test(object.name)) return;
        const position = object.geometry.attributes?.position;
        if (!position?.count) return;
        let farthest = null;
        let farthestDistance = 0;
        const point = new THREE.Vector3();
        for (let vertex = 0; vertex < position.count; vertex += 1) {
          point.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
          const projected = projectPoint(point);
          const distance = Math.hypot(projected.x - hub.x, projected.y - hub.y);
          if (distance > farthestDistance) {
            farthestDistance = distance;
            farthest = projected;
          }
        }
        if (farthest && farthestDistance > size * .08) spokeEnds.push(farthest);
      });
      const ribOverlay = document.createElement("canvas");
      ribOverlay.width = output.width;
      ribOverlay.height = output.height;
      const ribContext = ribOverlay.getContext("2d");
      ribContext.lineCap = "round";
      ribContext.lineJoin = "round";
      for (const endpoint of spokeEnds) {
        const endX = endpoint.x - left;
        const endY = endpoint.y - top;
        ribContext.strokeStyle = "rgba(93, 74, 49, .48)";
        ribContext.lineWidth = Math.max(1.4, size * .0025);
        ribContext.beginPath();
        ribContext.moveTo(hub.x - left, hub.y - top);
        ribContext.quadraticCurveTo(
          hub.x - left + (endX - (hub.x - left)) * .58,
          hub.y - top + (endY - (hub.y - top)) * .42,
          endX,
          endY
        );
        ribContext.stroke();
        ribContext.strokeStyle = "rgba(236, 222, 190, .36)";
        ribContext.lineWidth = Math.max(.7, size * .0011);
        ribContext.stroke();
      }
      ribContext.strokeStyle = "rgba(89, 68, 42, .82)";
      ribContext.lineWidth = Math.max(2.1, size * .0035);
      ribContext.beginPath();
      ribContext.moveTo(hub.x - left, hub.y - top);
      ribContext.lineTo(gripPx - left, gripPy - top);
      ribContext.stroke();
      ribContext.strokeStyle = "rgba(231, 216, 182, .78)";
      ribContext.lineWidth = Math.max(.8, size * .0013);
      ribContext.beginPath();
      ribContext.moveTo(hub.x - left - .6, hub.y - top);
      ribContext.lineTo(gripPx - left - .6, gripPy - top);
      ribContext.stroke();
      ribContext.globalCompositeOperation = "destination-in";
      ribContext.drawImage(raw, left, top, output.width, output.height, 0, 0, output.width, output.height);
      outputContext.drawImage(ribOverlay, 0, 0);
      return {
        src: output.toDataURL("image/png"),
        width: output.width,
        height: output.height,
        gripX: THREE.MathUtils.clamp((gripPx - left) / output.width, 0, 1),
        gripY: THREE.MathUtils.clamp((gripPy - top) / output.height, 0, 1),
        canopyBottom: THREE.MathUtils.clamp((canopyBottomPx - top) / output.height, 0.08, 0.92)
      };
    } finally {
      renderer.setRenderTarget(previousTarget);
      captureTarget.dispose();
      renderer.setSize(previousSize.x, previousSize.y, false);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      root.position.copy(oldPosition);
      root.rotation.copy(oldRotation);
      root.scale.copy(oldScale);
      this.applyFoldProgress(oldFoldProgress, false);
      this.foldTween = oldFoldTween;
      this.cameraTween = oldCameraTween;
      camera.position.copy(oldCameraPosition);
      camera.quaternion.copy(oldCameraQuaternion);
      camera.up.copy(oldCameraUp);
      camera.aspect = oldCameraAspect;
      camera.fov = oldCameraFov;
      camera.updateProjectionMatrix();
      this.controls.target.copy(oldTarget);
      this.controls.enabled = oldControlsEnabled;
      this.controls.autoRotate = oldAutoRotate;
      this.controls.autoRotateSpeed = oldAutoRotateSpeed;
      this.controls.update();
      this.displayMode = savedMode;
      if (oldTextureCanvas) this.setArtworkCanvas(oldTextureCanvas, oldTextureRevision);
      else this.textureRevision = oldTextureRevision;
      this.dynamicMaterials.forEach((material, index) => {
        const opacity = material.userData?.dynamicUniforms?.uInkOpacity;
        if (opacity && Number.isFinite(savedInkOpacities[index])) opacity.value = savedInkOpacities[index];
      });
      this.syncInkMaterials();
      if (wasActive) this.setActive(true);
      else this.renderOnce();
    }
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

  alignCanopyUvToArtwork(object) {
    const position = object.geometry?.attributes?.position;
    const uv = object.geometry?.attributes?.uv;
    if (!position || !uv || uv.itemSize < 2 || uv.count !== position.count) return false;

    const point = new THREE.Vector3();
    let meanX = 0, meanZ = 0, meanU = 0, meanV = 0;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      meanX += point.x;
      meanZ += point.z;
      meanU += uv.getX(index);
      meanV += uv.getY(index);
    }
    const count = Math.max(1, position.count);
    meanX /= count; meanZ /= count; meanU /= count; meanV /= count;

    let covXU = 0, covZV = 0, varX = 0, varZ = 0, varU = 0, varV = 0;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      const dx = point.x - meanX, dz = point.z - meanZ;
      const du = uv.getX(index) - meanU, dv = uv.getY(index) - meanV;
      covXU += dx * du; covZV += dz * dv;
      varX += dx * dx; varZ += dz * dz; varU += du * du; varV += dv * dv;
    }
    const corrXU = covXU / Math.sqrt(Math.max(varX * varU, 1e-12));
    const corrZV = covZV / Math.sqrt(Math.max(varZ * varV, 1e-12));
    const flipU = corrXU < -0.68;
    const flipV = corrZV > 0.68;
    if (!flipU && !flipV) return false;

    for (let index = 0; index < uv.count; index += 1) {
      if (flipU) uv.setX(index, 1 - uv.getX(index));
      if (flipV) uv.setY(index, 1 - uv.getY(index));
    }
    uv.needsUpdate = true;
    return true;
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
      if (hasUV) {
        this.alignCanopyUvToArtwork(object);
        return;
      }
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
        // 2D canvas Y grows downward; with CanvasTexture.flipY enabled,
        // world -Z receives the upper edge of the artwork.
        values[index * 2 + 1] = THREE.MathUtils.clamp(0.5 - (point.z - center.z) / (radius * 2), 0, 1);
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
    targets.forEach(({ object }) => {
      // The imported ribs can cast very dark self-shadows onto the silk and
      // make a clean, light canopy look aged. Keep the fabric lit by the soft
      // scene lights; the ribs remain visible through the UV's fine rib relief.
      object.receiveShadow = false;
      object.castShadow = this.host?.id !== "threeHost";
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      sourceMaterials.forEach((material) => { if (material) originalCanopyMaterials.add(material); });
      const replacement = sourceMaterials.map(() => {
        // Do not clone a ShaderMaterial callback: onBeforeCompile closes over
        // its own uniforms, while Material.clone() copies userData by value.
        // Each canopy material needs a matching uniform bundle so studio light,
        // selected fabric and live ink updates reach the actual compiled shader.
        const material = this.createCanopyMaterial();
        material.map = this.canvasTexture;
        // Use one clean silk response for procedural and imported canopies.
        // Old GLB normal/roughness maps often bake in a dark, aged look.
        material.normalMap = this.normalTexture;
        material.roughnessMap = this.roughnessTexture;
        material.metalness = 0;
        material.envMap = null;
        material.envMapIntensity = 0;
        const profile = FABRIC_PROFILES[this.fabricMaterial] || FABRIC_PROFILES.georgette;
        material.normalScale.set(profile.normal, profile.normal);
        material.roughness = profile.roughness;
        material.sheen = profile.sheen;
        material.sheenRoughness = profile.sheenRoughness;
        material.sheenColor.set("#e0e9e2");
        material.specularIntensity = profile.specular;
        material.specularColor.set("#d5dfd8");
        material.anisotropy = profile.anisotropy;
        material.clearcoat = 0;
        material.clearcoatRoughness = 1;
        material.ior = 1.25;
        material.anisotropyRotation = 0;
        material.color.set("#ffffff");
        material.userData.audioBaseRoughness = material.roughness;
        material.userData.audioBaseSheen = material.sheen;
        material.metalness = 0;
        material.needsUpdate = true;
        return material;
      });
      object.material = Array.isArray(object.material) ? replacement : replacement[0];
    });
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
    this.baseModelScale = wrapper.scale.clone();
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
    this.captureCanopyShapeTargets(targets.map(({ object }) => object));
    this.setFabricMaterial(this.fabricMaterial);
    this.applyPresentationLighting(this.host);
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
    // Keep the shared preview's established framing for home and gallery.
    this.camera.position.set(0.15, 6.2, 0.2);
    this.controls.target.set(0, -0.12, 0);
    this.controls.update();
  }

  fitStudioInitialView() {
    // Keep the studio's first view close enough to read the silk and ribs,
    // with a modest side angle that also reveals the canopy's shallow arc.
    const bounds = this.canopyMesh ? new THREE.Box3().setFromObject(this.canopyMesh) : null;
    const canopySize = bounds?.getSize(new THREE.Vector3()) || new THREE.Vector3(3.45, 0.6, 3.45);
    const center = bounds?.getCenter(new THREE.Vector3()) || new THREE.Vector3(0, 0.2, 0);
    const diameter = Math.max(canopySize.x, canopySize.z, 0.1);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    const distance = diameter / (2 * tangent * 1.45);
    const elevation = THREE.MathUtils.degToRad(50);
    // Desktop leaves the interpretation text to the left of the canopy. On a
    // narrow screen that text moves above the viewer, so keep the umbrella
    // close to center and preserve room around its edge.
    const narrowViewer = this.host.clientWidth < 720;
    center.x -= diameter * (narrowViewer ? 0 : 0.18);
    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + distance * 0.002,
      center.y + distance * Math.sin(elevation),
      center.z + distance * Math.cos(elevation)
    );
    this.controls.autoRotate = false;
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
    else {
      this.syncCanopyPresentationUniforms();
      this.syncInkMaterials();
      this.renderer.render(this.scene, this.camera);
    }
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
      this.syncCanopyPresentationUniforms();
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
