// The one column at the right (UI design specification 7.11, 7.12): the note about a part you touched, and the answer to what
// you asked. A note shows the part's name and id, what the scene says about it (part.describe), and the scene's live
// probes that are about it; on the stage a ring is drawn round the part and a hairline runs to the headword. Asking
// is wired to a hook the host may or may not have (window.__mimir.ask): without one there is nothing to ask with, and
// the player never answers by itself.
import type { MimirHost } from '../host/index.ts'
import type { Player } from './app.ts'
import { $, button, el, ICON, key } from './dom.ts'
import { clock, D, enter, fade, ink, place, reach, setText, smooth, span, sspan } from './motion.ts'
import { escapeHtml, probesOf, probeText } from './story.ts'

/** What a host that can answer questions puts on window.__mimir (a dev server with an agent behind it; an export has none). */
export interface AskRequest { question: string; /** id of the part the question is about, or null */ part: string | null; /** 1-based step being told */ step: number; t: number; title: string }
export interface AskAnswer { text: string; /** a moment of the story worth going to */ see?: { t: number; label?: string } | null; /** ids of the parts the answer names, most important first */ parts?: string[] }
export type AskHook = (q: AskRequest) => Promise<AskAnswer>

/** live values are refreshed this many times a second of story, so the last digit can be read (spec 7.11) */
export const VALUE_HZ = 10
/** the most probes a note shows */
export const NOTE_VALUES = 4
/** the ring round the part whose note is open: this far outside its box, between these radii (px) */
const RING = { pad: 10, min: 16, max: 240, width: 1.25 }
/** a sheet dragged down this far closes (px); released short of it, it settles back */
const SHEET_CLOSE = 64

