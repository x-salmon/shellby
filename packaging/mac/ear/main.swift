// Shellby's ear on a Mac: push-to-talk dictation with Apple's own recognizer,
// on this Mac only (requiresOnDeviceRecognition), so the audio never leaves it.
// The same line protocol as the Windows helper in src/main/dictation.js:
//   in:  "start <id>", "stop", "cancel", "quit"
//   out: {"type":"ready","text":"en-US"}, {"type":"heard","id":..,"text":..},
//        {"type":"done","id":..}, {"type":"error","id":..,"text":..}
// --wav <file> reads a recording instead of the microphone (the tests).
// Built by scripts/build-mac-ear.sh; the app's Info.plist holds the reasons
// macOS shows when it asks for the microphone and speech recognition.
import AVFoundation
import Foundation
import Speech

let out = FileHandle.standardOutput
let lock = NSLock()

func emit(_ type: String, _ id: String? = nil, _ text: String? = nil) {
  var msg: [String: String] = ["type": type]
  if let id = id { msg["id"] = id }
  if let text = text { msg["text"] = text }
  guard let data = try? JSONSerialization.data(withJSONObject: msg) else { return }
  lock.lock()
  out.write(data)
  out.write("\n".data(using: .utf8)!)
  lock.unlock()
}

let args = CommandLine.arguments
let wav: URL? = args.firstIndex(of: "--wav").flatMap { $0 + 1 < args.count ? URL(fileURLWithPath: args[$0 + 1]) : nil }

final class Ear {
  let recognizer: SFSpeechRecognizer
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var session: String?
  var heard = ""

  init?(locale: Locale) {
    guard let r = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(), r.supportsOnDeviceRecognition else { return nil }
    recognizer = r
  }

  func start(_ id: String) {
    if session != nil { cancel() }
    session = id
    heard = ""
    if let file = wav { return startFile(id, file) }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true
    req.shouldReportPartialResults = false
    request = req
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0 else { return fail(id, "no-microphone") }
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
    engine.prepare()
    do { try engine.start() } catch { return fail(id, "no-microphone") }
    task = recognizer.recognitionTask(with: req) { [weak self] result, err in self?.update(id, result, err) }
  }

  func startFile(_ id: String, _ file: URL) {
    let req = SFSpeechURLRecognitionRequest(url: file)
    req.requiresOnDeviceRecognition = true
    req.shouldReportPartialResults = false
    task = recognizer.recognitionTask(with: req) { [weak self] result, err in self?.update(id, result, err) }
  }

  func update(_ id: String, _ result: SFSpeechRecognitionResult?, _ err: Error?) {
    guard session == id else { return }
    if let r = result, r.isFinal {
      let text = r.bestTranscription.formattedString
      if !text.isEmpty { emit("heard", id, text) }
      finish(id)
    } else if let e = err as NSError? {
      // Stopped with nothing said: not a failure, just nothing to type.
      if !(e.domain == "kAFAssistantErrorDomain" && (e.code == 1110 || e.code == 216)) { emit("error", id, e.localizedDescription) }
      finish(id)
    }
  }

  func stop() {
    guard session != nil else { return }
    if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
    request?.endAudio()
  }

  func cancel() {
    session = nil
    task?.cancel()
    teardown()
  }

  func finish(_ id: String) {
    session = nil
    teardown()
    emit("done", id)
  }

  func fail(_ id: String, _ code: String) {
    emit("error", id, code)
    finish(id)
  }

  func teardown() {
    if engine.isRunning { engine.stop() }
    engine.inputNode.removeTap(onBus: 0)
    request = nil
    task = nil
  }
}

func authorize(_ then: @escaping (Bool) -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else { return then(false) }
    if wav != nil { return then(true) }
    AVCaptureDevice.requestAccess(for: .audio) { then($0) }
  }
}

guard let ear = Ear(locale: Locale.current) else {
  emit("error", nil, "no-recognizer")
  exit(2)
}

authorize { ok in
  DispatchQueue.main.async {
    guard ok else { emit("error", nil, "not-allowed"); exit(3) }
    emit("ready", nil, ear.recognizer.locale.identifier.replacingOccurrences(of: "_", with: "-"))
    Thread.detachNewThread {
      while let line = readLine() {
        let parts = line.trimmingCharacters(in: .whitespaces).split(separator: " ", maxSplits: 1).map(String.init)
        DispatchQueue.main.async {
          switch parts.first {
          case "start": if parts.count == 2 { ear.start(parts[1]) }
          case "stop": ear.stop()
          case "cancel": ear.cancel()
          case "quit": exit(0)
          default: break
          }
        }
      }
      exit(0) // stdin closed: Shellby has gone
    }
  }
}

RunLoop.main.run()
