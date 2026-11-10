# LOOK — the default 3D look ("luminous")

The spec the three.js backend (`src/r3d/three.ts`) implements as its default look. Owner direction (D14):
"3b1b video style", light on black. Reference implementation, tuned by rendering: the look-development rig (kept outside this repository)
(one file, three.js r187 core + `toCreasedNormals`). Every shader and every number below is copied from it
by the look-development rig (kept outside this repository); if this file and `look.js` disagree, `look.js` is what was rendered.

Pictures: the look-development rig (kept outside this repository) (4 views x 4 states), the look-development rig (kept outside this repository).
Re-render: `cd lookdev && node rig/shoot.mjs --sheet --look final --out final/sheet.png`.

## 0. The look in one paragraph

The scene is drawn in light on pure black. Bodies are dark slate (housings) and mid steel (mechanism), lit
in view space so no side is ever unlit. Form is carried by light, not by shadow: thin antialiased crease
lines with a small halo, a fresnel rim, a derivative-based silhouette line on curved surfaces. Value is the
hierarchy (mechanism lightest with the whitest lines, housings dark, fasteners nearly gone). Colour appears
only where the author gave an accent, as a dark tinted body drawn in its accent's light. Bloom is reserved
for the part in focus and for fluids. Pure white and pure yellow are reserved for label text and focus.

What was taken from the other three looks: the value ladder and per-part stagger (ink, clay), dark hatched
section faces as true caps on the plane with a window for buried parts (ink), the closed-mesh test (clay),
the mask-dilation focus contour and the veiled redraw of an occluded hero (studio), the desaturated receding
tier (clay), the fluid layering (ink), vertical light falloff (clay), the dispose/resize test page (studio).

## 1. Renderer

```js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap at 2
renderer.toneMapping = THREE.NoToneMapping;        // the shaders decide their own values
renderer.outputColorSpace = THREE.SRGBColorSpace;  // default; shaders compute linear and encode at the end
renderer.setClearColor(0x000000, 1);
scene.background = new THREE.Color(0x000000);      // pure black, always. No floor, no fog, no vignette.
renderer.localClippingEnabled = cutawayActive;     // only while a section plane is on
```

- **Antialiasing** is the canvas MSAA. The main image is one forward pass straight to the canvas; there is no
  full-screen post on it. Lines are antialiased analytically in their own shader.
- **Stencil is required** (`stencil: true`). Bits 0-5: section-cap count. Bit 6: focus veil. Bit 7: "the visible
  surface here is an uncut part". Bodies write with mask `0xBF`, so the three uses never collide.
- **No scene lights, no environment map, no shadow map, no textures.** All lighting is in the body shader.
- **Additive amounts are display-space.** X-ray tint and bloom are encoded first and scaled after, so "0.02"
  is 2 percent of white on screen (computing them in linear and encoding turned 0.03 into 0.17: milk).
- **Dither**: interleaved-gradient noise, plus or minus 0.5/255, from `gl_FragCoord` on every body, cap and bloom
  fragment. No time or random input: the same inputs give the same pixels (checked, see section 11).
- Float colour buffers are **not** needed. The only render targets are the bloom mask and two blur targets.

## 2. Light rig

All in the body fragment shader, in view space (directions point from the surface to the light; the camera
looks down -Z), so the lighting is the same from every orbit angle.

| light | value |
|---|---|
| key | point light riding with the camera: direction `(-0.50, 0.62, 0.60)` normalised, at `1.5 x bounds.radius` from the model centre (in view space). `key = smoothstep(-0.30, 1.0, N.L)`, gain `0.95` |
| sky | world-up hemisphere, `((N_world.y * 0.5 + 0.5)^2)`, gain `0.30` (keeps "up" stable while orbiting) |
| ambient | `0.20` |
| vertical falloff | whole diffuse term x `mix(0.80, 1.0, smoothstep(model.minY, model.maxY, world.y))` |
| gloss | one soft box seen in reflection: `smoothstep(0.45, 0.98, R . normalize(L_key + (-0.30, 0.80, 0.52)))`, tinted `mix(albedo, white, 0.55)`, gain = the material's `spec` |
| rim | `rimColour * rimGain * (1 - N.V)^3` |
| silhouette line | `1 - smoothstep(0.55, 1.45, (N.V / fwidth(N.V)) / devicePixelRatio)`, mixed toward the part's line colour at `0.85`. Free, constant width, only on curved surfaces (flat faces have `fwidth(N.V) ~ 0`; crease lines cover those) |
| back faces | lit the same with the normal flipped, x `0.62` (inside of an open shell) |

`diffuse = albedo * (ambient + keyGain * key + skyGain * sky^2) * falloff`. Being near, the key light puts a soft
gradient across large flat faces, which is what stops a box from looking like a flat fill.

```js
// per frame, before rendering: the key light position in view space
keyPos.copy(bounds.center).applyMatrix4(camera.matrixWorldInverse).addScaledVector(keyDir, bounds.radius * 1.5);
```

Body vertex shader:

```glsl
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  vWorld = worldPosition.xyz;
  vView = -mvPosition.xyz;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
```

Body fragment shader (`MODE` 0 lit body, 1 x-ray shell, 2 fluid, 3 flat emissive fill; defines `AMBIENT 0.20`,
`KEY_GAIN 0.95`, `KEY_WRAP -0.30`, `SKY_GAIN 0.30`, `RIM_POWER 3.0`, `BOX_DIR -0.30,0.80,0.52`,
`BOX_EDGE0 0.45`, `BOX_EDGE1 0.98`, `BOX_TINT 0.55`, `INNER 0.62`):

```glsl
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
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorld;
#include <common>
#include <clipping_planes_pars_fragment>
const vec3 L_BOX = normalize(vec3(BOX_DIR));
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  #include <clipping_planes_fragment>
  vec3 V = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vView);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, RIM_POWER);
  // constant-width silhouette line on curved surfaces: distance to the contour in pixels ~ ndv / |grad ndv|
  float sil = 1.0 - smoothstep(0.55, 1.45, ndv / max(fwidth(ndv), 1e-5) * uPx);
  vec3 col;
  float alpha = 1.0;

#if MODE == 0
  if (uCapBack > 0.5 && !gl_FrontFacing) {
    col = uCapFill;
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
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
#elif MODE == 1
  // additive: the amount is a display-space quantity, so encode the colour first and scale afterwards
  vec3 tint = linearToOutputTexel(vec4(uRim, 1.0)).rgb;
  vec3 tintSil = linearToOutputTexel(vec4(uSil, 1.0)).rgb;
  float amount = (uA.x + uA.y * pow(1.0 - ndv, 2.2)) * uLevel;
  gl_FragColor = vec4(tint * amount + tintSil * (sil * uSilGain * uLevel), 1.0);
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.004, amount);
#elif MODE == 2
  // a near-opaque far layer (back faces) under a thin fresnel near layer (front faces); premultiplied, so
  // it tints what is behind it and adds light of its own (uEmit)
  alpha = gl_FrontFacing ? uA.x + uA.y * pow(1.0 - ndv, uA.z) : uA.w;
  alpha = clamp(alpha * uOpacity, 0.0, 1.0);
  float light = alpha + uEmit * uOpacity * (gl_FrontFacing ? 0.30 : 1.0);
  gl_FragColor = vec4(linearToOutputTexel(vec4(uBase * uLevel, 1.0)).rgb * light, alpha);
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
#else
  col = uBase * (uA.x + uA.y * fres) * uLevel;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.004, uA.x + uA.y);
#endif
}
```

```js
// MODE 0 material. clippingPlanes only while a section plane is on.
new THREE.ShaderMaterial({ defines, uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide, clipping: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });   // lines win against their own surface
```

Bodies are `DoubleSide` (careless authors hand over open tubes). `uGrade = (model.minY, model.maxY, 0.80)`.
`uPx = 1 / devicePixelRatio`.

## 3. Colour and materials

### 3.1 Un-styled parts: role decides

The author writes no colours. A part's role gives everything:

| role | albedo | line | rim | rim gain | gloss | line core (CSS px) | line halo |
|---|---|---|---|---|---|---|---|
| housing (shells that enclose things) | `#39414E` | `#8E9BAE` | `#A9BDD6` | 0.50 | 0.10 | 1.05 | 0.10 |
| moving (the mechanism: the subject) | `#8690A0` | `#DDE2EA` | `#EEF2F8` | 0.50 | 0.22 | 1.25 | 0.15 |
| static (ports, plugs, brackets) | `#586271` | `#B4BDCA` | `#CFD8E4` | 0.50 | 0.16 | 1.10 | 0.12 |
| fastener | `#2E333B` | `#737C89` | `#8E99A8` | 0.40 | 0.10 | 0.95 | 0.06 |
| fluid | its colour (default BLUE `#58C4DD`) | same | same | - | 0 | 1.10 | 0.30 |

Automatic assignment rules, in order:

1. **Role** picks the row. If the engine has no role for a part: anything with `shell: true` or material
   `ghost`/`glass` is `housing`; anything driven by a mechanism or a signal is `moving`; bolts, screws, nuts,
   washers are `fastener`; flows and volumes are `fluid`; the rest is `static`.
2. **Stagger**: inside a role, neutral parts cycle albedo factors `[1.0, 0.80, 1.14, 0.90, 1.07, 0.84]` (linear)
   in declaration order, so same-role neighbours separate without colour. Lines and rim are not staggered.
