import SwiftUI

/// Champagne pro-audio design tokens.
enum Champ {
    // Backgrounds
    static let bgDeep = Color(red: 0.04, green: 0.04, blue: 0.055)
    static let bgCard = Color(red: 0.08, green: 0.08, blue: 0.10)
    static let bgElevated = Color(red: 0.11, green: 0.11, blue: 0.14)
    static let bgInset = Color(red: 0.05, green: 0.05, blue: 0.07)

    // Borders
    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.14)

    // Champagne gold
    static let gold = Color(red: 0.85, green: 0.70, blue: 0.35)
    static let goldBright = Color(red: 0.96, green: 0.85, blue: 0.52)
    static let goldDim = Color(red: 0.55, green: 0.45, blue: 0.22)

    // Accents
    static let violet = Color(red: 0.55, green: 0.35, blue: 0.95)
    static let violetSoft = Color(red: 0.45, green: 0.30, blue: 0.80)
    static let neutralAccent = Color(red: 0.48, green: 0.49, blue: 0.52)

    // Text
    static let textPrimary = Color(red: 0.96, green: 0.96, blue: 0.97)
    static let textSecondary = Color(red: 0.55, green: 0.55, blue: 0.60)
    static let textTertiary = Color(red: 0.38, green: 0.38, blue: 0.42)

    static var goldGradient: LinearGradient {
        LinearGradient(
            colors: [goldBright, gold, goldDim],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var brandGradient: LinearGradient {
        LinearGradient(
            colors: [goldBright.opacity(0.95), violet.opacity(0.85)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    static var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.06, green: 0.05, blue: 0.09),
                bgDeep,
                Color(red: 0.03, green: 0.03, blue: 0.05)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Shared chrome

struct GlassCard<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Champ.bgCard)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Champ.border, lineWidth: 1)
                    )
            )
    }
}

struct ChampButtonStyle: ButtonStyle {
    var prominent: Bool = false
    var disabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.85 : (disabled ? 0.45 : 1))
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
