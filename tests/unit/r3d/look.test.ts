// The look table and the pure maths that turn a part into what is drawn (src/r3d/look.ts). No GPU.
import { describe, expect, test } from 'bun:test'
import { desaturate, hexToLinear, LOOK, partDraw, resolveLook, styleOf, type LookProblem, type PartInput } from '../../../src/r3d/look.ts'

const rest: PartInput = { ghost: 0, focus: 0, dim: 0, hover: 0, energy: 0, edges: 1, alpha: 1, reveal: 1, mode: 'fade' }
const near = (a: readonly number[], b: readonly number[], eps = 1e-6): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= eps)

describe('look table', () => {
  test('the numbers of docs/LOOK.md section 7 are the defaults', () => {
    expect(LOOK.creaseDeg).toBe(38)
    expect(LOOK.light.key).toEqual([-0.5, 0.62, 0.6])
    expect(LOOK.role.housing.base).toBe('#39414E')
    expect(LOOK.role.moving.core).toBe(1.25)
    expect(LOOK.stagger).toEqual([1.0, 0.8, 1.14, 0.9, 1.07, 0.84])
    expect(LOOK.accent).toEqual({ body: 0.46, toRole: 0.12, rimGain: 0.75 })
    expect(Object.keys(LOOK.preset).sort()).toEqual(['aluminium', 'brass', 'copper', 'ghost', 'glass', 'glow', 'iron', 'matte', 'plastic', 'rubber', 'steel'])
    expect(LOOK.shell.ghost).toEqual({ face: 0.022, rim: 0.2, line: 0.55, halo: 0.08, sil: 0.38 })
    expect(LOOK.focus.veil).toBe(0.42)
    expect(LOOK.cut.period).toBe(0.15)
    expect(LOOK.fluid.bloomFill).toEqual([0.55, 2.9])
  })
  test('overrides merge deeply and leave the defaults alone', () => {
    const K = resolveLook({ line: { sigma: 2 }, role: { housing: { base: '#000000' } }, creaseDeg: 30 })
    expect(K.line.sigma).toBe(2)
    expect(K.line.crease).toBe(LOOK.line.crease)
    expect(K.role.housing.base).toBe('#000000')
    expect(K.role.housing.line).toBe(LOOK.role.housing.line)
    expect(K.creaseDeg).toBe(30)
    expect(LOOK.line.sigma).toBe(1.5)
    expect(resolveLook(null)).toBe(LOOK)
  })
  test('a key the table does not have, or a value of another type, is reported and ignored', () => {
    const problems: LookProblem[] = []
    const K = resolveLook({ lines: { sigma: 2 }, line: { sigmma: 2, sigma: 'wide' }, light: { key: [1, 2] } }, problems)
    expect(K.line.sigma).toBe(1.5)
    expect(K.light.key).toEqual(LOOK.light.key)
    expect(problems.map((p) => p.path).sort()).toEqual(['light.key', 'line.sigma', 'line.sigmma', 'lines'])
    expect(problems.find((p) => p.path === 'lines')!.near).toBe('line')
    expect(problems.find((p) => p.path === 'line.sigmma')!.near).toBe('sigma')
  })
  test('new presets and roles can be added by name', () => {
    const K = resolveLook({ preset: { gold: { base: '#B8860B', line: '#FFD700', rim: '#FFE55C', rimGain: 0.6, spec: 0.35 } } })
    const s = styleOf(K, { role: 'static', material: 'gold' })
    expect(near(s.base, hexToLinear('#B8860B')!)).toBe(true)
    expect(s.spec).toBe(0.35)
  })
})

