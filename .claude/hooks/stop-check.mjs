// Stop: do not finish a turn with a failing typecheck or unit tests.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (input.stop_hook_active) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  execSync('npm run --silent check:quick', { cwd: root, stdio: 'pipe' });
} catch (error) {
  const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.split('\n').slice(-40).join('\n');
  process.stderr.write(`check:quick failed. Fix before finishing:\n${out}`);
  process.exit(2);
}
