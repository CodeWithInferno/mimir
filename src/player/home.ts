// Home (UI design specification 7.16, 7.17): the question, examples and recent models, and the build as it happens. It exists
// only where a server offers it. The contract (served by `mimir serve`):
//   GET  /api/scenes                 → [{ id, title, kind, updated, thumb }]
//   POST /api/new { prompt, kind }   → { id }
//   GET  /api/new/<id>/events        server-sent events, each { stage, message, frame?, scene? }
//                                    stage: storyboard | writing | checking | looking | fixing | ready | failed
// A viewer opened without a scene asks for /api/scenes: an answer makes this page, no answer leaves the viewer as it
// was (it then says that no scene was given). Nothing here is ever made up: stages, frames and messages are the
// server's events.
import type { Player } from './app.ts'
import { $, $$, button, el, ICON, key } from './dom.ts'
import { clock, exit, fade, place, setText, smooth, span } from './motion.ts'
import { ago, buildState, escapeHtml, type BuildEvent } from './story.ts'

/** the page says what its server offers: <meta name="mimir-server" content="scenes new export">, written by the server into the viewer it serves */
export const SERVER_META = 'mimir-server'
/** the parts of the API every server that has a home page has */
const CONTRACT = ['scenes', 'new', 'export']
/** set for the tab once a home page was reached on this origin: the pages opened from it are served by the same server */
const SERVER_KEY = 'mimir.server'
/**
 * Whether the server behind this page offers a part of its API, without asking it: a request for a route that is not
 * there is an error in the page's console, and a viewer served by a plain file server must stay silent.
 */
export function serverOffers(what: string): boolean {
  const declared = (document.querySelector(`meta[name="${SERVER_META}"]`)?.getAttribute('content') ?? '').split(/[\s,]+/)
  if (declared.includes(what)) return true
  if (!CONTRACT.includes(what)) return false // what is not in the contract is offered only when declared
  try { return sessionStorage.getItem(SERVER_KEY) === '1' } catch { return false }
}
export const ROUTES = { scenes: '/api/scenes', create: '/api/new', events: (id: string): string => `/api/new/${encodeURIComponent(id)}/events`, examples: '/api/examples' }
/** the kinds a prompt may ask for; the first is "let the builder decide" */
export const KINDS: readonly { id: string; label: string }[] = [{ id: 'auto', label: 'Auto' }, { id: '3d', label: '3D model' }, { id: 'diagram', label: 'Diagram' }, { id: 'math', label: 'Math' }]
/** what the examples list shows unless the server declares its own (`examples` in its meta: GET /api/examples → [{ field, prompt }]) */
export const EXAMPLE_PROMPTS: readonly { field: string; prompt: string }[] = [
  { field: 'mechanical', prompt: 'How does a four-stroke engine work?' },
  { field: 'mechanical', prompt: 'How does a bicycle derailleur change gear?' },
  { field: 'software', prompt: 'What happens to a request when a queue fills up?' },
  { field: 'software', prompt: 'How does a hash map resolve a collision?' },
  { field: 'math', prompt: 'Why does gradient descent find the bottom of a bowl?' },
  { field: 'math', prompt: 'What does a Fourier series add up to?' },
]
/** the page change from the question to the build: one channel, this long (spec 8.13) */
export const SUBMIT_MS = 700
/** "Stopped at 0:39. Resume" stays this long */
export const STOPPED_MS = 5000
/** the prompt grows to this many lines, then scrolls */
export const PROMPT_LINES = 6
/** ms between `ready` and opening the scene: long enough to read the last row */
export const READY_HOLD_MS = 600

interface SceneRow { id: string; title: string; kind?: string; updated?: string | number; thumb?: string }

