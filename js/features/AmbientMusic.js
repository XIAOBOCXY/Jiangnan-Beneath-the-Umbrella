// A small original ambient loop synthesized with Web Audio. It needs no audio
// file, system capture, or network request, and its analyser drives the 3D light.
const SCALE = [146.83, 164.81, 185, 220, 246.94, 293.66, 329.63, 369.99, 440];
const PHRASE = [0, 2, 4, 3, 6, 4, 2, 1, 3, 4, 7, 6, 4, 2, 4, 3];

export class AmbientMusic {
  constructor() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("此浏览器不支持 Web Audio。");
    this.context = new AudioContextClass();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.66;
    this.analyser.minDecibels = -84;
    this.analyser.maxDecibels = -20;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.master = this.context.createGain();
    this.master.gain.value = 0.24;
    this.delay = this.context.createDelay(1.2);
    this.delay.delayTime.value = 0.42;
    this.feedback = this.context.createGain();
    this.feedback.gain.value = 0.2;
    this.wet = this.context.createGain();
    this.wet.gain.value = 0.18;
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.master.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.analyser);
    this.playing = false;
    this.timer = 0;
    this.noteIndex = 0;
    this.nextNoteAt = 0;
    this.noiseSource = null;
    this.noiseGain = null;
    this.drones = [];
  }

  async play() {
    if (this.playing) return true;
    await this.context.resume();
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.24, now, 0.8);
    this.startBed(now);
    this.nextNoteAt = now + 0.18;
    this.playing = true;
    this.timer = window.setInterval(() => this.schedulePhrase(), 120);
    this.schedulePhrase();
    return true;
  }

  startBed(now) {
    if (this.drones.length) return;
    // Quiet open fifths give the plucked pentatonic phrase a warm floor.
    [73.42, 110].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      oscillator.type = index ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      filter.type = "lowpass";
      filter.frequency.value = 520;
      gain.gain.value = index ? 0.032 : 0.044;
      oscillator.connect(filter).connect(gain).connect(this.master);
      oscillator.start(now);
      this.drones.push({ oscillator, gain });
    });

    // Filtered, very quiet noise adds a rain-on-leaves texture without using
    // microphone/system audio. The loop is generated locally in memory.
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      low = low * 0.96 + (Math.random() * 2 - 1) * 0.04;
      channel[i] = low;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    this.noiseGain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 1450;
    this.noiseGain.gain.value = 0.075;
    source.connect(filter).connect(this.noiseGain).connect(this.master);
    source.start(now);
    this.noiseSource = source;
  }

  schedulePhrase() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    while (this.nextNoteAt < now + 0.65) {
      const index = PHRASE[this.noteIndex % PHRASE.length];
      const octave = this.noteIndex % 8 === 4 ? 2 : 1;
      this.pluck(SCALE[index] * octave, this.nextNoteAt, this.noteIndex % 5 === 0 ? 0.058 : 0.038);
      this.noteIndex += 1;
      this.nextNoteAt += this.noteIndex % 4 === 0 ? 0.92 : 0.58;
    }
  }

  pluck(frequency, startAt, volume) {
    const oscillator = this.context.createOscillator();
    const overtone = this.context.createOscillator();
    const tone = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    oscillator.type = "triangle";
    overtone.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    overtone.frequency.setValueAtTime(frequency * 2.01, startAt);
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(Math.min(4200, frequency * 8), startAt);
    tone.frequency.exponentialRampToValueAtTime(Math.max(650, frequency * 2.4), startAt + 0.42);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(volume, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.65);
    oscillator.connect(tone);
    overtone.connect(tone);
    tone.connect(envelope).connect(this.master);
    oscillator.start(startAt);
    overtone.start(startAt);
    oscillator.stop(startAt + 1.7);
    overtone.stop(startAt + 1.7);
  }

  async pause() {
    if (!this.playing) return false;
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.0001, now, 0.18);
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    if (this.context.state !== "closed") await this.context.suspend();
    return false;
  }

  async toggle() {
    return this.playing ? this.pause() : this.play();
  }

  async dispose() {
    this.playing = false;
    window.clearInterval(this.timer);
    try { this.noiseSource?.stop(); } catch { /* already stopped */ }
    this.drones.forEach(({ oscillator }) => { try { oscillator.stop(); } catch { /* stopped */ } });
    if (this.context.state !== "closed") await this.context.close();
  }
}
