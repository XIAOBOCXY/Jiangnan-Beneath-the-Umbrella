import * as THREE from "three";

const LEGACY_FABRIC_MATERIALS = Object.freeze({
  scenery: "georgette", painting: "plainSilk", embroidery: "denseSilk",
  silk: "plainSilk", gauze: "georgette", indigo: "denseSilk", blueCloth: "denseSilk", satin: "plainSilk", damask: "denseSilk"
});

export const FABRIC_PROFILES = Object.freeze({
  georgette: {
    crown: 0.014, pleat: 0.0022, edge: -0.005, panelTension: 0.001,
    roughness: 0.92, sheen: 0.13, sheenRoughness: 0.97, specular: 0.035, normal: 0.18, anisotropy: 0,
    relief: 0.11, roughMap: 250, roughContrast: 3, transmission: 0.92,
    studioRoughness: 0.94, studioSheen: 0.08, studioNormal: 0.075, studioSpecular: 0.04, studioWeave: 0.065, opacity: 0.78, finish: 0.08
  },
  plainSilk: {
    crown: 0.014, pleat: 0.0026, edge: -0.007, panelTension: 0.0015,
    roughness: 0.90, sheen: 0.16, sheenRoughness: 0.96, specular: 0.042, normal: 0.20, anisotropy: 0,
    relief: 0.14, roughMap: 249, roughContrast: 4, transmission: 0.85,
    studioRoughness: 0.78, studioSheen: 0.27, studioNormal: 0.065, studioSpecular: 0.13, studioWeave: 0.036, opacity: 0.90, finish: 0.34
  },
  denseSilk: {
    crown: 0.017, pleat: 0.0034, edge: -0.010, panelTension: 0.0024,
    roughness: 0.94, sheen: 0.11, sheenRoughness: 0.98, specular: 0.03, normal: 0.17, anisotropy: 0,
    relief: 0.10, roughMap: 251, roughContrast: 3, transmission: 0.78,
    studioRoughness: 0.70, studioSheen: 0.38, studioNormal: 0.07, studioSpecular: 0.19, studioWeave: 0.036, opacity: 0.96, finish: 0.56
  }
});

export function normalizeFabricMaterial(material) {
  const normalized = LEGACY_FABRIC_MATERIALS[material] || material;
  return Object.hasOwn(FABRIC_PROFILES, normalized) ? normalized : "georgette";
}

export function updateSilkDetailMaps(normalTexture, roughnessTexture, material) {
  if (!normalTexture?.image?.data || !roughnessTexture?.image?.data) return;
  const style = normalizeFabricMaterial(material);
  const size = normalTexture.image.width;
  const normalPixels = normalTexture.image.data;
  const roughPixels = roughnessTexture.image.data;
  const profile = FABRIC_PROFILES[style];
  const relief = (x, y) => Math.sin(x * Math.PI / 4.8 + Math.sin(y * 0.11) * 0.16)
      * Math.sin(y * Math.PI / 5.7 + Math.sin(x * 0.13) * 0.14) * 0.16
    + Math.sin((x * 0.71 + y * 0.39) * Math.PI / 9.5) * 0.025
    + Math.sin((x * 13 + y * 7) * 0.37) * 0.012
    + (style === "denseSilk" ? Math.sin(x * Math.PI / 3.1 + Math.sin(y * 0.18)) * 0.008 : 0);
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
      const value = Math.max(0, Math.min(255, profile.roughMap + samples[y * size + x] * profile.roughContrast));
      roughPixels[index] = value;
      roughPixels[index + 1] = value;
      roughPixels[index + 2] = value;
      roughPixels[index + 3] = 255;
    }
  }
  normalTexture.needsUpdate = true;
  roughnessTexture.needsUpdate = true;
}

export function createSilkDetailMaps(material = "georgette", anisotropy = 1) {
  const size = 128;
  const makeTexture = () => {
    const texture = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 10);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
  };
  const maps = { normalTexture: makeTexture(), roughnessTexture: makeTexture() };
  updateSilkDetailMaps(maps.normalTexture, maps.roughnessTexture, material);
  return maps;
}

