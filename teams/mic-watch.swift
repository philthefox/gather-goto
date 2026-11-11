// mic-watch — prints a line whenever an app starts or stops capturing audio input.
//   mic-watch                      list apps currently using the microphone, then exit
//   mic-watch --watch [prefix]     stay running; print "start <bundle>" / "stop <bundle>" for bundle ids
//                                  with that prefix (default: all). Event-driven, no polling.
// Uses the CoreAudio process objects available since macOS 14.
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
let system = AudioObjectID(kAudioObjectSystemObject)
func addr(_ s: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: s, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}
func processObjects() -> [AudioObjectID] {
    var a = addr(kAudioHardwarePropertyProcessObjectList), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &a, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}
func bundleID(_ obj: AudioObjectID) -> String {
    var a = addr(kAudioProcessPropertyBundleID), size = UInt32(MemoryLayout<CFString?>.size)
    var s: Unmanaged<CFString>?
    guard AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &s) == noErr, let v = s?.takeRetainedValue() else { return "" }
    return v as String
}
func pidOf(_ obj: AudioObjectID) -> pid_t {
    var a = addr(kAudioProcessPropertyPID), size = UInt32(MemoryLayout<pid_t>.size), v: pid_t = 0
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : 0
}
/// Bundle id, or "pid:<executable name>" for command line tools that have none.
func identity(_ obj: AudioObjectID) -> String {
    let b = bundleID(obj); if !b.isEmpty { return b }
    var buf = [CChar](repeating: 0, count: 4096)
    let n = proc_pidpath(pidOf(obj), &buf, UInt32(buf.count))
    return n > 0 ? "pid:" + (String(cString: buf) as NSString).lastPathComponent : ""
}
func defaultInputDevice() -> AudioObjectID {
    var a = addr(kAudioHardwarePropertyDefaultInputDevice), size = UInt32(MemoryLayout<AudioObjectID>.size), d: AudioObjectID = 0
    return AudioObjectGetPropertyData(system, &a, 0, nil, &size, &d) == noErr ? d : 0
}
func isRunningInput(_ obj: AudioObjectID) -> Bool {
    var a = addr(kAudioProcessPropertyIsRunningInput), size = UInt32(MemoryLayout<UInt32>.size), v: UInt32 = 0
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr && v != 0
}

let args = CommandLine.arguments
guard args.contains("--watch") else {
    for o in processObjects() where isRunningInput(o) { print(identity(o)) }
    exit(0)
}
let prefix = args.last.flatMap { $0.hasPrefix("--") ? nil : $0 } ?? ""
let queue = DispatchQueue(label: "mic-watch")
var state: [String: Bool] = [:]          // bundle id -> capturing (any of its processes)
var watched = Set<AudioObjectID>()

func refresh() {
    var now: [String: Bool] = [:]
    for o in processObjects() {
        let b = identity(o)
        guard !b.isEmpty, b.hasPrefix(prefix) else { continue }
        now[b] = (now[b] ?? false) || isRunningInput(o)
        if watched.insert(o).inserted {
            var a = addr(kAudioProcessPropertyIsRunningInput)
            AudioObjectAddPropertyListenerBlock(o, &a, queue) { _, _ in refresh() }
        }
    }
    for (b, on) in now where on != (state[b] ?? false) { print("\(on ? "start" : "stop") \(b)") }
    for (b, was) in state where was && now[b] == nil { print("stop \(b)") }
    state = now
}
var list = addr(kAudioHardwarePropertyProcessObjectList)
AudioObjectAddPropertyListenerBlock(system, &list, queue) { _, _ in refresh() }
// Second trigger: the input device itself reports when anyone starts or stops capturing. The
// per-process flag can lag a moment behind, so look again shortly after.
var watchedDevice: AudioObjectID = 0
func watchInputDevice() {
    let d = defaultInputDevice(); guard d != 0, d != watchedDevice else { return }
    watchedDevice = d
    var a = addr(kAudioDevicePropertyDeviceIsRunningSomewhere)
    AudioObjectAddPropertyListenerBlock(d, &a, queue) { _, _ in refresh(); queue.asyncAfter(deadline: .now() + 1) { refresh() } }
}
var defIn = addr(kAudioHardwarePropertyDefaultInputDevice)
AudioObjectAddPropertyListenerBlock(system, &defIn, queue) { _, _ in watchInputDevice(); refresh() }
queue.sync { watchInputDevice() }
queue.sync { refresh() }
dispatchMain()
