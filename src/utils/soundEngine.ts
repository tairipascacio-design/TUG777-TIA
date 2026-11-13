class TradingSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private ensureContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType, gainPeak: number, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  public click() {
    this.playTone(920, 0.045, 'triangle', 0.06);
  }

  public tabSwitch() {
    this.playTone(680, 0.04, 'sine', 0.05);
    this.playTone(980, 0.045, 'sine', 0.04, 0.025);
  }

  public powerOn() {
    this.playTone(330, 0.09, 'sawtooth', 0.04, 0);
    this.playTone(495, 0.11, 'triangle', 0.06, 0.06);
    this.playTone(660, 0.16, 'sine', 0.07, 0.12);
  }

  public powerOff() {
    this.playTone(540, 0.08, 'triangle', 0.05, 0);
    this.playTone(320, 0.14, 'sine', 0.05, 0.06);
  }

  public tradeExecuted() {
    this.playTone(587.33, 0.08, 'triangle', 0.07, 0);
    this.playTone(880, 0.14, 'sine', 0.08, 0.065);
    this.playTone(1174.66, 0.18, 'sine', 0.06, 0.13);
  }

  public alert() {
    this.playTone(260, 0.11, 'sawtooth', 0.05, 0);
    this.playTone(210, 0.15, 'sawtooth', 0.05, 0.09);
  }
}

export const soundEngine = new TradingSoundEngine();