3. **Accent** (`p.color(BLUE)`): the palette colour is light, not paint. Body = `accent * 0.46` (linear) mixed
   `12 %` toward the role albedo; line = rim = the accent unchanged; rim gain `0.75`. No stagger.
   Keep to about three accents on screen.
4. **Scene line brightness is capped at `#DDE2EA`.** Pure white is for label text, `#FFFF00` for focus.
5. A **fluid** is its colour undimmed (accent, else BLUE), never staggered, never lit.

```js
// role + accent (+ named material) -> { kind, base, line, rim, rimGain, spec, core, halo }
const roleCount = {};
function styleOf(part) {                       // part: { role, accent?: '#RRGGBB', material?: name }
  const role = LOOK.role[part.role] || LOOK.role.static;
  const preset = LOOK.preset[part.material];
  const nth = roleCount[part.role] = (roleCount[part.role] ?? -1) + 1;
  const s = { ...role, kind: 'lit', base: new THREE.Color(role.base), line: new THREE.Color(role.line), rim: new THREE.Color(role.rim) };
  if (preset) {
    Object.assign(s, preset, { kind: preset.kind || 'lit' });
    for (const k of ['base', 'line', 'rim']) s[k] = new THREE.Color(preset[k] ?? role[k]);
  }
  if (part.role === 'fluid') {                  // a fluid is its colour, undimmed
    s.base = new THREE.Color(part.accent || LOOK.role.fluid.base); s.line = s.base.clone(); s.rim = s.base.clone();
  } else if (part.accent && s.kind === 'lit') { // accent = light: dark tinted body, lines and rim in the accent
    s.base = new THREE.Color(part.accent).multiplyScalar(LOOK.accent.body).lerp(new THREE.Color(role.base), LOOK.accent.toRole);
    s.line = new THREE.Color(part.accent); s.rim = new THREE.Color(part.accent); s.rimGain = LOOK.accent.rimGain;
  } else if (part.accent) {                     // glow / shell in the accent colour
    s.base = new THREE.Color(part.accent); s.line = s.base.clone(); s.rim = s.base.clone();
  } else if (s.kind === 'lit' && !preset) {
    s.base.multiplyScalar(LOOK.stagger[nth % LOOK.stagger.length]); // THREE.Color is linear: the stagger is linear
  }
  return s;
}
```

### 3.2 Named materials (`p.material(name)`)

A preset replaces the role row. `p.color()` on top of a lit preset still follows rule 3. Presets are not
staggered (the author chose them).

| name | kind | albedo | line | rim | rim gain | gloss | notes |
|---|---|---|---|---|---|---|---|
| `steel` | lit | `#8690A0` | `#DDE2EA` | `#EEF2F8` | 0.50 | 0.26 | the default mechanism, a little glossier |
| `aluminium` | lit | `#A4ABB6` | `#E2E6EC` | `#F2F5F9` | 0.45 | 0.14 | lightest neutral, soft gloss |
| `iron` | lit | `#454C57` | `#9AA5B4` | `#B4C0D0` | 0.45 | 0.06 | dark cast metal, nearly matte |
| `brass` | lit | `#94793F` | `#EBCB84` | `#F4DC9E` | 0.55 | 0.30 | warm; reads next to GOLD, so do not put it beside a gold accent |
| `copper` | lit | `#97583F` | `#EDA583` | `#F6BFA2` | 0.55 | 0.30 | warm red-brown |
| `rubber` | lit | `#1F2227` | `#5C6470` | `#6C7582` | 0.30 | 0.02 | near black, weak rim, exists through its line |
| `plastic` | lit | `#5F6877` | `#C0C8D4` | `#D6DEE9` | 0.50 | 0.12 | the carrier for `p.color()` on non-metal parts |
| `matte` | lit | `#6B7481` | `#C6CDD8` | `#D6DEE9` | 0.35 | 0.00 | no gloss |
| `glass` | shell | - | `#BFD0E6` | `#CFE0F5` | - | - | x-ray shell (section 6.2): face `0.030`, rim `0.30`, lines at `0.70`, halo `0.10` |
| `ghost` | shell | - | `#8E9BAE` | `#A9BDD6` | - | - | the ghost-state shell: face `0.022`, rim `0.20`, lines at `0.55`, halo `0.08` |
| `glow` | glow | its colour (default `#FFFF00`) | same | - | - | - | unlit `colour * (0.80 + 0.35 * fresnel)`, line halo `0.30`, joins the bloom mask at `0.60` |

Line core and halo for lit presets come from the part's role. Mapping from the public object form
`p.material({ color, metalness, roughness, opacity, emissive })`: `color` -> accent rule 3; `roughness` ->
`gloss = 0.30 * (1 - roughness)`; `metalness` is ignored (there is no environment to reflect); `opacity < 1`
-> shell with `face = 0.03 * opacity / 0.3`; `emissive` -> `glow` in that colour. (This mapping is specified,
not rendered: the rig has no object-form materials.)

Rendered check of all presets: the look-development rig (kept outside this repository).

## 4. Lines (the outline technique)

Every drawn line is a shading break of the geometry, drawn as a screen-space fat segment with analytic
coverage. One instanced draw per part. Hidden-line removal is the depth buffer. No extra scene pass, no
G-buffer, no edge-detect post.

### 4.1 Geometry preparation (once per geometry, at build)

1. **One crease angle, 38 degrees**, for shading normals and for lines. Stock indexed geometry is re-creased with
   `toCreasedNormals(geometry, 38 deg)`; lathe/extrude/sweep kinds should emit creased normals directly.
2. **Edges**: weld vertices by position (1e-4), walk triangles, emit an edge when its two faces differ by
   more than 38 degrees, and every boundary edge (one face only). Each segment keeps **both face normals**
   (a boundary edge stores `n` and `-n`). A mesh with no boundary edge is a **closed solid**; that flag decides
   whether it can get a section cap (6.3).
3. **Seam removal**: all segments of a part, in the part's space, are grouped per infinite line and XOR-ed:
   a stretch covered an even number of times is dropped. Where two plates of one part butt edge to edge the
   coincident edges cancel, so a housing assembled from plates reads as one solid. Collinear runs are merged
   into single long segments.
4. **Crowding**: per segment, the distance from its midpoint to the nearest segment that runs beside it
   (roughly parallel, not a chain neighbour), capped at 0.3 units. The shader turns it into pixels.
5. Lines are parented to the part group, so they follow rigid motion and non-uniform scale (springs, a gas
   volume that stretches).

```js
// Crease and boundary edges of a triangle soup, welded by position. `positions` are already in the space the
// lines will live in. Returns segment endpoints, the two face normals per segment, and whether the mesh is a
// closed solid (every edge shared by exactly two faces).
function creaseEdges(positions, index, creaseDeg) {
  const cosT = Math.cos(creaseDeg * Math.PI / 180);
  const count = positions.length / 3;
  const weld = new Map(), vid = new Int32Array(count), P = [];
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = weld.get(key);
    if (id === undefined) { id = P.length / 3; weld.set(key, id); P.push(x, y, z); }
    vid[i] = id;
  }
  const edges = new Map(), segs = [], norms = [];
  const emit = (u, w, n1x, n1y, n1z, n2x, n2y, n2z) => {
    segs.push(P[3 * u], P[3 * u + 1], P[3 * u + 2], P[3 * w], P[3 * w + 1], P[3 * w + 2]);
    norms.push(n1x, n1y, n1z, n2x, n2y, n2z);
  };
  const n = index ? index.length : count;
  const tri = [0, 0, 0];
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) tri[k] = vid[index ? index[t + k] : t + k];
    const [a, b, c] = tri;
    if (a === b || b === c || c === a) continue;
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
    const wx = P[3 * c] - P[3 * a], wy = P[3 * c + 1] - P[3 * a + 1], wz = P[3 * c + 2] - P[3 * a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-14) continue;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      const u = tri[k], w = tri[(k + 1) % 3];
      const key = u < w ? u * 4194304 + w : w * 4194304 + u;
      const e = edges.get(key);
      if (!e) edges.set(key, [u, w, nx, ny, nz]);
      else {
        if (e[2] * nx + e[3] * ny + e[4] * nz <= cosT) emit(e[0], e[1], e[2], e[3], e[4], nx, ny, nz);
        edges.set(key, null);
      }
    }
  }
  let open = 0;
  for (const e of edges.values()) if (e) { emit(e[0], e[1], e[2], e[3], e[4], -e[2], -e[3], -e[4]); open++; } // a boundary edge is always a contour
  return { segs, norms, closed: open === 0 };
}

// Collinear segments covered an even number of times are dropped: where two solids of one part butt
// together their coincident edges cancel, so a housing built from plates reads as one piece. Collinear runs
// are merged into single long segments (fewer instances, no beads).
function xorSegments(segs, norms) {
  const groups = new Map();
  const Q = 2000; // 0.5e-3 units
  for (let i = 0, s = 0; i < segs.length; i += 6, s++) {
    let dx = segs[i + 3] - segs[i], dy = segs[i + 4] - segs[i + 1], dz = segs[i + 5] - segs[i + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    dx /= len; dy /= len; dz /= len;
    const lead = Math.abs(dx) > 1e-4 ? dx : Math.abs(dy) > 1e-4 ? dy : dz;
    if (lead < 0) { dx = -dx; dy = -dy; dz = -dz; }
    const t0 = segs[i] * dx + segs[i + 1] * dy + segs[i + 2] * dz;
    const t1 = segs[i + 3] * dx + segs[i + 4] * dy + segs[i + 5] * dz;
    const ox = segs[i] - dx * t0, oy = segs[i + 1] - dy * t0, oz = segs[i + 2] - dz * t0;
    const key = `${Math.round(dx * 500)},${Math.round(dy * 500)},${Math.round(dz * 500)}|${Math.round(ox * Q)},${Math.round(oy * Q)},${Math.round(oz * Q)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { d: [dx, dy, dz], o: [ox, oy, oz], ev: [] }));
    g.ev.push([Math.min(t0, t1), 1, s], [Math.max(t0, t1), -1, s]);
  }
  const out = [], outN = [];
  for (const g of groups.values()) {
    g.ev.sort((p, q) => p[0] - q[0]);
    const spans = [];
    let count = 0, start = 0, src = 0;
    for (const [t, delta, s] of g.ev) {
      const was = count % 2 === 1;
      count += delta;
      const now = count % 2 === 1;
      if (now && !was) { start = t; src = s; }
      else if (was && !now && t - start > 2e-4) {
        const last = spans[spans.length - 1];
        if (last && start - last[1] < 1e-5) last[1] = t; else spans.push([start, t, src]);
      }
    }
    for (const [s0, s1, s] of spans) {
      out.push(g.o[0] + g.d[0] * s0, g.o[1] + g.d[1] * s0, g.o[2] + g.d[2] * s0, g.o[0] + g.d[0] * s1, g.o[1] + g.d[1] * s1, g.o[2] + g.d[2] * s1);
      if (norms) for (let k = 0; k < 6; k++) outN.push(norms[6 * s + k]);
    }
  }
  return { segs: out, norms: outN };
}

