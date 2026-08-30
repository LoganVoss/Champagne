import Foundation
@preconcurrency import AVFoundation
import Accelerate
import Combine

// MARK: - Public model

enum MasteringStyle: String, CaseIterable, Identifiable, Sendable {
    case fullPower    = "Full Power"
    case warmPresence = "Warm Presence"
    case modernCrisp  = "Modern Crisp"
    case dominant     = "Dominant"

    var id: String { rawValue }

    var subtitle: String {
        switch self {
        case .fullPower:    return "Parallel punch · full · competitive"
        case .warmPresence: return "Upward lift · warm density"
        case .modernCrisp:  return "Open · clear · dynamic polish"
        case .dominant:     return "Heavy glue · club loud"
        }
    }

    var systemImage: String {
        switch self {
        case .fullPower:    return "bolt.fill"
        case .warmPresence: return "flame.fill"
        case .modernCrisp:  return "diamond.fill"
        case .dominant:     return "waveform.path.ecg"
        }
    }

    nonisolated var fileSlug: String {
        rawValue.lowercased().replacingOccurrences(of: " ", with: "_")
    }
}

struct MasteringResult: Sendable {
    let originalWaveform: [Float]
    let processedWaveforms: [MasteringStyle: [Float]]
    let masteredURLs: [MasteringStyle: URL]
    let originalMetrics: MasteringMetrics
    let processedMetrics: [MasteringStyle: MasteringMetrics]
    let duration: TimeInterval
    let sampleRate: Double
}

/// Objective render measurements used by the engine and regression probe.
/// Loudness follows the BS.1770 K-weighting/gating model; true peak uses a
/// 4× polyphase windowed-sinc reconstruction plus a limiter safety margin.
struct MasteringMetrics: Sendable {
    let integratedLUFS: Double
    let samplePeakDBFS: Double
    let truePeakDBTP: Double
    let rmsDBFS: Double
    let crestFactorDB: Double
    let stereoCorrelation: Double
    let lowToMidDB: Double
    let highToMidDB: Double
}

// MARK: - Observable coordinator (UI-facing)

@MainActor
final class AudioMasteringProcessor: ObservableObject {
    @Published var originalWaveformSamples: [Float] = []
    @Published var processedWaveforms: [MasteringStyle: [Float]] = [:]
    @Published var hasProcessed = false
    @Published var isProcessing = false
    @Published var progress: Double = 0
    @Published var statusMessage = ""
    @Published var errorMessage: String?
    @Published var trackDuration: TimeInterval = 0
    /// Sandbox-local copy of the source — use this for Original playback.
    @Published var localSourceURL: URL?
    /// Bumps each time a style master becomes available (progressive load).
    @Published private(set) var mastersRevision: Int = 0

    private var masteredFileURLs: [MasteringStyle: URL] = [:]
    private var securityScopedURL: URL?
    private var loadTask: Task<Void, Never>?
    private var sessionID = UUID()

    var hasAudio: Bool { hasProcessed || isProcessing }

    func masteredFileURL(for style: MasteringStyle) -> URL? {
        masteredFileURLs[style]
    }

    func isStyleReady(_ style: MasteringStyle) -> Bool {
        masteredFileURLs[style] != nil
    }

    var allStylesReady: Bool {
        MasteringStyle.allCases.allSatisfy { masteredFileURLs[$0] != nil }
    }

    func processedWaveformSamples(for style: MasteringStyle) -> [Float] {
        processedWaveforms[style] ?? []
    }

    func cancelLoad() {
        loadTask?.cancel()
        loadTask = nil
        // Invalidate any progressive style callbacks already queued on the
        // main actor so a cancelled track cannot repopulate the start screen.
        sessionID = UUID()
        isProcessing = false
        statusMessage = ""
        progress = 0
    }

    func loadAndPrecomputeMasters(url: URL) {
        loadTask?.cancel()

        // Release previous security scope
        if let prev = securityScopedURL {
            prev.stopAccessingSecurityScopedResource()
            securityScopedURL = nil
        }

        let accessing = url.startAccessingSecurityScopedResource()
        if accessing { securityScopedURL = url }

        // Snapshot for this session
        let thisSession = UUID()
        sessionID = thisSession

        // Clear prior state immediately so UI feels responsive
        hasProcessed = false
        isProcessing = true
        progress = 0
        statusMessage = "Reading audio…"
        errorMessage = nil
        originalWaveformSamples = []
        processedWaveforms = [:]
        masteredFileURLs = [:]
        localSourceURL = nil
        trackDuration = 0
        mastersRevision = 0

        // Clean old temp masters from previous loads (best-effort)
        cleanupTempMasters()

        loadTask = Task { @MainActor [weak self] in
            guard let self else { return }

            do {
                self.progress = 0.04
                self.statusMessage = "Importing file…"

                // Single local copy: engine only *reads* into memory, so a
                // separate "work" clone was pure I/O overhead. Dry stays the
                // byte-identical Original A/B source and the process input.
                let dryURL = try await Self.copyToLocalTemp(url: url, role: "dry")

                guard !Task.isCancelled, self.sessionID == thisSession else { return }
                self.localSourceURL = dryURL
                self.progress = 0.08
                self.statusMessage = "Analyzing…"

                // Progress / style-ready hops to MainActor without capturing a
                // mutable `self` into the detached worker (Swift 6 safe).
                let sessionCheck = thisSession
                let progressBridge = ProgressBridge { [weak self] value, message in
                    Task { @MainActor [weak self] in
                        guard let self, self.sessionID == sessionCheck else { return }
                        self.progress = max(self.progress, min(1, value))
                        self.statusMessage = message
                    }
                }
                let styleBridge = StyleReadyBridge { [weak self] style, masterURL, wave, originalWave, duration in
                    Task { @MainActor [weak self] in
                        guard let self, self.sessionID == sessionCheck else { return }
                        self.masteredFileURLs[style] = masterURL
                        self.processedWaveforms[style] = wave
                        if self.originalWaveformSamples.isEmpty {
                            self.originalWaveformSamples = originalWave
                        }
                        if self.trackDuration <= 0 {
                            self.trackDuration = duration
                        }
                        // Unlock transport as soon as the first style is ready.
                        if !self.hasProcessed {
                            self.hasProcessed = true
                            self.statusMessage = "Ready to play — finishing other styles…"
                        }
                        self.mastersRevision &+= 1
                    }
                }

                // Detached work does not inherit parent cancellation; mirror it
                // into a flag so concurrent style workers also stop promptly.
                let cancelFlag = CancelFlag()
                let result = try await withTaskCancellationHandler {
                    try await Task.detached(priority: .userInitiated) {
                        try MasteringEngine.process(
                            url: dryURL,
                            progress: { value, message in
                                progressBridge.report(value, message)
                            },
                            isCancelled: {
                                Task.isCancelled || cancelFlag.isSet
                            },
                            onStyleReady: { style, masterURL, wave, originalWave, duration in
                                styleBridge.report(
                                    style: style,
                                    url: masterURL,
                                    wave: wave,
                                    originalWave: originalWave,
                                    duration: duration
                                )
                            }
                        )
                    }.value
                } onCancel: {
                    cancelFlag.set()
                }

                guard !Task.isCancelled, self.sessionID == thisSession else { return }

                // Final authoritative state (covers any race with progressive updates).
                self.originalWaveformSamples = result.originalWaveform
                self.processedWaveforms = result.processedWaveforms
                self.masteredFileURLs = result.masteredURLs
                self.trackDuration = result.duration
                self.progress = 1
                self.statusMessage = "Ready"
                self.isProcessing = false
                self.hasProcessed = true
                self.mastersRevision &+= 1
            } catch is CancellationError {
                // Silently drop cancelled loads
            } catch {
                guard self.sessionID == thisSession else { return }
                self.isProcessing = false
                self.hasProcessed = false
                self.progress = 0
                self.statusMessage = ""
                self.errorMessage = error.localizedDescription
            }
        }
    }

    private static func copyToLocalTemp(url: URL, role: String) async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            // Role prefix keeps dry original vs work vs masters unmistakable on disk.
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent("champagne_\(role)_\(UUID().uuidString)")
                .appendingPathExtension(url.pathExtension.isEmpty ? "wav" : url.pathExtension)
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: url, to: dest)
            return dest
        }.value
    }

    private func cleanupTempMasters() {
        let tmp = FileManager.default.temporaryDirectory
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: tmp,
            includingPropertiesForKeys: nil
        ) else { return }
        for item in items where item.lastPathComponent.hasPrefix("champagne_") {
            try? FileManager.default.removeItem(at: item)
        }
    }
}

/// Pushes progress off worker threads without dropping updates.
/// Explicitly nonisolated so default MainActor isolation does not trap DSP threads.
nonisolated private final class ProgressBridge: @unchecked Sendable {
    private let handler: @Sendable (Double, String) -> Void
    private let lock = NSLock()
    private var last: Double = 0

    nonisolated init(handler: @escaping @Sendable (Double, String) -> Void) {
        self.handler = handler
    }

    nonisolated func report(_ value: Double, _ message: String) {
        lock.lock()
        let v = max(last, min(1, value))
        last = v
        lock.unlock()
        handler(v, message)
    }
}

