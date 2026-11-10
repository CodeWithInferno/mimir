// The core step actions: play, wait, set, camera, show, hide, clock. Installed with defineStepAction.
import { currentModel as currentModelOf } from './context.ts'
import { closest } from './diagnostics.ts'
import { isNode } from './node.ts'
import { anim, defineStepAction, defineVerb, reportProblems } from './registry.ts'
import { validateOptions, type Schema } from './schema.ts'
import { CAMERA, CAMERA2D, isAnim, type Anim } from './timeline.ts'
import { toVec3 } from './math.ts'
import { spaceOf, ZOOM_MAX, ZOOM_MIN, type Zoom2DSpec } from './frame.ts'
import { MAX_SECONDS, type SceneModel } from './model.ts'
import type { MNode } from './node.ts'
import { laggedTimings, PACE, type RateFn } from './rate.ts'
import { VIEWS } from './camera.ts'
import { isParam } from './scene.ts'

const isOpts = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !isNode(v) && !isAnim(v)
const PLAY: Schema = { duration: { type: 'positive', dynamic: false, example: 'duration: 2' }, lag: { type: 'nonneg', dynamic: false, example: 'lag: 0.1' }, rate: { type: 'fn', example: 'rate: linear' } }

/** A duration nobody means (`duration: 1e9` makes the story a billion seconds long): reported, and the default is used instead. */
function sane(model: SceneModel, call: string, seconds: number | undefined): number | undefined {
  if (seconds === undefined || seconds <= MAX_SECONDS) return seconds
  model.diagnostics.add({ code: 'NUM-INVALID', measured: seconds, limit: MAX_SECONDS, what: `${call}: ${seconds} s is longer than any single move may be (${MAX_SECONDS} s).`, fix: ['durations are seconds: duration: 2', 'a long explanation is many steps (and chapters), not one long one'] })
  return undefined
}
/** Flatten nested arrays of anims; report anything that is not an animation. */
function collect(model: any, call: string, items: unknown[]): Anim[] {
  const out: Anim[] = []
  for (const it of items.flat(3)) {
    if (isAnim(it)) out.push(it)
    else if (isNode(it)) model.diagnostics.add({ code: 'API-TYPE', ids: [it.id], what: `${call} got the object #${it.id}, not an animation.`, fix: [`${call.replace('()', '')}(fadeIn(${it.id}))`, 'or use a verb: write(m), create(m), m.to.shift(1, 0) …'] })
    else if (it !== undefined && it !== null) model.diagnostics.add({ code: 'API-TYPE', what: `${call} expects animations (fadeIn(m), write(m), m.to.…), got ${typeof it}.`, fix: ['st.play(fadeIn(m))'] })
    else model.diagnostics.add({ code: 'REF-MISSING', what: `${call} got ${String(it)} where an animation was expected.`, fix: ['check the variable name of the animation you pass'] })
  }
  return out
}

/** all(a, b, …): play together. */
export const all = defineVerb('all', (...items: unknown[]): Anim => {
  const anims = collect(currentModelOf(), 'all()', items)
  const duration = Math.max(0, ...anims.map((a) => a.duration))
  return anim('all', duration, (rec, at, d, rate) => {
    const k = duration > 0 ? d / duration : 1
    for (const a of anims) a.record(rec, at, a.duration * k, rate)
  })
})
/** seq(a, b, …): play one after the other. */
export const seq = defineVerb('seq', (...items: unknown[]): Anim => {
  const anims = collect(currentModelOf(), 'seq()', items)
  const duration = anims.reduce((s, a) => s + a.duration, 0)
  return anim('seq', duration, (rec, at, d, rate) => {
    const k = duration > 0 ? d / duration : 1
    let t = at
    for (const a of anims) { a.record(rec, t, a.duration * k, rate); t += a.duration * k }
  })
})
/** lagged([a, b, …], { lag = 0.1 }): each starts lag × (previous duration) after the one before. */
export const lagged = defineVerb('lagged', (items: unknown, opts?: unknown): Anim => {
  const model = currentModelOf()
  const list = Array.isArray(items) ? items : [items]
  const v = validateOptions('lagged()', opts, { lag: { type: 'nonneg', dynamic: false, default: PACE.lag, example: 'lag: 0.1' } }, undefined, model)
  reportProblems(model, v.problems, [])
  const lag = (v.props.lag as number | undefined) ?? PACE.lag
  const anims = collect(model, 'lagged()', list)
  const timings = laggedTimings(anims.map((a) => a.duration), lag)
  const duration = Math.max(0, ...timings.map((t) => t[1]))
  return anim('lagged', duration, (rec, at, d, rate) => {
    const k = duration > 0 ? d / duration : 1
    anims.forEach((a, i) => a.record(rec, at + timings[i]![0] * k, a.duration * k, rate))
  })
})

