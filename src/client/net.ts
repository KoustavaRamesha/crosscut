import { connectRealtime } from '../../freebuff-realtime/browser.js'
import { validInput, type Input } from '../shared/physics'
import type { Snapshot } from '../shared/protocol'

export type NetStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'unauthorized'
  | 'closed'
export type RoomMember = { connectionId: string; userId: string; name: string }
export type IncomingBatch = { from: string; userId: string; inputs: Input[] }

export type NetHooks = {
  onSelf(connectionId: string): void
  onStatus(status: NetStatus): void
  onMembers(members: RoomMember[]): void
  onHostChange(hostId: string): void
  onInput(batch: IncomingBatch): void
  onSnap(snap: Snapshot): void
}

// Broadcast payloads come from other clients: validate before use.
const names = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const member = (v: unknown): RoomMember =>
  names(v) && typeof v.connectionId === 'string'
    ? {
        connectionId: v.connectionId,
        userId: typeof v.userId === 'string' ? v.userId : '',
        name: names(v.data) && typeof v.data.name === 'string' ? v.data.name.slice(0, 24) : 'Player',
      }
    : { connectionId: `unknown-${crypto.randomUUID()}`, userId: '', name: 'Unknown' }

const validSnapshot = (v: unknown): v is Snapshot => {
  if (!names(v) || (v as Snapshot).type !== 'snapshot') return false
  const s = v as Snapshot
  return (
    Number.isFinite(s.time) &&
    Number.isFinite(s.roundEnds) &&
    typeof s.roundId === 'string' &&
    Array.isArray(s.players) &&
    s.players.every(
      (p) =>
        names(p) &&
        !Array.isArray(p) &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        Number.isFinite(p.health) &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z) &&
        Number.isFinite(p.yaw),
    ) &&
    Array.isArray(s.events)
  )
}

const SEND_INTERVAL = 66 // ~15 msg/s, inside the room relay's rate budget

// browser.js is an untyped helper: give it a precise local signature.
type RealtimeConnection = {
  broadcast(event: string, data: unknown): boolean
  presence(data: unknown): boolean
  close(): void
}
type RealtimeConnect = (options: {
  ticketUrl?: string
  room: string
  onMessage: (message: unknown) => void
  onStatus: (status: string) => void
  websocketUrl?: (url: string) => string
}) => RealtimeConnection
const connect = connectRealtime as unknown as RealtimeConnect

export class Net {
  connectionId = ''
  userId = ''
  members: RoomMember[] = []
  hostId = ''
  status: NetStatus = 'connecting'
  private conn?: RealtimeConnection
  private room = 'crosscut:global'
  private name = 'Player'
  private queued: Input[] = []
  private sender?: ReturnType<typeof setInterval>

  constructor(private hooks: NetHooks) {}

  start(name: string, room: string) {
    this.name = name
    this.room = room
    this.hostId = ''
    this.status = 'connecting'
    this.conn?.close()
    this.stopSender()
    this.conn = connect({
      room,
      websocketUrl: (url) => url,
      ticketUrl: '/api/realtime/ticket',
      onStatus: (status: string) => {
        this.status = status as NetStatus
        this.hooks.onStatus(this.status)
      },
      onMessage: (message: unknown) => this.receive(message),
    })
  }

  receive(message: unknown) {
    if (!names(message) || typeof message.type !== 'string') return
    const m = message as {
      type: string
      userId?: string
      connectionId?: string
      members?: unknown
      event?: string
      data?: unknown
    }
    if (m.type === 'ready') {
      this.userId = typeof m.userId === 'string' ? m.userId : ''
      this.connectionId = typeof m.connectionId === 'string' ? m.connectionId : ''
      this.hooks.onSelf(this.connectionId)
      this.sendPresence()
      this.startSender()
      this.elect()
      return
    }
    if (m.type === 'presence' && Array.isArray(m.members)) {
      this.members = m.members.map(member)
      this.hooks.onMembers(this.members)
      this.elect()
      return
    }
    if (m.type === 'broadcast' && m.connectionId !== this.connectionId) {
      if (m.event === 'in' && this.hostSafe(m.connectionId)) {
        const data = names(m.data) && Array.isArray(m.data.i) ? m.data.i : []
        const inputs = data.filter(validInput).slice(0, 16)
        const from = typeof m.connectionId === 'string' ? m.connectionId : ''
        if (from && inputs.length)
          this.hooks.onInput({
            from,
            userId: typeof m.userId === 'string' ? m.userId : '',
            inputs,
          })
      }
      if (m.event === 'snap' && validSnapshot(m.data) && m.connectionId === this.hostId)
        this.hooks.onSnap(m.data)
    }
  }

  // The host is stable until it leaves; then the lowest connection id wins.
  elect() {
    if (this.hostId && this.members.some((m) => m.connectionId === this.hostId))
      return
    const next = [...this.members]
      .map((m) => m.connectionId)
      .sort()
      .at(0) ?? ''
    if (next !== this.hostId) {
      this.hostId = next
      this.hooks.onHostChange(this.hostId)
    }
  }

  hosting(): boolean {
    return this.hostId !== '' && this.hostId === this.connectionId
  }

  nameOf(connectionId: string): string {
    return this.members.find((m) => m.connectionId === connectionId)?.name ?? 'Player'
  }

  private hostSafe(connectionId: unknown): boolean {
    return typeof connectionId === 'string' && this.hosting() && connectionId !== this.connectionId
  }

  sendPresence() {
    this.conn?.presence({ name: this.name })
  }

  pushInput(input: Input) {
    if (this.hosting()) return // the host reads its own input directly
    this.queued.push(input)
    if (this.queued.length > 24) this.queued.splice(0, this.queued.length - 24)
  }

  private stopSender() {
    if (this.sender) clearInterval(this.sender)
    this.sender = undefined
    this.queued = []
  }

  private startSender() {
    this.stopSender()
    this.sender = setInterval(() => {
      if (!this.queued.length || !this.conn) return
      this.conn.broadcast('in', { i: this.queued.splice(-16) })
    }, SEND_INTERVAL)
  }

  publishSnap(snap: Snapshot) {
    this.conn?.broadcast('snap', snap)
  }

  close() {
    this.stopSender()
    this.conn?.close()
    this.conn = undefined
    this.connectionId = ''
    this.userId = ''
    this.members = []
    this.hostId = ''
    this.status = 'closed'
  }
}
