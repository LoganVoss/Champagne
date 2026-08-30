import Foundation
@preconcurrency import AVFoundation
import Darwin

// Standalone mastering regression probe.
//
// Compile this file in the same module as AudioMasteringProcessor.swift so it
// can call the internal MasteringEngine without adding an Xcode test target:
//
//   mkdir -p work
//   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
//   xcrun --sdk macosx swiftc \
//     -O -swift-version 5 -default-isolation MainActor -parse-as-library \
//     -module-name ChampagneProbe \
//     Champagne/AudioMasteringProcessor.swift Tools/MasteringProbe.swift \
//     -framework AVFoundation -framework Accelerate -framework Combine \
//     -o work/mastering-probe
//
// Run:
//
//   work/mastering-probe --json work/mastering-probe.json
//   work/mastering-probe --strict --artifacts work/mastering-probe-artifacts

private enum ProbeError: LocalizedError {
    case invalidArgument(String)
    case cannotCreateAudioBuffer
    case unsupportedAudioFormat(String)
    case missingMaster(String)

    var errorDescription: String? {
        switch self {
        case .invalidArgument(let message): return message
        case .cannotCreateAudioBuffer: return "Could not allocate an audio fixture buffer."
        case .unsupportedAudioFormat(let message): return message
        case .missingMaster(let style): return "The engine did not return a master for \(style)."
        }
    }
}

private struct Options {
    var jsonURL: URL?
    var artifactsURL: URL?
    var strict = false
    var showHelp = false

    static func parse(_ arguments: [String]) throws -> Options {
        var options = Options()
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--json":
                index += 1
                guard index < arguments.count else {
                    throw ProbeError.invalidArgument("--json requires a path.")
                }
                options.jsonURL = URL(fileURLWithPath: arguments[index]).standardizedFileURL
            case "--artifacts":
                index += 1
                guard index < arguments.count else {
                    throw ProbeError.invalidArgument("--artifacts requires a directory path.")
                }
                options.artifactsURL = URL(fileURLWithPath: arguments[index], isDirectory: true)
                    .standardizedFileURL
            case "--strict":
                options.strict = true
            case "-h", "--help":
                options.showHelp = true
            default:
                throw ProbeError.invalidArgument("Unknown argument: \(arguments[index])")
            }
            index += 1
        }
        return options
    }
}

private enum FixtureKind: String, Codable {
    case isolatedPeak = "isolated_peak"
    case transientTrain = "transient_train"
    case brightBursts = "bright_bursts"
    case stereoSub = "stereo_sub"
    case alreadyHot = "already_hot"
}

private struct Fixture {
    let kind: FixtureKind
    let url: URL
}

private struct DecodedAudio {
    let sampleRate: Double
    let channels: [[Double]]
    let frameCount: Int
    let bitDepth: Int?
}

private struct AudioMetrics: Codable {
    let sampleRate: Double
    let channels: Int
    let frameCount: Int
    let durationSeconds: Double
    let bitDepth: Int?
    let integratedLUFS: Double
    let loudnessRangeLU: Double
    let momentaryMaxLUFS: Double
    let samplePeakDBFS: Double
    let truePeakEstimateDBTP: Double
    let estimatedIntersampleClipCount: Int
    let clippedSampleCount: Int
    let pinnedSampleCount: Int
    let nonFiniteSampleCount: Int
    let rmsDBFS: Double
    let crestFactorDB: Double
    let peakToLoudnessRatioDB: Double
    let dcOffsetPeak: Double
    let stereoCorrelation: Double?
    let bassCorrelation: Double?
    let sideToMidDB: Double?
    let bassSideToMidDB: Double?
    let highBandToFullDB: Double
}

private struct MetricDelta: Codable {
    let loudnessLU: Double
    let truePeakDB: Double
    let crestFactorDB: Double
    let highBandBalanceDB: Double
    let stereoCorrelation: Double?
    let bassSideToMidDB: Double?
}

private enum CheckSeverity: String, Codable {
    case error
    case warning
}

private struct ProbeCheck: Codable {
    let name: String
    let severity: CheckSeverity
    let passed: Bool
    let detail: String
}

private struct StyleReport: Codable {
    let style: String
    let metrics: AudioMetrics
    let deltaFromInput: MetricDelta
    let checks: [ProbeCheck]
}

private struct FixtureReport: Codable {
    let fixture: String
    let input: AudioMetrics
    let styles: [StyleReport]
}

private struct ProbeSummary: Codable {
    let fixtures: Int
    let masters: Int
    let errors: Int
    let warnings: Int
    let strictMode: Bool
}

private struct ProbeReport: Codable {
    let formatVersion: Int
    let meterDescription: String
    let fixtures: [FixtureReport]
    let suiteChecks: [ProbeCheck]
    let summary: ProbeSummary
}

private struct DeterministicNoise {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0x9E37_79B9_7F4A_7C15 : seed
    }

    mutating func nextSigned() -> Double {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        let mantissa = state >> 11
        let unit = Double(mantissa) * (1.0 / 9_007_199_254_740_992.0)
        return unit * 2 - 1
    }
}

private struct Biquad {
    let b0: Double
    let b1: Double
    let b2: Double
    let a1: Double
    let a2: Double

    func process(_ input: [Double]) -> [Double] {
        var output = [Double](repeating: 0, count: input.count)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for index in input.indices {
            let x0 = input[index].isFinite ? input[index] : 0
            let y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            output[index] = y0
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = y0
        }
        return output
    }

