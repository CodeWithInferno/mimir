// Optional live voice (part of the guide chunk): the browser's own speech synthesis speaks each sentence as the story
// reaches it. The story is the clock and the voice follows it: nothing drawn ever depends on the voice. Word-boundary
// events, where the browser sends them, tell how far the voice has drifted from the caption, and trim the rate of the
// next sentence. Off unless the scene says s.guide({ voice: true }) or the page dispatches `mimir:voice`.
import type { Runtime } from '../core/index.ts'
import { guideConfig, guideStore } from './index.ts'

/** One spoken sentence in story time (seconds), with the story time of each word onset. */
export interface VoiceLine { t0: number; t1: number; text: string; words: { offset: number; at: number }[] }
/** Story time may jump this far between two frames and still count as playing; more is a seek. */
export const VOICE_MAX_STEP = 0.5
/** The rate trim stays inside these bounds, and moves by at most this share per sentence. */
export const VOICE_TRIM = Object.freeze({ min: 0.8, max: 1.3, step: 0.15 })
/** Characters per second of an untrimmed system voice (measured on one: about 209 words a minute); the rate is set against it. */
export const VOICE_NATURAL_CPS = 17.5

/** Every sentence the story says, in story time. */
export function voiceLines(model: Runtime['model']): VoiceLine[] {
  const out: VoiceLine[] = []
  for (const gs of guideStore(model).steps.values()) {
    const rec = model.steps[gs.index]
    if (!rec) continue
    for (const say of gs.says) {
      const t = rec.t0 + say.at
      out.push({ t0: t + say.timing.speechStart, t1: t + say.timing.speechEnd, text: say.parsed.plain, words: say.parsed.words.map((w, i) => ({ offset: w.start, at: t + (say.timing.wordStarts[i] ?? 0) })) })
    }
  }
  return out.sort((a, b) => a.t0 - b.t0)
}
/**
 * What the voice does when the story moves from `prev` to `now`: start the sentence whose first word was crossed
 * (its index), 'stop' when time went back or jumped (a scrub, a seek), or nothing.
 */
export function voiceStep(lines: readonly VoiceLine[], prev: number, now: number): number | 'stop' | null {
  if (!(now > prev) || now - prev > VOICE_MAX_STEP) return now === prev ? null : 'stop'
  for (let i = 0; i < lines.length; i++) if (lines[i]!.t0 > prev && lines[i]!.t0 <= now) return i
  return null
}
/** The new rate trim after one word boundary: the voice took `actual` seconds to reach a word the story reaches after `planned`. */
export function voiceTrim(trim: number, planned: number, actual: number): number {
  if (!(planned > 0.3) || !(actual > 0.3)) return trim
  const wanted = trim * Math.min(1 + VOICE_TRIM.step, Math.max(1 - VOICE_TRIM.step, actual / planned))
  return Math.min(VOICE_TRIM.max, Math.max(VOICE_TRIM.min, wanted))
}

/** Start following the runtime; returns the function that stops it. Does nothing where there is no speech synthesis. */
export function startVoice(runtime: Runtime): () => void {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null
  if (!synth || runtime.headless || typeof SpeechSynthesisUtterance === 'undefined') return () => {}
  const cfg = guideConfig(runtime.model)
  let on = cfg.voice, prev = runtime.tau, trim = 1, lines: VoiceLine[] | null = null
  const toggle = (e: Event): void => { on = !!(e as CustomEvent).detail; if (!on) synth.cancel() }
  document.addEventListener('mimir:voice', toggle)
  const off = runtime.on('frame', () => {
    const now = runtime.tau, was = prev
    prev = now
    if (!on) return
    const step = voiceStep((lines ??= voiceLines(runtime.model)), was, now)
    if (step === 'stop') { synth.cancel(); return }
    if (step === null) return
    const line = lines[step]!
    const u = new SpeechSynthesisUtterance(line.text)
    u.rate = (cfg.charactersPerSecond / VOICE_NATURAL_CPS) * trim
    let started = 0
    const base = trim // one correction per sentence: the last word heard decides
    u.onstart = (e) => { started = e.timeStamp }
    u.onboundary = (e) => {
      if (e.name !== 'word' || !started) return
      const word = line.words.find((w) => w.offset >= e.charIndex)
      if (word) trim = voiceTrim(base, word.at - line.t0, (e.timeStamp - started) / 1000)
    }
    synth.cancel()
    synth.speak(u)
  })
  return () => { off(); document.removeEventListener('mimir:voice', toggle); synth.cancel() }
}
