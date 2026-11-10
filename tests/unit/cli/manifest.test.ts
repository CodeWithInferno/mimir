import { describe, expect, test } from 'bun:test'
import { UsageError } from '../../../src/cli/errors.ts'
import type { SceneInfo } from '../../../src/cli/format.ts'
import {
  SHEET_HEADER, SHEET_MAX_HEIGHT, SHEET_MAX_WIDTH, formatManifestText, frameFileStem, groupByChapter, imageTokens, legendColor, legendHtml, planFrames,
  sha256Hex, sheetCaption, sheetHtml, sheetLayout, stepAt, stepEndTime, storyCues, storyHtml, storyLayout, turntableAngles, turntableName, valueSlug,
  type ManifestEntry, type SheetCell,
} from '../../../src/cli/manifest.ts'
import { pngSize } from '../../../src/cli/png.ts'

const info: SceneInfo = {
  title: 'Engine', duration: 6,
  steps: [
    { index: 1, title: 'Intake', t0: 0, t1: 2 },
    { index: 2, title: 'Compression', t0: 2, t1: 4 },
    { index: 3, title: 'Power', t0: 4, t1: 6 },
  ],
  params: [], parts: [], views: null, problems: null, fatal: null,
}

describe('planFrames', () => {
  test('default: the end state of every step, 1 ms before its end', () => {
    expect(planFrames(info, { kind: 'steps' })).toEqual([
      { step: 1, title: 'Intake', t: 1.999, stem: 'step-01' },
      { step: 2, title: 'Compression', t: 3.999, stem: 'step-02' },
      { step: 3, title: 'Power', t: 5.999, stem: 'step-03' },
    ])
  })
  test('--step picks by the index the page reports', () => {
    expect(planFrames(info, { kind: 'step', step: 2 })).toEqual([{ step: 2, title: 'Compression', t: 3.999, stem: 'step-02' }])
    const zero: SceneInfo = { ...info, steps: info.steps.map((s) => ({ ...s, index: s.index - 1 })) }
    expect(planFrames(zero, { kind: 'step', step: 0 })[0]).toMatchObject({ step: 0, title: 'Intake', stem: 'step-00' })
  })
  test('--step with no such step is a usage error that lists the steps', () => {
    expect(() => planFrames(info, { kind: 'step', step: 9 })).toThrow(UsageError)
    expect(() => planFrames(info, { kind: 'step', step: 9 })).toThrow('steps: 1, 2, 3')
  })
  test('--at maps each time to its step (half-open, the last step owns the end)', () => {
    expect(planFrames(info, { kind: 'at', items: [{ kind: 'time', t: 0 }, { kind: 'time', t: 1.5 }, { kind: 'time', t: 2 }, { kind: 'time', t: 6 }] })).toEqual([
      { step: 1, title: 'Intake', t: 0, stem: 't-0.000' },
      { step: 1, title: 'Intake', t: 1.5, stem: 't-1.500' },
      { step: 2, title: 'Compression', t: 2, stem: 't-2.000' },
      { step: 3, title: 'Power', t: 6, stem: 't-6.000' },
    ])
  })
  test('--at past the end is a usage error', () => {
    expect(() => planFrames(info, { kind: 'at', items: [{ kind: 'time', t: 6.5 }] })).toThrow('past the end of the story (duration 6s)')
  })
  test('a scene without steps still gives one frame', () => {
    const bare: SceneInfo = { ...info, steps: [], duration: 0 }
    expect(planFrames(bare, { kind: 'steps' })).toEqual([{ step: null, title: 'Engine', t: 0, stem: 'frame' }])
    expect(planFrames(bare, { kind: 'at', items: [{ kind: 'time', t: 0 }] })[0]).toMatchObject({ step: null, title: 'Engine' })
  })
  test('stepEndTime never leaves the step', () => {
    expect(stepEndTime(0, 2)).toBe(1.999)
    expect(stepEndTime(2, 2.0005)).toBe(2)
    expect(stepEndTime(1, 1)).toBe(1)
  })
})

