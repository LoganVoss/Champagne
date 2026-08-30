import Foundation
import AVFoundation
import Combine

/// Handles playback with seamless A/B, style switching, trim bounds, and live fades.
@MainActor
final class PlaybackController: ObservableObject {
    @Published var isPlaying = false
    @Published var isMastered = true
    /// Absolute playhead in the full source file (seconds).
    @Published var currentTime: TimeInterval = 0
    /// Full untrimmed duration of the loaded track.
    @Published var fullDuration: TimeInterval = 0
    @Published var editRegion = EditRegion()

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    private var originalURL: URL?
    private var masteredURLs: [MasteringStyle: URL] = [:]
    private var activeStyle: MasteringStyle = .fullPower
    private var isSwitching = false

    var startTime: TimeInterval { editRegion.startTime(duration: fullDuration) }
    var endTime: TimeInterval { editRegion.endTime(duration: fullDuration) }
    var effectiveDuration: TimeInterval { max(0.01, endTime - startTime) }

    /// Playhead 0…1 across the full file (for waveform progress).
    var fullProgress: Double {
        guard fullDuration > 0 else { return 0 }
        return min(1, max(0, currentTime / fullDuration))
    }

    // MARK: - Setup

    func configure(
        originalURL: URL?,
        masteredURLs: [MasteringStyle: URL],
        style: MasteringStyle,
        duration: TimeInterval
    ) {
        stop()
        self.originalURL = originalURL
        self.masteredURLs = masteredURLs
        self.activeStyle = style
        self.fullDuration = duration
        self.currentTime = 0
        self.isMastered = true
        self.editRegion = EditRegion()

        guard let url = urlForCurrentSource() else { return }
        installPlayer(url: url, seekTo: startTime, autoplay: false)
    }

    func reset() {
        stop()
        originalURL = nil
        masteredURLs = [:]
        currentTime = 0
        fullDuration = 0
        isPlaying = false
        isMastered = true
        editRegion = EditRegion()
    }

    func updateEditRegion(_ region: EditRegion) {
        var r = region
        r.normalize(duration: fullDuration)
        editRegion = r

        // Keep playhead inside selection
        if currentTime < startTime {
            seek(to: startTime)
        } else if currentTime > endTime {
            seek(to: max(startTime, endTime - 0.05))
        }
        applyLiveFadeVolume()
    }

    // MARK: - Transport

    func togglePlayPause() {
        guard player != nil || urlForCurrentSource() != nil else { return }

        if player == nil, let url = urlForCurrentSource() {
            let t = currentTime < startTime || currentTime >= endTime - 0.02 ? startTime : currentTime
            installPlayer(url: url, seekTo: t, autoplay: true)
            return
        }

        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            if currentTime >= endTime - 0.05 || currentTime < startTime {
                seek(to: startTime)
                player.play()
                isPlaying = true
            } else {
                player.play()
                isPlaying = true
            }
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func stop() {
        removeObservers()
        player?.pause()
        player = nil
        isPlaying = false
        currentTime = 0
    }

    /// Seek to absolute time in the full file (clamped to trim region).
    func seek(to time: TimeInterval) {
        let clamped = min(endTime, max(startTime, time))
        currentTime = clamped
        let cm = CMTime(seconds: clamped, preferredTimescale: 600)
        player?.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero)
        applyLiveFadeVolume()
    }

    /// Seek from a 0…1 position on the full waveform.
    func seekFullProgress(_ p: Double) {
        guard fullDuration > 0 else { return }
        seek(to: min(1, max(0, p)) * fullDuration)
    }

    func setStyle(_ style: MasteringStyle) {
        guard style != activeStyle else { return }
        activeStyle = style
        guard isMastered else { return }
        swapSourcePreservingPosition(forceRebuild: false)
    }

    func setMastered(_ mastered: Bool) {
        guard mastered != isMastered else { return }
        isMastered = mastered
        // Full rebuild on A/B so we never keep a mastered buffer under the Original label.
        swapSourcePreservingPosition(forceRebuild: true)
    }

    // MARK: - Internals

    private func urlForCurrentSource() -> URL? {
        if isMastered {
            return masteredURLs[activeStyle]
        }
        // Dry source only — byte-identical import copy, zero processing.
        return originalURL
    }

