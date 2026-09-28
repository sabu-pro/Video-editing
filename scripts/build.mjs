import { cp, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  'src/timing.js',
  'src/snapping.js',
  'src/links.js',
  'src/editing.js',
  'src/audio-meter.js',
  'src/audio-effects.js',
  'src/noise-removal.js',
  'src/noise-worklet.js',
  'src/effects-catalog.js',
  'src/voice-isolation.js',
  'src/voice-isolation-config.js',
  'src/voice-isolation-worker.js',
  'src/media-info.js',
  'src/waveforms.js',
  'src/engine.js',
  'src/webm.js',
  'src/icons.js',
  'src/styles.css',
  'assets/favicon.svg',
  'assets/alpine.jpg',
  'assets/lake.jpg',
  'assets/forest.jpg',
  'assets/voice-isolation/df.js',
  'assets/voice-isolation/df_bg.wasm',
  'assets/voice-isolation/DeepFilterNet3_onnx.tar.gz',
  'assets/voice-isolation/LICENSE-MIT.txt',
  'assets/voice-isolation/UPSTREAM-LICENSE-MIT.txt',
  'assets/voice-isolation/provenance.json',
  'assets/voice-isolation/NOTICE.md',
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
const voiceAssets=JSON.parse(await readFile(path.join(output,'assets/voice-isolation/provenance.json'),'utf8'));
for(const entry of voiceAssets){
  const bytes=await readFile(path.join(output,'assets/voice-isolation',entry.file));
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error(`Voice Isolation asset verification failed: ${entry.file}`);
}
console.log('Verified production Voice Isolation model, WASM, loader and licenses.');
