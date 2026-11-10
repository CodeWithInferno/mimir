// formula(latex): a typeset formula as a block. A step highlights one term, or sets a new formula: the terms both
// have glide into place, the rest fades. Built on tex() and rewrite(); nothing here knows any mathematics.
import { PALETTE, type Handle } from '../core/index.ts'
import { rewrite, tex } from '../tex/index.ts'
import { timed, write } from '../anim/index.ts'
import { defineBlock, didYouMean, fitScale, inset, type BlockCtx, type BlockDef, type BlockHandle, type StepHandle } from './block.ts'

/** A term without what does not change how it reads: spacing, braces, the multiplication sign, the underscore of an index. */
const squash = (t: string): string => t.replace(/\\(cdot|times|left|right|,|;|!)/g, '').replace(/[\s{}_*]/g, '').toLowerCase()
/** Do the braces of a stretch close what they open, in order? */
const balanced = (t: string): boolean => { let depth = 0; for (const ch of t) { if (ch === '{') depth++; else if (ch === '}' && --depth < 0) return false } return depth === 0 }
/**
 * The term of `latex` that `key` names: `key` itself when it is written there, else the shortest stretch of the
 * formula that reads the same (`F1 d1` names `F_1 \cdot d_1`), else null.
 */
export function termIn(latex: string, key: string): string | null {
  if (!key) return null
  if (latex.includes(key)) return key
  const want = squash(key)
  if (want === '') return null
  let best: string | null = null
  for (let a = 0; a < latex.length; a++) {
    if (/\s/.test(latex[a]!)) continue
    for (let b = a + 1; b <= latex.length; b++) {
      const piece = latex.slice(a, b)
      if (squash(piece) !== want) continue
      const term = piece.trim()
      // a stretch that leaves a brace open, or stops in the middle of a command name, is not a term
      if (!balanced(term)) continue
      if (/\\[a-zA-Z]+$/.test(piece) && /[a-zA-Z]/.test(latex[b] ?? '')) continue
      if (best === null || term.length < best.length) best = term
    }
  }
  return best
}

/** Named defaults of formula(). formula(latex, { style: { … } }) overrides them per block. */
export const FORMULA_DEFAULTS = {
  /** size of the formula on the engine's ladder; it is scaled down when its rectangle is smaller */
  size: 'section',
  /** free room inside the rectangle */
  padding: 0.3,
  /** colour and swell of the highlighted term */
  highlightColor: PALETTE.YELLOW as string,
  highlightScale: 1.25,
  /** seconds of a highlight, of writing the formula on, and of one formula becoming another */
  markSeconds: 0.5,
  writeSeconds: 1.2,
  rewriteSeconds: 1.2,
}
export type FormulaStyle = typeof FORMULA_DEFAULTS
export interface FormulaOptions { colors?: Record<string, string>; style?: Partial<FormulaStyle> }
export interface FormulaState { latex: string; highlight: string | null }

/** prev + change → next; problems are returned, never thrown. */
export function reduceFormula(prev: FormulaState, change: Record<string, unknown>): { next: FormulaState; problems: { what: string; fix?: string }[] } {
  const next: FormulaState = { ...prev }, problems: { what: string; fix?: string }[] = []
  if ('latex' in change) {
    if (typeof change.latex === 'string' && change.latex.trim()) { if (change.latex !== prev.latex) { next.latex = change.latex; next.highlight = null } }
    else problems.push({ what: `latex takes the new formula as a string, got ${JSON.stringify(change.latex)}`, fix: "latex: 'c = \\\\sqrt{a^2 + b^2}'" })
  }
  if ('highlight' in change) {
    if (change.highlight === null || change.highlight === undefined || change.highlight === false) next.highlight = null
    else if (typeof change.highlight === 'string' && change.highlight) next.highlight = change.highlight
    else problems.push({ what: `highlight takes one term as it is written in the formula, or null, got ${JSON.stringify(change.highlight)}`, fix: "highlight: 'c^2'" })
  }
  return { next, problems }
}

