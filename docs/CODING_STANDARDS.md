# Coding standards

- TypeScript strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`; narrow `unknown` instead.
- Prettier formats everything (110 columns, single quotes). ESLint must be clean. Hooks run both on edit.
- Simulation state lives in typed arrays (struct of arrays), not arrays of objects. Units are SI and named in the identifier when not obvious (`stepSeconds`, `depthM`, `densityKgM3`).
- Simulation code is deterministic: fixed step, seeded RNG, no `Date.now()` or `Math.random()` in `src/sim`.
- Hot paths (per frame, per step, per agent) allocate nothing: reuse scratch objects and pools.
- Comments explain why, not what. Public functions get a one-line doc comment.
- Errors the player can hit are shown in the UI with what happened and what to do; they are never swallowed.
- Every saved or networked structure is versioned; changing one needs a migration and a test.
- Tests: pure logic in `tests/unit`; the real app in `tests/e2e`. See the `automated-testing` skill.
- Commits are small and say what changed and why. `npm run check` passes on every commit.
