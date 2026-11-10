import { describe, expect, test } from 'bun:test'
import {
  MAX_SHOWN, buildCheckResult, displayFile, fatalToDiag, formatCheckJson, formatCheckText, formatDiagText, formatSeconds,
  normalizeDiag, normalizeFatal, normalizeInfo, sortDiags, statusLine, type Diag, type StepInfo,
} from '../../../src/cli/format.ts'

const steps: StepInfo[] = [
  { index: 1, title: 'Intake', t0: 0, t1: 2 },
  { index: 2, title: 'Compression', t0: 2, t1: 4 },
]
const diag = (over: Partial<Diag> = {}): Diag => ({
  code: 'OFF-FRAME', severity: 'error', step: 2, t: 3.5, ids: ['label3'], file: 'engine.scene.js', line: 41,
  measured: 38, limit: 0, what: '#label3 extends 38 px past the right edge of the frame.', fix: ['label3.nextTo(piston, "left")'], ...over,
})

describe('formatDiagText (DESIGN section 7)', () => {
  test('the full three-line form', () => {
    expect(formatDiagText(diag(), steps)).toBe(
      'OFF-FRAME error | step 2 "Compression" t=3.5s | #label3 | engine.scene.js:41\n' +
        '  what: #label3 extends 38 px past the right edge of the frame.\n' +
        '  fix: label3.nextTo(piston, "left")',
    )
  })
  test('parts that are absent are left out of the header', () => {
    expect(formatDiagText(diag({ step: null, t: null, ids: ['piston'], line: 14, file: 'scene.js', code: 'API-UNKNOWN' }), steps)).toBe(
      'API-UNKNOWN error | #piston | scene.js:14\n  what: #label3 extends 38 px past the right edge of the frame.\n  fix: label3.nextTo(piston, "left")',
    )
    expect(formatDiagText(diag({ step: null, t: null, ids: [], file: null, line: null, fix: [] }), steps)).toBe(
      'OFF-FRAME error\n  what: #label3 extends 38 px past the right edge of the frame.',
    )
  })
  test('several ids, several fixes (most likely first), unknown step title', () => {
    const text = formatDiagText(diag({ step: 7, ids: ['a', 'b'], fix: ['a.nextTo(b)', 'a.shift(1, 0)'] }), steps)
    expect(text.split('\n')[0]).toBe('OFF-FRAME error | step 7 t=3.5s | #a #b | engine.scene.js:41')
    expect(text.split('\n')[2]).toBe('  fix: a.nextTo(b); a.shift(1, 0)')
  })
  test('a step title reported with the diagnostic wins over the story lookup, and stays out of the JSON', () => {
    const d = normalizeDiag({ ...diag({ step: 7 }), stepTitle: 'Exhaust' })
    expect(formatDiagText(d, steps).split('\n')[0]).toBe('OFF-FRAME error | step 7 "Exhaust" t=3.5s | #label3 | engine.scene.js:41')
    expect(JSON.parse(formatCheckJson(buildCheckResult([d], false))).diagnostics[0].stepTitle).toBeUndefined()
  })
  test('multi-line messages are folded onto one line', () => {
    expect(formatDiagText(diag({ what: 'first\n   second' }), steps).split('\n')[1]).toBe('  what: first second')
  })
  test('page URLs under /scene/ become paths relative to the working directory', () => {
    const ctx = { sceneDir: '/work/scenes', cwd: '/work' }
    expect(formatDiagText(diag({ file: '/scene/engine.scene.js' }), steps, ctx).split('\n')[0]).toEndWith('| scenes/engine.scene.js:41')
    expect(displayFile('http://127.0.0.1:5000/scene/sub/a%20b.js?v=1', ctx)).toBe('scenes/sub/a b.js')
    expect(displayFile('/scene/x.js', { sceneDir: '/elsewhere', cwd: '/work' })).toBe('/elsewhere/x.js')
    expect(displayFile('/mimir.js', ctx)).toBe('/mimir.js')
    expect(displayFile('engine.scene.js', null)).toBe('engine.scene.js')
  })
  test('formatSeconds trims to 3 decimals', () => {
    expect(formatSeconds(3.5)).toBe('3.5')
    expect(formatSeconds(2)).toBe('2')
    expect(formatSeconds(1.9990000001)).toBe('1.999')
  })
})

