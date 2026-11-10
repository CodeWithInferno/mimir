// The command-line shape of the three commands of this folder: `mimir new`, `mimir serve`, `mimir skill`.
// Pure data (no I/O, no imports that run code), so that src/cli/args.ts can list them beside the other commands
// and each command module can also be run on its own.
import type { CommandSpec } from '../args.ts'
import { DEFAULT_BUDGET_USD, DEFAULT_JOBS, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_S } from './limits.ts'
import { NEW_LEAN_FLAGS } from '../lean-specs.ts'

export const NEW_SPEC: CommandSpec = {
  name: 'new',
  summary: 'generate a scene from a prompt with a headless coding agent',
  usage: 'mimir new "<prompt>" [-o dir] [--once | --loop] [--fix n] [--edit scene] [--open] [--agent name] [--model id] [--fast] [--size s] [--max-turns n] [--budget-usd x] [--system file] [--resume id] [--timeout s]',
  args: '"<prompt>"',
  minArgs: 1,
  maxArgs: 1,
  flags: [
    { name: 'out', short: 'o', type: 'string', value: 'dir', help: 'directory the agent works in and writes the scene to (default: the working directory)' },
    { name: 'agent', type: 'string', value: 'name', help: 'which agent adapter drives the loop: claude, codex, command (default: MIMIR_AGENT, else mimir.config.json, else the first one found on this machine)' },
    { name: 'model', type: 'string', value: 'id', help: 'model the agent uses (default: MIMIR_MODEL, else mimir.config.json, else the adapter default)' },
    { name: 'max-turns', type: 'string', value: 'n', help: `turn limit, enforced here as well as passed to the agent (default: MIMIR_MAX_TURNS, else mimir.config.json, else ${DEFAULT_MAX_TURNS})` },
    { name: 'budget-usd', type: 'string', value: 'x', help: `cost ceiling in US dollars, passed to agents that take one; the result says over_budget when it was passed anyway (default: MIMIR_BUDGET_USD, else mimir.config.json, else ${DEFAULT_BUDGET_USD})` },
    { name: 'system', type: 'string', value: 'file', help: 'instructions for a headless run (default: MIMIR_GEN_SYSTEM, else mimir.config.json, else <mimir>/skills/mimir/gen-system.md)' },
    { name: 'resume', type: 'string', value: 'id', help: 'continue an earlier generation (the session of its result) with a follow-up prompt' },
    { name: 'timeout', type: 'string', value: 's', help: `give up after this many seconds (default ${DEFAULT_TIMEOUT_S})` },
    ...NEW_LEAN_FLAGS,
  ],
  notes: [
    'stdout is NDJSON, a stage on every line: storyboard | writing | checking | looking | fixing, then ready or failed.',
    'The last line is {"event":"result", stage, ok, scene, check, sheet, looked, rounds, turns, cost_usd, error, notes}: the check was run by this command and the sheet rendered by it from the final file.',
    'exit 0 = ready (a scene was written and mimir check finds no error in it), 1 = failed (the result line says why), 2 = usage or setup.',
    'The engine calls no model: any agent works through --agent command (MIMIR_AGENT_COMMAND or mimir.config.json). docs/agents.md has the contract.',
  ],
}

export const SERVE_SPEC: CommandSpec = {
  name: 'serve',
  summary: 'the home of the player: the viewer and the home API (scenes, new, export) on a local port',
  usage: 'mimir serve [dir] [--port n] [--open] [--jobs n]',
  args: '[dir]',
  minArgs: 0,
  maxArgs: 1,
  flags: [
    { name: 'port', type: 'string', value: 'n', help: 'port (default: any free one)' },
    { name: 'open', type: 'boolean', help: 'open the browser' },
    { name: 'jobs', type: 'string', value: 'n', help: `generations that may run at the same time (default ${DEFAULT_JOBS})` },
  ],
  notes: [
    'stdout is one line: {url, port, root}. The server runs until it is interrupted.',
    'It listens on 127.0.0.1 only, refuses requests for another Host, and never serves dot files.',
    'API: GET /api/scenes · GET /api/agents · POST /api/new · GET /api/new/<id>/events (server-sent events) · GET /api/export?scene=',
  ],
}

export const SKILL_SPEC: CommandSpec = {
  name: 'skill',
  summary: 'install the mimir skill for a coding agent; regenerate its API reference',
  usage: 'mimir skill <install|refresh|check|snippet|path> [--target claude|codex|<dir>] [--copy] [--force] [--dry-run] [--agents-md file]',
  args: '<install|refresh|check|snippet|path>',
  minArgs: 1,
  maxArgs: 1,
  flags: [
    { name: 'target', type: 'list', value: 'claude|codex|dir', help: 'install: where to (repeatable). claude = its personal skills, codex = ~/.agents/skills, anything else = a directory. Default: every agent whose home directory exists' },
    { name: 'copy', type: 'boolean', help: 'install: copy the folder instead of linking it (a snapshot that does not follow this checkout)' },
    { name: 'force', type: 'boolean', help: 'install: replace what is already at the target' },
    { name: 'dry-run', type: 'boolean', help: 'install: say what would be done and change nothing' },
    { name: 'agents-md', type: 'string', value: 'file', help: 'install: also write the pointer to the skill into this AGENTS.md (created or updated between two markers)' },
  ],
  notes: [
    'install changes only the target it names; nothing else of the agent\'s configuration is touched.',
    'The skill needs the `mimir` command on the PATH of the agent\'s shell; install prints how when it is not.',
    'Claude Code can also take the skill and the command together as a plugin: see docs/agents.md.',
  ],
}

