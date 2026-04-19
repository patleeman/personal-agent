import SwiftUI

@main
struct PersonalAgentCompanionApp: App {
    @StateObject private var appModel = CompanionAppModel()

    var body: some Scene {
        WindowGroup {
            RootView(appModel: appModel)
                .onOpenURL { url in
                    Task {
                        await appModel.handleIncomingSetupURL(url)
                    }
                }
        }
    }
}