export function mountNote(P: Player): void {
  const host = P.host as MimirHost & { ask?: AskHook }
  const askable = (): boolean => typeof host.ask === 'function'

  // ── the note ─────────────────────────────────────────────────────────────────────────────────────
  const note = el('aside', 'm-abs m-note', `<i class="grab" aria-hidden="true"></i><div class="hw"><b tabindex="-1"></b><code></code><span class="sp"></span><button type="button" class="x" aria-label="Close the note">${ICON.close}</button></div><div class="bd"><p class="def"></p><div class="vals plain"></div><form class="m-line"><input type="text" autocomplete="off" aria-label="Ask about this part"></form></div>`)
  note.setAttribute('aria-label', 'About this part')
  P.app.appendChild(note)
  const nName = $('.hw b', note), nId = $('.hw code', note), nDef = $('.def', note), nVals = $('.vals', note), nAsk = $<HTMLFormElement>('form', note), nBody = $('.bd', note)
  let opener: HTMLElement | null = null, valueKey = '', resume = false, sheetH = 0, pull = 0
  let ring: { x: number; y: number; r: number } | null = null

  function fill(id: string): void {
    const part = P.part(id)
    setText(nName, part?.name ?? id)
    setText(nId, id)
    nDef.hidden = !part?.description
    setText(nDef, part?.description ?? '')
    nAsk.hidden = !askable()
    ;($('input', nAsk) as HTMLInputElement).placeholder = `Ask about the ${(part?.name ?? id).toLowerCase()}`
    valueKey = ''
    values()
  }
  function values(): void {
    const id = P.S.note
    if (!id) return
    const k = Math.floor(host.state().tau * VALUE_HZ) + ':' + JSON.stringify(host.state().overridden)
    if (k === valueKey && P.S.playing) return
    valueKey = k
    const list = probesOf(id, host.probes()).slice(0, NOTE_VALUES)
    nVals.hidden = !list.length
    nVals.classList.toggle('one', list.length === 1)
    const html = list.map((p) => `<div class="val"><div class="k">${escapeHtml(p.label)}</div><div class="v">${probeText(p.value)}</div></div>`).join('')
    if (nVals.dataset.h !== html) { nVals.dataset.h = html; nVals.innerHTML = html }
  }
  function show(id: string, from?: HTMLElement | null): void {
    if (!P.part(id)) return
    const was = P.S.note
    if (was === id && P.run.target('note') > 0.5) return
    if (!was) opener = from ?? P.invoker()
    answerHide(true)
    P.x.share?.hide()
    P.S.note = id
    fill(id)
    host.hover?.(id)
    if (was && P.run.target('note') > 0.5) P.run.to('swap', 1, P.ms(D.swap), { from: 0, full: true }) // a second part changes the note, it does not close it
    else { P.run.set('swap', 1); P.run.to('note', 1, P.ms(D.note), { turn: true }) }
    // where the note takes the ground the story is told on, the story waits
    if (P.L.phone && P.S.playing) { resume = true; P.setPlaying(false) }
    measureSheet()
    P.restage(D.note)
    if (opener && opener.matches(':focus-visible')) P.focusSoon(nName)
    P.announce(`${P.part(id)?.name ?? id}. ${P.part(id)?.description ?? ''}`)
    P.touch()
  }
  function hide(): void {
    if (!P.S.note || P.run.target('note') < 0.5) return
    const back = opener
    P.run.to('note', 0, P.ms(D.noteClose), { turn: true, done: () => { if (P.run.target('note') < 0.5) { P.S.note = null; ring = null; P.redraw() } } })
    host.hover?.(P.S.hover)
    pull = 0
    P.restage(D.noteClose)
    if (note.contains(document.activeElement)) P.refocus(back)
    opener = null
    if (resume) { resume = false; P.setPlaying(true) }
    P.touch()
  }
  function measureSheet(): void {
    if (!P.L.phone) { sheetH = 0; return }
    note.style.height = ''
    sheetH = Math.min(note.offsetHeight, Math.round(P.L.H * 0.7))
    note.style.height = sheetH + 'px'
  }
  $('.x', note).addEventListener('click', hide)
  nAsk.addEventListener('submit', (e) => { e.preventDefault(); const input = $<HTMLInputElement>('input', nAsk), q = input.value.trim(); if (q) { const id = P.S.note; input.value = ''; hide(); ask(q, id) } })
  // a sheet's head drags: pulled down far enough it closes, short of that it settles back
  const head = $('.hw', note)
  let dragY: number | null = null
  head.addEventListener('pointerdown', (e) => { if (!P.L.phone || (e.target as HTMLElement).closest('.x')) return; dragY = e.clientY; try { head.setPointerCapture(e.pointerId) } catch { /* gone */ } })
  head.addEventListener('pointermove', (e) => { if (dragY === null) return; pull = Math.max(0, e.clientY - dragY); P.redraw() })
  const drop = (): void => { if (dragY === null) return; dragY = null; if (pull > SHEET_CLOSE) hide(); else { pull = 0; P.redraw() } }
  head.addEventListener('pointerup', drop)
  head.addEventListener('pointercancel', drop)

  // ── ask, and the answer ──────────────────────────────────────────────────────────────────────────
  const answer = el('aside', 'm-abs m-note', `<i class="grab" aria-hidden="true"></i><div class="hw sh-only"><b>Ask</b><span class="sp"></span><button type="button" class="x" aria-label="Close">${ICON.close}</button></div><div class="bd"><p class="q"></p><p class="a"></p><div class="wait"><i></i></div><p class="took"></p><p class="fail" role="alert"></p><div class="acts"><button type="button" class="cite"></button><button type="button" class="m-word" data-r>Resume${key('Space')}</button></div><form class="m-line"><input type="text" placeholder="Ask about this model" autocomplete="off" aria-label="Ask about this model">${key('A')}</form></div>`)
  answer.setAttribute('aria-label', 'Ask about this model')
  answer.setAttribute('aria-live', 'polite')
  P.app.appendChild(answer)
  const aQ = $('.q', answer), aA = $('.a', answer), aWait = $('.wait', answer), aTook = $('.took', answer), aFail = $('.fail', answer), aActs = $('.acts', answer), aCite = $<HTMLButtonElement>('.cite', answer), aForm = $<HTMLFormElement>('form', answer), aIn = $<HTMLInputElement>('input', aForm)
  let asking: { question: string; part: string | null; since: number } | null = null, got: AskAnswer | null = null, failed = false, askOpener: HTMLElement | null = null, askResume = false, askSheet = 0, see: number | null = null
  const paint = (): void => {
    const idle = !asking && !got && !failed
    aQ.hidden = idle
    aA.hidden = !got
    aWait.hidden = aTook.hidden = !asking
    aFail.hidden = !failed
    aActs.hidden = !got
    aCite.hidden = see === null
    aIn.placeholder = idle ? 'Ask about this model' : 'Ask a follow-up'
    if (P.L.phone) { answer.style.height = ''; askSheet = Math.min(answer.offsetHeight, Math.round(P.L.H * 0.7)); answer.style.height = askSheet + 'px' }
  }
  function ask(question: string, part: string | null = null): void {
    if (!askable()) return
    answerShow()
    const since = performance.now(), mine = { question, part, since }
    asking = mine
    got = null
    failed = false
    see = null
    setText(aQ, question)
    if (P.S.playing) { askResume = true; P.setPlaying(false) } // the story waits for the answer, and goes on when it is closed
    paint()
    const state = host.state()
    host.ask!({ question, part, step: state.step, t: state.tau, title: P.info.title }).then((a) => {
      if (asking !== mine) return // another question was asked meanwhile
      asking = null
      if (!a || typeof a.text !== 'string' || !a.text.trim()) { failed = true; setText(aFail, 'Could not answer. Press Enter to try again.'); paint(); return }
      got = a
      // one sentence at a time, by opacity alone (spec 8.11)
      aA.innerHTML = a.text.trim().split(/(?<=[.!?])\s+/).map((s) => `<span class="s">${escapeHtml(s)} </span>`).join('')
      see = a.see && Number.isFinite(a.see.t) ? a.see.t : null
      if (see !== null) { const st = P.info.steps.find((x) => see! >= x.t0 && see! < x.t1); setText(aCite, `See ${a.see!.label ?? st?.title ?? 'this moment'} at ${clock(see)}`) }
      const named = (a.parts ?? []).find((id) => P.part(id))
      if (named) P.setHover(named, 'answer')
      P.run.to('answer', 1, P.ms(D.cross), { from: 0, full: true })
      paint()
      if (answer.contains(document.activeElement)) P.focusSoon(see !== null ? aCite : $<HTMLElement>('[data-r]', answer))
      P.redraw()
    }, () => { if (asking !== mine) return; asking = null; failed = true; setText(aFail, 'Could not answer. Press Enter to try again.'); paint(); P.redraw() })
    P.redraw()
  }
  function answerShow(focus = false): void {
    if (!askable()) return
    if (P.run.target('ask') < 0.5) askOpener = P.invoker()
    if (P.S.note) hide()
    P.x.share?.hide()
    P.run.to('ask', 1, P.ms(D.ask), { turn: true })
    $('[data-a=ask]', P.app).setAttribute('aria-expanded', 'true')
    paint()
    P.restage(D.ask)
    if (focus || !P.coarse) P.focusSoon(aIn)
    P.touch()
  }
  function answerHide(quiet = false): void {
    if (P.run.target('ask') < 0.5) return
    P.run.to('ask', 0, P.ms(D.askClose), { turn: true, done: () => { if (P.run.target('ask') < 0.5) { asking = null; got = null; failed = false; see = null; aIn.value = ''; paint() } } })
    $('[data-a=ask]', P.app).setAttribute('aria-expanded', 'false')
    if (P.S.hoverFrom === 'answer') P.setHover(null, 'answer')
    if (!quiet) { P.restage(D.askClose); if (answer.contains(document.activeElement)) P.refocus(askOpener) }
    askOpener = null
    if (askResume) { askResume = false; if (!quiet) P.setPlaying(true) }
    P.touch()
  }
  aForm.addEventListener('submit', (e) => { e.preventDefault(); const q = aIn.value.trim() || (failed && asking === null ? aQ.textContent ?? '' : ''); if (q) { aIn.value = ''; ask(q, null) } })
  $('.x', answer).addEventListener('click', () => answerHide())
  $('[data-r]', answer).addEventListener('click', () => answerHide())
  aCite.addEventListener('click', () => { const t = see; answerHide(); if (t !== null) P.seek(t) })
  paint()

  P.x.note = { open: () => P.run.target('note') > 0.5, show, hide, sheet: () => (P.run.target('note') > 0.5 ? sheetH : P.run.target('ask') > 0.5 ? askSheet : 0) }
  P.x.ask = { available: askable, open: () => P.run.target('ask') > 0.5, toggle: (focus?: boolean) => (P.run.target('ask') > 0.5 && !focus ? answerHide() : answerShow(true)), hide: () => answerHide(), ask }
  P.add({
    open: () => P.run.target('note') > 0.5 || P.run.target('ask') > 0.5,
    alive: () => asking !== null,
    layout() {
      const L = P.L
      for (const n of [note, answer]) {
        n.classList.toggle('sheet', L.phone)
        n.style.width = (L.phone ? L.W : L.noteW) + 'px'
        n.style.height = ''
        n.style.maxHeight = L.phone ? '' : Math.max(160, L.axisY - LAYOUT_FOOT - L.yNote) + 'px'
      }
      measureSheet()
      paint()
      $('[data-a=ask]', P.app).hidden = !askable()
    },
    draw() {
      const L = P.L, p = P.v('note'), s = P.v('swap', 1), a = P.v('ask')
      // the note: headword first, then what it says, then its values (spec 8.10)
      reach([note], P.run.target('note') > 0.5)
      reach([answer], P.run.target('ask') > 0.5)
      if (L.phone) {
        place(note, 0, L.H - sheetH * smooth(p) + pull)
        place(answer, 0, L.H - askSheet * smooth(a))
        fade(note, p > 0.001 ? 1 : 0)
        fade(answer, a > 0.001 ? 1 : 0)
      } else {
        place(note, L.noteX, L.yNote)
        place(answer, L.noteX, L.first - Math.round(L.tokens.lhUi * 0.72))
        fade(note, p > 0.001 ? 1 : 0)
        fade(answer, a)
        const sw = P.RM ? s : span(s, 0.35, 1)
        fade(nName, (P.RM ? p : span(p, 0.21, 0.53)) * sw)
        fade(nId, (P.RM ? p : span(p, 0.45, 0.74)) * sw)
        fade($('.x', note), P.RM ? p : span(p, 0.45, 0.74))
        fade(nDef, (P.RM ? p : span(p, 0.37, 0.69)) * sw)
        place(nDef, 0, P.RM ? 0 : 5 * (1 - enter(span(p, 0.37, 0.74))))
        fade(nVals, (P.RM ? p : span(p, 0.53, 0.84)) * sw)
        fade(nAsk, P.RM ? p : span(p, 0.62, 1))
      }
      if (P.S.note) values()
      nBody.classList.toggle('m-runs-on', nBody.scrollTop + nBody.clientHeight < nBody.scrollHeight - 3)
      // the answer arrives one sentence at a time
      if (got) { const q = P.v('answer', 1), ss = aA.children; for (let i = 0; i < ss.length; i++) (ss[i] as HTMLElement).style.opacity = String(span(q, (i * 0.2) / Math.max(1, ss.length * 0.2 + 0.05), (i * 0.2 + 0.25) / Math.max(1, ss.length * 0.2 + 0.05))) }
      if (asking) { const sec = (performance.now() - asking.since) / 1000; ($('i', aWait)).style.transform = `translateX(${(((sec / 1.1) % 1) * 200 - 100).toFixed(1)}%)`; setText(aTook, clock(sec)) }
      // where the ring goes: round the part, as it is on the stage now
      const id = P.S.note, r = id && typeof host.locate === 'function' ? host.locate(id) : null
      if (r) {
        const a = P.toPage(r.x, r.y), b = P.toPage(r.x + r.width, r.y + r.height)
        ring = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.min(RING.max, Math.max(RING.min, Math.max(b.x - a.x, b.y - a.y) / 2 + RING.pad)) }
      } else if (!id) ring = null
    },
    ink(ctx) {
      const p = P.v('note')
      if (!ring || p <= 0.001) return
      const s = P.v('swap', 1)
      ctx.lineWidth = RING.width
      ctx.strokeStyle = '#FFFFFF'
      ctx.globalAlpha = Math.min(1, p * 4)
      ink.ring(ctx, ring.x, ring.y, ring.r, (P.RM ? 1 : sspan(p, 0, 0.24)) * (P.RM ? 1 : sspan(s, 0, 0.6)))
      if (!P.L.phone) {
        // a hairline from the ring to the head of the note, drawn from the part outward
        const hx = P.L.noteX - 14, hy = P.L.yNote + Math.round(P.L.tokens.lhHead / 2), dx = hx - ring.x, dy = hy - ring.y, d = Math.hypot(dx, dy) || 1
        if (d > ring.r + 8) {
          ctx.lineWidth = 1
          ctx.strokeStyle = '#888888'
          ink.line(ctx, [[ring.x + (dx / d) * ring.r, ring.y + (dy / d) * ring.r], [hx, hy]], P.RM ? p : sspan(p, 0.1, 0.68) * sspan(s, 0, 0.6))
        }
      }
      ctx.globalAlpha = 1
    },
  })
}
/** the note ends this far above the line of time */
const LAYOUT_FOOT = 60
