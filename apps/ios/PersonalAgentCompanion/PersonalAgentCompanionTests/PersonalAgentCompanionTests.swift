import XCTest
@testable import PersonalAgentCompanion

@MainActor
final class PersonalAgentCompanionTests: XCTestCase {
    private let hostsStorageKey = "pa.ios.companion.hosts"
    private let activeHostStorageKey = "pa.ios.companion.active-host-id"
    private let surfaceInstallationIdKey = "pa.ios.companion.installation-id"

    private final class TestAppGroupFileManager: FileManager {
        let container: URL

        init(container: URL) {
            self.container = container
            super.init()
        }

        override func containerURL(forSecurityApplicationGroupIdentifier groupIdentifier: String) -> URL? {
            container
        }
    }

    override func setUp() {
        super.setUp()
        clearStoredHostState()
        ConversationComposerDraftStore.shared.removeAll()
    }

    override func tearDown() {
        clearStoredHostState()
        ConversationComposerDraftStore.shared.removeAll()
        unsetenv("PA_IOS_MOCK_MODE")
        unsetenv("PA_IOS_USE_DEVICE_DEMO_DATA")
        unsetenv("PA_IOS_DEMO_SNAPSHOT_FILE")
        super.tearDown()
    }

    func testComposerSendButtonIconStaysInsideFixedTapTargetAtAccessibilitySizes() {
        XCTAssertLessThanOrEqual(ConversationComposerSendButtonMetrics.iconPointSize, ConversationComposerSendButtonMetrics.circleSize / 2)
    }

