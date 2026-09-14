import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') {
  throw new Error('Build output must be the project dist directory.');
}

// Only browser assets are published; tests, source media imports, and local
// server tooling are not part of the deployment.
const files = [
  'index.html',
  'src/app.js',
  'src/core.js',
  'src/engine.js',
  'src/webm.js',
  'src/icons.js',
  'src/styles.css',
  'assets/favicon.svg',
  'assets/alpine.jpg',
  'assets/lake.jpg',
  'assets/forest.jpg',
];

for (const file of files) {
  if (!(await stat(path.join(root, file))).isFile()) {
    throw new Error(`Missing browser asset: ${file}`);
  }
}
await rm(output, { recursive: true, force: true });
for (const file of files) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, file), destination);
}
console.log(`Built ${files.length} browser assets in dist/`);
