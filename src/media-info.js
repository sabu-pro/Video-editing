// Header-only track detection; does not decode/copy a complete large movie.
async function mp4Audio(blob){
  const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const type=(b,o)=>String.fromCharCode(...b.subarray(o,o+4));
  async function walk(start,end,depth=0){
    if(depth>5)return false;
    for(let pos=start;pos+8<=end;){
      const b=new Uint8Array(await blob.slice(pos,pos+32).arrayBuffer());if(b.length<8)break;
      let size=view(b).getUint32(0),header=8;const name=type(b,4);
      if(size===1){size=Number(view(b).getBigUint64(8));header=16;}if(size===0)size=end-pos;
      if(size<header||pos+size>end)break;
      if(name==='hdlr'){const h=new Uint8Array(await blob.slice(pos+header,pos+header+12).arrayBuffer());if(type(h,8)==='soun')return true;}
      if(['moov','trak','mdia'].includes(name)&&await walk(pos+header,pos+size,depth+1))return true;
      pos+=size;
    }return false;
  }
  return walk(0,blob.size);
}
function ebmlVint(b,pos,id=false){let mask=128,width=1;while(width<8&&!(b[pos]&mask)){width++;mask>>=1;}if(pos+width>b.length||!b[pos])throw Error('Incomplete header');let n=id?b[pos]:b[pos]&(mask-1);for(let i=1;i<width;i++)n=n*256+b[pos+i];return {value:n,width};}
function webmAudio(b){
  let found=false;
  function walk(start,end,depth=0){
    if(depth>5)return false;
    for(let p=start;p<end;){const id=ebmlVint(b,p,true),len=ebmlVint(b,p+id.width),data=p+id.width+len.width,next=Math.min(end,data+len.value);
      if(id.value===0x1654ae6b)found=true;
      if(id.value===0x83&&b[data]===2)return true;
      if([0x18538067,0x1654ae6b,0xae].includes(id.value)&&walk(data,next,depth+1))return true;
      if(next<=p)break;p=next;
    }return false;
  }
  try{const yes=walk(0,b.length);return yes?true:found?false:null;}catch{return null;}
}
export async function detectAudioTrack(blob){
  const head=new Uint8Array(await blob.slice(0,Math.min(blob.size,2*1024*1024)).arrayBuffer());
  if(head[0]===0x1a&&head[1]===0x45&&head[2]===0xdf&&head[3]===0xa3)return webmAudio(head);
  if(String.fromCharCode(...head.subarray(4,8))==='ftyp')return mp4Audio(blob);
  return null;
}

export async function analyzeMedia(file) {
  let type=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':null;
  if(!type) {const ext=file.name.split('.').pop().toLowerCase();type=['mp4','webm','mov','m4v','ogv'].includes(ext)?'video':['mp3','wav','ogg','m4a','aac','flac'].includes(ext)?'audio':['jpg','jpeg','png','webp','gif','avif','svg'].includes(ext)?'image':null;}
  if(!type)throw new Error(`${file.name}: unsupported file type.`);
  const asset={id:crypto.randomUUID(),name:file.name,type,url:URL.createObjectURL(file),blob:file,size:file.size,duration:5,width:0,height:0};
  let probe;
  try {
    if(type==='image') {
      const img=new Image();img.src=asset.url;await img.decode();asset.width=img.naturalWidth;asset.height=img.naturalHeight;asset.thumb=thumbnail(img);
    } else {
      const el=probe=document.createElement(type);el.preload='auto';el.src=asset.url;el.muted=true;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Media took too long to load')),20000);
        el.onloadeddata=()=>{clearTimeout(timer);resolve();};el.onerror=()=>{clearTimeout(timer);reject(new Error('This browser cannot decode the media codec'));};
      });
      if(!Number.isFinite(el.duration)) {
        // Live-recorded WebM often omits its duration. Seeking to the end lets
        // the demuxer discover it without rejecting otherwise valid footage.
        await new Promise(resolve=>{
          const done=()=>{clearTimeout(timer);el.removeEventListener('durationchange',changed);el.removeEventListener('seeked',done);resolve();};
          const changed=()=>{if(Number.isFinite(el.duration))done();};
          const timer=setTimeout(done,5000);el.addEventListener('durationchange',changed);el.addEventListener('seeked',done);el.currentTime=1e10;
        });
        if(Number.isFinite(el.duration)&&el.duration>0){
          el.currentTime=0;await new Promise(resolve=>{const timer=setTimeout(resolve,2000);el.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});});
        }
      }
      if(!Number.isFinite(el.duration)||el.duration<=0) {el.removeAttribute('src');el.load();throw new Error('Media has no readable duration. Try converting it to a standard MP4, WebM or WAV file.');}
      asset.duration=el.duration;asset.width=el.videoWidth||0;asset.height=el.videoHeight||0;
      if(type==='video')asset.thumb=thumbnail(el);
      el.removeAttribute('src');el.load();
    }
    asset.hasAudio=type==='audio'?true:type==='image'?false:await detectAudioTrack(file);
    return asset;
  } catch(e) {URL.revokeObjectURL(asset.url);throw new Error(`${file.name}: ${e.message}`);} finally {if(probe){probe.onloadeddata=null;probe.onerror=null;probe.removeAttribute('src');probe.load();}}
}
function thumbnail(source) {
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  const ctx=canvas.getContext('2d'),w=source.videoWidth||source.naturalWidth,h=source.videoHeight||source.naturalHeight;
  const r=Math.max(320/w,180/h);ctx.drawImage(source,(320-w*r)/2,(180-h*r)/2,w*r,h*r);return canvas.toDataURL('image/jpeg',0.7);
}
