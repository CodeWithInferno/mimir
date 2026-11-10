// The narrator's sentence under a small stage (UI design specification 7.3). On a wide stage the captions are the engine's own,
// set inside the frame, the same in a shot, a video and the viewer. A frame narrower than LAYOUT.captionOwnBelow would set
// them too small to read (a phone held upright), so there the player switches the engine's off and sets the same
// words, with the same timings (info().guide), in its own zone under the stage: one cue at a time, each word lit as it
// is said, a word that names a part in the part's colour. Every opacity is a function of the story's time.
import type { Player } from './app.ts'
import { el } from './dom.ts'
import { fade, place, span, sspan } from './motion.ts'

/** a word that has not been said yet rests at this opacity; one that names a part at this (spec 7.3, 11) */
export const UNLIT = 0.66, UNLIT_NAME = 0.8
/** seconds: a cue is written this long before its first word, each word lights over this window round its onset, a cue leaves this long before the next */
export const CAPTION_TIMES = { lead: 0.42, before: 0.03, after: 0.07, leave: 0.18, write: 0.15 }
/** how wide a character of the caption face is, as a share of its size: what the cue length is estimated from */
const CHAR_EM = 0.47

interface GWord { text: string; t0: number | null; t1: number | null; cue: number }
interface GLine { text: string; show: number | null; words: GWord[] }
interface GStep { step: number; cues: { targets: string[] }[]; lines: GLine[] }
/** One cue: a run of words of one sentence that fits the zone. */
export interface Cue { words: GWord[]; t0: number; t1: number; step: number }

/**
 * Cut a sentence into cues of at most `budget` characters, at the pause nearest the middle of what is too long
 * (after punctuation first, else between any two words), until every cue fits. Pure.
 */
export function cutCue(words: readonly GWord[], budget: number): GWord[][] {
  const len = words.reduce((n, w) => n + w.text.length + 1, -1)
  if (len <= budget || words.length < 2) return [words.slice()]
  let best = -1, cost = Infinity, at = 0
  for (let i = 0; i < words.length - 1; i++) {
    at += words[i]!.text.length + 1
    const pause = /[,;:.!?…]$/u.test(words[i]!.text) ? 0 : words[i]!.cue >= 0 && words[i]!.cue === words[i + 1]!.cue ? 4 : 0.3
    const c = pause + Math.abs(at - len / 2) / len
    if (c < cost) { cost = c; best = i }
  }
  return [...cutCue(words.slice(0, best + 1), budget), ...cutCue(words.slice(best + 1), budget)]
}

export function mountCaption(P: Player): void {
  const zone = el('div', 'm-abs m-cap')
  zone.setAttribute('aria-hidden', 'true') // the step's text goes to the live region when the step begins
  const p = el('p', 'wrap')
  zone.appendChild(p)
  P.app.appendChild(zone)
  let cues: Cue[] = [], own = false, shown: Cue | null = null, spans: HTMLElement[] = [], lines = 2, lh = 34

  function build(): void {
    const guide = (P.info as { guide?: { steps: GStep[] } }).guide
    const fs = parseFloat(getComputedStyle(zone).fontSize) || 24
    const budget = Math.max(12, Math.floor((zone.clientWidth / (fs * CHAR_EM)) * lines))
    cues = []
    for (const gs of guide?.steps ?? []) {
      const step = P.info.steps[gs.step - 1]
      if (!step) continue
      const all: Cue[] = []
      for (const line of gs.lines) for (const ws of cutCue(line.words.filter((w) => w.t0 !== null), budget)) if (ws.length) all.push({ words: ws, t0: ws[0]!.t0!, t1: step.t1, step: gs.step })
      all.forEach((c, i) => { c.t1 = all[i + 1]?.t0 ?? step.t1 })
      cues.push(...all)
    }
    shown = null
  }
  function set(c: Cue): void {
    p.textContent = ''
    spans = []
    const guide = (P.info as { guide?: { steps: GStep[] } }).guide, gs = guide?.steps.find((s) => s.step === c.step)
    c.words.forEach((w, i) => {
      const s = el('span', 'w')
      s.textContent = w.text
      const part = w.cue >= 0 ? P.owner(gs?.cues[w.cue]?.targets[0] ?? null) ?? P.part(gs?.cues[w.cue]?.targets[0] ?? '') : undefined
      if (w.cue >= 0) { s.classList.add('lk'); if (part?.color) s.style.setProperty('--c', part.color) }
      spans.push(s)
      p.append(s, i < c.words.length - 1 ? ' ' : '')
    })
  }

  P.x.caption = { own: () => own }
  P.add({
    layout() {
      const L = P.L
      lines = L.phone ? 3 : 2
      zone.style.fontSize = ''
      zone.style.lineHeight = ''
      if (L.short) { zone.style.fontSize = '19px'; zone.style.lineHeight = '26px' } else if (!L.phone && (L.W < 1200 || L.H < 760)) { zone.style.fontSize = '22px'; zone.style.lineHeight = '31px' }
      lh = parseFloat(getComputedStyle(zone).lineHeight) || 34
      const w = Math.round(Math.min(880 * L.k, L.W - 2 * L.mx))
      zone.style.width = w + 'px'
      zone.style.height = lines * lh + 'px'
      // a short window has one foot: the caption stands there while the chrome sleeps, the line of time when the reader reaches for it
      place(zone, Math.round((L.W - w) / 2), L.short ? L.H - L.safe.bottom - 12 - lines * lh : L.axisY - (L.phone ? 42 : 60) - lines * lh)
      own = L.ownCaptions
      build()
    },
    draw(tau) {
      const on = own && P.S.captions && P.S.mode === 'video' && !P.x.palette?.open() && !P.x.erratum?.open()
      let cur: Cue | null = null
      if (on) for (const c of cues) if (tau >= c.t0 - CAPTION_TIMES.lead && tau < c.t1) cur = c
      if (cur !== shown) { shown = cur; if (cur) set(cur) }
      if (!cur) { fade(zone, 0); return }
      // written before its first word, gone before the next cue: exits lead (spec 8.5)
      const o = Math.min(P.RM ? 1 : sspan(tau, cur.t0 - CAPTION_TIMES.lead, cur.t0 - CAPTION_TIMES.lead + CAPTION_TIMES.write), 1 - span(tau, cur.t1 - CAPTION_TIMES.leave, cur.t1)) * (1 - P.v('read')) * (1 - P.v('explore')) * (P.L.short ? 1 - P.v('wake', 1) : 1)
      fade(zone, o)
      cur.words.forEach((w, i) => {
        const rest = w.cue >= 0 ? UNLIT_NAME : UNLIT
        spans[i]!.style.opacity = String(Math.round((rest + (1 - rest) * span(tau, w.t0! - CAPTION_TIMES.before, w.t0! + CAPTION_TIMES.after)) * 1000) / 1000)
      })
    },
  })
}
