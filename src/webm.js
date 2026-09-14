// Add a finite duration to the live WebM produced by MediaRecorder.
// Element IDs and timestamp units: https://www.matroska.org/technical/elements.html
function vint(bytes,offset,isId=false){
  const first=bytes[offset];if(!first)throw new Error('Invalid EBML');
  let width=1,mask=0x80;while(!(first&mask)&&width<8){mask>>=1;width++;}
  if(offset+width>bytes.length)throw new Error('Truncated EBML');
  let value=BigInt(isId?first:first&(mask-1));
  for(let i=1;i<width;i++)value=(value<<8n)|BigInt(bytes[offset+i]);
  return {width,value,unknown:!isId&&value===(1n<<BigInt(7*width))-1n};
}
function element(bytes,offset){
  const id=vint(bytes,offset,true),size=vint(bytes,offset+id.width),data=offset+id.width+size.width;
  return {id:Number(id.value),offset,sizeOffset:offset+id.width,sizeWidth:size.width,size:size.unknown?bytes.length-data:Number(size.value),unknown:size.unknown,data,end:size.unknown?bytes.length:data+Number(size.value)};
}
function encodeSize(value,width){
  let n=BigInt(value);if(n>=(1n<<BigInt(7*width))-1n)throw new Error('EBML size overflow');
  n|=1n<<BigInt(7*width);const result=new Uint8Array(width);for(let i=width-1;i>=0;i--){result[i]=Number(n&255n);n>>=8n;}return result;
}
export async function finalizeWebm(blob,seconds){
  if(!(seconds>0))return blob;
  try{
    const bytes=new Uint8Array(await blob.arrayBuffer());let segment;
    for(let pos=0;pos<bytes.length;){const e=element(bytes,pos);if(e.id===0x18538067){segment=e;break;}if(e.end<=pos)break;pos=e.end;}
    if(!segment)return blob;
    let info,hasIndex=false;
    for(let pos=segment.data;pos<segment.end;){const e=element(bytes,pos);if(e.id===0x1549a966)info=e;if(e.id===0x114d9b74||e.id===0x1c53bb6b)hasIndex=true;if(e.end<=pos)break;pos=e.end;}
    if(!info)return blob;
    let scale=1000000,durationElement,crc=false;
    for(let pos=info.data;pos<info.end;){const e=element(bytes,pos);if(e.id===0x2ad7b1){scale=0;for(let i=e.data;i<e.end;i++)scale=scale*256+bytes[i];}if(e.id===0x4489)durationElement=e;if(e.id===0xbf)crc=true;if(e.end<=pos)break;pos=e.end;}
    if(crc)return blob;
    const ticks=seconds*1e9/scale;
    if(durationElement&&(durationElement.size===8||durationElement.size===4)){
      const view=new DataView(bytes.buffer);durationElement.size===8?view.setFloat64(durationElement.data,ticks):view.setFloat32(durationElement.data,ticks);return new Blob([bytes],{type:blob.type});
    }
    // Indexed containers need offset rewriting; preserve those untouched.
    if(hasIndex)return blob;
    const extra=new Uint8Array(11);extra.set([0x44,0x89,0x88]);new DataView(extra.buffer).setFloat64(3,ticks);
    const infoSize=encodeSize(info.size+extra.length,info.sizeWidth);
    bytes.set(infoSize,info.sizeOffset);
    if(!segment.unknown)bytes.set(encodeSize(segment.size+extra.length,segment.sizeWidth),segment.sizeOffset);
    return new Blob([bytes.subarray(0,info.end),extra,bytes.subarray(info.end)],{type:blob.type});
  }catch{return blob;}
}
