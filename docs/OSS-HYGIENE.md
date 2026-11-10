# Open-source hygiene (binding for every contributor and every builder)

Mimir will be published as an open-source project. Anyone must be able to clone it on their own machine, with their
own AI, and get the same results. The owner's rule, verbatim: "You cannot just hardcode things in this."

## Nothing hardcoded
1. **No machine.** No absolute paths, usernames, home directories or hostnames in source, tests, examples or shipped
   docs. Paths come from `import.meta`, the working directory, environment variables or the OS temp dir. No fixed
   ports (pick a free one; `--port` overrides). Runs on macOS, Linux and Windows unless a file says why not.
2. **No external tool assumed.** Chrome / Chromium / Edge / Brave are discovered per platform, `MIMIR_CHROME`
   overrides, and a missing browser is a clear message with the fix. ffmpeg is optional (`MIMIR_FFMPEG` or PATH).
   Fonts are embedded, never assumed installed.
3. **No AI vendor.** The engine never calls a model. Generation goes through an adapter chosen by flag / env /
   config (`mimir new --agent <name>`); model names live only in adapter defaults that are documented and
   overridable; no keys in the repository; nothing phones home; exported files make zero network requests.
4. **No topic.** Engine code never special-cases a scene, an id, a title or a subject. Examples use only the public
   API. If an example needs something, the engine gets a general feature, not a branch.
5. **No magic number.** Every constant that shapes output (durations, sizes, colours, linter thresholds, sampling
   plans) is a named default in one place, documented, and overridable (per call, per scene, or in config).
6. **No faked result.** What a scene shows is computed: kinematics from the mechanism, counts from the simulation,
   curves from the function. Anything shown in the README or a gallery is reproducible with one documented command
   from files in the repository (`mimir export --mp4 examples/<name>.scene.js`).

## Repository
- Licence MIT. Every third-party asset or ported algorithm is listed in `THIRD_PARTY_NOTICES.md` with its licence
  (three.js MIT; KaTeX fonts OFL 1.1; rate functions and verb semantics ported from manim, MIT).
- No generated artefacts or media in git (`dist/`, frames, videos, `node_modules/`), with one exception: the short
  clips the README shows live in `docs/media/`, and each is rebuilt from a tracked scene with one command
  (`mimir export <scene> --mp4`). No personal data. No secrets.
- Internal process notes (research, reviews, plans, design competition, look-dev, hand-built prototypes) stay out of
  the published tree.
- `bun run hygiene` (scripts/hygiene.ts) enforces what can be checked mechanically and runs in CI with typecheck,
  tests and build.
- Public docs: README (what, quickstart, how the AI loop works, gallery), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
  CHANGELOG, issue and PR templates.
