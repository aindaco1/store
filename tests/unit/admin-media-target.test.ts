// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const source=readFileSync('assets/js/admin-dashboard.js','utf8');
const shared=readFileSync('shared/dust-wave-platform/packages/admin-shell/src/editor-media-browser.js','utf8');
function functions(names:string[]) {return names.map(name=>source.match(new RegExp('^  function '+name+'[(][^]*?^  }','m'))![0]).join('\n');}

function editor(type='image') {
  const image={src:'old'}, block=type==='gallery'?{type,images:[image]}:{type,src:'old'};
  const context={root:{isConnected:true},blocks:[block,{type:'image',src:'other'}]};
  const sandbox:any={window:null};sandbox.window=sandbox;
  vm.runInNewContext(shared+'\n'+functions(['storeProductDescriptionUploadTarget','storeProductDescriptionTargetIndex']),sandbox);
  const target=sandbox.storeProductDescriptionUploadTarget(context,{dataset:{contentIndex:'0',...(type==='gallery'?{contentImageIndex:'0'}:{})}});
  return {context,block,target,index:()=>sandbox.storeProductDescriptionTargetIndex(context,target)};
}
describe('product media target identity',()=>{
  it('follows reorder instead of overwriting the next block',()=>{const e=editor();e.context.blocks.reverse();expect(e.index()).toBe(1);});
  it('rejects deleted and replaced blocks',()=>{const e=editor();e.context.blocks[0]={type:'image',src:'replacement'};expect(e.index()).toBe(-1);});
  it('rejects detached editors',()=>{const e=editor();e.context.root.isConnected=false;expect(e.index()).toBe(-1);});
  it('rejects deleted gallery members',()=>{const e=editor('gallery');e.block.images!.splice(0);expect(e.index()).toBe(-1);});
});
