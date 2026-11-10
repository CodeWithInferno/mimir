// ── for the reader: what a viewer shows about a part ──
interface Placed<Self> {
  /** One sentence about the part, shown when a reader asks what it is (its note in the viewer): piston.describe('Slides up and down in the cylinder.'). */
  describe(text: string): Self
}
