// three.js backend (lazy chunk): the 3D panel and the default look ("luminous", docs/LOOK.md): dark bodies drawn in
// light on black, crease and silhouette lines, a fresnel rim, restrained bloom. The camera pose, every transform and
// the state of every part (material, opacity, enter progress, focus, view modes) come from the core Frame; every
// number of the look comes from ./look.ts. Nothing here keeps state that affects pixels between frames.
import {
  AdditiveBlending, AlwaysStencilFunc, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CustomBlending, CylinderGeometry, DecrementWrapStencilOp, DoubleSide, EdgesGeometry,
  EqualStencilFunc, FrontSide, GreaterDepth, Group, IncrementWrapStencilOp, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InstancedMesh, InterleavedBufferAttribute, KeepStencilOp,
  LessEqualDepth, LinearFilter, LinearSRGBColorSpace, LineBasicMaterial, LineSegments, Matrix3, Matrix4, Mesh, MeshBasicMaterial, NoToneMapping, NotEqualStencilFunc, Object3D, OneFactor, OneMinusSrcAlphaFactor,
  OrthographicCamera, PerspectiveCamera, Plane, PlaneGeometry, Quaternion, Raycaster, RedFormat, ReplaceStencilOp, Scene, ShaderChunk, ShaderMaterial, Sphere, SphereGeometry, SrcAlphaFactor, SRGBColorSpace,
  TorusGeometry, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget, ZeroStencilOp, Box3 as TBox3, type Material, type Side,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  backendOf, basisOf, clamp, defineKindBackend, defineManifest, defineRenderer, dist, FRAME_H, FRAME_W, INVALID_COLOR, kindOf, MATERIALS, materialOf, parseColor, toHex, transformBox,
  type Frame, type IdPassPart, type IdPassResult, type MaterialSpec, type MNode, type PartLook, type Pose, type Quat, type Rect, type Renderer, type Runtime, type Vec3,
} from '../core/index.ts'
import { smoothPath } from '../lib/profiles.ts'
import { configuredLook, ID_EDGE, ID_EDGE_STEPS, ID_OUTLINE, ID_OUTLINE_ROWS, litOf, lookOverrides, meshSource, roleInfo, type PartEdgeFn, type PartOutlineFn } from './index.ts'
import { creaseEdges, creasedSoup, sectionSegments, segmentGaps, xorSegments } from './edges.ts'
import { hexToLinear, mixRGB, partDraw, resolveLook, scaleRGB, styleOf, WHITE, type Look, type LookProblem, type MaterialNumbers, type PartDraw, type RGB, type Style } from './look.ts'
import { BLUR_FRAG, BODY_FRAG, BODY_VERT, CAP_FRAG, CAP_VERT, COMPOSITE_FRAG, COUNT_FRAG, COUNT_VERT, FS_VERT, LINE_FRAG, LINE_VERT, OUTLINE_FRAG } from './shaders.ts'
import { extrudeMesh, latheMesh, outward, sweepMesh, type Soup } from './shapes.ts'

/** Overrides of a named second material: a preset name, or numbers on top of the part's own look. */
export type SlotLook = string | Partial<Pick<MaterialSpec, 'color' | 'metalness' | 'roughness' | 'opacity' | 'emissive'>>
/** One copy of an instanced geometry, in the part's local space. */
export interface Instance { p: Vec3; q?: Quat; s?: number | Vec3 }

/** What a 3D kind backend receives. */
export interface Ctx3D {
  frame: Frame
  runtime: Runtime
  /**
   * A mesh with the node's standard material and crease lines: the default look for free. The geometry is re-creased
   * (one angle for shading and for lines), so hand over plain geometry and do not keep a reference to it.
   * flat: true = every face is shaded on its own (prisms, gears, anything faceted on purpose).
   * edges: false = no crease lines (smooth blobs). edgeAngle = the crease angle in degrees (default: the look's).
   * material: 'name' = use a named second material of this part instead (see material()).
   */
  mesh(geometry: BufferGeometry, o?: { edges?: boolean; edgeAngle?: number; flat?: boolean; material?: string }): Mesh
  /** replace a mesh's geometry only when `key` changed (for shapes whose proportions are options) */
  geometry(mesh: Mesh, key: string, make: () => BufferGeometry, o?: { edgeAngle?: number }): void
  /**
   * Many copies of one geometry in one draw call (teeth, balls, particles), with the node's material. Put them with
   * place() every frame. `capacity` is how many copies to make room for at first: place() makes more room when it is
   * given more (a count that follows a param), so nothing is ever dropped.
   */
  instanced(geometry: BufferGeometry, capacity: number, o?: { edges?: boolean; edgeAngle?: number; flat?: boolean; material?: string }): InstancedMesh
  /** Position the copies of an instanced mesh (local space): all of them are drawn. */
  place(mesh: InstancedMesh, items: readonly Instance[]): void
  /**
   * A line of constant width through local points (springs, wires, trails, flow paths). width is in world units (it
   * shrinks with distance like a wire), or with px: true in pixels of a 1280-wide stage (it scales with the stage,
   * like everything else, so a trail looks the same in a small embed and fullscreen). Lines take the look of the part too.
   */
  line(points: readonly Vec3[], o?: { width?: number; px?: boolean; closed?: boolean; material?: string }): Line2
  /** New points (and optionally a new width) for a line. Cheap enough to call every frame. */
  points(line: Line2, points: readonly Vec3[], o?: { width?: number; closed?: boolean }): void
  /**
   * The look of a named second material of this part ('glow', 'liquid' …): a preset name, or overrides on top of the
   * part's own look. Its opacity multiplies the part's. It still gets enter fades, focus dimming, view modes and the id pass.
   */
  material(slot: string, look: SlotLook): void
  /** The look table in force for this scene (the defaults with s.look() merged in): facet counts, widths, colours. */
  look: Look
}

/** What the 3D renderer offers beyond the Renderer interface (reach it with runtime.renderers.get('3d')). */
export interface Renderer3D extends Renderer {
  /** Brighten one part as if the pointer were over it (null = none). A live page only: a headless frame never has a hover. */
  hover(id: string | null): void
  /** Draw calls and triangles of the frame that was drawn last (all passes). */
  stats(): { calls: number; triangles: number; parts: number }
  /** The look table in force for this scene (the defaults with s.look() merged in). */
  look(): Look
}

type Uniforms = Record<string, { value: any }>
interface Slot {
  name: string
  over: SlotLook | null
  key: string
  style: Style
  draw: PartDraw
  lit: ShaderMaterial
  line: ShaderMaterial
  xray: ShaderMaterial | null
  pre: ShaderMaterial | null
  shell: ShaderMaterial | null
  veil: ShaderMaterial | null
  fluid: ShaderMaterial | null
  glow: ShaderMaterial | null
  mask: ShaderMaterial | null
}
interface LineBase { segs: Float32Array; norms: Float32Array; gaps: Float32Array; t: Float32Array }
type Aux = 'shell' | 'pre' | 'veil' | 'countBack' | 'countFront'
interface Rec {
  mesh: Mesh
  slot: Slot
  instanced: boolean
  flat: boolean
  edges: boolean
  edgeAngle: number
  /** no boundary edge after welding: a solid that can get a section cap */
  closed: boolean
  base: LineBase | null
  lines: Mesh | null
  xlines: Mesh | null
  shell: Mesh | null
  pre: Mesh | null
  veil: Mesh | null
  countBack: Mesh | null
  countFront: Mesh | null
  section: Mesh | null
  sectionKey: string
  placed: number
}
interface Fat { line: Line2; mat: LineMaterial; slot: string }
interface Handle {
  node: MNode
  index: number
  holder: Group
  obj: any
  /** 'main' and the named second materials */
  slots: Map<string, Slot>
  recs: Rec[]
  fat: Fat[]
  shown: boolean
  /** nothing behind it is hidden by it and it is not picked (a shell, a fluid, a part that is mostly transparent) */
  shell: boolean
  planes: Plane[]
  hover: number
  cap: Mesh | null
  capMat: ShaderMaterial | null
  countBack: ShaderMaterial | null
  countFront: ShaderMaterial | null
  sectionMat: ShaderMaterial | null
  occluder: MeshBasicMaterial | null
  idMat: MeshBasicMaterial | null
  emits: number
  hero: number
}

const NO_PLANES: Plane[] = []
const BIT_UNCUT = 0x80, COUNT_BITS = 0x3f, BIT_VEIL = 0x40
/** render order (docs/LOOK.md section 5): opaque list first, then the transparent list */
const ORDER = { shell: -10, body: 0, veil: 1, hero: 2, count: 100, guide: 9, line: 10, section: 11, heroLine: 12, fluid: 20, fluidLine: 21, fluidCount: 22, fluidCap: 23, fluidSection: 24, xrayIn: 24.5, pre: 25, fading: 26, fadingLine: 27, xray: 31, heroXray: 32 }

/** the stock clip varying is extrapolated outside the triangle under MSAA and leaves a ghost of the removed half */
const centroid = (src: string): string => src
  .replace('#include <clipping_planes_pars_vertex>', ShaderChunk.clipping_planes_pars_vertex.replace('varying vec3 vClipPosition', 'centroid varying vec3 vClipPosition'))
  .replace('#include <clipping_planes_pars_fragment>', ShaderChunk.clipping_planes_pars_fragment.replace('varying vec3 vClipPosition', 'centroid varying vec3 vClipPosition'))

const flatten = (points: readonly Vec3[], closed?: boolean): number[] => {
  const out: number[] = []
  for (const p of points) out.push(p[0], p[1], p[2])
  if (closed && points.length > 1) out.push(points[0]![0], points[0]![1], points[0]![2])
  // a line needs two points; a degenerate one is drawn as nothing
  while (out.length < 6) out.push(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)
  return out
}
const set3 = (c: Color, v: RGB): void => { c.setRGB(v[0], v[1], v[2], LinearSRGBColorSpace) }
/** any colour the core accepts → '#rrggbb' (or null) */
const hexOf = (c: unknown): string | null => { const v = parseColor(c); return v ? toHex(v).slice(0, 7) : null }

/** material option (preset name or object) + colour option → concrete numbers (the core's materialOf) */
export const resolveMaterial = materialOf

interface PixelStat { n: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }

/** the 8-vertex template of one fat segment: a body quad and two end-cap quads */
const QUAD = {
  position: [-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0],
  uv: [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2],
  index: [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5],
}
function lineGeometry(b: LineBase): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setIndex(QUAD.index)
  g.setAttribute('position', new BufferAttribute(new Float32Array(QUAD.position), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(QUAD.uv), 2))
  const se = new InstancedInterleavedBuffer(b.segs, 6, 1)
  g.setAttribute('instanceStart', new InterleavedBufferAttribute(se, 3, 0))
  g.setAttribute('instanceEnd', new InterleavedBufferAttribute(se, 3, 3))
  const nn = new InstancedInterleavedBuffer(b.norms, 6, 1)
  g.setAttribute('instanceN1', new InterleavedBufferAttribute(nn, 3, 0))
  g.setAttribute('instanceN2', new InterleavedBufferAttribute(nn, 3, 3))
  g.setAttribute('instanceGap', new InstancedBufferAttribute(b.gaps, 1))
  g.setAttribute('instanceT', new InstancedBufferAttribute(b.t, 2))
  g.instanceCount = b.segs.length / 6
  // bounds of the segments, not of the template (camera fit, culling)
  const box = new TBox3(), v = new Vector3()
  for (let i = 0; i < b.segs.length; i += 3) box.expandByPoint(v.set(b.segs[i]!, b.segs[i + 1]!, b.segs[i + 2]!))
  if (box.isEmpty()) box.set(new Vector3(), new Vector3())
  g.boundingBox = box
  g.boundingSphere = box.getBoundingSphere(new Sphere())
  g.computeBoundingBox = () => {}
  g.computeBoundingSphere = () => {}
  return g
}
const toGeometry = (s: Soup): BufferGeometry => {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(s.positions), 3))
  g.setIndex(s.indices)
  return g
}

