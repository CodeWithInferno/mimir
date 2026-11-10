/** What part.to gives: the standard tweens of a 2D object (color, shift, scale, opacity …). */
interface TexPartTo extends MobSetters<TexPartTo>, Anim {}
/**
 * One term of a formula as an object of its own: colour it (part.color(YELLOW)), tween it (part.to.color(YELLOW).scale(1.3)),
 * move it (part.to.shift(0, 0.4)), write or fade it on its own, point a label or an arrow at it. It follows its formula.
 */
interface TexPart extends MobOf<TexPart, TexPartTo> {}
/** A typeset formula. Standard 2D setters apply to the whole of it; write(formula) writes its pieces on from left to right. */
interface Tex extends MobOf<Tex> {
  /**
   * The piece of the formula that is set like `key` (LaTeX, written as in the formula: 'x^2', '\\theta', '='), as an
   * object. occurrence 2 = the second place the key occurs (1 = the first). A key the formula does not have is
   * REF-MISSING. Parts of one formula should not overlap.
   */
  part(key: string, occurrence?: number): TexPart
  /** The index-th piece in reading order (0 = the leftmost glyph, bar or sign). */
  part(index: number): TexPart
}
/**
 * A formula in Computer Modern (the fonts are embedded: it looks the same on every machine). LaTeX as KaTeX reads it;
 * in a JavaScript string write every backslash twice, or use String.raw`\frac{a}{b}`. Prose with maths in it:
 * tex('the angle $\\theta$ grows') - what stands between dollar signs is mathematics, the rest is text.
 * size as for text() (48 = body). colors: { '\\theta': YELLOW } colours every occurrence of a piece; the source can
 * colour too: '\\textcolor{#58C4DD}{x}'. inline: true sets it in text style (small operators, limits beside them).
 * A source that does not parse is TEX-INVALID and is shown as red text; nothing throws.
 */
declare function tex(latex: Dyn<string>, opts?: { id?: string; size?: number | 'hero' | 'title' | 'section' | 'body' | 'label' | 'note' | 'tiny'; color?: Dyn<Color>; colors?: Record<string, Color>; inline?: boolean; opacity?: Dyn<number> }): Tex
/**
 * One formula becomes another: st.play(rewrite(a, b)). The pieces both have glide from their place in `from` to their
 * place in `to`, the others fade out and in; afterwards `to` is on stage and `from` is gone. keep: true leaves `from`
 * where it is, so `to` is derived from a copy of it (a second line of a derivation). `to` is hidden until then.
 * duration defaults to TEX_STYLE.rewriteDuration (1.5 s).
 */
declare function rewrite(from: Tex, to: Tex, opts?: { keep?: boolean; duration?: number; rate?: (t: number) => number }): Anim
/**
 * Defaults of formulas; set a field before creating formulas to change it for the scene: TEX_STYLE.rewriteDuration = 2.
 * writeLag / writeLagTotal: how far apart the pieces start under write() (manim: min(4 / (n + 1), 0.2) of a piece's
 * time); writeTrace: share of a piece's time spent tracing its outline; writeStroke: outline width in em;
 * rewriteFade: share of rewrite() over which unpaired pieces fade; rewriteDrift: how far they drift towards the other
 * formula; errorColor: colour of a source that does not parse.
 */
declare const TEX_STYLE: { rewriteDuration: number; writeLag: number; writeLagTotal: number; writeTrace: number; writeStroke: number; rewriteFade: number; rewriteDrift: number; errorColor: string }
