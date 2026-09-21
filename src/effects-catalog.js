import {EFFECT_PRESETS} from './core.js';

export const EFFECT_GROUPS=[
  {name:'Favorites'},
  {name:'Audio Effects',children:['Cleanup & Restoration','EQ & Filters','Dynamics','Volume & Gain']},
  {name:'Audio Transitions'},
  {name:'Video Effects',children:['Adjust','Blur & Sharpen','Color Correction','Distort','Keying','Noise & Grain','Stylize','Transform']},
  {name:'Video Transitions'},
  {name:'Presets'}
];
// Existing preset names/values remain their stable application IDs.
export const EFFECT_CATALOG=[
  {name:'Background Noise Remover',path:['Audio Effects','Cleanup & Restoration'],target:'audio',description:'Reduce low-level noise, rumble and hum',processor:'noiseRemoval'},
  {name:'Volume',path:['Audio Effects','Volume & Gain'],target:'audio',description:'Adjust clip volume',values:{volume:100}},
  {name:'Exposure',path:['Video Effects','Adjust'],target:'video',description:'Adjust image brightness',values:{exposure:.25}},
  {name:'Blur',path:['Video Effects','Blur & Sharpen'],target:'video',description:'Soften image detail',values:{blur:5}},
  {name:'Color balance',path:['Video Effects','Color Correction'],target:'video',description:'Contrast, saturation and warmth',values:{contrast:110,saturation:110,temperature:10}},
  {name:'Monochrome',path:['Video Effects','Color Correction'],target:'video',description:'Remove image color',values:{grayscale:100}},
  {name:'Transform',path:['Video Effects','Transform'],target:'video',description:'Position, scale and rotation',values:{x:0,y:0,scale:100,rotation:0}},
  {name:'Crop',path:['Video Effects','Transform'],target:'video',description:'Trim the image edges',values:{cropTop:5,cropBottom:5,cropLeft:0,cropRight:0}},
  ...EFFECT_PRESETS.map(p=>({...p,target:p.name==='Audio fade'?'audio':'video',path:p.name==='Audio fade'?['Audio Transitions']:p.category==='Transitions'?['Video Transitions']:p.name==='Vignette'?['Video Effects','Stylize']:['Presets']}))
];
export function matchingEffects(path,query='',favorites=[]){
  const words=query.toLowerCase().trim().split(/\s+/);
  return EFFECT_CATALOG.filter(effect=>(path[0]==='Favorites'?favorites.includes(effect.name):path.every((name,i)=>effect.path[i]===name))&&words.every(word=>[...effect.path,effect.name,effect.description].join(' ').toLowerCase().includes(word)));
}
