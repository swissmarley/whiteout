// Assembles the static site for GitHub Pages: the client, the shared code, and the two server
// modules the client needs to host a solo match in the page (see public/src/local.js).
//
//   node scripts/pages.mjs [outDir]      (default: _site)
//
// Copies named folders only, and skips the macOS AppleDouble "._name" sidecars and .DS_Store
// that an exFAT drive leaves next to every file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(ROOT, process.argv[2] || '_site');
const junk = (name) => name.startsWith('._') || name === '.DS_Store';

function copy(src, dst) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) if (!junk(name)) copy(path.join(src, name), path.join(dst, name));
  } else fs.writeFileSync(dst, fs.readFileSync(src));      // contents only: no extended attributes, so no new sidecars
}

fs.rmSync(out, { recursive: true, force: true });
copy(path.join(ROOT, 'public'), out);
copy(path.join(ROOT, 'shared'), path.join(out, 'shared'));
fs.mkdirSync(path.join(out, 'server'));
for (const f of ['game.js', 'nav.js']) copy(path.join(ROOT, 'server', f), path.join(out, 'server', f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');        // serve the files as they are
console.log('site ->', path.relative(process.cwd(), out) || '.');
