// Stub of the lazy 3D chunk (the real one is dist/mimir.3d.js with three.js): one WebGL triangle.
// The picture is a pure function of (angle, hue, view, debug): no clock, no randomness.
export const CHUNK = 'stub-3d-chunk'

const VERT = `
attribute vec2 p;
attribute float shade;
uniform float angle;
uniform vec2 squash;
uniform float aspect;
varying float v;
void main() {
  float c = cos(angle), s = sin(angle);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * squash;
  gl_Position = vec4(q.x / aspect, q.y, 0.0, 1.0);
  v = shade;
}`
const FRAG = `
precision mediump float;
uniform vec3 color;
uniform float flatness;
varying float v;
void main() { gl_FragColor = vec4(color * mix(v, 1.0, flatness), 1.0); }`

const VIEWS = { front: [1, 1], iso: [1, 0.55], side: [0.45, 1], top: [0.7, 0.7] }

function hueToRgb(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12
    return 0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true, alpha: false })
  if (!gl) throw new Error('WebGL is not available')
  const compile = (type, src) => {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
    return sh
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  // x, y, shade
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0.62, 1.0, -0.54, -0.31, 0.7, 0.54, -0.31, 0.45]), gl.STATIC_DRAW)
  const loc = (n) => gl.getAttribLocation(prog, n)
  gl.enableVertexAttribArray(loc('p'))
  gl.vertexAttribPointer(loc('p'), 2, gl.FLOAT, false, 12, 0)
  gl.enableVertexAttribArray(loc('shade'))
  gl.vertexAttribPointer(loc('shade'), 1, gl.FLOAT, false, 12, 8)
  const u = (n) => gl.getUniformLocation(prog, n)

  return {
    renderer: gl.getParameter(gl.VERSION),
    draw({ angleDeg, hue, view, debug }) {
      const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
      const h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const squash = VIEWS[view] || VIEWS.front
      gl.uniform1f(u('angle'), (angleDeg * Math.PI) / 180)
      gl.uniform2f(u('squash'), squash[0], squash[1])
      gl.uniform1f(u('aspect'), w / h)
      gl.uniform3fv(u('color'), debug === 'ids' ? [1, 0, 1] : hueToRgb(hue))
      gl.uniform1f(u('flatness'), debug === 'ids' ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  }
}
