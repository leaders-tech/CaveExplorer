/*
This file holds the GPU shader code: cave walls, props (and the monster), wall writing, water, dust,
and the final pixel filter (low resolution, dithering, film grain, vignette, fear effects).
Edit this file to change lighting or the retro pixel look. Copy LIGHTING_GLSL into a new shader that needs cave light.
*/

export const NUM_LIGHTS = 16; // must equal LIGHTS.length + GLOW_LIGHT_SLOTS in caveLayout.ts

// Shared light: the player's flashlight plus the glowing lights placed in the cave.
export const LIGHTING_GLSL = /* glsl */ `
#define NUM_LIGHTS ${NUM_LIGHTS}
uniform vec3 uCamPos;
uniform vec3 uLightPos;
uniform vec3 uLightDir;
uniform float uLightPower;
uniform float uCosOuter;
uniform float uCosInner;
uniform vec3 uPLPos[NUM_LIGHTS];
uniform vec3 uPLColor[NUM_LIGHTS];
uniform float uFogDensity;
uniform float uTime;

vec3 caveLight(vec3 wp, vec3 n, float wet) {
  vec3 light = vec3(0.0035, 0.004, 0.006);
  vec3 L = uLightPos - wp;
  float d = length(L);
  L /= max(d, 0.0001);
  float cone = smoothstep(uCosOuter, uCosInner, dot(-L, uLightDir));
  float att = 1.0 / (1.0 + 0.10 * d + 0.045 * d * d);
  float diff = max(dot(n, L), 0.0);
  vec3 V = normalize(uCamPos - wp);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 28.0) * wet;
  light += vec3(1.0, 0.92, 0.78) * uLightPower * att * (cone * (diff * 2.2 + spec * 1.6) + 0.06 * diff);
  for (int i = 0; i < NUM_LIGHTS; i++) {
    vec3 Lp = uPLPos[i] - wp;
    float dp = length(Lp);
    Lp /= max(dp, 0.0001);
    float a = 1.0 / (1.0 + 0.25 * dp + 0.09 * dp * dp);
    light += uPLColor[i] * a * (max(dot(n, Lp), 0.0) * 1.6 + 0.03);
  }
  return light;
}

float fogAmount(vec3 wp) {
  float fd = length(uCamPos - wp) * uFogDensity;
  return 1.0 - exp(-fd * fd);
}
`;

export const CAVE_VERTEX = /* glsl */ `
attribute float aFlesh;
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vFlesh;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vFlesh = aFlesh;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const CAVE_FRAGMENT = /* glsl */ `
${LIGHTING_GLSL}
uniform sampler2D uTex;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vColor;
varying float vFlesh;

