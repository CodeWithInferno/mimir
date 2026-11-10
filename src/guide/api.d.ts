/** Options of s.guide(): the pace of narration, the look of pointer, marks, labels and captions, and the limits check uses. Lengths in frame units, times in seconds. */
interface GuideOptions {
  /** Narration pace without audio, characters per second (default 16.5). */
  charactersPerSecond?: number
  /** Silence after a comma (default 0.365) and after a sentence (default 0.36). */
  commaPause?: number
  sentencePause?: number
  /** Silence before the first word of a step, so the pointer can land on an early word (default 0.6). */
  leadIn?: number
  /** Flight time of one pointer hop (default 0.5) and the shortest rest on a part (default 0.35). */
  hop?: number
  perch?: number
  /** Idle seconds after which the pointer goes back to the caption (default 1.5). */
  dockAfter?: number
  /** Draw-on time of a ring, label, arrow or glow (default 0.45); shortest life of a glow (default 1.2). */
  drawTime?: number
  glowTime?: number
  /** Length (default 0.22) and colour (default white) of the pointer; its opacity while it rests by the caption (default 0: hidden). */
  pointerSize?: number
  pointerColor?: Color
  dockOpacity?: number
  /** Colour of marks and of the caption words that name them; null (default) = the colour of the part. */
  markColor?: Color | null
  /** Stroke width of rings and arrows (default 0.022). */
  markWidth?: number
  /** Height of label text (default 0.21); its colour while its word is said (null = the part's colour) and when it is not (default #BBBBBB; null = it keeps its colour); its distance from the part or from the figure (default 0.3). */
  labelSize?: number
  labelColor?: Color | null
  labelRest?: Color | null
  labelGap?: number
  /** A name wider than this is set on two lines (default 2.4). Colour of leaders (default #888888; null = the colour of the name). */
  labelMaxWidth?: number
  leaderColor?: Color | null
  /** How dim the rest of the 3D figure is while the pointer names its parts (default 0.9), and the flat stage (default 0); under [words](focus:part) (default 1). */
  highlightDim?: number
  highlightDim2d?: number
  focusDim?: number
  /** The side of a part a resting pointer hangs on when no text is in its way: degrees clockwise from straight below (default -35: below right). */
  perchAngle?: number
  /** Space between two names in a column (default 0.08); length of a leader's level shoulder (0.16) and where its elbow is (0.24). */
  labelSpace?: number
  labelShoulder?: number
  labelElbow?: number
  /** How long the dim holds after the last landing of a step (default 3.4) and how long it takes to let go (default 0.5). */
  highlightHold?: number
  highlightOut?: number
  // every other number of the guide (timings, widths, the label solver) is an option of the same name as in GUIDE_DEFAULTS (src/guide/index.ts)
  /** Number the labels 1, 2, 3 … in the order they are spoken (default false). */
  numbered?: boolean
  /** Height of caption text (default 0.25), colour of plain words (default #DDDDDD), distance of the line from the bottom edge (default 0.42). */
  captionSize?: number
  ink?: Color
  captionBottom?: number
  /** Show captions (default true); the transcript is recorded either way. */
  captions?: boolean
  /** Speak the narration with the browser's speech synthesis while the story plays (default false; never required). */
  voice?: boolean
  /** check limits (the defaults): words per sentence (25), marks per sentence (3; one or two read best), seconds of narration without a cue (10, about 30 words), seconds the pointer may be late (0.25), visible share of a part that is pointed at (0.3). Label and caption length: s.check({ limits: { labelWords, labelChars, captionChars } }). */
  maximumSentenceWords?: number
  maximumMarksPerSentence?: number
  maximumDeadAir?: number
  maximumLate?: number
  minimumVisibleShare?: number
}
interface Scene {
  /** Tune the guide for this scene; call it before the first step. s.guide({ numbered: true, labelColor: '#DDDDDD' }) */
  guide(options: GuideOptions): Scene
}
interface Step {
  /**
   * Narration for this step: spoken (optional voice), captioned one sentence at a time, and the transcript of read mode.
   * Link words to parts by id with [spoken words](verb:target): point (default) flies the pointer there as the words are
   * spoken, ring circles it (ring:a+b for several), label names it with the words, arrow draws from one part to another
   * (arrow:a->b), glow lights it for a moment, focus dims everything else (focus:a+b). A target is an id or id.anchor
   * (piston.top). ",hold" keeps a mark after the step. One or two spans a sentence.
   * st.say('The [piston](piston) slides down and the [intake valve](ring:intakeValve) opens.')
   */
  say(sentence: string): Step
  /**
   * Name a part for this step: typeset text on a thin leader, placed by the runtime (text defaults to the part's id; four
   * words at most). Names of 3D parts stand in two columns beside the figure, a line carries its name; a name is in its
   * part's colour while a linked word says it.
   */
  label(part: Placed<unknown> | string, text?: string): Step
  /** Dim everything except these parts for this step. */
  focus(...parts: (Placed<unknown> | string)[]): Step
  /**
   * Put parts in the light and dim everything else, as two separate things: `lit` is a part, a list of parts or a record
   * of id → amount (0..1), `dim` how dim the rest becomes (0..1, default 0.9). It lasts until the next st.highlight() of
   * the step or the end of the step; a second call hands the light over while the dim stays put (no flash);
   * st.highlight(false) ends it. The pointer does this by itself for every part it names.
   * st.highlight({ lit: piston, dim: 0.9 })
   */
  highlight(options: { lit?: Placed<unknown> | string | (Placed<unknown> | string)[] | Record<string, number>; dim?: number } | false): Step
}
