// Read mode (UI design specification 7.6): the whole explanation as a typeset column beside the stage. Chapter headings, one
// paragraph per step opening with the step's title as a run-in head, st.note text as an aside, the step being told
// marked with a dot that slides. Click to jump; words that name a part carry its colour, light it, and send the story
// to the moment the pointer lands on it.
import type { Player } from './app.ts'
import { button, el } from './dom.ts'
import { clock, D, fade, lagged, lerp, move, place, reach, smooth, span } from './motion.ts'
import { locate, noteHtml, splitTail, wordsOf } from './story.ts'

/** a paragraph that is not being told rests at this opacity (spec 7.6: 80 percent, 9.8 : 1 on the stage) */
export const RESTING = 0.8
/** the read channel's stretch over which the column is written, block by block (spec 8.7) */
const WRITE = [0.5, 0.92] as const
/** seconds after a pointer's landing at which a clicked word shows it at rest on its part */
const AFTER_LANDING = 0.3

interface Cue { words: string; targets: string[]; land: number | null; word: number | null }
interface GuideManifest { steps: { step: number; cues: Cue[] }[] }

export function mountRead(P: Player): void {
  const col = el('article', 'm-abs m-read')
  col.setAttribute('aria-label', 'The explanation, step by step')
  const inner = el('div', 'in'), now = el('i', 'm-now')
  col.appendChild(inner)
  const back = button('m-abs m-back', 'Back to where it is playing')
  P.app.append(col, back)
  let steps: HTMLElement[] = [], blocks: HTMLElement[] = [], following = true, current = -1, nowFrom = 0, nowTo = 0, ours = 0, shown: HTMLElement[] = []

  function build(): void {
    const info = P.info
    inner.textContent = ''
    inner.appendChild(now)
    const h = el('h2')
    h.textContent = info.title
    inner.appendChild(h)
    if (info.subtitle) { const sub = el('p', 'sub'); sub.textContent = info.subtitle; inner.appendChild(sub) }
    const guide = (info as { guide?: GuideManifest }).guide
    steps = []
    let chapter: number | null = null
    for (const t of info.transcript) {
      if (t.chapter !== null && t.chapter !== chapter) {
        chapter = t.chapter
        const ch = info.chapters.find((c) => c.index === t.chapter)
        const b = button('ch', '<span class="n"></span><span class="t"></span><i class="m-dots"></i><span class="tm"></span>')
        b.children[0]!.textContent = String(t.chapter)
        b.children[1]!.textContent = t.chapterTitle ?? ''
        b.children[3]!.textContent = clock(ch?.t0 ?? t.t0)
        const at = ch?.t0 ?? t.t0
        b.addEventListener('click', () => P.seek(at))
        inner.appendChild(b)
      }
      const p = el('p', 'st')
      p.dataset.step = String(t.step)
      const run = button('run', '')
      run.textContent = t.title.replace(/[.:]$/u, '') + '.'
      run.addEventListener('click', (e) => { e.stopPropagation(); P.seek(t.t0) })
      p.appendChild(run)
      const cues = guide?.steps.find((s) => s.step === t.step)?.cues ?? []
      for (const n of t.narration) {
        const sentence = el('span', 'nar')
        const words = wordsOf(n)
        for (let i = 0; i < words.length; i++) {
          const w = words[i]!
          if (w.span < 0) { sentence.append(w.text + (i < words.length - 1 ? ' ' : '')); continue }
          // the words of one name are one button; punctuation after the name stays outside it
          const sp = n.spans[w.span]!
          let j = i
          while (j + 1 < words.length && words[j]!.joined) j++
          const [last, tail] = splitTail(words[j]!.text)
          const text = [...words.slice(i, j).map((x) => x.text), last].join(' ')
          const part = P.owner(sp.targets[0]!) ?? P.part(sp.targets[0]!)
          const lk = button('lk', '')
          const ws = el('span', 'w')
          ws.textContent = text
          lk.appendChild(ws)
          if (part?.color) lk.style.setProperty('--c', part.color)
          lk.setAttribute('aria-label', `${text}: show ${part?.name ?? sp.targets[0]}`)
          const cue = cues.find((c) => c.words === sp.words && c.targets.join() === sp.targets.join())
          const id = part?.id ?? sp.targets[0]!
          lk.addEventListener('pointerenter', () => P.setHover(id, 'word'))
          lk.addEventListener('pointerleave', () => P.setHover(null, 'word'))
          lk.addEventListener('focus', () => P.setHover(id, 'word'))
          lk.addEventListener('blur', () => P.setHover(null, 'word'))
          lk.addEventListener('click', (e) => { e.stopPropagation(); P.seek(cue?.land !== null && cue?.land !== undefined ? Math.min(cue.land + AFTER_LANDING, t.t1 - 0.01) : t.t0) })
          const nw = el('span', 'nw')
          nw.append(lk, tail)
          sentence.append(nw, j < words.length - 1 ? ' ' : '')
          i = j
        }
        p.append(' ', sentence)
      }
      // with a mouse the whole paragraph jumps; under a finger only its head does, so reading and scrolling never move "now"
      p.addEventListener('click', () => { if (!P.coarse && !String(getSelection?.() ?? '')) P.seek(t.t0) })
      inner.appendChild(p)
      steps.push(p)
      if (t.note) { const aside = el('div', 'aside', noteHtml(t.note)); inner.appendChild(aside) }
    }
    blocks = [...inner.children].filter((n) => n !== now) as HTMLElement[]
    current = -1
  }

  /** The column follows the story: the paragraph being told is brought to the head of the column, on a block boundary. */
  function follow(force = false): void {
    if (force) following = true
    fade(back, following ? 0 : 1)
    const st = steps[current]
    if (!following || !st || P.S.mode !== 'read') return
    const lead = Math.round(P.L.tokens.lhBody * 1.5)
    const want = Math.max(0, Math.min(st.offsetTop - lead, inner.scrollHeight - col.clientHeight))
    if (Math.abs(col.scrollTop - want) < 2) return
    const from = col.scrollTop
    ours = performance.now()
    if (P.RM) { col.scrollTop = want; return }
    scroll = { from, to: want }
    P.run.to('readScroll', 1, D.now, { from: 0, full: true, ease: move })
  }
  let scroll: { from: number; to: number } | null = null
  col.addEventListener('scroll', () => {
    col.classList.toggle('scrolled', col.scrollTop > 2)
    if (scroll || performance.now() - ours < 80) return // our own scrolling
    if (P.S.playing && following) { following = false; fade(back, 1) }
    visible()
  }, { passive: true })
  col.addEventListener('wheel', () => { if (P.S.playing) { following = false; scroll = null; fade(back, 1) } }, { passive: true })
  col.addEventListener('touchmove', () => { if (P.S.playing) { following = false; scroll = null; fade(back, 1) } }, { passive: true })
  back.addEventListener('click', () => follow(true))
  /** the blocks that are in the column's window: the ones a change of mode writes */
  function visible(): void {
    const a = col.scrollTop, b = a + col.clientHeight
    shown = blocks.filter((n) => n.offsetTop + n.offsetHeight > a && n.offsetTop < b)
  }

  build()
  fade(back, 0)
  P.x.read = { follow, rebuild: build }
  P.add({
    layout() {
      const L = P.L
      col.style.width = (L.stack ? L.W - 2 * L.mx : L.colW + L.tokens.gutter) + 'px'
      col.style.height = Math.max(60, L.colBottom - L.colTop) + 'px'
      col.style.setProperty('--fade-top', L.stack ? '14px' : '32px')
      place(col, L.mx, L.colTop)
      place(back, L.mx + (L.stack ? 0 : L.tokens.gutter), L.colBottom + 4)
      current = -1
      visible()
    },
    draw(tau) {
      const r = P.v('read'), on = P.RM ? r : span(r, WRITE[0], WRITE[1])
      reach([col, back], P.run.target('read') > 0.5)
      fade(col, r > 0.001 ? 1 : 0)
      // the column is written block by block, in reading order, once the stage has got out of its way
      const moving = P.run.moving('read')
      if (moving || col.dataset.w !== '1') {
        if (!shown.length) visible()
        shown.forEach((n, i) => { n.style.opacity = String(Math.round(smooth(lagged(on, i, shown.length, 0.1)) * (n.classList.contains('st') && n.dataset.cur !== '1' ? RESTING : 1) * 1000) / 1000) })
        for (const n of blocks) if (!shown.includes(n)) n.style.opacity = on >= 1 ? (n.classList.contains('st') && n.dataset.cur !== '1' ? String(RESTING) : '') : '0'
        col.dataset.w = moving ? '0' : '1'
      }
      if (scroll) { const p = P.v('readScroll', 1); ours = performance.now(); col.scrollTop = lerp(scroll.from, scroll.to, p); if (p >= 1) { scroll = null; visible() } }
      const at = locate(P.info, tau).step
      if (at !== current) {
        const first = current < 0
        current = at
        steps.forEach((s, i) => { const cur = i === at; s.dataset.cur = cur ? '1' : '0'; s.style.opacity = cur ? '' : String(RESTING); if (cur) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current') })
        const st = steps[at]
        nowFrom = first ? (st ? st.offsetTop + 11 : 0) : lerp(nowFrom, nowTo, move(P.v('now', 1)))
        nowTo = st ? st.offsetTop + Math.round(P.L.tokens.lhBody / 2) - 4 : 0
        if (first) nowFrom = nowTo
        P.run.to('now', 1, P.ms(D.now), { from: 0, full: true })
        col.dataset.w = '0'
        follow()
      }
      place(now, 0, P.RM ? nowTo : lerp(nowFrom, nowTo, move(P.v('now', 1))))
      fade(now, steps.length ? span(r, 0.6, 1) : 0)
    },
  })
}
