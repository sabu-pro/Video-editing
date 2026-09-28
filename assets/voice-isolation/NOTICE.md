# Voice Isolation: DeepFilterNet3

DeepFilterNet3 model and libDF by Hendrik Schroeter and contributors:
https://github.com/Rikorose/DeepFilterNet
Upstream revision: d375b2d8309e0935d165700c91da9de862a99c31
Dual MIT / Apache-2.0; distributed here under the MIT option (see UPSTREAM-LICENSE-MIT.txt).

Browser WASM build and unmodified wasm-bindgen loader from MezonAI:
https://github.com/mezonai/mezon-noise-suppression
Loader revision: a5212661245a2184370fc3c3dd1f52dc4dffb2a5, v3 WASM.
Dual MIT / Apache-2.0; distributed under MIT (see LICENSE-MIT.txt).
The binary includes the tract inference runtime used by libDF.

Exact download origins, sizes and SHA-256 hashes are recorded in provenance.json.
These files are vendored, not downloaded by the Vercel build. No CDN is contacted
at runtime: Cutline fetches these static files from its own deployment only.

Cutline performs inference in a dedicated Worker. The runtime's raw-pointer API
has no safe destroy export, so each completed job terminates its Worker to release
the WASM heap. Compiled code and model bytes are cached for subsequent jobs.
Stereo channels have independent model states; no stereo-to-mono fold-down.
The 30 ms model/STFT delay is trimmed and the tail flushed before mixing.

This is speech enhancement, not speaker-identity separation. Other speakers,
reverberation or extremely damaged speech may remain; music may be suppressed.
