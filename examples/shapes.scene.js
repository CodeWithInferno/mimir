// shapes: the 2D frame in four short chapters. Type (the size ladder and the faces), every shape and what an outline
// gives you (arrows stop on it, a dot rides it), arrows, and layout (grid, ring, edges, fit, zoom). Nothing is placed by
// trigonometry: positions come from containers and relations.
import {
  scene, text, rect, circle, ellipse, dot, polyline, polygon, path, arc, brace, line, arrow, row, column, grid, ring,
  write, create, fadeIn, lagged, BLUE, TEAL, GREEN, YELLOW, RED, GREY_B, GREY_C, UL, UR,
} from 'mimir'

export default scene({ title: 'The 2D frame' }, (s) => {
  const angle = s.param('angle', { value: 40, min: 0, max: 330, unit: '°', label: 'Arc angle' })
  const travel = s.param('travel', { value: 0, min: 0, max: 1, label: 'Along the path' })

  // a title that stays put: it is in screen space, so the 2D camera does not move it
  const title = text('The 2D frame', { id: 'title', size: 'section' }).toEdge('up', 0.45).hud()

  // ── Type ───────────────────────────────────────────────────────────────────────────────────────────
  s.chapter('Type', { keep: [title] })
  const sizes = [
    text('title', { size: 'title' }),
    text('section', { size: 'section' }),
    text('body', { size: 'body' }),
    text('label', { size: 'label' }),
    text('note', { size: 'note' }),
  ]
  const ladder = column(sizes, { gap: 0.28, align: 'left' })
  const voices = [
    text('Roman 0123456789'),
    text('Italic, a second voice', { italic: true }),
    text('Bold for headwords', { weight: 'bold' }),
    text('v = ωr', { font: 'math' }),
    text('two lines,\nleft aligned', { size: 'label', align: 'left', color: GREY_B }),
  ]
  const faces = column(voices, { gap: 0.34, align: 'left' })
  row([ladder, faces], { gap: 1.6, align: 'top' }).at(0, -0.35)
  const rule = line(ladder.ur, ladder.dr, { color: GREY_C, strokeWidth: 1 }).shift(0.8, 0)

  s.step('Sizes and faces', (st) => {
    st.say('Text is set in Computer Modern, in five named sizes.')
    st.play(write(title))
    st.play(lagged(sizes.map((t) => write(t)), { lag: 0.25 }))
    st.play(create(rule), lagged(voices.map((t) => fadeIn(t, { shift: [0, 0.2] })), { lag: 0.15 }))
  })

  // ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────
  s.chapter('Shapes', { keep: [title] })
  const curve = path('M -0.9 -0.35 C -0.4 0.9, 0.4 -0.9, 0.9 0.35', { id: 'curve', color: BLUE, strokeWidth: 4 })
  const sweep = arc({ id: 'sweep', radius: 0.55, from: 0, to: () => angle(), color: YELLOW, strokeWidth: 3 })
  const shapes = {
    rect: rect({ width: 1.5, height: 1, radius: 0.18, color: BLUE }).fill(BLUE, 0.2),
    circle: circle({ radius: 0.5, color: TEAL }),
    ellipse: ellipse({ radiusX: 0.85, radiusY: 0.5, color: GREEN }).fill(GREEN, 0.2),
    polygon: polygon([[-0.65, -0.45], [0.65, -0.45], [0, 0.55]], { color: YELLOW }),
    polyline: polyline([[-0.8, -0.35], [-0.3, 0.4], [0.2, -0.35], [0.8, 0.4]], { color: GREEN }),
    path: curve,
    arc: sweep,
    dot: dot({ radius: 0.12, color: TEAL }),
  }
  const cells = Object.entries(shapes).map(([name, shape]) => column([shape, text(name, { size: 'note', color: GREY_B })], { gap: 0.22 }))
  const sheet = grid(cells, { id: 'sheet', columns: 4, gap: 0.85, align: 'bottom' }).at(0, 0.35)
  // an end given as an object stops on that object's outline, whatever its shape
  const links = [arrow(shapes.rect, shapes.circle), arrow(shapes.circle, shapes.ellipse), arrow(shapes.ellipse, shapes.polygon, { bend: -35 })]
  const rider = dot(curve.pointAt(() => travel()), { id: 'rider', radius: 0.09, color: YELLOW })
  const reading = text(() => `${Math.round(angle())}°`, { id: 'reading', size: 'note', color: YELLOW }).nextTo(sweep, 'right', 0.2)
  const under = brace(sheet, 'down', { id: 'under' })
  const count = text('eight kinds, one outline each', { size: 'label' }).nextTo(under, 'down', 0.15)

  s.step('Every kind', (st) => {
    st.say('Eight shapes. Each is drawn from its outline, so each can be drawn on.')
    st.play(lagged(cells.map((c) => create(c)), { lag: 0.12 }), { duration: 2 })
    st.play(create(under), write(count))
  })
  s.step('What an outline gives', (st) => {
    st.say('Arrows stop on the outline, a dot can ride it, and an arc follows a number.')
    st.play(lagged(links.map((l) => create(l)), { lag: 0.3 }))
    st.play(fadeIn(rider), fadeIn(reading))
    st.set(travel, 1)
    st.set(angle, 300)
  })

  // ── Arrows ─────────────────────────────────────────────────────────────────────────────────────────
  s.chapter('Arrows', { keep: [title] })
  const variants = [
    { name: 'plain', options: {} },
    { name: 'bend: 50', options: { bend: 50 } },
    { name: 'dashed', options: { dashed: true, strokeWidth: 2 } },
    { name: 'both: true', options: { both: true, strokeWidth: 2, color: TEAL } },
    { name: 'strokeWidth: 7', options: { strokeWidth: 7, color: YELLOW } },
  ]
  const lanes = variants.map((v) => {
    const from = dot({ radius: 0.06, color: GREY_C }), to = dot({ radius: 0.06, color: GREY_C })
    const ends = row([from, to], { gap: 2.6 })
    return { lane: column([ends, text(v.name, { size: 'note', color: GREY_B })], { gap: 0.3 }), shaft: arrow(from, to, v.options) }
  })
  const rack = grid(lanes.map((l) => l.lane), { columns: 2, gap: 0.9 }).at(-2.9, -0.3)
  // a hub and a ring of satellites: the ring spaces them, the lines and arrows find their own ends
  const moons = Array.from({ length: 6 }, (_, i) => circle({ radius: 0.2, color: i % 2 ? TEAL : GREEN }))
  const orbit = ring(moons, { id: 'orbit', radius: 1.7 }).at(4, -0.3)
  const hub = circle({ id: 'hub', radius: 0.42, color: BLUE }).fill(BLUE, 0.25).at(orbit)
  const spokes = moons.map((m, i) => (i % 2 ? line(hub, m, { color: GREY_C, dashed: true }) : arrow(hub, m, { strokeWidth: 2 })))

  s.step('Heads, bends and dashes', (st) => {
    st.say('An arrow grows from its tail with the head in front. It can bend, be dashed, or point both ways.')
    st.play(fadeIn(rack))
    st.play(lagged(lanes.map((l) => create(l.shaft)), { lag: 0.2 }))
    st.play(create(hub), lagged(moons.map((m) => create(m)), { lag: 0.08 }))
    st.play(lagged(spokes.map((sp) => create(sp)), { lag: 0.08 }))
  })

  // ── Layout ─────────────────────────────────────────────────────────────────────────────────────────
  s.chapter('Layout', { keep: [title] })
  const left = s.area('left', 0.5), right = s.area('right', 0.5)
  const panels = [left, right].map((a) => rect({ width: a.width, height: 4.4, radius: 0.12, color: GREY_C, strokeWidth: 1, dashed: true }).at(a.center[0], -0.35))
  // numbers that belong to the picture grow with it when the camera moves in; notes keep their size
  const tiles = Array.from({ length: 9 }, (_, i) => rect({ id: `tile${i + 1}`, width: 1, height: 0.62, radius: 0.08, color: i === 4 ? YELLOW : BLUE }).fill(i === 4 ? YELLOW : BLUE, 0.2))
  const board = grid(tiles, { id: 'board', columns: 3, gap: 0.25 }).fit(panels[0], { padding: 0.8 })
  const names = tiles.map((t, i) => text(String(i + 1), { size: 'label', scaleWithZoom: true }).at(t))
  const beads = Array.from({ length: 10 }, (_, i) => dot({ radius: 0.11, color: i ? TEAL : YELLOW }))
  const wheel = ring(beads, { id: 'wheel' }).fit(panels[1], { padding: 0.9 })
  const notes = [
    text('grid(items, { columns: 3 })', { size: 'note', color: GREY_B }).nextTo(panels[0], 'down', 0.2).alignTo(panels[0], 'left'),
    text('ring(items)', { size: 'note', color: GREY_B }).nextTo(panels[1], 'down', 0.2).alignTo(panels[1], 'left'),
    text('toEdge(UL)', { size: 'note', color: GREY_C }).toEdge(UL, 0.3).hud(),
    text('toEdge(UR)', { size: 'note', color: GREY_C }).toEdge(UR, 0.3).hud(),
  ]

  s.step('Containers and edges', (st) => {
    st.say('A grid and a ring place their items. Each is fitted into half of the frame.')
    st.play(lagged(panels.map((p) => create(p)), { lag: 0.3 }))
    st.play(lagged(tiles.map((t) => create(t)), { lag: 0.05 }), lagged(beads.map((b) => fadeIn(b, { scale: 0.3 })), { lag: 0.05 }))
    st.play(lagged([...names, ...notes].map((n) => fadeIn(n)), { lag: 0.04 }))
  })
  s.step('Zoom', (st) => {
    st.say('The camera moves in on the grid. Lines keep their weight; the numbers grow with the picture.')
    st.zoom(board, { margin: 1.5 })
  })
})
