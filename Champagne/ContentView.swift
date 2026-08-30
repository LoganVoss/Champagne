import SwiftUI
import UniformTypeIdentifiers

private enum WorkspacePhase: Equatable {
    case initial
    case loading
    case loaded
}

struct ContentView: View {
    @StateObject private var processor = AudioMasteringProcessor()
    @StateObject private var playback = PlaybackController()

    @State private var selectedFileURL: URL?
    @State private var selectedStyle: MasteringStyle = .fullPower
    @State private var showImporter = false
    @State private var showExporter = false
    @State private var isDropTargeted = false
    @State private var hoverStyle: MasteringStyle?
    @State private var editRegion = EditRegion()
    @State private var exportDocumentURL: URL?
    @State private var isPreparingExport = false
    @State private var exportDirectoryURL: URL? = FileManager.default
        .urls(for: .desktopDirectory, in: .userDomainMask)
        .first
    @State private var workspacePhase: WorkspacePhase = .initial
    @State private var isPreparingLoad = false
    @State private var deferredLoadTask: Task<Void, Never>?

    private var waveformReady: Bool {
        processor.hasProcessed && !processor.originalWaveformSamples.isEmpty
    }

    private var revealAnimation: Animation {
        .timingCurve(0.22, 0.78, 0.22, 1, duration: 0.36)
    }