    static func highPass(frequency: Double, q: Double, sampleRate: Double) -> Biquad {
        let omega = 2 * Double.pi * min(frequency, sampleRate * 0.49) / sampleRate
        let cosine = cos(omega)
        let alpha = sin(omega) / (2 * q)
        let a0 = 1 + alpha
        return Biquad(
            b0: ((1 + cosine) / 2) / a0,
            b1: (-(1 + cosine)) / a0,
            b2: ((1 + cosine) / 2) / a0,
            a1: (-2 * cosine) / a0,
            a2: (1 - alpha) / a0
        )
    }

    static func lowPass(frequency: Double, q: Double, sampleRate: Double) -> Biquad {
        let omega = 2 * Double.pi * min(frequency, sampleRate * 0.49) / sampleRate
        let cosine = cos(omega)
        let alpha = sin(omega) / (2 * q)
        let a0 = 1 + alpha
        return Biquad(
            b0: ((1 - cosine) / 2) / a0,
            b1: (1 - cosine) / a0,
            b2: ((1 - cosine) / 2) / a0,
            a1: (-2 * cosine) / a0,
            a2: (1 - alpha) / a0
        )
    }

    static func highShelf(
        frequency: Double,
        gainDB: Double,
        q: Double,
        sampleRate: Double
    ) -> Biquad {
        let amplitude = pow(10, gainDB / 40)
        let omega = 2 * Double.pi * min(frequency, sampleRate * 0.49) / sampleRate
        let cosine = cos(omega)
        let alpha = sin(omega) / (2 * q)
        let rootA = sqrt(amplitude)
        let twoRootAAlpha = 2 * rootA * alpha
        let a0 = (amplitude + 1) - (amplitude - 1) * cosine + twoRootAAlpha
        return Biquad(
            b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + twoRootAAlpha) / a0,
            b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine) / a0,
            b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - twoRootAAlpha) / a0,
            a1: 2 * ((amplitude - 1) - (amplitude + 1) * cosine) / a0,
            a2: ((amplitude + 1) - (amplitude - 1) * cosine - twoRootAAlpha) / a0
        )
    }
}

private enum FixtureFactory {
    static let sampleRate = 48_000.0
    static let duration = 8.0

    static func makeAll(in directory: URL) throws -> [Fixture] {
        let inputs = directory.appendingPathComponent("inputs", isDirectory: true)
        try FileManager.default.createDirectory(at: inputs, withIntermediateDirectories: true)
        return try [
            makeIsolatedPeak(in: inputs),
            makeTransientTrain(in: inputs),
            makeBrightBursts(in: inputs),
            makeStereoSub(in: inputs),
            makeAlreadyHot(in: inputs)
        ]
    }

    private static func makeIsolatedPeak(in directory: URL) throws -> Fixture {
        let count = Int(sampleRate * duration)
        var left = [Float](repeating: 0, count: count)
        var right = left
        var noise = DeterministicNoise(seed: 0xA11C_E001)
        var lowNoise = 0.0
        for index in 0..<count {
            let time = Double(index) / sampleRate
            lowNoise = lowNoise * 0.985 + noise.nextSigned() * 0.015
            let body = 0.55 * sin(2 * .pi * 110 * time)
                + 0.28 * sin(2 * .pi * 220 * time + 0.3)
                + 0.15 * sin(2 * .pi * 880 * time + 1.1)
                + 0.18 * lowNoise
            left[index] = Float(body)
            right[index] = Float(body * 0.985 + 0.018 * sin(2 * .pi * 1_760 * time))
        }
        normalizeRMSAndPeak(&left, &right, targetRMSDB: -24, peakCeilingDB: -8)
        let isolatedPeak = Float(pow(10, -0.5 / 20))
        for second in [2.125, 5.375] {
            let frame = Int(second * sampleRate)
            left[frame] = isolatedPeak
            right[frame] = isolatedPeak
        }
        return try write(kind: .isolatedPeak, left: left, right: right, directory: directory)
    }

    private static func makeTransientTrain(in directory: URL) throws -> Fixture {
        let count = Int(sampleRate * duration)
        var left = [Float](repeating: 0, count: count)
        var right = left
        var noise = DeterministicNoise(seed: 0x7A45_13A7)
        for index in 0..<count {
            let time = Double(index) / sampleRate
            let beatPhase = time.truncatingRemainder(dividingBy: 0.5)
            let kickEnvelope = exp(-beatPhase * 20)
            let kickFrequency = 48 + 75 * exp(-beatPhase * 35)
            let kick = kickEnvelope * sin(2 * .pi * kickFrequency * time)

            let snarePhase = (time + 0.25).truncatingRemainder(dividingBy: 1.0)
            let snareEnvelope = snarePhase < 0.16 ? exp(-snarePhase * 30) : 0
            let snare = noise.nextSigned() * snareEnvelope
            let bed = 0.13 * sin(2 * .pi * 196 * time)
                + 0.08 * sin(2 * .pi * 392 * time + 0.7)
            left[index] = Float(0.72 * kick + 0.24 * snare + bed)
            right[index] = Float(0.70 * kick - 0.21 * snare + bed * 0.98)
        }
        normalizePeak(&left, &right, targetDB: -1.5)
        return try write(kind: .transientTrain, left: left, right: right, directory: directory)
    }

