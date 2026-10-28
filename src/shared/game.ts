import {
  body,
  DT,
  EYE,
  FRAG,
  HEIGHT,
  idleInput,
  loftNade,
  move,
  spray,
  stepNade,
  WEAPONS,
  GUNS,
  type Input,
  type Projectile,
  type Weapon,
} from './physics'
import { direction, rayBox, spawns, wallDistance, waypoints } from './world'
import { coverPoint, route } from './navigation'
import type { Vec3 } from './world'
import type { GameEvent, Player, Snapshot, Stats } from './protocol'
export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'brutal'
export type BotState = 'roam' | 'investigate' | 'engage' | 'flank' | 'cover' | 'retreat' | 'ambush'
export type BotPersonality = 'rusher' | 'sentinel' | 'flanker' | 'skirmisher' | 'ambusher'
export const BOT_DIFFICULTIES: Record<BotDifficulty, {
  reaction: number
  aimError: number
  memory: number
  fov: number
  vision: number
  aggression: number
}> = {
  easy: { reaction: 0.66, aimError: 0.095, memory: 1.5, fov: 1.75, vision: 27, aggression: 0.42 },
  normal: { reaction: 0.43, aimError: 0.061, memory: 2.7, fov: 2.08, vision: 36, aggression: 0.6 },
  hard: { reaction: 0.29, aimError: 0.039, memory: 4, fov: 2.32, vision: 45, aggression: 0.75 },
  brutal: { reaction: 0.2, aimError: 0.026, memory: 5.2, fov: 2.55, vision: 54, aggression: 0.86 },
}
const PERSONALITIES: BotPersonality[] = ['rusher', 'sentinel', 'flanker', 'skirmisher', 'ambusher']
const PERSONALITY: Record<BotPersonality, { aggression: number; caution: number; accuracy: number; strafe: number; range: number }> = {
  rusher: { aggression: 1.35, caution: 0.48, accuracy: 1.15, strafe: 0.65, range: 0.62 },
  sentinel: { aggression: 0.62, caution: 1.35, accuracy: 0.78, strafe: 0.55, range: 1.45 },
  flanker: { aggression: 1.05, caution: 0.9, accuracy: 0.94, strafe: 1.2, range: 0.9 },
  skirmisher: { aggression: 0.94, caution: 0.92, accuracy: 1.05, strafe: 1.4, range: 1.05 },
  ambusher: { aggression: 0.77, caution: 1.25, accuracy: 0.85, strafe: 0.45, range: 1.22 },
}
type Actor = {
  p: Player
  input: Input
  queue: Input[]
  lastSeq: number
  nextShot: number
  lastFire: number
  target: number
  stuck: number
  path: Vec3[]
  nextRoute: number
  joined: number
  earned: Stats
  personality: BotPersonality
  state: BotState
  targetId: string
  targetSeenAt: number
  lastKnown?: Vec3
  lastKnownAt: number
  memorySource: 'sight' | 'sound' | 'damage' | ''
  heardFrom: string
  lastAttacker: string
  lastStep: number
  strafeSign: number
  burstUntil: number
  burstNext: number
  lastAimBearing: number
  aimOffset: number
  coverTarget?: Vec3
  coverCheckedAt: number
  lastPos: Vec3
  lastGrounded: boolean
  // Ammunition is tracked per weapon so switching guns doesn't refill the mag.
  ammo: Record<Weapon, number>
  botWeapon: Weapon
  nades: number
  nextNade: number
}
export type GameOptions = { seed?: number; difficulty?: BotDifficulty; adaptive?: boolean; botScoring?: boolean }
export class Game {
  actors = new Map<string, Actor>()
  events: GameEvent[] = []
  nades: (Projectile & { id: string; thrower: string; born: number })[] = []
  time = 0
  roundEnds = 240
  restartAt = 0
  roundId: string
  readonly seed: number
  readonly difficulty: BotDifficulty
  readonly adaptive: boolean
  readonly botScoring: boolean
  private randomState: number
  private idCounter = 0
  onResult?: (id: string, stats: Stats) => void
  constructor(options: GameOptions = {}) {
    this.seed = (options.seed ?? 0xC2055C) >>> 0 || 1
    this.randomState = this.seed
    this.difficulty = options.difficulty ?? 'normal'
    this.adaptive = options.adaptive ?? false
    this.botScoring = options.botScoring ?? true
    this.roundId = this.nextId('round')
  }
  private random() {
    // Mulberry32: compact, deterministic and independent of browser globals.
    let t = (this.randomState += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  private nextId(prefix: string) {
    return `${prefix}-${this.seed.toString(36)}-${++this.idCounter}`
  }
  private tuning(a: Actor) {
    const base = BOT_DIFFICULTIES[this.difficulty]
    if (!this.adaptive || !a.p.bot) return base
    const humans = [...this.actors.values()].filter((x) => !x.p.bot)
    const bots = [...this.actors.values()].filter((x) => x.p.bot)
    if (!humans.length || !bots.length) return base
    const lead = Math.max(...humans.map((x) => x.p.kills)) - Math.max(...bots.map((x) => x.p.kills))
    const adapt = Math.max(-1, Math.min(1, lead / 8))
    return {
      ...base,
      reaction: Math.max(0.12, base.reaction - adapt * 0.11),
      aimError: Math.max(0.012, base.aimError - adapt * 0.014),
      memory: Math.max(1, base.memory + adapt * 0.35),
      aggression: Math.max(0.3, Math.min(0.95, base.aggression + adapt * 0.07)),
    }
  }
  private visible(observer: Actor, target: Actor, vision = this.tuning(observer).vision, fov = this.tuning(observer).fov) {
    const a = observer.p, b = target.p
    const dx = b.x - a.x, dy = b.y + EYE * 0.55 - (a.y + EYE), dz = b.z - a.z
    const horizontal = Math.hypot(dx, dz), distance = Math.hypot(horizontal, dy)
    if (distance > vision || horizontal < 0.001) return false
    const bearing = Math.atan2(-dx, -dz)
    const delta = ((bearing - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    if (Math.abs(delta) > fov / 2) return false
    const pitch = Math.atan2(dy, horizontal)
    return wallDistance({ x: a.x, y: a.y + EYE, z: a.z }, direction(bearing, pitch)) > distance - 0.45
  }
  canBotSee(observerId: string, targetId: string) {
    const observer = this.actors.get(observerId), target = this.actors.get(targetId)
    return !!observer?.p.bot && !!target && target.p.health > 0 && this.visible(observer, target)
  }
  botTuning(id: string) {
    const a = this.actors.get(id)
    return a?.p.bot ? { ...this.tuning(a) } : undefined
  }
  botDebug(id: string) {
    const a = this.actors.get(id)
    return a?.p.bot ? { state: a.state, personality: a.personality, targetId: a.targetId, lastKnown: a.lastKnown ? { ...a.lastKnown } : undefined, lastKnownAt: a.lastKnownAt, memorySource: a.memorySource, stuck: a.stuck, burstNext: a.burstNext } : undefined
  }
  private hear(source: Actor, radius: number) {
    for (const listener of this.actors.values()) {
      if (!listener.p.bot || listener === source || listener.p.health <= 0) continue
      const d = Math.hypot(listener.p.x - source.p.x, listener.p.z - source.p.z)
      if (d > radius) continue
      // Sound communicates a coarse area, not an exact wall-penetrating position.
      listener.lastKnown = {
        x: Math.round((source.p.x + (this.random() - 0.5) * 2.8) / 2) * 2,
        y: source.p.y,
        z: Math.round((source.p.z + (this.random() - 0.5) * 2.8) / 2) * 2,
      }
      listener.lastKnownAt = this.time
      listener.memorySource = 'sound'
      listener.heardFrom = source.p.id
    }
  }
  add(id: string, name: string, bot = false) {
    if (this.actors.has(id)) return this.actors.get(id)!.p
    const a: Actor = {
      p: {
        ...body(),
        id,
        name,
        yaw: 0,
        pitch: 0,
        health: 100,
        kills: 0,
        deaths: 0,
        weapon: 'rifle',
        ammo: 30,
        reloadUntil: 0,
        respawnAt: 0,
        protectedUntil: 0,
        ack: 0,
        bot,
        shot: 0,
      },
      input: idleInput(),
      queue: [],
      lastSeq: 0,
      nextShot: 0,
      lastFire: 0,
      target: Math.floor(this.random() * waypoints.length),
      stuck: 0,
      path: [],
      nextRoute: 0,
      joined: this.time,
      earned: { kills: 0, deaths: 0, wins: 0, matches: 0 },
      personality: PERSONALITIES[this.actors.size % PERSONALITIES.length],
      state: 'roam',
      targetId: '',
      targetSeenAt: -Infinity,
      lastKnownAt: -Infinity,
      memorySource: '',
      heardFrom: '',
      lastAttacker: '',
      lastStep: this.time,
      strafeSign: this.random() < 0.5 ? -1 : 1,
      burstUntil: 0,
      burstNext: this.time,
      lastAimBearing: 0,
      aimOffset: 0,
      coverTarget: undefined,
      coverCheckedAt: -Infinity,
      lastPos: { x: 0, y: 0, z: 0 },
      lastGrounded: false,
      ammo: { rifle: 30, smg: 26, sniper: 5, knife: 0 },
      botWeapon: bot
        ? this.random() < 0.55
          ? 'rifle'
          : this.random() < 0.7
            ? 'smg'
            : 'sniper'
        : 'rifle',
      nades: FRAG.carry,
      nextNade: 0,
    }
    this.actors.set(id, a)
    this.spawn(a)
    return a.p
  }
  remove(id: string) {
    const a = this.actors.get(id)
    if (a) this.save(a, false)
    this.actors.delete(id)
  }
  enqueue(id: string, inputs: Input[]) {
    const a = this.actors.get(id)
    if (!a) return
    for (const i of inputs) {
      if (i.seq <= a.lastSeq || i.seq > a.lastSeq + 512 || a.queue.length >= 12)
        continue
      a.lastSeq = i.seq
      a.queue.push(i)
    }
  }
  spawn(a: Actor) {
    const choices = spawns
      .map((s) => ({
        s,
        d: Math.min(
          1e3,
          ...[...this.actors.values()]
            .filter((o) => o !== a && o.p.health > 0)
            .map((o) => Math.hypot(o.p.x - s.x, o.p.z - s.z)),
        ),
      }))
      .sort((a, b) => b.d - a.d)
    const s = choices[Math.floor(this.random() * Math.min(2, choices.length))].s
    Object.assign(a.p, body(s.x, s.y, s.z), {
      yaw: s.yaw,
      pitch: 0,
      health: 100,
      reloadUntil: 0,
      respawnAt: 0,
      protectedUntil: this.time + 1.2,
      shot: 0,
    })
    for (const w of GUNS) a.ammo[w] = WEAPONS[w].mag
    a.nades = FRAG.carry
    a.nextNade = 0
    a.p.weapon = a.p.bot ? a.botWeapon : 'rifle'
    a.p.ammo = a.ammo[a.p.weapon]
    a.path = []
    a.nextRoute = 0
    a.coverTarget = undefined
    a.coverCheckedAt = -Infinity
    a.state = 'roam'
    a.targetId = ''
    a.targetSeenAt = -Infinity
    a.lastKnown = undefined
    a.lastKnownAt = -Infinity
    a.memorySource = ''
    a.stuck = 0
    a.lastPos = { x: s.x, y: s.y, z: s.z }
    a.lastGrounded = false
    a.input = idleInput()
    a.input.yaw = s.yaw
    a.input.weapon = a.p.weapon
    a.queue = []
    a.nextShot = this.time + 0.3
  }
  save(a: Actor, completed: boolean) {
    if (a.p.bot) return
    const stats = {
      ...a.earned,
      matches: completed && this.time - a.joined > 10 ? 1 : 0,
    }
    if (Object.values(stats).some((n) => n > 0))
      this.onResult?.(a.p.id, stats)
    a.earned = { kills: 0, deaths: 0, wins: 0, matches: 0 }
  }
  tick() {
    this.time += DT
    if (this.restartAt) {
      if (this.time >= this.restartAt) {
        this.roundEnds = this.time + 240
        this.restartAt = 0
        this.roundId = this.nextId('round')
        this.nades = []
        for (const a of this.actors.values()) {
          a.p.kills = a.p.deaths = 0
          a.joined = this.time
          this.spawn(a)
        }
      }
      return
    }
    if (this.time >= this.roundEnds ||
      [...this.actors.values()].some((a) => a.p.kills >= 25)
    ) {
      const ranked = [...this.actors.values()].sort(
        (a, b) => b.p.kills - a.p.kills || a.p.deaths - b.p.deaths,
      )
      const winner = ranked[0]?.p.kills > 0 ? ranked[0] : null
      if (winner) winner.earned.wins++
      this.events.push({ type: 'round', winner: winner?.p.id ?? null })
      for (const a of this.actors.values()) this.save(a, true)
      this.restartAt = this.time + 9
      return
    }
    this.stepNades()
    for (const a of this.actors.values()) {
      const p = a.p
      if (p.health <= 0) {
        a.queue = []
        if (this.time >= p.respawnAt) this.spawn(a)
        continue
      }
      if (p.bot) this.bot(a)
      else {
        const next = a.queue.shift()
        if (next) {
          if (next.weapon !== p.weapon) {
            a.ammo[p.weapon] = p.ammo // holster the previous gun's mag
            p.ammo = a.ammo[next.weapon]
          }
          a.input = next
          p.ack = next.seq
        } else {
          a.input = {
            ...a.input,
            forward: 0,
            side: 0,
            jump: false,
            fire: false,
            reload: false,
          }
        }
      }
      const i = a.input
      p.yaw = i.yaw
      p.pitch = i.pitch
      p.weapon = i.weapon
      if (p.weapon === 'knife') p.reloadUntil = 0
      const wasGrounded = p.grounded
      move(p, i)
      const speedNow = Math.hypot(p.vx, p.vz)
      if (!wasGrounded && p.grounded && speedNow > 3) this.hear(a, 17 + speedNow * 0.8)
      if (p.bot && speedNow > 7 && this.time - a.lastStep > (i.crouch ? 1.2 : 0.72)) {
        this.hear(a, 10 + speedNow * (i.crouch ? 0.55 : 1.05))
        a.lastStep = this.time
      } else if (!p.bot && speedNow > 4 && (p.grounded || wasGrounded) && this.time - a.lastStep > (i.crouch ? 1.05 : 0.65)) {
        this.hear(a, 8 + speedNow * (i.crouch ? 0.65 : 1))
        a.lastStep = this.time
      }
      if (p.reloadUntil && this.time >= p.reloadUntil) {
        a.ammo[p.weapon] = WEAPONS[p.weapon].mag
        p.ammo = a.ammo[p.weapon]
        p.reloadUntil = 0
      }
      const spec = WEAPONS[p.weapon]
      if (
        p.weapon !== 'knife' &&
        i.reload &&
        p.ammo < spec.mag &&
        !p.reloadUntil
      )
        p.reloadUntil = this.time + spec.reload
      if (i.nade && a.nades > 0 && this.time >= a.nextNade) {
        a.nades--
        a.nextNade = this.time + FRAG.throwGap
        const nade = loftNade(i.yaw, i.pitch)
        this.nades.push({
          ...nade,
          id: this.nextId('frag'),
          thrower: p.id,
          born: this.time,
          x: p.x + nade.vx * 0.02,
          y: p.y + EYE - 0.15,
          z: p.z + nade.vz * 0.02,
        })
      }
      if (this.time - a.lastFire > 0.25) p.shot = 0
      if (i.fire && this.time >= a.nextShot && !p.reloadUntil) {
        if (p.weapon !== 'knife' && p.ammo === 0) {
          p.reloadUntil = this.time + spec.reload
          continue
        }
        this.fire(a)
        a.ammo[p.weapon] = p.ammo
      }
    }
  }
  fire(a: Actor) {
    const p = a.p,
      knife = p.weapon === 'knife',
      spec = WEAPONS[p.weapon]
    a.nextShot = this.time + spec.rof
    a.lastFire = this.time
    p.protectedUntil = 0
    if (!knife) p.ammo--
    const recoil = spray(p.shot, a.input.aim),
      dir = direction(
        p.yaw + (knife ? 0 : recoil.yaw * spec.spread),
        p.pitch + (knife ? 0 : recoil.pitch * spec.spread),
      )
    p.shot++
    const origin = { x: p.x, y: p.y + EYE, z: p.z }
    let distance = Math.min(spec.range, wallDistance(origin, dir)),
      victim: Actor | undefined,
      head = false
    for (const other of this.actors.values()) {
      const q = other.p
      if (q.id === p.id || q.health <= 0 || q.protectedUntil > this.time)
        continue
      const position = q
      // Crouching and sliding lower the head, so shots need a near-hit core.
      const headLine = position.y + 1.3 - (position.pose ? 0.42 : 0)
      const d = rayBox(
        origin,
        dir,
        { x: position.x - 0.32, y: position.y, z: position.z - 0.32 },
        { x: position.x + 0.32, y: position.y + HEIGHT, z: position.z + 0.32 },
      )
      if (d < distance) {
        distance = d
        victim = other
        head = origin.y + dir.y * d > headLine
      }
    }
    const to = {
      x: origin.x + dir.x * distance,
      y: origin.y + dir.y * distance,
      z: origin.z + dir.z * distance,
    }
    this.hear(a, knife ? 13 : p.weapon === 'sniper' ? 58 : p.weapon === 'smg' ? 34 : 43)
    this.events.push({
      type: 'shot',
      id: p.id,
      from: origin,
      to,
      weapon: p.weapon,
      hit: victim?.p.id,
      head,
    })
    if (victim) {
      const v = victim.p
      const damage = knife ? spec.damage : head ? spec.headshot : spec.damage
      v.health = Math.max(0, v.health - damage)
      if (victim.p.bot) {
        victim.lastAttacker = p.id
        victim.lastKnown = {
          x: Math.round((p.x + (this.random() - 0.5) * 1.8) * 2) / 2,
          y: p.y,
          z: Math.round((p.z + (this.random() - 0.5) * 1.8) * 2) / 2,
        }
        victim.lastKnownAt = this.time
        victim.memorySource = 'damage'
      }
      if (v.health === 0) {
        if (!p.bot || this.botScoring) {
          p.kills++
          a.earned.kills++
        }
        v.deaths++
        victim.earned.deaths++
        v.respawnAt = this.time + 2.2
        v.vx = v.vy = v.vz = 0
        this.events.push({
          type: 'kill',
          killer: p.id,
          victim: v.id,
          weapon: p.weapon,
          head,
        })
      }
    }
  }
  bot(a: Actor) {
    const p = a.p, i = idleInput(), tune = this.tuning(a), style = PERSONALITY[a.personality]
    i.seq = ++a.lastSeq
    i.yaw = p.yaw
    i.pitch = p.pitch
    i.weapon = a.botWeapon
    const candidates = [...this.actors.values()]
      .filter((other) => other !== a && other.p.health > 0 && other.p.protectedUntil <= this.time)
      .map((other) => ({ actor: other, d: Math.hypot(p.x - other.p.x, p.z - other.p.z), visible: this.visible(a, other) }))
      .filter((candidate) => candidate.visible)
    const leaderKills = Math.max(0, ...[...this.actors.values()].map((other) => other.p.kills))
    const scored = candidates.map((candidate) => {
      const q = candidate.actor.p
      // Target preferences are weighted, with a deterministic small tie-break.
      let score = 1 / (candidate.d + 3)
      score += (100 - q.health) * 0.0015
      if (q.id === a.lastAttacker) score += 0.2
      if (q.kills === leaderKills && leaderKills > 0) score += 0.12
      if (q.id === a.targetId) score += 0.16
      score += this.random() * 0.08
      return { ...candidate, score }
    }).sort((x, y) => y.score - x.score)
    const chosen = scored[0]
    const wasTracking = ['engage', 'cover', 'flank'].includes(a.state)
    if (chosen && (chosen.actor.p.id !== a.targetId || !wasTracking)) {
      a.targetId = chosen.actor.p.id
      a.targetSeenAt = this.time
      a.lastAimBearing = p.yaw
      a.aimOffset = (this.random() - 0.5) * tune.aimError * style.accuracy
      a.burstNext = this.time + tune.reaction
    }
    if (chosen) {
      const q = chosen.actor.p
      a.targetId = q.id
      a.lastKnown = { x: q.x, y: q.y, z: q.z }
      a.lastKnownAt = this.time
      a.memorySource = 'sight'
      a.heardFrom = ''
    }
    const current = a.targetId ? this.actors.get(a.targetId) : undefined
    const visible = !!current && current.p.health > 0 && this.visible(a, current)
    if (!visible && current?.p.health === 0) a.targetId = ''
    const memoryValid = !!a.lastKnown && this.time - a.lastKnownAt <= tune.memory
    // Never let hidden target coordinates affect state transitions or routing.
    const d = visible && current
      ? Math.hypot(p.x - current.p.x, p.z - current.p.z)
      : a.lastKnown ? Math.hypot(p.x - a.lastKnown.x, p.z - a.lastKnown.z) : Infinity
    const lowHealth = p.health < 20 + (1 - tune.aggression) * 28
    const threatNade = this.nades.some((nade) => nade.thrower !== p.id && Math.hypot(nade.x - p.x, nade.z - p.z) < 4.5 && Math.abs(nade.y - (p.y + 0.5)) < 2)
    const oldState = a.state
    // Priority order: immediate danger > visible contact > known contact > patrol.
    if (lowHealth || threatNade) a.state = 'retreat'
    else if (visible && current && d < 2.6) a.state = 'engage'
    else if (visible && current && a.personality === 'flanker' && d > 7) a.state = 'flank'
    else if (visible && current && (p.health < 48 || (a.personality === 'sentinel' && d < 16))) a.state = 'cover'
    else if (visible && current) a.state = 'engage'
    else if (memoryValid && a.personality === 'ambusher' && d < 4 && a.memorySource !== 'sight') a.state = 'ambush'
    else if (memoryValid) a.state = 'investigate'
    else a.state = 'roam'
    if (oldState !== a.state) {
      a.path = []
      a.nextRoute = 0
      a.coverTarget = undefined
    }

    if (visible && current && d <= (a.botWeapon === 'sniper' ? 62 : 38)) {
      const q = current.p
      const close = d < (a.personality === 'rusher' ? 8 : 3.2)
      i.weapon = close && (a.personality === 'rusher' || p.health > 45 || d < 2.5) ? 'knife' : a.botWeapon
      const aimX = q.x + q.vx * Math.min(0.22, d * 0.008)
      const aimZ = q.z + q.vz * Math.min(0.22, d * 0.008)
      const bearing = Math.atan2(-(aimX - p.x), -(aimZ - p.z))
      let turn = ((bearing - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      if (Math.sign(turn) !== Math.sign(a.lastAimBearing)) a.aimOffset = -a.aimOffset * 0.65
      a.lastAimBearing = turn
      const ownSpeed = Math.hypot(p.vx, p.vz)
      const errorScale = tune.aimError * style.accuracy * (1 + d / 42 + Math.hypot(q.vx, q.vz) / 13 + ownSpeed / 24)
      const reactionProgress = Math.min(1, Math.max(0, (this.time - a.targetSeenAt) / Math.max(0.05, tune.reaction)))
      const aimTurn = turn * reactionProgress + a.aimOffset + (this.random() - 0.5) * errorScale * 0.6
      const maxTurn = DT * (a.personality === 'sentinel' ? 2.1 : 2.7)
      i.yaw = p.yaw + Math.max(-maxTurn, Math.min(maxTurn, aimTurn))
      const desiredPitch = Math.atan2(q.y + 0.86 - (p.y + EYE), Math.max(0.1, d))
      const pitchTurn = ((desiredPitch - p.pitch + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      i.pitch = p.pitch + Math.max(-maxTurn, Math.min(maxTurn, pitchTurn + (this.random() - 0.5) * errorScale * 0.08))
      const ready = this.time >= a.burstNext
      if (i.weapon === 'knife') i.fire = ready && reactionProgress >= 1 && Math.abs(turn) < 0.34 && d < 2.5
      else if (reactionProgress >= 1 && Math.abs(turn) < Math.max(0.025, 0.11 - d * 0.0013)) {
        if (a.botWeapon === 'sniper') i.fire = ready && Math.abs(turn) < 0.045
        else {
          if (this.time > a.burstUntil && ready) {
            a.burstUntil = this.time + 0.24 + this.random() * 0.24
            a.burstNext = a.burstUntil + 0.48 + this.random() * 0.4
          }
          i.fire = this.time <= a.burstUntil
        }
      }
      const lateral = Math.sin(this.time * (1.2 + style.strafe) + a.target * 2.17) * style.strafe
      if (a.state === 'retreat') {
        i.forward = -1
        i.side = a.strafeSign
        i.jump = p.grounded && this.time - a.lastStep > 1
      } else if (i.weapon === 'knife') {
        i.forward = d > 1.7 ? 1 : 0
        i.jump = d > 4 && p.grounded && Math.sin(this.time * 2 + a.target) > 0.88
      } else {
        const preferred = (a.botWeapon === 'sniper' ? 25 : 12) * style.range / Math.max(0.55, tune.aggression * style.aggression)
        i.forward = d > preferred * 1.2 ? 1 : d < preferred * 0.55 ? -1 : 0
        i.side = lateral > 0.25 ? 1 : lateral < -0.25 ? -1 : 0
        i.crouch = a.state === 'cover' && p.grounded && this.time % 2.4 < 0.65
        if (a.state === 'cover') {
          if (this.time >= a.coverCheckedAt || a.stuck > 0.42) {
            a.coverTarget = coverPoint(p, q)
            a.path = a.coverTarget ? route(p, a.coverTarget) : []
            a.coverCheckedAt = this.time + 1.1
            a.nextRoute = this.time + 0.9
          }
          if (a.coverTarget && Math.hypot(a.coverTarget.x - p.x, a.coverTarget.z - p.z) > 1.4) {
            while (a.path.length > 1 && Math.hypot(a.path[0].x - p.x, a.path[0].z - p.z) < 1.1) a.path.shift()
            const point = a.path[0]
            if (point) {
              const dx = point.x - p.x, dz = point.z - p.z, len = Math.hypot(dx, dz) || 1
              const mx = dx / len, mz = dz / len
              i.forward = Math.max(-1, Math.min(1, -Math.sin(i.yaw) * mx - Math.cos(i.yaw) * mz))
              i.side = Math.max(-1, Math.min(1, Math.cos(i.yaw) * mx - Math.sin(i.yaw) * mz))
              i.crouch = p.grounded
            }
          }
        }
        if (a.state === 'flank') {
          i.forward = 1
          i.side = a.strafeSign
        }
      }
      if (a.botWeapon !== 'sniper' && d > 15 && d < 28 && p.grounded && Math.sin(this.time * 1.7 + a.target) > 0.92)
        i.jump = true
    } else if (a.state === 'retreat' && a.lastKnown) {
      const away = Math.atan2(-(p.x - a.lastKnown.x), -(p.z - a.lastKnown.z))
      i.yaw = away
      i.forward = 1
      i.side = a.strafeSign
      i.jump = p.grounded && this.time - a.lastStep > 1
    } else if (a.state === 'ambush' && a.lastKnown) {
      i.yaw = Math.atan2(-(a.lastKnown.x - p.x), -(a.lastKnown.z - p.z))
      i.crouch = true
      i.forward = 0
    } else {
      const destination = a.state === 'investigate' && a.lastKnown
        ? a.lastKnown
        : waypoints[a.target]
      if (this.time >= a.nextRoute || a.stuck > 0.42) {
        if (a.state === 'roam' && Math.hypot(destination.x - p.x, destination.z - p.z) < 2.5) {
          a.target = (a.target + 1 + Math.floor(this.random() * (waypoints.length - 1))) % waypoints.length
        }
        const aimPoint = a.state === 'flank' && current
          ? { x: current.p.x + Math.cos(a.strafeSign * 1.15) * 6, y: 0, z: current.p.z + Math.sin(a.strafeSign * 1.15) * 6 }
          : destination
        a.path = route(p, aimPoint)
        a.nextRoute = this.time + (a.personality === 'ambusher' ? 1.8 : 1.1)
        if (a.stuck > 0.42) a.strafeSign *= -1
      }
      // Follow farther ahead on straight segments to reduce grid zigzag.
      while (a.path.length > 1 && Math.hypot(a.path[0].x - p.x, a.path[0].z - p.z) < 1.1) a.path.shift()
      const waypoint = a.path[0]
      if (waypoint) {
        i.yaw = Math.atan2(-(waypoint.x - p.x), -(waypoint.z - p.z))
        i.forward = 1
        if (a.personality === 'rusher' && p.grounded && Math.sin(this.time * 1.4 + a.target) > 0.96) i.jump = true
      }
    }
    // Repel bots from nearby allies, with a deterministic lateral escape if pinned.
    let avoidX = 0, avoidZ = 0
    for (const other of this.actors.values()) {
      if (other === a || other.p.health <= 0 || !other.p.bot) continue
      const dx = p.x - other.p.x, dz = p.z - other.p.z, dist = Math.hypot(dx, dz)
      if (dist > 0.01 && dist < 1.65) { avoidX += dx / dist * (1.65 - dist); avoidZ += dz / dist * (1.65 - dist) }
    }
    if (Math.hypot(avoidX, avoidZ) > 0.15) {
      const rightX = Math.cos(i.yaw), rightZ = -Math.sin(i.yaw)
      i.side = Math.abs(rightX * avoidX + rightZ * avoidZ) > 0.08 ? Math.sign(rightX * avoidX + rightZ * avoidZ) : a.strafeSign
    }
    const speedNow = Math.hypot(p.vx, p.vz)
    if (Math.hypot(p.x - a.lastPos.x, p.z - a.lastPos.z) < 0.012 && Math.abs(i.forward) + Math.abs(i.side) > 0) a.stuck += DT
    else a.stuck = Math.max(0, a.stuck - DT * 2)
    a.lastPos = { x: p.x, y: p.y, z: p.z }
    if (a.stuck > 0.42) {
      i.side = a.strafeSign
      i.forward = -1
      i.jump = p.grounded
      a.nextRoute = 0
    }
    if (p.ammo === 0) i.reload = true
    a.input = i
  }
  // Grenades free-fly, bounce off the shared collision world and detonate on
  // their fuse; walls occlude the blast just like CoD frags.
  stepNades() {
    for (let n = this.nades.length - 1; n >= 0; n--) {
      const g = this.nades[n]
      stepNade(g)
      if (this.time - g.born >= FRAG.fuse) {
        this.nades.splice(n, 1)
        this.explode(g)
      }
    }
  }
  explode(g: Projectile & { thrower: string }) {
    const at = { x: g.x, y: g.y + 0.25, z: g.z }
    const source = this.actors.get(g.thrower)
    if (source) this.hear(source, 48)
    this.events.push({ type: 'boom', id: g.thrower, at })
    for (const a of this.actors.values()) {
      const p = a.p
      if (p.health <= 0 || p.protectedUntil > this.time) continue
      const d = Math.hypot(
        p.x - at.x,
        p.y + HEIGHT / 2 - at.y,
        p.z - at.z,
      )
      if (d > FRAG.blast) continue
      const to = {
        x: (p.x - at.x) / d,
        y: (p.y + 0.9 - at.y) / d,
        z: (p.z - at.z) / d,
      }
      if (wallDistance(at, to) < d - 0.2) continue
      const killer = this.actors.get(g.thrower)
      const damage = Math.max(22, Math.round(FRAG.damage * (1 - d / FRAG.blast)))
      p.health = Math.max(0, p.health - damage)
      if (p.health === 0) {
        if (killer && killer !== a && (!killer.p.bot || this.botScoring)) {
          killer.p.kills++
          killer.earned.kills++
        }
        a.earned.deaths++
        p.deaths++
        p.respawnAt = this.time + 2.2
        p.vx = p.vy = p.vz = 0
        this.events.push({
          type: 'kill',
          killer: g.thrower,
          victim: p.id,
          weapon: 'frag',
          head: false,
        })
      }
    }
  }
  snapshot(): Snapshot {
    return {
      type: 'snapshot',
      time: this.time,
      roundEnds: this.roundEnds,
      restartAt: this.restartAt,
      roundId: this.roundId,
      players: [...this.actors.values()].map((a) => ({ ...a.p })),
      nades: this.nades.map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z })),
      events: this.events.splice(0),
    }
  }
}
