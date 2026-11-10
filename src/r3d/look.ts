// The default 3D look ("luminous"): every number that shapes it, and the pure maths that turn a part (role, accent
// colour, named material) into what the renderer draws. Nothing here imports three.js or touches the DOM: the
// renderer (./three.ts) applies the result, and tests read it without a GPU.
//
// Every constant is a named default in LOOK. A scene overrides any of them with s.look({ … }) (a deep partial of this
// table); nothing in the renderer carries a number of its own.

import { closeConfigGroup, defineConfig } from '../core/index.ts'
import { VIEW_DEFAULTS } from './index.ts'

/** Linear RGB, 0..1 each (what the shaders compute in). */
export type RGB = [number, number, number]
import type { Role } from './index.ts'
export type { Role }
export type StyleKind = 'lit' | 'shell' | 'glow' | 'fluid'

export interface RoleLook { base: string; line: string; rim: string; rimGain: number; spec: number; core: number; halo: number }
export interface PresetLook {
  kind?: StyleKind
  base?: string; line?: string; rim?: string; rimGain?: number; spec?: number
  /** shell: display-space tint per surface layer, its fresnel share, the opacity of its lines, their halo */
  face?: number; rimAmount?: number; lineOpacity?: number; halo?: number
  /** glow: flat fill, its fresnel share, how strongly it joins the bloom mask */
  fill?: number; fillRim?: number; bloom?: number
}
export interface ShellLook { face: number; rim: number; line: number; halo: number; sil: number }

