import type { Camera } from 'three/webgpu';
import { Vector3 } from 'three/webgpu';
import type { Snowcat, SnowcatInput } from '../../sim/vehicles/snowcat';

/** What the sound needs from the scene each frame, beyond the machine itself. */
export interface ListenerState {
  camera: Camera;
  /** The camera sits in the driver's seat: sound is heard through the cab. */
  inCab: boolean;
  /** 0 for fresh powder under the tracks, 1 for hard pack and ice. */
  snowHardness: number;
  altitudeM: number;
}

const forward = new Vector3();
const up = new Vector3();

/** A second of decaying stereo noise: a cheap outdoor reverb tail. */
function reverbImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 1.6);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 7;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const t = i / ctx.sampleRate;
      // A slap from the treeline at 80 ms, then a diffuse tail.
      const slap = t > 0.08 && t < 0.095 ? 0.5 : 0;
      data[i] = ((seed / 2147483648) * Math.exp(-t * 4.2) + slap * (seed / 2147483648)) * 0.6;
    }
  }
  return buffer;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    brown = brown * 0.985 + (seed / 2147483648) * 0.15;
    data[i] = brown;
  }
  return buffer;
}

/**
 * Sound for the machine being driven, synthesized on the audio thread from simulation state,
 * placed in 3D around the camera, and muffled when heard from inside the cab. Browsers only allow
 * audio after a key press or click, so it starts on the first one.
 */
