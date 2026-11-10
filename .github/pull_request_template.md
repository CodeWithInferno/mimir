## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

<!-- The commands you ran and what they printed. Only what actually ran. -->

- [ ] `bun scripts/build.ts` (sizes within budget)
- [ ] `bun run typecheck`
- [ ] `bun test` (say if the end-to-end suites were skipped for lack of a browser)
- [ ] `bun run hygiene`
- [ ] For anything visible: I rendered it (`bin/mimir shot ... --sheet`) and looked at the frames
- [ ] For anything that affects pixels: the same time shot twice in different orders gives the same sha256

Not verified:

<!-- Platforms, browsers or cases you could not try. "Nothing" is a fine answer if it is true. -->

## Checklist

- [ ] No absolute path, user name, host name, fixed port without fallback, or assumption about an installed tool or font
- [ ] No vendor, model name or key; nothing that makes a network request
- [ ] No special case for one scene, id, title or topic in engine code
- [ ] Every new constant that shapes output is a named, documented, overridable default
- [ ] Nothing shown is typed in by hand: numbers and motion are computed
- [ ] New public names have an entry in the module's `api.d.ts`; `docs/` and `CHANGELOG.md` are updated
- [ ] New third-party code, fonts or ported algorithms are listed in `THIRD_PARTY_NOTICES.md` with their licence
- [ ] No generated files or media added (`dist/`, frames, videos); generated sources are current
