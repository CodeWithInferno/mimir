// JavaScript that the CLI evaluates inside the viewer page (strings: this file runs under bun, the code runs in
// the browser). Everything goes through window.__mimir (DESIGN section 9). Two things need more than that protocol
// carries today, and both degrade to "not available" instead of guessing:
//
//   geometry (query bounds / distance / contacts / visible, the legend of --debug ids)
//     1. window.__mimir.query(what, ids, { tolerance }) when the viewer has it: the page-side support.
//     2. otherwise the frame state itself, reached through the public overlay registry: an overlay that draws
//        nothing is registered once, and the context every overlay receives (the runtime: the frame on screen,
//        screenRect, the id pass) is what the measurements are computed from.
//     3. otherwise the answer is { unavailable: reason }.
//
// Nothing here reads a clock or keeps state between frames: every measurement is of the frame that was seeked.

import type { ParamValue } from './args.ts'

/** A view for setView(): a named one (--views), or a pose patch (--turntable: the azimuth, the rest stays the story's). */
export type ViewSpec = string | { azimuth: number } | null

/** story seconds between two samples when looking for the moment a parameter reaches a value (--at name=value) */
export const PARAM_SCAN_STEP = 0.05
/** the moment is then narrowed down to this many seconds */
export const PARAM_SCAN_PRECISION = 0.0005
/** contacts: at most this many pairs are returned (the total is always reported) */
export const CONTACTS_MAX = 200

const json = (v: unknown): string => JSON.stringify(v)

/** Shared page-side helpers. `cx()` resolves to the measuring context or null. */
export const LIB = `
  const m = window.__mimir;
  const cx = async () => {
    if (window.__mimirCli !== undefined) return window.__mimirCli;
    let got = null;
    try {
      const core = globalThis.__mimirBridge && globalThis.__mimirBridge['core/index.ts'];
      if (core && typeof core.defineOverlay === 'function' && typeof m.debug === 'function') {
        core.defineOverlay({ name: 'cli.measure', z: 0, create(c) { got = c; return { paint() {} }; } });
        // overlays registered after the page booted are created when the dev chunk is asked for
        await m.debug('safe');
        await m.debug(null);
      }
    } catch (e) { got = null; }
    window.__mimirCli = got && got.runtime && got.runtime.model ? got : null;
    return window.__mimirCli;
  };
  const r4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
  const v4 = (p) => [r4(p[0]), r4(p[1]), r4(p[2] || 0)];
  const rect4 = (r) => (r ? { x: r4(r.x), y: r4(r.y), width: r4(r.width), height: r4(r.height) } : null);
  const leaves = (c) => c.runtime.frame.visibleLeaves();
  const leafIds = (c, n) => (n.children && n.children.length ? n.children.flatMap((k) => leafIds(c, k)) : [n.id]);
  /** "piston" → the part; "piston.top" → the part and one of its anchors; unknown → an error with the nearest ids */
  const resolve = (c, ref) => {
    const nodes = c.runtime.model.nodes;
    const exact = nodes.find((n) => n.id === ref);
    if (exact) return { node: exact, anchor: null, ref };
    const dot = ref.lastIndexOf('.');
    if (dot > 0) {
      const node = nodes.find((n) => n.id === ref.slice(0, dot));
      const anchor = ref.slice(dot + 1);
      if (node) {
        const names = c.runtime.frame.anchorNames(node);
        if (names.includes(anchor)) return { node, anchor, ref };
        return { error: 'no-anchor', ref, id: node.id, anchor, anchors: names };
      }
    }
    return { error: 'no-part', ref, ids: nodes.map((n) => n.id) };
  };
  const boxOf = (c, node) => {
    const b = c.runtime.frame.bounds(node);
    return { min: v4(b.min), max: v4(b.max), center: v4([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]), size: v4([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]) };
  };
  /** separation of two axis-aligned boxes: gap (0 when they touch or overlap) and how deep they overlap along the shallowest axis */
  const separation = (a, b, dims) => {
    let gap2 = 0, depth = Infinity;
    for (let i = 0; i < dims; i++) {
      const s = Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i]);
      if (s > 0) gap2 += s * s;
      depth = Math.min(depth, -s);
    }
    return { gap: Math.sqrt(gap2), overlap: gap2 > 0 ? 0 : Math.max(0, depth) };
  };
  const onStage = (c, node) => c.runtime.frame.visible(node);
  const where = () => { const s = m.state ? m.state() : {}; return { t: r4(s.tau), step: s.step || null }; };
`

/**
 * One page round trip per frame: seek, apply overrides and the view, wait for the settled render, read probes and
 * the parameter values in effect. With `legend` the parts on screen are measured too (--debug ids).
 */