vec3 triplanar(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return texture2D(uTex, p.yz).rgb * w.x + texture2D(uTex, p.xz).rgb * w.y + texture2D(uTex, p.xy).rgb * w.z;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 t = triplanar(vWorld * 0.33, n);
  vec3 albedo = vColor * (0.35 + 1.2 * t.r);
  vec3 light = caveLight(vWorld, n, t.g * (0.5 + vFlesh));
  float vein = smoothstep(0.5, 0.8, t.b) * vFlesh;
  float pulse = 0.5 + 0.5 * sin(uTime * 2.4 - vWorld.y * 0.8 + vWorld.x * 0.2);
  vec3 col = albedo * light + vec3(0.32, 0.01, 0.015) * vein * pulse;
  col = mix(col, vec3(0.0), fogAmount(vWorld));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const BASIC_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const PROP_FRAGMENT = /* glsl */ `
${LIGHTING_GLSL}
uniform vec3 uColor;
uniform vec3 uEmissive;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 col = uColor * caveLight(vWorld, n, 0.6) + uEmissive;
  col = mix(col, vec3(0.0), fogAmount(vWorld) * (1.0 - min(1.0, length(uEmissive) * 2.0)));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Writing on the walls: the texture says where the paint is, the cave light makes it visible.
export const DECAL_FRAGMENT = /* glsl */ `
${LIGHTING_GLSL}
uniform sampler2D uTex;
uniform vec3 uColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  float paint = texture2D(uTex, vUv).r;
  if (paint < 0.5) discard;
  vec3 col = uColor * caveLight(vWorld, normalize(vNormal), 0.9);
  col = mix(col, vec3(0.0), fogAmount(vWorld));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const WATER_FRAGMENT = /* glsl */ `
${LIGHTING_GLSL}
varying vec3 vWorld;
void main() {
  float t = uTime;
  vec3 n = normalize(vec3(
    sin(vWorld.x * 1.3 + t * 0.9) * 0.07 + sin(vWorld.z * 2.7 - t * 1.4) * 0.04,
    1.0,
    cos(vWorld.z * 1.1 + t * 0.7) * 0.07 + cos(vWorld.x * 2.3 + t) * 0.04));
  vec3 col = vec3(0.02, 0.035, 0.04) * caveLight(vWorld, n, 2.5) * 2.0;
  col = mix(col, vec3(0.0), fogAmount(vWorld));
  gl_FragColor = vec4(col, 0.86);
}
`;

export const DUST_VERTEX = /* glsl */ `
${LIGHTING_GLSL}
uniform float uPixelScale;
varying float vBright;
void main() {
  vec3 p = position;
  p.y -= uTime * 0.05 * (0.5 + fract(position.x * 7.13));
  p.x += sin(uTime * 0.3 + position.z) * 0.2;
  p = mod(p - uCamPos + 7.0, 14.0) - 7.0 + uCamPos;
  vec3 L = uLightPos - p;
  float d = length(L);
  float cone = smoothstep(uCosOuter, uCosInner, dot(-L / max(d, 0.0001), uLightDir));
  vBright = cone * uLightPower / (1.0 + 0.3 * d + 0.08 * d * d) * (1.0 - fogAmount(p));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uPixelScale / -mv.z, 1.0, 2.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const DUST_FRAGMENT = /* glsl */ `
varying float vBright;
void main() {
  gl_FragColor = vec4(vec3(1.0, 0.94, 0.82) * vBright * 0.9, 1.0);
}
`;

export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// The retro filter: chunky pixels, ordered dithering into few colors, grain, vignette, and fear distortion.
export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uFear;
uniform float uFlash;
uniform float uFade;
uniform float uStatic;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 uv = vUv;
  float wobble = uFear * uFear;
  uv.x += sin(uv.y * 38.0 + uTime * 7.0) * 0.0025 * wobble;
  uv.y += sin(uv.x * 23.0 - uTime * 5.0) * 0.0015 * wobble;
  vec2 pix = floor(uv * uRes);
  float tear = step(0.985 - uStatic * 0.2, hash(vec2(floor(pix.y / 3.0), floor(uTime * 20.0))));
  pix.x += tear * (hash(vec2(pix.y, uTime)) - 0.5) * 12.0 * (uStatic + 0.2 * wobble);
  vec2 suv = (pix + 0.5) / uRes;
  float ca = (0.6 + 2.5 * uFear) / uRes.x * length(suv - 0.5) * 2.0;
  vec3 c;
  c.r = texture2D(tScene, suv + vec2(ca, 0.0)).r;
  c.g = texture2D(tScene, suv).g;
  c.b = texture2D(tScene, suv - vec2(ca, 0.0)).b;

  // Linear light -> screen brightness, then a cold, sick colour grade.
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 0.75);
  c *= mix(vec3(0.72, 0.9, 1.0), vec3(1.08, 1.0, 0.86), smoothstep(0.05, 0.6, lum));

  float grain = hash(pix + fract(uTime * 13.0) * 91.0) - 0.5;
  c += grain * (0.03 + 0.07 * uFear + 0.3 * uStatic) * smoothstep(0.0, 0.15, lum + uFear * 0.2 + uStatic);
  // Crush the deepest shadows to true black so the dark feels heavy.
  c = max(c - 0.05, 0.0) * 1.06;

  float aspect = uRes.x / uRes.y;
  float vig = smoothstep(0.95, 0.2, length((suv - 0.5) * vec2(aspect, 1.0)) * (1.0 + 0.4 * uFear));
  c *= mix(1.0, vig, 0.9);
  c = mix(c, vec3(0.55, 0.0, 0.02), uFlash);

  // Ordered dithering into 7 levels per channel = chunky retro colour.
  float levels = 7.0;
  c = floor(c * levels + bayer4(pix)) / levels;
  c *= 0.94 + 0.06 * mod(pix.y, 2.0);
  c *= uFade;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
