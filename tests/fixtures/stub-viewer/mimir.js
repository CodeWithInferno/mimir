// Stub of the Mimir runtime + viewer for the CLI tests. NOT the engine: a tiny scene recorder, an SVG overlay
// whose text depends on the story time, a lazily imported WebGL triangle, and the full window.__mimir host
// protocol (DESIGN section 9). Everything drawn is a pure function of (tau, params, view, debug).
//
// Scene files for this stub:
//   import { scene } from 'mimir'
//   export default scene({ title }, (s) => {
//     s.param(name, { value, min, max })   s.step(title, seconds)   s.triangle({ id, label })   s.dot({ id, label })
//     s.probe(name, (state) => number)     s.diag({ code, severity, step, t, ids, line, measured, limit, what, fix })
//   })

const query = new URLSearchParams(location.search)
const headless = query.get('headless') === '1'
const $ = (id) => document.getElementById(id)

export function scene(meta, build) {
  return { meta: meta || {}, build }
}

const model = { title: '', steps: [], params: [], parts: [], diags: [], probes: [], uses3d: false, fatal: null }
const state = { tau: 0, values: {}, view: null, debug: null }
let renderer = null
let sceneFile = null

const recorder = {
  param(name, { value = 0, min = 0, max = 1 } = {}) {
    model.params.push({ name, min, max, value })
    state.values[name] = value
    return () => state.values[name]
  },
  step(title, seconds = 2) {
    const t0 = model.steps.length ? model.steps[model.steps.length - 1].t1 : 0
    model.steps.push({ index: model.steps.length + 1, title, t0, t1: t0 + seconds })
  },
  triangle({ id = 'tri', label = 'Triangle' } = {}) {
    model.uses3d = true
    model.parts.push({ id, label })
  },
  dot({ id = 'dot', label = 'Dot' } = {}) {
    model.parts.push({ id, label })
  },
  probe(name, fn) {
    model.probes.push({ name, fn })
  },
  diag(d) {
    model.diags.push({ file: sceneFile, ...d })
  },
}

const duration = () => (model.steps.length ? model.steps[model.steps.length - 1].t1 : 0)
// half-open steps [t0, t1); the last one also owns the final instant
const stepAt = (tau) => model.steps.find((s) => tau >= s.t0 && tau < s.t1) || model.steps[model.steps.length - 1] || null
const value = (name, fallback) => (typeof state.values[name] === 'number' ? state.values[name] : fallback)

function render() {
  const d = duration()
  const step = stepAt(state.tau)
  const hue = value('hue', 200)
  $('title').textContent = model.title
  $('step').textContent = step ? `step ${step.index} · ${step.title}` : ''
  $('clock').textContent = `t = ${state.tau.toFixed(2)} s`
  $('readout').textContent = model.params.map((p) => `${p.name} = ${state.values[p.name]}`).join('   ') + (state.view ? `   view: ${state.view}` : '')
  $('message').textContent = model.fatal ? String(model.fatal.message).split('\n')[0] : ''
  const x = 120 + (d > 0 ? state.tau / d : 0) * 1040
  const dot = $('dot')
  const hasDot = model.parts.some((p) => p.id === 'dot')
  dot.style.display = hasDot ? '' : 'none'
  dot.setAttribute('cx', x.toFixed(2))
  dot.setAttribute('fill', state.debug === 'ids' ? '#00ffff' : `hsl(${hue} 70% 60%)`)
  $('dot-id').setAttribute('x', x.toFixed(2))
  $('dot-id').textContent = state.debug === 'ids' && hasDot ? '#dot' : ''
  $('tri-id').textContent = state.debug === 'ids' && model.uses3d ? '#tri' : ''
  $('progress').setAttribute('width', ((d > 0 ? state.tau / d : 0) * 1184).toFixed(2))
  if (renderer) renderer.draw({ angleDeg: 40 * state.tau * value('speed', 1), hue, view: state.view, debug: state.debug })
}

function currentProbes() {
  const out = { t: state.tau, angle: 40 * state.tau * value('speed', 1) }
  for (const p of model.probes) {
    try {
      out[p.name] = Number(p.fn({ t: state.tau, ...state.values }))
    } catch {
      out[p.name] = NaN
    }
  }
  return out
}

let resolveReady
window.__mimir = {
  ready: new Promise((r) => { resolveReady = r }),
  info() {
    return {
      title: model.title,
      duration: duration(),
      steps: model.steps.map((s) => ({ ...s })),
      // like the real host: the DECLARED value; the value in effect is in state().params
      params: model.params.map((p) => ({ name: p.name, min: p.min, max: p.max, value: p.value })),
      parts: model.parts.map((p) => ({ ...p })),
      views: ['front', 'iso', 'side', 'top'],
      ...(model.fatal ? { fatal: model.fatal } : {}),
    }
  },
  seek(tau) {
    state.tau = Math.max(0, Math.min(duration(), Number(tau) || 0))
    render()
  },
  setParam(name, v) {
    if (!(name in state.values)) return
    state.values[name] = v
    render()
  },
  setView(view) {
    state.view = typeof view === 'string' ? view : view ? 'custom' : null
    render()
  },
  frame() {
    render()
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  },
  async diagnostics(_opts) {
    return model.diags.map((d) => ({ ...d }))
  },
  probes: currentProbes,
  // beyond DESIGN section 9, as in the real host: what is on screen right now
  state() {
    const step = stepAt(state.tau)
    return { tau: state.tau, step: step ? step.index : 0, duration: duration(), params: { ...state.values } }
  },
  debug(mode) {
    state.debug = mode || null
    render()
  },
}

async function boot() {
  const param = query.get('scene')
  try {
    if (!param) throw new Error('no ?scene=<module url> in the page address')
    const url = new URL(param, location.href)
    sceneFile = url.protocol === 'file:' || url.protocol === 'blob:' ? param : url.pathname
    const mod = await import(url.href)
    const def = mod.default
    if (!def || typeof def.build !== 'function') throw new Error('the scene module must `export default scene({ title }, (s) => { … })`')
    model.title = def.meta.title || ''
    def.build(recorder)
    if (model.uses3d) {
      const three = await import('./mimir.3d.js')
      renderer = three.createRenderer($('gl'))
    }
  } catch (e) {
    const stack = String((e && e.stack) || e)
    const where = /([^\s()]+\.m?js):(\d+)(?::\d+)?/.exec(stack)
    model.fatal = { message: String((e && e.message) || e), file: sceneFile, line: where ? Number(where[2]) : null }
  }
  if (!headless) {
    const scrub = document.createElement('input')
    Object.assign(scrub, { id: 'scrub', type: 'range', min: 0, max: duration(), step: 0.01, value: 0 })
    scrub.addEventListener('input', () => window.__mimir.seek(Number(scrub.value)))
    document.body.append(scrub)
    addEventListener('resize', render)
  }
  state.tau = Number(query.get('t')) || 0
  render()
  resolveReady()
}

boot()
