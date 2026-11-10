# Driving Mimir from a coding agent

Mimir calls no model. A coding agent (any agent with a shell and a way to open a picture) writes the scene, and
Mimir gives it three things: a **skill** that teaches the loop, a **command line** that checks and renders, and
`mimir new`, which starts an agent headless and reports honestly what came out.

Everything here was run on one machine (macOS, bun 1.3, Claude Code 2.1.322, codex-cli 0.163). Each section says
what was run and what was not.

## Quick start

```
mimir new "how does a bicycle gear change work" -o gears --open  # one call of a model writes gears/<name>.scene.js and it plays
mimir new "make the small gear gold" --edit gears/<name>.scene.js # a change is one call too
mimir export gears/<name>.scene.js -o gears.html                 # one self-contained file
```

`mimir new` needs a model on the machine: a command line that answers in text (the default, one call), or a coding
agent that runs the loop itself (`--loop`). It uses the first one it finds; `mimir serve` lists what it found under
`GET /api/agents`.

## Giving an agent the skill

| Agent | Command | What it does | Verified here |
|---|---|---|---|
| Claude Code, one session | `claude --plugin-dir <mimir>` | loads the plugin in place: the skill `mimir:mimir`, and `bin/mimir` on the shell's PATH | yes: this is how `mimir new --agent claude` runs |
| Claude Code, installed | `claude plugin marketplace add <mimir>` then `claude plugin install mimir@mimir` | the same, for every session; the plugin is read in place, so it follows the checkout | yes, in a separate config directory (`CLAUDE_CONFIG_DIR`); not in a real user configuration |
| Claude Code, skill only | `mimir skill install --target claude` | links `skills/mimir` into the personal skills folder; `mimir` must be on PATH | the link, yes; a session using it, no |
| Codex, skill | `mimir skill install --target codex --agents-md AGENTS.md` | links `skills/mimir` into `~/.agents/skills` and writes the pointer into `AGENTS.md` | the files, yes; a Codex session, no |
| Codex, plugin | `codex plugin marketplace add <mimir>` then `codex plugin add mimir@mimir` | installs from `.agents/plugins/marketplace.json` | "installed, enabled" in a separate `CODEX_HOME`. Codex COPIES the whole checkout into its cache (91 MB with `node_modules`): prefer the skill link |
| Any other agent | `mimir skill install --target <directory>`, or paste `mimir skill snippet` into its instructions file | a copy or link of the skill folder; a pointer to it | the files, yes |

`mimir skill install` changes only the target it names, refuses to replace something that is already there without
`--force`, and `--dry-run` shows the plan. Without `--target` it installs for every agent whose home directory exists.

`claude plugin validate . --strict` passes (exit 0). Its notes for the public plugin directory ask for a README of
at least 40 words and an icon; neither changes the result.

### What the skill costs

Measured with `claude plugin details mimir@mimir`: about **240 tokens always on** (the description in the skill
list) and about **3.7 thousand tokens when the skill fires** (`SKILL.md`, 10.5 KB). References are opened on demand:
the three complete scenes of the cookbook are 13 KB, each API module file 2 to 12 KB (65 KB for all thirteen; an
agent reads four to seven of them). A story sheet costs an agent about one thousand tokens to look at.

## `mimir new`

```
mimir new "<prompt>" [-o dir] [--once | --loop] [--fix n] [--edit scene] [--open] [--agent name] [--model id]
                     [--fast] [--effort level] [--size s] [--max-turns n] [--budget-usd x] [--system file]
                     [--resume id] [--timeout s]
```

### Write once (the default): the model answers with the scene, the engine reviews it

The model is used as a function from text to text. It gets ONE page (`skills/mimir/ONCE.md`, with the reference of
`explain()`, `docs/topics/quick.md`, in its place: about 3.5 thousand tokens) and the request, and answers with the
module in a code block. `mimir new` writes the file, builds it and reviews it here (`mimir review`: the linter, an
account of every step, composition findings). Only when the review finds something is the model asked again, with
its module and the review as the correction (`--fix n`, default 1; `--fix 0` never asks). No tools and no agent
loop, so any model that answers in text can write.

