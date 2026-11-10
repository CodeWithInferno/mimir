// cells(values, { pointers, labels, index }): a row of values for algorithms. Named pointers glide under the row,
// ranges are lit or dimmed, cells are compared, swapped, inserted, removed, found and settled. Every change is a
// state of the row; the block turns the difference between two states into motion. Nothing here knows an algorithm.
import { emOf, PALETTE, TEXT_SIZES, thereAndBack, type Handle } from '../core/index.ts'
import { group, polygon, rect, text } from '../r2d/index.ts'
import { fadeIn, fadeOut, indicate, timed } from '../anim/index.ts'
import { defineBlock, didYouMean, textWidth, type BlockCtx, type BlockDef, type BlockHandle, type StepHandle } from './block.ts'

/** Named defaults of cells(). Lengths in frame units; shares are of the cell height. cells(values, { style: { … } }) overrides them per block. */
export const CELLS_DEFAULTS = {
  /** largest and smallest height of a cell */
  cell: 1.3,
  minimumCell: 0.42,
  /** room between two cells and corner radius, as shares of the cell height */
  gap: 0.12,
  radius: 0.1,
  /** room left and right of the widest value inside its cell, as a share of the cell height */
  pad: 0.3,
  /** outline and ink of a cell at rest */
  stroke: PALETTE.GREY_B as string,
  strokeWidth: 2.5,
  ink: PALETTE.WHITE as string,
  /** outside the lit range: opacity of the cell's outline, and of its value (which must still be read: at least 4.5 : 1 on black) */
  dimOpacity: 0.3,
  dimInk: 0.52,
  /** colours: pointers and the pair being compared; a found cell; a settled cell */
  pointerColor: PALETTE.YELLOW as string,
  compareColor: PALETTE.YELLOW as string,
  foundColor: PALETTE.GREEN as string,
  doneColor: PALETTE.GREEN as string,
  /** fill opacity of a found and of a settled cell */
  foundFill: 0.35,
  doneFill: 0.2,
  /** height of one pointer lane (pointers that share a cell stack), half width of the caret, size of pointer names and slot labels */
  lane: 0.68,
  caret: 0.13,
  pointerSize: 'label',
  labelSize: 'note',
  /** height of the line of slot labels above the row */
  labelHeight: 0.42,
  /** colour of slot labels */
  labelColor: PALETTE.GREY_C as string,
  /** seconds of a move (glide, swap, insert, remove) and of a mark (compare, found, settled, lit) */
  moveSeconds: 0.7,
  markSeconds: 0.4,
  /** how far a swapped cell leaves the row on its way, as a share of the cell height (one goes over, one under) */
  swapLift: 0.55,
  /** how much a found cell swells when it is found */
  foundSwell: 1.18,
  /** smallest height of value text that is still read (frame units); under it the block says so */
  legible: 0.17,
}
export type CellsStyle = typeof CELLS_DEFAULTS
export type CellValue = number | string
export interface CellsOptions { pointers?: string[] | Record<string, number | null>; labels?: (string | number)[]; index?: boolean; style?: Partial<CellsStyle> }
/** The state of a row. `items` are stable keys: a value keeps its key when it moves. */
export interface CellsState {
  values: CellValue[]
  /** key of the item in each slot */
  items: number[]
  /** pointer name → slot, or null when it is not shown */
  pointers: Record<string, number | null>
  /** slots that are dimmed */
  dim: number[]
  /** keys of found and of settled items */
  found: number[]
  done: number[]
  /** the two slots compared in the step that made this state, or null */
  compare: [number, number] | null
}
const ACTIONS = ['lit', 'dim', 'found', 'done', 'compare', 'swap', 'insert', 'remove'] as const

// ── the reducer: pure, tested without a scene ────────────────────────────────────────────────────────
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
/** `[a, b]` → every slot from a to b (with `range`; otherwise those two slots); a number → that slot; a longer list → those slots. Out of range is clipped. */
export function slotsOf(v: unknown, count: number, range = true): number[] | null {
  if (v === null || v === undefined || v === false) return []
  if (isIndex(v)) return v >= 0 && v < count ? [v] : []
  if (!Array.isArray(v) || !v.every(isIndex)) return null
  if (range && v.length === 2) { const a = Math.max(0, Math.min(v[0]!, v[1]!)), b = Math.min(count - 1, Math.max(v[0]!, v[1]!)); const out: number[] = []; for (let i = a; i <= b; i++) out.push(i); return out }
  return [...new Set(v.filter((i) => i >= 0 && i < count))].sort((a, b) => a - b)
}
export interface CellsProblem { what: string; fix?: string }
/**
 * prev + change → next. Order inside one change: compare, swap, remove, insert, pointers, lit / dim, found, done.
 * Problems (an index outside the row, a malformed value) are returned, never thrown; that part of the change is skipped.
 */
