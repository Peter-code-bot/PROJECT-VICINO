import { z } from 'zod';
import { MAP_AREA } from '@vicino/shared';
import { regionMapSnapshot } from '@/lib/geo/region-map-snapshot';
import { frenoEnMemoria } from '@/lib/freno-en-memoria';
import { enforce, getClientIp, readHeavyRateLimit } from '@/lib/rate-limit';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const quota=frenoEnMemoria({tope:15,ventanaMs:60_000});
const schema=z.object({center:z.object({lat:z.number().finite().min(MAP_AREA.south).max(MAP_AREA.north),lng:z.number().finite().min(MAP_AREA.west).max(MAP_AREA.east)}).strict().nullable(),theme:z.enum(['light','dark'])}).strict();
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){
  const ip=getClientIp(request.headers);
  if(!quota.permitir(`preview:${ip}`)||!(await enforce(readHeavyRateLimit,`preview:${ip}`)).ok)return Response.json({error:'Espera antes de cambiar el mapa.'},{status:429,headers:{...headers,'Retry-After':'60'}});
  try{
    const reader=request.body?.getReader();if(!reader)return Response.json({error:'Consulta inválida.'},{status:400,headers});
    let body='';const decoder=new TextDecoder();let size=0;
    while(true){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>1024){await reader.cancel();return Response.json({error:'Consulta demasiado grande.'},{status:413,headers});}body+=decoder.decode(c.value,{stream:true});}
    body+=decoder.decode();
    let input:unknown;
    try{input=JSON.parse(body);}catch{return Response.json({error:'Consulta inválida.'},{status:400,headers});}
    const parsed=schema.safeParse(input);
    if(!parsed.success)return Response.json({error:'Elige una ubicación en México.'},{status:400,headers});
    return new Response(await regionMapSnapshot(parsed.data.center,parsed.data.theme==='dark'),{headers:{...headers,'Content-Type':'image/png'}});
  }catch{return Response.json({error:'No pudimos cargar el preview.'},{status:503,headers});}
}