class Three3D implements Renderer3D {
  private rt!: Runtime
  private gl!: WebGLRenderer
  private canvas!: HTMLCanvasElement
  private K!: Look
  private scene = new Scene()
  private camera = new PerspectiveCamera(30, 16 / 9, 0.1, 1000)
  private handles: Handle[] = []
  private byNode = new Map<number, Handle>()
  private ctx!: Ctx3D
  private building: Handle | null = null
  private rect: Rect = { x: 0, y: 0, width: 1, height: 1 } // stage px of the panel
  private ratio = 1
  private cleanup: (() => void)[] = []
  private shown: Frame | null = null
  // shared uniforms: one object, read by every material
  private uPx = { value: 1 }
  private uKeyPos = { value: new Vector3() }
  private uGrade = { value: new Vector3(0, 1, 1) }
  private uDither = { value: 1 }
  private uResolution = { value: new Vector2(1, 1) }
  private keyDir = new Vector3()
  // section plane basis (world)
  private capGeometry = new PlaneGeometry(1, 1)
  // post passes
  private fsScene = new Scene()
  private fsCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private fsMesh!: Mesh
  private blurMat!: ShaderMaterial
  private compMat!: ShaderMaterial
  private outlineMat!: ShaderMaterial
  private coverMat = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  private hiddenMat = new MeshBasicMaterial({ visible: false })
  private maskColor: WebGLRenderTarget | null = null
  private maskCover: WebGLRenderTarget | null = null
  private blurA: WebGLRenderTarget | null = null
  private blurB: WebGLRenderTarget | null = null
  private idTarget: WebGLRenderTarget | null = null
  private idLineMats = new Map<string, LineMaterial>()
  private guides: Mesh | null = null
  private guideMat: ShaderMaterial | null = null
  private anyCut = false
  /** world box of everything shown, as it is in this frame */
  private modelBox: { min: Vec3; max: Vec3 } = { min: [0, 0, 0], max: [0, 0, 0] }
  private heroColor: RGB = [1, 1, 0]
  private heroWeight = 0
  private heroRect: Rect | null = null
  private bloomOn = false
  private count = { calls: 0, triangles: 0 }
  private hoverId: string | null = null
  private disposables: { dispose(): void }[] = []

  look(): Look { return this.K }
  stats(): { calls: number; triangles: number; parts: number } { return { ...this.count, parts: this.handles.filter((h) => h.shown).length } }

