import SwiftUI

@main
struct PersonalAgentCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var appModel = CompanionAppModel()

    var body: some Scene {
        WindowGroup {
            RootView(appModel: appModel)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    Task {
                        await appModel.handleIncomingURL(url)
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else {
                        return
                    }
                    Task {
                        await appModel.processPendingKnowledgeSharesIfPossible()
                    }
                }
        }
    }
}
