// The player's pure side: where a moment is in the story, where a jump lands, how names share the line of time, how a
// value is written, what a search matches, what the generating view is after a list of events.
import { describe, expect, test } from 'bun:test'
import {
  ago, buildState, decimalsOf, END_EPSILON, fileNameOf, fuzzy, fuzzyRank, isAutoId, jumpTarget, levenshtein, locate, magnet, nearest, nextSpeed, noteHtml, numberText, planNames,
  prettyName, probesOf, probeText, sectionAt, sectionsOf, shareUrl, sizeText, sliderStep, snapParam, speedText, splitTail, ticksOf, wordsOf,
} from '../../../src/player/story.ts'

const step = (index: number, t0: number, t1: number, chapter: number | null) => ({ index, title: `S${index}`, t0, t1, hold: 1, say: [], chapter })
const info = {
  duration: 30,
  steps: [step(1, 0, 5, 1), step(2, 5, 11, 1), step(3, 11, 17, 2), step(4, 17, 23, 2), step(5, 23, 30, 3)],
  chapters: [
    { index: 1, title: 'One', t0: 0, t1: 11, steps: [1, 2], keep: [] },
    { index: 2, title: 'Two', t0: 11, t1: 23, steps: [3, 4], keep: [] },
    { index: 3, title: 'Three', t0: 23, t1: 30, steps: [5], keep: [] },
  ],
}
const flat = { duration: 9, steps: [step(1, 0, 3, null), step(2, 3, 6, null), step(3, 6, 9, null)], chapters: [] }

describe('where a moment is', () => {
  test('locate gives the step and chapter being told', () => {
    expect(locate(info, 0)).toEqual({ step: 0, chapter: 0 })
    expect(locate(info, 10.99)).toEqual({ step: 1, chapter: 0 })
    expect(locate(info, 11)).toEqual({ step: 2, chapter: 1 })
    expect(locate(info, 30)).toEqual({ step: 4, chapter: 2 })
    expect(locate(flat, 4)).toEqual({ step: 1, chapter: -1 })
    expect(locate({ steps: [], chapters: [] }, 3)).toEqual({ step: -1, chapter: -1 })
  })
  test('next goes to the next start, and past the last step to the end', () => {
    expect(jumpTarget(info, 2, 1)).toBe(5)
    expect(jumpTarget(info, 24, 1)).toBe(30)
    expect(jumpTarget(info, 2, 1, true)).toBe(11)
    expect(jumpTarget(flat, 2, 1, true)).toBe(3) // no chapters: by chapter is by step
  })
  test('previous goes to the start of the step first, then to the step before', () => {
    expect(jumpTarget(info, 7, -1)).toBe(5)
    expect(jumpTarget(info, 5.3, -1)).toBe(0)
    expect(jumpTarget(info, 0.2, -1)).toBe(0)
    expect(jumpTarget(info, 18, -1, true)).toBe(11)
    expect(jumpTarget(info, 11.2, -1, true)).toBe(0)
  })
  test('two presses are two steps: a jump from where the story is going', () => {
    const once = jumpTarget(info, 2, 1)
    expect(jumpTarget(info, once, 1)).toBe(11)
  })
  test('the end of the story still belongs to its last step', () => {
    expect(locate(info, 30 - END_EPSILON).step).toBe(4)
  })
})

