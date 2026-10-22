import Foundation
import AVFoundation
import Capacitor

// MEDIA-OPT-01. No caller paths/URLs: the only accepted handle is our UUID.
@objc(VicinoVideoPlugin)
public final class VicinoVideoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VicinoVideoPlugin"
    public let jsName = "VicinoVideo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "mx.vicino.video")
    private let inputMax = 200 * 1024 * 1024
    private let outputMax = 10 * 1024 * 1024
    private let chunkMax = 192 * 1024
    private let ttl: TimeInterval = 15 * 60
    private var active: Session?
    private var root: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("vicino-video", isDirectory: true)
    }
    private final class Session {
        let id: String
        let expected: Int
        let directory: URL
        let input: URL
        let output: URL
        var written = 0
        var finishing = false
        var exporter: AVAssetExportSession?
        var pending: CAPPluginCall?
        var inputDimensions = CGSize.zero
        var inputDuration: Double = 0
        init(root: URL, expected: Int) {
            let id = UUID().uuidString.lowercased()
            self.id = id
            self.expected = expected
            directory = root.appendingPathComponent(id, isDirectory: true)
            input = directory.appendingPathComponent("input")
            output = directory.appendingPathComponent("output.mp4")
        }
    }
    private enum Failure: Error { case invalid }

    public override func load() {
        queue.async {
            let entries = (try? FileManager.default.contentsOfDirectory(at: self.root,
                includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for entry in entries where UUID(uuidString: entry.lastPathComponent) != nil {
                let date = try? entry.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                if Date().timeIntervalSince(date ?? .distantPast) > self.ttl { self.erase(entry) }
            }
        }
    }
    private func erase(_ directory: URL) {
        // Delete fixed filenames only; never recursively follow caller-controlled paths.
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("input"))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("output.mp4"))
        try? FileManager.default.removeItem(at: directory)
    }
    private func session(_ call: CAPPluginCall) throws -> Session {
        guard let session = active, call.getString("id") == session.id else { throw Failure.invalid }
        return session
    }
    @objc func begin(_ call: CAPPluginCall) {
        queue.async {
            guard self.active == nil, let size = call.getInt("size"), size > 0, size <= self.inputMax else {
                call.reject("Video inválido, mayor a 200 MB o preparación en curso"); return
            }
            let session = Session(root: self.root, expected: size)
            do {
                try FileManager.default.createDirectory(at: session.directory, withIntermediateDirectories: true)
                var directory = session.directory
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
                guard FileManager.default.createFile(atPath: session.input.path, contents: nil) else { throw Failure.invalid }
                self.active = session
                self.queue.asyncAfter(deadline: .now() + self.ttl) { self.cancelSession(session, reason: "Preparación de video expirada") }
                call.resolve(["id": session.id])
            } catch {
                self.erase(session.directory)
                call.reject("No se pudo crear el cache de video")
            }
        }
    }
    @objc func writeChunk(_ call: CAPPluginCall) {
        queue.async {
            do {
                let session = try self.session(call)
                guard !session.finishing, call.getInt("offset") == session.written,
                      let encoded = call.getString("data"), !encoded.isEmpty,
                      encoded.utf8.count <= self.chunkMax / 3 * 4,
                      let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= self.chunkMax,
                      session.written + data.count <= session.expected else { throw Failure.invalid }
                let handle = try FileHandle(forWritingTo: session.input)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                session.written += data.count
                call.resolve()
            } catch { call.reject("Bloque de video inválido") }
        }
    }
    @objc func finish(_ call: CAPPluginCall) {
        queue.async {
            do {
                let session = try self.session(call)
                guard !session.finishing, session.written == session.expected else { throw Failure.invalid }
                session.finishing = true
                session.pending = call
                try self.transcode(session)
            } catch {
                if let session = self.active, session.pending === call {
                    self.cancelSession(session, reason: "Video inválido o incompatible; debe durar hasta 10 segundos")
                } else { call.reject("Video incompleto o sesión inválida") }
            }
        }
    }
    private func transcode(_ session: Session) throws {
        let asset = AVURLAsset(url: session.input)
        let duration = asset.duration.seconds
        guard duration.isFinite, duration > 0, duration <= 10,
              let video = asset.tracks(withMediaType: .video).first else { throw Failure.invalid }
        let sourceRect = CGRect(origin: .zero, size: video.naturalSize).applying(video.preferredTransform)
        let width = abs(sourceRect.width), height = abs(sourceRect.height)
        guard width >= 2, height >= 2, width * height <= 100_000_000 else { throw Failure.invalid }
        session.inputDimensions = CGSize(width: width, height: height)
        session.inputDuration = duration
        let scale = min(1, min(1280 / max(width, height), 720 / min(width, height)))
        let outputSize = CGSize(width: max(2, floor(width * scale / 2) * 2), height: max(2, floor(height * scale / 2) * 2))
        // Fresh composition copies only audiovisual tracks; source metadata/GPS never enters it.
        let composition = AVMutableComposition()
        let range = CMTimeRange(start: .zero, duration: asset.duration)
        guard let destination = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failure.invalid }
        try destination.insertTimeRange(range, of: video, at: .zero)
        if let audio = asset.tracks(withMediaType: .audio).first,
           let audioDestination = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try audioDestination.insertTimeRange(range, of: audio, at: .zero)
        }
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: destination)
        // Normalize the rotated bounding box before resizing; preserve portrait/mirrored orientation.
        let transform = video.preferredTransform
            .concatenating(CGAffineTransform(translationX: -sourceRect.minX, y: -sourceRect.minY))
            .concatenating(CGAffineTransform(scaleX: outputSize.width / width, y: outputSize.height / height))
        layer.setTransform(transform, at: .zero)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = range
        instruction.layerInstructions = [layer]
        let videoComposition = AVMutableVideoComposition()
        videoComposition.instructions = [instruction]
        videoComposition.renderSize = outputSize
        let fps = video.nominalFrameRate > 0 ? min(30, Double(video.nominalFrameRate)) : 30
        videoComposition.frameDuration = CMTime(seconds: 1 / fps, preferredTimescale: 60_000)
        // Request SDR/BT.709. AVFoundation performs the HDR -> SDR conversion during composition.
        videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1280x720),
              exporter.supportedFileTypes.contains(.mp4) else { throw Failure.invalid }
        exporter.outputURL = session.output
        exporter.outputFileType = .mp4
        exporter.videoComposition = videoComposition
        exporter.metadata = []
        exporter.metadataItemFilter = AVMetadataItemFilter.forSharing()
        exporter.shouldOptimizeForNetworkUse = true
        exporter.fileLengthLimit = Int64(outputMax)
        session.exporter = exporter
        exporter.exportAsynchronously {
            self.queue.async {
                guard self.active === session else { self.erase(session.directory); return }
                guard exporter.status == .completed else { self.cancelSession(session, reason: "No se pudo preparar el video"); return }
                self.complete(session)
            }
        }
        poll(session)
    }
    private func fileSize(_ url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
    private func poll(_ session: Session) {
        guard active === session, session.pending != nil, let exporter = session.exporter else { return }
        if fileSize(session.output) > outputMax { cancelSession(session, reason: "Video preparado mayor a 10 MB"); return }
        notifyListeners("progress", data: ["id": session.id, "progress": Double(exporter.progress)])
        queue.asyncAfter(deadline: .now() + 0.25) { self.poll(session) }
    }
    private func complete(_ session: Session) {
        let asset = AVURLAsset(url: session.output)
        let duration = asset.duration.seconds
        let size = fileSize(session.output)
        guard let video = asset.tracks(withMediaType: .video).first else { cancelSession(session, reason: "Sin pista de video"); return }
        let rect = CGRect(origin: .zero, size: video.naturalSize).applying(video.preferredTransform)
        let width = abs(rect.width), height = abs(rect.height)
        let formats = video.formatDescriptions as! [CMFormatDescription]
        let codecsValid = !formats.isEmpty && formats.allSatisfy { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 }
        let audioValid = asset.tracks(withMediaType: .audio).allSatisfy { track in
            (track.formatDescriptions as! [CMFormatDescription]).allSatisfy { CMFormatDescriptionGetMediaSubType($0) == kAudioFormatMPEG4AAC }
        }
        guard size > 0, size <= outputMax, duration.isFinite, duration > 0, duration <= 10,
              max(width, height) <= 1280, min(width, height) <= 720,
              width <= session.inputDimensions.width, height <= session.inputDimensions.height,
              abs(duration - session.inputDuration) <= 0.1, video.nominalFrameRate <= 30.01,
              codecsValid, audioValid,
              !asset.commonMetadata.contains(where: { $0.commonKey == .commonKeyLocation }) else {
            cancelSession(session, reason: "Video preparado fuera de límites"); return
        }
        let pending = session.pending
        session.pending = nil
        session.exporter = nil
        try? FileManager.default.removeItem(at: session.input)
        pending?.resolve(["uri": session.output.absoluteString, "size": size, "duration": duration])
        // Keep output until JS has fetched it; cancel is also the idempotent release method.
    }
    @objc func cancel(_ call: CAPPluginCall) {
        queue.async {
            if let session = self.active, call.getString("id") == session.id {
                self.cancelSession(session, reason: "Preparación de video cancelada")
            }
            call.resolve()
        }
    }
    private func cancelSession(_ session: Session, reason: String) {
        guard active === session else { return }
        session.exporter?.cancelExport()
        session.pending?.reject(reason)
        session.pending = nil
        active = nil
        erase(session.directory)
    }
}
