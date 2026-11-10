// four-stroke-engine: one cylinder of a petrol engine, cut open, beside the plot of its piston's height.
// Nothing is keyed by hand. One param, the crank angle, drives everything: crankSlider() moves the piston through a
// real rod (bore = stroke = 86 mm, rod 139 mm), two camshafts at half crank speed push the valves (camFollower), the
// gas is the volume between the piston crown and the head, and the spark fires once per 720 degrees. The plot's
// point is read off the mechanism; its curve is the slider-crank law, and `mimir check` holds the two together.
// Timing is the idealised one: each valve is open for exactly its own stroke, the spark fires at top dead centre.
// Colour keeps one meaning: BLUE fresh charge and intake, GREEN compression, GOLD the burn, RED exhaust, YELLOW the spark.
//   mimir shot examples/four-stroke-engine.scene.js --at crank=90     a quarter turn into the intake stroke
//   mimir query examples/four-stroke-engine.scene.js probes --at crank=450
import {
  scene, kit, crankSlider, camFollower, belt, gearPair, fourStroke, between, extrude, lathe, gas, flow, burst,
  axes, guide, line, dot, text, row, mix, expect, write, create, fadeIn, derive, flashAround, lagged,
  BLUE, BLUE_B, GREEN, GOLD, RED, RED_B, YELLOW, WHITE, GREY_B,
} from 'mimir'

const MM = 0.02 // world units per millimetre: the engine is about ten units tall
const BORE = 86, STROKE = 86, ROD = 139 // millimetres
const COMPRESSION = 10 // (swept + clearance volume) / clearance volume
const CYCLE = 720 // crank degrees per cycle: two turns
const QUARTER = CYCLE / 4 // crank degrees per stroke
const LIFT = 7.2 // valve lift, millimetres
const VALVE_X = 26 // each valve stands this far from the cylinder's axis, millimetres
const SPARK = 40 // crank degrees the spark and its flame front take
const RUN = 240 // crank degrees per second when the engine runs
const STROKES = [
  { name: '1 intake', color: BLUE },
  { name: '2 compression', color: GREEN },
  { name: '3 power', color: GOLD },
  { name: '4 exhaust', color: RED },
]
const PALE = '#E8F4E1' // a squeezed charge just before it burns
const ASH = GREY_B // burnt gas

/** a list of points in millimetres as world units @param {number[][]} points */
const mm = (points) => points.map((p) => p.map((c) => c * MM))
/** a round hole as a 20-sided outline, millimetres @param {number} x @param {number} y @param {number} r */
const round = (x, y, r) => Array.from({ length: 20 }, (_, i) => [x + r * Math.cos((i / 20) * 2 * Math.PI), y + r * Math.sin((i / 20) * 2 * Math.PI)])
/** an angle folded into one cycle; a whole number of cycles stays at the end of the cycle, not at its start @param {number} degrees */
const inCycle = (degrees) => (degrees <= 0 ? ((degrees % CYCLE) + CYCLE) % CYCLE : degrees - CYCLE * (Math.ceil(degrees / CYCLE) - 1))
/** the slider-crank law: share of the stroke the piston has come down at a crank angle @param {number} degrees */
const law = (degrees) => {
  const a = (degrees * Math.PI) / 180, r = STROKE / 2
  return (r * (1 - Math.cos(a)) + ROD - Math.sqrt(ROD * ROD - r * r * Math.sin(a) ** 2)) / STROKE
}
/** a rate that speeds up over the first share `rampIn` of the time, cruises, and slows over the last share `rampOut` */
const trapezoid = (rampIn, rampOut) => (t) => {
  const area = 1 - (rampIn + rampOut) / 2
  if (t < rampIn) return (t * t) / (2 * rampIn * area)
  if (t > 1 - rampOut) return 1 - ((1 - t) * (1 - t)) / (2 * rampOut * area)
  return (t - rampIn / 2) / area
}

