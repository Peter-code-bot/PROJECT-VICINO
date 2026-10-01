import 'server-only';
import { sign } from 'node:crypto';
/** Credentials and the signed provider URL never leave this server. */
export async function regionMapSnapshot(center:{lat:number;lng:number}|null,dark:boolean):Promise<ArrayBuffer>{
  const teamId=process.env.APPLE_MAPKIT_TEAM_ID,keyId=process.env.APPLE_MAPKIT_KEY_ID,raw=process.env.APPLE_MAPKIT_PRIVATE_KEY;
  if(!teamId||!keyId||!raw)throw new Error('Map unavailable');
  let key=raw.trim().replace(/\\n/g,'\n');
  if(!key.includes('-----BEGIN PRIVATE KEY-----'))key=`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  const query=new URLSearchParams({center:center?`${center.lat},${center.lng}`:'24,-102.5',size:'640x360',scale:'2',spn:center?'0.06,0.11':'21,35',lang:'es-MX',poi:'0',colorScheme:dark?'dark':'light',teamId,keyId});
  const path=`/api/v1/snapshot?${query}`;
  const signature=sign('SHA256',Buffer.from(path),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  const response=await fetch(`https://snapshot.apple-mapkit.com${path}&signature=${signature}`,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('Map unavailable');
  const reader=response.body?.getReader();if(!reader)throw new Error('Map unavailable');
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>2*1024*1024){await reader.cancel();throw new Error('Map unavailable');}chunks.push(chunk.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
