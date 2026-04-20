import SwiftUI

@main
struct PersonalAgentCompanionApp: App {
    @StateObject private var appModel = CompanionAppModel()

    var body: some Scene {
        WindowGroup {
            RootView(appModel: appModel)
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    Task {
                        await appModel.handleIncomingSetupURL(url)
                    }
                }
        }
    }
}
