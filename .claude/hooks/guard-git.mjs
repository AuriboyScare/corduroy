// PreToolUse (Bash): refuse force-pushes to main.
import { readFileSync } from 'node:fs';

const command = JSON.parse(readFileSync(0, 'utf8')).tool_input?.command ?? '';
if (
  /git\s+push\b/.test(command) &&
  /(--force\b|--force-with-lease\b|\s-f\b)/.test(command) &&
  /\bmain\b/.test(command)
) {
  process.stderr.write('Force-pushing to main is not allowed in this repo.');
  process.exit(2);
}