// For every segment: distance from its midpoint to the nearest segment that runs beside it (roughly parallel,
// not a chain neighbour), capped. This is what the line shader turns into pixels to fade crowded lines.
function segmentGaps(segs, cap) {
  const n = segs.length / 6;
  const gaps = new Float32Array(n).fill(cap);
  if (n < 2) return gaps;
  const h = cap, cells = new Map();
  const cellKey = (x, y, z) => (Math.floor(x / h) + 2048) * 16777216 + (Math.floor(y / h) + 2048) * 4096 + (Math.floor(z / h) + 2048);
  const dir = new Float32Array(n * 3), lens = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = 6 * i;
    const dx = segs[o + 3] - segs[o], dy = segs[o + 4] - segs[o + 1], dz = segs[o + 5] - segs[o + 2];
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    lens[i] = len; dir[3 * i] = dx / len; dir[3 * i + 1] = dy / len; dir[3 * i + 2] = dz / len;
    const steps = Math.max(1, Math.ceil(len / (h * 0.5)));
    let lastKey = NaN;
    for (let s = 0; s <= steps; s++) {
      const k = cellKey(segs[o] + dx * s / steps, segs[o + 1] + dy * s / steps, segs[o + 2] + dz * s / steps);
      if (k === lastKey) continue;
      lastKey = k;
      const list = cells.get(k);
      if (list) list.push(i); else cells.set(k, [i]);
    }
  }
  for (let i = 0; i < n; i++) {
    const o = 6 * i;
    const mx = (segs[o] + segs[o + 3]) / 2, my = (segs[o + 1] + segs[o + 4]) / 2, mz = (segs[o + 2] + segs[o + 5]) / 2;
    const dx = dir[3 * i], dy = dir[3 * i + 1], dz = dir[3 * i + 2];
    let best = cap;
    for (let cx = -1; cx <= 1; cx++) for (let cy = -1; cy <= 1; cy++) for (let cz = -1; cz <= 1; cz++) {
      const list = cells.get(cellKey(mx + cx * h, my + cy * h, mz + cz * h));
      if (!list) continue;
      for (const j of list) {
        if (j === i) continue;
        if (Math.abs(dx * dir[3 * j] + dy * dir[3 * j + 1] + dz * dir[3 * j + 2]) < 0.7) continue;
        const p = 6 * j;
        // closest point of segment j to the midpoint of i
        const ex = segs[p + 3] - segs[p], ey = segs[p + 4] - segs[p + 1], ez = segs[p + 5] - segs[p + 2];
        let t = ((mx - segs[p]) * ex + (my - segs[p + 1]) * ey + (mz - segs[p + 2]) * ez) / (lens[j] * lens[j]);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const vx = segs[p] + ex * t - mx, vy = segs[p + 1] + ey * t - my, vz = segs[p + 2] + ez * t - mz;
        const d2 = vx * vx + vy * vy + vz * vz;
        if (d2 >= best * best || d2 < 1e-10) continue;
        const along = vx * dx + vy * dy + vz * dz;
        if (along * along > d2 * 0.5) continue; // ahead or behind on the same chain, not beside
        best = Math.sqrt(d2);
      }
    }
    gaps[i] = best;
  }
  return gaps;
}
```

Instanced geometry (8 template vertices: a body quad and two end-cap quads):

```js
const quad = {
  position: new THREE.Float32BufferAttribute([-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0], 3),
  uv: new THREE.Float32BufferAttribute([-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2], 2),
  index: [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5],
};
function lineGeometry(segs, norms, gaps) {      // 6 floats per segment, 6 per normal pair, 1 gap per segment
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(quad.index);
  g.setAttribute('position', quad.position);
  g.setAttribute('uv', quad.uv);
  const se = new THREE.InstancedInterleavedBuffer(new Float32Array(segs), 6, 1);
  g.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(se, 3, 0));
  g.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(se, 3, 3));
  const nn = new THREE.InstancedInterleavedBuffer(new Float32Array(norms), 6, 1);
  g.setAttribute('instanceN1', new THREE.InterleavedBufferAttribute(nn, 3, 0));
  g.setAttribute('instanceN2', new THREE.InterleavedBufferAttribute(nn, 3, 3));
  g.setAttribute('instanceGap', new THREE.InstancedBufferAttribute(gaps, 1));
  g.instanceCount = segs.length / 6;
  const box = new THREE.Box3(), v = new THREE.Vector3();   // bounds of the segments, not of the template
  for (let i = 0; i < segs.length; i += 3) box.expandByPoint(v.set(segs[i], segs[i + 1], segs[i + 2]));
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.computeBoundingBox = () => {};
  g.computeBoundingSphere = () => {};
  return g;
}