export function mountHome(P: Player): void {
  const http = /^https?:$/.test(location.protocol)
  const wants = !P.query.get('scene')
  let pending = wants && http, showing = false
  let page: HTMLElement | null = null
  let events: (BuildEvent & { at: number })[] = [], started = 0, source: EventSource | null = null, buildId: string | null = null, prompt = '', stoppedAt = 0, stopTimer = 0, leaving = 0
  const sceneUrl = (id: string): string => `${location.pathname}?scene=${encodeURIComponent(id)}`
  const elapsed = (): number => (performance.now() - started) / 1000

  async function probe(): Promise<void> {
    let scenes: SceneRow[] | null = null
    // a viewer opened without a scene asks; one that shows a scene only believes what the page or the tab already knows
    if (http && wants) {
      try { const r = await fetch(ROUTES.scenes, { headers: { accept: 'application/json' } }); const j = r.ok ? await r.json() : null; scenes = Array.isArray(j) ? j : null } catch { scenes = null }
      if (scenes) { try { sessionStorage.setItem(SERVER_KEY, '1') } catch { /* no storage */ } }
    }
    P.home = scenes !== null || (http && serverOffers('scenes'))
    pending = false
    const mark = $<HTMLAnchorElement>('.m-mark', P.app)
    if (P.home) { mark.href = location.pathname; mark.setAttribute('aria-label', 'Mimir, home') }
    if (wants && scenes) open(scenes)
    else if (wants) P.x.erratum?.show() // no server, no scene: the viewer says what it was not given
  }

  function open(scenes: SceneRow[]): void {
    showing = true
    P.root.classList.add('m-home')
    page = el('div', 'h-page', `<div class="h-wrap">
<header class="h-top"><a class="m-mark" aria-label="Mimir, home">Mimir</a><span class="sp"></span><div class="g-meta"><span class="m-dust"><span class="m-num" data-h="time"></span><span class="g-bg">, runs in the background</span></span><button type="button" class="m-word" data-h="stop">Stop${key('esc')}</button></div></header>
<main class="h-view">
  <h1 class="h-q">What do you want to see working?</h1>
  <form class="h-ask" autocomplete="off">
    <label class="m-line"><i class="caret" aria-hidden="true"></i><textarea rows="1" placeholder="${escapeHtml(EXAMPLE_PROMPTS[0]!.prompt)}" aria-label="What do you want to see working?" spellcheck="false"></textarea></label>
    <div class="h-opts"><div class="m-opt" data-g="kind" role="radiogroup" aria-label="Kind of model"><i class="m-opt-dot"></i>${KINDS.map((k, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-kind="${k.id}">${k.label}</button>`).join('')}</div><button type="submit" class="h-go" disabled>Build it${key('⏎')}</button></div>
    <p class="h-stopped" role="status" hidden><span></span><button type="button">Resume</button></p>
  </form>
  <div class="h-cols"><ol class="h-ex" aria-label="Examples"></ol><div class="h-plates" aria-label="Recent models"></div></div>
</main>
<section class="g-view" aria-label="Building the model">
  <h1 class="g-title"></h1>
  <p class="g-status" role="status"></p>
  <div class="g-grid"><div class="g-left"><ol data-h="stages" aria-label="Stages"></ol><p class="g-fail" role="alert" hidden></p></div>
  <div class="g-right"><div class="g-cap"><span></span><i></i></div><div class="g-frame big"><span class="no"></span></div><p class="g-say"></p><div class="g-strip" aria-label="Frames"></div></div></div>
</section></div>`)
    P.app.appendChild(page)
    const view = $('.h-view', page), gen = $('.g-view', page), form = $<HTMLFormElement>('.h-ask', page), ta = $<HTMLTextAreaElement>('textarea', page), lineEl = $('.m-line', form), go = $<HTMLButtonElement>('.h-go', page)
    const kinds = $('[data-g=kind]', page), meta = $('.g-meta', page), timeEl = $('[data-h=time]', page), stopped = $('.h-stopped', page)
    const stages = $('[data-h=stages]', page), big = $('.g-frame.big', page), strip = $('.g-strip', page), cap = $('.g-cap', page), say = $('.g-say', page), fail = $('.g-fail', page), status = $('.g-status', page), title = $('.g-title', page)
    let kind = KINDS[0]!.id
    $('.h-top .m-mark', page).setAttribute('href', location.pathname)

    // the line to write on: it grows to its text, shows a caret while empty and ready, and Enter builds
    const grow = (): void => {
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 38
      ta.style.height = 'auto'
      const h = Math.min(ta.scrollHeight, PROMPT_LINES * lh)
      ta.style.height = Math.max(lh, h) + 'px'
      ta.classList.toggle('tall', ta.scrollHeight > PROMPT_LINES * lh + 1)
      const has = !!ta.value.trim()
      go.disabled = !has
      go.classList.toggle('ready', has)
      lineEl.classList.toggle('ready', !ta.value && document.activeElement === ta)
    }
    ta.addEventListener('input', grow)
    ta.addEventListener('focus', grow)
    ta.addEventListener('blur', grow)
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit() } })
    kinds.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]'); if (!b) return; kind = b.dataset.kind!; P.x.choose(kinds, $$('button', kinds).indexOf(b)) })
    form.addEventListener('submit', (e) => { e.preventDefault(); const text = ta.value.trim(); if (text) void submit(text) })

    // examples: one per row, the field they belong to hanging beside them; a click fills the line and does not submit
    const exList = $('.h-ex', page)
    const fillExamples = (list: readonly { field: string; prompt: string }[]): void => {
      exList.textContent = ''
      let last = ''
      list.forEach((x, i) => {
        const li = el('li', x.field !== last && i > 0 ? 'gap' : '')
        if (x.field !== last) { const d = el('span', 'dom'); d.textContent = x.field; li.appendChild(d); last = x.field }
        const b = button('', '')
        b.textContent = x.prompt
        b.addEventListener('click', () => { ta.value = x.prompt; grow(); ta.focus() })
        li.appendChild(b)
        exList.appendChild(li)
      })
    }
    fillExamples(EXAMPLE_PROMPTS)
    if (serverOffers('examples')) void fetch(ROUTES.examples).then((r) => (r.ok ? r.json() : null)).then((j) => { if (Array.isArray(j) && j.length && j.every((x) => x && typeof x.prompt === 'string')) fillExamples(j.map((x) => ({ field: String(x.field ?? ''), prompt: String(x.prompt) }))) }).catch(() => {})

    // recent models: a plate, its title, one fact. No recents: nothing in that half.
    const plates = $('.h-plates', page), now = Date.now()
    for (const s of scenes) {
      const a = el('a', 'h-plate')
      a.href = sceneUrl(s.id)
      const pl = el('span', 'pl')
      if (s.thumb) { const img = el('img'); img.src = s.thumb; img.alt = ''; img.loading = 'lazy'; pl.appendChild(img) }
      const b = el('b'), mt = el('span', 'mt')
      b.textContent = s.title || s.id
      const when = typeof s.updated === 'number' ? s.updated : s.updated ? Date.parse(s.updated) : NaN
      mt.textContent = [s.kind, Number.isFinite(when) ? ago(when, now) : ''].filter(Boolean).join(', ')
      a.append(pl, b, mt)
      plates.appendChild(a)
    }

    // ── the build ──────────────────────────────────────────────────────────────────────────────────
    function listen(id: string): void {
      source?.close()
      source = new EventSource(ROUTES.events(id))
      source.onmessage = (m) => {
        let e: BuildEvent | null = null
        try { e = JSON.parse(m.data) as BuildEvent } catch { /* not ours */ }
        if (!e || typeof e.stage !== 'string') return
        events.push({ ...e, at: elapsed() })
        if (e.stage === 'ready' || e.stage === 'failed') { source?.close(); source = null }
        if (e.stage === 'ready' && e.scene) { const to = sceneUrl(e.scene); leaving = setTimeout(() => { location.href = to }, READY_HOLD_MS) as unknown as number }
        P.redraw()
      }
      source.onerror = () => { if (source?.readyState === EventSource.CLOSED && !events.some((x) => x.stage === 'ready' || x.stage === 'failed')) { events.push({ stage: 'failed', message: 'The connection to the build was lost.', at: elapsed() }); source = null; P.redraw() } }
    }
    async function submit(text: string): Promise<void> {
      prompt = text
      events = []
      started = performance.now()
      stopped.hidden = true
      setText(title, text)
      P.run.to('gen', 1, P.ms(SUBMIT_MS), { from: 0, full: true }) // the page changes whatever the build does
      try {
        const r = await fetch(ROUTES.create, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: text, kind }) })
        const j = r.ok ? ((await r.json()) as { id?: unknown }) : null
        if (!j || typeof j.id !== 'string') throw new Error(`the server answered ${r.status}`)
        buildId = j.id
        listen(j.id)
      } catch (e) { events.push({ stage: 'failed', message: `The build could not be started (${(e as Error).message}).`, at: elapsed() }) }
      P.redraw()
    }
    /** Stop never runs the build backwards: the view goes, the prompt is back where it was typed (spec 8.13). */
    function stop(): void {
      if (P.run.target('gen') < 0.5) return
      const done = events.some((x) => x.stage === 'failed')
      source?.close()
      source = null
      clearTimeout(leaving)
      stoppedAt = elapsed()
      P.run.to('gen', 0, P.ms(200))
      if (!done && buildId) {
        stopped.hidden = false
        setText(stopped.children[0]!, `Stopped at ${clock(stoppedAt)}.`)
        clearTimeout(stopTimer)
        stopTimer = setTimeout(() => { stopped.hidden = true }, STOPPED_MS) as unknown as number
      }
      ta.focus()
    }
    $('[data-h=stop]', page).addEventListener('click', stop)
    $('button', stopped).addEventListener('click', () => { if (!buildId) return; stopped.hidden = true; started = performance.now() - stoppedAt * 1000; P.run.to('gen', 1, P.ms(SUBMIT_MS)); listen(buildId) })
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && showing && P.run.target('gen') > 0.5) { e.preventDefault(); stop() } }) // wherever the focus is
    // a letter typed at the page goes to the line; a key meant for a focused control never does
    window.addEventListener('keydown', (e) => { if (!showing || P.run.target('gen') > 0.5 || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return; const t = e.target as HTMLElement; if (t === ta || t.closest?.('button, a, input, textarea')) return; ta.focus() })
    if (!P.coarse) ta.focus() // under a finger that would raise the keyboard over the examples
    grow()

    let drawn = ''
    const stageRow = (): HTMLElement => el('li', 'g-stage', `<span class="mk"><i class="o"></i><i class="d"></i><i class="c">${ICON.check}</i></span><div class="hd"><span class="t"></span><i class="m-dots"></i><span class="tm"></span></div><div class="fact"></div>`)
    P.add({
      alive: () => P.run.target('gen') > 0.5 && !events.some((x) => x.stage === 'ready' || x.stage === 'failed'),
      open: () => true,
      layout() { P.x.measureOpts() },
      draw() {
        const g = P.v('gen'), on = P.run.target('gen') > 0.5
        // the question and the lists leave first; the build's rows arrive after them
        fade(view, P.RM ? 1 - g : 1 - exit(span(g, 0, 0.17)))
        place(view, 0, P.RM ? 0 : -6 * exit(span(g, 0, 0.17)))
        fade(gen, P.RM ? g : smooth(span(g, 0.29, 0.8)))
        fade(meta, P.RM ? g : span(g, 0.5, 0.8))
        view.inert = on
        gen.inert = !on
        if (g <= 0.001) return
        const st = buildState(events, elapsed())
        setText(timeEl, `${clock(st.failed || st.ready !== null ? (events[events.length - 1]?.at ?? 0) : elapsed())} so far`)
        setText(status, st.status)
        const sig = JSON.stringify([st.rows.map((r) => [r.state, r.fact, r.passes, Math.floor(r.seconds)]), st.frames.length, st.looking, st.failed])
        if (sig === drawn) return
        drawn = sig
        while (stages.children.length < st.rows.length) stages.appendChild(stageRow())
        st.rows.forEach((r, i) => {
          const li = stages.children[i] as HTMLElement
          li.classList.toggle('on', r.state === 'now')
          li.classList.toggle('done', r.state === 'done')
          fade($('.o', li), r.state === 'todo' ? 1 : 0)
          fade($('.d', li), r.state === 'now' ? 1 : 0)
          fade($('.c', li), r.state === 'done' ? 1 : 0)
          setText($('.t', li), r.label)
          setText($('.tm', li), r.state === 'done' && r.passes ? clock(r.seconds) : '')
          fade($('.m-dots', li), r.state === 'done' && r.passes ? 0.6 : 0)
          setText($('.fact', li), [r.passes > 1 ? `pass ${r.passes}` : '', r.fact].filter(Boolean).join(', '))
        })
        fail.hidden = !st.failed
        if (st.failed) fail.innerHTML = `<b>Failed.</b>${escapeHtml(st.failed)}`
        // the frame the agent is looking at, large; every frame that has arrived, in the strip
        const cur = st.frames[st.looking]
        const img = big.querySelector('img') ?? big.appendChild(el('img'))
        if (cur && img.getAttribute('src') !== cur) { img.src = cur; img.alt = `Frame ${st.looking + 1}` }
        img.hidden = !cur
        setText($('.no', big), cur ? '' : '1')
        setText(cap.children[0]!, cur ? `Looking at frame ${st.looking + 1} of ${st.frames.length}` : '')
        setText(say, st.rows.find((r) => r.state === 'now')?.fact ?? '')
        while (strip.children.length < st.frames.length) { const f = el('div', 'g-frame'); f.appendChild(el('img')); const wrap = el('div', 'grp'), pl = el('div', 'pl'); pl.appendChild(f); wrap.appendChild(pl); strip.appendChild(wrap) }
        st.frames.forEach((src, i) => { const f = strip.children[i]!.querySelector<HTMLElement>('.g-frame')!, im = f.querySelector('img')!; if (im.getAttribute('src') !== src) { im.src = src; im.alt = `Frame ${i + 1}` } f.classList.toggle('at', i === st.looking) })
        strip.classList.toggle('more', strip.scrollWidth > strip.clientWidth + 2)
        if (st.status) P.announce(st.status)
      },
    })
    P.relayout()
  }

  P.x.home = { active: () => showing || pending, pending: () => pending }
  const wasReady = P.x.onReady as (() => void) | undefined
  P.x.onReady = () => { wasReady?.(); void probe() }
}