describe('ordering, the cap and the status line', () => {
  const many: Diag[] = [
    ...Array.from({ length: 10 }, (_, i) => diag({ code: 'TEXT-OVERLAP', severity: 'warn', ids: [`w${i}`] })),
    diag({ code: 'FLOATING', ids: ['e1'] }),
    diag({ code: 'INFO', severity: 'info', ids: ['i1'] }),
    diag({ code: 'DEAD-PARAM', ids: ['e2'] }),
  ]
  test('errors first, then warnings, then the rest; stable inside a class', () => {
    const sorted = sortDiags(many)
    expect(sorted.slice(0, 2).map((d) => d.ids[0])).toEqual(['e1', 'e2'])
    expect(sorted.slice(2, 12).map((d) => d.ids[0])).toEqual(Array.from({ length: 10 }, (_, i) => `w${i}`))
    expect(sorted[12]!.ids[0]).toBe('i1')
  })
  test('at most 8 are shown unless all is asked for; counts cover everything', () => {
    const r = buildCheckResult(many, false)
    expect(MAX_SHOWN).toBe(8)
    expect(r).toMatchObject({ ok: false, errors: 2, warnings: 10, total: 13, shown: 8 })
    expect(r.diagnostics.length).toBe(8)
    expect(r.diagnostics[0]!.code).toBe('FLOATING')
    const all = buildCheckResult(many, true)
    expect(all.shown).toBe(13)
    expect(all.diagnostics.length).toBe(13)
  })
  test('status line starts with OK or FAIL and says how many are hidden', () => {
    expect(statusLine(buildCheckResult([], false))).toBe('OK 0 errors, 0 warnings')
    expect(statusLine(buildCheckResult([diag({ severity: 'warn' })], false))).toBe('OK 0 errors, 1 warning')
    expect(statusLine(buildCheckResult([diag()], false))).toBe('FAIL 1 error, 0 warnings')
    expect(statusLine(buildCheckResult(many, false))).toBe('FAIL 2 errors, 10 warnings (showing 8 of 13; --all prints every one)')
    expect(statusLine(buildCheckResult(many, true))).toBe('FAIL 2 errors, 10 warnings')
  })
  test('warnings alone do not fail the check', () => {
    expect(buildCheckResult([diag({ severity: 'warn' }), diag({ severity: 'unknown' })], false).ok).toBe(true)
  })
  test('text output: one block per diagnostic, then the status line', () => {
    const text = formatCheckText(buildCheckResult([diag(), diag({ severity: 'warn', code: 'TEXT-TINY' })], false), steps)
    const lines = text.trimEnd().split('\n')
    expect(lines.length).toBe(7)
    expect(lines[0]).toStartWith('OFF-FRAME error |')
    expect(lines[3]).toStartWith('TEXT-TINY warn |')
    expect(lines[6]).toBe('FAIL 1 error, 1 warning')
    expect(text.endsWith('\n')).toBe(true)
  })
  test('JSON output is one compact line with the documented record', () => {
    const json = formatCheckJson(buildCheckResult([diag({ file: '/scene/a.js' })], false), { sceneDir: '/w', cwd: '/w' })
    expect(json.endsWith('\n')).toBe(true)
    expect(json.trimEnd().includes('\n')).toBe(false)
    const parsed = JSON.parse(json)
    expect(parsed).toEqual({
      ok: false, errors: 1, warnings: 0, total: 1, shown: 1,
      diagnostics: [{
        code: 'OFF-FRAME', severity: 'error', step: 2, t: 3.5, ids: ['label3'], file: 'a.js', line: 41, measured: 38, limit: 0,
        what: '#label3 extends 38 px past the right edge of the frame.', fix: ['label3.nextTo(piston, "left")'],
      }],
    })
    expect(Object.keys(parsed.diagnostics[0])).toEqual(['code', 'severity', 'step', 't', 'ids', 'file', 'line', 'measured', 'limit', 'what', 'fix'])
  })
})