// one line object per part, in the part's own space
function partLines(part /* Group */, meshes, material) {
  const inv = part.matrixWorld.clone().invert(), rel = new THREE.Matrix4(), v = new THREE.Vector3();
  const segs = [], norms = [], closed = new Map();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position, arr = new Float32Array(pos.count * 3);
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(rel).toArray(arr, 3 * i);
    const e = creaseEdges(arr, mesh.geometry.index ? mesh.geometry.index.array : null, LOOK.creaseDeg);
    closed.set(mesh, e.closed);
    const flip = rel.determinant() < 0 ? -1 : 1;
    for (const x of e.segs) segs.push(x);
    for (const x of e.norms) norms.push(flip * x);
  }
  const merged = xorSegments(segs, norms);
  const lines = new THREE.Mesh(lineGeometry(merged.segs, merged.norms, segmentGaps(merged.segs, LOOK.line.gapCap)), material);
  lines.renderOrder = 10;
  part.add(lines);
  return { lines, closed };
}
```

### 4.2 Line shader

Per instance the vertex shader classifies the edge from the camera:

- **silhouette** (one face toward the eye, one away, or a boundary): full weight and width;
- **crease** (both toward): alpha x `0.82`, core width x `0.84`;
- **far side** (both away; only visible on x-ray shells): alpha x `0.34`. This is what tells near wall from far
  wall in the ghost state without a depth prepass.

and fades crowded lines: `alpha *= mix(0.24, 1.0, smoothstep(1.3, 4.2, gapInPixels))`. Ring grooves, gear teeth
and belt edges stop merging into bright bands when the part is small on screen.

Fragment: `alpha = max(core, halo)`. Core = smoothstep edge at `core/2 +- (0.5/dpr + 0.2)` px. Halo =
`halo * exp(-r^2 / (2 * 1.5^2))`, r in CSS px; the quad is `core + 2 * 3.9` px wide when there is a halo. Halo is
butt-ended, and so is the core of any translucent line (round caps of neighbouring segments overlap and show
as a bead at every vertex). Alpha-blended, no depth write, depth test on, drawn after the opaque bodies.
Depth: `clip.z -= 6e-5 * clip.w` (lines win against their own surface); fluid lines use `+7.2e-4` instead so
they lose against a container wall they coincide with.

```glsl
#include <common>
#include <clipping_planes_pars_vertex>
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute vec3 instanceN1;
attribute vec3 instanceN2;
attribute float instanceGap;
uniform vec2 uResolution;  // viewport in CSS px
uniform float uWidth;      // quad width in CSS px (core + halo reach)
uniform float uBias;
uniform vec3 uFade;        // gap px where the fade ends, gap px where it starts, alpha at the crowded end
uniform vec3 uWeights;     // crease alpha, far-side alpha, crease core width
varying vec2 vUv;
varying vec3 vKind;        // x: 1 = silhouette edge, y: alpha weight, z: core width factor
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

  // crowded lines fade: distance to the nearest parallel neighbour, in pixels at this depth
  float gapPx = instanceGap * projectionMatrix[1][1] * uResolution.y * 0.5 / (perspective ? max(1e-4, -mid.z) : 1.0);
  float fade = mix(uFade.z, 1.0, smoothstep(uFade.x, uFade.y, gapPx));
  vKind = vec3(sil, fade * mix(uWeights.x, 1.0, sil) * mix(1.0, uWeights.y, back), mix(uWeights.z, 1.0, sil));

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
  clip.z -= uBias * clip.w;
  gl_Position = clip;
  vUv = uv;
  vec4 mvPosition = position.y < 0.5 ? start : end;
  #include <clipping_planes_vertex>
}
```

```glsl
uniform vec3 uColor;
uniform vec3 uSilColor;
uniform float uOpacity;
uniform float uCore;
uniform float uHalo;
uniform float uSigma;
uniform float uPx;
uniform float uCap;
uniform float uWidth;
varying vec2 vUv;
varying vec3 vKind;
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
  float alpha = max(core * max(body, uCap), halo * body) * uOpacity * vKind.y;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uSilColor, vKind.x), alpha);
  #include <colorspace_fragment>
}
```

```js
function lineMaterial({ color, silColor = color, core, halo = 0, opacity = 1, bias = LOOK.line.bias, back = 1, crease = LOOK.line.crease, fade = true }) {
  const reach = halo > 0 ? LOOK.line.sigma * 2.6 : 1.0;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uSilColor: { value: new THREE.Color(silColor) }, uOpacity: { value: opacity },
      uCore: { value: core }, uHalo: { value: halo }, uSigma: { value: LOOK.line.sigma }, uPx: { value: 1 / pixelRatio },
      uCap: { value: opacity < 1 ? 0 : 1 }, uWidth: { value: core + 2 * reach }, uBias: { value: bias },
      uResolution: { value: new THREE.Vector2(cssWidth, cssHeight) },
      uFade: { value: fade ? new THREE.Vector3(...LOOK.line.fade) : new THREE.Vector3(-2, -1, 1) },
      uWeights: { value: new THREE.Vector3(crease, back, LOOK.line.creaseWidth) },
    },
    vertexShader: centroid(LINE_VERT), fragmentShader: centroid(LINE_FRAG),
    transparent: true, depthWrite: false, clipping: true,   // + clippingPlanes: [plane] on cut parts
  });
}
// solid part:   lineMaterial({ color: style.line, core: style.core, halo: style.halo })
// fluid:        lineMaterial({ color, core: 1.10, halo: 0.30, opacity: 0.9, bias: -12 * LOOK.line.bias })
// x-ray shell:  lineMaterial({ color: style.line, core: style.core, halo: 0.08, opacity: 0.55, back: LOOK.line.back })
```

`uResolution` is the viewport in **CSS pixels** (widths are CSS px); update it and `uPx` on resize.

## 5. View modes

Draw order (three.js `renderOrder`; "opaque list" entries are non-transparent materials, drawn first):

| order | list | what |
|---|---|---|
| -10 | opaque | x-ray shell tint: additive, no depth test, no depth write |
| 0 | opaque | lit bodies (write depth; write stencil in cutaway) |
| 1 | opaque | focus veil (depth GREATER, blended, stencil bit 6) |
| 2 | opaque | the focus part's body |
| 100 + 2k | opaque | section counting passes of capped part k (no colour, no depth) |
| 101 + 2k | opaque | section cap quad of part k |
| 10 | transparent | crease lines of solid and receding parts |
| 11 | transparent | section outlines |
| 12 | transparent | crease lines of the focus part |
| 20, 21 | transparent | fluid bodies, fluid lines |
| 22, 23, 24 | transparent | fluid section: counting, cap, outline |
| 31, 32 | transparent | x-ray shell lines; focused shell lines |
| after the scene | - | bloom mask -> blur -> add; focus contour |

### 5.1 Focus / dim (`st.focus(part)`)

One part in focus, everything else recedes. Nothing is painted yellow: the part is lit, the highlight colour
(accent if it has one, else `#FFFF00`) lives in a crisp contour and a soft halo outside the silhouette.

- **Focus part, neutral**: albedo `#BEC4CD`, gloss `0.30`, rim `mix(highlight, white, 0.7)` at `0.55`, silhouette
  shading line `mix(highlight, white, 0.6)`, crease lines `mix(highlight, white, 0.85)` at core x `1.25`, halo `0.16`.
  **With an accent**: albedo `accent * 0.62`, rim = accent, lines `mix(accent, white, 0.3)`.
- **Contour**: the part alone is drawn flat white into a coverage mask (device resolution, 4x MSAA, one
  channel, no depth). One quad, scissored to the part's screen rectangle, dilates the mask by `1.6` CSS px
  (12 directions x 2 radii) and draws `max - centre` in the highlight colour at `0.95`. It works on any
  geometry, is not occluded (it marks the part through whatever covers it), and puts no yellow inside the part.
- **Halo**: the same mask blurred (two 13-tap gaussians at half CSS resolution, sigma `4.2` texels, values
  stored as sqrt in 8 bits), added in display space at `0.50` with shoulder `c / (1 + 0.5c)`, multiplied by
  `1 - coverage` so it stays outside the part and never tints an occluder in front. Live: strength x
  `1 + 0.10 * sin(2.4 t)`.
- **Occluded part of the hero**: drawn again over what covers it, its own shading at alpha `0.42`,
  `depthFunc: Greater`, no depth write, once per pixel (stencil bit 6), *before* the hero's own body so it
  never veils its own front.
- **Others recede**: housings and fasteners become the dim x-ray shell (face `0.008`, rim `0.07`, lines `0.20`).
  Every other part stays solid and keeps its depth: colours desaturated to `22 %`, value x `0.30`, lines at
  `0.26` without halo, silhouette shading line at `0.25`. Non-focused fluids are hidden.
- **Focusing a housing** keeps it a shell (you must still see inside): face `0.016`, rim `0.24` in
  `mix(highlight, white, 0.5)`, lines at `0.95` core x `1.25`, plus the same contour and halo.
- **Focusing a fluid**: it keeps its fluid material and blooms (5.4); no contour.
- **Label** of the focus part takes the highlight colour.

```js
const hi = new THREE.Color(part.accent || LOOK.focus.color);
const white = new THREE.Color('#ffffff');
const desaturate = (c, keep) => { const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return c.clone().lerp(new THREE.Color(y, y, y), 1 - keep); };

// the focus part: lit, not painted
const hero = bodyMaterial(0, {
  base: part.accent ? hi.clone().multiplyScalar(LOOK.focus.accentBody) : new THREE.Color(LOOK.focus.steel),
  rim: part.accent ? hi : hi.clone().lerp(white, 0.7), sil: hi.clone().lerp(white, part.accent ? 0.2 : 0.6),
  rimGain: LOOK.focus.rimGain, spec: LOOK.focus.spec, silGain: 0.85,
});
const heroLines = lineMaterial({ color: hi.clone().lerp(white, part.accent ? 0.3 : LOOK.focus.line), core: style.core * LOOK.focus.core, halo: LOOK.focus.halo });
for (const mesh of meshes) mesh.renderOrder = 2;   // lines: renderOrder 12

// veil: the hero's own shading over whatever covers it, once per pixel, drawn before the hero itself
const veil = bodyMaterial(0, { ...heroOptions, opacity: LOOK.focus.veil, side: THREE.FrontSide });
Object.assign(veil, {
  depthFunc: THREE.GreaterDepth, depthWrite: false, polygonOffset: false,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  stencilWrite: true, stencilRef: 0x40, stencilFunc: THREE.NotEqualStencilFunc, stencilFuncMask: 0x40, stencilWriteMask: 0x40,
  stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
});
for (const mesh of meshes) { const g = new THREE.Mesh(mesh.geometry, veil); g.renderOrder = 1; mesh.add(g); }

// every other non-housing part recedes but stays solid
const receding = bodyMaterial(0, {
  base: desaturate(style.base, LOOK.recede.saturation), rim: desaturate(style.rim, LOOK.recede.saturation),
  sil: desaturate(style.line, LOOK.recede.saturation), rimGain: style.rimGain, spec: style.spec,
  silGain: LOOK.recede.sil, level: LOOK.recede.level,
});
const recedingLines = lineMaterial({ color: desaturate(style.line, LOOK.recede.saturation), core: style.core, halo: 0, opacity: LOOK.recede.line });

// coverage mask: the hero alone, flat white, on layer 1 -> contour + halo (after the main render)
const cover = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
for (const mesh of meshes) { const g = new THREE.Mesh(mesh.geometry, cover); g.layers.set(1); mesh.add(g); }
const mask = new THREE.WebGLRenderTarget(cssWidth * pixelRatio, cssHeight * pixelRatio, { samples: 4, depthBuffer: false, format: THREE.RedFormat });
const blurA = new THREE.WebGLRenderTarget(cssWidth / 2, cssHeight / 2, { depthBuffer: false });
const blurB = blurA.clone();

function renderFocusOverlay(rect /* hero screen rectangle + 35 px, CSS px, y up */) {
  for (const t of [mask, blurA, blurB]) {           // the same rectangle in each target's pixels
    const k = t.width / cssWidth;
    t.scissorTest = true;
    t.scissor.set(Math.floor(rect.x * k), Math.floor(rect.y * k), Math.ceil(rect.w * k) + 1, Math.ceil(rect.h * k) + 1);
  }
  camera.layers.set(1);
  renderer.setRenderTarget(mask); renderer.render(scene, camera);
  camera.layers.set(0);
  quadMesh.material = blur;                         // BLUR_FRAG, horizontal then vertical
  blur.uniforms.tMap.value = mask.texture; blur.uniforms.uDecode.value = 0; blur.uniforms.uStep.value.set(1 / blurA.width, 0);
  renderer.setRenderTarget(blurA); renderer.render(quadScene, quadCamera);
  blur.uniforms.tMap.value = blurA.texture; blur.uniforms.uDecode.value = 1; blur.uniforms.uStep.value.set(0, 1 / blurA.height);
  renderer.setRenderTarget(blurB); renderer.render(quadScene, quadCamera);
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  renderer.setScissor(rect.x, rect.y, rect.w, rect.h); renderer.setScissorTest(true);
  quadMesh.material = composite;                    // COMPOSITE_FRAG, AdditiveBlending: uTint = (hi, 1), tCover = mask.texture, uStrength = 0.50
  renderer.render(quadScene, quadCamera);
  quadMesh.material = outline;                      // OUTLINE_FRAG, normal blending: uRadius = 1.6 * mask.width / cssWidth, uColor = hi, uOpacity = 0.95
  renderer.render(quadScene, quadCamera);
  renderer.setScissorTest(false);
  renderer.autoClear = true;
}
```