    var body: some View {
        ZStack {
            Champ.backgroundGradient
                .ignoresSafeArea()

            // Soft ambient glows
            GeometryReader { geo in
                Circle()
                    .fill(Champ.violet.opacity(0.12))
                    .frame(width: 420, height: 420)
                    .blur(radius: 80)
                    .offset(x: -120, y: -80)
                Circle()
                    .fill(Champ.gold.opacity(0.08))
                    .frame(width: 360, height: 360)
                    .blur(radius: 90)
                    .offset(x: geo.size.width - 180, y: geo.size.height - 220)
            }
            .allowsHitTesting(false)

            ZStack {
                initialStage
                    .opacity(workspacePhase == .initial ? 1 : 0)
                    .blur(radius: workspacePhase == .initial ? 0 : 3)
                    .offset(y: workspacePhase == .initial ? 0 : -4)
                    .allowsHitTesting(workspacePhase == .initial)
                    .accessibilityHidden(workspacePhase != .initial)

                loadingStage
                    .opacity(workspacePhase == .loading ? 1 : 0)
                    .blur(radius: workspacePhase == .loading ? 0 : 3)
                    .offset(y: workspacePhase == .loading ? 0 : 4)
                    .allowsHitTesting(workspacePhase == .loading)
                    .accessibilityHidden(workspacePhase != .loading)

                loadedStage
                    .opacity(workspacePhase == .loaded ? 1 : 0)
                    .blur(radius: workspacePhase == .loaded ? 0 : 3)
                    .offset(y: workspacePhase == .loaded ? 0 : 5)
                    .allowsHitTesting(workspacePhase == .loaded)
                    .accessibilityHidden(workspacePhase != .loaded)
            }
            .animation(revealAnimation, value: workspacePhase)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(minWidth: 900, minHeight: 720)
        .preferredColorScheme(.dark)
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: audioTypes,
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                loadFile(url)
            case .failure(let error):
                processor.errorMessage = error.localizedDescription
            }
        }
        .background {
            Color.clear
                .frame(width: 0, height: 0)
                .fileExporter(
                    isPresented: $showExporter,
                    document: exportDocumentURL.map { ExportableAudio(url: $0) },
                    contentType: .wav,
                    defaultFilename: exportFilename
                ) { result in
                    switch result {
                    case .success(let savedURL):
                        exportDirectoryURL = savedURL.deletingLastPathComponent()
                    case .failure(let error):
                        processor.errorMessage = error.localizedDescription
                    }
                }
                .fileDialogDefaultDirectory(exportDirectoryURL)
        }
        .onChange(of: processor.mastersRevision) { _, _ in
            syncPlaybackFromProcessor()
        }
        .onChange(of: processor.hasProcessed) { _, ready in
            if ready {
                syncPlaybackFromProcessor(resetEdit: true)
            }
        }
        .onChange(of: waveformReady) { _, ready in
            guard ready else { return }
            Task { @MainActor in
                // Mount the completed hierarchy invisibly for one render pass,
                // then reveal the brand and every workspace element together.
                await Task.yield()
                guard waveformReady else { return }
                withAnimation(revealAnimation) {
                    workspacePhase = .loaded
                }
            }
        }
        .onChange(of: processor.errorMessage) { _, message in
            guard message != nil,
                  workspacePhase == .loading,
                  !processor.isProcessing,
                  !processor.hasProcessed else { return }
            isPreparingLoad = false
            withAnimation(revealAnimation) {
                workspacePhase = .initial
            }
        }
        .onChange(of: editRegion) { _, region in
            playback.updateEditRegion(region)
        }
    }

    private var initialStage: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 28)
                .padding(.top, 18)
                .padding(.bottom, 12)

            ZStack(alignment: .bottom) {
                initialDropZone
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)

                if let err = processor.errorMessage {
                    errorBanner(err)
                        .padding(.bottom, 28)
                }
            }
            .padding(.horizontal, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .onDrop(of: [.fileURL, .audio], isTargeted: $isDropTargeted) { providers in
            handleDrop(providers: providers)
        }
    }

    private var loadingStage: some View {
        VStack(spacing: 0) {
            // Reserve the same top rhythm while the brand softly steps away.
            header
                .hidden()
                .accessibilityHidden(true)
                .padding(.horizontal, 28)
                .padding(.top, 18)
                .padding(.bottom, 12)

            ZStack(alignment: .bottom) {
                loadingDropZone
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)

                if let err = processor.errorMessage {
                    errorBanner(err)
                        .padding(.bottom, 28)
                }
            }
            .padding(.horizontal, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var loadedStage: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 28)
                .padding(.top, 18)
                .padding(.bottom, 12)

            ScrollView(.vertical, showsIndicators: false) {
                loadedWorkspace
                    .padding(.horizontal, 28)
                    .padding(.bottom, 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var loadedWorkspace: some View {
        VStack(spacing: 20) {
            loadedTrackCard
            waveformSection
            styleGrid
            transportBar
            downloadButton
            if let err = processor.errorMessage { errorBanner(err) }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Champ.goldGradient)
                    .frame(width: 44, height: 44)
                    .shadow(color: Champ.gold.opacity(0.45), radius: 12, y: 4)
                Image(systemName: "waveform")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.black.opacity(0.85))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("CHAMPAGNE")
                    .font(.system(size: 23.5, weight: .bold, design: .rounded))
                    .tracking(3.2)
                    .foregroundStyle(Champ.goldGradient)
                Text("Mastering Studio")
                    .font(.system(size: 11.5, weight: .medium))
                    .tracking(1.5)
                    .foregroundStyle(Champ.textSecondary)
                    .textCase(.uppercase)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    // MARK: - Drop zone

    private func trackCard<Content: View>(
        height: CGFloat,
        active: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(active ? Champ.gold.opacity(0.08) : Champ.bgCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(
                            active ? Champ.gold : Champ.border,
                            lineWidth: active ? 2 : 1
                        )
                )

            content()
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
    }

    private var initialDropZone: some View {
        trackCard(height: 160, active: isDropTargeted) {
            emptyDropContent(active: isDropTargeted)
        }
        .onTapGesture { showImporter = true }
    }

    private var loadingDropZone: some View {
        trackCard(height: 160, active: isDropTargeted) {
            processingView
        }
        .allowsHitTesting(false)
    }

    private var loadedTrackCard: some View {
        trackCard(height: 68, active: false) {
            loadedTrackContent
        }
    }

    private var loadedTrackContent: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Champ.gold)

            VStack(alignment: .leading, spacing: 2) {
                Text("Track loaded")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Champ.textPrimary)
                if let name = selectedFileURL?.lastPathComponent {
                    Text(name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Champ.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer(minLength: 12)

            Button {
                returnToInitialView()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                    Text("New Track")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Champ.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(Champ.bgElevated)
                        .overlay(Capsule().stroke(Champ.borderStrong, lineWidth: 1))
                )
            }
            .buttonStyle(ChampButtonStyle())
        }
        .padding(.horizontal, 20)
    }

    private func emptyDropContent(active: Bool) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Champ.gold.opacity(active ? 0.2 : 0.1))
                    .frame(width: 64, height: 64)
                Image(systemName: "arrow.down.to.line.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(active ? Champ.goldBright : Champ.gold)
                    .symbolEffect(.pulse, options: .repeating, isActive: active)
            }
            VStack(spacing: 4) {
                Text(active ? "Drop to master" : "Drop Audio File")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Champ.textPrimary)
                Text("WAV · AIFF · MP3 · M4A · FLAC")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Champ.textTertiary)
                    .tracking(0.5)
            }
        }
        .padding(.vertical, 20)
    }

    private var processingView: some View {
        let visibleProgress = isPreparingLoad ? 0.03 : processor.progress
        let visibleStatus = isPreparingLoad
            ? "Preparing track…"
            : (processor.statusMessage.isEmpty ? "Mastering…" : processor.statusMessage)

        return VStack(spacing: 16) {
            ZStack {
                Circle()
                    .stroke(Champ.borderStrong, lineWidth: 4)
                    .frame(width: 56, height: 56)
                Circle()
                    .trim(from: 0, to: max(0.03, visibleProgress))
                    .stroke(
                        Champ.goldGradient,
                        style: StrokeStyle(lineWidth: 4, lineCap: .round)
                    )
                    .frame(width: 56, height: 56)
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.25), value: visibleProgress)

                Text("\(Int(visibleProgress * 100))%")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Champ.goldBright)
            }

            Text(visibleStatus)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Champ.textPrimary)
                .contentTransition(.opacity)
                .animation(.easeOut(duration: 0.16), value: visibleStatus)
        }
        .padding(.vertical, 24)
    }

    // MARK: - Waveform

    private var waveformSection: some View {
        GlassCard(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(playback.isMastered ? "MASTERED" : "ORIGINAL")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1.8)
                        .foregroundStyle(playback.isMastered ? Champ.gold : Champ.neutralAccent)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 8)

                EditableWaveformView(
                    samples: playback.isMastered
                        ? processor.processedWaveformSamples(for: selectedStyle)
                        : processor.originalWaveformSamples,
                    progress: playback.fullProgress,
                    accent: playback.isMastered ? Champ.gold : Champ.neutralAccent,
                    fullDuration: playback.fullDuration,
                    region: $editRegion,
                    onSeek: { p in playback.seekFullProgress(p) }
                )
                .frame(height: 140)
                .padding(.horizontal, 10)
                .padding(.bottom, 14)
            }
        }
    }

    // MARK: - Styles

    private var styleGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("MASTERING STYLE")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(Champ.textSecondary)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ],
                spacing: 12
            ) {
                ForEach(MasteringStyle.allCases) { style in
                    let ready = processor.isStyleReady(style)
                    StyleCard(
                        style: style,
                        isSelected: selectedStyle == style,
                        isEnabled: ready,
                        isHovered: hoverStyle == style
                    ) {
                        guard ready else { return }
                        selectedStyle = style
                        playback.setStyle(style)
                    }
                    .onHover { h in
                        hoverStyle = h ? style : (hoverStyle == style ? nil : hoverStyle)
                    }
                    .opacity(ready ? 1 : 0.4)
                    .animation(.easeOut(duration: 0.18), value: ready)
                }
            }
            .opacity(processor.hasProcessed ? 1 : 0.45)
            .allowsHitTesting(processor.hasProcessed)
        }
    }

    // MARK: - Transport

    private var transportBar: some View {
        GlassCard {
            HStack(spacing: 20) {
                // A/B source toggle
                HStack(spacing: 0) {
                    sourceChip(title: "Original", icon: "waveform", mastered: false)
                    sourceChip(title: "Mastered", icon: "sparkles", mastered: true)
                }
                .padding(3)
                .background(
                    Capsule(style: .continuous)
                        .fill(Champ.bgInset)
                )

                Spacer()

                // Play / pause
                Button {
                    playback.togglePlayPause()
                } label: {
                    ZStack {
                        Circle()
                            .fill(Champ.goldGradient)
                            .frame(width: 56, height: 56)
                            .shadow(color: Champ.gold.opacity(0.4), radius: 16, y: 4)
                        Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(.black.opacity(0.9))
                            .offset(x: playback.isPlaying ? 0 : 2)
                    }
                }
                .buttonStyle(ChampButtonStyle())
                .disabled(!processor.hasProcessed || workspacePhase != .loaded)
                .opacity(processor.hasProcessed ? 1 : 0.4)
                .keyboardShortcut(.space, modifiers: [])
                .help("Play/Pause (Space)")

                Spacer()

                // Time readout (relative to trim)
                Text("\(formatTime(max(0, playback.currentTime - playback.startTime)))  /  \(formatTime(playback.effectiveDuration))")
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(Champ.textSecondary)
                    .frame(minWidth: 120, alignment: .trailing)
            }
        }
    }

    private func sourceChip(title: String, icon: String, mastered: Bool) -> some View {
        let on = playback.isMastered == mastered
        return Button {
            playback.setMastered(mastered)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(on ? .black.opacity(0.9) : Champ.textSecondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(on ? AnyShapeStyle(Champ.goldGradient) : AnyShapeStyle(Color.clear))
            )
        }
        .buttonStyle(ChampButtonStyle())
        .disabled(!processor.hasProcessed)
    }

    // MARK: - Download

    private var downloadButton: some View {
        Button {
            prepareAndExport()
        } label: {
            HStack(spacing: 12) {
                if isPreparingExport {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 26, weight: .semibold))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(isPreparingExport ? "Preparing…" : "Download Master")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                    Text("\(selectedStyle.rawValue) · 24-bit WAV")
                        .font(.system(size: 12, weight: .medium))
                        .opacity(0.75)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .opacity(0.7)
            }
            .foregroundStyle(.black.opacity(0.9))
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Champ.goldGradient)
                    .shadow(color: Champ.gold.opacity(0.35), radius: 20, y: 8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.25), lineWidth: 1)
            )
        }
        .buttonStyle(ChampButtonStyle(disabled: !processor.isStyleReady(selectedStyle) || isPreparingExport))
        .disabled(!processor.isStyleReady(selectedStyle) || isPreparingExport)
        .padding(.top, 4)
    }

    private func prepareAndExport() {
        guard let source = processor.masteredFileURL(for: selectedStyle) else { return }
        isPreparingExport = true
        let region = editRegion
        let duration = processor.trackDuration
        Task {
            do {
                let url = try await Task.detached(priority: .userInitiated) {
                    try AudioEditRenderer.render(
                        sourceURL: source,
                        region: region,
                        fullDuration: duration
                    )
                }.value
                await MainActor.run {
                    exportDocumentURL = url
                    isPreparingExport = false
                    showExporter = true
                }
            } catch {
                await MainActor.run {
                    isPreparingExport = false
                    processor.errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Champ.textPrimary)
            Spacer()
            Button("Dismiss") {
                processor.errorMessage = nil
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Champ.gold)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.orange.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                )
        )
    }

    // MARK: - Actions

    /// Wire playback to whatever masters are ready so the user can listen while
    /// remaining styles finish rendering in the background.
    private func syncPlaybackFromProcessor(resetEdit: Bool = false) {
        guard processor.hasProcessed else { return }
        var urls: [MasteringStyle: URL] = [:]
        for style in MasteringStyle.allCases {
            if let u = processor.masteredFileURL(for: style) {
                urls[style] = u
            }
        }
        guard !urls.isEmpty else { return }

        if resetEdit {
            editRegion = EditRegion()
        }

        // Prefer the user's selected style if ready; otherwise the first ready one.
        let style: MasteringStyle = {
            if urls[selectedStyle] != nil { return selectedStyle }
            return MasteringStyle.allCases.first { urls[$0] != nil } ?? selectedStyle
        }()
        if style != selectedStyle {
            selectedStyle = style
        }

        // First unlock: full configure. Later arrivals: merge URLs only.
        if playback.fullDuration <= 0 {
            playback.configure(
                originalURL: processor.localSourceURL,
                masteredURLs: urls,
                style: style,
                duration: processor.trackDuration
            )
            if !resetEdit {
                playback.updateEditRegion(editRegion)
            }
        } else {
            playback.updateMasteredURLs(urls)
        }
    }

    private func loadFile(_ url: URL) {
        deferredLoadTask?.cancel()

        if workspacePhase == .loaded {
            // Hold the outgoing filename and waveform intact while that complete
            // workspace dissolves. The new processor session starts only after
            // its visible handoff, so nothing resets underneath the fade.
            playback.pause()
            isPreparingLoad = true
            withAnimation(revealAnimation) {
                workspacePhase = .loading
            }
            deferredLoadTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(360))
                guard !Task.isCancelled else { return }
                beginLoading(url)
            }
            return
        }

        isPreparingLoad = false
        withAnimation(revealAnimation) {
            workspacePhase = .loading
        }
        beginLoading(url)
    }

    private func returnToInitialView() {
        deferredLoadTask?.cancel()
        processor.cancelLoad()
        playback.pause()
        isPreparingLoad = false
        isDropTargeted = false
        processor.errorMessage = nil

        withAnimation(revealAnimation) {
            workspacePhase = .initial
        }

        // Keep the outgoing filename, waveform, and transport visually stable
        // until their dissolve is complete. A new drop cancels this cleanup and
        // starts loading immediately from the initial workspace.
        deferredLoadTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(360))
            guard !Task.isCancelled, workspacePhase == .initial else { return }
            playback.reset()
            editRegion = EditRegion()
            exportDocumentURL = nil
            selectedFileURL = nil
            selectedStyle = .fullPower
            deferredLoadTask = nil
        }
    }

    private func beginLoading(_ url: URL) {
        playback.reset()
        editRegion = EditRegion()
        exportDocumentURL = nil
        selectedFileURL = url
        selectedStyle = .fullPower
        isPreparingLoad = false
        deferredLoadTask = nil
        processor.loadAndPrecomputeMasters(url: url)
    }

    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }

        // Prefer file URL
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                let url: URL? = {
                    if let data = item as? Data {
                        return URL(dataRepresentation: data, relativeTo: nil)
                    }
                    if let url = item as? URL { return url }
                    if let str = item as? String { return URL(fileURLWithPath: str) }
                    return nil
                }()
                guard let url else { return }
                DispatchQueue.main.async { loadFile(url) }
            }
            return true
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.audio.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.audio.identifier, options: nil) { item, _ in
                guard let url = item as? URL else { return }
                DispatchQueue.main.async { loadFile(url) }
            }
            return true
        }

        return false
    }

    private var exportFilename: String {
        let base = selectedFileURL?
            .deletingPathExtension()
            .lastPathComponent ?? "track"
        return "\(base)_champagne_\(selectedStyle.fileSlug)"
    }

    private var audioTypes: [UTType] {
        var types: [UTType] = [.audio, .wav, .mp3, .aiff, .mpeg4Audio]
        if let flac = UTType(filenameExtension: "flac") { types.append(flac) }
        if let caf = UTType(filenameExtension: "caf") { types.append(caf) }
        return types
    }

    private func formatTime(_ t: TimeInterval) -> String {
        guard t.isFinite && t >= 0 else { return "0:00" }
        let total = Int(t.rounded(.down))
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Style card

private struct StyleCard: View {
    let style: MasteringStyle
    let isSelected: Bool
    let isEnabled: Bool
    let isHovered: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(isSelected ? AnyShapeStyle(Champ.goldGradient) : AnyShapeStyle(Champ.bgElevated))
                        .frame(width: 42, height: 42)
                    Image(systemName: style.systemImage)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(isSelected ? .black.opacity(0.85) : Champ.gold)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(style.rawValue)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Champ.textPrimary)
                    Text(style.subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Champ.textSecondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Champ.goldBright)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Champ.bgCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(
                                isSelected ? Champ.gold.opacity(0.7) : (isHovered ? Champ.borderStrong : Champ.border),
                                lineWidth: isSelected ? 1.5 : 1
                            )
                    )
                    .shadow(color: isSelected ? Champ.gold.opacity(0.18) : .clear, radius: 12, y: 4)
            )
        }
        .buttonStyle(ChampButtonStyle(disabled: !isEnabled))
        .disabled(!isEnabled)
        .animation(.easeOut(duration: 0.15), value: isSelected)
    }
}

