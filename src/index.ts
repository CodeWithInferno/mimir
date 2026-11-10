// Public entry of the main chunk (dist/mimir.js): assembles the API from every src/<module>/index.ts (through the
// generated barrel), installs every public name on globalThis, and exposes boot() for the viewer page. The API of an
// on-demand module (an index.ts that says `lazy = true`) arrives with its own chunk, before a scene that uses it runs.
import { api, installApi } from './_generated/core.ts'
import { bridge } from './_generated/bridge.ts'
import { chunks, FEATURES } from './_generated/chunks.ts'
import { boot as hostBoot, installGlobals, type BootOptions, type MimirHost } from './host/index.ts'

// lazy chunks (mimir.3d.js, mimir.check.js, a module's own) resolve their imports of core-chunk modules through this object
;(globalThis as { __mimirBridge?: unknown }).__mimirBridge = bridge
installGlobals(api)

/** Start the viewer: reads the URL contract from location.search unless options are given. */
export function boot(options: BootOptions = {}): MimirHost {
  return hostBoot({ api, chunks, featureTable: FEATURES, install: installApi, ...options })
}
export { api }
export * from './_generated/core.ts'
export type { BootOptions, MimirHost }
