package com.vicino.mx;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.FrameDropEffect;
import androidx.media3.effect.Presentation;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.InAppMp4Muxer;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.UUID;

/** No caller-supplied paths/URIs. All work stays in one app-private cache session. */
@UnstableApi
@CapacitorPlugin(name = "VicinoVideo")
public class VicinoVideoPlugin extends Plugin {
    private static final long INPUT_MAX = 200L * 1024 * 1024;
    private static final long OUTPUT_MAX = 10L * 1024 * 1024;
    private static final int CHUNK_MAX = 192 * 1024;
    private static final long TTL_MS = 15 * 60 * 1000;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Session active;

    private static final class Session {
        final String id = UUID.randomUUID().toString();
        final long expected;
        final File dir, input, output;
        long written;
        int[] source;
        boolean finishing;
        Transformer transformer;
        PluginCall pending;
        Session(File root, long size) {
            expected = size;
            dir = new File(root, id);
            input = new File(dir, "input");
            output = new File(dir, "output.mp4");
        }
    }

    @Override public void load() {
        File[] dirs = root().listFiles();
        if (dirs != null) for (File dir : dirs) {
            if (dir.getName().matches("[0-9a-f-]{36}") && System.currentTimeMillis() - dir.lastModified() > TTL_MS) erase(dir);
        }
    }

    private File root() { return new File(getContext().getCacheDir(), "vicino-video"); }
    private static void erase(File dir) {
        // Only our fixed filenames; never follow arbitrary directory trees or links.
        new File(dir, "input").delete();
        new File(dir, "output.mp4").delete();
        dir.delete();
    }
    private Session session(PluginCall call) {
        String id = call.getString("id", "");
        if (active == null || !active.id.equals(id)) throw new IllegalArgumentException("Sesión de video inválida");
        return active;
    }

