-- Reviewable source. Coordinator creates the actual migration through Supabase CLI.
-- Originals are private. Only service-role workers can publish canonical processed outputs.
create table public.media_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_path text not null unique,
  input_size bigint not null check (input_size between 1 and 209715200),
  mime text not null check (mime in ('video/mp4', 'video/webm', 'video/quicktime')),
  idempotency_key uuid not null,
  status text not null default 'uploading' check (status in ('uploading', 'queued', 'processing', 'ready', 'failed', 'cancelled')),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  output_path text not null,
  output_size bigint,
  duration numeric,
  error_code text,
  input_deleted_at timestamptz,
  output_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (input_path = user_id::text || '/' || id::text || '/source'),
  check (output_path = user_id::text || '/processed/' || id::text || '.mp4'),
  check (status <> 'ready' or (output_size between 1 and 10485760 and duration > 0 and duration <= 10)),
  check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$')
);
create index media_processing_jobs_claim on public.media_processing_jobs (status, lease_until, created_at) where status in ('queued', 'processing');
create index media_processing_jobs_user_recent on public.media_processing_jobs (user_id, created_at desc);
create index media_processing_jobs_gc on public.media_processing_jobs (created_at) where input_deleted_at is null;

alter table public.media_processing_jobs enable row level security;
revoke all on public.media_processing_jobs from public, anon, authenticated, service_role;
grant select on public.media_processing_jobs to authenticated, service_role;
create policy media_processing_job_owner_read on public.media_processing_jobs for select to authenticated using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-processing', 'media-processing', false, 209715200, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy media_processing_input_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'media-processing' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.media_processing_jobs j where j.user_id = (select auth.uid()) and j.input_path = name and j.status = 'uploading')
);
create policy media_processing_input_select on storage.objects for select to authenticated using (
  bucket_id = 'media-processing' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.media_processing_jobs j where j.user_id = (select auth.uid()) and j.input_path = name and j.status in ('uploading', 'cancelled', 'failed'))
);
create policy media_processing_input_delete on storage.objects for delete to authenticated using (
  bucket_id = 'media-processing' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.media_processing_jobs j where j.user_id = (select auth.uid()) and j.input_path = name and j.status in ('cancelled', 'failed'))
);
-- RESTRICTIVE guards also constrain existing/future permissive product-media policies.
-- Keep the existing product-media size cap and owner delete policy unchanged.
create policy media_processed_service_insert on storage.objects as restrictive for insert to authenticated with check (
  bucket_id <> 'product-media' or coalesce((storage.foldername(name))[2], '') <> 'processed'
);
create policy media_processed_service_update on storage.objects as restrictive for update to authenticated using (
  bucket_id <> 'product-media' or coalesce((storage.foldername(name))[2], '') <> 'processed'
) with check (
  bucket_id <> 'product-media' or coalesce((storage.foldername(name))[2], '') <> 'processed'
);

