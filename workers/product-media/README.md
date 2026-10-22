# Product media worker

Reviewable local implementation; this directory does not provision or start hosted infrastructure. The coordinator creates/applies the migration from `schema.sql`. Runtime has no npm dependencies and requires Node 24 plus FFmpeg/ffprobe with libx264, AAC, zscale and tonemap.

## Contract

Authenticated RPCs (all JSONB):

- `reserve_product_video_job(p_key uuid,p_size bigint,p_mime text)` returns the job. Same key requires same size/MIME. Maximum three active jobs. Each new reservation charges the full 200 MiB bucket cap against a rolling 1 GiB budget, regardless of declared size/MIME; this permits at most five reservations (1,000 MiB) per rolling 24 hours. Cancelled/failed jobs still consume that reservation budget. Input maximum 200 MiB. The declared size remains an exact post-upload verification requirement, not a pre-upload quota discount.
- `mark_product_video_uploaded(p_job_id uuid)` checks the private Storage object and its actual metadata size, then queues it. The original has no UPDATE policy and cannot be deleted while uploading. Stop/abort the TUS upload, cancel the job through its RPC, then clean up the original through Storage API. SELECT permits uploading for HEAD/resume and terminal cancelled/failed for owner cleanup. No metadata-size predicate is added to INSERT because TUS authorization may run before object metadata exists.
- `cancel_product_video_job(p_job_id uuid)` cancels before ready; it does not delete objects through SQL.

Service RPCs:

- `claim_product_video_job()` returns one job or null; each claim issues a unique 15 minute lease and increments attempts, maximum three. Expired leases can be reclaimed. Workers consume one job at a time; separate processes use `FOR UPDATE SKIP LOCKED`.
- `finish_product_video_job(p_job_id,p_lease_id,p_status,p_output_size,p_duration,p_error_code)` returns a boolean CAS. Only a current, unexpired processing lease may complete ready/failed. Ready requires <=10 MiB and <=10 seconds.
- GC uses `expire_product_video_jobs()`, `mark_product_video_input_deleted(uuid)`, `expire_unlinked_product_video_outputs(p_public_base_url text)`, and `mark_product_video_output_deleted(uuid)`. Extra marker columns `input_deleted_at` and `output_deleted_at` make cleanup retryable without starving later jobs.

No user-supplied URLs enter the worker. Paths must be exactly `{uid}/{job}/source`, `{uid}/processed/{job}.mp4` and the derived `{job}_thumb.jpg`. Originals are private in `media-processing`; the existing product-media bucket configuration remains unchanged. Restrictive INSERT/UPDATE policies prohibit authenticated writes to the `processed` namespace even if another permissive policy exists. No new final-media DELETE permission is added.

The worker streams bounded downloads to a private temporary directory, probes before encoding, permits exactly one video and optional one audio stream, rejects unknown/overlong duration and invalid dimensions, and recodes to H264/AAC with metadata removed. It preserves input frame rates <=30 and reduces higher rates to 30; output bounds are 1280x720 or 720x1280, without upscaling. HDR uses zscale/Hable tonemapping, with an explicit error when unavailable. The frame crop remains the full source; the 512x512 thumbnail uses padding. The frontend can subsequently choose its own cover.

Subprocesses use argument arrays without a shell, have two codec threads/one filter thread, no inherited service credentials, a file/pipe protocol whitelist and a container format whitelist. Probe has a 30 second limit, encode 120 seconds, and the complete job five minutes. `-fs` is a disk safety cap: output approaching that cap is rejected, and shorter/truncated results are rejected. Input durations are verified before encoding; there is no `-t` trim.

Immutable output conflicts can recover a previous attempt only when the existing output's SHA256 equals the new deterministic encode and its probe passes. Mixed FFmpeg versions can conservatively produce `OUTPUT_CONFLICT`; deploy identical worker images together. Never overwrite an existing processed object.

## Run and verify

Provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` through the deployment secret store/environment. Do not put credentials in this directory. Optional `FFMPEG_PATH`/`FFPROBE_PATH` select local binaries.

```sh
node workers/product-media/worker.mjs --once
node workers/product-media/worker.mjs --gc
node --test --test-isolation=none workers/product-media/api.test.mjs workers/product-media/schema.test.mjs workers/product-media/transcode.test.mjs
```

`schema.test.mjs` uses the repository's existing PGlite dependency for real PostgreSQL execution; it is not a runtime worker dependency. The transcode tests require actual binaries and fail when missing. Tests generate temporary MP4, WebM and HDR fixtures; no user media or remote credentials are used. On Windows, local test binaries may live in ignored `.runtime/`; verify the distributor checksum before executing them.

`compose.yaml` provides two CPUs, 1 GiB memory, a bounded 512 MiB temporary filesystem, a read-only root filesystem, an unprivileged user and dropped capabilities. Build/run only after deployment approval using the chosen hosting provider; no provider is configured here. Docker itself must still be verified on the deployment host. Rebuild images regularly for FFmpeg security updates.

The long-running loop runs GC hourly. Original inputs are removed after ready/terminal failures when confirmed, or after 24 hours through GC. Reservation quotas bound completed-object admission conservatively; provider-level ingress/partial TUS limits remain an integration concern and are not claimed to be enforced by PostgreSQL. All object deletion uses the Storage API. Transient errors leave the lease for bounded reclaim; only explicit terminal state permits deleting canonical outputs. A lost finish response, a ready job, or another processing lease preserves outputs. Logs contain job IDs and stable codes only.

Ready worker outputs are provisional in the current client: it downloads the result and republishes a File with its chosen cover. After 24 hours in ready, GC checks exact canonical URLs in `products_services.imagen_principal` and `galeria_imagenes`, marks unlinked jobs failed/OUTPUT_EXPIRED first, then deletes their output/thumbnail through Storage API. Referenced outputs are preserved. Failed cleanup remains retryable. New gallery submissions reject processed URLs to avoid a readiness/GC publication race; existing legacy gallery entries may survive unchanged. Direct future publication of processed URLs must serialize job readiness validation and product writes against GC; the current client does not publish those URLs directly. SQL has not been applied remotely by this worker task.

## Local evidence (2026-10-22)

FFmpeg Windows 9.0.2 essentials from Gyan (linked by ffmpeg.org), distributor SHA256 verified:
`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.

Real tests cover H264/AAC, silent MP4, WebM, HEVC HDR tonemapping, metadata stripping, 24/60fps, 9.9s and 10.0s AAC boundaries, overlong/corrupt input, subprocess timeout, and real worker encoding with ready CAS, SHA retry adoption, cancellation, other-lease preservation and ambiguous ready commits. PGlite verifies executable SQL, RLS, RPC grants, idempotency, byte/active quotas, lease CAS, output limits and referenced/unlinked GC. Supabase Storage itself, Docker execution and hosted deployment remain integration checks.

Sources: [FFmpeg downloads](https://ffmpeg.org/download.html#build-windows), [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html), [Storage uploads](https://supabase.com/docs/reference/javascript/storage-from-upload).