export const LOOK = {
  /** one threshold, in degrees, for shading normals and for lines: every drawn line is a shading break */
  creaseDeg: 38,
  renderer: {
    /** device pixel ratio is capped here for a live page (a shot uses the ratio it was asked for) */
    maxPixelRatio: 2,
    /** amplitude of the ordered dither, in 8-bit steps */
    dither: 1,
  },
  /** view-space light rig (directions point from the surface to the light; the camera looks down -Z) */
  light: {
    key: [-0.5, 0.62, 0.6] as [number, number, number], keyGain: 0.95, keyWrap: -0.3, keyDistance: 1.5,
    skyGain: 0.3, ambient: 0.2,
    box: [-0.3, 0.8, 0.52] as [number, number, number], boxEdge: [0.45, 0.98] as [number, number], boxTint: 0.55,
    rimPower: 3.0,
    /** light x this at the model's foot (vertical falloff) */
    floor: 0.8,
    /** back faces of open shells */
    inner: 0.62,
    /** the derivative silhouette line on curved surfaces: its strength, and the distance from the contour (CSS px) over which it fades */
    silhouette: 0.85, silhouetteEdge: [0.55, 1.45] as [number, number],
  },
  /** body albedo / crease line / rim per role; core = line width in CSS px, halo = its glow */
  role: {
    housing: { base: '#39414E', line: '#8E9BAE', rim: '#A9BDD6', rimGain: 0.5, spec: 0.1, core: 1.05, halo: 0.1 },
    moving: { base: '#8690A0', line: '#DDE2EA', rim: '#EEF2F8', rimGain: 0.5, spec: 0.22, core: 1.25, halo: 0.15 },
    static: { base: '#586271', line: '#B4BDCA', rim: '#CFD8E4', rimGain: 0.5, spec: 0.16, core: 1.1, halo: 0.12 },
    fastener: { base: '#2E333B', line: '#737C89', rim: '#8E99A8', rimGain: 0.4, spec: 0.1, core: 0.95, halo: 0.06 },
    fluid: { base: '#58C4DD', line: '#58C4DD', rim: '#58C4DD', rimGain: 0.6, spec: 0.0, core: 1.1, halo: 0.3 },
  } as Record<Role, RoleLook>,
  /** albedo factor by part order inside a role (linear): neutral neighbours separate without colour */
  stagger: [1.0, 0.8, 1.14, 0.9, 1.07, 0.84],
  /** an accent colour is light, not paint: body = accent x body mixed toRole toward the role albedo; lines and rim = the accent */
  accent: { body: 0.46, toRole: 0.12, rimGain: 0.75 },
  /** named materials (p.material('brass')) */
  preset: {
    steel: { base: '#8690A0', line: '#DDE2EA', rim: '#EEF2F8', rimGain: 0.5, spec: 0.26 },
    aluminium: { base: '#A4ABB6', line: '#E2E6EC', rim: '#F2F5F9', rimGain: 0.45, spec: 0.14 },
    iron: { base: '#454C57', line: '#9AA5B4', rim: '#B4C0D0', rimGain: 0.45, spec: 0.06 },
    brass: { base: '#94793F', line: '#EBCB84', rim: '#F4DC9E', rimGain: 0.55, spec: 0.3 },
    copper: { base: '#97583F', line: '#EDA583', rim: '#F6BFA2', rimGain: 0.55, spec: 0.3 },
    rubber: { base: '#1F2227', line: '#5C6470', rim: '#6C7582', rimGain: 0.3, spec: 0.02 },
    plastic: { base: '#5F6877', line: '#C0C8D4', rim: '#D6DEE9', rimGain: 0.5, spec: 0.12 },
    matte: { base: '#6B7481', line: '#C6CDD8', rim: '#D6DEE9', rimGain: 0.35, spec: 0.0 },
    glass: { kind: 'shell', line: '#BFD0E6', rim: '#CFE0F5', face: 0.03, rimAmount: 0.3, lineOpacity: 0.7, halo: 0.1 },
    ghost: { kind: 'shell', line: '#8E9BAE', rim: '#A9BDD6', face: 0.022, rimAmount: 0.2, lineOpacity: 0.55, halo: 0.08 },
    glow: { kind: 'glow', base: '#FFFF00', fill: 0.8, fillRim: 0.35, halo: 0.3, bloom: 0.6 },
  } as Record<string, PresetLook>,
  /** p.material({ … }) in numbers: gloss = glossMax x (1 - roughness); opacity below 1 = a shell whose face is faceAt at opacityAt; emissive at or above emissiveFull = the full glow */
  object: { glossMax: 0.3, faceAt: 0.03, opacityAt: 0.3, emissiveFull: 0.85 },
  line: {
    /** halo gaussian, CSS px */
    sigma: 1.5,
    /** an interior crease against a silhouette edge: alpha, core width */
    crease: 0.82, creaseWidth: 0.84,
    /** edges whose two faces both face away (the far side of an x-ray shell) */
    back: 0.34,
    /** parallel lines closer than [0] px drop to alpha [2]; full weight from [1] px */
    fade: [1.3, 4.2, 0.24] as [number, number, number],
    /** world units: neighbours farther than this are not searched */
    gapCap: 0.3,
    /** lines are drawn this share of their distance nearer to the eye (they win against their own surface); fluid lines are pushed back by fluidBias x this instead */
    bias: 0.0015, fluidBias: -2,
    /** an instanced mesh gets crease lines only while copies x segments stays under this */
    instancedLimit: 60000,
    /** the halo is drawn out to this many sigmas from the line */
    reach: 2.6,
  },
  focus: {
    color: '#FFFF00', steel: '#BEC4CD', accentBody: 0.62, spec: 0.3, rimGain: 0.55,
    /** lines of the part in focus: this far from the highlight colour toward white (neutral part / accent part) */
    line: 0.85, lineAccent: 0.3,
    /** rim and silhouette of the part in focus toward white (neutral), silhouette toward white (accent), rim of a housing in focus toward white */
    rimWhite: 0.7, silWhite: 0.6, silWhiteAccent: 0.2, shellWhite: 0.5,
    core: 1.25, halo: 0.16,
    /** halo outside the silhouette: strength, and how much it breathes with simulation time (pulseRate in rad/s) */
    bloom: 0.5, pulse: 0.1, pulseRate: 2.4,
    /** crisp contour in the highlight colour, CSS px outside the silhouette */
    outline: 1.6, outlineOpacity: 0.95,
    /** the occluded portion of the part in focus, redrawn over what covers it */
    veil: 0.42,
  },
  /** every part that is not in focus while something is */
  recede: { level: 0.3, saturation: 0.22, line: 0.26, sil: 0.25, fluid: 0.0 },
  /** x-ray housings; face and rim are display-space amounts added per surface layer */
  shell: {
    ghost: { face: 0.022, rim: 0.2, line: 0.55, halo: 0.08, sil: 0.38 },
    dim: { face: 0.008, rim: 0.07, line: 0.2, halo: 0.0, sil: 0.14 },
    focus: { face: 0.016, rim: 0.24, line: 0.95, halo: 0.14, sil: 0.6 },
    /** fresnel exponent of the tint */
    power: 2.2,
  } as { ghost: ShellLook; dim: ShellLook; focus: ShellLook; power: number },
  fluid: {
    /** front faces: alpha = [0] + [1] x fresnel^[2] */
    front: [0.12, 0.5, 3.0] as [number, number, number],
    /** back faces: a near-opaque far layer that holds the colour */
    back: 0.62,
    /** colour gain, emitted light and bloom fill at energy 0 and 1 */
    level: [1.18, 1.55] as [number, number], emit: [0.14, 0.7] as [number, number], bloomFill: [0.55, 2.9] as [number, number],
    /** alpha of the section face, opacity of the lines, strength of the bloom */
    cap: 0.86, line: 0.9, bloom: 0.6,
    /** share of the emitted light that the thin near layer and the section face carry */
    frontEmit: 0.3, capEmit: 0.5,
  },
  cut: {
    /** section face = albedo x fill + fillAdd (accent parts: accent x accentFill as the albedo) */
    fill: 0.5, fillAdd: 0.006, accentFill: 0.4,
    /** hatch colour = fill mixed this far toward the part's line colour */
    hatch: 0.22,
    /** hatch period in world units, line share of a period, and the range of the period in CSS px over which it fades out */
    period: 0.15, share: 0.16, fadePx: [2.4, 5.5] as [number, number],
    /** section outline: width, glow, how far toward white (neutral part / accent part); fasteners x fastener */
    lineCore: 1.6, lineHalo: 0.2, lineWhite: 0.45, lineWhiteAccent: 0.35, fastener: 0.7,
    /** opacity of the outline on an x-ray shell, as a share of the shell's weight; its depth pull, x the line bias */
    shellLine: 0.6, lineBias: 2,
    /** the same while the plane is travelling */
    sweepCore: 2.5, sweepHalo: 0.42, sweepWhite: 1.0,
    /** soft, margin: how a part that is kept whole fades once the plane has passed it, and how far outside the model the plane starts (./index.ts) */
    ...VIEW_DEFAULTS.cut,
  },
  /** bloom mask = CSS size / downscale; sigma in mask texels; what emits is drawn into the mask as fill[0] + fill[1] x fresnel */
  glow: { sigma: 4.2, downscale: 2, fill: [0.5, 0.4] as [number, number] },
  explode: {
    /** spread, step, lag: where and when each part goes (./index.ts) */
    ...VIEW_DEFAULTS.explode,
    /** guide lines from where a part rests to where it is */
    guide: '#444444', guideCore: 1.0, guideOpacity: 0.9,
    /** the guides are fully there once the amount reaches this */
    guideIn: 0.25,
  },
  /** how a part enters and leaves: lines first, then the body. Shares of the enter progress. */
  enter: {
    /** create(): the lines are drawn from the bottom anchor to the top over [0, drawEnd]; the body fills over [fillStart, 1] */
    drawEnd: 0.62, fillStart: 0.38,
    /** fadeIn() / fadeOut(): the lines are fully there at linesEnd; the body fills over [fadeFillStart, 1] */
    linesEnd: 0.5, fadeFillStart: 0.18,
    /** width of the soft front of the line draw-on, as a share of the part's height */
    front: 0.12,
  },
  /** what the pointer does (a live page only) */
  hover: { rim: 0.3, level: 0.16, line: 0.35, core: 0.2, halo: 0.1, shell: 0.6, xray: 0.5 },
  /** how finely round shapes are cut into facets: segments around a cylinder, cone and tube, a sphere (around, down), a torus (tube, ring), a rod, and per corner of a swept path */
  detail: { round: 56, sphere: [48, 28] as [number, number], torus: [24, 72] as [number, number], rod: 28, bend: 8 },
  /** orbit and zoom by the user (a live page only) */
  camera: {
    /** degrees per pixel dragged, zoom per wheel unit */
    orbit: 0.4, zoom: 0.0015,
    /** the view reaches a share (1 - 1/e) of the way to where the user put it in this many seconds; 0 = at once */
    damping: 0.09,
    /** elevation stops here, degrees */
    maxElevation: 89,
  },
}
// the look is part of the config store: 'look.line.sigma' in scene({ defaults }), s.config() or mimir.config.json, and docs/CONFIG.md lists it
defineConfig('look', LOOK)
closeConfigGroup('look')
export type Look = typeof LOOK