describe('normalising what the page reports', () => {
  test('a complete diagnostic passes through', () => {
    expect(normalizeDiag(diag())).toEqual(diag())
  })
  test('missing and odd fields become safe defaults, never a throw', () => {
    expect(normalizeDiag({ code: 'X', id: 'a', fix: 'do this', message: 'm' })).toEqual({
      code: 'X', severity: 'error', step: null, t: null, ids: ['a'], file: null, line: null, measured: null, limit: null, what: 'm', fix: ['do this'],
    })
    expect(normalizeDiag(null).code).toBe('UNKNOWN')
    expect(normalizeDiag({ measured: NaN, limit: '14 px' })).toMatchObject({ measured: 'NaN', limit: '14 px' })
  })
  test('info(): steps, params, parts are always arrays with typed fields', () => {
    const info = normalizeInfo({ title: 'T', duration: 4, steps: [{ index: 1, title: 'A', t0: 0, t1: 4 }], params: [{ name: 'rpm', min: 0, max: 9, value: 3 }] })
    expect(info).toEqual({
      title: 'T', duration: 4, steps: [{ index: 1, title: 'A', t0: 0, t1: 4 }], params: [{ name: 'rpm', min: 0, max: 9, value: 3, kind: null, options: [] }], parts: [], views: null, problems: null, fatal: null,
    })
    expect(normalizeInfo(undefined)).toEqual({ title: '', duration: 0, steps: [], params: [], parts: [], views: null, problems: null, fatal: null })
    // what shot --set validates against, and what shot / export warn about
    expect(normalizeInfo({ params: [{ name: 'mode', kind: 'choice', options: ['a', 'b', 3], value: 'a' }], problems: { errors: 4, warnings: 1 } })).toMatchObject({ params: [{ kind: 'choice', options: ['a', 'b'] }], problems: { errors: 4, warnings: 1 } })
    expect(normalizeInfo({ views: ['iso', 'front', 3] }).views).toEqual(['iso', 'front'])
    expect(normalizeInfo({ steps: [{ title: 'A', t0: 0, t1: 3 }] })).toMatchObject({ duration: 3, steps: [{ index: 1 }] })
  })
  test('fatal may be a string or an object', () => {
    expect(normalizeFatal('boom')).toEqual({ message: 'boom', file: null, line: null })
    expect(normalizeFatal({ message: 'boom', file: '/scene/a.js', line: 3 })).toEqual({ message: 'boom', file: '/scene/a.js', line: 3 })
    expect(normalizeFatal(undefined)).toBeNull()
    expect(normalizeInfo({ fatal: 'x' }).fatal).toEqual({ message: 'x', file: null, line: null })
  })
  test('a fatal load error is exactly one RUNTIME-ERROR', () => {
    const d = fatalToDiag({ message: 'piston is not defined', file: '/scene/a.js', line: 12 }, '/scene/a.js')
    expect(d).toMatchObject({ code: 'RUNTIME-ERROR', severity: 'error', file: '/scene/a.js', line: 12, step: null, ids: [] })
    expect(d.what).toBe('the scene module failed to load: piston is not defined')
    expect(d.fix.length).toBe(1)
  })
  test('the line is recovered from a stack when the page gave none', () => {
    const d = fatalToDiag({ message: 'ReferenceError: x is not defined\n    at http://127.0.0.1:1/scene/a.scene.js:7:3', file: null, line: null }, '/scene/a.scene.js')
    expect(d.line).toBe(7)
    expect(displayFile(d.file!, { sceneDir: '/w', cwd: '/w' })).toBe('a.scene.js')
    expect(d.what).toBe('the scene module failed to load: ReferenceError: x is not defined')
  })
})

describe('normalizeInfo: chapters, transcript, cues (what long explanations add)', () => {
  test('absent on a host that does not report them', () => {
    const info = normalizeInfo({ title: 'T' })
    for (const key of ['chapters', 'transcript', 'cues', 'has3d', 'subtitle']) expect(info).not.toHaveProperty(key)
  })
  test('chapters and the transcript are made total; the chapter of a step travels with it', () => {
    const info = normalizeInfo({
      title: 'T', subtitle: 'sub', has3d: true,
      steps: [{ index: 1, title: 'A', t0: 0, t1: 4, chapter: 1 }, { index: 2, title: 'B', t0: 4, t1: 8, chapter: null }],
      chapters: [{ index: 1, title: 'One', t0: 0, t1: 4, steps: [1, 'x'], keep: ['a'] }, {}],
      transcript: [
        { step: 1, title: 'A', chapter: 1, chapterTitle: 'One', t0: 0, t1: 4, narration: [{ text: 'The [box](a).', plain: 'The box.', t0: 0, duration: 1.2, spans: [] }, { plain: 'Only plain.' }], note: 'n' },
        { narration: 'oops' },
      ],
    })
    expect(info.subtitle).toBe('sub')
    expect(info.has3d).toBe(true)
    expect(info.steps).toEqual([{ index: 1, title: 'A', t0: 0, t1: 4, chapter: 1 }, { index: 2, title: 'B', t0: 4, t1: 8 }])
    expect(info.chapters).toEqual([{ index: 1, title: 'One', t0: 0, t1: 4, steps: [1] }, { index: 2, title: '', t0: 0, t1: 0, steps: [] }])
    expect(info.transcript).toEqual([
      { step: 1, title: 'A', chapter: 1, chapterTitle: 'One', t0: 0, t1: 4, note: 'n', narration: [{ text: 'The [box](a).', plain: 'The box.', t0: 0, duration: 1.2 }, { text: 'Only plain.', plain: 'Only plain.', t0: 0, duration: 0 }] },
      { step: 2, title: '', chapter: null, chapterTitle: null, t0: 0, t1: 0, note: null, narration: [] },
    ])
  })
  test('cues reported by the host: several spellings of the times are accepted, cues without a time or a step are dropped', () => {
    const info = normalizeInfo({ cues: [
      { step: 1, verb: 'ring', targets: ['a', 'b'], words: 'both', land: 1.5, drawn: 1.95 },
      { step: 2, target: 'c', landAt: 5, drawEnd: 5.4 },
      { step: 3, t: 7 },
      { verb: 'point', land: 9 },
      { step: 4 },
    ] })
    expect(info.cues).toEqual([
      { step: 1, verb: 'ring', targets: ['a', 'b'], words: 'both', land: 1.5, drawn: 1.95 },
      { step: 2, verb: 'point', targets: ['c'], words: '', land: 5, drawn: 5.4 },
      { step: 3, verb: 'point', targets: [], words: '', land: 7, drawn: 7 },
    ])
    expect(normalizeInfo({ cues: [] }).cues).toEqual([])
  })
})
