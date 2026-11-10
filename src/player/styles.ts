// What the real player adds to the lifted stylesheet (css.ts): the slot the engine's stage is mounted in, the ink
// canvas, the loading line, the transport's switches for captions and loop, the note's live values, the parts of the
// erratum that come from real diagnostics. Same rules of the house: no surface, transform and opacity only.
export const EXTRA_CSS = `
/* the faces are the engine's embedded Computer Modern (KaTeX Main), the ones the stage itself is set in: TeX's word
   space needs no tightening there, and under 18 px a hair of tracking does what the 8 pt master did in the design */
.m-root { --word-space: 0em; }
.m-app { letter-spacing: .012em; }
.m-cap, .m-read, .m-card, .h-q, .h-ask, .g-title { letter-spacing: 0; }

/* the stage: the engine letterboxes its frame inside this slot; the player only places and carries it */
.m-slot { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: var(--stage); }
.m-root.nocur, .m-root.nocur * { cursor: none !important; }
.m-app > .m-ink { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: var(--z-ink); }
.m-dim { transition: none; }

/* loading: a rule that sweeps, a word under it. No spinner. */
.m-load { z-index: var(--z-caption); pointer-events: none; text-align: center; color: var(--faint); font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); }
.m-load .bar { position: relative; width: 160px; height: 1px; margin: 0 auto 12px; background: var(--rule); overflow: hidden; }
.m-load .bar i { position: absolute; left: 0; top: 0; width: 100%; height: 1px; background: var(--chalk); transform-origin: 0 50%; will-change: transform; }

/* transport: captions, voice and loop are the same switch; where there is no room the name gives way to a glyph */
.m-transport-r .m-switch { margin-left: 22px; }
.m-transport-r .m-switch .vi { display: none; flex: none; }
.m-transport-r.tight .m-switch .nm { display: none; }
.m-transport-r.tight .m-switch .vi, .m-transport-r.tight #m-voice .vi { display: block; }
.m-transport-r.tight .m-switch { margin-left: 14px; gap: 6px; }
.m-transport-r.tight .m-switch .st { min-width: 18px; }
.m-where b { color: var(--faint); margin-right: .5em; font-variant-numeric: lining-nums tabular-nums; }

/* the line of time: its hover preview stands on the stage's black so it masks the names under it */
.nl-tip b { color: var(--dust); margin-right: .45em; }

/* read: a note sets as an aside, with whatever inline marks it has */
.m-read .aside p + p { margin-top: 6px; }
.m-read .aside code, .m-note code { font: 400 .9em/1 var(--ff-mono); word-spacing: 0; letter-spacing: 0; }
.m-read .aside strong { font-weight: 700; }
.m-read .st[aria-current="step"] { opacity: 1; }
.m-read .st .lk { cursor: pointer; }
.m-read .nar + .nar::before { content: " "; }

/* the note: live values without a trace are two figures on one line of names */
.m-note .vals.plain { grid-template-rows: auto auto; }
.m-note .vals.plain .val { grid-row: span 2; }
.m-note .vals.one { grid-template-columns: 1fr; }
.m-note .wait { position: relative; height: 1px; margin-top: 12px; background: var(--rule); overflow: hidden; }
.m-note .wait i { position: absolute; left: 0; top: 0; width: 100%; height: 1px; background: var(--chalk); transform-origin: 0 50%; will-change: transform; }
.m-note .took { font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--faint); font-variant-numeric: lining-nums tabular-nums; margin-top: 4px; }
.m-note .fail { color: var(--chalk); margin-top: 8px; }

/* a unit of one sign (°, %) stands against its figure */
.m-param .vl i.tight { margin-left: .04em; }
/* explore: a choice that heads its own row, a parameter that is a choice */
.gv-g .lbl { display: block; color: var(--dust); margin: 2px 0 0; }
.gv-g .pick { padding: 0 0 10px; }
.m-tabs { z-index: var(--z-chrome); }
.m-hint.m-abs { z-index: var(--z-caption); text-align: center; pointer-events: none; white-space: normal; font: 400 var(--fs-body)/var(--lh-body) var(--ff-text); color: var(--dust); text-wrap: balance; letter-spacing: 0; }

/* erratum: what the engine's diagnostic says, its fixes as a choice */
.m-erratum .code { font: 400 var(--fs-code)/var(--lh-ui) var(--ff-mono); color: var(--faint); word-spacing: 0; letter-spacing: 0; margin-right: .6em; }
.m-erratum .fixes { display: grid; justify-items: start; gap: 0; margin: 14px 0 0; }
.m-erratum .fixes > span { color: var(--dust); }
.m-erratum .cand code { white-space: pre-wrap; overflow-wrap: anywhere; }
.m-erratum .nav { display: inline-flex; gap: 14px; margin-left: 14px; }
.m-erratum pre .cur .ln { color: var(--wrong); }
.m-palette .roll > div, .m-share .roll > div, .m-erratum .roll > div { will-change: transform; }

/* home: a frame the agent sent is a picture, not a canvas; a build that failed says so in the erratum's red */
.g-frame img, .h-plate img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; object-fit: contain; }
.g-fail { margin-top: 14px; color: var(--chalk); }
.g-fail b { color: var(--wrong); margin-right: .5em; }
.g-meta .m-word { margin-left: 0; }
.h-none { color: var(--faint); font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); }

/* the home page takes the window: there is no stage under it */
.m-home .m-slot, .m-home .m-top, .m-home .nl, .m-home .m-transport, .m-home .m-load, .m-home .m-ink { display: none; }

@media (max-width: 760px) {
  .m-transport-r .m-switch.wide-only { display: none; }
  .m-transport-r .m-switch { margin-left: 8px; }
}
@media (max-width: 430px) {
  .m-transport-r .m-switch .nm { display: none; }
  .m-transport-r .m-switch .vi { display: block; }
}
`