describe('styleOf', () => {
  test('an unstyled part is drawn by its role, staggered by its order inside the role', () => {
    const a = styleOf(LOOK, { role: 'housing', nth: 0 }), b = styleOf(LOOK, { role: 'housing', nth: 1 }), g = styleOf(LOOK, { role: 'housing', nth: 6 })
    const base = hexToLinear('#39414E')!
    expect(near(a.base, base)).toBe(true)
    expect(near(b.base, base.map((x) => x * 0.8))).toBe(true)
    expect(near(g.base, a.base)).toBe(true) // the stagger is a cycle
    expect(near(a.line, b.line)).toBe(true) // lines and rim are not staggered
    expect(a.core).toBe(1.05)
    expect(styleOf(LOOK, { role: 'moving' }).core).toBe(1.25)
  })
  test('an accent is light, not paint: a dark tinted body, lines and rim in the accent', () => {
    const blue = hexToLinear('#58C4DD')!
    const s = styleOf(LOOK, { role: 'static', accent: '#58C4DD', nth: 3 })
    const role = hexToLinear(LOOK.role.static.base)!
    expect(near(s.base, blue.map((x, i) => x * 0.46 + (role[i]! - x * 0.46) * 0.12))).toBe(true)
    expect(near(s.line, blue)).toBe(true)
    expect(near(s.rim, blue)).toBe(true)
    expect(s.rimGain).toBe(0.75)
  })
  test('a named material replaces the role row and is not staggered', () => {
    const a = styleOf(LOOK, { role: 'static', material: 'brass', nth: 0 }), b = styleOf(LOOK, { role: 'static', material: 'brass', nth: 1 })
    expect(near(a.base, hexToLinear('#94793F')!)).toBe(true)
    expect(near(a.base, b.base)).toBe(true)
    expect(a.spec).toBe(0.3)
    expect(a.core).toBe(LOOK.role.static.core) // line core and halo come from the role
  })
  test('every preset has a kind', () => {
    const kinds = Object.fromEntries(Object.keys(LOOK.preset).map((name) => [name, styleOf(LOOK, { role: 'static', material: name }).kind]))
    expect(kinds).toEqual({ steel: 'lit', aluminium: 'lit', iron: 'lit', brass: 'lit', copper: 'lit', rubber: 'lit', plastic: 'lit', matte: 'lit', glass: 'shell', ghost: 'shell', glow: 'glow' })
    expect(styleOf(LOOK, { role: 'static', material: 'glass' }).face).toBe(0.03)
    expect(styleOf(LOOK, { role: 'static', material: 'ghost' }).lineOpacity).toBe(0.55)
  })
  test('the object form: roughness is gloss, opacity below 1 is a shell, emissive is a glow', () => {
    expect(styleOf(LOOK, { role: 'static', material: { roughness: 0 } }).spec).toBeCloseTo(0.3)
    expect(styleOf(LOOK, { role: 'static', material: { roughness: 1 } }).spec).toBeCloseTo(0)
    const shell = styleOf(LOOK, { role: 'static', material: { opacity: 0.3 } })
    expect(shell.kind).toBe('shell')
    expect(shell.face).toBeCloseTo(0.03)
    const glow = styleOf(LOOK, { role: 'static', material: { emissive: 0.85, color: '#FC6255' } })
    expect(glow.kind).toBe('glow')
    expect(near(glow.base, hexToLinear('#FC6255')!)).toBe(true)
    expect(glow.fill).toBeCloseTo(0.8)
    expect(styleOf(LOOK, { role: 'static', material: { emissive: 0.425 } }).fill).toBeCloseTo(0.4)
  })
  test('a fluid is its colour, undimmed; BLUE when it has none', () => {
    expect(near(styleOf(LOOK, { role: 'fluid' }).base, hexToLinear('#58C4DD')!)).toBe(true)
    const gold = styleOf(LOOK, { role: 'fluid', accent: '#F0AC5F', nth: 4 })
    expect(gold.kind).toBe('fluid')
    expect(near(gold.base, hexToLinear('#F0AC5F')!)).toBe(true)
    expect(near(gold.line, gold.base)).toBe(true)
  })
})

