// GPU ink simulation inspired by PavelDoGreat's WebGL Fluid Simulation.
// This adapts the fluid pass graph to the umbrella UV surface and shares the
// application's existing Three.js renderer and artwork data model.
const MAX_SPLATS_PER_PASS = 32;

export class InkFluidSystem {
  constructor(THREE, renderer, { velocitySize = 128, dyeSize = 512, wetnessSize = 256, pressureIterations = 8 } = {}) {
    this.THREE = THREE;
    this.renderer = renderer;
    this.velocitySize = velocitySize;
    this.dyeSize = dyeSize;
    this.wetnessSize = wetnessSize;
    this.pressureIterations = pressureIterations;

    // Half float keeps small velocities and pressure gradients from collapsing
    // into 8-bit color steps. The packed fallback keeps older WebGL devices usable.
    this.useHalfFloat = Boolean(renderer.capabilities?.isWebGL2 && renderer.extensions?.has("EXT_color_buffer_float"));
    this.fieldType = this.useHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.velocityRange = 6;
    this.scalarRange = 24;

    this.neutralFieldColor = this.useHalfFloat ? 0x000000 : 0x808080;
    this.velocityTargets = this.createPair(velocitySize, this.neutralFieldColor);
    this.dyeTargets = this.createPair(dyeSize, 0x000000);
    this.wetnessTargets = this.createPair(wetnessSize, this.neutralFieldColor);
    this.pressureTargets = this.createPair(velocitySize, this.neutralFieldColor);
    this.curlTarget = this.createTarget(velocitySize, this.neutralFieldColor);
    this.divergenceTarget = this.createTarget(velocitySize, this.neutralFieldColor);
    this.velocityIndex = 0;
    this.dyeIndex = 0;
    this.wetnessIndex = 0;
    this.pressureIndex = 0;
    this.pendingSplats = [];
    this.debugMode = "composite";
    this.lastStepAt = 0;
    this.lastSplatAt = 0;
    this.version = 0;
    this.aspect = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.materials = {};
    this.createPasses();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.velocitySplat);
    this.scene.add(this.quad);

    this.displayScene = new THREE.Scene();
    this.displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.displayMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uDye: { value: this.dyeTargets[0].texture },
        uVelocity: { value: this.velocityTargets[0].texture },
        uWetness: { value: this.wetnessTargets[0].texture },
        uDebugMode: { value: 0 },
        uDisplayOpacity: { value: 1 },
        uTexel: { value: new THREE.Vector2(1 / dyeSize, 1 / dyeSize) },
        uHalfFloat: { value: this.useHalfFloat ? 1 : 0 },
        uVelocityRange: { value: this.velocityRange },
        uScalarRange: { value: this.scalarRange }
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uDye;
        uniform sampler2D uVelocity;
        uniform sampler2D uWetness;
        uniform int uDebugMode;
        uniform float uDisplayOpacity;
        uniform vec2 uTexel;
        uniform float uHalfFloat;
        uniform float uVelocityRange;
        uniform float uScalarRange;
        vec2 decodeVelocity(vec2 value){return uHalfFloat>0.5?value:(value-0.5019608)*(2.0*uVelocityRange);}
        float decodeScalar(float value){return uHalfFloat>0.5?value:(value-0.5019608)*(2.0*uScalarRange);}
        void main(){
          float radius=length((vUv-0.5)*2.0);
          float canopy=1.0-smoothstep(0.988,1.0,radius);
          vec4 dye=texture2D(uDye,vUv);
          if(uDebugMode==1){
            vec2 flow=decodeVelocity(texture2D(uVelocity,vUv).rg);
            float energy=clamp(length(flow)/3.2,0.0,1.0);
            vec3 direction=vec3(0.46+flow.x*0.085,0.54+flow.y*0.085,0.53-energy*0.08);
            gl_FragColor=vec4(clamp(direction,0.0,1.0),0.84*canopy*uDisplayOpacity); return;
          }
          if(uDebugMode==2){gl_FragColor=vec4(dye.rgb,min(0.96,dye.a)*canopy*uDisplayOpacity);return;}
          if(uDebugMode==3){
            float wet=clamp(decodeScalar(texture2D(uWetness,vUv).r),0.0,1.0);
            gl_FragColor=vec4(0.28,0.58,0.55,wet*0.82*canopy*uDisplayOpacity);return;
          }

          // Read a small neighborhood to give wet pigment a soft watercolor
          // fringe and gently raised ink edge without blurring the whole mark.
          float left=texture2D(uDye,vUv-vec2(uTexel.x*1.8,0.0)).a;
          float right=texture2D(uDye,vUv+vec2(uTexel.x*1.8,0.0)).a;
          float top=texture2D(uDye,vUv+vec2(0.0,uTexel.y*1.8)).a;
          float bottom=texture2D(uDye,vUv-vec2(0.0,uTexel.y*1.8)).a;
          float softEdge=(left+right+top+bottom)*0.25;
          float wet=clamp(decodeScalar(texture2D(uWetness,vUv).r),0.0,1.0);
          float halo=wet>0.08?softEdge*0.18*wet:0.0;
          vec2 pigmentGradient=vec2(right-left,top-bottom);
          float silkLight=clamp(0.98-dot(pigmentGradient,vec2(0.24,-0.18)),0.82,1.08);
          float fiber=0.985+0.015*sin(vUv.x*910.0+sin(vUv.y*420.0));
          float alpha=clamp(dye.a*0.94+halo,0.0,0.96)*canopy*uDisplayOpacity;
          gl_FragColor=vec4(dye.rgb*silkLight*fiber,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    this.displayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.displayMaterial);
    this.displayScene.add(this.displayQuad);
    this.setDebugMode("composite");
  }

