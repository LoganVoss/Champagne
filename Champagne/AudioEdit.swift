import Foundation
import AVFoundation
import Accelerate

/// Trim + fade region over the full track (normalized 0…1 positions, fades in seconds).
struct EditRegion: Equatable, Sendable {
    /// Inclusive start of keep-region as fraction of full duration.
    var trimStart: Double = 0
    /// Exclusive-ish end of keep-region as fraction of full duration.
    var trimEnd: Double = 1
    /// Fade-in length in seconds from trimStart.
    var fadeIn: Double = 0
    /// Fade-out length in seconds into trimEnd.
    var fadeOut: Double = 0
    /// Signed quadratic bend: positive is sharper, negative is broader.
    var fadeInCurvature: Double = Self.defaultFadeCurvature
    var fadeOutCurvature: Double = Self.defaultFadeCurvature

    nonisolated static let minSelection: Double = 0.02 // 2% of track minimum
    nonisolated static let defaultFadeCurvature: Double = 1.0 / 3.0
    nonisolated static let fadeCurvatureBounds: ClosedRange<Double> = -1.0...1.0

    nonisolated mutating func normalize(duration: Double) {
        trimStart = min(max(0, trimStart), 1 - Self.minSelection)
        trimEnd = min(max(trimStart + Self.minSelection, trimEnd), 1)
        let selSeconds = max(0.01, (trimEnd - trimStart) * duration)
        // Fades can each take up to ~45% of the selection so they never cross
        let maxFade = selSeconds * 0.45
        fadeIn = min(max(0, fadeIn), maxFade)
        fadeOut = min(max(0, fadeOut), maxFade)
        fadeInCurvature = Self.normalizedCurvature(fadeInCurvature)
        fadeOutCurvature = Self.normalizedCurvature(fadeOutCurvature)
    }

    nonisolated func startTime(duration: Double) -> Double { trimStart * duration }
    nonisolated func endTime(duration: Double) -> Double { trimEnd * duration }
    nonisolated func selectionDuration(duration: Double) -> Double {
        max(0, endTime(duration: duration) - startTime(duration: duration))
    }

    /// Quadratic envelope measured outward from silence. The default retains
    /// the original `x(4-x)/3` fade exactly; curvature bends that same family
    /// upward (sharper) or downward (broader).
    @inline(__always)
    nonisolated static func parabolicFadeGain(
        _ normalizedDistance: Float,
        curvature: Double
    ) -> Float {
        let x = min(1, max(0, normalizedDistance))
        let bend = normalizedCurvature(curvature)
        let original = x * (4 - x) / 3
        // Keep untouched fades bit-identical to the approved legacy law. For
        // adjusted curves, the direct form is more numerically monotonic at
        // the full ±1 pressure-point extremes.
        if bend == defaultFadeCurvature { return original }
        return min(1, max(0, x + Float(bend) * x * (1 - x)))
    }

    @inline(__always)
    nonisolated static func normalizedCurvature(_ curvature: Double) -> Double {
        guard curvature.isFinite else { return defaultFadeCurvature }
        return min(fadeCurvatureBounds.upperBound, max(fadeCurvatureBounds.lowerBound, curvature))
    }

    /// Maps the asymmetric audio curvature around its approved default onto a
    /// smooth, symmetric -1...1 handle position. The curve has equal sensitivity
    /// in both directions at center, then eases into the unequal audio spans so
    /// equal vertical travel still reaches either pressure-point extreme.
    nonisolated static func fadeControlPosition(forCurvature curvature: Double) -> Double {
        let bend = normalizedCurvature(curvature)
        let offset = bend - defaultFadeCurvature
        let discriminant = max(0, 9 - 12 * offset)
        return min(1, max(-1, (3 - sqrt(discriminant)) / 2))
    }

    nonisolated static func fadeCurvature(forControlPosition position: Double) -> Double {
        let safePosition = position.isFinite ? min(1, max(-1, position)) : 0
        return normalizedCurvature(
            defaultFadeCurvature + safePosition - safePosition * safePosition / 3
        )
    }
}

enum AudioEditRenderer {
    enum EditError: LocalizedError {
        case cannotOpen
        case empty
        case writeFailed

