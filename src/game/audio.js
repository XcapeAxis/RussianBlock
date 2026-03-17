const SOUND_LIBRARY = {
  click: { frequency: 540, duration: 0.06, type: "triangle" },
  drop: { frequency: 220, duration: 0.08, type: "square" },
  "line-clear": { frequency: 740, duration: 0.18, type: "triangle" },
  gameover: { frequency: 140, duration: 0.36, type: "sawtooth" },
  hold: { frequency: 420, duration: 0.1, type: "triangle" },
};

export class AudioManager {
  constructor({ muted = false } = {}) {
    this.context = null;
    this.masterGain = null;
    this.muted = muted;
  }

  ensureContext() {
    if (typeof window === "undefined" || !window.AudioContext) {
      return null;
    }
    if (!this.context) {
      this.context = new window.AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.07;
      this.masterGain.connect(this.context.destination);
    }
    return this.context;
  }

  unlock() {
    const context = this.ensureContext();
    if (context && context.state === "suspended") {
      void context.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 0.07;
    }
  }

  play(name) {
    const context = this.ensureContext();
    const sound = SOUND_LIBRARY[name];
    if (!context || !sound || this.muted || !this.masterGain) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(60, sound.frequency * 0.72),
      now + sound.duration
    );

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);

    oscillator.connect(gain);
    gain.connect(this.masterGain);

    oscillator.start(now);
    oscillator.stop(now + sound.duration + 0.02);
  }
}