/** A deep partial of LOOK: what s.look() accepts. */
export type LookOverrides = { [K in keyof Look]?: Look[K] extends readonly unknown[] ? Look[K] : Look[K] extends object ? { [P in keyof Look[K]]?: unknown } : Look[K] }

export interface LookProblem { path: string; what: string; near: string | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
function nearest(name: string, names: string[]): string | null {
  let best: string | null = null, bestD = 3
  for (const n of names) {
    const a = name.toLowerCase(), b = n.toLowerCase()
    if (b.startsWith(a) || a.startsWith(b)) return n
    // small edit distance
    const d: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]!
      d[0] = i
      for (let j = 1; j <= b.length; j++) { const t = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t }
    }
    if (d[b.length]! < bestD) { bestD = d[b.length]!; best = n }
  }
  return best
}

/**
 * LOOK with a scene's overrides merged in. A key that LOOK does not have, or a value of another type, is left out
 * and listed in `problems` (the caller reports them); `role` and `preset` accept new names.
 */
export function resolveLook(overrides: unknown, problems: LookProblem[] = []): Look {
  const merge = (base: unknown, over: unknown, path: string, open: boolean): unknown => {
    if (over === undefined) return base
    if (Array.isArray(base)) {
      if (Array.isArray(over) && over.length === base.length && over.every((x) => typeof x === typeof base[0] && (typeof x !== 'number' || Number.isFinite(x)))) return over.slice()
      // a longer or shorter list is fine where the list is a cycle
      if (path === 'stagger' && Array.isArray(over) && over.length && over.every((x) => typeof x === 'number' && Number.isFinite(x))) return over.slice()
      problems.push({ path, what: `${path} must be a list of ${base.length} ${typeof base[0]}s`, near: null })
      return base
    }
    if (isObj(base)) {
      if (!isObj(over)) { problems.push({ path, what: `${path} must be an object`, near: null }); return base }
      const out: Record<string, unknown> = { ...base }
      for (const [k, v] of Object.entries(over)) {
        if (!(k in base)) {
          if (open && isObj(v)) { out[k] = { ...v }; continue }
          problems.push({ path: path ? `${path}.${k}` : k, what: `the look has no "${path ? `${path}.${k}` : k}"`, near: nearest(k, Object.keys(base)) })
          continue
        }
        out[k] = merge(base[k], v, path ? `${path}.${k}` : k, false)
      }
      return out
    }
    if (typeof over !== typeof base || (typeof over === 'number' && !Number.isFinite(over))) { problems.push({ path, what: `${path} must be a ${typeof base}`, near: null }); return base }
    return over
  }
  if (overrides === undefined || overrides === null) return LOOK
  if (!isObj(overrides)) { problems.push({ path: '', what: 'the look overrides must be an object', near: null }); return LOOK }
  const out: Record<string, unknown> = { ...LOOK }
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in LOOK)) { problems.push({ path: k, what: `the look has no "${k}"`, near: nearest(k, Object.keys(LOOK)) }); continue }
    out[k] = merge((LOOK as Record<string, unknown>)[k], v, k, k === 'role' || k === 'preset')
  }
  return out as Look
}