    func testHostSessionBuildsPinnedOpenAndRecentSections() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(session.chatSections.map(\.id), ["pinned", "open"])
        XCTAssertEqual(session.chatSections.first?.sessions.first?.id, "conv-1")
        XCTAssertEqual(session.chatSections.last?.sessions.first?.id, "conv-2")
        XCTAssertTrue(session.archivedSessions.isEmpty)
    }

    func testHostSessionBuildsSectionsFromNormalizedConversationOrdering() async throws {
        let client = MockCompanionClient()
        try await client.updateConversationTabs(ordering: ConversationOrdering(
            sessionIds: ["conv-2"],
            pinnedSessionIds: ["conv-1"],
            archivedSessionIds: [],
            workspacePaths: []
        ))
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(session.chatSections.map(\.id), ["pinned", "open"])
        XCTAssertEqual(session.chatSections.first?.sessions.map(\.id), ["conv-1"])
        XCTAssertEqual(session.chatSections.last?.sessions.map(\.id), ["conv-2"])
    }

    func testNewConversationAppearsOpenWhenCreateResponseOmitsOrdering() async throws {
        let client = MockCompanionClient()
        client.createConversationOmitsOpenOrdering = true
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        let conversationId = await session.createConversation(NewConversationRequest())
        let createdId = try XCTUnwrap(conversationId)
        try await waitForCondition(timeout: .seconds(2)) {
            session.chatSections.flatMap(\.sessions).contains(where: { $0.id == createdId })
        }

        XCTAssertFalse(session.archivedSessions.contains(where: { $0.id == createdId }))
        let state = try await client.listConversations()
        XCTAssertFalse(state.ordering.archivedSessionIds.contains(createdId))
        XCTAssertEqual(client.updateConversationTabsCount, 0)
    }

    func testArchivingConversationRemovesItFromOpenOrderingBeforeSaving() async throws {
        let client = MockCompanionClient()
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        await session.toggleArchived("conv-2")
        try await Task.sleep(for: .milliseconds(50))

        let state = try await client.listConversations()
        XCTAssertFalse(state.ordering.sessionIds.contains("conv-2"))
        XCTAssertEqual(state.ordering.archivedSessionIds, ["conv-2"])
    }

    func testConversationSwipeActionStateRevealsAndClampsActions() {
        var state = CompanionSwipeActionState()

        state.update(translationWidth: 240)
        XCTAssertEqual(state.offset, CompanionSwipeActionState.actionWidth)

        state.settle(translationWidth: 12)
        XCTAssertEqual(state.offset, 0)

        state.settle(translationWidth: -60)
        XCTAssertEqual(state.offset, -CompanionSwipeActionState.actionWidth)

        state.close()
        XCTAssertEqual(state.offset, 0)
    }

    func testCompanionSetupLinkParsesCustomPairURL() {
        let raw = "pa-companion://pair?base=http%3A%2F%2F192.168.1.23%3A3845&code=ABCD-EFGH-IJKL&label=Desktop%20Mac&hostInstanceId=host_123"
        let setupLink = CompanionSetupLink(rawString: raw)

        XCTAssertEqual(setupLink?.baseURL, "http://192.168.1.23:3845")
        XCTAssertEqual(setupLink?.code, "ABCD-EFGH-IJKL")
        XCTAssertEqual(setupLink?.hostLabel, "Desktop Mac")
        XCTAssertEqual(setupLink?.hostInstanceId, "host_123")
    }

    func testCompanionSetupLinkRejectsNonCompanionPairURLs() {
        let raw = "pa-companion://example.com/pair?base=http%3A%2F%2F192.168.1.23%3A3845&code=ABCD-EFGH-IJKL"

        XCTAssertNil(CompanionSetupLink(rawString: raw))
        XCTAssertNil(CompanionSetupLink(rawString: "https://example.com/pair?base=http%3A%2F%2F192.168.1.23%3A3845&code=ABCD-EFGH-IJKL"))
    }

    func testCompanionIncomingShareLinkParsesShareURL() {
        XCTAssertNotNil(CompanionIncomingShareLink(url: URL(string: "pa-companion://share")!))
        XCTAssertNotNil(CompanionIncomingShareLink(url: URL(string: "pa-companion:/share")!))
        XCTAssertNil(CompanionIncomingShareLink(url: URL(string: "https://example.com/share")!))
    }

    func testCompanionIncomingShareLinkRejectsNonShareHosts() {
        XCTAssertNil(CompanionIncomingShareLink(url: URL(string: "pa-companion://example.com/share")!))
    }

    func testKnowledgeShareInboxSkipsCorruptPendingShareFiles() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileManager = TestAppGroupFileManager(container: container)
        let valid = PendingKnowledgeShareEnvelope(
            id: "valid-share",
            createdAt: "2026-04-25T00:00:00Z",
            items: [PendingKnowledgeShareItem(kind: .text, text: "Keep me")]
        )

        try KnowledgeShareInboxStore.save(valid, fileManager: fileManager)
        let pendingDirectory = try KnowledgeShareInboxStore.pendingDirectoryURL(fileManager: fileManager)
        try Data("{ nope".utf8).write(to: pendingDirectory.appendingPathComponent("corrupt.json"))

        let loaded = try KnowledgeShareInboxStore.loadAll(fileManager: fileManager)

        XCTAssertEqual(loaded, [valid])
    }

    func testUpdatingSavedHostNormalizesLocalHostsToHTTP() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let original = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "http://127.0.0.1:3843",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        storeHosts([original])

        let model = CompanionAppModel()
        let saved = await model.updateHost(original, baseURLString: "https://mini.local:4444", displayName: "Mac mini")

        XCTAssertTrue(saved)
        XCTAssertEqual(model.hosts.first?.baseURL, "http://mini.local:4444")
        XCTAssertEqual(model.hosts.first?.hostLabel, "Mac mini")
    }

    func testUpdatingSavedHostDropsPathQueryAndFragmentFromBaseURL() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let original = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "http://127.0.0.1:3843",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        storeHosts([original])

        let model = CompanionAppModel()
        let saved = await model.updateHost(original, baseURLString: "https://mini.local:4444/setup?code=ABCD#pair", displayName: "Mac mini")

        XCTAssertTrue(saved)
        XCTAssertEqual(model.hosts.first?.baseURL, "http://mini.local:4444")
    }

    func testUpdatingSavedHostKeepsTailnetHostsOnHTTPS() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let original = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "https://desktop.tailnet.ts.net",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        storeHosts([original])

        let model = CompanionAppModel()
        let saved = await model.updateHost(original, baseURLString: "desktop.tailnet.ts.net", displayName: "Tailnet host")

        XCTAssertTrue(saved)
        XCTAssertEqual(model.hosts.first?.baseURL, "https://desktop.tailnet.ts.net")
    }

    func testLoadingSavedHostsNormalizesLocalHTTPSUrlsToHTTP() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let original = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "https://192.168.1.23:3843",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        storeHosts([original])

        let model = CompanionAppModel()

        XCTAssertEqual(model.hosts.first?.baseURL, "http://192.168.1.23:3843")
    }

    func testLoadingSavedHostsKeepsValidRecordsWhenOneRecordIsMalformed() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let valid = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "https://192.168.1.23:3843",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        let validObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(valid))
        let data = try JSONSerialization.data(withJSONObject: [
            validObject,
            ["id": "22222222-2222-2222-2222-222222222222", "hostLabel": "Malformed host"],
        ])
        UserDefaults.standard.set(data, forKey: hostsStorageKey)

        let model = CompanionAppModel()

        XCTAssertEqual(model.hosts.map(\.hostLabel), ["Desktop Host"])
        XCTAssertNil(model.bannerMessage)
    }

    func testMockModeSeedsASelectableHostWithoutAutoConnecting() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)

        let model = CompanionAppModel()

        XCTAssertEqual(model.hosts.first?.hostLabel, "Demo Host")
        XCTAssertEqual(model.activeHostId, model.hosts.first?.id)
        XCTAssertNil(model.activeSession)
    }

    func testMockKnowledgeImportCreatesInboxNote() async throws {
        let client = MockCompanionClient()
        let result = try await client.importKnowledge(CompanionKnowledgeImportRequest(
            kind: .url,
            directoryId: "Inbox",
            title: "Example link",
            text: nil,
            url: "https://example.com/post",
            mimeType: nil,
            fileName: nil,
            dataBase64: nil,
            sourceApp: "Safari",
            createdAt: "2026-04-22T12:00:00Z"
        ))

        XCTAssertEqual(result.sourceKind, "url")
        XCTAssertEqual(result.title, "Example link")
        let file = try await client.readKnowledgeFile(fileId: result.note.id)
        XCTAssertTrue(file.content.contains("https://example.com/post"))
    }

    func testMockClientCanLoadToolHeavyDeviceSnapshot() async throws {
        let snapshotURL = FileManager.default.temporaryDirectory.appendingPathComponent("pa-ios-demo-snapshot-\(UUID().uuidString).json")
        let conversation = MockCompanionSnapshotFixture(
            sessionMeta: SessionMeta(
                id: "local-demo-1",
                file: "/tmp/local-demo-1.jsonl",
                timestamp: ISO8601DateFormatter.flexible.string(from: .now),
                cwd: "/home/user/project",
                cwdSlug: "personal-agent",
                model: "gpt-5.4",
                title: "Real transcript demo",
                messageCount: 6,
                isRunning: false,
                isLive: true,
                lastActivityAt: ISO8601DateFormatter.flexible.string(from: .now),
                parentSessionFile: nil,
                parentSessionId: nil,
                sourceRunId: nil,
                remoteHostId: nil,
                remoteHostLabel: nil,
                remoteConversationId: nil,
                automationTaskId: nil,
                automationTitle: nil,
                needsAttention: false,
                attentionUpdatedAt: nil,
                attentionUnreadMessageCount: nil,
                attentionUnreadActivityCount: nil,
                attentionActivityIds: nil
            ),
            blocks: [
                DisplayBlock(type: "user", id: "u1", ts: ISO8601DateFormatter.flexible.string(from: .now), text: "Show me the transcript"),
                DisplayBlock(type: "tool_use", id: "tool-1", ts: ISO8601DateFormatter.flexible.string(from: .now), tool: "read", input: .object(["path": .string("AGENTS.md")]), output: "Loaded AGENTS.md", durationMs: 1200),
                DisplayBlock(type: "text", id: "a1", ts: ISO8601DateFormatter.flexible.string(from: .now), text: "Here is the transcript summary.")
            ],
            toolUseCount: 1
        )
        let snapshot = MockCompanionSnapshotFixtureFile(hostLabel: "Desktop Demo", generatedAt: ISO8601DateFormatter.flexible.string(from: .now), conversations: [conversation])
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: snapshotURL)

        setenv("PA_IOS_USE_DEVICE_DEMO_DATA", "1", 1)
        setenv("PA_IOS_DEMO_SNAPSHOT_FILE", snapshotURL.path, 1)

        let client = MockCompanionClient()
        let listState = try await client.listConversations()
        let bootstrap = try await client.conversationBootstrap(conversationId: "local-demo-1")

        XCTAssertEqual(client.host.hostLabel, "Desktop Demo")
        XCTAssertEqual(listState.sessions.first?.id, "local-demo-1")
        XCTAssertTrue(bootstrap.bootstrap.sessionDetail?.blocks.contains(where: { $0.type == "tool_use" }) == true)
    }

    func testRemovingActiveHostFallsBackToNextSavedHost() async throws {
        setenv("PA_IOS_MOCK_MODE", "1", 1)
        let first = CompanionHostRecord(
            id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
            baseURL: "http://127.0.0.1:3843",
            hostLabel: "Desktop Host",
            hostInstanceId: "host_1",
            deviceId: "device_1",
            deviceLabel: "iPhone"
        )
        let second = CompanionHostRecord(
            id: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
            baseURL: "http://mini.local:3843",
            hostLabel: "Mac mini",
            hostInstanceId: "host_2",
            deviceId: "device_2",
            deviceLabel: "iPhone"
        )
        storeHosts([first, second])

        let model = CompanionAppModel()
        await model.selectHost(first.id)
        model.removeHost(first)
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(model.activeHostId, second.id)
        XCTAssertNotNil(model.activeSession)
        XCTAssertEqual(model.hosts.map(\.id), [second.id])
    }

    func testConversationBootstrapLoadsTranscriptAndAttachments() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.loadBootstrap()
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertEqual(client.lastConversationBootstrapOptions?.tailBlocks, ConversationBootstrapRequestOptions.defaultTailBlocks)
        XCTAssertEqual(model.title, "iOS companion app")
        XCTAssertEqual(model.blocks.count, 5)
        XCTAssertTrue(model.blocks.contains(where: { $0.type == "tool_use" }))
        XCTAssertEqual(model.savedAttachments.count, 1)
        XCTAssertEqual(model.currentExecutionTargetId, "local")
    }

    func testStaleBootstrapDoesNotOverwriteLiveConversationEvents() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        client.conversationBootstrapDelayNanoseconds = 150_000_000
        model.loadBootstrap()
        try await Task.sleep(nanoseconds: 30_000_000)
        client.emitUserMessage(conversationId: "conv-1", text: "Remote message during refresh")

        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }
        XCTAssertEqual(model.blocks.filter { $0.type == "user" && $0.text == "Remote message during refresh" }.count, 1)
    }

    func testStaleBootstrapDoesNotOverwriteLiveTitleUpdate() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.title == "iOS companion app"
        }

        client.conversationBootstrapDelayNanoseconds = 150_000_000
        model.loadBootstrap()
        try await Task.sleep(nanoseconds: 30_000_000)
        client.emitTitleUpdate(conversationId: "conv-1", title: "Updated remote title")

        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }
        XCTAssertEqual(model.title, "Updated remote title")
    }

    func testToolEndWithoutToolStartStillShowsFailureBlock() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        client.emitToolEnd(conversationId: "conv-1", toolCallId: "missing-tool-start", toolName: "bash", isError: true, output: "command failed")

        try await waitForCondition(timeout: .seconds(2)) {
            model.blocks.contains { $0.id == "missing-tool-start" }
        }
        let block = try XCTUnwrap(model.blocks.first { $0.id == "missing-tool-start" })
        XCTAssertEqual(block.type, "tool_use")
        XCTAssertEqual(block.tool, "bash")
        XCTAssertEqual(block.output, "command failed")
        XCTAssertEqual(block.message, "command failed")
    }

    func testToolUpdateWithoutToolStartStillShowsLiveOutputBlock() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        client.emitToolUpdate(conversationId: "conv-1", toolCallId: "missing-tool-update", partialResult: .string("partial output"))

        try await waitForCondition(timeout: .seconds(2)) {
            model.blocks.contains { $0.id == "missing-tool-update" }
        }
        let block = try XCTUnwrap(model.blocks.first { $0.id == "missing-tool-update" })
        XCTAssertEqual(block.type, "tool_use")
        XCTAssertEqual(block.output, "partial output")
        XCTAssertNil(block.durationMs)
    }

    func testOlderConversationBootstrapDoesNotClearLoadingForNewerBootstrap() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        client.conversationBootstrapDelayQueueNanoseconds = [50_000_000, 150_000_000]

        model.loadBootstrap()
        try await Task.sleep(nanoseconds: 10_000_000)
        model.loadBootstrap()
        try await Task.sleep(nanoseconds: 80_000_000)

        XCTAssertTrue(model.isLoading)
        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }
    }

    func testStoppingConversationCancelsPendingBootstrapLoad() async throws {
        let client = MockCompanionClient()
        client.conversationBootstrapDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.loadBootstrap()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.stop()
        XCTAssertFalse(model.isLoading)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(model.blocks.isEmpty)
        XCTAssertEqual(model.title, "Conversation")
        XCTAssertNil(model.errorMessage)
    }

    func testCompanionTranscriptImageAssetPathRewritesSessionAssetUrls() {
        XCTAssertEqual(
            companionTranscriptImageAssetPath("/api/sessions/conv-1/blocks/block-1/image"),
            "/companion/v1/conversations/conv-1/blocks/block-1/image"
        )
        XCTAssertEqual(
            companionTranscriptImageAssetPath("/api/sessions/conv-1/blocks/block-1/images/2"),
            "/companion/v1/conversations/conv-1/blocks/block-1/images/2"
        )
        XCTAssertEqual(
            companionTranscriptImageAssetPath("/api/sessions/conv-1/blocks/block-1/image?revision=3#preview"),
            "/companion/v1/conversations/conv-1/blocks/block-1/image?revision=3#preview"
        )
        XCTAssertEqual(
            companionTranscriptImageAssetPath("/companion/v1/conversations/conv-1/blocks/block-1/image"),
            "/companion/v1/conversations/conv-1/blocks/block-1/image"
        )
        XCTAssertEqual(
            companionTranscriptImageAssetPath("/api/companion/v1/conversations/conv-1/blocks/block-1/image"),
            "/companion/v1/conversations/conv-1/blocks/block-1/image"
        )
        XCTAssertNil(companionTranscriptImageAssetPath("https://example.com/image.png"))
    }

    func testDataURLDataDecodesWrappedBase64Payloads() {
        let wrapped = "data:text/plain;base64,aGVs\n bG8="

        XCTAssertEqual(dataURLData(wrapped), Data("hello".utf8))
    }

    func testRemoteDirectoryEndpointEncodesQueryPathAndTargetSegment() {
        XCTAssertEqual(
            companionRemoteDirectoryEndpoint(targetId: "ssh/prod", path: "/tmp/a & b?x=1"),
            "/companion/v1/execution-targets/ssh%2Fprod/directories?path=/tmp/a%20%26%20b?x%3D1"
        )
        XCTAssertEqual(
            companionRemoteDirectoryEndpoint(targetId: "local", path: "  "),
            "/companion/v1/execution-targets/local/directories"
        )
    }

    func testKnowledgeEndpointsEncodeAmpersandsInQueryValues() {
        XCTAssertEqual(
            companionKnowledgeTreeEndpoint(directoryId: "Research/R&D"),
            "/companion/v1/knowledge/tree?dir=Research/R%26D"
        )
        XCTAssertEqual(
            companionKnowledgeFileEndpoint(fileId: "Research/R&D.md"),
            "/companion/v1/knowledge/file?id=Research/R%26D.md"
        )
        XCTAssertEqual(
            companionKnowledgeEntryEndpoint(id: "Research/R&D.md"),
            "/companion/v1/knowledge/entry?id=Research/R%26D.md"
        )
    }

    func testDisplayBlockDecodesImagesWithoutAltText() throws {
        let payload = Data(#"{"type":"text","id":"block-1","ts":"2026-04-25T00:00:00Z","text":"Image attached","images":[{"src":"/companion/v1/conversations/conv-1/blocks/block-1/images/0"}]}"#.utf8)

        let block = try JSONDecoder().decode(DisplayBlock.self, from: payload)

        XCTAssertEqual(block.images?.first?.alt, "")
        XCTAssertEqual(block.images?.first?.src, "/companion/v1/conversations/conv-1/blocks/block-1/images/0")
    }

    func testSessionDetailSkipsMalformedBootstrapBlocks() throws {
        let meta = SessionMeta(
            id: "conv-1",
            file: "/tmp/conv-1.jsonl",
            timestamp: "2026-04-25T00:00:00Z",
            cwd: "/tmp/project",
            cwdSlug: "project",
            model: "gpt-5.4",
            title: "Bootstrap",
            messageCount: 2,
            isRunning: false,
            isLive: true,
            lastActivityAt: nil,
            parentSessionFile: nil,
            parentSessionId: nil,
            sourceRunId: nil,
            remoteHostId: nil,
            remoteHostLabel: nil,
            remoteConversationId: nil,
            automationTaskId: nil,
            automationTitle: nil,
            needsAttention: false,
            attentionUpdatedAt: nil,
            attentionUnreadMessageCount: nil,
            attentionUnreadActivityCount: nil,
            attentionActivityIds: nil
        )
        let metaObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(meta))
        let payload = try JSONSerialization.data(withJSONObject: [
            "meta": metaObject,
            "blocks": [
                ["type": "text", "id": "valid", "ts": "2026-04-25T00:00:00Z", "text": "Keep me"],
                ["id": "bad", "ts": "2026-04-25T00:00:01Z", "text": "Missing type"],
            ],
            "blockOffset": 0,
            "totalBlocks": 2,
        ])

        let detail = try JSONDecoder().decode(SessionDetail.self, from: payload)

        XCTAssertEqual(detail.blocks.map(\.id), ["valid"])
        XCTAssertEqual(detail.totalBlocks, 2)
    }

    func testConversationComposerDraftRestoresAcrossViewModels() {
        let client = MockCompanionClient()
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let draftStore = ConversationComposerDraftStore(baseURL: tempDraftRoot)
        let imageData = Data("image-data".utf8)
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let attachmentRevision = ConversationAttachmentRevision(
            revision: 1,
            createdAt: now,
            sourceName: "drawing.excalidraw",
            sourceMimeType: "application/vnd.excalidraw+json",
            sourceDownloadPath: "/source",
            previewName: "drawing.png",
            previewMimeType: "image/png",
            previewDownloadPath: "/preview",
            note: nil
        )

        let first = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil,
            composerDraftStore: draftStore
        )
        first.promptText = "Keep this draft"
        first.addPromptImage(PromptImageDraft(name: "pasted.png", mimeType: "image/png", base64Data: imageData.base64EncodedString(), previewData: imageData))
        first.attachDrawingReference(
            attachment: ConversationAttachmentSummary(
                id: "att-1",
                conversationId: "conv-1",
                kind: "excalidraw",
                title: "Sketch",
                createdAt: now,
                updatedAt: now,
                currentRevision: 1,
                latestRevision: attachmentRevision
            ),
            revision: 1
        )
        first.stop()

        let second = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil,
            composerDraftStore: draftStore
        )
        second.start()

        XCTAssertEqual(second.promptText, "Keep this draft")
        XCTAssertEqual(second.promptImages.count, 1)
        XCTAssertEqual(second.promptImages.first?.name, "pasted.png")
        XCTAssertEqual(second.promptAttachmentRefs.count, 1)
        XCTAssertEqual(second.promptAttachmentRefs.first?.attachmentId, "att-1")
        second.stop()
    }

    func testConversationPresencePresentationBlocksComposerWhenAnotherSurfaceControls() {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let state = LiveSessionPresenceState(
            surfaces: [
                .init(surfaceId: "desktop-1", surfaceType: "desktop_app", connectedAt: now),
                .init(surfaceId: "ios-test", surfaceType: "ios_native", connectedAt: now),
            ],
            controllerSurfaceId: "desktop-1",
            controllerSurfaceType: "desktop_app",
            controllerAcquiredAt: now
        )

        let presentation = ConversationPresencePresentation(state: state, installationSurfaceId: "ios-test")

        XCTAssertTrue(presentation.shouldDisplay)
        XCTAssertTrue(presentation.shouldBlockComposer)
        XCTAssertTrue(presentation.controllingElsewhere)
        XCTAssertFalse(presentation.controllingHere)
    }

    func testConversationPresencePresentationKeepsComposerWhenThisPhoneControls() {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let state = LiveSessionPresenceState(
            surfaces: [
                .init(surfaceId: "desktop-1", surfaceType: "desktop_app", connectedAt: now),
                .init(surfaceId: "ios-test", surfaceType: "ios_native", connectedAt: now),
            ],
            controllerSurfaceId: "ios-test",
            controllerSurfaceType: "ios_native",
            controllerAcquiredAt: now
        )

        let presentation = ConversationPresencePresentation(state: state, installationSurfaceId: "ios-test")

        XCTAssertTrue(presentation.shouldDisplay)
        XCTAssertFalse(presentation.shouldBlockComposer)
        XCTAssertFalse(presentation.controllingElsewhere)
        XCTAssertTrue(presentation.controllingHere)
    }

    func testMockConversationAutoModeCanBeReadAndUpdated() async throws {
        let client = MockCompanionClient()

        let initialState = try await client.readConversationAutoMode(conversationId: "conv-1")
        XCTAssertFalse(initialState.enabled)

        let enabledState = try await client.updateConversationAutoMode(conversationId: "conv-1", enabled: true, surfaceId: "ios-test")
        XCTAssertTrue(enabledState.enabled)
        XCTAssertNotNil(enabledState.updatedAt)

        let persistedState = try await client.readConversationAutoMode(conversationId: "conv-1")
        XCTAssertTrue(persistedState.enabled)
    }

    func testConversationRowPresentationUsesCwdFolderForSubtitleUnreadAndRunningIndicators() {
        let session = SessionMeta(
            id: "conversation-1",
            file: "/tmp/conversation-1.jsonl",
            timestamp: ISO8601DateFormatter.flexible.string(from: .now),
            cwd: "/Users/patrick/Documents/personal-agent",
            cwdSlug: "personal-agent",
            model: "gpt-5.4",
            title: "Unread running thread",
            messageCount: 5,
            isRunning: true,
            isLive: true,
            lastActivityAt: nil,
            parentSessionFile: nil,
            parentSessionId: nil,
            sourceRunId: nil,
            remoteHostId: nil,
            remoteHostLabel: nil,
            remoteConversationId: nil,
            automationTaskId: nil,
            automationTitle: nil,
            needsAttention: true,
            attentionUpdatedAt: nil,
            attentionUnreadMessageCount: 2,
            attentionUnreadActivityCount: 2,
            attentionActivityIds: nil
        )

        let presentation = ConversationRowPresentation(session: session)

        XCTAssertTrue(presentation.hasUnreadMessages)
        XCTAssertTrue(presentation.showsRunningIndicator)
        XCTAssertEqual(presentation.subtitle, "personal-agent")
    }

    func testConversationRowPresentationCanHideCwdWhenListIsGroupedByWorkspace() {
        let session = SessionMeta(
            id: "conversation-1",
            file: "/tmp/conversation-1.jsonl",
            timestamp: ISO8601DateFormatter.flexible.string(from: .now),
            cwd: "/home/user/project",
            cwdSlug: "personal-agent",
            model: "gpt-5.4",
            title: "Remote thread",
            messageCount: 3,
            isRunning: false,
            isLive: true,
            lastActivityAt: nil,
            parentSessionFile: nil,
            parentSessionId: nil,
            sourceRunId: nil,
            remoteHostId: nil,
            remoteHostLabel: "Buildbox",
            remoteConversationId: nil,
            automationTaskId: nil,
            automationTitle: nil,
            needsAttention: false,
            attentionUpdatedAt: nil,
            attentionUnreadMessageCount: nil,
            attentionUnreadActivityCount: nil,
            attentionActivityIds: nil
        )

        let presentation = ConversationRowPresentation(session: session, includeCwdInSubtitle: false)

        XCTAssertEqual(presentation.subtitle, "Buildbox")
    }

    func testConversationGroupLabelsDisambiguateSharedFolderNamesAndNormalizePaths() {
        let alpha = "/Users/patrick/personal/personal-agent/"
        let beta = "/Users/patrick/Documents/personal-agent"

        let labels = buildCompanionConversationGroupLabels([alpha, beta])

        XCTAssertEqual(normalizeCompanionConversationGroupCwd(alpha), "/Users/patrick/personal/personal-agent")
        XCTAssertEqual(labels[normalizeCompanionConversationGroupCwd(alpha)], "personal/personal-agent")
        XCTAssertEqual(labels[normalizeCompanionConversationGroupCwd(beta)], "Documents/personal-agent")
    }

    func testTranscriptMarkdownRendererAcceptsInlineAndBlockMarkdown() throws {
        XCTAssertNotNil(renderTranscriptMarkdown("**Bold** inline text only"))

        let orderedList = try XCTUnwrap(renderTranscriptMarkdown("1. First\n2. Second\n3. Third"))
        XCTAssertEqual(String(orderedList.characters), "FirstSecondThird")

        let bulletList = try XCTUnwrap(renderTranscriptMarkdown("- First\n- Second"))
        XCTAssertEqual(String(bulletList.characters), "FirstSecond")
    }

    func testPromptSendClearsComposerAndAddsBlocks() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
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

    func testSavingDrawingAttachmentAddsItToPrompt() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let saved = await model.saveNewAttachmentAndAttach(makeLiveAttachmentDraft())

        XCTAssertTrue(saved)
        XCTAssertEqual(model.promptAttachmentRefs.count, 1)
        XCTAssertEqual(model.promptAttachmentRefs.first?.title, "Live test drawing")
        XCTAssertTrue(model.savedAttachments.contains(where: { $0.id == model.promptAttachmentRefs.first?.attachmentId }))
    }

    func testSavingDrawingAttachmentIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createAttachmentDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        async let first = model.saveNewAttachmentAndAttach(makeLiveAttachmentDraft())
        async let second = model.saveNewAttachmentAndAttach(makeLiveAttachmentDraft())
        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(model.savedAttachments.filter { $0.title == "Live test drawing" }.count, 1)
        XCTAssertEqual(model.promptAttachmentRefs.filter { $0.title == "Live test drawing" }.count, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testSaveNewAttachmentClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createAttachmentFailureQueueMessages = ["Attachment create temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedSave = await model.saveNewAttachment(makeLiveAttachmentDraft())
        XCTAssertFalse(failedSave)
        XCTAssertNotNil(model.errorMessage)

        let saved = await model.saveNewAttachment(makeLiveAttachmentDraft())
        XCTAssertTrue(saved)
        XCTAssertTrue(model.savedAttachments.contains(where: { $0.title == "Live test drawing" }))
        XCTAssertNil(model.errorMessage)
    }

    func testSaveNewAttachmentAndAttachClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createAttachmentFailureQueueMessages = ["Attachment create temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedSave = await model.saveNewAttachmentAndAttach(makeLiveAttachmentDraft())
        XCTAssertFalse(failedSave)
        XCTAssertNotNil(model.errorMessage)

        let saved = await model.saveNewAttachmentAndAttach(makeLiveAttachmentDraft())
        XCTAssertTrue(saved)
        XCTAssertTrue(model.promptAttachmentRefs.contains(where: { $0.title == "Live test drawing" }))
        XCTAssertNil(model.errorMessage)
    }

    func testEditingAttachmentUpdatesExistingRecordInsteadOfDuplicatingIt() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.savedAttachments.contains(where: { $0.id == "att-1" })
        }

        var draft = makeLiveAttachmentDraft()
        draft.title = "Updated whiteboard"
        draft.note = "Updated note"
        let saved = await model.saveExistingAttachment(attachmentId: "att-1", draft: draft)

        XCTAssertTrue(saved)
        XCTAssertEqual(model.savedAttachments.count, 1)
        XCTAssertEqual(model.savedAttachments.first?.id, "att-1")
        XCTAssertEqual(model.savedAttachments.first?.title, "Updated whiteboard")
    }

    func testSaveExistingAttachmentClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.updateAttachmentFailureQueueMessages = ["Attachment update temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.savedAttachments.contains(where: { $0.id == "att-1" })
        }

        var draft = makeLiveAttachmentDraft()
        draft.title = "Updated whiteboard"

        let failedSave = await model.saveExistingAttachment(attachmentId: "att-1", draft: draft)
        XCTAssertFalse(failedSave)
        XCTAssertNotNil(model.errorMessage)

        let saved = await model.saveExistingAttachment(attachmentId: "att-1", draft: draft)
        XCTAssertTrue(saved)
        XCTAssertEqual(model.savedAttachments.first?.title, "Updated whiteboard")
        XCTAssertNil(model.errorMessage)
    }

    func testStaleAttachmentRefreshDoesNotOverwriteNewlySavedAttachment() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.savedAttachments.contains(where: { $0.id == "att-1" })
        }

        client.listAttachmentsDelayNanoseconds = 150_000_000
        model.refreshAttachments()
        try await Task.sleep(nanoseconds: 30_000_000)

        let saved = await model.saveNewAttachment(makeLiveAttachmentDraft())
        XCTAssertTrue(saved)
        let savedAttachmentId = try XCTUnwrap(model.savedAttachments.first(where: { $0.title == "Live test drawing" })?.id)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(model.savedAttachments.contains(where: { $0.id == savedAttachmentId }))
        XCTAssertNil(model.errorMessage)
    }

    func testAttachmentRefreshClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listAttachmentsFailureQueueMessages = ["Attachments temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.refreshAttachments()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.refreshAttachments()
        try await waitForCondition(timeout: .seconds(2)) {
            model.savedAttachments.contains(where: { $0.id == "att-1" })
        }
        XCTAssertNil(model.errorMessage)
    }

    func testMockKnowledgeListsFoldersAndNotes() async throws {
        let client = MockCompanionClient()

        let root = try await client.listKnowledgeEntries(directoryId: nil)
        let notesFolder = try XCTUnwrap(root.entries.first(where: { $0.kind == "folder" && $0.name == "notes" }))
        XCTAssertEqual(root.root, "/Users/patrick/Documents/personal-agent")
        XCTAssertTrue(root.entries.contains(where: { $0.kind == "folder" && $0.name == "systems" }))

        let nested = try await client.listKnowledgeEntries(directoryId: notesFolder.id)
        XCTAssertTrue(nested.entries.contains(where: { $0.kind == "file" && $0.name == "ios-companion.md" }))

        let note = try await client.readKnowledgeFile(fileId: "notes/ios-companion.md")
        XCTAssertTrue(note.content.contains("# iOS companion"))
    }

    func testMockKnowledgeWritesFilesAndCreatesFolders() async throws {
        let client = MockCompanionClient()

        let folder = try await client.createKnowledgeFolder(folderId: "notes/archive")
        XCTAssertEqual(folder.id, "notes/archive/")

        let file = try await client.writeKnowledgeFile(fileId: "notes/archive/mobile-kb.md", content: "# Mobile KB\n")
        XCTAssertEqual(file.id, "notes/archive/mobile-kb.md")
        XCTAssertEqual(file.name, "mobile-kb.md")

        let nested = try await client.listKnowledgeEntries(directoryId: "notes/archive")
        XCTAssertTrue(nested.entries.contains(where: { $0.id == "notes/archive/mobile-kb.md" }))

        let saved = try await client.readKnowledgeFile(fileId: "notes/archive/mobile-kb.md")
        XCTAssertEqual(saved.content, "# Mobile KB\n")
    }

    func testKnowledgeCreateNoteIgnoresDuplicateSaveWhilePending() async throws {
        let client = MockCompanionClient()
        client.writeKnowledgeFileDelayNanoseconds = 150_000_000
        let model = KnowledgeDirectoryViewModel(client: client, directoryId: "notes")
        await model.reload()
        let initialEntries = model.entries

        async let first = model.createNote(named: "One Tap")
        async let second = model.createNote(named: "One Tap")
        let created = await [first, second].compactMap { $0 }
        let listing = try await client.listKnowledgeEntries(directoryId: "notes")

        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(client.writeKnowledgeFileCount, 1)
        XCTAssertEqual(listing.entries.filter { $0.id == "notes/One Tap.md" }.count, 1)
        XCTAssertEqual(listing.entries.count, initialEntries.count + 1)
        XCTAssertNil(model.errorMessage)
    }

    func testKnowledgeDirectoryCreateRejectsPathSeparatorsInNames() async throws {
        let client = MockCompanionClient()
        let model = KnowledgeDirectoryViewModel(client: client, directoryId: "notes")
        await model.reload()
        let initialListing = try await client.listKnowledgeEntries(directoryId: "notes")

        let note = await model.createNote(named: "Nested/Surprise")
        XCTAssertNil(note)
        XCTAssertEqual(model.errorMessage, "Note names cannot contain path separators.")

        let folder = await model.createFolder(named: "Archive\\Later")
        XCTAssertNil(folder)
        XCTAssertEqual(model.errorMessage, "Folder names cannot contain path separators.")

        let finalListing = try await client.listKnowledgeEntries(directoryId: "notes")
        XCTAssertEqual(finalListing.entries.map(\.id).sorted(), initialListing.entries.map(\.id).sorted())
        XCTAssertEqual(client.writeKnowledgeFileCount, 0)
    }

    func testMockKnowledgeCanRenameAndDeleteEntries() async throws {
        let client = MockCompanionClient()

        _ = try await client.createKnowledgeFolder(folderId: "notes/archive")
        _ = try await client.writeKnowledgeFile(fileId: "notes/archive/mobile-kb.md", content: "# Mobile KB\n")

        let renamedFile = try await client.renameKnowledgeEntry(id: "notes/archive/mobile-kb.md", newName: "kb-v2.md", parentId: nil)
        XCTAssertEqual(renamedFile.id, "notes/archive/kb-v2.md")

        let renamedFolder = try await client.renameKnowledgeEntry(id: "notes/archive/", newName: "history", parentId: nil)
        XCTAssertEqual(renamedFolder.id, "notes/history/")

        let nested = try await client.listKnowledgeEntries(directoryId: "notes/history")
        XCTAssertTrue(nested.entries.contains(where: { $0.id == "notes/history/kb-v2.md" }))

        let movedFile = try await client.renameKnowledgeEntry(id: "notes/history/kb-v2.md", newName: "kb-v2.md", parentId: "")
        XCTAssertEqual(movedFile.id, "kb-v2.md")

        let root = try await client.listKnowledgeEntries(directoryId: nil)
        XCTAssertTrue(root.entries.contains(where: { $0.id == "kb-v2.md" }))

        try await client.deleteKnowledgeEntry(id: "notes/history/")
        let notesRoot = try await client.listKnowledgeEntries(directoryId: "notes")
        XCTAssertFalse(notesRoot.entries.contains(where: { $0.id == "notes/history/" }))
    }

    func testKnowledgeDeleteIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.deleteKnowledgeEntryDelayNanoseconds = 150_000_000
        let model = KnowledgeDirectoryViewModel(client: client, directoryId: "notes")
        await model.reload()
        let entry = try XCTUnwrap(model.entries.first(where: { $0.id == "notes/ios-companion.md" }))

        async let first = model.delete(entry: entry)
        async let second = model.delete(entry: entry)
        let results = await [first, second]
        let listing = try await client.listKnowledgeEntries(directoryId: "notes")

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(client.deleteKnowledgeEntryCount, 1)
        XCTAssertFalse(listing.entries.contains(where: { $0.id == entry.id }))
        XCTAssertNil(model.errorMessage)
    }

    func testMockKnowledgeSearchAndImageAssetUpload() async throws {
        let client = MockCompanionClient()

        let search = try await client.searchKnowledge(query: "ios", limit: 5)
        XCTAssertTrue(search.results.contains(where: { $0.id == "notes/ios-companion.md" }))

        let asset = try await client.createKnowledgeImageAsset(fileName: "snapshot.png", mimeType: "image/png", dataBase64: Data("png-data".utf8).base64EncodedString())
        XCTAssertEqual(asset.id, "_attachments/snapshot.png")
    }

    func testKnowledgeImageMarkdownIgnoresDuplicateCreateWhilePending() async throws {
        let client = MockCompanionClient()
        client.createKnowledgeImageAssetDelayNanoseconds = 150_000_000
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        async let first = model.createImageMarkdown(data: Data("png-data".utf8), mimeType: "image/png", fileName: "snapshot.png")
        async let second = model.createImageMarkdown(data: Data("png-data".utf8), mimeType: "image/png", fileName: "snapshot.png")
        let markdown = await [first, second].compactMap { $0 }

        XCTAssertEqual(markdown.count, 1)
        XCTAssertEqual(markdown.first, "![snapshot](../_attachments/snapshot.png)")
        XCTAssertEqual(client.createKnowledgeImageAssetCount, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testKnowledgeNoteRenameIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.renameKnowledgeEntryDelayNanoseconds = 150_000_000
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        async let first = model.rename(to: "ios-renamed")
        async let second = model.rename(to: "ios-renamed")
        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(client.renameKnowledgeEntryCount, 1)
        XCTAssertEqual(model.fileId, "notes/ios-renamed.md")
        XCTAssertNil(model.errorMessage)
    }

    func testKnowledgeNoteDeleteIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.deleteKnowledgeEntryDelayNanoseconds = 150_000_000
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        async let first = model.delete()
        async let second = model.delete()
        let results = await [first, second]
        let listing = try await client.listKnowledgeEntries(directoryId: "notes")

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(client.deleteKnowledgeEntryCount, 1)
        XCTAssertFalse(listing.entries.contains(where: { $0.id == "notes/ios-companion.md" }))
        XCTAssertNil(model.errorMessage)
    }

    func testKnowledgeHelpersParseHeadingsLinksAndRelativePaths() {
        let text = """
        ---
        title: Release note
        ---

        # Release checklist
        
        Some prose with a [[ios companion]] link.

        ## Ship it
        """

        XCTAssertEqual(knowledgePrimaryHeading(in: text), "Release checklist")
        XCTAssertEqual(knowledgeOutlineHeadings(in: text).map(\.title), ["Release checklist", "Ship it"])
        XCTAssertEqual(knowledgeFindRanges(of: "ship", in: text).count, 1)

        let wikiContext = knowledgeCurrentWikiLinkContext(in: "Start [[ios com", selectedRange: NSRange(location: 15, length: 0))
        XCTAssertEqual(wikiContext?.query, "ios com")
        XCTAssertEqual(knowledgeRelativePath(from: "notes/mobile/ios.md", to: "_attachments/snapshot.png"), "../../_attachments/snapshot.png")
    }

    func testKnowledgeSmartReturnContinuesMarkdownLists() {
        let checklistMutation = knowledgeSmartReturnMutation(text: "- [ ] Ship it", selectedRange: NSRange(location: 13, length: 0))
        XCTAssertEqual(checklistMutation?.text, "- [ ] Ship it\n- [ ] ")

        let orderedMutation = knowledgeSmartReturnMutation(text: "1. First", selectedRange: NSRange(location: 8, length: 0))
        XCTAssertEqual(orderedMutation?.text, "1. First\n2. ")
    }

    func testKnowledgeChecklistToggleHandlesUppercaseCheckedMarkers() {
        let mutation = knowledgeToggleChecklistMutation(text: "- [X] Ship it", selectedRange: NSRange(location: 3, length: 0))

        XCTAssertEqual(mutation?.text, "- [ ] Ship it")
    }

    func testKnowledgeNoteAutosavesAfterIdle() async throws {
        let client = MockCompanionClient()
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let draftStore = KnowledgeDraftStore(baseURL: tempDraftRoot)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: draftStore)

        model.load()
        try await Task.sleep(for: .milliseconds(100))

        model.draft = "# Autosaved\n"
        try await Task.sleep(for: .milliseconds(1800))

        let saved = try await client.readKnowledgeFile(fileId: "notes/ios-companion.md")
        XCTAssertEqual(saved.content, "# Autosaved\n")
        XCTAssertNil(draftStore.load(fileId: "notes/ios-companion.md"))
    }

    func testKnowledgeNotePreservesNewerDraftEditedDuringSave() async throws {
        let client = MockCompanionClient()
        client.writeKnowledgeFileDelayNanoseconds = 150_000_000
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let draftStore = KnowledgeDraftStore(baseURL: tempDraftRoot)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: draftStore)

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading && !model.content.isEmpty
        }

        model.draft = "# First save\n"
        let saveTask = Task { await model.save() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.isSaving
        }
        model.draft = "# Newer local edit\n"

        let saveSucceeded = await saveTask.value
        XCTAssertTrue(saveSucceeded)
        let saved = try await client.readKnowledgeFile(fileId: "notes/ios-companion.md")
        XCTAssertEqual(saved.content, "# First save\n")
        XCTAssertEqual(model.content, "# First save\n")
        XCTAssertEqual(model.draft, "# Newer local edit\n")
        XCTAssertTrue(model.isDirty)
        XCTAssertEqual(draftStore.load(fileId: "notes/ios-companion.md")?.draft, "# Newer local edit\n")
    }

    func testStoppingKnowledgeNoteCancelsPendingLoad() async throws {
        let client = MockCompanionClient()
        client.readKnowledgeFileDelayNanoseconds = 150_000_000
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.stop()
        XCTAssertFalse(model.isLoading)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(model.content.isEmpty)
        XCTAssertTrue(model.draft.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testOlderKnowledgeNoteLoadDoesNotClearLoadingForNewerLoad() async throws {
        let client = MockCompanionClient()
        client.readKnowledgeFileDelayQueueNanoseconds = [120_000_000, 180_000_000]
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.load()

        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(model.isLoading)

        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }
        XCTAssertTrue(model.content.contains("# iOS companion"))
        XCTAssertNil(model.errorMessage)
    }

    func testStoppingKnowledgeDirectoryCancelsPendingLoad() async throws {
        let client = MockCompanionClient()
        client.listKnowledgeEntriesDelayNanoseconds = 150_000_000
        let model = KnowledgeDirectoryViewModel(client: client, directoryId: nil)

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.stop()
        XCTAssertFalse(model.isLoading)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertTrue(model.rootPath.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testOlderKnowledgeDirectoryLoadDoesNotClearLoadingForNewerLoad() async throws {
        let client = MockCompanionClient()
        client.listKnowledgeEntriesDelayQueueNanoseconds = [120_000_000, 180_000_000]
        let model = KnowledgeDirectoryViewModel(client: client, directoryId: nil)

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.load()

        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(model.isLoading)

        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }
        XCTAssertFalse(model.entries.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testStoppingKnowledgeFolderPickerCancelsPendingLoad() async throws {
        let client = MockCompanionClient()
        client.listKnowledgeEntriesDelayNanoseconds = 150_000_000
        let model = KnowledgeFolderPickerViewModel(client: client, directoryId: nil, excludedFolderId: nil)

        model.load()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isLoading
        }
        model.stop()
        XCTAssertFalse(model.isLoading)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(model.folders.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testKnowledgeNoteDetectsHostConflictsBeforeOverwrite() async throws {
        let client = MockCompanionClient()
        let tempDraftRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let model = KnowledgeNoteViewModel(client: client, fileId: "notes/ios-companion.md", draftStore: KnowledgeDraftStore(baseURL: tempDraftRoot))

        model.load()
        try await Task.sleep(for: .milliseconds(100))

        model.draft = "# Local edit\n"
        _ = try await client.writeKnowledgeFile(fileId: "notes/ios-companion.md", content: "# Remote edit\n")

        let saved = await model.save()
        XCTAssertFalse(saved)
        XCTAssertEqual(model.conflict?.remoteContent, "# Remote edit\n")
    }

    func testMockSimulationStartsRunningConversationAndStopsOnAbort() async throws {
        let client = MockCompanionClient()
        let created = try await client.createConversation(NewConversationRequest(), surfaceId: "ios-test")
        let conversationId = created.bootstrap.conversationId

        try await client.simulateRunningConversation(conversationId: conversationId)
        let running = try await client.conversationBootstrap(conversationId: conversationId)
        XCTAssertEqual(running.bootstrap.liveSession.isStreaming, true)
        XCTAssertTrue(running.bootstrap.sessionDetail?.blocks.contains(where: { $0.type == "tool_use" }) == true)

        try await client.abortConversation(conversationId: conversationId)
        let stopped = try await client.conversationBootstrap(conversationId: conversationId)
        XCTAssertEqual(stopped.bootstrap.liveSession.isStreaming, false)
        XCTAssertTrue(stopped.bootstrap.sessionDetail?.blocks.contains(where: { $0.title == "Simulation stopped" }) == true)
    }

    func testStartRunningConversationSimulationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.simulateRunningConversationFailureQueueMessages = ["Simulation temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.startRunningConversationSimulation()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.startRunningConversationSimulation()
        try await waitForCondition(timeout: .seconds(2)) {
            client.simulateRunningConversationCount == 2
        }
        XCTAssertNil(model.errorMessage)
    }

    func testAbortConversationIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.abortConversationDelayNanoseconds = 150_000_000
        try await client.simulateRunningConversation(conversationId: "conv-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.abort()
        model.abort()
        try await Task.sleep(nanoseconds: 220_000_000)
        let stopped = try await client.conversationBootstrap(conversationId: "conv-1")

        XCTAssertEqual(client.abortConversationCount, 1)
        XCTAssertEqual(stopped.bootstrap.liveSession.isStreaming, false)
        XCTAssertNil(model.errorMessage)
    }

    func testAbortClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.abortConversationFailureQueueMessages = ["Abort temporarily unavailable."]
        try await client.simulateRunningConversation(conversationId: "conv-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.abort()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.abort()
        try await waitForCondition(timeout: .seconds(2)) {
            client.abortConversationCount == 2
        }
        XCTAssertNil(model.errorMessage)
    }

    func testTakeOverIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.takeOverConversationDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.takeOver()
        model.takeOver()
        try await Task.sleep(nanoseconds: 220_000_000)

        XCTAssertEqual(client.takeOverConversationCount, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testTakeOverClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.takeOverConversationFailureQueueMessages = ["Take over temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.takeOver()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.takeOver()
        try await waitForCondition(timeout: .seconds(2)) {
            client.takeOverConversationCount == 2
        }
        XCTAssertNil(model.errorMessage)
    }

    func testConversationDuplicateClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.duplicateConversationFailureQueueMessages = ["Conversation duplicate temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedDuplicateId = await model.duplicateConversation()
        XCTAssertNil(failedDuplicateId)
        XCTAssertNotNil(model.errorMessage)

        let duplicateId = await model.duplicateConversation()
        XCTAssertNotNil(duplicateId)
        XCTAssertNil(model.errorMessage)
    }

    func testChangeWorkingDirectoryIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.changeConversationCwdDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        async let first = model.changeWorkingDirectory("/tmp/one")
        async let second = model.changeWorkingDirectory("/tmp/one")
        _ = await (first, second)

        XCTAssertEqual(client.changeConversationCwdCount, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testChangeWorkingDirectoryClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.changeConversationCwdFailureQueueMessages = ["Working directory change temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failed = await model.changeWorkingDirectory("/tmp/one")
        XCTAssertNil(failed)
        XCTAssertNotNil(model.errorMessage)

        let changed = await model.changeWorkingDirectory("/tmp/one")
        XCTAssertEqual(changed?.cwd, "/tmp/one")
        XCTAssertNil(model.errorMessage)
    }

    func testConversationRemoteDirectoryClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readRemoteDirectoryFailureQueueMessages = ["Remote directory temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedListing = await model.readRemoteDirectory(targetId: "local", path: "/home/user/workspace")
        XCTAssertNil(failedListing)
        XCTAssertNotNil(model.errorMessage)

        let listing = await model.readRemoteDirectory(targetId: "local", path: "/home/user/workspace")
        XCTAssertEqual(listing?.entries.first?.name, "personal-agent")
        XCTAssertNil(model.errorMessage)
    }

    func testSaveAutoModeIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.updateConversationAutoModeDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        async let first = model.saveAutoMode(enabled: true)
        async let second = model.saveAutoMode(enabled: true)
        let results = await [first, second]

        XCTAssertEqual(client.updateConversationAutoModeCount, 1)
        XCTAssertEqual(results.compactMap { $0 }.count, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testSaveAutoModeClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.updateConversationAutoModeFailureQueueMessages = ["Auto mode update temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failed = await model.saveAutoMode(enabled: true)
        XCTAssertNil(failed)
        XCTAssertNotNil(model.errorMessage)

        let saved = await model.saveAutoMode(enabled: true)
        XCTAssertEqual(saved?.enabled, true)
        XCTAssertNil(model.errorMessage)
    }

    func testLoadAutoModeClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readConversationAutoModeFailureQueueMessages = ["Auto mode state temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failed = await model.loadAutoModeState()
        XCTAssertNil(failed)
        XCTAssertNotNil(model.errorMessage)

        let loaded = await model.loadAutoModeState()
        XCTAssertEqual(loaded?.enabled, false)
        XCTAssertNil(model.errorMessage)
    }

    func testQueuedPromptModesWorkDuringMockSimulation() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.startRunningConversationSimulation()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isStreaming
        }

        model.promptText = "Stay focused on revoked-device handling"
        model.sendPrompt(mode: .steer)
        try await waitForCondition(timeout: .seconds(2)) {
            !model.queuedSteeringPrompts.isEmpty
        }

        model.promptText = "Summarize the server diff after this turn"
        model.sendPrompt(mode: .followUp)
        try await waitForCondition(timeout: .seconds(2)) {
            !model.queuedFollowUpPrompts.isEmpty
        }

        model.promptText = "Investigate the build failure in parallel"
        model.sendPrompt(mode: .parallel)
        try await waitForCondition(timeout: .seconds(2)) {
            !model.parallelJobs.isEmpty
        }
    }

    func testParallelJobActionIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.manageParallelJobDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Investigate this in parallel"
        model.sendPrompt(mode: .parallel)
        try await waitForCondition(timeout: .seconds(2)) {
            model.parallelJobs.count == 1
        }

        let job = try XCTUnwrap(model.parallelJobs.first)
        model.manageParallelJob(job.id, action: "cancel")
        model.manageParallelJob(job.id, action: "cancel")
        try await waitForCondition(timeout: .seconds(2)) {
            model.parallelJobs.isEmpty
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNil(model.errorMessage)
    }

    func testParallelJobActionClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Investigate this in parallel"
        model.sendPrompt(mode: .parallel)
        try await waitForCondition(timeout: .seconds(2)) {
            model.parallelJobs.count == 1
        }

        client.manageParallelJobFailureQueueMessages = ["Parallel prompt action temporarily unavailable."]
        let job = try XCTUnwrap(model.parallelJobs.first)
        model.manageParallelJob(job.id, action: "cancel")
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }
        XCTAssertEqual(model.parallelJobs.count, 1)

        model.manageParallelJob(job.id, action: "cancel")
        try await waitForCondition(timeout: .seconds(2)) {
            model.parallelJobs.isEmpty
        }
        XCTAssertNil(model.errorMessage)
    }

    func testPromptSendSubscribesBeforeSubmittingWhenLiveStreamIsStillConnecting() async throws {
        let client = MockCompanionClient()
        client.subscribeConversationEventsDelayNanoseconds = 1_000_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Stream this immediately"
        model.sendPrompt()

        try await waitForCondition(timeout: .seconds(4)) {
            model.blocks.contains { $0.type == "user" && $0.text == "Stream this immediately" }
        }
        XCTAssertGreaterThanOrEqual(client.conversationSubscriptionCount, 1)
        XCTAssertTrue(model.promptText.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testPromptSendIgnoresDuplicateTapWhileSubmissionIsPending() async throws {
        let client = MockCompanionClient()
        client.promptSubmissionDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Only send this once"
        model.sendPrompt()
        model.sendPrompt()

        try await waitForCondition(timeout: .seconds(3)) {
            !model.isSubmittingPrompt && client.promptSubmissionCount > 0
        }
        XCTAssertEqual(client.promptSubmissionCount, 1)
        XCTAssertEqual(model.blocks.filter { $0.type == "user" && $0.text == "Only send this once" }.count, 1)
        XCTAssertTrue(model.promptText.isEmpty)
    }

    func testPromptSendWaitsForConversationSubscriptionBeforeSubmitting() async throws {
        let client = MockCompanionClient()
        client.subscribeConversationEventsDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Stream this immediately"
        model.sendPrompt()

        try await waitForCondition(timeout: .seconds(2)) {
            model.blocks.contains(where: { $0.type == "user" && $0.text == "Stream this immediately" })
                && model.blocks.contains(where: { $0.type == "text" && ($0.text ?? "").contains("Native companion prompt accepted") })
        }
        XCTAssertEqual(client.promptSubmissionCount, 1)
        XCTAssertGreaterThanOrEqual(client.conversationSubscriptionCount, 1)
    }

    func testPromptSendPreservesNewComposerTextEditedDuringSubmission() async throws {
        let client = MockCompanionClient()
        client.promptSubmissionDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Send the first prompt"
        model.sendPrompt()
        try await waitForCondition(timeout: .seconds(2)) {
            model.isSubmittingPrompt
        }
        model.promptText = "Keep this newer draft"

        try await waitForCondition(timeout: .seconds(2)) {
            !model.isSubmittingPrompt
        }

        XCTAssertEqual(client.promptSubmissionCount, 1)
        XCTAssertTrue(model.blocks.contains(where: { $0.type == "user" && $0.text == "Send the first prompt" }))
        XCTAssertEqual(model.promptText, "Keep this newer draft")
    }

    func testPromptSendClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.promptSubmissionFailureQueueMessages = ["Prompt send temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Send after retry"
        model.sendPrompt()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }
        XCTAssertEqual(model.promptText, "Send after retry")

        model.sendPrompt()
        try await waitForCondition(timeout: .seconds(2)) {
            model.blocks.contains(where: { $0.type == "user" && $0.text == "Send after retry" })
        }
        XCTAssertTrue(model.promptText.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testQueuedPromptRestorePrefillsComposer() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Queue this for later"
        model.sendPrompt(mode: .followUp)
        try await waitForCondition(timeout: .seconds(2)) {
            model.queuedFollowUpPrompts.count == 1
        }

        let preview = try XCTUnwrap(model.queuedFollowUpPrompts.first)
        model.restoreQueuedPrompt(behavior: "followUp", index: 0, previewId: preview.id)
        try await waitForCondition(timeout: .seconds(2)) {
            model.promptText.contains("Queue this for later")
        }
    }

    func testQueuedPromptRestoreIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.restoreQueuedPromptDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Queue this once"
        model.sendPrompt(mode: .followUp)
        try await waitForCondition(timeout: .seconds(2)) {
            model.queuedFollowUpPrompts.count == 1
        }

        let preview = try XCTUnwrap(model.queuedFollowUpPrompts.first)
        model.restoreQueuedPrompt(behavior: "followUp", index: 0, previewId: preview.id)
        model.restoreQueuedPrompt(behavior: "followUp", index: 0, previewId: preview.id)
        try await waitForCondition(timeout: .seconds(2)) {
            model.promptText == "Queue this once"
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.promptText.components(separatedBy: "Queue this once").count - 1, 1)
    }

    func testQueuedPromptRestoreClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            !model.blocks.isEmpty
        }

        model.promptText = "Restore after retry"
        model.sendPrompt(mode: .followUp)
        try await waitForCondition(timeout: .seconds(2)) {
            model.queuedFollowUpPrompts.count == 1
        }

        client.restoreQueuedPromptFailureQueueMessages = ["Queued prompt restore temporarily unavailable."]
        let preview = try XCTUnwrap(model.queuedFollowUpPrompts.first)
        model.restoreQueuedPrompt(behavior: "followUp", index: 0, previewId: preview.id)
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }
        XCTAssertFalse(model.promptText.contains("Restore after retry"))

        model.restoreQueuedPrompt(behavior: "followUp", index: 0, previewId: preview.id)
        try await waitForCondition(timeout: .seconds(2)) {
            model.promptText.contains("Restore after retry")
        }
        XCTAssertNil(model.errorMessage)
    }

    func testHostSessionLoadsModelCatalogAndSshTargets() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await waitForCondition(timeout: .seconds(2)) {
            session.modelState != nil && !session.sshTargets.isEmpty
        }

        XCTAssertTrue(session.modelState?.models.contains(where: { $0.id == "gpt-5.4" }) == true)
        XCTAssertEqual(session.sshTargets.first?.label, "Buildbox")
    }

    func testListSshTargetsClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listSshTargetsFailureQueueMessages = ["SSH target list temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedTargets = await session.listSshTargets()
        XCTAssertTrue(failedTargets.isEmpty)
        XCTAssertNotNil(session.errorMessage)

        let targets = await session.listSshTargets()
        XCTAssertEqual(targets.first?.label, "Buildbox")
        XCTAssertNil(session.errorMessage)
    }

    func testTestSshTargetClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.testSshTargetFailureQueueMessages = ["SSH probe temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedResult = await session.testSshTarget("user@buildbox")
        XCTAssertNil(failedResult)
        XCTAssertNotNil(session.errorMessage)

        let result = await session.testSshTarget("user@buildbox")
        XCTAssertEqual(result?.sshTarget, "user@buildbox")
        XCTAssertNil(session.errorMessage)
    }

    func testReadRemoteDirectoryClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readRemoteDirectoryFailureQueueMessages = ["Remote directory temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedListing = await session.readRemoteDirectory(targetId: "local", path: "/home/user/workspace")
        XCTAssertNil(failedListing)
        XCTAssertNotNil(session.errorMessage)

        let listing = await session.readRemoteDirectory(targetId: "local", path: "/home/user/workspace")
        XCTAssertEqual(listing?.entries.first?.name, "personal-agent")
        XCTAssertNil(session.errorMessage)
    }

    func testSaveSshTargetIgnoresDuplicateCreateWhilePending() async throws {
        let client = MockCompanionClient()
        client.saveSshTargetDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialTargets = await session.listSshTargets()

        async let first = session.saveSshTarget(id: nil, label: "Staging box", sshTarget: "agent@staging")
        async let second = session.saveSshTarget(id: nil, label: "Staging box", sshTarget: "agent@staging")
        let results = await [first, second]
        let targets = await session.listSshTargets()

        XCTAssertEqual(results.filter { $0.contains { $0.label == "Staging box" } }.count, 1)
        XCTAssertEqual(client.saveSshTargetCount, 1)
        XCTAssertEqual(targets.filter { $0.label == "Staging box" && $0.sshTarget == "agent@staging" }.count, 1)
        XCTAssertEqual(targets.count, initialTargets.count + 1)
        XCTAssertNil(session.errorMessage)
    }

    func testSaveSshTargetClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.saveSshTargetFailureQueueMessages = ["SSH target save temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedTargets = await session.saveSshTarget(id: nil, label: "Retry box", sshTarget: "agent@retry")
        XCTAssertFalse(failedTargets.contains { $0.label == "Retry box" })
        XCTAssertNotNil(session.errorMessage)

        let targets = await session.saveSshTarget(id: nil, label: "Retry box", sshTarget: "agent@retry")
        XCTAssertTrue(targets.contains { $0.label == "Retry box" && $0.sshTarget == "agent@retry" })
        XCTAssertNil(session.errorMessage)
    }

    func testDeleteSshTargetIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.deleteSshTargetDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialTargets = await session.listSshTargets()
        let targetId = try XCTUnwrap(initialTargets.first?.id)

        async let first = session.deleteSshTarget(targetId)
        async let second = session.deleteSshTarget(targetId)
        let results = await [first, second]
        let targets = await session.listSshTargets()

        XCTAssertEqual(results.filter { !$0.contains { $0.id == targetId } }.count, 1)
        XCTAssertEqual(client.deleteSshTargetCount, 1)
        XCTAssertFalse(targets.contains { $0.id == targetId })
        XCTAssertNil(session.errorMessage)
    }

    func testDeleteSshTargetClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.deleteSshTargetFailureQueueMessages = ["SSH target delete temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialTargets = await session.listSshTargets()
        let targetId = try XCTUnwrap(initialTargets.first?.id)

        let failedTargets = await session.deleteSshTarget(targetId)
        XCTAssertTrue(failedTargets.contains { $0.id == targetId })
        XCTAssertNotNil(session.errorMessage)

        let targets = await session.deleteSshTarget(targetId)
        XCTAssertFalse(targets.contains { $0.id == targetId })
        XCTAssertNil(session.errorMessage)
    }

    func testStaleModelRefreshDoesNotOverwriteSavedPreference() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        client.readModelsDelayNanoseconds = 150_000_000
        model.refreshModelState()
        try await Task.sleep(nanoseconds: 30_000_000)

        let saved = await model.saveModelPreferences(model: "gpt-5.5", thinkingLevel: "high", serviceTier: "priority")
        XCTAssertEqual(saved?.currentModel, "gpt-5.5")

        try await waitForCondition(timeout: .seconds(2)) {
            model.modelState?.currentModel == "gpt-5.5"
        }
        try await Task.sleep(nanoseconds: 180_000_000)
        XCTAssertEqual(model.modelState?.currentModel, "gpt-5.5")
        XCTAssertNil(model.errorMessage)
    }

    func testModelRefreshClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readModelsFailureQueueMessages = ["Models temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.refreshModelState()
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.refreshModelState()
        try await waitForCondition(timeout: .seconds(2)) {
            model.modelState?.currentModel == "gpt-5.4"
        }
        XCTAssertNil(model.errorMessage)
    }

    func testStaleModelPreferenceSaveDoesNotOverrideLatestModel() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.loadBootstrap()
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.model == "gpt-5.4"
        }

        client.updateConversationModelPreferencesDelayQueueNanoseconds = [150_000_000, 0]
        let slowSave = Task {
            await model.saveModelPreferences(model: "old-slow-model", thinkingLevel: nil, serviceTier: nil)
        }
        try await Task.sleep(nanoseconds: 30_000_000)
        _ = await model.saveModelPreferences(model: "new-fast-model", thinkingLevel: nil, serviceTier: nil)
        _ = await slowSave.value

        XCTAssertEqual(model.sessionMeta?.model, "new-fast-model")
    }

    func testSaveModelPreferencesClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.updateConversationModelPreferencesFailureQueueMessages = ["Model preferences temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failed = await model.saveModelPreferences(model: "gpt-5.5", thinkingLevel: "high", serviceTier: "priority")
        XCTAssertNil(failed)
        XCTAssertNotNil(model.errorMessage)

        let saved = await model.saveModelPreferences(model: "gpt-5.5", thinkingLevel: "high", serviceTier: "priority")
        XCTAssertEqual(saved?.currentModel, "gpt-5.5")
        XCTAssertEqual(saved?.currentThinkingLevel, "high")
        XCTAssertEqual(saved?.currentServiceTier, "priority")
        XCTAssertNil(model.errorMessage)
    }

    func testLoadModelPreferencesClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readConversationModelPreferencesFailureQueueMessages = ["Model preferences temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failed = await model.loadModelPreferences()
        XCTAssertNil(failed)
        XCTAssertNotNil(model.errorMessage)

        let loaded = await model.loadModelPreferences()
        XCTAssertEqual(loaded?.currentModel, "gpt-5.4")
        XCTAssertNil(model.errorMessage)
    }

    func testParallelPromptCreatesChildConversationInMockClient() async throws {
        let client = MockCompanionClient()
        let created = try await client.createConversation(NewConversationRequest(), surfaceId: "ios-test")
        let conversationId = created.bootstrap.conversationId

        try await client.promptConversation(
            conversationId: conversationId,
            text: "Investigate the build failure",
            images: [],
            attachmentRefs: [],
            mode: .parallel,
            surfaceId: "ios-test"
        )

        let list = try await client.listConversations()
        XCTAssertTrue(list.sessions.contains(where: {
            $0.parentSessionId == conversationId && $0.title == "Parallel: Investigate the build failure"
        }))
    }

    func testDuplicateConversationIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.duplicateConversationDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        async let first = session.duplicateConversation("conv-1")
        async let second = session.duplicateConversation("conv-1")
        let duplicateIds = await [first, second].compactMap { $0 }
        let list = try await client.listConversations()

        XCTAssertEqual(duplicateIds.count, 1)
        XCTAssertEqual(client.duplicateConversationCount, 1)
        XCTAssertEqual(list.sessions.filter { $0.id == duplicateIds[0] }.count, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testDuplicateConversationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.duplicateConversationFailureQueueMessages = ["Conversation duplicate temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedDuplicateId = await session.duplicateConversation("conv-1")
        XCTAssertNil(failedDuplicateId)
        XCTAssertNotNil(session.errorMessage)

        let duplicateId = await session.duplicateConversation("conv-1")
        XCTAssertNotNil(duplicateId)
        XCTAssertNil(session.errorMessage)
    }

    func testPinnedConversationIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.updateConversationTabsDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        async let first: Void = session.togglePinned("conv-1")
        async let second: Void = session.togglePinned("conv-1")
        _ = await (first, second)
        let list = try await client.listConversations()

        XCTAssertEqual(client.updateConversationTabsCount, 1)
        XCTAssertEqual(list.ordering.pinnedSessionIds.filter { $0 == "conv-1" }.count, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testPinnedConversationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.updateConversationTabsFailureQueueMessages = ["Conversation pin temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        await session.togglePinned("conv-1")
        XCTAssertNotNil(session.errorMessage)

        await session.togglePinned("conv-1")
        let list = try await client.listConversations()
        XCTAssertTrue(list.ordering.pinnedSessionIds.contains("conv-1"))
        XCTAssertNil(session.errorMessage)
    }

    func testResumeConversationIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createConversationDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let request = ResumeConversationRequest(sessionFile: "/tmp/session.jsonl", cwd: "/tmp", executionTargetId: "local")

        async let first = session.resumeConversation(request)
        async let second = session.resumeConversation(request)
        let conversationIds = await [first, second].compactMap { $0 }
        let list = try await client.listConversations()

        XCTAssertEqual(conversationIds.count, 1)
        XCTAssertEqual(client.createConversationCount, 1)
        XCTAssertEqual(list.sessions.filter { $0.id == conversationIds[0] }.count, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testResumeConversationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createConversationFailureQueueMessages = ["Conversation resume temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let request = ResumeConversationRequest(sessionFile: "/tmp/session.jsonl", cwd: "/tmp", executionTargetId: "local")

        let failedConversationId = await session.resumeConversation(request)
        XCTAssertNil(failedConversationId)
        XCTAssertNotNil(session.errorMessage)

        let conversationId = await session.resumeConversation(request)
        XCTAssertNotNil(conversationId)
        XCTAssertNil(session.errorMessage)
    }

    func testMockDuplicateConversationCopiesTranscript() async throws {
        let client = MockCompanionClient()
        let source = try await client.conversationBootstrap(conversationId: "conv-1")
        let duplicateId = try await client.duplicateConversation(conversationId: "conv-1")
        let duplicate = try await client.conversationBootstrap(conversationId: duplicateId)

        XCTAssertNotEqual(duplicateId, "conv-1")
        XCTAssertEqual(duplicate.sessionMeta?.cwd, source.sessionMeta?.cwd)
        XCTAssertEqual(duplicate.bootstrap.sessionDetail?.blocks.map(\.type), source.bootstrap.sessionDetail?.blocks.map(\.type))
        XCTAssertEqual(duplicate.bootstrap.sessionDetail?.blocks.map(\.text), source.bootstrap.sessionDetail?.blocks.map(\.text))
    }

    func testMockDuplicateConversationRehomesAttachments() async throws {
        let client = MockCompanionClient()
        let duplicateId = try await client.duplicateConversation(conversationId: "conv-1")
        let attachments = try await client.listAttachments(conversationId: duplicateId)

        XCTAssertEqual(attachments.conversationId, duplicateId)
        XCTAssertFalse(attachments.attachments.isEmpty)
        XCTAssertEqual(attachments.attachments.map(\.conversationId), Array(repeating: duplicateId, count: attachments.attachments.count))

        let detail = try await client.readAttachment(conversationId: duplicateId, attachmentId: attachments.attachments[0].id)
        XCTAssertEqual(detail.conversationId, duplicateId)
        XCTAssertEqual(detail.attachment.conversationId, duplicateId)
    }

    func testMockDuplicateConversationRehomesArtifacts() async throws {
        let client = MockCompanionClient()
        let duplicateId = try await client.duplicateConversation(conversationId: "conv-1")
        let artifacts = try await client.listConversationArtifacts(conversationId: duplicateId)

        XCTAssertFalse(artifacts.isEmpty)
        XCTAssertEqual(artifacts.map(\.conversationId), Array(repeating: duplicateId, count: artifacts.count))

        let artifact = try await client.readConversationArtifact(conversationId: duplicateId, artifactId: artifacts[0].id)
        XCTAssertEqual(artifact.conversationId, duplicateId)
    }

    func testAttachmentEditingDraftDownloadsSourceAndPreview() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let loadedRecord = await model.loadAttachment("att-1")
        let record = try XCTUnwrap(loadedRecord)
        let loadedDraft = await model.buildDraftForEditing(record)
        let draft = try XCTUnwrap(loadedDraft)

        XCTAssertEqual(draft.title, "Whiteboard")
        XCTAssertEqual(draft.sourceAsset?.mimeType, "application/vnd.excalidraw+json")
        XCTAssertEqual(draft.previewAsset?.mimeType, "image/png")
    }

    func testBuildAttachmentEditingDraftClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.downloadAttachmentAssetFailureQueueMessages = ["Attachment asset temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )
        let loadedRecord = await model.loadAttachment("att-1")
        let record = try XCTUnwrap(loadedRecord)

        let failedDraft = await model.buildDraftForEditing(record)
        XCTAssertNil(failedDraft)
        XCTAssertNotNil(model.errorMessage)

        let draft = await model.buildDraftForEditing(record)
        XCTAssertEqual(draft?.title, "Whiteboard")
        XCTAssertNil(model.errorMessage)
    }

    func testLoadAttachmentClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readAttachmentFailureQueueMessages = ["Attachment read temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedAttachment = await model.loadAttachment("att-1")
        XCTAssertNil(failedAttachment)
        XCTAssertNotNil(model.errorMessage)

        let attachment = await model.loadAttachment("att-1")
        XCTAssertEqual(attachment?.title, "Whiteboard")
        XCTAssertNil(model.errorMessage)
    }

    func testDownloadAttachmentAssetClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.downloadAttachmentAssetFailureQueueMessages = ["Attachment asset temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedAsset = await model.downloadAttachmentAsset(attachmentId: "att-1", asset: "preview", revision: 1)
        XCTAssertNil(failedAsset)
        XCTAssertNotNil(model.errorMessage)

        let asset = await model.downloadAttachmentAsset(attachmentId: "att-1", asset: "preview", revision: 1)
        XCTAssertEqual(asset?.mimeType, "image/png")
        XCTAssertNil(model.errorMessage)
    }

    func testHostSessionCanArchiveRestoreAndPinConversations() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        await session.toggleArchived("conv-2")
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(session.chatSections.map(\.id), ["pinned"])
        XCTAssertEqual(session.archivedSessions.map(\.id), ["conv-2"])

        await session.restoreConversation("conv-2")
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(session.archivedSessions.isEmpty)
        XCTAssertTrue(session.chatSections.contains(where: { $0.id == "open" && $0.sessions.contains(where: { $0.id == "conv-2" }) }))

        await session.toggleArchived("conv-2")
        try await Task.sleep(for: .milliseconds(50))
        await session.togglePinned("conv-2")
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(session.archivedSessions.isEmpty)
        XCTAssertTrue(session.chatSections.contains(where: { $0.id == "pinned" && $0.sessions.contains(where: { $0.id == "conv-2" }) }))
    }

    func testHostSessionCanCreateConversation() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await waitForCondition(timeout: .seconds(2)) {
            !session.chatSections.isEmpty
        }

        let createdConversationId = await session.createConversation(NewConversationRequest(cwd: "/tmp/ios-create"))
        let createdId = try XCTUnwrap(createdConversationId)

        try await waitForCondition(timeout: .seconds(2)) {
            session.chatSections
                .flatMap(\.sessions)
                .contains(where: { $0.id == createdId })
        }

        XCTAssertEqual(session.sessions[createdId]?.cwd, "/tmp/ios-create")
        XCTAssertNil(session.errorMessage)
    }

    func testHostSessionCreateConversationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createConversationFailureQueueMessages = ["Conversation create temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedConversationId = await session.createConversation(NewConversationRequest(cwd: "/tmp/ios-create"))
        XCTAssertNil(failedConversationId)
        XCTAssertNotNil(session.errorMessage)

        let createdConversationId = await session.createConversation(NewConversationRequest(cwd: "/tmp/ios-create"))
        XCTAssertNotNil(createdConversationId)
        XCTAssertNil(session.errorMessage)
    }

    func testHostSessionCreateConversationIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createConversationDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let request = NewConversationRequest(promptText: "Create this conversation once", cwd: "/tmp/ios-create")
        async let first = session.createConversation(request)
        async let second = session.createConversation(request)
        let createdIds = await [first, second].compactMap { $0 }

        XCTAssertEqual(createdIds.count, 1)
        XCTAssertEqual(client.createConversationCount, 1)
        XCTAssertEqual(session.sessions.values.filter { $0.title == "Create this conversation once" }.count, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testStaleHostRefreshDoesNotOverwriteAppEventConversationList() async throws {
        let client = MockCompanionClient()
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        session.start()
        defer { session.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            session.sessions.keys.contains("conv-1")
        }

        client.listConversationsDelayNanoseconds = 150_000_000
        session.refresh()
        try await Task.sleep(nanoseconds: 30_000_000)
        let created = try await client.createConversation(
            NewConversationRequest(promptText: "Created while refresh is stale"),
            surfaceId: "ios-test"
        )

        try await waitForCondition(timeout: .seconds(2)) {
            !session.isLoading
        }
        XCTAssertTrue(session.sessions.keys.contains(created.bootstrap.conversationId))
    }

    func testOlderHostRefreshDoesNotClearLoadingForNewerRefresh() async throws {
        let client = MockCompanionClient()
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        client.listConversationsDelayQueueNanoseconds = [50_000_000, 150_000_000]

        session.refresh()
        try await Task.sleep(nanoseconds: 10_000_000)
        session.refresh()
        try await Task.sleep(nanoseconds: 80_000_000)

        XCTAssertTrue(session.isLoading)
        try await waitForCondition(timeout: .seconds(2)) {
            !session.isLoading
        }
    }

    func testStoppingHostSessionCancelsPendingRefresh() async throws {
        let client = MockCompanionClient()
        client.listConversationsDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        session.refresh()
        try await waitForCondition(timeout: .seconds(2)) {
            session.isLoading
        }
        session.stop()
        XCTAssertFalse(session.isLoading)

        try await Task.sleep(nanoseconds: 220_000_000)
        XCTAssertTrue(session.sessions.isEmpty)
        XCTAssertTrue(session.sections.isEmpty)
        XCTAssertNil(session.errorMessage)
    }

    func testCreatedConversationOpensWithReturnedBootstrapImmediately() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        let createdConversationId = await session.createConversation(NewConversationRequest(promptText: "Start from the returned bootstrap", cwd: "/tmp/ios-create"))
        let createdId = try XCTUnwrap(createdConversationId)

        let model = session.makeConversationModel(conversationId: createdId, initialSession: session.sessions[createdId])
        model.start()
        defer { model.stop() }

        XCTAssertEqual(model.conversationId, createdId)
        XCTAssertEqual(model.sessionMeta?.cwd, "/tmp/ios-create")
        XCTAssertEqual(model.blocks.map(\.text).compactMap { $0 }, ["Start from the returned bootstrap"])
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.errorMessage)
    }

    func testConversationLoadsArtifactsAndCheckpoints() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let artifacts = await model.listArtifacts()
        let artifact = await model.readArtifact("artifact-1")
        let checkpoints = await model.listCheckpoints()
        let checkpoint = await model.readCheckpoint("abc1234")

        XCTAssertEqual(artifacts.first?.id, "artifact-1")
        XCTAssertEqual(artifact?.kind, "html")
        XCTAssertEqual(checkpoints.first?.id, "abc1234")
        XCTAssertEqual(checkpoint?.files.count, 1)
    }

    func testListArtifactsClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listConversationArtifactsFailureQueueMessages = ["Artifact list temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedArtifacts = await model.listArtifacts()
        XCTAssertTrue(failedArtifacts.isEmpty)
        XCTAssertNotNil(model.errorMessage)

        let artifacts = await model.listArtifacts()
        XCTAssertEqual(artifacts.first?.id, "artifact-1")
        XCTAssertNil(model.errorMessage)
    }

    func testReadArtifactClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readConversationArtifactFailureQueueMessages = ["Artifact read temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedArtifact = await model.readArtifact("artifact-1")
        XCTAssertNil(failedArtifact)
        XCTAssertNotNil(model.errorMessage)

        let artifact = await model.readArtifact("artifact-1")
        XCTAssertEqual(artifact?.kind, "html")
        XCTAssertNil(model.errorMessage)
    }

    func testListCheckpointsClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listConversationCheckpointsFailureQueueMessages = ["Checkpoint list temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedCheckpoints = await model.listCheckpoints()
        XCTAssertTrue(failedCheckpoints.isEmpty)
        XCTAssertNotNil(model.errorMessage)

        let checkpoints = await model.listCheckpoints()
        XCTAssertEqual(checkpoints.first?.id, "abc1234")
        XCTAssertNil(model.errorMessage)
    }

    func testReadCheckpointClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readConversationCheckpointFailureQueueMessages = ["Checkpoint read temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedCheckpoint = await model.readCheckpoint("abc1234")
        XCTAssertNil(failedCheckpoint)
        XCTAssertNotNil(model.errorMessage)

        let checkpoint = await model.readCheckpoint("abc1234")
        XCTAssertEqual(checkpoint?.subject, "Add iOS companion parity")
        XCTAssertNil(model.errorMessage)
    }

    func testCreateCheckpointAddsCheckpointRecord() async throws {
        let model = ConversationViewModel(
            client: MockCompanionClient(),
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let created = await model.createCheckpoint(message: "Save mobile parity checkpoint", paths: ["apps/ios/PersonalAgentCompanion"])
        let checkpoint = try XCTUnwrap(created)
        let checkpoints = await model.listCheckpoints()

        XCTAssertEqual(checkpoint.subject, "Save mobile parity checkpoint")
        XCTAssertTrue(checkpoints.contains(where: { $0.id == checkpoint.id }))
    }

    func testCreateCheckpointClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createConversationCheckpointFailureQueueMessages = ["Checkpoint create temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let failedCheckpoint = await model.createCheckpoint(message: "Retry checkpoint", paths: ["apps/ios/PersonalAgentCompanion"])
        XCTAssertNil(failedCheckpoint)
        XCTAssertNotNil(model.errorMessage)

        let checkpoint = await model.createCheckpoint(message: "Retry checkpoint", paths: ["apps/ios/PersonalAgentCompanion"])
        XCTAssertEqual(checkpoint?.subject, "Retry checkpoint")
        XCTAssertNil(model.errorMessage)
    }

    func testCreateCheckpointIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createConversationCheckpointDelayNanoseconds = 150_000_000
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        let initialCount = await model.listCheckpoints().count
        async let first = model.createCheckpoint(message: "Save once", paths: ["apps/ios/PersonalAgentCompanion"])
        async let second = model.createCheckpoint(message: "Save once", paths: ["apps/ios/PersonalAgentCompanion"])
        let created = await [first, second].compactMap { $0 }
        let checkpoints = await model.listCheckpoints()

        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(checkpoints.count, initialCount + 1)
        XCTAssertNil(model.errorMessage)
    }

    func testStaleActivityRunRefreshDoesNotOverwriteNewerRunList() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        client.addMockRun(runId: "run-old", sourceId: "conv-1")
        client.listRunsDelayNanoseconds = 150_000_000
        model.refreshActivityRuns()
        try await Task.sleep(nanoseconds: 30_000_000)

        client.addMockRun(runId: "run-new", sourceId: "conv-1")
        client.listRunsDelayNanoseconds = 0
        model.refreshActivityRuns()

        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.contains(where: { $0.runId == "run-new" })
        }
        try await Task.sleep(nanoseconds: 180_000_000)

        XCTAssertTrue(model.connectedRuns.contains(where: { $0.runId == "run-new" }))
    }

    func testCancelConnectedRunClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.cancelRunFailureQueueMessages = ["Run cancel temporarily unavailable."]
        client.addMockRun(runId: "run-1", sourceId: "conv-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.refreshActivityRuns()
        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.contains(where: { $0.runId == "run-1" })
        }

        model.cancelConnectedRun("run-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }
        XCTAssertTrue(model.connectedRuns.contains(where: { $0.runId == "run-1" }))

        model.cancelConnectedRun("run-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.isEmpty
        }
        XCTAssertNil(model.errorMessage)
    }

    func testStaleExecutionTargetChangeDoesNotOverrideLatestSelection() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.loadBootstrap()
        try await waitForCondition(timeout: .seconds(2)) {
            model.currentExecutionTargetId == "local"
        }

        client.changeExecutionTargetDelayQueueNanoseconds = [150_000_000, 0]
        model.changeExecutionTarget("ssh-1")
        try await Task.sleep(nanoseconds: 30_000_000)
        model.changeExecutionTarget("local")
        try await Task.sleep(nanoseconds: 220_000_000)

        XCTAssertEqual(model.currentExecutionTargetId, "local")
    }

    func testStaleConversationRenameDoesNotOverrideLatestTitle() async throws {
        let client = MockCompanionClient()
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        client.renameConversationDelayQueueNanoseconds = [150_000_000, 0]
        model.renameConversation("Old slow title")
        try await Task.sleep(nanoseconds: 30_000_000)
        model.renameConversation("New fast title")

        try await waitForCondition(timeout: .seconds(2)) {
            model.title == "New fast title"
        }
        try await Task.sleep(nanoseconds: 180_000_000)

        XCTAssertEqual(model.title, "New fast title")
    }

    func testRenamingConversationClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.renameConversationFailureQueueMessages = ["Conversation rename temporarily unavailable."]
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.renameConversation("Retry title")
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        model.renameConversation("Retry title")
        try await waitForCondition(timeout: .seconds(2)) {
            model.title == "Retry title"
        }
        XCTAssertNil(model.errorMessage)
    }

    func testRenamingConversationPreservesDeferredResumes() async throws {
        let client = MockCompanionClient()
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.renameConversation("Renamed with deferred resume")
        try await waitForCondition(timeout: .seconds(2)) {
            model.title == "Renamed with deferred resume"
        }
        model.loadBootstrap()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }

        XCTAssertEqual(model.sessionMeta?.deferredResumes?.map(\.id), ["resume-1"])
    }

    func testCancellingDeferredResumeRemovesItFromConversation() async throws {
        let client = MockCompanionClient()
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.cancelDeferredResume("resume-1")

        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.isEmpty == true
        }
        model.loadBootstrap()
        try await waitForCondition(timeout: .seconds(2)) {
            !model.isLoading
        }

        XCTAssertEqual(model.sessionMeta?.deferredResumes, [])
    }

    func testCancellingDeferredResumeIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.cancelDeferredResumeDelayNanoseconds = 150_000_000
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.cancelDeferredResume("resume-1")
        model.cancelDeferredResume("resume-1")

        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.isEmpty == true
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(client.cancelDeferredResumeCount, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testCancelDeferredResumeClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.cancelDeferredResumeFailureQueueMessages = ["Deferred resume cancel temporarily unavailable."]
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.cancelDeferredResume("resume-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        client.conversationBootstrapDelayNanoseconds = 500_000_000
        model.cancelDeferredResume("resume-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.isEmpty == true
        }
        XCTAssertNil(model.errorMessage)
    }

    func testFiringDeferredResumeShowsStartedRun() async throws {
        let client = MockCompanionClient()
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.fireDeferredResume("resume-1")

        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.contains(where: { $0.manifest?.source?.type == "deferred-resume" && $0.manifest?.source?.id == "resume-1" })
        }
    }

    func testFiringDeferredResumeIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.fireDeferredResumeDelayNanoseconds = 150_000_000
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.fireDeferredResume("resume-1")
        model.fireDeferredResume("resume-1")

        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.contains(where: { $0.manifest?.source?.type == "deferred-resume" && $0.manifest?.source?.id == "resume-1" })
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(model.connectedRuns.filter { $0.manifest?.source?.type == "deferred-resume" && $0.manifest?.source?.id == "resume-1" }.count, 1)
        XCTAssertNil(model.errorMessage)
    }

    func testFireDeferredResumeClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.fireDeferredResumeFailureQueueMessages = ["Deferred resume fire temporarily unavailable."]
        client.addMockDeferredResume(conversationId: "conv-1", resumeId: "resume-1")
        let model = ConversationViewModel(
            client: client,
            conversationId: "conv-1",
            installationSurfaceId: "ios-test",
            initialSession: nil,
            initialExecutionTargets: [],
            initialWorkspacePaths: [],
            initialModelState: nil
        )

        model.start()
        defer { model.stop() }
        try await waitForCondition(timeout: .seconds(2)) {
            model.sessionMeta?.deferredResumes?.contains(where: { $0.id == "resume-1" }) == true
        }

        model.fireDeferredResume("resume-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.errorMessage != nil
        }

        client.conversationBootstrapDelayNanoseconds = 500_000_000
        model.fireDeferredResume("resume-1")
        try await waitForCondition(timeout: .seconds(2)) {
            model.connectedRuns.contains(where: { $0.manifest?.source?.type == "deferred-resume" && $0.manifest?.source?.id == "resume-1" })
        }
        XCTAssertNil(model.errorMessage)
    }

    func testAutomationRunsAndDeviceAdminAreAvailable() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")

        let tasks = await session.listTasks()
        XCTAssertEqual(tasks.first?.id, "task-1")

        let runResponse = await session.runTask("task-1")
        XCTAssertTrue(runResponse?.accepted == true)
        let runs = await session.listRuns()
        XCTAssertGreaterThanOrEqual(runs?.runs.count ?? 0, 1)

        let devices = await session.readDeviceAdminState()
        XCTAssertEqual(devices?.devices.count, 1)
        let setup = await session.createSetupState()
        XCTAssertEqual(setup?.pairing.code, "ABCD-EFGH-IJKL")
    }

    func testListTasksClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listTasksFailureQueueMessages = ["Task list temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedTasks = await session.listTasks()
        XCTAssertTrue(failedTasks.isEmpty)
        XCTAssertNotNil(session.errorMessage)

        let tasks = await session.listTasks()
        XCTAssertEqual(tasks.first?.id, "task-1")
        XCTAssertNil(session.errorMessage)
    }

    func testListRunsClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.listRunsFailureQueueMessages = ["Run list temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedRuns = await session.listRuns()
        XCTAssertNil(failedRuns)
        XCTAssertNotNil(session.errorMessage)

        let runs = await session.listRuns()
        XCTAssertEqual(runs?.runs.first?.runId, "run-1")
        XCTAssertNil(session.errorMessage)
    }

    func testReadDeviceAdminStateClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readDeviceAdminStateFailureQueueMessages = ["Device admin state temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedState = await session.readDeviceAdminState()
        XCTAssertNil(failedState)
        XCTAssertNotNil(session.errorMessage)

        let state = await session.readDeviceAdminState()
        XCTAssertEqual(state?.devices.first?.id, "device-demo")
        XCTAssertNil(session.errorMessage)
    }

    func testReadTaskClearsStaleErrorAfterSuccessfulRetry() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")

        let missing = await session.readTask("missing-task")
        XCTAssertNil(missing)
        XCTAssertNotNil(session.errorMessage)

        let task = await session.readTask("task-1")
        XCTAssertEqual(task?.id, "task-1")
        XCTAssertNil(session.errorMessage)
    }

    func testReadTaskLogClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readTaskLogFailureQueueMessages = ["Task log temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedLog = await session.readTaskLog("task-1")
        XCTAssertNil(failedLog)
        XCTAssertNotNil(session.errorMessage)

        let log = await session.readTaskLog("task-1")
        XCTAssertEqual(log?.path, "/tmp/task-1.log")
        XCTAssertNil(session.errorMessage)
    }

    func testReadRunClearsStaleErrorAfterSuccessfulRetry() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")

        let missing = await session.readRun("missing-run")
        XCTAssertNil(missing)
        XCTAssertNotNil(session.errorMessage)

        let run = await session.readRun("run-1")
        XCTAssertEqual(run?.run.runId, "run-1")
        XCTAssertNil(session.errorMessage)
    }

    func testReadRunLogClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.readRunLogFailureQueueMessages = ["Run log temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedLog = await session.readRunLog("run-1")
        XCTAssertNil(failedLog)
        XCTAssertNotNil(session.errorMessage)

        let log = await session.readRunLog("run-1")
        XCTAssertEqual(log?.path, "/tmp/run-1.log")
        XCTAssertNil(session.errorMessage)
    }

    func testCreateSetupStateIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createSetupStateDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        async let first = session.createSetupState()
        async let second = session.createSetupState()
        let states = await [first, second].compactMap { $0 }

        XCTAssertEqual(states.count, 1)
        XCTAssertEqual(states.first?.pairing.code, "ABCD-EFGH-IJKL")
        XCTAssertEqual(client.createSetupStateCount, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testCreateSetupStateClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createSetupStateFailureQueueMessages = ["Setup state temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedSetup = await session.createSetupState()
        XCTAssertNil(failedSetup)
        XCTAssertNotNil(session.errorMessage)

        let setup = await session.createSetupState()
        XCTAssertEqual(setup?.pairing.code, "ABCD-EFGH-IJKL")
        XCTAssertNil(session.errorMessage)
    }

    func testDeletePairedDeviceIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.deletePairedDeviceDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let state = await session.readDeviceAdminState()
        let initialState = try XCTUnwrap(state)
        let deviceId = try XCTUnwrap(initialState.devices.first?.id)

        async let first = session.deletePairedDevice(deviceId)
        async let second = session.deletePairedDevice(deviceId)
        let states = await [first, second].compactMap { $0 }

        XCTAssertEqual(states.filter { !$0.devices.contains { $0.id == deviceId } }.count, 1)
        XCTAssertEqual(client.deletePairedDeviceCount, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testDeletePairedDeviceClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.deletePairedDeviceFailureQueueMessages = ["Device delete temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let state = await session.readDeviceAdminState()
        let initialState = try XCTUnwrap(state)
        let deviceId = try XCTUnwrap(initialState.devices.first?.id)

        let failedState = await session.deletePairedDevice(deviceId)
        XCTAssertNil(failedState)
        XCTAssertNotNil(session.errorMessage)

        let updatedState = await session.deletePairedDevice(deviceId)
        XCTAssertFalse(updatedState?.devices.contains { $0.id == deviceId } ?? true)
        XCTAssertNil(session.errorMessage)
    }

    func testUpdatePairedDeviceIgnoresDuplicateSaveWhilePending() async throws {
        let client = MockCompanionClient()
        client.updatePairedDeviceDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let state = await session.readDeviceAdminState()
        let initialState = try XCTUnwrap(state)
        let deviceId = try XCTUnwrap(initialState.devices.first?.id)

        async let first = session.updatePairedDevice(deviceId, label: "User’s phone")
        async let second = session.updatePairedDevice(deviceId, label: "User’s phone")
        let states = await [first, second].compactMap { $0 }

        XCTAssertEqual(states.filter { $0.devices.contains { $0.id == deviceId && $0.deviceLabel == "User’s phone" } }.count, 1)
        XCTAssertEqual(client.updatePairedDeviceCount, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testUpdatePairedDeviceClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.updatePairedDeviceFailureQueueMessages = ["Device update temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let state = await session.readDeviceAdminState()
        let initialState = try XCTUnwrap(state)
        let deviceId = try XCTUnwrap(initialState.devices.first?.id)

        let failedState = await session.updatePairedDevice(deviceId, label: "User’s phone")
        XCTAssertNil(failedState)
        XCTAssertNotNil(session.errorMessage)

        let updatedState = await session.updatePairedDevice(deviceId, label: "User’s phone")
        XCTAssertEqual(updatedState?.devices.first?.deviceLabel, "User’s phone")
        XCTAssertNil(session.errorMessage)
    }

    func testRunTaskIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.runTaskDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialRunCount = await session.listRuns()?.runs.filter { $0.manifest?.source?.type == "task" && $0.manifest?.source?.id == "task-1" }.count ?? 0

        async let first = session.runTask("task-1")
        async let second = session.runTask("task-1")
        let responses = await [first, second].compactMap { $0 }
        let runs = await session.listRuns()

        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(client.runTaskCount, 1)
        XCTAssertEqual(runs?.runs.filter { $0.manifest?.source?.type == "task" && $0.manifest?.source?.id == "task-1" }.count, initialRunCount + 1)
        XCTAssertNil(session.errorMessage)
    }

    func testRunTaskClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.runTaskFailureQueueMessages = ["Task run temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialRunCount = await session.listRuns()?.runs.filter { $0.manifest?.source?.type == "task" && $0.manifest?.source?.id == "task-1" }.count ?? 0

        let failedResponse = await session.runTask("task-1")
        XCTAssertNil(failedResponse)
        XCTAssertNotNil(session.errorMessage)

        let response = await session.runTask("task-1")
        XCTAssertEqual(response?.accepted, true)
        XCTAssertNil(session.errorMessage)

        let runs = await session.listRuns()
        XCTAssertEqual(runs?.runs.filter { $0.manifest?.source?.type == "task" && $0.manifest?.source?.id == "task-1" }.count, initialRunCount + 1)
        XCTAssertNil(session.errorMessage)
    }

    func testCancelRunIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.cancelRunDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let run = await session.runTask("task-1")
        let runId = try XCTUnwrap(run?.runId)

        async let first = session.cancelRun(runId)
        async let second = session.cancelRun(runId)
        let responses = await [first, second].compactMap { $0 }

        XCTAssertEqual(responses.count, 1)
        XCTAssertEqual(client.cancelRunCount, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testCancelRunClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.cancelRunFailureQueueMessages = ["Run cancel temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let run = await session.runTask("task-1")
        let runId = try XCTUnwrap(run?.runId)

        let failedResponse = await session.cancelRun(runId)
        XCTAssertNil(failedResponse)
        XCTAssertNotNil(session.errorMessage)

        let response = await session.cancelRun(runId)
        XCTAssertEqual(response?.cancelled, true)
        XCTAssertNil(session.errorMessage)
    }

    func testCreatePairingCodeIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.createPairingCodeDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")
        let initialPairingCount = await session.readDeviceAdminState()?.pendingPairings.count ?? 0

        async let first = session.createPairingCode()
        async let second = session.createPairingCode()
        let codes = await [first, second].compactMap { $0 }
        let state = await session.readDeviceAdminState()

        XCTAssertEqual(codes.count, 1)
        XCTAssertEqual(client.createPairingCodeCount, 1)
        XCTAssertEqual(state?.pendingPairings.count, initialPairingCount + 1)
        XCTAssertNil(session.errorMessage)
    }

    func testCreatePairingCodeClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.createPairingCodeFailureQueueMessages = ["Pairing code temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedCode = await session.createPairingCode()
        XCTAssertNil(failedCode)
        XCTAssertNotNil(session.errorMessage)

        let code = await session.createPairingCode()
        XCTAssertEqual(code?.code, "WXYZ-QRST-UVWX")
        XCTAssertNil(session.errorMessage)
    }

    func testAutomationEditorPersistsCallbackFields() async throws {
        let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: "ios-test")
        session.refresh()
        try await Task.sleep(for: .milliseconds(50))

        var draft = ScheduledTaskEditorDraft()
        draft.title = "Nightly digest"
        draft.prompt = "Summarize failures."
        draft.targetType = "background-agent"
        draft.callbackConversationId = "conv-1"
        draft.deliverOnSuccess = false
        draft.deliverOnFailure = true
        draft.notifyOnSuccess = "none"
        draft.notifyOnFailure = "disruptive"
        draft.requireAck = true
        draft.autoResumeIfOpen = false

        let saved = await session.saveTask(taskId: nil, draft: draft)
        let task = try XCTUnwrap(saved)
        XCTAssertEqual(task.callbackConversationId, "conv-1")
        XCTAssertEqual(task.deliverOnSuccess, false)
        XCTAssertEqual(task.autoResumeIfOpen, false)
    }

    func testSaveTaskIgnoresDuplicateCreateWhilePending() async throws {
        let client = MockCompanionClient()
        client.createTaskDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        var draft = ScheduledTaskEditorDraft()
        draft.title = "Create this task once"
        draft.prompt = "Summarize overnight failures."
        draft.targetType = "background-agent"
        let submittedDraft = draft

        async let first = session.saveTask(taskId: nil, draft: submittedDraft)
        async let second = session.saveTask(taskId: nil, draft: submittedDraft)
        let created = await [first, second].compactMap { $0 }
        let tasks = await session.listTasks()

        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(client.createTaskCount, 1)
        XCTAssertEqual(tasks.filter { $0.title == "Create this task once" }.count, 1)
        XCTAssertNil(session.errorMessage)
    }

    func testSaveTaskClearsStaleErrorAfterSuccessfulCreateRetry() async throws {
        let client = MockCompanionClient()
        client.createTaskFailureQueueMessages = ["Task create temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        var draft = ScheduledTaskEditorDraft()
        draft.title = "Retry-created task"
        draft.prompt = "Summarize overnight failures."
        draft.targetType = "background-agent"

        let failedTask = await session.saveTask(taskId: nil, draft: draft)
        XCTAssertNil(failedTask)
        XCTAssertNotNil(session.errorMessage)

        let task = await session.saveTask(taskId: nil, draft: draft)
        XCTAssertEqual(task?.title, "Retry-created task")
        XCTAssertNil(session.errorMessage)
    }

    func testDeleteTaskIgnoresDuplicateTapWhilePending() async throws {
        let client = MockCompanionClient()
        client.deleteTaskDelayNanoseconds = 150_000_000
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        async let first = session.deleteTask("task-1")
        async let second = session.deleteTask("task-1")
        let results = await [first, second]
        let tasks = await session.listTasks()

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(client.deleteTaskCount, 1)
        XCTAssertFalse(tasks.contains { $0.id == "task-1" })
        XCTAssertNil(session.errorMessage)
    }

    func testDeleteTaskClearsStaleErrorAfterSuccessfulRetry() async throws {
        let client = MockCompanionClient()
        client.deleteTaskFailureQueueMessages = ["Task delete temporarily unavailable."]
        let session = HostSessionModel(client: client, installationSurfaceId: "ios-test")

        let failedResult = await session.deleteTask("task-1")
        XCTAssertFalse(failedResult)
        XCTAssertNotNil(session.errorMessage)

        let result = await session.deleteTask("task-1")
        XCTAssertTrue(result)
        XCTAssertNil(session.errorMessage)

        let tasks = await session.listTasks()
        XCTAssertFalse(tasks.contains { $0.id == "task-1" })
        XCTAssertNil(session.errorMessage)
    }

    func testLiveSetupURLPairsAgainstDesktopHost() async throws {
        let environment = ProcessInfo.processInfo.environment
        let config = try loadLiveCompanionConfig(from: environment)
        guard config.enabled else {
            throw XCTSkip("Live companion test is disabled.")
        }
        guard let baseURL = URL(string: config.baseURL) else {
            throw XCTSkip("The live companion test host URL is invalid.")
        }
        _ = try await loadLiveHelloOrSkip(baseURL: baseURL)
        let pairingCode = try await loadLivePairingCode(from: config)

        var components = URLComponents()
        components.scheme = "pa-companion"
        components.host = "pair"
        components.queryItems = [
            URLQueryItem(name: "base", value: config.baseURL),
            URLQueryItem(name: "code", value: pairingCode),
            URLQueryItem(name: "label", value: "Live Host"),
            URLQueryItem(name: "hostInstanceId", value: "host_live_test"),
        ]
        let setupURL = try XCTUnwrap(components.url)
        let model = CompanionAppModel()
        await model.handleIncomingSetupURL(setupURL)
        try await waitForCondition(timeout: .seconds(20)) {
            model.activeSession != nil && !model.hosts.isEmpty
        }

        if let bannerMessage = model.bannerMessage {
            XCTAssertTrue(bannerMessage.contains("Keychain"))
        }
        XCTAssertEqual(model.hosts.first?.baseURL, config.baseURL)
        XCTAssertEqual(model.activeHostId, model.hosts.first?.id)

        let session = try XCTUnwrap(model.activeSession)
        try await waitForCondition(timeout: .seconds(20)) {
            !session.sections.isEmpty || session.errorMessage != nil
        }
        XCTAssertNil(session.errorMessage)
        XCTAssertFalse(session.sections.isEmpty)

        let createdConversationId = await session.createConversation(NewConversationRequest(cwd: config.cwd ?? FileManager.default.currentDirectoryPath))
        let createdId = try XCTUnwrap(createdConversationId)
        XCTAssertFalse(createdId.isEmpty)
        try await waitForCondition(timeout: .seconds(20)) {
            session.sessions[createdId] != nil || session.errorMessage != nil
        }
        XCTAssertNil(session.errorMessage)
        XCTAssertNotNil(session.sessions[createdId])
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
        let pairingCode = try await loadLivePairingCode(from: config)

        let cwd = config.cwd ?? FileManager.default.currentDirectoryPath
        let surfaceId = "ios-live-test"
        let hello = try await loadLiveHelloOrSkip(baseURL: baseURL)
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

        let modelState = try await client.readModels()
        XCTAssertNotNil(modelState.currentModel)

        _ = try await client.listSshTargets()

        let tasks = try await client.listTasks()
        XCTAssertNotNil(tasks)

        let runs = try await client.listRuns()
        XCTAssertNotNil(runs)

        let knowledgeQaFolder = "Inbox/ios-live-qa-\(UUID().uuidString.lowercased())"
        let knowledgeQaFile = "\(knowledgeQaFolder)/smoke.md"
        _ = try await client.listKnowledgeEntries(directoryId: nil)
        let createdFolder = try await client.createKnowledgeFolder(folderId: knowledgeQaFolder)
        XCTAssertEqual(createdFolder.kind, "folder")
        let createdNote = try await client.writeKnowledgeFile(fileId: knowledgeQaFile, content: "# iOS live QA\n\nCOMPANION-KNOWLEDGE-OK\n")
        XCTAssertEqual(createdNote.id, knowledgeQaFile)
        let folderEntries = try await client.listKnowledgeEntries(directoryId: knowledgeQaFolder)
        XCTAssertTrue(folderEntries.entries.contains(where: { $0.id == knowledgeQaFile }))
        let readNote = try await client.readKnowledgeFile(fileId: knowledgeQaFile)
        XCTAssertTrue(readNote.content.contains("COMPANION-KNOWLEDGE-OK"))
        let searchResults = try await client.searchKnowledge(query: "COMPANION-KNOWLEDGE-OK", limit: 5)
        XCTAssertTrue(searchResults.results.contains(where: { $0.id == knowledgeQaFile }))
        let renamedNote = try await client.renameKnowledgeEntry(id: knowledgeQaFile, newName: "smoke-renamed.md", parentId: nil)
        XCTAssertTrue(renamedNote.id.hasSuffix("smoke-renamed.md"))
        try await client.deleteKnowledgeEntry(id: knowledgeQaFolder + "/")

        let deviceState = try await client.readDeviceAdminState()
        XCTAssertTrue(deviceState.devices.contains(where: { $0.id == paired.device.id }))

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

        let previewAsset = try await client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: attachment.attachment.id, asset: "preview", revision: nil)
        XCTAssertEqual(previewAsset.mimeType, "image/png")
        XCTAssertFalse(previewAsset.data.isEmpty)

        let bootstrap = try await client.conversationBootstrap(conversationId: conversationId)
        XCTAssertEqual(bootstrap.bootstrap.conversationId, conversationId)

        guard config.exercisePrompt else {
            return
        }

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
            mode: .submit,
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
                cwd: environment["PA_IOS_LIVE_COMPANION_CWD"],
                exercisePrompt: environment["PA_IOS_LIVE_COMPANION_EXERCISE_PROMPT"] == "1"
            )
        }

        let configFile = environment["PA_IOS_LIVE_COMPANION_CONFIG_FILE"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            ?? "/tmp/personal-agent-ios-live-test-config.json"
        guard FileManager.default.fileExists(atPath: configFile) else {
            return LiveCompanionConfig(enabled: false, baseURL: "", pairingCode: nil, cwd: nil, exercisePrompt: false)
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: configFile))
        return try JSONDecoder().decode(LiveCompanionConfig.self, from: data)
    }

    private func loadLiveHelloOrSkip(baseURL: URL) async throws -> CompanionHello {
        do {
            return try await LiveCompanionClient.hello(baseURL: baseURL)
        } catch {
            throw XCTSkip("Live companion host is unavailable at \(baseURL.absoluteString): \(error.localizedDescription)")
        }
    }

    private func loadLivePairingCode(from config: LiveCompanionConfig) async throws -> String {
        if let baseURL = URL(string: config.baseURL), let scheme = baseURL.scheme, let port = baseURL.port {
            var adminURL = URLComponents()
            adminURL.scheme = scheme
            adminURL.host = "127.0.0.1"
            adminURL.port = port
            adminURL.path = "/companion/v1/admin/pairing-codes"
            if let url = adminURL.url {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                do {
                    let (data, response) = try await URLSession.shared.data(for: request)
                    if let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) {
                        struct PairingCodeResponse: Decodable { let code: String }
                        let decoded = try JSONDecoder().decode(PairingCodeResponse.self, from: data)
                        if !decoded.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            return decoded.code
                        }
                    }
                } catch {
                    // Fall back to the configured code below when loopback admin access is unavailable.
                }
            }
        }

        guard let pairingCode = config.pairingCode?.trimmingCharacters(in: .whitespacesAndNewlines), !pairingCode.isEmpty else {
            throw XCTSkip("Set a live companion pairing code to run the live companion tests.")
        }
        return pairingCode
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

    private func waitForCondition(timeout: Duration, pollInterval: Duration = .milliseconds(100), _ condition: @escaping @MainActor () -> Bool) async throws {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if condition() {
                return
            }
            try await Task.sleep(for: pollInterval)
        }

        XCTAssertTrue(condition(), "Condition was not satisfied before the timeout elapsed.")
    }

    private func clearStoredHostState() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: hostsStorageKey)
        defaults.removeObject(forKey: activeHostStorageKey)
        defaults.removeObject(forKey: surfaceInstallationIdKey)
    }

    private func storeHosts(_ hosts: [CompanionHostRecord]) {
        let data = try! JSONEncoder().encode(hosts)
        UserDefaults.standard.set(data, forKey: hostsStorageKey)
    }
}

private struct MockCompanionSnapshotFixture: Codable {
    let sessionMeta: SessionMeta
    let blocks: [DisplayBlock]
    let toolUseCount: Int?
}

private struct MockCompanionSnapshotFixtureFile: Codable {
    let hostLabel: String?
    let generatedAt: String?
    let conversations: [MockCompanionSnapshotFixture]
}

private struct LiveCompanionConfig: Decodable {
    let enabled: Bool
    let baseURL: String
    let pairingCode: String?
    let cwd: String?
    private let exercisePromptFlag: Bool?

    init(enabled: Bool, baseURL: String, pairingCode: String?, cwd: String?, exercisePrompt: Bool?) {
        self.enabled = enabled
        self.baseURL = baseURL
        self.pairingCode = pairingCode
        self.cwd = cwd
        self.exercisePromptFlag = exercisePrompt
    }

    enum CodingKeys: String, CodingKey {
        case enabled
        case baseURL
        case pairingCode
        case cwd
        case exercisePromptFlag = "exercisePrompt"
    }

    var exercisePrompt: Bool {
        exercisePromptFlag ?? false
    }
}
