export async function makeAVFixture(page, withAudio=true, seconds=4, tones={}){
  const base64=await page.evaluate(async({withAudio,seconds,tones})=>{
    const {finalizeWebm}=await import('/src/webm.js');
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');
    const stream=canvas.captureStream(30),audio=new AudioContext(),destination=audio.createMediaStreamDestination(),merger=audio.createChannelMerger(2),oscillators=[];
    if(withAudio){for(let i=0;i<2;i++){const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=tones.frequencies?.[i]??(i?660:440);gain.gain.value=tones.levels?.[i]??(i?.12:.6);osc.connect(gain);gain.connect(merger,0,i);osc.start();oscillators.push(osc);}merger.connect(destination);stream.addTrack(destination.stream.getAudioTracks()[0]);}
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'+(withAudio?',opus':'')}),chunks=[];
    const stopped=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
    let frame=0;const paint=()=>{ctx.fillStyle='#00cc00';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ef4680';ctx.fillRect(40+(frame++%80),45,80,90);ctx.fillStyle='#fff';ctx.font='20px Arial';ctx.fillText('FRAME '+frame,10,25);};paint();
    const interval=setInterval(paint,1000/30);recorder.start();await new Promise(r=>setTimeout(r,seconds*1000));recorder.stop();await stopped;clearInterval(interval);oscillators.forEach(o=>o.stop());await audio.close();stream.getTracks().forEach(t=>t.stop());
    const blob=await finalizeWebm(new Blob(chunks,{type:'video/webm'}),seconds);
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
  },{withAudio,seconds,tones});
  return {name:withAudio?'stereo-video.webm':'silent-video.webm',mimeType:'video/webm',buffer:Buffer.from(base64,'base64')};
}
export async function blankProject(page){await page.locator('[data-menu="file"]').click();await page.locator('[data-action="new"]').click();await page.getByRole('button',{name:'Create project',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length===0);}
export async function sessionProject(page){await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='Saved locally');return page.evaluate(async()=>{const {openDatabase,dbRead}=await import('/src/engine.js');const db=await openDatabase();const session=await dbRead(db,'session','current');db.close();return session.project;});}

export function makeNoiseFixture(seconds=4){
  const rate=48000,frames=rate*seconds,buffer=Buffer.alloc(44+frames*4);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);
  buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*4,28);
  buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(frames*4,40);
  let seed=123;for(let i=0;i<frames;i++)for(let ch=0;ch<2;ch++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;buffer.writeInt16LE(Math.round((seed/2147483648-1)*(ch?.04:.12)*32767),44+i*4+ch*2);}
  return {name:'continuous-stereo-noise.wav',mimeType:'audio/wav',buffer};
}
