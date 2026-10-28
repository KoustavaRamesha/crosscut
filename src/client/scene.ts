import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { boxes, type Vec3 } from '../shared/world'
import { EYE, FRAG, spray, WEAPONS, type Weapon } from '../shared/physics'
import type { GameEvent, Player, Snapshot } from '../shared/protocol'
export type Quality = 'low' | 'medium' | 'high'
const colors = {
  stone: 0xc5ab88,
  teal: 0x416d6a,
  wood: 0x957650,
  dark: 0x26383b,
  trim: 0xead2a8,
}
export class World {
  renderer: T.WebGLRenderer
  scene = new T.Scene()
  camera = new T.PerspectiveCamera(85, 1, 0.06, 180)
  viewScene = new T.Scene()
  viewCamera = new T.PerspectiveCamera(63, 1, 0.02, 10)
  rifle = new T.Group()
  knife = new T.Group()
  smg = new T.Group()
  sniper = new T.Group()
  models: Record<Weapon, T.Group>
  muzzle: T.Mesh
  players = new Map<
    string,
    {
      root: T.Group
      legs: T.Group[]
      arms: T.Group[]
      shadow: T.Mesh
      poseB: number
      slideB: number
    }
  >()
  effects: {
    mesh: T.Object3D
    life: number
    velocity?: T.Vector3
    grow?: number
    fade?: number
  }[] = []
  kick = 0
  slash = 0
  reload = 0
  bob = 0
  landing = 0
  aim = 0
  eye = EYE
  tilt = 0
  playersClock = 0
  nades = new Map<string, T.Mesh>()
  lastY = 0
  wasGrounded = false
  fov = 85
  quality: Quality = 'high'
  reducedMotion = false
  frameMs = 0
  frameSamples = 0
  drawCalls = 0
  triangles = 0
  private dust?: T.Points
  private dustBase?: Float32Array
  time = 0
  menu = true
  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65))
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.renderer.info.autoReset = false
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.22
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.scene.background = new T.Color(0xb5ccce)
    this.scene.fog = new T.Fog(0xb5ccce, 55, 130)
    this.scene.add(new T.HemisphereLight(0xdceefd, 0x9b7958, 2.8))
    const sun = new T.DirectionalLight(0xffe3af, 3.3)
    sun.position.set(-28, 46, 23)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, {
      left: -40,
      right: 40,
      top: 40,
      bottom: -40,
      near: 1,
      far: 120,
    })
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.035
    this.scene.add(sun)
    this.buildMap()
    this.buildDust()
    this.setQuality('high')
    this.viewScene.add(new T.HemisphereLight(0xf0f5ff, 0x8d6955, 3))
    const light = new T.DirectionalLight(0xffe4bf, 4)
    light.position.set(-2, 4, 1)
    this.viewScene.add(light)
    this.rifle = this.makeRifle()
    this.knife = this.makeKnife()
    this.smg = this.makeSmg()
    this.sniper = this.makeSniper()
    this.models = { rifle: this.rifle, smg: this.smg, sniper: this.sniper, knife: this.knife }
    this.viewScene.add(this.rifle, this.knife, this.smg, this.sniper)
    for (const gun of [this.rifle, this.smg, this.sniper]) {
      const muzzle = new T.Mesh(
        new T.ConeGeometry(0.055, 0.16, 5),
        new T.MeshBasicMaterial({
          color: 0xffe9a2,
          transparent: true,
          opacity: 0.9,
        }),
      )
      muzzle.rotation.x = -Math.PI / 2
      muzzle.position.set(0, 0.02, gun === this.rifle ? -0.75 : gun === this.smg ? -0.46 : -0.68)
      gun.add(muzzle)
      gun.userData.muzzle = muzzle
      muzzle.visible = false
    }
    this.muzzle = this.rifle.userData.muzzle
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }
  private buildDust() {
    const count = 84, positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ((i * 37.17) % 46) - 23
      positions[i * 3 + 1] = 0.5 + ((i * 13.73) % 6)
      positions[i * 3 + 2] = ((i * 19.31) % 42) - 21
    }
    const geometry = new T.BufferGeometry()
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
    this.dustBase = positions.slice()
    this.dust = new T.Points(geometry, new T.PointsMaterial({ color: 0xf1d8a8, size: 0.055, transparent: true, opacity: 0.34, depthWrite: false, sizeAttenuation: true }))
    this.scene.add(this.dust)
  }
  setQuality(quality: Quality) {
    this.quality = quality
    const ratio = quality === 'low' ? 1 : quality === 'medium' ? 1.25 : 1.65
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, ratio))
    this.renderer.shadowMap.enabled = quality !== 'low'
    if (this.dust) {
      const count = quality === 'low' ? 20 : quality === 'medium' ? 48 : 84
      this.dust.geometry.setDrawRange(0, count)
      ;(this.dust.material as T.PointsMaterial).size = quality === 'low' ? 0.04 : 0.055
    }
    const size = quality === 'low' ? 512 : quality === 'medium' ? 1024 : 2048
    if (this.scene.children.length) {
      const sun = this.scene.children.find((child) => child instanceof T.DirectionalLight) as T.DirectionalLight | undefined
      if (sun) sun.shadow.mapSize.set(size, size)
    }
  }
  resize() {
    const w = innerWidth,
      h = innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.viewCamera.aspect = w / h
    this.viewCamera.updateProjectionMatrix()
  }
  buildMap() {
    const batches = new Map<number, T.BufferGeometry[]>()
    const add = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
      ry = 0,
    ) => {
      const g = new T.BoxGeometry(w, h, d)
      g.rotateY(ry)
      g.translate(x, y, z)
      if (!batches.has(color)) batches.set(color, [])
      batches.get(color)!.push(g)
    }
    for (const b of boxes) {
      add(b.x, b.y, b.z, b.w, b.h, b.d, colors[b.material])
      if (b.material === 'stone' && b.h > 2) {
        add(
          b.x,
          b.y + b.h / 2 + 0.08,
          b.z,
          b.w + 0.15,
          0.16,
          b.d + 0.15,
          0xdfc6a1,
        )
      }
    }
    // Fine masonry lines, grouped into a handful of draw calls.
    for (let z = -21; z < 23; z += 2)
      for (const x of [-23.98, 23.98]) {
        add(x, 1.6, z, 0.015, 0.025, 1.96, 0x9e8e77)
        add(x, 3.2, z, 0.015, 0.025, 1.96, 0x9e8e77)
        add(x, 2.4, z, 0.018, 1.55, 0.025, 0xab9679)
      }
    for (let z = -20; z < 23; z += 4)
      for (let x = -22; x < 24; x += 4) {
        add(x, 0.006, z, 3.98, 0.008, 0.025, 0xbca487)
        add(x, 0.008, z, 0.025, 0.008, 3.98, 0xbca487)
      }
    // Teal shutters and inset workshop windows.
    for (const [x, z] of [
      [-19.5, -7.47],
      [-10.4, -7.47],
      [11, 10.53],
      [19, 10.53],
    ]) {
      add(x, 2.1, z, 2.7, 3.8, 0.1, 0x304b4d)
      for (let n = 0; n < 9; n++)
        add(x, 0.5 + n * 0.4, z + 0.08, 2.6, 0.3, 0.12, 0x547c76)
      add(x, 4.2, z, 3.2, 0.22, 0.45, 0xead2a8)
    }
    for (const x of [-21, -18, -12, -9]) {
      add(x, 3, -5.4, 0.22, 6, 0.22, 0x77654e)
      add(x, 5.9, -4.8, 0.3, 0.3, 6, 0x77654e)
    }
    for (let x = -21.5; x < -8; x += 0.65)
      add(x, 6, -5.2, 0.22, 0.18, 5.6, 0xb9a581)
    // Container corrugation and corner hardware.
    for (let z = 5; z <= 11; z += 0.35)
      add(-8.38, 1.4, z, 0.08, 2.7, 0.1, 0x557f78)
    for (let x = 10.5; x <= 15.5; x += 0.35)
      add(x, 1.3, -9.46, 0.1, 2.5, 0.08, 0x557f78)
    for (const z of [4.85, 11.15])
      for (const x of [-11.55, -8.45]) add(x, 1.45, z, 0.1, 2.9, 0.1, 0x263f3d)
    // Crate battens and dark metal straps.
    for (const b of boxes.filter((b) => b.material === 'wood')) {
      for (let h = -b.h / 2 + 0.1; h < b.h / 2; h += 0.3)
        add(b.x, b.y + h, b.z + b.d / 2 + 0.01, b.w, 0.018, 0.025, 0x71583f)
      for (const x of [-0.35, 0.35])
        add(b.x + x * b.w, b.y, b.z + b.d / 2 + 0.03, 0.1, b.h, 0.05, 0x3b4744)
    }
    // Roof skylights, drainage, painted lane marks and low stone kerbs.
    for (const x of [11, 14, 17, 20]) add(x, 7.68, 5, 1.6, 0.1, 7.3, 0x678785)
    for (let z = -21; z < 22; z += 3) {
      add(6.5, 0.015, z, 0.13, 0.015, 1.3, 0xe7d7b8)
    }
    for (let z = -18; z < 22; z += 1.1) {
      add(-22.7, 0.08, z, 0.5, 0.16, 0.9, 0xd2bd9c)
    }
    add(3.4, 6.8, -2.74, 0.65, 0.7, 0.06, 0x386460)
    add(3.4, 6.8, -2.78, 0.08, 0.45, 0.02, 0xe3ceaa)
    // Distant quarry terraces surround the arena instead of an empty horizon.
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2,
        r = 51 + Math.sin(i * 5) * 7,
        h = 9 + Math.sin(i * 3.2) * 5
      add(
        Math.sin(angle) * r,
        h / 2 - 1,
        Math.cos(angle) * r,
        14,
        h,
        13,
        i % 3 === 0 ? 0x9ca59b : 0xbaac95,
        angle * 0.6,
      )
    }
    add(0, -1.5, 0, 180, 1, 180, 0xbaaa8e)
    // Sparse desert plants, steel lamps, ochre cables.
    for (const [x, z] of [
      [-22, 19],
      [22, -19],
      [-6, -20],
      [21, 20],
    ]) {
      add(x, 0.4, z, 1.2, 0.8, 1.2, 0x9d7355)
      for (let n = 0; n < 5; n++)
        add(
          x + Math.sin(n) * 0.22,
          1.2 + Math.cos(n) * 0.1,
          z + Math.cos(n) * 0.22,
          0.2,
          1.5,
          0.2,
          0x677b58,
          n,
        )
    }
    for (const [color, geoms] of batches) {
      const merged = mergeGeometries(geoms)
      const mesh = new T.Mesh(
        merged,
        new T.MeshStandardMaterial({
          color,
          roughness: 0.91,
          flatShading: true,
        }),
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
      for (const g of geoms) g.dispose()
    }
    const wire = new T.Line(
      new T.BufferGeometry().setFromPoints(
        Array.from(
          { length: 30 },
          (_, i) =>
            new T.Vector3(
              -21 + i * 1.5,
              8 - Math.sin((i / 29) * Math.PI) * 2,
              -5,
            ),
        ),
      ),
      new T.LineBasicMaterial({ color: 0x474944 }),
    )
    this.scene.add(wire)
    // Three angular fabric shades add a distinct silhouette.
    const sail = new T.BufferGeometry()
    sail.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [-21, 6.2, -7, -8, 6.2, -7, -19, 6.1, -2],
        3,
      ),
    )
    sail.computeVertexNormals()
    const fabric = new T.Mesh(
      sail,
      new T.MeshStandardMaterial({
        color: 0xd1af78,
        side: T.DoubleSide,
        roughness: 1,
      }),
    )
    fabric.castShadow = true
    this.scene.add(fabric)
  }
  part(
    group: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    rx = 0,
  ) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({
        color,
        roughness: 0.64,
        metalness: color === 0x283236 ? 0.5 : 0,
        flatShading: true,
      }),
    )
    mesh.position.set(x, y, z)
    mesh.rotation.x = rx
    group.add(mesh)
    return mesh
  }
  makeRifle() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, 0, 0, 0.095, 0.12, 0.38, 0x283236)
    p(0, 0.065, -0.04, 0.073, 0.035, 0.28, 0x39474a)
    p(0, -0.005, -0.32, 0.086, 0.09, 0.25, 0x936649)
    p(0, 0.045, -0.37, 0.039, 0.035, 0.33, 0x283236)
    p(0, 0.027, -0.59, 0.031, 0.04, 0.3, 0x283236)
    p(0, 0.09, -0.65, 0.025, 0.1, 0.033, 0x283236)
    p(0, 0.145, -0.66, 0.055, 0.02, 0.025, 0x283236)
    p(0, -0.12, 0.07, 0.064, 0.18, 0.075, 0x675844, -0.22)
    p(0, -0.15, -0.115, 0.07, 0.24, 0.1, 0x283236, -0.2)
    p(0, -0.29, -0.08, 0.065, 0.09, 0.09, 0x344144, -0.4)
    p(0, -0.027, 0.3, 0.09, 0.14, 0.25, 0x936649)
    p(0, -0.027, 0.44, 0.1, 0.15, 0.03, 0x263236)
    for (let n = 0; n < 5; n++) {
      p(0.046, -0.01, -0.25 - n * 0.032, 0.009, 0.07, 0.015, 0x6d4b36)
      p(
        0.038,
        -0.15 - n * 0.025,
        -0.13 + n * 0.005,
        0.007,
        0.008,
        0.06,
        0x465154,
      )
    }
    p(0.043, 0.027, 0.05, 0.05, 0.018, 0.055, 0x59615d)
    p(0, 0.095, 0.08, 0.06, 0.045, 0.05, 0x283236)
    // Gloved hands and forearms.
    p(0.025, -0.16, 0.11, 0.105, 0.1, 0.15, 0x333f3c, 0.15)
    p(0.035, -0.245, 0.24, 0.105, 0.12, 0.26, 0xb79b7a, -0.4)
    p(-0.06, -0.08, -0.3, 0.105, 0.1, 0.16, 0x34443f)
    p(-0.16, -0.19, -0.18, 0.11, 0.13, 0.35, 0xb79b7a, -0.5)
    return g
  }
  makeKnife() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, -0.08, 0, 0.07, 0.07, 0.2, 0x34423f)
    p(0, -0.08, -0.12, 0.15, 0.035, 0.035, 0x707f7e)
    p(0, -0.06, -0.27, 0.035, 0.055, 0.27, 0xb5c5bc)
    p(0, -0.04, -0.44, 0.025, 0.028, 0.09, 0xdce4d8, -0.12)
    p(0.015, -0.12, 0.035, 0.12, 0.1, 0.15, 0x374740)
    p(0.02, -0.23, 0.19, 0.12, 0.15, 0.26, 0xb79b7a, -0.5)
    return g
  }
  makeSmg() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, 0, 0, 0.085, 0.115, 0.3, 0x2a3a3d)
    p(0, -0.015, -0.21, 0.06, 0.06, 0.24, 0x20292b)
    p(0, 0.055, -0.03, 0.055, 0.03, 0.2, 0x41565a)
    p(0, 0.082, -0.1, 0.018, 0.032, 0.02, 0x333a3a)
    p(0, -0.11, 0.02, 0.055, 0.14, 0.08, 0x2f3538, -0.16)
    p(0, -0.05, 0.13, 0.07, 0.17, 0.12, 0x27362f)
    p(0, -0.005, 0.26, 0.075, 0.09, 0.13, 0x2a3a3d)
    for (let n = 0; n < 4; n++)
      p(0.032, -0.012, -0.12 - n * 0.03, 0.01, 0.052, 0.014, 0x1d262a)
    // Gloved hands and forearms.
    p(0.02, -0.15, 0.09, 0.1, 0.095, 0.13, 0x333f3c, 0.15)
    p(0.03, -0.24, 0.2, 0.1, 0.115, 0.24, 0xb79b7a, -0.4)
    p(-0.055, -0.08, -0.26, 0.1, 0.095, 0.15, 0x34443f)
    p(-0.15, -0.18, -0.15, 0.105, 0.125, 0.32, 0xb79b7a, -0.5)
    return g
  }
  makeSniper() {
    const g = new T.Group(),
      p = this.part.bind(this, g)
    p(0, 0, 0.02, 0.08, 0.12, 0.5, 0x39423c)
    p(0, 0.02, -0.36, 0.045, 0.045, 0.32, 0x232c2a)
    p(0, 0.012, -0.56, 0.03, 0.036, 0.14, 0x1c2322)
    p(0, 0.13, -0.06, 0.055, 0.05, 0.24, 0x14181a)
    p(0, 0.13, -0.19, 0.062, 0.062, 0.02, 0x14181a)
    p(0, 0.13, 0.06, 0.06, 0.06, 0.02, 0x14181a)
    p(0, 0.09, -0.12, 0.02, 0.046, 0.05, 0x0f1213)
    p(0, -0.115, 0.06, 0.055, 0.14, 0.08, 0x2f2a22, -0.2)
    p(0, -0.06, 0.17, 0.08, 0.14, 0.17, 0x41372e)
    p(0, -0.02, -0.21, 0.03, 0.05, 0.1, 0x2f2a22)
    // Gloved hands and forearms.
    p(0.025, -0.16, 0.13, 0.105, 0.1, 0.15, 0x333f3c, 0.15)
    p(0.035, -0.245, 0.26, 0.105, 0.12, 0.26, 0xb79b7a, -0.4)
    p(-0.055, -0.08, -0.32, 0.105, 0.1, 0.16, 0x34443f)
    p(-0.16, -0.19, -0.18, 0.11, 0.13, 0.35, 0xb79b7a, -0.5)
    return g
  }
  actor(p: Player) {
    const root = new T.Group(),
      part = this.part.bind(this, root)
    const botPalette = [0xe66d4e, 0xd5b34d, 0x73c8a4, 0x77a8e0, 0xc785d9]
    const botHash = [...p.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0)
    const accent = p.bot ? botPalette[botHash % botPalette.length] : 0xd9f3a7
    part(0, 1.04, 0, 0.58, 0.52, 0.32, p.bot ? 0x344d4b : 0x3f6563)
    part(0, 1.05, -0.18, 0.46, 0.34, 0.075, 0x263c3c)
    part(0, 1.29, -0.225, 0.34, 0.045, 0.025, accent)
    part(0, 1.48, -0.18, 0.2, 0.06, 0.035, accent)
    for (const x of [-0.15, 0, 0.15])
      part(x, 1.03, -0.24, 0.12, 0.19, 0.08, 0x607f71)
    part(0, 1.47, 0, 0.36, 0.35, 0.33, 0xb79b7a)
    part(0, 1.66, 0, 0.43, 0.14, 0.4, 0x3a5350)
    part(0, 1.52, -0.18, 0.34, 0.09, 0.04, 0x263536)
    part(0, 1.58, -0.23, 0.45, 0.04, 0.09, 0x3a5350)
    part(0.3, 1.17, 0, 0.08, 0.15, 0.2, 0xd6a364)
    part(-0.3, 1.17, 0, 0.08, 0.15, 0.2, 0xd6a364)
    const legs: T.Group[] = [],
      arms: T.Group[] = []
    for (const side of [-1, 1]) {
      const leg = new T.Group()
      leg.position.set(side * 0.16, 0.78, 0)
      this.part(leg, 0, -0.31, 0, 0.23, 0.58, 0.25, 0x535c50)
      this.part(leg, 0, -0.69, -0.055, 0.25, 0.19, 0.35, 0x2c3834)
      root.add(leg)
      legs.push(leg)
      const arm = new T.Group()
      arm.position.set(side * 0.37, 1.2, 0)
      this.part(arm, 0, -0.21, -0.08, 0.2, 0.43, 0.22, 0x4c6b5c, -0.4)
      this.part(arm, 0, -0.37, -0.18, 0.18, 0.15, 0.18, 0x283c36)
      this.part(arm, 0, -0.18, -0.08, 0.205, 0.055, 0.23, accent)
      root.add(arm)
      arms.push(arm)
    }
    part(0.22, 0.98, -0.45, 0.07, 0.08, 0.6, 0x283236)
    part(0.22, 0.99, -0.43, 0.085, 0.08, 0.23, 0x9e7050)
    const shadow = new T.Mesh(
      new T.CircleGeometry(0.52, 20),
      new T.MeshBasicMaterial({
        color: 0x343730,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    )
    shadow.rotation.x = -Math.PI / 2
    this.scene.add(shadow, root)
    this.players.set(p.id, { root, legs, arms, shadow, poseB: 0, slideB: 0 })
    return this.players.get(p.id)!
  }
  updatePlayers(players: Player[], localId: string) {
    const seen = new Set<string>()
    for (const p of players) {
      if (p.id === localId) continue
      seen.add(p.id)
      const a = this.players.get(p.id) ?? this.actor(p)
      a.root.visible = p.health > 0
      a.shadow.visible = p.health > 0
      a.root.position.set(p.x, p.y, p.z)
      a.root.rotation.y = p.yaw
      a.shadow.position.set(p.x, 0.018, p.z)
      a.shadow.scale.setScalar(1 + Math.max(0, p.y) * 0.1)
      // Blend crouch (pose 1) and slide (pose 2) into the animated skeleton.
      const dt = Math.max(0.001, (performance.now() - this.playersClock) / 1000)
      const bend = p.pose === 1 ? 1 : 0,
        lying = p.pose === 2 ? 1 : 0
      a.poseB += (bend - a.poseB) * (1 - Math.exp(-dt * 11))
      a.slideB += (lying - a.slideB) * (1 - Math.exp(-dt * 10))
      a.root.scale.y = 1 - a.poseB * 0.26
      a.root.rotation.x = -a.slideB * 1.02
      a.root.position.y += a.slideB * 0.24
      const walk = Math.min(1, Math.hypot(p.vx, p.vz) / 6)
      a.legs.forEach(
        (leg, n) =>
          (leg.rotation.x =
            Math.sin(this.time * 13 + n * Math.PI) * 0.65 * walk +
            a.poseB * 0.55 +
            a.slideB * 0.9),
      )
      a.arms.forEach((arm) => (arm.rotation.x = -p.pitch + a.slideB * 0.5))
    }
    for (const [id, a] of this.players)
      if (!seen.has(id)) {
        this.scene.remove(a.root, a.shadow)
        a.root.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.geometry.dispose()
            ;(o.material as T.Material).dispose()
          }
        })
        a.shadow.geometry.dispose()
        ;(a.shadow.material as T.Material).dispose()
        this.players.delete(id)
      }
  }
  shot(weapon: Weapon) {
    if (weapon === 'rifle') this.kick = Math.min(0.12, this.kick + 0.065)
    else if (weapon === 'smg') this.kick = Math.min(0.1, this.kick + 0.04)
    else if (weapon === 'sniper') this.kick = Math.min(0.17, this.kick + 0.13)
    else this.slash = 1
    const muzzle = weapon === 'knife' ? undefined : (this.models[weapon].userData.muzzle as T.Mesh)
    if (muzzle) {
      muzzle.visible = true
      setTimeout(() => (muzzle.visible = false), 35)
    }
  }
  updateNades(list: Snapshot['nades']) {
    const seen = new Set<string>()
    for (const g of list) {
      seen.add(g.id)
      let m = this.nades.get(g.id)
      if (!m) {
        m = new T.Mesh(
          new T.SphereGeometry(FRAG.radius + 0.045, 10, 8),
          new T.MeshStandardMaterial({
            color: 0x2f4634,
            roughness: 0.45,
            metalness: 0.35,
            flatShading: true,
          }),
        )
        this.scene.add(m)
        this.nades.set(g.id, m)
      }
      m.position.set(g.x, g.y, g.z)
      m.rotation.x += 0.22
      m.rotation.z += 0.17
    }
    for (const [id, m] of this.nades)
      if (!seen.has(id)) {
        this.scene.remove(m)
        m.geometry.dispose()
        ;(m.material as T.Material).dispose()
        this.nades.delete(id)
      }
  }
  // Frag detonation: a growing fireball plus debris spray.
  boom(at: Vec3) {
    const flash = new T.Mesh(
      new T.SphereGeometry(0.4, 14, 10),
      new T.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.95,
      }),
    )
    flash.position.set(at.x, at.y, at.z)
    this.scene.add(flash)
    this.effects.push({ mesh: flash, life: this.reducedMotion ? 0.12 : 0.3, grow: this.reducedMotion ? 12 : 26, fade: this.reducedMotion ? 0.12 : 0.3 })
    if (this.quality === 'low' || this.reducedMotion) return
    const debrisCount = this.quality === 'medium' ? 8 : 18
    for (let n = 0; n < debrisCount; n++) {
      const mesh = new T.Mesh(
        new T.BoxGeometry(0.08, 0.08, 0.08),
        new T.MeshBasicMaterial({ color: n % 2 ? 0x40342a : 0xd8c7ad }),
      )
      mesh.position.set(at.x, at.y, at.z)
      this.scene.add(mesh)
      this.effects.push({
        mesh,
        life: 0.5 + this.randomVisual() * 0.45,
        velocity: new T.Vector3(
          (this.randomVisual() - 0.5) * 10,
          this.randomVisual() * 6.5 + 1,
          (this.randomVisual() - 0.5) * 10,
        ),
        grow: 2.2,
      })
    }
  }
  private visualState = 0x91e10da5
  private randomVisual() {
    let t = this.visualState += 0x6d2b79f5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  event(e: GameEvent, localId: string) {
    if (e.type !== 'shot') return
    const tracerColor: Record<Weapon, number | undefined> = {
      rifle: 0xffe2aa,
      smg: 0xffcfae,
      sniper: 0xfff6e0,
      knife: undefined,
    }
    if (e.id !== localId && tracerColor[e.weapon]) {
      const points = [
        new T.Vector3(e.from.x, e.from.y - 0.2, e.from.z),
        new T.Vector3(e.to.x, e.to.y, e.to.z),
      ]
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        new T.LineBasicMaterial({
          color: tracerColor[e.weapon],
          transparent: true,
          opacity: 0.65,
        }),
      )
      this.scene.add(line)
      this.effects.push({ mesh: line, life: 0.06 })
    }
    if (e.weapon !== 'knife' && this.quality !== 'low' && !this.reducedMotion) {
      const impactCount = this.quality === 'medium' ? (e.hit ? 3 : 1) : (e.hit ? 5 : 3)
      for (let n = 0; n < impactCount; n++) {
        const mesh = new T.Mesh(
          new T.BoxGeometry(0.035, 0.035, 0.035),
          new T.MeshBasicMaterial({ color: e.hit ? 0xc99166 : 0xf0dab7 }),
        )
        mesh.position.set(e.to.x, e.to.y, e.to.z)
        this.scene.add(mesh)
        this.effects.push({
          mesh,
          life: 0.25 + this.randomVisual() * 0.15,
          velocity: new T.Vector3(
            (this.randomVisual() - 0.5) * 3,
            this.randomVisual() * 3,
            (this.randomVisual() - 0.5) * 3,
          ),
        })
      }
    }
  }
  render(
    dt: number,
    local?: Player,
    look?: { yaw: number; pitch: number; aim: boolean },
    idle = false,
  ) {
    this.time += dt
    this.frameMs = this.frameMs * 0.92 + dt * 1000 * 0.08
    this.frameSamples++
    if (this.dust && this.dustBase) {
      const positions = this.dust.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3] = this.dustBase[i * 3] + Math.sin(this.time * 0.13 + i) * 0.28
        positions[i * 3 + 1] = 0.5 + ((this.dustBase[i * 3 + 1] - 0.5 + this.time * (0.12 + i % 5 * 0.025)) % 6)
        positions[i * 3 + 2] = this.dustBase[i * 3 + 2] + Math.cos(this.time * 0.1 + i * 0.7) * 0.2
      }
      this.dust.geometry.attributes.position.needsUpdate = true
    }
    for (let n = this.effects.length - 1; n >= 0; n--) {
      const e = this.effects[n]
      e.life -= dt
      if (e.velocity) {
        e.velocity.y -= 10 * dt
        e.mesh.position.addScaledVector(e.velocity, dt)
      }
      if (e.grow && e.mesh instanceof T.Mesh)
        e.mesh.scale.setScalar(e.mesh.scale.x + e.grow * dt)
      if (e.fade && e.mesh instanceof T.Mesh) {
        const mat = e.mesh.material as T.MeshBasicMaterial
        mat.opacity = Math.max(0, e.life / e.fade) * 0.95
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh)
        const m = e.mesh as T.Mesh
        m.geometry.dispose()
        ;(m.material as T.Material).dispose()
        this.effects.splice(n, 1)
      }
    }
    this.kick *= Math.exp(-dt * 19)
    this.slash *= Math.exp(-dt * 10)
    if (!local) {
      const a = Math.sin(this.time * 0.045) * 0.08
      this.camera.position.set(27 + Math.sin(a) * 7, 20, 31)
      this.camera.lookAt(-3, 2, -2)
      this.camera.fov = 58
      this.camera.updateProjectionMatrix()
    } else if (look) {
      const speed = Math.hypot(local.vx, local.vz)
      if (!this.reducedMotion) this.bob += dt * speed * 1.5
      if (!this.wasGrounded && local.grounded) this.landing = 0.055
      this.wasGrounded = local.grounded
      this.landing *= Math.exp(-dt * 14)
      this.aim +=
        (Number(look.aim && local.weapon !== 'knife') - this.aim) *
        (1 - Math.exp(-dt * 15))
      // Camera squats with crouch, dips low during a slide, and tilts into it.
      const eyeTarget = local.pose === 2 ? 0.95 : local.pose === 1 ? 1.06 : EYE
      this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-dt * 12))
      const targetTilt = this.reducedMotion ? 0 : Number(local.pose === 2) * 0.07
      this.tilt += (targetTilt - this.tilt) * (1 - Math.exp(-dt * 10))
      this.camera.position.set(
        local.x,
        local.y +
          this.eye -
          this.landing +
          (local.grounded ? Math.sin(this.bob * 2) * 0.012 : 0),
        local.z,
      )
      const recoil = spray(Math.max(0, local.shot - 1), look.aim)
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.set(
        look.pitch + this.kick * 0.24 + recoil.pitch,
        look.yaw + recoil.yaw - this.tilt * 0.4,
        this.tilt,
      )
      this.camera.fov =
        this.fov -
        this.aim * WEAPONS[local.weapon].ads +
        (this.reducedMotion ? 0 : Math.max(0, speed - 8) * 0.35)
      this.camera.updateProjectionMatrix()
      const scoped =
        local.weapon === 'sniper' && !!look?.aim && this.aim > 0.55
      for (const w of Object.keys(this.models) as Weapon[])
        this.models[w].visible =
          w === local.weapon && local.health > 0 && !scoped
      const reload =
        local.reloadUntil > 0
          ? Math.sin(Math.max(0, Math.min(1, this.reload)) * Math.PI)
          : 0
      const g = this.models[local.weapon]
      g.position.set(
        0.24 * (1 - this.aim) + Math.cos(this.bob) * 0.009,
        -0.26 +
          this.aim * 0.12 -
          Math.abs(Math.sin(this.bob)) * 0.009 -
          reload * 0.22 -
          this.tilt * 0.9,
        -0.65 + this.kick + 0.08 * this.slash,
      )
      g.rotation.set(
        this.kick * 0.65 + reload * 0.65 - this.slash * 0.7,
        -0.035 + this.slash * 0.5,
        -0.03 - reload * 0.5 + this.slash * 0.7 + this.tilt * 2.1,
      )
    }
    this.renderer.autoClear = true
    this.renderer.render(this.scene, this.camera)
    this.renderer.shadowMap.autoUpdate = false
    if (local && look && !idle) {
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.viewScene, this.viewCamera)
    }
    this.drawCalls = this.renderer.info.render.calls
    this.triangles = this.renderer.info.render.triangles
    this.renderer.info.reset()
  }
}
