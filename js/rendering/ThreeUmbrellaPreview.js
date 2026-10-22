// Three.js 只负责 3D 展示；Canvas 中的 ArtworkDocument 仍是唯一作品数据源。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const RADIUS = 1.78;
const RIBS = 24;
const CANOPY_HEIGHT = 0.36;
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
    this.introPlayed = false;
    this.cameraTween = null;
    this.autoRotateTimer = 0;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute("aria-label", "可旋转的西湖绸伞三维预览");
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    this.camera.position.set(3.15, 2.65, 3.85);
    this.scene.add(new THREE.HemisphereLight(0xf7f3e8, 0x66736a, 1.25));

    const keyLight = new THREE.DirectionalLight(0xfff3dc, 2.15);
    keyLight.position.set(-3.8, 6.4, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -3.4;
    keyLight.shadow.camera.right = 3.4;
    keyLight.shadow.camera.top = 3.4;
    keyLight.shadow.camera.bottom = -3.4;
    keyLight.shadow.bias = -0.0003;
    keyLight.shadow.radius = 4;
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xd7e8e0, 0.68);
    fillLight.position.set(4, 2.4, -3.5);
    this.scene.add(fillLight);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.03, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.1;
    this.controls.maxDistance = 8.2;
    this.controls.minPolarAngle = 0.32;
    this.controls.maxPolarAngle = Math.PI - 0.32;
    this.controls.rotateSpeed = 0.62;
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

    this.createProceduralUmbrella();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
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
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const r = radial / radialSegments;
      for (let angular = 0; angular <= angularSegments; angular += 1) {
        const angle = angular / angularSegments * Math.PI * 2 - Math.PI / 2;
        const point = this.getCanopyPoint(r, angle);
        positions.push(point.x, point.y, point.z);
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
    return geometry;
  }

  createCanopyMaterial() {
    return new THREE.MeshPhysicalMaterial({
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
  }

  createProceduralUmbrella() {
    this.removeModel();
    const root = new THREE.Group();
    const canopy = new THREE.Mesh(this.createCanopyGeometry(), this.createCanopyMaterial());
    canopy.name = "silk-canopy";
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    root.add(canopy);

    const bamboo = new THREE.MeshPhysicalMaterial({
      color: "#94764e", roughness: 0.7, metalness: 0,
      clearcoat: 0.035, clearcoatRoughness: 0.88
    });
    const bambooLight = new THREE.MeshStandardMaterial({ color: "#c3aa7c", roughness: 0.76 });
    const seamMaterial = new THREE.MeshStandardMaterial({ color: "#a8936d", roughness: 0.88 });
    for (let rib = 0; rib < RIBS; rib += 1) {
      const angle = -Math.PI / 2 + rib * Math.PI * 2 / RIBS;
      const supportPoints = [];
      const seamPoints = [];
      for (let step = 0; step <= 28; step += 1) {
        const radius = 0.045 + step / 28 * 0.94;
        // 承力竹骨放在绸面内侧；外侧只留极细的缝线提示骨位。
        supportPoints.push(this.getCanopyPoint(radius, angle, -0.019));
        seamPoints.push(this.getCanopyPoint(radius, angle, 0.0018));
      }
      const supportCurve = new THREE.CatmullRomCurve3(supportPoints);
      const supportRib = new THREE.Mesh(new THREE.TubeGeometry(supportCurve, 56, rib % 3 === 0 ? 0.008 : 0.0065, 6, false), bamboo);
      supportRib.name = `bamboo-rib-under-${rib + 1}`;
      root.add(supportRib);

      const seamCurve = new THREE.CatmullRomCurve3(seamPoints);
      const seam = new THREE.Mesh(new THREE.TubeGeometry(seamCurve, 56, 0.0014, 4, false), seamMaterial);
      seam.name = `silk-rib-seam-${rib + 1}`;
      root.add(seam);
    }

    // 伞骨撑条从伞柄内侧连接至主骨，转到伞底时可见真实的支撑关系。
    for (let brace = 0; brace < RIBS / 2; brace += 1) {
      const angle = -Math.PI / 2 + (brace * 2 + 0.5) * Math.PI * 2 / RIBS;
      const points = [
        new THREE.Vector3(0, -0.17, 0),
        this.getCanopyPoint(0.3, angle, -0.035),
        this.getCanopyPoint(0.62, angle, -0.024)
      ];
      const strut = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, 0.0048, 5, false),
        bambooLight
      );
      strut.name = `umbrella-stretcher-${brace + 1}`;
      root.add(strut);
    }

    const hemPoints = Array.from({ length: 193 }, (_, index) => this.getCanopyPoint(1, index / 192 * Math.PI * 2, 0.003));
    const hem = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hemPoints), 384, 0.009, 7, false),
      new THREE.MeshStandardMaterial({ color: "#a9936b", roughness: 0.82 })
    );
    hem.name = "stitched-canopy-hem";
    root.add(hem);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.072, 0.11, 20), bamboo);
    hub.position.y = CANOPY_HEIGHT + 0.014;
    hub.name = "umbrella-hub";
    root.add(hub);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.048, 18, 12), bambooLight);
    finial.position.y = CANOPY_HEIGHT + 0.085;
    finial.name = "umbrella-finial";
    root.add(finial);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.022, 1.34, 12), bamboo);
    shaft.position.y = -0.62;
    shaft.name = "bamboo-shaft";
    root.add(shaft);
    const handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -1.22, 0),
      new THREE.Vector3(0, -1.42, 0),
      new THREE.Vector3(0.08, -1.55, 0),
      new THREE.Vector3(0.21, -1.51, 0),
      new THREE.Vector3(0.24, -1.39, 0)
    ]);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 32, 0.031, 9, false), bamboo));

    root.name = "procedural-west-lake-umbrella";
    this.scene.add(root);
    this.modelRoot = root;
    this.modelKind = "procedural";
    this.resetCamera();
    this.renderOnce();
  }

  removeModel() {
    if (!this.modelRoot) return;
    this.scene.remove(this.modelRoot);
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      // dispose() 只释放材质程序；共享的 CanvasTexture 与法线图由预览器统一持有。
      materials.forEach((material) => material?.dispose());
    });
    this.modelRoot = null;
  }

  setArtworkCanvas(canvas, revision = null) {
    if (this.canvasTexture && revision !== null && revision === this.textureRevision) return;
    if (!this.canvasTexture) {
      this.canvasTexture = new THREE.CanvasTexture(canvas);
      this.canvasTexture.colorSpace = THREE.SRGBColorSpace;
      this.canvasTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.canvasTexture.flipY = true;
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
    const root = gltf.scene;
    if (!root) throw new Error("GLB 中没有可显示的场景。");
    root.updateMatrixWorld(true);

    const candidates = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      const size = box.getSize(new THREE.Vector3());
      const label = `${object.name} ${Array.isArray(object.material) ? object.material.map((item) => item.name).join(" ") : object.material?.name || ""}`.toLowerCase();
      const namedCanopy = /canopy|cloth|fabric|silk|umbrella|伞面|伞布|绸面/.test(label);
      const hasUV = Boolean(object.geometry.attributes.uv);
      candidates.push({ object, box, size, namedCanopy, hasUV, score: size.x * size.z });
    });
    if (!candidates.length) throw new Error("GLB 中没有可用的伞面网格。");

    const named = candidates.filter((item) => item.namedCanopy);
    const fallback = candidates.filter((item) => item.hasUV).sort((a, b) => b.score - a.score).slice(0, 1);
    const targets = named.length ? named : fallback;
    if (!targets.length || targets.some((item) => !item.hasUV)) {
      throw new Error("未找到带 UV 的伞面。请在 Blender 为伞面展开 UV，并命名为 canopy、cloth 或 fabric 后导出 GLB。");
    }

    // 选取按名称标记的伞面；未命名时，使用最大水平 UV 网格作为纹理接收面。
    const loaderMaterial = this.createCanopyMaterial();
    targets.forEach(({ object }) => {
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const replacement = sourceMaterials.map(() => {
        const material = loaderMaterial.clone();
        material.map = this.canvasTexture;
        material.needsUpdate = true;
        return material;
      });
      object.material = Array.isArray(object.material) ? replacement : replacement[0];
    });
    loaderMaterial.dispose();

    this.removeModel();
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
    this.resetCamera();
    this.renderOnce();
    return { meshes: targets.length };
  }

  resetCamera() {
    this.camera.position.set(3.3, 4.65, 4.35);
    this.controls.target.set(0, -0.12, 0);
    this.controls.update();
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
    this.renderer.render(this.scene, this.camera);
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      window.clearTimeout(this.autoRotateTimer);
      return;
    }
    this.resize();
    if (this.frameHandle) return;
    if (!this.introPlayed) {
      const target = this.controls.target.clone();
      const destination = this.camera.position.clone();
      const from = new THREE.Vector3(0, 7.4, 0.05);
      this.camera.position.copy(from);
      this.camera.lookAt(target);
      this.controls.enabled = false;
      this.controls.autoRotate = false;
      this.cameraTween = { startedAt: performance.now(), duration: 920, target, from, destination };
      this.introPlayed = true;
    }
    const frame = () => {
      if (!this.active) { this.frameHandle = 0; return; }
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
      } else this.controls.update();
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
    const backdrop = context.createRadialGradient(output.width * 0.48, output.height * 0.38, 12, output.width * 0.5, output.height * 0.5, output.width * 0.65);
    backdrop.addColorStop(0, "#edf1e8");
    backdrop.addColorStop(1, "#dce5dc");
    context.fillStyle = backdrop;
    context.fillRect(0, 0, output.width, output.height);
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
