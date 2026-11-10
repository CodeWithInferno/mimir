// Where things live: the project root, the viewer directory (built on demand), the scene file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { CliError, UsageError } from './errors.ts'

/** Project root: two levels above src/cli. */
export const ROOT = resolve(import.meta.dir, '..', '..')

export async function readVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(ROOT, 'package.json')).json()) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export interface SceneRef {
  /** absolute path of the scene file */
  path: string
  dir: string
  /** file name, e.g. engine.scene.js */
  file: string
  /** name used for output directories: the file name without .scene.js / .js / .mjs */
  name: string
  /** URL of the module on the local server, e.g. /scene/engine.scene.js */
  url: string
}

export function resolveScene(arg: string, cwd: string, command: string): SceneRef {
  const path = resolve(cwd, arg)
  let isFile = false
  try {
    isFile = statSync(path).isFile()
  } catch {
    // reported below
  }
  if (!isFile) throw new UsageError(`scene file not found: ${arg}`, command)
  const file = basename(path)
  const name = file.replace(/(\.scene)?\.(m?js|ts)$/i, '') || file
  return { path, dir: dirname(path), file, name, url: `/scene/${encodeURIComponent(file)}` }
}

/** Newest modification time (ms) of the files under a directory; 0 when it does not exist. */
export function newestMtime(dir: string, skip: (path: string) => boolean = () => false): number {
  let newest = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.name === 'node_modules' || e.name.startsWith('.') || skip(p)) continue
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p, skip))
    else if (e.isFile()) {
      try {
        newest = Math.max(newest, statSync(p).mtimeMs)
      } catch {
        // deleted while walking
      }
    }
  }
  return newest
}

/** Every file under a directory, as sorted paths relative to `base` (dot files and node_modules skipped). */
function listFiles(dir: string, base: string, skip: (path: string) => boolean, out: string[] = []): string[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.name === 'node_modules' || e.name.startsWith('.') || skip(p)) continue
    if (e.isDirectory()) listFiles(p, base, skip, out)
    else if (e.isFile()) out.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return out
}

/**
 * A fingerprint of WHICH files the viewer is built from (not of their contents: modification times cover edits).
 * scripts/build.ts stores it in dist/build.json; when a module or a file is added, removed or renamed the
 * fingerprint of the tree no longer matches and the viewer is rebuilt. src/cli (not part of the viewer) and
 * src/_generated (written by the build itself) do not count.
 */
export function inputSignature(root: string): string {
  const src = join(root, 'src')
  const skip = (p: string): boolean => p === join(src, 'cli') || p === join(src, '_generated')
  const files = [...listFiles(src, root, skip), ...listFiles(join(root, 'scripts'), root, () => false)].sort()
  const hash = new Bun.CryptoHasher('sha1')
  hash.update(files.join('\n'))
  return `${files.length}:${hash.digest('hex').slice(0, 16)}`
}

/** The `inputs` fingerprint the last successful build recorded, or null (no dist, or a dist from before build.json). */
export function builtSignature(distDir: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(distDir, 'build.json'), 'utf8')) as { inputs?: unknown }).inputs
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export interface ViewerRoot {
  dir: string
  built: boolean
  /** set when a rebuild was needed and failed: `dir` is the last good build, which does not match the sources */
  stale?: string
}

/**
 * Decide whether the real viewer has to be (re)built. Pure given its inputs. 'changed' = the set of source files is
 * not the one dist was built from (a module was added, removed or renamed): modification times cannot show a deletion.
 */
export function buildNeeded(viewerExists: boolean, distNewest: number, srcNewest: number, built: string | null = null, current: string | null = null): 'missing' | 'stale' | 'changed' | null {
  if (!viewerExists) return 'missing'
  if (srcNewest > distNewest) return 'stale'
  return built !== current ? 'changed' : null
}

/**
 * The directory that holds viewer.html. MIMIR_VIEWER_ROOT selects another viewer (used by the tests with the
 * stub). Otherwise it is <root>/dist, built with `bun scripts/build.ts` when it is missing or older than src.
 */
export async function ensureViewer(
  env: Record<string, string | undefined> = process.env,
  log: (m: string) => void = () => {},
  root: string = ROOT,
): Promise<ViewerRoot> {
  const override = env.MIMIR_VIEWER_ROOT
  if (override !== undefined && override !== '') {
    const dir = resolve(override)
    if (!existsSync(join(dir, 'viewer.html'))) throw new CliError(`MIMIR_VIEWER_ROOT has no viewer.html: ${dir}`)
    return { dir, built: false }
  }
  const dir = join(root, 'dist')
  const viewer = join(dir, 'viewer.html')
  const cliDir = join(root, 'src', 'cli')
  const srcNewest = Math.max(
    newestMtime(join(root, 'src'), (p) => p === cliDir),
    newestMtime(join(root, 'scripts')),
  )
  const script = join(root, 'scripts', 'build.ts')
  // the fingerprint only means something when the build script writes one (a complete checkout)
  const tracked = existsSync(join(dir, 'build.json'))
  const why = buildNeeded(existsSync(viewer), newestMtime(dir), srcNewest, tracked ? builtSignature(dir) : null, tracked ? inputSignature(root) : null)
  if (why === null) return { dir, built: false }

  if (!existsSync(script)) {
    if (why !== 'missing') {
      // an installed package: it ships its build and no build script, and file dates there mean nothing
      return { dir, built: false }
    }
    throw new CliError(
      `the viewer is not built: ${viewer} is missing and ${script} does not exist. ` +
        'Run from a complete checkout, or set MIMIR_VIEWER_ROOT to a directory that contains viewer.html.',
    )
  }
  log(why === 'missing' ? 'building the viewer (dist is missing)…' : why === 'stale' ? 'rebuilding the viewer (dist is older than src)…' : 'rebuilding the viewer (a module or file was added, removed or renamed since dist was built)…')
  const proc = Bun.spawn([process.execPath, script], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) {
    const what = `building the viewer failed (bun scripts/build.ts exited with ${code}):\n${(err + out).trim()}`
    // a broken module must not take every command down with it: the last good build still answers, loudly
    if (why !== 'missing' && existsSync(viewer)) {
      log(`WARNING: ${what}\nWARNING: using the last good build in ${dir}; it does NOT contain the latest source changes. Fix the error above.`)
      return { dir, built: false, stale: what }
    }
    throw new CliError(what)
  }
  if (!existsSync(viewer)) throw new CliError(`bun scripts/build.ts finished but did not produce ${viewer}`)
  return { dir, built: true }
}