create function public.reserve_product_video_job(p_key uuid, p_size bigint, p_mime text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_job public.media_processing_jobs; v_id uuid := gen_random_uuid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_key is null or p_size is null or p_size not between 1 and 209715200 or p_mime is null or p_mime not in ('video/mp4', 'video/webm', 'video/quicktime') then raise exception 'INVALID_INPUT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select * into v_job from public.media_processing_jobs where user_id = v_uid and idempotency_key = p_key;
  if found then
    if v_job.input_size <> p_size or v_job.mime <> p_mime then raise exception 'IDEMPOTENCY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(v_job);
  end if;
  if (select count(*) from public.media_processing_jobs where user_id = v_uid and status in ('uploading','queued','processing')) >= 3 then raise exception 'ACTIVE_JOB_LIMIT'; end if;
  -- Charge the full bucket cap for every reservation, including cancelled/failed jobs.
  -- Declared size/MIME cannot reduce ingress quota before upload verification.
  if (select (count(*) + 1) * 209715200 from public.media_processing_jobs where user_id = v_uid and created_at > now() - interval '24 hours') > 1073741824 then raise exception 'DAILY_BYTES_LIMIT'; end if;
  insert into public.media_processing_jobs (id,user_id,input_path,input_size,mime,idempotency_key,output_path)
  values (v_id,v_uid,v_uid::text || '/' || v_id::text || '/source',p_size,p_mime,p_key,v_uid::text || '/processed/' || v_id::text || '.mp4') returning * into v_job;
  return pg_catalog.to_jsonb(v_job);
end $$;

create function public.mark_product_video_uploaded(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_job public.media_processing_jobs; v_size numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_job from public.media_processing_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.status in ('queued','processing','ready') then return pg_catalog.to_jsonb(v_job); end if;
  if v_job.status <> 'uploading' then raise exception 'JOB_NOT_UPLOADABLE'; end if;
  select case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::numeric end into v_size
  from storage.objects where bucket_id = 'media-processing' and name = v_job.input_path;
  if v_size is null or v_size <> v_job.input_size or v_size not between 1 and 209715200 then raise exception 'INPUT_OBJECT_MISMATCH'; end if;
  update public.media_processing_jobs set status = 'queued', updated_at = now() where id = v_job.id returning * into v_job;
  return pg_catalog.to_jsonb(v_job);
end $$;

create function public.cancel_product_video_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_job public.media_processing_jobs;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into v_job from public.media_processing_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.status = 'ready' then raise exception 'JOB_ALREADY_READY'; end if;
  if v_job.status <> 'cancelled' then
    update public.media_processing_jobs set status = 'cancelled', lease_id = null, lease_until = null, updated_at = now() where id = v_job.id returning * into v_job;
  end if;
  return pg_catalog.to_jsonb(v_job);
end $$;

create function public.claim_product_video_job()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.media_processing_jobs;
begin
  update public.media_processing_jobs set status = 'failed', error_code = 'ATTEMPTS_EXHAUSTED', lease_id = null, lease_until = null, updated_at = now()
  where status = 'processing' and lease_until < now() and attempts >= 3;
  select * into v_job from public.media_processing_jobs
  where attempts < 3 and (status = 'queued' or (status = 'processing' and lease_until < now()))
  order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update public.media_processing_jobs set status = 'processing', attempts = attempts + 1,
    lease_id = gen_random_uuid(), lease_until = now() + interval '15 minutes', updated_at = now(), error_code = null
  where id = v_job.id returning * into v_job;
  return pg_catalog.to_jsonb(v_job);
end $$;

create function public.finish_product_video_job(p_job_id uuid, p_lease_id uuid, p_status text, p_output_size bigint, p_duration numeric, p_error_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ready','failed') or p_status is null then raise exception 'INVALID_FINISH_STATUS'; end if;
  if p_status = 'ready' and (p_output_size is null or p_output_size not between 1 and 10485760 or p_duration is null or p_duration <= 0 or p_duration > 10) then raise exception 'INVALID_OUTPUT'; end if;
  if p_status = 'failed' and (p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$') then raise exception 'INVALID_ERROR_CODE'; end if;
  update public.media_processing_jobs set status = p_status,
    output_size = case when p_status = 'ready' then p_output_size else null end,
    duration = case when p_status = 'ready' then p_duration else null end,
    error_code = case when p_status = 'failed' then p_error_code else null end,
    lease_id = null, lease_until = null, updated_at = now()
  where id = p_job_id and lease_id = p_lease_id and status = 'processing' and lease_until > now();
  return found;
end $$;

-- Extra worker-only GC RPCs avoid granting direct UPDATE to either users or workers.
create function public.expire_product_video_jobs()
returns void language sql security definer set search_path = '' as $$
  update public.media_processing_jobs set status = 'cancelled', error_code = 'INPUT_EXPIRED', lease_id = null, lease_until = null, updated_at = now()
  where created_at < now() - interval '24 hours' and (status in ('uploading','queued') or (status = 'processing' and lease_until < now()));
$$;
create function public.mark_product_video_input_deleted(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.media_processing_jobs set input_deleted_at = now() where id = p_job_id and status in ('ready','failed','cancelled') and input_deleted_at is null;
  return found;
end $$;

revoke all on function public.reserve_product_video_job(uuid,bigint,text) from public, anon;
revoke all on function public.mark_product_video_uploaded(uuid) from public, anon;
revoke all on function public.cancel_product_video_job(uuid) from public, anon;
grant execute on function public.reserve_product_video_job(uuid,bigint,text), public.mark_product_video_uploaded(uuid), public.cancel_product_video_job(uuid) to authenticated;
revoke all on function public.claim_product_video_job(), public.finish_product_video_job(uuid,uuid,text,bigint,numeric,text), public.expire_product_video_jobs(), public.mark_product_video_input_deleted(uuid) from public, anon, authenticated;
grant execute on function public.claim_product_video_job(), public.finish_product_video_job(uuid,uuid,text,bigint,numeric,text), public.expire_product_video_jobs(), public.mark_product_video_input_deleted(uuid) to service_role;

-- Ready worker files are provisional: current client downloads and republishes a cropped-cover copy.
-- Transition ready -> failed BEFORE Storage API deletion so no client sees a broken ready job.
create function public.expire_unlinked_product_video_outputs(p_public_base_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.media_processing_jobs; v_url text; v_rows jsonb := '[]'::jsonb;
begin
  if p_public_base_url is null or p_public_base_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' then raise exception 'INVALID_BASE_URL'; end if;
  for v_job in select j.* from public.media_processing_jobs j
    where j.output_deleted_at is null
      and ((j.status = 'ready' and j.updated_at < now() - interval '24 hours') or (j.status = 'failed' and j.error_code = 'OUTPUT_EXPIRED'))
      and not exists (select 1 from public.products_services p
        where p.imagen_principal = p_public_base_url || '/storage/v1/object/public/product-media/' || j.output_path
          or (p_public_base_url || '/storage/v1/object/public/product-media/' || j.output_path) = any(p.galeria_imagenes))
    order by j.created_at limit 100 for update of j skip locked
  loop
    v_url := p_public_base_url || '/storage/v1/object/public/product-media/' || v_job.output_path;
    if not exists (select 1 from public.products_services p where p.imagen_principal = v_url or v_url = any(p.galeria_imagenes)) then
      update public.media_processing_jobs set status = 'failed', error_code = 'OUTPUT_EXPIRED', output_size = null, duration = null, updated_at = now() where id = v_job.id;
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_job.id,'user_id',v_job.user_id,'output_path',v_job.output_path));
    end if;
  end loop;
  return v_rows;
end $$;
create function public.mark_product_video_output_deleted(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.media_processing_jobs set output_deleted_at = now() where id = p_job_id and status = 'failed' and error_code = 'OUTPUT_EXPIRED' and output_deleted_at is null;
  return found;
end $$;
revoke all on function public.expire_unlinked_product_video_outputs(text), public.mark_product_video_output_deleted(uuid) from public, anon, authenticated;
grant execute on function public.expire_unlinked_product_video_outputs(text), public.mark_product_video_output_deleted(uuid) to service_role;
