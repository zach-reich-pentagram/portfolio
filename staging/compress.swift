// Compresses a video for the site: H.264, no larger than 1080p (short side ≤ 1080), at a set
// bitrate, without audio (the site plays videos muted). Like a "Low, 1080p" web compressor.
//   swift compress.swift <in> <out.mp4> [megabits per second, default 4]
import AVFoundation

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: compress.swift <in> <out.mp4> [mbps]"); exit(2) }
let mbps = args.count > 3 ? Double(args[3]) ?? 4 : 4
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let out = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: out)

let sem = DispatchSemaphore(value: 0)
Task {
  do {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { print("no video track"); exit(1) }
    let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
    let shown = natural.applying(transform)
    var w = abs(shown.width), h = abs(shown.height)
    let k = min(1, 1080 / min(w, h))
    w = (w * k / 2).rounded() * 2; h = (h * k / 2).rounded() * 2   // H.264 needs even sizes

    let reader = try AVAssetReader(asset: asset)
    let comp = try await AVMutableVideoComposition.videoComposition(withPropertiesOf: asset)
    comp.renderSize = CGSize(width: w, height: h)
    let scale = CGAffineTransform(scaleX: k, y: k)
    let inst = AVMutableVideoCompositionInstruction()
    inst.timeRange = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(transform.concatenating(scale), at: .zero)
    inst.layerInstructions = [layer]
    comp.instructions = [inst]
    let rout = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    rout.videoComposition = comp
    reader.add(rout)

    let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true   // fast start: plays before it's all loaded
    let win = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: mbps * 1_000_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
    ])
    win.expectsMediaDataInRealTime = false
    writer.add(win)
    reader.startReading(); writer.startWriting(); writer.startSession(atSourceTime: .zero)
    while let buf = rout.copyNextSampleBuffer() {
      while !win.isReadyForMoreMediaData { usleep(1000) }
      win.append(buf)
    }
    win.markAsFinished()
    await writer.finishWriting()
    if writer.status != .completed { print(writer.error ?? "failed"); exit(1) }
  } catch { print(error); exit(1) }
  sem.signal()
}
sem.wait()
