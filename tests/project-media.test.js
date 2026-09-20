import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createClip,removeProjectAsset,History,validateProject} from '../src/core.js';

test('Remove from Project protects media used by timeline clips',()=>{
  const p=createProject();p.clips.push(createClip({id:'used',name:'Video',type:'video',duration:4},'v1'));
  const before=structuredClone(p);assert.equal(removeProjectAsset(p,'used'),false);assert.deepEqual(p,before);
});
test('project media removal supports history and save/load without stale references',()=>{
  const p=createProject(),history=new History();p.mediaReferences={unused:{name:'Unused'}};history.push(p);
  assert.equal(removeProjectAsset(p,'unused'),true);assert.equal(removeProjectAsset(p,'unused'),false);
  assert.equal(p.mediaReferences.unused,undefined);
  const saved=validateProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(saved.removedAssetIds,['unused']);
  const restored=history.undo(saved);assert.ok(restored.mediaReferences.unused);assert.equal(restored.removedAssetIds,undefined);
  assert.deepEqual(history.redo(restored).removedAssetIds,['unused']);
});
