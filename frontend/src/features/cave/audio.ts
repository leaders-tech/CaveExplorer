/*
This file makes every sound in code with the Web Audio API: cave drone, water drips, footsteps,
the monster's breathing (3D positioned), heartbeat, tape static, and scare sounds. No audio files are used.
Edit this file to change or add sounds. Copy a small method like dripSound to make a new sound effect.
*/

import type { Vec3 } from "./caveLayout";

export class CaveAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private creatureGain!: GainNode;
  private creaturePanner!: PannerNode;
  private growlGain!: GainNode;
  private heartTimer = 0;
  private dripTimer = 1;
  private moanTimer = 20;
  private clickTimer = 0;
  private fear = 0;
  private creatureActive = false;
  private hunting = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.9;
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.master);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startDrone();
    this.startCreatureVoice();
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    return buffer;
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  private send(node: AudioNode, dry: number, wet: number): void {
    const ctx = this.ctx!;
    const dryGain = ctx.createGain();
    dryGain.gain.value = dry;
    node.connect(dryGain).connect(this.master);
    const wetGain = ctx.createGain();
    wetGain.gain.value = wet;
    node.connect(wetGain).connect(this.reverbIn);
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 120;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0.07;
    for (const freq of [41, 41.7, 61.3]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 50;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(gain);
    this.send(gain, 0.8, 0.6);

    // Wind breathing through the tunnels.
    const wind = this.noiseSource(true);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 320;
    band.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.02;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.018;
    windLfo.connect(windLfoGain).connect(windGain.gain);
    windLfo.start();
    wind.connect(band).connect(windGain);
    wind.start();
    this.send(windGain, 0.5, 1);
  }

  private startCreatureVoice(): void {
    const ctx = this.ctx!;
    this.creaturePanner = ctx.createPanner();
    this.creaturePanner.panningModel = "HRTF";
    this.creaturePanner.distanceModel = "inverse";
    this.creaturePanner.refDistance = 2;
    this.creaturePanner.rolloffFactor = 1.3;
    this.creatureGain = ctx.createGain();
    this.creatureGain.gain.value = 0;
    this.creatureGain.connect(this.creaturePanner);
    this.send(this.creaturePanner, 1, 0.5);

    // Wet, slow breathing.
    const breath = this.noiseSource(true);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 650;
    band.Q.value = 2.5;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.33;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain).connect(breathGain.gain);
    lfo.start();
    breath.connect(band).connect(breathGain).connect(this.creatureGain);
    breath.start();

    // Low growl, only loud while hunting.
    const growl = ctx.createOscillator();
    growl.type = "sawtooth";
    growl.frequency.value = 52;
    const growlFilter = ctx.createBiquadFilter();
    growlFilter.type = "lowpass";
    growlFilter.frequency.value = 260;
    this.growlGain = ctx.createGain();
    this.growlGain.gain.value = 0;
    const growlLfo = ctx.createOscillator();
    growlLfo.frequency.value = 7;
    const growlLfoGain = ctx.createGain();
    growlLfoGain.gain.value = 6;
    growlLfo.connect(growlLfoGain).connect(growl.frequency);
    growlLfo.start();
    growl.connect(growlFilter).connect(this.growlGain).connect(this.creatureGain);
    growl.start();
  }

  setListener(pos: Vec3, forward: Vec3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setCreature(pos: Vec3, active: boolean, hunting: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.creatureActive = active;
    this.hunting = hunting;
    this.creaturePanner.positionX.setTargetAtTime(pos.x, t, 0.03);
    this.creaturePanner.positionY.setTargetAtTime(pos.y, t, 0.03);
    this.creaturePanner.positionZ.setTargetAtTime(pos.z, t, 0.03);
    this.creatureGain.gain.setTargetAtTime(active ? 1 : 0, t, 0.4);
    this.growlGain.gain.setTargetAtTime(hunting ? 0.22 : 0, t, 0.3);
  }

  setFear(value: number): void {
    this.fear = value;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.dripTimer -= dt;
    if (this.dripTimer <= 0) {
      this.dripSound();
      this.dripTimer = 0.6 + Math.random() * 3;
    }
    this.moanTimer -= dt;
    if (this.moanTimer <= 0) {
      this.distantMoan();
      this.moanTimer = 25 + Math.random() * 40;
    }
    if (this.fear > 0.08) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartbeat(Math.min(1, this.fear));
        this.heartTimer = 1.15 - this.fear * 0.7;
      }
    }
    if (this.creatureActive) {
      this.clickTimer -= dt;
      if (this.clickTimer <= 0) {
        this.creatureClicks();
        this.clickTimer = this.hunting ? 0.4 + Math.random() * 0.8 : 2 + Math.random() * 4;
      }
    }
  }

  private envelope(gain: GainNode, peak: number, attack: number, release: number): number {
    const t = this.ctx!.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return t + attack + release + 0.05;
  }

  dripSound(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const f0 = 900 + Math.random() * 1600;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.06);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    osc.connect(gain).connect(pan);
    this.send(pan, 0.3, 0.8);
    osc.start();
    osc.stop(this.envelope(gain, 0.06 + Math.random() * 0.06, 0.003, 0.1));
  }

  private distantMoan(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(520, t);
    filter.frequency.linearRampToValueAtTime(330, t + 3.5);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    for (const detune of [0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(95 + detune, t);
      osc.frequency.linearRampToValueAtTime(68 + detune, t + 3.5);
      osc.connect(filter);
      osc.start();
      osc.stop(t + 4.2);
    }
    filter.connect(gain).connect(pan);
    this.send(pan, 0.1, 1);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 1.2);
    gain.gain.linearRampToValueAtTime(0, t + 4);
  }

  private heartbeat(strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const delay of [0, 0.28]) {
      const osc = ctx.createOscillator();
      const t = ctx.currentTime + delay;
      osc.frequency.setValueAtTime(62, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35 * strength * (delay ? 0.7 : 1), t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.25);
    }
  }

  private creatureClicks(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const count = 2 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * (0.04 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1400 + Math.random() * 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      osc.connect(gain).connect(this.creatureGain);
      osc.start(t);
      osc.stop(t + 0.03);
    }
  }

  footstep(water: boolean, loudness: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = water ? "bandpass" : "lowpass";
    filter.frequency.value = water ? 900 + Math.random() * 600 : 380 + Math.random() * 380;
    filter.Q.value = water ? 1.5 : 0.7;
    const gain = ctx.createGain();
    src.connect(filter).connect(gain);
    this.send(gain, 0.9, 0.4);
    src.start(0, Math.random());
    src.stop(this.envelope(gain, (water ? 0.22 : 0.18) * loudness, 0.005, water ? 0.25 : 0.09));
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 2200;
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(this.envelope(gain, 0.05, 0.001, 0.015));
  }

  tapeStatic(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.click();
    const src = this.noiseSource(true);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2500;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.1);
    gain.gain.setValueAtTime(0.035, t + seconds);
    gain.gain.linearRampToValueAtTime(0, t + seconds + 0.4);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    src.stop(t + seconds + 0.5);
  }

  batteryPickup(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const t = ctx.currentTime + i * 0.09;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.06, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      this.send(gain, 0.8, 0.3);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  stinger(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16 * volume, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    for (const freq of [207, 220, 311, 329.6, 415]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * 0.94, t + 2.5);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 3);
    }
    this.send(gain, 0.7, 0.9);
  }

  scream(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.02);
    gain.gain.linearRampToValueAtTime(0.35, t + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    for (const base of [380, 397, 760]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 3.2, t + 0.25);
      osc.frequency.exponentialRampToValueAtTime(base * 0.7, t + 1.8);
      osc.connect(shaper);
      osc.start(t);
      osc.stop(t + 2);
    }
    const src = this.noiseSource();
    src.connect(shaper);
    src.start(t);
    src.stop(t + 2);
    shaper.connect(gain);
    this.send(gain, 1, 0.6);
  }
}