export class MachineAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private outside!: GainNode;
  private cab!: GainNode;
  private panner!: PannerNode;
  private master!: GainNode;
  private reverbSend!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rpm = 850;
  private gust = 0;
  private gustTarget = 0;
  private lastCable = 0;

  constructor() {
    const start = (): void => {
      if (!this.ctx) void this.build();
      void this.ctx?.resume();
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  /** For tests: whether audio is running and the synthesizer is producing sound. */
  get state(): { context: string; synth: boolean } {
    return { context: this.ctx?.state ?? 'not started', synth: this.node !== null };
  }

  /** Engine speed shown on the HUD, rev/min. */
  get engineRpm(): number {
    return this.rpm;
  }

  private async build(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Served as-is from public/: the dev server's module handling breaks worklet registration.
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}sound/machineWorklet.js`);
    const node = new AudioWorkletNode(ctx, 'corduroy-machine', {
      numberOfInputs: 0,
      numberOfOutputs: 4,
      outputChannelCount: [1, 1, 1, 1],
    });

    const mix = ctx.createGain();
    const levels = [0.95, 0.75, 0.7, 0.8];
    levels.forEach((level, k) => {
      const bus = ctx.createGain();
      bus.gain.value = level;
      node.connect(bus, k).connect(mix);
    });

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(compressor).connect(ctx.destination);

    // Outside: placed in 3D at the machine.
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 7,
      rolloffFactor: 0.9,
      maxDistance: 4000,
    });
    this.outside = ctx.createGain();
    mix.connect(this.panner).connect(this.outside).connect(this.master);

    // Inside the cab: the glass and panels take off the top end, and the cab booms a little.
    const cabLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2100, Q: 0.6 });
    const cabBoom = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 140, Q: 1, gain: 5 });
    this.cab = ctx.createGain();
    this.cab.gain.value = 0;
    mix.connect(cabLow).connect(cabBoom).connect(this.cab).connect(this.master);

    const reverb = new ConvolverNode(ctx, { buffer: reverbImpulse(ctx) });
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.12;
    this.panner.connect(this.reverbSend).connect(reverb).connect(this.master);

    // Wind: slow brown noise, band-limited, with gusts.
    const windSource = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 6), loop: true });
    this.windFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 0.45 });
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    windSource.connect(this.windFilter).connect(this.wind).connect(this.master);
    windSource.start();

    this.node = node;
  }

  update(dt: number, cat: Snowcat, input: SnowcatInput, listener: ListenerState): void {
    // The governor raises revs with demand: throttle, track load and the tiller drive.
    const demand = Math.max(
      Math.abs(input.throttle) * 0.55,
      Math.min(1.1, cat.engineLoad),
      cat.tillerWorking ? 0.6 : 0,
    );
    this.rpm += (850 + 1250 * Math.min(1, demand) - this.rpm) * Math.min(1, dt * 2.5);

    const ctx = this.ctx;
    const node = this.node;
    if (!ctx || !node) return;
    const t = ctx.currentTime;
    const set = (name: string, value: number, smoothing = 0.05): void => {
      node.parameters.get(name)?.setTargetAtTime(value, t, smoothing);
    };
    const winchReel = dt > 0 ? (this.lastCable - cat.winchCableOutM) / dt : 0;
    this.lastCable = cat.winchCableOutM;
    set('rpm', this.rpm);
    set('load', cat.engineLoad);
    set('beltLeft', cat.trackSpeed[0]!);
    set('beltRight', cat.trackSpeed[1]!);
    set('hardness', listener.snowHardness, 0.3);
    set('tiller', cat.tillerWorking ? 1 : cat.tillerPos * 0.3, 0.15);
    set('speed', Math.abs(cat.forwardSpeed));
    set('cut', Math.min(1, cat.cutRate / 350), 0.08);
    set('bladeLoad', cat.bladeLoadKg / cat.spec.bladeCapacityKg, 0.2);
    const tillerMoving = cat.tillerPos > 0.02 && cat.tillerPos < 0.98;
    set(
      'hydraulics',
      Math.min(1, Math.abs(input.bladeLift) + (tillerMoving ? 1 : 0) + Math.abs(input.winchAdjust ?? 0)),
      0.04,
    );
    set('winchReel', cat.winchAnchor ? Math.min(1, Math.abs(winchReel) / 2) : 0, 0.1);
    set('winchTension', cat.winchAnchor ? cat.winchForceN / Math.max(1, cat.spec.winchPullN) : 0, 0.2);
    set('reverse', cat.forwardSpeed < -0.15 || input.throttle < -0.1 ? 1 : 0, 0.01);

    // Listener at the camera; the machine's sound comes from its engine bay.
    const camera = listener.camera;
    camera.getWorldDirection(forward);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const l = ctx.listener;
    l.positionX.setTargetAtTime(camera.position.x, t, 0.02);
    l.positionY.setTargetAtTime(camera.position.y, t, 0.02);
    l.positionZ.setTargetAtTime(camera.position.z, t, 0.02);
    l.forwardX.setTargetAtTime(forward.x, t, 0.02);
    l.forwardY.setTargetAtTime(forward.y, t, 0.02);
    l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    l.upX.setTargetAtTime(up.x, t, 0.02);
    l.upY.setTargetAtTime(up.y, t, 0.02);
    l.upZ.setTargetAtTime(up.z, t, 0.02);
    const b = cat.body;
    this.panner.positionX.setTargetAtTime(b.px, t, 0.02);
    this.panner.positionY.setTargetAtTime(b.py + 0.5, t, 0.02);
    this.panner.positionZ.setTargetAtTime(b.pz, t, 0.02);

    this.outside.gain.setTargetAtTime(listener.inCab ? 0 : 1, t, 0.08);
    this.cab.gain.setTargetAtTime(listener.inCab ? 0.85 : 0, t, 0.08);
    this.reverbSend.gain.setTargetAtTime(listener.inCab ? 0 : 0.12, t, 0.1);

    // Gusts come and go every few seconds; the wind is stronger higher up and quieter in the cab.
    if (Math.abs(this.gust - this.gustTarget) < 0.02) this.gustTarget = Math.random();
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.6);
    const exposure = Math.min(1, Math.max(0, (listener.altitudeM - 1450) / 450));
    const windLevel = (0.05 + 0.12 * exposure) * (0.4 + 0.6 * this.gust) * (listener.inCab ? 0.25 : 1);
    this.wind.gain.setTargetAtTime(windLevel, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(320 + 380 * this.gust, t, 0.5);

    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, t, 0.1);
  }
}
