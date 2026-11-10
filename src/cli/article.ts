// mimir export --md: the transcript as an article (DESIGN section 3.4). Chapters become headings, every step a
// numbered section with its narration as a paragraph and its st.note() text as written. Pure: text in, text out.
import type { SceneInfo, TranscriptEntry } from './format.ts'

export interface ArticleOptions {
  /** step number → image path as it should appear in the markdown (relative to the file), or absent for no images */
  frames?: Map<number, string>
}

export interface Article {
  markdown: string
  steps: number
  chapters: number
  /** words of narration (notes not counted) */
  words: number
}

/** Text that is safe as markdown inline content: characters that would start formatting are escaped. */
export function mdEscape(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#|])/g, '\\$1')
}

/** The narration of a step as one paragraph: the spoken text, guide spans reduced to their words. */
export function stepParagraph(entry: TranscriptEntry): string {
  return entry.narration.map((n) => n.plain.trim()).filter((s) => s !== '').join(' ')
}

/** Markdown of the whole explanation. A scene without a transcript gives its step titles only. */
export function articleMarkdown(info: SceneInfo, opts: ArticleOptions = {}): Article {
  const transcript: TranscriptEntry[] = info.transcript?.length
    ? info.transcript
    : info.steps.map((s) => ({ step: s.index, title: s.title, chapter: s.chapter ?? null, chapterTitle: null, t0: s.t0, t1: s.t1, narration: [], note: null }))
  const chapters = info.chapters ?? []
  const hasChapters = transcript.some((e) => e.chapter !== null)
  const out: string[] = [`# ${mdEscape(info.title || 'Untitled')}`, '']
  if (info.subtitle) out.push(`*${mdEscape(info.subtitle)}*`, '')
  let chapter: number | null = null
  let words = 0
  for (const e of transcript) {
    if (hasChapters && e.chapter !== null && e.chapter !== chapter) {
      const title = e.chapterTitle ?? chapters.find((c) => c.index === e.chapter)?.title ?? `Chapter ${e.chapter}`
      out.push(`## ${mdEscape(title)}`, '')
    }
    chapter = e.chapter
    // under a chapter a step is one level deeper; a step before the first chapter stays at the top level
    out.push(`${hasChapters && e.chapter !== null ? '###' : '##'} ${e.step}. ${mdEscape(e.title || `Step ${e.step}`)}`, '')
    const image = opts.frames?.get(e.step)
    if (image) out.push(`![${mdEscape(e.title || `Step ${e.step}`)}](${image.split('/').map(encodeURIComponent).join('/')})`, '')
    const paragraph = stepParagraph(e)
    if (paragraph !== '') {
      words += paragraph.split(/\s+/).length
      out.push(mdEscape(paragraph), '')
    }
    // a note is markdown the author wrote for readers: it goes in as written
    if (e.note !== null && e.note.trim() !== '') out.push(e.note.trim(), '')
  }
  return { markdown: out.join('\n').replace(/\n+$/, '\n'), steps: transcript.length, chapters: hasChapters ? new Set(transcript.map((e) => e.chapter).filter((c) => c !== null)).size : 0, words }
}