describe('the line of time', () => {
  test('major ticks open chapters and close the story, minor ticks open the other steps', () => {
    const t = ticksOf(info)
    expect(t.map((k) => k.t)).toEqual([0, 5, 11, 17, 23, 30])
    expect(t.map((k) => k.major)).toEqual([true, false, true, false, true, true])
    expect(t[1]!.chapter).toBe(0)
    expect(t[5]!.step).toBe(-1)
  })
  test('a story without chapters is graduated and named by its steps', () => {
    expect(ticksOf(flat).every((k) => k.major)).toBe(true)
    expect(sectionsOf(flat).map((s) => s.numeral + s.title)).toEqual(['1S1', '2S2', '3S3'])
    expect(sectionsOf(info).map((s) => s.title)).toEqual(['One', 'Two', 'Three'])
    expect(sectionAt(sectionsOf(info), 12)).toBe(1)
  })
  test('every name is written when every name fits before the next tick', () => {
    const p = planNames([0, 400, 800], 1200, [10, 10, 10], [100, 100, 100], 1)
    expect(p.all).toBe(true)
    expect(p.name).toEqual([17, 417, 817])
    expect(p.numeral).toEqual([0, 400, 800])
  })
  test('when they do not fit only the one being told is named, after its numeral or before it', () => {
    const after = planNames([0, 100, 600], 900, [10, 10, 10], [300, 300, 300], 1)
    expect(after.all).toBe(false)
    expect(after.name).toEqual([null, 117, null])
    const before = planNames([0, 500, 600], 900, [10, 10, 10], [300, 300, 300], 1)
    expect(before.name[1]).toBe(500 - 9 - 300)
    const neither = planNames([0, 60, 120], 400, [10, 10, 10], [300, 300, 300], 1)
    expect(neither.name).toEqual([null, null, null]) // the transport names it instead
  })
  test('a numeral gives way only to the numeral before it, never the one being told', () => {
    const p = planNames([0, 8, 300], 600, [12, 12, 12], [50, 50, 50], 2)
    expect(p.numeral).toEqual([0, null, 300])
    expect(planNames([0, 8, 300], 600, [12, 12, 12], [50, 50, 50], 1).numeral[1]).toBe(8)
  })
  test('the magnet takes hold of a tick within a few px and lets go beyond', () => {
    const t = ticksOf(info)
    expect(magnet(t, 5.1, 30, 1200)).toBe(5) // 4 px away
    expect(magnet(t, 5.5, 30, 1200)).toBe(5.5) // 20 px away
    expect(magnet(t, -3, 30, 1200)).toBe(0)
    expect(magnet(t, 2, 0, 1200)).toBe(0)
  })
  test('speeds step along the list and the button goes round', () => {
    expect(nextSpeed(1, 1)).toBe(1.5)
    expect(nextSpeed(2, 1)).toBe(2)
    expect(nextSpeed(2, 1, true)).toBe(0.5)
    expect(nextSpeed(0.5, -1)).toBe(0.5)
    expect(nextSpeed(1.25, 1)).toBe(1.5) // an unknown speed counts as 1
    expect([speedText(1), speedText(1.5), speedText(0.5)]).toEqual(['1×', '1.5×', '0.5×'])
  })
})

describe('values', () => {
  test('a number shows the decimals its step needs', () => {
    expect(decimalsOf({ step: 0.1, min: 1, max: 2 })).toBe(1)
    expect(decimalsOf({ step: 5, min: 0, max: 600 })).toBe(0)
    expect(decimalsOf({ step: 0.25, min: 0, max: 1 })).toBe(2)
    expect(decimalsOf({ step: 0, min: 0, max: 360 })).toBe(0)
    expect(decimalsOf({ step: 0, min: 0, max: 1 })).toBe(2)
    expect(decimalsOf({ step: 0, min: 2, max: 2 })).toBe(2)
  })
  test('numbers are typeset with a real minus and never as -0', () => {
    expect(numberText(-3.14159, 2)).toBe('−3.14')
    expect(numberText(-0.001, 2)).toBe('0.00')
    expect(numberText(NaN, 2)).toBe('–')
    expect(probeText(123.456)).toBe('123')
    expect(probeText(3.14159)).toBe('3.14')
    expect(probeText(0.012345)).toBe('0.012')
  })
  test('a slider snaps to its step, a tenth of it with the fine key, and stays in range', () => {
    const p = { step: 0.1, min: 1, max: 2 }
    expect(snapParam(p, 1.234)).toBe(1.2)
    expect(snapParam(p, 1.234, true)).toBe(1.23)
    expect(snapParam(p, 9)).toBe(2)
    expect(sliderStep({ step: 0, min: 0, max: 360 })).toBeCloseTo(0.9)
    expect(sliderStep({ step: 0, min: 1, max: 1 })).toBe(0.01)
  })
  test('the probes of a part are the ones named after it', () => {
    const probes = { sliderHeight: 3.86, pinX: -1.2, speed: 4, slider: 1 }
    expect(probesOf('slider', probes).map((p) => [p.name, p.label])).toEqual([['sliderHeight', 'Height'], ['slider', 'Slider']])
    expect(probesOf('pin', probes).map((p) => p.label)).toEqual(['X'])
    expect(probesOf('engine.piston', { pistonTravel: 2 }).map((p) => p.label)).toEqual(['Travel'])
    expect(probesOf('wheel', probes)).toEqual([])
  })
})

