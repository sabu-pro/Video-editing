import {test,expect} from '@playwright/test';
test('clip overlays stay isolated and the rendered effect survives browser encoding',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {MediaEngine}=await import('/src/engine.js'),{createProject,createClip}=await import('/src/core.js');
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const p=createProject();p.width=320;p.height=180;
    const bottom=createClip({type:'color',name:'Blue',duration:2},'v1',0,{color:'#0000ff'});
    const top=createClip({type:'color',name:'Red',duration:2},'v2',0,{color:'#ff0000'});top.effects.scale=50;top.effects.temperature=100;top.effects.vignette=50;
    p.clips=[bottom,top];const engine=new MediaEngine(canvas,new Map(),()=>p);engine.sync(.5,false);
    const pixel=(x,y)=>Array.from(canvas.getContext('2d').getImageData(x,y,1,1).data);
    const corner=pixel(5,5),active=pixel(160,90);
    top.effectBypass=['temperature','vignette'];engine.render();const bypass=pixel(160,90);
    top.effectBypass=[];engine.render();
    const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
    const stopped=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
    recorder.start();const paint=setInterval(()=>{engine.render();track.requestFrame();},1000/30);await new Promise(r=>setTimeout(r,1000));recorder.stop();await stopped;clearInterval(paint);stream.getTracks().forEach(t=>t.stop());
    const video=document.createElement('video'),url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));video.muted=true;
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error(`Encoded effect fixture cannot be decoded: ${video.error?.message}; ${chunks.reduce((n,c)=>n+c.size,0)} bytes`));video.src=url;});
    canvas.getContext('2d').drawImage(video,0,0);const exported=pixel(160,90);video.removeAttribute('src');video.load();URL.revokeObjectURL(url);engine.reset();
    return {corner,active,bypass,exported};
  });
  expect(result.corner).toEqual([0,0,255,255]);expect(result.active).not.toEqual(result.bypass);
  for(let i=0;i<3;i++)expect(Math.abs(result.exported[i]-result.active[i])).toBeLessThan(15);
});

test('effect bypass preserves authored values and reset removes its animation',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();await page.locator('.timeline-clip.image').first().click();
  await page.getByRole('checkbox',{name:'Enable Scale',exact:true}).uncheck();await expect(page.locator('#effect-scale')).not.toHaveValue('100');
  await page.getByRole('checkbox',{name:'Enable Scale',exact:true}).check();await page.getByRole('button',{name:'Reset Scale',exact:true}).click();
  await expect(page.locator('#effect-scale')).toHaveValue('100');await expect(page.locator('[data-keyframe="scale"]')).not.toHaveClass(/active/);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-keyframe="scale"]')).toHaveClass(/active/);
});
