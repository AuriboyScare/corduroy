/** Where save files live: real files in the desktop app, the browser's private file system otherwise. */
export interface SaveStore {
  readonly kind: 'desktop' | 'browser';
  read(name: string): Promise<Uint8Array | null>;
  /** Replaces a save atomically, keeping the previous one as a backup. */
  write(name: string, bytes: Uint8Array): Promise<void>;
  /** Backup file names for a save, newest first. */
  backups(name: string): Promise<string[]>;
  readBackup(file: string): Promise<Uint8Array>;
}

interface NativeSaves {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  backups(name: string): Promise<string[]>;
  readBackup(file: string): Promise<Uint8Array>;
}

export interface NativeBridge {
  saves: NativeSaves;
  onBeforeQuit(callback: () => void): void;
  quitReady(): void;
}

declare global {
  interface Window {
    corduroyNative?: NativeBridge;
  }
}

const KEEP_BACKUPS = 5;

/**
 * Origin-private file system store. A writable stream writes to a hidden swap file that only
 * replaces the real file when it is closed, so an interrupted write leaves the old save intact.
 */
class BrowserStore implements SaveStore {
  readonly kind = 'browser';
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  static async open(): Promise<BrowserStore | null> {
    try {
      const root = await navigator.storage.getDirectory();
      // Ask the browser not to evict saves under storage pressure.
      void navigator.storage.persist?.();
      return new BrowserStore(await root.getDirectoryHandle('saves', { create: true }));
    } catch {
      return null;
    }
  }

  async read(name: string): Promise<Uint8Array | null> {
    try {
      const file = await (await this.root.getFileHandle(`${name}.crdy`)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return null;
      throw error;
    }
  }

  async write(name: string, bytes: Uint8Array): Promise<void> {
    const previous = await this.read(name);
    const backups = await this.root.getDirectoryHandle('backups', { create: true });
    if (previous) {
      await writeFile(backups, `${name}-${Date.now().toString().padStart(15, '0')}.crdy`, previous);
      const old = (await this.backups(name)).slice(KEEP_BACKUPS);
      for (const file of old) await backups.removeEntry(file);
    }
    await writeFile(this.root, `${name}.crdy`, bytes);
  }

  async backups(name: string): Promise<string[]> {
    const backups = await this.root.getDirectoryHandle('backups', { create: true });
    const names: string[] = [];
    for await (const key of (backups as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (key.startsWith(`${name}-`) && key.endsWith('.crdy')) names.push(key);
    }
    return names.sort().reverse();
  }

  async readBackup(file: string): Promise<Uint8Array> {
    const backups = await this.root.getDirectoryHandle('backups', { create: true });
    return new Uint8Array(await (await (await backups.getFileHandle(file)).getFile()).arrayBuffer());
  }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try {
    await stream.write(bytes as BufferSource);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}

class DesktopStore implements SaveStore {
  readonly kind = 'desktop';
  constructor(private readonly native: NativeSaves) {}
  read(name: string) {
    return this.native.read(name);
  }
  write(name: string, bytes: Uint8Array) {
    return this.native.write(name, bytes);
  }
  backups(name: string) {
    return this.native.backups(name);
  }
  readBackup(file: string) {
    return this.native.readBackup(file);
  }
}

/** The best store this environment offers, or null when none can be opened. */
export async function openSaveStore(): Promise<SaveStore | null> {
  if (window.corduroyNative?.saves) return new DesktopStore(window.corduroyNative.saves);
  return BrowserStore.open();
}