// MARK: - Editable waveform (trim + fade handles)

private enum WaveDragTarget: Equatable {
    case trimStart, trimEnd, fadeIn, fadeOut, scrub
}

private enum FadeDragAxis: Equatable {
    case horizontal, vertical
}

struct EditableWaveformView: View {
    let samples: [Float]
    let progress: Double
    let accent: Color
    let fullDuration: Double
    @Binding var region: EditRegion
    var onSeek: (Double) -> Void

    @State private var dragTarget: WaveDragTarget?
    @State private var dragStartRegion: EditRegion?
    @State private var fadeDragAxis: FadeDragAxis?

    /// Minimum pixel gap between a trim edge and its fade handle so they never stack.
    private let handleGap: CGFloat = 32
    /// Separates an intentional horizontal/vertical edit from pointer jitter.
    private let dragAxisThreshold: CGFloat = 4
    /// Full neutral-to-extreme curve travel, relative to waveform height.
    private let curvatureTravelFraction: CGFloat = 2.0 / 3.0

    var body: some View {
        GeometryReader { geo in
            let w = max(1, geo.size.width)
            let h = geo.size.height
            let layout = handleLayout(width: w)

            ZStack(alignment: .topLeading) {
                waveformCanvas(width: w, height: h, layout: layout)

                // Dim outside selection
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(Color.black.opacity(0.45))
                        .frame(width: max(0, layout.trimStartX))
                    Spacer(minLength: 0)
                    Rectangle()
                        .fill(Color.black.opacity(0.45))
                        .frame(width: max(0, w - layout.trimEndX))
                }
                .allowsHitTesting(false)

                // Selection border
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .stroke(Champ.gold.opacity(0.7), lineWidth: 1.5)
                    .frame(width: max(4, layout.trimEndX - layout.trimStartX), height: h)
                    .offset(x: layout.trimStartX)

                // Playhead
                Rectangle()
                    .fill(Champ.goldBright)
                    .frame(width: 1.5, height: h)
                    .offset(x: w * progress)
                    .allowsHitTesting(false)

                // TRIM handles — gold, full height edge grips (bottom-biased knob)
                trimHandle(x: layout.trimStartX, h: h, leading: true)
                trimHandle(x: layout.trimEndX, h: h, leading: false)

                // Neutral fade handles stay visually secondary to the gold master.
                fadeHandle(
                    x: layout.fadeInX,
                    h: h,
                    label: "IN",
                    isAdjustingCurve: dragTarget == .fadeIn && fadeDragAxis == .vertical
                )
                fadeHandle(
                    x: layout.fadeOutX,
                    h: h,
                    label: "OUT",
                    isAdjustingCurve: dragTarget == .fadeOut && fadeDragAxis == .vertical
                )
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let x = value.location.x
                        let p = min(1, max(0, x / w))
                        let layoutNow = handleLayout(width: w)

                        let target: WaveDragTarget
                        let startRegion: EditRegion
                        if let activeTarget = dragTarget {
                            target = activeTarget
                            startRegion = dragStartRegion ?? region
                        } else {
                            target = hitTest(x: x, layout: layoutNow)
                            dragTarget = target
                            dragStartRegion = region
                            fadeDragAxis = nil
                            startRegion = region
                        }

                        var r = region
                        switch target {
                        case .trimStart:
                            r.trimStart = min(p, r.trimEnd - EditRegion.minSelection)
                            r.normalize(duration: fullDuration)
                        case .trimEnd:
                            r.trimEnd = max(p, r.trimStart + EditRegion.minSelection)
                            r.normalize(duration: fullDuration)
                        case .fadeIn:
                            guard let axis = resolvedFadeDragAxis(for: value.translation) else { return }
                            r = startRegion
                            switch axis {
                            case .horizontal:
                                let dx = adjustedAxisTranslation(value.translation.width)
                                r.fadeIn = displayedFadeLength(
                                    startRegion.fadeIn,
                                    in: startRegion,
                                    width: w
                                )
                                    + Double(dx / w) * fullDuration
                            case .vertical:
                                let dy = adjustedAxisTranslation(value.translation.height)
                                // Direct manipulation: up lifts/steepens the
                                // curve; down lowers it into a broader fade.
                                // The symmetric control position gives both
                                // directions the same amount of pointer travel.
                                let startPosition = EditRegion.fadeControlPosition(
                                    forCurvature: startRegion.fadeInCurvature
                                )
                                r.fadeInCurvature = EditRegion.fadeCurvature(
                                    forControlPosition: startPosition
                                        - Double(dy / max(1, h * curvatureTravelFraction))
                                )
                            }
                            r.normalize(duration: fullDuration)
                        case .fadeOut:
                            guard let axis = resolvedFadeDragAxis(for: value.translation) else { return }
                            r = startRegion
                            switch axis {
                            case .horizontal:
                                let dx = adjustedAxisTranslation(value.translation.width)
                                r.fadeOut = displayedFadeLength(
                                    startRegion.fadeOut,
                                    in: startRegion,
                                    width: w
                                )
                                    - Double(dx / w) * fullDuration
                            case .vertical:
                                let dy = adjustedAxisTranslation(value.translation.height)
                                let startPosition = EditRegion.fadeControlPosition(
                                    forCurvature: startRegion.fadeOutCurvature
                                )
                                r.fadeOutCurvature = EditRegion.fadeCurvature(
                                    forControlPosition: startPosition
                                        - Double(dy / max(1, h * curvatureTravelFraction))
                                )
                            }
                            r.normalize(duration: fullDuration)
                        case .scrub:
                            onSeek(p)
                            return
                        }
                        region = r
                    }
                    .onEnded { _ in
                        dragTarget = nil
                        dragStartRegion = nil
                        fadeDragAxis = nil
                    }
            )
        }
    }

    // MARK: Layout

    private struct HandleLayout {
        var trimStartX: CGFloat
        var trimEndX: CGFloat
        var fadeInX: CGFloat
        var fadeOutX: CGFloat
        var fadeInN: Double
        var fadeOutN: Double
    }

    private func handleLayout(width w: CGFloat) -> HandleLayout {
        let ts = region.trimStart
        let te = region.trimEnd
        let fadeInN = fullDuration > 0 ? region.fadeIn / fullDuration : 0
        let fadeOutN = fullDuration > 0 ? region.fadeOut / fullDuration : 0

        let gapN = Double(handleGap / w)
        let sel = max(EditRegion.minSelection, te - ts)
        // Keep seed insets inside the selection so fade handles never sit on trim edges
        let seed = min(gapN, sel * 0.35)

        // Actual fade position, but never closer to the edge than `seed` when drawing/hit-testing
        // so the neutral control is always independently grabbable.
        let fadeInHandleN = max(fadeInN, seed)
        let fadeOutHandleN = max(fadeOutN, seed)

        return HandleLayout(
            trimStartX: CGFloat(ts) * w,
            trimEndX: CGFloat(te) * w,
            fadeInX: CGFloat(ts + fadeInHandleN) * w,
            fadeOutX: CGFloat(te - fadeOutHandleN) * w,
            fadeInN: fadeInN,
            fadeOutN: fadeOutN
        )
    }

    /// Fade handles are seeded inward when a fade is shorter than the minimum
    /// visual gap. Use that displayed position as the drag origin so the handle
    /// stays under the pointer instead of trailing it by the seed distance.
    private func displayedFadeLength(
        _ fadeSeconds: Double,
        in baseRegion: EditRegion,
        width w: CGFloat
    ) -> Double {
        guard fullDuration > 0 else { return 0 }
        let selection = max(EditRegion.minSelection, baseRegion.trimEnd - baseRegion.trimStart)
        let seed = min(Double(handleGap / max(1, w)), selection * 0.35)
        return max(fadeSeconds, seed * fullDuration)
    }

    private func hitTest(x: CGFloat, layout: HandleLayout) -> WaveDragTarget {
        // Nearest-handle wins — four distinct targets, no priority stacking on the same pixel.
        let candidates: [(WaveDragTarget, CGFloat)] = [
            (.trimStart, layout.trimStartX),
            (.trimEnd, layout.trimEndX),
            (.fadeIn, layout.fadeInX),
            (.fadeOut, layout.fadeOutX)
        ]
        let tol: CGFloat = 22
        let closest = candidates.min(by: { abs($0.1 - x) < abs($1.1 - x) })
        if let closest, abs(closest.1 - x) <= tol {
            return closest.0
        }
        return .scrub
    }

    private func resolvedFadeDragAxis(for translation: CGSize) -> FadeDragAxis? {
        if let fadeDragAxis { return fadeDragAxis }
        let horizontal = abs(translation.width)
        let vertical = abs(translation.height)
        guard max(horizontal, vertical) > dragAxisThreshold else { return nil }
        let resolved: FadeDragAxis = vertical > horizontal ? .vertical : .horizontal
        fadeDragAxis = resolved
        return resolved
    }

    private func adjustedAxisTranslation(_ translation: CGFloat) -> CGFloat {
        guard abs(translation) > dragAxisThreshold else { return 0 }
        return translation > 0
            ? translation - dragAxisThreshold
            : translation + dragAxisThreshold
    }

    // MARK: Drawing

    private func waveformCanvas(width w: CGFloat, height h: CGFloat, layout: HandleLayout) -> some View {
        Canvas { context, size in
            guard !samples.isEmpty else { return }
            let count = samples.count
            let barWidth = max(1.2, size.width / CGFloat(count) * 0.65)
            let spacing = size.width / CGFloat(count)
            let mid = size.height / 2
            let progressX = size.width * CGFloat(min(1, max(0, progress)))
            let left = layout.trimStartX
            let right = layout.trimEndX

            for i in 0..<count {
                let x = CGFloat(i) * spacing + spacing * 0.15
                let amp = CGFloat(samples[i])
                let barH = max(2, amp * (size.height * 0.82))
                let rect = CGRect(x: x, y: mid - barH / 2, width: barWidth, height: barH)

                let inSel = x >= left && x <= right
                let isPlayed = inSel && x < progressX
                let color: Color = {
                    if !inSel { return accent.opacity(0.12) }
                    if isPlayed { return accent }
                    return accent.opacity(0.35)
                }()
                context.fill(
                    Path(roundedRect: rect, cornerRadius: barWidth / 2),
                    with: .color(color)
                )
            }

            // Keep the original triangular-envelope language: the waveform
            // bounds provide two sides of each triangle and this is its curved
            // diagonal. There is deliberately no closed fill beneath the line.
            if layout.fadeInN > 0.0005 {
                let endX = left + size.width * CGFloat(layout.fadeInN)
                let curve = parabolicFadeCurve(
                    startX: left,
                    endX: endX,
                    height: size.height,
                    fadesIn: true,
                    curvature: region.fadeInCurvature
                )
                context.stroke(
                    curve,
                    with: .linearGradient(
                        Gradient(colors: [
                            Color.white.opacity(0.18),
                            Color.white.opacity(0.42)
                        ]),
                        startPoint: CGPoint(x: left, y: mid),
                        endPoint: CGPoint(x: endX, y: mid)
                    ),
                    style: StrokeStyle(lineWidth: 1.25, lineCap: .round)
                )
            }
            if layout.fadeOutN > 0.0005 {
                let startX = right - size.width * CGFloat(layout.fadeOutN)
                let curve = parabolicFadeCurve(
                    startX: startX,
                    endX: right,
                    height: size.height,
                    fadesIn: false,
                    curvature: region.fadeOutCurvature
                )
                context.stroke(
                    curve,
                    with: .linearGradient(
                        Gradient(colors: [
                            Color.white.opacity(0.42),
                            Color.white.opacity(0.18)
                        ]),
                        startPoint: CGPoint(x: startX, y: mid),
                        endPoint: CGPoint(x: right, y: mid)
                    ),
                    style: StrokeStyle(lineWidth: 1.25, lineCap: .round)
                )
            }
        }
        .drawingGroup()
    }

    private func parabolicFadeCurve(
        startX: CGFloat,
        endX: CGFloat,
        height: CGFloat,
        fadesIn: Bool,
        curvature: Double
    ) -> Path {
        let safeEndX = max(startX + 0.001, endX)
        let top = min(2, height / 2)
        let bottom = max(top, height - 2)
        let start = CGPoint(
            x: startX,
            y: fadesIn ? bottom : top
        )
        let end = CGPoint(
            x: safeEndX,
            y: fadesIn ? top : bottom
        )
        // This is the same quadratic control used by preview and export:
        // positive curvature lifts the center; negative curvature lowers it.
        let bend = EditRegion.normalizedCurvature(curvature)
        let control = CGPoint(
            x: (startX + safeEndX) / 2,
            y: top + (bottom - top) * CGFloat((1 - bend) / 2)
        )

        var curve = Path()
        curve.move(to: start)
        curve.addQuadCurve(to: end, control: control)
        return curve
    }

    /// Gold edge grip for trim (cut).
    private func trimHandle(x: CGFloat, h: CGFloat, leading: Bool) -> some View {
        ZStack {
            Capsule()
                .fill(Champ.goldBright)
                .frame(width: 5, height: h * 0.85)
            VStack(spacing: 2) {
                Image(systemName: "arrow.left.and.line.vertical.and.arrow.right")
                    .font(.system(size: 8, weight: .bold))
                Text("CUT")
                    .font(.system(size: 7, weight: .heavy))
                    .tracking(0.5)
            }
            .foregroundStyle(.black.opacity(0.8))
            .padding(.horizontal, 5)
            .padding(.vertical, 4)
            .background(Capsule().fill(Champ.goldBright))
            .offset(y: h * 0.28)
        }
        .shadow(color: Champ.gold.opacity(0.45), radius: 4)
        .position(x: x, y: h / 2)
        .allowsHitTesting(false)
    }

    /// Graphite fade handle — distinct from trim without competing with gold.
    private func fadeHandle(
        x: CGFloat,
        h: CGFloat,
        label: String,
        isAdjustingCurve: Bool
    ) -> some View {
        VStack(spacing: 3) {
            HStack(spacing: 3) {
                Text("FADE \(label)")
                    .tracking(0.3)
                Image(systemName: "arrow.up.and.down")
                    .font(.system(size: 6, weight: .black))
            }
            .font(.system(size: 7, weight: .heavy))
            .foregroundStyle(.black.opacity(0.85))
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(isAdjustingCurve ? Color.white.opacity(0.9) : Champ.neutralAccent)
            )
            RoundedRectangle(cornerRadius: 1)
                .fill(isAdjustingCurve ? Color.white.opacity(0.9) : Champ.neutralAccent)
                .frame(width: 3, height: h * 0.45)
        }
        .shadow(color: Color.black.opacity(0.65), radius: 4)
        .position(x: x, y: h * 0.42)
        .allowsHitTesting(false)
    }
}

// MARK: - Export document

struct ExportableAudio: FileDocument {
    static var readableContentTypes: [UTType] { [.wav] }

    let url: URL?

    init(url: URL?) {
        self.url = url
    }

    init(configuration: ReadConfiguration) throws {
        url = nil
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        guard let url else { throw CocoaError(.fileReadNoSuchFile) }
        let data = try Data(contentsOf: url)
        return .init(regularFileWithContents: data)
    }
}

#Preview {
    ContentView()
        .frame(width: 960, height: 780)
}
