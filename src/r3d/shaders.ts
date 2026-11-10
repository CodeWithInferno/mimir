// GLSL of the default 3D look (docs/LOOK.md). Strings only: the renderer (./three.ts) builds the materials and feeds
// every number from the LOOK table (./look.ts) through `defines` and uniforms, so nothing here carries a constant
// that shapes the picture except the interleaved-gradient-noise dither, which is a fixed function of the pixel.

/** Ordered dither: a fixed function of the pixel position (no time, no random input). */
export const IGN = /* glsl */ `float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`

export const BODY_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    mat3 im = mat3(instanceMatrix);
    n /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    n = im * n;
  #endif
  vec4 worldPosition = modelMatrix * local;
  vec4 mvPosition = viewMatrix * worldPosition;
  vWorld = worldPosition.xyz;
  vView = -mvPosition.xyz;
  vNormal = normalMatrix * n;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`

/**
 * MODE 0 lit body · 1 x-ray shell (additive) · 2 fluid (premultiplied) · 3 flat emissive fill.
 * Defines: AMBIENT KEY_GAIN KEY_WRAP SKY_GAIN RIM_POWER BOX_DIR BOX_EDGE0 BOX_EDGE1 BOX_TINT INNER SHELL_POWER SIL0 SIL1
 * FRONT_EMIT.
 */
export const BODY_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uRim;
uniform vec3 uSil;
uniform float uRimGain;
uniform float uSpec;
uniform float uSilGain;
uniform float uLevel;
uniform float uOpacity;
uniform vec4 uA;          // shell: face, rim amount. fluid: front a, b, c, back alpha. fill: flat, rim
uniform float uEmit;      // fluid: light added on top of the tint
uniform float uCapBack;   // 1 = back faces show the flat section colour (closed solid under a section plane)
uniform vec3 uCapFill;
uniform float uPx;        // 1 / device pixel ratio
uniform vec3 uKeyPos;     // key light position in view space
uniform vec3 uGrade;      // model foot y, model top y, light factor at the foot
uniform float uDither;    // amplitude of the dither in 8-bit steps
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
#include <common>
#include <clipping_planes_pars_fragment>
const vec3 L_BOX = normalize(vec3(BOX_DIR));
${IGN}
void main() {
  #include <clipping_planes_fragment>
  vec3 V = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vView);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, RIM_POWER);
  // constant-width silhouette line on curved surfaces: distance to the contour in pixels ~ ndv / |grad ndv|
  float sil = 1.0 - smoothstep(SIL0, SIL1, ndv / max(fwidth(ndv), 1e-5) * uPx);
  float dither = (ign(gl_FragCoord.xy) - 0.5) / 255.0 * uDither;
  vec3 col;
  float alpha = 1.0;

#if MODE == 0
  if (uCapBack > 0.5 && !gl_FrontFacing) {
    col = uCapFill * uLevel;
  } else {
    vec3 Nw = normalize((vec4(N, 0.0) * viewMatrix).xyz);
    vec3 Lk = normalize(uKeyPos + vView);                 // a near light: big flat faces get a gradient
    float key = smoothstep(KEY_WRAP, 1.0, dot(N, Lk));
    float sky = Nw.y * 0.5 + 0.5;
    float tone = AMBIENT + KEY_GAIN * key + SKY_GAIN * sky * sky;
    tone *= mix(uGrade.z, 1.0, smoothstep(uGrade.x, uGrade.y, vWorld.y));
    col = uBase * tone;
    vec3 R = reflect(-V, N);
    col += uSpec * smoothstep(BOX_EDGE0, BOX_EDGE1, dot(R, normalize(Lk + L_BOX))) * mix(uBase, vec3(1.0), BOX_TINT);
    col += uRim * (uRimGain * fres);
    col = mix(col, uSil, sil * uSilGain);
    if (!gl_FrontFacing) col *= INNER;
    col *= uLevel;
  }
  alpha = uOpacity;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither;
#elif MODE == 1
  // additive: the amount is a display-space quantity, so encode the colour first and scale afterwards
  vec3 tint = linearToOutputTexel(vec4(uRim, 1.0)).rgb;
  vec3 tintSil = linearToOutputTexel(vec4(uSil, 1.0)).rgb;
  float amount = (uA.x + uA.y * pow(1.0 - ndv, SHELL_POWER)) * uLevel;
  gl_FragColor = vec4(tint * amount + tintSil * (sil * uSilGain * uLevel), 1.0);
  gl_FragColor.rgb += dither * step(0.004, amount);
#elif MODE == 2
  // a near-opaque far layer (back faces) under a thin fresnel near layer (front faces); premultiplied, so it tints
  // what is behind it and adds light of its own (uEmit)
  alpha = gl_FrontFacing ? uA.x + uA.y * pow(1.0 - ndv, uA.z) : uA.w;
  alpha = clamp(alpha * uOpacity, 0.0, 1.0);
  float light = alpha + uEmit * uOpacity * (gl_FrontFacing ? FRONT_EMIT : 1.0);
  gl_FragColor = vec4(linearToOutputTexel(vec4(uBase * uLevel, 1.0)).rgb * light, alpha);
  gl_FragColor.rgb += dither * step(0.004, alpha);
#else
  col = uBase * (uA.x + uA.y * fres) * uLevel;
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither * step(0.004, (uA.x + uA.y) * uLevel);
#endif
}`

