// The real player, driven in headless Chrome with real key, mouse and touch events (raw CDP, as the CLI does).
// Every test opens the built viewer on tests/e2e/scenes/player/tour.scene.js and asserts what a person would see or
// be able to do: it plays by itself, the chrome sleeps and wakes, keys and the line of time seek exactly, read and
// explore are generated from the scene, layers take and return the focus, a phone gets 44 px targets.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchChrome } from '../../src/cli/chrome.ts'
import { drive, FIXTURE, MOD, ROOT, type Drive } from '../unit/player/drive.ts'

const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(FIXTURE)
const T = 180_000 // the first test may build dist
const WORK = mkdtempSync(join(tmpdir(), 'mimir-player-'))
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const tau = (d: Drive): Promise<number> => d.ev<number>('__mimir.state().tau')
const step = (d: Drive): Promise<number> => d.ev<number>('__mimir.state().step')
const settled = (d: Drive, ms = 700): Promise<void> => d.wait(ms) // longer than any warp or layer motion
const opacity = (d: Drive, sel: string): Promise<number> => d.ev<number>(`Number(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity)`)
const text = (d: Drive, sel: string): Promise<string> => d.ev<string>(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').trim()`)
const shown = (d: Drive, sel: string): Promise<boolean> => d.ev<boolean>(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n || n.closest('[inert]') || n.hidden) return false; const s = getComputedStyle(n); return s.visibility !== 'hidden' && Number(s.opacity) > 0.5 && n.getClientRects().length > 0 })()`)
const steps = (d: Drive): Promise<{ t0: number; t1: number; title: string }[]> => d.ev('__mimir.info().steps.map((s) => ({ t0: s.t0, t1: s.t1, title: s.title }))')
async function with1<R>(o: Parameters<typeof drive>[0], fn: (d: Drive) => Promise<R>): Promise<R> {
  const d = await drive(o)
  try { return await fn(d) } finally { await d.close() }
}

describe.skipIf(!HAVE)('the player', () => {
  test('it is a video: it plays by itself, the chrome sleeps while it plays and returns on pointer movement', async () => {
    await with1({}, async (d) => {
      await d.open()
      await d.wait(600)
      const a = await tau(d)
      expect(a).toBeGreaterThan(0.2) // nobody pressed play
      expect(await d.ev('document.querySelector("[data-a=play]").getAttribute("aria-label")')).toBe('Pause')
      expect(await d.ev('document.title')).toBe('How a crank turns a slider · Mimir')
      await d.wait(2900) // 2.2 s without input, then the 400 ms fade
      expect(await opacity(d, '.m-top')).toBeLessThan(0.02)
      expect(await d.ev('document.querySelector(".m-top").inert && document.querySelector(".nl").inert')).toBe(true) // what is not visible is not reachable
      expect(await d.ev('document.querySelector(".m-root").classList.contains("nocur")')).toBe(true)
      expect(await tau(d)).toBeGreaterThan(a + 2)
      await d.move(700, 400)
      await d.wait(350)
      expect(await opacity(d, '.m-top')).toBeGreaterThan(0.98)
      expect(await d.ev('document.querySelector(".m-top").inert')).toBe(false)
      // the stage is one black: the page, the slot and the frame
      expect(await d.ev('getComputedStyle(document.querySelector(".m-root")).backgroundColor')).toBe('rgb(0, 0, 0)')
      expect(d.errors).toEqual([])
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual([]) // a plain server is asked for nothing
    })
  }, T)

  test('nothing autoplays under reduced motion, or when the address says so; the story still plays when asked', async () => {
    await with1({}, async (d) => {
      await d.open('rm=1')
      await d.wait(500)
      expect(await tau(d)).toBe(0)
      await d.key(' ')
      await d.wait(500)
      expect(await tau(d)).toBeGreaterThan(0.2)
      await d.key('r') // a change of mode is a dissolve: the stage is at its place in the next frame
      await d.wait(60)
      expect(await d.ev('document.querySelector(".m-slot").style.transform')).toBe('')
      await d.open('play=0&t=7')
      await d.wait(300)
      expect(await tau(d)).toBe(7)
    })
  }, T)

  test('a page the dev server reloads comes back holding its moment; a refresh by hand plays on', async () => {
    await with1({}, async (d) => {
      await d.open()
      await d.wait(400)
      // what `mimir open` does when the scene file changes: the same address, with the moment in it
      await d.ev('(() => { window.__old = true; const u = new URL(location.href); u.searchParams.set("t", "7"); location.replace(u) })()')
      await d.until('!window.__old && window.__mimir')
      await d.ev('window.__mimir.ready.then(() => 1)')
      await d.wait(500)
      expect(await tau(d)).toBe(7)
      expect(await d.ev('document.querySelector("[data-a=play]").getAttribute("aria-label")')).toBe('Play')
      await d.key(' ')
      await d.wait(300)
      await d.ev('window.__old = true')
      await d.page.send('Page.reload')
      await d.until('!window.__old && window.__mimir')
      await d.ev('window.__mimir.ready.then(() => 1)')
      await d.wait(600)
      expect(await tau(d)).toBeGreaterThan(7.2) // it was playing, the reader refreshed: it plays
    })
  }, T)

  test('keys: space, arrows by step and chapter, digits, 0, speed, captions, voice, loop, modes', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      const st = await steps(d)
      await d.key('ArrowRight')
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[1]!.t0, 5)
      await d.key('ArrowRight'); await d.key('ArrowRight') // two presses are two steps, even while the first is still running
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[3]!.t0, 5)
      await d.key('ArrowLeft', MOD.shift) // previous chapter: the start of this one
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[2]!.t0, 5)
      await d.key('3')
      await settled(d)
      expect(await step(d)).toBe(5)
      await d.key('0')
      await settled(d)
      expect(await tau(d)).toBe(0)
      expect(await d.ev('document.querySelector("[data-a=prev]").getAttribute("aria-disabled")')).toBe('true')
      await d.key('End')
      await settled(d)
      expect(await d.ev('document.querySelector("[data-a=next]").getAttribute("aria-disabled")')).toBe('true')
      await d.key(' ') // at the end, play starts again from the beginning
      await d.wait(400)
      expect(await tau(d)).toBeLessThan(2)
      await d.key(' ')
      const paused = await tau(d)
      await d.wait(300)
      expect(await tau(d)).toBe(paused)
      await d.key(']')
      expect(await text(d, '[data-a=speed]')).toBe('1.5×')
      await d.key('['); await d.key('[')
      expect(await text(d, '[data-a=speed]')).toBe('0.5×')
      for (const [k, a] of [['c', 'captions'], ['m', 'voice'], ['o', 'loop']] as const) {
        const before = await d.ev<string>(`document.querySelector('[data-a=${a}]').getAttribute('aria-checked')`)
        await d.key(k)
        expect(await d.ev<string>(`document.querySelector('[data-a=${a}]').getAttribute('aria-checked')`)).toBe(before === 'true' ? 'false' : 'true')
        await d.key(k)
      }
      for (const [k, m] of [['r', 'read'], ['e', 'explore'], ['v', 'video']] as const) {
        await d.key(k)
        expect(await d.ev('document.querySelector(".m-root").dataset.mMode')).toBe(m)
        expect(await d.ev(`document.querySelector('.m-top [data-mode=${m}]').getAttribute('aria-checked')`)).toBe('true')
      }
      expect(d.errors).toEqual([])
    })
  }, T)

  test('subtitles: the toggle switches the captions the stage sets, and read mode never shows them', async () => {
    await with1({}, async (d) => {
      await d.open('play=0&t=3')
      await d.wait(300)
      const cap = 'document.querySelector(\'[data-overlay="guide.caption"] > div\')'
      expect(await d.ev(`getComputedStyle(${cap}).display`)).not.toBe('none')
      expect(await d.ev(`${cap}.textContent`)).toContain('turning becomes sliding')
      await d.key('c')
      await d.wait(200)
      expect(await d.ev(`getComputedStyle(${cap}).display`)).toBe('none')
      await d.key('c')
      await d.wait(200)
      expect(await d.ev(`getComputedStyle(${cap}).display`)).not.toBe('none')
      await d.key('r')
      await settled(d)
      expect(await d.ev(`getComputedStyle(${cap}).display`)).toBe('none')
    })
  }, T)

  test('the line of time: a drag scrubs to the exact moment, ticks take hold, the hover names the step', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      const info = await d.ev<{ duration: number }>('({ duration: __mimir.info().duration })'), st = await steps(d)
      const g = await d.ev<{ x0: number; x1: number; y: number }>('(() => { const a = document.querySelector(".nl-axis").getBoundingClientRect(); return { x0: a.left, x1: a.right, y: a.top } })()')
      const xAt = (t: number): number => g.x0 + ((g.x1 - g.x0) * t) / info.duration
      const t = st[1]!.t0 + 2.5
      await d.drag(xAt(1), g.y, xAt(t), g.y)
      expect(await tau(d)).toBeCloseTo(t, 1) // within a pixel of the pointer
      await d.drag(xAt(1), g.y, xAt(st[2]!.t0) + 3, g.y) // 3 px from a tick: the tick takes hold
      expect(await tau(d)).toBeCloseTo(st[2]!.t0, 6)
      const before = await d.page.screenshot()
      await d.drag(xAt(1), g.y, xAt(t), g.y)
      await d.drag(xAt(20), g.y, xAt(st[2]!.t0) + 3, g.y)
      await d.wait(200)
      expect(Buffer.from(await d.page.screenshot()).equals(Buffer.from(before))).toBe(true) // the same moment, reached another way, is the same picture
      await d.move(xAt(st[3]!.t0 + 1), g.y)
      await d.wait(150)
      expect(await text(d, '.nl-tip')).toBe(`One turn, ${st[3]!.title}0:${String(Math.floor(st[3]!.t0 + 1)).padStart(2, '0')}`)
      expect(await d.ev('document.querySelector(".nl").getAttribute("aria-valuetext")')).toMatch(/^One turn, Half a turn, 0:\d\d of 0:\d\d$/)
      // with the keyboard: the line is a slider
      await d.ev('document.querySelector(".nl").focus()')
      await d.key('Home')
      await d.key('ArrowRight')
      await d.wait(100)
      expect(await tau(d)).toBe(5)
      await d.key('PageDown') // by step
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[1]!.t0, 5)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('read: the whole explanation as a column, the step being told marked, click to jump, words that name parts', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      const st = await steps(d)
      await d.key('r')
      await settled(d, 900)
      expect(await shown(d, '.m-read')).toBe(true)
      expect(await text(d, '.m-read h2')).toBe('How a crank turns a slider')
      expect(await d.ev('[...document.querySelectorAll(".m-read .ch .t")].map((n) => n.textContent)')).toEqual(['Meet the parts', 'One turn', 'Why it matters'])
      expect(await d.ev('document.querySelectorAll(".m-read .st").length')).toBe(st.length) // one paragraph per step
      expect(await d.ev('[...document.querySelectorAll(".m-read .st .run")].map((n) => n.textContent)')).toEqual(st.map((s) => s.title + '.'))
      expect(await d.ev('document.querySelector(".m-read .aside strong").textContent')).toBe('crank radius') // st.note, only here
      expect(await d.ev('document.querySelector(".m-read .st[aria-current=step]").dataset.step')).toBe('1')
      // the stage stands beside the column, a gutter away, and nothing overlaps
      const box = await d.ev<{ col: number; stage: number }>('({ col: document.querySelector(".m-read").getBoundingClientRect().right, stage: document.querySelector(".mimir-stage").getBoundingClientRect().left })')
      expect(box.stage - box.col).toBeGreaterThanOrEqual(56)
      await d.clickOn('.m-read .st[data-step="4"] .run')
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[3]!.t0, 5)
      expect(await d.ev('document.querySelector(".m-read .st[aria-current=step]").dataset.step')).toBe('4')
      // a word that names a part carries its colour, lights it, and sends the story to where the pointer rests on it
      const lk = '.m-read .st[data-step="2"] .lk'
      expect(await text(d, lk)).toBe('crank pin')
      expect(await d.ev(`document.querySelector(${JSON.stringify(lk)}).getAttribute('aria-label')`)).toBe('crank pin: show Crank pin')
      expect(await d.ev(`getComputedStyle(document.querySelector(${JSON.stringify(lk)})).color`)).not.toBe('rgb(221, 221, 221)')
      await d.ev(`document.querySelector(${JSON.stringify(lk)}).scrollIntoView({ block: 'center' })`)
      await d.wait(150)
      await d.clickOn(lk)
      await settled(d)
      const at = await tau(d)
      expect(at).toBeGreaterThan(st[1]!.t0)
      expect(at).toBeLessThan(st[1]!.t1)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('explore: controls generated from the scene\'s parameters; hidden ones stay hidden; only the track drags', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      await d.key('e')
      await settled(d, 900)
      expect(await d.ev('[...document.querySelectorAll(".m-given .gv-p .gn")].map((n) => n.textContent)')).toEqual(['Running', 'Geometry'])
      expect(await d.ev('[...document.querySelectorAll(".m-given .m-param .nm")].map((n) => n.textContent)')).toEqual(['Crank angle', 'Crank radius']) // `tilt` is hidden
      expect(await d.ev('document.querySelector(".m-given").textContent.includes("tilt")')).toBe(false)
      expect(await text(d, '.m-given .m-param:nth-of-type(1) .vl')).toBe('40°')
      const radius = '.m-given .gv-g:nth-child(2) .m-param'
      expect(await text(d, `${radius} .vl`)).toBe('1.6m')
      const tr = await d.ev<{ x: number; y: number; w: number }>(`(() => { const r = document.querySelector(${JSON.stringify(radius + ' .tr')}).getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width } })()`)
      await d.click(tr.x + 20, tr.y - 30) // the name does nothing
      expect(await d.ev('__mimir.state().overridden')).toEqual([])
      await d.drag(tr.x + tr.w * 0.6, tr.y, tr.x + tr.w * 0.9, tr.y)
      expect(await d.ev('__mimir.state().params.radius')).toBe(1.9) // snapped to the step
      expect(await d.ev('__mimir.state().overridden')).toEqual(['radius'])
      expect(await text(d, `${radius} .vl`)).toBe('1.9m')
      expect(await d.ev(`document.querySelector(${JSON.stringify(radius)}).classList.contains('off')`)).toBe(true) // reset shows only now
      // a single key still works after a drag: a pointer never leaves the focus in a slider
      await d.key(' ')
      await d.wait(300)
      expect(await tau(d)).toBeGreaterThan(0)
      await d.key(' ')
      await d.clickOn(`${radius} .rs`)
      await settled(d)
      expect(await d.ev('__mimir.state().overridden')).toEqual([])
      expect(await d.ev('__mimir.state().params.radius')).toBe(1.6)
      // a switch and a choice
      await d.clickOn('.m-given .m-switch[role=switch]')
      expect(await d.ev('__mimir.state().params.trace')).toBe(true)
      await d.clickOn('.m-given .pick [data-v=brass]')
      expect(await d.ev('__mimir.state().params.metal')).toBe('brass')
      // leaving explore gives the story its parameters back
      await d.key('v')
      await settled(d)
      expect(await d.ev('__mimir.state().overridden')).toEqual([])
      expect(d.errors).toEqual([])
    })
  }, T)

  test('explore: the view and the camera of a 3D scene, one choice each; the parts as a list to search', async () => {
    await with1({}, async (d) => {
      await d.open('play=0&t=2')
      await d.key('e')
      await settled(d, 900)
      await d.clickOn('.m-tabs [data-tab=view]')
      await d.wait(200)
      expect(await d.ev('[...document.querySelectorAll(".gv-v [role=radiogroup][aria-label=View] button")].map((n) => n.textContent)')).toEqual(['Story', 'Solid', 'Ghost', 'Section', 'Exploded'])
      const plain = Buffer.from(await d.page.screenshot())
      for (const name of ['ghost', 'cutaway', 'explode']) {
        await d.clickOn(`.gv-v [data-v=${name}]`)
        await settled(d, 1200)
        expect(await d.ev(`document.querySelector('.gv-v [data-v=${name}]').getAttribute('aria-checked')`)).toBe('true')
        expect(Buffer.from(await d.page.screenshot()).equals(plain)).toBe(false) // the model really changed
      }
      await d.clickOn('.gv-v [data-v=story]')
      await settled(d, 400)
      await d.clickOn('.gv-v [role=radiogroup][aria-label=Camera] [data-v=front]')
      await settled(d, 1000)
      const cam = await d.ev<{ azimuth: number; elevation: number }>('__mimir.camera()')
      expect(Math.abs(cam.azimuth)).toBeLessThan(0.01)
      expect(Math.abs(cam.elevation)).toBeLessThan(0.01)
      // parts
      await d.clickOn('.m-tabs [data-tab=parts]')
      await d.wait(200)
      expect(await text(d, '.m-index .cnt')).toBe('7')
      await d.key('/')
      await d.type('sli')
      expect(await text(d, '.m-index .cnt')).toBe('1 of 7')
      expect(await d.ev('[...document.querySelectorAll(".m-index .row .lb b")].map((n) => n.textContent).join("")')).toBe('Sli') // the matched letters
      await d.key('Escape') // the first Esc clears what was typed
      expect(await text(d, '.m-index .cnt')).toBe('7')
      await d.type('zzz')
      expect(await text(d, '.m-index .none')).toContain('No part called “zzz”.')
      await d.key('Escape')
      const row = await d.ev<{ x: number; y: number }>('(() => { const r = document.querySelector(".m-index .row[data-part=slider]").getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 } })()')
      await d.move(row.x, row.y)
      await d.wait(200)
      expect(await d.ev('document.querySelector(".m-index .row[data-part=slider]").classList.contains("hot")')).toBe(true)
      expect(await text(d, '.m-hint.m-abs')).toBe('Slider. Can only move along the guide: the rod pushes and pulls it.')
      await d.click(row.x, row.y)
      await settled(d)
      expect(await text(d, '.m-note .hw b')).toBe('Slider')
      await d.key('v') // leaving explore gives the story its view back
      await settled(d)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('a part\'s note: click it on the stage; name, id, what the scene says, live probe values; Esc closes it', async () => {
    await with1({}, async (d) => {
      await d.open('play=0&t=2')
      const at = await d.ev<{ x: number; y: number }>('(() => { const r = __mimir.locate("slider"), s = document.querySelector(".mimir-stage").getBoundingClientRect(); return { x: s.left + r.x + r.width / 2, y: s.top + r.y + r.height / 2 } })()')
      await d.click(at.x, at.y)
      await settled(d)
      expect(await shown(d, '.m-note')).toBe(true)
      expect(await text(d, '.m-note .hw b')).toBe('Slider')
      expect(await text(d, '.m-note .hw code')).toBe('slider')
      expect(await text(d, '.m-note .def')).toBe('Can only move along the guide: the rod pushes and pulls it.')
      expect(await text(d, '.m-note .val .k')).toBe('Height')
      const probe = await d.ev<number>('__mimir.probes().sliderHeight')
      expect(await text(d, '.m-note .val .v')).toBe(probe.toFixed(2))
      expect(await d.ev('document.querySelector(".m-note form").hidden')).toBe(true) // nothing to ask with: no line to ask on
      // the stage has made room: nothing typeset within the gutter
      const gap = await d.ev<number>('document.querySelector(".m-note").getBoundingClientRect().left - document.querySelector(".mimir-stage").getBoundingClientRect().right')
      expect(gap).toBeGreaterThanOrEqual(56)
      // a second part changes the note, it does not close it
      const pin = await d.ev<{ x: number; y: number }>('(() => { const r = __mimir.locate("wheel"), s = document.querySelector(".mimir-stage").getBoundingClientRect(); return { x: s.left + r.x + r.width / 2 + 20, y: s.top + r.y + r.height / 2 + 30 } })()')
      await d.click(pin.x, pin.y)
      await d.wait(80)
      expect(await opacity(d, '.m-note')).toBe(1)
      await settled(d)
      expect(await text(d, '.m-note .hw b')).toBe('Wheel')
      await d.key('Escape')
      await settled(d)
      expect(await shown(d, '.m-note')).toBe(false)
      // a click on the empty stage plays and pauses
      await d.click(120, 400)
      await d.wait(400)
      expect(await tau(d)).toBeGreaterThan(2)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('ask is offered only where the host can answer, and what is shown is what the host said', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      expect(await d.ev('document.querySelector("[data-a=ask]").hidden')).toBe(true)
      await d.key('a')
      await d.wait(200)
      expect(await shown(d, '.m-note[aria-label="Ask about this model"]')).toBe(false)
      // a host with a backend
      await d.ev('(() => { window.__asked = []; __mimir.ask = (q) => { __asked.push(q); return new Promise((res, rej) => setTimeout(() => (/fail/.test(q.question) ? rej(new Error("down")) : res({ text: "The pin is off centre. So it moves in a circle.", see: { t: 6 }, parts: ["pin"] })), 150)) }; window.dispatchEvent(new Event("resize")) })()')
      expect(await d.ev('document.querySelector("[data-a=ask]").hidden')).toBe(false)
      await d.key('a')
      await d.wait(350)
      expect(await d.ev('document.activeElement.getAttribute("aria-label")')).toBe('Ask about this model')
      await d.type('Why does the pin move?')
      await d.key('Enter')
      await d.wait(60)
      expect(await d.ev('document.querySelector(".m-note .wait").hidden')).toBe(false) // waiting: a rule that sweeps, no answer yet
      expect(await text(d, '.m-note .a')).toBe('')
      await d.until('!document.querySelector(".m-note .a").hidden')
      expect(await text(d, '.m-note .a')).toBe('The pin is off centre. So it moves in a circle.')
      expect(await text(d, '.m-note .q')).toBe('Why does the pin move?')
      expect(await d.ev('__asked[0]')).toEqual({ question: 'Why does the pin move?', part: null, step: 1, t: 0, title: 'How a crank turns a slider' })
      expect(await text(d, '.m-note .cite')).toBe('See What moves at 0:06')
      await d.clickOn('.m-note .cite')
      await settled(d)
      expect(await tau(d)).toBe(6)
      await d.key('a')
      await d.wait(350)
      await d.type('fail please')
      await d.key('Enter')
      await d.until('!document.querySelector(".m-note .fail").hidden')
      expect(await text(d, '.m-note .fail')).toBe('Could not answer. Press Enter to try again.')
      expect(await d.ev('document.querySelector(".m-note .a").hidden')).toBe(true)
    })
  }, T)

  test('command palette: Ctrl+K opens it on its line, typing searches steps, views and parts, Enter runs, Esc gives the focus back', async () => {
    await with1({}, async (d) => {
      await d.open('play=0')
      const st = await steps(d)
      await d.ev('document.querySelector("[data-a=palette]").focus()')
      await d.key('k', MOD.ctrl)
      await settled(d, 400)
      expect(await shown(d, '.m-palette')).toBe(true)
      expect(await d.ev('document.activeElement.getAttribute("role")')).toBe('combobox')
      expect(await d.ev('[...document.querySelectorAll("#m-pl li[role=option] .lb")].slice(0, 5).map((n) => n.textContent)')).toEqual(st.map((s) => s.title))
      expect(await d.ev('document.querySelector("#m-pl li.cur .lb").textContent')).toBe(st[0]!.title) // where you are: an open dot
      expect(await d.ev('[...new Set([...document.querySelectorAll("#m-pl li[role=option]")].map((n) => n.offsetHeight))]')).toEqual([30]) // a key cannot change a row's height
      const gap = await d.ev<number>('document.querySelector(".mimir-stage").getBoundingClientRect().left - document.querySelector(".m-palette").getBoundingClientRect().right')
      expect(gap).toBeGreaterThanOrEqual(56) // no scrim: the stage makes room
      await d.key('ArrowDown'); await d.key('ArrowDown')
      expect(await d.ev('document.querySelector("#m-pl li[aria-selected=true] .lb").textContent')).toBe(st[2]!.title)
      await d.until('Number(getComputedStyle(document.querySelector(".nl-ghost")).opacity) === 1') // where it would land, before it is run: a hollow dot on the line
      await d.key('Enter')
      await settled(d)
      expect(await tau(d)).toBeCloseTo(st[2]!.t0, 5)
      expect(await shown(d, '.m-palette')).toBe(false)
      expect(await d.ev('document.activeElement.dataset.a')).toBe('palette') // the focus returns to what opened it
      await d.key('k', MOD.ctrl)
      await settled(d, 400)
      await d.type('ghos')
      expect(await d.ev('document.querySelector("#m-pl li[aria-selected=true] .lb").textContent')).toBe('Ghost')
      await d.key('Escape')
      await settled(d, 300)
      expect(await shown(d, '.m-palette')).toBe(false)
      await d.key('?') // the shortcut sheet: every command and its key
      await settled(d, 400)
      const keys = await d.ev<string[]>('[...document.querySelectorAll("#m-pl li[role=option]")].filter((n) => n.querySelector(".m-key")).map((n) => n.querySelector(".lb").textContent + " " + n.querySelector(".m-key").textContent)')
      for (const k of ['Watch V', 'Read R', 'Explore E', 'Captions C', 'Voice M', 'Loop O', 'Full screen F', 'Play or pause Space']) expect(keys).toContain(k)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('share: the link with or without the moment, the scene file, and a download only where a server packs the page', async () => {
    await with1({}, async (d) => {
      await d.open('play=0&t=7')
      await d.key('s')
      await settled(d, 400)
      expect(await shown(d, '.m-share')).toBe(true)
      expect(await text(d, '.m-share .url code')).toMatch(/viewer\.html\?scene=.*&t=7$/)
      expect(await text(d, '#m-shAt .nm')).toBe('Start at 0:07, in What moves')
      await d.clickOn('#m-shAt')
      expect(await text(d, '.m-share .url code')).not.toContain('t=7')
      const lines = readFileSync(FIXTURE, 'utf8').split('\n').length
      expect(await d.ev('[...document.querySelectorAll(".m-share .shrow")].map((n) => [n.dataset.k, n.querySelector(".f").textContent])')).toEqual([['scene', `${lines} lines`]]) // no server: no download offered
      await d.key('Escape')
      await settled(d, 300)
      expect(await shown(d, '.m-share')).toBe(false)
    })
    const page = '<!doctype html><title>packed</title>'
    await with1({ api: { exportHtml: page, declare: 'export' } }, async (d) => {
      await d.open('play=0')
      await d.until('window.__mimir && document.querySelector("[data-a=share]")')
      await d.wait(400)
      await d.key('s')
      await settled(d, 400)
      expect(await d.ev('[...document.querySelectorAll(".m-share .shrow")].map((n) => [n.dataset.k, n.querySelector(".t").textContent, n.querySelector(".f").textContent])')).toEqual([['html', 'Download as one HTML file', '1 KB'], ['scene', 'Copy the scene file', expect.stringMatching(/^\d+ lines$/)]])
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual(['HEAD /api/export'])
      expect(d.errors).toEqual([])
    })
  }, T)

  test('a scene with errors: the erratum says what the engine said, where, and how to fix it; the story waits', async () => {
    await with1({ scene: join(ROOT, 'examples', 'broken.scene.js') }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".m-erratum") && Number(getComputedStyle(document.querySelector(".m-erratum")).opacity) > 0.9')
      await settled(d, 400)
      expect(await tau(d)).toBe(0) // it does not play over an error
      expect(await d.ev('document.querySelector(".m-erratum").getAttribute("role")')).toBe('alertdialog')
      const diag = await d.ev<{ code: string; what: string; line: number; fix: string[] }[]>('__mimir.diagnostics({ static: true }).then((a) => a.filter((x) => x.severity === "error").map((x) => ({ code: x.code, what: x.what, line: x.line, fix: x.fix })))')
      expect(await text(d, '.m-erratum [data-n]')).toBe(`Scene error, 1 of ${diag.length}`)
      expect(await text(d, '.m-erratum .loc code')).toBe(`broken.scene.js:${diag[0]!.line}`)
      expect(await text(d, '.m-erratum h3')).toBe(diag[0]!.code + diag[0]!.what)
      expect(await text(d, '.m-erratum pre .cur .ln')).toBe(String(diag[0]!.line)) // the line itself, from the scene file
      expect(await d.ev('[...document.querySelectorAll(".m-erratum .cand code")].map((n) => n.textContent)')).toEqual(diag[0]!.fix)
      expect(await d.ev('document.querySelector(".m-top").inert')).toBe(true) // the chrome behind it steps back and cannot be reached
      expect(await d.ev('document.querySelector(".m-erratum").contains(document.activeElement)')).toBe(true)
      for (let i = 0; i < 6; i++) await d.key('Tab') // it holds the focus
      expect(await d.ev('document.querySelector(".m-erratum").contains(document.activeElement)')).toBe(true)
      await d.clickOn('.m-erratum [data-d="1"]')
      expect(await text(d, '.m-erratum [data-n]')).toBe(`Scene error, 2 of ${diag.length}`)
      expect(await text(d, '.m-erratum h3')).toBe(diag[1]!.code + diag[1]!.what)
      await d.key('Escape')
      await settled(d, 400)
      expect(await shown(d, '.m-erratum')).toBe(false)
      expect(await d.ev('document.querySelector(".m-top").inert')).toBe(false)
    })
  }, T)

  test('a phone: every control is 44 px, a tap on the sleeping film only wakes it, a note is a sheet, captions stand under the stage', async () => {
    await with1({ width: 390, height: 844, touch: true }, async (d) => {
      await d.open()
      const small = 'JSON.stringify([...document.querySelectorAll(".m-app button, .m-app [role=slider], .m-app a")].filter((b) => b.getClientRects().length && !b.closest("[inert]") && !b.closest(".lk, .run") && getComputedStyle(b).visibility !== "hidden").map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.a || b.dataset.mode || b.dataset.tab || b.className, Math.round(r.width), Math.round(r.height)] }).filter((x) => x[1] < 44 || x[2] < 44))'
      expect(await d.ev(small)).toBe('[]')
      // the player's own captions: the frame is too small to carry the engine's
      await d.wait(1500)
      expect(await d.ev('document.querySelector(\'[data-overlay="guide.caption"] > div\').style.display')).toBe('none')
      expect(await opacity(d, '.m-cap')).toBeGreaterThan(0.9)
      expect(await text(d, '.m-cap')).toContain('A wheel, a rod and a slider')
      const below = await d.ev<number>('document.querySelector(".m-cap").getBoundingClientRect().top - document.querySelector(".mimir-stage").getBoundingClientRect().bottom')
      expect(below).toBeGreaterThanOrEqual(0)
      await d.wait(2300) // asleep
      expect(await opacity(d, '.m-top')).toBeLessThan(0.05)
      const before = await d.ev<boolean>('document.querySelector("[data-a=play]").getAttribute("aria-label") === "Pause"')
      await d.tap(195, 300)
      await d.wait(350)
      expect(before).toBe(true)
      expect(await d.ev('document.querySelector("[data-a=play]").getAttribute("aria-label")')).toBe('Pause') // still playing: the tap only woke it
      expect(await opacity(d, '.m-top')).toBeGreaterThan(0.9)
      await d.ev('document.querySelector(".m-top [data-mode=explore]").click()')
      await settled(d, 900)
      expect(await d.ev(small)).toBe('[]')
      await d.ev('document.querySelector(".m-tabs [data-tab=parts]").click()')
      await d.wait(200)
      await d.ev('document.querySelector(".m-index .row[data-part=slider]").click()')
      await settled(d)
      expect(await d.ev('document.querySelector(".m-note").classList.contains("sheet")')).toBe(true)
      const sheet = await d.ev<{ top: number; bottom: number; stage: number }>('(() => { const r = document.querySelector(".m-note").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, stage: document.querySelector(".mimir-stage").getBoundingClientRect().bottom } })()')
      expect(sheet.bottom).toBe(844)
      expect(sheet.stage).toBeLessThanOrEqual(sheet.top) // the model stands clear above it
      expect(await d.ev(small)).toBe('[]')
      await d.ev('document.querySelector(".m-note .x").click()')
      await settled(d)
      // the three dots: a full layer that does not raise the keyboard
      await d.ev('document.querySelector(".m-top [data-mode=video]").click()')
      await settled(d)
      await d.ev('document.querySelector("[data-a=more]").click()')
      await settled(d, 500)
      expect(await d.ev('document.querySelector(".m-palette").classList.contains("full")')).toBe(true)
      expect(await d.ev('document.activeElement.tagName')).not.toBe('INPUT')
      expect(await d.ev('document.querySelector("#m-pl li.gh").textContent')).toBe('Share') // it leads with what has no other way in
      expect(await d.ev(small)).toBe('[]')
      expect(d.errors).toEqual([])
    })
  }, T)

  test('the exported file carries the player: it plays from file:// with no network', async () => {
    const out = join(WORK, 'tour.html')
    const proc = Bun.spawn([join(ROOT, 'bin', 'mimir'), 'export', FIXTURE, '-o', out, '--json'], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect({ code, stderr: code ? stderr : '' }).toEqual({ code: 0, stderr: '' })
    const result = JSON.parse(stdout) as { path: string; bytes: number; warnings?: string[] }
    expect(result.warnings ?? []).toEqual([])
    const html = readFileSync(out, 'utf8')
    expect(html).toContain('m-transport') // the chrome's stylesheet is inside
    expect(html).not.toMatch(/src="https?:/)
    const errors: string[] = [], requests: string[] = []
    const browser = await launchChrome({ onConsole: (l, t) => { if (l === 'error') errors.push(t) } })
    try {
      const page = await browser.newPage(1280, 720, 1)
      await page.send('Network.enable')
      browser.cdp.on((e) => { if (e.method === 'Network.requestWillBeSent') requests.push(String(e.params.request?.url)) })
      await page.navigate(pathToFileURL(out).href)
      for (let i = 0; i < 200 && !(await page.evaluate<boolean>('!!window.__mimir').catch(() => false)); i++) await Bun.sleep(30)
      await page.evaluate('window.__mimir.ready.then(() => 1)', 30_000)
      await Bun.sleep(900)
      expect(await page.evaluate<number>('__mimir.state().tau')).toBeGreaterThan(0.3) // it plays
      expect(await page.evaluate<boolean>('!!document.querySelector(".m-root .nl") && !!document.querySelector(".m-read") && !document.querySelector(".mimir-fatal")')).toBe(true)
      expect(await page.evaluate<string>('getComputedStyle(document.querySelector(".m-app")).fontFamily')).toContain('KaTeX_Main') // the stage's own embedded faces
      expect(await page.evaluate<boolean>('document.fonts.check("17px KaTeX_Main")')).toBe(true)
      expect(await page.evaluate<boolean>('document.querySelector("[data-a=ask]").hidden')).toBe(true)
      expect(requests.filter((u) => /^https?:/.test(u))).toEqual([])
      expect(errors).toEqual([])
    } finally { await browser.close() }
  }, T)
})