// ── colour (linear) ──────────────────────────────────────────────────────────────────────────────────
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const cache = new Map<string, RGB | null>()
/** '#rgb' | '#rrggbb' (| alpha, ignored) → linear RGB; null when it is not a hex colour. */
export function hexToLinear(hex: unknown): RGB | null {
  if (typeof hex !== 'string') return null
  const hit = cache.get(hex)
  if (hit !== undefined) return hit
  let out: RGB | null = null
  const m = hex.trim().match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    const x = m[1]!
    const full = x.length <= 4 ? [...x].map((ch) => ch + ch).join('') : x
    if (full.length >= 6) out = [toLinear(parseInt(full.slice(0, 2), 16) / 255), toLinear(parseInt(full.slice(2, 4), 16) / 255), toLinear(parseInt(full.slice(4, 6), 16) / 255)]
    if (out && !out.every(Number.isFinite)) out = null
  }
  cache.set(hex, out)
  return out
}
const lin = (hex: string | undefined, fallback: RGB): RGB => hexToLinear(hex) ?? fallback
export const WHITE: RGB = [1, 1, 1]
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const scaleRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]
/** Keep `keep` of the colour's saturation (0 = grey of the same luminance). */
export function desaturate(c: RGB, keep: number): RGB {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  return [y + (c[0] - y) * keep, y + (c[1] - y) * keep, y + (c[2] - y) * keep]
}

