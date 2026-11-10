// Run one command module directly (`bun src/cli/commands/serve.ts …`): the same output rules and exit codes as the
// `mimir` launcher. Used by the modules of this folder under `import.meta.main`, so each can be run and tested by
// itself; `mimir <command>` calls the same functions.
import { commandHelp, parseFlags, wantsJson, type CommandSpec } from '../args.ts'
import { runCleanups, terminationInProgress } from '../chrome.ts'
import { CliError, UsageError } from '../errors.ts'
import { processIo, type Io } from '../io.ts'

export async function standalone(spec: CommandSpec, run: (argv: readonly string[], io: Io) => Promise<number>, argv: readonly string[] = process.argv.slice(2)): Promise<never> {
  let code: number
  try {
    const parsed = parseFlags(spec, argv)
    if (parsed.help) {
      process.stdout.write(commandHelp(spec))
      code = 0
    } else code = await run(argv, processIo(wantsJson(parsed.json, parsed.text, process.stdout.isTTY === true)))
  } catch (e) {
    const stopping = terminationInProgress()
    if (stopping) code = await stopping
    else if (e instanceof UsageError) { process.stderr.write(`mimir: ${e.message}\nusage: ${spec.usage}\n`); code = 2 }
    else if (e instanceof CliError) { process.stderr.write(`mimir: ${e.message}\n`); code = e.exitCode }
    else { const err = e instanceof Error ? e : new Error(String(e)); process.stderr.write(`mimir: internal error: ${process.env.MIMIR_DEBUG ? err.stack : err.message}\n`); code = 2 }
  }
  await (terminationInProgress() ?? Promise.resolve())
  runCleanups()
  await new Promise<void>((done) => process.stdout.write('', () => done()))
  process.exit(code)
}
