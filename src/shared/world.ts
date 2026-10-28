export type Vec3 = { x: number; y: number; z: number }
export type Box = {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  material: 'stone' | 'teal' | 'wood' | 'dark' | 'trim'
  solid: boolean
}
export const boxes: Box[] = []
const box = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: Box['material'] = 'stone',
  solid = true,
) => boxes.push({ x, y, z, w, h, d, material, solid })
// A compact, deliberately asymmetric three-lane arena. All collision is shared.
box(0, -0.6, 0, 54, 1.2, 48, 'stone')
box(-25, 4, 0, 2, 8, 46)
box(25, 4, 0, 2, 8, 46)
box(0, 4, -23, 48, 8, 2)
box(0, 4, 23, 48, 8, 2)
// West workshop: traversable doorway and covered arcade.
box(-15, 2.9, -8, 13, 5.8, 1)
box(-21, 2.9, -13, 1, 5.8, 10)
box(-9, 2.9, -13, 1, 5.8, 10)
box(-15, 2.9, -18, 13, 5.8, 1)
box(-15, 6, -13, 14, 0.5, 11, 'trim')
// Southern wall has a generous opening.
boxes.splice(5, 1)
box(-19.6, 2.9, -8, 4.8, 5.8, 1)
box(-10.4, 2.9, -8, 4.8, 5.8, 1)
box(-15, 4.8, -8, 4.4, 2, 1)
// East storage and its cut-through.
box(15, 3.6, 10, 13, 7.2, 1)
box(21, 3.6, 5, 1, 7.2, 10)
box(9, 3.6, 5, 1, 7.2, 10)
box(11, 3.6, 0, 4, 7.2, 1)
box(19, 3.6, 0, 4, 7.2, 1)
box(15, 6, 0, 4, 2.4, 1)
box(15, 7.4, 5, 14, 0.4, 11, 'trim')
// Central stone saw, contrasting steel container, readable cover.
box(-1, 1.2, -1, 6, 2.4, 4, 'stone')
box(-1, 2.52, -1, 6.3, 0.24, 4.3, 'trim')
box(3.4, 3.9, -2.1, 1.2, 7.8, 1.2)
box(3.4, 7.9, -2.1, 1.7, 0.4, 1.7, 'trim')
box(-10, 1.45, 8, 3.2, 2.9, 6.4, 'teal')
box(-10, 2.95, 8, 3.4, 0.18, 6.6, 'trim')
box(13, 1.35, -11, 5.4, 2.7, 3, 'teal')
box(13, 2.78, -11, 5.6, 0.16, 3.2, 'trim')
box(-4, 0.65, 12, 2.3, 1.3, 2.3, 'wood')
box(-5, 0.45, 14.6, 2, 0.9, 2, 'wood')
box(5, 0.65, -14, 2.4, 1.3, 2.4, 'wood')
box(7.7, 0.6, -15.6, 2, 1.2, 2, 'wood')
box(2, 1, 18.6, 8, 2, 1.2)
box(-1, 2.08, 18.6, 2, 0.16, 1.4, 'trim')
box(-19, 0.5, 4, 3, 1, 3, 'stone')
box(-19, 0.2, 6.2, 3, 0.4, 1.4, 'stone')
box(19, 0.5, -4, 3, 1, 2.8, 'stone')
box(19, 0.2, -6, 3, 0.4, 1.4, 'stone')
export const solids = boxes.filter((b) => b.solid)
export const spawns = [
  { x: -21, y: 0, z: 18, yaw: -0.86 },
  { x: 21, y: 0, z: -18, yaw: 2.28 },
  { x: -17, y: 0, z: -13, yaw: Math.PI },
  { x: 15, y: 0, z: 6, yaw: 0 },
  { x: 0, y: 0, z: -19, yaw: Math.PI },
  { x: 18, y: 0, z: 18, yaw: 0.78 },
  { x: -21, y: 0, z: -3, yaw: -1.57 },
  { x: 0, y: 0, z: 13, yaw: 0 },
]
export const waypoints = [
  [-20, 18],
  [-15, 15],
  [-6, 18],
  [6, 16],
  [18, 18],
  [21, 13],
  [16, 13],
  [6, 10],
  [4, 4],
  [14, -4],
  [20, -7],
  [20, -18],
  [8, -19],
  [-2, -18],
  [-6, -13],
  [-15, -13],
  [-15, -4],
  [-21, -3],
  [-20, 4],
  [-17, 11],
  [-5, 5],
  [-5, -5],
  [4, -7],
].map(([x, z]) => ({ x, y: 0, z }))
export function rayBox(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number {
  let lo = 0,
    hi = Infinity
  for (const a of ['x', 'y', 'z'] as const) {
    if (Math.abs(dir[a]) < 1e-8) {
      if (origin[a] < min[a] || origin[a] > max[a]) return Infinity
      continue
    }
    let t1 = (min[a] - origin[a]) / dir[a],
      t2 = (max[a] - origin[a]) / dir[a]
    if (t1 > t2) [t1, t2] = [t2, t1]
    lo = Math.max(lo, t1)
    hi = Math.min(hi, t2)
    if (lo > hi) return Infinity
  }
  return lo
}
export function wallDistance(origin: Vec3, dir: Vec3): number {
  let nearest = Infinity
  for (const b of solids)
    nearest = Math.min(
      nearest,
      rayBox(
        origin,
        dir,
        { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
      ),
    )
  return nearest
}
export const direction = (yaw: number, pitch: number): Vec3 => ({
  x: -Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
})
