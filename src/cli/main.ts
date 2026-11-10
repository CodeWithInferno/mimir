#!/usr/bin/env bun
// mimir: the command line. stdout carries the result only; logs go to stderr.
// Exit codes: 0 clean, 1 errors found in the scene, 2 usage or internal failure.
import {
  COMMANDS, commandHelp, parseFlags, parseTopLevel, toCheckOptions, toDocsOptions, toExamplesOptions, toExportOptions, toInitOptions,
  toNewOptions, toOpenOptions, toQueryOptions, toShotOptions, topHelp, wantsJson,
} from './args.ts'
import { skill, toSkillOptions } from './agents/skill.ts'
import { runCleanups, terminationInProgress } from './chrome.ts'
import { check } from './commands/check.ts'
import { docs, examples, init } from './commands/docs.ts'
import { exportScene } from './commands/export.ts'
import { newScene } from './commands/new.ts'
import { open } from './commands/open.ts'
import { query } from './commands/query.ts'
import { review, toReviewOptions } from './commands/review.ts'
import { serve, toServeOptions } from './commands/serve.ts'
import { shot } from './commands/shot.ts'
import { bench, toBenchOptions } from './commands/bench.ts'
import { CliError, UsageError } from './errors.ts'
import { processIo } from './io.ts'
import { readVersion } from './paths.ts'

export async function run(argv: readonly string[]): Promise<number> {
  const top = parseTopLevel(argv)
  if (top.kind === 'help') {
    process.stdout.write(topHelp(await readVersion()))
    return 0
  }
  if (top.kind === 'version') {
    process.stdout.write(`${await readVersion()}\n`)
    return 0
  }
  const spec = COMMANDS[top.command]!
  const parsed = parseFlags(spec, top.rest)
  if (parsed.help) {
    process.stdout.write(commandHelp(spec))
    return 0
  }
  // shot, examples, review and bench answer in compact text unless --json is given: they are read by agents, and JSON of paths and hashes is what made a small scene expensive
  const textFirst = top.command === 'shot' || top.command === 'examples' || top.command === 'review' || top.command === 'bench'
  const io = processIo(textFirst ? parsed.json : wantsJson(parsed.json, parsed.text, process.stdout.isTTY === true))
  switch (top.command) {
    case 'check': return check(toCheckOptions(parsed), io)
    case 'shot': return shot(toShotOptions(parsed), io)
    case 'open': return open(toOpenOptions(parsed), io)
    case 'export': return exportScene(toExportOptions(parsed), io)
    // the reference is text; JSON only when asked for explicitly
    case 'docs': return docs(toDocsOptions(parsed), io, parsed.json)
    case 'examples': return examples(toExamplesOptions(parsed), io, parsed.json)
    case 'init': return init(toInitOptions(parsed), io)
    case 'query': return query(toQueryOptions(parsed), io)
    case 'new': return newScene(toNewOptions(parsed), io)
    case 'serve': return serve(toServeOptions(parsed), io)
    case 'skill': return skill(toSkillOptions(parsed), io)
    case 'review': return review(toReviewOptions(parsed), io)
    case 'bench': return bench(toBenchOptions(parsed), io)
    default: throw new UsageError(`unknown command "${top.command}"`)
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv)
  } catch (e) {
    // A signal is tearing the process down: this error is a consequence of the browser being killed under a
    // running command. The signal path reports nothing and exits with the signal's code once it is done.
    const stopping = terminationInProgress()
    if (stopping) return stopping
    if (e instanceof UsageError) {
      const spec = e.command ? COMMANDS[e.command] : undefined
      process.stderr.write(`mimir: ${e.message}\n` + (spec ? `usage: ${spec.usage}\n` : 'usage: mimir <command> [options]   (mimir --help)\n'))
      return 2
    }
    if (e instanceof CliError) {
      process.stderr.write(`mimir: ${e.message}\n`)
      return e.exitCode
    }
    const err = e instanceof Error ? e : new Error(String(e))
    process.stderr.write(`mimir: internal error: ${process.env.MIMIR_DEBUG ? err.stack : err.message}\n`)
    return 2
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2))
  // never race a signal teardown to the exit (it owns the exit code and the cleanup)
  await (terminationInProgress() ?? Promise.resolve())
  runCleanups()
  // let stdout drain before exiting (it may be a pipe)
  await new Promise<void>((done) => process.stdout.write('', () => done()))
  process.exit(code)
}
