import SwiftUI
import AppKit

@MainActor
private final class ChampagneAppDelegate: NSObject, NSApplicationDelegate {
    private let privacyPolicyURLString = "https://sites.google.com/view/champagne-studio/home"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(windowDidBecomeKey(_:)),
            name: NSWindow.didBecomeKeyNotification,
            object: nil
        )
        // SwiftUI finishes installing its default commands after launch. Move
        // our replacement one run-loop turn later so the minimal menu wins.
        DispatchQueue.main.async { [weak self] in
            self?.installMinimalMainMenu()
            self?.routeCloseButtonsToQuit()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        installMinimalMainMenu()
        routeCloseButtonsToQuit()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Hide immediately so SwiftUI does not paint a close/teardown glitch.
        for window in sender.windows {
            window.alphaValue = 0
            window.orderOut(nil)
        }
        return .terminateNow
    }

    @objc private func windowDidBecomeKey(_ notification: Notification) {
        routeCloseButtonsToQuit()
    }

    /// Red X must quit like Cmd+Q. Closing the window first, then terminating,
    /// lets SwiftUI tear down the scene and hitch — especially on the empty start screen.
    private func routeCloseButtonsToQuit() {
        for window in NSApp.windows {
            guard !(window is NSPanel) else { continue }
            guard let closeButton = window.standardWindowButton(.closeButton) else { continue }
            closeButton.target = self
            closeButton.action = #selector(quitOnCloseButton(_:))
        }
    }

    @objc private func quitOnCloseButton(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    private func installMinimalMainMenu() {
        let menuBar = NSMenu()
        let champagneItem = NSMenuItem(
            title: "Champagne",
            action: nil,
            keyEquivalent: ""
        )
        let champagneMenu = NSMenu(title: "Champagne")

        let privacyItem = NSMenuItem(
            title: "Privacy Policy",
            action: #selector(openPrivacyPolicy(_:)),
            keyEquivalent: ""
        )
        privacyItem.target = self
        privacyItem.image = NSImage(
            systemSymbolName: "book.closed",
            accessibilityDescription: "Privacy Policy"
        )
        champagneMenu.addItem(privacyItem)

        let quitItem = NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        quitItem.target = NSApp
        champagneMenu.addItem(quitItem)

        champagneItem.submenu = champagneMenu
        menuBar.addItem(champagneItem)
        NSApp.mainMenu = menuBar
    }

    @objc private func openPrivacyPolicy(_ sender: Any?) {
        guard !privacyPolicyURLString.isEmpty,
              let url = URL(string: privacyPolicyURLString),
              let scheme = url.scheme,
              ["http", "https"].contains(scheme.lowercased()) else { return }
        NSWorkspace.shared.open(url)
    }
}

@main
struct ChampagneApp: App {
    @NSApplicationDelegateAdaptor(ChampagneAppDelegate.self)
    private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .defaultSize(width: 980, height: 820)
    }
}
