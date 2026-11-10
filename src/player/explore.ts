// Explore (UI design specification 7.8 to 7.10): the scene's parameters as number lines, switches and choices, the view and
// the camera of a 3D scene, and the parts as a list you can search. Everything is generated from the manifest: a
// scene with no parameters has no parameters panel, a 2D scene has no view, a scene that names nothing has no list.
import type { ParamInfo } from '../host/index.ts'
import type { Player } from './app.ts'
import { $, $$, button, el, ICON, key } from './dom.ts'
import type { PartMeta } from './index.ts'
import { clamp, D, fade, lerp, move, place, reach, setText, smooth, span, wipe } from './motion.ts'
import { decimalsOf, escapeHtml, fuzzy, nearest, numberText, sliderStep, snapParam } from './story.ts'

/** ms a view mode takes from a control, [on, off], by the look's channel (spec 8.12); any other look takes the default */
export const LOOK_MS: Record<string, readonly [number, number]> = { explode: [D.explodeOut, D.explodeBack], ghost: [D.ghost, D.ghost], cutaway: [D.section, D.section] }
export const LOOK_MS_DEFAULT: readonly [number, number] = [D.section, D.section]
/** the named views a camera choice offers, in this order, when the engine has them */
export const CAMERAS = ['front', 'side', 'top', 'iso'] as const
/** a finger takes hold of a track after this much sideways travel (px), so a swipe that starts on a row scrolls the list */
export const TOUCH_HOLD_PX = 6
/** keys that already mean something everywhere: a view mode takes the first letter of its name that is not one of these */
const TAKEN = 'kjlcmofvresa'
type Pose = { target: [number, number, number]; azimuth: number; elevation: number; distance: number; fov: number }

