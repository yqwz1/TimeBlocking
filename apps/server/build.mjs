import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// Bundle our own workspace package (@timeblock/shared) but leave real npm
// dependencies external — several of them (fastify plugins, googleapis,
// better-sqlite3) do dynamic requires or ship native code that esbuild
// can't bundle safely.
const externals = Object.keys(pkg.dependencies)
  .filter((name) => name !== '@timeblock/shared')
  .flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // .mjs is unambiguous ESM regardless of any package.json nearby — the
  // packaged desktop app copies this file out from under its own package.json.
  outfile: 'dist/index.mjs',
  external: externals,
  logLevel: 'info',
});
