// Compile from the project root with:
// DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swiftc -O \
//   -parse-as-library -module-name ChampagneFadeProbe \
//   Champagne/AudioEdit.swift Tools/FadeCurveProbe.swift \
//   -framework AVFoundation -framework Accelerate -o /tmp/champagne-fade-probe

import Foundation
import AVFoundation

@main
struct FadeCurveProbe {
    private static var failures: [String] = []

    static func main() throws {
        verifyCurveMath()
        try verifyRenderedAudio()

        if failures.isEmpty {
            print("Fade curve probe passed")
            return
        }

        for failure in failures {
            fputs("FAIL: \(failure)\n", stderr)
        }
        exit(1)
    }

    private static func verifyCurveMath() {
        let bounds = EditRegion.fadeCurvatureBounds
        let curves = [
            bounds.lowerBound,
            -0.5,
            0,
            EditRegion.defaultFadeCurvature,
            0.5,
            bounds.upperBound
        ]
        let resolution = 262_144

        for curve in curves {
            var previous: Float = -1
            for index in 0...resolution {
                let x = Float(index) / Float(resolution)
                let gain = EditRegion.parabolicFadeGain(x, curvature: curve)
                check(gain.isFinite && gain >= 0 && gain <= 1, "gain left 0...1 at curve \(curve)")
                check(gain + 1e-7 >= previous, "curve \(curve) is not monotonic")
                previous = gain

                if curve == EditRegion.defaultFadeCurvature {
                    let legacy = x * (4 - x) / 3
                    check(gain.bitPattern == legacy.bitPattern, "default curve changed the legacy fade law")
                }
            }
            check(EditRegion.parabolicFadeGain(0, curvature: curve) == 0, "curve \(curve) misses zero")
            check(EditRegion.parabolicFadeGain(1, curvature: curve) == 1, "curve \(curve) misses unity")
        }

        let x: Float = 0.5
        let broad = EditRegion.parabolicFadeGain(x, curvature: bounds.lowerBound)
        let normal = EditRegion.parabolicFadeGain(x, curvature: EditRegion.defaultFadeCurvature)
        let sharp = EditRegion.parabolicFadeGain(x, curvature: bounds.upperBound)
        check(broad < normal && normal < sharp, "midpoint curvature ordering is incorrect")
        check(bounds.lowerBound == -1 && bounds.upperBound == 1, "curvature does not reach full extremes")
        check(abs(broad - 0.25) < 1e-7, "broad extreme is not the full x² curve")
        check(abs(normal - Float(7.0 / 12.0)) < 1e-7, "default midpoint gain changed")
        check(abs(sharp - 0.75) < 1e-7, "sharp extreme is not the full 2x-x² curve")

        check(
            EditRegion.fadeControlPosition(forCurvature: EditRegion.defaultFadeCurvature) == 0,
            "default curvature is not centered in the handle range"
        )
        check(
            EditRegion.fadeControlPosition(forCurvature: bounds.lowerBound) == -1,
            "lower curvature does not reach the full handle range"
        )
        check(
            EditRegion.fadeControlPosition(forCurvature: bounds.upperBound) == 1,
            "upper curvature does not reach the full handle range"
        )
        check(
            EditRegion.fadeCurvature(forControlPosition: -1) == bounds.lowerBound,
            "full downward travel does not reach the lower pressure point"
        )
        check(
            EditRegion.fadeCurvature(forControlPosition: 1) == bounds.upperBound,
            "full upward travel does not reach the upper pressure point"
        )
        for step in -100...100 {
            let position = Double(step) / 100
            let curvature = EditRegion.fadeCurvature(forControlPosition: position)
            let roundTrip = EditRegion.fadeControlPosition(forCurvature: curvature)
            check(abs(roundTrip - position) < 1e-12, "handle/curvature mapping is not reversible")
        }
        let epsilon = 0.0001
        let upwardSlope = (
            EditRegion.fadeCurvature(forControlPosition: epsilon)
                - EditRegion.defaultFadeCurvature
        ) / epsilon
        let downwardSlope = (
            EditRegion.defaultFadeCurvature
                - EditRegion.fadeCurvature(forControlPosition: -epsilon)
        ) / epsilon
        check(abs(upwardSlope - downwardSlope) < 0.0001, "fine curvature control is asymmetric at center")
        check(
            EditRegion.fadeCurvature(forControlPosition: .nan) == EditRegion.defaultFadeCurvature,
            "NaN handle position did not reset"
        )
        check(
            EditRegion.fadeCurvature(forControlPosition: .infinity) == EditRegion.defaultFadeCurvature,
            "infinite handle position did not reset"
        )

        var invalid = EditRegion()
        invalid.fadeInCurvature = .nan
        invalid.fadeOutCurvature = .infinity
        invalid.normalize(duration: 10)
        check(invalid.fadeInCurvature == EditRegion.defaultFadeCurvature, "NaN curvature did not reset")
        check(invalid.fadeOutCurvature == EditRegion.defaultFadeCurvature, "infinite curvature did not reset")
    }