```glsl
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
}
```

### 5.2 Ghost / x-ray housing (`s.ghost(parts)`, materials `ghost` and `glass`)

Housings and fasteners become shells; the mechanism inside stays fully opaque and is never milky.

- **Tint**: additive, `0.022 + 0.20 * (1 - N.V)^2.2` of the rim colour per surface layer, both sides, plus the
  silhouette shading line at `0.38`. Drawn **first, under everything, with no depth test and no depth write**.
  Opaque parts then overwrite it, so no number of walls in front can wash the mechanism out.
- **Lines**: opacity `0.55`, halo `0.08`, drawn last with the depth test on: near edges cross the mechanism,
  edges behind it disappear. Edges on the far side of the shell (both faces away from the eye) drop to
  `x 0.34`. Lines carry the depth order.
- Shells do not write depth and do not occlude anything, including each other.
- Fluids bloom in this state (5.4).

```js
const k = LOOK.shell.ghost;                      // { face: 0.022, rim: 0.20, line: 0.55, halo: 0.08, sil: 0.38 }
const shell = bodyMaterial(1, { rim: style.rim, sil: style.line, a: [k.face, k.rim, 0, 0], silGain: k.sil });
shell.blending = THREE.AdditiveBlending;
shell.depthTest = false;                         // under everything: opaque parts overwrite it
shell.depthWrite = false;
for (const mesh of meshes) mesh.renderOrder = -10;
const shellLines = lineMaterial({ color: style.line, core: style.core, halo: k.halo, opacity: k.line, back: LOOK.line.back });
lines.renderOrder = 31;                          // last, depth-tested: they carry near and far
```

### 5.3 Cutaway with caps (`s.cutaway({ axis, at, parts })`)

A section plane; the kept side is `plane.distanceToPoint(p) > 0`.

- **What is cut**: housings, statics, fasteners and fluids (`material.clippingPlanes = [plane]` on body and
  lines). Moving parts stay whole: the mechanism is the subject. A moving part that lies wholly on the removed
  side is hidden (belt, pulleys). `parts` in the API overrides this default.
- **Section face (cap)**: opaque, flat, **darker than any lit face**: `fill = albedo * 0.50 + 0.006`
  (accent parts use `accent * 0.40` as the albedo), hatch colour = fill mixed `22 %` toward the part's line
  colour. Hatch: 45 degrees, direction alternating per part, period `0.15` world units, line share `0.16`,
  evaluated from the world position on the plane (so it does not swim, and works for orthographic cameras),
  fading out as the period shrinks from `5.5` to `2.4` CSS px. Fluids get a flat section face with no hatch:
  hatching means solid material.
