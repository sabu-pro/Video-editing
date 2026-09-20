# Cutline Studio continuation — 19 September 2026

The starting point was checkpoint `211f73d` plus four uncommitted files. The channel-aware meter changes and linked Ctrl+K coverage were preserved. `src/icons.js` contained only an extra trailing blank line and was not edited; its SHA256 remains `3F9002C8B8E3E23CA66846962A99AB2FA07260525DD36C81B428F259E1F31365`. No commit or push was made.

## Findings and changes

- Pointer Razor and Ctrl+K already called `cutClips`. That path, linked source timing, lock protection, split automation offsets, history, real stereo metering, and the existing media model were retained.
- Trim snapping previously accepted targets that the subsequent edit could not reach. `trimBounds` now supplies identical frame-aligned source constraints to the UI and linked trim operation. Snap tolerance uses the pointer position before quantization; slipping respects whole sequence-frame increments at fractional source bounds. Invalid speeds are rejected before mutation.
- Vertical track scrolling carried the ruler out of view. The existing ruler, range reference, and playhead handle now counter vertical scrolling while retaining native horizontal alignment. No duplicate ruler is rendered.
- Meter markup contained literal `?6`, `?12`, etc. It now contains readable ASCII negative dB labels with larger monospaced text. The other agent's meter implementation is preserved.
- A timeline pointer interaction prevented default focus changes, leaving keyboard focus on a previously adjusted zoom slider. Timeline interaction now explicitly transfers focus, preserving shortcut guards while typing.
- Track height calculation no longer reads every lane's layout. Ordinary movement reuses clip DOM and waveform geometry. A bounded waveform cache is keyed by peak data, source timing, playback speed, and resolution.
- Remove from Project supports media selection, contextual Delete/Backspace, a context menu, undo, and persistence. In-use assets are protected with an explanation. Removed blobs stay in the session cache for undo, but are omitted from saved/restored active media lists. Original files are never deleted.
- Media probing and thumbnails now live in `media-info.js`; the previous `readAsset` API re-exports that implementation. Probe elements are released on failures. Playback errors are reported without repeated play promises or toast floods. Seeking clears stale pending targets. Export prepares its actual starting range and aborts on newly reported playback failures.
- Automation has visible/selectable points, explicit sequence-time editing, previous/next navigation, deletion, and Linear/Ease In/Ease Out/Ease In-Out interpolation. Existing curve coordinates survive splitting. Time edits reject collisions and locked tracks and integrate with history.
- Existing effects now support per-property bypass and reset without losing authored values on bypass. Temperature and vignette render on an isolated reusable layer, preventing changes to lower tracks. Preview and export share this renderer. Caption endpoints, loaded markers/ranges, and export render times use sequence frame conversion.

## Validation

Regression suites cover core editing, AV import and linking, stereo peaks, lock protection, mute/solo playback, failed-import recovery, media removal/history/reload, keyframe editing and easing, effect isolation, encoded effect pixels, and scrolling alignment. Existing tests were retained. The older zoom test now reads geometry atomically to avoid observing a detached element during DOM replacement.

A 300-clip drag profile observed zero timeline DOM replacements, preserved clip node identity, and recorded 45 frame intervals: median 16.7 ms and p95 16.9 ms on this machine. These are local measurements, not a guarantee for all hardware or footage.

Final test counts and production status are recorded in the accompanying completion report.

## Remaining scope and recommended follow-up

- Export still uses real-time MediaRecorder. Frame-aligned render decisions do not guarantee offline, frame-perfect encoded timestamps or freedom from dropped frames under load. A separately validated WebCodecs/muxer export path remains future work.
- Source frame rate is not invented. Container/audio metadata detection and browser codec support remain limited; waveform decoding still has a 256 MB budget.
- Keyframes can move through their time field; direct point dragging and a curve editor are not implemented. Undo restores project data but does not restore the previous UI selection.
- This phase improves the working effect set; it does not implement the entire requested advanced effect catalog (chroma key, lens distortion, directional blur, etc.).
- Very long timelines still generate the full ruler and all clip DOM on committed edits. Further virtualization should follow broader footage/hardware profiling.
- Removed media remains in the IndexedDB cache; reclaiming unused cached blobs safely across active history needs a separate storage cleanup policy.
- Full preview/export parity for every codec, transform, automation combination, and multi-hour sequence is not established by these targeted regressions.

Source changes: `index.html`, `src/app.js`, `src/core.js`, `src/editing.js`, `src/engine.js`, `src/media-info.js`, `src/snapping.js`, `src/styles.css`, `src/waveforms.js`. Tests were added or extended under `tests/` and `tests/browser/`. The pre-existing modifications in `src/audio-meter.js`, `src/icons.js`, and `tests/browser/audio.spec.js` were preserved.
