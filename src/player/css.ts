// The player's stylesheet: tokens and components. Lifted from the judged design (UI design specification 3 and 7)
// and scoped to the player's own root, so nothing here can reach into the stage. Rules of the house are in the
// comment at the head of UI_CSS. Additions that the design's prototype did not need are in styles.ts.
export const TOKENS_CSS = `/* Mimir player tokens.
   The chrome is typeset on the film: the stage's own greys are the only text colours,
   a hue enters chrome only as a reference to a part, and nothing has a surface at rest.
   Colour, type, space, radius, layer and motion tokens as CSS custom properties, on the player's root. */


.m-root {
  color-scheme: dark;

  /* ---- colour: the stage and its chalk (3Blue1Brown's own grey ramp) */
  --stage:  #000000;   /* canvas and page; there is no seam */
  --chalk:  #DDDDDD;   /* primary text, lit words, the value            15.5 : 1 on stage */
  --dust:   #BBBBBB;   /* resting text, controls not chosen             10.9 : 1 */
  --faint:  #888888;   /* tertiary text (16 px and up), and the edge of a control: an axis, a line to write on   5.9 : 1 */
  --rule:   #444444;   /* a tick inside an axis, a keycap's box: never the only edge of a control */
  --hair:   #222222;   /* plate edges, the quietest line */
  --white:  #FFFFFF;   /* the dart, the focus ring, the thing being pressed, the row you picked */
  --sheet:  #161616;   /* the only fill: a sheet on a phone, where there is no free stage */

  /* ---- colour: scene palette. In chrome a hue is only ever a reference to a part. */
  --blue: #58C4DD; --teal: #5CD0B3; --green: #83C167; --yellow: #FFFF00; --gold: #F0AC5F;
  --red: #FC6255; --maroon: #C55F73; --purple: #9A72AC;
  --maroon-text: #EC92AB; --purple-text: #B189C6;   /* AA variants when a word must carry these hues */
  --wrong: var(--red);      /* the struck token of an erratum, a fault found in a render */
  --right: var(--green);    /* the correction */

  /* ---- type: one family, Computer Modern, in two optical sizes */
  --ff-text:    var(--m-face);
  --ff-caption: var(--m-face);
  --ff-mono:    var(--m-mono);
  --ff-key:     system-ui, -apple-system, "Segoe UI", sans-serif;                                                  /* key glyphs   */

  /* size / line-height pairs (px). Nothing in Computer Modern is set under 15 px. */
  --fs-display:  44px; --lh-display:  52px;   /* the home question, a chapter card          CM Text    */
  --fs-title:    28px; --lh-title:    34px;   /* title of the explanation in read mode     CM Text    */
  --fs-prompt:   26px; --lh-prompt:   38px;   /* the typed prompt                          CM Text    */
  --fs-caption:  24px; --lh-caption:  34px;   /* subtitle in video mode                    CM Text    */
  --fs-head:     22px; --lh-head:     30px;   /* chapter heading, headword of a note       CM Text    */
  --fs-body:     19px; --lh-body:     29px;   /* read column, answers                      CM Text    */
  --fs-ui:       17px; --lh-ui:       24px;   /* rows, controls, labels on the stage       CM Caption */
  --fs-small:    16px; --lh-small:    22px;   /* facts, times, tick names                  CM Caption */
  --fs-micro:    15px; --lh-micro:    20px;   /* chalk or dust only, never faint           CM Caption */
  --fs-code:     15px; --lh-code:     24px;   /* code frame of an erratum                  CM Mono    */
  --fs-key:      11px;                         /* keycaps                                   system     */
  --word-space:  -0.05em;                      /* TeX's word space is tuned for justified print */

  /* ---- space: 4 px grid */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 72px;
  --page: 1560px;                  /* the chrome never spreads wider than this, so its columns stay tied to the model; the stage is always full-bleed */
  --mx: calc(max(clamp(20px, 5vw, 72px), (100vw - var(--page)) / 2) + max(var(--sal), var(--sar)));    /* page margin */
  --gutter: 30px;                  /* what hangs: numerals, the now-dot */
  --col: 440px;                    /* measure of the read column (about 50 characters at 19 px) */
  --note: 320px;                   /* width of the one column at the right: note, answer, share, givens */
  --first: 96px;                   /* first baseline of every column: note, answer, share, palette, index, givens */
  --clear: 56px;                   /* nothing typeset comes nearer than this to the figure or its labels */
  --row: 32px;                     /* a row: switch, choice, part, command (30 in the palette) */
  --touch: 44px;                   /* least hit target under a coarse pointer */

  /* safe areas: a notch, a home indicator */
  --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px);
  --sab: env(safe-area-inset-bottom, 0px); --sal: env(safe-area-inset-left, 0px);

  /* ---- radii: type has none because it has no box */
  --r-plate: 3px;                  /* a render, a thumbnail */
  --r-key: 4px;                    /* a keycap */
  --r-sheet: 14px;                 /* top corners of a phone sheet */

  /* ---- lines */
  --line: 1px;                     /* rule, leader, tick */
  --line-lit: 2px;                 /* the lit interval of a number line */
  --dot: 11px;                     /* the closed dot: the value, now, on */
  --dot-small: 7px;                /* the same dot beside a word */

  /* ---- elevation: none. Layers are ordered, not lifted. */
  --z-stage: 0; --z-ink: 1; --z-caption: 2; --z-chrome: 3; --z-note: 4; --z-veil: 5; --z-layer: 6; --z-travel: 7; --z-focus: 8;

  /* ---- motion (wall clock). Story-time motion is never a CSS transition: see motion.js. */
  --d-fast: 80ms;      /* press, label exit */
  --d-quick: 130ms;    /* hover release, small fades, a switch */
  --d-wake: 150ms;     /* chrome appears */
  --d-base: 200ms;     /* a layer opens: palette 180, share 200, erratum 220; any close */
  --d-swap: 220ms;     /* one note becomes another */
  --d-note: 380ms;     /* a note opens */
  --d-sleep: 400ms;    /* chrome leaves */
  --d-explore: 420ms;  /* watch to explore */
  --d-cross: 480ms;    /* read to explore and back */
  --d-read: 640ms;     /* watch to read: the signature move */
  --e-smooth: cubic-bezier(.5, 0, .5, 1);     /* manim's smooth, within 1 percent */
  --e-enter:  cubic-bezier(.05, .7, .1, 1);   /* arriving: translate only, never opacity */
  --e-exit:   cubic-bezier(.3, 0, .8, .15);   /* leaving, at 60 percent of the enter time */
  --e-move:   cubic-bezier(.2, 0, 0, 1);      /* from one place on screen to another */
}

/* a large display: the type and the columns grow by an eighth, so a 1920 window is not a 1440 comp with wider gaps */
@media (min-width: 1680px) {
  .m-root {
    --fs-display: 50px; --lh-display: 58px;
    --fs-title: 32px; --lh-title: 38px;
    --fs-prompt: 29px; --lh-prompt: 42px;
    --fs-caption: 27px; --lh-caption: 38px;
    --fs-head: 25px; --lh-head: 34px;
    --fs-body: 21px; --lh-body: 32px;
    --fs-ui: 19px; --lh-ui: 27px;
    --fs-small: 18px; --lh-small: 25px;
    --fs-micro: 17px; --lh-micro: 23px;
    --fs-code: 17px; --lh-code: 27px;
    --fs-key: 12px;
    --col: 500px; --note: 360px; --first: 108px; --gutter: 34px; --row: 36px;
  }
}

@media (max-width: 760px) {
  .m-root {
    --fs-display: 30px; --lh-display: 36px;
    --fs-title: 24px; --lh-title: 30px;
    --fs-prompt: 21px; --lh-prompt: 30px;
    --fs-caption: 19px; --lh-caption: 27px;
    --fs-head: 20px; --lh-head: 28px;
    --fs-body: 18px; --lh-body: 27px;
    --gutter: 0px; --first: 88px;
  }
}
`