export function frameExpression(t: number, sets: ReadonlyArray<{ name: string; value: ParamValue }>, view: ViewSpec, opts: { legend?: boolean } = {}): string {
  return `(async () => {
  ${opts.legend ? LIB : 'const m = window.__mimir;'}
  await m.seek(${json(t)});
  for (const [name, value] of ${json(sets.map((s) => [s.name, s.value]))}) await m.setParam(name, value);
  ${view === null ? '' : `await m.setView(${json(view)});`}
  await m.frame();
  // Parameter values IN EFFECT for this frame. info().params carries the declared defaults on the real host
  // (measured: --set crank=200 changed the pixels and the probes while info() still said 40), so the live
  // values come from state() when the host has it; a contract-only viewer falls back to info().
  const params = {};
  const live = typeof m.state === 'function' ? (m.state() || {}).params : null;
  if (live) for (const name of Object.keys(live)) params[name] = live[name];
  else for (const p of (m.info().params || [])) params[p.name] = p.value;
  ${opts.legend ? `
  let legend = null;
  const c = await cx();
  if (c) {
    await m.frame();
    const all = c.runtime.model.nodes.filter((n) => !(n.children && n.children.length));
    const shown = new Set(leaves(c).map((n) => n.id));
    legend = [];
    all.forEach((n, i) => {
      if (!shown.has(n.id)) return;
      const rect = rect4(c.screenRect(n));
      if (!rect) return;
      const at = n.space === '3d' ? c.visiblePoint(n) : null;
      legend.push({ index: i, id: n.id, space: n.space, rect, at: at ? { x: r4(at.x), y: r4(at.y) } : null });
    });
  }` : ''}
  return JSON.stringify({ probes: m.probes() || {}, params${opts.legend ? ', legend' : ''} });
})()`
}

/**
 * The first story time at which the story has parameter `name` at `value` (--at crank=90). Samples the pure state
 * along the story, then bisects the first crossing. Leaves the page seeked somewhere: the caller seeks next.
 * Returns JSON { found, t, actual, from, to, kind } (from / to: the range the story covers, for the error message).
 */
export function paramTimeExpression(name: string, value: ParamValue, step = PARAM_SCAN_STEP, precision = PARAM_SCAN_PRECISION): string {
  return `(async () => {
  const m = window.__mimir, name = ${json(name)}, target = ${json(value)};
  const duration = Number(m.info().duration) || 0;
  if (typeof m.state !== 'function') return JSON.stringify({ found: false, reason: 'no-state' });
  const read = (t) => { m.seek(t); const s = m.state(); return s && s.params ? s.params[name] : undefined; };
  const n = Math.max(1, Math.min(20000, Math.ceil(duration / ${json(step)})));
  const numeric = typeof target === 'number';
  const hit = (v) => (numeric ? typeof v === 'number' && v === target : String(v) === String(target));
  const side = (v) => (numeric && typeof v === 'number' ? Math.sign(v - target) : hit(v) ? 0 : 1);
  let lo = Infinity, hi = -Infinity;
  const seen = [];
  let prevT = 0, prev = read(0), found = null;
  const note = (v) => { if (typeof v === 'number') { lo = Math.min(lo, v); hi = Math.max(hi, v); } else if (!seen.includes(String(v))) seen.push(String(v)); };
  note(prev);
  if (hit(prev)) found = 0;
  for (let i = 1; i <= n && found === null; i++) {
    const t = (duration * i) / n;
    const v = read(t);
    note(v);
    if (hit(v) || (numeric && side(prev) * side(v) < 0)) {
      // the value is reached somewhere in (prevT, t]: narrow it down to the first instant at or past the target
      let a = prevT, b = t;
      const before = side(prev);
      while (b - a > ${json(precision)}) {
        const mid = (a + b) / 2, s = side(read(mid));
        if (s === before && s !== 0) a = mid; else b = mid;
      }
      found = b;
    }
    prevT = t; prev = v;
  }
  if (found === null) return JSON.stringify({ found: false, reason: 'never', from: Number.isFinite(lo) ? lo : null, to: Number.isFinite(hi) ? hi : null, seen });
  const t = Math.round(found * 1000) / 1000;
  return JSON.stringify({ found: true, t: Math.min(duration, t), actual: read(Math.min(duration, t)) });
})()`
}

/** What a query needs measured: the request the CLI makes of the page. */
export interface QueryRequest { what: string; ids: string[]; tolerance: number }

/**
 * Answer a query about the frame on screen (the caller has seeked and rendered it). Returns JSON
 * { source: 'viewer' | 'frame state', result } or { unavailable: reason } or { error, … } for an unknown id.
 */