// a longer story: two chapters, narration with guide spans
const story: SceneInfo = {
  title: 'Press', duration: 20,
  steps: [
    { index: 1, title: 'Parts', t0: 0, t1: 5, chapter: 1 },
    { index: 2, title: 'Push', t0: 5, t1: 10, chapter: 1 },
    { index: 3, title: 'Trade', t0: 10, t1: 20, chapter: 2 },
  ],
  params: [], parts: [], views: null, problems: null, fatal: null,
  chapters: [{ index: 1, title: 'One fluid', t0: 0, t1: 10, steps: [1, 2] }, { index: 2, title: 'The trade', t0: 10, t1: 20, steps: [3] }],
  transcript: [
    { step: 1, title: 'Parts', chapter: 1, chapterTitle: 'One fluid', t0: 0, t1: 5, note: null, narration: [{ text: 'A [small piston](small) and a [large one](ring:large).', plain: 'A small piston and a large one.', t0: 0, duration: 2.4 }] },
    { step: 2, title: 'Push', chapter: 1, chapterTitle: 'One fluid', t0: 5, t1: 10, note: null, narration: [{ text: 'Nothing to point at here.', plain: 'Nothing to point at here.', t0: 5, duration: 2 }] },
    { step: 3, title: 'Trade', chapter: 2, chapterTitle: 'The trade', t0: 10, t1: 20, note: null, narration: [{ text: 'The [oil](glow:oil) presses everywhere.', plain: 'The oil presses everywhere.', t0: 10, duration: 2 }] },
  ],
}

describe('planFrames: cues, filmstrips, parameter addresses', () => {
  test('chapters travel with the plan', () => {
    expect(planFrames(story, { kind: 'steps' }).map((p) => [p.step, p.chapter])).toEqual([[1, 1], [2, 1], [3, 2]])
    expect(planFrames(info, { kind: 'steps' })[0]).not.toHaveProperty('chapter')
  })
  test('--fine: n evenly spaced times, both ends included', () => {
    const plans = planFrames(info, { kind: 'fine', t0: 2, t1: 4, count: 5 })
    expect(plans.map((p) => p.t)).toEqual([2, 2.5, 3, 3.5, 4])
    expect(plans.map((p) => p.step)).toEqual([2, 2, 2, 2, 3])
    expect(plans.map((p) => p.stem)).toEqual(['t-2.000', 't-2.500', 't-3.000', 't-3.500', 't-4.000'])
    expect(() => planFrames(info, { kind: 'fine', t0: 5, t1: 7, count: 3 })).toThrow('--fine 5:7:3: past the end of the story (duration 6s)')
  })
  test('--cues without a host list: scheduled from the narration text with the guide library, one frame per span', () => {
    const { cues, from } = storyCues(story)
    expect(from).toBe('cli')
    expect(cues.map((c) => [c.step, c.verb, c.targets, c.words])).toEqual([
      [1, 'point', ['small'], 'small piston'], [1, 'ring', ['large'], 'large one'], [3, 'glow', ['oil'], 'oil'],
    ])
    // a cue lands while its sentence is spoken, in story order, and its mark is drawn at or after it lands
    expect(cues[0]!.land).toBeGreaterThanOrEqual(0)
    expect(cues[1]!.land).toBeGreaterThan(cues[0]!.land)
    expect(cues[1]!.land).toBeLessThan(2.4)
    expect(cues[2]!.land).toBeGreaterThanOrEqual(10)
    for (const c of cues) expect(c.drawn).toBeGreaterThanOrEqual(c.land)
    const plans = planFrames(story, { kind: 'cues' })
    expect(plans.map((p) => [p.stem, p.step, p.chapter, p.cue!.index, p.cue!.verb])).toEqual([
      ['cue-01', 1, 1, 1, 'point'], ['cue-02', 1, 1, 2, 'ring'], ['cue-03', 3, 2, 3, 'glow'],
    ])
    // the frame shows the mark drawn and stays inside the cue's step
    expect(plans[1]!.t).toBe(cues[1]!.drawn)
    for (const p of plans) expect(p.t).toBeGreaterThanOrEqual(p.cue!.land)
  })
  test('--cues with a host list uses it as it is', () => {
    const hosted: SceneInfo = { ...story, cues: [{ step: 3, verb: 'ring', targets: ['oil'], words: 'oil', land: 12, drawn: 12.45 }, { step: 1, verb: 'point', targets: ['small'], words: 'it', land: 1, drawn: 1 }] }
    expect(storyCues(hosted).from).toBe('host')
    expect(planFrames(hosted, { kind: 'cues' }).map((p) => [p.cue!.index, p.t, p.step])).toEqual([[1, 1, 1], [2, 12.45, 3]])
    // a mark that would finish after its step ended is shot at the step's last instant
    const late: SceneInfo = { ...story, cues: [{ step: 1, verb: 'ring', targets: ['small'], words: 'it', land: 4.9, drawn: 5.35 }] }
    expect(planFrames(late, { kind: 'cues' })[0]!.t).toBe(4.999)
  })
  test('--cues on a narration without spans says how to write one', () => {
    expect(() => planFrames(info, { kind: 'cues' })).toThrow('has no guide cue')
    expect(() => planFrames(info, { kind: 'cues' })).toThrow("st.say('The [piston](piston)")
  })
  test('--at name=value: the time comes from the caller, the name and value go into the file name and the plan', () => {
    const plans = planFrames(info, { kind: 'at', items: [{ kind: 'param', name: 'crank', value: 90 }, { kind: 'time', t: 1 }, { kind: 'param', name: 'mode', value: 'fast lane' }] }, (item) => (item.name === 'crank' ? 2.75 : 5))
    expect(plans.map((p) => [p.stem, p.t, p.step])).toEqual([['at-crank-90', 2.75, 2], ['t-1.000', 1, 1], ['at-mode-fast-lane', 5, 3]])
    expect(plans[0]!.param).toEqual({ name: 'crank', value: 90 })
    expect(plans[1]).not.toHaveProperty('param')
    expect([valueSlug(-0.5), valueSlug(true), valueSlug('a/b c'), valueSlug('')]).toEqual(['m0.5', 'true', 'a-b-c', 'x'])
  })
  test('stepAt: half-open steps, the last one owns the end', () => {
    expect([0, 1.999, 2, 6, 7].map((t) => stepAt(info.steps, t)?.index)).toEqual([1, 1, 2, 3, 3])
    expect(stepAt([], 1)).toBeUndefined()
  })
  test('turntable: evenly spaced azimuths from the front, named for file names', () => {
    expect(turntableAngles(8)).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
    expect(turntableAngles(3)).toEqual([0, 120, 240])
    expect(turntableAngles(16).map(turntableName).slice(0, 3)).toEqual(['az000', 'az022.5', 'az045'])
  })
})

