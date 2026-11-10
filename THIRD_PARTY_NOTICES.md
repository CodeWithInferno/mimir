# Third-party notices

Mimir is released under the MIT licence (see `LICENSE`). This file lists every third-party work that is
redistributed with Mimir, every algorithm or data table that was ported from another project, and every dependency
in `package.json`, each with its licence and the notice that licence asks for.

Checked against `node_modules/<package>/package.json` and the licence files of the installed packages. When a
dependency is added, removed or upgraded, or a font or ported algorithm lands, this file changes in the same pull
request. `bun run hygiene` fails when a runtime dependency, an embedded font or a comment that says "ported from"
has no entry here.

## 1. Redistributed with Mimir

These are part of what a user receives: `bun scripts/build.ts` bundles them into `dist/`, and `mimir export`
inlines the chunks a scene uses into the HTML file it writes.

### three.js

- Version 0.187.0 (`three` in `package.json`), https://github.com/mrdoob/three.js
- Licence: MIT. Copyright © 2010-2026 three.js authors.
- Where: bundled into `dist/mimir.3d.js` (the lazy 3D chunk) and inlined into every exported HTML file of a scene
  that has a 3D part. A scene that is 2D only does not contain it.
- Includes the fat-line classes `Line2`, `LineGeometry`, `LineMaterial` and what they import from
  `three/examples/jsm/lines/` (imported by `src/r3d/three.ts`), which are part of the three.js repository under
  the same licence.

### KaTeX

- Version 0.19.1 (`katex` in `package.json`), https://github.com/KaTeX/KaTeX
- Licence: MIT. Copyright (c) 2013-2020 Khan Academy and other contributors.
- Where: the TeX parser and layout are bundled into `dist/mimir.tex.js` (the lazy formula chunk, imported by
  `src/tex/layout.ts`) and inlined into the exported HTML file of a scene that uses `tex()`. A scene without a
  formula does not contain it.

### KaTeX fonts (the Computer Modern faces every scene is set in)

- Source: the `katex` package 0.19.1, `dist/fonts/*.woff2`, embedded **byte for byte** as base64. Nothing is
  subset, renamed or otherwise modified, and the files keep the copyright and licence records of their name tables.
- Licence: SIL Open Font License, version 1.1 (full text in section 6). Copyright (c) 2009-2010 Design Science,
  Inc.; Copyright (c) 2014-2018 Khan Academy. The faces are derived from Computer Modern (Donald E. Knuth) and the
  AMS fonts (American Mathematical Society).
- Where:
  - `src/r2d/fontdata.ts` → `dist/mimir.fonts.js`: `KaTeX_Main-Regular`, `KaTeX_Main-Italic`, `KaTeX_Main-Bold`,
    `KaTeX_Math-Italic`. Loaded by every scene that shows text; inlined into its exported HTML file.
  - `src/tex/fonts/{size,ams,bold,italic,cal,fancy,sans}.ts` (written by `src/tex/fonts/embed.ts`) →
    `dist/mimir.tex<group>.js`: the remaining KaTeX faces (Size1-4, AMS, Main-BoldItalic, Math-BoldItalic,
    Caligraphic, Fraktur, Script, SansSerif, Typewriter). Loaded only when a formula needs a glyph from the group.
- The fonts are redistributed as part of a larger work, which the licence permits; they are not sold by themselves.

### Computer Modern metrics (widths and kerning pairs)

- `src/r2d/type.ts` holds advance widths read from the `hmtx` tables of the KaTeX font files above (OFL-1.1, same
  copyright) and kerning pairs read from the `cmr10`, `cmbx10` and `cmti10` TeX font metric files with `tftopl`.
- Computer Modern is by Donald E. Knuth. The metric files are distributed with TeX under Knuth's terms: they may
  be used freely, and a changed copy must not keep the original name. No `.tfm` file is redistributed here; only
  the pair values for letters, digits and common punctuation are, inside a table of this project's own format.

## 2. Ported algorithms and data

No source file was copied. The following were re-implemented in TypeScript from the named source; where the
source's licence asks for its notice in derived work, the notice is in section 6.

### manim (ManimGL, by 3Blue1Brown)

- Source: https://github.com/3b1b/manim
- Licence: MIT. Copyright (c) 2020-2026 3Blue1Brown LLC (the copyright line of the upstream `LICENSE.md`, read on
  2026-11-10).
