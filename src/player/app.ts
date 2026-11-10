// The player: the chrome round the engine's stage (UI design specification). State, then one draw: `S` holds what the reader
// chose, named channels of the runner hold every change in progress, `layout()` measures once per window size and
// `draw()` turns state and channels into transforms and opacities. It talks to the scene through window.__mimir (the
// host protocol) and nothing else: the stage, its captions, labels and pointer are the engine's.
import type { PlayerTransport } from '../core/index.ts'
import type { HostState, Manifest, MimirHost } from '../host/index.ts'
import { FONT_MONO_STACK, FONT_TEXT } from '../r2d/type.ts'
import { TOKENS_CSS, UI_CSS } from './css.ts'
import { $, $$, button, el, ICON, key, MOD, playGlyph, typing } from './dom.ts'
import type { PartMeta, PlayerManifest } from './index.ts'
import { carryBox, freeStage, LAYOUT, letterbox, measure, mixBox, type Box, type Metrics, type Tokens } from './layout.ts'
import { clamp, clock, createRunner, D, fade, lerp, linear, move, place, prefersReduced, reach, setText, smooth, span, sspan, WARP_MAX_SECONDS, type Runner } from './motion.ts'
import { END_EPSILON, jumpTarget, locate, magnet, NUDGE_SECONDS, nextSpeed, planNames, sectionAt, sectionsOf, SKIP_SECONDS, speedText, ticksOf, CROWDED_STEPS, type Section, type Tick } from './story.ts'
import { EXTRA_CSS } from './styles.ts'

export type Mode = 'video' | 'read' | 'explore'
/** What the reader chose. Everything on screen is a function of this, the channels, and the story's time. */
export interface State {
  mode: Mode
  playing: boolean
  speed: number
  /** subtitles in watch mode (read and explore never show them: the column, or the hint, is the text) */
  captions: boolean
  voice: boolean
  loop: boolean
  /** the scene is built and its first frame drawn */
  ready: boolean
  /** the part under the pointer or the keyboard, and where the hover came from */
  hover: string | null
  hoverFrom: string
  /** the part whose note is open */
  note: string | null
  scrubbing: boolean
  /** a parameter's track is being dragged: the rest of the chrome steps back */
  dragging: boolean
}
/** A part of the chrome with its own state: laid out and drawn with the rest, asked whether it holds the chrome awake. */
export interface Feature { layout?(): void; draw?(tau: number, state: HostState): void; ink?(ctx: CanvasRenderingContext2D): void; /** it is open: the chrome stays awake */ open?(): boolean; /** it is waiting on something that moves by itself: frames keep coming */ alive?(): boolean; dispose?(): void }
export interface Player {
  host: MimirHost; root: HTMLElement; app: HTMLElement; slot: HTMLElement
  query: URLSearchParams; RM: boolean; coarse: boolean
  info: Manifest; parts: PartMeta[]; listed: PartMeta[]
  L: Metrics; run: Runner; S: State
  /** a channel's value; under reduced motion geometry reads where it is going instead (nothing travels) */
  v(key: string, d?: number): number
  G(key: string, d?: number): number
  /** a duration as it is run: travel becomes a dissolve under reduced motion */
  ms(n: number): number
  part(id: string): PartMeta | undefined
  /** the listed part an object on the stage belongs to (itself, or what it is part of) */
  owner(id: string | null): PartMeta | undefined
  /** where the story is going (a jump in progress counts): two presses are two steps */
  goal(): number
  seek(t: number, o?: { cut?: boolean }): void
  step(dir: -1 | 1, chapter?: boolean): void
  setPlaying(on: boolean): void
  setMode(m: Mode): void
  setSpeed(s: number): void
  setCaptions(on: boolean): void
  setVoice(on: boolean): void
  setLoop(on: boolean): void
  toggleFull(): void
  /** the reader did something: the chrome wakes */
  touch(): void
  redraw(): void
  relayout(): void
  /** something opened or closed beside the stage: it makes room over `ms` */
  restage(ms: number): void
  setHover(id: string | null, from?: string): void
  /** a point of the engine's frame (stage px) as a point of the window, wherever the frame is being carried */
  toPage(x: number, y: number): { x: number; y: number }
  /** the frame as it is shown right now, in window px */
  frameBox(): Box
  announce(text: string): void
  /** the element to give the focus back to when a layer closes: what had it, if the keyboard put it there */
  invoker(): HTMLElement | null
  refocus(node: HTMLElement | null | undefined, fallback?: HTMLElement | null): void
  /** give the focus to something that is still arriving: it takes it in the first frame in which it can */
  focusSoon(node: HTMLElement): void
  add(f: Feature): void
  /** what other parts of the chrome can be asked to do (filled in by player.chunk.ts) */
  x: Record<string, any>
  /** a home page is served next to this viewer (GET /api/scenes answered) */
  home: boolean
}

/** the read channel's share in which the stage gets out of the way (spec 8.7), and when the column is written */
const READ = { stage: 0.55, stageStacked: 0.5, title: 0.3, column: [0.5, 0.92] as const }
/** the chrome that is not being used steps back to this while a parameter is dragged or an error is shown (spec 7.8, 7.15) */
export const DIMMED = 0.35
const STYLE_ID = 'mimir-player-style'
/** what is remembered across a reload of the same scene in the same tab (the dev server reloads the page when the scene file changes) */
const KEEP_KEY = 'mimir.player.keep'