// ── style: role + accent + named material → what a part is drawn with ────────────────────────────────
export interface Style {
  kind: StyleKind
  role: Role
  base: RGB; line: RGB; rim: RGB
  rimGain: number; spec: number
  /** crease line: core width (CSS px) and halo strength */
  core: number; halo: number
  /** the accent colour the author gave, linear; null for a neutral part */
  accent: RGB | null
  /** shell: tint per layer, its fresnel share, line opacity, strength of the silhouette shading line */
  face: number; rimAmount: number; lineOpacity: number; sil: number
  /** glow: flat fill, fresnel share, bloom strength */
  fill: number; fillRim: number; bloom: number
}
/** Numbers of p.material({ … }). */
export interface MaterialNumbers { color?: string | null; metalness?: number; roughness?: number; opacity?: number; emissive?: number }
export interface StyleInput {
  role: Role
  /** p.color(): a hex colour, or null */
  accent?: string | null
  /** p.material(): a preset name or numbers */
  material?: string | MaterialNumbers | null
  /** index of the part among the neutral parts of its role, in declaration order */
  nth?: number
}

/** The style of a part (LOOK.md 3.1 and 3.2). Pure. */
export function styleOf(K: Look, input: StyleInput): Style {
  const role = K.role[input.role] ?? K.role.static
  const named = typeof input.material === 'string' ? K.preset[input.material] : undefined
  const nums = isObj(input.material) ? (input.material as MaterialNumbers) : null
  let accent = hexToLinear(input.accent ?? nums?.color ?? null)
  const fallbackBase = lin(role.base, [0.1, 0.1, 0.1])
  const s: Style = {
    kind: 'lit', role: input.role,
    base: fallbackBase, line: lin(role.line, WHITE), rim: lin(role.rim, WHITE),
    rimGain: role.rimGain, spec: role.spec, core: role.core, halo: role.halo, accent,
    face: K.shell.ghost.face, rimAmount: K.shell.ghost.rim, lineOpacity: K.shell.ghost.line, sil: K.shell.ghost.sil,
    fill: K.preset.glow?.fill ?? 0.8, fillRim: K.preset.glow?.fillRim ?? 0.35, bloom: K.preset.glow?.bloom ?? 0.6,
  }
  let chosen = false // the author picked a material: no stagger
  if (named) {
    chosen = true
    s.kind = named.kind ?? 'lit'
    s.base = lin(named.base, s.base); s.line = lin(named.line, s.line); s.rim = lin(named.rim, s.rim)
    if (named.rimGain !== undefined) s.rimGain = named.rimGain
    if (named.spec !== undefined) s.spec = named.spec
    if (named.kind === 'shell') {
      s.face = named.face ?? s.face; s.rimAmount = named.rimAmount ?? s.rimAmount; s.lineOpacity = named.lineOpacity ?? s.lineOpacity
      if (named.halo !== undefined) s.halo = named.halo
    }
    if (named.kind === 'glow') {
      s.fill = named.fill ?? s.fill; s.fillRim = named.fillRim ?? s.fillRim; s.bloom = named.bloom ?? s.bloom
      if (named.halo !== undefined) s.halo = named.halo
    }
  } else if (nums) {
    chosen = nums.roughness !== undefined || nums.opacity !== undefined || nums.emissive !== undefined
    if (typeof nums.roughness === 'number') s.spec = K.object.glossMax * (1 - Math.min(1, Math.max(0, nums.roughness)))
    if (typeof nums.emissive === 'number' && nums.emissive > 0) {
      const k = Math.min(1, nums.emissive / K.object.emissiveFull)
      s.kind = 'glow'; s.fill *= k; s.fillRim *= k; s.bloom *= k
      s.halo = (K.preset.glow?.halo ?? 0.3) * k
    } else if (typeof nums.opacity === 'number' && nums.opacity < 1) {
      s.kind = 'shell'
      s.face = (K.object.faceAt * Math.max(0, nums.opacity)) / K.object.opacityAt
    }
  }
  if (input.role === 'fluid' && s.kind === 'lit') {
    // a fluid is its colour, undimmed, never staggered, never lit
    s.kind = 'fluid'
    s.base = accent ?? lin(K.role.fluid.base, [0.1, 0.5, 0.7])
    s.line = s.base; s.rim = s.base
    s.accent = accent = s.base
  } else if (accent && s.kind === 'lit') {
    // the palette colour is light, not paint: a dark tinted body drawn in its accent's light
    s.base = mixRGB(scaleRGB(accent, K.accent.body), fallbackBase, K.accent.toRole)
    s.line = accent; s.rim = accent; s.rimGain = K.accent.rimGain
  } else if (accent) {
    // glow / shell in the accent colour
    s.base = accent; s.line = accent; s.rim = accent
  } else if (s.kind === 'glow') {
    s.accent = s.base
    s.line = s.base; s.rim = s.base
  } else if (s.kind === 'lit' && !chosen) {
    const st = K.stagger
    if (st.length) s.base = scaleRGB(s.base, st[(((input.nth ?? 0) % st.length) + st.length) % st.length]!)
  }
  return s
}