describe('file names', () => {
  const plan = { step: 2, title: 'Compression', t: 3.999, stem: 'step-02' }
  test('view and debug mode are part of the name', () => {
    expect(frameFileStem(plan, null, null)).toBe('step-02')
    expect(frameFileStem(plan, 'iso', null)).toBe('step-02.iso')
    expect(frameFileStem(plan, 'iso', 'ids')).toBe('step-02.iso.debug-ids')
    expect(frameFileStem(plan, null, 'ids')).toBe('step-02.debug-ids')
  })
})

describe('sheetLayout', () => {
  test('6 frames of 1280x720 → 3x2 grid, exactly 1280 wide', () => {
    const l = sheetLayout(6, 1280, 720)
    expect(l).toMatchObject({ cols: 3, rows: 2, cellWidth: 416, cellHeight: 234, width: 1280, height: 544 })
  })
  test('grid shape by count', () => {
    const shape = (n: number): string => { const l = sheetLayout(n, 1280, 720); return `${l.cols}x${l.rows}` }
    expect([1, 2, 3, 4, 5, 6, 7, 9, 10, 13].map(shape)).toEqual(['1x1', '2x1', '3x1', '2x2', '3x2', '3x2', '3x3', '3x3', '3x4', '3x5'])
  })
  test('never wider than the limit, and the height follows from the grid', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 12, 20]) {
      for (const [w, h] of [[1280, 720], [640, 360], [800, 800], [1920, 1080]] as const) {
        const l = sheetLayout(n, w, h)
        expect(l.width).toBeLessThanOrEqual(SHEET_MAX_WIDTH)
        expect(l.width).toBe(2 * l.pad + l.cols * l.cellWidth + (l.cols - 1) * l.gap)
        expect(l.height).toBe(2 * l.pad + l.rows * (l.cellHeight + l.captionHeight) + (l.rows - 1) * l.gap)
        expect(l.cols * l.rows).toBeGreaterThanOrEqual(n)
        expect(l.cellWidth).toBeLessThanOrEqual(w)
      }
    }
  })
  test('a wider limit gives more columns; cells are never upscaled', () => {
    expect(sheetLayout(4, 1920, 1080, 1920)).toMatchObject({ cols: 4, rows: 1, cellWidth: 470, width: 1920 })
    expect(sheetLayout(6, 1920, 1080, 1920)).toMatchObject({ cols: 3, rows: 2 })
    expect(sheetLayout(1, 320, 180)).toMatchObject({ cellWidth: 320, cellHeight: 180, width: 336 })
  })
})

