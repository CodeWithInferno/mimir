// What a command may touch: stdout for the result, stderr for logs, the working directory and environment.

import { writeSync } from 'node:fs'

export interface Io {
  /** write the result (stdout) */
  out(text: string): void
  /** write a log line (stderr), prefixed with "mimir: " */
  log(message: string): void
  /** true when the result must be compact JSON (see wantsJson in args.ts) */
  json: boolean
  cwd: string
  env: Record<string, string | undefined>
}

/** ms to wait when the reader of a pipe is slower than we write */
const PIPE_WAIT_MS = 1

/**
 * Write all of a text to a file descriptor before returning. The result of a command is read by programs through
 * a pipe, and a pipe holds 64 KB: a write that is left to the event loop is cut off there when the process exits.
 */
export function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text)
  for (let done = 0; done < bytes.length; ) {
    try {
      done += writeSync(fd, bytes, done)
    } catch (e) {
      // the pipe is full: its reader has not caught up yet
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e
      Bun.sleepSync(PIPE_WAIT_MS)
    }
  }
}

export function processIo(json: boolean): Io {
  return {
    out: (text) => { try { writeAll(1, text) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPIPE') throw e } },
    log: (message) => void process.stderr.write(`mimir: ${message}\n`),
    json,
    cwd: process.cwd(),
    env: process.env,
  }
}