- **Cap mechanics, per cut part**: count in the stencil, then draw a quad on the plane.
  1. Bodies first. A cut part writes stencil `0` where it is visible, an uncut (moving) part writes `0x80`.
  2. For each closed mesh of the part, two passes with no colour, no depth test, no depth write, clipped by
     the plane: back faces `IncrementWrap`, front faces `DecrementWrap`, on the low six bits, and only where
     bit 7 is clear. The count is non-zero exactly where the plane lies inside the solid.
  3. One quad on the plane (sized to the part's bounds), depth-tested and depth-writing, drawn where the count
     is non-zero; it zeroes the count for the next part on pass and on depth-fail.
  - Because the cap is at the plane's true depth, the part's own far edges and anything buried behind the
    section are hidden: the cut reads as sliced metal, not a glass box.
  - **Window**: counting skips pixels whose visible surface is an uncut part (bit 7), so a part kept whole
    inside solid material (a crank buried in a solid box) shows through a clean hole in the hatching instead
    of being covered.
  - **Open meshes** (a boundary edge exists: a zero-thickness tube) are not counted and get no cap; you see
    their lit inner faces at x `0.62`. Under a closed mesh the back faces are painted the flat fill colour as an
    underlay, so a tolerance failure never shows through as lit geometry.
  - Caps of two parts that overlap at the plane share a depth; the later part wins (declaration order).
- **Section outline**: the plane is intersected with every triangle of the part (in the part's space, with
  the same XOR seam removal) and drawn as a fat line: core `1.6` px (fasteners x `0.7`), halo `0.20`, colour
  `mix(line, white, 0.45)`, no crowding fade. It is rebuilt only when the plane moves in the part's own space;
  measured cost for the whole 69k-triangle engine is about 2 ms (section 9), so a sweeping cut is affordable.
- Seen from behind the plane a cutaway looks like the solid state. That is correct; no cue is added.

```js
renderer.localClippingEnabled = true;
const BIT_UNCUT = 0x80, COUNT_BITS = 0x3f;       // bit 6 is the focus veil's

// 1. bodies say what they are, wherever they end up visible
function stencilMark(material, ref) {
  Object.assign(material, { stencilWrite: true, stencilRef: ref, stencilFunc: THREE.AlwaysStencilFunc, stencilWriteMask: 0xbf,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp });
}
stencilMark(cutBody, 0);           cutBody.clippingPlanes = [plane];     // housing, static, fastener
stencilMark(uncutBody, BIT_UNCUT);                                       // moving parts stay whole
// closed cut meshes: back faces show the flat fill (uCapBack = 1, uCapFill) as an underlay; open ones their lit inside

// 2. count: +1 back faces, -1 front faces beyond the plane, only where no uncut part is visible
const counter = (side, op) => new THREE.ShaderMaterial({
  vertexShader: centroid(COUNT_VERT), fragmentShader: centroid(COUNT_FRAG), side, clipping: true, clippingPlanes: [plane],
  colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilRef: 0, stencilFuncMask: BIT_UNCUT, stencilWriteMask: COUNT_BITS,
  stencilFail: THREE.KeepStencilOp, stencilZFail: op, stencilZPass: op,
});
const countBack = counter(THREE.BackSide, THREE.IncrementWrapStencilOp);
const countFront = counter(THREE.FrontSide, THREE.DecrementWrapStencilOp);

// 3. cap: a quad on the plane where the count is non-zero; zero the count either way
function capMaterial(fill, line, angle) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFill: { value: fill }, uLine: { value: line }, uU: { value: planeU }, uV: { value: planeV },
      uHatch: { value: new THREE.Vector4(angle, LOOK.cut.period, LOOK.cut.share, 1 / pixelRatio) },
      uFadePx: { value: new THREE.Vector2(...LOOK.cut.fadePx) }, uFluid: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, side: THREE.DoubleSide,
    stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 0, stencilFuncMask: COUNT_BITS, stencilWriteMask: COUNT_BITS,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ZeroStencilOp, stencilZPass: THREE.ZeroStencilOp,
  });
}

let order = 100;
for (const part of cutParts) {                   // declaration order
  const solids = part.meshes.filter((m) => part.closed.get(m));
  if (!solids.length) continue;
  for (const mesh of solids) for (const mat of [countBack, countFront]) {
    const c = new THREE.Mesh(mesh.geometry, mat); c.renderOrder = order; mesh.add(c);
  }
  const capBase = part.accent ? new THREE.Color(part.accent).multiplyScalar(0.40) : part.style.base.clone();
  const fill = capBase.multiplyScalar(LOOK.cut.fill).addScalar(LOOK.cut.fillAdd);
  const line = fill.clone().lerp(part.style.line, LOOK.cut.hatch);
  const cap = new THREE.Mesh(unitPlane /* PlaneGeometry(1, 1) */, capMaterial(fill, line, (part.index % 2 ? -1 : 1) * Math.PI / 4));
  cap.renderOrder = order + 1; cap.matrixAutoUpdate = false; cap.frustumCulled = false;
  scene.add(cap); part.cap = cap;
  order += 2;
}

// per frame: put each cap quad on the plane, covering its part's bounds
function placeCap(cap, partBox /* world Box3 */) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? partBox.max.x : partBox.min.x, i & 2 ? partBox.max.y : partBox.min.y, i & 4 ? partBox.max.z : partBox.min.z);
    const pu = p.dot(planeU), pv = p.dot(planeV);
    u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
  }
  const pad = 0.02 * bounds.radius;
  centre.copy(plane.normal).multiplyScalar(-plane.constant).addScaledVector(planeU, (u0 + u1) / 2).addScaledVector(planeV, (v0 + v1) / 2);
  cap.matrix.makeBasis(ax.copy(planeU).multiplyScalar(u1 - u0 + 2 * pad), ay.copy(planeV).multiplyScalar(v1 - v0 + 2 * pad), plane.normal).setPosition(centre);
  cap.matrixWorld.copy(cap.matrix);
}
// planeU = normalize(cross(|n.y| > 0.9 ? X : Y, n)), planeV = cross(n, planeU)

// section outline: rebuilt only when the plane moves in the part's own space
function sectionOutline(part, soups /* [{ positions, index }] in part space */) {
  const local = plane.clone().applyMatrix4(part.group.matrixWorld.clone().invert());
  if (part.sectionPlane && part.sectionPlane.equals(local)) return;      // use a tolerance in practice
  part.sectionPlane = local;
  const raw = [];
  for (const s of soups) sectionSegments(s.positions, s.index, [local.normal.x, local.normal.y, local.normal.z, local.constant], raw);
  const { segs } = xorSegments(raw, null);
  const n = segs.length / 6, norms = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) norms.set([0, 0, 1, 0, 0, -1], i * 6);    // n and -n: always full weight
  part.section = new THREE.Mesh(lineGeometry(segs, norms, new Float32Array(n).fill(LOOK.line.gapCap)), lineMaterial({
    color: part.style.line.clone().lerp(new THREE.Color('#ffffff'), LOOK.cut.lineWhite),
    core: LOOK.cut.lineCore, halo: LOOK.cut.lineHalo, fade: false }));   // not clipped: it lies on the plane
  part.section.renderOrder = 11;
  part.group.add(part.section);
}
```

```glsl
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
```

```glsl
#include <common>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(0.0);
}
```

```glsl
varying vec3 vWorld;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
```

```glsl
uniform vec3 uFill;
uniform vec3 uLine;
uniform vec3 uU;
uniform vec3 uV;
uniform vec4 uHatch;      // angle (rad), period (world units), line share (0 = none), 1 / device pixel ratio
uniform vec2 uFadePx;     // hatch fades out as its period shrinks from .y to .x CSS px
uniform vec2 uFluid;      // alpha, emitted light (fluid section face); alpha 1 = opaque solid
varying vec3 vWorld;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
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
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
}
```

```js
// Where a plane crosses a triangle soup: unordered segments (positions and plane in the same space).
function sectionSegments(positions, index, plane /* [nx, ny, nz, constant] */, out = []) {
  const n = index ? index.length : positions.length / 3;
  const dist = (i) => positions[3 * i] * plane[0] + positions[3 * i + 1] * plane[1] + positions[3 * i + 2] * plane[2] + plane[3];
  const cross = (p, q, dp, dq) => {
    const t = dp / (dp - dq);
    out.push(positions[3 * p] + (positions[3 * q] - positions[3 * p]) * t, positions[3 * p + 1] + (positions[3 * q + 1] - positions[3 * p + 1]) * t, positions[3 * p + 2] + (positions[3 * q + 2] - positions[3 * p + 2]) * t);
  };
  for (let t = 0; t < n; t += 3) {
    const a = index ? index[t] : t, b = index ? index[t + 1] : t + 1, c = index ? index[t + 2] : t + 2;
    const da = dist(a), db = dist(b), dc = dist(c);
    const sa = da > 0, sb = db > 0, sc = dc > 0;
    if (sa === sb && sb === sc) continue;
    if (sa !== sb) cross(a, b, da, db);
    if (sb !== sc) cross(b, c, db, dc);
    if (sc !== sa) cross(c, a, dc, da);
  }
  return out;
}
```

### 5.4 Fluid volumes (gas, liquid, charge)

A translucent volume of coloured light. Unlit, no hatch, the only thing besides focus that blooms.

- **Layers** (premultiplied blend `ONE, ONE_MINUS_SRC_ALPHA`, no depth write, `DoubleSide`, back faces
  then front faces): back faces alpha `0.62` (a near-opaque far layer that holds the colour), front faces
  `0.12 + 0.50 * (1 - N.V)^3` (a thin near layer). `rgb = colour * level * (alpha + emit)`, with `emit` x `0.30` on
  front faces. This is what keeps gold gold: a low-alpha tint of orange over dark slate is brown.
- **Energy** is authored per fluid, `0..1` (0 = resting charge, 1 = burning): `level = mix(1.18, 1.55, e)`,
  `emit = mix(0.14, 0.70, e^2)`, bloom fill `= mix(0.55, 2.9, e^1.5)`. The engine passes it per frame
  (`info.energy[id]` in the reference); the rig derives it from the four-stroke phase.
- **Lines**: crease lines in the fluid colour at `0.9`, halo `0.30`, depth-biased to lose against a coincident
  container.
- **Section face** (under a section plane): the cap quad of 5.3, flat fluid colour x level at alpha `0.86`
  plus `emit * 0.5`; when all its meshes are closed the body is drawn `FrontSide` only.
- **Bloom**: whenever something lets you see inside (ghost, cutaway, focus on the fluid, or any `glass`/`ghost`
  material in the scene). The fluid is drawn into a half-resolution 4x MSAA mask (fill `0.5 + 0.4 * fresnel`
  x bloom fill, lines at `0.8`), opaque parts are drawn into the same mask in black so the glow cannot leak
  through a wall in front, then two 13-tap gaussians and an additive composite at `0.60`.
- In focus on another part, fluids are hidden.

```js
const fluid = bodyMaterial(2, { base: colour, a: [...LOOK.fluid.front, LOOK.fluid.back], side: THREE.DoubleSide });
Object.assign(fluid, { transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
for (const mesh of meshes) mesh.renderOrder = 20;   // lines 21
const mix = (a, b, t) => a + (b - a) * t;

function setEnergy(e) {                             // 0..1, authored per fluid, every frame
  fluid.uniforms.uLevel.value = mix(...LOOK.fluid.level, e);
  fluid.uniforms.uEmit.value = mix(...LOOK.fluid.emit, e * e);
  maskFill.uniforms.uLevel.value = mix(...LOOK.fluid.bloomFill, Math.pow(e, 1.5));
  if (cap) {                                        // section face: the cap quad of 5.3, premultiplied, no depth write
    cap.uniforms.uFill.value.copy(colour).multiplyScalar(mix(...LOOK.fluid.level, e));
    cap.uniforms.uFluid.value.set(LOOK.fluid.cap, mix(...LOOK.fluid.emit, e * e) * 0.5);
  }
}

// bloom mask (layer 1, half CSS resolution, 4x MSAA, with depth): the fluid in colour, everything opaque in black
const maskFill = bodyMaterial(3, { base: colour, a: [0.5, 0.4, 0, 0], side: THREE.DoubleSide });
maskFill.polygonOffset = false;
const maskLines = lineMaterial({ color: colour, core: 1.3 * LOOK.glow.downscale, opacity: 0.8, crease: 1 });
maskLines.uniforms.uPx.value = LOOK.glow.downscale;
const occluder = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
// add Mesh(mesh.geometry, maskFill) under each fluid mesh and Mesh(mesh.geometry, occluder) under each opaque mesh,
// all on layer 1; skip occluders whose screen circle misses the fluid's screen rectangle (+35 px).
// Then: mask -> BLUR_FRAG horizontal -> BLUR_FRAG vertical -> COMPOSITE_FRAG (AdditiveBlending, uStrength 0.60, uTint.w = 0),
// every pass scissored to that rectangle.
```

```glsl
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
}
```

```glsl
uniform sampler2D tMap;
uniform float uStrength;
uniform vec4 uTint;       // rgb + 1: the mask is coverage (red channel) and takes this colour; w = 0: the mask is coloured
uniform sampler2D tCover; // coverage mode: the sharp mask, so the halo stays outside the part and never tints what covers it
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 c = texture2D(tMap, vUv).rgb;
  c = c * c * uStrength;                                   // added in display space
  if (uTint.w > 0.5) c = c.r * (1.0 - texture2D(tCover, vUv).r) * linearToOutputTexel(vec4(uTint.rgb, 1.0)).rgb;
  c = c / (1.0 + 0.5 * c);                                 // soft shoulder, the halo never clips
  gl_FragColor = vec4(c + (ign(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.002, max(c.r, max(c.g, c.b))), 1.0);
}
```

### 5.5 Exploded view (`s.explode(amount01)`)

Placement belongs to the engine (which parts move, along which axis, in what order). The look's part:

- Materials, lines, focus, ghost and fluids are unchanged: lines are parented to their part, so they follow.
- The light rig and the vertical falloff keep using the **assembled** bounds (`uGrade`, key distance), so
  parts do not change value as they slide.
- A **guide line** from each part's assembled position to its exploded position: `#444444`, 1 px core, no
  halo, alpha `0.9`, depth-tested, drawn before the crease lines (order 9).
- Section planes stay in world space; a part that slides across the plane rebuilds its outline (5.3).
- Refit the camera to the exploded bounds, and re-run the label layout.

Default offset when the author gives no axis: `offset = (partCentre - modelCentre) * 0.85 * amount`. Concentric
parts (a piston inside a liner inside a block) share a centre and stay nested, so mechanisms should provide an
explicit axis and order.

```js
// default placement + guides. `amount` 0..1; rest centres are taken with amount = 0.
const guideSegs = [], guideNorms = [];
for (const part of parts) {
  const c = part.restCentre;                                         // centre of the part's bounds, assembled
  part.offset = c.clone().sub(bounds.center).multiplyScalar(LOOK.explode.spread * amount);
  part.group.matrixAutoUpdate = false;
  guideSegs.push(c.x, c.y, c.z, c.x + part.offset.x, c.y + part.offset.y, c.z + part.offset.z);
  guideNorms.push(0, 0, 1, 0, 0, -1);
}
const guides = new THREE.Mesh(lineGeometry(guideSegs, guideNorms, new Float32Array(guideSegs.length / 6).fill(LOOK.line.gapCap)),
  lineMaterial({ color: LOOK.explode.guide, core: 1.0, halo: 0, opacity: 0.9, fade: false }));
guides.renderOrder = 9; guides.frustumCulled = false;
scene.add(guides);

function applyExplode() {                                            // every frame, after the mechanism has posed the parts
  for (const part of parts) {
    part.group.updateMatrix();
    part.group.matrix.premultiply(shift.makeTranslation(part.offset.x, part.offset.y, part.offset.z));
    part.group.updateMatrixWorld(true);
  }
}
```

Verified only as a mechanism (`?explode=0.3` in the rig: parts slide, lines follow, guides draw). The rig
does not refit its camera, so there is no judged picture of it.

## 6. Labels (D14: plain typeset text, thin leader, dot)

HTML/SVG over the canvas, so always on top. The look's job is that they stay readable over bright line work.

- **Text**: Computer Modern (`"Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "KaTeX_Main", serif`),
  17 px, weight 400, letter-spacing 0.01em. Colour = the colour of what it names: the part's accent, else
  `#FFFFFF`; the highlight colour for the focus part. No pill, no number badge.
- **Halo**: `-webkit-text-stroke: 3.5px #000; paint-order: stroke fill; text-shadow: 0 0 3px #000, 0 0 6px #000`.
  Needed: crease lines are the same colour family as the text.
- **Leader**: 1 px, accent colour (else `#DDDDDD`) at `0.9`, over a 4 px black casing at `0.78`, round caps. A
  20 px horizontal run out of the text, then one straight stroke to the part.
- **Dot** on the part: radius 2.6 px, leader colour, with a 1.6 px black ring (`paint-order: stroke`).
- Text sits outside the silhouette in two columns (the runtime's layout), 7 px from the leader's end, and
  slides toward the model rather than cross the screen edge.

```js
const L = LOOK.label;
const ink = isFocus ? highlight : accent || L.color;        // text
const stroke = isFocus ? highlight : accent || L.neutral;   // leader + dot
text.style.cssText = `position:absolute;white-space:nowrap;transform:translateY(-52%);color:${ink};`
  + `font:400 ${L.size}px/1 ${L.font};letter-spacing:0.01em;`
  + `-webkit-text-stroke:${L.stroke}px #000;paint-order:stroke fill;text-shadow:0 0 3px #000,0 0 6px #000`;
// SVG, in this order:
// <path fill="none" stroke="#000" stroke-opacity="0.78" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="..."/>
// <path fill="none" stroke="${stroke}" stroke-opacity="0.9" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" d="..."/>
// <circle r="2.6" fill="${stroke}" stroke="#000" stroke-width="1.6" paint-order="stroke" cx="..." cy="..."/>
const run = Math.min(L.run, Math.abs(endX - dotX) * 0.5);    // endX, endY: where the text column meets the leader
const elbowX = side === 'left' ? endX + run : endX - run;
const d = `M${endX} ${endY} L${elbowX} ${endY} L${dotX} ${dotY}`;
// text: right-aligned at endX - 7 on the left side, left-aligned at endX + 7 on the right side
```

## 7. All numbers in one table

```js
const LOOK = {
  creaseDeg: 38, // one threshold for shading normals and for lines: every drawn line is a shading break
  // view-space light rig (directions point from the surface to the light, the camera looks down -Z)
  light: {
    key: [-0.50, 0.62, 0.60], keyGain: 0.95, keyWrap: -0.30, keyDistance: 1.5, // near point light over the left shoulder
    skyGain: 0.30, ambient: 0.20,                                              // world-up hemisphere + flat fill
    box: [-0.30, 0.80, 0.52], boxEdge: [0.45, 0.98], boxTint: 0.55,            // one soft box seen in reflection
    rimPower: 3.0, floor: 0.80,                                                // fresnel rim; light x floor at the model's foot
    inner: 0.62,                                                               // back faces of open shells
  },
  // body albedo / crease line / rim per role
  role: {
    housing: { base: '#39414E', line: '#8E9BAE', rim: '#A9BDD6', rimGain: 0.50, spec: 0.10, core: 1.05, halo: 0.10 },
    moving: { base: '#8690A0', line: '#DDE2EA', rim: '#EEF2F8', rimGain: 0.50, spec: 0.22, core: 1.25, halo: 0.15 },
    static: { base: '#586271', line: '#B4BDCA', rim: '#CFD8E4', rimGain: 0.50, spec: 0.16, core: 1.10, halo: 0.12 },
    fastener: { base: '#2E333B', line: '#737C89', rim: '#8E99A8', rimGain: 0.40, spec: 0.10, core: 0.95, halo: 0.06 },
    fluid: { base: '#58C4DD', line: '#58C4DD', rim: '#58C4DD', rimGain: 0.60, spec: 0.0, core: 1.10, halo: 0.30 },
  },
  stagger: [1.0, 0.80, 1.14, 0.90, 1.07, 0.84], // albedo factor by part order inside a role: neutral neighbours separate
  accent: { body: 0.46, toRole: 0.12, rimGain: 0.75 }, // accent part: dark tinted body drawn in its accent's light
  // named materials (p.material('brass')); kind: lit | shell | glow
  preset: {
    steel: { base: '#8690A0', line: '#DDE2EA', rim: '#EEF2F8', rimGain: 0.50, spec: 0.26 },
    aluminium: { base: '#A4ABB6', line: '#E2E6EC', rim: '#F2F5F9', rimGain: 0.45, spec: 0.14 },
    iron: { base: '#454C57', line: '#9AA5B4', rim: '#B4C0D0', rimGain: 0.45, spec: 0.06 },
    brass: { base: '#94793F', line: '#EBCB84', rim: '#F4DC9E', rimGain: 0.55, spec: 0.30 },
    copper: { base: '#97583F', line: '#EDA583', rim: '#F6BFA2', rimGain: 0.55, spec: 0.30 },
    rubber: { base: '#1F2227', line: '#5C6470', rim: '#6C7582', rimGain: 0.30, spec: 0.02 },
    plastic: { base: '#5F6877', line: '#C0C8D4', rim: '#D6DEE9', rimGain: 0.50, spec: 0.12 },
    matte: { base: '#6B7481', line: '#C6CDD8', rim: '#D6DEE9', rimGain: 0.35, spec: 0.0 },
    glass: { kind: 'shell', line: '#BFD0E6', rim: '#CFE0F5', face: 0.030, rimAmount: 0.30, lineOpacity: 0.70, halo: 0.10 },
    ghost: { kind: 'shell', line: '#8E9BAE', rim: '#A9BDD6', face: 0.022, rimAmount: 0.20, lineOpacity: 0.55, halo: 0.08 },
    glow: { kind: 'glow', base: '#FFFF00', fill: 0.80, fillRim: 0.35, halo: 0.30, bloom: 0.60 },
  },
  line: {
    sigma: 1.5,          // halo gaussian, CSS px
    crease: 0.82, creaseWidth: 0.84, // an interior crease against a silhouette edge: alpha, core width
    back: 0.34,          // edges whose two faces both face away (far side of an x-ray shell)
    fade: [1.3, 4.2, 0.24], // parallel lines closer than 1.3 px drop to 0.24 alpha, full weight from 4.2 px
    gapCap: 0.3,         // world units: neighbours farther than this are not searched
    bias: 6e-5,          // NDC depth pull toward the camera; fluid lines are pushed back instead
  },
  focus: {
    color: '#FFFF00', steel: '#BEC4CD', accentBody: 0.62, spec: 0.30, rimGain: 0.55,
    line: 0.85,         // lines of the focus part: this far from the highlight colour toward white
    core: 1.25, halo: 0.16, bloom: 0.50, pulse: 0.10,
    outline: 1.6, outlineOpacity: 0.95, // crisp contour in the highlight colour, CSS px outside the silhouette
    veil: 0.42,         // the occluded portion of the focus part, redrawn over what covers it
  },
  recede: { level: 0.30, saturation: 0.22, line: 0.26, sil: 0.25, fluid: 0.0 },
  shell: { // x-ray housing; face + rim are display-space amounts added per surface layer
    ghost: { face: 0.022, rim: 0.20, line: 0.55, halo: 0.08, sil: 0.38 },
    dim: { face: 0.008, rim: 0.07, line: 0.20, halo: 0.0, sil: 0.14 },
    focus: { face: 0.016, rim: 0.24, line: 0.95, halo: 0.14, sil: 0.60 },
  },
  fluid: {
    front: [0.12, 0.50, 3.0], // front faces: alpha = a + b * fresnel^c
    back: 0.62,               // back faces: near-opaque far layer
    level: [1.18, 1.55],      // colour gain at energy 0 and 1
    emit: [0.14, 0.70],        // light added on top of the tint at energy 0 and 1
    cap: 0.86,                // alpha of the section face
    line: 0.9, bloom: 0.60, bloomFill: [0.55, 2.9],
  },
  cut: {
    fill: 0.50, fillAdd: 0.006, // section face = albedo * fill + add: darker than any lit face of the part
    hatch: 0.22,                // hatch colour = fill mixed this far toward the part's line colour
    period: 0.15, share: 0.16, fadePx: [2.4, 5.5], // world period, line share, fade-out range of the period in px
    lineCore: 1.6, lineHalo: 0.20, lineWhite: 0.45,
  },
  glow: { sigma: 4.2, downscale: 2 }, // bloom mask = CSS size / downscale, sigma in mask texels
  label: {
    font: '"Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "KaTeX_Main", "Times New Roman", serif',
    size: 17, color: '#FFFFFF', neutral: '#DDDDDD', stroke: 3.5, leader: 1, casing: 4, dot: 2.6, ring: 1.6, run: 20, gap: 7,
  },
  explode: { spread: 0.85, guide: '#444444' },
};
```

## 8. Dispose and resize

`resize(width, height, pixelRatio)`: update `uPx` on body and cap materials, `uResolution` and `uPx` on line
materials, resize the mask (device pixels in focus, CSS/2 otherwise) and the two blur targets (CSS/2).
`dispose()` removes every object the look added, restores swapped geometries, `visible`, `renderOrder`,
`matrixAutoUpdate`, tone mapping, clipping, `autoClear`, scissor, camera layers and the scene background,
disposes materials, geometries and targets, and empties the label overlay. Test page:
the look-development rig (kept outside this repository).

## 9. Performance

Measured with the rig's `--bench` (120 frames, 1280x720 at device pixel ratio 2 = 2560x1440, forced
`gl.finish` after every frame; GPU from `EXT_disjoint_timer_query_webgl2`). Machine: Apple M5 Pro, ANGLE
Metal, headless Chrome, load average 1.7 to 3.7 (other jobs were running). Three runs.

| state (engine: 25 parts, 56 meshes, 69k triangles) | CPU+GPU ms | GPU ms | draw calls | triangles |
|---|---|---|---|---|
| solid | 1.27 / 1.81 / 1.75 | 1.60 / 2.02 / 1.84 | 81 | 167k |
| focus | 1.90 / 2.34 / 1.42 | 2.01 / 2.54 / 2.59 | 89 | 172k |
| ghost | 2.38 / 2.25 / 2.49 | 2.53 / 2.98 / 3.20 | 117 | 218k |
| cutaway | 2.79 / 2.58 / 2.22 | 2.20 / 2.89 / 2.94 | 187 | 224k |
| crude scene, cutaway (14 parts, 1.3k triangles) | 1.39 / 1.99 | 0.98 / 1.05 | 86 | 8k |
| baseline look (plain `MeshStandardMaterial`), solid | 1.19 / 1.70 / 1.75 | 1.05 / 1.00 / 1.02 | 56 | 69k |

- `requestAnimationFrame` cadence: 16.67 ms average / 16.8 ms worst in every state in the first run. In the
  second and third runs (and in the run that produced the header of `sheet.png`) headless Chrome ticked at
  33.3 ms for every look **including the baseline**, with the same 1 to 3 ms frame cost, so that is the
  machine's headless frame clock, not the look. Not re-measured on a quiet machine or in a visible window.
- **Apply-time geometry work** (node, same machine, the look-development rig (kept outside this repository)): engine, 68,920
  triangles -> 16,302 line segments: edges about 30 ms, seam XOR 6 to 10 ms, crowding 26 to 33 ms, creased
  normals and copies under 4 ms; about 70 to 85 ms in total, once. Crude scene: about 2 ms. Do it per geometry
  when the geometry is built or changed, never per frame.
- **Section outline rebuild**: 2.0 to 4.6 ms for all parts of the engine at once (1,700 to 1,900 segments).
- **Cost drivers**: line fill (each segment is a `core + 7.8` px wide quad with blending: the halo is the
  expensive part) and, in cutaway, two counting draws per closed cut mesh.
- **Budget switches for weak GPUs**, in this order: (1) line halo off (`halo: 0` -> quads shrink to `core + 2`
  px); (2) bloom off (fluids keep their emitted light, focus keeps its contour); (3) pixel ratio cap 1.5;
  (4) count with a single `INVERT` pass per mesh instead of increment/decrement (exact only when the meshes
  of a part do not overlap each other).
- Memory: no per-frame allocation. Targets: bloom mask (CSS/2, RGBA8, 4x MSAA + depth; in focus a device-
  resolution R8 4x MSAA mask instead, about 18 MB at 2560x1440) and two CSS/2 RGBA8 blur targets.
- 60 parts: not measured (the rig has 25). Cost is linear in parts for draw calls (bodies + one line draw
  per part) and in segments x pixels for fill.

## 10. Pitfalls (each of these was hit)

- **Additive in linear** turns a 0.03 tint into 0.17 on screen. Encode first, scale after.
- **Shell tint in depth order** washes the mechanism to white behind six to eight wall layers. Draw it first,
  with no depth, and let opaque parts overwrite it.
- **Back faces as the cap** (flat-shading whatever back face is visible) leaves the cap at the depth of the
  far wall: the part's own far edges and buried parts show through. Use the stencil count + plane quad.
- **`gl_FragDepth` to pull back faces to the plane** does not work for hollow parts: the far outer wall's
  back faces pop in front of the cavity. The count is what knows whether the plane is inside material.
- **Counting on open meshes** fills half the screen. Test closedness (no boundary edge after welding) per mesh.
- **Clip residue under MSAA**: the stock `vClipPosition` varying is extrapolated at pixel centres outside
  the triangle and leaves a ghost of the removed half on faces and lines seen edge-on. Declare it `centroid`
  in vertex and fragment shaders of every clipped material:

  ```js
  const centroid = (src) => src
    .replace('#include <clipping_planes_pars_vertex>', THREE.ShaderChunk.clipping_planes_pars_vertex.replace('varying vec3 vClipPosition', 'centroid varying vec3 vClipPosition'))
    .replace('#include <clipping_planes_pars_fragment>', THREE.ShaderChunk.clipping_planes_pars_fragment.replace('varying vec3 vClipPosition', 'centroid varying vec3 vClipPosition'));
  ```
- **Bloom mask depth fights**: a fluid touches its container (a charge in a bore). Push the black occluders
  back (`polygonOffset 2, 4`) and give the fluid's mask fill no offset, or the glow disappears in cutaway.
- **Yellow on the hero's own lines** turns ring grooves into a glowing slab, and bloom over an occluder makes
  the occluder look highlighted. Keep the highlight colour in the contour and in a halo masked by `1 - coverage`.
- **Round caps on translucent lines** bead at every vertex. Butt-end them.
- **`polygonOffset` alone** does not settle line against surface (dotted cap circles, or lines bleeding
  through a coincident wall). Use `polygonOffset(1, 1)` on bodies plus the constant line bias; push fluid
  lines the other way.
- **A crowding fade by projected segment length** is wrong: tessellated circles are made of tiny segments.
  Fade by the distance to the nearest *parallel neighbour*.
- **`renderer.setScissor` is y-up** (lower-left origin), like render-target scissors. Flipping it clipped the
  contour in half.
- **Bounds of instanced line geometry**: set `boundingBox` / `boundingSphere` from the segments yourself, or
  `Box3.setFromObject(part)` (label anchors, camera fit) and frustum culling use the 8-vertex template.
- **Line widths are CSS pixels**; `uResolution` must be the CSS viewport, also while rendering into the
  half-resolution mask (widen mask lines to about 1.3 mask texels and set their `uPx` to the downscale).
- **Lines are baked per part**: a mesh that moves relative to its own part group, or geometry edited in place,
  needs its line geometry rebuilt.
- **Concave creases** are thinner than convex ones (half the fat line is behind the adjoining face). Accepted.
- **The derivative silhouette line** needs smooth normals: on a 24-segment cylinder its width varies slightly,
  and a faceted curve gets crease lines instead.
- **Seam removal** only cancels edge-on-edge coincidences. A plate edge lying on another plate's face still
  draws as a panel line.
- **A buried uncut part** shows whole through its window, including what is behind the plane; where it meets
  the hatch its own outline loses its outer half (the cap is nearer there).

## 11. Verification

Ran, on the reference implementation:

- The 16-cell sheet (`engine` iso/front/low, `crude` iso x solid/focus/ghost/cutaway), plus: cutaway at
  crank 370, 372, 400, 460; ghost at 370 and 400; cutaway from behind (az 200), from the top, crude front;
  crude ghost from az -50; crude top; focus on piston, intake valve, a housing (head), the crude crank; all 25
  labels in ghost; 480x270 at device pixel ratio 1; device pixel ratio 1 and 2; an orthographic camera in all
  four states (the look-development rig (kept outside this repository)); all eleven presets; explode 0.3 and 1.0; a section plane
  together with focus (a moving part, a housing, the crude crank) and together with ghost (`?cut=1`).
- the look-development rig (kept outside this repository), both scenes, four states each: scene graph, renderer state and
  geometries restored after `dispose()`; pixel hash identical for a repeated render, after a resize round
  trip, and after dispose + a fresh `apply()`; zero `console.error`.
- Background is exactly `(0, 0, 0)` outside the model.

Not verified: any GPU other than the M5 Pro; a phone; a 60-part scene; motion judged by eye in the live page
(only stills and the bench loop); the object-form material mapping in 3.2; a section plane that is animated
(only its rebuild cost was timed).