    private static func makeBrightBursts(in directory: URL) throws -> Fixture {
        let count = Int(sampleRate * duration)
        var left = [Float](repeating: 0, count: count)
        var right = left
        var noise = DeterministicNoise(seed: 0xB817_6A7E)
        for index in 0..<count {
            let time = Double(index) / sampleRate
            let phase = time.truncatingRemainder(dividingBy: 0.8)
            let envelope = phase < 0.14 ? pow(1 - phase / 0.14, 1.7) : 0
            let hiss = noise.nextSigned()
            let body = 0.16 * sin(2 * .pi * 180 * time)
                + 0.11 * sin(2 * .pi * 720 * time + 0.4)
            let brightLeft = envelope * (
                0.52 * sin(2 * .pi * 5_600 * time)
                    + 0.33 * sin(2 * .pi * 8_300 * time + 0.2)
                    + 0.24 * sin(2 * .pi * 11_200 * time + 1.0)
                    + 0.16 * hiss
            )
            let brightRight = envelope * (
                0.49 * sin(2 * .pi * 6_100 * time + 0.5)
                    + 0.31 * sin(2 * .pi * 9_100 * time + 0.9)
                    + 0.20 * sin(2 * .pi * 12_000 * time + 1.4)
                    - 0.14 * hiss
            )
            left[index] = Float(body + brightLeft)
            right[index] = Float(body * 0.98 + brightRight)
        }
        normalizePeak(&left, &right, targetDB: -1.2)
        return try write(kind: .brightBursts, left: left, right: right, directory: directory)
    }

    private static func makeStereoSub(in directory: URL) throws -> Fixture {
        let count = Int(sampleRate * duration)
        var left = [Float](repeating: 0, count: count)
        var right = left
        for index in 0..<count {
            let time = Double(index) / sampleRate
            let subSide = 0.72 * sin(2 * .pi * 70 * time)
            let monoBody = 0.31 * sin(2 * .pi * 700 * time + 0.3)
                + 0.16 * sin(2 * .pi * 1_400 * time)
            let highSide = 0.08 * sin(2 * .pi * 5_000 * time)
            left[index] = Float(monoBody + subSide + highSide)
            right[index] = Float(monoBody - subSide - highSide)
        }
        normalizePeak(&left, &right, targetDB: -2)
        return try write(kind: .stereoSub, left: left, right: right, directory: directory)
    }

    private static func makeAlreadyHot(in directory: URL) throws -> Fixture {
        let count = Int(sampleRate * duration)
        var left = [Float](repeating: 0, count: count)
        var right = left
        var noise = DeterministicNoise(seed: 0xA1E4_AD7A)
        for index in 0..<count {
            let time = Double(index) / sampleRate
            let modulation = 0.78 + 0.22 * sin(2 * .pi * 0.5 * time)
            let common = modulation * (
                0.42 * sin(2 * .pi * 55 * time)
                    + 0.29 * sin(2 * .pi * 110 * time + 0.2)
                    + 0.22 * sin(2 * .pi * 220 * time + 0.7)
                    + 0.16 * sin(2 * .pi * 880 * time + 1.3)
            )
            let grit = 0.08 * noise.nextSigned()
            left[index] = Float(common + 0.13 * sin(2 * .pi * 2_400 * time) + grit)
            right[index] = Float(common + 0.12 * sin(2 * .pi * 2_650 * time + 0.4) - grit * 0.65)
        }
        normalizeRMSAndPeak(&left, &right, targetRMSDB: -10.5, peakCeilingDB: -0.8)
        return try write(kind: .alreadyHot, left: left, right: right, directory: directory)
    }

    private static func normalizePeak(_ left: inout [Float], _ right: inout [Float], targetDB: Double) {
        var peak = 0.0
        for index in left.indices {
            peak = max(peak, abs(Double(left[index])), abs(Double(right[index])))
        }
        guard peak > 0 else { return }
        let gain = pow(10, targetDB / 20) / peak
        applyGain(&left, &right, gain: gain)
    }

    private static func normalizeRMSAndPeak(
        _ left: inout [Float],
        _ right: inout [Float],
        targetRMSDB: Double,
        peakCeilingDB: Double
    ) {
        var energy = 0.0
        var peak = 0.0
        for index in left.indices {
            let l = Double(left[index])
            let r = Double(right[index])
            energy += l * l + r * r
            peak = max(peak, abs(l), abs(r))
        }
        let rms = sqrt(energy / Double(max(1, left.count * 2)))
        guard rms > 0, peak > 0 else { return }
        let rmsGain = pow(10, targetRMSDB / 20) / rms
        let peakGain = pow(10, peakCeilingDB / 20) / peak
        applyGain(&left, &right, gain: min(rmsGain, peakGain))
    }

    private static func applyGain(_ left: inout [Float], _ right: inout [Float], gain: Double) {
        for index in left.indices {
            left[index] = Float(Double(left[index]) * gain)
            right[index] = Float(Double(right[index]) * gain)
        }
    }

    private static func write(
        kind: FixtureKind,
        left: [Float],
        right: [Float],
        directory: URL
    ) throws -> Fixture {
        guard left.count == right.count,
              let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: 2,
                interleaved: false
              ),
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(left.count)
              ),
              let channelData = buffer.floatChannelData else {
            throw ProbeError.cannotCreateAudioBuffer
        }

        buffer.frameLength = AVAudioFrameCount(left.count)
        left.withUnsafeBufferPointer { source in
            guard let base = source.baseAddress else { return }
            channelData[0].update(from: base, count: left.count)
        }
        right.withUnsafeBufferPointer { source in
            guard let base = source.baseAddress else { return }
            channelData[1].update(from: base, count: right.count)
        }

        let url = directory.appendingPathComponent(kind.rawValue).appendingPathExtension("wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 2,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false
        ]
        let file = try AVAudioFile(
            forWriting: url,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        try file.write(from: buffer)
        return Fixture(kind: kind, url: url)
    }
}