/// Delivers completed style masters to the UI thread as soon as each render finishes.
nonisolated private final class StyleReadyBridge: @unchecked Sendable {
    private let handler: @Sendable (MasteringStyle, URL, [Float], [Float], TimeInterval) -> Void

    nonisolated init(
        handler: @escaping @Sendable (MasteringStyle, URL, [Float], [Float], TimeInterval) -> Void
    ) {
        self.handler = handler
    }

    nonisolated func report(
        style: MasteringStyle,
        url: URL,
        wave: [Float],
        originalWave: [Float],
        duration: TimeInterval
    ) {
        handler(style, url, wave, originalWave, duration)
    }
}

/// Thread-safe accumulation of per-style render outputs.
nonisolated private final class StyleRenderStore: @unchecked Sendable {
    private let lock = NSLock()
    private var waveforms: [MasteringStyle: [Float]] = [:]
    private var urls: [MasteringStyle: URL] = [:]
    private var metrics: [MasteringStyle: MasteringMetrics] = [:]

    nonisolated func insert(
        style: MasteringStyle,
        url: URL,
        wave: [Float],
        metrics: MasteringMetrics
    ) {
        lock.lock()
        waveforms[style] = wave
        urls[style] = url
        self.metrics[style] = metrics
        lock.unlock()
    }

    nonisolated func snapshot() -> (
        waveforms: [MasteringStyle: [Float]],
        urls: [MasteringStyle: URL],
        metrics: [MasteringStyle: MasteringMetrics]
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (waveforms, urls, metrics)
    }
}

nonisolated private final class ErrorBox: @unchecked Sendable {
    private let lock = NSLock()
    private var error: Error?

    nonisolated var hasError: Bool {
        lock.lock()
        defer { lock.unlock() }
        return error != nil
    }

    nonisolated func set(_ error: Error) {
        lock.lock()
        if self.error == nil { self.error = error }
        lock.unlock()
    }

    nonisolated func get() -> Error? {
        lock.lock()
        defer { lock.unlock() }
        return error
    }
}

nonisolated private final class AtomicCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int

    nonisolated init(_ value: Int) {
        self.value = value
    }

    @discardableResult
    nonisolated func increment() -> Int {
        lock.lock()
        value += 1
        let v = value
        lock.unlock()
        return v
    }
}

/// Shared cancel signal for work that outlives structured task inheritance
/// (e.g. `Task.detached` + concurrent style workers).
nonisolated private final class CancelFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var setFlag = false

    nonisolated var isSet: Bool {
        lock.lock()
        defer { lock.unlock() }
        return setFlag
    }

    nonisolated func set() {
        lock.lock()
        setFlag = true
        lock.unlock()
    }
}

// MARK: - DSP engine
//
// Two-pass design: measure the complete source first, derive bounded tonal/
// dynamics decisions for each style, then render and independently measure the
// result. Chain: cleanup → adaptive broad EQ → low-band control → program glue
// → parallel density → harmonics → dynamic HF control → correlation-safe width
// → BS.1770 loudness gain → linked 4× true-peak look-ahead limiter.

enum MasteringEngine {
    enum EngineError: LocalizedError {
        case cannotOpen, cannotAllocateBuffer, cancelled, writeFailed(String)
        var errorDescription: String? {
            switch self {
            case .cannotOpen: return "Could not open audio file."
            case .cannotAllocateBuffer: return "Not enough memory for this file."
            case .cancelled: return "Cancelled."
            case .writeFailed(let s): return "Export failed: \(s)"
            }
        }
    }

    private struct Recipe: Sendable {
        let targetLUFS: Double
        let ceiling: Float
        let maxLimiterReductionDB: Float
        // Style biases are blended with input-adaptive corrective EQ.
        let desiredLowToMidDB: Float
        let desiredHighToMidDB: Float
        let lowColorDB: Float
        let presenceDB: Float
        let airColorDB: Float
        // Dynamics are automatically reduced for already-dense masters.
        let compression: Float
        let parallelMix: Float
        let upwardAmount: Float
        let deHarshAmount: Float
        let midDrive: Float
        let width: Float
    }

    private struct TrackAnalysis: Sendable {
        let metrics: MasteringMetrics
        let lowMidToMidDB: Double
    }

    /// - Parameters:
    ///   - onStyleReady: Optional progressive callback fired as each style finishes
    ///     (style, master URL, waveform, original waveform, duration). DSP chain is
    ///     unchanged; this only affects delivery / scheduling around it.
    nonisolated static func process(
        url: URL,
        progress: @escaping @Sendable (Double, String) -> Void,
        isCancelled: @escaping @Sendable () -> Bool,
        onStyleReady: (@Sendable (MasteringStyle, URL, [Float], [Float], TimeInterval) -> Void)? = nil
    ) throws -> MasteringResult {
        if isCancelled() { throw EngineError.cancelled }

        progress(0.05, "Opening file…")
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let sampleRate = format.sampleRate
        let capacity = AVAudioFrameCount(file.length)
        guard capacity > 0 else { throw EngineError.cannotOpen }
        guard let source = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            throw EngineError.cannotAllocateBuffer
        }
        try file.read(into: source)
        sanitize(buffer: source)
        if isCancelled() { throw EngineError.cancelled }

        progress(0.12, "Analyzing…")
        let originalWaveform = downsampleWaveform(monoAbs(from: source), target: 1600)
        let duration = Double(source.frameLength) / sampleRate
        // Source analysis still drives adaptive decisions inside the chain —
        // leave that measurement path intact.
        let sourceAnalysis = analyze(buffer: source, sampleRate: sampleRate)

        // Every style begins with this identical cleanup filter. Run it once on
        // the shared source after analysis instead of repeating a full-song pass
        // in every worker. Each style still receives its own mutable copy below.
        applyHighPass(buffer: source, cutoff: 27, sampleRate: sampleRate)

        progress(0.18, "Mastering styles…")
        let styles = Array(MasteringStyle.allCases)
        let nStyles = max(1, styles.count)

        // Shared result storage. The prepared `source` is read-only from here;
        // each worker mutates only its own working buffer.
        let store = StyleRenderStore()

        // Prefer the first style (Full Power) alone so the UI can unlock ASAP,
        // then fan out the remainder using a memory-aware concurrency limit.
        let preferred = styles[0]
        let remaining = Array(styles.dropFirst())

        try renderOneStyle(
            style: preferred,
            source: source,
            format: format,
            sampleRate: sampleRate,
            sourceAnalysis: sourceAnalysis,
            originalWaveform: originalWaveform,
            duration: duration,
            store: store,
            progress: progress,
            completedBase: 0,
            nStyles: nStyles,
            isCancelled: isCancelled,
            onStyleReady: onStyleReady
        )

        if !remaining.isEmpty {
            if isCancelled() { throw EngineError.cancelled }
            try renderStylesConcurrently(
                styles: remaining,
                source: source,
                format: format,
                sampleRate: sampleRate,
                sourceAnalysis: sourceAnalysis,
                originalWaveform: originalWaveform,
                duration: duration,
                store: store,
                progress: progress,
                completedBase: 1,
                nStyles: nStyles,
                maxConcurrent: recommendedStyleConcurrency(
                    source: source,
                    maximum: remaining.count
                ),
                isCancelled: isCancelled,
                onStyleReady: onStyleReady
            )
        }

