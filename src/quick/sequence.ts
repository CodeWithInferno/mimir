// sequence({ actors, messages }) as a block. The diagram itself is the engine's sequence(): lifelines side by side and
// the messages between them, top to bottom. This file only adds what a story needs: messages revealed in order
// (`upTo`), a message that is lost on the way (`lost`: its arrow stops short at a cross) and one that is sent again
// (`retry`). An engine object used as a stage entry is adopted by the block of its kind; nothing is drawn twice.
import { PALETTE, type Handle, type MNode } from '../core/index.ts'
import { text } from '../r2d/index.ts'
import { timed } from '../anim/index.ts'
import { defineBlock, fitScale, inset, type BlockCtx, type BlockDef, type BlockHandle, type StepHandle } from './block.ts'

/** Named defaults of the sequence block. Change a field before the scene is built to change it for the scene. */
export const SEQUENCE_DEFAULTS = {
  /** free room inside the rectangle, and the most the diagram is enlarged to fill it */
  padding: 0.25,
  maximumScale: 2,
  /** seconds one message takes to be drawn, and a mark to appear */
  messageSeconds: 0.7,
  markSeconds: 0.4,
  /** how far a lost message gets before it stops, as a share of its way */
  lostShare: 0.72,
  /** colour of a lost message and its cross; colour of a message that is sent again */
  lostColor: PALETTE.RED as string,
  retryColor: PALETTE.YELLOW as string,
  /**
   * who says what is read off the colour: the party that opens the conversation (the first actor) and what it sends
   * have one hue, every other party is drawn in the light neutral. One hue, so that a lost message and a retry (two
   * more) stay inside the three a viewer tracks (COLOR-COUNT).
   */
  openerColor: PALETTE.BLUE as string,
  otherColor: PALETTE.GREY_A as string,
  /** the cross at the end of a lost message, and its size on the engine's ladder */
  lostMark: '×',
  lostMarkSize: 'body',
}
export interface SequenceState {
  /** how many messages are drawn, counted from the first */
  upTo: number
  /** numbers (1 = the first message) of the messages that are lost, and of those that are sent again */
  lost: number[]
  retry: number[]
}
const numbers = (v: unknown, count: number): number[] | null => {
  if (v === null || v === undefined || v === false) return []
  const list = Array.isArray(v) ? v : [v]
  return list.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= count) ? [...new Set(list as number[])].sort((a, b) => a - b) : null
}
/** prev + change → next; problems are returned, never thrown. `count` = messages of the diagram. */
export function reduceSequence(prev: SequenceState, change: Record<string, unknown>, count: number): { next: SequenceState; problems: { what: string; fix?: string }[] } {
  const next: SequenceState = { upTo: prev.upTo, lost: prev.lost.slice(), retry: prev.retry.slice() }
  const problems: { what: string; fix?: string }[] = []
  if ('upTo' in change) {
    const v = change.upTo === 'end' || change.upTo === 'all' ? count : change.upTo
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= count) next.upTo = v
    else problems.push({ what: `upTo takes how many messages are drawn (0 to ${count}, or 'end'), got ${JSON.stringify(change.upTo)}`, fix: `upTo: ${Math.min(count, prev.upTo + 1)}` })
  }
  for (const key of ['lost', 'retry'] as const) {
    if (!(key in change)) continue
    const list = numbers(change[key], count)
    if (list) next[key] = list
    else problems.push({ what: `${key} takes the number of a message (1 to ${count}), a list of them, or null, got ${JSON.stringify(change[key])}`, fix: `${key}: ${Math.max(1, Math.min(count, prev.upTo + 1))}` })
  }
  return { next, problems }
}

