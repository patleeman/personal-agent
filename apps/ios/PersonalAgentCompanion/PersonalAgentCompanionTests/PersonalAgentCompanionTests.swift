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

    func testLiveCompanionRoundTripAgainstDesktopHost() async throws {
        let environment = ProcessInfo.processInfo.environment
        let config = try loadLiveCompanionConfig(from: environment)
        guard config.enabled else {
            throw XCTSkip("Live companion test is disabled.")
        }
        guard let baseURL = URL(string: config.baseURL) else {
            throw XCTSkip("The live companion test host URL is invalid.")
        }
        guard let pairingCode = config.pairingCode?.trimmingCharacters(in: .whitespacesAndNewlines), !pairingCode.isEmpty else {
            throw XCTSkip("Set a live companion pairing code to run the live test.")
        }

        let cwd = config.cwd ?? FileManager.default.currentDirectoryPath
        let surfaceId = "ios-live-test"
        let hello = try await LiveCompanionClient.hello(baseURL: baseURL)
        let paired = try await LiveCompanionClient.pair(baseURL: baseURL, code: pairingCode, deviceLabel: "PersonalAgentCompanion XCTest")
        let host = CompanionHostRecord(
            baseURL: baseURL.absoluteString,
            hostLabel: paired.hello?.hostLabel ?? hello.hostLabel,
            hostInstanceId: paired.hello?.hostInstanceId ?? hello.hostInstanceId,
            deviceId: paired.device.id,
            deviceLabel: paired.device.deviceLabel
        )
        let client = LiveCompanionClient(host: host, token: paired.bearerToken)
        defer { client.disconnect() }

        try await client.connect()
        let listState = try await client.listConversations()
        XCTAssertNotNil(listState.ordering)

        let executionTargets = try await client.listExecutionTargets()
        let targetId = executionTargets.first?.id ?? "local"
        let created = try await client.createConversation(
            .init(promptText: "", cwd: cwd, executionTargetId: targetId),
            surfaceId: surfaceId
        )
        let conversationId = created.bootstrap.conversationId
        XCTAssertFalse(conversationId.isEmpty)

        let attachment = try await client.createAttachment(conversationId: conversationId, draft: makeLiveAttachmentDraft())
        XCTAssertEqual(attachment.conversationId, conversationId)

        let attachments = try await client.listAttachments(conversationId: conversationId)
        XCTAssertTrue(attachments.attachments.contains(where: { $0.id == attachment.attachment.id }))

        let detail = try await client.readAttachment(conversationId: conversationId, attachmentId: attachment.attachment.id)
        XCTAssertEqual(detail.attachment.id, attachment.attachment.id)

        let sourceAsset = try await client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: attachment.attachment.id, asset: "source", revision: nil)
        XCTAssertEqual(sourceAsset.mimeType, "application/vnd.excalidraw+json")
        XCTAssertFalse(sourceAsset.data.isEmpty)

        let previewAsset = try await client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: attachment.attachment.id, asset: "preview", revision: nil)
        XCTAssertEqual(previewAsset.mimeType, "image/png")
        XCTAssertFalse(previewAsset.data.isEmpty)

        let stream = try await client.subscribeConversationEvents(conversationId: conversationId, surfaceId: surfaceId)
        let responseExpectation = expectation(description: "live assistant response")
        let streamTask = Task {
            var text = ""
            for await event in stream {
                switch event {
                case .textDelta(let delta):
                    text += delta
                    if text.contains("COMPANION-OK") {
                        await MainActor.run { responseExpectation.fulfill() }
                        return
                    }
                case .error(let message):
                    await MainActor.run {
                        XCTFail("Conversation stream returned an error: \(message)")
                        responseExpectation.fulfill()
                    }
                    return
                default:
                    continue
                }
            }

            await MainActor.run {
                XCTFail("Conversation stream closed before the live assistant response arrived.")
                responseExpectation.fulfill()
            }
        }

        try await client.promptConversation(
            conversationId: conversationId,
            text: "Reply with exactly COMPANION-OK and nothing else.",
            images: [],
            attachmentRefs: [PromptAttachmentReference(attachmentId: attachment.attachment.id, revision: nil, title: attachment.attachment.title)],
            surfaceId: surfaceId
        )
        await fulfillment(of: [responseExpectation], timeout: 120)
        streamTask.cancel()
    }

    private func loadLiveCompanionConfig(from environment: [String: String]) throws -> LiveCompanionConfig {
        if environment["PA_IOS_LIVE_COMPANION_TEST"] == "1", let baseURL = environment["PA_IOS_LIVE_COMPANION_URL"] {
            return LiveCompanionConfig(
                enabled: true,
                baseURL: baseURL,
                pairingCode: environment["PA_IOS_LIVE_COMPANION_PAIRING_CODE"],
                cwd: environment["PA_IOS_LIVE_COMPANION_CWD"]
            )
        }

        let configFile = environment["PA_IOS_LIVE_COMPANION_CONFIG_FILE"] ?? "/tmp/personal-agent-ios-live-test-config.json"
        guard FileManager.default.fileExists(atPath: configFile) else {
            return LiveCompanionConfig(enabled: false, baseURL: "", pairingCode: nil, cwd: nil)
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: configFile))
        return try JSONDecoder().decode(LiveCompanionConfig.self, from: data)
    }

    private func makeLiveAttachmentDraft() -> AttachmentEditorDraft {
        let sourceJSON = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"personal-agent-live-test\",\"elements\":[],\"appState\":{\"gridSize\":null},\"files\":{}}"
        let previewPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i0K8AAAAASUVORK5CYII="
        return AttachmentEditorDraft(
            title: "Live test drawing",
            note: "Created by the real companion integration test.",
            sourceAsset: AttachmentDraftAsset(
                fileName: "live-test.excalidraw",
                mimeType: "application/vnd.excalidraw+json",
                base64Data: Data(sourceJSON.utf8).base64EncodedString(),
                rawData: Data(sourceJSON.utf8)
            ),
            previewAsset: AttachmentDraftAsset(
                fileName: "live-test-preview.png",
                mimeType: "image/png",
                base64Data: previewPNGBase64,
                rawData: Data(base64Encoded: previewPNGBase64) ?? Data()
            )
        )
    }
}

private struct LiveCompanionConfig: Decodable {
    let enabled: Bool
    let baseURL: String
    let pairingCode: String?
    let cwd: String?
}