  mount(rt: Runtime): void {
    this.rt = rt
    // the look table of this scene: the defaults with s.look() merged in; a key the table does not have is reported once
    const store = lookOverrides(rt.model)
    const problems: LookProblem[] = []
    const K = (this.K = resolveLook(configuredLook(rt.model, store.overrides), problems))
    for (const p of problems) rt.model.diagnostics.add({ code: p.near !== null || /has no/.test(p.what) ? 'API-UNKNOWN' : 'API-TYPE', what: `s.look(): ${p.what}.`, fix: [p.near ? `use "${p.near}"` : 'see the look table: mimir docs look'] }, store.src ?? undefined)
    this.keyDir.set(K.light.key[0], K.light.key[1], K.light.key[2]).normalize()
    this.uDither.value = K.renderer.dither

    const canvas = (this.canvas = document.createElement('canvas'))
    canvas.className = 'mimir-3d'
    canvas.style.cssText = 'position:absolute;z-index:1;display:block;touch-action:none;outline:none'
    rt.stageEl.appendChild(canvas)
    const gl = (this.gl = new WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: rt.headless }))
    gl.setClearColor(0x000000, 1) // pure black, always: no floor, no fog, no vignette
    gl.outputColorSpace = SRGBColorSpace
    gl.toneMapping = NoToneMapping // the shaders decide their own values
    gl.localClippingEnabled = true
    gl.info.autoReset = false

    this.blurMat = new ShaderMaterial({ uniforms: { tMap: { value: null }, uStep: { value: new Vector2() }, uSigma: { value: K.glow.sigma }, uDecode: { value: 0 } }, vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false })
    this.compMat = new ShaderMaterial({ uniforms: { tMap: { value: null }, tCover: { value: null }, uStrength: { value: 1 }, uTint: { value: new Vector4(1, 1, 1, 0) }, uDither: this.uDither }, vertexShader: FS_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false, blending: AdditiveBlending, transparent: true })
    this.outlineMat = new ShaderMaterial({ uniforms: { tMap: { value: null }, uTexel: { value: new Vector2() }, uRadius: { value: 1 }, uColor: { value: new Color() }, uOpacity: { value: 1 } }, vertexShader: FS_VERT, fragmentShader: OUTLINE_FRAG, depthTest: false, depthWrite: false, transparent: true })
    this.fsMesh = new Mesh(new PlaneGeometry(2, 2), this.blurMat)
    this.fsMesh.frustumCulled = false
    this.fsScene.add(this.fsMesh)
    this.disposables.push(this.blurMat, this.compMat, this.outlineMat, this.fsMesh.geometry, this.coverMat, this.hiddenMat, this.capGeometry)

    const self = this
    const m4 = new Matrix4(), v3 = new Vector3(), q4 = new Quaternion(), s3 = new Vector3()
    const record = (h: Handle, mesh: Mesh, o: { edges?: boolean; edgeAngle?: number; flat?: boolean; material?: string }, instanced: boolean): Rec => {
      const rec: Rec = {
        mesh, slot: self.slotOf(h, o.material), instanced, flat: !!o.flat, edges: o.edges !== false, edgeAngle: o.edgeAngle ?? K.creaseDeg, closed: false,
        base: null, lines: null, xlines: null, shell: null, pre: null, veil: null, countBack: null, countFront: null, section: null, sectionKey: '', placed: NaN,
      }
      mesh.userData.rec = rec
      mesh.userData.node = h.node.id
      mesh.layers.enable(1) // the id pass and the masks draw the bodies alone
      h.recs.push(rec)
      return rec
    }
    this.ctx = {
      frame: rt.frame,
      runtime: rt,
      look: K,
      mesh(geometry, o = {}) {
        const h = self.building!
        const mesh = new Mesh(geometry, self.slotOf(h, o.material).lit)
        const rec = record(h, mesh, o, false)
        mesh.geometry = self.prepare(rec, geometry)
        self.relines(rec)
        return mesh
      },
      geometry(mesh, key, make, o = {}) {
        if (mesh.userData.geoKey === key) return
        mesh.userData.geoKey = key
        const rec = mesh.userData.rec as Rec | undefined
        if (!rec) { mesh.geometry.dispose(); mesh.geometry = make(); return }
        if (o.edgeAngle !== undefined) rec.edgeAngle = o.edgeAngle
        const old = mesh.geometry
        mesh.geometry = self.prepare(rec, make())
        old.dispose()
        for (const k of ['shell', 'pre', 'veil', 'countBack', 'countFront'] as Aux[]) { const a = rec[k]; if (a) a.geometry = mesh.geometry }
        rec.sectionKey = ''
        rec.placed = NaN
        self.relines(rec)
      },
      instanced(geometry, capacity, o = {}) {
        const h = self.building!
        const mesh = new InstancedMesh(geometry, self.slotOf(h, o.material).lit, Math.max(1, Math.floor(capacity)))
        mesh.count = 0
        mesh.frustumCulled = false // the copies are anywhere: one box around the unit geometry would cull them wrongly
        const rec = record(h, mesh, o, true)
        mesh.geometry = self.prepare(rec, geometry)
        return mesh
      },
      place(mesh, items) {
        const n = items.length
        if (n > mesh.instanceMatrix.count) {
          // more copies than there is room for: make room (the next power of two) instead of dropping the rest
          mesh.dispose() // frees the GPU buffer of the old attribute; the mesh itself lives on
          mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(2 ** Math.ceil(Math.log2(n)) * 16), 16)
        }
        for (let i = 0; i < n; i++) {
          const it = items[i]!
          const s = it.s ?? 1
          v3.set(it.p[0], it.p[1], it.p[2])
          if (it.q) q4.set(it.q[0], it.q[1], it.q[2], it.q[3]); else q4.identity()
          if (typeof s === 'number') s3.setScalar(s); else s3.set(s[0], s[1], s[2])
          mesh.setMatrixAt(i, m4.compose(v3, q4, s3))
        }
        mesh.count = n
        mesh.instanceMatrix.needsUpdate = true
        mesh.boundingSphere = null // recomputed for picking
        const rec = mesh.userData.rec as Rec | undefined
        if (rec) self.bakeInstancedLines(rec, mesh)
      },
      line(points, o = {}) {
        const h = self.building!
        const geo = new LineGeometry()
        geo.setPositions(flatten(points, o.closed))
        const width = o.width ?? (o.px ? 2 : 0.05)
        const mat = new LineMaterial({ color: 0xffffff, linewidth: width, worldUnits: !o.px })
        const line = new Line2(geo, mat)
        line.userData.width = width
        line.userData.node = h.node.id
        line.userData.count = points.length + (o.closed ? 1 : 0)
        line.userData.closed = !!o.closed
        line.frustumCulled = false
        line.layers.enable(1)
        line.renderOrder = ORDER.line
        h.fat.push({ line, mat, slot: o.material ?? 'main' })
        if (o.material) self.slotOf(h, o.material)
        return line
      },
      points(line, points, o = {}) {
        const closed = o.closed ?? (line.userData.closed as boolean)
        const count = points.length + (closed ? 1 : 0)
        // a LineGeometry cannot grow in place: a different number of points needs a new one
        if (count !== line.userData.count) { line.geometry.dispose(); line.geometry = new LineGeometry(); line.userData.count = count }
        line.geometry.setPositions(flatten(points, closed))
        if (o.width !== undefined) line.userData.width = o.width
      },
      material(slot, look) { self.slotOf(self.building!, slot).over = look },
    }
    let index = 0
    for (const node of rt.model.nodes) {
      if (node.space !== '3d') continue
      const backend = backendOf(node.kind)
      if (!backend) continue
      const h: Handle = {
        node, index: index++, holder: new Group(), obj: null, slots: new Map(), recs: [], fat: [], shown: true, shell: false, planes: NO_PLANES, hover: 0,
        cap: null, capMat: null, countBack: null, countFront: null, sectionMat: null, occluder: null, idMat: null, emits: 0, hero: 0,
      }
      this.slotOf(h, undefined)
      h.holder.name = node.id
      this.building = h
      try {
        const out = backend.build(node, this.ctx)
        h.obj = out
        const root: Object3D | undefined = out instanceof Object3D ? out : out?.object
        if (root) h.holder.add(root)
      } catch (e) { rt.model.reportError(e, `building #${node.id}`, { ids: [node.id] }) }
      this.building = null
      this.scene.add(h.holder)
      this.handles.push(h)
      this.byNode.set(node.uid, h)
    }
    this.resize()
    if (!rt.headless) this.listen()
  }

  // ── materials ────────────────────────────────────────────────────────────────────────────────────
  private track<T extends { dispose(): void }>(x: T): T { this.disposables.push(x); return x }
  /** MODE 0 lit body · 1 x-ray shell · 2 fluid · 3 flat emissive fill (docs/LOOK.md section 2). */
  private bodyMaterial(mode: 0 | 1 | 2 | 3, side: Side = DoubleSide): ShaderMaterial {
    const L = this.K.light
    const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x))
    const m = new ShaderMaterial({
      defines: {
        MODE: mode, AMBIENT: f(L.ambient), KEY_GAIN: f(L.keyGain), KEY_WRAP: f(L.keyWrap), SKY_GAIN: f(L.skyGain), RIM_POWER: f(L.rimPower),
        BOX_DIR: L.box.map(f).join(','), BOX_EDGE0: f(L.boxEdge[0]), BOX_EDGE1: f(L.boxEdge[1]), BOX_TINT: f(L.boxTint), INNER: f(L.inner), SHELL_POWER: f(this.K.shell.power),
        SIL0: f(L.silhouetteEdge[0]), SIL1: f(L.silhouetteEdge[1]), FRONT_EMIT: f(this.K.fluid.frontEmit),
      },
      uniforms: {
        uBase: { value: new Color(0.2, 0.2, 0.2) }, uRim: { value: new Color(1, 1, 1) }, uSil: { value: new Color(1, 1, 1) },
        uRimGain: { value: 0.5 }, uSpec: { value: 0 }, uSilGain: { value: 0 }, uLevel: { value: 1 }, uOpacity: { value: 1 },
        uA: { value: new Vector4(0, 0, 0, 0) }, uEmit: { value: 0 }, uCapBack: { value: 0 }, uCapFill: { value: new Color(0, 0, 0) },
        uPx: this.uPx, uKeyPos: this.uKeyPos, uGrade: this.uGrade, uDither: this.uDither,
      },
      vertexShader: centroid(BODY_VERT), fragmentShader: centroid(BODY_FRAG), side, clipping: true,
    })
    if (mode === 0 || mode === 3) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1 } // lines win against their own surface
    return this.track(m)
  }
  private lineMaterial(o: { fade?: boolean; clip?: boolean } = {}): ShaderMaterial {
    const L = this.K.line
    return this.track(new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(1, 1, 1) }, uSilColor: { value: new Color(1, 1, 1) }, uOpacity: { value: 1 },
        uCore: { value: 1 }, uHalo: { value: 0 }, uSigma: { value: L.sigma }, uPx: this.uPx, uCap: { value: 1 }, uWidth: { value: 3 }, uBias: { value: L.bias },
        uResolution: this.uResolution, uDraw: { value: new Vector2(4, 1) },
        uFade: { value: o.fade === false ? new Vector3(-2, -1, 1) : new Vector3(L.fade[0], L.fade[1], L.fade[2]) },
        uWeights: { value: new Vector3(L.crease, L.back, L.creaseWidth) },
      },
      vertexShader: centroid(LINE_VERT), fragmentShader: centroid(LINE_FRAG), transparent: true, depthWrite: false, clipping: o.clip !== false,
    }))
  }
  /** width, colour, opacity of one set of lines; returns whether there is anything to draw */
  private setLine(m: ShaderMaterial, colour: RGB, opacity: number, core: number, halo: number, bias: number, draw = 4, front = 1): boolean {
    const u = m.uniforms as Uniforms
    set3(u.uColor!.value, colour)
    set3(u.uSilColor!.value, colour)
    u.uOpacity!.value = opacity
    u.uCore!.value = core
    u.uHalo!.value = halo
    u.uCap!.value = opacity < 0.999 ? 0 : 1 // round caps of translucent lines bead at every vertex
    u.uWidth!.value = core + 2 * (halo > 0.001 ? this.K.line.sigma * this.K.line.reach : 1)
    u.uBias!.value = bias
    u.uDraw!.value.set(draw, front)
    const on = opacity > 0.002
    m.visible = on
    return on
  }
  private slotOf(h: Handle, name: string | undefined): Slot {
    const key = name ?? 'main'
    let s = h.slots.get(key)
    if (!s) {
      const style = styleOf(this.K, { role: 'static' })
      const lit = this.bodyMaterial(0)
      Object.assign(lit, { stencilFunc: AlwaysStencilFunc, stencilWriteMask: 0xbf, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp })
      s = { name: key, over: null, key: '', style, draw: partDraw(this.K, style, { ghost: 0, focus: 0, dim: 0, hover: 0, energy: 0, edges: 1, alpha: 1, reveal: 1, mode: 'fade' }), lit, line: this.lineMaterial(), xray: null, pre: null, shell: null, veil: null, fluid: null, glow: null, mask: null }
      h.slots.set(key, s)
    }
    return s
  }

  // ── geometry: creased normals, crease lines, closedness ──────────────────────────────────────────
  /** Re-crease a geometry with the one angle of the look and work out its lines. The input is consumed. */
  private prepare(rec: Rec, g: BufferGeometry): BufferGeometry {
    rec.base = null
    rec.closed = false
    const pos = g.getAttribute('position')
    if (!pos || pos.count < 3) return g
    const P = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) { P[3 * i] = pos.getX(i); P[3 * i + 1] = pos.getY(i); P[3 * i + 2] = pos.getZ(i) }
    const soup = creasedSoup(P, g.index ? (g.index.array as ArrayLike<number>) : null, rec.flat ? 0 : rec.edgeAngle)
    const out = new BufferGeometry()
    out.setAttribute('position', new BufferAttribute(soup.positions, 3))
    out.setAttribute('normal', new BufferAttribute(soup.normals, 3))
    out.computeBoundingBox()
    out.computeBoundingSphere()
    g.dispose()
    const e = creaseEdges(soup.positions, null, rec.edgeAngle)
    rec.closed = e.closed
    if (rec.edges) {
      const merged = xorSegments(e.segs, e.norms)
      const segs = new Float32Array(merged.segs)
      // where each end sits between the bottom and the top of the mesh: the order the lines are drawn in when it enters
      const box = out.boundingBox!, y0 = box.min.y, dy = Math.max(1e-9, box.max.y - box.min.y)
      const t = new Float32Array((segs.length / 6) * 2)
      for (let i = 0; i < t.length / 2; i++) { t[2 * i] = (segs[6 * i + 1]! - y0) / dy; t[2 * i + 1] = (segs[6 * i + 4]! - y0) / dy }
      rec.base = { segs, norms: new Float32Array(merged.norms), gaps: segmentGaps(merged.segs, this.K.line.gapCap), t }
    }
    return out
  }
  private lineMesh(parent: Object3D, base: LineBase, material: ShaderMaterial, old: Mesh | null): Mesh {
    if (old) { old.geometry.dispose(); old.geometry = lineGeometry(base); return old }
    const m = new Mesh(lineGeometry(base), material)
    m.frustumCulled = false
    parent.add(m)
    return m
  }
  /** (re)build the line objects of a plain mesh from its base segments */
  private relines(rec: Rec): void {
    if (rec.instanced) return
    const base = rec.base
    if (!base || !base.segs.length) { for (const k of ['lines', 'xlines'] as const) { const l = rec[k]; if (l) { l.geometry.dispose(); l.removeFromParent(); rec[k] = null } } return }
    rec.lines = this.lineMesh(rec.mesh, base, rec.slot.line, rec.lines)
    if (rec.xlines) { rec.xlines.geometry = rec.lines.geometry }
  }
  /** an instanced mesh has one copy of every crease line per instance, baked whenever the copies moved */
  private bakeInstancedLines(rec: Rec, mesh: InstancedMesh): void {
    const base = rec.base
    const n = mesh.count
    const drop = (): void => { for (const k of ['lines', 'xlines'] as const) { const l = rec[k]; if (l) l.visible = false } rec.placed = NaN }
    if (!base || !base.segs.length || !n || (base.segs.length / 6) * n > this.K.line.instancedLimit) return drop()
    const arr = mesh.instanceMatrix.array as Float32Array
    let hash = n
    for (let i = 0; i < n * 16; i++) hash = (Math.imul(hash, 31) + Math.round(arr[i]! * 1e4)) | 0
    if (hash === rec.placed && rec.lines) return
    rec.placed = hash
    const per = base.segs.length / 6
    const segs = new Float32Array(per * n * 6), norms = new Float32Array(per * n * 6), gaps = new Float32Array(per * n), t = new Float32Array(per * n * 2)
    const m = new Matrix4(), nm = new Matrix3(), v = new Vector3()
    for (let k = 0; k < n; k++) {
      m.fromArray(arr, k * 16)
      nm.getNormalMatrix(m)
      const scale = Math.cbrt(Math.abs(m.determinant())) || 1
      for (let i = 0; i < per * 2; i++) {
        v.set(base.segs[3 * i]!, base.segs[3 * i + 1]!, base.segs[3 * i + 2]!).applyMatrix4(m).toArray(segs, (k * per * 2 + i) * 3)
        v.set(base.norms[3 * i]!, base.norms[3 * i + 1]!, base.norms[3 * i + 2]!).applyMatrix3(nm).normalize().toArray(norms, (k * per * 2 + i) * 3)
      }
      for (let i = 0; i < per; i++) { gaps[k * per + i] = base.gaps[i]! * scale; t[(k * per + i) * 2] = base.t[2 * i]!; t[(k * per + i) * 2 + 1] = base.t[2 * i + 1]! }
    }
    rec.lines = this.lineMesh(mesh, { segs, norms, gaps, t }, rec.slot.line, rec.lines)
    if (rec.xlines) rec.xlines.geometry = rec.lines.geometry
  }
  /** a helper drawn with the mesh's geometry and another material (x-ray shell, depth pre-pass, veil, section counters) */
  private aux(rec: Rec, key: Aux, material: Material, order: number): Mesh {
    let m = rec[key]
    if (!m) {
      m = rec.instanced ? new InstancedMesh(rec.mesh.geometry, material, 1) : new Mesh(rec.mesh.geometry, material)
      m.frustumCulled = rec.instanced ? false : rec.mesh.frustumCulled
      rec.mesh.add(m)
      rec[key] = m
    }
    if (rec.instanced) { const im = m as InstancedMesh, src = rec.mesh as InstancedMesh; im.instanceMatrix = src.instanceMatrix; im.count = src.count }
    m.material = material
    m.renderOrder = order
    m.visible = true
    return m
  }

  resize(): void {
    const rt = this.rt
    const v = rt.model.viewportRect() ?? { x: -FRAME_W / 2, y: -FRAME_H / 2, width: FRAME_W, height: FRAME_H }
    // the panel is a fixed rectangle of the screen: the 2D camera does not move it
    const a = rt.screenToStage([v.x, v.y + v.height])
    this.rect = { x: Math.round(a.x), y: Math.round(a.y), width: Math.max(2, Math.round(v.width * rt.scale)), height: Math.max(2, Math.round(v.height * rt.scale)) }
    const s = this.canvas.style
    s.left = this.rect.x + 'px'
    s.top = this.rect.y + 'px'
    // a shot is drawn at the ratio it was asked for; a live page is capped (the look's maxPixelRatio)
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
    this.ratio = Math.min(dpr, rt.headless ? 4 : this.K.renderer.maxPixelRatio)
    this.gl.setPixelRatio(this.ratio)
    this.gl.setSize(this.rect.width, this.rect.height, true)
    this.camera.aspect = this.rect.width / this.rect.height
    this.camera.updateProjectionMatrix()
    this.uPx.value = 1 / this.ratio
    this.uResolution.value.set(this.rect.width, this.rect.height) // line widths are CSS px
    for (const t of [this.maskColor, this.maskCover, this.blurA, this.blurB]) t?.dispose()
    this.maskColor = this.maskCover = this.blurA = this.blurB = null
  }

  // ── per frame ────────────────────────────────────────────────────────────────────────────────────
  private applyPose(pose: Pose, radius: number): void {
    const b = basisOf(pose)
    const cam = this.camera
    cam.position.set(b.eye[0], b.eye[1], b.eye[2])
    cam.up.set(b.up[0], b.up[1], b.up[2])
    cam.lookAt(pose.target[0], pose.target[1], pose.target[2])
    cam.fov = pose.fov
    cam.near = Math.max(pose.distance / 200, 0.01)
    cam.far = pose.distance + radius * 4 + 100
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  }

  /** the model as it rests (nothing pushed apart): where the key light sits and where the vertical falloff runs */
  private lightBounds(frame: Frame): { centre: Vec3; radius: number; y0: number; y1: number } {
    const exploded = frame.viewValue<number>('explode', 0) > 0
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (const h of this.handles) {
      const b = transformBox(frame.localBounds(h.node), exploded ? frame.rest(h.node) : frame.world(h.node))
      if (!(b.min[0] <= b.max[0]) || !Number.isFinite(b.min[0] + b.max[0] + b.min[1] + b.max[1] + b.min[2] + b.max[2])) continue
      if (b.min[0] < x0) x0 = b.min[0]; if (b.min[1] < y0) y0 = b.min[1]; if (b.min[2] < z0) z0 = b.min[2]
      if (b.max[0] > x1) x1 = b.max[0]; if (b.max[1] > y1) y1 = b.max[1]; if (b.max[2] > z1) z1 = b.max[2]
    }
    if (!(x0 <= x1)) return { centre: [0, 0, 0], radius: 1, y0: 0, y1: 1 }
    return { centre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], radius: Math.max(1e-3, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2), y0, y1: Math.max(y1, y0 + 1e-6) }
  }

  /** the style of one slot of a part, recomputed only when what decides it changed */
  private restyle(h: Handle, slot: Slot, r: Record<string, any>): void {
    const info = roleInfo(h.node)
    let material: string | MaterialNumbers | null = (r.material as string | MaterialNumbers | null) ?? null
    let accent = h.node.invalid ? INVALID_COLOR : hexOf(r.color)
    if (slot.over) {
      // a named second material: a preset of its own, or numbers on top of the part's look
      if (typeof slot.over === 'string') { material = slot.over; accent = h.node.invalid ? INVALID_COLOR : null }
      else {
        const o = slot.over
        material = { ...(typeof material === 'object' && material ? material : {}), ...o }
        if (o.color !== undefined) accent = hexOf(o.color)
        if (typeof r.material === 'string' && o.roughness === undefined && o.opacity === undefined && o.emissive === undefined) material = r.material
      }
    } else if (typeof material === 'object' && material && material.color && !accent) accent = hexOf(material.color)
    if (typeof material === 'object' && material) material = { ...material, color: null }
    const key = `${info.role}|${info.nth}|${accent ?? ''}|${typeof material === 'string' ? material : JSON.stringify(material)}`
    if (key === slot.key) return
    slot.key = key
    slot.style = styleOf(this.K, { role: info.role, accent, material, nth: info.nth })
  }

  private sync(frame: Frame): void {
    const K = this.K
    this.ctx.frame = frame
    // who is in focus, and how strongly (the guide's st.focus records the action; its envelope is the weight)
    const heroes = new Map<number, number>()
    for (const a of frame.actions<{ nodes?: MNode[] }>('focus')) {
      const mark = (n: MNode): void => { heroes.set(n.uid, Math.max(heroes.get(n.uid) ?? 0, a.env)); for (const c of n.children) mark(c) }
      for (const n of a.data?.nodes ?? []) mark(n)
    }
    const light = this.lightBounds(frame)
    this.uGrade.value.set(light.y0, light.y1, K.light.floor)
    this.uKeyPos.value.set(light.centre[0], light.centre[1], light.centre[2]).applyMatrix4(this.camera.matrixWorldInverse).addScaledVector(this.keyDir, light.radius * K.light.keyDistance)

    this.anyCut = false
    this.bloomOn = false
    this.heroWeight = 0
    let heroAccent: RGB | null | undefined
    let hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity
    const pxScale = this.rt.width / 1280 // a px width is given for a 1280-wide stage and scales with the stage
    const mb = this.modelBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const h of this.handles) {
      if (this.cutOf(frame.look(h.node))) this.anyCut = true
      const b = frame.bounds(h.node)
      if (!Number.isFinite(b.min[0] + b.min[1] + b.min[2] + b.max[0] + b.max[1] + b.max[2])) continue
      for (let k = 0; k < 3; k++) { if (b.min[k]! < mb.min[k]!) mb.min[k] = b.min[k]!; if (b.max[k]! > mb.max[k]!) mb.max[k] = b.max[k]! }
    }
    if (!(mb.min[0] <= mb.max[0])) this.modelBox = { min: [-1, -1, -1], max: [1, 1, 1] }

    for (const h of this.handles) {
      const node = h.node
      // the core decides the state: material + colour, opacity x ancestors x enter progress, dimming, view modes
      const look = frame.look(node)
      const r = frame.props(node)
      const m0 = materialOf(r).opacity || 1
      const vis = look.opacity / m0
      const shown = vis > 0.002
      h.shown = shown
      h.holder.visible = shown
      h.emits = 0
      h.hero = 0
      if (h.cap) h.cap.visible = false
      if (!shown) continue
      const w = frame.world(node)
      h.holder.position.set(w.p[0], w.p[1], w.p[2])
      h.holder.quaternion.set(w.q[0], w.q[1], w.q[2], w.q[3])
      h.holder.scale.setScalar(w.s)
      const backend = backendOf(node.kind)
      if (backend?.update) {
        this.building = h
        try { backend.update(h.obj, r, this.ctx, node) } catch (e) { this.rt.model.reportError(e, `drawing #${node.id}`, { ids: [node.id], t: frame.tau }) }
        this.building = null
      }
      h.planes = look.clip.length ? look.clip.map((c) => new Plane(new Vector3(c.normal[0], c.normal[1], c.normal[2]).normalize(), c.constant)) : NO_PLANES
      const reveal = frame.reveal(node)
      const alpha = reveal.p > 0 ? Math.min(1, vis / reveal.p) : 0
      // in the light: named by st.focus, or lit by a look (the guide hands the light from part to part with lightPart)
      const focus = Math.max(heroes.get(node.uid) ?? 0, litOf(look))
      for (const slot of h.slots.values()) {
        this.restyle(h, slot, r)
        const overOpacity = slot.over && typeof slot.over === 'object' && typeof slot.over.opacity === 'number' && slot.style.kind !== 'shell' ? slot.over.opacity : 1
        slot.draw = partDraw(K, slot.style, { ghost: look.ghost ?? 0, focus, dim: look.dim, hover: h.hover, energy: Number(r.energy) || 0, edges: look.edges, alpha: alpha * overOpacity, reveal: reveal.p, mode: reveal.mode })
        this.applySlot(h, slot, look)
      }
      const main = h.slots.get('main')!.draw
      h.shell = look.shell || main.seeThrough
      h.hero = main.hero
      if (main.hero > 0.002) {
        this.heroWeight = Math.max(this.heroWeight, main.hero)
        // one contour colour: the accent when every part in focus has the same one, the look's highlight otherwise
        const acc = h.slots.get('main')!.style.kind === 'lit' || h.slots.get('main')!.style.kind === 'shell' ? h.slots.get('main')!.style.accent : null
        heroAccent = heroAccent === undefined ? acc : heroAccent && acc && heroAccent.every((x, i) => Math.abs(x - acc[i]!) < 1e-6) ? heroAccent : null
        const fr = frame.frameRect(node)
        if (fr) { hx0 = Math.min(hx0, fr.x); hy0 = Math.min(hy0, fr.y); hx1 = Math.max(hx1, fr.x + fr.width); hy1 = Math.max(hy1, fr.y + fr.height) }
      }
      for (const rec of h.recs) this.applyRec(h, rec, look)
      for (const f of h.fat) {
        const d = (h.slots.get(f.slot) ?? h.slots.get('main')!).draw
        const c = d.kind === 'glow' || d.kind === 'fluid' ? d.base : d.line
        f.mat.color.setRGB(c[0] * d.level, c[1] * d.level, c[2] * d.level, LinearSRGBColorSpace)
        const transparent = d.wire < 0.999
        if (f.mat.transparent !== transparent) { f.mat.transparent = transparent; f.mat.needsUpdate = true }
        f.mat.opacity = d.wire
        f.mat.depthWrite = !transparent
        f.line.visible = d.wire > 0.002
        f.line.renderOrder = transparent ? ORDER.fadingLine : ORDER.line
        if ((f.mat.clippingPlanes?.length ?? 0) !== h.planes.length) f.mat.needsUpdate = true
        f.mat.clippingPlanes = h.planes
        f.mat.linewidth = (f.line.userData.width as number) * (f.mat.worldUnits ? 1 : pxScale)
      }
      this.applyCut(h, look, frame)
    }
    this.heroColor = heroAccent ?? hexToLinear(K.focus.color) ?? [1, 1, 0]
    this.heroRect = Number.isFinite(hx0) ? this.rt.rectToStage({ x: hx0, y: hy0, width: hx1 - hx0, height: hy1 - hy0 }) : null
    this.syncGuides(frame)
  }

  /** the section plane of a part: the cutaway's, or the one plane any other look clips it with (a slice gets honest caps too) */
  private cutOf(look: PartLook): NonNullable<PartLook['cut']> | null {
    if (look.cut) return look.cut
    const only = look.clip.length === 1 ? look.clip[0]! : null
    return only ? { normal: only.normal, constant: only.constant, sweep: 0 } : null
  }

  /** one slot's materials for this frame */
  private applySlot(h: Handle, slot: Slot, look: PartLook): void {
    const K = this.K, d = slot.draw
    const planes = h.planes
    const clip = (m: Material): void => { m.clippingPlanes = planes }
    const cutThis = !!this.cutOf(look)
    // lit body
    const lit = slot.lit, u = lit.uniforms as Uniforms
    const bodyOn = d.kind === 'lit' && d.body > 0.002
    const opaque = d.body >= 0.999
    set3(u.uBase!.value, d.base); set3(u.uRim!.value, d.rim); set3(u.uSil!.value, d.sil)
    u.uRimGain!.value = d.rimGain; u.uSpec!.value = d.spec; u.uSilGain!.value = d.silGain; u.uLevel!.value = d.level; u.uOpacity!.value = d.body
    lit.visible = bodyOn
    if (lit.transparent !== !opaque) { lit.transparent = !opaque; lit.needsUpdate = true }
    lit.depthWrite = opaque
    lit.stencilWrite = this.anyCut
    lit.stencilRef = cutThis ? 0 : BIT_UNCUT
    clip(lit)
    // depth pre-pass: a half-faded body is one clean layer, never its own back faces showing through
    if (bodyOn && !opaque) {
      if (!slot.pre) { slot.pre = this.bodyMaterial(0); slot.pre.colorWrite = false; slot.pre.transparent = true; slot.pre.depthWrite = true }
      slot.pre.visible = true
      clip(slot.pre)
    } else if (slot.pre) slot.pre.visible = false
    // x-ray shell: additive, under everything, no depth; opaque parts then overwrite it
    if (d.shell > 0.002 && (d.kind === 'lit' || d.kind === 'shell')) {
      if (!slot.shell) { slot.shell = this.bodyMaterial(1); Object.assign(slot.shell, { blending: AdditiveBlending, depthTest: false, depthWrite: false }) }
      const su = slot.shell.uniforms as Uniforms
      set3(su.uRim!.value, d.shellRim); set3(su.uSil!.value, d.shellLine)
      su.uA!.value.set(d.face, d.rimAmount, 0, 0)
      su.uSilGain!.value = d.shellSil
      su.uLevel!.value = d.shell * d.level
      slot.shell.visible = true
      clip(slot.shell)
    } else if (slot.shell) slot.shell.visible = false
    // the occluded part of the part in focus, redrawn over what covers it
    if (bodyOn && opaque && d.hero > 0.002) {
      if (!slot.veil) {
        slot.veil = this.bodyMaterial(0, FrontSide)
        Object.assign(slot.veil, {
          depthFunc: GreaterDepth, depthWrite: false, polygonOffset: false, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor,
          stencilWrite: true, stencilRef: BIT_VEIL, stencilFunc: NotEqualStencilFunc, stencilFuncMask: BIT_VEIL, stencilWriteMask: BIT_VEIL, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp,
        })
      }
      const vu = slot.veil.uniforms as Uniforms
      for (const k of ['uBase', 'uRim', 'uSil'] as const) vu[k]!.value.copy(u[k]!.value)
      for (const k of ['uRimGain', 'uSpec', 'uSilGain', 'uLevel'] as const) vu[k]!.value = u[k]!.value
      vu.uOpacity!.value = K.focus.veil * d.hero
      slot.veil.visible = true
      clip(slot.veil)
    } else if (slot.veil) slot.veil.visible = false
    // fluid: a translucent volume of coloured light
    if (d.kind === 'fluid') {
      if (!slot.fluid) { slot.fluid = this.bodyMaterial(2); Object.assign(slot.fluid, { transparent: true, depthWrite: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor }) }
      const fu = slot.fluid.uniforms as Uniforms
      set3(fu.uBase!.value, d.base)
      fu.uLevel!.value = d.fluidLevel; fu.uEmit!.value = d.emit; fu.uOpacity!.value = d.body
      fu.uA!.value.set(K.fluid.front[0], K.fluid.front[1], K.fluid.front[2], K.fluid.back)
      slot.fluid.visible = d.body > 0.002
      clip(slot.fluid)
    }
    // glow: an unlit emissive fill
    if (d.kind === 'glow') {
      if (!slot.glow) slot.glow = this.bodyMaterial(3)
      const gu = slot.glow.uniforms as Uniforms
      set3(gu.uBase!.value, d.base)
      gu.uA!.value.set(d.fill, d.fillRim, 0, 0)
      gu.uLevel!.value = d.level; gu.uOpacity!.value = d.body
      const solid = d.body >= 0.999
      if (slot.glow.transparent !== !solid) { slot.glow.transparent = !solid; slot.glow.needsUpdate = true }
      slot.glow.depthWrite = solid
      slot.glow.visible = d.body > 0.002
      clip(slot.glow)
    }
    // what joins the bloom mask
    if ((d.kind === 'fluid' || d.kind === 'glow') && d.bloom > 0.002) {
      if (!slot.mask) { slot.mask = this.bodyMaterial(3); slot.mask.polygonOffset = false }
      const mu = slot.mask.uniforms as Uniforms
      set3(mu.uBase!.value, d.base)
      mu.uA!.value.set(K.glow.fill[0], K.glow.fill[1], 0, 0)
      mu.uLevel!.value = d.bloom
      clip(slot.mask)
      h.emits = Math.max(h.emits, d.bloom)
      this.bloomOn = true
    }
    // crease lines: the solid set, and the x-ray set that takes over as the part turns into a shell
    const bias = d.kind === 'fluid' ? K.line.bias * K.line.fluidBias : K.line.bias
    const draw = d.draw >= 1 ? 4 : d.draw * (1 + K.enter.front)
    this.setLine(slot.line, d.line, d.lineOpacity, d.core, d.halo, bias, draw, K.enter.front)
    clip(slot.line)
    if (d.xray > 0.002) {
      if (!slot.xray) slot.xray = this.lineMaterial()
      this.setLine(slot.xray, d.shellLine, Math.min(1, d.xray), d.core, d.xrayHalo, bias, draw, K.enter.front)
      clip(slot.xray)
    } else if (slot.xray) slot.xray.visible = false
  }

  /** one mesh's draw objects for this frame: which material, in which pass */
  private applyRec(h: Handle, rec: Rec, _look: PartLook): void {
    const slot = rec.slot, d = slot.draw
    const mesh = rec.mesh
    for (const k of ['shell', 'pre', 'veil', 'countBack', 'countFront'] as Aux[]) { const a = rec[k]; if (a) a.visible = false }
    const opaque = d.body >= 0.999
    const hero = d.hero > 0.002
    if (d.kind === 'fluid') { mesh.material = slot.fluid!; mesh.renderOrder = ORDER.fluid }
    else if (d.kind === 'glow') { mesh.material = slot.glow!; mesh.renderOrder = opaque ? ORDER.body : ORDER.fading }
    else { mesh.material = slot.lit; mesh.renderOrder = opaque ? (hero ? ORDER.hero : ORDER.body) : ORDER.fading }
    if (slot.pre?.visible) this.aux(rec, 'pre', slot.pre, ORDER.pre)
    if (slot.shell?.visible) this.aux(rec, 'shell', slot.shell, ORDER.shell)
    if (slot.veil?.visible) this.aux(rec, 'veil', slot.veil, ORDER.veil)
    if (rec.lines) {
      rec.lines.material = slot.line
      rec.lines.visible = slot.line.visible && (!rec.instanced || Number.isFinite(rec.placed))
      rec.lines.renderOrder = d.kind === 'fluid' ? ORDER.fluidLine : !opaque && d.kind !== 'shell' ? ORDER.fadingLine : hero ? ORDER.heroLine : ORDER.line
      if (slot.xray?.visible) {
        if (!rec.xlines) { rec.xlines = new Mesh(rec.lines.geometry, slot.xray); rec.xlines.frustumCulled = false; mesh.add(rec.xlines) }
        rec.xlines.geometry = rec.lines.geometry
        rec.xlines.material = slot.xray
        rec.xlines.visible = !rec.instanced || Number.isFinite(rec.placed)
        // while the body is still fading the x-ray lines go under it; once it is a shell they are drawn last and carry the depth order
        rec.xlines.renderOrder = d.body > 0.002 ? ORDER.xrayIn : hero ? ORDER.heroXray : ORDER.xray
      } else if (rec.xlines) rec.xlines.visible = false
    }
  }

  /** the section of one part: caps counted in the stencil, a quad on the plane, the outline that travels with it */
  private applyCut(h: Handle, look: PartLook, frame: Frame): void {
    const K = this.K
    const cut = this.cutOf(look)
    const main = h.slots.get('main')!
    const d = main.draw
    for (const slot of h.slots.values()) (slot.lit.uniforms as Uniforms).uCapBack!.value = 0
    const fluid = d.kind === 'fluid'
    const solid = d.kind === 'lit' && d.body >= 0.999
    const sectionOn = !!cut && (solid || fluid || d.shell > 0.002 || d.body > 0.002)
    if (!cut || !sectionOn) {
      for (const rec of h.recs) if (rec.section) rec.section.visible = false
      if (main.fluid) main.fluid.side = DoubleSide
      return
    }
    const plane = new Plane(new Vector3(cut.normal[0], cut.normal[1], cut.normal[2]).normalize(), cut.constant)
    const style = main.style
    // section face: darker than any lit face of the part; hatch = the fill mixed toward the part's line colour
    const capBase = style.accent && style.kind === 'lit' ? scaleRGB(style.accent, K.cut.accentFill) : style.base
    const fill = fluid ? scaleRGB(d.base, d.fluidLevel) : (scaleRGB(capBase, K.cut.fill * d.level).map((x) => x + K.cut.fillAdd) as RGB)
    const hatch = mixRGB(fill, scaleRGB(style.line, d.level), K.cut.hatch)
    // every closed solid of the part is capped, the copies of an instanced one too (the balls of a bearing)
    const solids = h.recs.filter((r) => r.closed && (r.slot === main || r.slot.style.kind === style.kind))
    const allClosed = solids.length === h.recs.length
    // a body that is fading (a housing turning into a ghost under a section plane) keeps its section face, at its own opacity
    const fading = d.kind === 'lit' && d.body > 0.002 && !solid
    const capped = (solid || fading || (fluid && d.body > 0.002)) && solids.length > 0
    if (solid || fading) for (const slot of h.slots.values()) { const u = slot.lit.uniforms as Uniforms; u.uCapBack!.value = allClosed ? 1 : 0; set3(u.uCapFill!.value, fill) }
    if (main.fluid) main.fluid.side = fluid && allClosed ? FrontSide : DoubleSide
    if (capped) {
      if (!h.countBack) {
        const counter = (side: Side, op: number): ShaderMaterial => this.track(new ShaderMaterial({
          vertexShader: centroid(COUNT_VERT), fragmentShader: centroid(COUNT_FRAG), side, clipping: true, colorWrite: false, depthWrite: false, depthTest: false,
          stencilWrite: true, stencilFunc: EqualStencilFunc, stencilRef: 0, stencilFuncMask: BIT_UNCUT, stencilWriteMask: COUNT_BITS, stencilFail: KeepStencilOp, stencilZFail: op as never, stencilZPass: op as never,
        }))
        h.countBack = counter(BackSide, IncrementWrapStencilOp)
        h.countFront = counter(FrontSide, DecrementWrapStencilOp)
        h.capMat = this.track(new ShaderMaterial({
          uniforms: {
            uFill: { value: new Color() }, uLine: { value: new Color() }, uU: { value: new Vector3() }, uV: { value: new Vector3() },
            uHatch: { value: new Vector4((h.index % 2 ? -1 : 1) * Math.PI / 4, K.cut.period, K.cut.share, 1) }, uFadePx: { value: new Vector2(K.cut.fadePx[0], K.cut.fadePx[1]) }, uFluid: { value: new Vector2(1, 0) }, uDither: this.uDither,
          },
          vertexShader: CAP_VERT, fragmentShader: CAP_FRAG, side: DoubleSide,
          stencilWrite: true, stencilFunc: NotEqualStencilFunc, stencilRef: 0, stencilFuncMask: COUNT_BITS, stencilWriteMask: COUNT_BITS, stencilFail: KeepStencilOp, stencilZFail: ZeroStencilOp, stencilZPass: ZeroStencilOp,
        }))
        h.cap = new Mesh(this.capGeometry, h.capMat)
        h.cap.matrixAutoUpdate = false
        h.cap.frustumCulled = false
        this.scene.add(h.cap)
      }
      // opaque parts count and cap in the opaque list, part by part; a fading part does both right after every fading body has been drawn
      const late = ORDER.fading + (1 + h.index) / 4096
      const countOrder = fluid ? ORDER.fluidCount : fading ? late : ORDER.count + 2 * h.index
      for (const m of [h.countBack!, h.countFront!]) { m.clippingPlanes = h.planes; m.transparent = fluid || fading }
      for (const rec of solids) { this.aux(rec, 'countBack', h.countBack!, countOrder); this.aux(rec, 'countFront', h.countFront!, countOrder) }
      const cm = h.capMat!, cu = cm.uniforms as Uniforms
      set3(cu.uFill!.value, fill); set3(cu.uLine!.value, hatch)
      cu.uHatch!.value.z = fluid ? 0 : K.cut.share // hatching means solid material
      cu.uHatch!.value.w = 1 / this.ratio
      cu.uFluid!.value.set(fluid ? K.fluid.cap * d.body : fading ? d.body : 1, fluid ? d.emit * K.fluid.capEmit * d.body : 0)
      if (cm.transparent !== (fluid || fading)) { cm.transparent = fluid || fading; cm.needsUpdate = true }
      cm.depthWrite = !fluid
      // a fluid's section face loses against the face of a solid that sits in it (a valve ball in the water)
      if (fluid || fading) Object.assign(cm, { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor })
      cm.polygonOffset = fluid
      cm.polygonOffsetFactor = 1
      cm.polygonOffsetUnits = 2
      // the quad lies on the plane and covers the part's bounds
      const n = plane.normal
      const pu = cu.uU!.value as Vector3, pv = cu.uV!.value as Vector3
      pu.crossVectors(Math.abs(n.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), n).normalize()
      pv.crossVectors(n, pu)
      // every cap on one plane uses the same quad (the model's bounds), so two caps that overlap have the very same
      // depth and the later part wins cleanly; the stencil count limits each to its own part
      const b = this.modelBox
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      const p = new Vector3()
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2])
        const a = p.dot(pu), c = p.dot(pv)
        if (a < u0) u0 = a; if (a > u1) u1 = a; if (c < v0) v0 = c; if (c > v1) v1 = c
      }
      const pad = 0.02 * Math.hypot(u1 - u0, v1 - v0) + 1e-4
      const centre = new Vector3().copy(n).multiplyScalar(-plane.constant).addScaledVector(pu, (u0 + u1) / 2).addScaledVector(pv, (v0 + v1) / 2)
      h.cap!.matrix.makeBasis(new Vector3().copy(pu).multiplyScalar(u1 - u0 + 2 * pad), new Vector3().copy(pv).multiplyScalar(v1 - v0 + 2 * pad), n).setPosition(centre)
      h.cap!.matrixWorld.copy(h.cap!.matrix)
      h.cap!.renderOrder = fluid ? ORDER.fluidCap : fading ? late + 1 / 8192 : ORDER.count + 2 * h.index + 1
      h.cap!.visible = true
    }
    // the outline of the section, rebuilt only when the plane moved in the mesh's own space
    if (!h.sectionMat) h.sectionMat = this.lineMaterial({ fade: false, clip: false })
    const sweep = cut.sweep
    const rest = style.accent && style.kind === 'lit' ? K.cut.lineWhiteAccent : K.cut.lineWhite
    const white = rest + (K.cut.sweepWhite - rest) * sweep
    const thin = style.role === 'fastener' ? K.cut.fastener : 1
    const lineOpacity = fluid ? d.lineOpacity : Math.min(1, Math.max(d.body, d.xray, d.shell > 0.002 ? K.cut.shellLine * d.shell : 0))
    this.setLine(h.sectionMat, fluid ? d.base : scaleRGB(mixRGB(style.line, WHITE, white), d.level), lineOpacity, (K.cut.lineCore + (K.cut.sweepCore - K.cut.lineCore) * sweep) * thin, K.cut.lineHalo + (K.cut.sweepHalo - K.cut.lineHalo) * sweep, K.line.bias * K.cut.lineBias)
    h.holder.updateMatrixWorld(true)
    const inv = new Matrix4(), local = new Plane()
    for (const rec of h.recs) {
      const pos = rec.mesh.geometry.getAttribute('position')
      if (!pos) continue
      local.copy(plane).applyMatrix4(inv.copy(rec.mesh.matrixWorld).invert())
      const q = (x: number): number => Math.round(x * 1e5)
      // the copies of an instanced part are cut one by one, each where it stands; their outlines are one set of lines
      const copies = rec.instanced ? (rec.mesh as InstancedMesh) : null
      let key = `${q(local.normal.x)},${q(local.normal.y)},${q(local.normal.z)},${q(local.constant)},${rec.mesh.geometry.id}`
      if (copies) { const a = copies.instanceMatrix.array; key += `,${copies.count}`; for (let i = 0; i < copies.count * 16; i++) key += ',' + q(a[i]!) }
      if (key !== rec.sectionKey) {
        rec.sectionKey = key
        let raw: number[]
        if (copies) {
          raw = []
          const mi = new Matrix4(), each = new Plane(), p = new Vector3()
          for (let i = 0; i < copies.count; i++) {
            copies.getMatrixAt(i, mi)
            if (Math.abs(mi.determinant()) < 1e-12) continue
            each.copy(local).applyMatrix4(inv.copy(mi).invert())
            const own = sectionSegments(pos.array as ArrayLike<number>, null, [each.normal.x, each.normal.y, each.normal.z, each.constant])
            for (let k = 0; k + 2 < own.length; k += 3) { p.set(own[k]!, own[k + 1]!, own[k + 2]!).applyMatrix4(mi); raw.push(p.x, p.y, p.z) }
          }
        } else raw = Array.from(sectionSegments(pos.array as ArrayLike<number>, null, [local.normal.x, local.normal.y, local.normal.z, local.constant]))
        const { segs } = xorSegments(raw, null)
        const count = segs.length / 6
        const norms = new Float32Array(count * 6)
        for (let i = 0; i < count; i++) { norms[6 * i + 2] = 1; norms[6 * i + 5] = -1 } // n and -n: always full weight
        const base: LineBase = { segs: new Float32Array(segs), norms, gaps: new Float32Array(count).fill(K.line.gapCap), t: new Float32Array(count * 2) }
        if (count) rec.section = this.lineMesh(rec.mesh, base, h.sectionMat, rec.section)
        else if (rec.section) { rec.section.geometry.dispose(); rec.section.geometry = lineGeometry(base) }
      }
      if (rec.section) {
        rec.section.material = h.sectionMat
        rec.section.visible = h.sectionMat.visible
        rec.section.renderOrder = fluid ? ORDER.fluidSection : d.body >= 0.999 ? ORDER.section : ORDER.xray
      }
    }
  }

  /** exploded view: a thin line from where every pushed part rests to where it is */
  private syncGuides(frame: Frame): void {
    const K = this.K
    const amount = frame.viewValue<number>('explode', 0)
    if (!(amount > 0)) { if (this.guides) this.guides.visible = false; return }
    const segs: number[] = []
    for (const node of this.rt.model.nodes) {
      if (node.space !== '3d' || !frame.visible(node)) continue
      const own = frame.prop<Vec3>(node, 'offset')
      if (!Array.isArray(own) || Math.hypot(own[0] ?? 0, own[1] ?? 0, own[2] ?? 0) < 1e-4) continue
      const w = frame.world(node), rest = frame.rest(node)
      const pw = node.parent ? frame.world(node.parent) : null, pr = node.parent ? frame.rest(node.parent) : null
      const dx = w.p[0] - rest.p[0] - (pw && pr ? pw.p[0] - pr.p[0] : 0), dy = w.p[1] - rest.p[1] - (pw && pr ? pw.p[1] - pr.p[1] : 0), dz = w.p[2] - rest.p[2] - (pw && pr ? pw.p[2] - pr.p[2] : 0)
      if (Math.hypot(dx, dy, dz) < 1e-4) continue
      const b = frame.bounds(node)
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2
      if (!Number.isFinite(cx + cy + cz)) continue
      segs.push(cx - dx, cy - dy, cz - dz, cx, cy, cz)
    }
    if (!segs.length) { if (this.guides) this.guides.visible = false; return }
    const count = segs.length / 6
    const norms = new Float32Array(count * 6)
    for (let i = 0; i < count; i++) { norms[6 * i + 2] = 1; norms[6 * i + 5] = -1 }
    const base: LineBase = { segs: new Float32Array(segs), norms, gaps: new Float32Array(count).fill(K.line.gapCap), t: new Float32Array(count * 2) }
    if (!this.guideMat) this.guideMat = this.lineMaterial({ fade: false, clip: false })
    this.setLine(this.guideMat, hexToLinear(K.explode.guide) ?? [0.06, 0.06, 0.06], K.explode.guideOpacity * Math.min(1, amount / Math.max(1e-6, K.explode.guideIn)), K.explode.guideCore, 0, K.line.bias)
    this.guides = this.lineMesh(this.scene, base, this.guideMat, this.guides)
    this.guides.renderOrder = ORDER.guide
    this.guides.visible = true
  }

  render(frame: Frame): void {
    this.shown = frame
    const pose = frame.camera()
    this.applyPose(pose, dist(pose.target, basisOf(pose).eye))
    this.sync(frame)
    this.draw(frame)
  }

  /** the main pass straight to the canvas, then the bloom and the focus contour on top */
  private draw(frame: Frame): void {
    const gl = this.gl
    gl.info.reset()
    gl.setRenderTarget(null)
    gl.render(this.scene, this.camera)
    if (this.bloomOn) this.renderBloom()
    if (this.heroWeight > 0.002) this.renderFocus(frame)
    this.count = { calls: gl.info.render.calls, triangles: gl.info.render.triangles }
  }

  private targets(): { color: WebGLRenderTarget; a: WebGLRenderTarget; b: WebGLRenderTarget } {
    if (!this.maskColor) {
      const w = Math.max(2, Math.round(this.rect.width / this.K.glow.downscale)), h = Math.max(2, Math.round(this.rect.height / this.K.glow.downscale))
      this.maskColor = new WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true })
      this.blurA = new WebGLRenderTarget(w, h, { depthBuffer: false })
      this.blurB = new WebGLRenderTarget(w, h, { depthBuffer: false })
      for (const t of [this.maskColor, this.blurA, this.blurB]) { t.texture.minFilter = t.texture.magFilter = LinearFilter; t.texture.generateMipmaps = false }
    }
    return { color: this.maskColor, a: this.blurA!, b: this.blurB! }
  }
  /** blur a mask (two 13-tap gaussians) into blurB and add it to the canvas */
  private blurAndAdd(mask: WebGLRenderTarget, strength: number, tint: RGB | null, cover: WebGLRenderTarget | null): void {
    const gl = this.gl
    const { a, b } = this.targets()
    const bm = this.blurMat.uniforms as Uniforms
    this.fsMesh.material = this.blurMat
    bm.tMap!.value = mask.texture; bm.uDecode!.value = 0; bm.uStep!.value.set(1 / a.width, 0)
    gl.setRenderTarget(a)
    gl.render(this.fsScene, this.fsCamera)
    bm.tMap!.value = a.texture; bm.uDecode!.value = 1; bm.uStep!.value.set(0, 1 / a.height)
    gl.setRenderTarget(b)
    gl.render(this.fsScene, this.fsCamera)
    const cm = this.compMat.uniforms as Uniforms
    this.fsMesh.material = this.compMat
    cm.tMap!.value = b.texture
    cm.tCover!.value = cover ? cover.texture : null
    cm.uStrength!.value = strength
    if (tint) cm.uTint!.value.set(tint[0], tint[1], tint[2], 1); else cm.uTint!.value.set(1, 1, 1, 0)
    gl.setRenderTarget(null)
    const auto = gl.autoClear
    gl.autoClear = false
    gl.render(this.fsScene, this.fsCamera)
    gl.autoClear = auto
  }
  /** draw the bodies alone (layer 1) with stand-in materials chosen per part and per mesh */
  private standIn(target: WebGLRenderTarget, pick: (h: Handle, rec: Rec) => Material | null, clearAlpha = 1): void {
    const gl = this.gl
    const saved: [Mesh, Material | Material[]][] = []
    for (const h of this.handles) {
      if (!h.shown) continue
      for (const rec of h.recs) { saved.push([rec.mesh, rec.mesh.material]); rec.mesh.material = pick(h, rec) ?? this.hiddenMat }
      for (const f of h.fat) f.line.layers.disable(1)
    }
    this.camera.layers.set(1)
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, clearAlpha)
    gl.clear()
    gl.render(this.scene, this.camera)
    gl.setClearColor(0x000000, 1)
    this.camera.layers.set(0)
    for (const [m, mat] of saved) m.material = mat
    for (const h of this.handles) for (const f of h.fat) f.line.layers.enable(1)
  }
  /** bloom: what emits light in colour, everything opaque in black (the glow cannot leak through a wall in front) */
  private renderBloom(): void {
    const { color } = this.targets()
    this.standIn(color, (h, rec) => {
      const d = rec.slot.draw
      if ((d.kind === 'fluid' || d.kind === 'glow') && d.bloom > 0.002) return rec.slot.mask
      if (d.kind === 'lit' && d.body >= 0.5) {
        // pushed back, so a fluid that touches its container keeps its glow
        if (!h.occluder) h.occluder = this.track(new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4, toneMapped: false, fog: false }))
        if ((h.occluder.clippingPlanes?.length ?? 0) !== h.planes.length) h.occluder.needsUpdate = true
        h.occluder.clippingPlanes = h.planes
        return h.occluder
      }
      return null
    })
    this.blurAndAdd(color, this.K.fluid.bloom, null, null)
  }
  /** focus: a crisp contour and a soft halo outside the silhouette, from a coverage mask of the part alone */
  private renderFocus(frame: Frame): void {
    const K = this.K, gl = this.gl
    const W = Math.max(2, Math.round(this.rect.width * this.ratio)), H = Math.max(2, Math.round(this.rect.height * this.ratio))
    if (!this.maskCover) {
      this.maskCover = new WebGLRenderTarget(W, H, { samples: 4, depthBuffer: false, format: RedFormat })
      this.maskCover.texture.minFilter = this.maskCover.texture.magFilter = LinearFilter
      this.maskCover.texture.generateMipmaps = false
    }
    const cover = this.maskCover
    const holders: [Group, boolean][] = this.handles.map((h) => [h.holder, h.holder.visible])
    for (const h of this.handles) h.holder.visible = h.shown && h.hero > 0.002
    this.standIn(cover, (h, rec) => {
      if ((this.coverMat.clippingPlanes?.length ?? 0) !== 0) this.coverMat.clippingPlanes = null
      return rec.slot.draw.hero > 0.002 ? this.coverMat : null
    })
    for (const [g, v] of holders) g.visible = v
    // everything the halo and the contour can reach lies inside the part's rectangle plus the blur radius
    const r = this.heroRect
    const reach = K.glow.sigma * K.glow.downscale * 3.2 + 8 + K.focus.outline
    let scissor: [number, number, number, number] | null = null
    if (r) {
      const x0 = Math.max(0, Math.floor(r.x - this.rect.x - reach)), x1 = Math.min(this.rect.width, Math.ceil(r.x - this.rect.x + r.width + reach))
      const top = Math.max(0, Math.floor(r.y - this.rect.y - reach)), bottom = Math.min(this.rect.height, Math.ceil(r.y - this.rect.y + r.height + reach))
      if (x1 > x0 && bottom > top) scissor = [x0, this.rect.height - bottom, x1 - x0, bottom - top] // GL scissors are y-up
    }
    if (scissor) { gl.setScissor(scissor[0], scissor[1], scissor[2], scissor[3]); gl.setScissorTest(true) }
    const pulse = 1 + K.focus.pulse * Math.sin(K.focus.pulseRate * frame.t)
    this.blurAndAdd(cover, K.focus.bloom * this.heroWeight * pulse, this.heroColor, cover)
    const ou = this.outlineMat.uniforms as Uniforms
    this.fsMesh.material = this.outlineMat
    ou.tMap!.value = cover.texture
    ou.uTexel!.value.set(1 / cover.width, 1 / cover.height)
    ou.uRadius!.value = K.focus.outline * this.ratio
    set3(ou.uColor!.value, this.heroColor)
    ou.uOpacity!.value = K.focus.outlineOpacity * this.heroWeight
    const auto = gl.autoClear
    gl.autoClear = false
    gl.setRenderTarget(null)
    gl.render(this.fsScene, this.fsCamera)
    gl.autoClear = auto
    if (scissor) gl.setScissorTest(false)
  }

  /** Pure maths gives the projected silhouette; the id pass gives measured visible pixels. */
  screenRect(): Rect | null { return null }

  // ── picking and the id pass ──────────────────────────────────────────────────────────────────────
  pick(x: number, y: number): MNode | null {
    const r = this.rect
    if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return null
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(((x - r.x) / r.width) * 2 - 1, -(((y - r.y) / r.height) * 2 - 1)), this.camera)
    const owner = new Map<Object3D, Handle>()
    for (const h of this.handles) if (h.shown && !h.shell) { for (const rec of h.recs) owner.set(rec.mesh, h); for (const f of h.fat) owner.set(f.line, h) }
    for (const hit of ray.intersectObjects([...owner.keys()], false)) {
      const h = owner.get(hit.object)
      if (!h) continue
      // what a section plane has removed cannot be picked
      if (h.planes.some((p) => p.distanceToPoint(hit.point) < 0)) continue
      return h.node
    }
    return null
  }

  /**
   * Every part drawn in a flat colour of its own. One full-frame pass for the opaque parts together (they hide each
   * other), then one small pass per housing (and per part with { solo: true }) limited to the rectangle its hull
   * projects to, so the cost follows the area that is read back, not parts × the whole frame.
   */
  idPass(opts: { solo?: boolean } = {}): IdPassResult {
    const gl = this.gl
    const W = this.rect.width, H = this.rect.height
    if (!this.idTarget || this.idTarget.width !== W || this.idTarget.height !== H) { this.idTarget?.dispose(); this.idTarget = new WebGLRenderTarget(W, H, { depthBuffer: true }) }
    const target = this.idTarget
    const parts: IdPassResult['parts'] = {}
    const live = this.handles.filter((h) => h.shown && (h.recs.length || h.fat.length))
    const saved = new Map<Object3D, Material | Material[]>()
    const rgb = (m: { color: Color }, i: number): void => { const n = i + 1; m.color.setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255, LinearSRGBColorSpace) }
    live.forEach((h, i) => {
      const m = (h.idMat ??= this.track(new MeshBasicMaterial({ toneMapped: false, fog: false, side: DoubleSide })))
      rgb(m, i)
      m.clippingPlanes = h.planes
      m.needsUpdate = true
      for (const rec of h.recs) { saved.set(rec.mesh, rec.mesh.material); rec.mesh.material = m }
      h.fat.forEach((f, k) => {
        // a line keeps its own width: one flat-colour line material per (part, line)
        let lm = this.idLineMats.get(h.index + ':' + k)
        if (!lm) this.idLineMats.set(h.index + ':' + k, (lm = new LineMaterial({ toneMapped: false, fog: false })))
        rgb(lm, i)
        lm.linewidth = f.mat.linewidth
        lm.worldUnits = f.mat.worldUnits
        lm.clippingPlanes = h.planes
        lm.needsUpdate = true
        saved.set(f.line, f.line.material)
        f.line.material = lm
      })
    })
    this.camera.layers.set(1) // the bodies and the free lines alone: no crease lines, shells, caps or guides
    /** render the parts `visible` picks into the region (x, y, w, h) of the target (GL pixels, origin bottom-left) and count ids there */
    const pass = (visible: (h: Handle) => boolean, x: number, y: number, w: number, h: number): { stats: Map<number, PixelStat>; buf: Uint8Array } => {
      for (const p of live) p.holder.visible = visible(p)
      target.scissor.set(x, y, w, h)
      target.scissorTest = true
      gl.setRenderTarget(target)
      gl.setClearColor(0x000000, 1)
      gl.clear()
      gl.render(this.scene, this.camera)
      const buf = new Uint8Array(w * h * 4)
      gl.readRenderTargetPixels(target, x, y, w, h, buf)
      const stats = new Map<number, PixelStat>()
      for (let j = 0, p = 0; j < h; j++) {
        for (let i = 0; i < w; i++, p += 4) {
          const id = buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16)
          if (!id) continue
          let e = stats.get(id)
          if (!e) stats.set(id, (e = { n: 0, x0: i, y0: j, x1: i, y1: j, sx: 0, sy: 0 }))
          e.n++
          e.sx += i
          e.sy += j
          if (i < e.x0) e.x0 = i
          if (i > e.x1) e.x1 = i
          if (j < e.y0) e.y0 = j
          if (j > e.y1) e.y1 = j
        }
      }
      return { stats, buf }
    }
    /** the visible pixel of `id` nearest to the centre of its visible area, in stage px */
    const pointOf = (id: number, e: PixelStat, buf: Uint8Array, x: number, y: number, w: number): { x: number; y: number } => {
      const cx = e.sx / e.n, cy = e.sy / e.n
      let best = Infinity, bi = Math.round(cx), bj = Math.round(cy)
      for (let j = e.y0; j <= e.y1; j++) {
        for (let i = e.x0; i <= e.x1; i++) {
          const p = (j * w + i) * 4
          if ((buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16)) !== id) continue
          const d = (i - cx) * (i - cx) + (j - cy) * (j - cy)
          if (d < best) { best = d; bi = i; bj = j }
        }
      }
      // GL rows start at the bottom; stage px start at the top. +0.5 = the centre of the pixel
      return { x: this.rect.x + x + bi + 0.5, y: this.rect.y + (H - 1 - (y + bj)) + 0.5 }
    }
    const rectOf = (e: PixelStat, x: number, y: number): Rect => ({ x: this.rect.x + x + e.x0, y: this.rect.y + (H - 1 - (y + e.y1)), width: e.x1 - e.x0 + 1, height: e.y1 - e.y0 + 1 })
    const part = (h: Handle): IdPassPart => (parts[h.node.id] ??= { id: h.node.id, pixels: 0, rect: { x: 0, y: 0, width: 0, height: 0 }, at: null })
    /** where the pixels of each part can be read again: the buffer it was counted in and the region that buffer covers */
    const sources = new Map<string, { id: number; buf: Uint8Array; x: number; y: number; w: number; h: number; e: PixelStat }>()
    // 1. opaque parts together
    const main = pass((h) => !h.shell, 0, 0, W, H)
    let covered = 0
    live.forEach((h, i) => {
      if (h.shell) return
      const cur = part(h)
      const e = main.stats.get(i + 1)
      if (!e) return
      cur.pixels = e.n
      cur.rect = rectOf(e, 0, 0)
      cur.at = pointOf(i + 1, e, main.buf, 0, 0, W)
      sources.set(h.node.id, { id: i + 1, buf: main.buf, x: 0, y: 0, w: W, h: H, e })
      covered += e.n
    })
    // 2. housings (ghost / glass / shell) alone, and every part alone when asked: only inside its projected rectangle
    const frame = this.shown
    live.forEach((h, i) => {
      if (!h.shell && !opts.solo) return
      const cur = part(h)
      cur.total = 0
      const fr = frame?.frameRect(h.node)
      if (!fr) return
      const a = this.rt.screenToStage([fr.x, fr.y + fr.height])
      const pad = 6 + 0.1 * Math.max(fr.width, fr.height) * this.rt.scale // hulls are approximations of the silhouette
      const x0 = Math.max(0, Math.floor(a.x - this.rect.x - pad)), x1 = Math.min(W, Math.ceil(a.x - this.rect.x + fr.width * this.rt.scale + pad))
      const top = Math.max(0, Math.floor(a.y - this.rect.y - pad)), bottom = Math.min(H, Math.ceil(a.y - this.rect.y + fr.height * this.rt.scale + pad))
      if (x1 <= x0 || bottom <= top) return
      const y0 = H - bottom
      const one = pass((p) => p === h, x0, y0, x1 - x0, bottom - top)
      const e = one.stats.get(i + 1)
      if (!e) return
      cur.total = e.n
      if (h.shell) { cur.pixels = e.n; cur.rect = rectOf(e, x0, y0); cur.at = pointOf(i + 1, e, one.buf, x0, y0, x1 - x0); sources.set(h.node.id, { id: i + 1, buf: one.buf, x: x0, y: y0, w: x1 - x0, h: bottom - top, e }) }
      else if (!cur.pixels) cur.rect = rectOf(e, x0, y0)
    })
    target.scissorTest = false
    this.camera.layers.set(0)
    for (const h of live) h.holder.visible = h.shown
    for (const [obj, m] of saved) (obj as Mesh).material = m
    if (frame) this.draw(frame) // put the picture back
    const result: IdPassResult = { width: W, height: H, scale: 1, background: W * H - covered, parts }
    // the silhouette of a part along a ray (labels and the pointer end on the edge of a part, not on its middle)
    const edge: PartEdgeFn = (id, from, to) => {
      const src = sources.get(id)
      if (!src) return null
      const length = Math.hypot(to.x - from.x, to.y - from.y)
      const steps = Math.max(1, Math.ceil(length * ID_EDGE_STEPS))
      for (let k = 0; k <= steps; k++) {
        const X = from.x + ((to.x - from.x) * k) / steps, Y = from.y + ((to.y - from.y) * k) / steps
        // stage px → the buffer's pixel (GL rows start at the bottom)
        const i = Math.floor(X - this.rect.x) - src.x, j = H - 1 - Math.floor(Y - this.rect.y) - src.y
        if (i < 0 || j < 0 || i >= src.w || j >= src.h) continue
        const p = (j * src.w + i) * 4
        if ((src.buf[p]! | (src.buf[p + 1]! << 8) | (src.buf[p + 2]! << 16)) === src.id) return { x: X, y: Y }
      }
      return null
    }
    Object.defineProperty(result, ID_EDGE, { value: edge })
    // the pixels of a part as points round them: the left and right end of rows of its pixels (a ring hugs these)
    const outline: PartOutlineFn = (id) => {
      const src = sources.get(id)
      if (!src) return []
      const { e } = src, out: { x: number; y: number }[] = []
      const stride = Math.max(1, Math.floor((e.y1 - e.y0 + 1) / ID_OUTLINE_ROWS))
      for (let j = e.y0; j <= e.y1; j = j === e.y1 ? j + 1 : Math.min(e.y1, j + stride)) {
        let lo = -1, hi = -1
        for (let i = e.x0; i <= e.x1; i++) { const p = (j * src.w + i) * 4; if ((src.buf[p]! | (src.buf[p + 1]! << 8) | (src.buf[p + 2]! << 16)) === src.id) { if (lo < 0) lo = i; hi = i } }
        if (lo < 0) continue
        // GL rows start at the bottom; a pixel covers [i, i + 1): the row of pixels is a thin box with four corners
        const top = this.rect.y + (H - 1 - (src.y + j)), left = this.rect.x + src.x + lo, right = this.rect.x + src.x + hi + 1
        out.push({ x: left, y: top }, { x: right, y: top }, { x: left, y: top + 1 }, { x: right, y: top + 1 })
      }
      return out
    }
    Object.defineProperty(result, ID_OUTLINE, { value: outline })
    return result
  }

  // ── user input: damped orbit, zoom, pan; hover. The user's camera wins over the story's cue (Runtime.setView user: true) ──
  hover(id: string | null): void {
    if (id === this.hoverId) return
    this.hoverId = id
    for (const h of this.handles) h.hover = id !== null && (h.node.id === id || h.node.id.startsWith(id + '.')) ? 1 : 0
    this.canvas.dispatchEvent(new CustomEvent('mimir:hover', { bubbles: true, detail: { id } }))
    this.rt.invalidate()
  }
  private listen(): void {
    const c = this.canvas
    const C = this.K.camera
    let drag: { x: number; y: number; pan: boolean } | null = null
    // where the user wants the view, and the eased view that is shown; the easing runs on animation frames of the
    // live page only (a headless frame never has user input)
    let goal: Pose | null = null, shown: Pose | null = null, raf = 0, last = 0
    const step = (now: number): void => {
      raf = 0
      if (!goal || !shown) return
      const k = C.damping > 0 ? 1 - Math.exp(-Math.min(0.1, Math.max(0.001, (now - last) / 1000)) / C.damping) : 1
      last = now
      const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180
      shown = {
        target: [shown.target[0] + (goal.target[0] - shown.target[0]) * k, shown.target[1] + (goal.target[1] - shown.target[1]) * k, shown.target[2] + (goal.target[2] - shown.target[2]) * k],
        azimuth: shown.azimuth + wrap(goal.azimuth - shown.azimuth) * k, elevation: shown.elevation + (goal.elevation - shown.elevation) * k,
        distance: shown.distance * Math.exp(Math.log(goal.distance / shown.distance) * k), fov: goal.fov,
      }
      const near = Math.abs(wrap(goal.azimuth - shown.azimuth)) < 0.02 && Math.abs(goal.elevation - shown.elevation) < 0.02 && Math.abs(Math.log(goal.distance / shown.distance)) < 1e-3 && dist(goal.target, shown.target) < goal.distance * 1e-4
      if (near) shown = goal
      this.rt.setView(shown, { user: true })
      if (!near) raf = requestAnimationFrame(step)
      else if (!drag) goal = shown = null
    }
    const aim = (edit: (p: Pose) => Pose): void => {
      const cur = this.rt.frame.camera()
      if (!goal || !shown) { shown = { ...cur, target: [...cur.target] as Vec3 }; goal = shown; last = performance.now() }
      goal = edit(goal)
      if (!raf) raf = requestAnimationFrame(step)
    }
    const down = (e: PointerEvent): void => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }
      c.setPointerCapture(e.pointerId)
      this.hover(null)
    }
    const move = (e: PointerEvent): void => {
      if (!drag) {
        const box = this.rt.stageEl.getBoundingClientRect()
        this.hover(this.rt.pick(e.clientX - box.left, e.clientY - box.top)?.id ?? null)
        return
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      if (drag.pan) {
        aim((p) => {
          const b = basisOf(p)
          const k = (2 * p.distance * Math.tan((p.fov * Math.PI) / 360)) / this.rect.height
          return { ...p, target: [p.target[0] - (b.right[0] * dx - b.up[0] * dy) * k, p.target[1] - (b.right[1] * dx - b.up[1] * dy) * k, p.target[2] - (b.right[2] * dx - b.up[2] * dy) * k] }
        })
      } else aim((p) => ({ ...p, azimuth: p.azimuth - dx * C.orbit, elevation: clamp(p.elevation + dy * C.orbit, -C.maxElevation, C.maxElevation) }))
    }
    const up = (e: PointerEvent): void => { drag = null; try { c.releasePointerCapture(e.pointerId) } catch { /* not captured */ } }
    const leave = (): void => { if (!drag) this.hover(null) }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      aim((p) => ({ ...p, distance: p.distance * Math.exp(clamp(e.deltaY, -200, 200) * C.zoom) }))
    }
    const dbl = (): void => { goal = shown = null; this.rt.setView(null) }
    const menu = (e: Event): void => e.preventDefault()
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('pointerleave', leave)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('dblclick', dbl)
    c.addEventListener('contextmenu', menu)
    // a camera cue that takes the view back ends the user's easing
    const off = this.rt.on('view', (v: unknown) => { if (v === null) goal = shown = null })
    this.cleanup.push(() => { if (raf) cancelAnimationFrame(raf); off(); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('pointerleave', leave); c.removeEventListener('wheel', wheel); c.removeEventListener('dblclick', dbl); c.removeEventListener('contextmenu', menu) })
  }

  dispose(): void {
    for (const f of this.cleanup) f()
    for (const h of this.handles) {
      for (const rec of h.recs) { rec.mesh.geometry.dispose(); rec.lines?.geometry.dispose(); rec.section?.geometry.dispose() }
      for (const f of h.fat) { f.line.geometry.dispose(); f.mat.dispose() }
    }
    for (const d of this.disposables) d.dispose()
    for (const m of this.idLineMats.values()) m.dispose()
    this.guides?.geometry.dispose()
    for (const t of [this.maskColor, this.maskCover, this.blurA, this.blurB, this.idTarget]) t?.dispose()
    this.gl?.dispose()
    this.canvas?.remove()
    this.handles = []
    this.byNode.clear()
  }
}
defineRenderer('3d', () => new Three3D())
// __mimir.info().r3d: what the frame on screen cost (draw calls, triangles, parts drawn), for whoever tunes a scene
defineManifest('r3d', (_model, runtime) => (runtime?.renderers.get('3d') as Renderer3D | undefined)?.stats?.() ?? null)