describe('partDraw', () => {
  const steel = styleOf(LOOK, { role: 'moving' }), housing = styleOf(LOOK, { role: 'housing' })
  test('at rest a lit part is an opaque body with full lines and no shell', () => {
    const d = partDraw(LOOK, steel, rest)
    expect(d.body).toBe(1)
    expect(d.shell).toBe(0)
    expect(d.lineOpacity).toBe(1)
    expect(d.xray).toBe(0)
    expect(d.hero).toBe(0)
    expect(d.seeThrough).toBe(false)
    expect(near(d.base, steel.base)).toBe(true)
  })
  test('ghost is a blend, never a switch: body and solid lines fade as shell and x-ray lines arrive', () => {
    let last = partDraw(LOOK, housing, rest)
    for (let g = 0.1; g <= 1.0001; g += 0.1) {
      const d = partDraw(LOOK, housing, { ...rest, ghost: g })
      expect(d.body).toBeLessThan(last.body)
      expect(d.shell).toBeGreaterThan(last.shell)
      expect(d.xray).toBeGreaterThan(last.xray)
      expect(Math.abs(d.body - last.body)).toBeLessThan(0.11)
      last = d
    }
    expect(last.body).toBeCloseTo(0)
    expect(last.xray).toBeCloseTo(LOOK.shell.ghost.line)
    expect(last.face).toBeCloseTo(LOOK.shell.ghost.face)
    expect(last.seeThrough).toBe(true)
  })
  test('focus: the part in focus is lit, not painted; everything else recedes', () => {
    const hero = partDraw(LOOK, steel, { ...rest, focus: 1, dim: 1 })
    expect(hero.hero).toBe(1)
    expect(near(hero.base, hexToLinear(LOOK.focus.steel)!)).toBe(true)
    expect(near(hero.highlight, hexToLinear('#FFFF00')!)).toBe(true)
    expect(hero.level).toBe(1)
    const other = partDraw(LOOK, steel, { ...rest, dim: 1 })
    expect(other.level).toBeCloseTo(LOOK.recede.level)
    expect(other.lineOpacity).toBeCloseTo(LOOK.recede.line)
    expect(other.halo).toBeCloseTo(0)
    expect(other.body).toBe(1) // a receding mechanism part stays solid and keeps its depth
    expect(near(other.base, desaturate(steel.base, LOOK.recede.saturation))).toBe(true)
    // a housing that is not in focus becomes the dim x-ray shell
    const shell = partDraw(LOOK, housing, { ...rest, dim: 1 })
    expect(shell.body).toBeCloseTo(0)
    expect(shell.face).toBeCloseTo(LOOK.shell.dim.face)
    expect(shell.xray).toBeCloseTo(LOOK.shell.dim.line)
    // the highlight of an accent part is its accent
    const blue = styleOf(LOOK, { role: 'moving', accent: '#58C4DD' })
    expect(near(partDraw(LOOK, blue, { ...rest, focus: 1 }).highlight, hexToLinear('#58C4DD')!)).toBe(true)
  })
  test('a glass part is always a shell with its own numbers', () => {
    const d = partDraw(LOOK, styleOf(LOOK, { role: 'housing', material: 'glass' }), rest)
    expect(d.body).toBe(0)
    expect(d.shell).toBe(1)
    expect(d.face).toBeCloseTo(0.03)
    expect(d.xray).toBeCloseTo(0.7)
    expect(d.seeThrough).toBe(true)
  })
  test('a fluid follows its energy and is hidden while something else is in focus', () => {
    const f = styleOf(LOOK, { role: 'fluid', accent: '#F0AC5F' })
    const cold = partDraw(LOOK, f, rest), hot = partDraw(LOOK, f, { ...rest, energy: 1 })
    expect(cold.fluidLevel).toBeCloseTo(1.18)
    expect(hot.fluidLevel).toBeCloseTo(1.55)
    expect(cold.emit).toBeCloseTo(0.14)
    expect(hot.emit).toBeCloseTo(0.7)
    expect(cold.bloom).toBeCloseTo(0.55)
    expect(hot.bloom).toBeCloseTo(2.9)
    expect(partDraw(LOOK, f, { ...rest, energy: 0.5 }).emit).toBeCloseTo(0.14 + 0.56 * 0.25)
    expect(partDraw(LOOK, f, { ...rest, dim: 1 }).body).toBeCloseTo(0)
    expect(partDraw(LOOK, f, { ...rest, dim: 1, focus: 1 }).body).toBe(1)
  })
  test('entering: lines first, then the body; create() draws the lines on from the bottom', () => {
    const early = partDraw(LOOK, steel, { ...rest, reveal: 0.3, mode: 'create' })
    expect(early.draw).toBeCloseTo(0.3 / LOOK.enter.drawEnd)
    expect(early.body).toBe(0)
    expect(early.lineOpacity).toBe(1)
    const late = partDraw(LOOK, steel, { ...rest, reveal: 0.8, mode: 'create' })
    expect(late.draw).toBe(1)
    expect(late.body).toBeGreaterThan(0.3)
    expect(late.body).toBeLessThan(1)
    const fade = partDraw(LOOK, steel, { ...rest, reveal: 0.25, mode: 'fade' })
    expect(fade.draw).toBe(1)
    expect(fade.lineOpacity).toBeGreaterThan(fade.body)
    // monotonic and complete
    let last = -1
    for (let p = 0; p <= 1.0001; p += 0.05) { const d = partDraw(LOOK, steel, { ...rest, reveal: Math.min(1, p), mode: 'fade' }); expect(d.body).toBeGreaterThanOrEqual(last); last = d.body }
    expect(last).toBe(1)
  })
  test('opacity fades body and lines together; a half-faded part hides nothing', () => {
    const d = partDraw(LOOK, steel, { ...rest, alpha: 0.4 })
    expect(d.body).toBeCloseTo(0.4)
    expect(d.lineOpacity).toBeCloseTo(0.4)
    expect(d.seeThrough).toBe(true)
  })
  test('hover brightens and never changes anything at 0', () => {
    const a = partDraw(LOOK, steel, rest), b = partDraw(LOOK, steel, { ...rest, hover: 1 })
    expect(b.level).toBeGreaterThan(a.level)
    expect(b.rimGain).toBeGreaterThan(a.rimGain)
    expect(b.core).toBeGreaterThan(a.core)
  })
  test('same input, same output', () => {
    const i = { ...rest, ghost: 0.37, focus: 0.2, dim: 0.6, reveal: 0.71 }
    expect(partDraw(LOOK, housing, i)).toEqual(partDraw(LOOK, housing, i))
  })
})

describe('colour', () => {
  test('hex to linear', () => {
    expect(hexToLinear('#000')).toEqual([0, 0, 0])
    expect(hexToLinear('#FFFFFF')).toEqual([1, 1, 1])
    expect(hexToLinear('#808080')![0]).toBeCloseTo(0.2158, 3)
    expect(hexToLinear('#58C4DD80')).toEqual(hexToLinear('#58C4DD'))
    expect(hexToLinear('blue')).toBeNull()
    expect(hexToLinear(12)).toBeNull()
  })
  test('desaturate keeps the luminance', () => {
    const c = hexToLinear('#FC6255')!, g = desaturate(c, 0)
    const y = (v: readonly number[]): number => 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!
    expect(g[0]).toBeCloseTo(g[1]!)
    expect(y(g)).toBeCloseTo(y(c))
    desaturate(c, 1).forEach((x, i) => expect(x).toBeCloseTo(c[i]!, 12))
  })
})
