import { KESTREL_420, type SnowcatSpec } from '../vehicles/snowcat';

/**
 * Machines that can be bought, and the upgrades each one takes. Every upgrade changes the
 * machine's simulated specification; none is cosmetic.
 */

export interface UpgradeDef {
  readonly id: string;
  readonly name: string;
  /** What one level does, for the shop. */
  readonly summary: string;
  /** Price of each level as a fraction of the machine's price. */
  readonly costFractions: readonly number[];
  apply(spec: Mutable<SnowcatSpec>, level: number): void;
}

export interface MachineModel {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly description: string;
  /** Size relative to the Kestrel 420, used for the model and the geometry in `spec`. */
  readonly scale: number;
  readonly spec: SnowcatSpec;
  readonly upgrades: readonly string[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const UPGRADES: Record<string, UpgradeDef> = {
  engine: {
    id: 'engine',
    name: 'Engine remap',
    summary: '+12% engine power and +5% top speed per level',
    costFractions: [0.06, 0.1, 0.16],
    apply(spec, level) {
      spec.enginePowerW *= 1 + 0.12 * level;
      spec.maxForwardMs *= 1 + 0.05 * level;
    },
  },
  tracks: {
    id: 'tracks',
    name: 'Wide-grouser tracks',
    summary: '+10% grip and less sinkage in loose snow per level',
    costFractions: [0.05, 0.09],
    apply(spec, level) {
      spec.gripFactor += 0.1 * level;
      spec.trackWidthM += 0.12 * level;
      // Wider tracks spread the load, so the snow is pressed less and the machine sinks less.
      spec.trackCompactionDensity -= 18 * level;
    },
  },
  tiller: {
    id: 'tiller',
    name: 'Tiller extension',
    summary: '+50 cm working width per level',
    costFractions: [0.06, 0.1],
    apply(spec, level) {
      spec.tillerHalfWidthM += 0.25 * level;
      spec.tillerPowerW *= 1 + 0.08 * level;
    },
  },
  blade: {
    id: 'blade',
    name: 'Blade wings',
    summary: '+50 cm blade width and +30% carrying capacity per level',
    costFractions: [0.04, 0.07],
    apply(spec, level) {
      spec.bladeHalfWidthM += 0.25 * level;
      spec.bladeCapacityKg *= 1 + 0.3 * level;
    },
  },
  hydraulics: {
    id: 'hydraulics',
    name: 'High-flow hydraulics',
    summary: 'Blade and tiller move 40% faster per level',
    costFractions: [0.03, 0.05],
    apply(spec, level) {
      spec.bladeRateMs *= 1 + 0.4 * level;
      spec.tillerRate *= 1 + 0.4 * level;
    },
  },
  finisher: {
    id: 'finisher',
    name: 'Finisher comb',
    summary: 'Full-quality corduroy at +0.5 m/s (1.8 km/h) more speed per level',
    costFractions: [0.04, 0.07],
    apply(spec, level) {
      spec.cleanSpeedMs += 0.5 * level;
    },
  },
  cruise: {
    id: 'cruise',
    name: 'Cruise control',
    summary: 'V holds the current speed so you can steer without the throttle; S cancels',
    costFractions: [0.025],
    apply(spec) {
      spec.cruiseControl = true;
    },
  },
};

const GROOMER_UPGRADES = ['engine', 'tracks', 'tiller', 'blade', 'hydraulics', 'finisher', 'cruise'];

/** Geometry of the Kestrel 420 scaled to another machine size. */
function scaledGeometry(scale: number) {
  const base = KESTREL_420;
  return {
    trackOffsetM: base.trackOffsetM * scale,
    trackWidthM: base.trackWidthM * scale,
    contactZ: base.contactZ.map((z) => z * scale),
    trackBottomM: base.trackBottomM * scale,
    bladeZ: base.bladeZ * scale,
    tillerZ: base.tillerZ * scale,
    bodyWidthM: base.bodyWidthM * scale,
    bodyHeightM: base.bodyHeightM * scale,
    bodyLengthM: base.bodyLengthM * scale,
  };
}

export const MACHINE_MODELS: readonly MachineModel[] = [
  {
    id: 'kestrel-260',
    name: 'Kestrel 260',
    price: 14_000,
    description: 'Compact groomer. Light and cheap to run; narrow tiller and a modest engine.',
    scale: 0.86,
    spec: {
      ...KESTREL_420,
      ...scaledGeometry(0.86),
      name: 'Kestrel 260',
      massKg: 6400,
      enginePowerW: 175_000,
      maxForwardMs: 5.2,
      maxReverseMs: 2.8,
      trackCompactionDensity: 280,
      bladeHalfWidthM: 2.0,
      bladeCapacityKg: 1500,
      tillerHalfWidthM: 2.1,
      tillerPowerW: 45_000,
      bladeRateMs: 0.38,
      tillerRate: 1.1,
      cleanSpeedMs: 3.6,
    },
    upgrades: GROOMER_UPGRADES,
  },
  {
    id: 'kestrel-420',
    name: 'Kestrel 420',
    price: 38_000,
    description:
      'Full-size piste groomer. The workhorse: wide tiller, strong blade, climbs groomed 25° slopes.',
    scale: 1,
    spec: KESTREL_420,
    upgrades: GROOMER_UPGRADES,
  },
  {
    id: 'kestrel-600w',
    name: 'Kestrel 600W',
    price: 92_000,
    description:
      'Heavy winch groomer. Widest tiller and blade, and a 45 kN winch for slopes too steep to climb.',
    scale: 1.1,
    spec: {
      ...KESTREL_420,
      ...scaledGeometry(1.1),
      name: 'Kestrel 600W',
      massKg: 12_600,
      enginePowerW: 390_000,
      maxForwardMs: 6.4,
      maxReverseMs: 3.4,
      trackCompactionDensity: 290,
      bladeHalfWidthM: 3.0,
      bladeCapacityKg: 3400,
      tillerHalfWidthM: 3.1,
      tillerPowerW: 95_000,
      bladeRateMs: 0.5,
      tillerRate: 1.4,
      cleanSpeedMs: 4.4,
      winchPullN: 45_000,
      winchCableM: 1050,
    },
    upgrades: GROOMER_UPGRADES,
  },
];

export function machineModel(id: string): MachineModel {
  const model = MACHINE_MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`no machine model "${id}"`);
  return model;
}

/** Price of the next level of an upgrade, or null when it is fully upgraded or not offered. */
export function upgradePrice(model: MachineModel, upgradeId: string, currentLevel: number): number | null {
  if (!model.upgrades.includes(upgradeId)) return null;
  const fraction = UPGRADES[upgradeId]?.costFractions[currentLevel];
  return fraction === undefined ? null : Math.round((model.price * fraction) / 10) * 10;
}

/** The machine's specification with its upgrades applied. */
export function effectiveSpec(model: MachineModel, levels: Readonly<Record<string, number>>): SnowcatSpec {
  const spec: Mutable<SnowcatSpec> = { ...model.spec, contactZ: [...model.spec.contactZ] };
  for (const id of model.upgrades) {
    const level = levels[id] ?? 0;
    if (level > 0) UPGRADES[id]!.apply(spec, level);
  }
  return spec;
}
