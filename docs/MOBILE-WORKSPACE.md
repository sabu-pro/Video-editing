# Mobile / touch workspace

At widths up to 900 CSS pixels, the existing preview sits above a touch toolbar
and the existing timeline. Media, Audio (audio assets), Text, Effect Controls and
More open bottom sheets. The library and inspector are moved into the sheet, not
duplicated. Closed panels skip rendering; opening them refreshes from the same
project state. Above 900px, panels return to their original desktop locations.

Tap a clip to select. Drag its body to move; drag its edge to trim. Swipe empty
lanes to scroll horizontally or vertically; More > Pan / select tool permits
scrolling over clips. Pinch the timeline to zoom; hold a clip to open its context
menu. Tap/drag the ruler to seek. Touch cancellation restores an unfinished drag
without adding an undo entry. Snapping, linked edits and track locks use existing
editing functions. The toolbar provides Undo, Redo, Split, Delete and Play.

Effects opens Applied Effects for the selected clip. Add effect opens the normal
catalog. Existing effect controls and keyframes edit the same project data and
use the same preview/export graph. No model loads merely because the screen is
small. Voice Isolation retains its existing limits and error handling.

## Phone testing before commit

For Android Chrome, without deploying:

1. On the computer, run `npm start` in this repository.
2. Enable USB debugging on the phone, connect it by USB and accept the debugging
   prompt. Open `chrome://inspect/#devices` in desktop Chrome.
3. Open **Port forwarding**, map device port **3000** to **localhost:3000**, and
   enable forwarding. Open `http://localhost:3000` in Chrome on the phone.
4. Import a short video through Media. Tap the asset, then Add to timeline.
   Move/trim clips, swipe empty lanes, pinch and seek. Check Undo/Redo and Split.
5. Select a clip, open Effects, add an effect, and check bypass/reset/remove.
   Use More to save/open and export. Rotate between portrait and landscape.

For iPhone/iPad or another phone without USB forwarding, use a trusted HTTPS
preview deployment of the working folder (for example, `npx vercel` from this
repository, then open the returned preview URL on the phone). This is a manual
deployment step, separate from committing or pushing. Plain HTTP to a computer's
LAN IP is not sufficient for Web Audio worklets or Voice Isolation.

## Limits

Automated touch validation uses Chromium; Safari/iOS hardware needs a manual
codec/export check. Export remains real time: keep the browser visible and the
phone awake. Existing codec/memory errors are retained and project/export quality
is never silently reduced. Long ML jobs can be expensive on a phone. In landscape
the vertical timeline viewport is smaller; swipe empty lanes to reach other tracks.
For narrow clips, zoom in before trimming. Pinch zoom applies only to the timeline.