        if isCancelled() { throw EngineError.cancelled }
        let snapshot = store.snapshot()
        guard snapshot.urls.count == styles.count else {
            throw EngineError.writeFailed("Not all styles completed.")
        }
        progress(1.0, "Ready")
        return MasteringResult(
            originalWaveform: originalWaveform,
            processedWaveforms: snapshot.waveforms,
            masteredURLs: snapshot.urls,
            // Per-style post metrics are not used by the app (probe re-meters files).
            // Skipping the second full measure pass avoids another true-peak + LUFS
            // walk over every master without changing a single DSP sample.
            originalMetrics: sourceAnalysis.metrics,
            processedMetrics: snapshot.metrics,
            duration: duration,
            sampleRate: sampleRate
        )
    }

    /// The chain peaks near five full-size PCM buffers per worker. Use at most
    /// one quarter of physical memory for concurrent style scratch space and
    /// never exceed the three styles left after the fast first result.
    private nonisolated static func recommendedStyleConcurrency(
        source: AVAudioPCMBuffer,
        maximum: Int
    ) -> Int {
        guard maximum > 1 else { return max(1, maximum) }
        let bytesPerBuffer = UInt64(source.frameLength)
            * UInt64(source.format.channelCount)
            * UInt64(MemoryLayout<Float>.stride)
        let minimumWorkerEstimate = UInt64(64 * 1024 * 1024)
        let estimatedBytesPerWorker = max(minimumWorkerEstimate, bytesPerBuffer * 5)
        let memoryBudget = max(UInt64(1), ProcessInfo.processInfo.physicalMemory / 4)
        let memoryLimit = max(1, Int(memoryBudget / estimatedBytesPerWorker))
        let cpuLimit = max(1, ProcessInfo.processInfo.activeProcessorCount - 1)
        return max(1, min(maximum, min(memoryLimit, cpuLimit)))
    }

    /// Runs the unchanged mastering chain for one style and publishes the result.
    private nonisolated static func renderOneStyle(
        style: MasteringStyle,
        source: AVAudioPCMBuffer,
        format: AVAudioFormat,
        sampleRate: Double,
        sourceAnalysis: TrackAnalysis,
        originalWaveform: [Float],
        duration: TimeInterval,
        store: StyleRenderStore,
        progress: @escaping @Sendable (Double, String) -> Void,
        completedBase: Int,
        nStyles: Int,
        isCancelled: @escaping @Sendable () -> Bool,
        onStyleReady: (@Sendable (MasteringStyle, URL, [Float], [Float], TimeInterval) -> Void)?
    ) throws {
        if isCancelled() { throw EngineError.cancelled }
        progress(
            0.18 + (Double(completedBase) / Double(nStyles)) * 0.78,
            "Mastering \(style.rawValue)…"
        )

        guard let working = copyBuffer(source) else {
            throw EngineError.cannotAllocateBuffer
        }
        // GOLD PATH — do not alter applyMasteringChain or its callees.
        applyMasteringChain(
            buffer: working,
            sampleRate: sampleRate,
            recipe: recipe(for: style),
            sourceAnalysis: sourceAnalysis
        )

        let wave = downsampleWaveform(monoAbs(from: working), target: 1600)
        let outURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("champagne_master_\(style.fileSlug)_\(UUID().uuidString).wav")
        try writeWAV(
            buffer: working,
            to: outURL,
            sampleRate: sampleRate,
            channels: format.channelCount
        )

        // Placeholder metrics: app never displays these; regression probe re-reads WAVs.
        let placeholder = MasteringMetrics(
            integratedLUFS: 0,
            samplePeakDBFS: 0,
            truePeakDBTP: 0,
            rmsDBFS: 0,
            crestFactorDB: 0,
            stereoCorrelation: 1,
            lowToMidDB: 0,
            highToMidDB: 0
        )
        store.insert(style: style, url: outURL, wave: wave, metrics: placeholder)
        onStyleReady?(style, outURL, wave, originalWaveform, duration)
        progress(
            0.18 + (Double(completedBase + 1) / Double(nStyles)) * 0.78,
            "Mastering \(style.rawValue)…"
        )
    }

    /// Bounded parallel fan-out for remaining styles. Same chain, separate working buffers.
    private nonisolated static func renderStylesConcurrently(
        styles: [MasteringStyle],
        source: AVAudioPCMBuffer,
        format: AVAudioFormat,
        sampleRate: Double,
        sourceAnalysis: TrackAnalysis,
        originalWaveform: [Float],
        duration: TimeInterval,
        store: StyleRenderStore,
        progress: @escaping @Sendable (Double, String) -> Void,
        completedBase: Int,
        nStyles: Int,
        maxConcurrent: Int,
        isCancelled: @escaping @Sendable () -> Bool,
        onStyleReady: (@Sendable (MasteringStyle, URL, [Float], [Float], TimeInterval) -> Void)?
    ) throws {
        let semaphore = DispatchSemaphore(value: max(1, maxConcurrent))
        let group = DispatchGroup()
        let errorBox = ErrorBox()
        let doneCounter = AtomicCounter(completedBase)

        for style in styles {
            group.enter()
            DispatchQueue.global(qos: .userInitiated).async {
                defer { group.leave() }
                semaphore.wait()
                defer { semaphore.signal() }

                if isCancelled() || errorBox.hasError { return }
                do {
                    guard let working = copyBuffer(source) else {
                        throw EngineError.cannotAllocateBuffer
                    }
                    // GOLD PATH — identical chain invocation.
                    applyMasteringChain(
                        buffer: working,
                        sampleRate: sampleRate,
                        recipe: recipe(for: style),
                        sourceAnalysis: sourceAnalysis
                    )

                    let wave = downsampleWaveform(monoAbs(from: working), target: 1600)
                    let outURL = FileManager.default.temporaryDirectory
                        .appendingPathComponent(
                            "champagne_master_\(style.fileSlug)_\(UUID().uuidString).wav"
                        )
                    try writeWAV(
                        buffer: working,
                        to: outURL,
                        sampleRate: sampleRate,
                        channels: format.channelCount
                    )

                    let placeholder = MasteringMetrics(
                        integratedLUFS: 0,
                        samplePeakDBFS: 0,
                        truePeakDBTP: 0,
                        rmsDBFS: 0,
                        crestFactorDB: 0,
                        stereoCorrelation: 1,
                        lowToMidDB: 0,
                        highToMidDB: 0
                    )
                    store.insert(style: style, url: outURL, wave: wave, metrics: placeholder)
                    onStyleReady?(style, outURL, wave, originalWaveform, duration)

                    let finished = doneCounter.increment()
                    progress(
                        0.18 + (Double(finished) / Double(nStyles)) * 0.78,
                        "Mastering \(style.rawValue)…"
                    )
                } catch {
                    errorBox.set(error)
                }
            }
        }

        group.wait()
        if isCancelled() { throw EngineError.cancelled }
        if let err = errorBox.get() { throw err }
    }

    // MARK: - Recipes

    private nonisolated static func recipe(for style: MasteringStyle) -> Recipe {
        switch style {
        case .fullPower:
            return Recipe(
                targetLUFS: -10.0, ceiling: -1.0, maxLimiterReductionDB: 4.5,
                desiredLowToMidDB: 0.5, desiredHighToMidDB: -1.5,
                lowColorDB: 0.5, presenceDB: 0.7, airColorDB: 0.25,
                compression: 0.78, parallelMix: 0.20, upwardAmount: 0.22,
                deHarshAmount: 0.55, midDrive: 0.18,
                width: 1.10
            )
        case .warmPresence:
            return Recipe(
                targetLUFS: -11.0, ceiling: -1.0, maxLimiterReductionDB: 3.8,
                desiredLowToMidDB: 1.5, desiredHighToMidDB: -2.5,
                lowColorDB: 0.9, presenceDB: 0.35, airColorDB: -0.15,
                compression: 0.62, parallelMix: 0.14, upwardAmount: 0.30,
                deHarshAmount: 0.68, midDrive: 0.30,
                width: 1.05
            )
        case .modernCrisp:
            return Recipe(
                targetLUFS: -10.5, ceiling: -1.0, maxLimiterReductionDB: 3.8,
                desiredLowToMidDB: -0.2, desiredHighToMidDB: 2.0,
                lowColorDB: 0.1, presenceDB: 0.9, airColorDB: 1.10,
                compression: 0.55, parallelMix: 0.12, upwardAmount: 0.15,
                deHarshAmount: 0.12, midDrive: 0.10,
                width: 1.14
            )
        case .dominant:
            return Recipe(
                targetLUFS: -8.8, ceiling: -0.8, maxLimiterReductionDB: 6.0,
                desiredLowToMidDB: 1.0, desiredHighToMidDB: -1.8,
                lowColorDB: 0.7, presenceDB: 0.55, airColorDB: 0.15,
                compression: 1.0, parallelMix: 0.25, upwardAmount: 0.24,
                deHarshAmount: 0.50, midDrive: 0.22,
                width: 1.12
            )
        }
    }

    // MARK: - Input-adaptive mastering chain

    private nonisolated static func applyMasteringChain(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double,
        recipe: Recipe,
        sourceAnalysis: TrackAnalysis
    ) {
        let metrics = sourceAnalysis.metrics
        let crestNeed = clamped(Float((metrics.crestFactorDB - 7.0) / 7.0), 0.28, 1.0)
        let alreadyDense = metrics.integratedLUFS >= recipe.targetLUFS - 1.0
        let dynamicsScale = max(0.28, crestNeed * (alreadyDense ? 0.58 : 1.0))
        let tonalScale: Float = alreadyDense ? 0.68 : 1.0

        // 1. DC/subsonic cleanup was applied once to the prepared source.

        // 2. Broad, bounded, input-adaptive EQ. A style supplies a direction,
        //    while analysis prevents the same shelf from being forced onto every mix.
        let lowCorrection = clamped(
            (recipe.desiredLowToMidDB - Float(metrics.lowToMidDB)) * 0.18,
            -1.35,
            1.35
        )
        let airCorrection = clamped(
            (recipe.desiredHighToMidDB - Float(metrics.highToMidDB)) * 0.14,
            -1.15,
            1.15
        )
        let mudCorrection = clamped(
            (0.3 - Float(sourceAnalysis.lowMidToMidDB)) * 0.16,
            -1.25,
            0.55
        )
        applyLowShelf(
            buffer: buffer,
            freq: 95,
            gainDB: (recipe.lowColorDB + lowCorrection) * tonalScale,
            sampleRate: sampleRate
        )
        applyPeaking(
            buffer: buffer,
            freq: 310,
            gainDB: mudCorrection * tonalScale,
            q: 0.82,
            sampleRate: sampleRate
        )
        applyPeaking(
            buffer: buffer,
            freq: 2300,
            gainDB: recipe.presenceDB * tonalScale,
            q: 0.9,
            sampleRate: sampleRate
        )
        applyHighShelf(
            buffer: buffer,
            freq: 11500,
            gainDB: (recipe.airColorDB + airCorrection) * tonalScale,
            sampleRate: sampleRate
        )

        // 3. Control low-end peaks separately so the full-band compressor does
        //    not pump to kick/sub energy.
        applyLowBandControl(
            buffer: buffer,
            amount: recipe.compression * dynamicsScale,
            sampleRate: sampleRate
        )

        // 4. A noise-gated upward lift adds low-level body, followed by gentle
        //    bus glue. Already-limited inputs automatically receive less of both.
        applyUpwardCompressorBodyOnly(
            buffer: buffer,
            amount: recipe.upwardAmount * dynamicsScale,
            sampleRate: sampleRate
        )

        let postEQRMS = unweightedRMSDB(buffer: buffer)
        applySoftKneeCompressor(
            buffer: buffer,
            thresholdDB: Float(postEQRMS + 5.0),
            ratio: 1.0 + 1.25 * recipe.compression * dynamicsScale,
            kneeDB: 6,
            attackMs: 18,
            releaseMs: 150,
            detectorMs: 10,
            sampleRate: sampleRate,
            makeupDB: 0
        )

        // 5. A restrained, band-limited parallel path supplies density without
        //    replacing transients or generating full-band clipping harmonics.
        applyParallelCompression(
            buffer: buffer,
            mix: recipe.parallelMix * dynamicsScale,
            threshold: Float(postEQRMS + 1.5),
            ratio: 4.5 + recipe.compression * 1.5,
            sampleRate: sampleRate
        )

        // 6. Low-level mid-band harmonic density, followed by dynamic cleanup.
        if recipe.midDrive > 0.01 {
            applyMidBandSaturation(
                buffer: buffer,
                drive: recipe.midDrive * (alreadyDense ? 0.65 : 1.0),
                sampleRate: sampleRate
            )
        }

        applyDynamicDeHarsh(
            buffer: buffer,
            amount: recipe.deHarshAmount,
            sampleRate: sampleRate
        )
        applyAntiFizz(
            buffer: buffer,
            amount: clamped(recipe.midDrive * 2 + recipe.parallelMix, 0.2, 0.8),
            sampleRate: sampleRate
        )

        // 7. Correlation-aware width. Dubious/negative stereo is narrowed, never
        //    widened, and the sub-side is attenuated for mono compatibility.
        var safeWidth = recipe.width
        if metrics.stereoCorrelation < 0.05 {
            safeWidth = min(1.0, safeWidth)
        } else if metrics.stereoCorrelation < 0.35 {
            let blend = Float((metrics.stereoCorrelation - 0.05) / 0.30)
            safeWidth = 1 + (safeWidth - 1) * clamped(blend, 0, 1)
        }
        let lowSideGain: Float
        let monoCutoff: Float
        if metrics.stereoCorrelation < 0 {
            lowSideGain = 0
            monoCutoff = 180
        } else if metrics.stereoCorrelation < 0.35 {
            lowSideGain = 0.14
            monoCutoff = 145
        } else {
            lowSideGain = 0.28
            monoCutoff = 125
        }
        if abs(safeWidth - 1) > 0.005 || buffer.format.channelCount >= 2 {
            applyStereoWidth(
                buffer: buffer,
                width: safeWidth,
                monoBelow: monoCutoff,
                lowSideGain: lowSideGain,
                sampleRate: sampleRate
            )
        }

        // 8. Final standards-aware loudness pass and linked look-ahead true-peak
        //    limiter. Nothing that can raise peaks is allowed after this stage.
        applyMaximizer(
            buffer: buffer,
            targetLUFS: recipe.targetLUFS,
            ceilingDB: recipe.ceiling,
            maxReductionDB: recipe.maxLimiterReductionDB,
            sampleRate: sampleRate
        )
    }

    // MARK: - Upward compression (body only)
    //
    // Lift quiet material in the body/low-mids for that "expensive full" feel,
    // but never amplify the high-frequency noise floor (that was a fizz source).

    private nonisolated static func applyUpwardCompressorBodyOnly(
        buffer: AVAudioPCMBuffer,
        amount: Float,
        sampleRate: Double
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let data = buffer.floatChannelData, frames > 0 else { return }
        guard let body = copyBuffer(buffer) else { return }
        // Body path carries the upward lift; residual highs pass through untouched.
        applyLowPass(buffer: body, cutoff: 5500, sampleRate: sampleRate)
        guard let bodyData = body.floatChannelData else { return }

        guard amount > 0.005 else { return }
        let floorDB: Float = -50
        let pivotDB: Float = -25
        let maxBoostDB: Float = 4.0 * amount
        let sr = Float(sampleRate)
        let envAttack = 1 - exp(-1 / max(1, 12 * sr / 1000))
        let envRelease = 1 - exp(-1 / max(1, 180 * sr / 1000))
        let gainRise = 1 - exp(-1 / max(1, 75 * sr / 1000))
        let gainFall = 1 - exp(-1 / max(1, 18 * sr / 1000))
        var envSquared: Float = 1e-10
        var smoothedBoostDB: Float = 0

        for i in 0..<frames {
            var meanSquare: Float = 0
            for ch in 0..<channels {
                let x = bodyData[ch][i]
                meanSquare += x * x
            }
            meanSquare /= Float(max(1, channels))
            let envCoefficient = meanSquare > envSquared ? envAttack : envRelease
            envSquared += (meanSquare - envSquared) * envCoefficient
            let levelDB = 10 * log10(max(1e-12, envSquared))

            // Do not lift the noise floor. The transition above the floor is
            // gradual, so ambience does not chatter in and out.
            let gate = clamped((levelDB - floorDB) / 8, 0, 1)
            let desiredBoost = levelDB < pivotDB
                ? min(maxBoostDB, (pivotDB - levelDB) * 0.16 * amount) * gate
                : 0
            let gainCoefficient = desiredBoost > smoothedBoostDB ? gainRise : gainFall
            smoothedBoostDB += (desiredBoost - smoothedBoostDB) * gainCoefficient
            let g = pow(10, smoothedBoostDB / 20)
            for ch in 0..<channels {
                let dry = data[ch][i]
                let low = bodyData[ch][i]
                let high = dry - low
                // Only the body is gain-ridden; air stays clean.
                data[ch][i] = low * g + high
            }
        }
    }

    // MARK: - Low-band dynamics

    private nonisolated static func applyLowBandControl(
        buffer: AVAudioPCMBuffer,
        amount: Float,
        sampleRate: Double
    ) {
        guard amount > 0.01,
              let dryLow = copyBuffer(buffer) else { return }

        // Matching filters make the replacement exact when no gain reduction
        // occurs: full - dryLow + controlledLow.
        applyLowPass(buffer: dryLow, cutoff: 165, sampleRate: sampleRate)
        applyLowPass(buffer: dryLow, cutoff: 165, sampleRate: sampleRate)
        guard let controlledLow = copyBuffer(dryLow) else { return }

        let lowRMS = unweightedRMSDB(buffer: dryLow)
        applySoftKneeCompressor(
            buffer: controlledLow,
            thresholdDB: Float(lowRMS + 4.5),
            ratio: 1.0 + amount * 1.7,
            kneeDB: 5,
            attackMs: 28,
            releaseMs: 165,
            detectorMs: 14,
            sampleRate: sampleRate,
            makeupDB: 0
        )

        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let data = buffer.floatChannelData,
              let dry = dryLow.floatChannelData,
              let wet = controlledLow.floatChannelData else { return }
        for ch in 0..<channels {
            for i in 0..<frames {
                data[ch][i] += wet[ch][i] - dry[ch][i]
            }
        }
    }

    // MARK: - Parallel compression (band-limited wet path)

    private nonisolated static func applyParallelCompression(
        buffer: AVAudioPCMBuffer,
        mix: Float,
        threshold: Float,
        ratio: Float,
        sampleRate: Double
    ) {
        guard let wet = copyBuffer(buffer) else { return }

        // Keep an identically filtered linear copy so a zero-effect blend
        // nulls instead of changing the EQ.
        applyHighPass(buffer: wet, cutoff: 100, sampleRate: sampleRate)
        applyLowPass(buffer: wet, cutoff: 7000, sampleRate: sampleRate)
        applyLowPass(buffer: wet, cutoff: 7000, sampleRate: sampleRate)
        guard let dryBand = copyBuffer(wet) else { return }

        let beforeRMS = unweightedRMSDB(buffer: wet)
        applySoftKneeCompressor(
            buffer: wet,
            thresholdDB: max(Float(beforeRMS + 1.5), threshold - 4),
            ratio: ratio,
            kneeDB: 7,
            attackMs: 3,
            releaseMs: 80,
            detectorMs: 7,
            sampleRate: sampleRate,
            makeupDB: 0
        )
        let afterRMS = unweightedRMSDB(buffer: wet)
        let matchDB = clamped(Float(beforeRMS - afterRMS), 0, 4)
        applyGain(buffer: wet, gain: pow(10, matchDB / 20))

        // Character only in the mid band of the wet path — not full-band soft clip
        // (full-band tanh was spraying odd-harmonic fizz into the top octave).
        applyMidBandSaturation(buffer: wet, drive: 0.18, sampleRate: sampleRate)

        // Steep post low-pass so nonlinear residue cannot re-enter the air band.
        applyLowPass(buffer: wet, cutoff: 7000, sampleRate: sampleRate)

        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let dryData = buffer.floatChannelData,
              let wetData = wet.floatChannelData,
              let dryBandData = dryBand.floatChannelData else { return }

        let wetMix = clamped(mix, 0, 0.35)

        for ch in 0..<channels {
            for i in 0..<frames {
                dryData[ch][i] += (wetData[ch][i] - dryBandData[ch][i]) * wetMix
            }
        }
    }

    /// Final anti-fizz: dynamic pull on grit above ~8 kHz + gentle ultrasonic shelf.
    /// Keeps musical air; removes the "spray paint" distortion from nonlinear stages.
    private nonisolated static func applyAntiFizz(
        buffer: AVAudioPCMBuffer,
        amount: Float,
        sampleRate: Double
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return }

        // Isolate the fizz band (8 kHz+)
        guard let fizz = copyBuffer(buffer) else { return }
        applyHighPass(buffer: fizz, cutoff: 8000, sampleRate: sampleRate)
        guard let fData = fizz.floatChannelData else { return }

        // Body reference for relative detection
        guard let body = copyBuffer(buffer) else { return }
        applyLowPass(buffer: body, cutoff: 4000, sampleRate: sampleRate)
        guard let bData = body.floatChannelData else { return }

        let sr = Float(sampleRate)
        let envAttack = 1 - exp(-1 / max(1, 2 * sr / 1000))
        let envRelease = 1 - exp(-1 / max(1, 65 * sr / 1000))
        let gainAttack = 1 - exp(-1 / max(1, 2 * sr / 1000))
        let gainRelease = 1 - exp(-1 / max(1, 90 * sr / 1000))
        var fizzEnergy: Float = 1e-12
        var bodyEnergy: Float = 1e-12
        var cutDB: Float = 0

        for i in 0..<frames {
            var fMS: Float = 0
            var bMS: Float = 0
            for ch in 0..<channels {
                fMS += fData[ch][i] * fData[ch][i]
                bMS += bData[ch][i] * bData[ch][i]
            }
            fMS /= Float(max(1, channels))
            bMS /= Float(max(1, channels))
            let fA = fMS > fizzEnergy ? envAttack : envRelease
            let bA = bMS > bodyEnergy ? envAttack : envRelease
            fizzEnergy += (fMS - fizzEnergy) * fA
            bodyEnergy += (bMS - bodyEnergy) * bA
            let fizzDB = 10 * log10(max(1e-12, fizzEnergy))
            let relativeDB = 10 * log10(max(1e-12, fizzEnergy) / max(1e-12, bodyEnergy))
            let wantedCut = fizzDB > -35
                ? min(1.2 * amount, max(0, relativeDB + 5) * 0.16 * amount)
                : 0
            let gA = wantedCut > cutDB ? gainAttack : gainRelease
            cutDB += (wantedCut - cutDB) * gA
            let cut = 1 - pow(10, -cutDB / 20)
            for ch in 0..<channels {
                data[ch][i] -= fData[ch][i] * cut
            }
        }

        // A tiny ultrasonic trim catches residual nonlinear hash without making
        // every style categorically darker.
        applyHighShelf(
            buffer: buffer,
            freq: 16500,
            gainDB: -0.3 * amount,
            sampleRate: sampleRate
        )
    }

    // MARK: - Dynamic de-harsh (surgical, not a blanket)

    /// Compress only the 3.5–9 kHz "squeak zone" when it exceeds the body.
    private nonisolated static func applyDynamicDeHarsh(
        buffer: AVAudioPCMBuffer,
        amount: Float,
        sampleRate: Double
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return }

        // Band-pass the harsh zone via HPF@3.5k then LPF@9k on a copy
        guard let harsh = copyBuffer(buffer) else { return }
        applyHighPass(buffer: harsh, cutoff: 3500, sampleRate: sampleRate)
        applyLowPass(buffer: harsh, cutoff: 9000, sampleRate: sampleRate)
        guard let hData = harsh.floatChannelData else { return }

        // Body reference (low-passed) for relative detection
        guard let body = copyBuffer(buffer) else { return }
        applyLowPass(buffer: body, cutoff: 2500, sampleRate: sampleRate)
        guard let bData = body.floatChannelData else { return }

        let sr = Float(sampleRate)
        let envAttack = 1 - exp(-1 / max(1, 4 * sr / 1000))
        let envRelease = 1 - exp(-1 / max(1, 95 * sr / 1000))
        let gainAttack = 1 - exp(-1 / max(1, 3 * sr / 1000))
        let gainRelease = 1 - exp(-1 / max(1, 85 * sr / 1000))
        var harshEnergy: Float = 1e-12
        var bodyEnergy: Float = 1e-12
        var cutDB: Float = 0
        let maxCutDB = 0.7 + amount * 1.8

        for i in 0..<frames {
            var hMS: Float = 0
            var bMS: Float = 0
            for ch in 0..<channels {
                hMS += hData[ch][i] * hData[ch][i]
                bMS += bData[ch][i] * bData[ch][i]
            }
            hMS /= Float(max(1, channels))
            bMS /= Float(max(1, channels))
            let hA = hMS > harshEnergy ? envAttack : envRelease
            let bA = bMS > bodyEnergy ? envAttack : envRelease
            harshEnergy += (hMS - harshEnergy) * hA
            bodyEnergy += (bMS - bodyEnergy) * bA

            let harshDB = 10 * log10(max(1e-12, harshEnergy))
            let relativeDB = 10 * log10(max(1e-12, harshEnergy) / max(1e-12, bodyEnergy))
            let wantedCut = harshDB > -42
                ? min(maxCutDB, max(0, relativeDB + 4) * 0.32 * amount)
                : 0
            let gA = wantedCut > cutDB ? gainAttack : gainRelease
            cutDB += (wantedCut - cutDB) * gA
            let cut = 1 - pow(10, -cutDB / 20)
            for ch in 0..<channels {
                data[ch][i] -= hData[ch][i] * cut
            }
        }
    }

    // MARK: - Mid-band saturation

    private nonisolated static func applyMidBandSaturation(
        buffer: AVAudioPCMBuffer,
        drive: Float,
        sampleRate: Double
    ) {
        // Extract mids, saturate, LPF again (kill tanh harmonics), then blend
        guard let mids = copyBuffer(buffer) else { return }
        applyHighPass(buffer: mids, cutoff: 280, sampleRate: sampleRate)
        applyLowPass(buffer: mids, cutoff: 3200, sampleRate: sampleRate)
        // Preserve the already-filtered linear path before adding harmonics.
        // This is identical to extracting it from the untouched destination
        // again, while avoiding two more full-track filter passes.
        guard let linearMids = copyBuffer(mids) else { return }

        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let mData = mids.floatChannelData else { return }

        let pre = 1 + drive * 1.8
        for ch in 0..<channels {
            let ptr = mData[ch]
            for i in 0..<frames {
                let m = ptr[i]
                ptr[i] = tanhf(m * pre)
            }
        }
        // Critical: filter out the HF hash tanh just created before we add it back
        applyLowPass(buffer: mids, cutoff: 4000, sampleRate: sampleRate)
        applyLowPass(buffer: mids, cutoff: 4000, sampleRate: sampleRate)

        guard let data = buffer.floatChannelData else { return }
        guard let linData = linearMids.floatChannelData else { return }

        let mix = drive * 0.24
        for ch in 0..<channels {
            for i in 0..<frames {
                data[ch][i] += (mData[ch][i] - linData[ch][i]) * mix
            }
        }
    }

    // MARK: - Stereo width

    private nonisolated static func applyStereoWidth(
        buffer: AVAudioPCMBuffer,
        width: Float,
        monoBelow: Float,
        lowSideGain: Float,
        sampleRate: Double
    ) {
        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)
        guard channels >= 2, let data = buffer.floatChannelData else { return }
        var hpX = [Float](repeating: 0, count: 4)
        var hpY = [Float](repeating: 0, count: 4)
        let hpR = exp(-2 * Float.pi * monoBelow / Float(sampleRate))
        let l = data[0], r = data[1]
        for i in 0..<frames {
            let mid = 0.5 * (l[i] + r[i])
            let side = 0.5 * (l[i] - r[i])
            var highSide = side
            for stage in 0..<4 {
                let output = hpR * (hpY[stage] + highSide - hpX[stage])
                hpX[stage] = highSide
                hpY[stage] = output
                highSide = output
            }
            let lowSide = side - highSide
            let shapedSide = lowSide * lowSideGain + highSide * width
            l[i] = mid + shapedSide
            r[i] = mid - shapedSide
        }
    }

    // MARK: - Maximizer

    private nonisolated static func applyMaximizer(
        buffer: AVAudioPCMBuffer,
        targetLUFS: Double,
        ceilingDB: Float,
        maxReductionDB: Float,
        sampleRate: Double
    ) {
        let currentLUFS = integratedLoudness(buffer: buffer, sampleRate: sampleRate)
        let peakEnvelope = truePeakEnvelope(buffer: buffer)
        var peakLinear: Float = 0
        if !peakEnvelope.isEmpty {
            vDSP_maxv(peakEnvelope, 1, &peakLinear, vDSP_Length(peakEnvelope.count))
        }
        let currentTruePeak = peakLinear > 0 ? 20 * log10(peakLinear) : -120
        var gainDB = clamped(Float(targetLUFS - currentLUFS), -6, 14)

        // Quality budget is peak-rarity aware. A handful of outliers can take
        // deep momentary reduction transparently; sustained hot material cannot.
        let sixDBDown = peakLinear * 0.5011872
        let hotFrames = peakEnvelope.reduce(into: 0) { count, value in
            if value >= sixDBDown { count += 1 }
        }
        let hotDuty = peakEnvelope.isEmpty
            ? 1
            : Float(hotFrames) / Float(peakEnvelope.count)
        let rarePeakAllowance: Float
        if hotDuty < 0.0005 {
            rarePeakAllowance = 8
        } else if hotDuty < 0.005 {
            rarePeakAllowance = 5
        } else if hotDuty < 0.03 {
            rarePeakAllowance = 2.5
        } else {
            rarePeakAllowance = 0
        }
        // High-crest material has more transient headroom to spend before its
        // program dynamics become dense. Dense/hot masters get no extra budget.
        let peakToLoudness = currentTruePeak - Float(currentLUFS)
        let crestAllowance = clamped((peakToLoudness - 11) * 0.55, 0, 3)
        let effectiveReductionBudget = maxReductionDB + rarePeakAllowance + crestAllowance
        let predictedReduction = currentTruePeak + gainDB - ceilingDB
        if predictedReduction > effectiveReductionBudget {
            gainDB -= predictedReduction - effectiveReductionBudget
        }
        applyGain(buffer: buffer, gain: pow(10, gainDB / 20))
        applyLookaheadTruePeakLimiter(
            buffer: buffer,
            ceilingDB: ceilingDB,
            lookaheadMs: 5,
            releaseMs: 110,
            sampleRate: sampleRate
        )
    }

    /// Stereo/multichannel-linked look-ahead limiter. The detector is a 4×
    /// polyphase windowed-sinc reconstruction, not a sample-peak scan.
    private nonisolated static func applyLookaheadTruePeakLimiter(
        buffer: AVAudioPCMBuffer,
        ceilingDB: Float,
        lookaheadMs: Float,
        releaseMs: Float,
        sampleRate: Double
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0, let data = buffer.floatChannelData else { return }

        let detector = truePeakEnvelope(buffer: buffer)
        let lookahead = max(1, Int(Double(lookaheadMs) * sampleRate / 1000))
        let detectorCeiling = pow(10 as Float, (ceilingDB - 0.08) / 20)

        // Sliding maximum over the future look-ahead window in O(n).
        var deque = [Int](repeating: 0, count: frames)
        var head = 0
        var tail = 0
        let preloadEnd = min(frames - 1, lookahead)
        if preloadEnd >= 0 {
            for index in 0...preloadEnd {
                while tail > head && detector[deque[tail - 1]] <= detector[index] { tail -= 1 }
                deque[tail] = index
                tail += 1
            }
        }

        let sr = Float(sampleRate)
        let attackSamples = max(1, Float(lookahead) * 0.22)
        let attack = 1 - exp(-1 / attackSamples)
        let release = 1 - exp(-1 / max(1, releaseMs * sr / 1000))
        var gain: Float = 1

        for i in 0..<frames {
            while head < tail && deque[head] < i { head += 1 }
            let futurePeak = head < tail ? detector[deque[head]] : detector[i]
            let target = futurePeak > detectorCeiling ? detectorCeiling / futurePeak : 1
            let coefficient = target < gain ? attack : release
            gain += (target - gain) * coefficient
            for ch in 0..<channels {
                data[ch][i] *= gain
            }

            let incoming = i + lookahead + 1
            if incoming < frames {
                while tail > head && detector[deque[tail - 1]] <= detector[incoming] { tail -= 1 }
                deque[tail] = incoming
                tail += 1
            }
        }

        // Independent post-pass verification. This only applies a tiny safety
        // trim when the attack envelope or reconstruction edge exceeded ceiling;
        // it is not the old whole-track peak normalizer.
        let finalPeak = truePeakLinear(buffer: buffer)
        let ceiling = pow(10 as Float, ceilingDB / 20)
        if finalPeak > ceiling {
            applyGain(buffer: buffer, gain: (ceiling / finalPeak) * 0.999)
        }
    }

    // MARK: - Shared compressor

    private nonisolated static func applySoftKneeCompressor(
        buffer: AVAudioPCMBuffer,
        thresholdDB: Float,
        ratio: Float,
        kneeDB: Float,
        attackMs: Float,
        releaseMs: Float,
        detectorMs: Float,
        sampleRate: Double,
        makeupDB: Float
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let data = buffer.floatChannelData else { return }
        let sr = Float(sampleRate)
        guard frames > 0, channels > 0, ratio > 1.0001 else { return }
        let detectorCoefficient = 1 - exp(-1 / max(1, detectorMs * sr / 1000))
        let attack = 1 - exp(-1 / max(1, attackMs * sr / 1000))
        let release = 1 - exp(-1 / max(1, releaseMs * sr / 1000))
        var detectorSquared: Float = 1e-12
        var gainDB: Float = 0
        let makeup = pow(10 as Float, makeupDB / 20)

        for i in 0..<frames {
            var meanSquare: Float = 0
            for ch in 0..<channels {
                let x = data[ch][i]
                meanSquare += x * x
            }
            meanSquare /= Float(channels)
            detectorSquared += (meanSquare - detectorSquared) * detectorCoefficient
            let levelDB = 10 * log10(max(1e-12, detectorSquared))
            let delta = levelDB - thresholdDB
            let halfKnee = max(0.001, kneeDB * 0.5)
            let targetGainDB: Float
            if delta <= -halfKnee {
                targetGainDB = 0
            } else if delta >= halfKnee {
                targetGainDB = -delta * (1 - 1 / ratio)
            } else {
                let kneePosition = delta + halfKnee
                targetGainDB = -(1 - 1 / ratio) * kneePosition * kneePosition / (2 * kneeDB)
            }
            let coefficient = targetGainDB < gainDB ? attack : release
            gainDB += (targetGainDB - gainDB) * coefficient
            let g = pow(10, gainDB / 20) * makeup
            for ch in 0..<channels { data[ch][i] *= g }
        }
    }

    // MARK: - Filters

    private nonisolated static func applyHighPass(buffer: AVAudioPCMBuffer, cutoff: Float, sampleRate: Double) {
        guard sampleRate > 0 else { return }
        let safeCutoff = clamped(cutoff, 5, Float(sampleRate) * 0.45)
        let w = 2 * Float.pi * safeCutoff / Float(sampleRate)
        let a = tan(w / 2)
        let b0 = 1 / (1 + sqrt(2) * a + a * a)
        applyBiquad(buffer: buffer, b0: b0, b1: -2 * b0, b2: b0,
                    a1: 2 * (a * a - 1) * b0, a2: (1 - sqrt(2) * a + a * a) * b0)
    }

    private nonisolated static func applyLowPass(buffer: AVAudioPCMBuffer, cutoff: Float, sampleRate: Double) {
        guard sampleRate > 0 else { return }
        let safeCutoff = clamped(cutoff, 5, Float(sampleRate) * 0.45)
        let w = 2 * Float.pi * safeCutoff / Float(sampleRate)
        let a = tan(w / 2)
        let n = 1 + sqrt(2) * a + a * a
        let b0 = (a * a) / n
        applyBiquad(buffer: buffer, b0: b0, b1: 2 * b0, b2: b0,
                    a1: 2 * (a * a - 1) / n, a2: (1 - sqrt(2) * a + a * a) / n)
    }

    private nonisolated static func applyPeaking(
        buffer: AVAudioPCMBuffer, freq: Float, gainDB: Float, q: Float, sampleRate: Double
    ) {
        guard sampleRate > 0, abs(gainDB) > 0.001 else { return }
        let safeFreq = clamped(freq, 10, Float(sampleRate) * 0.45)
        let A = pow(10 as Float, gainDB / 40)
        let w = 2 * Float.pi * safeFreq / Float(sampleRate)
        let alpha = sin(w) / (2 * max(0.1, q))
        let b0 = 1 + alpha * A
        let b1 = -2 * cos(w)
        let b2 = 1 - alpha * A
        let a0 = 1 + alpha / A
        let a1 = -2 * cos(w)
        let a2 = 1 - alpha / A
        let n = 1 / a0
        applyBiquad(buffer: buffer, b0: b0 * n, b1: b1 * n, b2: b2 * n, a1: a1 * n, a2: a2 * n)
    }

    private nonisolated static func applyLowShelf(
        buffer: AVAudioPCMBuffer, freq: Float, gainDB: Float, sampleRate: Double
    ) {
        guard sampleRate > 0, abs(gainDB) > 0.001 else { return }
        let safeFreq = clamped(freq, 10, Float(sampleRate) * 0.42)
        let A = pow(10 as Float, gainDB / 40)
        let w = 2 * Float.pi * safeFreq / Float(sampleRate)
        let cosw = cos(w), sinw = sin(w)
        let alpha = sinw / 2 * sqrt(max(0.01, (A + 1 / A) * (1 / 0.707 - 1) + 2))
        let tsa = 2 * sqrt(A) * alpha
        let b0 = A * ((A + 1) - (A - 1) * cosw + tsa)
        let b1 = 2 * A * ((A - 1) - (A + 1) * cosw)
        let b2 = A * ((A + 1) - (A - 1) * cosw - tsa)
        let a0 = (A + 1) + (A - 1) * cosw + tsa
        let a1 = -2 * ((A - 1) + (A + 1) * cosw)
        let a2 = (A + 1) + (A - 1) * cosw - tsa
        let n = 1 / a0
        applyBiquad(buffer: buffer, b0: b0 * n, b1: b1 * n, b2: b2 * n, a1: a1 * n, a2: a2 * n)
    }

    private nonisolated static func applyHighShelf(
        buffer: AVAudioPCMBuffer, freq: Float, gainDB: Float, sampleRate: Double
    ) {
        guard sampleRate > 0,
              abs(gainDB) > 0.001,
              freq < Float(sampleRate) * 0.45 else { return }
        let A = pow(10 as Float, gainDB / 40)
        let w = 2 * Float.pi * freq / Float(sampleRate)
        let cosw = cos(w), sinw = sin(w)
        let alpha = sinw / 2 * sqrt(max(0.01, (A + 1 / A) * (1 / 0.707 - 1) + 2))
        let tsa = 2 * sqrt(A) * alpha
        let b0 = A * ((A + 1) + (A - 1) * cosw + tsa)
        let b1 = -2 * A * ((A - 1) + (A + 1) * cosw)
        let b2 = A * ((A + 1) + (A - 1) * cosw - tsa)
        let a0 = (A + 1) - (A - 1) * cosw + tsa
        let a1 = 2 * ((A - 1) - (A + 1) * cosw)
        let a2 = (A + 1) - (A - 1) * cosw - tsa
        let n = 1 / a0
        applyBiquad(buffer: buffer, b0: b0 * n, b1: b1 * n, b2: b2 * n, a1: a1 * n, a2: a2 * n)
    }

    private nonisolated static func applyBiquad(
        buffer: AVAudioPCMBuffer,
        b0: Float, b1: Float, b2: Float, a1: Float, a2: Float
    ) {
        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)
        guard let data = buffer.floatChannelData else { return }
        for ch in 0..<channels {
            let ptr = data[ch]
            // Transposed DF-II with Double state is materially more stable for
            // sub-30 Hz filters at 96/192 kHz than Float Direct Form I.
            var z1: Double = 0
            var z2: Double = 0
            let db0 = Double(b0), db1 = Double(b1), db2 = Double(b2)
            let da1 = Double(a1), da2 = Double(a2)
            for i in 0..<frames {
                let x = Double(ptr[i])
                let y = db0 * x + z1
                z1 = db1 * x - da1 * y + z2
                z2 = db2 * x - da2 * y
                ptr[i] = y.isFinite ? Float(y) : 0
            }
        }
    }

    private nonisolated static func applyGain(buffer: AVAudioPCMBuffer, gain: Float) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard let data = buffer.floatChannelData else { return }
        var g = gain
        for ch in 0..<channels {
            vDSP_vsmul(data[ch], 1, &g, data[ch], 1, vDSP_Length(frames))
        }
    }

    // MARK: - Utils

    private nonisolated static func sanitize(buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return }
        for ch in 0..<channels {
            let pointer = data[ch]
            for i in 0..<frames where !pointer[i].isFinite {
                pointer[i] = 0
            }
        }
    }

    private nonisolated static func copyBuffer(_ source: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let c = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameCapacity) else {
            return nil
        }
        c.frameLength = source.frameLength
        let chs = Int(source.format.channelCount)
        let frames = Int(source.frameLength)
        for ch in 0..<chs {
            guard let s = source.floatChannelData?[ch], let d = c.floatChannelData?[ch] else { continue }
            memcpy(d, s, frames * MemoryLayout<Float>.size)
        }
        return c
    }

    private nonisolated static func monoAbs(from buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return [] }
        var mono = [Float](repeating: 0, count: frames)
        if channels == 1 {
            vDSP_vabs(data[0], 1, &mono, 1, vDSP_Length(frames))
        } else {
            var tmp = [Float](repeating: 0, count: frames)
            for ch in 0..<channels {
                vDSP_vabs(data[ch], 1, &tmp, 1, vDSP_Length(frames))
                vDSP_vadd(mono, 1, tmp, 1, &mono, 1, vDSP_Length(frames))
            }
            var s = 1 / Float(channels)
            vDSP_vsmul(mono, 1, &s, &mono, 1, vDSP_Length(frames))
        }
        return mono
    }

    private nonisolated static func downsampleWaveform(_ samples: [Float], target: Int) -> [Float] {
        guard !samples.isEmpty else { return [] }
        let step = max(1, samples.count / target)
        var out = [Float]()
        out.reserveCapacity(target + 1)
        samples.withUnsafeBufferPointer { buf in
            guard let base = buf.baseAddress else { return }
            var i = 0
            while i < samples.count {
                let end = min(i + step, samples.count)
                var m: Float = 0
                vDSP_maxv(base.advanced(by: i), 1, &m, vDSP_Length(end - i))
                out.append(m)
                i = end
            }
        }
        return out
    }

    private nonisolated static func clamped(_ value: Float, _ lower: Float, _ upper: Float) -> Float {
        min(upper, max(lower, value))
    }

    private nonisolated static func analyze(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double
    ) -> TrackAnalysis {
        let metrics = measure(buffer: buffer, sampleRate: sampleRate)
        let lowMid = bandRMSDB(buffer: buffer, low: 170, high: 680, sampleRate: sampleRate)
        let mid = bandRMSDB(buffer: buffer, low: 680, high: 2700, sampleRate: sampleRate)
        let relation = lowMid <= -119 || mid <= -119 ? 0 : lowMid - mid
        return TrackAnalysis(metrics: metrics, lowMidToMidDB: relation)
    }

    /// Exposed internally for the deterministic mastering probe.
    nonisolated static func measure(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double
    ) -> MasteringMetrics {
        let samplePeak = samplePeakLinear(buffer: buffer)
        let truePeak = truePeakLinear(buffer: buffer)
        let rms = unweightedRMSDB(buffer: buffer)
        let samplePeakDB = samplePeak > 0 ? 20 * log10(Double(samplePeak)) : -120
        let truePeakDB = truePeak > 0 ? 20 * log10(Double(truePeak)) : -120
        let crest = samplePeak > 0 && rms > -119 ? samplePeakDB - rms : 0
        let low = bandRMSDB(buffer: buffer, low: 60, high: 240, sampleRate: sampleRate)
        let mid = bandRMSDB(buffer: buffer, low: 500, high: 2000, sampleRate: sampleRate)
        let highUpper = min(16000.0, sampleRate * 0.42)
        let high = highUpper > 4200
            ? bandRMSDB(buffer: buffer, low: 4000, high: highUpper, sampleRate: sampleRate)
            : mid
        let hasBands = low > -119 && mid > -119
        let hasHigh = high > -119 && mid > -119

        return MasteringMetrics(
            integratedLUFS: integratedLoudness(buffer: buffer, sampleRate: sampleRate),
            samplePeakDBFS: samplePeakDB,
            truePeakDBTP: truePeakDB,
            rmsDBFS: rms,
            crestFactorDB: crest,
            stereoCorrelation: stereoCorrelation(buffer: buffer),
            lowToMidDB: hasBands ? low - mid : 0,
            highToMidDB: hasHigh ? high - mid : 0
        )
    }

    private nonisolated static func samplePeakLinear(buffer: AVAudioPCMBuffer) -> Float {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return 0 }
        var peak: Float = 0
        for ch in 0..<channels {
            var channelPeak: Float = 0
            vDSP_maxmgv(data[ch], 1, &channelPeak, vDSP_Length(frames))
            peak = max(peak, channelPeak)
        }
        return peak.isFinite ? peak : 0
    }

    private nonisolated static func unweightedRMSDB(buffer: AVAudioPCMBuffer) -> Double {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0, let data = buffer.floatChannelData else { return -120 }
        var energy: Double = 0
        for ch in 0..<channels {
            var meanSquare: Float = 0
            vDSP_measqv(data[ch], 1, &meanSquare, vDSP_Length(frames))
            energy += Double(max(0, meanSquare))
        }
        energy /= Double(channels)
        return energy > 1e-12 ? 10 * log10(energy) : -120
    }

    private nonisolated static func bandRMSDB(
        buffer: AVAudioPCMBuffer,
        low: Double,
        high: Double,
        sampleRate: Double
    ) -> Double {
        guard high > low, high < sampleRate * 0.49, let band = copyBuffer(buffer) else { return -120 }
        applyHighPass(buffer: band, cutoff: Float(low), sampleRate: sampleRate)
        applyHighPass(buffer: band, cutoff: Float(low), sampleRate: sampleRate)
        applyLowPass(buffer: band, cutoff: Float(high), sampleRate: sampleRate)
        applyLowPass(buffer: band, cutoff: Float(high), sampleRate: sampleRate)
        return unweightedRMSDB(buffer: band)
    }

    private nonisolated static func stereoCorrelation(buffer: AVAudioPCMBuffer) -> Double {
        let frames = Int(buffer.frameLength)
        guard frames > 0,
              buffer.format.channelCount >= 2,
              let left = buffer.floatChannelData?[0],
              let right = buffer.floatChannelData?[1] else { return 1 }
        var dot: Float = 0
        var leftEnergy: Float = 0
        var rightEnergy: Float = 0
        vDSP_dotpr(left, 1, right, 1, &dot, vDSP_Length(frames))
        vDSP_svesq(left, 1, &leftEnergy, vDSP_Length(frames))
        vDSP_svesq(right, 1, &rightEnergy, vDSP_Length(frames))
        let denominator = sqrt(Double(max(1e-20, leftEnergy * rightEnergy)))
        return min(1, max(-1, Double(dot) / denominator))
    }

    // MARK: BS.1770-5 integrated loudness

    private nonisolated static func integratedLoudness(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double
    ) -> Double {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0,
              channels > 0,
              sampleRate > 0,
              let weighted = copyBuffer(buffer),
              let data = weighted.floatChannelData else { return -120 }

        applyKWeighting(buffer: weighted, sampleRate: sampleRate)
        let blockFrames = min(frames, max(1, Int((0.400 * sampleRate).rounded())))
        let hopFrames = max(1, Int((0.100 * sampleRate).rounded()))
        var energies: [Double] = []
        var start = 0

        while start + blockFrames <= frames {
            var blockEnergy: Double = 0
            for ch in 0..<channels {
                var meanSquare: Float = 0
                vDSP_measqv(
                    data[ch].advanced(by: start),
                    1,
                    &meanSquare,
                    vDSP_Length(blockFrames)
                )
                // Champagne currently accepts mono/stereo material. For any
                // additional channels, a neutral weight is safer than guessing
                // an LFE position from an unspecified file layout.
                blockEnergy += Double(max(0, meanSquare))
            }
            if blockEnergy > 1e-15 { energies.append(blockEnergy) }
            if frames == blockFrames { break }
            start += hopFrames
        }

        let absoluteGated = energies.filter {
            -0.691 + 10 * log10(max(1e-15, $0)) >= -70
        }
        guard !absoluteGated.isEmpty else { return -120 }
        let absoluteMean = absoluteGated.reduce(0, +) / Double(absoluteGated.count)
        let relativeGate = -0.691 + 10 * log10(max(1e-15, absoluteMean)) - 10
        let gate = max(-70, relativeGate)
        let relativeGated = absoluteGated.filter {
            -0.691 + 10 * log10(max(1e-15, $0)) >= gate
        }
        guard !relativeGated.isEmpty else { return -120 }
        let integratedEnergy = relativeGated.reduce(0, +) / Double(relativeGated.count)
        return -0.691 + 10 * log10(max(1e-15, integratedEnergy))
    }

    private nonisolated static func applyKWeighting(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double
    ) {
        // Exact BS.1770 analog prototypes, bilinear-transformed for the source rate.
        let shelfFrequency = 1681.974450955533
        let shelfGain = 3.999843853973347
        let shelfQ = 0.7071752369554196
        let k = tan(Double.pi * shelfFrequency / sampleRate)
        let vh = pow(10.0, shelfGain / 20)
        let vb = pow(vh, 0.4996667741545416)
        let denominator = 1 + k / shelfQ + k * k
        applyBiquad(
            buffer: buffer,
            b0: Float((vh + vb * k / shelfQ + k * k) / denominator),
            b1: Float(2 * (k * k - vh) / denominator),
            b2: Float((vh - vb * k / shelfQ + k * k) / denominator),
            a1: Float(2 * (k * k - 1) / denominator),
            a2: Float((1 - k / shelfQ + k * k) / denominator)
        )

        let highPassFrequency = 38.13547087602444
        let highPassQ = 0.5003270373238773
        let kh = tan(Double.pi * highPassFrequency / sampleRate)
        let hpDenominator = 1 + kh / highPassQ + kh * kh
        applyBiquad(
            buffer: buffer,
            b0: 1,
            b1: -2,
            b2: 1,
            a1: Float(2 * (kh * kh - 1) / hpDenominator),
            a2: Float((1 - kh / highPassQ + kh * kh) / hpDenominator)
        )
    }

    // MARK: 4× polyphase true-peak reconstruction

    private nonisolated static func truePeakDBTP(buffer: AVAudioPCMBuffer) -> Float {
        let peak = truePeakLinear(buffer: buffer)
        return peak > 0 ? 20 * log10(peak) : -120
    }

    private nonisolated static func truePeakLinear(buffer: AVAudioPCMBuffer) -> Float {
        var peak: Float = 0
        let envelope = truePeakEnvelope(buffer: buffer)
        if !envelope.isEmpty {
            vDSP_maxv(envelope, 1, &peak, vDSP_Length(envelope.count))
        }
        return peak.isFinite ? peak : 0
    }

    private nonisolated static func truePeakEnvelope(buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0, let data = buffer.floatChannelData else { return [] }

        var envelope = [Float](repeating: 0, count: frames)
        var magnitudes = [Float](repeating: 0, count: frames)
        for ch in 0..<channels {
            vDSP_vabs(data[ch], 1, &magnitudes, 1, vDSP_Length(frames))
            vDSP_vmax(envelope, 1, magnitudes, 1, &envelope, 1, vDSP_Length(frames))
        }

        let radius = 8
        let tapCount = radius * 2 + 1
        let outputCount = frames - tapCount + 1
        guard outputCount > 0 else { return envelope }

        var filtered = [Float](repeating: 0, count: outputCount)
        for phase in 1..<4 {
            let coefficients = truePeakCoefficients(phase: phase, radius: radius)
            for ch in 0..<channels {
                coefficients.withUnsafeBufferPointer { coefficientBuffer in
                    guard let coefficientsBase = coefficientBuffer.baseAddress else { return }
                    vDSP_conv(
                        data[ch],
                        1,
                        coefficientsBase,
                        1,
                        &filtered,
                        1,
                        vDSP_Length(outputCount),
                        vDSP_Length(tapCount)
                    )
                }
                for i in 0..<outputCount {
                    let index = i + radius
                    envelope[index] = max(envelope[index], abs(filtered[i]))
                }
            }
        }
        return envelope
    }

    private nonisolated static func truePeakCoefficients(phase: Int, radius: Int) -> [Float] {
        let fraction = Double(phase) / 4.0
        var coefficients = [Double]()
        coefficients.reserveCapacity(radius * 2 + 1)
        for index in -radius...radius {
            let distance = fraction - Double(index)
            let sinc = abs(distance) < 1e-12
                ? 1.0
                : sin(Double.pi * distance) / (Double.pi * distance)
            let normalized = abs(distance) / Double(radius + 1)
            let window = normalized < 1
                ? 0.42 + 0.5 * cos(Double.pi * normalized) + 0.08 * cos(2 * Double.pi * normalized)
                : 0
            coefficients.append(sinc * window)
        }
        let sum = coefficients.reduce(0, +)
        return coefficients.map { Float($0 / max(1e-12, sum)) }
    }

    private nonisolated static func writeWAV(
        buffer: AVAudioPCMBuffer,
        to url: URL,
        sampleRate: Double,
        channels: AVAudioChannelCount
    ) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            // Preview/intermediate stays 32-bit float. Final export performs the
            // sole 24-bit quantization and TPDF dither after trims/fades.
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: true
        ]
        let out = try AVAudioFile(
            forWriting: url, settings: settings,
            commonFormat: .pcmFormatFloat32, interleaved: false
        )
        try out.write(from: buffer)
    }
}
