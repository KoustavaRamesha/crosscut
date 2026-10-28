import { describe, expect, test } from 'bun:test'
import {
  body,
  DT,
  FRAG,
  idleInput,
  loftNade,
  move,
  stepNade,
  validInput,
} from '../src/shared/physics'
import type { GameEvent } from '../src/shared/protocol'
import { BOT_DIFFICULTIES, Game } from '../src/shared/game'
import { route } from '../src/shared/navigation'
import { direction, spawns, wallDistance } from '../src/shared/world'
const run = (
  p: ReturnType<typeof body>,
  input: ReturnType<typeof idleInput>,
  ticks: number,
) => {
  for (let n = 0; n < ticks; n++) move(p, input)
}
describe('movement', () => {
  test('gravity lands and standing remains stable', () => {
    const p = body(0, 5, 12)
    run(p, idleInput(), 180)
    expect(p.y).toBeCloseTo(0, 5)
    expect(p.grounded).toBe(true)
  })
  test('walls block movement at speed without tunneling', () => {
    const p = body(-22, 0, 12)
    const i = { ...idleInput(), side: -1, weapon: 'knife' as const }
    run(p, i, 600)
    expect(p.x).toBeGreaterThanOrEqual(-23.691)
    expect(p.x).toBeLessThan(-23)
  })
  test('jump lands, held jump chains and knife is faster', () => {
    const p = body(0, 0, 10)
    run(p, idleInput(), 2)
    run(p, { ...idleInput(), jump: true }, 20)
    expect(p.y).toBeGreaterThan(1)
    run(p, idleInput(), 100)
    expect(p.y).toBeCloseTo(0, 5)
    const rifle = body(0, 0, 10),
      knife = body(0, 0, 10)
    run(rifle, { ...idleInput(), side: 1 }, 35)
    run(knife, { ...idleInput(), side: 1, weapon: 'knife' }, 35)
    expect(knife.x).toBeGreaterThan(rifle.x)
    run(p, { ...idleInput(), jump: true }, 55)
    expect(p.y).toBeGreaterThan(0)
  })
  test('diagonal input cannot exceed cardinal ground speed', () => {
    const a = body(0, 0, 12),
      b = body(0, 0, 12)
    run(a, { ...idleInput(), forward: 1 }, 20)
    run(b, { ...idleInput(), forward: 1, side: 1 }, 20)
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(Math.hypot(a.vx, a.vz), 4)
  })
  test('malformed and time-cheating inputs are rejected', () => {
    expect(validInput({ ...idleInput(), seq: 1 })).toBe(true)
    for (const patch of [
      { yaw: NaN },
      { forward: 3 },
      { pitch: Infinity },
      { seq: -1 },
      { jump: 1 },
      { weapon: 'rocket' },
      { nade: 1 },
    ])
      expect(validInput({ ...idleInput(), seq: 1, ...patch })).toBe(false)
  })
})
describe('bot AI', () => {
  test('seeded bot matches are deterministic, including bot loadouts and movement', () => {
    const make = () => {
      const game = new Game({ seed: 417, difficulty: 'normal' })
      game.add('player', 'Player')
      for (const [n, name] of ['Flint', 'Mica', 'Slate', 'Onyx', 'Jasper'].entries()) game.add('bot' + n, name, true)
      const inputs = Array.from({ length: 480 }, (_, n) => ({ ...idleInput(), seq: n + 1, forward: n < 200 ? 1 : 0, yaw: n / 120 }))
      for (const input of inputs) {
        game.enqueue('player', [input])
        game.tick()
        game.snapshot()
      }
      return { players: [...game.actors.values()].map((actor) => actor.p), debug: [...game.actors.keys()].map((id) => game.botDebug(id)) }
    }
    expect(make()).toEqual(make())
  })
  test('vision respects view cone and solid walls', () => {
    const game = new Game({ seed: 9 })
    game.add('bot', 'Bot', true)
    game.add('target', 'Target')
    const bot = game.actors.get('bot')!, target = game.actors.get('target')!
    Object.assign(bot.p, body(-1, 0, 6), { yaw: 0 })
    Object.assign(target.p, body(-1, 0, -6))
    expect(game.canBotSee('bot', 'target')).toBe(false)
    Object.assign(bot.p, body(0, 0, 12), { yaw: 0 })
    Object.assign(target.p, body(0, 0, 4))
    expect(game.canBotSee('bot', 'target')).toBe(true)
    target.p.x = 12
    target.p.z = 12
    expect(game.canBotSee('bot', 'target')).toBe(false)
  })
  test('a bot investigates the last known location after losing line of sight', () => {
    const game = new Game({ seed: 22 })
    game.add('bot', 'Bot', true)
    game.add('target', 'Target')
    const bot = game.actors.get('bot')!, target = game.actors.get('target')!
    Object.assign(bot.p, body(0, 0, 12), { yaw: 0, protectedUntil: 0 })
    Object.assign(target.p, body(0, 0, 8), { protectedUntil: 0 })
    bot.input.yaw = 0
    game.tick()
    expect(game.botDebug('bot')?.targetId).toBe('target')
    Object.assign(target.p, body(-1, 0, -6))
    for (let n = 0; n < 4; n++) game.tick()
    expect(game.canBotSee('bot', 'target')).toBe(false)
    expect(game.botDebug('bot')?.state).toBe('investigate')
    expect(game.botDebug('bot')?.lastKnown).toBeDefined()
    expect(game.botDebug('bot')?.memorySource).toBe('sight')
  })
  test('practice bots can be excluded from round kill scoring', () => {
    const game = new Game({ seed: 63, botScoring: false })
    game.add('bot', 'Bot', true)
    game.add('target', 'Target')
    const bot = game.actors.get('bot')!, target = game.actors.get('target')!
    Object.assign(bot.p, body(0, 0, 12), { yaw: 0, pitch: -0.04, protectedUntil: 0 })
    Object.assign(target.p, body(0, 0, 7), { protectedUntil: 0 })
    bot.input = { ...idleInput(), yaw: 0, pitch: -0.04 }
    for (let n = 0; n < 3; n++) { game.time += 0.11; game.fire(bot) }
    expect(target.p.health).toBe(0)
    expect(bot.p.kills).toBe(0)
  })
  test('bots wait for their configured reaction delay before firing', () => {
    const game = new Game({ seed: 6, difficulty: 'normal' })
    game.add('bot', 'Bot', true)
    game.add('target', 'Target')
    const bot = game.actors.get('bot')!, target = game.actors.get('target')!
    Object.assign(bot.p, body(0, 0, 12), { yaw: 0, protectedUntil: 0 })
    Object.assign(target.p, body(0, 0, 6), { protectedUntil: 0 })
    bot.input.yaw = 0
    for (let n = 0; n < 8; n++) game.tick()
    expect(game.botDebug('bot')?.targetId).toBe('target')
    expect(game.time).toBeLessThan(BOT_DIFFICULTIES.normal.reaction)
    expect(bot.input.fire).toBe(false)
  })
  test('difficulty tuning is bounded and reacts in the expected direction', () => {
    const values = (['easy', 'normal', 'hard', 'brutal'] as const).map((difficulty) => {
      const game = new Game({ seed: 2, difficulty })
      game.add('human', 'Human')
      game.add('bot', 'Bot', true)
      return game.botTuning('bot')!
    })
    expect(values.map((v) => v.reaction)).toEqual([0.66, 0.43, 0.29, 0.2])
    expect(values[0].aimError).toBeGreaterThan(values[3].aimError)
    expect(values[0].memory).toBeLessThan(values[3].memory)
    const adaptive = new Game({ seed: 2, difficulty: 'normal', adaptive: true })
    adaptive.add('human', 'Human')
    adaptive.add('bot', 'Bot', true)
    adaptive.actors.get('human')!.p.kills = 20
    const tuned = adaptive.botTuning('bot')!
    expect(tuned.reaction).toBeGreaterThanOrEqual(0.12)
    expect(tuned.aimError).toBeGreaterThanOrEqual(0.012)
    expect(tuned.reaction).toBeLessThan(BOT_DIFFICULTIES.normal.reaction)
  })
  test('sound memory is a coarse location rather than an exact track', () => {
    const game = new Game({ seed: 77 })
    game.add('bot', 'Bot', true)
    game.add('human', 'Human')
    const bot = game.actors.get('bot')!, human = game.actors.get('human')!
    Object.assign(bot.p, body(0, 0, 12), { yaw: 1.5 })
    Object.assign(human.p, body(1.4, 0, 9.1), { protectedUntil: 0 })
    for (let seq = 1; seq <= 24; seq++) {
      game.enqueue('human', [{ ...idleInput(), seq, fire: true }])
      game.tick()
      if (game.botDebug('bot')?.memorySource === 'sound') break
    }
    const memory = game.botDebug('bot')!
    expect(memory.lastKnown).toBeDefined()
    expect(memory.memorySource).toBe('sound')
    expect(Math.hypot(memory.lastKnown!.x - human.p.x, memory.lastKnown!.z - human.p.z)).toBeGreaterThan(0.1)
  })
  test('a stuck bot tries a jump-and-strafe recovery', () => {
    const game = new Game({ seed: 31 })
    game.add('bot', 'Bot', true)
    const bot = game.actors.get('bot')!
    Object.assign(bot.p, body(-23.5, 0, -10), { grounded: true })
    bot.lastPos = { x: bot.p.x, y: bot.p.y, z: bot.p.z }
    bot.stuck = 0.5
    bot.target = 0
    bot.nextRoute = 0
    game.tick()
    expect(bot.input.forward).toBe(-1)
    expect(bot.input.jump).toBe(true)
    expect(bot.input.side).not.toBe(0)
  })
  test('smoothed navigation reaches all spawn pairs', () => {
    for (const from of spawns) for (const to of spawns) {
      const path = route(from, to)
      if (from !== to) expect(path.length).toBeGreaterThan(0)
    }
  })
})
describe('combat', () => {
  function setup() {
    const g = new Game()
    g.add('a', 'A')
    g.add('b', 'B')
    const a = g.actors.get('a')!,
      b = g.actors.get('b')!
    Object.assign(a.p, body(0, 0, 12), {
      yaw: 0,
      pitch: -0.04,
      protectedUntil: 0,
    })
    Object.assign(b.p, body(0, 0, 7), { protectedUntil: 0 })
    a.input = { ...idleInput(), pitch: -0.04 }
    return { g, a, b }
  }
  test('rifle damages, kills and respawns in the simulation', () => {
    const { g, a, b } = setup()
    for (let n = 0; n < 3; n++) {
      g.time += 0.11
      g.fire(a)
    }
    expect(b.p.health).toBe(0)
    expect(a.p.kills).toBe(1)
    expect(b.p.deaths).toBe(1)
    for (let n = 0; n < 150; n++) g.tick()
    expect(b.p.health).toBe(100)
    expect(b.p.protectedUntil).toBeGreaterThan(g.time)
  })
  test('walls absorb bullets', () => {
    const { g, a, b } = setup()
    Object.assign(a.p, body(-1, 0, 6), { yaw: 0, pitch: 0 })
    Object.assign(b.p, body(-1, 0, -6))
    g.fire(a)
    expect(b.p.health).toBe(100)
    expect(wallDistance({ x: -1, y: 1.5, z: 6 }, direction(0, 0))).toBeLessThan(
      10,
    )
  })
  test('knife cannot hit outside its reach', () => {
    const { g, a, b } = setup()
    a.p.weapon = 'knife'
    g.fire(a)
    expect(b.p.health).toBe(100)
    b.p.z = 10.5
    g.fire(a)
    expect(b.p.health).toBe(35)
  })
  test('fire rate and ammo enforced through inputs', () => {
    const { g, a } = setup()
    for (let n = 1; n <= 120; n++) {
      g.enqueue('a', [{ ...idleInput(), seq: n, fire: true }])
      g.tick()
    }
    expect(a.p.ammo).toBeGreaterThan(10)
    expect(a.p.ammo).toBeLessThan(18)
  })
  test('input flooding cannot speed up simulation', () => {
    const g = new Game()
    g.add('a', 'A')
    const a = g.actors.get('a')!
    Object.assign(a.p, body(0, 0, 12))
    g.enqueue(
      'a',
      Array.from({ length: 100 }, (_, n) => ({
        ...idleInput(),
        seq: n + 1,
        side: 1,
      })),
    )
    g.tick()
    expect(a.p.ack).toBe(1)
    expect(a.queue.length).toBeLessThanOrEqual(11)
    expect(a.p.x).toBeLessThan(0.1)
  })
  test('25 kills ends the round and stats are saved once', () => {
    const { g, a } = setup()
    a.p.kills = 25
    a.earned.kills = 25
    a.joined = -20
    const receipts: any[] = []
    g.onResult = (...r) => receipts.push(r)
    g.tick()
    expect(g.restartAt).toBeGreaterThan(g.time)
    expect(receipts).toHaveLength(1)
    expect(receipts[0][1]).toEqual({
      kills: 25,
      deaths: 0,
      wins: 1,
      matches: 1,
    })
    for (let n = 0; n < 30; n++) g.tick()
    expect(receipts).toHaveLength(1)
  })
  test('spawn protection rejects damage', () => {
    const { g, a, b } = setup()
    b.p.protectedUntil = 10
    g.fire(a)
    expect(b.p.health).toBe(100)
  })
  test('frags explode on fuse, damage with falloff and restock on spawn', () => {
    const { g, a, b } = setup()
    a.input = { ...idleInput(), seq: 1, nade: true }
    g.tick()
    expect(a.nades).toBe(1)
    expect(g.nades).toHaveLength(1)
    // The cooldown between throws, plus an empty pouch, blocks repeats.
    a.input = { ...idleInput(), seq: 2, nade: true }
    g.tick()
    expect(a.nades).toBe(1)
    expect(g.nades).toHaveLength(1)
    // Pin the fused frag ~3.5m from b: hurt, but not killed.
    a.input = { ...idleInput(), seq: 3 }
    Object.assign(g.nades[0]!, { x: 0, y: 0.13, z: 10.5, vx: 0, vy: 0, vz: 0 })
    for (let n = 0; n < Math.ceil((FRAG.fuse + 0.25) / DT); n++) g.tick()
    expect(g.nades).toHaveLength(0)
    expect(b.p.health).toBeLessThan(100)
    expect(b.p.health).toBeGreaterThan(0)
    const boom = g.events.find(
      (e): e is Extract<GameEvent, { type: 'boom' }> => e.type === 'boom',
    )
    expect(boom?.id).toBe('a')
    expect(boom?.at.y).toBeGreaterThan(0)
    // Dying and respawning refills the pouch.
    a.p.health = 0
    a.p.respawnAt = g.time + 0.1
    for (let n = 0; n < 30; n++) g.tick()
    expect(a.nades).toBe(FRAG.carry)
  })
  test('a frag at point blank kills with frag credit', () => {
    const { g, a, b } = setup()
    a.input = { ...idleInput(), seq: 1, nade: true }
    g.tick()
    // Drop the fused grenade right next to b.
    const nade = g.nades[0]!
    Object.assign(nade, {
      x: b.p.x,
      y: b.p.y + 0.4,
      z: b.p.z + 0.4,
      vx: 0,
      vy: 0,
      vz: 0,
    })
    nade.born = g.time - FRAG.fuse
    g.tick()
    expect(b.p.health).toBe(0)
    const kill = g.events.find(
      (e): e is Extract<GameEvent, { type: 'kill' }> => e.type === 'kill',
    )
    expect(kill?.weapon).toBe('frag')
    expect(kill?.killer).toBe('a')
    expect(a.p.kills).toBe(1)
    expect(b.p.respawnAt).toBeGreaterThan(g.time)
  })
  test('walls occlude frag blast', () => {
    const { g, a, b } = setup()
    a.input = { ...idleInput(), seq: 1, nade: true }
    g.tick()
    // b waits behind the arena's solid east boundary wall.
    Object.assign(b.p, body(21, 0, 0))
    const nade = g.nades[0]!
    Object.assign(nade, { x: 23.4, y: 0.6, z: 0, vx: 0, vy: 0, vz: 0 })
    nade.born = g.time - FRAG.fuse
    g.tick()
    expect(b.p.health).toBe(100)
  })
  test('thrown grenades bounce and settle on the ground', () => {
    const p = { ...loftNade(Math.PI, 0.04), x: -13, y: 0.2, z: 20 }
    for (let n = 0; n < 240; n++) stepNade(p)
    expect(p.y).toBeCloseTo(FRAG.radius, 1)
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(1)
  })
})
