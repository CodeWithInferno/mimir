// A scene that fails to parse reaches the page as a failed dynamic import, and the browser gives no position for
// it (measured: "SyntaxError: missing ) after argument list", no file, no line). The CLI has the files on disk,
// so it parses them itself and puts the line back into the diagnostic.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import type { FatalInfo } from './format.ts'

export interface SyntaxProblem {
  /** absolute path of the file that does not parse */
  file: string
  line: number
  column: number
  message: string
}

interface BuildPosition { line?: unknown; column?: unknown }

/**
 * First syntax error in a module or in the local modules it imports (relative specifiers, inside `root`).
 * Null when everything parses, or when a file cannot be read. Never throws.
 */
export function findSyntaxError(entry: string, root: string = dirname(entry), limit = 64): SyntaxProblem | null {
  const transpiler = new Bun.Transpiler({ loader: 'js' })
  const inside = (p: string): boolean => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)
  const seen = new Set<string>()
  const todo = [resolve(entry)]
  while (todo.length && seen.size < limit) {
    const file = todo.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      if (!statSync(file).isFile()) continue
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    try {
      transpiler.transformSync(source)
    } catch (e) {
      const err = e as { message?: unknown; position?: BuildPosition | null; errors?: Array<{ message?: unknown; position?: BuildPosition | null }> }
      const first = Array.isArray(err.errors) && err.errors.length ? err.errors[0]! : err
      const pos = first.position ?? null
      const line = pos !== null && typeof pos.line === 'number' ? pos.line : null
      if (line === null) continue
      return { file, line, column: typeof pos!.column === 'number' ? pos!.column : 0, message: String(first.message ?? 'syntax error') }
    }
    let imports: string[]
    try {
      imports = transpiler.scanImports(source).map((i) => i.path)
    } catch {
      continue
    }
    for (const spec of imports) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue
      const target = resolve(dirname(file), spec)
      if (inside(target) && existsSync(target)) todo.push(target)
    }
  }
  return null
}

/** Page URL path of a file under the scene directory: /scene/<relative path>, each segment URL-encoded. */
function sceneUrlOf(file: string, sceneDir: string): string {
  return '/scene/' + relative(sceneDir, file).split(sep).map(encodeURIComponent).join('/')
}

/** 1-based line of the import statement that lists `name`, or null. */
function importLineOf(file: string, name: string): number | null {
  let lines: string[]
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    return null
  }
  const word = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`)
  let inImport = false
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    if (/^\s*import\b/.test(text)) inImport = true
    if (inImport && word.test(text)) return i + 1
    if (inImport && /\bfrom\s*['"]|^\s*import\s*['"]/.test(text)) inImport = false
  }
  return null
}

/**
 * Give a load failure that has no line the position of the syntax error on disk, when there is one.
 * A fatal that already has a line, or a scene that parses, is returned unchanged.
 */
export function locateFatal(fatal: FatalInfo, scenePath: string): FatalInfo {
  if (fatal.line !== null) return fatal
  const problem = findSyntaxError(scenePath)
  if (problem === null) {
    // an import of a name the API does not have: point at the import line that lists it
    const missing = /'([A-Za-z_$][\w$]*)' is not part of the mimir API/.exec(fatal.message)
    if (missing) {
      const line = importLineOf(scenePath, missing[1]!)
      if (line !== null) return { ...fatal, file: sceneUrlOf(resolve(scenePath), dirname(resolve(scenePath))), line }
    }
    return fatal
  }
  const first = fatal.message.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? 'SyntaxError'
  const detail = /syntax/i.test(first) ? `${first} (${problem.message})` : `SyntaxError: ${problem.message}`
  return { message: detail, file: sceneUrlOf(problem.file, dirname(scenePath)), line: problem.line }
}