- What was ported:
  - the rate functions in `src/core/rate.ts` (`smooth`, `rushInto`, `rushFrom`, `thereAndBack`, `doubleSmooth`,
    `lingering`, `overshoot`, `wiggle` and the others), transcribed from `manimlib/utils/rate_functions.py` and
    tested against values computed by the Python original (`tests/unit/core/fixtures/rate_ref.json`);
  - the palette values in `src/core/color.ts` (`BLUE`, `TEAL`, `GREEN` … with their `_A` to `_E` shades) and the
    colour interpolation in squared RGB (`mix`), from ManimGL's colour constants and `interpolate_color`;
  - the meaning and default timings of the verbs (`write`, `create`, `fadeIn`, `fadeOut`, `transform`, lagged
    starts) in `src/anim/` and `src/core/rate.ts` (`PACE`), the frame of 14.222 by 8 units, the named text sizes
    and the size-to-em rule in `src/core/text.ts`, `nextTo` placement, the default dot radius and the stroke-width
    unit, which follow manim's conventions;
  - the conventions of the path library in `src/lib/path/` (where outlines start and which way they run, the
    `bend` of an arrow, morphing in the sense of manim's `Transform`). The morphing code itself is this project's
    own.

### Clicky

- Source: https://github.com/farzaa/clicky (a macOS app, Swift)
- Licence: MIT. Copyright (c) 2026 Farza (the copyright line of the upstream `LICENSE`, read on 2026-11-10).
- What was ported: the flight of the guide pointer in `src/lib/guide/pose.ts`: a quadratic bezier whose control
  point is lifted by min(0.2 × distance, 80 px), smoothstep easing, heading along the tangent, a scale pulse at
  mid-flight, and the distance-based flight time (800 px/s clamped to 0.6 to 1.4 s). It was rewritten as a pure
  function of time; no Swift source was copied.

### Pseudo-random number generators

All three are small public-domain algorithms; they are listed so that their authors are credited.

- **mulberry32**, by Tommy Ettinger (public domain / CC0): `src/core/math.ts` (`makeRng`, behind `s.rng(seed)`),
  `src/lib/layout/force.ts`, `src/lib/solids/sample.ts`.
- **sfc32** ("Small Fast Counter"), by Chris Doty-Humphrey, from the PractRand suite (public domain):
  `src/lib/sim/rng.ts`.
- **xmur3**, a string hash by "bryc" built on the mixing steps of MurmurHash3 (Austin Appleby), both public
  domain: `src/lib/sim/rng.ts` (turns a seed text into the generator's state).

### This project's own earlier work

Comments in `src/lib/path/morph.ts`, `src/r3d/edges.ts` and a few tests say that code was "ported from" a prototype
or from the look-development reference. Those prototypes were written by the authors of this project during its
design and are not third-party work; they are not published.

## 3. Development dependencies (not redistributed)

Installed by `bun install` for type checking and tests. None of their code is in `dist/` or in exported files.

| Package | Licence | Why it is there |
|---|---|---|
| `typescript` (and its platform binary package) | Apache-2.0 (Microsoft Corp.) | type checking (`bun run typecheck`) |
| `@types/bun`, `bun-types` | MIT | types of the bun runtime |
| `@types/node`, `undici-types` | MIT | dependencies of `bun-types` |
| `@types/three` | MIT | types of three.js |
| `@types/stats.js`, `@types/webxr`, `@tweenjs/tween.js`, `fflate`, `meshoptimizer` | MIT | dependencies of `@types/three` (types only; not imported by Mimir) |
| `@dimforge/rapier3d-compat` | Apache-2.0 | dependency of `@types/three` (types only; not imported by Mimir) |

Exact versions are in `bun.lock`.

## 4. Tools Mimir runs but does not ship

- **bun** (MIT, https://github.com/oven-sh/bun): the runtime of the CLI, the bundler and the test runner. Installed
  by the user.
- **A Chrome-family browser** (Google Chrome, Chromium, Microsoft Edge or Brave): found on the machine or named by
  `MIMIR_CHROME`; driven over the DevTools protocol. Not downloaded and not redistributed.
- **ffmpeg** (LGPL or GPL depending on the build): optional, only for `mimir export --mp4`; found on `PATH` or named
  by `MIMIR_FFMPEG`. Not downloaded and not redistributed. A video you export is encoded by your copy of ffmpeg.
- **A coding agent**: optional, only for `mimir new`; started as a local process by the adapter you choose. Not
  downloaded and not redistributed.

## 5. Not included on purpose

No images, videos, design mock-ups, downloaded fonts or research notes of the project's development are part of the
published repository. If you find a third-party file or a ported piece of code that is not listed here, open an
issue.

## 6. Licence texts

### The MIT License

Applies to three.js, KaTeX, manim and Clicky, each with its own copyright line from the sections above:

- Copyright © 2010-2026 three.js authors
- Copyright (c) 2013-2020 Khan Academy and other contributors
- Copyright (c) 2020-2026 3Blue1Brown LLC
- Copyright (c) 2026 Farza

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### SIL Open Font License, version 1.1

Applies to the KaTeX fonts. Copyright (c) 2009-2010 Design Science, Inc.; Copyright (c) 2014-2018 Khan Academy.
The authoritative text is at https://openfontlicense.org and in the name table of every embedded font file.

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## 7. The notices travel with the bundles

The MIT licence asks for its notice "in all copies or substantial portions of the Software". Every chunk the build
writes to `dist/` opens with a `/*! … */` line that names the packages bundled into it with their version, licence
and copyright line (three.js in `mimir.3d.js`, KaTeX in `mimir.tex.js`), and `mimir export` keeps those lines in the
HTML file it writes. The embedded fonts carry their copyright and licence in their own name tables. `bun run hygiene`
checks this on every run (rule `bundle-notice`).
