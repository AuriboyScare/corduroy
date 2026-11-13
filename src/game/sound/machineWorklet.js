// AudioWorklet: synthesizes a tracked groomer from its simulated state, one sample at a time.
// Outputs (mono each): 0 engine, 1 tracks, 2 tiller and blade, 3 hydraulics, winch and alarm.
// Plain JavaScript because it is loaded as-is into the audio thread.

const TWO_PI = Math.PI * 2;

class Rng {
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    // xorshift32, returns [-1, 1)
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 2147483648 - 1;
  }
}

/** RBJ band-pass (constant peak gain), coefficients updated per block. */
class BandPass {
  constructor() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(1000, 1, 48000);
  }
  set(freq, q, sr) {
    const w = (TWO_PI * Math.min(freq, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class OnePole {
  constructor() {
    this.y = 0;
    this.k = 0.1;
  }
  set(freq, sr) {
    this.k = 1 - Math.exp((-TWO_PI * freq) / sr);
  }
  run(x) {
    this.y += this.k * (x - this.y);
    return this.y;
  }
}

const PARAMS = [
  'rpm',
  'load',
  'beltLeft',
  'beltRight',
  'hardness',
  'tiller',
  'speed',
  'cut',
  'bladeLoad',
  'hydraulics',
  'winchReel',
  'winchTension',
  'reverse',
];

class MachineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMS.map((name) => ({ name, defaultValue: name === 'rpm' ? 850 : 0, automationRate: 'k-rate' }));
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.rng = new Rng(0x9e3779b9);
    // Engine: six cylinders, each a little different, firing in turn.
    this.firePhase = 0;
    this.cylinder = 0;
    this.cylinderGain = [1, 0.93, 1.06, 0.97, 1.03, 0.9];
    this.jitter = 0;
    this.burst = 0;
    this.burstDecay = 0;
    this.thump = 0;
    this.thumpPhase = 0;
    this.combustion = new OnePole();
    this.exhaustDelay = new Float32Array(Math.ceil(sr * 0.02));
    this.exhaustIndex = 0;
    this.exhaustLength = Math.round(sr * 0.0105);
    this.exhaustTone = new OnePole();
    this.body = new BandPass();
    this.rattle = new BandPass();
    this.boost = 0;
    this.turboPhase = 0;
    // Tracks: one cleat phase per side.
    this.cleatPhase = [0, 0.37];
    this.click = [0, 0];
    this.clickFreq = [900, 1100];
    this.clickPhase = [0, 0];
    this.crunch = [0, 0];
    this.crunchFilter = [new BandPass(), new BandPass()];
    this.rumble = new OnePole();
    // Tiller and blade.
    this.tillerFilter = new BandPass();
    this.tillerPhase = 0;
    this.motorPhase = 0;
    this.bladeLow = new OnePole();
    this.bladeMid = new BandPass();
    this.whump = 0;
    this.whumpFilter = new OnePole();
    // Hydraulics, winch, reverse alarm.
    this.pumpPhase = 0;
    this.winchPhase = 0;
    this.creak = 0;
    this.creakFilter = new BandPass();
    this.alarmTime = 0;
    this.alarmPhase = 0;
  }

  process(_inputs, outputs, parameters) {
    const sr = sampleRate;
    const p = {};
    for (const name of PARAMS) p[name] = parameters[name][0];
    const rng = this.rng;
    const rpm = Math.max(500, p.rpm);
    const load = Math.min(1.2, Math.max(0, p.load));
    const rpmNorm = (rpm - 850) / 1250;
    const engine = outputs[0][0];
    const tracks = outputs[1][0];
    const tool = outputs[2][0];
    const hyd = outputs[3][0];
    const n = engine.length;

    // Per-block filter settings.
    this.combustion.set(900 + 2600 * load + 600 * rpmNorm, sr);
    this.exhaustTone.set(420 + 1500 * load + 400 * rpmNorm, sr);
    this.body.set(95 + 40 * rpmNorm, 1.1, sr);
    this.rattle.set(3200, 0.9, sr);
    const hardness = Math.min(1, Math.max(0, p.hardness));
    for (let s = 0; s < 2; s++) this.crunchFilter[s].set(1400 + 2600 * hardness, 1.4 + 2 * hardness, sr);
    this.rumble.set(90, sr);
    this.tillerFilter.set(2300 + 600 * Math.min(1, p.speed / 4), 0.8, sr);
    this.bladeLow.set(260, sr);
    this.bladeMid.set(850, 0.9, sr);
    this.whumpFilter.set(140, sr);
    this.creakFilter.set(2900, 6, sr);
    // Shorter, sharper combustion pulses under load: the diesel knock.
    const burstTau = (0.0055 - 0.0028 * Math.min(1, load)) * sr;
    const burstDecay = Math.exp(-1 / burstTau);
    const thumpDecay = Math.exp(-1 / (0.011 * sr));
    const thumpFreq = 62 + 0.025 * rpm;
    const firingHz = rpm / 20;
    const clickDecay = Math.exp(-1 / (0.013 * sr));
    const crunchDecay = Math.exp(-1 / ((0.03 + 0.02 * (1 - hardness)) * sr));
    const whumpDecay = Math.exp(-1 / (0.12 * sr));

    for (let i = 0; i < n; i++) {
      // Engine.
      this.firePhase += (firingHz * (1 + this.jitter)) / sr;
      if (this.firePhase >= 1) {
        this.firePhase -= 1;
        this.cylinder = (this.cylinder + 1) % 6;
        this.jitter = rng.next() * 0.018;
        const strength =
          (0.45 + 0.55 * Math.min(1, load)) * this.cylinderGain[this.cylinder] * (1 + 0.07 * rng.next());
        this.burst = strength;
        this.thump = strength * (0.8 + 0.4 * load);
        this.thumpPhase = 0;
      }
      const noise = rng.next();
      const pulse = this.combustion.run(noise) * this.burst;
      this.burst *= burstDecay;
      this.thumpPhase += thumpFreq / sr;
      const thump = Math.sin(TWO_PI * this.thumpPhase) * this.thump;
      this.thump *= thumpDecay;
      // Exhaust: the pipe's round trip feeds back, giving the note its body.
      const raw = pulse * 1.6 + thump;
      const delayed =
        this.exhaustDelay[
          (this.exhaustIndex - this.exhaustLength + this.exhaustDelay.length) % this.exhaustDelay.length
        ];
      const piped = raw + 0.5 * delayed;
      this.exhaustDelay[this.exhaustIndex] = piped;
      this.exhaustIndex = (this.exhaustIndex + 1) % this.exhaustDelay.length;
      const tone = this.exhaustTone.run(piped);
      const resonance = this.body.run(piped) * 1.4;
      const valve =
        this.rattle.run(rng.next()) *
        (0.012 + 0.02 * rpmNorm) *
        (0.5 + 0.5 * Math.sin(TWO_PI * this.firePhase));
      this.boost += (Math.min(1, load) * Math.max(0, rpmNorm + 0.2) - this.boost) * 0.00004;
      this.turboPhase += (1600 + 4200 * this.boost) / sr;
      const turbo = Math.sin(TWO_PI * this.turboPhase) * 0.012 * this.boost;
      engine[i] = Math.tanh((tone * 0.9 + resonance + valve + turbo) * 1.3) * 0.5;

      // Tracks: a clank as each cleat meets the snow, and a crunch shaped by how hard it is.
      let trackOut = 0;
      const belts = [p.beltLeft, p.beltRight];
      for (let s = 0; s < 2; s++) {
        const speed = Math.abs(belts[s]);
        this.cleatPhase[s] += speed / 0.16 / sr;
        if (this.cleatPhase[s] >= 1) {
          this.cleatPhase[s] -= 1;
          this.click[s] = (0.4 + 0.3 * rng.next()) * Math.min(1, 0.3 + speed / 4);
          this.clickFreq[s] = 760 + 520 * Math.abs(rng.next());
          this.clickPhase[s] = 0;
          this.crunch[s] = (0.5 + 0.3 * rng.next()) * (0.4 + 0.8 * hardness);
        }
        this.clickPhase[s] += this.clickFreq[s] / sr;
        trackOut += Math.sin(TWO_PI * this.clickPhase[s]) * this.click[s] * 0.35;
        this.click[s] *= clickDecay;
        trackOut += this.crunchFilter[s].run(rng.next()) * this.crunch[s] * 0.8;
        this.crunch[s] *= crunchDecay;
      }
      const meanBelt = (Math.abs(p.beltLeft) + Math.abs(p.beltRight)) / 2;
      trackOut += this.rumble.run(rng.next()) * Math.min(1, meanBelt / 5) * 2.2;
      tracks[i] = trackOut;

      // Tiller: a fluttering hiss of milled snow over the hydraulic drive's whine.
      this.tillerPhase += 92 / sr;
      const flutter = 0.65 + 0.35 * Math.sin(TWO_PI * this.tillerPhase);
      const working = p.tiller * (0.35 + 0.65 * Math.min(1, p.speed / 3));
      this.motorPhase += (380 + 0.06 * rpm) / sr;
      let toolOut = this.tillerFilter.run(rng.next()) * working * flutter * 0.9;
      toolOut +=
        (Math.sin(TWO_PI * this.motorPhase) + 0.3 * Math.sin(2 * TWO_PI * this.motorPhase)) *
        p.tiller *
        0.025;
      // Blade: roar of snow being cut and rolled, with heavy whumps when it is full.
      const cut = Math.min(1, p.cut);
      toolOut += (this.bladeLow.run(rng.next()) * 2.5 + this.bladeMid.run(rng.next()) * 0.5) * cut;
      if (p.bladeLoad > 0.3 && rng.next() > 1 - 0.00012 * p.bladeLoad * Math.max(0.2, p.speed))
        this.whump = 0.6 * p.bladeLoad;
      toolOut += this.whumpFilter.run(rng.next()) * this.whump * 3;
      this.whump *= whumpDecay;
      tool[i] = toolOut;

      // Hydraulic pump (driven by the engine), winch and the reversing alarm.
      this.pumpPhase += ((rpm / 60) * 9) / sr;
      const pumpLevel = 0.006 + 0.03 * Math.min(1, p.hydraulics);
      let hydOut =
        (Math.sin(TWO_PI * this.pumpPhase) * 0.6 +
          Math.sin(2 * TWO_PI * this.pumpPhase) * 0.3 +
          Math.sin(3 * TWO_PI * this.pumpPhase) * 0.15) *
        pumpLevel;
      const reel = Math.min(1, Math.abs(p.winchReel));
      this.winchPhase += (190 + 820 * reel) / sr;
      hydOut += Math.sin(TWO_PI * this.winchPhase) * 0.035 * reel;
      if (p.winchTension > 0.4 && rng.next() > 1 - 0.00004 * p.winchTension) this.creak = 0.5;
      hydOut += this.creakFilter.run(rng.next()) * this.creak;
      this.creak *= 0.9993;
      if (p.reverse > 0.5) {
        this.alarmTime += 1 / sr;
        this.alarmPhase += 1050 / sr;
        if (this.alarmTime % 1 < 0.5) hydOut += this.alarmPhase % 1 < 0.5 ? 0.09 : -0.09;
      } else {
        this.alarmTime = 0;
      }
      hyd[i] = hydOut;
    }
    return true;
  }
}

registerProcessor('corduroy-machine', MachineProcessor);