defineStepAction('play', (st, ...args: unknown[]) => {
  let opts: Record<string, unknown> = {}
  if (args.length && isOpts(args[args.length - 1])) {
    const v = validateOptions('st.play()', args.pop(), PLAY, { runTime: 'duration', run_time: 'duration', lagRatio: 'lag', lag_ratio: 'lag' }, st.model)
    reportProblems(st.model, v.problems, [])
    opts = v.props
  }
  const anims = collect(st.model, 'st.play()', args)
  if (!anims.length) return
  const rate = opts.rate as RateFn | undefined
  const one = opts.lag !== undefined ? lagged(anims, { lag: opts.lag as number }) : anims.length === 1 ? anims[0]! : all(...anims)
  const duration = sane(st.model, 'st.play()', opts.duration as number | undefined) ?? Math.min(one.duration, MAX_SECONDS)
  one.record(st, st.cursor, duration, rate)
  st.advance(duration)
  st.need(st.cursor)
})

defineStepAction('wait', (st, seconds: unknown = PACE.wait) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) { st.model.diagnostics.add({ code: typeof seconds === 'number' ? 'NUM-INVALID' : 'API-TYPE', what: `st.wait() expects seconds (a number that is not negative), got ${String(seconds)}.`, fix: ['st.wait(1)'] }); return }
  if (sane(st.model, 'st.wait()', seconds) === undefined) return
  st.advance(seconds)
  st.need(st.cursor)
})

const SET: Schema = { duration: { type: 'nonneg', dynamic: false, example: 'duration: 2' }, rate: { type: 'fn', example: 'rate: linear' } }
defineStepAction('set', (st, param: unknown, value: unknown, opts?: unknown) => {
  const model = st.model
  if (!isParam(param)) {
    const names = model.params.map((p) => p.name)
    const byName = typeof param === 'string' ? model.params.find((p) => p.name === param) : undefined
    if (!byName) {
      const near = typeof param === 'string' ? closest(param, names) : null
      model.diagnostics.add({ code: param === undefined || typeof param === 'string' ? 'REF-MISSING' : 'API-TYPE', what: `st.set(): the first argument is not a param (${typeof param === 'string' ? `"${param}"` : String(param)}).`, fix: [near ? `use the param "${near}"` : names.length ? `pass the value returned by s.param(...): ${names.join(', ')}` : "create it first: const speed = s.param('speed', { value: 0, min: 0, max: 10 })"] })
      return
    }
    param = { def: byName, isParam: true }
  }
  const def = (param as { def: import('./model.ts').ParamDef }).def
  const v = validateOptions('st.set()', opts, SET, undefined, model)
  reportProblems(model, v.problems, [])
  if (def.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) { model.diagnostics.add({ code: typeof value === 'number' ? 'NUM-INVALID' : 'API-TYPE', what: `st.set(${def.name}, …): the value must be a finite number, got ${String(value)}.`, fix: [`st.set(${def.name}, ${def.max})`] }); return }
    const d = sane(model, 'st.set()', v.props.duration as number | undefined)
    if (d !== undefined) st.clip(def, 'value', value, { duration: d, rate: v.props.rate as RateFn | undefined })
    else st.clip(def, 'value', value, { at: 0, sweep: true, rate: v.props.rate as RateFn | undefined })
    return
  }
  if (def.kind === 'toggle' && typeof value !== 'boolean') { model.diagnostics.add({ code: 'API-TYPE', what: `st.set(${def.name}, …): a toggle takes true or false, got ${String(value)}.`, fix: [`st.set(${def.name}, true)`] }); return }
  if (def.kind === 'choice' && !def.options.includes(String(value))) {
    const near = closest(String(value), def.options)
    model.diagnostics.add({ code: 'API-UNKNOWN', what: `st.set(${def.name}, …): "${String(value)}" is not one of its options.`, fix: [near ? `use "${near}"` : `use one of: ${def.options.join(', ')}`] })
    return
  }
  st.clip(def, 'value', value, { duration: 0 })
})