export function mountExplore(P: Player): void {
  const host = P.host
  const index = el('section', 'm-abs m-index', `<label class="m-line">${ICON.find}<input type="text" placeholder="Find a part" autocomplete="off" spellcheck="false" aria-label="Find a part"><span class="cnt"></span>${key('/')}</label><div class="roll"><div><ol aria-label="Parts"></ol></div></div>`)
  index.setAttribute('aria-label', 'Parts')
  const given = el('section', 'm-abs m-given', '<div class="roll"><div class="gv"><div class="gv-p" aria-label="Parameters"></div><div class="gv-v" aria-label="View"></div></div></div>')
  given.setAttribute('aria-label', 'Parameters and view')
  const tabs = el('div', 'm-abs m-opt m-tabs', '<i class="m-opt-dot"></i>')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Explore')
  tabs.dataset.g = 'tabs'
  const hint = el('p', 'm-abs m-hint')
  P.app.append(index, given, tabs, hint)
  const find = $<HTMLInputElement>('input', index), cnt = $('.cnt', index), list = $<HTMLOListElement>('ol', index), gvP = $('.gv-p', given), gvV = $('.gv-v', given)
  const idxRoll = $('.roll', index), gvRoll = $('.roll', given)
  let tab = 'params', params: ParamInfo[] = [], rows: { p: ParamInfo; sync(v: unknown, mine: boolean): void }[] = []
  let viewG: HTMLElement | null = null, camG: HTMLElement | null = null, view = 'story', cam: string | null = null
  const looks = (): { channel: string; label: string }[] => (typeof host.setLook === 'function' ? P.info.looks ?? [] : [])
  const lookKey = (label: string): string => [...label.toLowerCase()].find((c) => /[a-z]/.test(c) && !TAKEN.includes(c)) ?? ''
  let camMove: { from: Pose; to: Pose; name: string | null } | null = null
  const resets = new Map<string, { from: number; to: number }>()

  // ── parameters ───────────────────────────────────────────────────────────────────────────────────
  const valueHtml = (p: ParamInfo, val: number): string => `${numberText(val, decimalsOf(p))}${p.unit ? `<i${/^[^\p{L}\d]+$/u.test(p.unit) ? ' class="tight"' : ''}>${escapeHtml(p.unit)}</i>` : ''}`
  function paramRow(p: ParamInfo): HTMLElement {
    const row = el('div', 'm-param')
    const d = decimalsOf(p)
    row.innerHTML = `<div class="hd"><span class="nm"></span><button type="button" class="rs">reset</button><span class="vl m-num"></span></div><div class="ln"><span class="lo">${numberText(p.min, d)}</span><span class="tr"><input type="range" min="${p.min}" max="${p.max}" step="${sliderStep(p)}" tabindex="0"><i class="ax"></i><i class="c0"></i><i class="c1"></i><i class="lt"></i><i class="df"></i><i class="dt"></i></span><span class="hi">${numberText(p.max, d)}</span></div>`
    $('.nm', row).textContent = p.label
    const input = $<HTMLInputElement>('input', row), tr = $('.tr', row), vl = $('.vl', row), lt = $('.lt', row), dt = $('.dt', row), df = $('.df', row), rs = $('.rs', row)
    input.setAttribute('aria-label', p.label)
    rs.setAttribute('aria-label', `Give ${p.label} back to the story`)
    const range = Math.max(1e-9, p.max - p.min)
    const set = (val: number): void => host.setParam(p.name, val)
    input.addEventListener('input', () => set(Number(input.value)))
    const at = (ev: PointerEvent): number => { const r = tr.getBoundingClientRect(); return snapParam(p, p.min + clamp((ev.clientX - r.left) / r.width) * range, ev.altKey) }
    // Only the track drags. A mouse takes hold at once; a finger after a few px of sideways travel, so a swipe that
    // starts on a row scrolls the list instead of changing a value.
    let drag: { x: number; y: number; on: boolean } | null = null
    const hold = (ev: PointerEvent): void => { drag!.on = true; try { tr.setPointerCapture(ev.pointerId) } catch { /* gone */ } P.S.dragging = true; dimRow = row; P.run.to('dim', 1, P.ms(D.dim)); set(at(ev)) }
    tr.addEventListener('pointerdown', (ev) => { if (ev.button) return; drag = { x: ev.clientX, y: ev.clientY, on: false }; if (ev.pointerType !== 'touch') { hold(ev); ev.preventDefault() } })
    tr.addEventListener('pointermove', (ev) => {
      if (!drag) return
      if (!drag.on) { const dx = Math.abs(ev.clientX - drag.x), dy = Math.abs(ev.clientY - drag.y); if (dy > 8 && dy > dx) { drag = null; return } if (dx < TOUCH_HOLD_PX) return; hold(ev) }
      set(at(ev))
    })
    const up = (ev: PointerEvent): void => { if (!drag) return; const was = drag; drag = null; if (was.on) { P.S.dragging = false; P.run.to('dim', 0, P.ms(D.undim)) } else if (ev.type === 'pointerup') set(at(ev)) } // a tap on the track sets the value there
    tr.addEventListener('pointerup', up)
    tr.addEventListener('pointercancel', up)
    rs.addEventListener('click', () => reset(p))
    let was = NaN, wasMine: boolean | null = null, w = 0
    rows.push({ p, sync(value, mine) {
      const val = Number(value)
      if (mine !== wasMine) { wasMine = mine; row.classList.toggle('off', mine) }
      if (val === was && w) return
      if (!w) w = tr.clientWidth
      if (!w) return
      was = val
      const u = clamp((val - p.min) / range)
      vl.innerHTML = valueHtml(p, val)
      input.value = String(val)
      lt.style.transform = `scaleX(${u.toFixed(4)})`
      place(dt, u * w, 0)
      place(df, clamp((Number(p.value) - p.min) / range) * w, 0)
    } })
    ;(row as HTMLElement & { _remeasure?: () => void })._remeasure = () => { w = 0; was = NaN }
    return row
  }
  /** `reset` gives a parameter back to the story: the value eases to where the story has it, and the scene follows. */
  function reset(p: ParamInfo): void {
    const from = Number(host.state().params[p.name])
    host.clearParam(p.name)
    const to = Number(host.state().params[p.name])
    if (P.RM || !Number.isFinite(from) || !Number.isFinite(to) || from === to) return
    host.setParam(p.name, from)
    resets.set(p.name, { from, to })
    P.run.to('reset:' + p.name, 1, D.reset, { from: 0, full: true, done: () => { resets.delete(p.name); host.clearParam(p.name) } })
  }
  function switchRow(label: string, title = ''): HTMLButtonElement {
    const b = button('m-switch rw', '<span class="nm"></span><i class="st"></i><span class="tr"></span>', { role: 'switch', 'aria-checked': 'false' })
    $('.nm', b).textContent = label
    if (title) b.title = title
    return b
  }
  function choice(name: string, items: [string, string, string?][], pick: (id: string) => void): HTMLElement {
    const g = el('div', 'm-opt wide', '<i class="m-opt-dot"></i>')
    g.setAttribute('role', 'radiogroup')
    g.setAttribute('aria-label', name)
    g.dataset.g = 'x-' + name.toLowerCase().replace(/\W+/g, '-')
    for (const [id, label, k] of items) {
      const b = button('', '', { role: 'radio', 'aria-checked': 'false' })
      b.textContent = label
      b.dataset.v = id
      if (k) b.title = `${label} (${k.toUpperCase()})`
      b.addEventListener('click', () => pick(id))
      g.appendChild(b)
    }
    return g
  }
  const group = (name: string): HTMLElement => { const box = el('div', 'gv-g'); const gn = el('i', 'gn'); gn.textContent = name; box.appendChild(gn); return box }
  let dimRow: HTMLElement | null = null, hintW = 0

  function buildGiven(): void {
    gvP.textContent = ''
    gvV.textContent = ''
    rows = []
    params = P.info.params.filter((p) => !p.hidden)
    const groups = new Map<string, ParamInfo[]>()
    for (const p of params) { const g = p.group || 'Given'; groups.set(g, [...(groups.get(g) ?? []), p]) }
    for (const [name, ps] of groups) {
      const box = group(name)
      for (const p of ps.filter((x) => x.kind === 'number')) box.appendChild(paramRow(p)) // lines first, then choices, then switches
      for (const p of ps.filter((x) => x.kind === 'choice')) {
        const wrap = el('div', 'pick'), lbl = el('span', 'lbl')
        lbl.textContent = p.label
        const g = choice(p.label, p.options.map((o) => [o, o]), (id) => { host.setParam(p.name, id) })
        wrap.append(lbl, g)
        box.appendChild(wrap)
        rows.push({ p, sync(value) { const i = p.options.indexOf(String(value)); if (g.dataset.i !== String(i)) { g.dataset.i = String(i); P.x.choose(g, i) } } })
      }
      for (const p of ps.filter((x) => x.kind === 'toggle')) {
        const b = switchRow(p.label)
        b.addEventListener('click', () => { host.setParam(p.name, b.getAttribute('aria-checked') !== 'true') })
        box.appendChild(b)
        rows.push({ p, sync(value) { const on = String(!!value); if (b.getAttribute('aria-checked') !== on) b.setAttribute('aria-checked', on) } })
      }
      gvP.appendChild(box)
    }
    viewG = camG = null
    if (P.info.has3d) {
      const ls = looks()
      if (ls.length) {
        const vg = group('View')
        viewG = choice('View', [['story', 'Story'], ['solid', 'Solid'], ...ls.map((l): [string, string, string] => [l.channel, l.label, lookKey(l.label)])], setView)
        vg.appendChild(viewG)
        gvV.appendChild(vg)
      }
      const names = CAMERAS.filter((c) => P.info.views.includes(c))
      if (names.length) {
        const cg = group('Camera')
        camG = choice('Camera', [['story', 'Story'], ...names.map((c, i): [string, string, string] => [c, c[0]!.toUpperCase() + c.slice(1), `⇧${i + 1}`])], (id) => setCam(id === 'story' ? null : id))
        cg.appendChild(camG)
        gvV.appendChild(cg)
      }
    }
    syncChoices()
  }
  function syncChoices(): void {
    if (viewG) { const i = $$('button', viewG).findIndex((b) => b.dataset.v === view); if (viewG.dataset.i !== String(i)) { viewG.dataset.i = String(i); P.x.choose(viewG, i) } }
    if (camG) {
      const i = host.state().userView && !camMove ? -1 : $$('button', camG).findIndex((b) => b.dataset.v === (cam ?? 'story'))
      if (camG.dataset.i !== String(i)) { camG.dataset.i = String(i); P.x.choose(camG, i) }
    }
  }

  // ── view and camera: one choice each, eased from where the scene is ────────────────────────────────
  const pinned = new Set<string>()
  function setView(name: string): void {
    view = name
    for (const l of looks()) {
      const key = 'look:' + l.channel, [on, off] = LOOK_MS[l.channel] ?? LOOK_MS_DEFAULT
      if (name === 'story') { pinned.delete(l.channel); P.run.set(key, 0); host.setLook(l.channel, null); continue }
      const to = name === l.channel ? 1 : 0
      if (!pinned.has(l.channel)) { pinned.add(l.channel); P.run.set(key, 0); host.setLook(l.channel, 0) }
      P.run.to(key, to, P.RM ? 0 : to ? on : off, { ease: smooth })
    }
    syncChoices()
    P.touch()
  }
  const mixPose = (a: Pose, b: Pose, t: number): Pose => ({
    target: [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)],
    azimuth: a.azimuth + (((((b.azimuth - a.azimuth) % 360) + 540) % 360) - 180) * t, elevation: lerp(a.elevation, b.elevation, t),
    distance: a.distance * Math.exp(Math.log(b.distance / a.distance) * t), fov: b.fov,
  })
  function setCam(name: string | null): void {
    cam = name
    const from = host.camera?.() as Pose | null | undefined
    host.setView(name)
    const to = host.camera?.() as Pose | null | undefined
    if (from && to && !P.RM) { camMove = { from, to, name }; host.setView(from); P.run.to('cam', 1, D.camera, { from: 0, full: true, ease: smooth, done: () => { if (camMove) { host.setView(camMove.name); camMove = null } } }) }
    syncChoices()
    P.touch()
  }

  // ── the parts ────────────────────────────────────────────────────────────────────────────────────
  function buildIndex(q = ''): void {
    list.textContent = ''
    const all = P.listed
    const hits = all.map((p) => ({ p, at: fuzzy(q, p.name) })).filter((h) => h.at)
    setText(cnt, q.trim() ? `${hits.length} of ${all.length}` : String(all.length))
    if (!hits.length && q.trim()) {
      const near = nearest(q, all.map((p) => p.name)), li = el('li', 'none')
      li.append(`No part called “${q.trim()}”.`)
      if (near) { const b = button('', ''); b.textContent = near; b.addEventListener('click', () => { find.value = near; buildIndex(near) }); li.append(' Nearest: ', b) }
      list.appendChild(li)
      return
    }
    let last: string | null = null
    hits.forEach(({ p, at }, i) => {
      const li = el('li')
      if (p.group !== last) { if (i > 0) li.classList.add('gap'); if (p.group) { const g = el('i', 'grp'); g.textContent = p.group; li.appendChild(g) } last = p.group }
      const b = button('row', '<i class="sw"></i><span class="lb"></span>')
      b.dataset.part = p.id
      b.tabIndex = i === 0 ? 0 : -1
      if (p.color) $('.sw', b).style.setProperty('--c', p.color)
      const marks = new Set(at), lb = $('.lb', b)
      lb.innerHTML = [...p.name].map((ch, k) => (marks.has(k) ? `<b>${escapeHtml(ch)}</b>` : escapeHtml(ch))).join('')
      b.addEventListener('pointerenter', () => P.setHover(p.id, 'index'))
      b.addEventListener('pointerleave', () => { if (P.S.hoverFrom === 'index') P.setHover(null, 'index') })
      b.addEventListener('focus', () => P.setHover(p.id, 'index'))
      b.addEventListener('click', () => P.x.note?.show(p.id, b))
      li.appendChild(b)
      list.appendChild(li)
    })
  }
  find.addEventListener('input', () => buildIndex(find.value))
  find.addEventListener('keydown', (e) => {
    // the first Esc clears what was typed, the second leaves the field; Enter opens the first match only when something is typed
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (find.value) { find.value = ''; buildIndex() } else find.blur() }
    else if (e.key === 'Enter' && find.value.trim()) { const first = list.querySelector<HTMLElement>('.row'); if (first) first.click() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector<HTMLElement>('.row')?.focus() }
  })
  // the list is one tab stop: arrows move within it, Up from the first row returns to the field
  list.addEventListener('keydown', (e) => {
    const rs = $$('.row', list), i = rs.indexOf(e.target as HTMLElement)
    if (i < 0) return
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    e.stopPropagation()
    if (to < 0) { find.focus(); return }
    const n = rs[Math.min(to, rs.length - 1)]
    if (n) { rs.forEach((r) => { r.tabIndex = r === n ? 0 : -1 }); n.focus() }
  })

  // ── tabs: when the columns cannot stand either side of the stage ───────────────────────────────────
  function buildTabs(): void {
    tabs.textContent = ''
    tabs.appendChild(el('i', 'm-opt-dot'))
    const have: [string, string][] = []
    if (params.length) have.push(['params', 'Parameters'])
    if (gvV.children.length) have.push(['view', 'View'])
    if (P.listed.length) have.push(['parts', 'Parts'])
    if (!have.some(([id]) => id === tab)) tab = have[0]?.[0] ?? 'params'
    for (const [id, label] of have) {
      const b = button('', '', { role: 'tab', 'aria-selected': String(id === tab) })
      b.textContent = label
      b.dataset.tab = id
      b.addEventListener('click', () => setTab(id))
      tabs.appendChild(b)
    }
    tabs.hidden = have.length < 2
  }
  function setTab(id: string): void {
    tab = id
    given.dataset.tab = id
    P.x.choose(tabs, $$('button', tabs).findIndex((b) => b.dataset.tab === id))
    P.redraw()
  }

  buildGiven()
  buildIndex()
  buildTabs()
  P.x.explore = {
    enter() { view = 'story'; cam = null; syncChoices() },
    /** leaving explore returns to the story as it is told: its parameters, its view, its camera */
    leave() {
      host.clearParam()
      for (const c of pinned) { host.setLook(c, null); P.run.set('look:' + c, 0) }
      pinned.clear()
      camMove = null
      host.setView(null)
      view = 'story'
      cam = null
      syncChoices()
      P.setHover(null, 'index')
    },
    find() { if (!P.listed.length) return; if (P.S.mode !== 'explore') P.setMode('explore'); if (P.L.exTabs) setTab('parts'); find.focus() },
    key(e: KeyboardEvent): boolean {
      const k = e.key.toLowerCase()
      if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) { const c = CAMERAS.filter((x) => P.info.views.includes(x))[Number(e.code.slice(5)) - 1]; if (c && camG) { setCam(c); return true } return false }
      const l = looks().find((x) => lookKey(x.label) === k)
      if (l) { setView(view === l.channel ? 'solid' : l.channel); return true }
      return false
    },
    setView, setCam, looks, lookKey, view: () => view, cam: () => cam, cameras: (): string[] => CAMERAS.filter((c) => P.info.views.includes(c)), rebuild() { buildGiven(); buildIndex(find.value); buildTabs(); P.relayout() },
  }
  P.add({
    layout() {
      const L = P.L
      index.classList.toggle('flat', L.exTabs)
      P.root.style.setProperty('--gutter-idx', L.idxGutter + 'px')
      given.classList.toggle('tabs', L.exTabs)
      given.dataset.tab = tab
      const top = L.exStack ? L.exBottom + 12 : L.yTabs, body = top + (tabs.hidden ? 0 : 44)
      if (L.exTabs) {
        place(tabs, L.idxX, top)
        index.style.width = given.style.width = L.idxW + 'px'
        index.style.height = given.style.height = Math.max(80, L.exFoot - body) + 'px'
        place(index, L.idxX, body)
        place(given, L.idxX, body)
      } else {
        index.style.width = L.idxW + 'px'
        index.style.height = Math.max(80, L.exFoot - L.yLine) + 'px'
        place(index, L.mx, L.yLine)
        given.style.width = L.noteW + 'px'
        given.style.height = Math.max(80, L.exFoot - L.yGiven) + 'px'
        place(given, L.noteX, L.yGiven)
      }
      for (const row of $$<HTMLElement & { _remeasure?: () => void }>('.m-param', given)) row._remeasure?.()
      for (const b of $$('.m-switch', given)) b.classList.toggle('tight', L.noteW < 300 && !L.phone)
      hintW = Math.round(Math.min(880 * L.k, L.W - 2 * L.mx))
      hint.style.width = hintW + 'px'
    },
    draw(_tau, state) {
      const L = P.L, x = P.v('explore'), on = P.run.target('explore') > 0.5, noteUp = !!P.x.note?.open() && !L.phone
      // the index unrolls from its search line and the givens from the top of their column, once the stage has made room
      const o = P.RM ? x : span(x, 0.19, 0.42), roll = P.RM ? 1 : move(span(x, 0.19, 0.67))
      const dim = 1 - 0.65 * Math.max(P.v('error'), 0)
      const showIdx = !L.exTabs || tab === 'parts', showGiven = !L.exTabs || tab !== 'parts'
      const right = noteUp ? 1 - span(P.v('note'), 0, 0.3) : 1 // a note takes the right column until it closes
      fade(index, o * (showIdx ? 1 : 0) * (L.exTabs ? right : 1) * (1 - 0.65 * P.v('dim')) * dim)
      fade(given, o * (showGiven ? 1 : 0) * right * dim)
      fade(tabs, tabs.hidden ? 0 : o * right * (1 - 0.65 * P.v('dim')) * dim)
      wipe(idxRoll, roll, 'top')
      wipe(gvRoll, roll, 'top')
      reach([index], on && showIdx && !(L.exTabs && noteUp))
      reach([given], on && showGiven && !noteUp)
      reach([tabs], on && !noteUp)
      if (x > 0.001) {
        for (const r of rows) r.sync(state.params[r.p.name], state.overridden.includes(r.p.name))
        syncChoices()
        for (const n of [list, gvP]) n.classList.toggle('m-runs-on', n.scrollTop + n.clientHeight < n.scrollHeight - 3)
      }
      for (const [name, r] of resets) host.setParam(name, lerp(r.from, r.to, move(P.v('reset:' + name, 1))))
      for (const c of pinned) if (P.run.moving('look:' + c)) host.setLook(c, P.v('look:' + c))
      if (camMove) host.setView(mixPose(camMove.from, camMove.to, P.v('cam', 1)))
      // the caption zone says what the lit part is: its name, and what the scene says about it
      const part: PartMeta | undefined = P.S.hover ? P.part(P.S.hover) : undefined
      if (part && on) {
        const html = `<b>${escapeHtml(part.name)}</b>${part.description ? '. ' + escapeHtml(part.description) : ''}`
        if (hint.dataset.h !== html) { hint.dataset.h = html; hint.innerHTML = html }
      }
      const box = P.frameBox()
      place(hint, Math.round(clamp(box.x + box.width / 2 - hintW / 2, L.mx, L.W - L.mx - hintW)), L.hintTop)
      fade(hint, part && on && !P.S.note ? x : 0)
      for (const b of $$('.row', list)) b.classList.toggle('hot', b.dataset.part === P.S.hover)
    },
    ink(ctx) {
      // a 2D object has no light of its own: the part under a row or a word is drawn round instead
      const id = P.S.hover, part = id ? P.part(id) : undefined
      if (!part || part.space !== '2d' || P.S.hoverFrom === 'stage' || typeof host.locate !== 'function') return
      const r = host.locate(part.id)
      if (!r) return
      const a = P.toPage(r.x - 6, r.y - 6), b = P.toPage(r.x + r.width + 6, r.y + r.height + 6)
      ctx.strokeStyle = '#DDDDDD'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y), 3)
      ctx.stroke()
    },
  })
}
