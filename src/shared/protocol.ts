import type { Body, Weapon } from './physics'
import type { Vec3 } from './world'
export type Player = Body & {
  id: string
  name: string
  yaw: number
  pitch: number
  health: number
  kills: number
  deaths: number
  weapon: Weapon
  ammo: number
  reloadUntil: number
  respawnAt: number
  protectedUntil: number
  ack: number
  bot: boolean
  shot: number
  // Simulated pose: 0 stand, 1 crouch walk, 2 slide.
  pose: 0 | 1 | 2
}
export type GameEvent =
  | {
      type: 'shot'
      id: string
      from: Vec3
      to: Vec3
      weapon: Weapon
      hit?: string
      head?: boolean
    }
  | {
      type: 'kill'
      killer: string
      victim: string
      // 'frag' is a grenade kill; Player.weapon never holds it.
      weapon: Weapon | 'frag'
      head: boolean
    }
  | { type: 'boom'; id: string; at: Vec3 }
  | { type: 'round'; winner: string | null }
export type Snapshot = {
  type: 'snapshot'
  time: number
  roundEnds: number
  restartAt: number
  roundId: string
  players: Player[]
  // Live grenades for remote rendering.
  nades: { id: string; x: number; y: number; z: number }[]
  events: GameEvent[]
}
export type Stats = {
  kills: number
  deaths: number
  wins: number
  matches: number
}
export const emptyStats = (): Stats => ({
  kills: 0,
  deaths: 0,
  wins: 0,
  matches: 0,
})
