// Home, against a tiny mock of the server's contract (tests/unit/player/drive.ts):
//   GET /api/scenes → [{ id, title, kind, updated, thumb }]     POST /api/new { prompt } → { id }
//   GET /api/new/<id>/events → server-sent events { stage, message, frame?, scene? }
// and the other half of the contract: with no server the viewer does not offer any of it, and asks for nothing.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { drive, FIXTURE, ROOT, type Drive, type MockApi } from '../unit/player/drive.ts'

const HAVE = existsSync(join(ROOT, 'scripts', 'build.ts')) && existsSync(FIXTURE)
const T = 180_000
const NOW = Date.now()
const SCENES: NonNullable<MockApi['scenes']> = [
  { id: '/scene/tour.scene.js', title: 'How a crank turns a slider', kind: '3D model', updated: NOW - 2 * 3600e3, thumb: '/mock/a.png' },
  { id: '/scene/queue.scene.js', title: 'What happens to a request when a queue fills up', kind: 'Diagram', updated: new Date(NOW - 26 * 3600e3).toISOString() },
]
const EVENTS = [
  { stage: 'storyboard', message: '5 steps in 3 chapters, 7 parts' }, { stage: 'writing', message: 'tour.scene.js, 66 lines' }, { stage: 'checking', message: 'no errors' },
  { stage: 'looking', message: 'frame 1 of 2', frame: '/mock/1.png' }, { stage: 'looking', message: 'frame 2 of 2', frame: '/mock/2.png' },
]
const text = (d: Drive, sel: string): Promise<string> => d.ev<string>(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').trim()`)
async function with1<R>(o: Parameters<typeof drive>[0], fn: (d: Drive) => Promise<R>): Promise<R> {
  const d = await drive(o)
  try { return await fn(d) } finally { await d.close() }
}
const rows = (d: Drive): Promise<[string, string, string][]> => d.ev('[...document.querySelectorAll(".g-stage")].map((n) => [n.querySelector(".t").textContent, n.classList.contains("done") ? "done" : n.classList.contains("on") ? "now" : "todo", n.querySelector(".fact").textContent])')

describe.skipIf(!HAVE)('home', () => {
  test('the prompt page: the question, the line, examples that fill it, recent models that open', async () => {
    await with1({ scene: null, api: { scenes: SCENES, build: { id: 'b1', events: EVENTS } } }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".h-page")')
      expect(await text(d, '.h-q')).toBe('What do you want to see working?')
      expect(await d.ev('document.activeElement.tagName')).toBe('TEXTAREA') // it takes the focus, with a pointer that is not a finger
      expect(await d.ev('document.querySelector(".h-ask .m-line").classList.contains("ready")')).toBe(true) // empty and ready: the caret
      expect(await d.ev('document.querySelector(".h-go").disabled')).toBe(true)
      expect(await d.ev('[...document.querySelectorAll(".h-plate")].map((a) => [a.querySelector("b").textContent, a.querySelector(".mt").textContent, new URL(a.href).searchParams.get("scene")])')).toEqual([
        ['How a crank turns a slider', '3D model, 2 hours ago', '/scene/tour.scene.js'], ['What happens to a request when a queue fills up', 'Diagram, 1 day ago', '/scene/queue.scene.js'],
      ])
      expect(await d.ev('document.querySelectorAll(".h-plate img").length')).toBe(1) // a model with no thumbnail has an empty plate, not a made-up one
      expect(await d.ev('document.querySelectorAll(".h-ex button").length')).toBeGreaterThanOrEqual(4)
      const first = await text(d, '.h-ex button')
      await d.clickOn('.h-ex button') // fills the line; does not submit
      expect(await d.ev('document.querySelector(".h-ask textarea").value')).toBe(first)
      expect(d.posts).toEqual([])
      expect(await d.ev('document.querySelector(".h-go").classList.contains("ready")')).toBe(true)
      // the kind is one tab stop: arrows move the choice and wrap
      await d.ev('document.querySelector("[data-kind=auto]").focus()')
      await d.key('ArrowLeft')
      expect(await d.ev('document.querySelector("[data-kind=math]").getAttribute("aria-checked")')).toBe('true')
      await d.key(' ') // a key meant for a focused control never goes to the line
      expect(await d.ev('document.querySelector(".h-ask textarea").value')).toBe(first)
      // the stage, the line of time and the transport are not there: this is not a scene
      expect(await d.ev('getComputedStyle(document.querySelector(".m-slot")).display')).toBe('none')
      expect(await d.ev('!!document.querySelector(".m-erratum") && Number(getComputedStyle(document.querySelector(".m-erratum")).opacity)')).toBe(0)
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual(['GET /api/scenes'])
      expect(d.errors).toEqual([])
    })
  }, T)

  test('building: Enter posts the prompt, the stages follow the server\'s events, frames arrive, ready opens the scene', async () => {
    await with1({ scene: null, api: { scenes: SCENES, build: { id: 'b1', events: [...EVENTS, { stage: 'ready', message: 'ready', scene: '/scene/tour.scene.js' }], everyMs: 220 } } }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".h-page")')
      await d.type('How does a crank turn a slider?')
      await d.clickOn('[data-kind="3d"]')
      await d.ev('document.querySelector(".h-ask textarea").focus()')
      await d.key('Enter')
      await d.until('document.querySelectorAll(".g-stage.done").length >= 1')
      expect(d.posts).toEqual([{ path: '/api/new', body: JSON.stringify({ prompt: 'How does a crank turn a slider?', kind: '3d' }) }])
      expect(await text(d, '.g-title')).toBe('How does a crank turn a slider?')
      expect(await text(d, '.g-meta .m-dust')).toMatch(/^0:0\d so far, runs in the background$/)
      await d.until('document.querySelectorAll(".g-strip .g-frame").length === 2')
      const r = await rows(d)
      expect(r.map((x) => x[0])).toEqual(['Storyboard', 'Building', 'Checking', 'Looking at renders', 'Fixing', 'Ready'])
      expect(r.slice(0, 3).map((x) => x[1])).toEqual(['done', 'done', 'done'])
      expect(r[0]![2]).toBe('5 steps in 3 chapters, 7 parts') // the server's own words
      expect(r[4]![1]).toBe('todo') // nothing the server did not report is ticked
      expect(await d.ev('document.querySelector(".g-frame.big img").getAttribute("src")')).toBe('/mock/2.png')
      expect(await d.ev('[...document.querySelectorAll(".g-strip .g-frame")].map((f) => f.classList.contains("at"))')).toEqual([false, true])
      expect(await text(d, '.g-status')).toMatch(/^Looking at renders, frame 2 of 2$|^Ready/)
      // ready: the scene opens, and it plays
      await d.until('new URLSearchParams(location.search).get("scene") === "/scene/tour.scene.js" && window.__mimir', 20_000)
      await d.ev('window.__mimir.ready.then(() => 1)')
      await d.wait(700)
      expect(await d.ev<number>('__mimir.state().tau')).toBeGreaterThan(0.2)
      // opened from the home page, the scene knows its way back and what the server packs
      expect(await d.ev('new URL(document.querySelector(".m-top .m-mark").href).search')).toBe('')
      expect(d.errors.filter((e) => !/api\/export/.test(e))).toEqual([]) // this mock has no /api/export: the one request for it is the only complaint
    })
  }, T)

  test('a build that fails says so in the server\'s words; Stop takes the prompt back and never runs anything backwards', async () => {
    await with1({ scene: null, api: { scenes: [], build: { id: 'b2', events: [{ stage: 'storyboard', message: '3 steps' }, { stage: 'writing' }, { stage: 'failed', message: 'The agent stopped after 12 turns.' }], everyMs: 120 } } }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".h-page")')
      expect(await d.ev('document.querySelectorAll(".h-plate").length')).toBe(0) // no recents: nothing in that half
      await d.type('Something impossible')
      await d.key('Enter')
      await d.until('!document.querySelector(".g-fail").hidden')
      expect(await text(d, '.g-fail')).toBe('Failed.The agent stopped after 12 turns.')
      const r = await rows(d)
      expect(r[0]!.slice(0, 2)).toEqual(['Storyboard', 'done'])
      expect(r[5]![1]).toBe('todo') // never "ready"
      await d.key('Escape')
      await d.wait(500)
      expect(await d.ev('Number(getComputedStyle(document.querySelector(".h-view")).opacity)')).toBe(1)
      expect(await d.ev('document.querySelector(".h-ask textarea").value')).toBe('Something impossible') // the prompt is where it was typed
      expect(await d.ev('document.querySelector(".h-stopped").hidden')).toBe(true) // nothing to resume: it failed
    })
    await with1({ scene: null, api: { scenes: [], build: { id: 'b3', events: [{ stage: 'storyboard' }], everyMs: 100 } } }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".h-page")')
      await d.type('A long build')
      await d.key('Enter')
      await d.until('document.querySelector(".g-stage.on") && Number(getComputedStyle(document.querySelector(".g-meta")).opacity) > 0.95')
      await d.clickOn('[data-h=stop]')
      await d.wait(400)
      expect(await text(d, '.h-stopped span')).toMatch(/^Stopped at 0:0\d\.$/)
      await d.clickOn('.h-stopped button') // Resume takes the same build up again
      for (let i = 0; i < 100 && d.requests.filter((r) => r === 'GET /api/new/b3/events').length < 2; i++) await d.wait(50)
      await d.until('document.querySelector(".g-stage.on")')
      expect(d.posts.length).toBe(1) // not a second build
      expect(d.requests.filter((r) => r === 'GET /api/new/b3/events').length).toBe(2)
    })
  }, T)

  test('with no server there is no home: the bare viewer says no scene was given, and a scene page asks for nothing', async () => {
    await with1({ scene: null }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".m-erratum") && Number(getComputedStyle(document.querySelector(".m-erratum")).opacity) > 0.9')
      expect(await d.ev('!!document.querySelector(".h-page")')).toBe(false)
      expect(await text(d, '.m-erratum h3')).toContain('No scene given')
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual(['GET /api/scenes']) // asked once, answered 404
    })
    await with1({}, async (d) => {
      await d.open('play=0')
      await d.wait(500)
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual([])
      expect(await d.ev('document.querySelector(".m-top .m-mark").hasAttribute("href")')).toBe(false) // nowhere to go home to
      await d.key('?')
      await d.wait(400)
      expect(await d.ev('[...document.querySelectorAll("#m-pl .lb")].some((n) => n.textContent === "All models")')).toBe(false)
      expect(d.errors).toEqual([])
    })
  }, T)

  test('a scene page whose server declares its API offers the way home without asking', async () => {
    await with1({ api: { scenes: SCENES, declare: 'scenes' } }, async (d) => {
      await d.open('play=0')
      await d.wait(500)
      expect(await d.ev('new URL(document.querySelector(".m-top .m-mark").href).pathname')).toBe('/viewer.html')
      await d.key('?')
      await d.wait(400)
      expect(await d.ev('[...document.querySelectorAll("#m-pl .lb")].some((n) => n.textContent === "All models")')).toBe(true)
      expect(d.requests.filter((r) => r.includes('/api/'))).toEqual([])
      expect(d.errors).toEqual([])
    })
  }, T)

  test('a phone: the question does not take the focus (it would raise the keyboard over the examples)', async () => {
    await with1({ scene: null, width: 390, height: 844, touch: true, api: { scenes: SCENES } }, async (d) => {
      await d.open()
      await d.until('document.querySelector(".h-page")')
      expect(await d.ev('document.activeElement.tagName')).not.toBe('TEXTAREA')
      expect(await d.ev('document.documentElement.scrollWidth <= 390')).toBe(true)
    })
  }, T)
})
