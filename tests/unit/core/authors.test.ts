// What scene authors hit in their first hour (they wrote scenes from the public reference only): chapters and cameras.
// Each case is the reduced scene of a report, kept as a regression test.
import { describe, expect, test } from 'bun:test'
import { build, codes } from './helpers.ts'
import { circle, rect } from '../../../src/r2d/index.ts'
import { fadeIn } from '../../../src/anim/index.ts'

describe('a chapter and the 2D camera', () => {
  const story = (chapter: Record<string, unknown>) => build((s: any) => {
    const a = rect({ id: 'a', width: 1, height: 1 }).at(3, 1)
    const b = circle({ id: 'b', radius: 0.5 }).at(-3, -1)
    const c = circle({ id: 'c', radius: 0.5 }).at(0, -2)
    s.chapter('one')
    s.step('zoom', (st: any) => { st.zoom(a, { duration: 0 }); st.wait(2) })
    s.chapter('two', typeof chapter.keep === 'function' ? { ...chapter, keep: (chapter.keep as (x: unknown[]) => unknown[])([a, b, c]) } : chapter)
    s.step('next', (st: any) => { st.play(fadeIn(b)) })
  })
  const zooms = (m: ReturnType<typeof story>, times: number[]): number[] => times.map((t) => Math.round(m.state(t).camera2d().zoom * 1000) / 1000)

  test('a chapter that opens while zoomed in eases back to the whole frame, also when every object is kept (it was a jump cut)', () => {
    const m = story({ keep: (all: unknown[]) => all })
    expect(codes(m)).toEqual([])
    const t0 = m.steps[1]!.t0
    const z = zooms(m, [t0 - 0.1, t0, t0 + 0.2, t0 + 0.4, t0 + 0.6, t0 + 0.8, t0 + 1])
    expect(z[0]).toBeGreaterThan(6)
    expect(z[1]).toBe(z[0]!) // nothing jumps at the boundary
    for (let i = 2; i <= 4; i++) { expect(z[i]!).toBeLessThan(z[i - 1]!); expect(z[i]!).toBeGreaterThan(1) } // on its way for the whole opening
    expect([z[5], z[6]]).toEqual([1, 1])
    // the opening takes its time for the camera alone: the first step of the chapter starts after it
    expect(m.chapters[1]!.clear).toBeGreaterThan(0.5)
  })

  test('what the camera was following may leave with the chapter: the way back stays smooth', () => {
    const m = story({ keep: (all: unknown[]) => all.slice(1) }) // `a`, the zoom's target, leaves
    const t0 = m.steps[1]!.t0
    const z = zooms(m, Array.from({ length: 17 }, (_, i) => t0 + i * 0.05))
    for (let i = 1; i < z.length; i++) { expect(z[i]!).toBeLessThanOrEqual(z[i - 1]!); expect(z[i - 1]! / z[i]!).toBeLessThan(1.45) } // no snap when the target is gone (it was 1.66 -> 1 in one frame)
    expect(z[z.length - 1]).toBe(1)
  })

  test('keepCamera: true leaves the camera where it is, and a chapter that clears nothing then takes no time', () => {
    const m = story({ keep: (all: unknown[]) => all, keepCamera: true })
    expect(codes(m)).toEqual([])
    const t0 = m.steps[1]!.t0
    expect(new Set(zooms(m, [t0 - 0.1, t0, t0 + 0.4, t0 + 1.5])).size).toBe(1)
    expect(m.chapters[1]!.clear).toBe(0)
    // a wrong option is said, with its fix
    const bad = story({ keepCamera: 'yes' })
    expect(codes(bad).length).toBeGreaterThan(0)
  })
})

describe('the 3D camera and a part that stands where the camera puts it', () => {
  // an author's engine: a flash at a point of a plot that stands beside the projected model. In the live page the
  // player asked for the flash first and the scene carried "size of #flash became NaN" (and did not play); a headless
  // frame asked for the camera first and showed nothing wrong.
  const story = async () => {
    const { box } = await import('../../../src/r3d/index.ts')
    const { dot } = await import('../../../src/r2d/index.ts')
    const { burst } = await import('../../../src/flow/index.ts')
    let flash: any, body: any
    const m = build((s: any) => {
      body = box({ id: 'body', width: 2, height: 3, depth: 1 })
      const tag = dot(body.anchor('top'), { id: 'tag', radius: 0.05 }) // a 2D dot on a 3D anchor: its place needs the camera
      flash = burst(() => { const c = tag.center(); return [c[0], c[1], 0] }, { id: 'flash', progress: () => 0.5 })
      s.step('one', (st: any) => { st.wait(1) })
    })
    return { m, flash, body }
  }
  test('whoever asks first, the scene has no error and the camera is the same', async () => {
    const a = await story(), b = await story()
    expect(a.flash.space).toBe('3d')
    const fa = a.m.state(0)
    fa.props(a.flash) // the player's order: the part first
    const fromPart = fa.camera()
    const fromCamera = b.m.state(0).camera() // a headless frame's order: the camera first
    expect(codes(a.m)).toEqual([])
    expect(codes(b.m)).toEqual([])
    expect(fromPart).toEqual(fromCamera)
    // and the camera frames the model, not the mark that follows it
    const alone = (await story())
    expect(Number.isFinite(fromCamera.distance) && fromCamera.distance > 0).toBe(true)
    expect(alone.m.state(0).subject().length).toBe(alone.m.state(0).subject([alone.body]).length)
  })
})