/** The block of an engine sequence(): fitted into its rectangle, messages hidden until the story reveals them. */
function adopt(q: Handle): BlockDef<SequenceState> {
  const D = SEQUENCE_DEFAULTS
  const messages: Handle[] = Array.isArray(q.messages) ? (q.messages as Handle[]) : []
  const actors: Record<string, Handle> = typeof q.actors === 'object' && q.actors !== null ? (q.actors as Record<string, Handle>) : {}
  const written: unknown[] = Array.isArray(q.props.messages) ? (q.props.messages as unknown[]) : []
  const words = (i: number): string => { const m = written[i]; return Array.isArray(m) ? `${String(m[0])} -> ${String(m[1])}${m[2] ? ` "${String(m[2])}"` : ''}` : `message ${i + 1}` }
  const gapX = typeof q.props.actorGap === 'number' ? q.props.actorGap : 2.6, gapY = typeof q.props.messageGap === 'number' ? q.props.messageGap : 0.62
  const names = Object.keys(actors)
  return {
    kind: 'sequence',
    prefer: { aspect: Math.max(0.8, Math.min(3, (names.length * gapX) / ((messages.length + 2.5) * gapY))), weight: 1 },
    build(ctx: BlockCtx): BlockHandle<SequenceState> {
      const model = ctx.s.model
      const room = inset(ctx.rect, D.padding)
      const b = model.state(0).bounds(q)
      const k = fitScale(b.max[0] - b.min[0], b.max[1] - b.min[1], room, D.maximumScale)
      // centred on what it draws (its own origin is not its middle), so it never hangs at the top of its rectangle
      if (!q.placement) { if (k !== 1) q.scale(k); q.at(room.center[0] - (k * (b.min[0] + b.max[0])) / 2, room.center[1] - (k * (b.min[1] + b.max[1])) / 2) }
      // the story draws the messages: none is shown before it says so
      q.shown(0)
      const crosses = messages.map((m, i) => (text(D.lostMark, { id: `${ctx.id}.lost${i + 1}`, size: D.lostMarkSize, color: D.lostColor }) as Handle).at(m.pointAt(D.lostShare)).opacity(0))
      // who says what is read off the colour: a party's box and the messages it sends share one
      const hue = (i: number): string => (i === 0 ? D.openerColor : D.otherColor)
      names.forEach((name, i) => { const a = actors[name] as Handle & { color?: (c: string) => unknown }; if (typeof a.color === 'function') a.color(hue(i)) })
      messages.forEach((m, i) => {
        const w = written[i]
        const from = Array.isArray(w) ? names.indexOf(String(w[0])) : -1
        const own = Array.isArray(w) && w[3] !== null && typeof w[3] === 'object' && 'color' in (w[3] as object)
        const paint = (m as Handle & { color?: (c: string) => unknown }).color
        if (from >= 0 && !own && typeof paint === 'function') paint.call(m, hue(from))
      })
      const colors = messages.map((m) => model.state(0).prop<string>(m as MNode, 'color'))
      const initial: SequenceState = { upTo: 0, lost: [], retry: [] }
      const apply = (st: StepHandle, change: Partial<SequenceState>, prev: SequenceState): SequenceState => {
        const { next, problems } = reduceSequence(prev, change as Record<string, unknown>, messages.length)
        for (const p of problems) ctx.report(p.what, p.fix)
        const drawn = (s: SequenceState, i: number): number => (i < s.upTo ? (s.lost.includes(i + 1) ? D.lostShare : 1) : 0)
        const tint = (s: SequenceState, i: number): string => (s.lost.includes(i + 1) ? D.lostColor : s.retry.includes(i + 1) ? D.retryColor : colors[i]!)
        // marks first (a message that turns out to be lost, or to be a retry, takes its colour), then the arrows one after the other
        const marks: unknown[] = []
        messages.forEach((m, i) => {
          if (tint(next, i) !== tint(prev, i)) marks.push(timed(m.to.color(tint(next, i)), { duration: D.markSeconds }))
        })
        if (marks.length) { const at = st.cursor; st.play(...marks); st.rec.cursor = at }
        const order = next.upTo >= prev.upTo ? messages.map((_, i) => i) : messages.map((_, i) => messages.length - 1 - i)
        for (const i of order) {
          const from = drawn(prev, i), to = drawn(next, i)
          const lostNow = next.lost.includes(i + 1) && i < next.upTo, lostBefore = prev.lost.includes(i + 1) && i < prev.upTo
          if (from !== to) st.play(timed(m_set(messages[i]!, to), { duration: D.messageSeconds * Math.max(0.4, Math.abs(to - from)) }))
          if (lostNow !== lostBefore) st.play(timed(crosses[i]!.to.opacity(lostNow ? 1 : 0), { duration: D.markSeconds }))
        }
        return next
      }
      return {
        root: q, initial, apply,
        keys: ['upTo', 'lost', 'retry'],
        target: (path) => (path === '' ? q : actors[path] ?? (/^m\d+$/.test(path) ? messages[Number(path.slice(1)) - 1] : undefined)),
        targets: () => [...names, ...messages.map((_, i) => `m${i + 1}`)],
        extras: () => crosses,
        api: { actors: names, get length(): number { return messages.length } },
        describe: (s) => `${names.join(', ')} · ${s.upTo} of ${messages.length} messages drawn${s.upTo ? ': ' + messages.slice(0, s.upTo).map((_, i) => `${i + 1} ${words(i)}${s.lost.includes(i + 1) ? ' (lost)' : s.retry.includes(i + 1) ? ' (sent again)' : ''}`).join(', ') : ''}`,
      }
    },
  }
}
const m_set = (message: Handle, drawn: number): unknown => message.to.set({ drawn })
// the kind 'sequence' is the engine's own constructor: used as a stage entry, its object becomes this block
defineBlock({ kind: 'sequence', adopts: 'sequence', adopt, example: "sequence({ actors: ['client', 'server'], messages: [['client', 'server', 'SYN']] })" })