export const UI_CSS = `/* Mimir player styles. Needs the tokens.
   Rules of the house:
   - nothing has a surface at rest: text, rules and dots are set straight on the stage's black;
   - a rule is an axis or a line to write on; a closed dot is the value, now, on; an open dot is off, not yet;
   - colour appears only where a word names a part of the scene;
   - anything that moves is positioned by transform and shown by opacity (see motion.js);
   - hover styles live under (hover: hover); every control has a pressed state; under a coarse pointer
     (.m-coarse) every control is at least 44 px without its type growing. */

:where(.m-app), :where(.m-app) *, :where(.m-app) *::before, :where(.m-app) *::after { box-sizing: border-box; }
.m-root { position: fixed; inset: 0; overflow: hidden; margin: 0; background: var(--stage); color: var(--chalk); }
.m-app {
  font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); word-spacing: var(--word-space);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;
  font-kerning: normal; font-variant-ligatures: common-ligatures; font-variant-numeric: lining-nums; font-synthesis: none;
  -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%;
}
:where(.m-app) button, :where(.m-app) input, :where(.m-app) textarea { font: inherit; color: inherit; background: none; border: 0; border-radius: 0; padding: 0; margin: 0; word-spacing: inherit; letter-spacing: inherit; text-align: inherit; }
:where(.m-app) button { cursor: pointer; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
:where(.m-app) a { color: inherit; text-decoration: none; }
:where(.m-app) p, :where(.m-app) h1, :where(.m-app) h2, :where(.m-app) h3, :where(.m-app) ol, :where(.m-app) ul, :where(.m-app) li, :where(.m-app) figure { margin: 0; padding: 0; font-weight: 400; list-style: none; }
:where(.m-app) b { font-weight: 400; }
:where(.m-app) i, :where(.m-app) em { font-style: italic; }
:where(.m-app) ::selection { background: rgba(255, 255, 255, .24); }
:where(.m-app) :focus { outline: none; }
:where(.m-app) :focus-visible { outline: 2px solid var(--white); outline-offset: 3px; border-radius: 2px; }
:where(.m-app) input:focus-visible, :where(.m-app) textarea:focus-visible { outline: none; }          /* a field shows focus on its own line: see .m-line */
:where(.m-app) [hidden] { display: none !important; }
:where(.m-app) [inert] { pointer-events: none; }
.m-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ---------------------------------------------------------------- voices */
.m-text  { font-family: var(--ff-text); }
.m-chalk { color: var(--chalk); } .m-dust { color: var(--dust); } .m-faint { color: var(--faint); }
.m-it    { font-style: italic; }
.m-num   { font-variant-numeric: lining-nums tabular-nums; }           /* Computer Modern's digits are all one width */
.m-code  { font: 400 var(--fs-code)/var(--lh-code) var(--ff-mono); word-spacing: 0; }

/* a key, printed on the control it belongs to */
.m-key {
  display: inline-block; min-width: 19px; height: 18px; padding: 0 5px; margin-left: 7px; vertical-align: 1px; flex: none;
  font: 500 var(--fs-key)/16px var(--ff-key); word-spacing: 0; letter-spacing: 0; text-align: center; color: var(--dust);
  border: 1px solid var(--rule); border-radius: var(--r-key);
}
.m-coarse .m-key { display: none; }

/* ---------------------------------------------------------------- the stage */
.m-app { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.m-app > * { pointer-events: auto; }
.m-stage, .m-stage2, .m-ink, .m-snap { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.m-stage { cursor: default; touch-action: none; will-change: opacity; }
.m-stage.nocur { cursor: none !important; }
.m-stage2, .m-ink, .m-snap { pointer-events: none; will-change: opacity; }
.m-abs { position: absolute; left: 0; top: 0; will-change: transform, opacity; }
.m-travel { z-index: var(--z-travel); pointer-events: none; }
.m-travel > * { position: absolute; left: 0; top: 0; transform-origin: 0 0; white-space: nowrap; will-change: transform, opacity; }
.m-travel .ln { font: 400 var(--fs-caption)/var(--lh-caption) var(--ff-text); }
.m-travel .hwc { font: 700 var(--fs-head)/var(--lh-head) var(--ff-text); color: var(--chalk); }

/* ---------------------------------------------------------------- words that act: buttons set as text */
.m-word { position: relative; color: var(--dust); padding: 6px 0; white-space: nowrap; }
.m-word[aria-expanded="true"] { color: var(--chalk); }
.m-word:active { color: var(--white); }
.m-word[disabled], .m-word[aria-disabled="true"] { color: var(--faint); cursor: default; }

/* a choice among words: the closed dot sits before the chosen one and goes to the next when it changes */
.m-opt { position: relative; display: inline-flex; align-items: baseline; gap: 14px; white-space: nowrap; }
.m-opt > button { position: relative; color: var(--dust); padding: 6px 0 6px 15px; }
.m-opt > button[aria-checked="true"], .m-opt > button[aria-selected="true"] { color: var(--chalk); }
.m-opt > button:active { color: var(--white); }
.m-opt > .m-opt-dot { position: absolute; left: 0; top: 0; width: var(--dot-small); height: var(--dot-small); border-radius: 50%; background: var(--chalk); pointer-events: none; will-change: transform; }

/* a switch, one way everywhere: its name, the state in a word, then the shortest line there is with an open or a closed dot */
.m-switch { position: relative; display: inline-flex; align-items: center; gap: 10px; color: var(--dust); padding: 4px 0; min-height: var(--row); white-space: nowrap; text-align: left; }
.m-switch .nm { min-width: 0; }
.m-switch .st { flex: none; font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--faint); min-width: 24px; text-align: right; }
.m-switch .st::after { content: "off"; }
.m-switch[aria-checked="true"] .st::after { content: "on"; }
.m-switch .tr { position: relative; width: 30px; height: 12px; flex: none; }
.m-switch .tr::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 1px; margin-top: -.5px; background: var(--faint); }
.m-switch .tr::after {
  content: ""; position: absolute; left: 0; top: 50%; width: var(--dot); height: var(--dot); margin-top: calc(var(--dot) / -2); border-radius: 50%;
  background: var(--stage); box-shadow: inset 0 0 0 1.5px var(--dust);
  transition: transform var(--d-quick) var(--e-move), background-color var(--d-quick) linear, box-shadow var(--d-quick) linear;
}
.m-switch[aria-checked="true"] .tr::after { transform: translateX(19px); background: var(--chalk); box-shadow: inset 0 0 0 1.5px var(--chalk); }
.m-switch[aria-checked="true"] { color: var(--chalk); }
.m-switch:active { color: var(--white); }
.m-switch.rw { display: flex; width: 100%; white-space: normal; }       /* in a column: the name may wrap, the control never shrinks */
.m-switch.rw .nm { flex: 1 1 auto; }
.m-switch .hintw { font-style: italic; font-size: var(--fs-small); color: var(--faint); margin-left: .35em; white-space: nowrap; }
.m-switch.tight .hintw { display: none; }                               /* no room: the hint goes before the control shrinks */

/* a line to write on */
.m-line { position: relative; display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--faint); padding: 5px 0 7px; }
.m-line input { flex: 1; min-width: 0; color: var(--chalk); caret-color: var(--white); }
.m-line input::placeholder { color: var(--faint); opacity: 1; }
.m-line:focus-within { border-bottom-color: var(--chalk); box-shadow: 0 1px 0 var(--chalk); }     /* the line doubles: that is the focus mark */
.m-line .m-key { margin-left: 0; align-self: center; }

/* ---------------------------------------------------------------- top row */
.m-top { position: absolute; left: 0; right: 0; top: var(--sat); height: 60px; display: flex; align-items: center; gap: 22px; padding: 0 var(--mx); z-index: var(--z-chrome); pointer-events: none; }
.m-top > * { pointer-events: auto; }
.m-top[inert] > * { pointer-events: none; }
.m-mark { font: 400 20px/28px var(--ff-text); color: var(--chalk); padding: 4px 0; flex: none; }
.m-ttl { font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--dust); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.m-top .sp { flex: 1; }
.m-top .m-opt { margin-right: 22px; flex: none; }
.m-top .m-word { flex: none; }
.m-more { display: none; flex: none; width: 44px; height: 44px; margin-right: -13px; color: var(--dust); }
.m-more svg { display: block; margin: auto; }
.m-more:active { color: var(--white); }

/* ---------------------------------------------------------------- caption zone: the narrator's sentence */
.m-cap { z-index: var(--z-caption); text-align: center; font: 400 var(--fs-caption)/var(--lh-caption) var(--ff-text); color: var(--chalk); pointer-events: none; }
.m-cap p { position: absolute; left: 0; right: 0; top: 0; white-space: nowrap; will-change: transform, opacity; }        /* lines are broken by captions.js, at a reader's pauses */
.m-cap p.wrap { white-space: normal; overflow-wrap: anywhere; }                                                       /* a word wider than the zone: the only time the browser breaks a line */
.m-cap p > * { pointer-events: auto; }
.nw { white-space: nowrap; }
.w { display: inline-block; will-change: opacity; }                         /* one word: lit by opacity, as it is said */
.lk { display: inline; color: var(--c, var(--chalk)); cursor: pointer; }      /* a word that names a part, in the part's colour */
.lk .w { position: relative; }
.lk .w::after { content: ""; position: absolute; left: 0; right: 0; bottom: .12em; height: 1px; background: currentColor; transform: scaleX(var(--u, 0)); transform-origin: 0 50%; }
.lk .w.j::after { right: -.3em; }                                            /* joins the next word of the same name */
.lk:focus-visible .w::after, .lk.lit .w::after { transform: scaleX(1); }
.lk:focus-visible { outline-offset: 2px; }
.lk:active { color: var(--white); }
.m-cap .m-hint { white-space: normal; font: 400 var(--fs-body)/var(--lh-body) var(--ff-text); color: var(--dust); text-wrap: balance; }      /* what the lit part is: it wraps inside the free stage, under the model */
.m-hint b { color: var(--chalk); }

/* chapter card: the title, written on its own rule in the middle of the stage while the scene holds */
.m-cards { z-index: var(--z-caption); pointer-events: none; }
.m-card { position: absolute; left: 0; top: 0; display: flex; justify-content: center; align-items: center; pointer-events: none; font: 400 var(--fs-display)/var(--lh-display) var(--ff-text); color: var(--chalk); will-change: transform, opacity; }
.m-card .in { position: relative; display: block; padding: 0 6px 12px; text-align: center; text-wrap: balance; max-width: 100%; }
.m-card .n { color: var(--faint); margin-right: .5em; }
.m-card .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--faint); transform-origin: 0 50%; }

/* ---------------------------------------------------------------- the number line: time, crank angle, every parameter */
.nl { position: absolute; left: 0; top: 0; height: 44px; touch-action: none; cursor: pointer; z-index: var(--z-chrome); }
.nl:focus-visible { outline: none; }
.nl > * { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
.nl-axis { width: 100px; height: 1px; background: var(--faint); transform-origin: 0 50%; }
.nl-lit { width: 100px; height: var(--line-lit); background: var(--chalk); transform-origin: 0 50%; }
.nl-tick { width: 1px; height: 13px; background: var(--dust); transform-origin: 50% 0; }
.nl-tick.minor { background: var(--faint); }
.nl-dot { width: var(--dot); height: var(--dot); border-radius: 50%; background: var(--chalk); margin: -5.5px 0 0 -5.5px; }
.nl:focus-visible .nl-dot { box-shadow: 0 0 0 2px var(--stage), 0 0 0 4px var(--white); }      /* the focus ring goes on the dot, not round the band */
.nl-num, .nl-name { font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--dust); white-space: nowrap; }
.nl-num { color: var(--faint); font-variant-numeric: lining-nums tabular-nums; }
.nl-num.on, .nl-name.on { color: var(--chalk); }
.nl-deg { font: 400 var(--fs-micro)/var(--lh-micro) var(--ff-caption); color: var(--dust); white-space: nowrap; }
.nl-tip { font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--chalk); white-space: nowrap; background: var(--stage); padding: 0 8px; }
.nl-tip i { color: var(--dust); margin-left: .6em; font-style: normal; }
.nl-mark { width: 1px; height: 19px; background: var(--chalk); }
.nl-ghost { width: 9px; height: 9px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--chalk); margin: -4.5px 0 0 -4.5px; }   /* where a preview would land */

/* ---------------------------------------------------------------- transport */
.m-transport { z-index: var(--z-chrome); height: 36px; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.m-transport-r { left: auto; right: var(--mx); gap: 0; }
.m-ico { position: relative; flex: none; width: 34px; height: 34px; display: grid; place-items: center; color: var(--chalk); border-radius: 50%; }
.m-ico svg { display: block; }
.m-ico:active { transform: scale(.94); color: var(--white); }
.m-ico[aria-disabled="true"] { color: var(--faint); cursor: default; }
.m-ico[aria-disabled="true"]:active { transform: none; color: var(--faint); }
.m-clock { flex: none; margin-left: 12px; color: var(--chalk); font-variant-numeric: lining-nums tabular-nums; }
.m-clock i { font-style: normal; color: var(--faint); }
.m-transport.tight .m-clock .tot { display: none; }      /* no room for the step's name: the total time gives way first */
.m-where { flex: 0 1 auto; min-width: 0; margin-left: 18px; color: var(--dust); }
.m-where span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; will-change: transform, opacity; }
.m-speed { min-width: 34px; text-align: right; font-variant-numeric: lining-nums tabular-nums; }
#m-voice { margin-left: 24px; }                                    /* speed and voice are two controls, not one phrase */
#m-voice .vi { display: none; flex: none; }
#m-full { margin-left: 14px; margin-right: -9px; }
.m-theta { position: absolute; left: 44px; top: 6px; color: var(--chalk); font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.m-theta i { color: var(--dust); margin: 0 .3em 0 0; }
.m-theta span { color: var(--dust); margin-left: .5em; }

/* ---------------------------------------------------------------- read mode: the explanation as a typeset column */
.m-read { z-index: var(--z-chrome); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; font: 400 var(--fs-body)/var(--lh-body) var(--ff-text); color: var(--dust); overflow-wrap: anywhere; hyphens: auto; }
.m-read::-webkit-scrollbar { display: none; }
/* the column ends where the stage's number line begins, and lets a line go quietly instead of cutting it in half */
.m-read { -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 32px), transparent 100%); mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 32px), transparent 100%); }
.m-read.scrolled { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 var(--fade-top, 32px), #000 calc(100% - 32px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 var(--fade-top, 32px), #000 calc(100% - 32px), transparent 100%); }
.m-read .in { position: relative; padding: 0 0 46vh var(--gutter); }
.m-read h2 { font: 400 var(--fs-title)/var(--lh-title) var(--ff-text); color: var(--chalk); text-wrap: balance; }
.m-read .sub { font: italic 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--dust); margin: 6px 0 0; }
.m-read .ch { position: relative; display: flex; align-items: baseline; margin: 34px 0 6px; font: 400 var(--fs-head)/var(--lh-head) var(--ff-text); color: var(--chalk); width: 100%; text-align: left; }
.m-read .ch .n { position: absolute; left: calc(-1 * var(--gutter)); width: calc(var(--gutter) - 10px); text-align: right; color: var(--faint); }
.m-read .ch .t { min-width: 0; }
.m-read .ch .tm { flex: none; font: 400 var(--fs-small)/var(--lh-head) var(--ff-caption); color: var(--dust); font-variant-numeric: lining-nums tabular-nums; }
.m-read .ch:active { color: var(--white); }
.m-dots { flex: 1; align-self: stretch; margin: 0 9px 0 11px; min-width: 20px; opacity: .6; background: radial-gradient(circle, var(--faint) .85px, transparent 1.15px) 0 74% / 7px 5px repeat-x; }
.m-read .st { position: relative; margin: 0 0 10px; cursor: pointer; will-change: opacity; color: var(--chalk); }
.m-read .st .run { position: relative; font-weight: 700; color: var(--chalk); margin-right: .35em; }
.m-read .st .run:active { color: var(--white); }
.m-read .st .w { opacity: 1; }
.m-read .aside { margin: -2px 0 14px; font: 400 var(--fs-small)/24px var(--ff-caption); color: var(--chalk); }
.m-now { position: absolute; left: 6px; top: 0; width: var(--dot-small); height: var(--dot-small); border-radius: 50%; background: var(--chalk); will-change: transform; }
.m-back { position: absolute; z-index: var(--z-chrome); color: var(--chalk); font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); padding: 6px 0; }
.m-back:active { color: var(--white); }

/* a formula: variables italic, words in subscripts upright, a fraction whose bar sits on the math axis */
.m-eq { display: flex; align-items: center; gap: .42em; margin: 10px 0 4px 18px; font: italic 400 var(--fs-body)/1.3 var(--ff-text); color: var(--chalk); white-space: nowrap; }
.m-eq .op, .m-eq .num { font-style: normal; }
.m-eq .num { font-variant-numeric: lining-nums tabular-nums; }
.m-eq sub { font: normal 400 .7em/1 var(--ff-text); vertical-align: -.24em; margin-left: .06em; }
.m-frac { display: inline-flex; flex-direction: column; align-items: stretch; text-align: center; }
.m-frac > span { padding: 0 .16em; }
.m-frac .nu { padding-bottom: .26em; }
.m-frac .de { padding-top: .2em; border-top: 1px solid currentColor; }

/* ---------------------------------------------------------------- explore: parts index */
.m-index { z-index: var(--z-chrome); display: flex; flex-direction: column; }
.m-index .m-line { margin: 0 0 8px var(--gutter-idx, 96px); flex: none; }
.m-index .m-line svg { align-self: center; color: var(--faint); flex: none; }
.m-index .cnt { color: var(--faint); font-size: var(--fs-small); font-variant-numeric: lining-nums tabular-nums; }
.m-index .roll { flex: 1; min-height: 0; overflow: hidden; }
.m-index .roll > div { height: 100%; }
.m-index ol { height: 100%; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding-bottom: 12px; }
.m-index ol::-webkit-scrollbar { display: none; }
.m-index li { position: relative; padding-left: var(--gutter-idx, 96px); }
.m-index .grp { position: absolute; left: 0; top: 4px; width: calc(var(--gutter-idx, 96px) - 14px); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: italic 400 var(--fs-small)/var(--lh-ui) var(--ff-caption); color: var(--faint); }
/* a list that runs on below its box lets its last row go quietly (set by script only while there is more to scroll to) */
.m-runs-on { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 32px), transparent 100%); mask-image: linear-gradient(to bottom, #000 calc(100% - 32px), transparent 100%); }
.m-index li.gap { margin-top: 10px; }
.m-index .row { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: var(--row); padding: 4px 0; color: var(--dust); text-align: left; }
.m-index .row .sw { width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--dust)); flex: none; }
.m-index .row .lb { min-width: 0; }
.m-index .row b { color: var(--white); }                                    /* the letters a search matched */
.m-index .row.hot, .m-index .row:focus-visible { color: var(--chalk); }
.m-index .row:active { color: var(--white); }
.m-index .none { padding: 6px 0 0 var(--gutter-idx, 96px); color: var(--dust); }
.m-index.flat .grp { position: static; display: block; width: auto; text-align: left; padding: 4px 0 0; }      /* no gutter to hang in: the group name heads its rows */
.m-index .none button { color: var(--chalk); border-bottom: 1px solid var(--faint); }

/* ---------------------------------------------------------------- explore: what is given, and the view */
.m-given { z-index: var(--z-chrome); }
.m-given .roll { height: 100%; overflow: hidden; }
.m-given .gv { height: 100%; display: flex; flex-direction: column; }
.gv-p { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.gv-p::-webkit-scrollbar { display: none; }
.gv-v { flex: none; }
.m-given.tabs[data-tab="params"] .gv-v, .m-given.tabs[data-tab="view"] .gv-p { display: none; }
.m-given.tabs .gv-p { flex: 1 1 auto; }
.m-given.tabs .gv-v > .gv-g:first-child { margin-top: 0 !important; }
.gv-g + .gv-g, .gv-p:not(:empty) + .gv-v > .gv-g:first-child { margin-top: 20px; }
.gv-g > .gn { display: block; font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--faint); margin: 0 0 6px; }
.m-param { position: relative; padding: 0 0 14px; touch-action: pan-y; }
.m-param .hd { display: flex; align-items: baseline; gap: 12px; height: 26px; }
.m-param .nm { color: var(--dust); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-param .rs { position: relative; flex: none; font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--faint); visibility: hidden; }
.m-param.off .rs { visibility: visible; }                                    /* the value is not the default: one word puts it back */
.m-param .rs:active { color: var(--white); }
.m-param .vl { flex: none; margin-left: auto; font: 400 20px/26px var(--ff-text); color: var(--chalk); font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.m-param .vl i { font: 400 var(--fs-ui)/26px var(--ff-caption); color: var(--dust); margin-left: .25em; font-style: normal; }
.m-param .ln { position: relative; display: flex; align-items: center; gap: 12px; height: 24px; color: var(--faint); font: 400 var(--fs-small)/24px var(--ff-caption); font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.m-param .ln .lo { min-width: 22px; flex: none; } .m-param .ln .hi { min-width: 26px; text-align: right; flex: none; }
.m-param .tr { position: relative; flex: 1; height: 24px; cursor: ew-resize; touch-action: pan-y; }
.m-param .tr::before { content: ""; position: absolute; left: -6px; right: -6px; top: -10px; bottom: -10px; }      /* the track's hit box: 44 px tall */
.m-param .tr > i { position: absolute; left: 0; top: 50%; will-change: transform; pointer-events: none; }
.m-param .tr .ax { width: 100%; height: 1px; margin-top: -.5px; background: var(--faint); transform-origin: 0 50%; }
.m-param .tr .lt { width: 100%; height: var(--line-lit); margin-top: -1px; background: var(--chalk); transform-origin: 0 50%; }
.m-param .tr .c0, .m-param .tr .c1 { width: 1px; height: 9px; margin-top: -4.5px; background: var(--faint); }
.m-param .tr .c1 { left: auto; right: 0; }
.m-param .tr .df { width: 1px; height: 7px; margin-top: -9px; background: var(--dust); }                 /* a notch at the default */
.m-param .tr .dt { width: var(--dot); height: var(--dot); margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: var(--chalk); }
.m-param input[type=range] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; pointer-events: none; }   /* for arrows and assistive technology; the pointer drags the track itself */
.m-param input:focus-visible ~ .dt { box-shadow: 0 0 0 2px var(--stage), 0 0 0 4px var(--white); }
.gv-g .rw { display: flex; align-items: baseline; gap: 14px; min-height: var(--row); padding: 4px 0; width: 100%; }
.gv-g .rw .m-opt { gap: 12px; flex-wrap: wrap; row-gap: 0; }
.gv-g .m-opt.wide { display: flex; flex-wrap: wrap; gap: 0 12px; min-height: var(--row); align-items: center; }
.gv-g .m-opt > button { padding-top: 4px; padding-bottom: 4px; }

/* ---------------------------------------------------------------- the one column at the right: what you touched, what you asked */
.m-note { z-index: var(--z-note); display: flex; flex-direction: column; font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); }
.m-note .hw { flex: none; }
.m-note .bd { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.m-note .bd::-webkit-scrollbar { display: none; }
.m-note .grab, .m-note .hw.sh-only { display: none; }
.m-note .hw { display: flex; align-items: baseline; gap: 12px; }
.m-note .hw .clipw { min-width: 0; overflow: hidden; }
.m-note .hw b { display: block; font: 700 var(--fs-head)/var(--lh-head) var(--ff-text); color: var(--chalk); overflow-wrap: anywhere; text-wrap: balance; }
.m-note:focus-visible { outline: none; }
.m-note .hw code { flex: none; font: 400 var(--fs-code)/var(--lh-head) var(--ff-mono); color: var(--faint); word-spacing: 0; }
.m-note .hw .sp { flex: 1; }
.m-note .x { position: relative; flex: none; width: 30px; height: 30px; margin: 0 -8px 0 0; display: grid; place-items: center; color: var(--dust); align-self: flex-start; }
.m-note .x:active { color: var(--white); }
.m-note .def { margin: 4px 0 0; font: 400 var(--fs-body)/var(--lh-body) var(--ff-text); color: var(--chalk); text-wrap: pretty; }
.m-note .def.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.m-note .more { display: none; font-style: italic; color: var(--dust); padding: 2px 0; }
.m-note .more.on { display: inline-block; }
.m-note .vals { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto auto; gap: 0 22px; margin: 16px 0 0; }
.m-note .val { min-width: 0; display: grid; grid-row: span 3; grid-template-rows: subgrid; }      /* name, figure, trace: a name that wraps keeps the two figures on one line */
.m-note .val .k { color: var(--dust); font-size: var(--fs-small); line-height: var(--lh-small); }
.m-note .val .v { font: 400 var(--fs-head)/var(--lh-head) var(--ff-text); color: var(--chalk); font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.m-note .val .v i { font: 400 var(--fs-ui)/var(--lh-head) var(--ff-caption); color: var(--dust); font-style: normal; margin-left: .2em; }
.m-note .val .tr { position: relative; height: 34px; margin-top: 2px; overflow: hidden; }
.m-note .val .tr .clipw { position: absolute; inset: 0; overflow: hidden; }
.m-note .val svg { display: block; width: 100%; height: 34px; overflow: visible; }
.m-note .val path { fill: none; stroke: var(--dust); stroke-width: 1.25; vector-effect: non-scaling-stroke; }
.m-note .val path.zero { stroke: var(--rule); stroke-width: 1; }
.m-note .val .now { position: absolute; left: 0; top: 0; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: var(--chalk); will-change: transform; }
.m-note .m-line { margin-top: 16px; }
.m-note .sugg { margin-top: 8px; display: grid; justify-items: start; }
.m-note .sugg button { position: relative; text-align: left; padding: 3px 0; font-style: italic; color: var(--dust); }
.m-note .sugg button:active { color: var(--white); }
.m-note .q { font: italic 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--dust); text-wrap: balance; }
.m-note .a { margin: 8px 0 0; font: 400 var(--fs-body)/28px var(--ff-text); color: var(--chalk); text-wrap: pretty; }
.m-note .a .w { opacity: 1; }
.m-note .a .s { will-change: opacity; display: inline; }
.m-note .acts { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 22px; margin: 12px 0 2px; }
.m-note .cite { position: relative; color: var(--chalk); border-bottom: 1px solid var(--faint); padding: 2px 0; }
.m-note .cite:active { color: var(--white); }
.m-note .bd > .m-line:first-child, .m-note .bd > [style*="display: none"] + .m-line { margin-top: 0; }

/* on a phone there is no free stage beside the model: the note is a sheet that rises under it. The only fill in the product. */
.m-note.sheet { position: fixed; z-index: var(--z-note); display: flex; flex-direction: column; background: var(--sheet); border-radius: var(--r-sheet) var(--r-sheet) 0 0; padding: 0 var(--mx) calc(14px + var(--sab)); }
.m-note.sheet .grab { display: block; flex: none; width: 36px; height: 4px; border-radius: 2px; background: var(--rule); margin: 8px auto 0; }
.m-note.sheet .hw { flex: none; align-items: center; min-height: 48px; touch-action: none; }
.m-note.sheet .hw.sh-only { display: flex; }
.m-note.sheet .x { width: 44px; height: 44px; margin-right: -15px; align-self: center; }
.m-note.sheet .bd { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding-bottom: 6px; }
.m-note.sheet .bd::-webkit-scrollbar { display: none; }
.m-note.sheet .def { margin-top: 0; }

/* ---------------------------------------------------------------- layers that open over free stage: palette, share, erratum */
.m-layer { z-index: var(--z-layer); }
.m-layer .lh { display: none; }
.m-veil { position: fixed; inset: 0; z-index: var(--z-veil); background: var(--stage); opacity: 0; will-change: opacity; }
.m-palette .m-line { padding: 8px 0 10px; font: 400 var(--fs-head)/var(--lh-head) var(--ff-text); border-bottom-color: transparent; box-shadow: none; }
.m-palette .m-line:focus-within { border-bottom-color: transparent; box-shadow: none; }
.m-palette .pr { display: block; flex: none; height: 1px; margin-top: -1px; background: var(--chalk); transform-origin: 0 50%; }   /* the rule the list hangs from */
.m-palette .roll { overflow: hidden; }
.m-palette .roll > div { padding-top: 12px; }
.m-palette ol { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.m-palette ol::-webkit-scrollbar { display: none; }
.m-palette li { position: relative; display: flex; align-items: center; gap: 10px; height: calc(var(--row) - 2px); padding: 0 0 0 var(--gutter-pal, 150px); color: var(--dust); cursor: pointer; }
.m-palette li.gap { margin-top: 10px; }
.m-palette li.gh { height: 26px; align-items: flex-end; padding-left: 0; font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--faint); cursor: default; }
.m-palette li .grp { position: absolute; left: 0; width: calc(var(--gutter-pal, 150px) - 30px); text-align: right; font-style: italic; color: var(--faint); font-size: var(--fs-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-palette li .lb { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-palette li .lb b { color: var(--white); }
.m-palette li .stt { flex: none; font-style: italic; color: var(--faint); font-size: var(--fs-small); }
.m-palette li .m-key { margin-left: 0; }
.m-palette li::before { content: ""; position: absolute; left: calc(var(--gutter-pal, 150px) - 16px); top: 50%; width: var(--dot-small); height: var(--dot-small); margin-top: -3.5px; border-radius: 50%; opacity: 0; }
.m-palette li.gh::before { display: none; }
.m-palette li.cur::before { opacity: 1; box-shadow: inset 0 0 0 1.5px var(--dust); }                     /* where you are: an open dot */
.m-palette li[aria-selected="true"] { color: var(--white); }                                           /* what you picked: white, with the closed dot */
.m-palette li[aria-selected="true"]::before { opacity: 1; background: var(--white); box-shadow: none; }
.m-palette .ft { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 14px 0 0 var(--gutter-pal, 150px); color: var(--faint); font-size: var(--fs-small); line-height: var(--lh-small); }
.m-palette .ft .m-key { margin: 0 5px 0 0; }
.m-palette .none { padding: 6px 0 0 var(--gutter-pal, 150px); color: var(--dust); height: auto; cursor: default; }

.m-share .roll { overflow: hidden; }
.m-share .url { display: flex; align-items: baseline; gap: 14px; }
.m-share .url code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 var(--fs-code)/var(--lh-ui) var(--ff-mono); color: var(--dust); word-spacing: 0; }
.m-share .url button { position: relative; flex: none; color: var(--chalk); border-bottom: 1px solid var(--faint); }
.m-share .url button:active { color: var(--white); }
.m-share #m-shAt { margin: 4px 0 10px; }
.m-share .shrow { position: relative; display: grid; grid-template-columns: 1fr auto; column-gap: 14px; width: 100%; text-align: left; padding: 8px 0; color: var(--dust); }
.m-share .shrow .t { font: 400 var(--fs-body)/26px var(--ff-text); color: var(--chalk); }
.m-share .shrow .c { grid-column: 1; font-size: var(--fs-small); line-height: var(--lh-small); }
.m-share .shrow .f { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-size: var(--fs-small); font-style: italic; color: var(--faint); font-variant-numeric: lining-nums tabular-nums; white-space: nowrap; }
.m-share .shrow:focus-visible .t, .m-share .shrow:active .t { color: var(--white); }
.m-share .shrow.done .f { color: var(--chalk); font-style: normal; }

.m-erratum { font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); }
.m-erratum .bar { height: 2px; background: var(--wrong); transform-origin: 0 50%; margin-bottom: 14px; }
.m-erratum .roll { overflow: hidden; }
.m-erratum .loc { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; color: var(--dust); }
.m-erratum .loc code { font: 400 var(--fs-code)/var(--lh-ui) var(--ff-mono); color: var(--dust); border-bottom: 1px solid var(--faint); word-spacing: 0; }
.m-erratum h3 { margin: 10px 0 4px; font: 700 var(--fs-head)/var(--lh-head) var(--ff-text); color: var(--chalk); }
.m-erratum h3 code { font: 400 .86em/var(--lh-head) var(--ff-mono); word-spacing: 0; }
.m-erratum .what { font: 400 var(--fs-body)/var(--lh-body) var(--ff-text); color: var(--dust); text-wrap: pretty; }
.m-erratum pre { margin: 16px 0 6px; font: 400 var(--fs-code)/var(--lh-code) var(--ff-mono); color: var(--faint); word-spacing: 0; white-space: pre; overflow-x: auto; scrollbar-width: none; }
.m-erratum pre::-webkit-scrollbar { display: none; }
.m-erratum pre .ln { display: inline-block; width: 2.2em; margin-right: 1.4em; text-align: right; color: var(--faint); }
.m-erratum pre .cur { color: var(--chalk); }
.m-erratum pre .bad { position: relative; color: var(--wrong); }
.m-erratum pre .bad::after { content: ""; position: absolute; left: -1px; right: -1px; top: 54%; height: 1.5px; background: var(--wrong); transform: scaleX(var(--strike, 1)); transform-origin: 0 50%; }
.m-erratum pre .fix { color: var(--right); }
.m-erratum .dym { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 4px 18px; margin: 14px 0 0; }
.m-erratum .dym > span { color: var(--dust); padding-top: 3px; }
.m-erratum .cand { display: grid; text-align: left; padding: 3px 0 3px 15px; position: relative; color: var(--dust); }
.m-erratum .cand code { font: 400 var(--fs-small)/var(--lh-small) var(--ff-mono); color: var(--chalk); word-spacing: 0; }
.m-erratum .cand code u { text-decoration: none; color: var(--right); border-bottom: 1px solid var(--right); }
.m-erratum .cand small { font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--dust); }
.m-erratum .cand::before { content: ""; position: absolute; left: 0; top: 12px; width: var(--dot-small); height: var(--dot-small); border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--faint); }
.m-erratum .cand[aria-pressed="true"]::before { background: var(--chalk); box-shadow: none; }
.m-erratum .cand:active code { color: var(--white); }
.m-erratum .acts { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 24px; margin: 18px 0 0; }
.m-erratum .acts .m-word.pri { color: var(--chalk); }
.m-erratum .acts .m-word:active { color: var(--white); }
.m-erratum .say { margin-top: 8px; min-height: var(--lh-small); font-style: italic; color: var(--dust); font-size: var(--fs-small); }

/* a layer on a phone: the whole screen, on the stage's own black, with one header row and a Close */
.m-layer.full { position: fixed; display: flex; flex-direction: column; left: 0; top: 0; width: 100% !important; height: 100%; padding: calc(4px + var(--sat)) var(--mx) calc(10px + var(--sab)); }
.m-layer.full .lh { display: flex; flex: none; align-items: center; height: 52px; }
.m-layer.full .lh b { font: 400 20px/28px var(--ff-text); color: var(--chalk); }
.m-layer.full .lh .sp { flex: 1; }
.m-layer.full .lh .m-word { color: var(--chalk); }
.m-layer.full .roll { flex: 1 1 auto; min-height: 0; }
.m-layer.full .roll > div { height: 100%; display: flex; flex-direction: column; }
.m-palette.full .m-line { flex: none; font-size: 20px; }
.m-palette.full ol { flex: 1 1 auto; min-height: 0; max-height: none !important; }
.m-palette.full .ft { display: none; }
.m-palette.full li { padding-left: 16px; }
.m-palette.full li::before { left: 0; }
.m-palette.full .none { padding-left: 0; }
.m-erratum.full .roll > div { overflow-y: auto; }

/* ---------------------------------------------------------------- home: the question */
.h-page { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; }
.h-wrap { position: relative; min-height: 100%; padding: var(--sat) var(--mx) calc(56px + var(--sab)); }
.h-top { height: 60px; display: flex; align-items: center; gap: 22px; }
.h-top .sp { flex: 1; }
.h-q { font: 400 var(--fs-display)/var(--lh-display) var(--ff-text); color: var(--chalk); margin: 56px 0 0; text-wrap: balance; }
.h-ask { margin: 26px 0 0; }
.h-ask .m-line { padding: 6px 0 14px; border-bottom-color: var(--dust); align-items: flex-start; }
.h-ask textarea { flex: 1; display: block; width: 100%; resize: none; overflow: hidden; height: var(--lh-prompt); max-height: calc(6 * var(--lh-prompt)); font: 400 var(--fs-prompt)/var(--lh-prompt) var(--ff-text); color: var(--chalk); caret-color: var(--white); overflow-wrap: anywhere; }
.h-ask textarea.tall { overflow-y: auto; }                                  /* past six lines the field scrolls instead of growing */
.h-ask textarea::placeholder { color: var(--faint); opacity: 1; }
/* an empty field that is ready to be typed in shows it: a 2 px caret at the start of the line */
.h-ask .caret { position: absolute; left: 0; top: 10px; width: 2px; height: calc(var(--lh-prompt) - 8px); background: var(--white); opacity: 0; pointer-events: none; }
.h-ask .m-line.ready .caret { opacity: 1; animation: h-blink 1.1s steps(1) infinite; }
.h-ask .m-line.ready textarea { caret-color: transparent; }
@keyframes h-blink { 50% { opacity: 0; } }
.h-opts { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 20px; margin: 12px 0 0; }
.h-opts .m-opt { flex-wrap: wrap; row-gap: 0; }
.h-go { position: relative; display: inline-flex; align-items: center; color: var(--faint); padding: 6px 0; margin-left: auto; }
.h-go.ready { color: var(--chalk); }
.h-go.ready:active { color: var(--white); }
.h-stopped { margin: 8px 0 0; font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--dust); }
.h-stopped button { font-style: normal; color: var(--chalk); border-bottom: 1px solid var(--faint); margin-left: .5em; }
.h-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); gap: 0 76px; margin: 58px 0 0; align-items: start; }
.h-ex li { position: relative; padding-left: 104px; }
.h-ex .dom { position: absolute; left: 0; top: 5px; width: 84px; font: italic 400 var(--fs-small)/26px var(--ff-caption); color: var(--faint); }
.h-ex button { position: relative; display: block; width: 100%; text-align: left; padding: 5px 0 7px; font: 400 var(--fs-body)/26px var(--ff-text); color: var(--dust); text-wrap: pretty; }
.h-ex button:focus-visible { color: var(--chalk); }
.h-ex button:active { color: var(--white); }
.h-ex li.gap { margin-top: 8px; }
/* recent models: plates wide enough to read, a title that always takes two lines so every fact sits on one baseline */
.h-plates { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0 20px; }
.h-plate { display: grid; grid-row: span 3; grid-template-rows: subgrid; text-align: left; min-width: 0; margin-bottom: 28px; }      /* plate, title, fact: the title's row is as tall as the tallest title beside it */
.h-plate .pl { position: relative; display: block; aspect-ratio: 16 / 10; border-radius: var(--r-plate); box-shadow: 0 0 0 1px var(--hair); background: var(--stage); overflow: hidden; }
.h-plate canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.h-plate canvas.tall { left: 50%; top: 8px; height: calc(100% - 16px); width: auto; aspect-ratio: 1 / 2; transform: translateX(-50%); }      /* a tall subject is fitted whole, not cropped through */
.h-plate:focus-visible .pl, .h-plate:active .pl { box-shadow: 0 0 0 1px var(--faint); }
.h-plate b { display: block; font: 400 var(--fs-ui)/22px var(--ff-caption); color: var(--chalk); margin: 9px 0 0; text-wrap: balance; }
.h-plate span.mt { display: block; font: 400 var(--fs-micro)/var(--lh-micro) var(--ff-caption); color: var(--dust); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------------------------------------------------------------- home: generating */
.h-view, .g-view { will-change: opacity; }
.g-view { position: absolute; left: var(--mx); right: var(--mx); top: calc(60px + var(--sat)); bottom: 0; display: flex; flex-direction: column; }
.g-title { flex: none; margin-top: 36px; min-height: var(--lh-prompt); transform-origin: 0 0; font: 400 var(--fs-prompt)/var(--lh-prompt) var(--ff-text); color: var(--chalk); text-wrap: balance; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.g-status { flex: none; display: none; margin: 10px 0 0; color: var(--chalk); }
.g-status i { font-style: normal; color: var(--dust); margin-left: .6em; }
.g-grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 440px) minmax(0, 1fr); gap: 0 78px; margin-top: 40px; align-items: start; }
.g-left { padding-left: 30px; max-height: 100%; overflow-y: auto; scrollbar-width: none; padding-bottom: 48px; }
.g-left::-webkit-scrollbar { display: none; }
.g-plan { margin-top: 30px; }
.g-right { min-width: 0; padding-bottom: 48px; }
.g-stage { position: relative; padding-left: 0; margin: 0 0 12px; }
.g-stage .hd { position: relative; display: flex; align-items: baseline; font: 400 var(--fs-body)/26px var(--ff-text); color: var(--dust); }
.g-stage .hd .tm { font: 400 var(--fs-small)/26px var(--ff-caption); font-variant-numeric: lining-nums tabular-nums; color: var(--dust); }
.g-stage .fact { font: italic 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--dust); min-height: var(--lh-small); }
.g-stage .mk { position: absolute; left: -30px; top: 5px; width: 16px; height: 16px; }
.g-stage .mk > * { position: absolute; inset: 0; will-change: transform, opacity; }
.g-stage .mk .o { margin: 4.5px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--faint); }          /* not yet */
.g-stage .mk .d { margin: 4.5px; border-radius: 50%; background: var(--chalk); }                              /* now */
.g-stage .mk .c { overflow: hidden; }                                                                         /* done */
.g-stage .mk .c > span, .g-stage .mk .c svg { display: block; }
.g-stage.on .hd, .g-stage.done .hd { color: var(--chalk); }
.g-plan li { position: relative; margin: 0 0 8px; font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--chalk); }
.g-plan .n { position: absolute; left: -30px; width: 20px; text-align: right; color: var(--faint); }
.g-plan i { display: block; color: var(--dust); font-size: var(--fs-small); line-height: var(--lh-small); }
.g-frame { position: relative; border-radius: var(--r-plate); box-shadow: 0 0 0 1px var(--hair); background: var(--stage); overflow: hidden; }
.g-frame canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.g-frame .clipw { position: absolute; inset: 0; overflow: hidden; }
.g-frame .clipw > div { position: absolute; inset: 0; }
.g-frame .scan { position: absolute; left: 0; top: 0; width: 1px; height: 100%; background: var(--chalk); will-change: transform, opacity; }
.g-frame .no { position: absolute; left: 0; right: 0; top: 50%; margin-top: -11px; text-align: center; font: 400 var(--fs-small)/22px var(--ff-caption); color: var(--faint); font-variant-numeric: lining-nums tabular-nums; }     /* a frame not rendered yet says which it will be */
/* the frame the agent is looking at: as large as the window allows, and never so tall that the strip under it leaves the screen */
.g-frame.big { width: 100%; aspect-ratio: 16 / 9; max-height: max(180px, calc(100dvh - 460px)); }
#m-gInk { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.g-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 10px; min-height: var(--lh-ui); font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--dust); }
.g-cap b { color: var(--chalk); }
.g-cap i { color: var(--faint); font-size: var(--fs-small); }
.g-say { margin-top: 12px; min-height: var(--lh-ui); font: 400 var(--fs-ui)/var(--lh-ui) var(--ff-caption); color: var(--dust); text-wrap: pretty; }
.g-say b { color: var(--wrong); margin-right: .45em; }       /* where the frame is too small to carry the finding, the sentence leads with it */
/* the strip: one plate per step, cropped to its subject, grouped under its chapter. It scrolls sideways when the steps outrun the width. */
.g-strip { display: flex; gap: 16px; margin-top: 18px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; padding: 1px; }
.g-strip::-webkit-scrollbar { display: none; }
.g-strip.more { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent 100%); mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent 100%); }      /* there are more frames to the right */
.g-strip .grp { flex: none; min-width: 0; }
.g-strip .pl { display: flex; gap: 6px; }
.g-strip .g-frame { flex: none; width: var(--plate, 88px); height: var(--plate-h, 104px); }
.g-strip .g-frame.at { box-shadow: 0 0 0 1px var(--dust); }
.g-strip .nm { display: block; margin-top: 7px; max-width: calc(var(--n) * var(--plate, 88px) + (var(--n) - 1) * 6px); font: 400 var(--fs-small)/var(--lh-small) var(--ff-caption); color: var(--dust); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.g-strip .nm .n { color: var(--faint); margin-right: .5em; }
.g-strip .nm.on { color: var(--chalk); }
.g-meta { display: flex; align-items: baseline; gap: 22px; white-space: nowrap; }

/* ---------------------------------------------------------------- hover: only where there is a pointer that can */
@media (hover: hover) {
  .m-word:hover, .m-opt > button:hover, .m-switch:hover { color: var(--chalk); }
  .m-word[disabled]:hover, .m-word[aria-disabled="true"]:hover { color: var(--faint); }
  .m-ico:hover, .m-more:hover, .m-note .x:hover { color: var(--white); }
  .m-ico[aria-disabled="true"]:hover { color: var(--faint); }
  .lk:hover .w::after { transform: scaleX(1); }
  .m-index .row:hover, .m-note .sugg button:hover, .m-read .st:hover, .h-ex button:hover, .m-param .rs:hover, .m-note .more:hover { color: var(--chalk); }
  .m-note .cite:hover, .m-share .url button:hover, .m-index .none button:hover, .h-stopped button:hover { border-bottom-color: var(--chalk); }
  .m-share .shrow:hover .t, .h-go.ready:hover { color: var(--white); }
  .h-plate:hover .pl { box-shadow: 0 0 0 1px var(--faint); }
  .m-erratum .cand:hover code { color: var(--white); }
}

/* ---------------------------------------------------------------- a coarse pointer: 44 px targets, the type does not grow */
.m-coarse .m-word, .m-coarse .m-opt > button, .m-coarse .m-switch, .m-coarse .m-index .row, .m-coarse .gv-g .rw,
.m-coarse .m-note .sugg button, .m-coarse .m-note .cite, .m-coarse .h-go, .m-coarse .m-back { min-height: var(--touch); }
.m-coarse .m-word, .m-coarse .m-opt > button, .m-coarse .h-go { display: inline-flex; align-items: center; }
.m-coarse .m-note .sugg button, .m-coarse .m-note .cite { display: flex; align-items: center; }
.m-coarse .m-word { min-width: var(--touch); justify-content: center; }
.m-coarse .m-ico { width: var(--touch); height: var(--touch); }
.m-coarse .m-transport { gap: 8px; height: var(--touch); }
.m-coarse .m-palette li { height: var(--touch); }
.m-coarse .m-palette li.gh { height: 30px; }
.m-coarse .m-palette li.gap { margin-top: 4px; }
.m-coarse .m-note .x { width: var(--touch); height: var(--touch); margin-right: -15px; }
.m-coarse .m-share .shrow { padding: 10px 0; }
.m-coarse .m-share .url button { min-height: var(--touch); display: inline-flex; align-items: center; border-bottom: 0; text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 4px; }
.m-coarse .m-erratum .cand { min-height: var(--touch); align-content: center; }
.m-coarse .m-erratum .cand::before { top: 50%; margin-top: -11px; }
.m-coarse .m-line { padding: 0; }                                         /* a field's own height is its target: the padding moves from the line into the input */
.m-coarse .m-line input { padding: 10px 0 12px; min-height: var(--touch); }
.m-coarse .h-ask .m-line { padding: 0; }
.m-coarse .h-ask textarea { padding: 6px 0 14px; }
.m-coarse .m-mark { display: inline-flex; align-items: center; min-height: var(--touch); }
.m-coarse .m-opt > button { min-width: var(--touch); }
.m-coarse .m-param .rs { padding: 12px 6px; margin: -12px -6px; }
/* inline targets keep their place in the line and take their 44 px from a hit area laid over them */
.m-coarse .lk::before, .m-coarse .m-read .st .run::before, .m-coarse .m-read .ch::before { content: ""; position: absolute; z-index: 1; left: -6px; right: -6px; top: 50%; height: var(--touch); margin-top: calc(var(--touch) / -2); }
.m-coarse .lk { position: relative; }
.m-coarse .m-read .st { cursor: default; }

/* ---------------------------------------------------------------- phone */
@media (max-width: 760px) {
  .m-top { height: 56px; gap: 8px; }
  .m-ttl, .m-top .m-word { display: none !important; }
  .m-top .m-opt { margin-right: 0; gap: 10px; }
  .m-more { display: block; }
  .m-where { display: none; }
  #m-full { display: none; }
  .m-read .in { padding-left: 15px; }
  .m-read .ch .n { position: static; width: auto; margin-right: .6em; }
  .m-now { left: 0; }
  .m-card .in { padding-bottom: 9px; }
  .h-cols { grid-template-columns: 1fr; gap: 40px 0; margin-top: 40px; }
  .h-ex li { padding-left: 0; }
  .h-ex .dom { position: static; display: block; width: auto; line-height: 20px; margin-top: 8px; }
  .h-ex li.gap { margin-top: 0; }
  .h-plates { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
  .h-plate { margin-bottom: 22px; }
  .h-q { margin-top: 28px; }
  .g-view { bottom: auto; display: block; padding-bottom: 40px; }
  .g-bg { display: none; }
  .g-title { margin-top: 16px; }
  .g-status { display: block; }
  .g-grid { display: flex; flex-direction: column; align-items: stretch; margin-top: 16px; }
  .g-right { order: -1; }      /* under a finger: one line of status, the frame, then the whole list */
  .g-left { max-height: none; overflow: visible; padding-left: 28px; margin-top: 30px; padding-bottom: 0; }
  .g-right { padding-bottom: 0; }
  .g-frame.big { max-height: none; }
}
/* a narrow phone: the transport keeps its targets and drops what the line already says */
@media (max-width: 430px) {
  .m-clock .tot { display: none; }
  #m-voice .nm { display: none; }
  #m-voice .vi { display: block; }
  #m-voice { margin-left: 8px; }
  .m-clock { margin-left: 6px; }
}
@media (max-width: 349px) {
  .m-mark { display: none !important; }
  .m-clock { display: none !important; }
}
/* a short window (a phone on its side): the film takes the screen; see layout() */
@media (max-height: 519px) and (orientation: landscape) {
  .m-top { height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .m-switch .tr::after { transition: none; }
  .h-ask .m-line.ready .caret { animation: none; }
}
`
