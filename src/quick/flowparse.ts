// flow(): reading a system description. Pure (no engine, no DOM): text or { nodes, links } in, a plain graph out.
//
//   'producer -> queue[8] -> worker*3 -> database; worker -fail-> retry -> queue; retry -3x-> dead letters'
//
//   name          a node; several words are fine ('dead letters'); its id is the words in camelCase (deadLetters)
//   name[8]       a node that holds a line of jobs, drawn with 8 slots (a queue)
//   name*3        three replicas: name1, name2, name3 (naming `name` later means all of them, `name2` just one)
//   a -> b        a link; a -label-> b gives it a label. Some labels mean something:
//                   -fail->      where a job goes when it fails at `a` (FAIL_WORDS)
//                   -3x->        taken instead of the plain link once a job has failed 3 times (a dead-letter exit)
//                   -miss 35%->  taken by that share of the jobs; the rest take the plain link, or end at `a`
//   ;  or newline  separates chains
// Nothing here throws: what cannot be read is skipped and reported in `problems`, with the fix.
export interface FlowNode {
  id: string
  label: string
  /** the name it was written with (`worker` for worker1 … worker3) */
  base: string
  /** slots of a queue; 0 = not a queue */
  slots: number
  /** 1-based index among its replicas; 0 = it is the only one */
  replica: number
}
export type LinkKind = 'go' | 'fail' | 'after'
export interface FlowLink {
  from: string
  to: string
  label: string
  kind: LinkKind
  /** share of the jobs that take it, 0..1; null = not given */
  share: number | null
  /** kind 'after': failures after which it is taken */
  tries: number
}
export interface FlowProblem { what: string; fix: string }
export interface FlowGraph { nodes: FlowNode[]; links: FlowLink[]; problems: FlowProblem[] }

/** Labels that mark the link a failed job takes. */
export const FAIL_WORDS: readonly string[] = ['fail', 'fails', 'failed', 'failure', 'error', 'timeout', 'crash']
/** Most replicas of one node and most slots of one queue that are drawn (more is clamped and reported). */
export const FLOW_LIMITS = Object.freeze({ replicas: 6, slots: 16 })

/** The candidate nearest to a word (edit distance, at most a third of its length away), for did-you-mean. */
export function nearest(word: string, candidates: Iterable<string>): string | null {
  const a = word.toLowerCase()
  let best: string | null = null, bestD = Math.max(1, Math.ceil(a.length / 3)) + 1
  for (const c of candidates) {
    const b = c.toLowerCase()
    let row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      const next = [i]
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      row = next
    }
    const d = b.startsWith(a) || a.startsWith(b) ? Math.min(1, row[b.length]!) : row[b.length]!
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

export const idOf = (name: string): string => {
  const words = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean)
  return words.map((w, i) => (i === 0 ? w[0]!.toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1))).join('')
}

/** What a link label means: '-fail->', '-3x->', '-miss 35%->', or just words. */
export function readLabel(label: string): Pick<FlowLink, 'label' | 'kind' | 'share' | 'tries'> {
  const text = label.trim()
  const after = /^(\d+)\s*x$/i.exec(text)
  if (after) return { label: text, kind: 'after', share: null, tries: Math.max(1, Number(after[1])) }
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(text)
  const share = pct ? Math.min(1, Math.max(0, Number(pct[1]) / 100)) : null
  const words = text.toLowerCase().split(/\s+/)
  return { label: text, kind: words.some((w) => FAIL_WORDS.includes(w)) ? 'fail' : 'go', share, tries: 0 }
}

interface Mention { base: string; label: string; slots: number; replicas: number }
function readNode(text: string, problems: FlowProblem[]): Mention | null {
  let rest = text.trim(), slots = 0, replicas = 0
  for (let pass = 0; pass < 2; pass++) {
    const q = /\[\s*(\d+)\s*\]\s*$/.exec(rest)
    if (q) { slots = Number(q[1]); rest = rest.slice(0, q.index).trim() }
    const r = /\*\s*(\d+)\s*$/.exec(rest)
    if (r) { replicas = Number(r[1]); rest = rest.slice(0, r.index).trim() }
  }
  const base = idOf(rest)
  if (!base) { if (text.trim()) problems.push({ what: `flow: "${text.trim()}" is not a node name`, fix: 'a node is a name, optionally with slots or replicas: queue[8], worker*3' }); return null }
  if (slots > FLOW_LIMITS.slots) { problems.push({ what: `flow: ${rest}[${slots}] has more slots than are drawn (${FLOW_LIMITS.slots})`, fix: `${rest}[${FLOW_LIMITS.slots}]: the line itself may still grow longer than its slots` }); slots = FLOW_LIMITS.slots }
  if (replicas > FLOW_LIMITS.replicas) { problems.push({ what: `flow: ${rest}*${replicas} is more replicas than are drawn (${FLOW_LIMITS.replicas})`, fix: `${rest}*${FLOW_LIMITS.replicas}` }); replicas = FLOW_LIMITS.replicas }
  return { base, label: rest.replace(/\s+/g, ' '), slots, replicas }
}

