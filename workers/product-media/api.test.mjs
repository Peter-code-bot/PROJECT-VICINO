import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJob, createApi } from './api.mjs';
import { inspectProbe } from './transcode.mjs';
import { collectGarbage } from './worker.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user='11111111-1111-4111-8111-111111111111';
const job={id,user_id:user,lease_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',input_size:10,mime:'video/mp4',input_path:`${user}/${id}/source`,output_path:`${user}/processed/${id}.mp4`};
const api = fetcher => createApi({url:'https://fixture.supabase.co',key:'test-placeholder-not-a-credential',fetcher});

test('canonical job rejects URL/path injection and enforces input cap',()=>{
  assert.equal(canonicalJob(job).output,job.output_path);
  assert.throws(()=>canonicalJob({...job,input_path:'https://attacker.invalid/source'}),/INVALID_JOB/);
  assert.throws(()=>canonicalJob({...job,input_size:209715201}),/INVALID_JOB/);
  assert.throws(()=>createApi({url:'http://fixture.supabase.co',key:'test'}),/INVALID_CONFIGURATION/);
});
test('fixed origin, no redirects, bounded HTTP JSON and status checks',async()=>{
  let requested;
  const client=api(async(url,init)=>{requested={url,init};return new Response('true');});
  assert.equal(await client.rpc('claim_product_video_job'),true);
  assert.equal(requested.url,'https://fixture.supabase.co/rest/v1/rpc/claim_product_video_job');
  assert.equal(requested.init.redirect,'error');
  await assert.rejects(api(async()=>new Response('{}',{status:503})).rpc('claim_product_video_job'),/HTTP_503/);
  await assert.rejects(api(async()=>new Response('x'.repeat(128*1024+1))).rpc('claim_product_video_job'),/RESPONSE_TOO_LARGE/);
  assert.equal(await api(async()=>new Response(null,{status:204})).rpc('expire_product_video_jobs'),null);
});
test('streamed downloads enforce actual bytes, even without content-length',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vicino-api-test-'));
  try {
    await assert.rejects(api(async()=>new Response('01234567890')).download('media-processing',job.input_path,join(directory,'oversized'),10,10),/DOWNLOAD_SIZE_LIMIT/);
    await assert.rejects(api(async()=>new Response('tiny', {headers:{'content-length':'500'}})).download('media-processing',job.input_path,join(directory,'header'),10,10),/INPUT_SIZE_MISMATCH/);
    assert.equal(await api(async()=>new Response('0123456789')).download('media-processing',job.input_path,join(directory,'valid'),10,10),10);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('probe rejects unknown duration, excessive dimensions and extra/malicious streams',()=>{
  const metadata={format:{duration:'2'},streams:[{codec_type:'video',width:1920,height:1080}]};
  assert.equal(inspectProbe(metadata).duration,2);
  assert.throws(()=>inspectProbe({...metadata,format:{duration:'N/A'}}),/VIDEO_DURATION_LIMIT/);
  assert.throws(()=>inspectProbe({...metadata,format:{duration:'10.01'}}),/VIDEO_DURATION_LIMIT/);
  assert.throws(()=>inspectProbe({...metadata,streams:[{...metadata.streams[0],width:9000}]}),/INVALID_DIMENSIONS/);
  assert.throws(()=>inspectProbe({...metadata,streams:[...metadata.streams,{codec_type:'attachment'}]}),/UNSUPPORTED_STREAMS/);
});
test('GC deletes original inputs and only outputs returned after SQL expiry, never arbitrary paths',async()=>{
  const deleted=[],calls=[];
  const client={publicBaseUrl:'https://fixture.supabase.co',garbage:async()=>[{id,user_id:user,input_path:job.input_path}],remove:async(bucket,paths)=>deleted.push({bucket,paths}),rpc:async(name,params)=>{calls.push({name,params});return name==='expire_unlinked_product_video_outputs'?[{id,user_id:user,output_path:job.output_path}]:true;}};
  await collectGarbage(client,{logger:()=>{}});
  assert.deepEqual(deleted,[{bucket:'media-processing',paths:[job.input_path]},{bucket:'product-media',paths:[job.output_path,job.output_path.replace('.mp4','_thumb.jpg')]}]);
  assert.equal(calls[1].name,'expire_unlinked_product_video_outputs');
  await assert.rejects(collectGarbage({...client,garbage:async()=>[{id,user_id:user,input_path:'../other-owner'}]},{logger:()=>{}}),/INVALID_JOB/);
});
