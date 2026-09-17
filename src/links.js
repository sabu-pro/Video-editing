export function linkedIds(project, ids) {
  const result=new Set(ids), groups=new Set(project.clips.filter(c=>result.has(c.id)&&c.linkId).map(c=>c.linkId));
  for(const c of project.clips)if(groups.has(c.linkId))result.add(c.id);
  return [...result];
}
export function editableIds(project, ids) {
  const selected=linkedIds(project,ids),locked=new Set(project.tracks.filter(t=>t.locked).map(t=>t.id));
  const blocked=new Set(project.clips.filter(c=>locked.has(c.track)&&c.linkId).map(c=>c.linkId));
  return selected.filter(id=>{const c=project.clips.find(c=>c.id===id);return c&&!locked.has(c.track)&&!blocked.has(c.linkId);});
}
export function unlinkClips(project,ids){
  const editable=new Set(editableIds(project,ids));
  for(const c of project.clips)if(editable.has(c.id))delete c.linkId;
}
export function linkClips(project,ids){
  const clips=project.clips.filter(c=>ids.includes(c.id));
  if(clips.length<2||editableIds(project,ids).length!==linkedIds(project,ids).length)return false;
  unlinkClips(project,ids);const linkId=crypto.randomUUID();clips.forEach(c=>c.linkId=linkId);return true;
}
