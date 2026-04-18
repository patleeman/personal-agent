import XCTest
@testable import PersonalAgentCompanion

@MainActor
final class PersonalAgentCompanionTests: XCTestCase {
    func testHostSessionBuildsPinnedOpenAndRecentSections() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(session.sections.map(\.id), ["pinned", "open"])
        XCTAssertEqual(session.sections.first?.sessions.first?.id, "conv-1")
        XCTAssertEqual(session.sections.last?.sessions.first?.id, "conv-2")
    }

    func testConversationBootstrapLoadsTranscriptAndAttachments() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: []
        )

        model.loadBootstrap()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(model.title, "iOS companion app")
        XCTAssertEqual(model.blocks.count, 3)
        XCTAssertEqual(model.savedAttachments.count, 1)
        XCTAssertEqual(model.currentExecutionTargetId, "local")
    }

    func testPromptSendClearsComposerAndAddsBlocks() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: []
        )
        model.start()
        try await Task.sleep(for: .milliseconds(50))

        model.promptText = "Ship the iOS host client"
        model.sendPrompt()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertTrue(model.promptText.isEmpty)
        XCTAssertGreaterThan(model.blocks.count, 3)
        XCTAssertTrue(model.blocks.contains(where: { $0.type == "user" && $0.text == "Ship the iOS host client" }))
    }

    func testAttachmentEditingDraftDownloadsSourceAndPreview() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: []
        )

        let loadedRecord = await model.loadAttachment("att-1")
        let record = try XCTUnwrap(loadedRecord)
        let loadedDraft = await model.buildDraftForEditing(record)
        let draft = try XCTUnwrap(loadedDraft)

        XCTAssertEqual(draft.title, "Whiteboard")
        XCTAssertEqual(draft.sourceAsset?.mimeType, "application/vnd.excalidraw+json")
        XCTAssertEqual(draft.previewAsset?.mimeType, "image/png")
    }
}
