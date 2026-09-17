// Project files keep seconds for v1 compatibility. All edit decisions use
// integer sequence frames; source offsets retain full source precision.
export const toFrame = (time, fps) => Math.round(time * fps + Number.EPSILON);
export const fromFrame = (frame, fps) => frame / fps;
export const quantize = (time, fps) => fromFrame(toFrame(time, fps), fps);
export const floorFrames = (time, fps) => Math.floor(time * fps + 1e-7);
export const endFrame = (clip, fps) => toFrame(clip.start, fps) + toFrame(clip.duration, fps);
export const endTime = (clip, fps) => fromFrame(endFrame(clip, fps), fps);
export function normalizeTiming(clip, fps) {
  clip.start = Math.max(0, quantize(clip.start, fps));
  clip.duration = Math.max(1, toFrame(clip.duration, fps)) / fps;
  return clip;
}
export class FrameClock {
  start(time, now, rate = 1) { this.anchor = time; this.started = now; this.rate = rate; }
  time(now, fps) { return quantize(this.anchor + (now - this.started) * this.rate, fps); }
}
