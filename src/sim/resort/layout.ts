/**
 * The prototype resort's runs and lift lines, in map metres (x east, z south; the summit is
 * at small z, the valley floor at large z). Control points run from the top of each run down.
 */

export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  beginner: 'Beginner',
  easy: 'Easy',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export interface RunPlan {
  readonly id: string;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly halfWidthM: number;
  /** Steepest grade the run is shaped to along its centreline. */
  readonly maxGradeDeg: number;
  readonly control: readonly (readonly [number, number])[];
}

export type LiftKind = 'ropeTow' | 'chair' | 'gondola' | 'tram';

export interface LiftPlan {
  readonly id: string;
  readonly name: string;
  readonly kind: LiftKind;
  readonly bottom: readonly [number, number];
  readonly top: readonly [number, number];
  /** Runs riders of this lift ski down; their grooming decides how busy the lift is. */
  readonly serves: readonly string[];
}

export const RUN_PLANS: readonly RunPlan[] = [
  {
    id: 'nursery',
    name: 'Nursery',
    difficulty: 'beginner',
    halfWidthM: 22,
    maxGradeDeg: 9,
    control: [
      [815, 1680],
      [850, 1780],
      [880, 1850],
    ],
  },
  {
    id: 'long-meadow',
    name: 'Long Meadow',
    difficulty: 'easy',
    halfWidthM: 20,
    maxGradeDeg: 16,
    control: [
      [880, 470],
      [640, 560],
      [420, 720],
      [300, 950],
      [330, 1180],
      [450, 1380],
      [560, 1560],
      [640, 1720],
      [800, 1830],
      [900, 1870],
    ],
  },
  {
    id: 'kestrel',
    name: 'Kestrel',
    difficulty: 'intermediate',
    halfWidthM: 21,
    maxGradeDeg: 20,
    control: [
      [1024, 470],
      [1010, 600],
      [905, 800],
      [1000, 1040],
      [930, 1290],
      [1000, 1540],
      [1010, 1760],
      [1024, 1850],
    ],
  },
  {
    id: 'falcon-face',
    name: 'Falcon Face',
    difficulty: 'advanced',
    halfWidthM: 17,
    maxGradeDeg: 31,
    control: [
      [1490, 580],
      [1430, 720],
      [1360, 900],
      [1330, 1150],
      [1330, 1400],
      [1290, 1620],
      [1230, 1790],
      [1200, 1860],
    ],
  },
];

export const LIFT_PLANS: readonly LiftPlan[] = [
  {
    id: 'nursery-tow',
    name: 'Nursery Tow',
    kind: 'ropeTow',
    bottom: [840, 1850],
    top: [775, 1690],
    serves: ['nursery'],
  },
  {
    id: 'meadow-quad',
    name: 'Meadow Quad',
    kind: 'chair',
    bottom: [930, 1840],
    top: [400, 1080],
    serves: ['long-meadow'],
  },
  {
    id: 'summit-gondola',
    name: 'Summit Gondola',
    kind: 'gondola',
    bottom: [1100, 1850],
    top: [1090, 540],
    serves: ['kestrel', 'long-meadow'],
  },
  {
    id: 'ridge-tram',
    name: 'Ridge Tram',
    kind: 'tram',
    bottom: [1300, 1870],
    top: [1530, 560],
    serves: ['falcon-face'],
  },
];

/** Half width of the cleared corridor under each kind of lift, m. */
export const LIFT_CORRIDOR_HALF_WIDTH_M: Record<LiftKind, number> = {
  ropeTow: 6,
  chair: 10,
  gondola: 11,
  tram: 14,
};

/** The base area: a levelled rectangle with rounded corners, where machines are parked. */
export const BASE_AREA = { x: 1070, z: 1895, halfX: 300, halfZ: 55, blendM: 40 } as const;

/** Where the machine garage stands; machines park facing uphill. */
export const GARAGE = { x: 1024, z: 1905, heading: Math.PI } as const;

/** Target length of a run section; each run is split into whole sections near this length. */
export const SECTION_LENGTH_M = 150;

export interface WinchAnchorPlan {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

/** Winch anchors: steel posts set beside the steep runs for winch groomers to hook onto. */
export const WINCH_ANCHOR_PLANS: readonly WinchAnchorPlan[] = [
  { id: 'falcon-top', name: 'Falcon Face top', x: 1518, z: 600 },
  { id: 'falcon-mid', name: 'Falcon Face mid', x: 1372, z: 1165 },
  { id: 'kestrel-top', name: 'Kestrel top', x: 1052, z: 470 },
];