export function createPlayer(host: MimirHost, mount: HTMLElement): { player: Player; slot: HTMLElement; transport: PlayerTransport; dispose(): void } {
  const query = new URLSearchParams(location.search)
  const RM = prefersReduced(query)
  const coarse = query.get('touch') === '1' || (query.get('touch') !== '0' && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  if (!document.getElementById(STYLE_ID)) {
    const style = el('style')
    style.id = STYLE_ID
    style.textContent = TOKENS_CSS + UI_CSS + EXTRA_CSS
    document.head.appendChild(style)
  }
  const root = el('div', 'm-root' + (coarse ? ' m-coarse' : ''))
  root.style.setProperty('--m-face', FONT_TEXT)
  root.style.setProperty('--m-mono', FONT_MONO_STACK)
  const slot = el('div', 'm-slot')
  const app = el('div', 'm-app')
  root.append(slot, app)
  mount.appendChild(root)
  const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
  if (meta && !/viewport-fit/.test(meta.content)) meta.content += ', viewport-fit=cover' // the margins read the safe areas

  // ── chrome ───────────────────────────────────────────────────────────────────────────────────────
  app.innerHTML = `
<canvas class="m-ink" aria-hidden="true"></canvas>
<header class="m-top">
  <a class="m-mark" aria-label="Mimir">Mimir</a>
  <h1 class="m-ttl"></h1>
  <span class="sp"></span>
  <div class="m-opt" data-g="mode" role="radiogroup" aria-label="Mode">
    <i class="m-opt-dot"></i>
    <button type="button" role="radio" data-mode="video" aria-checked="true" title="Watch (V)">Watch</button>
    <button type="button" role="radio" data-mode="read" aria-checked="false" title="Read (R)">Read</button>
    <button type="button" role="radio" data-mode="explore" aria-checked="false" title="Explore (E)">Explore</button>
  </div>
  <button type="button" class="m-word" data-a="ask" aria-expanded="false" title="Ask about this model (A)" hidden>Ask</button>
  <button type="button" class="m-word" data-a="share" aria-expanded="false" aria-haspopup="menu" title="Share (S)">Share</button>
  <button type="button" class="m-word" data-a="palette" aria-expanded="false" aria-haspopup="dialog">Commands${key(MOD() + 'K')}</button>
  <button type="button" class="m-more" data-a="more" aria-label="Share, commands" aria-haspopup="dialog">${ICON.more}</button>
</header>
<div class="m-abs m-load" role="status"><div class="bar"><i></i></div><span>Loading the scene</span></div>
<div class="nl" role="slider" tabindex="0" aria-label="Story time" aria-valuemin="0"></div>
<div class="m-abs m-transport" data-t="l">
  <button type="button" class="m-ico" data-a="play" aria-label="Play" title="Play or pause (Space)">${ICON.play}</button>
  <button type="button" class="m-ico" data-a="prev" aria-label="Previous step" title="Previous step (←), previous chapter (⇧←)">${ICON.prev}</button>
  <button type="button" class="m-ico" data-a="next" aria-label="Next step" title="Next step (→), next chapter (⇧→)">${ICON.next}</button>
  <span class="m-clock"><b data-t="now">0:00</b><span class="tot"> <i>/</i> <i data-t="all">0:00</i></span></span>
  <span class="m-where"><span data-t="where"></span></span>
</div>
<div class="m-abs m-transport m-transport-r" data-t="r">
  <button type="button" class="m-word m-speed" data-a="speed" title="Speed ([ slower, ] faster)">1×</button>
  <button type="button" class="m-switch wide-only" data-a="captions" role="switch" aria-checked="true" aria-label="Captions" title="Captions (C)"><span class="nm">Captions</span>${ICON.captions.replace('<svg', '<svg class="vi"')}<i class="st"></i><span class="tr"></span></button>
  <button type="button" class="m-switch" data-a="voice" id="m-voice" role="switch" aria-checked="false" aria-label="Voice" title="Voice (M). Captions stay either way."><span class="nm">Voice</span>${ICON.voice.replace('<svg', '<svg class="vi"')}<i class="st"></i><span class="tr"></span></button>
  <button type="button" class="m-switch wide-only" data-a="loop" role="switch" aria-checked="false" aria-label="Loop" title="Loop (O)"><span class="nm">Loop</span>${ICON.loop.replace('<svg', '<svg class="vi"')}<i class="st"></i><span class="tr"></span></button>
  <button type="button" class="m-ico" data-a="full" id="m-full" aria-label="Full screen" title="Full screen (F)">${ICON.full}</button>
</div>
<p class="m-sr" data-t="live" aria-live="polite"></p>`
  const ink = $<HTMLCanvasElement>('.m-ink', app), ictx = ink.getContext('2d')!
  const top = $('.m-top', app), line = $('.nl', app), tpL = $('[data-t=l]', app), tpR = $('[data-t=r]', app), load = $('.m-load', app), live = $('[data-t=live]', app)
  const modes = $('[data-g=mode]', app), playBtn = $<HTMLButtonElement>('[data-a=play]', app), prevBtn = $('[data-a=prev]', app), nextBtn = $('[data-a=next]', app)
  const whereEl = $('[data-t=where]', app), whereBox = $('.m-where', app), tNow = $('[data-t=now]', app), tAll = $('[data-t=all]', app), ttl = $('.m-ttl', app)
  const speedBtn = $('[data-a=speed]', app), capBtn = $('[data-a=captions]', app), voiceBtn = $('[data-a=voice]', app), loopBtn = $('[data-a=loop]', app)
  const [pp1, pp2] = $$<HTMLElement>('[data-pp]', playBtn) as unknown as [SVGPathElement, SVGPathElement]
  const safeProbe = el('div')
  safeProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  app.appendChild(safeProbe)

  // ── state ────────────────────────────────────────────────────────────────────────────────────────
  let keep: Partial<State> = {}
  // The dev server reloads the page when the scene file changes, by going to the same address with the moment in it:
  // the page then comes back where the author was and holds still, so the same instant can be looked at again. (A
  // refresh by hand is a `reload` navigation: that one plays, like any other opening.)
  let held = false
  try { const k = JSON.parse(sessionStorage.getItem(KEEP_KEY) ?? '{}') as Partial<State> & { scene?: string }; sessionStorage.removeItem(KEEP_KEY); if (k.scene && k.scene === query.get('scene')) { keep = k; held = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'navigate' } } catch { /* no storage here: start fresh */ }
  const asMode = (m: unknown): Mode | null => (m === 'video' || m === 'read' || m === 'explore' ? m : m === 'watch' ? 'video' : null)
  const S: State = {
    mode: asMode(query.get('mode')) ?? asMode(keep.mode) ?? 'video', playing: false, speed: typeof keep.speed === 'number' ? keep.speed : 1,
    captions: keep.captions ?? true, voice: keep.voice ?? false, loop: keep.loop ?? false, ready: false, hover: null, hoverFrom: '', note: null, scrubbing: false, dragging: false,
  }
  let info = host.info()
  const features: Feature[] = []
  let L = measure(1280, 720, tokens())
  let lastInput = performance.now(), overChrome = false, sleepTimer = 0
  let warp: { from: number; to: number } | null = null
  const stage = { free: { x: 0, y: 0, width: 1280, height: 720 } as Box, to: { x: 0, y: 0, width: 1280, height: 720 } as Box, from: null as Box | null }
  const sections: Section[] = [], ticks: (Tick & { el: HTMLElement })[] = []
  const nl = { axis: line, lit: line, dot: line, tip: line, mark: line, ghost: line, secs: [] as { num: HTMLElement; name: HTMLElement; wn: number; w: number; on?: boolean }[] }
  const geom = { x0: 0, x1: 1, w: 1 }
  let namePlan = { all: true, named: true }
  /** widths of the transport's groups with their names and without (px), and which of the two is on screen */
  const tw = { rightFull: 0, rightTight: 0, leftFull: 0, leftTight: 0, state: '' }
  /** the least room a step's name is worth showing in (px), and the air between the two groups */
  const WHERE_MIN = 96, TRANSPORT_AIR = 28
  let hoverT: number | null = null
  let wantFocus: { node: HTMLElement; until: number } | null = null
  let dotFrom = -1, ppWas = -1, wasStep = -2
  /** set by the palette: where a row that is being considered would land (a hollow dot on the line) */
  let ghostT: number | null = null

  function tokens(): Tokens {
    const cs = getComputedStyle(root), n = (name: string, d: number): number => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) ? v : d }
    return {
      lhCaption: n('--lh-caption', 34), fsUi: n('--fs-ui', 17), lhUi: n('--lh-ui', 24), fsBody: n('--fs-body', 19), lhBody: n('--lh-body', 29), fsSmall: n('--fs-small', 16), lhSmall: n('--lh-small', 22),
      fsHead: n('--fs-head', 22), lhHead: n('--lh-head', 30), fsTitle: n('--fs-title', 28), lhTitle: n('--lh-title', 34),
      gutter: n('--gutter', 30), col: n('--col', 440), note: n('--note', 320), first: n('--first', 96), clear: n('--clear', 56), row: n('--row', 32), page: n('--page', 1560),
    }
  }
  const run: Runner = createRunner(frame, { reduced: RM })
  const v = (k: string, d = 0): number => run.value(k, d)
  const G = (k: string, d = 0): number => (RM ? run.target(k, d) : run.value(k, d))
  const ms = (n: number): number => (RM ? (n > 0 ? D.dissolve : 0) : n)
  const tauNow = (): number => host.state().tau
  const meta2 = (): PlayerManifest => ((info as { player?: PlayerManifest }).player ?? { parts: [] })

  const P: Player = {
    host, root, app, slot, query, RM, coarse, info, parts: meta2().parts, listed: meta2().parts.filter((p) => p.listed), L, run, S, v, G, ms, x: {}, home: false,
    part: (id) => P.parts.find((p) => p.id === id),
    owner(id) {
      for (let cur = id; cur; cur = cur.includes('.') ? cur.slice(0, cur.lastIndexOf('.')) : '') { const p = P.listed.find((q) => q.id === cur); if (p) return p }
      return undefined
    },
    goal: () => (warp ? warp.to : tauNow()),
    seek, step: stepGo, setPlaying, setMode, setSpeed, setCaptions, setVoice, setLoop, toggleFull, touch, redraw: () => void run.kick(), relayout: layout, restage,
    setHover, toPage, frameBox: shownBox, announce: (text) => setText(live, text), invoker, refocus, focusSoon: (node) => { wantFocus = { node, until: performance.now() + 1000 }; run.kick() }, add: (f) => void features.push(f),
  }

  // ── the line of time ─────────────────────────────────────────────────────────────────────────────
  function buildLine(): void {
    line.textContent = ''
    const add = (cls: string, text?: string): HTMLElement => { const n = el('i', cls); if (text !== undefined) n.textContent = text; line.appendChild(n); return n }
    nl.axis = add('nl-axis')
    nl.lit = add('nl-lit')
    ticks.length = 0
    for (const t of ticksOf(info)) ticks.push({ ...t, el: add('nl-tick' + (t.major ? '' : ' minor')) })
    sections.length = 0
    sections.push(...sectionsOf(info))
    nl.secs = sections.map((s) => ({ num: add('nl-num', s.numeral), name: add('nl-name', s.title), wn: 0, w: 0 }))
    nl.mark = add('nl-mark')
    nl.tip = add('nl-tip')
    nl.ghost = add('nl-ghost')
    nl.dot = add('nl-dot')
    for (const n of [nl.mark, nl.tip, nl.ghost]) fade(n, 0)
    line.setAttribute('aria-valuemax', String(Math.round(info.duration)))
    setText(tAll, clock(info.duration))
    setText(ttl, info.title)
    document.title = info.title ? `${info.title} · Mimir` : 'Mimir'
  }
  const lineT = (clientX: number): number => clamp((clientX - geom.x0) / geom.w) * info.duration
  const whereText = (t: number): string => {
    const w = locate(info, t), st = info.steps[w.step], ch = info.chapters[w.chapter]
    return st ? (ch ? `${ch.title}, ${st.title}` : st.title) : ''
  }
  function drawLine(T: number, on: number): void {
    const y = LAYOUT.axisInBand, dur = Math.max(1e-6, info.duration), readX = move(span(G('read'), 0, L.stack ? READ.stageStacked : READ.stage))
    const x0 = lerp(L.mx, L.readLine, readX), x1 = L.W - L.mx, w = Math.max(1, x1 - x0), u = clamp(T / dur)
    geom.x0 = x0; geom.x1 = x1; geom.w = w
    place(line, 0, L.axisY - y)
    fade(line, on)
    nl.axis.style.transform = `translate3d(${x0.toFixed(2)}px,${y}px,0) scaleX(${(w / 100).toFixed(4)})`
    nl.lit.style.transform = `translate3d(${x0.toFixed(2)}px,${y - 0.5}px,0) scaleX(${((w * u) / 100).toFixed(4)})`
    place(nl.dot, x0 + w * u, y + 0.5)
    const at = locate(info, T), cur = sectionAt(sections, T)
    const crowd = L.phone || info.steps.length > CROWDED_STEPS
    for (const t of ticks) {
      const h = t.major ? 13 : 7, hidden = crowd && !t.major && t.chapter !== at.chapter
      fade(t.el, hidden ? 0 : 1)
      if (!hidden) t.el.style.transform = `translate3d(${(x0 + (w * t.t) / dur).toFixed(2)}px,${(y - h / 2 + 0.5).toFixed(2)}px,0) scaleY(${(h / 13).toFixed(3)})`
    }
    const xs = sections.map((s) => x0 + (w * s.t0) / dur)
    const plan = planNames(xs, x1, nl.secs.map((s) => s.wn), nl.secs.map((s) => s.w), cur, { left: x0 })
    nl.secs.forEach((s, i) => {
      const lit = i === cur
      if (s.on !== lit) { s.on = lit; s.num.classList.toggle('on', lit); s.name.classList.toggle('on', lit) }
      const nx = plan.numeral[i]
      fade(s.num, nx === null || nx === undefined ? 0 : 1)
      if (nx !== null && nx !== undefined) place(s.num, Math.round(nx) - 1, y - 32)
      let px = plan.name[i], py = y - 32
      if ((px === null || px === undefined) && lit && L.phone) { px = clamp(xs[i]! - 1, x0 - 1, x1 - s.w); py = y + 4 } // a phone's transport has no room for the name: it sits under the axis
      fade(s.name, px === null || px === undefined ? 0 : 1)
      if (px !== null && px !== undefined) place(s.name, Math.round(px), py)
    })
    namePlan = { all: plan.all, named: cur >= 0 && plan.name[cur] !== null && plan.name[cur] !== undefined }
    // the hover preview: a mark at the pointer and, in the names row, where it is and when
    if (hoverT !== null && !coarse) {
      const hx = x0 + (w * hoverT) / dur
      place(nl.mark, hx, y - 9)
      nl.tip.innerHTML = ''
      const b = el('b')
      b.textContent = whereText(hoverT)
      nl.tip.append(b, clock(hoverT))
      place(nl.tip, Math.round(clamp(hx - nl.tip.offsetWidth / 2, x0 - 8, x1 - nl.tip.offsetWidth + 8)), y - 32)
    }
    fade(nl.mark, hoverT !== null && !coarse ? 1 : 0)
    fade(nl.tip, hoverT !== null && !coarse ? 1 : 0)
    if (ghostT !== null) place(nl.ghost, x0 + (w * ghostT) / dur, y + 0.5)
    fade(nl.ghost, ghostT !== null ? 1 : 0)
    // transport: its left group rides the line's left end, its right group stays at the margin
    place(tpL, x0 - 9, L.transY - 18)
    place(tpR, 0, L.transY - 18)
    fade(tpL, on)
    fade(tpR, on)
    // when the two groups would meet, the names of the switches give way to their glyphs, then the total time, then the step's name
    const span0 = x1 - (x0 - 9) - 18 - TRANSPORT_AIR
    const rTight = tw.rightFull + tw.leftFull + WHERE_MIN > span0, lTight = (rTight ? tw.rightTight : tw.rightFull) + tw.leftFull + WHERE_MIN > span0
    const room = span0 - (rTight ? tw.rightTight : tw.rightFull) - (lTight ? tw.leftTight : tw.leftFull)
    const key3 = `${rTight}${lTight}${Math.round(room)}`
    if (tw.state !== key3) {
      tw.state = key3
      tpR.classList.toggle('tight', rTight)
      tpL.classList.toggle('tight', lTight)
      whereBox.style.maxWidth = Math.max(0, room) + 'px'
      whereBox.style.display = room < 40 ? 'none' : ''
    }
    setText(tNow, clock(T))
    const st = info.steps[at.step], ch = info.chapters[at.chapter]
    // the step's name; with the chapter's before it when the line cannot name the chapter itself
    const label = st ? (ch && !namePlan.named && !L.phone ? `${ch.title}, ${st.title}` : st.title) : ''
    // it leaves before the boundary and the next arrives after it, in story time (spec 8.3)
    const near = st ? Math.min(T - st.t0, st.t1 - T) : 1, o = RM || !S.playing ? 1 : sspan(near, 0, 0.2)
    setText(whereEl, label)
    fade(whereEl, o)
    place(whereEl, 0, st && T - st.t0 < st.t1 - T ? 4 * (1 - o) : -3 * (1 - o))
    const atStart = T < 0.05, atEnd = T >= info.duration - 0.05
    prevBtn.setAttribute('aria-disabled', String(atStart))
    nextBtn.setAttribute('aria-disabled', String(atEnd))
    const vt = `${whereText(T)}${whereText(T) ? ', ' : ''}${clock(T)} of ${clock(info.duration)}`
    if (line.getAttribute('aria-valuetext') !== vt) { line.setAttribute('aria-valuenow', String(Math.round(T))); line.setAttribute('aria-valuetext', vt) }
    const m = Number(move(v('play')).toFixed(3))
    if (m !== ppWas) { ppWas = m; const [a, b] = playGlyph(m); pp1.setAttribute('d', a); pp2.setAttribute('d', b) }
    // each step's title and text go to a polite live region when the step begins (spec 11)
    if (at.step !== wasStep) { wasStep = at.step; if (st && S.playing) P.announce(`${ch ? ch.title + '. ' : ''}${st.title}. ${st.say.join(' ')}`) }
  }

  // ── a choice among words: the closed dot sits before the chosen one ───────────────────────────────
  type Opt = HTMLElement & { _at?: { x: number; y: number }[] }
  const optIndex = (g: HTMLElement): number => $$('button', g).findIndex((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true')
  function measureOpts(): void {
    for (const g of $$<Opt>('.m-opt', app)) {
      if (g.offsetParent === null) continue
      g._at = $$('button', g).map((b) => ({ x: b.offsetLeft, y: b.offsetTop + Math.round(b.offsetHeight / 2) - 3 }))
      const i = Math.max(0, optIndex(g))
      $$('button', g).forEach((b, k) => { b.tabIndex = k === i ? 0 : -1 })
      placeDot(g, -1, i, 1)
    }
  }
  /** To a neighbour the dot slides; further away it scales out where it was and in where it is going, so it never passes through a word. */
  function placeDot(g: Opt, from: number, to: number, p: number): void {
    const at = g._at, dot = g.querySelector<HTMLElement>('.m-opt-dot')
    if (!at || !dot) return
    fade(dot, to < 0 || !at[to] ? 0 : 1)
    if (to < 0 || !at[to]) return
    if (from < 0 || from === to || RM || p >= 1 || !at[from]) { place(dot, at[to]!.x + 1, at[to]!.y); return }
    if (Math.abs(from - to) === 1 && Math.abs(at[from]!.y - at[to]!.y) < 2) { place(dot, lerp(at[from]!.x, at[to]!.x, move(p)) + 1, at[to]!.y); return }
    if (p < 0.5) place(dot, at[from]!.x + 1, at[from]!.y, ` scale(${(1 - span(p, 0, 0.45)).toFixed(3)})`)
    else place(dot, at[to]!.x + 1, at[to]!.y, ` scale(${span(p, 0.55, 1).toFixed(3)})`)
  }
  /** Mark the chosen word of a choice and send its dot there (160 ms). */
  function choose(g: HTMLElement, index: number): void {
    const from = optIndex(g), bs = $$('button', g), attr = bs[0]?.hasAttribute('aria-selected') ? 'aria-selected' : 'aria-checked'
    bs.forEach((b, k) => { b.setAttribute(attr, String(k === index)); b.tabIndex = k === index || (index < 0 && k === 0) ? 0 : -1 })
    const id = 'dot:' + (g.dataset.g ?? '')
    ;(g as Opt & { _from?: number })._from = from
    run.to(id, 1, ms(D.dot), { from: 0, full: true })
  }
  P.x.choose = choose
  P.x.ghost = (t: number | null): void => { if (ghostT !== t) { ghostT = t; run.kick() } }
  P.x.measureOpts = measureOpts
  app.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement, g = t.closest?.('.m-opt') as HTMLElement | null
    if (!g || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
    const bs = $$('button', g), d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1, n = bs[(bs.indexOf(t as HTMLButtonElement) + d + bs.length) % bs.length]
    e.preventDefault()
    e.stopPropagation()
    if (n) { n.focus(); n.click() }
  })

  // ── layout: measured once per window size ────────────────────────────────────────────────────────
  function layout(): void {
    const cs = getComputedStyle(safeProbe)
    const safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 }
    L = P.L = measure(root.clientWidth || innerWidth, root.clientHeight || innerHeight, tokens(), safe)
    const dpr = Math.min(2, devicePixelRatio || 1)
    ink.width = Math.round(L.W * dpr)
    ink.height = Math.round(L.H * dpr)
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0)
    line.style.width = L.W + 'px'
    for (const s of nl.secs) { s.wn = s.num.offsetWidth; s.w = s.name.offsetWidth }
    // the transport's two groups, measured both ways: draw() decides which fits from where the line begins
    const clockEl = $('.m-clock', tpL), edge = (): number => clockEl.offsetLeft + clockEl.offsetWidth
    tpR.classList.remove('tight'); tpL.classList.remove('tight')
    tw.rightFull = tpR.offsetWidth; tw.leftFull = edge()
    tpR.classList.add('tight'); tpL.classList.add('tight')
    tw.rightTight = tpR.offsetWidth; tw.leftTight = edge()
    tw.state = ''
    load.style.width = '240px'
    for (const f of features) f.layout?.()
    applyCaptions()
    measureOpts()
    restage(0)
    draw()
  }

  // ── the stage makes room ─────────────────────────────────────────────────────────────────────────
  const openRight = (): boolean => !!(P.x.note?.open() || P.x.ask?.open() || P.x.share?.open())
  const openLeft = (): boolean => !!(P.x.palette?.open() || P.x.erratum?.open())
  function shownBox(): Box {
    const p = v('stage', 1)
    return stage.from && p < 1 && !RM ? mixBox(stage.from, stage.to, move(p)) : stage.to
  }
  function restage(dur: number): void {
    const free = freeStage(L, { mode: S.mode, right: openRight(), left: openLeft(), sheet: L.phone ? (P.x.note?.sheet?.() ?? 0) : 0 })
    const to = letterbox(free)
    if (to.x === stage.to.x && to.y === stage.to.y && to.width === stage.to.width && to.height === stage.to.height && free.width === stage.free.width && free.height === stage.free.height) return
    const was = shownBox()
    stage.free = free
    stage.to = to
    slot.style.left = free.x + 'px'
    slot.style.top = free.y + 'px'
    slot.style.width = free.width + 'px'
    slot.style.height = free.height + 'px'
    if (dur > 0 && !RM && S.ready) { stage.from = was; run.to('stage', 1, dur, { from: 0, full: true }) } else { stage.from = null; run.set('stage', 1) }
    run.kick()
  }
  function drawStage(): void {
    // the frame is laid out where it is going and carried there from where it was: translate and one uniform scale
    const c = carryBox(shownBox(), stage.to), ox = stage.to.x - stage.free.x, oy = stage.to.y - stage.free.y
    const t = Math.abs(c.scale - 1) < 1e-4 && Math.abs(c.x) < 0.01 && Math.abs(c.y) < 0.01 ? '' : `translate3d(${(c.x + ox * (1 - c.scale)).toFixed(2)}px,${(c.y + oy * (1 - c.scale)).toFixed(2)}px,0) scale(${c.scale.toFixed(5)})`
    if (slot.style.transform !== t) slot.style.transform = t
  }
  function toPage(x: number, y: number): { x: number; y: number } {
    const b = shownBox(), k = b.width / stage.to.width
    return { x: b.x + x * k, y: b.y + y * k }
  }

  // ── the story's clock ────────────────────────────────────────────────────────────────────────────
  function frame(dt: number): void {
    if (S.ready && info.duration > 0) {
      if (warp) {
        const p = v('warp', 1)
        host.seek(lerp(warp.from, warp.to, p))
        if (p >= 1) warp = null
        void host.frame()
      } else if (S.playing && !S.scrubbing) {
        const next = tauNow() + dt * S.speed // the wall clock only chooses the moment; the pixels depend on the moment alone
        if (next >= info.duration - END_EPSILON) {
          if (S.loop || S.mode === 'explore') host.seek(0)
          else { host.seek(info.duration - END_EPSILON); setPlaying(false, true) }
        } else host.seek(next)
        void host.frame() // drawn in this same animation frame, so the playhead and the picture agree
      }
    }
    draw()
  }
  function seek(t: number, o: { cut?: boolean } = {}): void {
    if (!S.ready) return
    const from = tauNow(), to = clamp(t, 0, Math.max(0, info.duration - END_EPSILON))
    const a = locate(info, from), b = locate(info, to)
    const near = a.chapter === b.chapter && Math.abs(to - from) <= WARP_MAX_SECONDS
    if (o.cut || RM || !near || Math.abs(to - from) < 0.05) { warp = null; run.set('warp', 1); host.seek(to); void host.frame() } else {
      // a jump inside a chapter runs the story to the new moment; pressed again on the way it bends to the new target
      const steps = Math.abs(b.step - a.step), again = warp !== null
      warp = { from, to }
      run.to('warp', 1, again ? Math.min(D.warp, D.warpBase + D.warpStep * steps) : D.warp, { from: 0, full: true, ease: again ? (x) => 1 - (1 - x) ** 3 : smooth })
    }
    touch()
    run.kick()
  }
  function stepGo(dir: -1 | 1, chapter = false): void {
    if (!S.ready) return
    const from = P.goal()
    if ((dir < 0 && from < 0.05) || (dir > 0 && from >= info.duration - 0.05)) return
    seek(jumpTarget(info, from, dir, chapter))
  }
  const transportListeners: Array<(playing: boolean, ended: boolean) => void> = []
  function setPlaying(on: boolean, ended = false): void {
    if (!S.ready && on) return
    const was = S.playing
    if (on && tauNow() >= info.duration - 0.05) { warp = null; host.seek(0) } // at the end, play starts again from the beginning
    if (on && S.mode !== 'explore') host.clearParam() // the story drives its parameters again
    S.playing = on
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play')
    run.to('play', on ? 1 : 0, ms(D.play), { ease: linear })
    if (S.voice) document.dispatchEvent(new CustomEvent('mimir:voice', { detail: on })) // a paused story says nothing more
    touch()
    run.kick()
    if (was !== on) for (const fn of transportListeners) fn(on, ended)
  }
  function setSpeed(s: number): void { S.speed = s; setText(speedBtn, speedText(s)); touch() }
  // the engine sets the captions inside its frame; where the frame is too small to read them the player sets them under it (caption.ts)
  const applyCaptions = (): void => void document.dispatchEvent(new CustomEvent('mimir:captions', { detail: S.captions && S.mode === 'video' && !L.ownCaptions }))
  function setCaptions(on: boolean): void { S.captions = on; capBtn.setAttribute('aria-checked', String(on)); applyCaptions(); touch() }
  function setVoice(on: boolean): void { S.voice = on; voiceBtn.setAttribute('aria-checked', String(on)); document.dispatchEvent(new CustomEvent('mimir:voice', { detail: on && S.playing })); touch() }
  function setLoop(on: boolean): void { S.loop = on; loopBtn.setAttribute('aria-checked', String(on)); touch() }
  function toggleFull(): void {
    try { if (document.fullscreenElement) void document.exitFullscreen(); else void root.requestFullscreen?.().catch(() => {}) } catch { /* not allowed here */ }
  }

  // ── modes: two channels, each retargeted from where it is (spec 6, 8.7, 8.8) ───────────────────────
  function setMode(m: Mode): void {
    if (m === S.mode) return
    const was = S.mode
    if (was === 'explore') P.x.explore?.leave()
    S.mode = m
    root.dataset.mMode = m
    choose(modes, ['video', 'read', 'explore'].indexOf(m))
    const cross = was !== 'video' && m !== 'video'
    run.to('read', m === 'read' ? 1 : 0, ms(cross ? (m === 'read' ? D.cross - 140 : 160) : m === 'read' ? D.read : D.readBack), { turn: true, delay: cross && m === 'read' && !RM ? 140 : 0 })
    run.to('explore', m === 'explore' ? 1 : 0, ms(cross ? (m === 'explore' ? D.cross - 140 : 160) : m === 'explore' ? D.explore : D.exploreBack), { turn: true, delay: cross && m === 'explore' && !RM ? 140 : 0 })
    applyCaptions()
    if (m === 'explore') P.x.explore?.enter()
    if (m === 'read') P.x.read?.follow(true)
    restage(Math.round((m === 'read' ? D.read : was === 'read' ? D.readBack : m === 'explore' ? D.explore : D.exploreBack) * (L.stack ? READ.stageStacked : READ.stage)))
    P.announce(m === 'video' ? 'Watch' : m === 'read' ? 'Read' : 'Explore')
    touch()
  }

  // ── wake: the chrome sleeps while the film plays (spec 8.6) ────────────────────────────────────────
  const anyOpen = (): boolean => features.some((f) => f.open?.())
  // a short window gives its foot to one thing at a time, so there the chrome sleeps even when paused and in every mode
  const awake = (): boolean => !S.ready || (!S.playing && !L.short) || (S.mode !== 'video' && !L.short) || S.scrubbing || overChrome || anyOpen() || performance.now() - lastInput < D.idle || (app.contains(document.activeElement) && (document.activeElement as HTMLElement).matches?.(':focus-visible'))
  function touch(): void {
    lastInput = performance.now()
    clearTimeout(sleepTimer)
    sleepTimer = setTimeout(() => void run.kick(), D.idle + 30) as unknown as number
    run.kick()
  }
  function invoker(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null
    return a && a !== document.body && a.matches(':focus-visible') ? a : null
  }
  function refocus(node: HTMLElement | null | undefined, fallback?: HTMLElement | null): void {
    const n = node && node.isConnected && node.offsetParent !== null ? node : fallback
    if (n) n.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur?.()
  }
  function setHover(id: string | null, from = ''): void {
    if (S.hover === id) return
    S.hover = id
    S.hoverFrom = from
    if (from !== 'stage') host.hover?.(id) // the stage lights what is under its own pointer
    run.kick()
  }

  // ── draw: one function turns state and channels into pixels ────────────────────────────────────────
  let wasAwake = true
  function draw(): void {
    const state = host.state(), T = state.tau
    const up = awake()
    if (up !== wasAwake) { wasAwake = up; run.to('wake', up ? 1 : 0, up ? D.wake : D.sleep, { ease: linear }) }
    const wake = v('wake', 1), dim = 1 - (1 - DIMMED) * Math.max(v('dim'), v('error')), on = wake * dim
    const asleep = run.target('wake', 1) < 0.5, held = v('error') > 0.5
    reach([top, line, tpL, tpR], !asleep && !held)
    root.classList.toggle('nocur', asleep && S.playing)
    fade(top, on)
    fade(ttl, 1 - span(v('read'), 0, READ.title))
    fade(load, S.ready ? 0 : 1)
    if (!S.ready) { place(load, Math.round(L.W / 2 - 120), Math.round(L.H / 2 - 20)); const k = (performance.now() / 1100) % 1; ($('.bar i', load)).style.transform = `translateX(${(k * 200 - 100).toFixed(1)}%)` }
    drawStage()
    drawLine(T, S.ready ? on : 0)
    for (const g of $$<Opt & { _from?: number }>('.m-opt', app)) { const id = 'dot:' + (g.dataset.g ?? ''); if (g._at) placeDot(g, g._from ?? -1, optIndex(g), v(id, 1)) }
    for (const f of features) f.draw?.(T, state)
    ictx.clearRect(0, 0, L.W, L.H)
    for (const f of features) f.ink?.(ictx)
    // a layer takes the focus when it opens: in the first frame in which what it holds can be reached
    if (wantFocus) {
      const { node, until } = wantFocus
      if (node.isConnected && !node.closest('[inert]') && getComputedStyle(node).visibility !== 'hidden') { node.focus({ preventScroll: true }); wantFocus = null } else if (performance.now() > until) wantFocus = null
      else run.kick()
    }
  }
  run.keepAlive(() => (S.playing && S.ready) || !S.ready || features.some((f) => f.alive?.()))

  // ── input ────────────────────────────────────────────────────────────────────────────────────────
  const act: Record<string, (e: MouseEvent) => void> = {
    play: () => setPlaying(!S.playing),
    prev: (e) => stepGo(-1, e.shiftKey),
    next: (e) => stepGo(1, e.shiftKey),
    speed: () => setSpeed(nextSpeed(S.speed, 1, true)),
    captions: () => setCaptions(!S.captions),
    voice: () => setVoice(!S.voice),
    loop: () => setLoop(!S.loop),
    full: () => toggleFull(),
    ask: () => P.x.ask?.toggle(),
    share: () => P.x.share?.toggle(),
    palette: () => P.x.palette?.toggle(),
    more: () => P.x.palette?.toggle(),
  }
  app.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
    if (b && b.getAttribute('aria-disabled') !== 'true') act[b.dataset.a!]?.(e)
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')
    if (m) setMode(m.dataset.mode as Mode)
  })
  for (const n of [top, line, tpL, tpR]) {
    n.addEventListener('pointerenter', () => { overChrome = true; touch() })
    n.addEventListener('pointerleave', () => { overChrome = false; touch() })
  }
  // the line: drag scrubs in the same frame; a tick takes hold within a few px (Alt lets go)
  let resume = false
  const scrubTo = (e: PointerEvent): void => {
    const t = lineT(e.clientX)
    warp = null
    host.seek(e.altKey ? t : magnet(ticks, t, info.duration, geom.w))
    void host.frame()
    run.kick()
  }
  line.addEventListener('pointerdown', (e) => {
    if (e.button || !S.ready) return
    try { line.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
    S.scrubbing = true
    resume = S.playing
    scrubTo(e)
    e.preventDefault()
  })
  line.addEventListener('pointermove', (e) => { if (S.scrubbing) scrubTo(e); hoverT = lineT(e.clientX); touch() })
  const lineUp = (): void => { if (!S.scrubbing) return; S.scrubbing = false; if (S.mode === 'read') P.x.read?.follow(true); if (!resume && S.playing) setPlaying(false); touch() }
  line.addEventListener('pointerup', lineUp)
  line.addEventListener('pointercancel', lineUp)
  line.addEventListener('pointerleave', () => { hoverT = null; run.kick() })
  line.addEventListener('keydown', (e) => {
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowDown') { if (e.shiftKey) stepGo(-1, true); else seek(P.goal() - NUDGE_SECONDS, { cut: true }) }
    else if (k === 'ArrowRight' || k === 'ArrowUp') { if (e.shiftKey) stepGo(1, true); else seek(P.goal() + NUDGE_SECONDS, { cut: true }) }
    else if (k === 'PageUp') stepGo(-1)
    else if (k === 'PageDown') stepGo(1)
    else if (k === 'Home') seek(0)
    else if (k === 'End') seek(info.duration)
    else return
    e.preventDefault()
    e.stopPropagation()
  })

  // the stage: a click on the empty stage plays and pauses, a click on a part opens its note (spec 7.18)
  let down: { x: number; y: number; woke: boolean } | null = null
  const stagePoint = (e: MouseEvent): { x: number; y: number } => { const b = shownBox(), k = stage.to.width / b.width; return { x: (e.clientX - b.x) * k, y: (e.clientY - b.y) * k } }
  slot.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, woke: e.pointerType === 'touch' && run.target('wake', 1) < 0.5 }; touch() })
  slot.addEventListener('click', (e) => {
    const was = down
    down = null
    if (!S.ready || !was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 6) return // a drag turned the model: not a click
    if (was.woke) return // a tap on a sleeping film only wakes it
    const p = stagePoint(e), hit = P.owner(host.pick(p.x, p.y))
    if (hit) { P.x.note?.show(hit.id); return }
    if (P.x.note?.open()) { P.x.note.hide(); return }
    if (S.mode === 'video') setPlaying(!S.playing)
  })
  let moveRaf = 0
  slot.addEventListener('pointermove', (e) => {
    touch()
    if (moveRaf || e.buttons) return
    moveRaf = requestAnimationFrame(() => { moveRaf = 0; if (!S.ready) return; const p = stagePoint(e); setHover(P.owner(host.pick(p.x, p.y))?.id ?? null, 'stage') })
  })
  slot.addEventListener('pointerleave', () => { if (S.hoverFrom === 'stage') setHover(null, 'stage') })
  root.addEventListener('pointermove', touch, { passive: true })
  root.addEventListener('touchstart', touch, { passive: true })
  root.addEventListener('focusin', touch)

  let heldAt = 0
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return
    if (P.x.home?.active()) return // the prompt page has its own keys
    const k = e.key, mod = e.metaKey || e.ctrlKey
    touch()
    if (mod && k.toLowerCase() === 'k') { e.preventDefault(); P.x.palette?.toggle(); return }
    if (k === 'Escape') { if (!typing(e.target) && escape()) e.preventDefault(); return }
    if (k === 'Tab') return // waking is enough: the focus then lands on the first control
    if (mod || e.altKey || typing(e.target) || P.x.palette?.open() || P.x.erratum?.open()) return
    const explore = S.mode === 'explore'
    const stop = (): void => { e.preventDefault() }
    if (k === ' ' || k === 'k' || k === 'K') { if (k === ' ' && (e.target as HTMLElement).closest?.('button, [role=slider], a')) return; stop(); setPlaying(!S.playing) }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if ((e.target as HTMLElement).closest?.('.m-opt, input, [role=slider], .m-index, [role=menu]')) return
      stop()
      const now = performance.now()
      if (e.repeat && now - heldAt < D.held) return // a held key steps at a pace
      heldAt = now
      stepGo(k === 'ArrowLeft' ? -1 : 1, e.shiftKey)
    }
    else if (k === 'j' || k === 'J') seek(P.goal() - SKIP_SECONDS, { cut: true })
    else if (k === 'l' || k === 'L') seek(P.goal() + SKIP_SECONDS, { cut: true })
    else if (/^[1-9]$/.test(k) && !e.shiftKey) { const s = sections[Number(k) - 1]; if (s) seek(s.t0) }
    else if (k === '0') { host.setView(null); seek(0) }
    else if (k === 'Home') seek(0)
    else if (k === 'End') seek(info.duration)
    else if (k === '[') setSpeed(nextSpeed(S.speed, -1))
    else if (k === ']') setSpeed(nextSpeed(S.speed, 1))
    else if (k === 'c' || k === 'C') setCaptions(!S.captions)
    else if (k === 'm' || k === 'M') setVoice(!S.voice)
    else if (k === 'o' || k === 'O') setLoop(!S.loop)
    else if (k === 'f' || k === 'F') toggleFull()
    else if (k === 'v' || k === 'V') setMode('video')
    else if (k === 'r' || k === 'R') setMode('read')
    else if (k === 'e' || k === 'E') setMode('explore')
    else if (k === 's' || k === 'S') P.x.share?.toggle()
    else if (k === 'a' || k === 'A') { if (P.x.ask?.available()) { stop(); P.x.ask.toggle(true) } }
    else if (k === '/') { stop(); P.x.explore?.find() }
    else if (k === '?') { stop(); P.x.palette?.toggle(true) }
    else if (explore && P.x.explore?.key(e)) stop()
  }
  /** Esc closes the top layer, then the note; then puts the view back. True when it did something. */
  function escape(): boolean {
    for (const name of ['palette', 'erratum', 'share', 'ask', 'note']) if (P.x[name]?.open()) { P.x[name].hide(); return true }
    if (host.state().userView) { host.setView(null); return true }
    return false
  }
  window.addEventListener('keydown', onKey)
  const onResize = (): void => layout()
  window.addEventListener('resize', onResize)
  document.addEventListener('fullscreenchange', onResize)
  const onHide = (): void => { try { sessionStorage.setItem(KEEP_KEY, JSON.stringify({ scene: query.get('scene'), mode: S.mode, playing: S.playing, speed: S.speed, captions: S.captions, voice: S.voice, loop: S.loop })) } catch { /* no storage */ } }
  window.addEventListener('pagehide', onHide)

  // ── start ────────────────────────────────────────────────────────────────────────────────────────
  root.dataset.mMode = S.mode
  buildLine()
  setText(speedBtn, speedText(S.speed))
  capBtn.setAttribute('aria-checked', String(S.captions))
  loopBtn.setAttribute('aria-checked', String(S.loop))
  run.set('wake', 1).set('stage', 1).set('warp', 1).set('read', S.mode === 'read' ? 1 : 0).set('explore', S.mode === 'explore' ? 1 : 0).set('play', 0)
  $$('button', modes).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)))
  const offReady = host.on('ready', () => {
    info = P.info = host.info()
    P.parts = meta2().parts
    P.listed = P.parts.filter((p) => p.listed)
    buildLine()
    S.ready = true
    P.x.onReady?.()
    S.voice = keep.voice ?? !!(info as { guide?: { voice?: boolean } }).guide?.voice
    voiceBtn.setAttribute('aria-checked', String(S.voice))
    applyCaptions()
    layout()
    // fonts that arrive after the first layout change every measured width
    void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => layout())
    if (S.mode === 'explore') P.x.explore?.enter()
    // the film starts by itself (never under reduced motion, never over a scene error, never when the address says not to, the reader had paused it before a refresh, or the dev server has just reloaded the page)
    // the host's verdict (info().autoplay: the address, the 'viewer.autoplay' setting) holds; a page opened AT a moment (t=, step=) stays there unless the reader was playing when they refreshed it
    const moment = query.get('t') !== null || query.get('step') !== null
    const allowed = moment ? keep.playing === true : (info as { autoplay?: boolean }).autoplay !== false
    const wants = query.get('play') !== '0' && query.get('autoplay') !== '0' && allowed && keep.playing !== false && !held && !RM && !info.fatal && info.problems.errors === 0 && info.duration > 0
    if (wants) setPlaying(true)
    touch()
  })
  const offFrame = host.on('frame', () => void run.kick())
  const offParams = host.on('params', () => void run.kick())
  layout()
  run.kick()

  return {
    player: P, slot,
    // the player's clock is the page's clock: the host's play / pause / playing speak for it (PlayerInstance.transport)
    transport: {
      get playing() { return S.playing },
      get speed() { return S.speed },
      play(o: { speed?: number } = {}) { if (typeof o.speed === 'number' && o.speed > 0) setSpeed(o.speed); setPlaying(true) },
      pause() { setPlaying(false) },
      onChange(fn: (playing: boolean, ended: boolean) => void) { transportListeners.push(fn) },
      pausesOnParam: () => S.mode !== 'explore',
    },
    dispose() {
      run.stop()
      clearTimeout(sleepTimer)
      offReady(); offFrame(); offParams()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onResize)
      window.removeEventListener('pagehide', onHide)
      for (const f of features) f.dispose?.()
      root.remove()
    },
  }
}
