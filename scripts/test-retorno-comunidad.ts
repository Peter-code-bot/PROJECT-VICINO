import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextCommunityNavigation as next, communityReturn } from '../apps/web/lib/navigation/retorno-comunidad';

const root='/comunidades/one';
test('five visits to administration return to the actual origin without push loops',()=>{
  const origin=next(null,'/buscar?q=grupo',true);
  const community=next(origin,root,false);
  for(let i=0;i<5;i++){
    const admin=next(community,root+'/administrar',false);
    assert.deepEqual(communityReturn(admin,admin.path,'one',true),{back:true,href:root});
    assert.deepEqual(communityReturn(community,root,'one',false),{back:true,href:origin.path});
  }
});
test('direct admin and reload preserve safe fallback without guessing history length',()=>{
  const admin=next(null,root+'/administrar',true);
  assert.deepEqual(communityReturn(JSON.parse(JSON.stringify(admin)),admin.path,'one',true),{back:false,href:root});
  const community=next(admin,root,true);
  assert.deepEqual(communityReturn(community,root,'one',false),{back:false,href:'/'});
});
test('different communities have distinct origins and back/forward restores entry state',()=>{
  const first=next(next(null,'/perfil',true),root,false);
  const second=next(first,'/comunidades/two',false);
  assert.deepEqual(communityReturn(second,second.path,'two',false),{back:true,href:root});
  assert.deepEqual(communityReturn(first,root,'one',false),{back:true,href:'/perfil'});
});
test('untracked or old push-loop entries never go back to administration',()=>{
  assert.deepEqual(communityReturn(null,root,'one',false),{back:false,href:'/'});
  const admin=next(next(next(null,'/',true),root,false),root+'/administrar',false);
  const oldLoop=next(admin,root,false);
  assert.deepEqual(communityReturn(oldLoop,root,'one',false),{back:false,href:'/'});
});
test('unsafe, mismatched and auth origins fall back internally',()=>{
  for(const path of ['//evil.invalid','/\\evil.invalid','/login','/comunidades/one/administrar']){
    const entry=next(next(null,path,true),root,false);
    assert.equal(communityReturn(entry,root,'one',false).href,'/');
  }
  assert.deepEqual(communityReturn(next(null,'/perfil',true),root,'one',false),{back:false,href:'/'});
});