private enum AudioAnalyzer {
    static func read(_ url: URL) throws -> DecodedAudio {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let length = file.length
        guard length > 0,
              length <= AVAudioFramePosition(UInt32.max),
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(length)
              ) else {
            throw ProbeError.unsupportedAudioFormat("Could not decode \(url.lastPathComponent).")
        }
        try file.read(into: buffer)
        guard let channelData = buffer.floatChannelData else {
            throw ProbeError.unsupportedAudioFormat(
                "\(url.lastPathComponent) did not decode to non-interleaved Float32 PCM."
            )
        }

        let frameCount = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        var channels = [[Double]]()
        channels.reserveCapacity(channelCount)
        for channel in 0..<channelCount {
            let pointer = channelData[channel]
            var samples = [Double](repeating: 0, count: frameCount)
            for frame in 0..<frameCount {
                samples[frame] = Double(pointer[frame])
            }
            channels.append(samples)
        }

        let bitDepth = (file.fileFormat.settings[AVLinearPCMBitDepthKey] as? NSNumber)?.intValue
        return DecodedAudio(
            sampleRate: format.sampleRate,
            channels: channels,
            frameCount: frameCount,
            bitDepth: bitDepth
        )
    }

    static func metrics(for audio: DecodedAudio) -> AudioMetrics {
        var samplePeak = 0.0
        var energy = 0.0
        var nonFinite = 0
        var clipped = 0
        var pinned = 0
        var dcPeak = 0.0
        var cleanChannels = [[Double]]()
        cleanChannels.reserveCapacity(audio.channels.count)

        for channel in audio.channels {
            var clean = [Double](repeating: 0, count: channel.count)
            var sum = 0.0
            for index in channel.indices {
                let raw = channel[index]
                guard raw.isFinite else {
                    nonFinite += 1
                    continue
                }
                clean[index] = raw
                let magnitude = abs(raw)
                samplePeak = max(samplePeak, magnitude)
                energy += raw * raw
                sum += raw
                if magnitude >= 1 { clipped += 1 }
                if magnitude >= 0.999_999 { pinned += 1 }
            }
            if !channel.isEmpty {
                dcPeak = max(dcPeak, abs(sum / Double(channel.count)))
            }
            cleanChannels.append(clean)
        }

        let sampleCount = max(1, audio.frameCount * max(1, audio.channels.count))
        let rms = sqrt(energy / Double(sampleCount))
        let truePeak = cubicTruePeak(channels: cleanChannels)
        let loudness = bs1770(channels: cleanChannels, sampleRate: audio.sampleRate)
        let stereo = stereoMetrics(channels: cleanChannels, sampleRate: audio.sampleRate)
        let highBand = highBandRatio(channels: cleanChannels, sampleRate: audio.sampleRate)
        let samplePeakDB = amplitudeDB(samplePeak)
        let truePeakDB = amplitudeDB(truePeak.peak)
        let rmsDB = amplitudeDB(rms)

        return AudioMetrics(
            sampleRate: audio.sampleRate,
            channels: audio.channels.count,
            frameCount: audio.frameCount,
            durationSeconds: Double(audio.frameCount) / audio.sampleRate,
            bitDepth: audio.bitDepth,
            integratedLUFS: loudness.integrated,
            loudnessRangeLU: loudness.range,
            momentaryMaxLUFS: loudness.momentaryMax,
            samplePeakDBFS: samplePeakDB,
            truePeakEstimateDBTP: truePeakDB,
            estimatedIntersampleClipCount: truePeak.overs,
            clippedSampleCount: clipped,
            pinnedSampleCount: pinned,
            nonFiniteSampleCount: nonFinite,
            rmsDBFS: rmsDB,
            crestFactorDB: samplePeakDB - rmsDB,
            peakToLoudnessRatioDB: truePeakDB - loudness.integrated,
            dcOffsetPeak: dcPeak,
            stereoCorrelation: stereo.correlation,
            bassCorrelation: stereo.bassCorrelation,
            sideToMidDB: stereo.sideToMid,
            bassSideToMidDB: stereo.bassSideToMid,
            highBandToFullDB: highBand
        )
    }

    private static func amplitudeDB(_ amplitude: Double) -> Double {
        guard amplitude > 1e-12 else { return -160 }
        return 20 * log10(amplitude)
    }

    private static func powerDB(_ power: Double) -> Double {
        guard power > 1e-16 else { return -160 }
        return 10 * log10(power)
    }

    private static func cubicTruePeak(channels: [[Double]]) -> (peak: Double, overs: Int) {
        var peak = 0.0
        var overs = 0
        for samples in channels where !samples.isEmpty {
            for index in samples.indices {
                peak = max(peak, abs(samples[index]))
                guard index + 1 < samples.count else { continue }
                let p0 = samples[max(0, index - 1)]
                let p1 = samples[index]
                let p2 = samples[index + 1]
                let p3 = samples[min(samples.count - 1, index + 2)]
                for phase in 1...3 {
                    let t = Double(phase) / 4
                    let t2 = t * t
                    let t3 = t2 * t
                    let interpolated = 0.5 * (
                        2 * p1
                            + (-p0 + p2) * t
                            + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                            + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
                    )
                    let magnitude = abs(interpolated)
                    peak = max(peak, magnitude)
                    if magnitude >= 1 { overs += 1 }
                }
            }
        }
        return (peak, overs)
    }

    private static func bs1770(
        channels: [[Double]],
        sampleRate: Double
    ) -> (integrated: Double, range: Double, momentaryMax: Double) {
        guard !channels.isEmpty else { return (-120, 0, -120) }
        let shelf = Biquad.highShelf(
            frequency: 1_681.974_450_955_533,
            gainDB: 3.999_843_853_973_347,
            q: 0.707_175_236_955_419_6,
            sampleRate: sampleRate
        )
        let rumbleFilter = Biquad.highPass(
            frequency: 38.135_470_876_024_44,
            q: 0.500_327_037_323_877_3,
            sampleRate: sampleRate
        )
        let weighted = channels.map { rumbleFilter.process(shelf.process($0)) }

        let momentaryEnergies = blockEnergies(
            channels: weighted,
            blockFrames: max(1, Int((0.400 * sampleRate).rounded())),
            hopFrames: max(1, Int((0.100 * sampleRate).rounded()))
        )
        let integrated = gatedLoudness(energies: momentaryEnergies, relativeGateLU: -10)
        let momentaryMax = momentaryEnergies.map(loudnessFromEnergy).max() ?? -120

        let shortTermEnergies = blockEnergies(
            channels: weighted,
            blockFrames: max(1, Int((3.0 * sampleRate).rounded())),
            hopFrames: max(1, Int((1.0 * sampleRate).rounded()))
        )
        let shortTermLoudness = shortTermEnergies.map(loudnessFromEnergy)
        let lraGate = max(-70, integrated - 20)
        let gatedShortTerm = shortTermLoudness.filter { $0 >= lraGate }.sorted()
        let range: Double
        if gatedShortTerm.count >= 2 {
            range = max(0, percentile(gatedShortTerm, fraction: 0.95)
                - percentile(gatedShortTerm, fraction: 0.10))
        } else {
            range = 0
        }
        return (integrated, range, momentaryMax)
    }

    private static func blockEnergies(
        channels: [[Double]],
        blockFrames: Int,
        hopFrames: Int
    ) -> [Double] {
        guard let frameCount = channels.first?.count, frameCount > 0 else { return [] }
        if frameCount < blockFrames {
            var energy = 0.0
            for channel in channels {
                energy += channel.reduce(0) { $0 + $1 * $1 } / Double(frameCount)
            }
            return [energy]
        }

        // Prefix sums keep block metering linear in track length. Re-summing
        // every overlapping 400 ms window makes even a short corpus needlessly
        // expensive in an unoptimized development build.
        let energyPrefixes: [[Double]] = channels.map { channel in
            var prefix = [Double](repeating: 0, count: frameCount + 1)
            for frame in 0..<frameCount {
                prefix[frame + 1] = prefix[frame] + channel[frame] * channel[frame]
            }
            return prefix
        }

        var output = [Double]()
        var start = 0
        while start + blockFrames <= frameCount {
            var energy = 0.0
            let end = start + blockFrames
            for prefix in energyPrefixes {
                energy += (prefix[end] - prefix[start]) / Double(blockFrames)
            }
            output.append(energy)
            start += hopFrames
        }
        return output
    }

    private static func gatedLoudness(energies: [Double], relativeGateLU: Double) -> Double {
        let absolute = energies.filter { loudnessFromEnergy($0) >= -70 }
        guard !absolute.isEmpty else { return -120 }
        let ungatedEnergy = absolute.reduce(0, +) / Double(absolute.count)
        let relativeThreshold = loudnessFromEnergy(ungatedEnergy) + relativeGateLU
        let threshold = max(-70, relativeThreshold)
        let relative = absolute.filter { loudnessFromEnergy($0) >= threshold }
        guard !relative.isEmpty else { return -120 }
        return loudnessFromEnergy(relative.reduce(0, +) / Double(relative.count))
    }

    private static func loudnessFromEnergy(_ energy: Double) -> Double {
        guard energy > 1e-16 else { return -120 }
        return -0.691 + 10 * log10(energy)
    }

    private static func percentile(_ sorted: [Double], fraction: Double) -> Double {
        guard !sorted.isEmpty else { return 0 }
        let position = min(1, max(0, fraction)) * Double(sorted.count - 1)
        let lower = Int(floor(position))
        let upper = Int(ceil(position))
        guard lower != upper else { return sorted[lower] }
        let blend = position - Double(lower)
        return sorted[lower] * (1 - blend) + sorted[upper] * blend
    }

    private static func stereoMetrics(
        channels: [[Double]],
        sampleRate: Double
    ) -> (correlation: Double?, bassCorrelation: Double?, sideToMid: Double?, bassSideToMid: Double?) {
        guard channels.count >= 2 else { return (nil, nil, nil, nil) }
        let left = channels[0]
        let right = channels[1]
        let correlation = correlation(left, right)
        let sideToMid = sideToMidDB(left, right)
        let lowPass = Biquad.lowPass(frequency: 130, q: 0.7071, sampleRate: sampleRate)
        let bassLeft = lowPass.process(left)
        let bassRight = lowPass.process(right)
        return (
            correlation,
            self.correlation(bassLeft, bassRight),
            sideToMid,
            sideToMidDB(bassLeft, bassRight)
        )
    }

    private static func correlation(_ left: [Double], _ right: [Double]) -> Double? {
        let count = min(left.count, right.count)
        guard count > 0 else { return nil }
        var leftSum = 0.0
        var rightSum = 0.0
        for index in 0..<count {
            leftSum += left[index]
            rightSum += right[index]
        }
        let leftMean = leftSum / Double(count)
        let rightMean = rightSum / Double(count)
        var covariance = 0.0
        var leftEnergy = 0.0
        var rightEnergy = 0.0
        for index in 0..<count {
            let l = left[index] - leftMean
            let r = right[index] - rightMean
            covariance += l * r
            leftEnergy += l * l
            rightEnergy += r * r
        }
        let denominator = sqrt(leftEnergy * rightEnergy)
        guard denominator > 1e-16 else { return nil }
        return min(1, max(-1, covariance / denominator))
    }

    private static func sideToMidDB(_ left: [Double], _ right: [Double]) -> Double? {
        let count = min(left.count, right.count)
        guard count > 0 else { return nil }
        var midEnergy = 0.0
        var sideEnergy = 0.0
        for index in 0..<count {
            let mid = 0.5 * (left[index] + right[index])
            let side = 0.5 * (left[index] - right[index])
            midEnergy += mid * mid
            sideEnergy += side * side
        }
        guard midEnergy > 1e-16 else { return sideEnergy > 1e-16 ? 160 : nil }
        return powerDB(sideEnergy / midEnergy)
    }

    private static func highBandRatio(channels: [[Double]], sampleRate: Double) -> Double {
        guard !channels.isEmpty else { return -160 }
        let highPass = Biquad.highPass(frequency: 4_000, q: 0.7071, sampleRate: sampleRate)
        var fullEnergy = 0.0
        var highEnergy = 0.0
        for channel in channels {
            let highs = highPass.process(channel)
            for index in channel.indices {
                fullEnergy += channel[index] * channel[index]
                highEnergy += highs[index] * highs[index]
            }
        }
        guard fullEnergy > 1e-16 else { return -160 }
        return powerDB(highEnergy / fullEnergy)
    }
}