    private static func verifyRenderedAudio() throws {
        let sampleRate = 48_000.0
        let frameCount = 48_000
        let fadeFrames = 12_000
        let sourceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("champagne_fade_curve_probe_source.wav")
        try? FileManager.default.removeItem(at: sourceURL)
        defer { try? FileManager.default.removeItem(at: sourceURL) }

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ), let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount)
        ), let samples = buffer.floatChannelData?[0] else {
            throw CocoaError(.fileReadUnknown)
        }
        buffer.frameLength = AVAudioFrameCount(frameCount)
        for index in 0..<frameCount { samples[index] = 0.5 }

        var source: AVAudioFile? = try AVAudioFile(
            forWriting: sourceURL,
            settings: format.settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        try source?.write(from: buffer)
        source = nil

        var region = EditRegion()
        region.fadeIn = 0.25
        region.fadeOut = 0.25
        region.fadeInCurvature = EditRegion.fadeCurvatureBounds.upperBound
        region.fadeOutCurvature = EditRegion.fadeCurvatureBounds.lowerBound
        let renderedURL = try AudioEditRenderer.render(
            sourceURL: sourceURL,
            region: region,
            fullDuration: 1
        )
        defer { try? FileManager.default.removeItem(at: renderedURL) }

        let rendered = try AVAudioFile(forReading: renderedURL)
        let renderedFrameCount = Int(rendered.length)
        guard let renderedBuffer = AVAudioPCMBuffer(
            pcmFormat: rendered.processingFormat,
            frameCapacity: AVAudioFrameCount(rendered.length)
        ) else { throw CocoaError(.fileReadUnknown) }
        try rendered.read(into: renderedBuffer)
        guard let output = renderedBuffer.floatChannelData?[0] else {
            throw CocoaError(.fileReadUnknown)
        }

        let midpoint = fadeFrames / 2
        let distance = Float(midpoint) / Float(fadeFrames - 1)
        let expectedIn = 0.5 * EditRegion.parabolicFadeGain(
            distance,
            curvature: region.fadeInCurvature
        )
        let expectedOut = 0.5 * EditRegion.parabolicFadeGain(
            distance,
            curvature: region.fadeOutCurvature
        )
        check(
            abs(output[midpoint] - expectedIn) < 2e-6,
            "rendered fade-in mismatch (actual \(output[midpoint]), expected \(expectedIn))"
        )
        check(
            abs(output[renderedFrameCount - 1 - midpoint] - expectedOut) < 2e-6,
            "rendered fade-out mismatch (actual \(output[renderedFrameCount - 1 - midpoint]), expected \(expectedOut))"
        )
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard !condition() else { return }
        if !failures.contains(message) { failures.append(message) }
    }
}