export function reduceCells(prev: CellsState, change: Record<string, unknown>, pointerNames: readonly string[], nextKey: () => number): { next: CellsState; problems: CellsProblem[]; inserted: number[]; removed: number[] } {
  const problems: CellsProblem[] = []
  const next: CellsState = { values: prev.values.slice(), items: prev.items.slice(), pointers: { ...prev.pointers }, dim: prev.dim.slice(), found: prev.found.slice(), done: prev.done.slice(), compare: null }
  const inserted: number[] = [], removed: number[] = []
  const inRow = (i: unknown): i is number => isIndex(i) && i >= 0 && i < next.items.length
  const pair = (v: unknown, name: string, one = false): [number, number] | null => {
    if (v === null || v === undefined) return null
    // looking at ONE slot is a comparison too (with the value that is searched for): it lights that slot
    if (one && inRow(v)) return [v, v]
    if (one && Array.isArray(v) && v.length === 1 && inRow(v[0])) return [v[0], v[0]]
    if (Array.isArray(v) && v.length === 2 && inRow(v[0]) && inRow(v[1]) && (one || v[0] !== v[1])) return [v[0], v[1]]
    problems.push({ what: `${name} takes two ${one ? '' : 'different '}slots of the row (0 to ${next.items.length - 1}), got ${JSON.stringify(v)}`, fix: `${name}: [0, 1]` })
    return null
  }
  if ('compare' in change) next.compare = pair(change.compare, 'compare', true)
  if ('swap' in change) {
    const p = pair(change.swap, 'swap')
    if (p) {
      const [i, j] = p
      ;[next.items[i], next.items[j]] = [next.items[j]!, next.items[i]!]
      ;[next.values[i], next.values[j]] = [next.values[j]!, next.values[i]!]
    }
  }
  if ('remove' in change && change.remove !== null && change.remove !== undefined) {
    const i = change.remove
    if (inRow(i)) {
      removed.push(next.items[i]!)
      next.items.splice(i, 1)
      next.values.splice(i, 1)
      next.dim = next.dim.filter((d) => d !== i).map((d) => (d > i ? d - 1 : d))
      for (const name of Object.keys(next.pointers)) { const at = next.pointers[name]; if (typeof at === 'number' && at > i) next.pointers[name] = at - 1 }
    } else problems.push({ what: `remove takes a slot of the row (0 to ${next.items.length - 1}), got ${JSON.stringify(i)}`, fix: 'remove: 0' })
  }
  if ('insert' in change && change.insert !== null && change.insert !== undefined) {
    const ins = change.insert as { at?: unknown; value?: unknown }
    const at = typeof ins === 'object' && ins !== null && !Array.isArray(ins) ? (ins.at === undefined ? next.items.length : ins.at) : undefined
    const value = typeof ins === 'object' && ins !== null ? ins.value : undefined
    if (isIndex(at) && at >= 0 && at <= next.items.length && (typeof value === 'number' || typeof value === 'string')) {
      const key = nextKey()
      inserted.push(key)
      next.items.splice(at, 0, key)
      next.values.splice(at, 0, value)
      next.dim = next.dim.map((d) => (d >= at ? d + 1 : d))
    } else problems.push({ what: `insert takes { at: a slot from 0 to ${next.items.length}, value: a number or a word }, got ${JSON.stringify(ins)}`, fix: 'insert: { at: 0, value: 7 }' })
  }
  const count = next.items.length
  for (const name of pointerNames) {
    if (!(name in change)) continue
    const v = change[name]
    if (v === null || v === undefined || v === false) next.pointers[name] = null
    // one past either end is a real state of many algorithms (lo > hi): the pointer stands just outside the row
    else if (isIndex(v) && v >= -1 && v <= count) next.pointers[name] = v
    else problems.push({ what: `the pointer "${name}" takes a slot of the row (0 to ${count - 1}) or null, got ${JSON.stringify(v)}`, fix: `${name}: 0` })
  }
  if ('lit' in change) {
    const lit = slotsOf(change.lit, count)
    if (lit === null) problems.push({ what: `lit takes [from, to], one slot, or null for the whole row, got ${JSON.stringify(change.lit)}`, fix: 'lit: [0, 3]' })
    else if (change.lit === null || change.lit === undefined) next.dim = []
    else { next.dim = []; for (let i = 0; i < count; i++) if (!lit.includes(i)) next.dim.push(i) }
  }
  if ('dim' in change) {
    const dim = slotsOf(change.dim, count)
    if (dim === null) problems.push({ what: `dim takes [from, to], one slot, or null for none, got ${JSON.stringify(change.dim)}`, fix: 'dim: [4, 7]' })
    else next.dim = dim
  }
  for (const mark of ['found', 'done'] as const) {
    if (!(mark in change)) continue
    const slots = slotsOf(change[mark], count, false)
    if (slots === null) { problems.push({ what: `${mark} takes one slot, a list of slots, or null, got ${JSON.stringify(change[mark])}`, fix: `${mark}: 2` }); continue }
    const keys = slots.map((i) => next.items[i]!)
    // found replaces what was found; done accumulates (a settled value stays settled); null clears
    if (change[mark] === null) next[mark] = []
    else if (mark === 'found') next.found = keys
    else next.done = [...new Set([...next.done, ...keys])]
  }
  next.found = next.found.filter((k) => next.items.includes(k))
  next.done = next.done.filter((k) => next.items.includes(k))
  return { next, problems, inserted, removed }
}
/** One line of text for a state: `[3 8 12 17] lo=0 mid=1 hi=3 · dim 2..3 · found 17 · settled 12`. */
export function describeCells(state: CellsState): string {
  const valueOf = (key: number): string => String(state.values[state.items.indexOf(key)] ?? '?')
  const parts = [`[${state.values.join(' ')}]`]
  const shown = Object.entries(state.pointers).filter(([, at]) => at !== null).map(([name, at]) => `${name}=${at}`)
  if (shown.length) parts[0] += ' ' + shown.join(' ')
  if (state.compare) parts.push(state.compare[0] === state.compare[1] ? `looks at slot ${state.compare[0]} (${state.values[state.compare[0]]})` : `compares slots ${state.compare[0]} and ${state.compare[1]} (${state.values[state.compare[0]]} and ${state.values[state.compare[1]]})`)
  if (state.dim.length) parts.push(`dim slots ${ranges(state.dim)}`)
  if (state.found.length) parts.push(`found ${state.found.map(valueOf).join(', ')}`)
  if (state.done.length) parts.push(`settled ${state.done.map(valueOf).join(', ')}`)
  return parts.join(' · ')
}
const ranges = (slots: number[]): string => {
  const out: string[] = []
  for (let i = 0; i < slots.length; i++) { let j = i; while (j + 1 < slots.length && slots[j + 1] === slots[j]! + 1) j++; out.push(i === j ? String(slots[i]) : `${slots[i]}..${slots[j]}`); i = j }
  return out.join(', ')
}
/** Stack level of every shown pointer: pointers that share a slot stack in the order they were named. */
export function pointerLevels(pointers: Record<string, number | null>, names: readonly string[]): Record<string, number> {
  const taken = new Map<number, number>(), out: Record<string, number> = {}
  for (const name of names) { const at = pointers[name]; if (typeof at !== 'number') continue; const level = taken.get(at) ?? 0; out[name] = level; taken.set(at, level + 1) }
  return out
}