export default scene({ title: 'How a four-stroke engine works' }, (s) => {
  const OPENING = 6 // seconds the engine runs before it slows
  const SLOWING = 2 // seconds it takes to stop
  const start = -QUARTER - RUN * (OPENING - SLOWING / 2) // so that it comes to rest at bottom dead centre, before the exhaust stroke
  const crank = s.param('crank', { value: start, min: start, max: 5 * CYCLE, unit: '°', label: 'Crank angle' })
  s.viewport('full') // the engine has the whole frame; the camera moves it aside when the plot arrives
  const side = s.area('right', 0.53)

  // ── crank, rod, piston ──────────────────────────────────────────────────────────────────────────────
  const crankshaft = kit.crankshaft({ id: 'crankshaft', throw: (STROKE / 2) * MM, journal: 44 * MM, length: 180 * MM })
  const rod = kit.conRod({ id: 'rod', length: ROD * MM }).allow('OCCLUDED') // declared for check: its ends are inside the piston and between the crank webs
  const piston = kit.piston({ id: 'piston', bore: BORE * MM })
  const slide = crankSlider({ id: 'slide', crank: crankshaft, rod, slider: piston, axis: 'up', angle: crank })

  // heights that follow from the mechanism, millimetres above the crank axis
  const pinToCrown = (piston.world('crown')[1] - piston.world('pin')[1]) / MM
  const crownAtTop = slide.tdc / MM + pinToCrown
  const clearance = STROKE / (COMPRESSION - 1)
  const ROOF = crownAtTop + clearance // underside of the cylinder head
  const DECK = 78 // underside of the cylinder block: clear of the counterweights
  const HALF = 60 // half the width and half the depth of the block
  const WALL = 8

  // ── the case: crankcase, cylinder, head, cam box ───────────────────────────────────────────────────
  const cylinder = kit.block({ id: 'cylinder', bore: BORE * MM, width: 2 * HALF * MM, height: (ROOF - DECK) * MM, depth: 2 * HALF * MM, shell: true })
    .at(0, ((ROOF + DECK) / 2) * MM, 0)
  const caseOutline = [[-52, DECK], [-90, DECK], [-90, -60], [-60, -90], [60, -90], [90, -60], [90, DECK], [52, DECK]]
  const caseCavity = [[52, DECK - WALL], [82, DECK - WALL], [82, -57], [57, -82], [-57, -82], [-82, -57], [-82, DECK - WALL], [-52, DECK - WALL]]
  const crankcase = extrude(mm([...caseOutline, ...caseCavity]), { id: 'crankcase', depth: 2 * HALF * MM, shell: true })
  const caseFace = mm([[-90, DECK], [-90, -60], [-60, -90], [60, -90], [90, -60], [90, DECK]])
  const caseBack = extrude(caseFace, { id: 'caseBack', depth: WALL * MM, shell: true }).attach(crankcase, { my: 'front', to: 'back' })
  const caseFront = extrude(caseFace, { id: 'caseFront', depth: WALL * MM, shell: true }).attach(crankcase, { my: 'back', to: 'front' })

  const INTAKE_HEAD = 30, EXHAUST_HEAD = 26, STEM = 7, VALVE_LENGTH = 100
  const head = extrude(mm([[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]]), {
    id: 'head', depth: WALL * MM, shell: true,
    holes: [mm(round(-VALVE_X, 0, INTAKE_HEAD / 2 + 0.6)), mm(round(VALVE_X, 0, EXHAUST_HEAD / 2 + 0.6)), mm(round(0, 0, 5.4))],
  }).rotate({ about: 'x', deg: 90 }).at(0, (ROOF + WALL / 2) * MM, 0)

  const PORT = ROOF + WALL + 30 // centre line of both ports
  const FLOOR = ROOF + 62 // underside of the cam box
  const BASE = 17.5 // base circle radius of a cam: the smallest that gives this lift in a quarter turn of the cam is 2.41 × the lift
  const CAM = ROOF + VALVE_LENGTH + BASE // cam axes: the face of a shut valve is flush with the roof
  const TOP = CAM + BASE + LIFT + 12
  const boxOutline = [[-HALF, FLOOR], [HALF, FLOOR], [HALF, TOP], [-HALF, TOP]]
  const boxCavity = [[-HALF + 6, FLOOR + 6], [HALF - 6, FLOOR + 6], [HALF - 6, TOP - 6], [-HALF + 6, TOP - 6]]
  const camBox = extrude(mm(boxOutline), { id: 'camBox', depth: 2 * HALF * MM, shell: true, holes: [mm(boxCavity)] })
  const coverOutline = mm([[-HALF, ROOF + WALL], [HALF, ROOF + WALL], [HALF, TOP], [-HALF, TOP]])
  const headBack = extrude(coverOutline, { id: 'headBack', depth: WALL * MM, shell: true }).attach(camBox, { my: 'front', to: 'back' })
  const headFront = extrude(coverOutline, { id: 'headFront', depth: WALL * MM, shell: true }).attach(camBox, { my: 'back', to: 'front' })

  // ── ports: each starts on its valve seat ───────────────────────────────────────────────────────────
  const intakePath = [[-VALVE_X, ROOF + WALL, 0], [-VALVE_X, PORT, 0], [-150, PORT, 0]]
  const exhaustPath = [[VALVE_X, ROOF + WALL, 0], [VALVE_X, PORT, 0], [122, PORT, 0], [122, ROOF - 70, 0]]
  const intakePort = kit.pipe(mm(intakePath), { id: 'intakePort', radius: 15 * MM, thickness: 2.5 * MM, bend: 20 * MM, shell: true })
  const exhaustPort = kit.pipe(mm(exhaustPath), { id: 'exhaustPort', radius: 13.5 * MM, thickness: 2.5 * MM, bend: 20 * MM, shell: true })

  // ── valve gear: two camshafts at half crank speed, one lobe each, a valve under each lobe ───────────
  const lobe = { baseRadius: BASE * MM, lift: LIFT * MM, duration: QUARTER / 2, lobeWidth: 14 * MM, radius: 7 * MM }
  const intakeCamshaft = kit.camshaft({ id: 'intakeCamshaft', length: 150 * MM, lobes: [{ offset: -15 * MM, angle: 0 }], ...lobe }).at(-VALVE_X * MM, CAM * MM, 15 * MM)
  const exhaustCamshaft = kit.camshaft({ id: 'exhaustCamshaft', length: 120 * MM, lobes: [{ offset: 0, angle: 0 }], ...lobe }).at(VALVE_X * MM, CAM * MM, 0)
  const intakeValve = kit.valve({ id: 'intakeValve', head: INTAKE_HEAD * MM, stem: STEM * MM, length: VALVE_LENGTH * MM, color: () => mix(BLUE, BLUE_B, intake.lift() / intake.maxLift) }) // lighter as it opens
  const exhaustValve = kit.valve({ id: 'exhaustValve', head: EXHAUST_HEAD * MM, stem: STEM * MM, length: VALVE_LENGTH * MM, color: () => mix(RED, RED_B, exhaust.lift() / exhaust.maxLift) })
  // a lobe is at full lift in the middle of its stroke: 90 degrees of crank for intake, 630 for exhaust.
  // the two camshafts are geared together, so the second one turns the other way round
  const intake = camFollower({ id: 'intake', cam: intakeCamshaft, lobe: 1, follower: intakeValve, axis: 'down', angle: () => (crank() - QUARTER / 2) / 2 })
  const exhaust = camFollower({ id: 'exhaust', cam: exhaustCamshaft, lobe: 1, follower: exhaustValve, axis: 'down', angle: () => -(crank() - (CYCLE - QUARTER / 2)) / 2 })
  const springs = [intakeValve, exhaustValve].map((valve, i) =>
    kit.spring({ id: i ? 'exhaustSpring' : 'intakeSpring', radius: 8 * MM, wire: 2.2 * MM, turns: 5 })
      .span([(i ? VALVE_X : -VALVE_X) * MM, (FLOOR + 6) * MM, 0], valve.anchor('tip'))
      .allow('MECH-OPEN')) // declared for check: a spring is meant to change length

  // timing drive: a belt from the crank to a pulley twice its size, and a pair of equal gears between the camshafts
  const crankPulley = kit.pulley({ id: 'crankPulley', radius: 20 * MM, width: 12 * MM }).attach(crankshaft, { my: 'front', to: 'nose' })
  const camPulley = kit.pulley({ id: 'camPulley', radius: 40 * MM, width: 12 * MM }).attach(intakeCamshaft, { my: 'front', to: 'front' })
  const timing = belt(crankPulley, camPulley, { id: 'timing' })
  const TEETH = 16
  const gearOptions = { teeth: TEETH, module: ((2 * VALVE_X) / TEETH) * MM, width: 8 * MM } // pitch circles that touch half way between the camshafts
  const intakeGear = kit.gear({ id: 'intakeGear', ...gearOptions }).attach(intakeCamshaft, { my: 'back', to: 'back' })
  const exhaustGear = kit.gear({ id: 'exhaustGear', ...gearOptions })
  gearPair(intakeGear, exhaustGear, { id: 'camGears', direction: 'right' })
  exhaustCamshaft.allow('INTERPENETRATE', exhaustGear) // declared for check: the gear is pressed onto its shaft

  // ── spark plug: between the valves, its electrode just inside the chamber ───────────────────────────
  const plug = lathe(mm([[0, -4], [1.2, -4], [1.2, 0], [5, 0], [5, 14], [8, 14], [8, 24], [5.5, 24], [4.5, 50], [2.5, 50], [2.5, 56], [0, 56]]), { id: 'plug' })
    .attach(cylinder, { my: 'bottom', to: 'deck', gap: -4 * MM })

  // ── the state of the cycle, all of it from the crank angle ──────────────────────────────────────────
  const stroke = fourStroke(crank)
  const angle = s.signal(() => inCycle(crank())) // 0 … 720 within the cycle
  const height = s.signal(() => STROKE * (1 - slide.fraction())) // of the piston above bottom dead centre, millimetres
  const sinceSpark = s.signal(() => (((crank() - CYCLE / 2) % CYCLE) + CYCLE) % CYCLE) // crank degrees since the last firing
  const flame = s.signal(() => Math.min(1, sinceSpark() / SPARK)) // 0 at the spark … 1 when the charge is alight
  const sparking = () => sinceSpark() > 0 && sinceSpark() < SPARK
  const sparks = () => Math.max(0, Math.floor((crank() + CYCLE / 2) / CYCLE)) // firings since crank angle 0
  // gas: its volume is the cylinder between crown and roof; its mass is constant while both valves are shut
  const gap = () => (cylinder.world('deck')[1] - piston.world('crown')[1]) / MM // crown to roof, measured on the model
  const volume = () => gap() / clearance // in clearance volumes: 1 at the top … COMPRESSION at the bottom
  const density = () => (stroke().name === 'compression' || stroke().name === 'power' ? 1 / volume() : 1 / COMPRESSION)
  const gasColor = () => {
    const { name, progress } = stroke()
    if (name === 'intake') return BLUE
    if (name === 'compression') return progress < 0.6 ? mix(BLUE, GREEN, progress / 0.6) : mix(GREEN, PALE, (progress - 0.6) / 0.4)
    if (name === 'power') return flame() < 1 ? mix(PALE, GOLD, flame()) : mix(GOLD, ASH, Math.max(0, (progress - 0.7) / 0.3))
    return ASH
  }
  const chamber = between(piston.anchor('crown'), cylinder.anchor('deck'), { id: 'chamber', radius: (BORE / 2 - 1) * MM }).allow('MECH-OPEN') // declared for check: the gas is squeezed
  const charge = gas(chamber, { id: 'charge', color: gasColor, density: () => 0.3 + 0.7 * density(), particles: 90 })
  const intakeOpen = () => intake.lift() / intake.maxLift
  const exhaustOpen = () => exhaust.lift() / exhaust.maxLift
  const fresh = flow(mm([...intakePath].reverse().concat([[-VALVE_X, ROOF - 8, 0]])), {
    id: 'fresh', count: 40, size: 0.09, glow: 0.8, spread: 9 * MM, color: BLUE_B, phase: () => crank() / QUARTER * 2, active: intakeOpen,
  })
  const burnt = flow(mm([[VALVE_X, ROOF - 8, 0], ...exhaustPath, [122, ROOF - 110, 0]]), {
    id: 'burnt', count: 44, size: 0.09, spread: 8 * MM, color: ASH, phase: () => crank() / QUARTER * 2, active: exhaustOpen,
  })
  // the spark is drawn flat, on top of the picture, where the electrode is seen
  const electrode = dot(plug.anchor('bottom'), { id: 'electrode', color: YELLOW, radius: 0.05 }).opacity(() => (sparking() ? 1 : 0)).allow('TINY')
  const spark = burst(electrode, { id: 'spark', count: 14, color: YELLOW, radius: 0.5, progress: flame, opacity: () => (sparking() ? 1 : 0) })

  // ── what check must hold the scene to ───────────────────────────────────────────────────────────────
  s.probe('crankAngle', () => crank())
  s.probe('travelPercent', () => 100 * slide.fraction())
  s.probe('rodLength', () => Math.hypot(...rod.world('bigEnd').map((c, i) => c - rod.world('smallEnd')[i])) / MM)
  s.probe('rodAngle', () => slide.rodAngle())
  s.probe('intakeLift', () => intake.lift() / MM)
  s.probe('exhaustLift', () => exhaust.lift() / MM)
  s.probe('intakeCamTurn', () => intake.angle() + QUARTER / 4) // cam degrees since crank angle 0
  s.probe('camPulleyRatio', () => timing.ratio)
  s.probe('stroke', () => stroke().index + 1)
  s.probe('volume', volume)
  s.probe('sparks', sparks)
  s.probe('valveGap', () => (Math.min(intakeValve.world('head')[1], exhaustValve.world('head')[1]) - piston.world('crown')[1]) / MM)
  expect.conserved('rodLength')
  expect.ratio('intakeCamTurn', 'crankAngle', 0.5) // cams at half crank speed
  expect.above(intakeValve, piston)
  expect.above(exhaustValve, piston)
  const shut = (lift) => Math.abs(lift) < 1e-6
  s.expect('the plotted curve is the piston: the slider-crank law for this rod', () => Math.abs(law(crank()) - slide.fraction()) < 1e-6)
  s.expect('a quarter turn brings the piston 57.9 % down its stroke', () => Math.abs(law(QUARTER / 2) - 0.579) < 5e-4)
  s.expect('both valves are shut through compression and power', () => !(stroke().name === 'compression' || stroke().name === 'power') || (shut(intake.lift()) && shut(exhaust.lift())))
  s.expect('the intake valve opens only on the intake stroke', () => shut(intake.lift()) || stroke().name === 'intake')
  s.expect('the exhaust valve opens only on the exhaust stroke', () => shut(exhaust.lift()) || stroke().name === 'exhaust')
  s.expect('the spark comes only at the top of compression, with both valves shut', () => !sparking() || (stroke().name === 'power' && shut(intake.lift()) && shut(exhaust.lift())))
  s.expect('one spark for every two turns of the crank', () => crank() < 0 || sparks() === Math.floor((crank() / 360 + 1) / 2))
  s.expect('the gas is never squeezed further than the compression ratio', () => volume() > 1 - 1e-6 && volume() < COMPRESSION + 1e-6)

  // ── the plot: as tall on screen as the stroke itself, so the piston's height carries straight across ──
  cylinder.define('wall', [-((BORE / 2 + HALF) / 2) * MM, 0, 0]) // the middle of the cut wall, for its label
  const RIM = (BORE / 2) * MM
  cylinder.define('top', [RIM, crownAtTop * MM - cylinder.world()[1], 0])
  cylinder.define('bottom', [RIM, (crownAtTop - STROKE) * MM - cylinder.world()[1], 0])
  piston.define('rim', [RIM, piston.world('crown')[1] - piston.world()[1], 0])
  // an unseen measuring line down the cylinder wall, from the crown's highest place to its lowest: where it is drawn
  // on screen gives the plot its height and its place, so one millimetre of piston is one millimetre of plot
  const travel = line(cylinder.anchor('top'), cylinder.anchor('bottom'), { id: 'travel', opacity: 0 })
  const plot = axes({
    id: 'plot', x: [0, CYCLE], y: [0, STROKE], width: side.width - 1.5, height: () => travel.height(),
    xLabel: 'crank angle', yLabel: 'piston height', xUnit: '°', ticks: { x: QUARTER, y: false },
  }).at(side.center[0] + 0.1, () => travel.center()[1])
  const curve = plot.plot((x) => STROKE * (1 - law(x)), { id: 'curve', to: () => Math.min(CYCLE, Math.max(0, crank())), colorAt: (x) => STROKES[Math.min(3, Math.floor(x / QUARTER))].color })
  // the point of the plot is the piston itself, read off the mechanism. When a cycle ends it starts again at the left:
  // it fades in there over the first degrees while its echo fades at the right end, so nothing jumps
  const WRAP = 24 // crank degrees the hand-over takes
  const again = () => (crank() > CYCLE ? Math.min(1, angle() / WRAP) : 1)
  const cursor = plot.dot(() => [angle(), height()], { id: 'cursor', color: WHITE, radius: 0.09 }).opacity(again)
  const echo = plot.dot(() => [CYCLE, height()], { id: 'echo', color: WHITE, radius: 0.09 }).opacity(() => 1 - again())
  cursor.allow('TINY') // declared for check: a dot is small by nature
  echo.allow('TINY')
  // the tie runs level from the crown to the point; once the first cycle is drawn it reaches right across the plot
  const tie = guide(piston.anchor('rim'), plot.toFrame(() => [Math.min(CYCLE, Math.max(0, crank())), height()]), { id: 'tie' })
  const names = STROKES.map((st, i) => plot.mark(QUARTER * (i + 0.5), st.name, { id: `stroke${i + 1}`, color: st.color, size: 'note' })
    .opacity(() => (Math.min(3, Math.max(0, Math.ceil(angle() / QUARTER) - 1)) === i ? 1 : 0.55))) // the stroke it is in is the brightest
  const turns = [plot.bracket(0, CYCLE / 2, 'turn 1', { id: 'turn1', level: 0, color: GREY_B }), plot.bracket(CYCLE / 2, CYCLE, 'turn 2', { id: 'turn2', level: 0, color: GREY_B })]
  const bang = plot.dot([CYCLE / 2, STROKE], { id: 'bang', color: GOLD, radius: 0.07 }).allow('TINY') // where the curve fires
  const flash = burst(plot.toFrame(CYCLE / 2, STROKE), { id: 'flash', count: 12, color: GOLD, radius: 0.34, progress: flame, opacity: () => (sparking() ? 1 : 0) })
  const title = text('Four strokes', { id: 'title', size: 'title' }).at(side.center[0], side.center[1])
  const closing = row([text('two turns,', { id: 'twoTurns', size: 'section' }), text('one bang', { id: 'oneBang', size: 'section', color: GOLD })], { id: 'closing', gap: 0.3 })
    .nextTo(plot, 'up', 0.8)

  // what the section plane cuts: the case, the ports, the plug, the gas, and the timing drive in front of it
  const sliced = [cylinder, crankcase, caseBack, caseFront, head, camBox, headBack, headFront, intakePort, exhaustPort, plug, crankPulley, camPulley, timing.part, chamber, charge]
  // the camera: a front three-quarter view. `beside(d)` is a point d units to the camera's right of the engine's axis;
  // looking at it puts the engine left of centre, which is how the engine makes room for the plot
  const AZIMUTH = 24, ELEVATION = 7
  const MIDDLE = ((TOP - 90) / 2) * MM
  const beside = (d) => [d * Math.cos((AZIMUTH * Math.PI) / 180), MIDDLE, -d * Math.sin((AZIMUTH * Math.PI) / 180)]
  const view = /** @type {const} */ ({ azimuth: AZIMUTH, elevation: ELEVATION, fit: true, zoom: 1.06 })
  const aside = { ...view, target: beside(4.2) }
  s.ghost(true)

  // ── the story ───────────────────────────────────────────────────────────────────────────────────────
  const engine = [crankshaft, rod, piston, cylinder, crankcase, caseBack, caseFront, head, camBox, headBack, headFront, intakePort, exhaustPort,
    intakeCamshaft, exhaustCamshaft, intakeValve, exhaustValve, ...springs, crankPulley, camPulley, timing.part, intakeGear, exhaustGear, plug, chamber, charge, fresh, burnt, electrode, spark]
  const valveNames = (st) => {
    st.label(intakeValve, 'intake valve')
    st.label(exhaustValve, 'exhaust valve')
  }

  s.chapter('An engine, running')
  s.step('Four strokes', (st) => {
    st.say('This engine turns fuel into motion, and it does it in four moves.')
    st.camera({ view: 'iso', azimuth: 58, duration: 0 })
    st.camera({ view: 'iso', duration: OPENING }) // a slow turn that ends on the camera's own view: a chapter starts from there
    st.play(crank.to(-QUARTER, { duration: OPENING, rate: trapezoid(0, SLOWING / OPENING) }), write(title, { span: [2.6, 4] }))
  })

  s.chapter('Inside, one stroke at a time', { keep: engine })
  s.step('Slice it open', (st) => {
    st.say('Normally all this is sealed in a metal case, so let\'s slice it open and look inside.')
    st.ghost(false, { duration: 1.5 })
    st.camera({ ...view, duration: 2.5 })
    st.wait(2.5)
    st.cutaway({ axis: 'z', at: 0, parts: sliced }, { duration: 3 })
    st.wait(3)
  })
  s.step('The parts', (st) => {
    st.say('The [piston](label:piston) slides up and down in the [cylinder](label:cylinder.wall).')
    st.say('A [connecting rod](label:rod) ties it to the [crankshaft](label:crankshaft): up and down becomes round and round.')
    st.say('The [intake valve](label:intakeValve) lets fresh gas in, the [exhaust valve](label:exhaustValve) lets burnt gas out, and a [spark plug](label:plug) sits between them.')
    st.say('A [camshaft](label:intakeCamshaft) over each valve pushes it open, turning half as fast as the crank.')
    st.set(crank, 0)
  })
  s.step('Piston height', (st) => {
    st.say('To keep track of the crank as it turns, follow the [height of the piston](piston.rim).')
    st.note(`Bore and stroke are ${BORE} mm, the rod is ${ROD} mm. Because the rod leans, the piston is not half way down after a quarter turn but ${(100 * law(QUARTER / 2)).toFixed(1)} % of the way.`)
    valveNames(st)
    st.camera({ ...aside, duration: 2 })
    st.wait(2)
    st.play(create(plot))
    st.play(derive(piston, cursor, { duration: 1.5 }))
    st.play(create(tie))
  })
  STROKES.forEach((one, i) => {
    const say = [
      'The [intake valve](glow:intakeValve) opens, and the falling piston draws in fresh charge.',
      'Both valves shut, and the rising piston squeezes the charge.',
      'A [spark](glow:plug), and the burning gas drives the piston down.',
      'The [exhaust valve](glow:exhaustValve) opens, and the piston pushes the burnt gas out.',
    ][i]
    s.step(one.name[2].toUpperCase() + one.name.slice(3), (st) => {
      st.say(say)
      if (i === 0) st.note('The timing here is the textbook one: each valve is open for exactly its own stroke and the spark comes at top dead centre. A real engine opens its valves a little early, shuts them a little late, and fires a few degrees before the top.')
      if (i === 1) st.note(`Squeezed to a ${COMPRESSION}th of its volume: the compression ratio is ${COMPRESSION} : 1.`)
      valveNames(st)
      st.play(write(names[i]))
      if (i === 2) st.play(flashAround(plug))
      st.play(crank.to(QUARTER * (i + 1), { duration: 4, rate: i === 2 ? trapezoid(0.05, 0.2) : trapezoid(0.125, 0.125) }))
    })
  })
  s.step('The whole cycle', (st) => {
    st.say('Run the four together: down, up, down, up.')
    valveNames(st)
    st.play(crank.to(3 * CYCLE, { duration: 8, rate: trapezoid(0.25, 0.15) }))
  })
  s.step('Two turns, one bang', (st) => {
    st.say('That is [two full turns](glow:turn1+turn2) of the crank, and only one stroke in four is a [bang](ring:bang).')
    valveNames(st)
    st.play(lagged(turns.map((t) => create(t)), { lag: 0.5 }), fadeIn(bang, { span: [1, 2] }))
    st.play(crank.to(5 * CYCLE, { duration: 9, rate: trapezoid(0.2, 0.2) }), write(closing, { span: [2.5, 4.5] }))
  })
})
