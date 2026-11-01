// Copies the game into www/, the folder Capacitor wraps into the iOS and Android apps.
// Usage:  node tools/build-www.js   (or: npm run build)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const FILES = ['index.html', 'manifest.webmanifest', 'privacy.html'];
const DIRS = ['icons', 'fonts'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
console.log('www/ ready:', fs.readdirSync(OUT).join(', '));
