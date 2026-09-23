/*
  scripts/background.js
  ------------------------------------------------------------
  Fixierter, nicht scrollender Live-Hintergrund:
  - Wabernde Farbgradienten (Simplex-Noise, wie Perlin-Noise)
  - 35mm-Film-Korn-Overlay
  - Läuft komplett clientseitig via Three.js (CDN), daher
    100% kompatibel mit GitHub Pages (kein Build-Step nötig)

  Einbindung in jede HTML-Seite (vor </body>):

    <script type="importmap">
      { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
    </script>
    <script type="module" src="scripts/background.js"></script>

  Und im <body> ganz oben, vor dem übrigen Content:

    <canvas id="bg-canvas"></canvas>

  Zugehöriges CSS siehe css/background.css
  ------------------------------------------------------------
*/

import * as THREE from "three";

// ---------------------------------------------------------------
// Konfiguration – hier lässt sich der Look zentral anpassen
// ---------------------------------------------------------------
const CONFIG = {
  // Farbpalette der Gradienten (RGB 0..1). Beliebig viele Farben möglich,
  // der Shader interpoliert dynamisch zwischen ihnen.
  colors: [
    [0.05, 0.02, 0.15], // dunkles Violett
    [0.02, 0.10, 0.25], // Tiefblau
    [0.55, 0.10, 0.35], // Magenta/Rot
    [0.05, 0.25, 0.30], // Petrol
  ],
  noiseScale: 1.4,     // Größe der Noise-„Wolken“ (kleiner = größere Flächen)
  speed: 0.06,         // Wabergeschwindigkeit
  grainAmount: 0.09,   // Stärke des Filmkorns (0 = aus, 0.15 = kräftig)
  grainSize: 1.6,      // Korngröße (größer = feineres Korn)
  vignette: 0.35,       // leichte Vignette wie bei echtem Film (0 = aus)
};

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------
const canvas = document.getElementById("bg-canvas");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uColor0: { value: new THREE.Vector3(...CONFIG.colors[0]) },
  uColor1: { value: new THREE.Vector3(...CONFIG.colors[1]) },
  uColor2: { value: new THREE.Vector3(...CONFIG.colors[2]) },
  uColor3: { value: new THREE.Vector3(...CONFIG.colors[3]) },
  uNoiseScale: { value: CONFIG.noiseScale },
  uSpeed: { value: CONFIG.speed },
  uGrainAmount: { value: CONFIG.grainAmount },
  uGrainSize: { value: CONFIG.grainSize },
  uVignette: { value: CONFIG.vignette },
};

// ---------------------------------------------------------------
// Vertex Shader – simples Fullscreen-Quad, keine 3D-Transformation nötig
// ---------------------------------------------------------------
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------
// Fragment Shader
//  - Simplex-Noise (Ashima/McEwan, Public-Domain-Implementierung)
//  - Mehrere Noise-Layer (fbm) für organisches Wabern
//  - Farbmischung über die konfigurierten Farben
//  - Film-Korn per Zeit-variierendem Zufallsrauschen
// ---------------------------------------------------------------
const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uColor0;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uNoiseScale;
  uniform float uSpeed;
  uniform float uGrainAmount;
  uniform float uGrainSize;
  uniform float uVignette;

  // ---- Simplex Noise 3D (Ashima Arts / Ian McEwan, MIT-like public use) ----
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // Fractal Brownian Motion: mehrere Noise-Ebenen übereinandergelegt
  // -> weichere, organischere "Wolken" statt hartem Einzel-Noise
  float fbm(vec3 p){
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return value;
  }

  // simples Pseudo-Random für das Filmkorn
  float rand(vec2 co, float seed){
    return fract(sin(dot(co, vec2(12.9898, 78.233)) + seed) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec2 aspectUv = uv;
    aspectUv.x *= uResolution.x / uResolution.y;

    float t = uTime * uSpeed;

    // Zwei unabhängige Noise-Felder, zeitlich leicht versetzt,
    // ergeben zusammen die Mischbasis für die Farbverläufe.
    float n1 = fbm(vec3(aspectUv * uNoiseScale, t));
    float n2 = fbm(vec3(aspectUv * uNoiseScale + 4.2, t * 0.8 + 3.1));

    float mixA = smoothstep(-0.6, 0.6, n1);
    float mixB = smoothstep(-0.6, 0.6, n2);

    vec3 colorA = mix(uColor0, uColor1, mixA);
    vec3 colorB = mix(uColor2, uColor3, mixB);
    vec3 color = mix(colorA, colorB, smoothstep(0.2, 0.8, n2 * 0.5 + 0.5));

    // dezente Vignette wie bei analogem Filmmaterial
    float dist = distance(uv, vec2(0.5));
    float vig = 1.0 - uVignette * smoothstep(0.3, 0.9, dist);
    color *= vig;

    // ---- 35mm Film-Korn ----
    // zeitlich animiertes Zufallsrauschen, unabhängig von der Bildauflösung
    // skaliert, damit es wie echtes Korn und nicht wie Pixel-Rauschen wirkt
    vec2 grainUv = gl_FragCoord.xy / uGrainSize;
    float grain = rand(grainUv, fract(uTime * 24.0)) - 0.5;
    color += grain * uGrainAmount;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

const geometry = new THREE.PlaneGeometry(2, 2);
const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  depthWrite: false,
  depthTest: false,
});
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// ---------------------------------------------------------------
// Render-Loop
// ---------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  uniforms.uTime.value = clock.getElapsedTime();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ---------------------------------------------------------------
// Resize-Handling
// ---------------------------------------------------------------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener("resize", onResize);

// Performance: Rendering pausieren, wenn Tab nicht sichtbar ist
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clock.stop();
  } else {
    clock.start();
  }
});
