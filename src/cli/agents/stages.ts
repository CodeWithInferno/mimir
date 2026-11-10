// From what an agent does to where its generation is: storyboard → writing → checking → looking → fixing → …
// The same rules for every agent, read off its tool calls (or, for an agent whose calls cannot be seen, off the
// files it writes and the stages it reports itself). Pure: the clock is handed in.
//
//   storyboard   until the scene file is first written (reading the reference, planning, writing the storyboard)
//   writing      the scene file is written for the first time, and edited before any check
//   checking     `mimir check` (and `mimir query`: measuring a claim)
//   looking      `mimir shot`, and opening a rendered picture
//   fixing       the scene file is changed after a check or a look
// ready / failed are decided at the end by the driver, never by the agent.
import type { AgentEvent, CheckSummary, Progress, Stage } from './types.ts'
import { STAGES } from './types.ts'

const SCENE_FILE = /\.scene\.m?js$/i
const PICTURE = /\.(png|jpe?g|webp)$/i
const STORYBOARD_FILE = /storyboard[^/\\]*\.md$/i
/** `mimir <command>` inside a shell command line (also through a path: ./bin/mimir, /abs/bin/mimir) */
const MIMIR_CALL = /(?:^|[\s;&|(])(?:[^\s;&|()'"]*[\\/])?mimir\s+([a-z]+)/g

/** The mimir commands a shell command line runs, in order. */
export function mimirCalls(commandLine: string): string[] {
  return [...commandLine.matchAll(MIMIR_CALL)].map((m) => m[1]!)
}

export type ShotKind = 'sheet' | 'cues' | 'fine' | 'frames'

/** What each `mimir shot` of a shell command line renders: the cue sheet, a filmstrip, the story sheet, or plain frames. */
export function shotKinds(commandLine: string): ShotKind[] {
  const out: ShotKind[] = []
  for (const m of commandLine.matchAll(MIMIR_CALL)) {
    if (m[1] !== 'shot') continue
    // the arguments of this call: up to the next shell operator
    const args = commandLine.slice(m.index + m[0].length).split(/[;&|]/)[0]!
    out.push(/(^|\s)--cues\b/.test(args) ? 'cues' : /(^|\s)--fine\b/.test(args) ? 'fine' : /(^|\s)--sheet\b/.test(args) ? 'sheet' : 'frames')
  }
  return out
}

/** What `mimir check` printed: the JSON envelope (piped) or the status line (--text). null = neither was found. */
export function readCheckStatus(output: string): CheckSummary | null {
  const json = /"ok"\s*:\s*(true|false)\s*,\s*"errors"\s*:\s*(\d+)\s*,\s*"warnings"\s*:\s*(\d+)/.exec(output)
  const lines = [...output.matchAll(/^(OK|FAIL) (\d+) errors?, (\d+) warnings?/gm)]
  const line = lines[lines.length - 1]
  if (line) return { ok: line[1] === 'OK', errors: Number(line[2]), warnings: Number(line[3]) }
  if (json) return { ok: json[1] === 'true', errors: Number(json[2]), warnings: Number(json[3]) }
  return null
}

/** The last line of `mimir review`: CLEAN, FLAGS (composition findings, no error) or FIX FIRST (linter errors). null = not a review. */
export function readReviewVerdict(output: string): 'clean' | 'flags' | 'errors' | null {
  const lines = [...output.matchAll(/^(CLEAN|FLAGS|FIX FIRST):/gm)]
  const last = lines[lines.length - 1]
  return last ? (last[1] === 'CLEAN' ? 'clean' : last[1] === 'FLAGS' ? 'flags' : 'errors') : null
}

export interface StageSummary {
  /** what the first `mimir review` / `mimir check` the agent ran said: true = no error and no flag; null = none could be read */
  firstClean: boolean | null
  /** how many times the agent ran `mimir review` */
  reviews: number
  rounds: { check: number; look: number; edit: number }
  /** how many times the agent rendered each kind of picture */
  shots: Record<ShotKind, number>
  /** true / false from the agent's tool calls; null when none could be seen */
  looked: boolean | null
  /** the last `mimir check` result the agent saw, or null */
  lastCheck: CheckSummary | null
  /** the scene files the agent wrote, most recent last */
  scenes: string[]
  storyboard: string | null
}

export class StageTracker {
  stage: Stage = 'storyboard'
  private checks = 0
  private looks = 0
  private edits = 0
  private sawActions = false
  private checked = false
  private shotFresh = false
  private lookedFresh = false
  private lastCheck: CheckSummary | null = null
  private shots: Record<ShotKind, number> = { sheet: 0, cues: 0, fine: 0, frames: 0 }
  private scenes: string[] = []
  private storyboard: string | null = null
  /** shell calls in flight that ran `mimir check`: their output carries the status */
  private pending = new Map<string, true>()
  private anonymousCheck = false
  private firstClean: boolean | null = null
  private reviews = 0

  constructor(private readonly elapsed: () => number) {}

  private move(to: Stage, round: number, out: Progress[]): void {
    if (this.stage === to) return
    this.stage = to
    out.push({ event: 'stage', stage: to, round, elapsed_ms: Math.round(this.elapsed()) })
  }

  /** A scene file was written (seen in a tool call, or found changed on disk). */
  private wrote(path: string, out: Progress[]): void {
    this.edits++
    this.shotFresh = false
    this.lookedFresh = false
    this.scenes = [...this.scenes.filter((p) => p !== path), path]
    this.move(this.checked || this.looks > 0 ? 'fixing' : 'writing', this.edits, out)
  }

  /** A scene file changed on disk and no tool call explained it (an agent whose calls cannot be seen). */
  observeWrite(path: string): Progress[] {
    const out: Progress[] = []
    this.wrote(path, out)
    return out
  }

  feed(ev: AgentEvent): Progress[] {
    const out: Progress[] = []
    if (ev.kind === 'tool') {
      const a = ev.action
      if (a.type !== 'other') this.sawActions = true
      if (a.type === 'write') {
        if (SCENE_FILE.test(a.path)) this.wrote(a.path, out)
        else if (STORYBOARD_FILE.test(a.path)) this.storyboard = a.path
      } else if (a.type === 'read' && PICTURE.test(a.path)) {
        this.looks++
        if (this.shotFresh) this.lookedFresh = true
        this.move('looking', this.looks, out)
        out.push({ event: 'tool', stage: this.stage, name: ev.name, summary: ev.summary }, { event: 'look', stage: this.stage, round: this.looks, image: a.path })
        return out
      } else if (a.type === 'shell') {
        for (const kind of shotKinds(a.command)) this.shots[kind]++
        for (const sub of mimirCalls(a.command)) {
          if (sub === 'check') {
            this.checks++
            this.checked = true
            if (ev.id !== null) this.pending.set(ev.id, true)
            else this.anonymousCheck = true
            this.move('checking', this.checks, out)
          } else if (sub === 'review') {
            // the whole inner loop in one call: a check round, and (with a sheet) a picture to look at
            this.checks++
            this.reviews++
            this.checked = true
            if (ev.id !== null) this.pending.set(ev.id, true)
            else this.anonymousCheck = true
            this.move('checking', this.checks, out)
          } else if (sub === 'query') this.move('checking', this.checks, out)
          else if (sub === 'shot') {
            this.shotFresh = true
            this.move('looking', this.looks + 1, out)
          }
        }
      }
      out.push({ event: 'tool', stage: this.stage, name: ev.name, summary: ev.summary })
    } else if (ev.kind === 'output') {
      const isCheck = ev.id !== null ? this.pending.delete(ev.id) : this.anonymousCheck
      if (ev.id === null) this.anonymousCheck = false
      if (isCheck) {
        const status = readCheckStatus(ev.text)
        const verdict = readReviewVerdict(ev.text)
        // a review that printed a sheet rendered it from the scene as it is now
        if (verdict !== null && /^NEXT: open \S+\.png/m.test(ev.text)) { this.shotFresh = true; this.shots.sheet++ }
        if (status) {
          this.lastCheck = status
          if (this.firstClean === null) this.firstClean = verdict !== null ? verdict === 'clean' : status.ok && status.warnings === 0
          out.push({ event: 'check', stage: this.stage, round: this.checks, ...status })
        }
      }
    } else if (ev.kind === 'stage') {
      // an agent that reports its own stage: only the working stages; the verdict is never the agent's
      const s = ev.stage as Stage
      if ((STAGES as readonly string[]).includes(s) && s !== 'ready' && s !== 'failed') {
        if (s === 'checking') { this.checks++; this.checked = true }
        this.move(s, s === 'checking' ? this.checks : s === 'looking' ? this.looks : this.edits, out)
      }
    } else if (ev.kind === 'text') out.push({ event: 'text', stage: this.stage, text: ev.text })
    else if (ev.kind === 'denied') out.push({ event: 'denied', stage: this.stage, tool: ev.tool, reason: ev.reason })
    else if (ev.kind === 'log') out.push({ event: 'log', stage: this.stage, line: ev.line })
    return out
  }

  summary(): StageSummary {
    return {
      firstClean: this.firstClean, reviews: this.reviews,
      rounds: { check: this.checks, look: this.looks, edit: this.edits },
      shots: { ...this.shots },
      looked: this.sawActions ? this.lookedFresh : null,
      lastCheck: this.lastCheck,
      scenes: [...this.scenes],
      storyboard: this.storyboard,
    }
  }
}