const CAMERA_SCHEMA: Schema = {
  view: { type: Object.keys(VIEWS), dynamic: false }, target: { type: 'point', example: 'target: piston' }, azimuth: { type: 'number', dynamic: false }, elevation: { type: 'number', dynamic: false },
  distance: { type: 'positive', dynamic: false }, zoom: { type: 'positive', dynamic: false, example: 'zoom: 1.5' }, fov: { type: 'positive', dynamic: false }, fit: { type: 'any', example: 'fit: [piston, rod]' },
  duration: { type: 'nonneg', dynamic: false, example: 'duration: 2' }, rate: { type: 'fn' },
}
defineStepAction('camera', (st, spec: unknown) => {
  const model = st.model
  const v = validateOptions('st.camera()', typeof spec === 'string' ? { view: spec } : spec ?? {}, CAMERA_SCHEMA, { theta: 'azimuth', phi: 'elevation', lookAt: 'target', at: 'target', frame: 'fit' }, model)
  reportProblems(model, v.problems, [])
  const { duration, rate, ...pose } = v.props as { duration?: number; rate?: RateFn } & Record<string, unknown>
  if (pose.fit !== undefined && pose.fit !== true) {
    const list = (Array.isArray(pose.fit) ? pose.fit : [pose.fit]).map((x) => model.resolveNode(x, 'st.camera()', 'fit')).filter((x) => x !== null)
    if (!list.length) delete pose.fit
    else pose.fit = list
  }
  if (!Object.keys(pose).length) return
  st.clip(CAMERA, 'pose', pose, { duration: sane(model, 'st.camera()', duration) ?? PACE.camera, rate })
})

const ZOOM: Schema = { zoom: { type: 'positive', dynamic: false, example: 'zoom: 2' }, margin: { type: 'positive', dynamic: false, example: 'margin: 1.3' }, duration: { type: 'nonneg', dynamic: false, example: 'duration: 2' }, rate: { type: 'fn' } }
/**
 * st.zoom(target | null, { zoom?, margin?, duration? }): move the 2D camera. target = a 2D object or a list of them
 * (framed with a margin and followed), a point [x, y], a rectangle { x, y, width, height } (s.area()), or null for
 * the whole frame. Objects marked m.hud() stay where they are.
 */
