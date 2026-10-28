import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import './style.css'
import { World, type Quality } from './scene'
import { Sound } from './audio'
import { Net } from './net'
import { Game, type BotDifficulty } from '../shared/game'
import { body, DT, GUNS, idleInput, move, WEAPONS, type Input, type Weapon } from '../shared/physics'
import type { Player, Snapshot } from '../shared/protocol'
import { SoloSession, readStats } from '../shared/session'
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3 3v4l3 1 1 3 3 3h4l1-3 3-1 3-3v-4l-3-1-1-3-3-3z"/>', sound: '<path d="M11 4 5 9H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', target: '<circle cx="12" cy="12" r="7"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>', user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>', chevron: '<path d="m9 5 7 7-7 7"/>', link: '<path d="m10 13 4-4m-7 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(2 0)"/>' } as Record<string, string>)[name] ?? ''}</svg>`
const logo = `<svg class="brand-mark" viewBox="0 0 36 32" aria-hidden="true"><path d="m2 3 9 13-9 13h8l9-13L10 3zm14 0 9 13-9 13h8l9-13-9-13z" fill="currentColor"/></svg>`
$('app').innerHTML = `
 <div id="menu" class="menu">
  <header>${logo}<span class="wordmark">Crosscut</span><div class="header-right"><button id="statsButton" class="quiet">Your record</button><button id="account" class="quiet">Sign in</button></div></header>
  <main class="entry"><div class="eyebrow"><span class="live-dot"></span> Solo deathmatch</div><h1>Make<br>your mark.</h1>    <div class="play-panel"><div class="name-field">${icon('user')}<input id="nickname" maxlength="20" aria-label="Player name" placeholder="Your name" autocomplete="off" spellcheck="false"></div><div class="name-field room-field"><span class="room-glyph">⌂</span><input id="roomcode" maxlength="24" aria-label="Online room code" placeholder="Room code — global" autocomplete="off" spellcheck="false"></div><button id="play" class="primary">Play solo — bots ${icon('arrow')}</button><button id="online" class="secondary">Play online ${icon('link')}</button><label class="toggle-row bots-toggle"><span>Fill online room with bots</span><input id="fillBots" type="checkbox" checked></label></div></main>
  <div class="map-caption"><span class="map-line"></span><div><span>Quarry</span><small>First to 25</small></div><span class="map-number">01</span></div>
  <footer><button id="controls" class="quiet">${icon('target')} Controls</button><button id="settings" class="quiet">${icon('gear')} Settings</button></footer>
 </div>
 <div id="hud" hidden><div class="match-top"><span id="matchName">Quarry</span><div id="matchClock">4:00</div><span id="matchScore">0 / 25</span></div> <canvas id="radar" width="132" height="132" aria-hidden="true"></canvas><div id="directions" aria-hidden="true"></div><div id="streak" hidden></div><div id="scope" hidden><span class="scope-ring"></span><i class="scope-h"></i><i class="scope-v"></i></div><div class="connection"><span id="fps">— fps · — ms</span><span id="netState"></span></div><div id="feed"></div><div id="crosshair"><i></i><i></i><i></i><i></i></div><div id="hitmarker"></div><div id="damage"></div><div id="killConfirm"></div><div id="respawn" hidden></div><div class="health"><span class="health-icon">+</span><span id="health">100</span><div class="health-track"><i id="healthBar"></i></div></div><div class="weapon"><div class="weapon-title"><span id="weaponName">Ak-47</span><kbd id="weaponKey">1</kbd></div><div id="ammo">30 <small>/ 30</small></div><div id="reloadProgress"><i></i></div></div><div class="game-bottom"><span id="speed"></span><span><kbd>tab</kbd> Score <kbd>esc</kbd> Menu</span></div></div>
 <div id="pause" class="scrim" hidden><section class="dialog compact"><div class="eyebrow">Crosscut</div><h2>Paused.</h2><button id="resume" class="primary">Resume ${icon('arrow')}</button><button id="freeLook" class="secondary" hidden>Play without mouse capture</button><button id="pauseSettings" class="secondary">Settings</button><button id="leave" class="quiet">End match</button></section></div>
 <div id="scoreboard" class="scrim" hidden><section class="dialog score-dialog"><div class="dialog-heading"><div><div class="eyebrow" id="scoreLabel">Deathmatch</div><h2 id="scoreTitle">Quarry</h2></div><span id="roundCountdown"></span></div><div class="score-head"><span>Player</span><span>Kills</span><span>Deaths</span></div><div id="scoreRows"></div></section></div>
 <div id="modal" class="scrim" hidden><section class="dialog"><div class="dialog-heading"><h2 id="modalTitle"></h2><button id="modalClose" class="icon-button" aria-label="Close">${icon('close')}</button></div><div id="modalBody"></div></section></div>
 
 <div id="toast" role="status" hidden></div><div id="unsupported" hidden>Mouse & keyboard required</div>`
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
const canvas = $<HTMLCanvasElement>('world'),
  sound = new Sound()
let world: World
try {
  world = new World(canvas)
} catch {
  $('menu').hidden = true
  $('unsupported').textContent = 'WebGL is unavailable in this browser.'
  $('unsupported').hidden = false
  throw Error('WebGL unavailable')
}
let mode: 'solo' | 'online' | undefined,
  online: Net | undefined,
  onlineGame: Game | undefined,
  selfBody: ReturnType<typeof body> | undefined,
  paused = false, netSeq = 0, hostClock = 0,
  accountName = ''
const storage = {
  getItem(key: string) { try { return localStorage.getItem(key) } catch { return null } },
  setItem(key: string, value: string) { try { localStorage.setItem(key, value) } catch { toast('Browser storage is unavailable.') } },
}
const difficultyOptions: BotDifficulty[] = ['easy', 'normal', 'hard', 'brutal'],
  qualityOptions: Quality[] = ['low', 'medium', 'high']
let sensitivity = Number(storage.getItem('crosscut-sensitivity') ?? 1),
  volume = Number(storage.getItem('crosscut-volume') ?? 0.5),
  storedDifficulty = storage.getItem('crosscut-difficulty') as BotDifficulty | null,
  difficulty: BotDifficulty = storedDifficulty && difficultyOptions.includes(storedDifficulty) ? storedDifficulty : 'normal',
  adaptiveDifficulty = storage.getItem('crosscut-adaptive') === 'true',
  storedQuality = storage.getItem('crosscut-quality') as Quality | null,
  quality: Quality = storedQuality && qualityOptions.includes(storedQuality) ? storedQuality : 'high',
  reducedMotion = storage.getItem('crosscut-reduced-motion') === 'true'
world.fov = Number(storage.getItem('crosscut-fov') ?? 85)
world.setQuality(quality)
world.reducedMotion = reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
sound.setVolume(volume)
$<HTMLInputElement>('nickname').value =
  storage.getItem('crosscut-name') ?? ''
$<HTMLInputElement>('roomcode').value =
  storage.getItem('crosscut-room') ?? ''
let selfId = 'you'
let session: SoloSession | undefined,
  local: Player | undefined,
  latest: Snapshot | undefined,
  previous: Snapshot | undefined,
  yaw = 0, pitch = 0,
  weapon: Weapon = 'rifle',
  fire = false, aim = false, reload = false, crouching = false,
  keys = new Set<string>(),
  accumulator = 0, hudClock = 0,
  frameCount = 0, fpsTime = 0, fps = 0,
  tab = false, lastReload = 0, lastRound = '',
  freeLook = false, captureFailed = false,
  nadeQueued = false, streak = 0,
  fireAt: Record<string, number> = {}
let errorTimer: ReturnType<typeof setTimeout> | undefined,
  killTimer: ReturnType<typeof setTimeout> | undefined,
  streakTimer: ReturnType<typeof setTimeout> | undefined
const active = () => !!session || !!online
const running = () => (session ? !session.paused : !!online && !paused)

function toast(message: string) {
  $('toast').textContent = message
  $('toast').hidden = false
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => ($('toast').hidden = true), 4500)
}
function showStreak(label: string) {
  const el = $('streak')
  el.textContent = label
  el.hidden = false
  el.className = 'pop'
  void el.offsetWidth
  if (streakTimer) clearTimeout(streakTimer)
  streakTimer = setTimeout(() => {
    el.hidden = true
    el.className = ''
  }, 1800)
}
// Attack direction wedges point from screen center toward the shooter.
function showDirection(from: { x: number; z: number }, hot = false) {
  if (!local) return
  const host = $('directions')
  if (hot && host.querySelector('.hot')) return
  while (host.children.length > 3) host.firstElementChild?.remove()
  const rel = relOf(from.x - local.x, from.z - local.z),
    deg = ((Math.atan2(rel.right, rel.ahead) * 180) / Math.PI + 360) % 360,
    el = document.createElement('i')
  el.className = 'dmg-arrow' + (hot ? ' hot' : '')
  el.style.transform = `rotate(${deg}deg)`
  host.appendChild(el)
  setTimeout(() => el.remove(), 880)
}
// Rotating circular radar: red pips for shooters, close movers and live nades.
function drawRadar() {
  const ctx = $<HTMLCanvasElement>('radar').getContext('2d')
  if (!ctx || !latest || !local || local.health <= 0) return
  const c = ctx.canvas,
    size = c.width,
    R = size / 2,
    RANGE = 34,
    pxPerM = R / RANGE
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.beginPath()
  ctx.arc(R, R, R - 2, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(9,18,16,0.75)'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(214,232,220,0.4)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(R, R, R - 2, latest.time % 2.4 - 0.5, latest.time % 2.4 + 0.35)
  ctx.strokeStyle = 'rgba(190,255,214,0.52)'
  ctx.stroke()
  for (const g of latest.nades) {
    const rel = relOf(g.x - local.x, g.z - local.z)
    if (Math.hypot(rel.right, rel.ahead) > RANGE) continue
    ctx.fillStyle = '#e7c66a'
    ctx.beginPath()
    ctx.arc(R + rel.right * pxPerM, R - rel.ahead * pxPerM, 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
  const hash = (s: string) => [...s].reduce((n, ch) => n * 31 + ch.charCodeAt(0) % 997, 0)
  for (const p of latest.players) {
    if (p.id === selfId || p.health <= 0) continue
    const rel = relOf(p.x - local.x, p.z - local.z),
      dist = Math.hypot(rel.right, rel.ahead),
      fired = latest.time - (fireAt[p.id] ?? -99) < 1.7
    if (!fired && dist > 13.5) continue
    const s = fired ? 3.4 : 2.6
    ctx.fillStyle = '#ff5f46'
    ctx.beginPath()
    ctx.arc(R + Math.max(-R + 6, Math.min(R - 6, rel.right * pxPerM)), R - Math.max(-R + 6, Math.min(R - 6, rel.ahead * pxPerM)) + (hash(p.id) % 100) / 2e4, s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#d9f5e6'
  ctx.beginPath()
  ctx.moveTo(R, R - 6)
  ctx.lineTo(R - 4.4, R + 5)
  ctx.lineTo(R + 4.4, R + 5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
function relOf(dx: number, dz: number) {
  // forward = (-sin, -cos), right = (cos, -sin); returns forward basis coords.
  return {
    ahead: -Math.sin(yaw) * dx - Math.cos(yaw) * dz,
    right: Math.cos(yaw) * dx - Math.sin(yaw) * dz,
  }
}
function clearInput() {
  keys.clear()
  fire = aim = reload = tab = false
  crouching = false
  nadeQueued = false
  accumulator = 0
}
function pause(explicit = false) {
  if (!active()) return
  if (session) {
    session.paused = true
    session.save()
  }
  // Online matches keep running when the window loses focus; solo play pauses.
  paused = !!session
  freeLook = false
  clearInput()
  if (session || explicit) {
    $('pause').hidden = false
    $('scoreboard').hidden = true
  }
  canvas.classList.remove('playing')
  if (document.pointerLockElement) document.exitPointerLock()
}
function resume(capture = true) {
  if (!active()) return
  clearInput()
  sound.start()
  paused = false
  if (session) session.paused = false
  freeLook = !capture
  $('pause').hidden = true
  $('modal').hidden = true
  canvas.classList.add('playing')
}
function captureError() {
  if (!session) return
  captureFailed = true
  pause()
  $('freeLook').hidden = false
  toast('Mouse capture is unavailable here. You can still play in this window.')
}
function lock() {
  if (captureFailed) { resume(false); return }
  sound.start()
  try {
    const result = canvas.requestPointerLock()
    if (result) result.catch(captureError)
  } catch { captureError() }
}
function start() {
  const name = $<HTMLInputElement>('nickname').value.trim() || 'You'
  storage.setItem('crosscut-name', name)
  mode = 'solo'
  session = new SoloSession(name, storage, { difficulty, adaptive: adaptiveDifficulty })
  latest = session.game.snapshot()
  previous = latest
  local = latest.players.find(p => p.id === selfId)!
  yaw = local.yaw
  pitch = local.pitch
  weapon = 'rifle'
  lastRound = latest.roundId
  lastReload = 0
  world.reload = 0
  world.kick = 0
  $('feed').innerHTML = ''
  $('killConfirm').className = ''
  $('damage').className = ''
  $('hitmarker').className = ''
  $('respawn').hidden = true
  streak = 0
  fireAt = {}
  nadeQueued = false
  $('directions').innerHTML = ''
  $('streak').hidden = true
  $('scope').hidden = true
  $('menu').hidden = true
  $('hud').hidden = false
  displayHud()
  lock()
}
let prevStatus = ''
function netStatus(status: string) {
  if (status === prevStatus) return
  const was = prevStatus
  prevStatus = status
  if (status === 'disconnected' && was === 'connected')
    toast('Connection lost — reconnecting…')
  if (status === 'unauthorized') {
    toast('Online play is unavailable from this address.')
    leave()
  }
}
function reconcilePracticeBots() {
  if (!onlineGame || !online) return
  if (!$<HTMLInputElement>('fillBots').checked) {
    for (const actor of [...onlineGame.actors.values()]) if (actor.p.bot) onlineGame.remove(actor.p.id)
    return
  }
  const humans = [...onlineGame.actors.values()].filter((actor) => !actor.p.bot).length
  const target = Math.max(0, Math.min(5, 6 - humans))
  const bots = [...onlineGame.actors.values()].filter((actor) => actor.p.bot)
  while (bots.length > target) {
    const actor = bots.pop()!
    onlineGame.remove(actor.p.id)
  }
  const names = ['Flint', 'Mica', 'Slate', 'Onyx', 'Jasper']
  for (let n = bots.length; n < target; n++) {
    const id = `practice-${n}`
    if (!onlineGame.actors.has(id)) onlineGame.add(id, names[n], true)
  }
}
function hostChange(hostId: string) {
  if (hostId === online?.connectionId) {
    onlineGame = new Game({ difficulty, adaptive: adaptiveDifficulty, botScoring: false })
    onlineGame.add(selfId, $<HTMLInputElement>('nickname').value.trim() || 'Player')
    if ($<HTMLInputElement>('fillBots').checked) reconcilePracticeBots()
    selfBody = undefined
    hostClock = 0
    toast('You are hosting — share the room code to play together.')
  } else {
    onlineGame = undefined
    selfBody = undefined
    hostClock = 0
  }
}
function hostInput(batch: { from: string; inputs: Input[] }) {
  if (!onlineGame || !online || batch.from === online.connectionId) return
  if (!onlineGame.actors.has(batch.from)) {
    onlineGame.add(batch.from, online.nameOf(batch.from))
    reconcilePracticeBots()
  }
  onlineGame.enqueue(batch.from, batch.inputs)
}
function startOnline() {
  const name = $<HTMLInputElement>('nickname').value.trim() || 'Player'
  storage.setItem('crosscut-name', name)
  const code =
    $<HTMLInputElement>('roomcode')
      .value.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40) || 'global'
  storage.setItem('crosscut-room', code)
  mode = 'online'
  session = undefined
  onlineGame = undefined
  selfBody = undefined
  local = undefined
  latest = previous = undefined
  paused = false
  netSeq = 0
  hostClock = 0
  selfId = ''
  yaw = 0
  pitch = 0
  weapon = 'rifle'
  lastRound = ''
  lastReload = 0
  prevStatus = ''
  world.reload = 0
  world.kick = 0
  $('feed').innerHTML = ''
  $('killConfirm').className = ''
  $('damage').className = ''
  $('hitmarker').className = ''
  $('respawn').hidden = true
  streak = 0
  fireAt = {}
  nadeQueued = false
  $('directions').innerHTML = ''
  $('streak').hidden = true
  $('scope').hidden = true
  $('menu').hidden = true
  $('hud').hidden = false
  $('netState').textContent = 'connecting'
  displayHud()
  online = new Net({
    onSelf: (id) => {
      selfId = id
    },
    onStatus: netStatus,
    onMembers: (members) => {
      if (!onlineGame || !online?.hosting()) return
      const present = new Set(members.map((member) => member.connectionId))
      for (const actor of [...onlineGame.actors.values()])
        if (!actor.p.bot && actor.p.id !== selfId && !present.has(actor.p.id)) onlineGame.remove(actor.p.id)
      reconcilePracticeBots()
    },
    onHostChange: hostChange,
    onInput: hostInput,
    onSnap: (s) => receive(s),
  })
  online.start(name, 'crosscut:' + code)
  startSim()
  lock()
}
function leave() {
  stopSim()
  online?.close()
  online = undefined
  onlineGame = undefined
  selfBody = undefined
  mode = undefined
  paused = false
  selfId = 'you'
  session?.finish()
  session = undefined
  local = undefined
  latest = previous = undefined
  freeLook = false
  clearInput()
  if (document.pointerLockElement) document.exitPointerLock()
  canvas.classList.remove('playing')
  $('menu').hidden = false
  for (const id of ['hud', 'pause', 'scoreboard', 'modal']) $(id).hidden = true
  world.updatePlayers([], '')
}
function receive(s: Snapshot) {
  previous = latest
  latest = s
  const p = s.players.find(p => p.id === selfId)
  if (!p) return
  const respawned = local && local.health <= 0 && p.health > 0
  const round = lastRound !== s.roundId
  const wasAlive = local && local.health > 0
  if (respawned || round) {
    yaw = p.yaw
    pitch = p.pitch
    weapon = 'rifle'
    world.kick = 0
    previous = s
    clearInput()
    streak = 0
    fireAt = {}
  }
  lastRound = s.roundId
  if (online && !onlineGame && p.health > 0 && !s.restartAt) {
    if (
      !selfBody ||
      respawned ||
      round ||
      Math.hypot(selfBody.x - p.x, selfBody.z - p.z) > 3
    )
      selfBody = body(p.x, p.y, p.z)
    else {
      selfBody.x += (p.x - selfBody.x) * 0.12
      selfBody.y += (p.y - selfBody.y) * 0.2
      selfBody.z += (p.z - selfBody.z) * 0.12
      selfBody.grounded = p.grounded
    }
  }
  if (local && p.health < local.health) {
    $('damage').classList.remove('flash')
    void $('damage').offsetWidth
    $('damage').classList.add('flash')
  }
  local = p
  if (p.reloadUntil && lastReload !== p.reloadUntil) {
    lastReload = p.reloadUntil
    sound.reload()
  }
  for (const e of s.events) {
    world.event(e, selfId)
    if (e.type === 'shot') {
      // Radar remembers muzzle flashes for a moment.
      fireAt[e.id] = s.time
      if (e.id !== selfId && e.hit === selfId) showDirection(e.from)
      if (e.id === selfId) {
        world.shot(e.weapon)
        if (e.weapon === 'knife') sound.knife()
        else sound.shot(e.weapon)
      }
      if (e.id !== selfId) {
        const d = local
          ? Math.hypot(e.from.x - local.x, e.from.z - local.z)
          : 100
        if (d < 30) sound.shot(e.weapon, true)
      }
      if (e.id === selfId && e.hit) {
        sound.hit()
        $('hitmarker').className = e.head ? 'head hit' : 'hit'
        setTimeout(() => ($('hitmarker').className = ''), 120)
      }
    }
    if (e.type === 'boom') {
      const d = local
        ? Math.hypot(e.at.x - local.x, e.at.y - local.y, e.at.z - local.z)
        : 99
      sound.boom(d)
      world.boom(e.at)
      if (d < 16 && local && local.health > 0) {
        world.kick = Math.min(0.3, world.kick + (1 - d / 16) * 0.26)
        showDirection(e.at, true)
      }
    }
    if (e.type === 'kill') {
      const killer = s.players.find((p) => p.id === e.killer)?.name ?? 'Player',
        victim = s.players.find((p) => p.id === e.victim)?.name ?? 'Player'
      const item = document.createElement('div')
      item.className = 'feed-item' + (e.killer === selfId ? ' yours' : '')
      const glyph: Record<Weapon | 'frag', string> = {
        rifle: '⌁',
        smg: '⁝',
        sniper: '⊙',
        knife: '／',
        frag: '⊗',
      }
      item.innerHTML = `<span>${esc(killer)}</span><span class="feed-weapon">${glyph[e.weapon]}</span><span>${esc(victim)}</span>`
      $('feed').prepend(item)
      while ($('feed').children.length > 4) $('feed').lastChild?.remove()
      setTimeout(() => item.remove(), 4500)
      if (e.killer === selfId) {
        streak++
        if (streak >= 2)
          showStreak(
            streak >= 5
              ? 'RAMPAGE ×' + streak
              : streak === 4
                ? 'FURY'
                : streak === 3
                  ? 'TRIPLE KILL'
                  : 'DOUBLE KILL',
          )
        sound.kill()
        $('killConfirm').textContent = (e.head ? 'Headshot · ' : '') + victim
        $('killConfirm').className = 'visible'
        if (killTimer) clearTimeout(killTimer)
        killTimer = setTimeout(() => ($('killConfirm').className = ''), 1700)
      }
    }
  }
  if (wasAlive && p.health === 0) {
    fire = aim = false
    keys.clear()
    streak = 0
  }
  $('respawn').hidden = p.health > 0 || !!s.restartAt
  updateScore()
}
function modal(title: string, body: string) {
  pause()
  $('modalTitle').textContent = title
  $('modalBody').innerHTML = body
  $('modal').hidden = false
  $('modalClose').focus()
}
function settings() {
  modal(
    'Settings',
    `<label class="setting"><span>Sensitivity</span><output id="sensitivityValue">${sensitivity.toFixed(2)}</output><input id="sensitivityInput" type="range" min="0.3" max="2.5" step=".05" value="${sensitivity}"></label><label class="setting"><span>Field of view</span><output id="fovValue">${world.fov}°</output><input id="fovInput" type="range" min="70" max="105" step="1" value="${world.fov}"></label><label class="setting"><span>Bot difficulty</span><output id="difficultyValue">${difficulty[0].toUpperCase() + difficulty.slice(1)}</output><select id="difficultyInput" class="text-input"><option value="easy" ${difficulty === 'easy' ? 'selected' : ''}>Easy</option><option value="normal" ${difficulty === 'normal' ? 'selected' : ''}>Normal</option><option value="hard" ${difficulty === 'hard' ? 'selected' : ''}>Hard</option><option value="brutal" ${difficulty === 'brutal' ? 'selected' : ''}>Brutal</option></select></label><label class="toggle-row"><span>Adaptive bot difficulty</span><input id="adaptiveInput" type="checkbox" ${adaptiveDifficulty ? 'checked' : ''}></label><label class="setting"><span>Visual quality</span><output id="qualityValue">${quality[0].toUpperCase() + quality.slice(1)}</output><select id="qualityInput" class="text-input"><option value="low" ${quality === 'low' ? 'selected' : ''}>Low</option><option value="medium" ${quality === 'medium' ? 'selected' : ''}>Medium</option><option value="high" ${quality === 'high' ? 'selected' : ''}>High</option></select></label><label class="toggle-row"><span>Reduce motion and flashing</span><input id="motionInput" type="checkbox" ${reducedMotion ? 'checked' : ''}></label><label class="setting"><span>Volume</span><output id="volumeValue">${Math.round(volume * 100)}%</output><input id="volumeInput" type="range" min="0" max="1" step=".05" value="${volume}"></label>`,
  )
  $<HTMLInputElement>('sensitivityInput').oninput = (e) => {
    sensitivity = Number((e.target as HTMLInputElement).value)
    $('sensitivityValue').textContent = sensitivity.toFixed(2)
    storage.setItem('crosscut-sensitivity', String(sensitivity))
  }
  $<HTMLInputElement>('fovInput').oninput = (e) => {
    world.fov = Number((e.target as HTMLInputElement).value)
    $('fovValue').textContent = world.fov + '°'
    storage.setItem('crosscut-fov', String(world.fov))
  }
  $<HTMLSelectElement>('difficultyInput').onchange = (e) => {
    difficulty = (e.target as HTMLSelectElement).value as BotDifficulty
    $('difficultyValue').textContent = difficulty[0].toUpperCase() + difficulty.slice(1)
    storage.setItem('crosscut-difficulty', difficulty)
  }
  $<HTMLInputElement>('adaptiveInput').onchange = (e) => {
    adaptiveDifficulty = (e.target as HTMLInputElement).checked
    storage.setItem('crosscut-adaptive', String(adaptiveDifficulty))
  }
  $<HTMLSelectElement>('qualityInput').onchange = (e) => {
    quality = (e.target as HTMLSelectElement).value as Quality
    world.setQuality(quality)
    $('qualityValue').textContent = quality[0].toUpperCase() + quality.slice(1)
    storage.setItem('crosscut-quality', quality)
  }
  $<HTMLInputElement>('motionInput').onchange = (e) => {
    reducedMotion = (e.target as HTMLInputElement).checked
    world.reducedMotion = reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
    storage.setItem('crosscut-reduced-motion', String(reducedMotion))
  }
  $<HTMLInputElement>('volumeInput').oninput = (e) => {
    volume = Number((e.target as HTMLInputElement).value)
    sound.setVolume(volume)
    $('volumeValue').textContent = Math.round(volume * 100) + '%'
    storage.setItem('crosscut-volume', String(volume))
  }
}
$('settings').onclick = settings
$('pauseSettings').onclick = settings
$('controls').onclick = () =>
  modal(
    'Controls',
    `<dl class="controls-list">${[
      ['Move', 'w a s d'],
      ['Look', 'Mouse'],
      ['Fire', 'Left click'],
      ['Aim', 'Right click'],
      ['Jump / bunny hop', 'Hold space'],
      ['Slide', 'c while sprinting'],
      ['Crouch', 'hold c when slow'],
      ['Reload', 'r'],
      ['Grenade', 'g'],
      ['Weapons', '1 – 4 or scroll'],
      ['Score', 'tab'],
      ['Menu', 'esc'],
    ]
      .map(([label, key]) => `<div><dt>${label}</dt><dd>${key}</dd></div>`)
      .join('')}</dl>`,
  )
$('modalClose').onclick = () => {
  $('modal').hidden = true
}
$('statsButton').onclick = () => {
  const s = readStats(storage)
  modal(
    'Your record',
    s
      ? `<div class="stats-grid">${[
          ['Wins', s.wins],
          ['Kills', s.kills],
          ['Deaths', s.deaths],
          ['Matches', s.matches],
        ]
          .map(
            ([label, value]) =>
              `<div><strong>${value}</strong><span>${label}</span></div>`,
          )
          .join('')}</div><p class="record-note">Saved in this browser</p>`
      : '<p>No matches yet.</p>',
  )
}
$('play').onclick = start
$('online').onclick = startOnline
$('fillBots').addEventListener('change', () => {
  if (!onlineGame || !online?.hosting()) return
  reconcilePracticeBots()
})
$('resume').onclick = lock
$('freeLook').onclick = () => resume(false)
$('leave').onclick = leave
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea')) return
  if (
    active() &&
    ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'ControlRight', 'KeyC'].includes(e.code)
  )
    e.preventDefault()
  if (e.code === 'Escape') {
    $('modal').hidden = true
    pause(true)
    return
  }
  if (!running()) return
  if (e.code === 'Tab') { tab = true; updateScore() }
  keys.add(e.code)
  if (e.code === 'Digit1') weapon = 'rifle'
  if (e.code === 'Digit2') weapon = 'smg'
  if (e.code === 'Digit3') weapon = 'sniper'
  if (e.code === 'Digit4') weapon = 'knife'
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC')
    crouching = true
  if (e.code === 'KeyR') reload = true
  if (e.code === 'KeyG') nadeQueued = true
})
window.addEventListener('keyup', (e) => {
  keys.delete(e.code)
  if (e.code === 'Tab') { tab = false; updateScore() }
  if (
    (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') &&
    !keys.has('ControlLeft') &&
    !keys.has('ControlRight') &&
    !keys.has('KeyC')
  )
    crouching = false
})
window.addEventListener('blur', () => pause())
window.addEventListener('pagehide', () => session?.save())
document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) resume()
  else if (running() && !freeLook) pause()
})
canvas.addEventListener('mousemove', (e) => {
  if (!running()) return
  yaw -= e.movementX * 0.002 * sensitivity
  pitch = Math.max(-1.48, Math.min(1.48, pitch - e.movementY * 0.002 * sensitivity))
  yaw = ((((yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
})
canvas.addEventListener('mouseleave', () => { if (freeLook) { fire = aim = false } })
canvas.addEventListener('mousedown', (e) => {
  if (!running()) return
  // Clicking an online view first re-captures the pointer instead of firing.
  if (!freeLook && !document.pointerLockElement && online) {
    lock()
    return
  }
  if (e.button === 0) fire = true
  if (e.button === 2) aim = true
})
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) fire = false
  if (e.button === 2) aim = false
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
canvas.addEventListener('wheel', (e) => {
  if (running()) {
    e.preventDefault()
    const at = GUNS.indexOf(weapon)
    const next = at < 0 ? GUNS[0] : GUNS[(at + (e.deltaY > 0 ? 1 : 2)) % GUNS.length]
    weapon = next
  }
}, { passive: false })
function updateScore() {
  const s = latest
  if (!s) return
  $('scoreboard').hidden = !running() || !(tab || s.restartAt)
  if ($('scoreboard').hidden) return
  const ranked = [...s.players].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths,
  )
  $('scoreLabel').textContent = s.restartAt ? 'Round complete' : 'Deathmatch'
  $('scoreTitle').textContent = s.restartAt
    ? ranked[0]?.kills
      ? ranked[0].id === selfId
        ? 'Your round.'
        : ranked[0].name + ' wins'
      : 'Good warm-up.'
    : 'Quarry'
  $('roundCountdown').textContent = s.restartAt
    ? 'Next round in ' + Math.max(0, Math.ceil(s.restartAt - s.time))
    : ''
  $('scoreRows').innerHTML = ranked
    .map(
      (p, n) =>
        `<div class="score-row ${p.id === selfId ? 'self' : ''}"><span><b>${n + 1}</b>${esc(p.name)}${p.bot ? '<small>Bot</small>' : ''}</span><span>${p.kills}</span><span>${p.deaths}</span></div>`,
    )
    .join('')
}
function displayHud() {
  if (!local || !latest) return
  const p = view() ?? local,
    s = latest,
    scoped = aim && weapon === 'sniper' && p.health > 0 && !s.restartAt,
    remaining = Math.max(0, Math.ceil(s.roundEnds - s.time))
  $('matchClock').textContent =
    Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0')
  $('matchScore').textContent = p.kills + ' / 25'
  $('health').textContent = String(p.health)
  $('healthBar').style.width = p.health + '%'
  $('healthBar').className = p.health <= 34 ? 'low' : ''
  $('weaponName').textContent = WEAPONS[weapon].name
  const keyOf: Record<Weapon, string> = { rifle: '1', smg: '2', sniper: '3', knife: '4' }
  $('weaponKey').textContent = keyOf[weapon]
  $('ammo').innerHTML =
    weapon === 'knife'
      ? '<span class="knife-glyph">⌁</span>'
      : p.ammo + ` <small>/ ${WEAPONS[weapon].mag}</small>`
  const reloadS = WEAPONS[p.weapon].reload || 1.65
  $('reloadProgress').className = p.reloadUntil ? 'active' : ''
  ;($('reloadProgress').firstElementChild as HTMLElement).style.width =
    (1 - Math.max(0, p.reloadUntil - s.time) / reloadS) * 100 + '%'
  world.reload = p.reloadUntil
    ? 1 - Math.max(0, p.reloadUntil - s.time) / reloadS
    : 0
  $('respawn').textContent =
    'Back in ' + Math.max(1, Math.ceil(p.respawnAt - s.time))
  $('speed').textContent = Math.hypot(p.vx, p.vz).toFixed(1) + ' m/s'
  $('fps').textContent = `${fps} fps · ${world.frameMs.toFixed(1)} ms · ${world.drawCalls} calls · ${world.triangles.toLocaleString()} tris`
  $('netState').textContent =
    mode === 'online'
      ? onlineGame
        ? 'host'
        : online?.hostId
          ? 'connected'
          : 'waiting for host'
      : latest.restartAt
        ? ''
        : 'solo'
  $('crosshair').className =
    (aim ? 'aim ' : '') +
    (p.health <= 0 || s.restartAt || scoped ? 'hidden' : '')
  $('scope').hidden = !scoped
  drawRadar()
  $('crosshair').style.setProperty(
    '--gap',
    5 + Math.hypot(p.vx, p.vz) * 0.35 + world.kick * 90 + 'px',
  )
  if (s.restartAt) updateScore()
}
function view(): Player | undefined {
  if (!local) return undefined
  if (!online || onlineGame || local.health <= 0 || !selfBody) return local
  return {
    ...local,
    x: selfBody.x,
    y: selfBody.y,
    z: selfBody.z,
    vx: selfBody.vx,
    vy: selfBody.vy,
    vz: selfBody.vz,
    grounded: selfBody.grounded,
    pose: selfBody.pose,
    yaw,
    pitch,
    weapon,
  }
}
function interpolated(): Player[] {
  if (!latest) return []
  const alpha = accumulator / DT
  return latest.players.map(p => {
    const b = previous?.players.find(q => q.id === p.id)
    if (!b || p.health <= 0 || b.health <= 0 || Math.hypot(b.x - p.x, b.z - p.z) > 4) return p
    const turn = ((p.yaw - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    return { ...p, x: b.x + (p.x - b.x) * alpha, y: b.y + (p.y - b.y) * alpha,
      z: b.z + (p.z - b.z) * alpha, yaw: b.yaw + turn * alpha }
  })
}
// Online matches keep stepping on an independent timer: rAF stalls in hidden
// tabs, and a hidden host would freeze the whole room's clock.
let simTimer: ReturnType<typeof setInterval> | undefined
function startSim() {
  stopSim()
  let simLast = performance.now()
  simTimer = setInterval(() => {
    const now = performance.now()
    const dt = Math.min((now - simLast) / 1000, 0.1)
    simLast = now
    if (mode !== 'online' || !online || paused || !running()) return
    accumulator = Math.min(accumulator + dt, 0.12)
    hudClock += dt
    stepOnline()
  }, 16)
}
function stopSim() {
  if (simTimer) clearInterval(simTimer)
  simTimer = undefined
}
function stepOnline() {
  while (accumulator >= DT) {
    accumulator -= DT
    if (onlineGame) {
      onlineGame.enqueue(selfId, [buildInput()])
      onlineGame.tick()
      hostClock += DT
      if (hostClock >= 1 / 15) {
        hostClock = 0
        const snap = onlineGame.snapshot()
        receive(snap)
        online!.publishSnap(snap)
      }
    } else {
      const input = buildInput()
      const alive = !!local && local.health > 0 && !latest?.restartAt
      if (selfBody && alive) move(selfBody, input)
      online!.pushInput(input)
    }
  }
}
function buildInput(): Input {
  const alive = !!local && local.health > 0 && !latest?.restartAt
  const wantsReload = alive && reload
  reload = false
  const wantsNade = alive && nadeQueued
  nadeQueued = false
  return {
    ...idleInput(),
    seq: ++netSeq,
    yaw,
    pitch,
    weapon,
    forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
    side: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
    jump: alive && keys.has('Space'),
    fire: alive && fire,
    aim: alive && aim,
    reload: wantsReload,
    crouch: alive && crouching,
    nade: wantsNade,
  }
}
let last = performance.now()
function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  frameCount++
  fpsTime += dt
  if (fpsTime >= 0.5) {
    fps = Math.round(frameCount / fpsTime)
    frameCount = 0
    fpsTime = 0
  }
  if (running() && (session || online)) {
    hudClock += dt
    if (online) {
      stepOnline() // the interval also advances this loop when hidden
    } else {
      accumulator += dt
      while (accumulator >= DT) {
        accumulator -= DT
        const snapshot = session!.step(buildInput())
        if (snapshot) receive(snapshot)
      }
    }
    if (hudClock >= 0.1) { hudClock = 0; displayHud() }
    const v = view()
    if (v && v.grounded && Math.hypot(v.vx, v.vz) > 2 && v.health > 0)
      sound.step(session?.game.time ?? latest?.time ?? 0, Math.hypot(v.vx, v.vz))
  }
  const players = running() ? interpolated() : latest?.players ?? []
  world.updatePlayers(players, selfId)
  world.updateNades(latest?.nades ?? [])
  const me = view() ?? players.find(p => p.id === selfId)
  world.render(running() || !active() ? dt : 0, me, local ? { yaw, pitch, aim } : undefined, false)
}
requestAnimationFrame(frame)
const me = (await fetch('/api/me').then(
  (response) => (response.ok ? response.json() : null),
).catch(() => null)) as { user?: { name?: string } } | null
accountName = typeof me?.user?.name === 'string' ? me.user.name : ''
$('account').textContent = accountName || 'Sign in'
$('account').onclick = () => {
  if (!accountName) location.href = '/auth/freebuff/signin?returnTo=%2F'
  else
    modal(
      'Account',
      `<p class="record-note">Signed in as <b>${esc(accountName)}</b>.</p>`,
    )
}
if (matchMedia('(pointer: coarse)').matches) {
  $('unsupported').hidden = false
  $('play').setAttribute('disabled', '')
}
// Small window hook for diagnostics and autonomous testing.
;(window as unknown as Record<string, unknown>)['__crosscut'] = {
  get mode() { return mode },
  get selfId() { return selfId },
  get online() {
    return online
      ? { status: online.status, hostId: online.hostId, connectionId: online.connectionId, members: online.members.length }
      : null
  },
  get hosting() { return !!onlineGame },
  get running() { return running() },
  get local() { return local ? { id: local.id, health: local.health, x: local.x, y: local.y, z: local.z, pose: local.pose, weapon: local.weapon, ammo: local.ammo, shot: local.shot } : null },
  get inputState() { return { fire, crouching, keys: [...keys], pointerLocked: !!document.pointerLockElement, freeLook } },
  get players() { return (latest?.players ?? []).map((p) => ({ id: p.id, name: p.name, health: p.health, kills: p.kills, bot: p.bot, pose: p.pose })) },
  get nades() { return latest?.nades ?? [] },
  get directions() { return $("directions").children.length },
  get streakLabel() { return $("streak").textContent },
  startSolo: () => { const el = document.getElementById('play'); el && el.click() },
  startOnline: () => { const el = document.getElementById('online'); el && el.click() },
  leave: () => { const el = document.getElementById('leave'); el && el.click() },
}
