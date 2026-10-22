/**
 * Offline Web Audio API Alert Synthesizer
 * Generates alert tones without external audio file dependencies.
 */
class AudioAlertSynth {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playBeep(freq = 880, type = 'sine', duration = 0.15, vol = 0.3) {
    try {
      this.init();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio alert play error:', e);
    }
  }

  playCrashAlarm() {
    this.playBeep(440, 'sawtooth', 0.12, 0.4);
    setTimeout(() => this.playBeep(330, 'sawtooth', 0.18, 0.4), 130);
    setTimeout(() => this.playBeep(220, 'sawtooth', 0.3, 0.5), 320);
  }

  playSuccessChime() {
    this.playBeep(523.25, 'sine', 0.1, 0.25); // C5
    setTimeout(() => this.playBeep(659.25, 'sine', 0.1, 0.25), 100); // E5
    setTimeout(() => this.playBeep(783.99, 'sine', 0.2, 0.3), 200); // G5
  }

  playWarningChirp() {
    this.playBeep(987.77, 'triangle', 0.1, 0.3); // B5
    setTimeout(() => this.playBeep(880.00, 'triangle', 0.15, 0.3), 110); // A5
  }
}

export const alertSynth = new AudioAlertSynth();
