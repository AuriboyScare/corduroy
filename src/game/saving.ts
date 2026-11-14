import { signal } from '@preact/signals';
import { decodeSave, encodeSave, readSummary, SaveFormatError, type SaveSummary } from '../platform/saveFile';
import type { SaveStore } from '../platform/saveStore';
import type { GameMode } from '../sim/career';
import { captureWorld, restoreWorld } from '../sim/save/worldSave';
import type { World } from '../sim/world';

export const AUTOSAVE_INTERVAL_MS = 120_000;

export interface SaveStatus {
  state: 'idle' | 'saving' | 'error' | 'unavailable';
  /** performance.now() of the last successful save. */
  lastSavedAt: number | null;
  message: string | null;
}

export const saveStatus = signal<SaveStatus>({ state: 'idle', lastSavedAt: null, message: null });

/** One save slot per game mode. */
export const slotFor = (mode: GameMode): string => mode;

export interface LoadedGame {
  world: World;
  summary: SaveSummary;
  /** Set when the main save was unreadable and a backup was used instead. */
  recoveredFrom: string | null;
}

async function tryDecode(bytes: Uint8Array): Promise<{ world: World; summary: SaveSummary } | null> {
  try {
    const { snapshot, summary } = await decodeSave(bytes);
    return { world: restoreWorld(snapshot), summary };
  } catch (error) {
    console.warn('Save could not be read:', error);
    return null;
  }
}

/** Loads a slot, falling back to the newest readable backup if the save itself is damaged. */
export async function loadSlot(store: SaveStore, slot: string): Promise<LoadedGame | null> {
  const main = await store.read(slot);
  if (main) {
    const loaded = await tryDecode(main);
    if (loaded) return { ...loaded, recoveredFrom: null };
  }
  for (const file of await store.backups(slot)) {
    const loaded = await tryDecode(await store.readBackup(file));
    if (loaded) return { ...loaded, recoveredFrom: loaded.summary.savedAt };
  }
  return null;
}

/** Summary of a slot for the start menu, or null if it is empty or unreadable. */
export async function peekSlot(store: SaveStore, slot: string): Promise<SaveSummary | null> {
  try {
    const bytes = await store.read(slot);
    if (bytes) return await readSummary(bytes);
  } catch (error) {
    if (!(error instanceof SaveFormatError)) console.warn(error);
  }
  // A damaged main save may still have good backups; say so by showing the newest one.
  for (const file of await store.backups(slot).catch(() => [])) {
    try {
      return await readSummary(await store.readBackup(file));
    } catch {
      // Try the next one.
    }
  }
  return null;
}

/** Writes the world to its slot, one save at a time; autosaves on an interval. */
export class SaveManager {
  private inFlight: Promise<boolean> | null = null;
  private lastAttempt = performance.now();

  constructor(
    private readonly store: SaveStore | null,
    private readonly world: World,
    private readonly slot: string,
  ) {
    if (!store)
      saveStatus.value = {
        state: 'unavailable',
        lastSavedAt: null,
        message: 'This browser cannot store saves.',
      };
  }

  /** Call every frame; saves when the autosave interval has passed. */
  tick(now: number): void {
    if (this.store && !this.inFlight && now - this.lastAttempt >= AUTOSAVE_INTERVAL_MS) void this.save();
  }

  /** Saves now. Resolves true on success; failures are reported in saveStatus. */
  save(): Promise<boolean> {
    if (!this.store) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    const store = this.store;
    this.lastAttempt = performance.now();
    saveStatus.value = { ...saveStatus.value, state: 'saving' };
    const career = this.world.career;
    this.inFlight = (async () => {
      try {
        const bytes = await encodeSave(captureWorld(this.world), {
          savedAt: new Date().toISOString(),
          mode: career.mode,
          money: career.mode === 'sandbox' ? null : career.money,
          machines: this.world.machines.length,
          playSeconds: this.world.stepCount * this.world.stepSeconds,
        });
        await store.write(this.slot, bytes);
        saveStatus.value = { state: 'idle', lastSavedAt: performance.now(), message: null };
        return true;
      } catch (error) {
        console.error('Save failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        saveStatus.value = { ...saveStatus.value, state: 'error', message };
        return false;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