// ── the state of one part in one frame ───────────────────────────────────────────────────────────────
export interface PartInput {
  /** 0..1: how far a lit part is turned into an x-ray shell by the ghost view mode */
  ghost: number
  /** 0..1: weight of the focus on this part */
  focus: number
  /** 0..1: how far everything that is not in focus recedes */
  dim: number
  /** 0..1 pointer hover (a live page only) */
  hover: number
  /** fluid energy 0..1 */
  energy: number
  /** 0..1 strength of the edge lines asked for by a look */
  edges: number
  /** opacity of the part without its enter progress */
  alpha: number
  /** enter progress 0..1 and how it enters */
  reveal: number
  mode: string
}
export interface PartDraw {
  kind: StyleKind
  /** the lit body: its colours and gains, and its opacity (0 = not drawn) */
  base: RGB; rim: RGB; sil: RGB
  rimGain: number; spec: number; silGain: number; level: number
  body: number
  /** the x-ray shell: display-space amounts (0 = not drawn) */
  shell: number; face: number; rimAmount: number; shellSil: number; shellRim: RGB; shellLine: RGB
  /** crease lines of the solid body, and the same lines of the x-ray shell (they cross-fade with the ghost amount) */
  line: RGB; lineOpacity: number; core: number; halo: number
  xray: number; xrayHalo: number
  /** opacity of the part's free lines (wires, springs, trails) */
  wire: number
  /** 0..1: how much of the lines is drawn, from the bottom of the part to its top (1 = all) */
  draw: number
  /** weight of the focus highlight (contour, halo, veil) and its colour */
  hero: number; highlight: RGB
  /** fluid: colour gain, emitted light, bloom fill; glow: fill, fresnel share, bloom */
  fluidLevel: number; emit: number; bloom: number; fill: number; fillRim: number
  /** true when the part hides nothing and is not picked (drawn as a shell, or mostly transparent) */
  seeThrough: boolean
}

const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9))); return t * t * (3 - 2 * t) }
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const mixShell = (a: ShellLook, b: ShellLook, t: number): ShellLook => ({ face: lerp(a.face, b.face, t), rim: lerp(a.rim, b.rim, t), line: lerp(a.line, b.line, t), halo: lerp(a.halo, b.halo, t), sil: lerp(a.sil, b.sil, t) })

/**
 * What the renderer draws for one part in one frame: a continuous function of the view modes (ghost, focus, dim),
 * the enter progress and the style. Every state change of LOOK.md section 5 is a blend here, never a switch.
 */