describe('names and search', () => {
  test('an id reads as a name', () => {
    expect(prettyName('intakeValve')).toBe('Intake valve')
    expect(prettyName('conn_rod-2')).toBe('Conn rod 2')
    expect(prettyName('engine.piston')).toBe('Engine piston')
    expect(prettyName('a')).toBe('A')
  })
  test('ids the engine made up are told from ids the author gave', () => {
    expect(isAutoId('box3', 'box')).toBe(true)
    expect(isAutoId('box3-2', 'box')).toBe(true)
    expect(isAutoId('box', 'box')).toBe(false)
    expect(isAutoId('piston', 'box')).toBe(false)
    expect(isAutoId('a.b1', 'a.b')).toBe(true) // a kind name with a dot is not a pattern
  })
  test('search is a subsequence match and says which letters matched', () => {
    expect(fuzzy('pst', 'Piston')).toEqual([0, 2, 3])
    expect(fuzzy('', 'Piston')).toEqual([])
    expect(fuzzy('xz', 'Piston')).toBeNull()
    expect(fuzzyRank('pis', 'Piston')).toBe(0)
    expect(fuzzyRank('rod', 'Connecting rod')).toBe(1)
    expect(fuzzyRank('zz', 'Piston')).toBe(Infinity)
    expect(fuzzyRank('pn', 'Piston')).toBeGreaterThan(fuzzyRank('pis', 'Piston'))
  })
  test('a miss offers the nearest name', () => {
    expect(levenshtein('pistn', 'piston')).toBe(1)
    expect(nearest('pistn', ['Wheel', 'Piston', 'Rod'])).toBe('Piston')
    expect(nearest('x', [])).toBeNull()
  })
})

describe('text', () => {
  test('a note keeps its inline marks and nothing else', () => {
    expect(noteHtml('The **crank radius** is `r`.\n\nTwice *that*.')).toBe('<p>The <strong>crank radius</strong> is <code>r</code>.</p><p>Twice <em>that</em>.</p>')
    expect(noteHtml('<img src=x onerror=alert(1)> 2 * 3 * 4')).toBe('<p>&lt;img src=x onerror=alert(1)&gt; 2 * 3 * 4</p>')
  })
  test('a sentence is cut into words that know the part they name', () => {
    const n = { plain: 'The crank pin rides on the wheel, off centre.', spans: [{ start: 4, end: 13, words: 'crank pin', verb: 'point', targets: ['pin'], options: [] }, { start: 27, end: 32, words: 'wheel', verb: 'point', targets: ['wheel'], options: [] }] }
    const w = wordsOf(n)
    expect(w.map((x) => x.span)).toEqual([-1, 0, 0, -1, -1, -1, 1, -1, -1])
    expect(w[1]!.joined).toBe(true)
    expect(w[2]!.joined).toBe(false)
    expect(splitTail('wheel,')).toEqual(['wheel', ','])
    expect(splitTail('slider')).toEqual(['slider', ''])
    expect(splitTail('...')).toEqual(['...', ''])
  })
  test('a span with no target names nothing', () => {
    expect(wordsOf({ plain: 'here now', spans: [{ start: 0, end: 4, words: 'here', verb: 'focus', targets: [], options: [] }] }).map((x) => x.span)).toEqual([-1, -1])
  })
})

