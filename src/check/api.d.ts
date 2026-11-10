/** A probe by its s.probe() name, or a function that returns the number. */
type ProbeLike = string | (() => number)
/** The codes of `mimir check` rules that take a declared exception with part.allow(code). */
type AllowCode = 'FLOATING' | 'INTERPENETRATE' | 'CONTAINED' | 'COINCIDENT' | 'OCCLUDED' | 'CAMERA-CLIP' | 'MECH-OPEN' | 'TINY' | 'TEXT-TINY' | 'CONTRAST-TEXT'
/** Thresholds and sampling counts of `mimir check` by name (defaults in brackets); every one can be changed with s.check({ limits }), or for a project with the configuration key check.<RULE>.<name>. */
interface CheckLimits {
  /** EMPTY-FRAME: least share of the frame that something must cover [0.005]. */
  emptyFrame?: number
  /** OFF-FRAME: share of an object's area that may lie beyond the frame [0.1]. */
  offFrame?: number
  /** TEXT-OVERLAP: px two texts may share each way [2]. */
  textOverlapPixels?: number
  /** TEXT-OVERLAP: share of the smaller text two texts may share [0.02]. */
  textOverlap?: number
  /** PLACE-NONE: share of the smaller unplaced 2D object that lies on another [0.5]. */
  pileOverlap?: number
  /** PLACE-NONE: least size of the smaller unplaced object relative to the larger for the two to be a pile [0.5]. */
  pileSimilar?: number
  /** OCCLUDED: least share of a pointed-at part's pixels that must show; pixels where a part it holds shows count as seen [0.3]. */
  occludedVisible?: number
  /** OCCLUDED: least share that must show when every part in front was declared with part.allow('OCCLUDED', other) [0.25]. */
  occludedDeclared?: number
  /** OCCLUDED: parts that draw fewer pixels than this are not judged [40]. */
  occludedMinPixels?: number
  /** INTERPENETRATE: overlap depth as a share of the thinner part's smallest extent [0.02]. */
  interpenetrateDepth?: number
  /** INTERPENETRATE: depth change below which two parts that keep their place are one rigid body [0.1]. */
  rigidDepthChange?: number
  /** FLOATING: surfaces closer than this share of the model's span are in contact [0.01]. */
  floatContact?: number
  /** FLOATING: detached groups smaller than this share of the model's span are ignored [0.01]. */
  floatMinSpan?: number
  /** FLOATING: beside a model that holds together, a gap up to this share of the model's span is an error, beyond it a warning [0.08]. */
  floatNear?: number
  /** FLOATING: a gap up to this share of the detached part's thinnest extent is an error even when nothing else holds together [0.5]. */
  floatClose?: number
  /** FLOATING: a stray far from the model is reported only when the model holds this many parts [3]. */
  floatAssembly?: number
  /** COINCIDENT: volume overlap (intersection over union) of two parts [0.9]. */
  coincidentIou?: number
  /** MECH-OPEN: residual of an invariant, or length change of a rod, as a share of the scene's span [0.01]. */
  mechOpen?: number
  /** Surface samples per solid for the pair measurements [64]. */
  solidSamples?: number
  /** TEXT-LONG: most words on a label [4]. */
  labelWords?: number
  /** TEXT-LONG: most characters on a label [28]. */
  labelChars?: number
  /** TEXT-LONG: most characters of one st.say() [180]. */
  captionChars?: number
  /** TEXT-TINY: least font size as a share of the frame height [0.02]. */
  textTiny?: number
  /** CONTRAST-TEXT: least contrast ratio of small text [4.5]. */
  contrastSmall?: number
  /** CONTRAST-TEXT: least contrast ratio of large text [3]. */
  contrastLarge?: number
  /** CONTRAST-TEXT: font size in px at 720p from which text is large [24]. */
  largeTextPx?: number
  /** TINY: least size of a visible object in px at 720p [6]. */
  tinyPixels?: number
  /** TINY: least size of a focused object as a share of the frame height [0.04]. */
  tinyFocused?: number
  /** SUBJECT-FIT: least share of the 3D panel's width or height the model fills [0.45]. */
  subjectFill?: number
  /** SUBJECT-FIT: most of the 3D panel one part may cover [0.85]. */
  subjectMax?: number
  /** LABEL-COVERS: most of another focused part a text may hide [0.25]. */
  labelCovers?: number
  /** LABEL-COVERS: grid over a 3D part's box on which what shows is probed [14]. */
  coverGrid?: number
  /** CONTRAST-TEXT: share of a text's box a shape must lie under to count as its background [0.5]. */
  behindShare?: number
  /** CHAPTER-LONG: seconds a chapter may last [90]. */
  chapterSeconds?: number
  /** COLOR-COUNT: hues on screen at once [3]. */
  hueCount?: number
  /** COLOR-COUNT: hues closer than this many degrees count as one [40]. */
  hueMerge?: number
  /** COLOR-COUNT: colours with less chroma than this are greys [0.2]. */
  hueChroma?: number
  /** HATCH-USE: share of placed objects with literal coordinates [0.3]. */
  hatchShare?: number
  /** expect.ratio: relative tolerance [0.01]. */
  ratioTolerance?: number
  /** expect.conserved: relative tolerance [0.01]. */
  conservedTolerance?: number
  /** Moments of the story at which expectations, invariants and probes are sampled besides the plan [48]. */
  timelineSamples?: number
  /** OCCLUDED: views tried to suggest a camera [5]. */
  viewTrials?: number
  /** OCCLUDED: parts per run a camera is searched for [3]. */
  viewTrialParts?: number
  /** OCCLUDED: a part is held by the one pointed at (and does not hide it) when this share of its box lies in the other's box [0.5]. */
  occludedInside?: number
  /** OCCLUDED: how much more of the part a suggested view must show to replace the best one before it [0.02]. */
  occludedViewGain?: number
  /** EMPTY-FRAME: columns of the grid 2D boxes are counted on [96]. */
  emptyGrid?: number
  /** EMPTY-FRAME: a 3D part this many times farther out than the next is named as the reason [50]. */
  emptyFar?: number
  /** OFF-FRAME: px a text may reach past the frame [1.5]. */
  offFrameTextPixels?: number
  /** CONTRAST-TEXT: least width in px at 720p, on each side of a glyph, of an outline that carries the text [1]. */
  contrastOutlinePx?: number
  /** TINY: moments of a step a pointed-at part is measured at [5]. */
  tinyMoments?: number
  /** DEAD-PARAM: a change smaller than 10^-digits of a unit is not visible [2]. */
  deadParamDigits?: number
  /** DEAD-PARAM: share of its range a slider is tried at besides its ends [0.637]. */
  deadParamProbe?: number
  /** COINCIDENT: boxes that differ by less than this share of the part's span are compared by volume [0.2]. */
  sameBox?: number
  /** PLACE-NONE: share of the smaller box's volume two unplaced solids share to be a pile [0.25]. */
  pileVolume?: number
  /** Sampling plan: evenly spaced moments inside every step that moves [3]. */
  planTransitions?: number
  /** Sampling plan: positions of every cyclic param [8]. */
  planPhases?: number
}
/** Claims about the scene that `mimir check` verifies at every step end, during transitions and at every slider extreme (EXPECT-FAILED). */
interface Expect {
  /** a lies inside b (b's box, in b's own axes). Also declares the fit: the pair is exempt from INTERPENETRATE and CONTAINED. */
  inside(a: Placed<unknown> | string, b: Placed<unknown> | string, opts?: { tolerance?: number }): void
  /** a and b touch: no gap (an overlap counts as touching). tolerance is in scene units. */
  touching(a: Placed<unknown> | string, b: Placed<unknown> | string, opts?: { tolerance?: number }): void
  /** All of a is above all of b (y up), in 2D and in 3D: expect.above(valve, piston). */
  above(a: Placed<unknown> | string, b: Placed<unknown> | string, opts?: { tolerance?: number }): void
  /** Probe a equals factor × probe b all the time: expect.ratio('camAngle', 'crankAngle', 0.5). tolerance is relative (0.01 = 1%). */
  ratio(a: ProbeLike, b: ProbeLike, factor: number, opts?: { tolerance?: number }): void
  /** A probe keeps its value over the whole story and every slider position: expect.conserved('rodLength'). */
  conserved(probe: ProbeLike, opts?: { tolerance?: number }): void
  /** Only during one step (number from 1, or title): a condition, or a block of expect.* calls: expect.during('Intake', () => expect.above(valve, piston)). */
  during(step: number | string, fn: () => boolean | void): void
}
/** Author-declared truth for `mimir check`: expect.inside / touching / above / ratio / conserved / during. */
declare const expect: Expect
interface Scene {
  /** A named claim that must be true whenever it is sampled: s.expect('the valve is shut at the top', () => lift() === 0). */
  expect(name: string, fn: () => boolean): void
  /** Settings of `mimir check` for this scene: s.check({ limits: { chapterSeconds: 120 }, off: ['COLOR-COUNT'] }). */
  check(options: { limits?: CheckLimits; off?: string[] }): void
}
interface Placed<Self> {
  /** Declare an exception to one check rule for this object (and one other, when given): plug.allow('FLOATING') · wheel.allow('INTERPENETRATE', axle). */
  allow(code: AllowCode, other?: Placed<unknown> | string): Self
}