export function createCanopyMaterial({
  canvasTexture = null,
  normalTexture,
  roughnessTexture,
  inkDyeTexture = null,
  inkOpacity = 1,
  fabricMaterial = "georgette",
  displayMode = "3d",
  studioFabricLift = 1
} = {}) {
  const style = normalizeFabricMaterial(fabricMaterial);
  const profile = FABRIC_PROFILES[style];
  const studio = displayMode === "3d";
  const dynamicUniforms = {
    uAudioLevel: { value: 0 },
    uAudioTime: { value: 0 },
    uInkDye: { value: inkDyeTexture },
    uInkOpacity: { value: inkOpacity },
    uStudioFabricLift: { value: studio ? studioFabricLift : 0 },
    uStudioFabricTransmission: { value: studio ? profile.transmission : 0 },
    uStudioWeaveStrength: { value: studio ? profile.studioWeave : 0 },
    uStudioSilkFinish: { value: studio ? profile.finish : 0 }
  };
  // Vector4 defaults w to 1. Its w component is the lamp intensity, so an
  // omitted value accidentally enables six warm lights at the origin.
  for (let index = 0; index < 6; index += 1) dynamicUniforms[`uStudioLantern${index}`] = { value: new THREE.Vector4(0, 0, 0, 0) };

  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    map: canvasTexture,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(studio ? profile.studioNormal : profile.normal, studio ? profile.studioNormal : profile.normal),
    roughnessMap: roughnessTexture,
    roughness: studio ? profile.studioRoughness : profile.roughness,
    metalness: 0,
    envMap: null,
    envMapIntensity: 0,
    sheen: studio ? profile.studioSheen : profile.sheen,
    sheenRoughness: profile.sheenRoughness,
    sheenColor: new THREE.Color("#e5e5e5"),
    specularIntensity: studio ? profile.studioSpecular : profile.specular,
    specularColor: new THREE.Color("#dedede"),
    anisotropy: profile.anisotropy,
    anisotropyRotation: 0,
    clearcoat: 0,
    clearcoatRoughness: 1,
    transmission: 0,
    thickness: 0,
    ior: 1.25,
    transparent: studio,
    opacity: studio ? profile.opacity : 1,
    depthWrite: true,
    side: THREE.DoubleSide,
    // The artwork and studio shader perform their own display conversion;
    // bypass scene tone mapping so the gallery's ACES scene cannot recolor silk.
    toneMapped: false
  });
  material.userData.dynamicUniforms = dynamicUniforms;
  material.userData.studioCanopyLanternUniforms = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [`uStudioLantern${index}`, dynamicUniforms[`uStudioLantern${index}`]])
  );
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, dynamicUniforms);
    const lampUniforms = Array.from({ length: 6 }, (_, index) => `uniform vec4 uStudioLantern${index};`).join("\n");
    const lampTerms = Array.from({ length: 6 }, (_, index) => `studioLanternLight(vStudioWorld, normal, uStudioLantern${index})`).join(" + ");
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uAudioLevel;\nuniform float uAudioTime;\nvarying vec2 vCanopyUv;\nvarying vec3 vStudioWorld;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCanopyUv = uv;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float canopyRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
        float audioCrease = sin(uAudioTime * 5.0 - canopyRadius * 13.0) * uAudioLevel * 0.0055;
        transformed += objectNormal * audioCrease;
        vStudioWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uAudioLevel;
