// One SVG path per waveform instead of hundreds of DOM bars. Each bin uses
// its actual maximum source peak, so zooming out cannot hide transients.
export function waveformPath(asset, clip, width=400){
  if(!asset?.peaks?.length||!asset.duration)return '';
  const bins=Math.min(600,Math.max(1,Math.round(width/3))),peaks=asset.peaks;
  let path='';
  for(let i=0;i<bins;i++){
    const a=(clip.sourceIn+i/bins*clip.duration*clip.speed)/asset.duration*peaks.length;
    const b=(clip.sourceIn+(i+1)/bins*clip.duration*clip.speed)/asset.duration*peaks.length;
    let peak=0;for(let j=Math.max(0,Math.floor(a));j<Math.min(peaks.length,Math.max(Math.ceil(b),Math.floor(a)+1));j++)peak=Math.max(peak,peaks[j]);
    const x=((i+.5)/bins*1000).toFixed(2),h=Math.min(48,peak*48).toFixed(2);
    path+=`M${x} ${(50-Number(h)).toFixed(2)}V${(50+Number(h)).toFixed(2)}`;
  }
  return path;
}