export function queryExpression(req: QueryRequest, contactsMax = CONTACTS_MAX): string {
  return `(async () => {
  ${LIB}
  const what = ${json(req.what)}, ids = ${json(req.ids)}, tolerance = ${json(req.tolerance)};
  if (what === 'state') {
    const s = m.state ? m.state() : null;
    if (!s) return JSON.stringify({ unavailable: 'this viewer has no state()' });
    const info = m.info();
    const step = (info.steps || []).find((x) => x.index === s.step) || null;
    const c = await cx();
    let camera = null;
    try { if (c && c.runtime.model.viewport) { const p = c.runtime.frame.camera(); camera = { target: v4(p.target), azimuth: r4(p.azimuth), elevation: r4(p.elevation), distance: r4(p.distance) }; } } catch (e) {}
    return JSON.stringify({ source: 'viewer', result: { t: r4(s.tau), duration: r4(s.duration), step: s.step || null, step_title: step ? step.title : null, chapter: step && step.chapter != null ? step.chapter : null, u: r4(s.u), params: s.params || {}, overridden: s.overridden || [], caption: s.caption || '', camera } });
  }
  if (what === 'probes') return JSON.stringify({ source: 'viewer', result: { ...where(), params: m.state ? (m.state().params || {}) : {}, probes: m.probes() || {} } });
  // the viewer's own support first
  if (typeof m.query === 'function') {
    try { return JSON.stringify({ source: 'viewer', result: await m.query(what, ids, { tolerance }) }); } catch (e) { return JSON.stringify({ unavailable: 'the viewer threw in __mimir.query(): ' + String((e && e.message) || e) }); }
  }
  const c = await cx();
  if (!c) return JSON.stringify({ unavailable: 'this viewer exposes neither __mimir.query() nor its frame state' });
  await m.frame();
  const frame = c.runtime.frame;
  const stage = c.stage();
  const refs = ids.map((id) => resolve(c, id));
  const bad = refs.find((r) => r.error);
  if (bad) return JSON.stringify(bad);
  const units = (node) => (node.space === '3d' ? 'world units' : 'frame units (the frame is 14.222 x 8, origin at its centre, y up)');

  if (what === 'bounds') {
    const { node, anchor, ref } = refs[0];
    if (anchor) return JSON.stringify({ error: 'needs-part', ref });
    return JSON.stringify({ source: 'frame state', result: {
      ...where(), id: node.id, kind: node.kind, space: node.space, on_stage: onStage(c, node),
      box: boxOf(c, node), units: units(node), screen: rect4(c.screenRect(node)), stage: { width: stage.width, height: stage.height },
      basis: 'box: computed from the scene graph (axis-aligned). screen: the rectangle the renderer measured, in px of the stage, origin top-left.',
    } });
  }

  if (what === 'distance') {
    const [a, b] = refs;
    const pa = frame.anchor(a.node, a.anchor || 'center'), pb = frame.anchor(b.node, b.anchor || 'center');
    const sa = c.project(a.anchor ? pa : a.node), sb = c.project(b.anchor ? pb : b.node);
    const screen = Math.hypot(sa.x - sb.x, sa.y - sb.y);
    const same = a.node.space === b.node.space;
    const out = { ...where(), a: a.ref, b: b.ref, space: same ? a.node.space : 'mixed', on_stage: { [a.ref]: onStage(c, a.node), [b.ref]: onStage(c, b.node) } };
    if (same) {
      const d = [pb[0] - pa[0], pb[1] - pa[1], (pb[2] || 0) - (pa[2] || 0)];
      const points = !!(a.anchor || b.anchor);
      const sep = points ? null : separation(frame.bounds(a.node), frame.bounds(b.node), a.node.space === '3d' ? 3 : 2);
      return JSON.stringify({ source: 'frame state', result: {
        ...out, distance: r4(Math.hypot(d[0], d[1], d[2])), delta: v4(d), from: v4(pa), to: v4(pb),
        gap: sep ? r4(sep.gap) : null, overlap: sep ? r4(sep.overlap) : null, units: units(a.node), screen_distance_px: r4(screen),
        basis: 'distance: between ' + (a.anchor ? 'the point ' + a.ref : 'the centre of ' + a.ref) + ' and ' + (b.anchor ? 'the point ' + b.ref : 'the centre of ' + b.ref) + ', computed from the scene graph.' + (sep ? ' gap / overlap: between the two axis-aligned bounding boxes.' : ''),
        limits: sep ? 'A box is not the surface: a gap of 0 means the boxes touch or overlap, not that the surfaces do.' : 'gap is null because a point was named; ask for two parts to get the gap between their boxes.',
      } });
    }
    return JSON.stringify({ source: 'frame state', result: {
      ...out, distance: null, screen_distance_px: r4(screen), screen_distance_units: r4(screen / stage.scale),
      basis: 'One object is 2D and the other 3D: they share no space, so only the distance between where they are drawn is given.',
    } });
  }

  if (what === 'contacts') {
    const only = refs.length ? refs[0].node : null;
    if (refs.length && refs[0].anchor) return JSON.stringify({ error: 'needs-part', ref: refs[0].ref });
    const onlyIds = only ? new Set(leafIds(c, only)) : null;
    const list = leaves(c).map((n) => ({ n, b: frame.bounds(n) }));
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (A.n.space !== B.n.space) continue;
        if (onlyIds && !onlyIds.has(A.n.id) && !onlyIds.has(B.n.id)) continue;
        const sep = separation(A.b, B.b, A.n.space === '3d' ? 3 : 2);
        if (sep.gap > tolerance) continue;
        pairs.push({ a: A.n.id, b: B.n.id, space: A.n.space, kind: sep.overlap > tolerance ? 'overlap' : 'touch', gap: r4(sep.gap), overlap: r4(sep.overlap) });
      }
    }
    pairs.sort((p, q) => q.overlap - p.overlap || p.gap - q.gap || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
    return JSON.stringify({ source: 'frame state', result: {
      ...where(), of: only ? only.id : null, tolerance, parts: list.length, total: pairs.length, truncated: pairs.length > ${json(contactsMax)}, contacts: pairs.slice(0, ${json(contactsMax)}),
      basis: 'Axis-aligned bounding boxes of the parts on stage, computed from the scene graph; pairs in the same space only.',
      limits: 'A box contact is a candidate: round or rotated parts can have overlapping boxes without touching, and a part inside a hollow one always overlaps it.',
    } });
  }

  if (what === 'visible') {
    const { node, anchor, ref } = refs[0];
    if (anchor) return JSON.stringify({ error: 'needs-part', ref });
    const base = { ...where(), id: node.id, kind: node.kind, space: node.space, stage: { width: stage.width, height: stage.height } };
    if (!onStage(c, node)) return JSON.stringify({ source: 'frame state', result: { ...base, visible: false, on_stage: false, reason: 'not on stage at this time (not yet introduced, faded out, or opacity 0)', basis: 'computed from the story state' } });
    const rect = c.screenRect(node);
    const inFrame = rect && rect.width > 0 && rect.height > 0
      ? Math.max(0, Math.min(rect.x + rect.width, stage.width) - Math.max(rect.x, 0)) * Math.max(0, Math.min(rect.y + rect.height, stage.height) - Math.max(rect.y, 0)) / (rect.width * rect.height)
      : rect ? 0 : null;
    const own = leafIds(c, node);
    if (node.space === '3d') {
      const pass = c.runtime.idPass({ solo: true });
      if (pass) {
        let pixels = 0, total = 0, known = true, at = null;
        for (const id of own) { const p = pass.parts[id]; if (!p) continue; pixels += p.pixels; if (typeof p.total === 'number') total += p.total; else known = false; at = at || p.at; }
        return JSON.stringify({ source: 'frame state', result: {
          ...base, visible: pixels > 0, on_stage: true, pixels, pixels_unobstructed: known ? total : null, fraction: known && total > 0 ? r4(pixels / total) : null,
          in_frame: r4(inFrame), screen: rect4(rect), at: at ? { x: r4(at.x), y: r4(at.y) } : null,
          basis: 'measured: a flat-colour id pass of the 3D panel (' + pass.width + ' x ' + pass.height + ' px buffer). pixels = what shows; pixels_unobstructed = the part drawn alone; fraction = their ratio.',
          limits: 'Only other 3D parts and the edge of the panel hide pixels in this count; 2D objects and labels drawn over the panel are not counted.',
        } });
      }
    }
    const cxp = rect ? rect.x + rect.width / 2 : 0, cyp = rect ? rect.y + rect.height / 2 : 0;
    const top = rect ? c.runtime.pick(cxp, cyp) : null;
    return JSON.stringify({ source: 'frame state', result: {
      ...base, visible: !!rect && (inFrame || 0) > 0, on_stage: true, opacity: r4(frame.opacity(node)), in_frame: r4(inFrame), screen: rect4(rect),
      top_at_center: top ? top.id : null, covered: top && !own.includes(top.id) ? 'the centre of its box shows #' + top.id : 'unknown',
      basis: 'computed: the layout box against the frame (in_frame = the share of the box inside it); top_at_center = the object the renderer reports at the centre of the box.',
      limits: 'How much of a 2D object other objects cover is not measured: covered is unknown unless the centre shows another object.',
    } });
  }
  return JSON.stringify({ unavailable: 'unknown query ' + what });
})()`
}