defineStepAction('zoom', (st, target: unknown, opts?: unknown) => {
  const model = st.model
  const v = validateOptions('st.zoom()', opts, ZOOM, { scale: 'zoom', padding: 'margin' }, model)
  reportProblems(model, v.problems, [])
  const { duration, rate, zoom, margin } = v.props as { duration?: number; rate?: RateFn; zoom?: number; margin?: number }
  let spec: Zoom2DSpec | null = null
  // null is the way back to the whole frame; a variable that holds nothing is a mistake, not a zoom out
  if (target === undefined) { model.diagnostics.add({ code: 'REF-MISSING', what: 'st.zoom(): the target is undefined - the object it should refer to does not exist.', fix: ['pass a 2D object created earlier in the scene (check the variable name)', 'st.zoom(null) goes back to the whole frame'] }); return }
  if (zoom !== undefined && (zoom < ZOOM_MIN || zoom > ZOOM_MAX)) { model.diagnostics.add({ code: 'NUM-INVALID', measured: zoom, limit: zoom < ZOOM_MIN ? ZOOM_MIN : ZOOM_MAX, what: `st.zoom(): zoom ${zoom} is outside ${ZOOM_MIN} to ${ZOOM_MAX}; at that magnification nothing readable is left on screen.`, fix: ['leave zoom out: the target is framed with a margin', 'zoom: 2'] }); return }
  if (Array.isArray(target) && target.length >= 2 && target.length <= 3 && target.every((x) => typeof x === 'number') && !target.every(Number.isFinite)) { model.diagnostics.add({ code: 'NUM-INVALID', what: `st.zoom(): the point [${target.map(String).join(', ')}] is not finite.`, fix: ['st.zoom([1, 2])', 'or pass the object to frame: st.zoom(note)'] }); return }
  if (target !== null) {
    const point = toVec3(target)
    const r = target as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    if (point) spec = { point: [point[0], point[1]] }
    else if (typeof target === 'object' && !isNode(target) && !Array.isArray(target) && typeof r.width === 'number' && typeof r.height === 'number') {
      if (!(r.width > 0) || !(r.height > 0) || !Number.isFinite(r.width + r.height)) { model.diagnostics.add({ code: 'NUM-INVALID', what: `st.zoom(): a rectangle of ${r.width} x ${r.height} has no area to frame.`, fix: ['st.zoom({ x: -3, y: -2, width: 4, height: 3 })', 'or pass the object to frame: st.zoom(note)'] }); return }
      spec = { rect: { x: typeof r.x === 'number' ? r.x : -r.width / 2, y: typeof r.y === 'number' ? r.y : -r.height / 2, width: r.width, height: r.height } }
    }
    else {
      const nodes = (Array.isArray(target) ? target : [target]).map((x) => st.node(x, 'st.zoom()', 'the target')).filter((n): n is MNode => n !== null)
      if (!nodes.length) return
      const solid = nodes.find((n) => n.space === '3d')
      if (solid) { model.diagnostics.add({ code: 'API-TYPE', ids: [solid.id], what: `st.zoom() moves the 2D camera, and #${solid.id} is a 3D part.`, fix: [`st.camera({ fit: [${solid.id}] })`] }); return }
      // (objects that turn out to live on the screen, because they follow a 3D part, are reported when the scene is finalised)
      const fixed = nodes.find((n) => spaceOf(n) === 'hud')
      if (fixed && nodes.length === 1) { model.diagnostics.add({ code: 'API-TYPE', ids: [fixed.id], what: `st.zoom(): #${fixed.id} is on the screen (m.hud() or pinned), which the 2D camera does not move, so it cannot be zoomed on.`, fix: ['zoom on a 2D object that is not .hud()', `or remove .hud() from #${fixed.id}`] }); return }
      spec = { nodes }
    }
    if (zoom !== undefined) spec.zoom = zoom
    if (margin !== undefined) spec.margin = margin
  }
  st.clip(CAMERA2D, 'pose2d', spec, { duration: sane(model, 'st.zoom()', duration) ?? PACE.camera, rate })
})

/** st.note(markdown): text for read mode only (extra depth, formulas). It takes no time and draws nothing on stage. */
defineStepAction('note', (st, markdown: unknown) => {
  if (typeof markdown !== 'string' || !markdown.trim()) { st.model.diagnostics.add({ code: 'API-TYPE', what: `st.note() expects markdown text, got ${typeof markdown === 'string' ? 'an empty string' : typeof markdown}.`, fix: ["st.note('The stroke is twice the crank radius.')"] }); return }
  st.rec.notes.push(markdown.trim())
})

const lifecycle = (name: 'show' | 'hide', to: 0 | 1) =>
  defineStepAction(name, (st, ...items: unknown[]) => {
    for (const it of items.flat(3)) {
      const node = st.node(it, `st.${name}()`)
      if (!node) continue
      st.clip(node, 'revealMode', 'fade', { duration: 0 })
      st.clip(node, 'present', to, { duration: PACE.scopedIn })
    }
  })
lifecycle('show', 1)
lifecycle('hide', 0)

defineStepAction('clock', (st, opts: unknown) => {
  const v = validateOptions('st.clock()', opts, { speed: { type: 'number', dynamic: false, example: 'speed: 0.5' }, freeze: { type: 'boolean', dynamic: false } }, undefined, st.model)
  reportProblems(st.model, v.problems, [])
  if (v.props.freeze === true) st.rec.clockSpeed = 0
  else if (typeof v.props.speed === 'number') {
    // time runs forward: a negative speed would take s.t() below zero, where nothing was ever simulated
    if (v.props.speed < 0) { st.model.diagnostics.add({ code: 'NUM-INVALID', measured: v.props.speed, limit: 0, what: `st.clock(): speed ${v.props.speed} is negative; simulation time only runs forward.`, fix: ['speed: 0.5 (slow motion), speed: 0 or freeze: true (stopped)', 'to show something going back, drive it with a param: st.set(angle, 0)'] }); return }
    st.rec.clockSpeed = v.props.speed
  }
})
