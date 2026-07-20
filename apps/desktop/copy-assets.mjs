import fs from 'node:fs';
import path from 'node:path';

// The server bundle must live inside dist/ so it packages into app.asar
// alongside node_modules — Node's module resolution walks up from the
// importing file looking for node_modules, and can't cross the asar
// boundary into a sibling extraResource.
const src = path.resolve('../server/dist/index.mjs');
const destDir = path.resolve('dist/server');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'index.mjs'));

// Window/tray icon needs to resolve relative to dist/main.js at runtime.
fs.copyFileSync(path.resolve('build/icon.ico'), path.resolve('dist/icon.ico'));
