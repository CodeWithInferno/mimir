// The layers that open over free stage (UI design specification 7.13 to 7.15): the command palette and the erratum at the
// left, the share list in the right column. No surface and no scrim: the stage makes room. On a phone there is no
// free stage, so each takes the whole screen over a veil of the stage's own black.
import type { Diag } from '../core/index.ts'
import type { Player } from './app.ts'
import { $, $$, button, el, key, MOD } from './dom.ts'
import { serverOffers } from './home.ts'
import { clock, D, fade, move, place, reach, setText, span, sspan, wipe } from './motion.ts'
import { escapeHtml, fileNameOf, fuzzy, fuzzyRank, PALETTE_STEPS, shareUrl, sizeText, SPEEDS, speedText } from './story.ts'

/** ms a share row shows its receipt before its fact returns (spec 7.14) */
export const RECEIPT_MS = 1400
/** lines of the scene shown round the line a diagnostic points at */
export const FRAME_LINES = 2
/** the server's route that packs the page being watched into one file (the dev server's contract) */
export const EXPORT_ROUTE = '/api/export'

interface Cmd { group: string; label: string; key?: string; state?: () => string; run(): void; /** ⌘⏎ runs it and keeps the palette open */ keep?: boolean; cur?: () => boolean; /** where it would land on the line of time */ t?: number; part?: string; /** listed before anything is typed */ always?: boolean }

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* not allowed here: try the old way */ }
  try {
    const t = el('textarea')
    t.value = text
    t.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  } catch { return false }
}

