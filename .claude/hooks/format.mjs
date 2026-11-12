// PostToolUse: format and lint-fix the TypeScript file that was just edited.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (
  !file.startsWith(root + '/') ||
  !/\.(ts|tsx|js|mjs|cjs|css|json)$/.test(file) ||
  file.includes('/node_modules/')
)
  process.exit(0);
const run = (bin, args) =>
  execFileSync(`${root}/node_modules/.bin/${bin}`, args, { cwd: root, stdio: 'pipe' });
try {
  run('prettier', ['--write', file]);
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(file)) run('eslint', ['--fix', file]);
} catch (error) {
  process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
  process.exit(2);
}
