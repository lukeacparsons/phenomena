import * as THREE from './vendor/three.module.min.js';
import { captureDarkPage } from './capture.js';
import { curtainEdges } from './aperture.js';

// Dark mode is the fabric in BOTH directions. Light mode is the untouched DOM
// beneath it. Geometry depends only on opening progress, so closing is exactly
// the same surface retracing its path, including after a mid-flight reversal.
export class ScreenCurtains {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.className = 'curtain-mesh';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 10000);
    this.uniforms = {
      page: { value: null }, fabric: { value: 0 }, resolution: { value: new THREE.Vector2() },
      cameraDistance: { value: 1 }, edges: { value: Array.from({ length: 49 }, () => new THREE.Vector2()) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      vertexShader: `
        attribute float panel;
        uniform vec2 resolution;
        uniform vec2 edges[49];
        uniform float cameraDistance;
        varying vec2 pageUV;
        varying vec3 clothNormal;
        vec3 clothPoint(float u, float v) {
          u = clamp(u, 0.0, 1.0);
          v = clamp(v, 0.0, 1.0);
          float row = v * 48.0;
          int index = int(min(47.0, floor(row)));
          vec2 edge = mix(edges[index], edges[index + 1], row - float(index));
          float start = panel > 0.5 ? edge.y : min(0.0, edge.x - 1.0);
          float end = panel > 0.5 ? max(resolution.x, edge.y + 1.0) : edge.x;
          float compression = clamp(1.0 - (end - start) / (resolution.x * 0.5), 0.0, 1.0);
          float envelope = sin(3.14159265 * u);
          float drape = sin(3.14159265 * v);
          float amplitude = min(60.0, resolution.x * 0.055) * compression * envelope;
          float z = amplitude * sin(34.55751919 * u + 0.35 * drape) * (0.7 + 0.3 * drape);
          float x = mix(start, end, u) - resolution.x * 0.5;
          float y = resolution.y * (0.5 - v) + compression * 16.0 * envelope * v * drape;
          return vec3(vec2(x, y) * (1.0 - z / cameraDistance), z);
        }
        void main() {
          pageUV = uv;
          float u = position.x + 0.5;
          float v = 0.5 - position.y;
          vec3 point = clothPoint(u, v);
          vec3 du = clothPoint(u + 0.001, v) - clothPoint(u - 0.001, v);
          vec3 dv = clothPoint(u, v + 0.001) - clothPoint(u, v - 0.001);
          clothNormal = normalize(normalMatrix * cross(dv, du));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D page;
        uniform float fabric;
        uniform vec2 resolution;
        varying vec2 pageUV;
        varying vec3 clothNormal;
        void main() {
          vec4 ink = texture2D(page, pageUV);
          vec3 n = normalize(clothNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 light = normalize(vec3(-0.6, 0.65, 1.0));
          float diffuse = 0.48 + 0.64 * max(0.0, dot(n, light));
          float velvet = 0.12 * pow(1.0 - abs(n.z), 2.0);
          float weave = sin(pageUV.x * resolution.x * 2.2) * sin(pageUV.y * resolution.y * 2.2) * 0.012;
          vec3 lit = pow(pow(ink.rgb, vec3(2.2)) * max(0.25, diffuse + velvet + weave), vec3(1.0 / 2.2));
          gl_FragColor = vec4(mix(ink.rgb, lit, fabric), ink.a);
        }`,
    });
    this.panels = [0, 1].map(side => {
      const geometry = new THREE.PlaneGeometry(1, 1, 128, 48);
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        uv.setX(i, (side + uv.getX(i)) / 2);
      }
      geometry.setAttribute('panel', new THREE.Float32BufferAttribute(new Float32Array(uv.count).fill(side), 1));
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return { geometry };
    });
    this.cache = null;
    this.version = 0;
    this.active = false;
    this.pending = null;
    this.lastProgress = -1;
    this.warmed = false;
  }

  key() { return `${document.documentElement.clientWidth}:${innerHeight}:${Math.round(scrollX)}:${Math.round(scrollY)}`; }
  has() { return this.cache?.ready === true && this.cache.key === this.key(); }
  cancelPreparation() { this.controller?.abort(); }
  invalidate() { this.version++; this.cache = null; this.cancelPreparation(); }

  async prepare() {
    if (this.active || this.pending || this.has()) return this.pending;
    const key = this.key(), version = this.version;
    this.controller = new AbortController();
    this.pending = (async () => {
      const canvas = await captureDarkPage(this.controller.signal);
      if (this.key() !== key || this.version !== version || this.active) return;
      const entry = { canvas, key, ready: false };
      this.cache = entry;
      // Compile the material before a press, so reversing never waits on a shader.
      this.begin(true);
      try {
        await this.renderer.compileAsync(this.scene, this.camera);
        if (this.controller.signal.aborted) return;
        // Exercise folded poses before the first press, not just the flat
        // endpoint. Yield between draws so this warm-up remains cancellable.
        for (const progress of this.warmed ? [0] : [.25, .5, .75, 1, 0]) {
          this.draw(progress);
          if (progress !== 0) await new Promise(requestAnimationFrame);
          if (this.controller.signal.aborted) return;
        }
        this.warmed = true;
        entry.ready = true;
      } finally {
        this.end();
      }
    })().finally(() => {
      this.pending = null;
      this.controller = null;
      if (this.cache && !this.cache.ready) this.cache = null;
    });
    return this.pending;
  }

  begin(preparing = false) {
    const entry = this.cache;
    if (!entry || (!entry.ready && !preparing) || entry.key !== this.key()) return null;
    this.active = true;
    this.width = document.documentElement.clientWidth;
    this.height = innerHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== this.width || size.y !== this.height) this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.position.z = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(16)));
    this.camera.updateProjectionMatrix();
    if (this.texture?.image !== entry.canvas) {
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(entry.canvas);
      // The shader performs lighting in linear space and preserves flat pixels.
      this.texture.colorSpace = THREE.NoColorSpace;
      this.texture.generateMipmaps = false;
      this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    }
    this.uniforms.page.value = this.texture;
    this.uniforms.resolution.value.set(this.width, this.height);
    this.uniforms.cameraDistance.value = this.camera.position.z;
    this.lastProgress = -1;
    return this.renderer.domElement;
  }

  draw(progress) {
    if (progress === this.lastProgress) return;
    this.lastProgress = progress;
    this.uniforms.fabric.value = Math.sin(progress * Math.PI / 2);
    // Send only the two silhouette curves. Vertex deformation and smooth
    // surface normals run on the GPU, without rebuilding/uploading the mesh.
    for (let row = 0; row < 49; row++) {
      const edge = curtainEdges(progress, row / 48);
      this.uniforms.edges.value[row].set(edge[0] * this.width, edge[1] * this.width);
    }
    this.renderer.render(this.scene, this.camera);
  }

  end() {
    this.active = false;
    this.renderer.clear();
    this.renderer.domElement.remove();
  }
}