  createTarget(size, clearColor = 0x000000) {
    const target = new this.THREE.WebGLRenderTarget(size, size, {
      format: this.THREE.RGBAFormat,
      type: this.fieldType,
      minFilter: this.THREE.LinearFilter,
      magFilter: this.THREE.LinearFilter,
      wrapS: this.THREE.ClampToEdgeWrapping,
      wrapT: this.THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    target.texture.colorSpace = this.THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    this.clearTarget(target, clearColor);
    return target;
  }

  createPair(size, clearColor = 0x000000) { return [this.createTarget(size, clearColor), this.createTarget(size, clearColor)]; }

  clearTarget(target, color = 0x000000, alpha = 0) {
    const oldTarget = this.renderer.getRenderTarget();
    const oldColor = this.renderer.getClearColor(new this.THREE.Color());
    const oldAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(color, alpha);
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(oldTarget);
    this.renderer.setClearColor(oldColor, oldAlpha);
  }

  createPasses() {
    const shared = `
      varying vec2 vUv;
      uniform float uDt;
      uniform vec2 uSplatUv;
      uniform vec2 uForce;
      uniform float uRadius;
      uniform float uOpacity;
      uniform float uAspect;
      uniform float uHalfFloat;
      uniform float uVelocityRange;
      uniform float uScalarRange;
      uniform vec2 uTexel;
      uniform int uSplatCount;
      uniform vec4 uSplatPath[${MAX_SPLATS_PER_PASS}];
      uniform vec4 uSplatInk[${MAX_SPLATS_PER_PASS}];
      uniform vec4 uSplatFlow[${MAX_SPLATS_PER_PASS}];
      uniform vec4 uSplatAux[${MAX_SPLATS_PER_PASS}];
      vec2 decodeVelocity(vec2 value){return uHalfFloat>0.5?value:(value-0.5019608)*(2.0*uVelocityRange);}
      vec2 encodeVelocity(vec2 value){return uHalfFloat>0.5?value:clamp(value/(2.0*uVelocityRange)+0.5019608,0.0,1.0);}
      float decodeScalar(float value){return uHalfFloat>0.5?value:(value-0.5019608)*(2.0*uScalarRange);}
      float encodeScalar(float value){return uHalfFloat>0.5?value:clamp(value/(2.0*uScalarRange)+0.5019608,0.0,1.0);}
      bool segmentNearPixel(vec2 uv, vec4 path, float radius){
        vec2 p=uv*vec2(uAspect,1.0);
        vec2 a=path.xy*vec2(uAspect,1.0);
        vec2 b=path.zw*vec2(uAspect,1.0);
        vec2 margin=vec2(radius*2.7);
        vec2 low=min(a,b)-margin;
        vec2 high=max(a,b)+margin;
        return p.x>=low.x&&p.y>=low.y&&p.x<=high.x&&p.y<=high.y;
      }
      float segmentStamp(vec2 uv, vec4 path, float radius, float grain, float seed, float speed, float pressure, float water){
        vec2 p=uv*vec2(uAspect,1.0);
        vec2 a=path.xy*vec2(uAspect,1.0);
        vec2 b=path.zw*vec2(uAspect,1.0);
        vec2 ab=b-a;
        float t=clamp(dot(p-a,ab)/max(dot(ab,ab),0.000001),0.0,1.0);
        vec2 delta=p-(a+ab*t);
        float angle=length(delta)>0.00001?atan(delta.y,delta.x):seed*6.2831853;
        float wetEdge=smoothstep(0.01,0.16,water);
        float edge=1.0+grain*wetEdge*(0.48*sin(angle*5.0+seed*17.0)+0.32*sin(angle*11.0-seed*9.0)+0.20*sin(angle*17.0+seed*5.0));
        // Yakudoo uses one speed-responsive line segment for the ink mark.
        float responsiveRadius=radius*edge*(1.0+speed*0.18)*mix(0.86,1.18,pressure);
        float fibers=0.68+0.32*(0.5+0.5*sin((uv.x*0.87+uv.y*0.49)*420.0+seed*23.0));
        float fiberAmount=clamp(grain*4.0,0.0,0.78);
        float distanceToStroke=length(delta);
        // Wet presets get a broad pigment bleed edge. Dry presets use a narrow
        // antialiased edge so fiber/clean marks stay crisp instead of looking
        // like watercolor even when their grain setting is nonzero.
        float edgeStart=mix(0.94,0.62,wetEdge);
        float segment=1.0-smoothstep(responsiveRadius*edgeStart,responsiveRadius,distanceToStroke);
        return segment*mix(1.0,fibers,fiberAmount);
      }
    `;
    const pass = (extraUniforms, body) => new this.THREE.ShaderMaterial({
      uniforms: {
        uDt: { value: 1 / 60 },
        uSplatUv: { value: new this.THREE.Vector2(-2, -2) },
        uForce: { value: new this.THREE.Vector2() },
        uRadius: { value: 0.018 },
        uOpacity: { value: 0 },
        uSplatCount: { value: 0 },
        uSplatPath: { value: new Float32Array(MAX_SPLATS_PER_PASS * 4) },
        uSplatInk: { value: new Float32Array(MAX_SPLATS_PER_PASS * 4) },
        uSplatFlow: { value: new Float32Array(MAX_SPLATS_PER_PASS * 4) },
        uSplatAux: { value: new Float32Array(MAX_SPLATS_PER_PASS * 4) },
        uAspect: { value: 1 },
        uHalfFloat: { value: this.useHalfFloat ? 1 : 0 },
        uVelocityRange: { value: this.velocityRange },
        uScalarRange: { value: this.scalarRange },
        uTexel: { value: new this.THREE.Vector2(1 / this.velocitySize, 1 / this.velocitySize) },
        ...extraUniforms
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `precision highp float; ${shared} ${body}`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: this.THREE.NoBlending
    });

    this.materials.velocitySplat = pass({ uPrevious: { value: this.velocityTargets[0].texture } }, `
      uniform sampler2D uPrevious;
      void main(){
        vec2 velocity=decodeVelocity(texture2D(uPrevious,vUv).rg);
        for(int i=0;i<${MAX_SPLATS_PER_PASS};i++){
          if(i>=uSplatCount) break;
          vec4 path=uSplatPath[i];
          vec4 ink=uSplatInk[i];
          vec4 flow=uSplatFlow[i];
          if(segmentNearPixel(vUv,path,ink.a)){
            float stamp=segmentStamp(vUv,path,ink.a,uSplatAux[i].x,uSplatAux[i].y,uSplatAux[i].z,uSplatAux[i].w,flow.w)*flow.z;
            velocity+=flow.xy*stamp*2.15;
          }
        }
        float canopy=1.0-smoothstep(0.484,0.498,length(vUv-0.5));
        gl_FragColor=vec4(mix(encodeVelocity(vec2(0.0)),encodeVelocity(clamp(velocity,vec2(-uVelocityRange),vec2(uVelocityRange))),canopy),0.0,1.0);
      }
    `);
    this.materials.dyeSplat = pass({
      uPrevious: { value: this.dyeTargets[0].texture },
      uColor: { value: new this.THREE.Color("#537c7e") }
    }, `
      uniform sampler2D uPrevious;
      uniform vec3 uColor;
      void main(){
        vec4 previous=texture2D(uPrevious,vUv);
        vec3 premultiplied=previous.rgb*previous.a;
        float alpha=previous.a;
        for(int i=0;i<${MAX_SPLATS_PER_PASS};i++){
          if(i>=uSplatCount) break;
          vec4 path=uSplatPath[i];
          vec4 ink=uSplatInk[i];
          vec4 flow=uSplatFlow[i];
          if(segmentNearPixel(vUv,path,ink.a)){
            float stamp=segmentStamp(vUv,path,ink.a,uSplatAux[i].x,uSplatAux[i].y,uSplatAux[i].z,uSplatAux[i].w,flow.w)*flow.z*0.82;
            float nextAlpha=clamp(stamp+alpha*(1.0-stamp),0.0,0.98);
            premultiplied=premultiplied*(1.0-stamp)+ink.rgb*stamp;
            alpha=nextAlpha;
          }
        }
        gl_FragColor=vec4(premultiplied/max(alpha,0.0001),alpha);
      }
    `);
    this.materials.wetnessSplat = pass({ uPrevious: { value: this.wetnessTargets[0].texture } }, `
      uniform sampler2D uPrevious;
      void main(){
        float wet=decodeScalar(texture2D(uPrevious,vUv).r);
        for(int i=0;i<${MAX_SPLATS_PER_PASS};i++){
          if(i>=uSplatCount) break;
          vec4 path=uSplatPath[i];
          vec4 ink=uSplatInk[i];
          vec4 flow=uSplatFlow[i];
          if(segmentNearPixel(vUv,path,ink.a*1.9)){
            float stamp=segmentStamp(vUv,path,ink.a*1.9,uSplatAux[i].x,uSplatAux[i].y,uSplatAux[i].z,uSplatAux[i].w,flow.w)*flow.z*flow.w;
            wet=max(wet,stamp);
          }
        }
        gl_FragColor=vec4(encodeScalar(wet),0.0,0.0,1.0);
      }
    `);

    this.materials.curl = pass({ uVelocity: { value: this.velocityTargets[0].texture } }, `
      uniform sampler2D uVelocity;
      void main(){
        vec2 l=decodeVelocity(texture2D(uVelocity,vUv-vec2(uTexel.x,0.0)).rg);
        vec2 r=decodeVelocity(texture2D(uVelocity,vUv+vec2(uTexel.x,0.0)).rg);
        vec2 t=decodeVelocity(texture2D(uVelocity,vUv+vec2(0.0,uTexel.y)).rg);
        vec2 b=decodeVelocity(texture2D(uVelocity,vUv-vec2(0.0,uTexel.y)).rg);
        float curl=(r.y-l.y-t.x+b.x)*0.5;
        gl_FragColor=vec4(encodeScalar(curl),0.0,0.0,1.0);
      }
    `);
    this.materials.vorticity = pass({
      uVelocity: { value: this.velocityTargets[0].texture },
      uCurl: { value: this.curlTarget.texture },
      uVorticity: { value: 20 }
    }, `
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float uVorticity;
      void main(){
        float l=decodeScalar(texture2D(uCurl,vUv-vec2(uTexel.x,0.0)).r);
        float r=decodeScalar(texture2D(uCurl,vUv+vec2(uTexel.x,0.0)).r);
        float t=decodeScalar(texture2D(uCurl,vUv+vec2(0.0,uTexel.y)).r);
        float b=decodeScalar(texture2D(uCurl,vUv-vec2(0.0,uTexel.y)).r);
        float c=decodeScalar(texture2D(uCurl,vUv).r);
        vec2 force=0.5*vec2(abs(t)-abs(b),abs(r)-abs(l));
        force/=length(force)+0.0001;
        force*=uVorticity*c*uDt;
        force.y*=-1.0;
        vec2 velocity=decodeVelocity(texture2D(uVelocity,vUv).rg)+force;
        float canopy=1.0-smoothstep(0.484,0.498,length(vUv-0.5));
        gl_FragColor=vec4(mix(encodeVelocity(vec2(0.0)),encodeVelocity(clamp(velocity,vec2(-uVelocityRange),vec2(uVelocityRange))),canopy),0.0,1.0);
      }
    `);
    this.materials.divergence = pass({ uVelocity: { value: this.velocityTargets[0].texture } }, `
      uniform sampler2D uVelocity;
      void main(){
        vec2 l=decodeVelocity(texture2D(uVelocity,vUv-vec2(uTexel.x,0.0)).rg);
        vec2 r=decodeVelocity(texture2D(uVelocity,vUv+vec2(uTexel.x,0.0)).rg);
        vec2 t=decodeVelocity(texture2D(uVelocity,vUv+vec2(0.0,uTexel.y)).rg);
        vec2 b=decodeVelocity(texture2D(uVelocity,vUv-vec2(0.0,uTexel.y)).rg);
        float div=0.5*(r.x-l.x+t.y-b.y);
        gl_FragColor=vec4(encodeScalar(div),0.0,0.0,1.0);
      }
    `);
    this.materials.pressureClear = pass({ uPrevious: { value: this.pressureTargets[0].texture }, uPressureRetention: { value: 0.66 } }, `
      uniform sampler2D uPrevious;
      uniform float uPressureRetention;
      void main(){float p=decodeScalar(texture2D(uPrevious,vUv).r)*uPressureRetention;gl_FragColor=vec4(encodeScalar(p),0.0,0.0,1.0);}
    `);
    this.materials.pressure = pass({
      uPrevious: { value: this.pressureTargets[0].texture },
      uDivergence: { value: this.divergenceTarget.texture }
    }, `
      uniform sampler2D uPrevious;
      uniform sampler2D uDivergence;
      void main(){
        float l=decodeScalar(texture2D(uPrevious,vUv-vec2(uTexel.x,0.0)).r);
        float r=decodeScalar(texture2D(uPrevious,vUv+vec2(uTexel.x,0.0)).r);
        float t=decodeScalar(texture2D(uPrevious,vUv+vec2(0.0,uTexel.y)).r);
        float b=decodeScalar(texture2D(uPrevious,vUv-vec2(0.0,uTexel.y)).r);
        float div=decodeScalar(texture2D(uDivergence,vUv).r);
        float p=(l+r+t+b-div)*0.25;
        gl_FragColor=vec4(encodeScalar(p),0.0,0.0,1.0);
      }
    `);
    this.materials.gradient = pass({
      uVelocity: { value: this.velocityTargets[0].texture },
      uPressure: { value: this.pressureTargets[0].texture }
    }, `
      uniform sampler2D uVelocity;
      uniform sampler2D uPressure;
      void main(){
        float l=decodeScalar(texture2D(uPressure,vUv-vec2(uTexel.x,0.0)).r);
        float r=decodeScalar(texture2D(uPressure,vUv+vec2(uTexel.x,0.0)).r);
        float t=decodeScalar(texture2D(uPressure,vUv+vec2(0.0,uTexel.y)).r);
        float b=decodeScalar(texture2D(uPressure,vUv-vec2(0.0,uTexel.y)).r);
        vec2 velocity=decodeVelocity(texture2D(uVelocity,vUv).rg)-0.5*vec2(r-l,t-b);
        float canopy=1.0-smoothstep(0.484,0.498,length(vUv-0.5));
        gl_FragColor=vec4(mix(encodeVelocity(vec2(0.0)),encodeVelocity(clamp(velocity,vec2(-uVelocityRange),vec2(uVelocityRange))),canopy),0.0,1.0);
      }
    `);
    this.materials.velocityAdvection = pass({ uVelocity: { value: this.velocityTargets[0].texture } }, `
      uniform sampler2D uVelocity;
      void main(){
        vec2 velocity=decodeVelocity(texture2D(uVelocity,vUv).rg);
        vec2 backUv=clamp(vUv-velocity*uDt*0.82,0.001,0.999);
        vec2 advected=decodeVelocity(texture2D(uVelocity,backUv).rg)*exp(-uDt*1.15);
        float canopy=1.0-smoothstep(0.484,0.498,length(vUv-0.5));
        gl_FragColor=vec4(mix(encodeVelocity(vec2(0.0)),encodeVelocity(clamp(advected,vec2(-uVelocityRange),vec2(uVelocityRange))),canopy),0.0,1.0);
      }
    `);
    this.materials.dyeAdvection = pass({
      uPrevious: { value: this.dyeTargets[0].texture },
      uVelocity: { value: this.velocityTargets[0].texture },
      uWetness: { value: this.wetnessTargets[0].texture }
    }, `
      uniform sampler2D uPrevious;
      uniform sampler2D uVelocity;
      uniform sampler2D uWetness;
      void main(){
        vec2 velocity=decodeVelocity(texture2D(uVelocity,vUv).rg);
        float wet=clamp(decodeScalar(texture2D(uWetness,vUv).r),0.0,1.0);
        float mobility=smoothstep(0.015,0.24,wet);
        vec2 backUv=clamp(vUv-velocity*uDt*1.32*mobility,0.001,0.999);
        if(length(backUv-0.5)>0.497) backUv=vUv;
        vec4 dye=texture2D(uPrevious,backUv);
        vec4 left=texture2D(uPrevious,clamp(backUv-vec2(uTexel.x*5.5,0.0),0.001,0.999));
        vec4 right=texture2D(uPrevious,clamp(backUv+vec2(uTexel.x*5.5,0.0),0.001,0.999));
        vec4 top=texture2D(uPrevious,clamp(backUv+vec2(0.0,uTexel.y*5.5),0.001,0.999));
        vec4 bottom=texture2D(uPrevious,clamp(backUv-vec2(0.0,uTexel.y*5.5),0.001,0.999));
        vec4 neighbors=(left+right+top+bottom)*0.25;
        float diffusion=clamp(wet*uDt*1.9,0.0,0.055);
        dye=mix(dye,neighbors,diffusion);
        // Dry pigment is permanent. Wetness controls motion and diffusion;
        // once the paper dries, the dye alpha is no longer dissipated.
        gl_FragColor=vec4(dye.rgb,dye.a);
      }
    `);
    this.materials.wetnessAdvection = pass({
      uPrevious: { value: this.wetnessTargets[0].texture },
      uVelocity: { value: this.velocityTargets[0].texture }
    }, `
      uniform sampler2D uPrevious;
      uniform sampler2D uVelocity;
      void main(){
        vec2 velocity=decodeVelocity(texture2D(uVelocity,vUv).rg);
        vec2 backUv=clamp(vUv-velocity*uDt*0.6,0.001,0.999);
        float wet=decodeScalar(texture2D(uPrevious,backUv).r);
        float left=decodeScalar(texture2D(uPrevious,clamp(backUv-vec2(uTexel.x*1.5,0.0),0.001,0.999)).r);
        float right=decodeScalar(texture2D(uPrevious,clamp(backUv+vec2(uTexel.x*1.5,0.0),0.001,0.999)).r);
        float top=decodeScalar(texture2D(uPrevious,clamp(backUv+vec2(0.0,uTexel.y*1.5),0.001,0.999)).r);
        float bottom=decodeScalar(texture2D(uPrevious,clamp(backUv-vec2(0.0,uTexel.y*1.5),0.001,0.999)).r);
        float spread=(left+right+top+bottom)*0.25;
        wet=mix(wet,spread,0.09);
        wet=max(0.0,wet)*exp(-uDt*1.05);
        gl_FragColor=vec4(encodeScalar(wet),0.0,0.0,1.0);
      }
    `);
  }

  configure(material, { dt = 1 / 60, splat = null, size = this.velocitySize } = {}) {
    material.uniforms.uDt.value = dt;
    material.uniforms.uSplatUv.value.copy(splat?.uv || new this.THREE.Vector2(-2, -2));
    material.uniforms.uForce.value.copy(splat?.force || new this.THREE.Vector2());
    material.uniforms.uRadius.value = splat?.radius || 0.018;
    material.uniforms.uOpacity.value = splat?.opacity || 0;
    material.uniforms.uAspect.value = this.aspect;
    material.uniforms.uTexel.value.set(1 / size, 1 / size);
  }

  setBatchUniforms(material, splats) {
    const paths = material.uniforms.uSplatPath.value;
    const inks = material.uniforms.uSplatInk.value;
    const flows = material.uniforms.uSplatFlow.value;
    const aux = material.uniforms.uSplatAux.value;
    paths.fill(0); inks.fill(0); flows.fill(0); aux.fill(0);
    const count = Math.min(MAX_SPLATS_PER_PASS, splats.length);
    for (let index = 0; index < count; index += 1) {
      const splat = splats[index];
      const start = splat.fromUv || splat.uv;
      const pathOffset = index * 4;
      paths[pathOffset] = start.x; paths[pathOffset + 1] = start.y;
      paths[pathOffset + 2] = splat.uv.x; paths[pathOffset + 3] = splat.uv.y;
      inks[pathOffset] = splat.color.r; inks[pathOffset + 1] = splat.color.g;
      inks[pathOffset + 2] = splat.color.b; inks[pathOffset + 3] = splat.radius;
      flows[pathOffset] = splat.force.x; flows[pathOffset + 1] = splat.force.y;
      flows[pathOffset + 2] = splat.opacity; flows[pathOffset + 3] = splat.water;
      aux[pathOffset] = splat.grain ?? 0.035; aux[pathOffset + 1] = splat.seed ?? 0.5;
      aux[pathOffset + 2] = splat.speed ?? 0; aux[pathOffset + 3] = splat.pressure ?? 0.5;
    }
    material.uniforms.uSplatCount.value = count;
  }

  run(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  setPairInput(material, name, pair, index) { material.uniforms[name].value = pair[index].texture; }

  applySplats(splats, dt) {
    let next = 1 - this.velocityIndex;
    this.configure(this.materials.velocitySplat, { dt, size: this.velocitySize });
    this.setBatchUniforms(this.materials.velocitySplat, splats);
    this.setPairInput(this.materials.velocitySplat, "uPrevious", this.velocityTargets, this.velocityIndex);
    this.run(this.materials.velocitySplat, this.velocityTargets[next]);
    this.velocityIndex = next;

    next = 1 - this.dyeIndex;
    this.configure(this.materials.dyeSplat, { dt, size: this.dyeSize });
    this.setBatchUniforms(this.materials.dyeSplat, splats);
    this.setPairInput(this.materials.dyeSplat, "uPrevious", this.dyeTargets, this.dyeIndex);
    this.run(this.materials.dyeSplat, this.dyeTargets[next]);
    this.dyeIndex = next;

    next = 1 - this.wetnessIndex;
    this.configure(this.materials.wetnessSplat, { dt, size: this.wetnessSize });
    this.setBatchUniforms(this.materials.wetnessSplat, splats);
    this.setPairInput(this.materials.wetnessSplat, "uPrevious", this.wetnessTargets, this.wetnessIndex);
    this.run(this.materials.wetnessSplat, this.wetnessTargets[next]);
    this.wetnessIndex = next;
  }

  setDebugMode(mode) {
    const modes = { composite: 0, velocity: 1, dye: 2, wetness: 3 };
    this.debugMode = modes[mode] === undefined ? "composite" : mode;
    this.displayMaterial.uniforms.uDebugMode.value = modes[this.debugMode];
  }

  setDisplayOpacity(opacity) {
    this.displayMaterial.uniforms.uDisplayOpacity.value = this.THREE.MathUtils.clamp(opacity, 0, 1);
  }

  addSplat({ uv, fromUv = uv, force = { x: 0, y: 0 }, color = "#537c7e", radius = 0.018, opacity = 0.45, water = 0.7, grain = 0.035, seed = Math.random() } = {}) {
    if (!uv || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1 || Math.hypot(uv.x - 0.5, uv.y - 0.5) > 0.5) return;
    const start = fromUv || uv;
    if (start.x < -0.5 || start.x > 1.5 || start.y < -0.5 || start.y > 1.5) return;
    const parsed = new this.THREE.Color(color);
    this.pendingSplats.push({
      uv: new this.THREE.Vector2(uv.x, uv.y),
      fromUv: new this.THREE.Vector2(start.x, start.y),
      force: new this.THREE.Vector2(
        this.THREE.MathUtils.clamp(force.x || 0, -this.velocityRange, this.velocityRange),
        this.THREE.MathUtils.clamp(force.y || 0, -this.velocityRange, this.velocityRange)
      ),
      color: parsed,
      radius: this.THREE.MathUtils.clamp(radius, 0.006, 0.09),
      opacity: this.THREE.MathUtils.clamp(opacity, 0, 0.92),
      // A zero-water splat is the dry, crisp brush. Keep zero intact so it
      // creates pigment without injecting wetness or watercolor diffusion.
      water: this.THREE.MathUtils.clamp(water, 0, 1),
      grain: this.THREE.MathUtils.clamp(grain, 0, 0.24),
      seed: Number.isFinite(seed) ? seed : Math.random()
    });
    this.lastSplatAt = performance.now();
    if (this.pendingSplats.length > 8192) this.pendingSplats.splice(0, this.pendingSplats.length - 8192);
  }

  addSplats(splats = []) { splats.forEach((splat) => this.addSplat(splat)); }

  injectTestSplat() {
    this.addSplat({ uv: { x: 0.68, y: 0.60 }, force: { x: -1.1, y: 0.5 }, color: "#537c7e", radius: 0.066, opacity: 0.82 });
    this.addSplat({ uv: { x: 0.75, y: 0.56 }, force: { x: -0.35, y: -0.1 }, color: "#b96e68", radius: 0.047, opacity: 0.62 });
  }

  isSettled(now = performance.now()) {
    return this.pendingSplats.length === 0 && (!this.lastSplatAt || now - this.lastSplatAt > 1200);
  }

  step(now = performance.now(), force = false) {
    if (!force && this.lastStepAt && now - this.lastStepAt < 1000 / 60) return false;
    const dt = Math.min(1 / 30, this.lastStepAt ? Math.max(1 / 120, (now - this.lastStepAt) / 1000) : 1 / 60);
    this.lastStepAt = now;

    // Apply incoming pointer splats before solving the shared flow field. This
    // makes fresh ink respond immediately while velocity carries it afterward.
    const injectionLimit = this.pendingSplats.length > MAX_SPLATS_PER_PASS
      ? MAX_SPLATS_PER_PASS * 2
      : MAX_SPLATS_PER_PASS;
    const splats = this.pendingSplats.splice(0, injectionLimit);
    if (splats.length) this.lastSplatAt = now;
    for (let index = 0; index < splats.length; index += MAX_SPLATS_PER_PASS) {
      this.applySplats(splats.slice(index, index + MAX_SPLATS_PER_PASS), dt);
    }

    this.configure(this.materials.curl, { dt, size: this.velocitySize });
    this.materials.curl.uniforms.uVelocity.value = this.velocityTexture;
    this.run(this.materials.curl, this.curlTarget);

    let next = 1 - this.velocityIndex;
    this.configure(this.materials.vorticity, { dt, size: this.velocitySize });
    this.materials.vorticity.uniforms.uVelocity.value = this.velocityTexture;
    this.materials.vorticity.uniforms.uCurl.value = this.curlTarget.texture;
    this.run(this.materials.vorticity, this.velocityTargets[next]);
    this.velocityIndex = next;

    this.configure(this.materials.divergence, { dt, size: this.velocitySize });
    this.materials.divergence.uniforms.uVelocity.value = this.velocityTexture;
    this.run(this.materials.divergence, this.divergenceTarget);

    next = 1 - this.pressureIndex;
    this.configure(this.materials.pressureClear, { dt, size: this.velocitySize });
    this.materials.pressureClear.uniforms.uPrevious.value = this.pressureTargets[this.pressureIndex].texture;
    this.run(this.materials.pressureClear, this.pressureTargets[next]);
    this.pressureIndex = next;
    for (let iteration = 0; iteration < this.pressureIterations; iteration += 1) {
      next = 1 - this.pressureIndex;
      this.configure(this.materials.pressure, { dt, size: this.velocitySize });
      this.materials.pressure.uniforms.uPrevious.value = this.pressureTargets[this.pressureIndex].texture;
      this.materials.pressure.uniforms.uDivergence.value = this.divergenceTarget.texture;
      this.run(this.materials.pressure, this.pressureTargets[next]);
      this.pressureIndex = next;
    }

    next = 1 - this.velocityIndex;
    this.configure(this.materials.gradient, { dt, size: this.velocitySize });
    this.materials.gradient.uniforms.uVelocity.value = this.velocityTexture;
    this.materials.gradient.uniforms.uPressure.value = this.pressureTargets[this.pressureIndex].texture;
    this.run(this.materials.gradient, this.velocityTargets[next]);
    this.velocityIndex = next;

    next = 1 - this.velocityIndex;
    this.configure(this.materials.velocityAdvection, { dt, size: this.velocitySize });
    this.materials.velocityAdvection.uniforms.uVelocity.value = this.velocityTexture;
    this.run(this.materials.velocityAdvection, this.velocityTargets[next]);
    this.velocityIndex = next;

    next = 1 - this.dyeIndex;
    this.configure(this.materials.dyeAdvection, { dt, size: this.dyeSize });
    this.materials.dyeAdvection.uniforms.uPrevious.value = this.dyeTexture;
    this.materials.dyeAdvection.uniforms.uVelocity.value = this.velocityTexture;
    this.materials.dyeAdvection.uniforms.uWetness.value = this.wetnessTexture;
    this.run(this.materials.dyeAdvection, this.dyeTargets[next]);
    this.dyeIndex = next;

    next = 1 - this.wetnessIndex;
    this.configure(this.materials.wetnessAdvection, { dt, size: this.wetnessSize });
    this.materials.wetnessAdvection.uniforms.uPrevious.value = this.wetnessTexture;
    this.materials.wetnessAdvection.uniforms.uVelocity.value = this.velocityTexture;
    this.run(this.materials.wetnessAdvection, this.wetnessTargets[next]);
    this.wetnessIndex = next;

    this.displayMaterial.uniforms.uDye.value = this.dyeTexture;
    this.displayMaterial.uniforms.uVelocity.value = this.velocityTexture;
    this.displayMaterial.uniforms.uWetness.value = this.wetnessTexture;
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.version += 1;
    return true;
  }

  renderOverlay() {
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.displayScene, this.displayCamera);
  }

  get dyeTexture() { return this.dyeTargets[this.dyeIndex].texture; }
  get velocityTexture() { return this.velocityTargets[this.velocityIndex].texture; }
  get wetnessTexture() { return this.wetnessTargets[this.wetnessIndex].texture; }

  clearPair(pair, color = 0x000000) { pair.forEach((target) => this.clearTarget(target, color)); }
  clear() {
    this.clearPair(this.velocityTargets, this.neutralFieldColor);
    this.clearPair(this.dyeTargets, 0x000000);
    this.clearPair(this.wetnessTargets, this.neutralFieldColor);
    this.clearPair(this.pressureTargets, this.neutralFieldColor);
    [this.curlTarget, this.divergenceTarget].forEach((target) => this.clearTarget(target, this.neutralFieldColor));
    this.velocityIndex = this.dyeIndex = this.wetnessIndex = this.pressureIndex = 0;
    this.pendingSplats.length = 0;
    this.lastStepAt = 0;
    this.lastSplatAt = this.pendingSplats.length ? performance.now() : 0;
    this.displayMaterial.uniforms.uDye.value = this.dyeTexture;
    this.displayMaterial.uniforms.uVelocity.value = this.velocityTexture;
    this.displayMaterial.uniforms.uWetness.value = this.wetnessTexture;
    this.version += 1;
  }

  // Dry earlier strokes before new input so a later impulse only moves the
  // current wet mark, rather than pulling the complete previous artwork.
  sealMotion() {
    this.clearPair(this.velocityTargets, this.neutralFieldColor);
    this.clearPair(this.pressureTargets, this.neutralFieldColor);
    this.clearTarget(this.curlTarget, this.neutralFieldColor);
    this.clearTarget(this.divergenceTarget, this.neutralFieldColor);
    this.clearPair(this.wetnessTargets, this.neutralFieldColor);
    this.velocityIndex = this.pressureIndex = this.wetnessIndex = 0;
    this.pendingSplats.forEach((splat) => splat.force.set(0, 0));
    this.lastStepAt = 0;
    this.lastSplatAt = 0;
    this.displayMaterial.uniforms.uVelocity.value = this.velocityTexture;
    this.displayMaterial.uniforms.uWetness.value = this.wetnessTexture;
  }

  dispose() {
    [...this.velocityTargets, ...this.dyeTargets, ...this.wetnessTargets, ...this.pressureTargets, this.curlTarget, this.divergenceTarget]
      .forEach((target) => target.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this.displayMaterial.dispose();
    this.quad.geometry.dispose();
    this.displayQuad.geometry.dispose();
  }
}
