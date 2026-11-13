export const KEEP_BACKUPS: number;
export function writeSave(dir: string, name: string, bytes: Uint8Array, keep?: number): Promise<void>;
export function readSave(dir: string, name: string): Promise<Uint8Array | null>;
export function listBackups(dir: string, name: string): Promise<string[]>;
export function readBackup(dir: string, file: string): Promise<Uint8Array>;