// ── primitive backends ───────────────────────────────────────────────────────────────────────────────
// Unit geometry scaled by the options wherever the shape allows it, so dynamic sizes cost no rebuild.
defineKindBackend<Mesh, Ctx3D>('box', {
  build: (_n, c) => c.mesh(new BoxGeometry(1, 1, 1)),
  update: (m, r) => { m.scale.set(r.width, r.height, r.depth) },
})
defineKindBackend<Mesh, Ctx3D>('sphere', {
  build: (_n, c) => c.mesh(new SphereGeometry(1, c.look.detail.sphere[0], c.look.detail.sphere[1]), { edges: false }),
  update: (m, r) => { m.scale.setScalar(r.radius) },
})
defineKindBackend<Mesh, Ctx3D>('cylinder', {
  build: (_n, c) => c.mesh(new CylinderGeometry(1, 1, 1, c.look.detail.round)),
  update: (m, r) => { m.scale.set(r.radius, r.height, r.radius) },
})
defineKindBackend<Mesh, Ctx3D>('cone', {
  build: (_n, c) => c.mesh(new ConeGeometry(1, 1, c.look.detail.round)),
  update: (m, r) => { m.scale.set(r.radius, r.height, r.radius) },
})
defineKindBackend<Mesh, Ctx3D>('torus', {
  build: (_n, c) => c.mesh(new BufferGeometry(), { edges: false }),
  update: (m, r, c) => { c.geometry(m, `${r.radius}:${r.tube}`, () => new TorusGeometry(r.radius, r.tube, c.look.detail.torus[0], c.look.detail.torus[1]).rotateX(Math.PI / 2)) },
})
defineKindBackend<Mesh, Ctx3D>('link', {
  build: (_n, c) => c.mesh(new CylinderGeometry(1, 1, 1, c.look.detail.rod)),
  update: (m, r) => { m.scale.set(r.radius, Math.max(1e-6, dist(r.a, r.b)), r.radius) },
})
/** hollow cylinder: one closed solid (outer wall, inner wall, two flat rings), so a section plane can cap it */
function tubeSoup(ro: number, ri: number, h: number, seg: number): Soup {
  const positions: number[] = [], indices: number[] = []
  for (let j = 0; j < seg; j++) {
    const a = (j / seg) * 2 * Math.PI, s = Math.sin(a), c = Math.cos(a)
    positions.push(ro * s, -h / 2, ro * c, ro * s, h / 2, ro * c, ri * s, h / 2, ri * c, ri * s, -h / 2, ri * c)
  }
  for (let j = 0; j < seg; j++) {
    const a = 4 * j, b = 4 * ((j + 1) % seg)
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; indices.push(a + k, b + k, b + k2, a + k, b + k2, a + k2) }
  }
  return outward({ positions, indices })
}
defineKindBackend<Mesh, Ctx3D>('tube', {
  build: (_n, c) => c.mesh(new BufferGeometry()),
  update(m, r, c) {
    const ri = Math.max(1e-4, r.radius - Math.min(r.thickness, r.radius * 0.98))
    c.geometry(m, `${r.radius}:${ri}:${r.height}`, () => toGeometry(tubeSoup(r.radius, ri, r.height, c.look.detail.round)))
  },
})
/** a shape that could not be built is drawn as nothing: the constructor has already reported why */
const orEmpty = (s: Soup | null): BufferGeometry => (s ? toGeometry(s) : new BufferGeometry())
defineKindBackend<Mesh, Ctx3D>('extrude', {
  build: (_n, c) => c.mesh(new BufferGeometry()),
  update(m, r, c) {
    // without a bevel the depth is a scale of a unit-deep shape, so a depth that follows a param costs no rebuild
    const bevel = Number(r.bevel) || 0
    c.geometry(m, bevel > 0 ? `b:${r.depth}:${bevel}` : 'unit', () => orEmpty(extrudeMesh(r.profile, r.holes ?? [], bevel > 0 ? r.depth : 1, bevel)))
    m.scale.set(1, 1, bevel > 0 ? 1 : r.depth)
  },
})
defineKindBackend<Mesh, Ctx3D>('lathe', {
  build: (_n, c) => c.mesh(new BufferGeometry()),
  update(m, r, c) { c.geometry(m, `s:${r.segments}`, () => orEmpty(latheMesh(r.profile, r.segments))) },
})
defineKindBackend<Mesh, Ctx3D>('sweep', {
  build: (_n, c) => c.mesh(new BufferGeometry()),
  update(m, r, c) {
    c.geometry(m, `${r.radius}:${r.bend}:${r.closed}:${r.sides}`, () => {
      const bend = r.bend === null || r.bend === undefined ? 2 * r.radius : r.bend
      const path = bend > 0 ? smoothPath(r.path as Vec3[], { radius: bend, samples: c.look.detail.bend, closed: !!r.closed }) : (r.path as Vec3[])
      return orEmpty(sweepMesh(path, r.radius, r.sides, !!r.closed))
    })
  },
})
defineKindBackend<Mesh, Ctx3D>('mesh', {
  build(node, c) {
    const src = meshSource(node)
    if (!src) return c.mesh(new BufferGeometry())
    const indices = src.indices ? Array.from(src.indices) : Array.from({ length: src.positions.length / 3 }, (_, i) => i)
    return c.mesh(toGeometry(outward({ positions: Array.from(src.positions), indices })))
  },
})
defineKindBackend<LineSegments, Ctx3D>('placeholder3d', {
  build: () => new LineSegments(new EdgesGeometry(new BoxGeometry(0.5, 0.5, 0.5)), new LineBasicMaterial({ color: new Color(INVALID_COLOR) })),
})

export { kindOf, MATERIALS }
