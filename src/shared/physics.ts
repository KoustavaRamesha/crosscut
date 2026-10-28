import { direction, solids, type Vec3 } from './world'
export const DT = 1 / 60,
  HEIGHT = 1.72,
  EYE = 1.53,
  RADIUS = 0.31
export type Weapon = 'rifle' | 'smg' | 'sniper' | 'knife'
export type WeaponSpec = {
  name: string
  mag: number
  reload: number
  rof: number
  damage: number
  headshot: number
  range: number
  spread: number
  speed: number
  ads: number
}
export const WEAPONS: Record<Weapon, WeaponSpec> = {
  rifle: { name: 'Ak-47', mag: 30, reload: 1.65, rof: 0.105, damage: 34, headshot: 76, range: 90, spread: 1, speed: 7.2, ads: 18 },
  smg: { name: 'Vector-9', mag: 26, reload: 1.3, rof: 0.072, damage: 22, headshot: 46, range: 60, spread: 1.35, speed: 7.9, ads: 13 },
  sniper: { name: 'Longbow', mag: 5, reload: 2.5, rof: 1.05, damage: 88, headshot: 140, range: 140, spread: 0.35, speed: 6.3, ads: 30 },
  knife: { name: 'Knife', mag: 0, reload: 0, rof: 0.46, damage: 65, headshot: 90, range: 2.25, spread: 0, speed: 9.3, ads: 0 },
}
export const GUNS: Weapon[] = ['rifle', 'smg', 'sniper']
// Frag grenade: thrown ~14.5 m/s along the view vector, detonates on a fuse.
export const FRAG = {
  name: 'Frag',
  carry: 2,
  speed: 14.5,
  fuse: 2.1,
  radius: 0.13,
  gravity: 23,
  blast: 7.5,
  damage: 118,
  throwGap: 0.85,
}
export type Projectile = Vec3 & { vx: number; vy: number; vz: number }
export function stepNade(p: Projectile, dt = DT) {
  const steps = Math.max(
    1,
    Math.ceil(
      (Math.max(Math.abs(p.vx), Math.abs(p.vy), Math.abs(p.vz)) * dt) / 0.16,
    ),
  )
  p.vy = Math.max(-38, p.vy - FRAG.gravity * dt)
  for (let n = 0; n < steps; n++)
    for (const axis of ['x', 'z', 'y'] as const) {
      const velocity = axis === 'x' ? 'vx' : axis === 'y' ? 'vy' : 'vz',
        delta = (p[velocity] * dt) / steps
      p[axis] += delta
      for (const b of solids) {
        const min = { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
          max = { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 }
        if (
          p.x + FRAG.radius <= min.x + 1e-6 ||
          p.x - FRAG.radius >= max.x - 1e-6 ||
          p.z + FRAG.radius <= min.z + 1e-6 ||
          p.z - FRAG.radius >= max.z - 1e-6 ||
          p.y + FRAG.radius <= min.y + 1e-6 ||
          p.y - FRAG.radius >= max.y - 1e-6
        )
          continue
        p[axis] =
          delta > 0 ? min[axis] - FRAG.radius : max[axis] + FRAG.radius
        if (axis === 'y') {
          // Floor contact bounces and bleeds the roll like a real frag.
          p.vy = -p.vy * 0.5
          p.vx *= 0.94
          p.vz *= 0.94
          if (Math.abs(p.vy) < 1.1)
            p.vy = Math.abs(p.vy) < 0.45 ? 0 : p.vy
        } else {
          p[velocity] = -p[velocity] * 0.42
        }
      }
    }
}
export const loftNade = (yaw: number, pitch: number): Projectile => {
  const d = direction(yaw, pitch)
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: d.x * FRAG.speed,
    vy: d.y * FRAG.speed + 2.6,
    vz: d.z * FRAG.speed,
  }
}
export type Input = {
  seq: number
  yaw: number
  pitch: number
  forward: number
  side: number
  jump: boolean
  fire: boolean
  reload: boolean
  aim: boolean
  crouch: boolean
  nade: boolean
  weapon: Weapon
}
export type Body = Vec3 & {
  vx: number
  vy: number
  vz: number
  grounded: boolean
  // Simulated pose state: 0 stand, 1 crouch walk, 2 slide.
  pose: 0 | 1 | 2
  // Remaining slide time; a cooldown blocks slide-spamming.
  slide: number
  slideCd: number
}
export const idleInput = (): Input => ({
  seq: 0,
  yaw: 0,
  pitch: 0,
  forward: 0,
  side: 0,
  jump: false,
  fire: false,
  reload: false,
  aim: false,
  crouch: false,
  nade: false,
  weapon: 'rifle',
})
export const body = (x = 0, y = 0, z = 0): Body => ({
  x,
  y,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: false,
  pose: 0,
  slide: 0,
  slideCd: 0,
})
export function move(p: Body, i: Input, dt = DT) {
  const spec = WEAPONS[i.weapon]
  let wx = -Math.sin(i.yaw) * i.forward + Math.cos(i.yaw) * i.side,
    wz = -Math.cos(i.yaw) * i.forward - Math.sin(i.yaw) * i.side
  const len = Math.hypot(wx, wz)
  if (len > 0) {
    wx /= len
    wz /= len
  }
  const runSpeed = i.crouch ? 3.35 : i.aim && spec.ads ? spec.speed * 0.61 : spec.speed
  if (p.slideCd > 0) p.slideCd = Math.max(0, p.slideCd - dt)
  const speed = Math.hypot(p.vx, p.vz)
  // Jump before friction preserves momentum and rewards chained landing jumps.
  if (p.grounded && i.jump) {
    p.vy = 8.2
    p.grounded = false
    if (p.slide > 0) {
      p.slide = 0
      p.slideCd = 0.4 // slide hop keeps the boosted momentum
    }
  }
  if (
    p.grounded &&
    p.slide <= 0 &&
    i.crouch &&
    !i.jump &&
    speed >= 5.4 &&
    p.slideCd <= 0
  ) {
    // Slide: kick forward along the current momentum direction.
    const boost = Math.min(12.4, speed + 3.1) / speed
    p.vx *= boost
    p.vz *= boost
    p.slide = 0.42
  }
  if (p.slide > 0) {
    p.slide = Math.max(0, p.slide - dt)
    if (!i.crouch || p.slide <= 0 || (p.grounded && Math.hypot(p.vx, p.vz) < 2.6)) {
      p.slide = 0
      p.slideCd = 0.45
    }
  }
  const slidPose: 0 | 1 | 2 = p.slide > 0 ? 2 : i.crouch ? 1 : 0
  p.pose = slidPose
  if (p.grounded) {
    const v = Math.hypot(p.vx, p.vz),
      friction = p.slide > 0 ? 1.4 : 9,
      drop = Math.max(v, 3) * friction * dt,
      scale = v > 0 ? Math.max(0, v - drop) / v : 0
    p.vx *= scale
    p.vz *= scale
  }
  if (len > 0) {
    const projection = p.vx * wx + p.vz * wz
    // Sliding all but locks in trajectory; only a whisper of steer remains.
    const wish = p.grounded
      ? p.slide > 0
        ? runSpeed * 0.14
        : runSpeed
      : Math.min(runSpeed, 2.1)
    const gain = p.grounded
      ? p.slide > 0
        ? 6
        : runSpeed * 14
      : 24
    const add = Math.min(Math.max(0, wish - projection), gain * dt)
    p.vx += add * wx
    p.vz += add * wz
  }
  const max = p.slide > 0 ? 12.6 : i.weapon === 'knife' ? 15 : p.pose === 1 ? 3.6 : 12.3,
    hs = Math.hypot(p.vx, p.vz)
  if (hs > max) {
    p.vx *= max / hs
    p.vz *= max / hs
  }
  p.vy = Math.max(-35, p.vy - 23 * dt)
  const steps = Math.max(
    1,
    Math.ceil(
      (Math.max(Math.abs(p.vx), Math.abs(p.vy), Math.abs(p.vz)) * dt) / 0.18,
    ),
  )
  p.grounded = false
  for (let n = 0; n < steps; n++)
    for (const axis of ['x', 'z', 'y'] as const) {
      const velocity = axis === 'x' ? 'vx' : axis === 'y' ? 'vy' : 'vz',
        delta = (p[velocity] * dt) / steps
      p[axis] += delta
      for (const b of solids) {
        const min = { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
          max = { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 }
        if (
          p.x + RADIUS <= min.x + 1e-6 ||
          p.x - RADIUS >= max.x - 1e-6 ||
          p.z + RADIUS <= min.z + 1e-6 ||
          p.z - RADIUS >= max.z - 1e-6 ||
          p.y + HEIGHT <= min.y + 1e-6 ||
          p.y >= max.y - 1e-6
        )
          continue
        if (axis === 'y') {
          p.y = delta > 0 ? min.y - HEIGHT : max.y
          if (delta <= 0) p.grounded = true
        } else p[axis] = delta > 0 ? min[axis] - RADIUS : max[axis] + RADIUS
        p[velocity] = 0
      }
    }
  if (p.y < -10) {
    p.y = 0
    p.vy = 0
  }
}
export function validInput(v: unknown): v is Input {
  if (!v || typeof v !== 'object') return false
  const i = v as Input
  return (
    Number.isSafeInteger(i.seq) &&
    i.seq > 0 &&
    i.seq < 2 ** 31 &&
    Number.isFinite(i.yaw) &&
    Math.abs(i.yaw) < 1e6 &&
    Number.isFinite(i.pitch) &&
    Math.abs(i.pitch) <= 1.5 &&
    [-1, 0, 1].includes(i.forward) &&
    [-1, 0, 1].includes(i.side) &&
    ['jump', 'fire', 'reload', 'aim', 'crouch', 'nade'].every(
      (k) => typeof (i as any)[k] === 'boolean',
    ) &&
    i.weapon in WEAPONS
  )
}
export function spray(shot: number, aim: boolean) {
  return {
    pitch: Math.min(shot, 10) * 0.0045 * (aim ? 0.7 : 1),
    yaw: Math.sin(shot * 1.7) * Math.min(shot, 9) * 0.0019 * (aim ? 0.7 : 1),
  }
}