export function partDraw(K: Look, s: Style, i: PartInput): PartDraw {
  const f = Math.min(1, Math.max(0, i.focus))
  const rec = Math.min(1, Math.max(0, i.dim)) * (1 - f)
  const hi = s.accent ?? lin(K.focus.color, [1, 1, 0])
  const hasAccent = s.accent !== null && s.kind !== 'glow'
  const sat = (c: RGB): RGB => (rec > 0 ? mixRGB(c, desaturate(c, K.recede.saturation), rec) : c)
  // how a part enters: lines first, then the body
  const p = Math.min(1, Math.max(0, i.reveal))
  const drawn = i.mode === 'create' || i.mode === 'write'
  const draw = drawn ? Math.min(1, p / K.enter.drawEnd) : 1
  const linesIn = drawn ? 1 : smoothstep(0, K.enter.linesEnd, p)
  const fillIn = p >= 1 ? 1 : smoothstep(drawn ? K.enter.fillStart : K.enter.fadeFillStart, 1, p)
  const alpha = Math.min(1, Math.max(0, i.alpha))

  // housings and fasteners turn into the dim x-ray shell when something else is in focus; a shell material is always one
  const shellable = s.role === 'housing' || s.role === 'fastener'
  const isShell = s.kind === 'shell'
  const g = s.kind === 'lit' ? Math.max(Math.min(1, Math.max(0, i.ghost)), shellable ? rec : 0) : isShell ? 1 : 0
  const own: ShellLook = isShell ? { face: s.face, rim: s.rimAmount, line: s.lineOpacity, halo: s.halo, sil: s.sil } : K.shell.ghost
  const shellLook = mixShell(mixShell(own, K.shell.dim, rec), K.shell.focus, f)

  const heroBase = hasAccent ? scaleRGB(hi, K.focus.accentBody) : lin(K.focus.steel, [0.5, 0.5, 0.5])
  const heroRim = hasAccent ? hi : mixRGB(hi, WHITE, K.focus.rimWhite)
  const heroSil = mixRGB(hi, WHITE, hasAccent ? K.focus.silWhiteAccent : K.focus.silWhite)
  const heroLine = mixRGB(hi, WHITE, hasAccent ? K.focus.lineAccent : K.focus.line)

  const h = Math.min(1, Math.max(0, i.hover))
  const edges = Math.min(1, Math.max(0, i.edges))
  const lineColour = mixRGB(sat(mixRGB(s.line, heroLine, f)), WHITE, K.hover.line * h)
  const solidLine = lerp(1, K.recede.line, rec)
  const solidHalo = lerp(s.halo, K.focus.halo, f) * (1 - rec)
  const out: PartDraw = {
    kind: s.kind,
    base: sat(mixRGB(s.base, heroBase, f)), rim: sat(mixRGB(s.rim, heroRim, f)), sil: sat(mixRGB(s.line, heroSil, f)),
    rimGain: lerp(s.rimGain, K.focus.rimGain, f) + K.hover.rim * h,
    spec: lerp(s.spec, K.focus.spec, f),
    silGain: lerp(K.light.silhouette, K.recede.sil, rec),
    level: lerp(1, K.recede.level, rec) * (1 + K.hover.level * h),
    body: s.kind === 'lit' ? alpha * fillIn * (1 - g) : 0,
    shell: g * alpha * linesIn * (1 + K.hover.shell * h),
    face: shellLook.face, rimAmount: shellLook.rim, shellSil: shellLook.sil,
    shellRim: sat(mixRGB(s.rim, mixRGB(hi, WHITE, K.focus.shellWhite), f)), shellLine: sat(mixRGB(s.line, heroLine, f)),
    line: lineColour,
    lineOpacity: (1 - g) * solidLine * alpha * linesIn * edges,
    core: s.core * (lerp(1, K.focus.core, f) + K.hover.core * h),
    halo: solidHalo + K.hover.halo * h,
    xray: g * shellLook.line * alpha * linesIn * edges * (1 + K.hover.xray * h),
    xrayHalo: shellLook.halo + K.hover.halo * h,
    wire: alpha * linesIn * solidLine,
    draw,
    hero: f, highlight: hi,
    fluidLevel: 1, emit: 0, bloom: 0, fill: s.fill, fillRim: s.fillRim,
    seeThrough: false,
  }
  if (s.kind === 'fluid') {
    const e = Math.min(1, Math.max(0, i.energy))
    // a fluid that is not in focus while something else is, is hidden
    const seen = alpha * fillIn * lerp(1, K.recede.fluid, rec)
    out.body = seen
    out.base = s.base
    out.fluidLevel = lerp(K.fluid.level[0], K.fluid.level[1], e)
    out.emit = lerp(K.fluid.emit[0], K.fluid.emit[1], e * e)
    out.bloom = lerp(K.fluid.bloomFill[0], K.fluid.bloomFill[1], e ** 1.5) * seen
    out.line = s.base
    out.lineOpacity = K.fluid.line * alpha * linesIn * lerp(1, K.recede.fluid, rec) * edges
    out.wire = out.lineOpacity
    out.halo = s.halo
    out.core = s.core
  } else if (s.kind === 'glow') {
    out.body = alpha * fillIn
    out.base = sat(s.base)
    out.level = lerp(1, K.recede.level, rec)
    out.bloom = s.bloom * alpha * fillIn * (1 - rec)
    out.line = sat(s.base)
    out.halo = s.halo * (1 - rec)
  }
  out.seeThrough = s.kind === 'fluid' || (s.kind === 'lit' ? g > 0.5 || out.body < 0.5 : isShell || out.body < 0.5)
  return out
}