@main
private enum MasteringProbe {
    static func main() {
        do {
            let options = try Options.parse(CommandLine.arguments)
            if options.showHelp {
                printHelp()
                return
            }
            let exitStatus = try run(options: options)
            Darwin.exit(exitStatus)
        } catch {
            writeError("mastering-probe: \(error.localizedDescription)\n")
            Darwin.exit(2)
        }
    }

    private static func run(options: Options) throws -> Int32 {
        let fileManager = FileManager.default
        let scratchURL: URL
        let shouldRemoveScratch: Bool
        if let artifacts = options.artifactsURL {
            scratchURL = artifacts
            shouldRemoveScratch = false
        } else {
            scratchURL = fileManager.temporaryDirectory
                .appendingPathComponent("champagne-probe-\(UUID().uuidString)", isDirectory: true)
            shouldRemoveScratch = true
        }
        try fileManager.createDirectory(at: scratchURL, withIntermediateDirectories: true)
        defer {
            if shouldRemoveScratch {
                try? fileManager.removeItem(at: scratchURL)
            }
        }

        let fixtures = try FixtureFactory.makeAll(in: scratchURL)
        var fixtureReports = [FixtureReport]()
        var temporaryMasters = [URL]()
        defer {
            for url in temporaryMasters {
                try? fileManager.removeItem(at: url)
            }
        }

        for fixture in fixtures {
            print("Processing \(fixture.kind.rawValue)…")
            let inputAudio = try AudioAnalyzer.read(fixture.url)
            let inputMetrics = AudioAnalyzer.metrics(for: inputAudio)
            let result = try MasteringEngine.process(
                url: fixture.url,
                progress: { _, _ in },
                isCancelled: { false }
            )

            var styleReports = [StyleReport]()
            for style in MasteringStyle.allCases {
                guard let temporaryURL = result.masteredURLs[style] else {
                    throw ProbeError.missingMaster(style.rawValue)
                }
                temporaryMasters.append(temporaryURL)
                let analysisURL: URL
                if options.artifactsURL != nil {
                    let mastersDirectory = scratchURL
                        .appendingPathComponent("masters", isDirectory: true)
                        .appendingPathComponent(fixture.kind.rawValue, isDirectory: true)
                    try fileManager.createDirectory(
                        at: mastersDirectory,
                        withIntermediateDirectories: true
                    )
                    let destination = mastersDirectory
                        .appendingPathComponent(style.fileSlug)
                        .appendingPathExtension("wav")
                    if fileManager.fileExists(atPath: destination.path) {
                        throw ProbeError.invalidArgument(
                            "Artifact already exists: \(destination.path). Use an empty --artifacts directory."
                        )
                    }
                    try fileManager.copyItem(at: temporaryURL, to: destination)
                    analysisURL = destination
                } else {
                    analysisURL = temporaryURL
                }

                let outputAudio = try AudioAnalyzer.read(analysisURL)
                let outputMetrics = AudioAnalyzer.metrics(for: outputAudio)
                let delta = metricDelta(input: inputMetrics, output: outputMetrics)
                let checks = checks(
                    fixture: fixture.kind,
                    style: style,
                    input: inputMetrics,
                    output: outputMetrics,
                    delta: delta
                )
                styleReports.append(StyleReport(
                    style: style.rawValue,
                    metrics: outputMetrics,
                    deltaFromInput: delta,
                    checks: checks
                ))
            }
            fixtureReports.append(FixtureReport(
                fixture: fixture.kind.rawValue,
                input: inputMetrics,
                styles: styleReports
            ))
        }

        let suiteChecks = suiteChecks(for: fixtureReports)
        let allChecks = fixtureReports.flatMap { $0.styles.flatMap(\.checks) } + suiteChecks
        let errors = allChecks.filter { !$0.passed && $0.severity == .error }.count
        let warnings = allChecks.filter { !$0.passed && $0.severity == .warning }.count
        let report = ProbeReport(
            formatVersion: 1,
            meterDescription: "BS.1770-style K-weighted/gated loudness; 4x cubic true-peak estimate (not a certified meter)",
            fixtures: fixtureReports,
            suiteChecks: suiteChecks,
            summary: ProbeSummary(
                fixtures: fixtureReports.count,
                masters: fixtureReports.reduce(0) { $0 + $1.styles.count },
                errors: errors,
                warnings: warnings,
                strictMode: options.strict
            )
        )

        printReadable(report)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let json = try encoder.encode(report)
        let jsonURL = options.jsonURL ?? options.artifactsURL?.appendingPathComponent("report.json")
        if let jsonURL {
            try fileManager.createDirectory(
                at: jsonURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try json.write(to: jsonURL, options: .atomic)
            print("JSON report: \(jsonURL.path)")
        }

        let shouldFail = errors > 0 || (options.strict && warnings > 0)
        return shouldFail ? 1 : 0
    }

    private static func metricDelta(input: AudioMetrics, output: AudioMetrics) -> MetricDelta {
        MetricDelta(
            loudnessLU: output.integratedLUFS - input.integratedLUFS,
            truePeakDB: output.truePeakEstimateDBTP - input.truePeakEstimateDBTP,
            crestFactorDB: output.crestFactorDB - input.crestFactorDB,
            highBandBalanceDB: output.highBandToFullDB - input.highBandToFullDB,
            stereoCorrelation: optionalDelta(input.stereoCorrelation, output.stereoCorrelation),
            bassSideToMidDB: optionalDelta(input.bassSideToMidDB, output.bassSideToMidDB)
        )
    }

    private static func optionalDelta(_ input: Double?, _ output: Double?) -> Double? {
        guard let input, let output else { return nil }
        return output - input
    }

    private static func checks(
        fixture: FixtureKind,
        style: MasteringStyle,
        input: AudioMetrics,
        output: AudioMetrics,
        delta: MetricDelta
    ) -> [ProbeCheck] {
        var checks = [ProbeCheck]()
        func add(_ condition: Bool, _ name: String, _ severity: CheckSeverity, _ detail: String) {
            checks.append(ProbeCheck(name: name, severity: severity, passed: condition, detail: detail))
        }

        add(
            output.nonFiniteSampleCount == 0,
            "finite_samples",
            .error,
            "non-finite samples: \(output.nonFiniteSampleCount)"
        )
        add(
            output.clippedSampleCount == 0,
            "no_sample_clipping",
            .error,
            "samples at or above 0 dBFS: \(output.clippedSampleCount)"
        )
        add(
            output.estimatedIntersampleClipCount == 0 && output.truePeakEstimateDBTP < 0,
            "no_estimated_intersample_clipping",
            .error,
            "4x cubic estimate: \(format(output.truePeakEstimateDBTP)) dBTP, overs: \(output.estimatedIntersampleClipCount)"
        )
        add(
            output.truePeakEstimateDBTP <= -0.5,
            "codec_safe_headroom",
            .warning,
            "recommended <= -0.5 dBTP; measured \(format(output.truePeakEstimateDBTP)) dBTP"
        )
        add(
            output.pinnedSampleCount == 0,
            "no_pinned_samples",
            .error,
            "near-full-scale samples: \(output.pinnedSampleCount)"
        )
        add(
            output.frameCount == input.frameCount,
            "preserve_frame_count",
            .error,
            "input \(input.frameCount), output \(output.frameCount) frames"
        )
        add(
            abs(output.sampleRate - input.sampleRate) < 0.5,
            "preserve_sample_rate",
            .error,
            "input \(format(input.sampleRate, digits: 0)), output \(format(output.sampleRate, digits: 0)) Hz"
        )
        add(
            output.channels == input.channels,
            "preserve_channels",
            .error,
            "input \(input.channels), output \(output.channels) channels"
        )
        add(
            output.dcOffsetPeak < 0.001,
            "dc_offset",
            .warning,
            "maximum absolute channel mean: \(format(output.dcOffsetPeak, digits: 6))"
        )
        add(
            output.integratedLUFS > -22 && output.integratedLUFS < -4,
            "master_loudness_sane",
            .error,
            "integrated loudness: \(format(output.integratedLUFS)) LUFS"
        )
        add(
            output.peakToLoudnessRatioDB >= 3.5,
            "minimum_peak_to_loudness_ratio",
            .warning,
            "PLR: \(format(output.peakToLoudnessRatioDB)) dB"
        )

        let target = expectedLoudness(for: style)
        add(
            abs(output.integratedLUFS - target) <= 2.0,
            "profile_loudness_target",
            .warning,
            "target \(format(target)), measured \(format(output.integratedLUFS)) LUFS"
        )

        switch fixture {
        case .isolatedPeak:
            add(
                delta.loudnessLU >= 1.5,
                "isolated_peak_has_real_loudness_lift",
                .error,
                "loudness lift: \(format(delta.loudnessLU)) LU"
            )
            add(
                delta.loudnessLU >= 3.0,
                "isolated_peak_competitive_lift",
                .warning,
                "preferred lift >= 3 LU; measured \(format(delta.loudnessLU)) LU"
            )
        case .transientTrain:
            add(
                output.crestFactorDB >= 4,
                "transients_remain",
                .warning,
                "output crest factor: \(format(output.crestFactorDB)) dB"
            )
            add(
                delta.crestFactorDB >= -8,
                "transient_reduction_bounded",
                .warning,
                "crest-factor change: \(format(delta.crestFactorDB)) dB"
            )
        case .brightBursts:
            add(
                delta.highBandBalanceDB >= -8 && delta.highBandBalanceDB <= 6,
                "bright_band_change_bounded",
                .warning,
                "4 kHz+ balance change: \(format(delta.highBandBalanceDB)) dB"
            )
        case .stereoSub:
            let bassDelta = delta.bassSideToMidDB ?? 0
            add(
                delta.bassSideToMidDB != nil && bassDelta <= -3,
                "sub_side_energy_reduced",
                .warning,
                "bass side/mid change: \(format(bassDelta)) dB"
            )
            if let correlation = output.bassCorrelation {
                add(
                    correlation > -0.25,
                    "bass_phase_not_strongly_negative",
                    .warning,
                    "bass correlation: \(format(correlation, digits: 3))"
                )
            }
        case .alreadyHot:
            add(
                abs(delta.loudnessLU) <= 4,
                "already_hot_not_overprocessed",
                .warning,
                "loudness change: \(format(delta.loudnessLU)) LU"
            )
        }
        return checks
    }

    private static func expectedLoudness(for style: MasteringStyle) -> Double {
        // Kept outside the private production Recipe on purpose: this is an
        // independent product expectation and is easy to update when profiles change.
        switch style.rawValue {
        case "Warm Presence": return -11.0
        case "Modern Crisp": return -10.5
        case "Dominant": return -8.8
        default: return -10.0
        }
    }

    private static func suiteChecks(for fixtures: [FixtureReport]) -> [ProbeCheck] {
        fixtures.map { fixture in
            let values = fixture.styles.map { $0.metrics.integratedLUFS }
            let spread = (values.max() ?? 0) - (values.min() ?? 0)
            return ProbeCheck(
                name: "\(fixture.fixture)_style_separation",
                severity: .warning,
                passed: spread >= 0.75,
                detail: "integrated-loudness spread across styles: \(format(spread)) LU"
            )
        }
    }

    private static func printReadable(_ report: ProbeReport) {
        print("\nChampagne mastering probe")
        print("LUFS-I / estimated dBTP / PLR / crest / correlation")
        for fixture in report.fixtures {
            let input = fixture.input
            print("\n\(fixture.fixture)  input: \(format(input.integratedLUFS)) LUFS, \(format(input.truePeakEstimateDBTP)) dBTP")
            for style in fixture.styles {
                let metrics = style.metrics
                let errorCount = style.checks.filter { !$0.passed && $0.severity == .error }.count
                let warningCount = style.checks.filter { !$0.passed && $0.severity == .warning }.count
                let status = errorCount > 0 ? "FAIL" : (warningCount > 0 ? "WARN" : "PASS")
                print(
                    "  \(style.style.padding(toLength: 15, withPad: " ", startingAt: 0)) "
                        + "\(format(metrics.integratedLUFS)) / "
                        + "\(format(metrics.truePeakEstimateDBTP)) / "
                        + "\(format(metrics.peakToLoudnessRatioDB)) / "
                        + "\(format(metrics.crestFactorDB)) / "
                        + "\(format(metrics.stereoCorrelation, digits: 3))  \(status)"
                )
            }
        }

        let failed = report.fixtures.flatMap { fixture in
            fixture.styles.flatMap { style in
                style.checks.filter { !$0.passed }.map { (fixture.fixture, style.style, $0) }
            }
        }
        if !failed.isEmpty {
            print("\nFailed checks")
            for (fixture, style, check) in failed {
                print("  [\(check.severity.rawValue.uppercased())] \(fixture) / \(style) / \(check.name): \(check.detail)")
            }
        }
        for check in report.suiteChecks where !check.passed {
            print("  [\(check.severity.rawValue.uppercased())] \(check.name): \(check.detail)")
        }
        print(
            "\nSummary: \(report.summary.masters) masters, "
                + "\(report.summary.errors) errors, \(report.summary.warnings) warnings"
        )
    }

    private static func format(_ value: Double, digits: Int = 2) -> String {
        String(format: "%.*f", locale: Locale(identifier: "en_US_POSIX"), digits, value)
    }

    private static func format(_ value: Double?, digits: Int = 2) -> String {
        guard let value else { return "n/a" }
        return format(value, digits: digits)
    }

    private static func printHelp() {
        print("""
        Usage: mastering-probe [--json PATH] [--artifacts DIRECTORY] [--strict]

          --json PATH          Write the deterministic metric report as JSON.
          --artifacts DIR      Keep generated inputs and mastered WAVs in an empty directory.
                               Also writes report.json unless --json is supplied.
          --strict             Treat advisory quality warnings as a failing exit status.
          -h, --help           Show this help.

        Exit status is 1 for hard audio-safety failures (or any warning in strict mode),
        2 for probe/runtime errors, and 0 otherwise.
        """)
    }

    private static func writeError(_ text: String) {
        if let data = text.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}
