// Player, the side every scene carries: what the chrome has to know about a scene that only the model can tell (the
// name, colour and group of each part, what the author wrote about it), as info().player, and `part.describe(text)`.
// The chrome itself is the lazy chunk src/player/player.chunk.ts, loaded only with a person watching; it uses
// window.__mimir (the host protocol) and nothing else.
import { defineManifest, defineMethod, kindOf, luminance, type MNode, type SceneModel } from '../core/index.ts'
import { LEGIBLE_LUMINANCE, partColor } from '../guide/index.ts'
import { isAutoId, prettyName } from './names.ts'

/** A name longer than this many words is a remark about the part, not its name (UI design specification 7.7: four words at most). */
export const NAME_WORDS = 4

/** One entry of info().player.parts: a part as the chrome lists it. */
export interface PartMeta {
  id: string
  /** what it is called: the label the story gives it, the words that name it in the narration, else its id as words */
  name: string
  /** the colour its dot and its linked words carry; null when it has none that reads on black */
  color: string | null
  /** the name of what it is part of ('' when it stands alone) */
  group: string
  /** part.describe(text); null when the scene said nothing */
  description: string | null
  space: '2d' | '3d'
  /** the author named it, or the story names it: it belongs in the list of parts */
  listed: boolean
}
export interface PlayerManifest { parts: PartMeta[] }

const descriptions = (model: SceneModel): Map<number, string> => model.store<Map<number, string>>('player.descriptions', () => new Map())
/** part.describe('Slides up and down in the cylinder.'): one sentence about the part, shown when a reader asks what it is. */
defineMethod('*', 'describe', (node: MNode, text: unknown) => {
  if (typeof text !== 'string' || !text.trim()) { node.model.diagnostics.add({ code: 'API-TYPE', ids: [node.id], what: `${node.kind}.describe() expects one sentence of text.`, fix: [".describe('Slides up and down in the cylinder.')"] }, node.src); return node }
  descriptions(node.model).set(node.uid, text.trim())
  return node
})

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

defineManifest('player', (model): PlayerManifest => {
  const told = new Map<number, string>() // the first thing the story calls each part
  const call = (node: MNode | undefined, text: unknown): void => {
    if (!node || typeof text !== 'string' || told.has(node.uid)) return
    const t = text.replace(/[.,;:!?…]+$/u, '').trim()
    if (t && words(t) <= NAME_WORDS) told.set(node.uid, cap(t))
  }
  for (const a of model.actions) if (a.type === 'label') call((a.data as { node?: MNode })?.node, (a.data as { text?: unknown })?.text)
  const spoken = new Set<number>()
  for (const s of model.steps) for (const n of s.narration) for (const sp of n.spans) {
    for (const id of sp.targets) { const node = model.byId.get(id); if (node) spoken.add(node.uid) }
    if (sp.targets.length === 1) call(model.byId.get(sp.targets[0]!), sp.words)
  }
  const frame = model.state(0)
  const said = descriptions(model)
  const named = (n: MNode): boolean => !isAutoId(n.id.split('.')[0]!, model.byId.get(n.id.split('.')[0]!)?.kind ?? n.kind)
  const parts: PartMeta[] = []
  for (const n of model.nodes) {
    if (kindOf(n.kind)?.container) continue
    let color: string | null = null
    try { color = frame.run(() => partColor(frame, n)) } catch { /* a colour that cannot be worked out is no colour */ }
    if (color && luminance(color) < LEGIBLE_LUMINANCE) color = null
    let owner: MNode | null = n.parent
    while (owner && isAutoId(owner.id, owner.kind) && owner.parent) owner = owner.parent
    parts.push({
      id: n.id, name: n.label ?? told.get(n.uid) ?? prettyName(n.id.split('.').pop() ?? n.id), color,
      group: owner && !isAutoId(owner.id, owner.kind) ? owner.label ?? told.get(owner.uid) ?? prettyName(owner.id) : '',
      description: said.get(n.uid) ?? null, space: n.space, listed: named(n) || told.has(n.uid) || spoken.has(n.uid) || said.has(n.uid),
    })
  }
  return { parts }
})

export const api = {}
