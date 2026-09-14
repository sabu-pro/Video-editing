# Cutline Studio

A working, local-first JavaScript video editor with a Premiere-inspired workspace and familiar editing shortcuts. It runs in a browser, processes media on your device, and includes a 24-second sample project.

## Start the editor

On Windows, double-click **Start Editor.cmd**. It starts the local server and opens **http://localhost:3000**. Keep the terminal window open while using the editor.

Or, from this folder:

```sh
npm start
```

Node.js 20 or newer is required. There are **no runtime packages to install**. The development dependency is only used for browser tests. Chrome and Edge are the tested target browsers. Open the local URL; opening `index.html` directly will not work because the app uses JavaScript modules and local asset requests.

For a different port, set the `PORT` environment variable before running `npm start`. The server listens only on `127.0.0.1`.

## Deploy on Vercel

Import [sabu-pro/Video-editing](https://github.com/sabu-pro/Video-editing) into Vercel and deploy the `main` branch. The included `vercel.json` configures the project automatically:

- Framework preset: **Other**
- Build command: **npm run build**
- Output directory: **dist**
- Install command: **npm ci --omit=dev**

The build publishes only the browser app and bundled sample assets. No server functions, API keys, or environment variables are required. The local `server.js` is only for development.

Vercel deploys later pushes automatically after the repository has been connected to a Vercel project. Creating a GitHub repository alone does not connect it to Vercel. See [Vercel's Git deployment guide](https://vercel.com/docs/git).

To verify the deployment build locally, run `npm run build`. Media and project autosaves on the hosted site belong to that site's browser origin, separate from your localhost session. Use a portable `.cutline` project to transfer an edit between them.

## What you can do

- **Import media:** local video, audio, and image files; multi-file import and drag/drop; searchable grid/list bin; source preview and source In/Out selection. Supported codecs depend on the browser, with explicit errors for files it cannot decode.
- **Edit a multitrack timeline:** start with three video tracks and two audio tracks, add up to 30 tracks, layer footage and graphics, move clips between compatible tracks, trim either edge, razor/split, ripple trim/delete, slip the source range, and insert or overwrite selected media.
- **Organize the sequence:** multi-select, copy/cut/paste, duplicate, undo/redo, track locks, video visibility, audio mute/solo, markers, sequence In/Out, loop playback, zoom, fit timeline, and resize the workspace.
- **Adjust motion:** position, scale, rotation, opacity, fit/fill, and four-sided crop. Linear keyframes animate effect properties. Splits and left trims preserve and rebase animation.
- **Grade and stylize:** exposure, contrast, saturation, warm/cool temperature, monochrome, blur, and vignette. Eleven editable presets include Cinematic, Golden hour, Arctic, Noir, Faded film, and audio/video fades.
- **Use transitions:** independent video fade-in/out and audio fade-in/out. Overlap footage on separate video tracks and fade the upper clip to create a dissolve over the lower clip.
- **Create graphics:** four editable title templates, multiline text, font/size/weight/alignment/color/shadow, animated motion, and color mattes.
- **Work with captions:** import SRT into a dedicated caption track; edit text and timing like titles; burn captions into video or export the edited track as SRT.
- **Mix audio:** video sound and dedicated audio tracks, source waveforms when decoding is available, per-clip volume and fades, keyframes, track mute/solo, master level meter, and separate a video's audio onto its own track.
- **Change speed:** 0.25×–4× clip speed; duration adjusts to preserve the source range. Forward and reverse shuttle playback and frame stepping are available.
- **Save projects:** automatic browser session storage using IndexedDB; portable `.cutline` files containing media; smaller timeline-only project files; original-name media relinking; restoration after reload.
- **Export:** the entire sequence or In/Out range, sequence/half/two-thirds resolution, selectable bitrate, browser-supported WebM or MP4, mixed audio, full-resolution PNG frames, and SRT captions. WebM recordings receive duration metadata for normal playback and reimport.
- **Change sequence formats:** landscape, portrait, and square presets; up to 3840 × 2160 landscape; 24, 25, 30, or 60 fps.

## Quick editing walkthrough

1. Try Space to play the sample sequence. Select a clip and open **Effects** to apply a look.
2. Choose **File → New project** for a blank sequence. Import your files with **Ctrl+I**.
3. Drag bin media to a timeline track. Double-click bin media to preview it and set a source range before adding it.
4. Drag clip edges to trim. Press **C** and click a clip to cut, or position the playhead and press **Ctrl+K**. Press **V** to return to selection.
5. Use **Effect controls** to adjust the selected clip. Click a diamond at one time, move the playhead, and change the property to create a second keyframe. Alt-click its diamond to remove animation.
6. Add titles with **T**, or import subtitles through **File → Import captions (SRT)**.
7. Save an editable project, then click **Export** to render the video.

Insert (`,`) opens a gap across unlocked tracks at the playhead. Overwrite (`.`) replaces the occupied range on the target media track. Both use the currently selected bin item. Plain drag/drop places a clip without removing existing clips. Clips on the same track are composited in project insertion order when they overlap; use different tracks for deliberate transitions.

## Keyboard reference

| Action | Shortcut |
| --- | --- |
| Play / pause | Space |
| Reverse / stop / forward shuttle | J / K / L |
| Previous / next frame | Left / Right |
| Jump one second | Shift + Left / Right |
| Previous / next edit | Up / Down |
| Sequence start / end | Home / End |
| Selection / razor / ripple trim / slip / hand | V / C / B / Y / H |
| Add title | T |
| Split at playhead | Ctrl+K |
| Trim start / end to playhead | Q / W |
| Insert / overwrite selected bin item | , / . |
| Delete / ripple delete | Delete / Shift+Delete |
| Copy / cut / paste / duplicate | Ctrl+C / X / V / D |
| Select all clips | Ctrl+A |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Mark In / Out | I / O |
| Clear In/Out | Ctrl+Shift+X |
| Marker / snapping | M / S |
| Zoom / fit timeline | + or − / Backslash |
| Import / open / save / export | Ctrl+I / O / S / M |
| Help | ? |

Use Command instead of Ctrl on macOS. Application shortcuts are suspended in text fields and dialogs. Some browser/OS-reserved shortcuts may not be interceptable. All main actions are also available in the menus.

## Storage and export details

No files are uploaded. The Node server serves static files; the browser performs compositing, decoding, audio mixing, and recording. Sample photographs are bundled locally, so the application itself needs no external network requests.

Browser storage is specific to the browser profile and origin, including the port. It can be cleared or run out of quota. Save a `.cutline` file for a separate copy of your work. Portable projects use base64 media, take more space than the original files, and are held in memory while saving/opening. Use timeline-only projects for large footage, then reimport the original filenames when reopening. Keep originals until your project and export are verified.

Video export runs **in real time**: a 10-minute sequence takes approximately 10 minutes. Keep the tab visible; hiding it cancels the export so it cannot silently finish with frozen frames. The master monitor mute does not mute exported audio; clip volume and track mute/solo do. Exported frame timing depends on the browser's recorder and available CPU/GPU resources. The export panel lists only formats that the browser reports as supported.

This is an independent editor, not Adobe software or a complete Premiere Pro replacement. It does not implement Adobe project/plugin compatibility, After Effects integration, professional RAW/ProRes workflows, proxy generation, multicam, motion tracking, masks/chroma key, optical flow, LUT import, automatic transcription, advanced audio restoration, or offline frame-accurate encoding. Animated image files are treated as image sources; complex GIF playback is not synchronized to sequence time. Reverse shuttle is a silent visual preview, not reverse-rendered footage. Large projects and high-resolution exports are limited by browser memory and real-time decoding performance.

## Project structure and tests

```text
index.html                Workspace structure
src/app.js                Editor interactions, persistence, export orchestration
src/core.js               Timeline operations, automation, captions, validation
src/engine.js             Canvas compositor and Web Audio/media playback
src/webm.js               Recorder duration metadata finalization
src/icons.js              Original inline SVG interface icons
src/styles.css            Responsive editing workspace
server.js                 Dependency-free localhost static server
assets/                   Bundled sample images and app icon
tests/core.test.js        Timeline, keyframe, caption, and validation tests
tests/browser/            Playwright end-to-end editing tests
```

```sh
npm run check
npm test
npm install
npm run test:browser
```

Browser tests use installed Google Chrome in headless mode. They verify playback, effects, cut/undo, title editing, keyframes, import, local restore, drag/trim/locks, portable project round-trip, PNG output, video export with audible sound, exported video reimport, separate audio, captions, insert/overwrite editing, and responsive layouts.

## Sample assets and implementation references

Sample photographs are sourced from Unsplash: [landscape](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b), [lake](https://images.unsplash.com/photo-1470770841072-f978cf4d019e), and [forest](https://images.unsplash.com/photo-1441974231531-c6227db76b6e). See the [Unsplash license](https://unsplash.com/license). The bundled ambient music is generated procedurally by this application.

The implementation uses the browser's [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [supported-codec detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static), [Web Audio stream destination](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination), and [Matroska/WebM duration and timestamp definitions](https://www.matroska.org/technical/elements.html).