export function mountLayers(P: Player): void {
  const host = P.host
  const veil = el('div', 'm-veil')
  P.app.appendChild(veil)

  // ── command palette ──────────────────────────────────────────────────────────────────────────────
  const pal = el('div', 'm-abs m-layer m-palette', `<div class="lh"><b>Commands</b><span class="sp"></span><button type="button" class="m-word" data-x>Close</button></div><label class="m-line"><input type="text" role="combobox" aria-expanded="true" aria-controls="m-pl" aria-autocomplete="list" autocomplete="off" spellcheck="false">${key('esc')}</label><i class="pr"></i><div class="roll"><div><ol id="m-pl" role="listbox" aria-label="Commands"></ol><div class="ft"><span>${key('↑')}${key('↓')}move</span><span>${key('⏎')}run</span><span>${key(MOD().trim() + '⏎')}run and stay</span><span>${key('?')}every key</span></div></div></div>`)
  pal.setAttribute('role', 'dialog')
  pal.setAttribute('aria-label', 'Commands')
  P.app.appendChild(pal)
  const palIn = $<HTMLInputElement>('input', pal), palList = $<HTMLOListElement>('ol', pal), palRule = $('.pr', pal), palRoll = $('.roll', pal), palLine = $('.m-line', pal)
  let items: Cmd[] = [], sel = 0, everything = false, palOpener: HTMLElement | null = null, moved = false

  function commands(): Cmd[] {
    const info = P.info, out: Cmd[] = [], now = host.state().step
    const chapters = info.chapters
    const stepsShown = info.steps.length <= PALETTE_STEPS
    if (chapters.length) {
      chapters.forEach((c, ci) => {
        const own = info.steps.filter((s) => s.chapter === c.index)
        if (!stepsShown) out.push({ group: 'Chapters', label: c.title, key: ci < 9 ? String(ci + 1) : undefined, run: () => P.seek(c.t0), t: c.t0, cur: () => own.some((s) => s.index === host.state().step), always: true })
        own.forEach((s, i) => out.push({ group: c.title, label: s.title, key: stepsShown && i === 0 && ci < 9 ? String(ci + 1) : undefined, run: () => P.seek(s.t0), t: s.t0, cur: () => s.index === host.state().step, always: stepsShown }))
      })
    } else info.steps.forEach((s, i) => out.push({ group: 'Steps', label: s.title, key: i < 9 ? String(i + 1) : undefined, run: () => P.seek(s.t0), t: s.t0, cur: () => s.index === now, always: stepsShown || true }))
    const modeNow = (m: string) => (): string => (P.S.mode === m ? 'now' : '')
    out.push({ group: 'Mode', label: 'Watch', key: 'V', state: modeNow('video'), run: () => P.setMode('video') }, { group: 'Mode', label: 'Read', key: 'R', state: modeNow('read'), run: () => P.setMode('read') }, { group: 'Mode', label: 'Explore', key: 'E', state: modeNow('explore'), run: () => P.setMode('explore') })
    const ex = P.x.explore
    const looks: { channel: string; label: string }[] = ex?.looks() ?? []
    if (looks.length) {
      const pick = (v: string) => (): void => { if (P.S.mode !== 'explore') P.setMode('explore'); ex.setView(v) }
      out.push({ group: 'View', label: 'Story', state: () => (ex.view() === 'story' ? 'now' : ''), run: pick('story'), keep: true, always: true }, { group: 'View', label: 'Solid', state: () => (ex.view() === 'solid' ? 'now' : ''), run: pick('solid'), keep: true, always: true })
      for (const l of looks) out.push({ group: 'View', label: l.label, key: ex.lookKey(l.label).toUpperCase() || undefined, state: () => (ex.view() === l.channel ? 'now' : ''), run: pick(l.channel), keep: true, always: true })
    }
    if (info.has3d) for (const c of (ex?.cameras() ?? []) as string[]) out.push({ group: 'Camera', label: c[0]!.toUpperCase() + c.slice(1), state: () => (ex?.cam() === c ? 'now' : ''), run: () => { if (P.S.mode !== 'explore') P.setMode('explore'); ex?.setCam(c) }, keep: true })
    const onOff = (b: boolean): string => (b ? 'on' : 'off')
    out.push(
      { group: 'Stage', label: 'Play or pause', key: 'Space', run: () => P.setPlaying(!P.S.playing) },
      { group: 'Stage', label: 'Captions', key: 'C', state: () => onOff(P.S.captions), run: () => P.setCaptions(!P.S.captions), keep: true },
      { group: 'Stage', label: 'Voice', key: 'M', state: () => onOff(P.S.voice), run: () => P.setVoice(!P.S.voice), keep: true },
      { group: 'Stage', label: 'Loop', key: 'O', state: () => onOff(P.S.loop), run: () => P.setLoop(!P.S.loop), keep: true },
      ...SPEEDS.map((s): Cmd => ({ group: 'Stage', label: `Speed ${speedText(s)}`, state: () => (P.S.speed === s ? 'now' : ''), run: () => P.setSpeed(s), keep: true })),
      { group: 'Stage', label: 'Full screen', key: 'F', run: () => P.toggleFull() },
      { group: 'Stage', label: 'Back to the start', key: '0', run: () => { host.setView(null); P.seek(0) } },
    )
    if (P.listed.length) out.push({ group: 'Stage', label: 'Find a part', key: '/', run: () => P.x.explore?.find() })
    for (const p of P.listed) out.push({ group: p.group || 'Parts', label: p.name, part: p.id, run: () => P.x.note?.show(p.id) })
    if (P.x.ask?.available()) out.push({ group: 'Ask', label: 'Ask about this model', key: 'A', run: () => P.x.ask.toggle(true), always: true })
    for (const r of shareRows()) out.push({ group: 'Share', label: r.label, key: r.key, run: r.run, always: true })
    if (errors.length) out.push({ group: 'Scene', label: `Scene errors, ${errors.length}`, run: () => errShow(), always: true })
    if (P.home) out.push({ group: 'Mimir', label: 'All models', run: () => { location.href = homeUrl() } })
    return out
  }
  function build(): void {
    const q = palIn.value.trim()
    const all = commands()
    items = q ? all.map((c) => ({ c, r: Math.min(fuzzyRank(q, c.label), fuzzyRank(q, c.group) + 4) })).filter((x) => Number.isFinite(x.r)).sort((a, b) => a.r - b.r).map((x) => x.c) : all.filter((c) => everything ? !c.part : c.always)
    // on a phone the sheet leads with Ask and Share: it is the only way to them there
    if (!q && P.L.phone) { const lead = (c: Cmd): number => (c.group === 'Ask' ? 0 : c.group === 'Share' ? 1 : 2); items = items.map((c, i) => ({ c, i })).sort((a, b) => lead(a.c) - lead(b.c) || a.i - b.i).map((x) => x.c) }
    palList.textContent = ''
    if (!items.length) { const li = el('li', 'none'); li.textContent = `Nothing called “${q}”.`; palList.appendChild(li); return }
    let last: string | null = null
    items.forEach((c, i) => {
      const first = !q && c.group !== last
      if (first && P.L.phone) { const gh = el('li', 'gh'); gh.textContent = c.group; gh.setAttribute('role', 'presentation'); palList.appendChild(gh) }
      const li = el('li', first && i > 0 && !P.L.phone ? 'gap' : '')
      li.id = 'm-pl-' + i
      li.setAttribute('role', 'option')
      li.dataset.i = String(i)
      if ((first || q) && !P.L.phone) { const g = el('span', 'grp'); g.textContent = c.group; li.appendChild(g) }
      const lb = el('span', 'lb'), marks = new Set(q ? fuzzy(q, c.label) ?? [] : [])
      lb.innerHTML = [...c.label].map((ch, k) => (marks.has(k) ? `<b>${escapeHtml(ch)}</b>` : escapeHtml(ch))).join('')
      li.appendChild(lb)
      const st = c.state?.()
      if (st) { const s = el('i', 'stt'); s.textContent = st; li.appendChild(s) }
      if (c.key && !P.coarse) li.insertAdjacentHTML('beforeend', key(c.key))
      if (c.cur?.()) li.classList.add('cur')
      last = c.group
      palList.appendChild(li)
    })
    mark()
  }
  function mark(): void {
    $$('li[role=option]', palList).forEach((li) => li.setAttribute('aria-selected', String(!P.L.phone && Number(li.dataset.i) === sel)))
    const cur = palList.querySelector<HTMLElement>('li[aria-selected=true]')
    if (cur) { palIn.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }) }
    // a row shows where it would land before it is run: a hollow dot on the line, the part lit on the stage
    const c = moved ? items[sel] : undefined
    P.x.ghost(c && c.t !== undefined && !P.coarse ? c.t : null)
    if (c?.part && !P.coarse) P.setHover(c.part, 'palette'); else if (P.S.hoverFrom === 'palette') P.setHover(null, 'palette')
  }
  function runSel(stay: boolean): void {
    const c = items[sel]
    if (!c) return
    if (stay && c.keep) { c.run(); build(); return }
    palHide()
    c.run()
  }
  function palShow(all = false): void {
    if (P.run.target('palette') > 0.5) { if (all !== everything) { everything = all; build() } return }
    palOpener = P.invoker() // opened by a key from nowhere, it gives the focus back to nowhere: Space then still plays
    P.x.share?.hide()
    everything = all
    palIn.value = ''
    palIn.placeholder = P.L.phone ? 'Search' : 'Jump to a step, change the view, export…'
    moved = false
    build()
    sel = Math.max(0, items.findIndex((c) => c.cur?.()))
    mark()
    P.run.to('palette', 1, P.ms(P.L.phone ? D.layerPhone : D.palette), { turn: true })
    $('[data-a=palette]', P.app).setAttribute('aria-expanded', 'true')
    P.restage(D.palette)
    if (!P.L.phone) P.focusSoon(palIn) // on a phone nothing raises the keyboard until the field is tapped
    P.touch()
  }
  function palHide(): void {
    if (P.run.target('palette') < 0.5) return
    P.run.to('palette', 0, P.ms(P.L.phone ? D.layerPhoneClose : D.paletteClose), { turn: true })
    $('[data-a=palette]', P.app).setAttribute('aria-expanded', 'false')
    P.x.ghost(null)
    if (P.S.hoverFrom === 'palette') P.setHover(null, 'palette')
    P.restage(D.paletteClose)
    if (pal.contains(document.activeElement)) P.refocus(palOpener)
    palOpener = null
    P.touch()
  }
  palIn.addEventListener('input', () => { sel = 0; moved = true; build() })
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moved = true; sel = Math.min(items.length - 1, Math.max(0, sel + (e.key === 'ArrowDown' ? 1 : -1))); mark() }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(e.metaKey || e.ctrlKey) }
    else if (e.key === 'Tab') e.preventDefault() // the focus stays on the line
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); palHide() }
    else if (e.key === '?' && !palIn.value) { e.preventDefault(); everything = true; build() }
  })
  palList.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[role=option]'); if (li) { sel = Number(li.dataset.i); runSel(false) } })
  palList.addEventListener('pointermove', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[role=option]'); if (li && Number(li.dataset.i) !== sel) { sel = Number(li.dataset.i); moved = true; mark() } })
  $('[data-x]', pal).addEventListener('click', palHide)

  // ── share ────────────────────────────────────────────────────────────────────────────────────────
  const share = el('div', 'm-abs m-layer m-share', `<div class="lh"><b>Share</b><span class="sp"></span><button type="button" class="m-word" data-x>Close</button></div><div class="roll"><div><div class="url"><code></code><button type="button" role="menuitem" data-k="link">Copy link</button></div><button type="button" class="m-switch rw" id="m-shAt" role="menuitemcheckbox" aria-checked="true"><span class="nm"></span><i class="st"></i><span class="tr"></span></button><div data-rows></div></div></div>`)
  share.setAttribute('role', 'menu')
  share.setAttribute('aria-label', 'Share')
  P.app.appendChild(share)
  const shUrl = $('.url code', share), shAt = $('#m-shAt', share), shRows = $('[data-rows]', share), shRoll = $('.roll', share), shCopy = $<HTMLButtonElement>('[data-k=link]', share)
  let shOpener: HTMLElement | null = null, source: string | null = null, exportBytes: number | null = null, canExport = false
  const sceneParam = (): string => new URLSearchParams(location.search).get('scene') ?? ''
  const exportUrl = (): string => `${EXPORT_ROUTE}?scene=${encodeURIComponent(sceneParam())}`
  const homeUrl = (): string => location.pathname
  const link = (): string => shareUrl(location.href, shAt.getAttribute('aria-checked') === 'true' ? host.state().tau : null)
  const receipt = (row: HTMLElement, text: string): void => {
    const f = $('.f', row) ?? row
    const back = f.dataset.f ?? f.textContent ?? ''
    f.dataset.f = back
    setText(f, text)
    row.classList.add('done')
    P.announce(text)
    setTimeout(() => { setText(f, back); row.classList.remove('done') }, RECEIPT_MS)
  }
  const copyLink = async (): Promise<void> => { const ok = await copyText(link()); const was = shCopy.textContent; setText(shCopy, ok ? 'Copied' : 'Could not copy'); P.announce(ok ? 'Link copied' : 'Could not copy the link'); setTimeout(() => setText(shCopy, was ?? 'Copy link'), RECEIPT_MS) }
  const download = (row?: HTMLElement): void => {
    const a = el('a')
    a.href = exportUrl()
    a.download = fileNameOf(P.info.title)
    a.click()
    if (row) receipt(row, `Saved ${a.download}`)
  }
  const copySource = async (row?: HTMLElement): Promise<void> => { if (source === null) return; const ok = await copyText(source), n = source.split('\n').length; if (row) receipt(row, ok ? `Copied ${n} lines` : 'Could not copy'); else P.announce(ok ? `Copied ${n} lines` : 'Could not copy') }
  /** the rows that can really be done here: a page with no server behind it has no download, an unreadable scene no source */
  function shareRows(): { k: string; label: string; what: string; fact: string; key?: string; run(row?: HTMLElement): void }[] {
    const rows: { k: string; label: string; what: string; fact: string; key?: string; run(row?: HTMLElement): void }[] = []
    if (canExport) rows.push({ k: 'html', label: 'Download as one HTML file', what: 'Opens anywhere, needs no network', fact: exportBytes ? sizeText(exportBytes) : '', run: download })
    if (source !== null) rows.push({ k: 'scene', label: 'Copy the scene file', what: 'Paste it to your agent to edit', fact: `${source.split('\n').length} lines`, run: (row) => void copySource(row) })
    rows.push({ k: 'link', label: `Copy link at ${clock(host.state().tau)}`, what: '', fact: '', run: () => void copyLink() })
    return rows
  }
  function shBuild(): void {
    shRows.textContent = ''
    for (const r of shareRows().filter((x) => x.k !== 'link')) {
      const b = button('shrow', '<span class="t"></span><span class="c"></span><span class="f"></span>', { role: 'menuitem' })
      b.dataset.k = r.k
      b.children[0]!.textContent = r.label
      b.children[1]!.textContent = r.what
      b.children[2]!.textContent = r.fact
      b.addEventListener('click', () => r.run(b))
      shRows.appendChild(b)
    }
  }
  function shSync(): void {
    setText(shUrl, link().replace(/^https?:\/\//, ''))
    const st = P.info.steps[host.state().step - 1]
    setText($('.nm', shAt), `Start at ${clock(host.state().tau)}${st ? `, in ${st.title}` : ''}`)
  }
  function shShow(): void {
    if (P.run.target('share') > 0.5) return
    shOpener = P.invoker()
    if (P.S.note) P.x.note.hide()
    P.x.ask?.hide()
    palHide()
    shBuild()
    shSync()
    P.run.to('share', 1, P.ms(P.L.phone ? D.layerPhone : D.share), { turn: true })
    $('[data-a=share]', P.app).setAttribute('aria-expanded', 'true')
    P.restage(D.share)
    if (shOpener?.matches(':focus-visible')) P.focusSoon(shCopy)
    P.touch()
  }
  function shHide(): void {
    if (P.run.target('share') < 0.5) return
    P.run.to('share', 0, P.ms(P.L.phone ? D.layerPhoneClose : D.shareClose), { turn: true })
    $('[data-a=share]', P.app).setAttribute('aria-expanded', 'false')
    P.restage(D.shareClose)
    if (share.contains(document.activeElement)) P.refocus(shOpener)
    shOpener = null
    P.touch()
  }
  shCopy.addEventListener('click', () => void copyLink())
  shAt.addEventListener('click', () => { shAt.setAttribute('aria-checked', String(shAt.getAttribute('aria-checked') !== 'true')); shSync() })
  share.addEventListener('keydown', (e) => {
    const all = $$('button:not([data-x])', share), i = all.indexOf(e.target as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus() }
  })
  share.addEventListener('focusout', (e) => { const to = e.relatedTarget as Node | null; if (to && !share.contains(to) && P.run.target('share') > 0.5 && !P.L.phone) shHide() }) // tabbing out of the list closes it
  $('[data-x]', share).addEventListener('click', shHide)
  /** What this page can really offer: a server that packs it, a scene file that can be read. */
  async function probe(): Promise<void> {
    if (/^https?:$/.test(location.protocol) && sceneParam() && serverOffers('export')) {
      try { const r = await fetch(exportUrl(), { method: 'HEAD' }); canExport = r.ok; const n = Number(r.headers.get('content-length')); exportBytes = r.ok && n > 0 ? n : null } catch { canExport = false }
    }
    // the scene file can be read where a server serves it; an exported page holds it as a module and asks for nothing
    if (P.info.file && /^https?:/.test(P.info.file) && /^https?:$/.test(location.protocol)) { try { const r = await fetch(P.info.file); source = r.ok ? await r.text() : null } catch { source = null } }
    if (P.run.target('share') > 0.5) shBuild()
    errFrame()
  }

  // ── erratum: what the engine says is wrong with the scene, for its author ──────────────────────────
  const err = el('div', 'm-abs m-layer m-erratum', `<div class="lh"><b>Scene error</b><span class="sp"></span><button type="button" class="m-word" data-x>Close</button></div><div class="bar"></div><div class="roll"><div><div class="loc"><span><span data-n></span><span class="nav"><button type="button" class="m-word" data-d="-1">Previous</button><button type="button" class="m-word" data-d="1">Next</button></span></span><code title="Copy the location"></code></div><h3 id="m-errH"></h3><p class="what"></p><pre></pre><div class="fixes"></div><div class="acts"><button type="button" class="m-word pri" data-e="fix"><span>Copy the fix</span>${key('⏎')}</button><button type="button" class="m-word" data-e="agent">Copy for the agent</button><button type="button" class="m-word" data-e="x">Dismiss${key('esc')}</button></div><p class="say" role="status"></p></div></div>`)
  err.setAttribute('role', 'alertdialog')
  err.setAttribute('aria-labelledby', 'm-errH')
  P.app.appendChild(err)
  const eN = $('[data-n]', err), eNav = $('.nav', err), eLoc = $('.loc code', err), eH = $('h3', err), eWhat = $('.what', err), ePre = $('pre', err), eFix = $('.fixes', err), eSay = $('.say', err), eBar = $('.bar', err), eRoll = $('.roll', err), eUse = $('[data-e=fix]', err)
  let errors: Diag[] = [], at = 0, pick = 0, errOpener: HTMLElement | null = null, errResume = false, errH = 0
  const short = (file: string | null | undefined): string => (file ? decodeURIComponent(file.split(/[\\/]/).pop() ?? file).replace(/[?#].*$/, '') : 'scene')
  function errFrame(): void {
    const d = errors[at]
    ePre.textContent = ''
    ePre.hidden = true
    if (!d || !source || !d.line) return
    const lines = source.split('\n'), a = Math.max(1, d.line - FRAME_LINES), b = Math.min(lines.length, d.line + FRAME_LINES)
    for (let n = a; n <= b; n++) {
      const row = el('span', n === d.line ? 'cur' : ''), ln = el('span', 'ln')
      ln.textContent = String(n)
      row.append(ln, lines[n - 1] ?? '')
      ePre.append(row, '\n')
    }
    ePre.hidden = false
  }
  function errFill(): void {
    const d = errors[at]
    if (!d) return
    setText(eN, `Scene error, ${at + 1} of ${errors.length}`)
    eNav.hidden = errors.length < 2
    setText(eLoc, `${short(d.file ?? P.info.file)}${d.line ? ':' + d.line : ''}`)
    eH.innerHTML = `<span class="code">${escapeHtml(d.code)}</span>${escapeHtml(d.what).replace(/&quot;([^&]+)&quot;|#([\w.-]+)/g, (m) => `<code>${m}</code>`)}`
    const st = d.step ? P.info.steps[d.step - 1] : undefined
    setText(eWhat, st ? `Step ${st.index}, ${st.title}${d.t !== null && d.t !== undefined ? `, at ${clock(d.t)}` : ''}.` : '')
    eWhat.hidden = !st
    eFix.textContent = ''
    const fixes = d.fix ?? []
    if (fixes.length) { const head = el('span'); head.textContent = fixes.length > 1 ? 'One of these fixes it' : 'This fixes it'; eFix.appendChild(head) }
    pick = 0
    fixes.forEach((f, i) => {
      const b = button('cand', '<code></code>', { 'aria-pressed': String(i === 0) })
      b.children[0]!.textContent = f
      b.addEventListener('click', () => { pick = i; $$('.cand', eFix).forEach((c, k) => c.setAttribute('aria-pressed', String(k === i))) })
      eFix.appendChild(b)
    })
    eUse.hidden = !fixes.length
    setText(eSay, '')
    errFrame()
    errH = 0
  }
  function errShow(): void {
    if (!errors.length || P.run.target('error') > 0.5) return
    errOpener = P.invoker()
    palHide()
    shHide()
    errFill()
    if (P.S.playing) { errResume = true; P.setPlaying(false) }
    P.run.to('error', 1, P.ms(P.L.phone ? D.layerPhone : D.error), { turn: true })
    P.restage(D.error)
    P.focusSoon(eUse.hidden ? $<HTMLElement>('[data-e=agent]', err) : eUse)
    P.touch()
  }
  function errHide(): void {
    if (P.run.target('error') < 0.5) return
    P.run.to('error', 0, P.ms(P.L.phone ? D.layerPhoneClose : D.errorClose), { turn: true })
    P.restage(D.errorClose)
    if (err.contains(document.activeElement)) P.refocus(errOpener)
    errOpener = null
    if (errResume) { errResume = false; P.setPlaying(true) }
    P.touch()
  }
  err.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-e], [data-d], [data-x], code[title]'), d = errors[at]
    if (!t || !d) return
    if (t.dataset.d) { at = (at + Number(t.dataset.d) + errors.length) % errors.length; errFill() }
    else if (t.dataset.e === 'x' || t.hasAttribute('data-x')) errHide()
    else if (t.dataset.e === 'fix') void copyText(d.fix?.[pick] ?? '').then((ok) => setText(eSay, ok ? 'Copied the fix.' : 'Could not copy.'))
    else if (t.dataset.e === 'agent') void copyText(JSON.stringify({ code: d.code, severity: d.severity, file: short(d.file ?? P.info.file), line: d.line ?? null, step: d.step ?? null, ids: d.ids ?? [], what: d.what, fix: d.fix ?? [] }, null, 1)).then((ok) => setText(eSay, ok ? 'Copied for the agent.' : 'Could not copy.'))
    else if (t.matches('code[title]')) void copyText(eLoc.textContent ?? '').then((ok) => setText(eSay, ok ? 'Copied the location.' : 'Could not copy.'))
  })
  err.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); errHide(); return }
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) { eUse.click(); return }
    if (e.key !== 'Tab') return
    // it holds the focus: Tab goes round inside it
    const all = $$<HTMLElement>('button, [href]', err).filter((n) => n.offsetParent !== null), i = all.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus()
  })

  P.x.palette = { open: () => P.run.target('palette') > 0.5, toggle: (all = false) => (P.run.target('palette') > 0.5 && !all ? palHide() : palShow(all)), hide: palHide }
  P.x.share = { open: () => P.run.target('share') > 0.5, toggle: () => (P.run.target('share') > 0.5 ? shHide() : shShow()), hide: shHide }
  P.x.erratum = { open: () => P.run.target('error') > 0.5, hide: errHide, show: errShow, count: () => errors.length }
  const wasReady = P.x.onReady as (() => void) | undefined
  P.x.onReady = () => {
    wasReady?.()
    void probe()
    // what the build recorded, without sampling anything: the errors an author has to see before the story plays
    void host.diagnostics({ static: true }).then((all) => {
      errors = all.filter((d) => d.severity === 'error')
      if (P.info.fatal && !errors.length) errors = [{ code: 'RUNTIME-ERROR', severity: 'error', what: P.info.fatal.message, fix: [], file: P.info.fatal.file, line: P.info.fatal.line, ids: [], step: null, t: null } as unknown as Diag]
      if (errors.length && !P.x.home?.active()) errShow()
    })
  }
  P.add({
    open: () => P.run.target('palette') > 0.5 || P.run.target('share') > 0.5 || P.run.target('error') > 0.5,
    layout() {
      const L = P.L
      for (const n of [pal, share, err]) n.classList.toggle('full', L.phone)
      pal.style.width = err.style.width = L.layerW + 'px'
      share.style.width = L.noteW + 'px'
      palList.style.maxHeight = L.phone ? '' : Math.max(120, L.axisY - 60 - L.yPalette - 60 - 72) + 'px'
      P.root.style.setProperty('--gutter-pal', (L.phone ? 0 : Math.round(150 * L.k)) + 'px')
      if (P.run.target('palette') > 0.5) build()
    },
    draw() {
      const L = P.L, p = P.v('palette'), s = P.v('share'), e = P.v('error')
      const full = L.phone, top = Math.max(p, s, e)
      fade(veil, full ? span(top, 0, 0.5) : 0)
      veil.style.pointerEvents = full && top > 0.5 ? 'auto' : 'none'
      // the palette: its line, the rule drawn from the left, the list unrolled from the rule (spec 8.11)
      reach([pal], P.run.target('palette') > 0.5)
      if (!full) place(pal, L.mx, L.yPalette)
      else place(pal, 0, 0)
      fade(pal, p > 0.001 ? 1 : 0)
      fade(palLine, P.RM ? p : span(p, 0, 0.3))
      palRule.style.transform = `scaleX(${(P.RM ? 1 : sspan(p, 0, 0.45)).toFixed(4)})`
      fade(palRule, p > 0.001 ? 1 : 0)
      wipe(palRoll, P.RM ? 1 : move(span(p, 0.2, 1)), 'top')
      fade(palRoll, P.RM ? p : span(p, 0.2, 0.5))
      palList.classList.toggle('m-runs-on', palList.scrollTop + palList.clientHeight < palList.scrollHeight - 3)
      // share: unrolls from the first baseline of the right column
      reach([share], P.run.target('share') > 0.5)
      place(share, full ? 0 : L.noteX, full ? 0 : L.yShare)
      fade(share, P.RM ? s : span(s, 0, 0.4))
      wipe(shRoll, P.RM ? 1 : move(s), 'top')
      if (s > 0.001) shSync()
      // the erratum: the red rule draws, then the sheet unrolls from it
      reach([err], P.run.target('error') > 0.5)
      if (e > 0.001 && !errH) errH = err.offsetHeight // measured once per opening, never per frame
      if (e <= 0.001) errH = 0
      place(err, full ? 0 : L.mx, full ? 0 : Math.max(L.first - 20, Math.round((L.axisY - 60 + L.top) / 2 - errH / 2)))
      fade(err, e > 0.001 ? 1 : 0)
      eBar.style.transform = `scaleX(${(P.RM ? 1 : sspan(e, 0, 0.5)).toFixed(4)})`
      wipe(eRoll, P.RM ? 1 : move(span(e, 0.2, 1)), 'top')
      fade(eRoll, P.RM ? e : span(e, 0.2, 0.5))
    },
  })
}
