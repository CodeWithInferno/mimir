import { describe, expect, test } from 'bun:test'
import { articleMarkdown, mdEscape, stepParagraph } from '../../../src/cli/article.ts'
import type { SceneInfo, TranscriptEntry } from '../../../src/cli/format.ts'

const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({ step: 1, title: 'Step', chapter: null, chapterTitle: null, t0: 0, t1: 1, narration: [], note: null, ...over })
const say = (plain: string, text = plain) => ({ text, plain, t0: 0, duration: 1 })
const base: SceneInfo = { title: 'How a press works', duration: 9, steps: [], params: [], parts: [], views: null, problems: null, fatal: null }

describe('export --md: the transcript as an article', () => {
  test('chapters are headings, steps numbered sections, narration a paragraph, notes as written', () => {
    const info: SceneInfo = {
      ...base, subtitle: 'Pascal, in oil',
      chapters: [{ index: 1, title: 'One fluid', t0: 0, t1: 5, steps: [1, 2] }, { index: 2, title: 'The trade', t0: 5, t1: 9, steps: [3] }],
      transcript: [
        entry({ step: 1, title: 'The parts', chapter: 1, chapterTitle: 'One fluid', narration: [say('A small piston and a large one.', 'A [small piston](small) and a [large one](ring:large).')] }),
        entry({ step: 2, title: 'Push down', chapter: 1, chapterTitle: 'One fluid', narration: [say('Push the small piston.'), say('The large one rises.')], note: 'Volume is kept: `A1 × d1 = A2 × d2`.' }),
        entry({ step: 3, title: 'Same pressure', chapter: 2, chapterTitle: 'The trade', narration: [say('Nine times the area, nine times the force.')] }),
      ],
    }
    const a = articleMarkdown(info)
    expect(a.markdown).toBe(
      '# How a press works\n\n*Pascal, in oil*\n\n' +
        '## One fluid\n\n### 1. The parts\n\nA small piston and a large one.\n\n' +
        '### 2. Push down\n\nPush the small piston. The large one rises.\n\nVolume is kept: `A1 × d1 = A2 × d2`.\n\n' +
        '## The trade\n\n### 3. Same pressure\n\nNine times the area, nine times the force.\n',
    )
    expect(a).toMatchObject({ steps: 3, chapters: 2, words: 7 + 8 + 8 })
    // the guide spans never leak into the article
    expect(a.markdown).not.toContain('](')
  })
  test('without chapters the steps are top-level sections; --frames puts an image under each heading', () => {
    const info: SceneInfo = { ...base, transcript: [entry({ step: 1, title: 'Intake', narration: [say('Air comes in.')] }), entry({ step: 2, title: 'Burn #2', narration: [] })] }
    const a = articleMarkdown(info, { frames: new Map([[1, 'art-frames/step-01.png'], [2, 'art frames/step-02.png']]) })
    expect(a.markdown).toBe(
      '# How a press works\n\n## 1. Intake\n\n![Intake](art-frames/step-01.png)\n\nAir comes in.\n\n## 2. Burn \\#2\n\n![Burn \\#2](art%20frames/step-02.png)\n',
    )
    expect(a.chapters).toBe(0)
  })
  test('a step before the first chapter stays at the top level', () => {
    const info: SceneInfo = { ...base, transcript: [entry({ step: 1, title: 'Hello' }), entry({ step: 2, title: 'In', chapter: 1, chapterTitle: 'Body' })] }
    expect(articleMarkdown(info).markdown).toBe('# How a press works\n\n## 1. Hello\n\n## Body\n\n### 2. In\n')
  })
  test('a viewer without a transcript still gives the step titles; an untitled scene a title', () => {
    const info: SceneInfo = { ...base, title: '', steps: [{ index: 1, title: 'A', t0: 0, t1: 1 }, { index: 2, title: '', t0: 1, t1: 2 }] }
    expect(articleMarkdown(info).markdown).toBe('# Untitled\n\n## 1. A\n\n## 2. Step 2\n')
  })
  test('narration is escaped so that it cannot start markdown; a note is not', () => {
    expect(mdEscape('a*b_c [x] <y> #1 |')).toBe('a\\*b\\_c \\[x\\] \\<y\\> \\#1 \\|')
    expect(stepParagraph(entry({ narration: [say(' One. '), say(''), say('Two.')] }))).toBe('One. Two.')
    const info: SceneInfo = { ...base, transcript: [entry({ narration: [say('2 * 3 = 6')], note: '**bold** stays' })] }
    expect(articleMarkdown(info).markdown).toContain('2 \\* 3 = 6\n\n**bold** stays\n')
  })
})