uniform float uAudioTime;
uniform sampler2D uInkDye;
uniform float uInkOpacity;
uniform float uStudioFabricLift;
uniform float uStudioFabricTransmission;
uniform float uStudioWeaveStrength;
uniform float uStudioSilkFinish;
varying vec2 vCanopyUv;
varying vec3 vStudioWorld;
${lampUniforms}
float studioLanternLight(vec3 worldPoint, vec3 surfaceNormal, vec4 lantern) {
  vec3 toLamp = lantern.xyz - worldPoint;
  float distanceToLamp = length(toLamp);
  float attenuation = lantern.w / (1.0 + 0.28 * distanceToLamp + 0.12 * distanceToLamp * distanceToLamp);
  vec3 worldNormal = inverseTransformDirection(surfaceNormal, viewMatrix);
  float facing = 0.28 + 0.72 * abs(dot(worldNormal, normalize(toLamp)));
  return attenuation * facing * exp(-distanceToLamp * distanceToLamp * 0.018);
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec4 wetInk = texture2D(uInkDye, vCanopyUv);
        float wetInkAlpha = clamp(wetInk.a * uInkOpacity * 0.78, 0.0, 0.76);
        diffuseColor.rgb = mix(diffuseColor.rgb, wetInk.rgb, wetInkAlpha);`)
      .replace("#include <colorspace_fragment>", `#include <colorspace_fragment>
        if (uStudioFabricLift > 0.001) {
          const float STUDIO_TAU = 6.28318530718;
          float studioWarp = sin((vCanopyUv.x * 74.0 + 0.10 * sin(vCanopyUv.y * 13.0)) * STUDIO_TAU);
          float studioWeft = sin((vCanopyUv.y * 70.0 + 0.08 * sin(vCanopyUv.x * 16.0)) * STUDIO_TAU);
          float studioSlub = sin((vCanopyUv.x * 0.71 + vCanopyUv.y * 0.43) * STUDIO_TAU * 19.0);
          // Keep the gauze translucent between fine crossing fibers. Fade the
          // mesh at a distance so tiny umbrellas do not acquire moire patterns.
          float studioMeshVisibility = 1.0 - smoothstep(0.20, 0.50, max(fwidth(vCanopyUv.x * 148.0), fwidth(vCanopyUv.y * 140.0)));
          float studioThread = max(smoothstep(0.80, 0.96, abs(studioWarp)), smoothstep(0.80, 0.96, abs(studioWeft)));
          float studioGauze = smoothstep(0.80, 0.92, uStudioFabricTransmission);
          gl_FragColor.a *= mix(1.0, 0.96 + studioThread * 0.06, studioGauze * studioMeshVisibility);
          float studioGrain = 1.0 + uStudioWeaveStrength * (0.09 * studioWarp + 0.08 * studioWeft + 0.045 * studioWarp * studioWeft + 0.025 * studioSlub);
          float studioRadius = length(vCanopyUv - vec2(0.5)) * 1.4142;
          float studioDome = 1.0 - 0.004 * smoothstep(0.08, 1.0, studioRadius);
          vec3 studioSilk = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.74));
          studioSilk = mix(studioSilk, vec3(1.0), 0.022);
          studioSilk = studioSilk * 1.012 + vec3(0.0025);
          float lanternWash = ${lampTerms};
          studioSilk = studioSilk * (vec3(1.0) + vec3(1.0, 0.37, 0.10) * lanternWash * 0.26);
          studioSilk += vec3(1.0, 0.27, 0.055) * lanternWash * 0.018;
          studioSilk = studioSilk * studioGrain * studioDome;
          float silkGlance = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
          studioSilk += vec3(0.042) * silkGlance * uStudioSilkFinish;
          float audioPhase = 0.5 + 0.5 * sin(uAudioTime * 2.4 + vCanopyUv.x * 9.0 + vCanopyUv.y * 5.0);
          float audioShimmer = pow(audioPhase, 1.35) * uAudioLevel;
          float audioRipple = pow(0.5 + 0.5 * sin(uAudioTime * 3.1 - studioRadius * 17.0), 5.0) * uAudioLevel;
          studioSilk += vec3(0.34) * audioShimmer * (0.28 + silkGlance);
          studioSilk += vec3(0.17) * audioRipple * 0.48;
          vec3 studioDisplayColor = linearToOutputTexel(vec4(clamp(studioSilk, 0.0, 1.0), diffuseColor.a)).rgb;
          // Keep the soft light and silk sheen, with less variation in the dye
          // as the user rotates the umbrella or switches between fabrics.
          gl_FragColor.rgb = mix(studioDisplayColor, gl_FragColor.rgb, 0.10 + uStudioSilkFinish * 0.14);
        }`);
  };
  material.customProgramCacheKey = () => "jiangnan-shared-studio-silk-v7";
  return material;
}
