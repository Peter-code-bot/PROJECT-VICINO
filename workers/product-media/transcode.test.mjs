import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transcode, probe, inspectProbe, thumbnail, runTool, videoFilters } from './transcode.mjs';
import { processJob } from './worker.mjs';
const exec=promisify(execFile);
const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg', ffprobe=process.env.FFPROBE_PATH || 'ffprobe';
const tools={ffmpeg,ffprobe};
const directory=await mkdtemp(join(tmpdir(),'vicino-ffmpeg-test-'));
const fixtures=new Map();
async function fixture(name,{duration=2,audio=true,codec='libx264',rate=24,hdr=false}={}) {
  if(fixtures.has(name)) return fixtures.get(name);
  const path=join(directory,name);
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i',`testsrc2=size=1280x720:rate=${rate}:duration=${duration}`];
  if(audio) args.push('-f','lavfi','-i',`sine=frequency=440:sample_rate=48000:duration=${duration}`);
  args.push('-c:v',codec,'-threads','2');
  if(codec==='libx264') args.push('-preset','ultrafast');
  if(codec==='libx265') args.push('-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error');
  args.push('-pix_fmt',hdr?'yuv420p10le':'yuv420p');
  if(hdr) args.push('-color_primaries','bt2020','-color_trc','smpte2084','-colorspace','bt2020nc');
  if(audio) args.push('-c:a',codec==='libvpx-vp9'?'libopus':'aac');
  args.push('-metadata','location=+19.4000-099.1000/','-metadata','make=fixture-camera',path);
  await exec(ffmpeg,args,{timeout:120000,maxBuffer:1024*1024,windowsHide:true});
  fixtures.set(name,path); return path;
}

test('real FFmpeg: H264/AAC, silent MP4, WebM, HDR, metadata stripping, no upscale, 24/60fps', {timeout:240000},async()=>{
  const cases=[['av.mp4',{}],['silent.mp4',{audio:false}],['input.webm',{codec:'libvpx-vp9',audio:false}],['hdr.mp4',{codec:'libx265',hdr:true,audio:false}],['fast.mp4',{rate:60,audio:false}]];
  for(const [name,options] of cases) {
    const input=await fixture(name,options), output=join(directory,`${name}.final.mp4`);
    const result=await transcode(input,output,tools);
    assert.ok(result.size>0 && result.size<=10485760); assert.ok(result.duration<=10);
    inspectProbe(result.metadata.json,{output:true});
    const [n,d]=result.metadata.video.avg_frame_rate.split('/').map(Number);
    assert.equal(n/d,options.rate===60?30:24);
    const jpeg=join(directory,`${name}.jpg`); await thumbnail(output,jpeg,tools);
    assert.ok((await stat(jpeg)).size<2097152);
  }
});
test('real FFmpeg: preserve 9.9s and 10.0s boundary clips with optional AAC', {timeout:240000},async()=>{
  for(const duration of [9.9,10]) {
    const input=await fixture(`boundary-${duration}.mp4`,{duration,rate:30});
    const result=await transcode(input,join(directory,`boundary-${duration}.final.mp4`),tools);
    assert.ok(result.duration<=10 && result.duration+0.05>=duration,JSON.stringify({duration,result:result.duration}));
  }
});
test('real FFmpeg: overlong and malformed inputs reject, subprocess wall timeout kills decoder', {timeout:120000},async()=>{
  await assert.rejects(transcode(await fixture('long.mp4',{duration:10.5,audio:false}),join(directory,'long-output.mp4'),tools),/VIDEO_DURATION_LIMIT/);
  const broken=join(directory,'broken.mp4'); await writeFile(broken,'not a video');
  await assert.rejects(transcode(broken,join(directory,'broken-output.mp4'),tools),/DECODE_FAILED/);
  await assert.rejects(runTool(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:20}),/PROCESS_TIMEOUT/);
});
test('real worker pipeline: ready CAS, immutable retry adoption, cancellation and ambiguous commit preserve ready outputs', {timeout:240000},async()=>{
  const original=await fixture('worker.mp4',{audio:false});
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user='11111111-1111-4111-8111-111111111111',lease='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const base={id,user_id:user,lease_id:lease,lease_until:new Date(Date.now()+900000).toISOString(),input_path:`${user}/${id}/source`,output_path:`${user}/processed/${id}.mp4`,input_size:(await stat(original)).size,mime:'video/mp4',status:'processing'};
  let stored;
  for(const mode of ['ready','adopt','cancelled','other-lease','ambiguous']) {
    let current={...base};const removed=[];
    const api={
      download:async(bucket,_path,target)=>{if(bucket==='media-processing')await copyFile(original,target);else await writeFile(target,stored);return(await stat(target)).size;},
      upload:async(_bucket,path,file)=>{
        if(path.endsWith('.mp4')) {
          if(mode==='adopt')return false;
          stored=await readFile(file);
          if(mode==='cancelled')current={...current,status:'cancelled',lease_id:null};
          if(mode==='other-lease')current={...current,lease_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
        }
        return true;
      },
      job:async()=>current,
      rpc:async(name,params)=>{
        if(name!=='finish_product_video_job')return true;
        if(params.p_lease_id!==current.lease_id||current.status!=='processing')return false;
        current={...current,status:params.p_status};
        if(mode==='ambiguous'&&params.p_status==='ready')throw Object.assign(new Error('NETWORK_ERROR'),{name:'MediaError',code:'NETWORK_ERROR'});
        return true;
      },
      remove:async(bucket,paths)=>removed.push({bucket,paths}),
    };
    const result=await processJob(api,base,{...tools,logger:()=>{}});
    if(['ready','adopt'].includes(mode)){assert.equal(result,true);assert.equal(current.status,'ready');}
    else assert.equal(result,false);
    if(['other-lease','ambiguous'].includes(mode))assert.equal(removed.length,0,`Unsafe cleanup ${mode}`);
    if(mode==='cancelled')assert.ok(removed.some(row=>row.bucket==='product-media'));
  }
});

test.after(async()=>{await rm(directory,{recursive:true,force:true});});
