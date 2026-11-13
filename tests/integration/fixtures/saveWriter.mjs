// Writes self-checking saves in a loop until killed. Each payload ends with the SHA-256 of
// everything before it, so a reader can tell a complete file from a torn one.
import { createHash, randomBytes } from 'node:crypto';
import { writeSave } from '../../../electron/saveStore.js';

const dir = process.argv[2];
for (let k = 0; ; k++) {
  const body = randomBytes(1_000_000 + Math.floor(Math.random() * 3_000_000));
  const digest = createHash('sha256').update(body).digest();
  await writeSave(dir, 'slot', Buffer.concat([body, digest]));
  process.stdout.write(`${k}\n`);
}
