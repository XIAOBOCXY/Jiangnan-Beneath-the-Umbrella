import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createCanopyMaterial,
  createSilkDetailMaps,
  normalizeFabricMaterial
} from "../rendering/UmbrellaCanopyMaterial.js?v=20261111-shared-silk-v7";

const WEATHER = {
  sunny: { rain: 0, fog: .0032, wind: .20, wet: 0, clouds: .13 },
  rainy: { rain: 1, fog: .014, wind: .82, wet: 1, clouds: .86 }
};
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);
const lerp = THREE.MathUtils.lerp;
const STREET_PAVED_END = 84.5;
const STREET_END = 190;
const STREET_HALF_WIDTH = 4.1;
const STREET_MIN_HALF_WIDTH = .18;
const streetTaperAtDepth = (depth) => {
  const progress = clamp((depth - STREET_PAVED_END) / (STREET_END - STREET_PAVED_END), 0, 1);
  return Math.max(STREET_MIN_HALF_WIDTH / STREET_HALF_WIDTH, (1 - progress) ** 1.65);
};
const ROPE_DEPTHS = [1.5, -3.2, -7.9, -12.6, -17.3, -22.0, -26.7, -31.4, -36.1];
const INITIAL_CAMERA_Z = 4.4;
const EAVE_HEIGHTS = [3.38, 4.08, 5.10, 5.22, 4.00, 5.28, 3.72];
const ROPE_SLOPES = [.06, -.05, .07, -.06, .04, -.07, .05, -.04, .05];
const STOREFRONT_X_OFFSETS = [0, .34, -.20, .22, -.36, .42, -.15, .28];
const ROPE_UMBRELLA_COUNTS = [3, 2, 4, 3, 2, 4, 3, 2, 4];
const UMBRELLA_HANG_LENGTHS = [.055,.068,.06,.074,.064,.07,.058,.066,.057];
const UMBRELLA_COLUMN_DROPS = [0,.012,.006];
const STREET_TRAVEL_LIMIT = 48;
// Stop with the farthest display rope just above the normal forward view.
// Work selection may still move the camera to frame a chosen umbrella.
const STREET_WHEEL_TRAVEL_LIMIT = INITIAL_CAMERA_Z - ROPE_DEPTHS[ROPE_DEPTHS.length - 1] - 3;
const LOOK_YAW_LIMIT = .085;
const LOOK_PITCH_UP_LIMIT = 1.32;
const LOOK_PITCH_DOWN_LIMIT = .65;
const TOUCH_LOOK_YAW_LIMIT = .65;
const TOUCH_DRAG_THRESHOLD = 8;