/** Screen-space fat segments, one instance per crease edge, classified from the camera (silhouette / crease / far side). */
export const LINE_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute vec3 instanceN1;
attribute vec3 instanceN2;
attribute float instanceGap;
attribute vec2 instanceT;  // where the two ends sit between the bottom (0) and the top (1) of the part: the draw-on order
uniform vec2 uResolution;  // viewport in CSS px
uniform float uWidth;      // quad width in CSS px (core + halo reach)
uniform float uBias;
uniform vec3 uFade;        // gap px where the fade ends, gap px where it starts, alpha at the crowded end
uniform vec3 uWeights;     // crease alpha, far-side alpha, crease core width
varying vec2 vUv;
varying vec3 vKind;        // x: 1 = silhouette edge, y: alpha weight, z: core width factor
varying float vT;
void main() {
  vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
  vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
  vec3 mid = 0.5 * (start.xyz + end.xyz);
  bool perspective = projectionMatrix[2][3] == -1.0;

  // which kind of edge is this, from here?
  vec3 toEye = perspective ? -mid : vec3(0.0, 0.0, 1.0);
  float f1 = dot(normalMatrix * instanceN1, toEye);
  float f2 = dot(normalMatrix * instanceN2, toEye);
  float sil = f1 * f2 <= 0.0 ? 1.0 : 0.0;
  float back = (f1 < 0.0 && f2 < 0.0) ? 1.0 : 0.0;

  // crowded lines fade: distance to the nearest parallel neighbour, in pixels at this depth (the gap is in the
  // mesh's own units: the mean scale of the model-view matrix brings it to view units)
  float unitScale = (length(modelViewMatrix[0].xyz) + length(modelViewMatrix[1].xyz) + length(modelViewMatrix[2].xyz)) / 3.0;
  float gapPx = instanceGap * unitScale * projectionMatrix[1][1] * uResolution.y * 0.5 / (perspective ? max(1e-4, -mid.z) : 1.0);
  float fade = mix(uFade.z, 1.0, smoothstep(uFade.x, uFade.y, gapPx));
  vKind = vec3(sil, fade * mix(uWeights.x, 1.0, sil) * mix(1.0, uWeights.y, back), mix(uWeights.z, 1.0, sil));

  // lines win against their own surface: both ends are pulled toward the eye by a share of their distance, which
  // leaves them where they are on screen (a negative bias pushes them back: fluid lines lose against a wall they touch)
  if (perspective) { start.xyz *= 1.0 - uBias; end.xyz *= 1.0 - uBias; }
  if (perspective) { // keep segments that cross the near plane
    float a = projectionMatrix[2][2], b = projectionMatrix[3][2];
    float nearEstimate = -0.5 * b / a;
    if (start.z < 0.0 && end.z >= 0.0) end.xyz = mix(start.xyz, end.xyz, (nearEstimate - start.z) / (end.z - start.z));
    else if (end.z < 0.0 && start.z >= 0.0) start.xyz = mix(end.xyz, start.xyz, (nearEstimate - end.z) / (start.z - end.z));
  }
  vec4 clipStart = projectionMatrix * start;
  vec4 clipEnd = projectionMatrix * end;
  float aspect = uResolution.x / uResolution.y;
  vec2 dir = clipEnd.xy / clipEnd.w - clipStart.xy / clipStart.w;
  dir.x *= aspect;
  dir = dot(dir, dir) > 1e-16 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 offset = vec2(dir.y, -dir.x);
  dir.x /= aspect;
  offset.x /= aspect;
  if (position.x < 0.0) offset *= -1.0;
  if (position.y < 0.0) offset -= dir; else if (position.y > 1.0) offset += dir;
  offset *= uWidth / uResolution.y;
  vec4 clip = position.y < 0.5 ? clipStart : clipEnd;
  clip.xy += offset * clip.w;
  if (!perspective) clip.z -= uBias * clip.w;
  gl_Position = clip;
  vUv = uv;
  vT = position.y < 0.5 ? instanceT.x : instanceT.y;
  vec4 mvPosition = position.y < 0.5 ? start : end;
  #include <clipping_planes_vertex>
}`

export const LINE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSilColor;
uniform float uOpacity;
uniform float uCore;
uniform float uHalo;
uniform float uSigma;
uniform float uPx;
uniform float uCap;
uniform float uWidth;
uniform vec2 uDraw;        // how far the lines are drawn (0 .. 1 + front), and the width of the soft front
varying vec2 vUv;
varying vec3 vKind;
varying float vT;
#include <common>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float la = vUv.x;
  float lb = abs(vUv.y) > 1.0 ? abs(vUv.y) - 1.0 : 0.0;
  float lr = sqrt(la * la + lb * lb) * uWidth * 0.5;      // CSS px from the centre line
  float aa = 0.5 * uPx + 0.2;
  float halfCore = uCore * vKind.z * 0.5;
  float core = 1.0 - smoothstep(halfCore - aa, halfCore + aa, lr);
  float halo = uHalo * exp(-lr * lr / (2.0 * uSigma * uSigma)) * (1.0 - smoothstep(uWidth * 0.5 - 1.0, uWidth * 0.5, lr));
  // End caps of neighbouring segments overlap, and overlapping alpha shows as a bead at every vertex:
  // the halo is butt-ended, and so is the core of a translucent line (uCap = 0).
  float body = lb == 0.0 ? 1.0 : 0.0;
  float drawn = 1.0 - smoothstep(uDraw.x - uDraw.y, uDraw.x, vT);
  float alpha = max(core * max(body, uCap), halo * body) * uOpacity * vKind.y * drawn;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uSilColor, vKind.x), alpha);
  #include <colorspace_fragment>
}`

