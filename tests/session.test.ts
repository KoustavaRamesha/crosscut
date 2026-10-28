import { expect, test } from 'bun:test'
import { SoloSession, readStats } from '../src/shared/session'
import { idleInput } from '../src/shared/physics'
import { route } from '../src/shared/navigation'
import { spawns } from '../src/shared/world'
const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
}
test('pause freezes physics, bots, reloads and the round clock', () => {
  const s = new SoloSession('Player', memory())
  const before = s.game.snapshot()
  for (let i = 0; i < 600; i++) s.step({ ...idleInput(), fire: true, forward: 1 })
  expect(s.game.snapshot()).toEqual(before)
  s.paused = false
  s.step(idleInput())
  expect(s.game.time).toBeGreaterThan(0)
  s.paused = true
  const paused = s.game.snapshot()
  for (let i = 0; i < 600; i++) s.step(idleInput())
  expect(s.game.snapshot()).toEqual(paused)
})
test('completed rounds save once and survive a new session', () => {
  const store = memory(), s = new SoloSession('Player', store)
  const player = s.game.actors.get('you')!
  player.p.kills = 25
  player.earned.kills = 25
  player.joined = -20
  s.paused = false
  s.step(idleInput())
  for (let i = 0; i < 30; i++) s.step(idleInput())
  s.finish()
  new SoloSession('Player', store)
  expect(readStats(store)).toEqual({ kills: 25, deaths: 0, wins: 1, matches: 1 })
})
test('opponents can navigate between every arena spawn', () => {
  for (let i = 0; i < spawns.length; i++) for (let j = 0; j < spawns.length; j++)
    if (i !== j) expect(route(spawns[i], spawns[j]).length).toBeGreaterThan(0)
})
test('bots play a full local round and restart with clean scores', () => {
  const s = new SoloSession('Player', memory())
  s.paused = false
  let ended = false, restarted = false, botKills = 0
  const firstRound = s.game.roundId
  for (let i = 0; i < 16000; i++) {
    const snapshot = s.step(idleInput())!
    botKills = Math.max(botKills, ...snapshot.players.filter(p => p.bot).map(p => p.kills))
    if (snapshot.restartAt) ended = true
    if (snapshot.roundId !== firstRound) { restarted = true; expect(snapshot.players.every(p => p.kills === 0)).toBe(true); break }
  }
  expect(botKills).toBeGreaterThan(0)
  expect(ended).toBe(true)
  expect(restarted).toBe(true)
})