describe('sharing', () => {
  test('the link carries the moment only when asked, and keeps the rest of the address', () => {
    expect(shareUrl('http://h/viewer.html?scene=%2Fa.js&t=3', 53.9)).toBe('http://h/viewer.html?scene=%2Fa.js&t=53')
    expect(shareUrl('http://h/viewer.html?scene=%2Fa.js&t=3&step=2', null)).toBe('http://h/viewer.html?scene=%2Fa.js')
    expect(shareUrl('http://h/v.html?scene=a', 0.4)).toBe('http://h/v.html?scene=a')
  })
  test('a download is named after the scene', () => {
    expect(fileNameOf('How a four-stroke engine works')).toBe('how-a-four-stroke-engine-works.html')
    expect(fileNameOf('  ')).toBe('scene.html')
    expect(fileNameOf('Größe: 3 × 4?')).toBe('groe-3-4.html')
    expect([sizeText(412 * 1024), sizeText(1.25 * 1024 * 1024), sizeText(10)]).toEqual(['412 KB', '1.3 MB', '1 KB'])
  })
})

describe('home', () => {
  test('how long ago, in the largest whole unit', () => {
    const now = 1_000_000_000
    expect(ago(now - 30_000, now)).toBe('just now')
    expect(ago(now - 2 * 3600_000, now)).toBe('2 hours ago')
    expect(ago(now - 86_400_000, now)).toBe('1 day ago')
    expect(ago(now + 5000, now)).toBe('just now')
  })
  test('the build is a function of its events and the time', () => {
    const ev = [
      { at: 0, stage: 'storyboard', message: '5 steps in 3 chapters' },
      { at: 8, stage: 'writing', message: 'tour.scene.js' },
      { at: 20, stage: 'checking' },
      { at: 24, stage: 'looking', frame: '/f/1.png' },
      { at: 26, stage: 'looking', frame: '/f/2.png', message: 'frame 2 of 5' },
    ]
    const s = buildState(ev, 30)
    expect(s.rows.map((r) => r.state)).toEqual(['done', 'done', 'done', 'now', 'todo', 'todo'])
    expect(s.rows.map((r) => r.seconds)).toEqual([8, 12, 4, 6, 0, 0])
    expect(s.rows[0]!.fact).toBe('5 steps in 3 chapters')
    expect(s.frames).toEqual(['/f/1.png', '/f/2.png'])
    expect(s.looking).toBe(1)
    expect(s.status).toBe('Looking at renders, frame 2 of 5')
    expect(s.ready).toBeNull()
    expect(buildState(ev, 30)).toEqual(s) // a page that joins late gets the same state
  })
  test('a second pass counts, rows never reset, ready and failed end it', () => {
    const ev = [
      { at: 0, stage: 'writing' }, { at: 5, stage: 'looking', frame: 'a' }, { at: 9, stage: 'fixing', message: '1 fault' }, { at: 12, stage: 'looking', frame: 'a' }, { at: 15, stage: 'ready', scene: 'x.scene.js' },
    ]
    const s = buildState(ev, 99)
    expect(s.rows.find((r) => r.stage === 'looking')!.passes).toBe(2)
    expect(s.rows.find((r) => r.stage === 'looking')!.seconds).toBe(7)
    expect(s.rows.find((r) => r.stage === 'storyboard')!.state).toBe('todo') // a stage the build never reported is not ticked
    expect(s.rows.find((r) => r.stage === 'fixing')!.state).toBe('done')
    expect(s.frames).toEqual(['a'])
    expect(s.ready).toBe('x.scene.js')
    const f = buildState([{ at: 0, stage: 'writing' }, { at: 4, stage: 'failed', message: 'The agent stopped.' }], 50)
    expect(f.failed).toBe('The agent stopped.')
    expect(f.rows[1]!.seconds).toBe(4)
    expect(buildState([], 3).status).toBe('Starting')
    expect(buildState([{ at: 0, stage: 'nonsense' }], 3).rows.every((r) => r.state === 'todo')).toBe(true)
  })
})
