export class AlarmPlayer {
  constructor() {
    this.context = null;
    this.master = null;
    this.playing = false;
    this.nodes = new Set();
    this.fillTimer = null;
    this.vibrateTimer = null;
    this.nextChimeAt = 0;
  }

  async unlock() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.14;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }
    return true;
  }

  async start({ sound = true, vibrate = true } = {}) {
    this.stop();
    this.playing = true;
    if (vibrate) this.startVibration();
    if (!sound) return;
    const ready = await this.unlock();
    if (!ready || !this.playing) return;

    this.nextChimeAt = this.context.currentTime + 0.05;
    this.fill();
    this.fillTimer = window.setInterval(() => this.fill(), 12000);
  }

  stop() {
    this.playing = false;
    if (this.fillTimer) {
      clearInterval(this.fillTimer);
      this.fillTimer = null;
    }
    if (this.vibrateTimer) {
      clearInterval(this.vibrateTimer);
      this.vibrateTimer = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.nodes.clear();
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(0.0001, this.context.currentTime + 0.06);
      window.setTimeout(() => {
        if (this.master) this.master.gain.value = 0.14;
      }, 140);
    }
  }

  fill() {
    if (!this.playing || !this.context) return;
    const horizon = this.context.currentTime + 18;
    while (this.nextChimeAt < horizon) {
      this.scheduleChime(this.nextChimeAt);
      this.nextChimeAt += 2.1;
    }
  }

  scheduleChime(at) {
    if (!this.context || !this.master) return;
    const notes = [
      { frequency: 880, offset: 0 },
      { frequency: 1174.66, offset: 0.17 },
      { frequency: 987.77, offset: 0.42 },
      { frequency: 1318.51, offset: 0.6 }
    ];
    for (const note of notes) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, at + note.offset);
      oscillator.detune.setValueAtTime(-3, at + note.offset);
      const start = at + note.offset;
      const end = start + 0.5;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.24, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
      this.nodes.add(oscillator);
      oscillator.addEventListener(
        "ended",
        () => {
          this.nodes.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        },
        { once: true }
      );
    }
  }

  startVibration() {
    if (!navigator.vibrate) return;
    const pattern = [320, 140, 320, 140, 640, 320];
    navigator.vibrate(pattern);
    this.vibrateTimer = window.setInterval(() => navigator.vibrate(pattern), 2600);
  }

  async preview() {
    await this.start({ sound: true, vibrate: false });
    window.setTimeout(() => this.stop(), 2600);
  }
}
