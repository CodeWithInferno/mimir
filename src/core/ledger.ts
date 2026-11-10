// The registration ledger: who registered what. Every define* call claims (registry, name) here, so a second
// module that registers the same name by accident is caught (scripts/build.ts fails on it) instead of silently
// replacing the first. Replacing on purpose is spelled out: `override: true`.

export interface Registration {
  /** 'kind' | 'backend' | 'setter' | 'method' | 'getter' | 'kindMethod' | 'verb' | 'stepAction' | 'sceneMethod' | 'overlay' | 'rule' | 'placement' | 'interp' | 'renderer' | 'look' | 'finalize' | 'manifest' | 'player' | 'config' */
  registry: string
  name: string
  /** `<module>/<file>` under src/ when known (dev and build); null inside a bundle */
  owner: string | null
  /** file:line:col of the define* call; null inside the main bundle */
  site: string | null
  /** owner of the registration this one replaced with `override: true` */
  replaced?: string | null
}
export interface RegistryConflict { registry: string; name: string; first: string | null; second: string | null }

// Who registered what is a question for the build (scripts/build.ts imports the sources under bun and reads the
// ledger). Inside a bundle every registration comes from the bundle itself, so the build compiles the stack reading
// out (`__MIMIR_BUNDLE__` is defined there and nowhere else).
declare const __MIMIR_BUNDLE__: boolean | undefined
function caller(): { owner: string | null; site: string | null } {
  if (typeof __MIMIR_BUNDLE__ !== 'undefined') return { owner: null, site: null }
  // module top-level frames carry a line but no column under JavaScriptCore: the column is optional
  const FRAME = /((?:[a-z][a-z0-9+.-]*:\/\/|\/|[A-Za-z]:\\)[^\s()]*?):(\d+)(?::(\d+))?\)?\s*$/
  const ENGINE = /\/core\/(ledger|registry|node|config)\.ts$/
  const E = Error as unknown as { stackTraceLimit?: number }
  const prev = E.stackTraceLimit
  if (typeof prev === 'number' && prev < 20) E.stackTraceLimit = 20
  const lines = (new Error().stack ?? '').split('\n')
  if (typeof prev === 'number') E.stackTraceLimit = prev
  /** the file this module lives in: the first frame of any stack taken here */
  let self = ''
  for (const line of lines) {
    const m = FRAME.exec(line)
    if (!m) continue
    if (!self) self = m[1]!
    const file = m[1]!.replace(/^file:\/\//, '')
    if (m[1] === self || ENGINE.test(file)) continue
    const mod = /\/src\/([^/]+)\/([^/?]+)(?:\?.*)?$/.exec(file)
    return { owner: mod ? `${mod[1]}/${mod[2]}` : file.split('/').slice(-2).join('/'), site: `${file}:${m[2]}:${m[3] ?? ''}` }
  }
  return { owner: null, site: null }
}

const ledger = new Map<string, Registration>()
const conflicts: RegistryConflict[] = []

/**
 * Claim `name` in `registry`. Returns true when the caller may install its definition: the name is free, it is the
 * same define* call running again, or `override` is set. Returns false (and records a conflict) when another
 * registration already owns the name: the first one stays in force.
 */
export function claim(registry: string, name: string, override = false): boolean {
  const key = registry + '\u0000' + name
  const at = caller()
  const prev = ledger.get(key)
  if (prev && !override && !(at.site !== null && at.site === prev.site)) {
    conflicts.push({ registry, name, first: prev.owner, second: at.owner })
    if (typeof document !== 'undefined') console.error(`[mimir] ${registry} "${name}" is registered twice (${prev.owner ?? 'first'} and ${at.owner ?? 'second'}); the first one is kept. Pass override: true to replace it on purpose.`)
    return false
  }
  ledger.set(key, { registry, name, owner: at.owner, site: at.site, ...(prev && override ? { replaced: prev.owner } : {}) })
  return true
}
/** Every registration, in registration order (for tools and the build). */
export const registrations = (): Registration[] => [...ledger.values()]
/** Who owns a name: ownerOf('kind', 'rect') → 'r2d/kinds.ts'. */
export const ownerOf = (registry: string, name: string): string | null => ledger.get(registry + '\u0000' + name)?.owner ?? null
/** Names registered twice without `override: true`. scripts/build.ts fails when this is not empty. */
export const registryConflicts = (): RegistryConflict[] => [...conflicts]
