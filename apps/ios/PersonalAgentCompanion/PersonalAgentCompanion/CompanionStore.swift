import Foundation
import SwiftUI

@MainActor
final class CompanionAppModel: ObservableObject {
    @Published private(set) var hosts: [CompanionHostRecord] = []
    @Published private(set) var activeHostId: UUID?
    @Published private(set) var activeSession: HostSessionModel?
    @Published var bannerMessage: String?
    @Published var hostSelectionPresented = false

    private let defaults = UserDefaults.standard
    private let hostsStorageKey = "pa.ios.companion.hosts"
    private let activeHostStorageKey = "pa.ios.companion.active-host-id"
    private let surfaceInstallationIdKey = "pa.ios.companion.installation-id"
    private let useMockMode: Bool

    let installationSurfaceId: String

    init() {
        self.useMockMode = ProcessInfo.processInfo.environment["PA_IOS_MOCK_MODE"] == "1"
        if let existing = defaults.string(forKey: surfaceInstallationIdKey), !existing.isEmpty {
            self.installationSurfaceId = existing
        } else {
            let next = "ios-\(UUID().uuidString.lowercased())"
            self.installationSurfaceId = next
            defaults.set(next, forKey: surfaceInstallationIdKey)
        }
        loadHosts()
        bootstrapInitialSession()
    }

    func pairHost(baseURLString: String, code: String, deviceLabel: String) async {
        do {
            let normalized = try normalizeHostURL(baseURLString)
            let hello = try await LiveCompanionClient.hello(baseURL: normalized)
            let paired = try await LiveCompanionClient.pair(baseURL: normalized, code: code.trimmed, deviceLabel: deviceLabel.trimmed.isEmpty ? UIDevice.current.name : deviceLabel.trimmed)
            let record = CompanionHostRecord(
                baseURL: normalized.absoluteString,
                hostLabel: paired.hello?.hostLabel ?? hello.hostLabel,
                hostInstanceId: paired.hello?.hostInstanceId ?? hello.hostInstanceId,
                deviceId: paired.device.id,
                deviceLabel: paired.device.deviceLabel
            )
            guard KeychainStore.shared.setToken(paired.bearerToken, for: record.id) else {
                throw CompanionClientError.requestFailed("Failed to store the paired device token in Keychain.")
            }
            hosts.removeAll { $0.hostInstanceId == record.hostInstanceId && $0.deviceId == record.deviceId }
            hosts.insert(record, at: 0)
            persistHosts()
            await selectHost(record.id)
        } catch {
            bannerMessage = error.localizedDescription
        }
    }

    func selectHost(_ id: UUID?) async {
        activeSession?.stop()
        activeSession = nil
        activeHostId = id
        persistHosts()

        guard let id else {
            return
        }
        if useMockMode {
            let session = HostSessionModel(client: MockCompanionClient(), installationSurfaceId: installationSurfaceId)
            activeSession = session
            session.start()
            return
        }
        guard let record = hosts.first(where: { $0.id == id }) else {
            return
        }
        guard let token = KeychainStore.shared.token(for: record.id) else {
            bannerMessage = "The paired token for \(record.hostLabel) is missing. Pair it again."
            return
        }
        let client = LiveCompanionClient(host: record, token: token)
        let session = HostSessionModel(client: client, installationSurfaceId: installationSurfaceId)
        activeSession = session
        session.start()
    }

    func removeHost(_ host: CompanionHostRecord) {
        if activeHostId == host.id {
            activeSession?.stop()
            activeSession = nil
            activeHostId = nil
        }
        hosts.removeAll { $0.id == host.id }
        KeychainStore.shared.removeToken(for: host.id)
        persistHosts()
        if activeHostId == nil, let next = hosts.first {
            Task { await selectHost(next.id) }
        }
    }

    func refreshActiveSession() {
        activeSession?.refresh()
    }

    private func bootstrapInitialSession() {
        if useMockMode {
            Task { await selectHost(UUID()) }
            return
        }
        guard let value = defaults.string(forKey: activeHostStorageKey), let id = UUID(uuidString: value), hosts.contains(where: { $0.id == id }) else {
            if let first = hosts.first {
                Task { await selectHost(first.id) }
            }
            return
        }
        Task { await selectHost(id) }
    }