/** Section counting passes: no colour, clipped by the plane. */
export const COUNT_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    local = instanceMatrix * local; // every copy of an instanced part is counted where it stands
  #endif
  vec4 mvPosition = modelViewMatrix * local;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`
export const COUNT_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(0.0);
}`

/** The section face: a quad on the plane, flat and hatched from the world position (it does not swim). */
export const CAP_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`
export const CAP_FRAG = /* glsl */ `
uniform vec3 uFill;
uniform vec3 uLine;
uniform vec3 uU;
uniform vec3 uV;
uniform vec4 uHatch;      // angle (rad), period (world units), line share (0 = none), 1 / device pixel ratio
uniform vec2 uFadePx;     // hatch fades out as its period shrinks from .y to .x CSS px
uniform vec2 uFluid;      // alpha, emitted light (fluid section face); alpha 1 = opaque solid
uniform float uDither;
varying vec3 vWorld;
${IGN}
void main() {
  vec2 pc = vec2(dot(vWorld, uU), dot(vWorld, uV));
  float h = (pc.x * cos(uHatch.x) + pc.y * sin(uHatch.x)) / uHatch.y;
  float fw = max(fwidth(h), 1e-6);                        // periods per device pixel
  float d = abs(fract(h) - 0.5);
  float stripe = smoothstep(0.5 - uHatch.z * 0.5 - fw, 0.5 - uHatch.z * 0.5 + fw, d);
  float periodPx = uHatch.w / fw;
  stripe *= step(0.001, uHatch.z) * smoothstep(uFadePx.x, uFadePx.y, periodPx);
  vec3 col = linearToOutputTexel(vec4(mix(uFill, uLine, stripe), 1.0)).rgb;
  gl_FragColor = vec4(col * (uFluid.x + uFluid.y), uFluid.x);
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0 * uDither;
}`

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

/** One direction of a 13-tap gaussian; values are stored as sqrt so 8 bits hold a dim glow. */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uStep;
uniform float uSigma;
uniform float uDecode;
varying vec2 vUv;
vec3 tap(vec2 uv) { vec3 c = texture2D(tMap, uv).rgb; return uDecode > 0.5 ? c * c : c; }
void main() {
  vec3 sum = tap(vUv);
  float wsum = 1.0;
  for (int i = 1; i <= 6; i++) {
    float x = float(i) * 1.5;                              // 1.5 texel spacing, bilinear taps
    float w = exp(-x * x / (2.0 * uSigma * uSigma));
    sum += (tap(vUv + uStep * x) + tap(vUv - uStep * x)) * w;
    wsum += 2.0 * w;
  }
  gl_FragColor = vec4(sqrt(sum / wsum), 1.0);
}`

/** Adds the blurred mask in display space. uTint.w = 1: the mask is coverage and takes the tint, outside the part only. */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uStrength;
uniform vec4 uTint;
uniform sampler2D tCover;
uniform float uDither;
varying vec2 vUv;
${IGN}
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  c = c * c * uStrength;                                   // added in display space
  if (uTint.w > 0.5) c = c.r * (1.0 - texture2D(tCover, vUv).r) * linearToOutputTexel(vec4(uTint.rgb, 1.0)).rgb;
  c = c / (1.0 + 0.5 * c);                                 // soft shoulder, the halo never clips
  gl_FragColor = vec4(c + (ign(gl_FragCoord.xy) - 0.5) / 255.0 * uDither * step(0.002, max(c.r, max(c.g, c.b))), 1.0);
}`

/** A crisp contour outside a coverage mask: the mask dilated by uRadius texels, minus the mask. */
export const OUTLINE_FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uTexel;      // 1 / mask size
uniform float uRadius;    // mask texels
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float centre = texture2D(tMap, vUv).r;
  float grown = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    vec2 d = vec2(cos(a), sin(a)) * uRadius * uTexel;
    grown = max(grown, max(texture2D(tMap, vUv + d).r, texture2D(tMap, vUv + d * 0.5).r));
  }
  gl_FragColor = vec4(linearToOutputTexel(vec4(uColor, 1.0)).rgb, clamp(grown - centre, 0.0, 1.0) * uOpacity);
}`