describe('sheet page', () => {
  const cells = [
    { src: '/__mimir/frame/0.png', step: 1, title: 'Intake <&> "x"', t: 1.999, view: null },
    { src: '/__mimir/frame/1.png', step: 2, title: 'Compression', t: 3.999, view: 'iso' },
  ]
  test('captions carry step number, title and time (and the view)', () => {
    expect(sheetCaption(cells[0]!)).toEqual({ left: '1  Intake <&> "x"', right: 't=2.00s' })
    expect(sheetCaption(cells[1]!)).toEqual({ left: '2  Compression', right: 't=4.00s  iso' })
  })
  test('html has one figure per frame, fixed pixel size, escaped titles, no scripts', () => {
    const l = sheetLayout(2, 1280, 720)
    const html = sheetHtml(cells, l)
    expect(html.match(/<figure>/g)!.length).toBe(2)
    expect(html).toContain(`width:${l.width}px;height:${l.height}px`)
    expect(html).toContain('Intake &lt;&amp;&gt; &quot;x&quot;')
    expect(html).toContain('<b>2</b>')
    expect(html).toContain('t=4.00s  iso')
    expect(html).not.toContain('<script')
  })
})

describe('story sheet: a row per chapter, pages no taller than the limit', () => {
  const cell = (step: number, chapter: number | null): SheetCell => ({ src: `${step}.png`, step, title: `Step ${step}`, t: step, view: null, chapter })
  test('one group without chapters is exactly the plain contact sheet', () => {
    const cells = [1, 2, 3, 4, 5].map((n) => cell(n, null))
    const groups = groupByChapter(cells, {})
    expect(groups).toEqual([{ heading: null, range: null, cells }])
    const l = storyLayout(groups, 1280, 720)
    const flat = sheetLayout(5, 1280, 720)
    expect(l.cell).toEqual(flat)
    expect(l.pages.length).toBe(1)
    expect(l.pages[0]).toMatchObject({ width: flat.width, height: flat.height, rows: flat.rows, frames: 5 })
  })
  test('chapters become headed groups in story order', () => {
    const cells = [cell(1, 1), cell(2, 1), cell(3, 2)]
    const groups = groupByChapter(cells, story)
    expect(groups.map((g) => [g.heading, g.range, g.cells.length])).toEqual([
      ['Chapter 1 · One fluid', '0.0 s – 10.0 s', 2], ['Chapter 2 · The trade', '10.0 s – 20.0 s', 1],
    ])
    const l = storyLayout(groups, 1280, 720)
    // as many columns as the longest chapter needs; a heading row above each group
    expect(l.cell.cols).toBe(2)
    const rowH = l.cell.cellHeight + l.cell.captionHeight
    expect(l.pages).toHaveLength(1)
    expect(l.pages[0]!.height).toBe(2 * l.cell.pad + 2 * (SHEET_HEADER + rowH) + l.cell.gap)
    expect(l.pages[0]).toMatchObject({ rows: 2, frames: 3 })
    const html = storyHtml(l.pages[0]!, l.cell)
    expect(html.match(/<h2>/g)!.length).toBe(2)
    expect(html.match(/<figure>/g)!.length).toBe(3)
    expect(html).toContain('Chapter 2 · The trade')
    expect(html).toContain(`width:${l.pages[0]!.width}px;height:${l.pages[0]!.height}px`)
    expect(html).not.toContain('<script')
  })
  test('steps before the first chapter get their own group', () => {
    const groups = groupByChapter([cell(1, null), cell(2, 1)], story)
    expect(groups.map((g) => g.heading)).toEqual(['Before the first chapter', 'Chapter 1 · One fluid'])
  })
  test('a long story is split into pages: none taller than the limit, every cell on exactly one page, headings repeated', () => {
    const cells: SheetCell[] = []
    const chapters = Array.from({ length: 8 }, (_, c) => ({ index: c + 1, title: `C${c + 1}`, t0: c * 10, t1: c * 10 + 10, steps: [] as number[] }))
    for (let c = 1; c <= 8; c++) for (let k = 0; k < 6; k++) cells.push(cell(cells.length + 1, c))
    const l = storyLayout(groupByChapter(cells, { chapters }), 1280, 720)
    expect(l.pages.length).toBeGreaterThan(1)
    for (const p of l.pages) {
      expect(p.height).toBeLessThanOrEqual(SHEET_MAX_HEIGHT)
      expect(p.frames).toBe(p.groups.reduce((n, g) => n + g.cells.length, 0))
      // the height is what the groups add up to
      const rowH = l.cell.cellHeight + l.cell.captionHeight
      const rows = p.groups.map((g) => Math.ceil(g.cells.length / l.cell.cols))
      expect(p.rows).toBe(rows.reduce((a, b) => a + b, 0))
      expect(p.height).toBe(2 * l.cell.pad + p.groups.length * SHEET_HEADER + p.rows * rowH + (p.rows - p.groups.length) * l.cell.gap + (p.groups.length - 1) * l.cell.gap)
    }
    const placed = l.pages.flatMap((p) => p.groups.flatMap((g) => g.cells.map((c) => c.src)))
    expect(placed).toEqual(cells.map((c) => c.src))
    expect(l.pages.reduce((n, p) => n + p.frames, 0)).toBe(48)
  })
  test('a chapter that does not fit continues on the next page under a repeated heading', () => {
    const cells = Array.from({ length: 30 }, (_, i) => cell(i + 1, 1))
    const l = storyLayout(groupByChapter(cells, { chapters: [{ index: 1, title: 'Long', t0: 0, t1: 1, steps: [] }] }), 1280, 720, { maxHeight: 900 })
    expect(l.pages.length).toBeGreaterThan(1)
    expect(l.pages[0]!.groups[0]!.heading).toBe('Chapter 1 · Long')
    expect(l.pages[1]!.groups[0]!.heading).toBe('Chapter 1 · Long (continued)')
    for (const p of l.pages) expect(p.height).toBeLessThanOrEqual(900)
  })
  test('--cols and the strip width choose the grid; cells are never upscaled', () => {
    const cells = Array.from({ length: 12 }, (_, i) => cell(i + 1, null))
    expect(storyLayout(groupByChapter(cells, {}), 1280, 720, { cols: 6 }).cell).toMatchObject({ cols: 6, rows: 2, cellWidth: 204 })
    expect(storyLayout(groupByChapter(cells, {}), 1280, 720, { cols: 4, minCell: 300 }).cell).toMatchObject({ cols: 4, rows: 3 })
    expect(storyLayout(groupByChapter(cells.slice(0, 2), {}), 320, 180, { cols: 2 }).cell.cellWidth).toBe(320)
  })
  test('captions: a cue cell shows its number and what it points at; tokens follow the pixel count', () => {
    const cue: SheetCell = { src: 'a.png', step: 2, title: 'Push', t: 5.2, view: null, badge: '4', label: 'ring large · “the large one”' }
    expect(sheetCaption(cue)).toEqual({ left: '4  ring large · “the large one”', right: 't=5.20s' })
    expect(imageTokens(1280, 720)).toBe(1229)
    expect(imageTokens(1920, 1080)).toBe(2765)
  })
})