// ── the block ────────────────────────────────────────────────────────────────────────────────────────
const ladder = Object.entries(TEXT_SIZES).map(([name, size]) => ({ name, em: emOf(size) })).sort((a, b) => b.em - a.em)
/** The largest size of the engine's ladder whose em is at most `most`; the smallest when none is. */
const sizeUnder = (most: number): string => (ladder.find((s) => s.em <= most) ?? ladder[ladder.length - 1]!).name

/** A row of values. `values` are numbers or short words; `pointers` names the pointers a story may place. */
export function cells(values: CellValue[], opts: CellsOptions = {}): BlockDef<CellsState> {
  const list: CellValue[] = Array.isArray(values) ? values.filter((v): v is CellValue => typeof v === 'number' || typeof v === 'string') : []
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as CellsOptions
  const D: CellsStyle = { ...CELLS_DEFAULTS, ...(typeof o.style === 'object' && o.style !== null ? o.style : {}) }
  const startAt: Record<string, number | null> = Array.isArray(o.pointers) ? Object.fromEntries(o.pointers.map((p) => [String(p), null])) : typeof o.pointers === 'object' && o.pointers !== null ? { ...o.pointers } : {}
  const names = Object.keys(startAt)
  const slotLabels: string[] | null = Array.isArray(o.labels) ? o.labels.map(String) : o.index ? list.map((_, i) => String(i)) : null
  const lanes = Math.min(names.length, 3)
  const tall = D.cell + lanes * D.lane + (slotLabels ? D.labelHeight : 0)
  return {
    kind: 'cells',
    prefer: { aspect: Math.max(1.4, Math.min(9, (Math.max(list.length, 1) * D.cell * (1 + D.gap)) / tall)), weight: 1 },
    build(ctx: BlockCtx): BlockHandle<CellsState> {
      const { rect: area, id } = ctx
      if (!Array.isArray(values)) ctx.report(`cells() takes a list of values, got ${typeof values}`, 'cells([3, 8, 12, 17])')
      else if (list.length !== values.length) ctx.report(`${values.length - list.length} of the values are neither numbers nor words and are left out`, 'cells([3, 8, 12, 17])')
      for (const key of Object.keys(o)) if (!['pointers', 'labels', 'index', 'style'].includes(key)) ctx.report(`cells() has no option "${key}"`, didYouMean(key, ['pointers', 'labels', 'index', 'style'], 'options'))
      for (const key of Object.keys(typeof o.style === 'object' && o.style !== null ? o.style : {})) if (!Object.hasOwn(CELLS_DEFAULTS, key)) ctx.report(`cells(): style has no option "${key}"`, didYouMean(key, Object.keys(CELLS_DEFAULTS), 'options'))
      for (const name of names) if ((ACTIONS as readonly string[]).includes(name)) ctx.report(`a pointer cannot be called "${name}": that is a state of the row`, `call it "${name}At"`)
      // sizes: the cell as tall as the rectangle allows, as wide as the widest value needs, then everything scaled to the width.
      // A rectangle too low even for the smallest cell shrinks the whole block (cell, labels, pointer lanes) by one factor.
      let cellH = Math.max(D.minimumCell, Math.min(D.cell, area.height - (slotLabels ? D.labelHeight : 0) - lanes * D.lane))
      const squeeze = Math.min(1, area.height / (cellH + (slotLabels ? D.labelHeight : 0) + lanes * D.lane))
      cellH *= squeeze
      const labelH = (slotLabels ? D.labelHeight : 0) * squeeze, laneH = D.lane * squeeze
      const sizeName = sizeUnder(cellH * 0.5)
      const em = emOf(TEXT_SIZES[sizeName]!)
      const widest = Math.max(0, ...list.map((v) => textWidth(String(v), sizeName)))
      let cellW = Math.max(cellH, widest + D.pad * cellH)
      // room at both ends for a pointer that stands one past the row (lo > hi is a real state of many algorithms)
      const nameW = names.length ? Math.max(2 * D.caret, ...names.map((name) => textWidth(name, D.pointerSize))) * squeeze + D.gap * D.cell : 0
      const edge = names.length ? 2 * (nameW + D.gap * D.cell) : 0
      const naturalW = (count: number): number => count * cellW + Math.max(0, count - 1) * D.gap * cellH
      const k = Math.min(1, Math.max(0.05, area.width - edge) / naturalW(Math.max(list.length, 1)))
      cellH *= k
      cellW *= k
      const gap = D.gap * cellH
      const textScale = k
      if (em * textScale < D.legible) ctx.report(`${list.length} values in this room are set under the smallest size that is still read`, 'show fewer values, or shorter ones, or give the row the stage to itself')
      if (squeeze < 1 && emOf(TEXT_SIZES[D.pointerSize] ?? TEXT_SIZES.note!) * squeeze < D.legible) ctx.report('this room is too low for the row with its pointers and labels at a size that is still read', 'give the row more of the stage (fewer blocks beside it), or name fewer pointers')
      const total = labelH + cellH + lanes * laneH
      // centred on the row with one lane of pointers (what is seen most of the time); further lanes hang below it when there is room
      const seen = labelH + cellH + Math.min(lanes, 1) * laneH
      const top = Math.max(area.center[1] + seen / 2, Math.min(area.top, area.bottom + total))
      const rowY = top - labelH - cellH / 2
      const cx = area.center[0]
      /** centre x of a slot when the row holds `count` values; a row that outgrows its room is squeezed */
      const slotX = (i: number, count: number): number => {
        const pitch = Math.min(cellW + gap, Math.max(0.05, area.width - edge) / Math.max(count, 1))
        const half = ((Math.max(count, 1) - 1) / 2) * pitch + cellW / 2
        if (i < 0) return cx - half - D.gap * D.cell - nameW / 2
        if (i >= count && count > 0) return cx + half + D.gap * D.cell + nameW / 2
        return cx + (i - (count - 1) / 2) * pitch
      }
      const laneY = (level: number): number => rowY - cellH / 2 - (Math.min(level, Math.max(lanes, 1) - 1) + 0.5) * laneH

      interface Item { key: number; box: Handle; label: Handle; node: Handle; opacity: number; mark: 'none' | 'found' | 'done' }
      const items = new Map<number, Item>()
      let keys = 0
      const nextKey = (): number => keys++
      const makeItem = (key: number, value: CellValue, x: number): Item => {
        const box = rect({ id: `${id}.box${key}`, width: cellW, height: cellH, radius: D.radius * cellH, stroke: D.stroke, strokeWidth: D.strokeWidth, fill: D.foundColor, fillOpacity: 0 }) as Handle
        const label = text(String(value), { id: `${id}.value${key}`, size: sizeName, color: D.ink }) as Handle
        if (textScale < 1) label.scale(textScale)
        const node = group([box, label], { id: `${id}.cell${key}` }) as Handle
        node.at(x, rowY)
        const item: Item = { key, box, label, node, opacity: 1, mark: 'none' }
        items.set(key, item)
        return item
      }
      const initial: CellsState = { values: list.slice(), items: list.map(() => nextKey()), pointers: {}, dim: [], found: [], done: [], compare: null }
      const first = initial.items.map((key, i) => makeItem(key, list[i]!, slotX(i, list.length)))
      const labels: Handle[] = (slotLabels ?? []).slice(0, list.length).map((word, i) => { const t = (text(word, { id: `${id}.label${i}`, size: D.labelSize, color: D.labelColor }) as Handle).at(slotX(i, list.length), top - labelH / 2); return squeeze < 1 ? t.scale(squeeze) : t })
      const root = group([...first.map((it) => it.node), ...labels], { id }) as Handle
      // pointers: a caret under the row with the name beneath it; invisible until a step places them
      const pointers = new Map<string, Handle>()
      for (const name of names) {
        const caret = (polygon([[-D.caret, -D.caret * 0.8], [D.caret, -D.caret * 0.8], [0, D.caret * 0.8]], { color: D.pointerColor, fill: D.pointerColor, fillOpacity: 1, strokeWidth: 1 }) as Handle).at(0, D.lane / 2 - D.caret - 0.03)
        const word = (text(name, { size: D.pointerSize, color: D.pointerColor }) as Handle).at(0, -D.lane / 2 + 0.22)
        const p = group([caret, word], { id: `${id}.${name}` }) as Handle
        if (squeeze < 1) p.scale(squeeze)
        const at = startAt[name]
        const shown = typeof at === 'number' && Number.isInteger(at) && at >= -1 && at <= list.length
        initial.pointers[name] = shown ? at! : null
        pointers.set(name, p)
      }
      {
        const levels = pointerLevels(initial.pointers, names)
        for (const name of names) {
          const at = initial.pointers[name]
          const p = pointers.get(name)!
          p.at(slotX(typeof at === 'number' ? at : 0, list.length), laneY(levels[name] ?? 0))
          if (typeof at !== 'number') p.opacity(0)
        }
      }
      let current = initial

      const apply = (st: StepHandle, change: Partial<CellsState> & Record<string, unknown>, prev: CellsState): CellsState => {
        const { next, problems, inserted, removed } = reduceCells(prev, change, names, nextKey)
        for (const p of problems) ctx.report(p.what, p.fix)
        const count = next.items.length
        // 1. the pair that is compared lights up for this step (and clears when the step is over)
        if (next.compare) {
          for (const slot of new Set(next.compare)) { const it = items.get(prev.items[slot]!); if (it) st.clip(it.box, 'stroke', D.compareColor, { duration: D.markSeconds, scope: 'step' }) }
          st.need(st.cursor + D.markSeconds)
          if ('swap' in change || 'remove' in change || 'insert' in change) st.advance(D.markSeconds)
        }
        const anims: unknown[] = []
        // 2. removed values leave, inserted ones are made where they belong
        for (const key of removed) { const it = items.get(key); if (it) { anims.push(fadeOut(it.node, { scale: 0.6, duration: D.moveSeconds })); items.delete(key) } }
        for (const key of inserted) {
          const slot = next.items.indexOf(key)
          const it = makeItem(key, next.values[slot]!, slotX(slot, count))
          anims.push(fadeIn(it.node, { scale: 0.6, duration: D.moveSeconds }))
        }
        // 3. every value glides to its slot; two that trade places leave the row on the way (one over, one under)
        const swapped = 'swap' in change && Array.isArray(change.swap) ? (change.swap as number[]) : []
        next.items.forEach((key, slot) => {
          const it = items.get(key)
          if (!it || inserted.includes(key)) return
          const was = prev.items.indexOf(key)
          if (was === slot && count === prev.items.length) return
          anims.push(timed(it.node.to.at(slotX(slot, count), rowY), { duration: D.moveSeconds }))
          const side = swapped.indexOf(slot)
          if (side >= 0 && was !== slot) anims.push(timed(it.node.to.shift(0, (side === 0 ? -1 : 1) * D.swapLift * cellH), { duration: D.moveSeconds, rate: thereAndBack }))
        })
        // 4. pointers appear, glide, stack, leave
        const before = pointerLevels(prev.pointers, names), after = pointerLevels(next.pointers, names)
        for (const name of names) {
          const p = pointers.get(name)!
          const a = prev.pointers[name], b = next.pointers[name]
          if (typeof b !== 'number') { if (typeof a === 'number') anims.push(timed(p.to.opacity(0), { duration: D.markSeconds })); continue }
          const x = slotX(b, count), y = laneY(after[name] ?? 0)
          // a pointer that was not shown is put where it belongs at this moment, then appears
          if (typeof a !== 'number') { p.at(x, y); anims.push(timed(p.to.opacity(1), { duration: D.markSeconds })) }
          else if (a !== b || before[name] !== after[name] || count !== prev.items.length) anims.push(timed(p.to.at(x, y), { duration: D.moveSeconds }))
        }
        // 5. dim, found, settled
        next.items.forEach((key, slot) => {
          const it = items.get(key)
          if (!it) return
          const dim = next.dim.includes(slot)
          if ((dim ? D.dimOpacity : 1) !== it.opacity) {
            it.opacity = dim ? D.dimOpacity : 1
            anims.push(timed(it.box.to.opacity(it.opacity), { duration: D.markSeconds }), timed(it.label.to.opacity(dim ? D.dimInk : 1), { duration: D.markSeconds }))
          }
          const mark = next.found.includes(key) ? 'found' : next.done.includes(key) ? 'done' : 'none'
          if (mark !== it.mark) {
            const color = mark === 'found' ? D.foundColor : mark === 'done' ? D.doneColor : D.stroke
            anims.push(timed(it.box.to.stroke(color).set({ fillOpacity: mark === 'found' ? D.foundFill : mark === 'done' ? D.doneFill : 0 }), { duration: D.markSeconds }))
            if (mark === 'found') anims.push(indicate(it.node, { scale: D.foundSwell, color: null, duration: D.moveSeconds }))
            it.mark = mark
          }
        })
        if (anims.length) st.play(...anims)
        current = next
        return next
      }

      const slotOf = (path: string): Item | undefined => { const i = Number(path); return Number.isInteger(i) && path.trim() !== '' ? items.get(current.items[i] ?? -1) : undefined }
      return {
        root, initial, apply,
        keys: [...names, ...ACTIONS],
        target: (path) => (path === '' || path === 'cells' || path === 'values' ? root : pointers.get(path) ?? slotOf(path)?.node),
        targets: () => [...names, ...current.items.map((_, i) => String(i))],
        extras: () => [...pointers.values(), ...[...items.values()].map((it) => it.node).filter((n) => n.parent !== root)],
        api: {
          /** the value in slot i, after every step recorded so far */
          value: (i: number): CellValue | undefined => current.values[i],
          values: (): CellValue[] => current.values.slice(),
          /** the slot a pointer stands on, or null */
          at: (name: string): number | null => current.pointers[name] ?? null,
          indexOf: (value: CellValue): number => current.values.indexOf(value),
          get length(): number { return current.values.length },
        },
        describe: describeCells,
      }
    },
  }
}
defineBlock({ kind: 'cells', example: "cells([3, 8, 12, 17], { pointers: ['lo', 'hi'] })" })