/** Split one chain into nodes and the arrows between them: 'a -> b -fail-> c' → ['a', 'b', 'c'], ['', 'fail']. */
function splitChain(chain: string): { names: string[]; labels: string[] } {
  const names: string[] = [], labels: string[] = []
  const arrow = /-(?:([^->][^>]*?)-)?>/g
  let at = 0
  for (let m = arrow.exec(chain); m; m = arrow.exec(chain)) {
    names.push(chain.slice(at, m.index))
    labels.push(m[1] ?? '')
    at = m.index + m[0].length
  }
  names.push(chain.slice(at))
  return { names, labels }
}

class Builder {
  nodes: FlowNode[] = []
  links: FlowLink[] = []
  problems: FlowProblem[] = []
  /** base name → ids */
  groups = new Map<string, string[]>()
  declare(m: Mention): string[] {
    const known = this.groups.get(m.base)
    if (known) {
      if (m.slots) for (const id of known) this.nodes.find((n) => n.id === id)!.slots = m.slots
      if (m.replicas > 1 && known.length !== m.replicas) this.problems.push({ what: `flow: "${m.label}" was written with ${known.length || 1} replica(s) first and ${m.replicas} later`, fix: `write ${m.label}*${m.replicas} where it first appears` })
      return known
    }
    const one = this.nodes.find((n) => n.id === m.base) // `worker2` after `worker*3`
    if (one) { if (m.slots) one.slots = m.slots; return [one.id] }
    const ids = m.replicas > 1 ? Array.from({ length: m.replicas }, (_, i) => `${m.base}${i + 1}`) : [m.base]
    ids.forEach((id, i) => this.nodes.push({ id, label: m.label, base: m.base, slots: m.slots, replica: m.replicas > 1 ? i + 1 : 0 }))
    this.groups.set(m.base, ids)
    return ids
  }
  link(from: string[], to: string[], label: string): void {
    const meaning = readLabel(label)
    for (const a of from) for (const b of to) {
      if (a === b) { this.problems.push({ what: `flow: "${a}" is linked to itself`, fix: 'link two different nodes' }); continue }
      if (this.links.some((l) => l.from === a && l.to === b)) continue
      this.links.push({ from: a, to: b, ...meaning })
    }
  }
  done(): FlowGraph { return { nodes: this.nodes, links: this.links, problems: this.problems } }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read a system: arrow text, or { nodes: { name: 'label' | { label, slots, replicas } }, links: [[from, to, label?]] }. */
export function parseFlow(spec: unknown): FlowGraph {
  const b = new Builder()
  if (typeof spec === 'string') {
    for (const chain of spec.split(/[;\n]/)) {
      if (!chain.trim()) continue
      const { names, labels } = splitChain(chain)
      let prev: string[] | null = null
      names.forEach((name, i) => {
        const m = readNode(name, b.problems)
        const ids = m ? b.declare(m) : null
        if (prev && ids) b.link(prev, ids, labels[i - 1] ?? '')
        else if (i > 0 && !ids && !name.trim()) b.problems.push({ what: `flow: an arrow in "${chain.trim()}" leads nowhere`, fix: 'name the node it points at: a -> b' })
        prev = ids
      })
    }
  } else if (isObject(spec)) {
    const nodes = isObject(spec.nodes) ? spec.nodes : {}
    for (const [name, v] of Object.entries(nodes)) {
      const o = isObject(v) ? v : {}
      const m = readNode(name, b.problems)
      if (!m) continue
      if (typeof v === 'string') m.label = v
      if (typeof o.label === 'string') m.label = o.label
      if (typeof o.slots === 'number' && o.slots > 0) m.slots = Math.min(FLOW_LIMITS.slots, Math.round(o.slots))
      if (typeof o.replicas === 'number' && o.replicas > 1) m.replicas = Math.min(FLOW_LIMITS.replicas, Math.round(o.replicas))
      b.declare(m)
    }
    const links = Array.isArray(spec.links) ? spec.links : []
    for (const l of links) {
      if (!Array.isArray(l) || typeof l[0] !== 'string' || typeof l[1] !== 'string') { b.problems.push({ what: `flow: a link must be [from, to, label?], got ${JSON.stringify(l)}`, fix: "links: [['client', 'server'], ['server', 'cache', 'miss 35%']]" }); continue }
      const from = readNode(l[0], b.problems), to = readNode(l[1], b.problems)
      if (from && to) b.link(b.declare(from), b.declare(to), typeof l[2] === 'string' ? l[2] : '')
    }
  } else {
    b.problems.push({ what: `flow: the system must be arrow text or { nodes, links }, got ${spec === null ? 'null' : typeof spec}`, fix: "flow('client -> server*2 -> database')" })
  }
  if (!b.nodes.length && !b.problems.length) b.problems.push({ what: 'flow: the system has no nodes', fix: "flow('client -> server*2 -> database')" })
  return b.done()
}

/** The ids a name written by an author stands for: an id, a base name (every replica), or the name as written. */
export function resolveNodes(graph: FlowGraph, name: unknown): string[] {
  if (typeof name !== 'string') return []
  const key = idOf(name)
  const exact = graph.nodes.filter((n) => n.id === name || n.id === key)
  return exact.length ? exact.map((n) => n.id) : graph.nodes.filter((n) => n.base === name || n.base === key).map((n) => n.id)
}