        var errorDescription: String? {
            switch self {
            case .cannotOpen: return "Could not open audio for export."
            case .empty: return "Selection is empty."
            case .writeFailed: return "Could not write edited audio."
            }
        }
    }

    /// Bake trim + fades into a new temp WAV. Source is left untouched.
    nonisolated static func render(
        sourceURL: URL,
        region: EditRegion,
        fullDuration: Double
    ) throws -> URL {
        var region = region
        region.normalize(duration: fullDuration)

        let file = try AVAudioFile(forReading: sourceURL)
        let format = file.processingFormat
        let sampleRate = format.sampleRate
        let totalFrames = AVAudioFrameCount(file.length)
        guard totalFrames > 0 else { throw EditError.cannotOpen }

        let startFrame = AVAudioFramePosition(
            max(0, min(Double(totalFrames - 1), region.trimStart * Double(totalFrames)))
        )
        let endFrame = AVAudioFramePosition(
            max(Double(startFrame) + 1, min(Double(totalFrames), region.trimEnd * Double(totalFrames)))
        )
        let outFrames = AVAudioFrameCount(endFrame - startFrame)
        guard outFrames > 0 else { throw EditError.empty }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outFrames) else {
            throw EditError.cannotOpen
        }
        file.framePosition = startFrame
        try file.read(into: buffer, frameCount: outFrames)

        applyFades(
            buffer: buffer,
            sampleRate: sampleRate,
            fadeInSeconds: region.fadeIn,
            fadeOutSeconds: region.fadeOut,
            fadeInCurvature: region.fadeInCurvature,
            fadeOutCurvature: region.fadeOutCurvature
        )
        applyTPDFDither(buffer: buffer, seed: UInt64(startFrame) ^ UInt64(outFrames))

        let dest = FileManager.default.temporaryDirectory
            .appendingPathComponent("champagne_export_\(UUID().uuidString).wav")

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVLinearPCMBitDepthKey: 24,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false
        ]
        let out = try AVAudioFile(
            forWriting: dest,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        try out.write(from: buffer)
        return dest
    }

    /// Apply triangular-PDF dither exactly once, immediately before the final
    /// 24-bit integer write. Preview masters stay 32-bit float.
    private nonisolated static func applyTPDFDither(
        buffer: AVAudioPCMBuffer,
        seed: UInt64
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return }
        var state = seed == 0 ? 0xD1B54A32D192ED03 : seed
        let oneLSB = Float(1.0 / 8_388_608.0)

        @inline(__always) func uniform() -> Float {
            state ^= state >> 12
            state ^= state << 25
            state ^= state >> 27
            let value = state &* 0x2545F4914F6CDD1D
            return Float(value >> 40) / Float(1 << 24)
        }

        for ch in 0..<channels {
            for i in 0..<frames {
                data[ch][i] += (uniform() - uniform()) * oneLSB
            }
        }
    }

    private nonisolated static func applyFades(
        buffer: AVAudioPCMBuffer,
        sampleRate: Double,
        fadeInSeconds: Double,
        fadeOutSeconds: Double,
        fadeInCurvature: Double,
        fadeOutCurvature: Double
    ) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, let data = buffer.floatChannelData else { return }

        let fadeInN = min(frames / 2, max(0, Int(fadeInSeconds * sampleRate)))
        let fadeOutN = min(frames / 2, max(0, Int(fadeOutSeconds * sampleRate)))

        if fadeInN > 1 {
            let denominator = Float(fadeInN - 1)
            for i in 0..<fadeInN {
                let distanceFromSilence = Float(i) / denominator
                let g = EditRegion.parabolicFadeGain(
                    distanceFromSilence,
                    curvature: fadeInCurvature
                )
                for ch in 0..<channels {
                    data[ch][i] *= g
                }
            }
        }

        if fadeOutN > 1 {
            let denominator = Float(fadeOutN - 1)
            for i in 0..<fadeOutN {
                // Walk backward from the final silent sample so the same
                // parabolic law is the exact mirror of the fade-in.
                let idx = frames - 1 - i
                let distanceFromSilence = Float(i) / denominator
                let g = EditRegion.parabolicFadeGain(
                    distanceFromSilence,
                    curvature: fadeOutCurvature
                )
                for ch in 0..<channels {
                    data[ch][idx] *= g
                }
            }
        }
    }
}