    private func normalizeHostURL(_ string: String) throws -> URL {
        let trimmed = string.trimmed
        guard !trimmed.isEmpty else {
            throw CompanionClientError.invalidHostURL
        }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme), let scheme = url.scheme, ["http", "https"].contains(scheme) else {
            throw CompanionClientError.invalidHostURL
        }
        return url.standardized
    }

    private func loadHosts() {
        guard let data = defaults.data(forKey: hostsStorageKey) else {
            return
        }
        do {
            hosts = try JSONDecoder().decode([CompanionHostRecord].self, from: data)
        } catch {
            bannerMessage = "Failed to load saved hosts: \(error.localizedDescription)"
        }
    }

    private func persistHosts() {
        do {
            let data = try JSONEncoder().encode(hosts)
            defaults.set(data, forKey: hostsStorageKey)
            defaults.set(activeHostId?.uuidString, forKey: activeHostStorageKey)
        } catch {
            bannerMessage = "Failed to save host state: \(error.localizedDescription)"
        }
    }
}

@MainActor
final class HostSessionModel: ObservableObject {
    @Published private(set) var host: CompanionHostRecord
    @Published private(set) var sections: [ConversationListSection] = []
    @Published private(set) var sessions: [String: SessionMeta] = [:]
    @Published private(set) var executionTargets: [ExecutionTargetSummary] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let installationSurfaceId: String
    private let client: CompanionClientProtocol
    private var appEventsTask: Task<Void, Never>?

    init(client: CompanionClientProtocol, installationSurfaceId: String) {
        self.client = client
        self.host = client.host
        self.installationSurfaceId = installationSurfaceId
    }

    func start() {
        refresh()
        subscribeAppEvents()
    }

    func stop() {
        appEventsTask?.cancel()
        appEventsTask = nil
        client.disconnect()
    }

