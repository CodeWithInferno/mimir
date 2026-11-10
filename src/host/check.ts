// The debug overlay of `mimir shot --debug ids | boxes | safe` and `?debug=`: boxes, ids, the text a kind draws itself,
// the visible point of every 3D part, the safe area. A development tool, so it lives in the dev chunk (this file name
// puts it there) and costs the viewer nothing: __mimir.debug(mode) loads the chunk on first use.
import { defineOverlay, kindOf, SAFE_X, SAFE_Y, type Frame } from '../core/index.ts'

defineOverlay({
  name: 'host.debug',
  z: 90,
  create(c) {
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%')
    c.root.appendChild(svg)
    return {
      paint(frame: Frame) {
        const mode = c.runtime.debugMode
        if (!mode) { if (svg.childNodes.length) svg.textContent = ''; return }
        let out = ''
        const st = c.stage()
        if (mode === 'safe' || mode === 'ids' || mode === 'boxes') {
          const a = c.runtime.screenToStage([-SAFE_X, SAFE_Y]), b = c.runtime.screenToStage([SAFE_X, -SAFE_Y])
          out += `<rect x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${(b.x - a.x).toFixed(1)}" height="${(b.y - a.y).toFixed(1)}" fill="none" stroke="#5CD0B3" stroke-width="1" stroke-dasharray="6 5" opacity=".7"/>`
        }
        if (mode === 'ids' || mode === 'boxes') {
          const fs = Math.max(10, st.width / 110)
          for (const n of frame.visibleLeaves()) {
            const r = c.screenRect(n)
            if (!r) continue
            const col = n.invalid ? '#FF3B30' : n.space === '3d' ? '#FFFF00' : '#58C4DD'
            out += `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${Math.max(1, r.width).toFixed(1)}" height="${Math.max(1, r.height).toFixed(1)}" fill="none" stroke="${col}" stroke-width="1" opacity=".85"/>`
            // text a kind draws itself (KindDef.textRects), as the text rules see it
            for (const t of frame.textRects(n)) { if (kindOf(n.kind)?.text) break; const q = c.runtime.rectToStage(t.rect); out += `<rect x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}" width="${q.width.toFixed(1)}" height="${q.height.toFixed(1)}" fill="none" stroke="#FC6255" stroke-width="1" stroke-dasharray="3 3"/>` }
            // the pixel of a 3D part that labels and the pointer should anchor on: really visible, near the middle of what shows
            const at = n.space === '3d' ? c.visiblePoint(n) : null
            if (at) out += `<path data-at="${n.id.replace(/[<&>"]/g, '')}" d="M${(at.x - 5).toFixed(1)} ${at.y.toFixed(1)}h10M${at.x.toFixed(1)} ${(at.y - 5).toFixed(1)}v10" stroke="${col}" stroke-width="1.5"/>`
            if (mode === 'ids') out += `<text x="${(r.x + 3).toFixed(1)}" y="${(r.y - 3).toFixed(1)}" fill="${col}" font-family="ui-monospace,Menlo,monospace" font-size="${fs.toFixed(1)}" paint-order="stroke" stroke="#000" stroke-width="3">${n.id.replace(/[<&>]/g, '')}</text>`
          }
        }
        svg.innerHTML = out
      },
      dispose() { svg.remove() },
    }
  },
})