- The file is named from the request (`how does a lever work` -> `lever.scene.js`) and never overwrites one that
  exists (`lever-2.scene.js`). `--edit <scene>` changes that file and keeps what it was in the run directory.
- The best version seen is what stays on disk: a correction that makes things worse is not kept.
- In a scene made by `explain()` the stage owns size and place, so `mimir review` prints SMALL, TOP-HEAVY, LOPSIDED
  and CAPTION there as `NOTE` lines, not as findings to send back: the author wrote no position to change.
- The result line says `mode: "once"`, `turns` = calls of the model, `calls` = what each cost and what its review
  found, and `looked: false` with a note: nobody looked at the frames. `--loop` is the agent that looks.
- Nobody asked for a mode and no model here answers in text: the agent loop runs instead, and the log says so.

| writer | how it is called | status |
|---|---|---|
| `command` | `MIMIR_WRITER_COMMAND` or `"agent": { "writer": "…" }`: the page and the request on stdin, the answer on stdout; placeholders `{system}` `{prompt}` `{model}` `{effort}` | tested with a stand-in (`tests/e2e/once.test.ts`) |
| `claude` | `claude -p --system-prompt <page> --tools "" --output-format json`, the request on stdin | tested: the numbers below |
| `codex` | `codex exec --json --sandbox read-only -`, the page and the request on stdin | untested |

Measured with `mimir bench` (the six prompts of `bench/small-concepts.txt`) and `mimir new` on four harder
requests, one run each, on a machine that was also running other work:

| | calls | tokens | seconds | cost | ready | first review clean |
|---|---|---|---|---|---|---|
| full loop (the audit's baseline, three prompts) | 20 | 732k | 104 | $0.279 | 3 of 3 | 2 of 3 |
| lean loop (`--loop`, six runs) | 4.2 | 49k | 30 | $0.055 | 6 of 6 | 3 of 6 |
| write once, the adapter's default model, six prompts | 1.0 | 8.3k | 13 | $0.014 | 6 of 6 | 6 of 6 |
| write once, `--fast`, the same six | 1.0 | 8.8k | 13 | $0.001 | 6 of 6 | 6 of 6 |
| write once: a Geneva drive, a four-stroke engine, a job queue with retries, gradient descent | 1 each | 7.8k to 13.5k | 12 to 60 | $0.006 to $0.063 | 4 of 4 | 4 of 4 |

What those numbers do not say:

- They are the last of four rounds on one day. The first round ended 11 of 12 ready and 8 of 12 in one call; every
  second call and the one failure were traced to something the engine now takes in its stride instead of reporting
  (`tests/unit/quick/absorb.test.ts` and `machine.test.ts` hold each case: a comparison of one slot, a part in no
  joint, a housing nobody declared, parts of one machine that touch, a formula term named loosely, chart marks that
  met, a free line in a drawing of one's own). Sixteen of sixteen is what the same requests give after that; a new
  kind of request can still find a new mistake.
- `ready` means the engine's review is clean, not that somebody looked. Of these runs the sheets of the Geneva
  drive and of the lever on the cheapest model were opened: the Geneva drive reads well; the cheapest model's lever
  is correct but a plain, still drawing (and in an earlier round it tilted the wrong way).
- A rotary engine is now a worked example on the page, so it no longer counts as a request the page has not seen.
- `--effort low|medium|high` (`MIMIR_EFFORT`, `agent.effort`) is handed to agents that have such a switch. The
  claude writer defaults to `low`: on the same request the agent's own default spent more tokens deliberating than
  writing (54 s and $0.078 against 34 s and $0.046) for a scene that looked no better.

### The lean loop (`--loop`) and what a small concept costs

`mimir new --loop` gives the agent ONE always-on page, `skills/mimir/PAGE.md`, instead of its own base prompt + the skill +
reference reads. The page holds the loop, `explain()` (shown only when this engine exports it), the minimum of the
full API, a pattern -> block table and the rules; everything else stays behind `mimir docs <name>`. An adapter that
can replaces the agent's system prompt with the page and passes the minimum tool set; an agent without a system
prompt flag gets the page in front of the request. `tests/unit/cli/lean.test.ts` fails when the page names something
the engine does not declare. `--full` (or naming instructions with `--system` / `MIMIR_GEN_SYSTEM` / the config)
keeps the full loop through the skill described below.

The loop of a small concept: write the scene and run `mimir review <scene> --sheet` in one message -> open the
sheet once -> fix everything reported and seen in ONE edit + `mimir review` -> again only if there are errors ->
stop. No storyboard file; no cue sheets or filmstrips unless the request is about motion (medium and large only).

| `--size` | steps | scene lines | fix rounds | turn limit | chosen when the prompt has |
|---|---|---|---|---|---|
| small | 4 to 5 | 40 to 70 | 2 | 30 | at most 14 words |
| medium | 5 to 7 | 60 to 110 | 3 | 50 | at most 45 words |
| large | 6 to 10 | 90 to 180 | 4 | 90 | more |

(`MIMIR_SIZE`; the table is `CONCEPT_SIZES` in `src/cli/agents/limits.ts`; `--max-turns` still wins.)

Measured with `mimir bench` on three prompts (binary search, TCP three-way handshake, lever), two passes of one run
each, the claude adapter with its default model, a machine under load (4 to 9). Five runs ended `ready`, one
`ready-with-flags` (a CAPTION finding it did not clear); every extra call was a fix round for a composition finding:

| | API calls | tokens | output | seconds | cost | first review clean |
|---|---|---|---|---|---|---|
| full loop (the audit's baseline) | 20 | 732k | 10.2k | 104 | $0.279 | 2 of 3 |
| lean launch, first pass | 3.7 | 42k | 2.7k | 28 | $0.049 | 2 of 3 |
| lean launch, second pass | 4.7 | 57k | 3.2k | 33 | $0.062 | 1 of 3 |
| lean launch, the six runs | 4.2 | 49k | 3.0k | 30 | $0.055 | 3 of 6 |

The first call carries 7.4k tokens (the page, four tool definitions, the request) where the full loop carried 27.5k
before a line was written. By looking at the sheets: the lever is on par (the plank tilts); binary search and TCP
are correct but plainer and smaller than the full loop's (thin cells in the upper half, a grey sequence diagram).
Three runs are not a distribution: run the bench before you quote these.

`--fast` picks the adapter's cheapest model (claude: its `haiku` alias; a `--model` wins; an adapter that names none
refuses). Measured with `mimir bench --fast` on binary search and the lever, one run each: $0.010 per scene instead
of $0.049, but 71 s instead of 28 s and 109k tokens instead of 42k (the small model writes 13k output tokens, most
of it thinking, and needed 5 calls). What it loses, by looking at the two sheets: thin outlines instead of filled
shapes, a model that fills about 40% of the frame, and in binary search a typed "23 found, done" where the default
model shows it. Both were correct and legible. Two runs: run the bench before you rely on it.

Every run keeps its record under `<workdir>/.mimir/new/runs/<session>/`: `stream.ndjson` (the agent's raw output)
and `usage.json` (the result line). The result line adds `verdict` (`ready`, `ready-with-flags`, `ready-unseen`,
`failed`), `usage` (`api_calls`, `input`, `cache_write`, `cache_read`, `output`, `thinking`, `total`),
`first_review_clean`, `flags`, `scene_lines`, `size`, `lean`, `run_dir`. `ready-unseen` means the check is clean and
the agent never opened a picture: nobody has looked at it.

The claude adapter refuses a working directory under a dot-directory before it starts (Claude Code will not write
there; a run used to spend $0.10 finding out). `MIMIR_ALLOW_DOT_DIR=1` skips the refusal.

`mimir bench [--prompts file] [--only word] [--model m] [--runs n] [--fast] [--full] [-o dir] [--json]` runs each
prompt of `bench/small-concepts.txt` through `mimir new`, one at a time, and prints one table. It spends real money
(about $0.05 per small prompt on the default model). Open the sheets it lists: the table does not say how they look.

Changed defaults, for programs: `mimir shot` and `mimir examples` print compact text when piped (the directory once,
file names, no sha256); pass `--json` for the manifest records. A cue sheet is `cues.png` and a filmstrip `film.png`,
so a later run of another kind no longer deletes them.

### Adapters

An adapter knows how to find one agent (`detect`), how to start it (`command`) and how to read its output
(`parseEvent`). They live in `src/cli/agents/`; adding one is a file with those three functions and a line in
`src/cli/agents/index.ts`.

| Adapter | Agent | Status | Default model |
|---|---|---|---|
| `command` | any command line: `MIMIR_AGENT_COMMAND`, or `agent.command` in `mimir.config.json` | tested with stand-in agents (the test suite) | none |
| `claude` | Claude Code, headless (`claude -p`, stream-json) | **tested end to end**: the numbers below | `sonnet` (the agent's own alias for its mid-size model) |
| `codex` | Codex CLI, non-interactive (`codex exec --json`) | **untested**: written from `codex exec --help` and the documented event stream; no generation was run with it | none (Codex's own configuration) |

**Which adapter runs:** `--agent`, else `MIMIR_AGENT`, else `agent.name` in `mimir.config.json`, else the first
one that is present, tried in the order of the table. `command` is first because it is present only when you
configured a command; the installed command lines follow by name. No vendor is preferred and none is required.

### Settings

Every value: the flag, else the environment, else `mimir.config.json`, else the adapter's default.

| Flag | Environment | `mimir.config.json` (`agent.…`) | Default |
|---|---|---|---|
| `--agent` | `MIMIR_AGENT` | `name` | first one found |
| `--model` | `MIMIR_MODEL` | `model` | the adapter's (table above) |
| `--max-turns` | `MIMIR_MAX_TURNS` | `maxTurns` | 90 |
| `--budget-usd` | `MIMIR_BUDGET_USD` | `budgetUsd` | 3 |
| `--timeout` | | `timeout` | 1800 s |
| `--system` | `MIMIR_GEN_SYSTEM` | `instructions` | `skills/mimir/gen-system.md` |
| | `MIMIR_AGENT_COMMAND` | `command` | |
| | | `args` (extra arguments for the agent) | |
| | `MIMIR_AGENT_BIN` (the agent's executable), `MIMIR_PLUGIN_DIR`, `MIMIR_SESSION`, `MIMIR_CONFIG` | | |

`mimir.config.json` is looked for in the working directory and above it. A field it does not know is an error.

```json
{ "agent": { "name": "command", "command": "my-agent --workdir {workdir} --model {model}", "model": "my-model", "maxTurns": 40 } }
```

### Output

NDJSON on stdout, one object a line, and every line carries the `stage` the run is in:

| stage | The run is … |
|---|---|
| `storyboard` | reading the reference, planning, writing the storyboard (until the scene file is first written) |
| `writing` | writing the scene for the first time |
| `checking` | running `mimir check` (or `mimir query`) |
| `looking` | running `mimir shot`, opening a rendered picture |
| `fixing` | changing the scene after a check or a look |
| `ready` / `failed` | the verdict, on the last line only, decided by this command and never by the agent |

```
{"event":"start","stage":"storyboard","agent":"claude","model":"…","session":"…","workdir":"/abs/gears"}
{"event":"tool","stage":"storyboard","name":"Read","summary":"…/references/cookbook.md"}
{"event":"stage","stage":"writing","round":1,"elapsed_ms":54162}
{"event":"stage","stage":"checking","round":1,"elapsed_ms":54332}
{"event":"check","stage":"checking","round":1,"ok":false,"errors":1,"warnings":0}
{"event":"stage","stage":"fixing","round":2,"elapsed_ms":59183}
{"event":"look","stage":"looking","round":1,"image":"/abs/gears/.mimir/shots/<name>/sheet.png"}
{"event":"result","stage":"ready","ok":true,"scene":"/abs/gears/<name>.scene.js","check":{"ok":true,"errors":0,"warnings":0},
 "sheet":"/abs/gears/.mimir/new/<name>/sheet.png","storyboard":"/abs/gears/<name>.storyboard.md","looked":true,
 "rounds":{"check":5,"look":2,"edit":12},"shots":{"sheet":2,"cues":0,"fine":0,"frames":0},"agent":"claude","model":"…",
 "session":"…","turns":32,"cost_usd":0.297,"duration_ms":102244,"wall_ms":105831,"denials":0,"error":null,"notes":[]}
```

Other events: `text` (what the agent said, one line), `denied` (a tool call it was refused), `log`.
`--text` prints the same as a log for a person. Exit 0 = ready, 1 = failed, 2 = usage or setup (nothing started).

### What the result means

Nothing the agent says about its own work is taken on trust.

- `ok` is true only when the agent ended by itself, a scene file exists, and **`mimir check`, run by this command
  on the final file, finds no error**. A run that hit its turn limit or its timeout is `failed` even when the scene
  it left is clean: the result still carries the scene, the check and the sheet, so you can decide.
- `check` is this command's own check. `sheet` is a contact sheet this command rendered from the final file.
- `looked` says whether the agent opened a picture rendered after its last change to the scene: `true`, `false`,
  or `null` when its tool calls cannot be seen (the `command` adapter). `false` adds a note; it does not fail the run.
- `rounds` and `shots` count what the agent did: checks, pictures opened, edits of the scene; story sheets, cue
  sheets, filmstrips.
- `cost_usd` is what the agent reports (Claude Code: an estimate at list prices; on a subscription nothing is
  billed per token). `null` when the agent reports none.
- `error` is the first thing that went wrong; `notes` are things worth knowing that are not failures.

### The headless recipe for Claude Code

`claude -p "<prompt>" --plugin-dir <mimir> --setting-sources "" --strict-mcp-config --permission-mode acceptEdits
--allowedTools "Skill(mimir:mimir)" "Bash(mimir *)" "Read(/<mimir>/skills/mimir/**)" --tools Read,Write,Edit,Bash,Skill
--append-system-prompt-file <mimir>/skills/mimir/gen-system.md --model sonnet --max-turns 90 --max-budget-usd 3
--session-id <uuid> --output-format stream-json --verbose`, with stdin closed and `<mimir>/bin` first on PATH.

`--setting-sources ""` and `--strict-mcp-config` keep the user's own settings, hooks, plugins and MCP servers out
of the run. The three `--allowedTools` rules are the three traps of a run in which nobody can approve anything:

1. a skill that declares `allowed-tools` needs approval to launch: `Skill(mimir:mimir)`;
2. the skill's own grant lasts one turn, so a resumed conversation needs `Bash(mimir *)` at session level;
3. a skill's reference files are outside the working directory: `Read(/<skill dir>/**)`.

Seen in the measured runs: with these rules the agent read every reference file and ran every `mimir` command
without a refusal. The only refusals were the agent's own attempts to write files through the shell (`cat > file`,
`sed -i`), three in the first two runs; the instructions now say to use the file tools, and the later runs had none.

### The `command` adapter: any agent

The template is split like a shell command line (quotes, no expansion) and run in the working directory.

| It gets | |
|---|---|
| placeholders | `{prompt}` the request as typed · `{request}` instructions + where the skill is + the request · `{system}` the instructions file · `{skill}` the skill folder · `{workdir}` · `{model}` · `{max_turns}` · `{budget_usd}` |
| environment | `MIMIR_PROMPT` `MIMIR_REQUEST` `MIMIR_SYSTEM_FILE` `MIMIR_SKILL_DIR` `MIMIR_WORKDIR` `MIMIR_MODEL` `MIMIR_MAX_TURNS` `MIMIR_BUDGET_USD` (`MIMIR_RESUME`), and `mimir` first on PATH |
| stdin | `{request}` |

It must write `<name>.scene.js` into the working directory and end its output with `RESULT <scene path>`. It may
print progress as JSON lines (`{"event":"tool","name":"…","summary":"…"}`, `{"event":"text","text":"…"}`,
`{"event":"stage","stage":"checking"}`); anything else is kept as a log line. When it reports no stage, the stage
moves when the scene file appears or changes on disk. `looked` is `null`: unknown, never yes.

### The `codex` adapter: untested

`codex exec --json --skip-git-repo-check --color never --cd <workdir> --sandbox workspace-write
--config sandbox_workspace_write.network_access=true [--model id] "<instructions + skill path + request>"`.

Known before the first run: Codex has no system-prompt flag, so the instructions travel in the prompt.
`mimir check` and `mimir shot` start a local server and a headless browser, so the sandbox is given network access;
if the browser still cannot start inside the sandbox, add `"args": ["--sandbox", "danger-full-access"]` to the
`agent` section of `mimir.config.json`. Codex reports tokens, not dollars (`cost_usd` is null, the budget is not
enforced) and one turn per run (`--max-turns` counts its finished commands, file changes and messages).

## `mimir serve`: the home API

```
mimir serve [dir] [--port n] [--open] [--jobs n]      →  {"url":"http://127.0.0.1:<port>/","port":…,"root":"…"}
```

| Request | Answer |
|---|---|
| `GET /api/scenes` | `{ root, scenes: [{ name, title, summary, path, url, modified }] }`, newest first; titles are read from the files, no scene is run |
| `GET /api/agents` | `{ agents: [{ name, status, describe, available, why }], default }` |
| `POST /api/new` `{ prompt, agent?, model?, maxTurns?, budgetUsd?, timeout?, dir? }` | `202 { id, dir, status, events_url }`; the generation runs in `<dir>/<words-of-the-prompt>`. `429` while `--jobs` generations run (default 1); `503` with the reason when no agent is found |
| `GET /api/new`, `GET /api/new/<id>` | status, stage and, when done, the result line |
| `GET /api/new/<id>/events` | server-sent events: `id: <n>`, `event: <start\|stage\|tool\|check\|look\|text\|result…>`, `data: <the NDJSON line>`; replayed from the start (or after `Last-Event-ID`), closed after `result` |
| `GET /api/new/<id>/sheet` | the contact sheet of the result (PNG) |
| `DELETE /api/new/<id>` | stops it; its result says so |
| `GET /api/sheet?scene=<path>` | a contact sheet of any scene of the directory (PNG), kept until the file changes |
| `GET /api/export?scene=<path>[&format=html\|mp4\|md]` | the scene as one file, as a download |
| `GET /scene/<path>`, `GET /events`, everything else | the files of the directory, live-reload events, the viewer |

Safe by default: it listens on `127.0.0.1` only, on a free port unless `--port` names one; a request whose `Host`
is not the server's own address is refused (403); a request that changes something must be JSON and same-origin
(another site cannot start an agent); dot files and dot directories are never served; no path leaves the directory.

## Measured: two prompts that are in no example

`mimir new "<prompt>" -o <dir> --agent claude` with the defaults (model alias `sonnet`, which resolved to
`claude-sonnet-5-5`; 60 turns until text E, then 90; $3). Two runs at a time. Each row is one run; the skill text changed between
versions and the scenes were never edited by hand. Cost is the agent's own estimate.

| Skill text | Prompt | Verdict | Turns | Wall | Cost | `mimir check` runs (errors on the first) | Pictures opened | What the sheet shows (judged by a person from the pixels) |
|---|---|---|---|---|---|---|---|---|
| A: first draft | bicycle gears | ready | 23 | 103 s | $0.28 | 2 (0) | 2 | Weak. Grey bars standing for sprockets seen from above, a line for the chain; the ratio as a typed sum. Not recognisable as a bicycle |
| A | binary search | ready | 28 | 79 s | $0.27 | 3 (3) | 3 | Decent. The real algorithm on a row of cells; the pay-off ("a million numbers: 20 looks") is a line of text; a title before the row; the lower half of the frame is empty |
| B: + which API for which subject, "concrete first" sharpened, "the payoff is a picture", files through file tools | bicycle gears | ready | 32 | 106 s | $0.30 | 5 (1) | 2 | Good. Two real drivetrains in 3D (`kit.gear` + `belt`), small sprocket against big, wheel turns counted from the belts. But it never shows the chain moving from one sprocket to the other |
| B | binary search | ready | 41 | 120 s | $0.35 | 5 (6) | 3 | Decent. Adds a one-by-one scan beside the halving, on one param; composition still hangs from the top edge |
| C: + "is the asked-for how shown happening", centre the subject, cue sheet and filmstrip are part of done | bicycle gears | ready | 28 | 139 s | $0.35 | 4 (2) | 3 (sheet, cues, 3 filmstrips) | Mixed. Shows the shift itself (cable, cage, chain stepping across), but as a flat schematic of bars again |
| C | binary search | ready | 34 | 128 s | $0.34 | 4 (3) | 4 | Decent. Two targets, a bar comparison for a million numbers; guide rings land on two cells that are not the point |
| D: + "a schematic beside the model, never instead of it" | both, 3 runs each | failed ×6 | 21 – 61 | | | | | See below: five were cut off by the machine, one ran out of turns on a 3D cassette it could not get clean (6 errors left) |
| E: final text: + fix every finding before checking again, 90 turns | bicycle gears | ready | 35 | 203 s of agent time (1213 s wall, machine busy) | $0.37 | 5 (2) | 3 + cue sheet + filmstrip | Decent. A 3D drivetrain (stacked chainrings, a three-sprocket cassette, the chain); the chain moves to the small sprocket and back, the ratio is read from the belt. The derailleur is a plain block, and the caption runs over it; four steps; no wheel |
| E | binary search | ready | 39 | 183 s of agent time (1191 s wall) | $0.40 | 4 (0) | 4 + cue sheet + 2 filmstrips | Decent. Row of cells, three targets, bars "binary 4 / one by one 15" at the end; a heading before the row; content still hangs from the top of the frame |
| E | both, 2 more runs each | failed ×4 (timeout, machine) | 12 – 51 | | | | | Two of them had a clean check by this command and had looked at sheet, cue sheet and filmstrip when the 1800 s ran out |

Runs A to C were made on a quiet machine: 23 to 41 turns, 79 to 139 s, $0.27 to $0.35, and every one ended `ready`
with a clean check by this command. During runs D and E the machine was shared with other test suites (load average
30 to 150) and froze for minutes at a time: both runs of a pair stop at the same moments, and wall time says nothing
about the agent (the two E runs that completed were given `--timeout 5400`; the agent's own time was about 200 s). Those runs show the failure paths working on a real agent: `failed` with "the agent was stopped
after 1800 s (--timeout)", with "the agent was stopped at its turn limit (60 …)", and once with "the scene could
not be checked: timed out … connecting to the browser" (the driver now tries its own check a second time).

What the agents got wrong, and what was changed in the skill because of it:

1. **Files written through the shell** (`cat > file <<EOF`, `sed -i`): refused in a headless run, three wasted
   turns in runs A. The instructions now say to use the file tools; no refusal since.
2. **A machine drawn as boxes** (bicycle, runs A and C): the agent never opened the mechanism reference and built
   bars and lines. Fixed for B by the table "the subject is … / build it from … / read …" at the top of the skill and
   by "rectangles that stand for parts are an abstraction". It came back in C when the skill pushed "show the change
   happening" and the cookbook still said a flat mechanism is "often clearer in 2D"; that sentence is gone.
3. **The pay-off as text** (both prompts, runs A): a ratio or "20 looks" typed on the stage. Fixed by the rule "the
   payoff is a picture" and a `Payoff:` line in the storyboard; every later run has a side-by-side comparison.
4. **Answering a neighbouring question** (bicycle, run B: why gears matter, not how the change happens). The
   storyboard now has "Answered by showing:" and the look list starts with that question.
5. **Stopping after one look**, and never opening the cue sheet or a filmstrip (runs A and B). They are now part of
   the definition of done; `shots` in the result line shows whether it happened.
6. **Too many turns** (runs D: 43 to 61): one edit per turn, and an over-ambitious 3D build patched instead of
   simplified. The text now says to fix every finding of a check before checking again and to simplify after four
   rounds; the default limit went from 60 to 90 turns.
7. **Still weak in the final text:** compositions hang from the top of the frame (a rule of `mimir check` would fix
   this better than words); positions are still often literal coordinates; which design the agent picks varies from
   run to run for the same prompt (a flat schematic in one run, a 3D model in the next).

## Not verified

- A generation with the `codex` adapter, and Codex using the installed skill in a session.
- The plugin installed into a real user configuration, `/reload-plugins`, and whether the skill fires on its own
  from its description when many other skills compete (the measured runs invoke it by instruction).
- A plugin installed from a git marketplace: the checkout is then copied without `node_modules` or `dist`, and the
  launcher needs bun. Local installs read the checkout in place and are not affected.
- Linux and Windows; any model other than the one in the table; `--resume`.