    func refresh() {
        Task {
            isLoading = true
            defer { isLoading = false }
            do {
                try await client.connect()
                let state = try await client.listConversations()
                applyConversationListState(state)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func makeConversationModel(conversationId: String, initialSession: SessionMeta?) -> ConversationViewModel {
        ConversationViewModel(
            client: client,
            conversationId: conversationId,
            installationSurfaceId: installationSurfaceId,
            initialSession: initialSession,
            initialExecutionTargets: executionTargets
        )
    }

    func createConversation(_ request: NewConversationRequest) async -> String? {
        do {
            let envelope = try await client.createConversation(request, surfaceId: installationSurfaceId)
            if let meta = envelope.sessionMeta {
                sessions[meta.id] = meta
            }
            return envelope.bootstrap.conversationId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func resumeConversation(_ request: ResumeConversationRequest) async -> String? {
        do {
            let envelope = try await client.resumeConversation(request)
            if let meta = envelope.sessionMeta {
                sessions[meta.id] = meta
            }
            return envelope.bootstrap.conversationId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func subscribeAppEvents() {
        appEventsTask?.cancel()
        appEventsTask = Task {
            do {
                let stream = try await client.subscribeAppEvents()
                for await event in stream {
                    if Task.isCancelled { break }
                    switch event {
                    case .conversationListState(let state):
                        applyConversationListState(state)
                    case .open:
                        break
                    case .close:
                        errorMessage = nil
                    case .error(let message):
                        errorMessage = message
                    }
                }
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func applyConversationListState(_ state: ConversationListState) {
        let sessionIndex = Dictionary(uniqueKeysWithValues: state.sessions.map { ($0.id, $0) })
        sessions = sessionIndex
        executionTargets = state.executionTargets ?? []

        let pinnedOrder = Set(state.ordering.pinnedSessionIds)
        let sessionOrder = state.ordering.sessionIds
        let pinned: [SessionMeta] = sessionOrder.compactMap { (id: String) -> SessionMeta? in
            guard pinnedOrder.contains(id) else { return nil }
            return sessionIndex[id]
        }
        let open: [SessionMeta] = sessionOrder.compactMap { (id: String) -> SessionMeta? in
            guard !pinnedOrder.contains(id) else { return nil }
            return sessionIndex[id]
        }
        let orderedSet = Set(sessionOrder)
        let recent = state.sessions
            .filter { !orderedSet.contains($0.id) }
            .sorted { lhs, rhs in
                (lhs.effectiveActivityDate ?? .distantPast) > (rhs.effectiveActivityDate ?? .distantPast)
            }

        sections = [
            pinned.isEmpty ? nil : ConversationListSection(id: "pinned", title: "Pinned", sessions: pinned),
            open.isEmpty ? nil : ConversationListSection(id: "open", title: "Open", sessions: open),
            recent.isEmpty ? nil : ConversationListSection(id: "recent", title: "Recent", sessions: recent),
        ].compactMap { $0 }
    }
}

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published private(set) var title: String
    @Published private(set) var sessionMeta: SessionMeta?
    @Published private(set) var blocks: [DisplayBlock] = []
    @Published private(set) var executionTargets: [ExecutionTargetSummary]
    @Published private(set) var currentExecutionTargetId: String = "local"
    @Published private(set) var savedAttachments: [ConversationAttachmentSummary] = []
    @Published private(set) var presenceState: LiveSessionPresenceState?
    @Published private(set) var isLoading = false
    @Published private(set) var isStreaming = false
    @Published var errorMessage: String?
    @Published var promptText: String = ""
    @Published var promptImages: [PromptImageDraft] = []
    @Published var promptAttachmentRefs: [PromptAttachmentReference] = []

    let conversationId: String
    let installationSurfaceId: String

    private let client: CompanionClientProtocol
    private var streamTask: Task<Void, Never>?
    private var lastStreamingTextBlockId: String?
    private var lastStreamingThinkingBlockId: String?

    init(
        client: CompanionClientProtocol,
        conversationId: String,
        installationSurfaceId: String,
        initialSession: SessionMeta?,
        initialExecutionTargets: [ExecutionTargetSummary]
    ) {
        self.client = client
        self.conversationId = conversationId
        self.installationSurfaceId = installationSurfaceId
        self.sessionMeta = initialSession
        self.title = initialSession?.title ?? "Conversation"
        self.executionTargets = initialExecutionTargets
        self.currentExecutionTargetId = initialSession?.remoteHostId ?? "local"
    }

    func start() {
        loadBootstrap()
        subscribeConversationEvents()
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
    }

    func loadBootstrap() {
        Task {
            isLoading = true
            defer { isLoading = false }
            do {
                let envelope = try await client.conversationBootstrap(conversationId: conversationId)
                applyBootstrap(envelope)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func refreshAttachments() {
        Task {
            do {
                let result = try await client.listAttachments(conversationId: conversationId)
                savedAttachments = result.attachments
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func sendPrompt() {
        let currentText = promptText
        let currentImages = promptImages
        let currentRefs = promptAttachmentRefs
        guard currentText.nilIfBlank != nil || !currentImages.isEmpty || !currentRefs.isEmpty else {
            return
        }
        Task {
            do {
                try await client.promptConversation(
                    conversationId: conversationId,
                    text: currentText,
                    images: currentImages,
                    attachmentRefs: currentRefs,
                    surfaceId: installationSurfaceId
                )
                promptText = ""
                promptImages.removeAll()
                promptAttachmentRefs.removeAll()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func abort() {
        Task {
            do {
                try await client.abortConversation(conversationId: conversationId)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func takeOver() {
        Task {
            do {
                try await client.takeOverConversation(conversationId: conversationId, surfaceId: installationSurfaceId)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func renameConversation(_ name: String) {
        let trimmed = name.trimmed
        guard !trimmed.isEmpty else { return }
        Task {
            do {
                try await client.renameConversation(conversationId: conversationId, name: trimmed, surfaceId: installationSurfaceId)
                title = trimmed
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func changeExecutionTarget(_ targetId: String) {
        guard currentExecutionTargetId != targetId else { return }
        Task {
            do {
                let envelope = try await client.changeExecutionTarget(conversationId: conversationId, executionTargetId: targetId)
                applyBootstrap(envelope)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadAttachment(_ attachmentId: String) async -> ConversationAttachmentRecord? {
        do {
            return try await client.readAttachment(conversationId: conversationId, attachmentId: attachmentId).attachment
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func downloadAttachmentAsset(attachmentId: String, asset: String, revision: Int?) async -> AttachmentAssetDownload? {
        do {
            return try await client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: attachmentId, asset: asset, revision: revision)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func buildDraftForEditing(_ record: ConversationAttachmentRecord) async -> AttachmentEditorDraft? {
        do {
            async let source = client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: record.id, asset: "source", revision: record.currentRevision)
            async let preview = client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: record.id, asset: "preview", revision: record.currentRevision)
            let sourceAsset = try await source
            let previewAsset = try await preview
            return AttachmentEditorDraft(
                title: record.title,
                note: record.latestRevision.note ?? "",
                sourceAsset: AttachmentDraftAsset(
                    fileName: sourceAsset.fileName ?? record.latestRevision.sourceName,
                    mimeType: sourceAsset.mimeType,
                    base64Data: sourceAsset.data.base64EncodedString(),
                    rawData: sourceAsset.data
                ),
                previewAsset: AttachmentDraftAsset(
                    fileName: previewAsset.fileName ?? record.latestRevision.previewName,
                    mimeType: previewAsset.mimeType,
                    base64Data: previewAsset.data.base64EncodedString(),
                    rawData: previewAsset.data
                )
            )
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveNewAttachment(_ draft: AttachmentEditorDraft) async -> Bool {
        do {
            let result = try await client.createAttachment(conversationId: conversationId, draft: draft)
            savedAttachments = result.attachments
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func saveExistingAttachment(attachmentId: String, draft: AttachmentEditorDraft) async -> Bool {
        do {
            let result = try await client.updateAttachment(conversationId: conversationId, attachmentId: attachmentId, draft: draft)
            savedAttachments = result.attachments
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func addPromptImage(_ image: PromptImageDraft) {
        promptImages.append(image)
    }

    func removePromptImage(_ id: UUID) {
        promptImages.removeAll { $0.id == id }
    }

    func attachDrawingReference(attachment: ConversationAttachmentSummary, revision: Int?) {
        let reference = PromptAttachmentReference(attachmentId: attachment.id, revision: revision, title: attachment.title)
        if !promptAttachmentRefs.contains(reference) {
            promptAttachmentRefs.append(reference)
        }
    }

    func removeAttachmentReference(_ id: String) {
        promptAttachmentRefs.removeAll { $0.id == id }
    }

    private func subscribeConversationEvents() {
        streamTask?.cancel()
        streamTask = Task {
            do {
                let stream = try await client.subscribeConversationEvents(conversationId: conversationId, surfaceId: installationSurfaceId)
                for await event in stream {
                    if Task.isCancelled { break }
                    applyEvent(event)
                }
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func applyBootstrap(_ envelope: ConversationBootstrapEnvelope) {
        sessionMeta = envelope.sessionMeta ?? envelope.bootstrap.sessionDetail?.meta ?? sessionMeta
        title = sessionMeta?.title ?? envelope.bootstrap.liveSession.title ?? title
        executionTargets = envelope.executionTargets
        currentExecutionTargetId = sessionMeta?.remoteHostId ?? envelope.bootstrap.sessionDetail?.meta.remoteHostId ?? "local"
        savedAttachments = envelope.attachments?.attachments ?? savedAttachments
        isStreaming = envelope.bootstrap.liveSession.isStreaming ?? false

        if let detail = envelope.bootstrap.sessionDetail {
            blocks = detail.blocks
        } else if let appendOnly = envelope.bootstrap.sessionDetailAppendOnly {
            blocks.append(contentsOf: appendOnly.blocks)
        }
    }

    private func applyEvent(_ event: CompanionConversationEvent) {
        switch event {
        case .snapshot(let snapshotBlocks, _, _):
            blocks = snapshotBlocks
            lastStreamingTextBlockId = nil
            lastStreamingThinkingBlockId = nil
        case .agentStart:
            isStreaming = true
        case .agentEnd, .turnEnd:
            isStreaming = false
            lastStreamingTextBlockId = nil
            lastStreamingThinkingBlockId = nil
        case .userMessage(let block):
            blocks.append(block)
        case .textDelta(let delta):
            appendStreamingDelta(type: "text", delta: delta)
        case .thinkingDelta(let delta):
            appendStreamingDelta(type: "thinking", delta: delta)
        case .toolStart(let toolCallId, let toolName, let args):
            let block = DisplayBlock(type: "tool_use", id: toolCallId, ts: ISO8601DateFormatter.flexible.string(from: .now), tool: toolName, input: args, output: "", toolCallId: toolCallId)
            blocks.append(block)
        case .toolUpdate(let toolCallId, let partialResult):
            updateToolBlock(toolCallId: toolCallId) { block in
                DisplayBlock(
                    type: block.type,
                    id: block.id,
                    ts: block.ts,
                    text: block.text,
                    title: block.title,
                    kind: block.kind,
                    detail: block.detail,
                    tool: block.tool,
                    input: block.input,
                    output: partialResult.map { describeJSONValue($0) } ?? block.output,
                    durationMs: block.durationMs,
                    toolCallId: block.toolCallId,
                    details: block.details,
                    outputDeferred: block.outputDeferred,
                    alt: block.alt,
                    src: block.src,
                    mimeType: block.mimeType,
                    width: block.width,
                    height: block.height,
                    caption: block.caption,
                    deferred: block.deferred,
                    message: block.message,
                    customType: block.customType,
                    images: block.images
                )
            }
        case .toolEnd(let toolCallId, let toolName, let isError, let durationMs, let output, let details):
            updateToolBlock(toolCallId: toolCallId) { block in
                DisplayBlock(
                    type: "tool_use",
                    id: block.id,
                    ts: block.ts,
                    text: block.text,
                    title: block.title,
                    kind: block.kind,
                    detail: block.detail,
                    tool: toolName,
                    input: block.input,
                    output: output,
                    durationMs: durationMs,
                    toolCallId: toolCallId,
                    details: details,
                    outputDeferred: block.outputDeferred,
                    alt: block.alt,
                    src: block.src,
                    mimeType: block.mimeType,
                    width: block.width,
                    height: block.height,
                    caption: block.caption,
                    deferred: block.deferred,
                    message: isError ? output : block.message,
                    customType: block.customType,
                    images: block.images
                )
            }
        case .titleUpdate(let nextTitle):
            title = nextTitle
        case .presenceState(let nextState):
            presenceState = nextState
        case .error(let message):
            errorMessage = message
            isStreaming = false
        case .open:
            break
        case .close:
            isStreaming = false
        case .unknown:
            break
        }
    }

    private func appendStreamingDelta(type: String, delta: String) {
        if type == "text", let id = lastStreamingTextBlockId, let index = blocks.firstIndex(where: { $0.id == id }) {
            let existing = blocks[index]
            blocks[index] = DisplayBlock(type: type, id: existing.id, ts: existing.ts, text: (existing.text ?? "") + delta)
            return
        }
        if type == "thinking", let id = lastStreamingThinkingBlockId, let index = blocks.firstIndex(where: { $0.id == id }) {
            let existing = blocks[index]
            blocks[index] = DisplayBlock(type: type, id: existing.id, ts: existing.ts, text: (existing.text ?? "") + delta)
            return
        }

        let id = UUID().uuidString
        blocks.append(DisplayBlock(type: type, id: id, ts: ISO8601DateFormatter.flexible.string(from: .now), text: delta))
        if type == "text" {
            lastStreamingTextBlockId = id
        } else {
            lastStreamingThinkingBlockId = id
        }
    }

    private func updateToolBlock(toolCallId: String, transform: (DisplayBlock) -> DisplayBlock) {
        if let index = blocks.lastIndex(where: { $0.toolCallId == toolCallId || $0.id == toolCallId }) {
            blocks[index] = transform(blocks[index])
        }
    }
}

private func describeJSONValue(_ value: JSONValue) -> String {
    switch value {
    case .string(let string):
        return string
    case .number(let number):
        return String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    case .object(let object):
        if let data = try? JSONEncoder().encode(object), let string = String(data: data, encoding: .utf8) {
            return string
        }
        return "{}"
    case .array(let array):
        if let data = try? JSONEncoder().encode(array), let string = String(data: data, encoding: .utf8) {
            return string
        }
        return "[]"
    case .null:
        return "null"
    }
}
