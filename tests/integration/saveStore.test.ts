import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { KEEP_BACKUPS, listBackups, readBackup, readSave, writeSave } from '../../electron/saveStore.js';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'corduroy-saves-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const complete = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 33) return false;
  const body = bytes.subarray(0, bytes.byteLength - 32);
  const digest = createHash('sha256').update(body).digest();
  return Buffer.from(bytes.subarray(bytes.byteLength - 32)).equals(digest);
};

describe('save store', () => {
  it('writes, reads back, and keeps a limited number of backups', async () => {
    const dir = tempDir();
    expect(await readSave(dir, 'career')).toBeNull();
    for (let k = 0; k < KEEP_BACKUPS + 3; k++) {
      await writeSave(dir, 'career', new Uint8Array([k]));
      await new Promise((r) => setTimeout(r, 3));
    }
    expect(Array.from((await readSave(dir, 'career'))!)).toEqual([KEEP_BACKUPS + 2]);
    const backups = await listBackups(dir, 'career');
    expect(backups).toHaveLength(KEEP_BACKUPS);
    // Newest backup is the save before the current one.
    expect(Array.from(await readBackup(dir, backups[0]!))).toEqual([KEEP_BACKUPS + 1]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses names that could escape the save folder', async () => {
    const dir = tempDir();
    await expect(writeSave(dir, '../evil', new Uint8Array(1))).rejects.toThrow('invalid save name');
    await expect(readBackup(dir, '../career.crdy')).rejects.toThrow('invalid backup name');
  });

  it('never leaves a torn save when the writer is killed mid-write', async () => {
    const dir = tempDir();
    const fixture = path.join(import.meta.dirname, 'fixtures', 'saveWriter.mjs');
    let kills = 0;
    let checked = 0;
    for (let round = 0; round < 12; round++) {
      const child = spawn(process.execPath, [fixture, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
      let written = 0;
      child.stdout.on('data', (chunk: Buffer) => (written += chunk.toString().split('\n').length - 1));
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 500));
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
      kills++;
      const slot = await readSave(dir, 'slot');
      if (written > 0 || slot) {
        expect(slot, `round ${round}`).not.toBeNull();
        expect(complete(slot!), `round ${round}: slot is torn`).toBe(true);
        checked++;
      }
      for (const file of await listBackups(dir, 'slot'))
        expect(complete(await readBackup(dir, file))).toBe(true);
    }
    expect(kills).toBe(12);
    expect(checked).toBeGreaterThan(8);
  }, 60_000);
});