/** A typeset formula. State: `highlight: 'c^2'` (a term as written, or null) and `latex: '…'` (the formula it becomes). */
export function formula(latex: string, opts: FormulaOptions = {}): BlockDef<FormulaState> {
  const o = (typeof opts === 'object' && opts !== null ? opts : {}) as FormulaOptions
  const D: FormulaStyle = { ...FORMULA_DEFAULTS, ...(typeof o.style === 'object' && o.style !== null ? o.style : {}) }
  const source = typeof latex === 'string' ? latex : ''
  return {
    kind: 'formula',
    prefer: { aspect: Math.max(2, Math.min(8, source.replace(/\\[A-Za-z]+|[{}^_\s]/g, 'x').length / 3)), weight: 0.6 },
    build(ctx: BlockCtx): BlockHandle<FormulaState> {
      const { rect, id } = ctx
      if (typeof latex !== 'string' || !latex.trim()) ctx.report(`formula() takes LaTeX as a string, got ${typeof latex === 'string' ? 'an empty string' : typeof latex}`, "formula('a^2 + b^2 = c^2')")
      for (const key of Object.keys(o)) if (!['colors', 'style'].includes(key)) ctx.report(`formula() has no option "${key}"`, didYouMean(key, ['colors', 'style'], 'options'))
      const model = ctx.s.model
      const room = inset(rect, D.padding)
      let count = 0
      /** one formula, set at the ladder size and scaled down to the rectangle when it is larger */
      const make = (src: string): Handle => {
        const t = tex(src || '\\,', { id: count++ ? `${id}.line${count}` : `${id}.line`, size: D.size, ...(o.colors ? { colors: o.colors } : {}) }) as Handle
        const b = model.state(0).localBounds(t)
        const k = fitScale(b.max[0] - b.min[0], b.max[1] - b.min[1], room)
        if (k < 1) t.scale(k)
        return t.at(room.center[0], room.center[1])
      }
      let current = make(source)
      let lit: Handle | null = null
      const initial: FormulaState = { latex: source, highlight: null }
      const partOf = (key: string): Handle | undefined => {
        // part() answers with a placeholder and a diagnostic when the term is not in the formula: ask only for what is written there
        const term = termIn(stateNow.latex, key)
        return term === null ? undefined : (current.part(term) as Handle)
      }
      let stateNow = initial
      const apply = (st: StepHandle, change: Partial<FormulaState>, prev: FormulaState): FormulaState => {
        const { next, problems } = reduceFormula(prev, change as Record<string, unknown>)
        for (const p of problems) ctx.report(p.what, p.fix)
        if (next.highlight !== null) {
          const term = termIn(next.latex, next.highlight)
          if (term !== null) next.highlight = term
          else {
            ctx.report(`highlight names "${next.highlight}", which is not written in the formula ${next.latex}`, 'write the term exactly as it stands in the formula')
            next.highlight = prev.latex === next.latex ? prev.highlight : null
          }
        }
        if (next.latex !== prev.latex) {
          // the highlight belongs to the formula that leaves
          lit = null
          const to = make(next.latex)
          st.play(rewrite(current, to, { duration: D.rewriteSeconds }))
          current = to
          stateNow = { ...next, highlight: null }
        }
        if (next.highlight !== (next.latex !== prev.latex ? null : prev.highlight)) {
          const anims: unknown[] = []
          if (lit) anims.push(timed(lit.to.color(PALETTE.WHITE).scale(1), { duration: D.markSeconds }))
          stateNow = next
          lit = next.highlight ? partOf(next.highlight) ?? null : null
          if (lit) anims.push(timed(lit.to.color(D.highlightColor).scale(D.highlightScale), { duration: D.markSeconds }))
          if (anims.length) st.play(...anims)
        }
        stateNow = next
        return next
      }
      return {
        // the stage fades the root in; the formula that a rewrite brings replaces it on stage
        root: current, initial, apply,
        keys: ['latex', 'highlight'],
        enter: (st) => { st.play(write(current, { duration: D.writeSeconds })) },
        target: (path) => (path === '' || path === 'formula' ? current : partOf(path)),
        targets: () => [],
        extras: () => [current],
        api: { get latex(): string { return stateNow.latex } },
        describe: (state) => `${state.latex}${state.highlight ? ` · highlights ${state.highlight}` : ''}`,
      }
    },
  }
}
defineBlock({ kind: 'formula', example: "formula('a^2 + b^2 = c^2')" })