    private func swapSourcePreservingPosition(forceRebuild: Bool) {
        guard let url = urlForCurrentSource() else { return }
        let wasPlaying = isPlaying
        let time = min(endTime, max(startTime, currentTime))
        isSwitching = true

        // Always rebuild when A/B-ing Original ↔ Mastered so the player can't
        // stick on the previous asset. Style flips can reuse the player.
        if forceRebuild || player == nil {
            installPlayer(url: url, seekTo: time, autoplay: wasPlaying)
        } else if let player {
            attachItem(AVPlayerItem(url: url), on: player, seekTo: time, autoplay: wasPlaying)
        }
    }

    private func installPlayer(url: URL, seekTo time: TimeInterval, autoplay: Bool) {
        removeObservers()
        player?.pause()
        player = nil

        let newPlayer = AVPlayer()
        newPlayer.automaticallyWaitsToMinimizeStalling = false
        // Unity gain always — loudness difference is content, never a player boost.
        newPlayer.volume = 1.0
        player = newPlayer

        // Track the parabolic envelope at display cadence so short live fades
        // stay fluid instead of stepping between coarse volume updates.
        let interval = CMTime(seconds: 1.0 / 60.0, preferredTimescale: 600)
        // AVPlayer delivers this on the main queue, but the closure is still
        // typed as Sendable/nonisolated — hop explicitly onto the main actor.
        timeObserver = newPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] t in
            Task { @MainActor [weak self] in
                guard let self, !self.isSwitching else { return }
                let seconds = t.seconds
                if seconds.isFinite {
                    self.currentTime = seconds
                }
                self.isPlaying = newPlayer.rate > 0
                self.applyLiveFadeVolume()

                // Stop at trim end
                if seconds >= self.endTime - 0.02 {
                    newPlayer.pause()
                    self.isPlaying = false
                    self.currentTime = self.endTime
                    newPlayer.seek(
                        to: CMTime(seconds: self.endTime, preferredTimescale: 600),
                        toleranceBefore: .zero,
                        toleranceAfter: .zero
                    )
                }
            }
        }

        attachItem(AVPlayerItem(url: url), on: newPlayer, seekTo: time, autoplay: autoplay)
    }

    private func attachItem(
        _ item: AVPlayerItem,
        on player: AVPlayer,
        seekTo time: TimeInterval,
        autoplay: Bool
    ) {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isPlaying = false
                self.currentTime = self.endTime
            }
        }

        player.replaceCurrentItem(with: item)

        let target = CMTime(seconds: max(0, time), preferredTimescale: 600)
        player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isSwitching = false
                self.currentTime = time
                self.applyLiveFadeVolume()
                if autoplay && finished {
                    player.play()
                    self.isPlaying = true
                } else if !autoplay {
                    self.isPlaying = false
                }
            }
        }
    }

    /// Merge newly finished style masters without tearing down transport.
    func updateMasteredURLs(_ urls: [MasteringStyle: URL]) {
        masteredURLs = urls
        // If the active mastered source just became available, attach it.
        guard isMastered, player == nil, let url = urls[activeStyle] else { return }
        let t = currentTime > 0 ? currentTime : startTime
        installPlayer(url: url, seekTo: t, autoplay: false)
    }

    /// Live volume for fade in/out while previewing (export bakes these in).
    private func applyLiveFadeVolume() {
        guard let player, fullDuration > 0 else { return }
        let t = currentTime
        let start = startTime
        let end = endTime
        let fadeIn = editRegion.fadeIn
        let fadeOut = editRegion.fadeOut

        var vol: Float = 1
        if fadeIn > 0.001, t < start + fadeIn {
            let distanceFromSilence = Float(max(0, min(1, (t - start) / fadeIn)))
            vol = EditRegion.parabolicFadeGain(
                distanceFromSilence,
                curvature: editRegion.fadeInCurvature
            )
        } else if fadeOut > 0.001, t > end - fadeOut {
            let distanceFromSilence = Float(max(0, min(1, (end - t) / fadeOut)))
            vol = EditRegion.parabolicFadeGain(
                distanceFromSilence,
                curvature: editRegion.fadeOutCurvature
            )
        }
        player.volume = max(0, min(1, vol))
    }

    private func removeObservers() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
    }
}
