import { quantize, toFrame, endTime } from './timing.js';

export function resolveSnap(project, { time, offsets = [0], exclude = [], playhead = null, zoom = 36, pixels = 8, enabled = true, bypass = false, min = 0, max = Infinity }) {
  const fps = project.fps;
  const legal = value => Math.max(Math.ceil(min * fps - 1e-7), Math.min(Math.floor(max * fps + 1e-7), toFrame(value, fps))) / fps;
  const base = legal(time);
  if (!enabled || bypass) return { time: base, point: null };
  const excluded = new Set(exclude), targets = [{ time: 0, kind: 'Start' }];
  if (Number.isFinite(playhead)) targets.push({ time: quantize(playhead, fps), kind: 'Playhead' });
  for (const m of project.markers) targets.push({ time: quantize(m.time, fps), kind: 'Marker' });
  for (const c of project.clips) if (!excluded.has(c.id)) {
    targets.push({ time: quantize(c.start, fps), kind: 'Clip start' }, { time: endTime(c, fps), kind: 'Clip end' });
  }
  let result = { time: base, point: null }, best = pixels / Math.max(zoom, .001) + 1e-9;
  for (const offset of offsets) for (const target of targets) {
    const candidate = quantize(target.time - offset, fps);
    if (candidate < min - 1e-8 || candidate > max + 1e-8) continue;
    const distance = Math.abs(candidate - time);
    if (distance < best) { best = distance; result = { time: candidate, point: target.time, kind: target.kind }; }
  }
  return result;
}