describe('--debug ids: a colour per part and a legend', () => {
  test('colours are stable per part index and distinct for neighbours', () => {
    const colors = Array.from({ length: 40 }, (_, i) => legendColor(i))
    expect(new Set(colors).size).toBe(40)
    expect(legendColor(3)).toBe(legendColor(3))
    expect(colors[0]).toMatch(/^hsl\(/)
  })
  test('the page outlines and numbers every part that draws something, and lists them under the frame', () => {
    const html = legendHtml('frame.png', 1280, 720, [
      { n: 1, id: 'wheel', color: legendColor(0), rect: { x: 100, y: 200, width: 50, height: 60 }, at: { x: 120, y: 230 }, space: '3d' },
      { n: 2, id: 'a<b>', color: legendColor(1), rect: { x: 10, y: 4, width: 5, height: 5 }, at: null, space: '2d' },
      { n: 3, id: 'hidden', color: legendColor(2), rect: null, at: null, space: '3d' },
    ])
    expect(html.match(/<rect /g)!.length).toBe(2)
    expect(html.match(/<li>/g)!.length).toBe(2)
    expect(html).toContain('<b>1</b>wheel')
    expect(html).toContain('<b>2</b>a&lt;b&gt;')
    expect(html).not.toContain('hidden')
    expect(html).toContain(`stroke="${legendColor(0)}"`)
    expect(html).toContain(`background:${legendColor(0)}`)
    expect(html.match(/<circle /g)!.length).toBe(1) // the visible point of the 3D part
    expect(html).toContain('<img src="frame.png"')
    expect(html).not.toContain('<script')
  })
})

describe('manifest', () => {
  const entries: ManifestEntry[] = [
    { path: '/o/step-01.png', step: 1, title: 'Intake', t: 1.999, camera: null, width: 1280, height: 720, sha256: 'aa' },
    { path: '/o/step-02.iso.png', step: 2, title: 'Compression', t: 3.999, camera: 'iso', width: 1280, height: 720, sha256: 'bb' },
    { path: '/o/sheet.png', step: null, title: 'contact sheet', t: null, camera: null, width: 1280, height: 284, sha256: 'cc', sheet: { cols: 2, rows: 1, frames: 2 } },
  ]
  test('JSON form keeps the documented keys in order', () => {
    const parsed = JSON.parse(JSON.stringify(entries))
    expect(Object.keys(parsed[0])).toEqual(['path', 'step', 'title', 't', 'camera', 'width', 'height', 'sha256'])
    expect(parsed[2].sheet).toEqual({ cols: 2, rows: 1, frames: 2 })
  })
  test('text form: one line per file, the sheet last', () => {
    expect(formatManifestText(entries)).toBe(
      'step 1 "Intake" t=1.999s  1280x720  /o/step-01.png\n' +
        'step 2 "Compression" t=3.999s iso  1280x720  /o/step-02.iso.png\n' +
        'sheet 2x1  1280x284  /o/sheet.png\n',
    )
  })
  test('text form names the cue or the parameter value a frame was shot for', () => {
    const more: ManifestEntry[] = [
      { path: '/o/cue-01.png', step: 1, title: 'Parts', t: 0.5, camera: null, width: 1280, height: 720, sha256: 'aa', cue: { index: 1, verb: 'ring', targets: ['a', 'b'], words: 'both', land: 0.4 } },
      { path: '/o/at-crank-90.png', step: 2, title: 'Turn', t: 6.966, camera: 'az045', width: 1280, height: 720, sha256: 'bb', param: { name: 'crank', value: 90 } },
    ]
    expect(formatManifestText(more)).toBe(
      'step 1 "Parts" t=0.5s cue 1 ring:a+b  1280x720  /o/cue-01.png\n' + 'step 2 "Turn" t=6.966s az045 crank=90  1280x720  /o/at-crank-90.png\n',
    )
  })
  test('sha256 of bytes', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('pngSize', () => {
  // a real 3x2 PNG header: signature, IHDR length 13, "IHDR", width 3, height 2
  const header = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0,
  ])
  test('reads width and height from IHDR', () => {
    expect(pngSize(header)).toEqual({ width: 3, height: 2 })
    expect(pngSize(header.subarray(0, 29))).toEqual({ width: 3, height: 2 })
  })
  test('rejects anything that is not a PNG', () => {
    expect(pngSize(new Uint8Array(40))).toBeNull()
    expect(pngSize(header.subarray(0, 10))).toBeNull()
    const jpeg = header.slice()
    jpeg[1] = 0x00
    expect(pngSize(jpeg)).toBeNull()
  })
})
