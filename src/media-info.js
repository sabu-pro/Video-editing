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
