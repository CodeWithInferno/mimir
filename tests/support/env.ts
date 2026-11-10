// What the end-to-end tests share about the machine they run on, so that no test file assumes one.
//
// The suites remove MIMIR_CHROME_ARGS, MIMIR_TIMEOUT and MIMIR_FFMPEG from the environment of the commands they start:
// a setting of the person's shell must not change what a test asserts. A machine that NEEDS something (a CI runner
// without a GPU or without user namespaces, a slow runner, an ffmpeg that is not on PATH) says so with the variables
// below, which exist for the tests only:
//   MIMIR_TEST_CHROME_ARGS   passed to the CLI as MIMIR_CHROME_ARGS (for example --no-sandbox --use-angle=swiftshader)
//   MIMIR_TEST_TIMEOUT       passed to the CLI as MIMIR_TIMEOUT (ms a scene may take to load)
//   MIMIR_FFMPEG             the ffmpeg the video tests use when none is on PATH (found by the CLI's own discovery)
import { findFfmpeg } from '../../src/cli/video.ts'

/** Variables of the person's shell that the tests clear before starting the CLI (a test that needs one sets it itself). */
export const CLEARED = ['MIMIR_TIMEOUT', 'MIMIR_TYPES', 'MIMIR_CHROME_ARGS', 'MIMIR_FFMPEG', 'MIMIR_PORT', 'MIMIR_SERVE_EXTENSIONS'] as const

/** Clear the shell's settings from `env` (plus `more`), then apply what the machine declared for the tests. Returns `env`. */
export function testEnv(env: Record<string, string>, more: readonly string[] = [], from: Record<string, string | undefined> = process.env): Record<string, string> {
  for (const name of [...CLEARED, ...more]) delete env[name]
  if (from.MIMIR_TEST_CHROME_ARGS) env.MIMIR_CHROME_ARGS = from.MIMIR_TEST_CHROME_ARGS
  if (from.MIMIR_TEST_TIMEOUT) env.MIMIR_TIMEOUT = from.MIMIR_TEST_TIMEOUT
  return env
}

/** The ffmpeg the CLI itself would find (MIMIR_FFMPEG, else PATH), or null: the video tests are skipped without one. */
export function ffmpegForTests(from: Record<string, string | undefined> = process.env): string | null {
  try { return findFfmpeg(from) } catch { return null }
}
/** What a video test adds to the CLI's environment so that it finds the same ffmpeg. */
export const videoEnv = (ffmpeg: string | null): Record<string, string> => (ffmpeg ? { MIMIR_FFMPEG: ffmpeg } : {})
