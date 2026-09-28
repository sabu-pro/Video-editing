# Voice Isolation

DeepFilterNet3 runs locally in a module Worker, with the upstream libDF/tract WASM
build. Both model and browser wrapper offer MIT / Apache-2.0; Cutline distributes
the MIT option and includes the notices in `assets/voice-isolation/`.
`provenance.json` pins the downloaded bytes, source revisions and checksums.

The effect is separate from Background Noise Remover. Inference receives 48 kHz
PCM, independently per channel. The source interval of the entire clip is processed
with 250 ms of preceding context where available. The 1440-sample STFT/model delay
is removed and the tail flushed. Dry L/R and enhanced L/R are encoded together in
a local float WAV. One media element drives both paths, preserving alignment and
the existing pitch-preserving speed behavior. Gain nodes smoothly blend Strength
before the unchanged Background Noise Remover, clip volume, Mute/Solo and master.
Preview and export use this same graph; export waits for ML preparation to finish.

No user media is sent over HTTP. Model/WASM fetches are same-origin GETs, lazy on
first use. The compiled module and model bytes are reused. Processed results are
keyed by source Blob identity and clip source interval, independent of Strength or
Bypass. Idle results are evicted above 160 MiB; active results remain pinned.
Worker termination frees Rust memory after each job. Project reset releases URLs
and cancels pending jobs. Saved projects contain settings, not temporary URLs.

## Production

`npm run build` copies every required file to `dist`; no download or compiler is
required on Vercel. Module-relative `new URL(..., import.meta.url)` resolves the
Worker, WASM and model below the deployment's base path. The `/dist/index.html`
browser test runs the actual built assets from a nested path. No Node inference,
CDN, API keys, shared memory, COOP/COEP or cross-origin headers are required.
WASM is compiled from fetched bytes, so streaming MIME assumptions are avoided.

## Limits and recovery

Requires HTTPS (or localhost), WebAssembly, module Workers and browser decoding
support for the input codec. Tested in Chrome; older browsers may not support the
WASM features. Clips are limited to 180 source seconds per operation, and source
decoding is guarded at 192 MiB PCM to reduce out-of-memory risk. Split/trim long
clips; unusually long source files may need to be shortened externally first.
Processing failures are shown in the effect controls and block enabled playback /
export. Reset retries failures; Bypass or Remove restores original audio.
This enhances speech, not speaker identity: competing speakers may remain, and
music, consonants or difficult recordings may be altered.

## Manual check before commit

1. Run `npm start`, open `http://localhost:3000`, import speech with audible fan or
   street noise, and place it on the timeline.
2. Select its audio (or linked video), open Effects > Audio Effects > Cleanup &
   Restoration > Voice Isolation. Wait for Ready.
3. Play the full clip, compare Strength 0 / 50 / 100 and Bypass; check speech timing,
   both meter channels, volume, Mute and Solo. Add Background Noise Remover as well.
4. Undo/redo, save a portable project, reopen it and compare again. Export video
   and listen to its audio. Test a stereo source and a mono source.
5. Open `http://localhost:3000/dist/index.html` after `npm run build`; repeat once.
   DevTools should show model assets only on first use, from `/dist/assets/`, and
   no media uploads. In offline mode after a fresh reload, first use should show
   an explicit loading failure; bypass should restore playback.
