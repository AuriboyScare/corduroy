import type { Snowcat, SnowcatInput } from '../sim/vehicles/snowcat';

/**
 * Machine sound synthesized from simulation state: diesel engine, track clatter, tiller and
 * hydraulics. Browsers only allow audio after a key press or click, so it starts on the first one.
 */
export class MachineAudio {
  muted = false;
  private context: AudioContext | null = null;
  private master!: GainNode;
  private engineA!: OscillatorNode;
  private engineB!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private clatterRate!: OscillatorNode;
  private clatterGain!: GainNode;
  private tillerGain!: GainNode;
  private tillerTone!: OscillatorNode;
  private hydraulicGain!: GainNode;
  private rpm = 850;

  constructor() {
    const start = (): void => {
      if (!this.context) this.build();
      void this.context?.resume();
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  /** Engine speed shown on the HUD, rev/min. */
  get engineRpm(): number {
    return this.rpm;
  }

  private build(): void {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Engine: firing-frequency sawtooth plus a half-order rumble, shaped and low-passed.
    this.engineA = ctx.createOscillator();
    this.engineA.type = 'sawtooth';
    this.engineB = ctx.createOscillator();
    this.engineB.type = 'square';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 2.2);
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;
    this.engineA.connect(shaper);
    this.engineB.connect(subGain).connect(shaper);
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.master);

    // Shared noise source for tracks, tiller and exhaust breath.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = (seed / 2147483648) * 0.9;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // Track clatter: band-passed noise gated at the rate cleats meet the snow.
    const clatterFilter = ctx.createBiquadFilter();
    clatterFilter.type = 'bandpass';
    clatterFilter.frequency.value = 900;
    clatterFilter.Q.value = 0.7;
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    this.clatterRate = ctx.createOscillator();
    this.clatterRate.type = 'square';
    const gateDepth = ctx.createGain();
    gateDepth.gain.value = 0.5;
    this.clatterRate.connect(gateDepth).connect(gate.gain);
    this.clatterGain = ctx.createGain();
    this.clatterGain.gain.value = 0;
    noise.connect(clatterFilter).connect(gate).connect(this.clatterGain).connect(this.master);

    // Tiller: the hiss of milled snow over the whine of the drum drive.
    const tillerFilter = ctx.createBiquadFilter();
    tillerFilter.type = 'bandpass';
    tillerFilter.frequency.value = 2400;
    tillerFilter.Q.value = 0.5;
    this.tillerGain = ctx.createGain();
    this.tillerGain.gain.value = 0;
    this.tillerTone = ctx.createOscillator();
    this.tillerTone.type = 'triangle';
    this.tillerTone.frequency.value = 310;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.18;
    noise.connect(tillerFilter).connect(this.tillerGain);
    this.tillerTone.connect(toneGain).connect(this.tillerGain);
    this.tillerGain.connect(this.master);

    // Hydraulics: a thin pump whine while an implement is moving.
    const pump = ctx.createOscillator();
    pump.type = 'sawtooth';
    pump.frequency.value = 520;
    const pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = 'bandpass';
    pumpFilter.frequency.value = 1100;
    this.hydraulicGain = ctx.createGain();
    this.hydraulicGain.gain.value = 0;
    pump.connect(pumpFilter).connect(this.hydraulicGain).connect(this.master);

    for (const source of [this.engineA, this.engineB, this.clatterRate, this.tillerTone, pump, noise])
      source.start();
  }

  update(dt: number, cat: Snowcat, input: SnowcatInput): void {
    // The governor raises revs with demand: throttle, track load and the tiller drive.
    const demand = Math.max(
      Math.abs(input.throttle) * 0.55,
      Math.min(1.1, cat.engineLoad),
      cat.tillerWorking ? 0.6 : 0,
    );
    const targetRpm = 850 + 1250 * Math.min(1, demand);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 2.5);
    const ctx = this.context;
    if (!ctx) return;
    const t = ctx.currentTime;
    const smooth = 0.06;
    const firing = (this.rpm / 60) * 3;
    this.engineA.frequency.setTargetAtTime(firing, t, smooth);
    this.engineB.frequency.setTargetAtTime(firing / 2, t, smooth);
    const load = Math.min(1, cat.engineLoad);
    this.engineFilter.frequency.setTargetAtTime(260 + 500 * load + (this.rpm - 850) * 0.35, t, smooth);
    this.engineGain.gain.setTargetAtTime(0.16 + 0.2 * load, t, smooth);

    const beltSpeed = (Math.abs(cat.trackSpeed[0]!) + Math.abs(cat.trackSpeed[1]!)) / 2;
    this.clatterRate.frequency.setTargetAtTime(Math.max(1, beltSpeed / 0.16), t, smooth);
    this.clatterGain.gain.setTargetAtTime(
      cat.groundedContacts > 0 ? Math.min(0.22, beltSpeed * 0.045) : 0,
      t,
      smooth,
    );

    this.tillerGain.gain.setTargetAtTime(
      cat.tillerWorking ? 0.1 + 0.08 * Math.min(1, Math.abs(cat.forwardSpeed) / 3) : 0,
      t,
      0.15,
    );
    this.tillerTone.frequency.setTargetAtTime(240 + this.rpm * 0.05, t, smooth);

    const tillerMoving = cat.tillerPos > 0.02 && cat.tillerPos < 0.98;
    this.hydraulicGain.gain.setTargetAtTime(input.bladeLift !== 0 || tillerMoving ? 0.035 : 0, t, 0.04);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, t, 0.1);
  }
}
