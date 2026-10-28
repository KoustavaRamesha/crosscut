import { solids, wallDistance, type Vec3 } from './world'

// Ground grid stays shared with the server simulation; it deliberately excludes
// jump-only shortcuts so every route is safe for ordinary ground movement.
const size = 1.5, width = 31, depth = 29
const point = (id: number): Vec3 => ({ x: (id % width) * size - 22.5, y: 0, z: Math.floor(id / width) * size - 21 })
const clear = (p: Vec3) => !solids.some((b) =>
  b.y + b.h / 2 > 0.05 && b.y - b.h / 2 < 1.8 &&
  Math.abs(p.x - b.x) < b.w / 2 + 0.45 && Math.abs(p.z - b.z) < b.d / 2 + 0.45)
const walkable = Array.from({ length: width * depth }, (_, id) => clear(point(id)))
const neighbors = walkable.map((ok, id) => ok
  ? [-width, -1, 1, width].map((d) => id + d)
    .filter((n) => n >= 0 && n < walkable.length && walkable[n] && Math.abs(n % width - id % width) <= 1)
  : [])
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)
function nearest(p: Vec3) {
  let best = -1, bestDistance = Infinity
  for (let id = 0; id < walkable.length; id++) {
    if (!walkable[id]) continue
    const q = point(id), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2
    if (d < bestDistance) { bestDistance = d; best = id }
  }
  return best
}
function segmentClear(a: Vec3, b: Vec3) {
  const length = distance(a, b), steps = Math.ceil(length / (size * 0.35))
  for (let n = 1; n < steps; n++) {
    const t = n / steps
    if (!clear({ x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t })) return false
  }
  return true
}
function smooth(path: Vec3[]) {
  if (path.length < 3) return path
  const result = [path[0]]
  let anchor = 0
  while (anchor < path.length - 1) {
    let next = path.length - 1
    while (next > anchor + 1 && !segmentClear(path[anchor], path[next])) next--
    result.push(path[next])
    anchor = next
  }
  return result
}
export function route(from: Vec3, to: Vec3): Vec3[] {
  const start = nearest(from), goal = nearest(to)
  if (start < 0 || goal < 0) return []
  const queue = [start], parent = new Map<number, number>([[start, -1]])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]
    if (id === goal) {
      const path: Vec3[] = []
      for (let at = id; at !== start; at = parent.get(at)!) path.push(point(at))
      return smooth(path.reverse())
    }
    for (const n of neighbors[id]) if (!parent.has(n)) { parent.set(n, id); queue.push(n) }
  }
  return []
}

// Pick reachable cover that blocks direct vision and doesn't force a long
// detour. The threat distance term discourages hiding directly on top of it.
export function coverPoint(from: Vec3, threat: Vec3): Vec3 | undefined {
  const threatDist = distance(from, threat)
  if (threatDist < 0.1) return undefined
  const dir = { x: (threat.x - from.x) / threatDist, y: 0, z: (threat.z - from.z) / threatDist }
  const origin = { x: threat.x, y: threat.y + 1.25, z: threat.z }
  const candidates: { point: Vec3; score: number }[] = []
  for (let id = 0; id < walkable.length; id++) {
    if (!walkable[id]) continue
    const candidate = point(id), fromDistance = distance(from, candidate)
    if (fromDistance < 2 || fromDistance > 14) continue
    const threatDistance = distance(candidate, threat)
    if (threatDistance < 3 || threatDistance > 18) continue
    const toward = { x: candidate.x - threat.x, y: -0.15, z: candidate.z - threat.z }
    const length = Math.hypot(toward.x, toward.y, toward.z)
    if (wallDistance(origin, { x: toward.x / length, y: toward.y / length, z: toward.z / length }) > length - 0.6) continue
    const score = fromDistance + Math.abs(threatDistance - 8) * 0.35 + Math.abs((candidate.x - from.x) * dir.z - (candidate.z - from.z) * dir.x) * 0.08
    candidates.push({ point: candidate, score })
  }
  // Route-check only the best few occluded candidates; avoids hundreds of
  // breadth-first searches when several bots decide to take cover at once.
  candidates.sort((a, b) => a.score - b.score)
  for (const candidate of candidates.slice(0, 12))
    if (route(from, candidate.point).length) return candidate.point
  return undefined
}

export function reachable(from: Vec3, to: Vec3) {
  return from === to || nearest(from) >= 0 && nearest(to) >= 0 && route(from, to).length > 0
}