function applyWetPavingShading(material) {
  const uniforms = {
    uWetness: { value: 0 },
    uWetNight: { value: 0 },
    uWetTime: { value: 0 }
  };
  for (let index = 0; index < 6; index += 1) uniforms[`uWetLantern${index}`] = { value: new THREE.Vector4() };
  material.userData.wetPavingUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const lampUniforms = Array.from({ length: 6 }, (_, index) => `uniform vec4 uWetLantern${index};`).join("\n");
    const lampTerms = Array.from({ length: 6 }, (_, index) => `wetLanternReflection(vWetPavingWorld, uWetLantern${index})`).join(" + ");
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWetPavingWorld;\nvarying vec3 vWetWorldNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWetPavingWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWetWorldNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWetPavingWorld;
varying vec3 vWetWorldNormal;
uniform float uWetness;
uniform float uWetNight;
uniform float uWetTime;
${lampUniforms}
float wetLanternReflection(vec3 worldPoint, vec4 lantern) {
  vec2 delta = vec2(worldPoint.x - lantern.x, worldPoint.z - lantern.y);
  float streak = exp(-delta.x * delta.x * 21.0 - delta.y * delta.y * 0.34);
  float brokenWater = 0.66 + 0.19 * sin(worldPoint.z * 10.5 + uWetTime * 2.1 + worldPoint.x * 5.2)
    + 0.15 * sin(worldPoint.z * 21.0 - uWetTime * 1.4 + worldPoint.x * 9.0);
  return clamp(lantern.z / 2.4, 0.0, 1.0) * streak * max(0.12, brokenWater);
}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float wetLampPool = ${lampTerms};
        float wetStoneFacing = smoothstep(0.12, 0.88, abs(normalize(vWetWorldNormal).y));
        float wetStoneRipple = 0.78 + 0.22 * sin(vWetPavingWorld.z * 14.0 + uWetTime * 2.8 + vWetPavingWorld.x * 4.0);
        totalEmissiveRadiance += vec3(1.0, 0.47, 0.19) * wetLampPool * wetStoneFacing * wetStoneRipple * uWetness * uWetNight * 1.5;
      `);
  };
  material.customProgramCacheKey = () => "xihu-rainy-night-lantern-paving-v2";
  material.needsUpdate = true;
  return uniforms;
}

/** A modeled street and real umbrella meshes share one camera and one lighting rig. */
export class HangingGallery3D {
  constructor(host, onSelect, stateCallbacks = {}) {
    this.host = host;
    this.onSelect = onSelect;
    this.onWeatherChange = stateCallbacks.onWeatherChange || (() => {});
    this.onTimeChange = stateCallbacks.onTimeChange || (() => {});
    this.active = false;
    this.elapsed = 0;
    this.weatherName = "sunny";
    this.weather = { ...WEATHER.sunny };
    this.weatherSwitchAt = 22 + Math.random() * 8;
    this.timeCycleOffset = 0;
    this.timeMode = null;
    this.daylight = 1;
    this.viewAngles = new THREE.Vector2();
    this.viewTarget = new THREE.Vector2();
    this.depth = 0;
    this.depthTarget = 0;
    this.cameraX = 0;
    this.cameraXTarget = 0;
    this.raycaster = new THREE.Raycaster();
    this.umbrellas = [];
    this.artworkTextures = [];
    this.artworkMaterials = [];
    this.silkDetailMaps = new Map();
    this.groundDisplays = [];
    this.ropes = [];
    this.materials = {};
    this.pavingMaterials = [];
    this.plants = [];
    this.generation = 0;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.pointer = new THREE.Vector2();
    this.touchPoints = new Map();
    this.touchGesture = null;
    this.ignoreTouchClickUntil = 0;
    this.canopyPickTargets = [];
    this.lightColors = {
      sunBase: new THREE.Color(0xffedcb), sunset: new THREE.Color(0xffa970),
      skyNight: new THREE.Color(0x172a3e), skyDay: new THREE.Color(0x91bbcb), skyCloudy: new THREE.Color(0x7d8e91),
      horizonNight: new THREE.Color(0x394b56), horizonDay: new THREE.Color(0xaab8b2),
      horizonCloudy: new THREE.Color(0x778986), horizonTwilight: new THREE.Color(0xb98568),
      top: new THREE.Color(), horizon: new THREE.Color()
    };
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaab8b2, this.weather.fog);
    this.camera = new THREE.PerspectiveCamera(49, 1, .08, 320);
    this.baseFov = this.camera.fov;
    this.currentFov = this.camera.fov;
    this.fovInitialized = false;
    this.camera.position.set(0, 2.05, INITIAL_CAMERA_Z);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    host.append(this.renderer.domElement);
    this.hemisphere = new THREE.HemisphereLight(0xe5f3ed, 0x6d6350, 1.35);
    this.canopyFill = new THREE.HemisphereLight(0xfff7e6, 0xd9caad, .48);
    this.sun = new THREE.DirectionalLight(0xffedcb, 2.15);
    this.sun.position.set(-6, 11, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 12, bottom: -12, near: .5, far: 36 });
    this.sun.shadow.bias = -.00035;
    this.scene.add(this.hemisphere, this.canopyFill, this.sun);
    this.lanternLights = [];
    for (const x of [-3.45, 3.45]) for (const z of [-.55, -5.25, -9.95]) {
      const light = new THREE.PointLight(0xffa24a, 0, 4.2, 2);
      light.position.set(x, 3.75, z); this.scene.add(light); this.lanternLights.push(light);
    }
    this.makeSky();
    this.makeEnvironment();
    this.makeRain();
    this.makeRopes();
    this.makeMountainBackdrop();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    host.addEventListener("pointermove", (e) => this.handlePointer(e), { passive: true });
    host.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      this.hoveredUmbrella = null; this.viewTarget.set(0, 0); host.style.cursor = "";
    });
    host.addEventListener("pointerdown", (event) => this.handleTouchStart(event));
    host.addEventListener("pointermove", (event) => this.handleTouchMove(event));
    host.addEventListener("pointerup", (event) => this.handleTouchEnd(event));
    host.addEventListener("pointercancel", (event) => this.handleTouchEnd(event, true));
    host.addEventListener("click", (e) => this.handleClick(e));
    host.addEventListener("wheel", (event) => {
      event.preventDefault();
      // Selecting a distant parasol can place the camera deeper in the lane;
      // a forward wheel tick there should not yank it back to the entrance.
      if (event.deltaY > 0 && this.depthTarget > STREET_WHEEL_TRAVEL_LIMIT) return;
      this.depthTarget = clamp(this.depthTarget + event.deltaY * .008, 0, STREET_WHEEL_TRAVEL_LIMIT);
    }, { passive: false });
    this.ready = this.load();
  }

  makeSky() {
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x9bc8dc) }, horizon: { value: new THREE.Color(0xe7e5d6) }, clouds: { value: .13 }, time: { value: 0 } },
      vertexShader: `varying vec3 vDirection; void main(){ vDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        varying vec3 vDirection; uniform vec3 top; uniform vec3 horizon; uniform float clouds; uniform float time;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){ float h=clamp(vDirection.y*.8+.15,0.,1.); vec3 c=mix(horizon,top,pow(h,.7));
          vec2 p=vDirection.xz/max(.20,vDirection.y+.35)*2.6+vec2(time*.004,0.);
          float n=noise(p)*.72+noise(p*2.)*.28;
          float cloud=smoothstep(.47,.73,n)*clouds*smoothstep(-.05,.35,vDirection.y);
          c=mix(c,mix(horizon,vec3(.73,.78,.76),.45),cloud*.58); gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 20), this.skyMaterial);
    sky.renderOrder = -100;
    this.scene.add(sky);
  }

  makeEnvironment() {
    // A small procedural sky environment supplies soft specular highlights on wet stone.
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "#a5c5d0"); gradient.addColorStop(.47, "#ece3ce");
    gradient.addColorStop(.52, "#827b6d"); gradient.addColorStop(1, "#3a403b");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 128);
    this.environment = new THREE.CanvasTexture(canvas);
    this.environment.mapping = THREE.EquirectangularReflectionMapping;
    this.environment.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = this.environment;
  }

  makeLanternPaperTexture() {
    const canvas=document.createElement("canvas"); canvas.width=256; canvas.height=128;
    const ctx=canvas.getContext("2d");
    const wash=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
    wash.addColorStop(0,"#f7ecd5"); wash.addColorStop(.52,"#f0dfbd"); wash.addColorStop(1,"#f8edda");
    ctx.fillStyle=wash; ctx.fillRect(0,0,canvas.width,canvas.height);
    let seed=151;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<1500;i++){
      const x=random()*256,y=random()*128,length=1+random()*6;
      ctx.strokeStyle=`rgba(${random()>.52?112:255},${random()>.52?88:247},${random()>.52?57:226},${.018+random()*.038})`;
      ctx.lineWidth=.25+random()*.42;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+length,y+(random()-.5)*1.25);ctx.stroke();
    }
    for(let i=0;i<55;i++){
      const x=random()*256,y=random()*128,r=.35+random()*1.15;
      ctx.fillStyle=`rgba(115,82,48,${.018+random()*.035})`;
      ctx.beginPath();ctx.ellipse(x,y,r,r*.48,random()*.7,0,Math.PI*2);ctx.fill();
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=THREE.RepeatWrapping;return texture;
  }


  makeRain() {
    const count = 1000, positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      positions[i * 6] = (Math.random() - .5) * 15;
      positions[i * 6 + 1] = Math.random() * 9;
      positions[i * 6 + 2] = 8 - Math.random() * 40;
    }
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMaterial = new THREE.LineBasicMaterial({ color: 0xd4e1df, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false; this.scene.add(this.rain);
  }

  makeMountainBackdrop() {
    let texture;
    this.panoramaReady = new Promise((resolve, reject) => {
      texture = new THREE.TextureLoader().load("assets/gallery/misty-west-lake-panorama.png?v=20261106-1", resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    this.lakePhotoTexture = texture;
    const maskCanvas = document.createElement("canvas"); maskCanvas.width = 8; maskCanvas.height = 256;
    const ctx = maskCanvas.getContext("2d"), fade = ctx.createLinearGradient(0,0,0,256);
    fade.addColorStop(0,"black"); fade.addColorStop(.26,"black"); fade.addColorStop(.41,"white");
    fade.addColorStop(.94,"white"); fade.addColorStop(1,"black");
    ctx.fillStyle = fade; ctx.fillRect(0,0,8,256);
    this.mountainMask = new THREE.CanvasTexture(maskCanvas);
    this.mountainMaterial = new THREE.MeshBasicMaterial({ map: texture, alphaMap: this.mountainMask, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    // Keep the landscape behind the long lane so it cannot clip the road at a
    // nearby flat billboard edge. The wider card preserves its former viewing angle.
    const mountain = new THREE.Mesh(new THREE.PlaneGeometry(240, 132), this.mountainMaterial);
    mountain.position.set(0, 19.25, -208); this.scene.add(mountain);

    // Soft, slowly drifting veils sit at different depths around the
    // lakeshore. Their light and opacity follow the same weather as the scene.
    this.mistLayers = [];
    for (const [width, height, elevation, depth, amount] of [[59,6,2.5,-36.5,.10],[84,10,5,-47,.13],[94,7,8.8,-51,.08],[112,9,4.7,-110,.20]]) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        uniforms: { tint: { value: new THREE.Color(0xd2ded8) }, time: { value: 0 }, amount: { value: amount } },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `
          varying vec2 vUv; uniform vec3 tint; uniform float time; uniform float amount;
          float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float noise(vec2 p){vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
          void main(){
            vec2 p=vec2(vUv.x*5.+time*.012,vUv.y*1.7);
            float n=noise(p);
            float bank=smoothstep(.02,.22,vUv.y)*(1.-smoothstep(.46,.96,vUv.y));
            float edges=smoothstep(0.,.12,vUv.x)*smoothstep(0.,.12,1.-vUv.x);
            gl_FragColor=vec4(tint,amount*bank*edges*(.45+n*.55));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      const layer = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
      layer.position.set(0,elevation,depth); this.scene.add(layer);
      this.mistLayers.push({ material, amount });
    }
  }

  makeWaterMaterial() {
    return new THREE.ShaderMaterial({
      fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, daylight: { value: 1 }, rain: { value: 0 }, panorama: { value: this.lakePhotoTexture } }]),
      vertexShader: `#include <fog_pars_vertex>\nvarying vec3 worldPoint; void main(){ vec4 world=modelMatrix*vec4(position,1.); worldPoint=world.xyz; vec4 mvPosition=viewMatrix*world; gl_Position=projectionMatrix*mvPosition; #include <fog_vertex> }`.replace("; #include", ";\n#include").replace("<fog_vertex> }", "<fog_vertex>\n}"),
      fragmentShader: `
        #include <fog_pars_fragment>
        varying vec3 worldPoint; uniform float time; uniform float daylight; uniform float rain; uniform sampler2D panorama;
        void main(){
          vec2 p=worldPoint.xz;
          float wave=sin(p.y*4.5+sin(p.x*.6+time*.32)*.8+time*.8);
          wave+=.45*sin(p.y*8.5-p.x*.7-time*.48);
          float glint=pow(max(0.,sin(p.y*5.7+sin(p.x*1.1+p.y*.13)*2.2+time*.6)),18.);
          glint*=pow(max(0.,sin(p.x*1.9+p.y*.32+time*.14)),4.);
          vec2 uv=vec2(clamp(.5+p.x/94.,0.,1.),clamp((-p.y-212.)/20.,0.,1.)*.30);
          uv.x+=sin(p.y*.7+time*.26)*.0015;
          vec3 photograph=texture2D(panorama,uv).rgb;
          vec3 day=photograph*.84, night=photograph*vec3(.14,.20,.25);
          vec3 col=mix(night,day,daylight)*(1.-rain*.14)+wave*.005+glint*(.015+daylight*.025);
          gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
  }

  makeRopes() {
    for (const [row, z] of ROPE_DEPTHS.entries()) {
      const storefrontIndex = Math.round((-z - 2) / 4.7);
      const endpoint = (side) => {
        const offsetIndex = ((storefrontIndex % STOREFRONT_X_OFFSETS.length) + STOREFRONT_X_OFFSETS.length) % STOREFRONT_X_OFFSETS.length;
        const setback = STOREFRONT_X_OFFSETS[offsetIndex] + (side > 0 ? .035 : 0);
        const profile = ((storefrontIndex + 3) % EAVE_HEIGHTS.length + EAVE_HEIGHTS.length) % EAVE_HEIGHTS.length;
        const slope = side > 0 ? ROPE_SLOPES[row] : 0;
        const depth = 2 + storefrontIndex * 4.7;
        return new THREE.Vector3(side * (3.2 + setback) * streetTaperAtDepth(depth), EAVE_HEIGHTS[profile] - .04 + slope, z);
      };
      const start = endpoint(-1), end = endpoint(1);
      const count = 24, nodes = [];
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        p.y -= Math.sin(t * Math.PI) * .05;
        nodes.push({ p, old: p.clone() });
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((count + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x39332a }));
      line.frustumCulled = false; this.scene.add(line);
      this.ropes.push({ nodes, geometry, line, start, end, row, z });
    }
  }

  async load() {
    const loader = new GLTFLoader();
    try {
      const [street, displayPoses] = await Promise.all([
        loader.loadAsync("assets/models/hanging-gallery-street.glb?v=20261111-flush-windows-v30"),
        loader.loadAsync("assets/models/west-lake-umbrella-display.glb?v=20261108-radial-canopy-v4"),
        this.panoramaReady
      ]);
      street.scene.traverse((object) => {
        if (object.name.startsWith("WindPlant")) this.plants.push(object);
        if (!object.isMesh) return;
        if (object.name.includes("LakeWater")) { this.waterMaterial = this.makeWaterMaterial(); object.material = this.waterMaterial; }
        object.castShadow = !["Mountain","LakeWater","Paving","Moss","RoofTiles","PlantLeaves"].some((part)=>object.name.includes(part));
        object.receiveShadow = true;
        const material = object.material;
        if (material?.name) this.materials[material.name] = material;
        if (material?.map) { material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping; material.map.needsUpdate = true; }
        if (material?.normalMap) { material.normalMap.wrapS = material.normalMap.wrapT = THREE.RepeatWrapping; material.normalMap.needsUpdate = true; }
        if (object.name.includes("PlantLeaves")) material.side = THREE.DoubleSide;
        if (object.name.includes("RoofTiles")) material.side = THREE.DoubleSide;
        if (material?.name === "WindowGlass") { material.color.set(0x51402e); material.emissive.set(0xffad5b); material.roughness = .7; }
        if (material?.name === "WindowPaper") {
          material.color.set(0xfff2d8); material.emissive.set(0xffc36d); material.roughness = .88;
          material.map = this.makeLanternPaperTexture(); material.map.wrapT = THREE.RepeatWrapping;
          material.needsUpdate = true;
        }
        if (material?.name === "LanternSilk") {
          material.emissive.set(0xff813a);
          material.map=this.makeLanternPaperTexture();
          material.needsUpdate=true;
        }
        if (material?.name === "Timber") material.color.setRGB(1.25, 1.12, .95);
        if (material?.name === "DarkTimber") material.color.setRGB(.72, .70, .63);
        if (material?.name === "AgedPlaster") material.color.setRGB(1.20, 1.18, 1.08);
        if (material?.name?.startsWith("Paving")) {
          if (material.name === "Paving") material.color.setRGB(1.18, 1.22, 1.26);
          if (material.name === "PavingWarm") material.color.setRGB(1.05, .97, .88);
          if (material.name === "PavingCool") material.color.setRGB(.86, .91, .90);
          const wetUniforms = material.userData.wetPavingUniforms || applyWetPavingShading(material);
          if (!this.pavingMaterials.some((entry) => entry.material === material)) {
            this.pavingMaterials.push({ material, color: material.color.clone(), wetUniforms });
          }
        }
      });
      this.scene.add(street.scene);
      this.prepareDisplayPoses(displayPoses.scene);
      this.renderer.shadowMap.needsUpdate = true;
      this.host.classList.add("is-ready");
    } catch (error) {
      const status = document.querySelector("#hangingGallery .hanging-gallery-loading");
      if (status) status.textContent = "三维街景加载失败，请刷新后重试。";
      console.error("悬伞街景加载失败：", error);
      throw error;
    }
  }

  prepareDisplayPoses(root) {
    root.updateMatrixWorld(true);
    const parts = { open: {}, half: {}, closed: {} };
    root.traverse((object) => {
      if (!object.isMesh) return;
      const match = /^Display-(open|half|closed)-(canopy|frame)$/.exec(object.name);
      if (!match) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      // The radial UV repair is for the open canopy disk only. Keep the GLB's
      // shared UVs on the folded pose so the gathered silk does not squash its print.
      if (match[1] === "open" && match[2] === "canopy") this.alignCanopyUv(geometry);
      parts[match[1]][match[2]] = geometry;
    });
    for (const pose of Object.values(parts)) {
      if (!pose.canopy || !pose.frame) throw new Error("展示伞的开合模型缺失");
      pose.canopy.computeBoundingBox(); pose.frame.computeBoundingBox();
      const grip = Math.min(pose.canopy.boundingBox.min.y, pose.frame.boundingBox.min.y);
      pose.canopy.translate(0, -grip, 0); pose.frame.translate(0, -grip, 0);
    }
    this.displayGeometries = parts;
    this.canopyGeometry = parts.open.canopy;
    this.frameGeometry = parts.open.frame;
    const canopyBounds = this.canopyGeometry.boundingBox;
    const centerX = (canopyBounds.min.x + canopyBounds.max.x) * .5;
    const centerZ = (canopyBounds.min.z + canopyBounds.max.z) * .5;
    const radius = Math.max(canopyBounds.max.x - canopyBounds.min.x, canopyBounds.max.z - canopyBounds.min.z) * .5;
    let edgeYTotal = 0, edgeVertexCount = 0;
    const positions = this.canopyGeometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      const distance = Math.hypot(positions.getX(index) - centerX, positions.getZ(index) - centerZ);
      if (distance < radius * .94) continue;
      edgeYTotal += positions.getY(index);
      edgeVertexCount += 1;
    }
    this.selectionRingPosition = new THREE.Vector3(centerX, edgeVertexCount ? edgeYTotal / edgeVertexCount : (canopyBounds.min.y + canopyBounds.max.y) * .5, centerZ);
    this.selectionRingGeometry = new THREE.TorusGeometry(radius + .012, .026, 6, 96);
    this.selectionRingGeometry.rotateX(Math.PI / 2);
    this.selectionRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xfffdf3, side: THREE.DoubleSide, transparent: true, opacity: .98,
      depthTest: false, depthWrite: false, toneMapped: false
    });
    this.frameMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7353, roughness: .89, side: THREE.DoubleSide });
  }

  alignCanopyUv(geometry) {
    geometry.computeBoundingBox();
    const p=geometry.attributes.position, uv=geometry.attributes.uv, bounds=geometry.boundingBox;
    const centerX=(bounds.min.x+bounds.max.x)*.5, centerZ=(bounds.min.z+bounds.max.z)*.5;
    const sizeX=bounds.max.x-bounds.min.x, sizeZ=bounds.max.z-bounds.min.z;
    const diameter=Math.max(sizeX,sizeZ,1e-6);
    // Rebuild one continuous radial map from the actual canopy disk. The old
    // decimated seam plus correlation-based flips could place several UV
    // islands over the same artwork and read as stacked prints.
    for(let i=0;i<p.count;i++){
      const u=clamp(.5+(p.getX(i)-centerX)/diameter,0,1);
      const v=clamp(.5+(p.getZ(i)-centerZ)/diameter,0,1);
      uv.setXY(i,u,v);
    }
    uv.needsUpdate = true;
  }

  async setWorks(works, getCanvas, focusedWorkId = null) {
    const generation = ++this.generation;
    try {
      await this.ready;
      const canvases = await Promise.all(works.map((work) => getCanvas(work)));
      if (generation !== this.generation) return false;
      this.groundDisplays.forEach((group) => {
        this.scene.remove(group);
        if (group.userData.ownsGeometry) group.geometry.dispose();
      });
      this.groundDisplays = [];
      const oldTextures=new Set(this.artworkTextures), oldMaterials=new Set(this.artworkMaterials);
      this.umbrellas.forEach((item) => { this.scene.remove(item.group, item.cord); item.cord.geometry.dispose(); item.cord.material.dispose(); });
      oldTextures.forEach((texture)=>texture.dispose()); oldMaterials.forEach((material)=>material.dispose());
      this.umbrellas = [];
      this.canopyPickTargets = [];
      this.artworkTextures=[]; this.artworkMaterials=[];
      const artworks=works.map((work,index)=>({work,canvas:canvases[index]})).filter((entry)=>entry.canvas);
      const resources=artworks.map(({work,canvas})=>{
        const style = normalizeFabricMaterial(work.fabricMaterial);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
        texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping; texture.repeat.set(1,1); texture.needsUpdate=true;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        let detailMaps = this.silkDetailMaps.get(style);
        if (!detailMaps) {
          detailMaps = createSilkDetailMaps(style, Math.min(6, this.renderer.capabilities.getMaxAnisotropy()));
          this.silkDetailMaps.set(style, detailMaps);
        }
        const material = createCanopyMaterial({
          canvasTexture: texture,
          normalTexture: detailMaps.normalTexture,
          roughnessTexture: detailMaps.roughnessTexture,
          fabricMaterial: style,
          displayMode: "3d",
          studioFabricLift: 1,
          inkOpacity: 0
        });
        material.userData.fabricMaterial = style;
        this.artworkTextures.push(texture); this.artworkMaterials.push(material);
        return {work,texture,material};
      });
      if (!resources.length) {
        this.focusedWorkId = null;
        return true;
      }
      const slots = [];
      this.pickGeometry ||= new THREE.SphereGeometry(.52, 10, 7);
      this.pickMaterial ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0, side: THREE.DoubleSide });
      const rowOrder = [2, 3, 1, 4, 5, 6, 7, 8, 0];
      const maximumPerRow = Math.max(...ROPE_UMBRELLA_COUNTS);
      for (let layer = 0; layer < maximumPerRow; layer += 1) {
        rowOrder.forEach((row) => {
          if (ROPE_UMBRELLA_COUNTS[row] > layer) slots.push({ row });
        });
      }
      const placedSlots = slots.slice(0, resources.length);
      const itemsPerRow = new Map();
      placedSlots.forEach(({ row }) => itemsPerRow.set(row, (itemsPerRow.get(row) || 0) + 1));
      const rowProgress = new Map();
      resources.slice(0, placedSlots.length).forEach((artwork, artworkIndex) => {
        const { row } = placedSlots[artworkIndex];
        const column = rowProgress.get(row) || 0;
        const rowCount = itemsPerRow.get(row);
        rowProgress.set(row, column + 1);
        const ropePosition = (column + 1) / (rowCount + 1);
        const group = new THREE.Group();
        group.userData.work = artwork.work;
        const canopy = new THREE.Mesh(this.canopyGeometry, artwork.material);
        const frame = new THREE.Mesh(this.frameGeometry, this.frameMaterial);
        const pickArea = new THREE.Mesh(this.pickGeometry, this.pickMaterial);
        pickArea.position.y = 1.2;
        pickArea.scale.y = 2.3;
        pickArea.userData.work = artwork.work;
        pickArea.renderOrder = 1000;
        const selectionRing = new THREE.Mesh(this.selectionRingGeometry, this.selectionRingMaterial);
        selectionRing.position.copy(this.selectionRingPosition);
        selectionRing.visible = false;
        selectionRing.renderOrder = 1001;
        canopy.castShadow = row < 3;
        // Avoid the umbrella's own bamboo ribs shadowing the silk from below.
        canopy.receiveShadow = false;
        frame.castShadow = false;
        frame.receiveShadow = false;
        canopy.userData.work = frame.userData.work = artwork.work;
        group.add(canopy, frame, pickArea, selectionRing);
        const baseScale = .29 - row * .0005;
        group.scale.setScalar(baseScale);
        this.scene.add(group);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
        const cord = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x40382d }));
        cord.frustumCulled = false;
        this.scene.add(cord);
        this.umbrellas.push({
          work: artwork.work, group, canopy, pickArea, selectionRing, texture: artwork.texture, material: artwork.material,
          cord, row, column, ropePosition, baseScale,
          phase: artworkIndex * 1.7, angle: 0, velocity: 0,
          tilt: [-.045,.035,-.025,.055,.02,-.055,.04,-.015,.03,-.03,.025,-.04][artworkIndex % 12]
        });
      });
      this.canopyPickTargets = this.umbrellas.flatMap((item) => [item.canopy, item.pickArea]);
      this.setFocusedWork(focusedWorkId);
      return true;
    } catch (error) {
      console.warn("悬伞作品加载失败：", error);
      throw error;
    }
  }

  setFocusedWork(workId = null) {
    this.focusedWorkId = workId;
    for (const item of this.umbrellas) {
      item.selectionRing.visible = item.work.id === workId;
    }
    const selected = this.umbrellas.find((item) => item.work.id === workId);
    if (selected) {
      const rope = this.ropes[selected.row];
      const nodeIndex = Math.round(selected.ropePosition * ((rope?.nodes.length || 1) - 1));
      const anchor = rope?.nodes[nodeIndex]?.p;
      const targetZ = anchor?.z ?? rope?.z ?? 0;
      const targetX = anchor?.x ?? 0;
      const lookAhead = 2.4;
      this.depthTarget = clamp(INITIAL_CAMERA_Z - (targetZ + lookAhead), 0, STREET_TRAVEL_LIMIT);
      this.cameraXTarget = targetX;
      const canopyHeight = (anchor?.y ?? 4.5) - UMBRELLA_HANG_LENGTHS[selected.row] - .65;
      this.viewTarget.set(0, Math.atan2(Math.max(.5, canopyHeight - 2.05), lookAhead) - Math.atan2(2.8, 16.4));
    }
  }

  makeGroundDisplays() {
    if (!this.umbrellas.length) return;
    // Display selected umbrellas vertically on the walls, with the short grip
    // against the timber and the decorated canopy facing into the lane.
    const placements = [
      { side:-1, z:4.75, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:4.10, pose:"wall", y:1.08, scale:.27 },
      { side:-1, z:1.45, pose:"wall", y:1.12, scale:.27 },
      { side: 1, z:1.95, pose:"wall", y:1.14, scale:.27 },
      { side:-1, z:-2.70, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:-2.38, pose:"wall", y:1.12, scale:.27 },
      { side:-1, z:-7.35, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:-7.90, pose:"wall", y:1.12, scale:.27 },
      { side:-1, z:-12.60, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:-12.15, pose:"wall", y:1.12, scale:.27 },
      { side:-1, z:-17.30, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:-17.10, pose:"wall", y:1.12, scale:.27 },
      { side:-1, z:-22.00, pose:"wall", y:1.10, scale:.27 },
      { side: 1, z:-21.70, pose:"wall", y:1.12, scale:.27 },
      { side: 1, z:3.15, pose:"open", x:3.10, scale:.37, tilt:.12 },
      { side:-1, z:-1.55, pose:"open", x:3.02, scale:.36, tilt:.21 },
      { side: 1, z:-9.95, pose:"open", x:3.08, scale:.37, tilt:.16 },
      { side:-1, z:-18.20, pose:"open", x:3.08, scale:.36, tilt:.20 }
    ];
    const entries=placements.map((placement,index)=>{
      const wallMounted=placement.pose==="wall";
      const umbrella=this.umbrellas[(index+2)%this.umbrellas.length];
      const transform=new THREE.Object3D();
      transform.position.set(placement.side*(wallMounted?3.82:placement.x),wallMounted?placement.y:.045,placement.z);
      transform.rotation.set(wallMounted?0:(index%3-1)*.10,0,
        wallMounted?placement.side*Math.PI*.5:-placement.side*placement.tilt);
      transform.scale.setScalar(placement.scale);
      transform.updateMatrix();
      return { transform, material:umbrella.material, work:umbrella.work };
    });
    const byArtwork=new Map();
    entries.forEach((entry)=>{
      if(!byArtwork.has(entry.material)) byArtwork.set(entry.material,[]);
      byArtwork.get(entry.material).push(entry);
    });
    byArtwork.forEach((artworkEntries,material)=>{
      const canopy=new THREE.InstancedMesh(this.displayGeometries.open.canopy,material,artworkEntries.length);
      canopy.userData.works=artworkEntries.map((entry)=>entry.work);
      canopy.castShadow=false; canopy.receiveShadow=true;
      artworkEntries.forEach((entry,index)=>canopy.setMatrixAt(index,entry.transform.matrix));
      canopy.instanceMatrix.needsUpdate=true; canopy.computeBoundingSphere();
      this.scene.add(canopy); this.groundDisplays.push(canopy); this.canopyPickTargets.push(canopy);
    });
    const frames=new THREE.InstancedMesh(this.displayGeometries.open.frame,this.frameMaterial,entries.length);
    frames.castShadow=false; frames.receiveShadow=true;
    entries.forEach((entry,index)=>frames.setMatrixAt(index,entry.transform.matrix));
    frames.instanceMatrix.needsUpdate=true; frames.computeBoundingSphere();
    this.scene.add(frames); this.groundDisplays.push(frames);

    const wallPlacements=placements.filter((placement)=>placement.pose==="wall");
    this.wallMountRodGeometry ||= new THREE.CylinderGeometry(.014,.014,.24,8);
    const mounts=new THREE.InstancedMesh(this.wallMountRodGeometry,this.frameMaterial,wallPlacements.length*2);
    const supportRotation=new THREE.Quaternion();
    const support=new THREE.Object3D();
    let supportIndex=0;
    wallPlacements.forEach((placement)=>{
      supportRotation.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-placement.side,0,0));
      for(const lift of [0,.14]){
        support.position.set(placement.side*3.88,placement.y+lift,placement.z);
        support.quaternion.copy(supportRotation); support.updateMatrix();
        mounts.setMatrixAt(supportIndex++,support.matrix);
      }
    });
    mounts.instanceMatrix.needsUpdate=true; mounts.computeBoundingSphere();
    this.scene.add(mounts); this.groundDisplays.push(mounts);
  }

  setWeather(name) {
    if (!WEATHER[name]) return;
    this.weatherName = name;
    this.weatherSwitchAt = this.elapsed + 22 + Math.random() * 18;
    this.onWeatherChange(name);
  }

  setTimeOfDay(name) {
    if (name !== "day" && name !== "night") return;
    const targetCycle = name === "night" ? .66 : .12;
    this.timeCycleOffset = targetCycle * 84 - this.elapsed;
    this.timeMode = null;
    this.updateLight();
  }

  resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.baseFov = width < 700 ? 58 : 49;
    if (!this.fovInitialized) {
      this.currentFov = this.camera.fov = this.baseFov;
      this.fovInitialized = true;
    }
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (active) { this.resize(); this.lastTime = 0; this.frame = requestAnimationFrame((time) => this.tick(time)); }
    else { cancelAnimationFrame(this.frame); this.lastTime = 0; this.touchPoints.clear(); this.touchGesture = null; }
  }

  handlePointer(event) {
    if (event.pointerType === "touch") return;
    const rect = this.host.getBoundingClientRect();
    if (event.pointerType === "mouse") {
      const x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      const y = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
      const vertical = clamp((.5 - y) * 2, -1, 1);
      const pitchOffset = vertical >= 0
        ? vertical * vertical * LOOK_PITCH_UP_LIMIT
        : vertical * LOOK_PITCH_DOWN_LIMIT;
      this.viewTarget.set((x - .5) * 2 * LOOK_YAW_LIMIT, pitchOffset);
    }
    this.pointer.set((event.clientX-rect.left)/Math.max(rect.width,1)*2-1, -((event.clientY-rect.top)/Math.max(rect.height,1)*2-1));
    const hit = this.findUmbrella(this.pointer);
    this.hoveredUmbrella = hit;
    this.host.style.cursor = hit ? "pointer" : "";
  }
  handleTouchStart(event) {
    if (!this.active || event.pointerType !== "touch") return;
    this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.host.setPointerCapture?.(event.pointerId);
    if (this.touchPoints.size === 1) {
      this.touchGesture = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, multiple: false };
    } else if (this.touchGesture) {
      this.touchGesture.multiple = true;
      const points = [...this.touchPoints.values()];
      this.touchGesture.lastX = (points[0].x + points[1].x) / 2;
      this.touchGesture.lastY = (points[0].y + points[1].y) / 2;
    }
  }

  handleTouchMove(event) {
    if (event.pointerType !== "touch" || !this.touchPoints.has(event.pointerId) || !this.touchGesture) return;
    const point = this.touchPoints.get(event.pointerId);
    point.x = event.clientX;
    point.y = event.clientY;
    const gesture = this.touchGesture;
    if (this.touchPoints.size >= 2) {
      const points = [...this.touchPoints.values()];
      const x = (points[0].x + points[1].x) / 2;
      const y = (points[0].y + points[1].y) / 2;
      const maxX = Math.max(.1, 2.5 * streetTaperAtDepth(this.depthTarget));
      this.cameraXTarget = clamp(this.cameraXTarget - (x - gesture.lastX) * .012, -maxX, maxX);
      this.viewTarget.y = clamp(this.viewTarget.y + (y - gesture.lastY) * .008, -LOOK_PITCH_DOWN_LIMIT, LOOK_PITCH_UP_LIMIT);
      gesture.lastX = x;
      gesture.lastY = y;
      gesture.moved = true;
      return;
    }
    if (gesture.multiple) return;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < TOUCH_DRAG_THRESHOLD) return;
    gesture.moved = true;
    const dx = event.clientX - gesture.lastX;
    const dy = event.clientY - gesture.lastY;
    const travel = -dy * .025;
    if (!(travel > 0 && this.depthTarget > STREET_WHEEL_TRAVEL_LIMIT)) {
      this.depthTarget = clamp(this.depthTarget + travel, 0, STREET_WHEEL_TRAVEL_LIMIT);
    }
    this.viewTarget.x = clamp(this.viewTarget.x - dx / Math.max(this.host.clientWidth, 1) * 1.8, -TOUCH_LOOK_YAW_LIMIT, TOUCH_LOOK_YAW_LIMIT);
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
  }

  handleTouchEnd(event, cancelled = false) {
    if (event.pointerType !== "touch" || !this.touchPoints.has(event.pointerId)) return;
    this.touchPoints.delete(event.pointerId);
    const gesture = this.touchGesture;
    if (this.touchPoints.size) return;
    this.touchGesture = null;
    // A touch tap selects once; swipes and the browser's following click do not.
    this.ignoreTouchClickUntil = performance.now() + 400;
    if (!cancelled && gesture && !gesture.moved && !gesture.multiple) this.selectAt(event);
  }

  handleClick(event) {
    if (performance.now() < this.ignoreTouchClickUntil) return;
    this.selectAt(event);
  }
  selectAt(event) {
    const rect = this.host.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/Math.max(rect.width,1)*2-1, -((event.clientY-rect.top)/Math.max(rect.height,1)*2-1));
    const hit = this.findUmbrella(this.pointer);
    if (hit) this.onSelect?.(hit.work, { x: event.clientX, y: event.clientY });
  }
  findUmbrella(pointer) {
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit=this.raycaster.intersectObjects(this.canopyPickTargets,false)[0];
    if (!hit) return null;
    const work=hit.object.userData.work || hit.object.userData.works?.[hit.instanceId];
    return work ? { work, object:hit.object, instanceId:hit.instanceId ?? null } : null;
  }

  tick(now) {
    if (!this.active) return;
    const elapsed = this.lastTime ? Math.min((now-this.lastTime)/1000, 1) : .016;
    const dt = Math.min(elapsed, .05);
    this.lastTime = now; this.elapsed += elapsed;
    if (this.elapsed >= this.weatherSwitchAt) {
      const choices = Object.keys(WEATHER).filter((name) => name !== this.weatherName);
      this.setWeather(choices[Math.floor(Math.random() * choices.length)]);
    }
    const blend = 1-Math.exp(-elapsed/2.2), target = WEATHER[this.weatherName];
    for (const key of Object.keys(target)) this.weather[key] = lerp(this.weather[key], target[key], blend);
    this.updateLight(); this.updateRopes(dt); this.updateRain(dt);
    this.shadowElapsed = (this.shadowElapsed || 0) + elapsed;
    if (this.shadowElapsed > 1.2) { this.renderer.shadowMap.needsUpdate = true; this.shadowElapsed = 0; }
    this.viewAngles.x = lerp(this.viewAngles.x, this.viewTarget.x,
      this.reducedMotion ? 1 : 1-Math.exp(-elapsed*3.8));
    const pitchDifference = this.viewTarget.y - this.viewAngles.y;
    const pitchStep = pitchDifference * (1-Math.exp(-elapsed*2));
    this.viewAngles.y += this.reducedMotion ? pitchDifference : clamp(pitchStep, -elapsed*.6, elapsed*.6);
    this.currentFov = lerp(this.currentFov, this.baseFov,
      this.reducedMotion ? 1 : 1-Math.exp(-elapsed*2.8));
    if (Math.abs(this.camera.fov - this.currentFov) > .01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
    this.depth = lerp(this.depth, this.depthTarget, 1-Math.exp(-elapsed*2.6));
    this.cameraX = lerp(this.cameraX, this.cameraXTarget, 1-Math.exp(-elapsed*2.6));
    this.camera.position.set(this.cameraX, 2.05, INITIAL_CAMERA_Z-this.depth);
    const yaw = this.viewAngles.x, pitch = Math.atan2(2.8, 16.4) + this.viewAngles.y, radius = 16.4;
    const horizontal = Math.cos(pitch)*radius;
    this.camera.lookAt(this.camera.position.x + Math.sin(yaw)*horizontal, this.camera.position.y + Math.sin(pitch)*radius,
      this.camera.position.z - Math.cos(yaw)*horizontal);
    const nearestShop = Math.floor((.55-this.camera.position.z)/4.7);
    this.lanternLights.forEach((light, i) => {
      const shopIndex = nearestShop + i % 3;
      light.position.x = (i < 3 ? -1 : 1) * 3.45 * streetTaperAtDepth(2 + shopIndex * 4.7);
      light.position.z = -.55 - shopIndex * 4.7;
    });
    this.syncWetPavingLights();
    this.plants.forEach((plant, i) => { plant.rotation.z = this.reducedMotion ? 0 : Math.sin(this.elapsed*.7+i)*(.004+this.weather.wind*.009); });
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  updateLight() {
    const cycleSeconds = ((this.elapsed + this.timeCycleOffset) % 84 + 84) % 84;
    const cycle = cycleSeconds / 84;
    let daylight = 1;
    if (cycle >= .38 && cycle < .55) daylight = 1-smooth(.38,.55,cycle);
    else if (cycle >= .55 && cycle < .78) daylight = 0;
    else if (cycle >= .78 && cycle < .96) daylight = smooth(.78,.96,cycle);
    const twilight = Math.sin(Math.PI * daylight) * (cycle < .6 ? 1 : .45);
    const weatherDim = 1 - this.weather.clouds*.40;
    this.sun.intensity = (.07 + daylight*2.14) * weatherDim;
    this.canopyFill.intensity = .12 + daylight*.44;
    this.sun.position.set(-7+cycle*14, 3+daylight*10, 5);
    this.sun.color.copy(this.lightColors.sunBase).lerp(this.lightColors.sunset, twilight*.48);
    this.hemisphere.intensity = (.17+daylight*1.18) * (1-this.weather.clouds*.16);
    const colors = this.lightColors;
    const top = colors.top.copy(colors.skyNight).lerp(colors.skyDay, daylight).lerp(colors.skyCloudy, this.weather.clouds*.34*daylight);
    const horizon = colors.horizon.copy(colors.horizonNight).lerp(colors.horizonDay, daylight)
      .lerp(colors.horizonCloudy, this.weather.clouds*.34*daylight).lerp(colors.horizonTwilight, twilight*.24);
    this.skyMaterial.uniforms.top.value.copy(top); this.skyMaterial.uniforms.horizon.value.copy(horizon);
    this.skyMaterial.uniforms.clouds.value = this.weather.clouds; this.skyMaterial.uniforms.time.value = this.elapsed;
    this.mountainMaterial.color.setRGB(.30+daylight*.38, .33+daylight*.38, .37+daylight*.37);
    const fogProgress = smooth(.004, .018, this.weather.fog);
    const mistStrength = lerp(.55, 1.8, fogProgress);
    this.mistLayers.forEach(({ material, amount }, i) => {
      material.uniforms.time.value = this.elapsed * (i % 2 ? -.7 : 1);
      material.uniforms.tint.value.copy(horizon);
      material.uniforms.amount.value = amount * mistStrength;
    });
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.time.value = this.elapsed;
      this.waterMaterial.uniforms.daylight.value = daylight;
      this.waterMaterial.uniforms.rain.value = this.weather.rain;
    }
    this.scene.fog.color.copy(horizon); this.scene.fog.density = this.weather.fog;
    const lamps = clamp((1-daylight)*1.1 + this.weather.clouds*.35 - .12, 0, 1);
    this.daylight = daylight;
    this.lanternLights.forEach((light) => { light.intensity = lamps * 3.5; });
    if (this.materials.LanternSilk) this.materials.LanternSilk.emissiveIntensity = .06 + lamps*3.2;
    if (this.materials.WindowGlass) this.materials.WindowGlass.emissiveIntensity = .025 + lamps*1.55;
    if (this.materials.WindowPaper) this.materials.WindowPaper.emissiveIntensity = .015 + lamps*1.3;
    this.pavingMaterials.forEach(({ material, color, wetUniforms }) => {
      material.roughness = lerp(.94,.22,this.weather.wet);
      material.color.copy(color).multiplyScalar(1-this.weather.wet*.27);
      material.envMapIntensity = .12+this.weather.wet*1.05;
      material.metalness = this.weather.wet * .045;
      wetUniforms.uWetness.value = this.weather.wet;
      wetUniforms.uWetNight.value = clamp((.48 - daylight) / .48, 0, 1);
      wetUniforms.uWetTime.value = this.elapsed;
    });
    this.host.dataset.phase = daylight > .8 ? "day" : daylight < .2 ? "night" : "twilight";
    const timeMode = daylight < .32 ? "night" : "day";
    if (timeMode !== this.timeMode) {
      this.timeMode = timeMode;
      this.onTimeChange(timeMode);
    }
  }

  syncWetPavingLights() {
    this.pavingMaterials.forEach(({ wetUniforms }) => {
      this.lanternLights.forEach((light, index) => {
        wetUniforms[`uWetLantern${index}`].value.set(light.position.x, light.position.z, light.intensity, 0);
      });
    });
    this.artworkMaterials.forEach((material) => {
      const uniforms = material.userData.studioCanopyLanternUniforms;
      if (!uniforms) return;
      this.lanternLights.forEach((light, index) => {
        uniforms[`uStudioLantern${index}`].value.set(light.position.x, light.position.y, light.position.z, light.intensity);
      });
    });
  }

  updateRopes(dt) {
    const wind = this.reducedMotion ? 0 : this.weather.wind;
    for (const rope of this.ropes) {
      const nodes = rope.nodes;
      const sway = Math.sin(this.elapsed * .56 + rope.row * .83) * wind;
      const sag = .05 + wind * .012;
      for (let i = 0; i < nodes.length; i++) {
        const t = i / (nodes.length - 1), envelope = Math.sin(Math.PI * t), node = nodes[i].p;
        node.x = lerp(rope.start.x, rope.end.x, t) + sway * .035 * envelope;
        node.y = lerp(rope.start.y, rope.end.y, t) - sag * 4 * t * (1 - t) + Math.sin(this.elapsed * .72 + t * 2.8 + rope.row) * wind * .012 * envelope;
        node.z = rope.z + Math.sin(this.elapsed * .68 + t * 2.2 + rope.row * .7) * wind * .022 * envelope;
      }
      const pos=rope.geometry.attributes.position;
      nodes.forEach((node,i)=>pos.setXYZ(i,node.p.x,node.p.y,node.p.z)); pos.needsUpdate=true;
    }
    for (const item of this.umbrellas) {
      const rope=this.ropes[item.row];
      const nodeIndex=Math.round(item.ropePosition*(rope.nodes.length-1));
      const node=rope.nodes[nodeIndex], anchor=node.p;
      const target=Math.sin(this.elapsed*(.65+item.row*.05)+item.phase)*wind*.055;
      item.velocity += ((target-item.angle)*5-item.velocity*2.8)*dt; item.angle += item.velocity*dt;
      const length=UMBRELLA_HANG_LENGTHS[item.row] + UMBRELLA_COLUMN_DROPS[Math.min(item.column,2)];
      item.group.position.set(anchor.x+Math.sin(item.angle)*length,anchor.y-Math.cos(item.angle)*length,anchor.z);
      item.group.rotation.set(.035*Math.sin(this.elapsed*.5+item.phase)*wind, item.phase*.15, Math.PI+item.angle+item.tilt);
      const pos=item.cord.geometry.attributes.position;
      for(let i=0;i<4;i++){const t=i/3;pos.setXYZ(i,lerp(anchor.x,item.group.position.x,t)+Math.sin(t*Math.PI)*wind*.025,lerp(anchor.y,item.group.position.y,t),lerp(anchor.z,item.group.position.z,t));} pos.needsUpdate=true;
    }
  }

  updateRain(dt) {
    this.rainMaterial.opacity = this.weather.rain*.42;
    this.rain.visible = this.weather.rain > .005;
    if (!this.rain.visible) return;
    const pos=this.rainGeometry.attributes.position;
    for(let i=0;i<pos.count;i+=2){let x=pos.getX(i)+this.weather.wind*dt*.12, y=pos.getY(i)-dt*(5+(i%7)*.18), z=pos.getZ(i);if(y<0){y=8.5;x=(Math.random()-.5)*15;z=8-Math.random()*40;}pos.setXYZ(i,x,y,z);pos.setXYZ(i+1,x-.018,y+.13,z);}
    pos.needsUpdate=true;
  }
}
