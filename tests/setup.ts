// Loaded before every `bun test` run (bunfig.toml). The barrels in src/_generated and the typed reference in types/ are
// written by the build and are not in git: on a fresh clone they are made here, once, before a test imports them.
// (The CLI does the same on its own: it builds dist/ when it is missing or older than the sources.)
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const needed = [join(root, 'src', '_generated', 'core.ts'), join(root, 'src', '_generated', 'chunks.ts'), join(root, 'types', 'mimir.d.ts')]
if (needed.some((f) => !existsSync(f)) && existsSync(join(root, 'scripts', 'build.ts'))) {
  const run = Bun.spawnSync([process.execPath, join(root, 'scripts', 'build.ts'), '--barrels', '--quiet'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(`the generated files are missing and \`bun scripts/build.ts --barrels\` failed:\n${run.stderr.toString()}${run.stdout.toString()}`)
}
