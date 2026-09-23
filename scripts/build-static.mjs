import { createHash } from 'node:crypto';
import { access, cp, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const staticFiles = ['index.html', 'styles.css', 'main.js'];
const staticDirs = ['assets'];
// Files that get cache-busted via a content-hash query string in the HTML.
// Their underlying filenames don't change, but the URL does — so the
// browser's `immutable` cache entry is bypassed cleanly on every deploy.
const versioned = ['styles.css', 'main.js'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of staticFiles) {
  await copyFile(join(root, file), join(outDir, file));
}

let copiedFiles = staticFiles.length;
for (const dir of staticDirs) {
  const src = join(root, dir);
  try {
    const s = await stat(src);
    if (!s.isDirectory()) continue;
  } catch {
    continue; // dir doesn't exist; skip silently
  }
  await cp(src, join(outDir, dir), { recursive: true });
  copiedFiles++;
}

// --- cache-bust versioned assets in the built HTML ---
const versionMap = {};
for (const file of versioned) {
  const buf = await readFile(join(outDir, file));
  versionMap[file] = createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

const indexPath = join(outDir, 'index.html');
let indexHtml = await readFile(indexPath, 'utf8');
for (const [file, hash] of Object.entries(versionMap)) {
  // match href="styles.css" or src="main.js" — strip any existing query
  const re = new RegExp(`(href|src)="(\\./)?${file.replace('.', '\\.')}(\\?[^"]*)?"`, 'g');
  indexHtml = indexHtml.replace(re, `$1="${file}?v=${hash}"`);
}
await writeFile(indexPath, indexHtml, 'utf8');

const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
if (vercel.outputDirectory !== 'dist') {
  throw new Error('vercel.json outputDirectory must be "dist".');
}

const sourceIndex = (await readFile(join(root, 'index.html'), 'utf8'))
  .replace(/<!--[\s\S]*?-->/g, ''); // ignore href/src that appear inside HTML comments
const refs = [...sourceIndex.matchAll(/\b(?:href|src)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((ref) => !/^(?:https?:|mailto:|tel:|#|data:)/i.test(ref))
  .map((ref) => ref.split(/[?#]/, 1)[0]);

for (const ref of refs) {
  await access(join(root, ref));
  await access(join(outDir, ref));
}

console.log(
  `Built ${copiedFiles} static entries into dist/. Versioned: ` +
  Object.entries(versionMap).map(([f, h]) => `${f}?v=${h}`).join(', ')
);