    @PluginMethod public synchronized void begin(PluginCall call) {
        try {
            Long size = call.getLong("size");
            if (active != null) throw new IllegalStateException("Ya se está preparando otro video");
            if (size == null || size <= 0 || size > INPUT_MAX) throw new IllegalArgumentException("Video mayor a 200 MB");
            Session s = new Session(root(), size);
            if (!s.dir.mkdirs()) throw new IllegalStateException("No se pudo crear el cache de video");
            active = s;
            main.postDelayed(() -> cancelSession(s, "Preparación de video expirada"), TTL_MS);
            call.resolve(new JSObject().put("id", s.id));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public synchronized void writeChunk(PluginCall call) {
        try {
            Session s = session(call);
            Long offset = call.getLong("offset");
            String encoded = call.getString("data", "");
            if (s.finishing || offset == null || offset != s.written || encoded.isEmpty() || encoded.length() > CHUNK_MAX / 3 * 4) {
                throw new IllegalArgumentException("Bloque de video inválido");
            }
            if (!encoded.matches("[A-Za-z0-9+/]*={0,2}")) throw new IllegalArgumentException("Codificación inválida");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > CHUNK_MAX || s.written + bytes.length > s.expected) throw new IllegalArgumentException("Tamaño inválido");
            try (FileOutputStream stream = new FileOutputStream(s.input, true)) { stream.write(bytes); }
            s.written += bytes.length;
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public synchronized void finish(PluginCall call) {
        try {
            Session s = session(call);
            if (s.finishing || s.written != s.expected) throw new IllegalStateException("Video incompleto");
            s.finishing = true;
            s.pending = call;
            // Transformer requires all access on one looper, including cancellation/progress.
            main.post(() -> transcode(s));
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    private synchronized void transcode(Session s) {
        if (active != s) return;
        try {
            int[] dimensions = inspect(s.input, false);
            s.source = dimensions;
            int width = dimensions[0], height = dimensions[1];
            float scale = Math.min(1f, Math.min(1280f / Math.max(width, height), 720f / Math.min(width, height)));
            int outW = Math.max(2, (int) (width * scale) / 2 * 2);
            int outH = Math.max(2, (int) (height * scale) / 2 * 2);
            EditedMediaItem item = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(s.input)))
                .setEffects(new Effects(Collections.emptyList(), Arrays.asList(
                    Presentation.createForWidthAndHeight(outW, outH, Presentation.LAYOUT_SCALE_TO_FIT),
                    FrameDropEffect.createDefaultFrameDropEffect(30))))
                .build();
            s.transformer = new Transformer.Builder(getContext())
                .setMuxerFactory(new InAppMp4Muxer.Factory(metadata -> metadata.clear()))
                .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(new DefaultEncoderFactory.Builder(getContext())
                    .setEnableFallback(false)
                    .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder().setBitrate(4_000_000).build()).build())
                .addListener(new Transformer.Listener() {
                    @Override public void onCompleted(Composition composition, ExportResult result) { complete(s); }
                    @Override public void onError(Composition composition, ExportResult result, ExportException error) {
                        cancelSession(s, "No se pudo preparar el video en este dispositivo");
                    }
                }).build();
            Composition composition = new Composition.Builder(new EditedMediaItemSequence.Builder(item).build())
                .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build();
            s.transformer.start(composition, s.output.getAbsolutePath());
            poll(s);
        } catch (Exception e) { cancelSession(s, "Video inválido o incompatible: " + e.getMessage()); }
    }

    private synchronized void poll(Session s) {
        if (active != s || s.pending == null || s.transformer == null) return;
        if (s.output.length() > OUTPUT_MAX) { cancelSession(s, "Video preparado mayor a 10 MB"); return; }
        ProgressHolder progress = new ProgressHolder();
        if (s.transformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
            notifyListeners("progress", new JSObject().put("id", s.id).put("progress", progress.progress / 100.0));
        }
        main.postDelayed(() -> poll(s), 250);
    }

    private synchronized void complete(Session s) {
        if (active != s || s.pending == null) return;
        try {
            int[] dimensions = inspect(s.output, true);
            if (dimensions[0] > s.source[0] || dimensions[1] > s.source[1] || Math.abs(dimensions[2] - s.source[2]) > 100) {
                throw new IllegalArgumentException("Dimensiones o duración de salida inválidas");
            }
            long size = s.output.length();
            if (size <= 0 || size > OUTPUT_MAX) throw new IllegalArgumentException("Video preparado mayor a 10 MB");
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            double duration;
            try { retriever.setDataSource(s.output.getAbsolutePath()); duration = Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) / 1000.0; }
            finally { retriever.release(); }
            PluginCall call = s.pending;
            s.pending = null;
            s.transformer = null;
            s.input.delete();
            call.resolve(new JSObject().put("uri", Uri.fromFile(s.output).toString()).put("size", size).put("duration", duration));
        } catch (Exception e) { cancelSession(s, "Video preparado fuera de límites"); }
    }

    /** Native duration admission, output codec/dimensions and location verification. */
    private int[] inspect(File file, boolean output) throws Exception {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        int width, height, durationMs;
        try {
            retriever.setDataSource(file.getAbsolutePath());
            long duration = Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            if (duration <= 0 || duration > 10_000) throw new IllegalArgumentException("El video debe durar hasta 10 segundos");
            durationMs = (int) duration;
            width = Integer.parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            height = Integer.parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            String rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            if ("90".equals(rotation) || "270".equals(rotation)) { int swap = width; width = height; height = swap; }
            if (width <= 0 || height <= 0 || (long) width * height > 100_000_000) throw new IllegalArgumentException("Dimensiones inválidas");
            if (output && (Math.max(width, height) > 1280 || Math.min(width, height) > 720 ||
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_LOCATION) != null)) throw new IllegalArgumentException("Salida inválida");
        } finally { retriever.release(); }
        if (output) {
            MediaExtractor extractor = new MediaExtractor();
            try {
                extractor.setDataSource(file.getAbsolutePath());
                boolean video = false;
                for (int i = 0; i < extractor.getTrackCount(); i++) {
                    MediaFormat format = extractor.getTrackFormat(i);
                    String mime = format.getString(MediaFormat.KEY_MIME);
                    if ("video/avc".equals(mime)) {
                        video = true;
                        if (format.containsKey(MediaFormat.KEY_FRAME_RATE) && format.getInteger(MediaFormat.KEY_FRAME_RATE) > 30) {
                            throw new IllegalArgumentException("Frecuencia de video inválida");
                        }
                    }
                    else if (!"audio/mp4a-latm".equals(mime)) throw new IllegalArgumentException("Codec inválido");
                }
                if (!video) throw new IllegalArgumentException("Sin pista de video");
            } finally { extractor.release(); }
        }
        return new int[] { width, height, durationMs };
    }

    @PluginMethod public void cancel(PluginCall call) {
        final String id = call.getString("id", "");
        main.post(() -> {
            synchronized (this) {
                if (active != null && active.id.equals(id)) cancelSession(active, "Preparación de video cancelada");
                call.resolve(); // idempotent; cannot address any path or another session
            }
        });
    }
    private synchronized void cancelSession(Session s, String reason) {
        if (active != s) return;
        if (s.transformer != null) s.transformer.cancel();
        if (s.pending != null) s.pending.reject(reason);
        erase(s.dir);
        active = null;
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> { synchronized (this) { if (active != null) cancelSession(active, "App cerrada"); } });
    }
}
