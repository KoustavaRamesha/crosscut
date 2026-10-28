export class Sound {
  ctx?: AudioContext
  gain?: GainNode
  volume = 0.5
  lastStep = 0
  start() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this.volume
      this.gain.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }
  setVolume(v: number) {
    this.volume = v
    if (this.gain) this.gain.gain.value = v
  }
  noise(duration: number, volume: number, freq: number) {
    if (!this.ctx || !this.gain) return
    const c = this.ctx,
      buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate),
      data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2)
    const source = c.createBufferSource()
    source.buffer = buffer
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = freq
    const gain = c.createGain()
    gain.gain.value = volume
    source.connect(filter).connect(gain).connect(this.gain)
    source.start()
  }
  tone(
    f: number,
    to: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
  ) {
    if (!this.ctx || !this.gain) return
    const c = this.ctx,
      o = c.createOscillator(),
      g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f, c.currentTime)
    o.frequency.exponentialRampToValueAtTime(to, c.currentTime + duration)
    g.gain.setValueAtTime(volume, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
    o.connect(g).connect(this.gain)
    o.start()
    o.stop(c.currentTime + duration)
  }
  shot(weapon: string = 'rifle', remote = false) {
    if (weapon === 'smg') {
      this.noise(0.09, remote ? 0.07 : 0.16, remote ? 2000 : 7200)
      this.tone(190, 66, 0.07, remote ? 0.025 : 0.11, 'triangle')
    } else if (weapon === 'sniper') {
      this.noise(0.34, remote ? 0.14 : 0.31, remote ? 900 : 2800)
      this.tone(72, 28, 0.3, remote ? 0.05 : 0.22, 'sawtooth')
    } else {
      this.noise(0.16, remote ? 0.09 : 0.23, remote ? 1300 : 5500)
      this.tone(145, 42, 0.12, remote ? 0.03 : 0.17, 'triangle')
    }
  }
  knife() {
    this.noise(0.12, 0.12, 2800)
  }
  // Distance in meters: full punch when it lands close, a thud when far.
  boom(distance: number) {
    const near = Math.max(0, Math.min(1, 1 - distance / 34)),
      v = near * near
    this.noise(0.55, 0.28 * v + 0.05, 320 + 900 * near)
    this.tone(64, 26, 0.44, 0.22 * v + 0.03, 'sine')
    setTimeout(() => this.noise(0.3, 0.1 * v + 0.02, 500), 110)
  }
  hit() {
    this.tone(920, 660, 0.06, 0.11, 'triangle')
  }
  kill() {
    this.tone(880, 1400, 0.14, 0.14)
    setTimeout(() => this.tone(1320, 1760, 0.13, 0.1), 90)
  }
  reload() {
    this.noise(0.06, 0.13, 3500)
    setTimeout(() => this.noise(0.09, 0.13, 1700), 700)
    setTimeout(() => this.noise(0.05, 0.15, 5000), 1400)
  }
  step(time: number, speed: number) {
    if (time - this.lastStep > Math.max(0.2, 0.43 - speed * 0.013)) {
      this.noise(0.065, 0.045, 650)
      this.lastStep = time
    }
  }
}
