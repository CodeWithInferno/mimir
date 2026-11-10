// gear-train: three meshing gears. gearTrain() puts each gear at the meshing distance of the one before it and
// phases the teeth; the scene only says how many teeth each gear has and how far the first one is turned.
// Every number shown is read back from the mechanism: train.turned(i) and train.ratio.
import { scene, kit, gearTrain, text, column, BLUE, GOLD, GREY_B, TEAL, WHITE } from 'mimir'

export default scene({ title: 'How gears trade speed for force' }, (s) => {
  const turn = s.param('turn', { value: 0, min: 0, max: 1080, unit: '°', label: 'Driver angle' })
  s.viewport('right', 0.64)

  // ── the model: gears face the viewer by default; only the first one is placed ───────────────────────
  const driver = kit.gear({ id: 'driver', teeth: 12, module: 0.3, width: 0.6, bore: 0.5, hub: 1.2, color: GOLD }).at(-4.2, -1.4, 0)
  const idler = kit.gear({ id: 'idler', teeth: 24, module: 0.3, width: 0.6, bore: 0.5, hub: 1.2 })
  const output = kit.gear({ id: 'output', teeth: 36, module: 0.3, width: 0.6, bore: 0.5, hub: 1.2, color: BLUE })
  const train = gearTrain([driver, idler, output], { id: 'train', angle: turn, direction: ['right', 35] })

  s.probe('ratio', () => train.ratio)
  s.probe('idlerTurned', () => train.turned(1))
  s.probe('outputTurned', () => train.turned(2))

  // ── the numbers, beside the model ───────────────────────────────────────────────────────────────────
  const side = s.area()
  const turns = (deg = 0) => `${(Math.round(deg / 3.6) / 100 + 0).toFixed(2)} turns`
  const title = text('Teeth set the ratio', { size: 'body' })
  const line1 = text(() => `driver, 12 teeth:  ${turns(train.turned(0))}`, { size: 'label', color: GOLD })
  const line2 = text(() => `idler, 24 teeth:  ${turns(train.turned(1))}`, { size: 'label', color: GREY_B })
  const line3 = text(() => `output, 36 teeth:  ${turns(train.turned(2))}`, { size: 'label', color: BLUE })
  const ratio = text(() => `ratio  ${train.ratio} : 1`, { size: 'label', color: WHITE })
  column([title, line1, line2, line3, ratio], { gap: 0.34, align: 'left' }).at(side.center[0], 0.9)

  s.step('Three gears', (st) => {
    st.say('Three gears in a row. Their teeth are the same size, so they mesh: a tooth of one sits in a gap of the next.')
    st.camera({ view: 'front' })
    st.label(driver, 'driver')
    st.label(idler, 'idler')
    st.label(output, 'output')
    st.wait(2.5)
  })

  s.step('One turn in', (st) => {
    st.say('Turn the small gear once. Each tooth pushes one tooth along, so the middle gear makes only half a turn, the other way round.')
    st.set(turn, 360)
    st.focus(driver, idler, line1, line2)
  })

  s.step('Three turns in, one turn out', (st) => {
    st.say('The big gear has three times the teeth of the small one. Three turns in give one turn out, slower and with three times the twist.')
    st.camera({ view: 'iso' })
    st.set(turn, 1080)
    st.focus(driver, output, line1, line3, ratio)
    st.play(output.to.color(TEAL))
  })
})
