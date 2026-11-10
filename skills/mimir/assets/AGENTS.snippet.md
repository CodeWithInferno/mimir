## Explainers, diagrams and simulations: use Mimir

When asked how something works and to show it (an animated explainer, a diagram with moving parts, a 3D model, a
small simulation), use the `mimir` skill: read its `SKILL.md` first and follow its loop. In short:

1. write the storyboard, then `<name>.scene.js`
2. `mimir check <name>.scene.js --text` until the last line starts with `OK`
3. `mimir shot <name>.scene.js --sheet`, open the PNG it names, fix what looks wrong, check again
4. `mimir open <name>.scene.js` (viewer) or `mimir export <name>.scene.js -o <name>.html`

Never report a scene as finished without a clean check and frames you looked at. The API: `mimir docs` lists every
name, `mimir docs <name>` prints one with an example, `mimir examples` lists working scenes.
