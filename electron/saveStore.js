import { constants } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Crash-safe save files. A save is written to a temporary file, flushed to disk, then renamed
 * over the old one, which the file system does atomically: after a crash or power cut the slot
 * holds either the previous save or the new one, never a mixture. Before each write the previous
 * save is copied into backups/, keeping the newest few.
 */

const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const KEEP_BACKUPS = 5;

function checkName(name) {
  if (!NAME.test(name)) throw new Error(`invalid save name "${name}"`);
}

const slotPath = (dir, name) => path.join(dir, `${name}.crdy`);

async function fsyncPath(target, flags) {
  const handle = await open(target, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeSave(dir, name, bytes, keep = KEEP_BACKUPS) {
  checkName(name);
  const backups = path.join(dir, 'backups');
  await mkdir(backups, { recursive: true });
  const target = slotPath(dir, name);
  try {
    await stat(target);
    // Millisecond timestamp plus a counter keeps backup names unique and in order.
    const stamp = `${Date.now().toString().padStart(15, '0')}`;
    // Copy under a temporary name and rename, so a crash mid-copy cannot leave a torn backup.
    const backup = path.join(backups, `${name}-${stamp}.crdy`);
    await copyFile(target, `${backup}.tmp`, constants.COPYFILE_FICLONE);
    await rename(`${backup}.tmp`, backup);
    await pruneBackups(dir, name, keep);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = `${target}.tmp`;
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, target);
  // Flush the directory entry too, so the rename itself survives a power cut.
  await fsyncPath(dir, 'r');
}

export async function readSave(dir, name) {
  checkName(name);
  try {
    return new Uint8Array(await readFile(slotPath(dir, name)));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Backups of one slot, newest first. */
export async function listBackups(dir, name) {
  checkName(name);
  let files;
  try {
    files = await readdir(path.join(dir, 'backups'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return files
    .filter((f) => f.startsWith(`${name}-`) && f.endsWith('.crdy'))
    .sort()
    .reverse();
}

export async function readBackup(dir, file) {
  if (!/^[a-z0-9-]+\.crdy$/.test(file)) throw new Error(`invalid backup name "${file}"`);
  return new Uint8Array(await readFile(path.join(dir, 'backups', file)));
}

async function pruneBackups(dir, name, keep) {
  const files = await listBackups(dir, name);
  for (const file of files.slice(keep)) await unlink(path.join(dir, 'backups', file));
  // Temporary files left by a crash are never valid saves.
  for (const file of await readdir(path.join(dir, 'backups'))) {
    if (file.startsWith(`${name}-`) && file.endsWith('.tmp')) await unlink(path.join(dir, 'backups', file));
  }
}
