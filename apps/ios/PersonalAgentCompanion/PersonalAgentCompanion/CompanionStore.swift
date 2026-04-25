import Foundation
import Network
import SwiftUI

enum HostDashboardTab: Hashable {
    case chat
    case knowledge
    case archived
    case automations
    case settings
}

struct KnowledgeNavigationRequest: Identifiable, Equatable {
    let id = UUID()
    let fileId: String
}

@MainActor
final class CompanionAppModel: ObservableObject {
    @Published private(set) var hosts: [CompanionHostRecord] = []
    @Published private(set) var activeHostId: UUID?
    @Published private(set) var activeSession: HostSessionModel?
    @Published var bannerMessage: String?
    @Published var hostSelectionPresented = false
    @Published var selectedDashboardTab: HostDashboardTab = .chat
    @Published var knowledgeNavigationRequest: KnowledgeNavigationRequest?

    private let defaults = UserDefaults.standard
    private let hostsStorageKey = "pa.ios.companion.hosts"
    private let activeHostStorageKey = "pa.ios.companion.active-host-id"
    private let surfaceInstallationIdKey = "pa.ios.companion.installation-id"
    private let environment: [String: String]
    private var transientTokens: [UUID: String] = [:]
    private let useMockMode: Bool
    private var isImportingKnowledgeShares = false

    let installationSurfaceId: String

    init() {
        self.environment = ProcessInfo.processInfo.environment
        self.useMockMode = environment["PA_IOS_MOCK_MODE"] == "1"
        if let existing = defaults.string(forKey: surfaceInstallationIdKey), !existing.isEmpty {
            self.installationSurfaceId = existing
        } else {
            let next = "ios-\(UUID().uuidString.lowercased())"
            self.installationSurfaceId = next
            defaults.set(next, forKey: surfaceInstallationIdKey)
        }
        loadHosts()
        seedMockHostIfNeeded()
        seedBootstrapHostIfNeeded()
        bootstrapInitialSelection()
        Task {
            await processPendingKnowledgeSharesIfPossible()
        }
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
            let persistedInKeychain = KeychainStore.shared.setToken(paired.bearerToken, for: record.id)
            if !persistedInKeychain {
                transientTokens[record.id] = paired.bearerToken
            }
            hosts.removeAll { $0.hostInstanceId == record.hostInstanceId && $0.deviceId == record.deviceId }
            hosts.insert(record, at: 0)
            persistHosts()
            await selectHost(record.id)
            if persistedInKeychain {
                bannerMessage = nil
            } else {
                bannerMessage = "Paired, but the token could not be stored in Keychain on this device. The host will stay connected for now, but you may need to pair again after restarting the app."
            }
        } catch {
            bannerMessage = error.localizedDescription
        }
    }

    func pairSetupLink(_ setupLink: CompanionSetupLink, deviceLabel: String? = nil) async {
        await pairHost(
            baseURLString: setupLink.baseURL,
            code: setupLink.code,
            deviceLabel: deviceLabel?.trimmed.nilIfBlank ?? UIDevice.current.name
        )
    }

    func handleIncomingURL(_ url: URL) async {
        if let setupLink = CompanionSetupLink(url: url) {
            await pairSetupLink(setupLink)
            return
        }
        if CompanionIncomingShareLink(url: url) != nil {
            await processPendingKnowledgeSharesIfPossible(forceHostSelection: true)
            return
        }
        bannerMessage = "That link is not a valid Personal Agent setup or share link."
    }

    func handleIncomingSetupURL(_ url: URL) async {
        await handleIncomingURL(url)
    }

    func selectHost(_ id: UUID?, processPendingShares: Bool = true) async {
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
            applyDebugKnowledgeNavigationIfNeeded()
            if processPendingShares {
                await processPendingKnowledgeSharesIfPossible()
            }
            return
        }
        guard let record = hosts.first(where: { $0.id == id }) else {
            return
        }
        guard let token = KeychainStore.shared.token(for: record.id) ?? transientTokens[record.id] else {
            bannerMessage = "The paired token for \(record.hostLabel) is missing. Pair it again."
            return
        }
        let client = LiveCompanionClient(host: record, token: token)
        let session = HostSessionModel(client: client, installationSurfaceId: installationSurfaceId)
        activeSession = session
        session.start()
        applyDebugKnowledgeNavigationIfNeeded()
        if processPendingShares {
            await processPendingKnowledgeSharesIfPossible()
        }
    }

    func updateHost(_ host: CompanionHostRecord, baseURLString: String, displayName: String) async -> Bool {
        do {
            let normalized = try normalizeHostURL(baseURLString)
            guard let index = hosts.firstIndex(where: { $0.id == host.id }) else {
                return false
            }

            var updated = hosts[index]
            updated.baseURL = normalized.absoluteString
            updated.hostLabel = displayName.trimmed.nilIfBlank ?? updated.hostLabel
            updated.lastUsedAt = .now
            hosts[index] = updated
            persistHosts()

            if activeSession != nil, activeHostId == updated.id {
                await selectHost(updated.id)
            }
            return true
        } catch {
            bannerMessage = error.localizedDescription
            return false
        }
    }

    func removeHost(_ host: CompanionHostRecord) {
        if activeHostId == host.id {
            activeSession?.stop()
            activeSession = nil
            activeHostId = nil
        }
        hosts.removeAll { $0.id == host.id }
        transientTokens.removeValue(forKey: host.id)
        KeychainStore.shared.removeToken(for: host.id)
        persistHosts()
        if activeHostId == nil {
            let nextHostId = hosts.first?.id
            activeHostId = nextHostId
            persistHosts()
            if let nextHostId {
                Task { await selectHost(nextHostId) }
            }
        }
    }

    func refreshActiveSession() {
        activeSession?.refresh()
    }

    func consumeKnowledgeNavigationRequest(_ request: KnowledgeNavigationRequest) {
        if knowledgeNavigationRequest == request {
            knowledgeNavigationRequest = nil
        }
    }

    private func makeImportClient() async -> CompanionClientProtocol? {
        if let session = activeSession {
            return session.client
        }
        if activeHostId == nil {
            activeHostId = hosts.first?.id
            persistHosts()
        }
        guard let activeHostId else {
            return nil
        }
        await selectHost(activeHostId, processPendingShares: false)
        return activeSession?.client
    }

    func processPendingKnowledgeSharesIfPossible(forceHostSelection: Bool = false) async {
        guard !isImportingKnowledgeShares else {
            return
        }

        let pending: [PendingKnowledgeShareEnvelope]
        do {
            pending = try KnowledgeShareInboxStore.loadAll()
        } catch KnowledgeShareInboxError.appGroupUnavailable {
            return
        } catch {
            bannerMessage = error.localizedDescription
            return
        }
        guard !pending.isEmpty else {
            return
        }

        if forceHostSelection, activeHostId == nil, hosts.isEmpty {
            bannerMessage = "Pair a host before saving shared items to Knowledge."
            hostSelectionPresented = true
            return
        }

        guard let client = await makeImportClient() else {
            bannerMessage = "Choose a host before saving shared items to Knowledge."
            hostSelectionPresented = true
            return
        }

        isImportingKnowledgeShares = true
        defer { isImportingKnowledgeShares = false }

        var importedCount = 0
        var lastNoteId: String?

        do {
            for envelope in pending {
                for item in envelope.items {
                    let response = try await client.importKnowledge(CompanionKnowledgeImportRequest(
                        kind: {
                            switch item.kind {
                            case .text: return .text
                            case .url: return .url
                            case .image: return .image
                            }
                        }(),
                        directoryId: "Inbox",
                        title: item.title,
                        text: item.text,
                        url: item.url,
                        mimeType: item.mimeType,
                        fileName: item.fileName,
                        dataBase64: item.dataBase64,
                        sourceApp: envelope.sourceApp,
                        createdAt: item.createdAt
                    ))
                    importedCount += 1
                    lastNoteId = response.note.id
                }
                try KnowledgeShareInboxStore.remove(envelope)
            }
        } catch {
            bannerMessage = error.localizedDescription
            return
        }

        guard importedCount > 0 else {
            return
        }
        selectedDashboardTab = .knowledge
        if let lastNoteId {
            knowledgeNavigationRequest = KnowledgeNavigationRequest(fileId: lastNoteId)
        }
        activeSession?.refresh()
        bannerMessage = importedCount == 1 ? "Saved shared item to Knowledge." : "Saved \(importedCount) shared items to Knowledge."
    }

    private func bootstrapInitialSelection() {
        guard let value = defaults.string(forKey: activeHostStorageKey), let id = UUID(uuidString: value), hosts.contains(where: { $0.id == id }) else {
            activeHostId = hosts.first?.id
            persistHosts()
            autoConnectMockHostIfRequested()
            return
        }
        activeHostId = id
        autoConnectMockHostIfRequested()
    }

    private func autoConnectMockHostIfRequested() {
        guard useMockMode, environment["PA_IOS_AUTO_CONNECT_MOCK_HOST"] == "1", let activeHostId else {
            return
        }
        Task {
            await selectHost(activeHostId)
        }
    }

    private func applyDebugKnowledgeNavigationIfNeeded() {
        if environment["PA_IOS_AUTO_SELECT_KNOWLEDGE_TAB"] == "1" {
            selectedDashboardTab = .knowledge
        }
        if let fileId = environment["PA_IOS_AUTO_OPEN_KNOWLEDGE_NOTE"]?.nilIfBlank {
            selectedDashboardTab = .knowledge
            knowledgeNavigationRequest = KnowledgeNavigationRequest(fileId: fileId)
        }
    }

    private func seedMockHostIfNeeded() {
        guard useMockMode, hosts.isEmpty else {
            return
        }

        let usingDeviceDemoData = environment["PA_IOS_USE_DEVICE_DEMO_DATA"] == "1"
        let record = CompanionHostRecord(
            id: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!,
            baseURL: "https://demo.personal-agent.invalid",
            hostLabel: usingDeviceDemoData ? "Device Demo" : "Demo Host",
            hostInstanceId: usingDeviceDemoData ? "host_device_demo" : "host_demo",
            deviceId: "device_demo",
            deviceLabel: "iPhone Demo"
        )
        hosts = [record]
        activeHostId = record.id
        persistHosts()
    }

    private func seedBootstrapHostIfNeeded() {
        guard !useMockMode else {
            return
        }
        guard let baseURLString = environment["PA_IOS_BOOTSTRAP_HOST_URL"]?.nilIfBlank,
              let bearerToken = environment["PA_IOS_BOOTSTRAP_BEARER_TOKEN"]?.nilIfBlank else {
            return
        }

        do {
            let normalized = try normalizeHostURL(baseURLString)
            let hostInstanceId = environment["PA_IOS_BOOTSTRAP_HOST_INSTANCE_ID"]?.nilIfBlank
                ?? hosts.first(where: { $0.baseURL == normalized.absoluteString })?.hostInstanceId
                ?? "bootstrap-\(normalized.host ?? "host")"
            let deviceId = environment["PA_IOS_BOOTSTRAP_DEVICE_ID"]?.nilIfBlank ?? "bootstrap-device"
            let existingId = environment["PA_IOS_BOOTSTRAP_RECORD_ID"].flatMap(UUID.init(uuidString:))
                ?? hosts.first(where: { $0.hostInstanceId == hostInstanceId && $0.deviceId == deviceId })?.id
                ?? UUID()
            let record = CompanionHostRecord(
                id: existingId,
                baseURL: normalized.absoluteString,
                hostLabel: environment["PA_IOS_BOOTSTRAP_HOST_LABEL"]?.nilIfBlank ?? normalized.host ?? "Companion Host",
                hostInstanceId: hostInstanceId,
                deviceId: deviceId,
                deviceLabel: environment["PA_IOS_BOOTSTRAP_DEVICE_LABEL"]?.nilIfBlank ?? "Bootstrap Device"
            )
            transientTokens[record.id] = bearerToken
            _ = KeychainStore.shared.setToken(bearerToken, for: record.id)
            hosts.removeAll { candidate in
                candidate.id == record.id || (candidate.hostInstanceId == record.hostInstanceId && candidate.deviceId == record.deviceId)
            }
            hosts.insert(record, at: 0)
            activeHostId = record.id
            persistHosts()
        } catch {
            bannerMessage = "Failed to bootstrap host from the environment: \(error.localizedDescription)"
        }
    }

    private func normalizeHostURL(_ string: String) throws -> URL {
        let trimmed = string.trimmed
        guard !trimmed.isEmpty else {
            throw CompanionClientError.invalidHostURL
        }

        let hadExplicitScheme = trimmed.contains("://")
        let seeded = hadExplicitScheme ? trimmed : "https://\(trimmed)"
        guard var components = URLComponents(string: seeded),
              let host = components.host?.trimmed.nilIfBlank,
              let originalScheme = components.scheme?.lowercased(),
              ["http", "https"].contains(originalScheme) else {
            throw CompanionClientError.invalidHostURL
        }

        let normalizedScheme: String
        if shouldForceHttps(forHost: host) {
            normalizedScheme = "https"
        } else if shouldForceHttp(forHost: host) {
            normalizedScheme = "http"
        } else if hadExplicitScheme {
            normalizedScheme = originalScheme
        } else {
            normalizedScheme = "https"
        }

        components.scheme = normalizedScheme
        guard let url = components.url else {
            throw CompanionClientError.invalidHostURL
        }
        return url.standardized
    }

    private func shouldForceHttps(forHost host: String) -> Bool {
        let normalized = host.lowercased()
        return normalized.hasSuffix(".ts.net")
    }

    private func shouldForceHttp(forHost host: String) -> Bool {
        let normalized = host.lowercased()
        if normalized == "localhost" || normalized.hasSuffix(".local") || normalized.hasSuffix(".lan") {
            return true
        }
        if !normalized.contains(".") {
            return true
        }
        if IPv4Address(normalized) != nil || IPv6Address(normalized) != nil {
            return true
        }
        return false
    }

    private func loadHosts() {
        guard let data = defaults.data(forKey: hostsStorageKey) else {
            return
        }
        do {
            let decoded = try JSONDecoder().decode([CompanionHostRecord].self, from: data)
            var didNormalize = false
            hosts = decoded.map { host in
                guard let normalized = try? normalizeHostURL(host.baseURL), normalized.absoluteString != host.baseURL else {
                    return host
                }
                didNormalize = true
                var updated = host
                updated.baseURL = normalized.absoluteString
                return updated
            }
            if didNormalize {
                persistHosts()
            }
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
    @Published private(set) var modelState: CompanionModelState?
    @Published private(set) var sshTargets: [CompanionSshTargetRecord] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let installationSurfaceId: String
    fileprivate let client: CompanionClientProtocol
    private var currentOrdering = ConversationOrdering(sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [], workspacePaths: [])
    private var refreshTask: Task<Void, Never>?
    private var appEventsTask: Task<Void, Never>?
    private var pendingConversationBootstraps: [String: ConversationBootstrapEnvelope] = [:]
    private var pendingConversationCreateKeys: Set<String> = []
    private var pendingConversationResumeKeys: Set<String> = []
    private var pendingConversationDuplicateIds: Set<String> = []
    private var pendingConversationOrderingMutationKeys: Set<String> = []
    private var pendingTaskRunIds: Set<String> = []
    private var pendingTaskSaveKeys: Set<String> = []
    private var pendingTaskDeleteIds: Set<String> = []
    private var pendingRunCancelIds: Set<String> = []
    private var pendingSshTargetSaveKeys: Set<String> = []
    private var pendingSshTargetDeleteIds: Set<String> = []
    private var pendingPairedDeviceUpdateKeys: Set<String> = []
    private var pendingPairedDeviceDeleteIds: Set<String> = []
    private var isCreatingPairingCode = false
    private var isCreatingSetupState = false
    private var appEventRevision = 0
    private var refreshRequestId = 0

    var workspacePathOptions: [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for candidate in currentOrdering.workspacePaths + sessions.values.map(\.cwd) {
            guard let path = candidate.nilIfBlank, seen.insert(path).inserted else {
                continue
            }
            ordered.append(path)
        }
        return ordered
    }

    var chatSections: [ConversationListSection] {
        sections.filter { $0.id != "archived" && $0.id != "recent" }
    }

    var archivedSessions: [SessionMeta] {
        sections
            .filter { $0.id == "archived" || $0.id == "recent" }
            .flatMap(\.sessions)
            .sorted { lhs, rhs in
                (lhs.effectiveActivityDate ?? .distantPast) > (rhs.effectiveActivityDate ?? .distantPast)
            }
    }

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
        refreshTask?.cancel()
        refreshTask = nil
        isLoading = false
        appEventsTask?.cancel()
        appEventsTask = nil
        client.disconnect()
    }

    func refresh() {
        refreshTask?.cancel()
        refreshRequestId += 1
        let requestId = refreshRequestId
        isLoading = true
        refreshTask = Task {
            let appEventRevisionAtRequest = appEventRevision
            defer {
                if refreshRequestId == requestId {
                    isLoading = false
                }
            }
            do {
                try await client.connect()
                async let conversationState = client.listConversations()
                async let models = client.readModels()
                async let sshTargetState = client.listSshTargets()
                let state = try await conversationState
                let nextModels = try await models
                let nextSshTargets = try await sshTargetState
                if !Task.isCancelled && refreshRequestId == requestId {
                    errorMessage = nil
                    modelState = nextModels
                    sshTargets = nextSshTargets.hosts
                }
                if !Task.isCancelled && refreshRequestId == requestId && appEventRevision == appEventRevisionAtRequest {
                    applyConversationListState(state)
                }
            } catch {
                if !Task.isCancelled && refreshRequestId == requestId {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func makeConversationModel(conversationId: String, initialSession: SessionMeta?) -> ConversationViewModel {
        let initialBootstrap = pendingConversationBootstraps.removeValue(forKey: conversationId)
        return ConversationViewModel(
            client: client,
            conversationId: conversationId,
            installationSurfaceId: installationSurfaceId,
            initialSession: initialSession,
            initialExecutionTargets: executionTargets,
            initialWorkspacePaths: workspacePathOptions,
            initialModelState: modelState,
            initialBootstrap: initialBootstrap
        )
    }

    func makeKnowledgeDirectoryModel(directoryId: String?) -> KnowledgeDirectoryViewModel {
        KnowledgeDirectoryViewModel(client: client, directoryId: directoryId)
    }

    func makeKnowledgeFolderPickerModel(directoryId: String?, excludedFolderId: String?) -> KnowledgeFolderPickerViewModel {
        KnowledgeFolderPickerViewModel(client: client, directoryId: directoryId, excludedFolderId: excludedFolderId)
    }

    func makeKnowledgeNoteModel(fileId: String) -> KnowledgeNoteViewModel {
        KnowledgeNoteViewModel(client: client, fileId: fileId)
    }

    func createConversation(_ request: NewConversationRequest) async -> String? {
        let createKey = conversationCreateKey(for: request)
        guard pendingConversationCreateKeys.insert(createKey).inserted else {
            return nil
        }
        defer { pendingConversationCreateKeys.remove(createKey) }
        do {
            let envelope = try await client.createConversation(request, surfaceId: installationSurfaceId)
            let conversationId = envelope.bootstrap.conversationId
            pendingConversationBootstraps[conversationId] = envelope
            if let meta = envelope.sessionMeta ?? envelope.bootstrap.sessionDetail?.meta {
                sessions[meta.id] = meta
            }
            refresh()
            errorMessage = nil
            return conversationId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func conversationCreateKey(for request: NewConversationRequest) -> String {
        [
            request.promptText.trimmed,
            request.cwd.trimmed,
            request.executionTargetId.trimmed,
            request.model.trimmed,
            request.thinkingLevel.trimmed,
            request.serviceTier.trimmed
        ].joined(separator: "\u{1f}")
    }

    func resumeConversation(_ request: ResumeConversationRequest) async -> String? {
        let resumeKey = conversationResumeKey(for: request)
        guard pendingConversationResumeKeys.insert(resumeKey).inserted else {
            return nil
        }
        defer { pendingConversationResumeKeys.remove(resumeKey) }
        do {
            let envelope = try await client.resumeConversation(request)
            if let meta = envelope.sessionMeta {
                sessions[meta.id] = meta
            }
            refresh()
            errorMessage = nil
            return envelope.bootstrap.conversationId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func conversationResumeKey(for request: ResumeConversationRequest) -> String {
        [
            request.sessionFile.trimmed,
            request.cwd.trimmed,
            request.executionTargetId.trimmed
        ].joined(separator: "\u{1f}")
    }

    func togglePinned(_ conversationId: String) async {
        let mutationKey = "pin:\(conversationId)"
        guard pendingConversationOrderingMutationKeys.insert(mutationKey).inserted else {
            return
        }
        defer { pendingConversationOrderingMutationKeys.remove(mutationKey) }
        var next = currentOrdering
        let isPinned = next.pinnedSessionIds.contains(conversationId)
        if isPinned {
            next.pinnedSessionIds.removeAll { $0 == conversationId }
        } else {
            next.archivedSessionIds.removeAll { $0 == conversationId }
            next.pinnedSessionIds.append(conversationId)
            if !next.sessionIds.contains(conversationId) {
                next.sessionIds.append(conversationId)
            }
        }
        await saveOrdering(next)
    }

    func toggleArchived(_ conversationId: String) async {
        let mutationKey = "archive:\(conversationId)"
        guard pendingConversationOrderingMutationKeys.insert(mutationKey).inserted else {
            return
        }
        defer { pendingConversationOrderingMutationKeys.remove(mutationKey) }
        var next = currentOrdering
        let isArchived = next.archivedSessionIds.contains(conversationId)
        if isArchived {
            next.archivedSessionIds.removeAll { $0 == conversationId }
            if !next.sessionIds.contains(conversationId) {
                next.sessionIds.append(conversationId)
            }
        } else {
            next.archivedSessionIds.append(conversationId)
            next.pinnedSessionIds.removeAll { $0 == conversationId }
        }
        await saveOrdering(next)
    }

    func restoreConversation(_ conversationId: String) async {
        let mutationKey = "restore:\(conversationId)"
        guard pendingConversationOrderingMutationKeys.insert(mutationKey).inserted else {
            return
        }
        defer { pendingConversationOrderingMutationKeys.remove(mutationKey) }
        var next = currentOrdering
        next.archivedSessionIds.removeAll { $0 == conversationId }
        if !next.sessionIds.contains(conversationId) {
            next.sessionIds.append(conversationId)
        }
        await saveOrdering(next)
    }

    func duplicateConversation(_ conversationId: String) async -> String? {
        guard pendingConversationDuplicateIds.insert(conversationId).inserted else {
            return nil
        }
        defer { pendingConversationDuplicateIds.remove(conversationId) }
        do {
            let nextId = try await client.duplicateConversation(conversationId: conversationId)
            refresh()
            errorMessage = nil
            return nextId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listTasks() async -> [ScheduledTaskSummary] {
        do {
            let tasks = try await client.listTasks()
            errorMessage = nil
            return tasks
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readTask(_ taskId: String) async -> ScheduledTaskDetail? {
        do {
            let task = try await client.readTask(taskId: taskId)
            errorMessage = nil
            return task
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readTaskLog(_ taskId: String) async -> DurableRunLogResponse? {
        do {
            let log = try await client.readTaskLog(taskId: taskId)
            errorMessage = nil
            return log
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveTask(taskId: String?, draft: ScheduledTaskEditorDraft) async -> ScheduledTaskDetail? {
        let saveKey = taskSaveKey(taskId: taskId, draft: draft)
        guard pendingTaskSaveKeys.insert(saveKey).inserted else {
            return nil
        }
        defer { pendingTaskSaveKeys.remove(saveKey) }
        do {
            let task = if let taskId {
                try await client.updateTask(taskId: taskId, draft: draft)
            } else {
                try await client.createTask(draft: draft)
            }
            errorMessage = nil
            return task
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private func taskSaveKey(taskId: String?, draft: ScheduledTaskEditorDraft) -> String {
        [
            taskId ?? "",
            draft.title.trimmed,
            String(draft.enabled),
            draft.scheduleMode.trimmed,
            draft.cron.trimmed,
            draft.at.trimmed,
            draft.model.trimmed,
            draft.thinkingLevel.trimmed,
            draft.cwd.trimmed,
            draft.timeoutSeconds.trimmed,
            draft.prompt.trimmed,
            draft.targetType.trimmed,
            draft.conversationBehavior.trimmed,
            draft.callbackConversationId.trimmed,
            String(draft.deliverOnSuccess),
            String(draft.deliverOnFailure),
            draft.notifyOnSuccess.trimmed,
            draft.notifyOnFailure.trimmed,
            String(draft.requireAck),
            String(draft.autoResumeIfOpen),
            draft.threadMode.trimmed,
            draft.threadConversationId.trimmed
        ].joined(separator: "\u{1f}")
    }

    func deleteTask(_ taskId: String) async -> Bool {
        guard pendingTaskDeleteIds.insert(taskId).inserted else {
            return false
        }
        defer { pendingTaskDeleteIds.remove(taskId) }
        do {
            try await client.deleteTask(taskId: taskId)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func runTask(_ taskId: String) async -> ScheduledTaskRunResponse? {
        guard pendingTaskRunIds.insert(taskId).inserted else {
            return nil
        }
        defer { pendingTaskRunIds.remove(taskId) }
        do {
            let response = try await client.runTask(taskId: taskId)
            errorMessage = nil
            return response
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listRuns() async -> DurableRunsListResponse? {
        do {
            let runs = try await client.listRuns()
            errorMessage = nil
            return runs
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRun(_ runId: String) async -> DurableRunDetailResponse? {
        do {
            let run = try await client.readRun(runId: runId)
            errorMessage = nil
            return run
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRunLog(_ runId: String, tail: Int? = 200) async -> DurableRunLogResponse? {
        do {
            let log = try await client.readRunLog(runId: runId, tail: tail)
            errorMessage = nil
            return log
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func cancelRun(_ runId: String) async -> DurableRunCancelResponse? {
        guard pendingRunCancelIds.insert(runId).inserted else {
            return nil
        }
        defer { pendingRunCancelIds.remove(runId) }
        do {
            let response = try await client.cancelRun(runId: runId)
            errorMessage = nil
            return response
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listSshTargets() async -> [CompanionSshTargetRecord] {
        do {
            let state = try await client.listSshTargets()
            sshTargets = state.hosts
            errorMessage = nil
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func saveSshTarget(id: String?, label: String, sshTarget: String) async -> [CompanionSshTargetRecord] {
        let saveKey = [id?.trimmed ?? "", label.trimmed, sshTarget.trimmed].joined(separator: "\u{1f}")
        guard pendingSshTargetSaveKeys.insert(saveKey).inserted else {
            return sshTargets
        }
        defer { pendingSshTargetSaveKeys.remove(saveKey) }
        do {
            let state = try await client.saveSshTarget(id: id, label: label, sshTarget: sshTarget)
            sshTargets = state.hosts
            executionTargets = [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + state.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
            errorMessage = nil
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return sshTargets
        }
    }

    func deleteSshTarget(_ targetId: String) async -> [CompanionSshTargetRecord] {
        guard pendingSshTargetDeleteIds.insert(targetId).inserted else {
            return sshTargets
        }
        defer { pendingSshTargetDeleteIds.remove(targetId) }
        do {
            let state = try await client.deleteSshTarget(targetId: targetId)
            sshTargets = state.hosts
            executionTargets = [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + state.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
            errorMessage = nil
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return sshTargets
        }
    }

    func testSshTarget(_ sshTarget: String) async -> CompanionSshTargetTestResult? {
        do {
            let result = try await client.testSshTarget(sshTarget: sshTarget)
            errorMessage = nil
            return result
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRemoteDirectory(targetId: String, path: String?) async -> CompanionRemoteDirectoryListing? {
        do {
            let listing = try await client.readRemoteDirectory(targetId: targetId, path: path)
            errorMessage = nil
            return listing
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readDeviceAdminState() async -> CompanionDeviceAdminState? {
        do {
            let state = try await client.readDeviceAdminState()
            errorMessage = nil
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createPairingCode() async -> CompanionPairingCodeRecord? {
        guard !isCreatingPairingCode else {
            return nil
        }
        isCreatingPairingCode = true
        defer { isCreatingPairingCode = false }
        do {
            let code = try await client.createPairingCode()
            errorMessage = nil
            return code
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createSetupState() async -> CompanionSetupState? {
        guard !isCreatingSetupState else {
            return nil
        }
        isCreatingSetupState = true
        defer { isCreatingSetupState = false }
        do {
            let state = try await client.createSetupState()
            errorMessage = nil
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func updatePairedDevice(_ deviceId: String, label: String) async -> CompanionDeviceAdminState? {
        let updateKey = [deviceId, label.trimmed].joined(separator: "\u{1f}")
        guard pendingPairedDeviceUpdateKeys.insert(updateKey).inserted else {
            return nil
        }
        defer { pendingPairedDeviceUpdateKeys.remove(updateKey) }
        do {
            let state = try await client.updatePairedDevice(deviceId: deviceId, deviceLabel: label)
            errorMessage = nil
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deletePairedDevice(_ deviceId: String) async -> CompanionDeviceAdminState? {
        guard pendingPairedDeviceDeleteIds.insert(deviceId).inserted else {
            return nil
        }
        defer { pendingPairedDeviceDeleteIds.remove(deviceId) }
        do {
            let state = try await client.deletePairedDevice(deviceId: deviceId)
            errorMessage = nil
            return state
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
                        appEventRevision += 1
                        applyConversationListState(state)
                    case .conversationListChanged:
                        appEventRevision += 1
                        refresh()
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
        errorMessage = nil
        currentOrdering = state.ordering
        let sessionIndex = Dictionary(uniqueKeysWithValues: state.sessions.map { ($0.id, $0) })
        sessions = sessionIndex
        executionTargets = state.executionTargets ?? []

        let pinnedOrder = Set(state.ordering.pinnedSessionIds)
        let archivedOrder = Set(state.ordering.archivedSessionIds)
        let sessionOrder = state.ordering.sessionIds
        let pinned: [SessionMeta] = sessionOrder.compactMap { (id: String) -> SessionMeta? in
            guard pinnedOrder.contains(id), !archivedOrder.contains(id) else { return nil }
            return sessionIndex[id]
        }
        let open: [SessionMeta] = sessionOrder.compactMap { (id: String) -> SessionMeta? in
            guard !pinnedOrder.contains(id), !archivedOrder.contains(id) else { return nil }
            return sessionIndex[id]
        }
        let archived: [SessionMeta] = state.ordering.archivedSessionIds.compactMap { sessionIndex[$0] }
        let orderedSet = Set(sessionOrder).union(archivedOrder)
        let recent = state.sessions
            .filter { !orderedSet.contains($0.id) }
            .sorted { lhs, rhs in
                (lhs.effectiveActivityDate ?? .distantPast) > (rhs.effectiveActivityDate ?? .distantPast)
            }

        sections = [
            pinned.isEmpty ? nil : ConversationListSection(id: "pinned", title: "Pinned", sessions: pinned),
            open.isEmpty ? nil : ConversationListSection(id: "open", title: "Open", sessions: open),
            archived.isEmpty ? nil : ConversationListSection(id: "archived", title: "Archived", sessions: archived),
            recent.isEmpty ? nil : ConversationListSection(id: "recent", title: "Recent", sessions: recent),
        ].compactMap { $0 }
    }

    private func saveOrdering(_ ordering: ConversationOrdering) async {
        do {
            try await client.updateConversationTabs(ordering: ordering)
            currentOrdering = ordering
            refresh()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
final class KnowledgeFolderPickerViewModel: ObservableObject {
    @Published private(set) var folders: [CompanionKnowledgeEntry] = []
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let directoryId: String?
    private let client: CompanionClientProtocol
    private let excludedFolderId: String?
    private var loadTask: Task<Void, Never>?
    private var loadRequestId = 0

    init(client: CompanionClientProtocol, directoryId: String?, excludedFolderId: String?) {
        self.client = client
        self.directoryId = directoryId?.trimmed.nilIfBlank?.replacingOccurrences(of: #"^/+|/+$"#, with: "", options: .regularExpression)
        self.excludedFolderId = excludedFolderId?.trimmed.nilIfBlank?.replacingOccurrences(of: #"^/+|/+$"#, with: "", options: .regularExpression)
    }

    deinit {
        loadTask?.cancel()
    }

    var title: String {
        guard let directoryId, !directoryId.isEmpty else {
            return "Knowledge"
        }
        return directoryId
            .replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
            .split(separator: "/")
            .last
            .map(String.init)
            ?? "Knowledge"
    }

    func load() {
        loadTask?.cancel()
        loadTask = Task {
            await reload()
        }
    }

    func stop() {
        loadRequestId += 1
        loadTask?.cancel()
        loadTask = nil
        isLoading = false
    }

    func reload() async {
        loadRequestId += 1
        let requestId = loadRequestId
        isLoading = true
        defer {
            if loadRequestId == requestId {
                isLoading = false
            }
        }
        do {
            let result = try await client.listKnowledgeEntries(directoryId: directoryId)
            if !Task.isCancelled, loadRequestId == requestId {
                folders = result.entries
                    .filter { entry in
                        guard entry.isDirectory else {
                            return false
                        }
                        guard let excludedFolderId else {
                            return true
                        }
                        let folderId = entry.id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
                        return folderId != excludedFolderId && !folderId.hasPrefix("\(excludedFolderId)/")
                    }
                    .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
                errorMessage = nil
            }
        } catch {
            if !Task.isCancelled, loadRequestId == requestId {
                errorMessage = error.localizedDescription
            }
        }
    }
}

@MainActor
final class KnowledgeDirectoryViewModel: ObservableObject {
    @Published private(set) var entries: [CompanionKnowledgeEntry] = []
    @Published private(set) var rootPath: String = ""
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    let directoryId: String?

    private let client: CompanionClientProtocol
    private var loadTask: Task<Void, Never>?
    private var loadRequestId = 0
    private var pendingCreateIds: Set<String> = []
    private var pendingMutationIds: Set<String> = []

    init(client: CompanionClientProtocol, directoryId: String?) {
        self.client = client
        self.directoryId = directoryId?.trimmed.nilIfBlank?.replacingOccurrences(of: #"^/+|/+$"#, with: "", options: .regularExpression)
    }

    deinit {
        loadTask?.cancel()
    }

    var title: String {
        guard let directoryId, !directoryId.isEmpty else {
            return "Knowledge"
        }
        return directoryId
            .replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
            .split(separator: "/")
            .last
            .map(String.init)
            ?? "Knowledge"
    }

    func load() {
        loadTask?.cancel()
        loadTask = Task {
            await reload()
        }
    }

    func stop() {
        loadRequestId += 1
        loadTask?.cancel()
        loadTask = nil
        isLoading = false
    }

    func reload() async {
        loadRequestId += 1
        let requestId = loadRequestId
        isLoading = true
        defer {
            if loadRequestId == requestId {
                isLoading = false
            }
        }
        do {
            let result = try await client.listKnowledgeEntries(directoryId: directoryId)
            if !Task.isCancelled, loadRequestId == requestId {
                rootPath = result.root
                entries = result.entries
                    .filter { $0.isDirectory || $0.isMarkdownFile }
                    .sorted { lhs, rhs in
                        if lhs.kind != rhs.kind {
                            return lhs.isDirectory
                        }
                        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
                    }
                errorMessage = nil
            }
        } catch {
            if !Task.isCancelled, loadRequestId == requestId {
                errorMessage = error.localizedDescription
            }
        }
    }

    func createNote(named rawName: String) async -> CompanionKnowledgeEntry? {
        let trimmed = rawName.trimmed
        guard !trimmed.isEmpty else {
            errorMessage = "Note name is required."
            return nil
        }
        let fileName = trimmed.lowercased().hasSuffix(".md") ? trimmed : "\(trimmed).md"
        guard !entries.contains(where: { $0.name.compare(fileName, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) else {
            errorMessage = "A note with that name already exists here."
            return nil
        }
        let fileId = if let directoryId, !directoryId.isEmpty {
            "\(directoryId)/\(fileName)"
        } else {
            fileName
        }
        guard pendingCreateIds.insert(fileId).inserted else {
            return nil
        }
        defer { pendingCreateIds.remove(fileId) }
        do {
            let created = try await client.writeKnowledgeFile(fileId: fileId, content: "")
            errorMessage = nil
            load()
            return created
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createFolder(named rawName: String) async -> CompanionKnowledgeEntry? {
        let trimmed = rawName.trimmed
        guard !trimmed.isEmpty else {
            errorMessage = "Folder name is required."
            return nil
        }
        guard !entries.contains(where: { $0.name.compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) else {
            errorMessage = "A folder with that name already exists here."
            return nil
        }
        let folderId = if let directoryId, !directoryId.isEmpty {
            "\(directoryId)/\(trimmed)"
        } else {
            trimmed
        }
        guard pendingCreateIds.insert(folderId).inserted else {
            return nil
        }
        defer { pendingCreateIds.remove(folderId) }
        do {
            let created = try await client.createKnowledgeFolder(folderId: folderId)
            errorMessage = nil
            load()
            return created
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func rename(entry: CompanionKnowledgeEntry, to rawName: String) async -> CompanionKnowledgeEntry? {
        let trimmed = rawName.trimmed
        guard !trimmed.isEmpty else {
            errorMessage = entry.isDirectory ? "Folder name is required." : "Note name is required."
            return nil
        }
        let finalName = entry.isDirectory || trimmed.lowercased().hasSuffix(".md") ? trimmed : "\(trimmed).md"
        guard !entries.contains(where: { $0.id != entry.id && $0.name.compare(finalName, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) else {
            errorMessage = "A file or folder with that name already exists here."
            return nil
        }
        guard pendingMutationIds.insert(entry.id).inserted else {
            return nil
        }
        defer { pendingMutationIds.remove(entry.id) }
        do {
            let renamed = try await client.renameKnowledgeEntry(id: entry.id, newName: finalName, parentId: nil)
            errorMessage = nil
            load()
            return renamed
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func move(entry: CompanionKnowledgeEntry, to rawDestinationFolder: String) async -> CompanionKnowledgeEntry? {
        let destinationFolder = rawDestinationFolder.trimmed.replacingOccurrences(of: #"^/+|/+$"#, with: "", options: .regularExpression)
        let normalizedEntryId = entry.id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        if entry.isDirectory, !destinationFolder.isEmpty, (destinationFolder == normalizedEntryId || destinationFolder.hasPrefix("\(normalizedEntryId)/")) {
            errorMessage = "A folder cannot be moved into itself. Physics remains undefeated."
            return nil
        }
        guard pendingMutationIds.insert(entry.id).inserted else {
            return nil
        }
        defer { pendingMutationIds.remove(entry.id) }
        do {
            let moved = try await client.renameKnowledgeEntry(id: entry.id, newName: entry.name, parentId: destinationFolder)
            errorMessage = nil
            load()
            return moved
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func delete(entry: CompanionKnowledgeEntry) async -> Bool {
        guard pendingMutationIds.insert(entry.id).inserted else {
            return false
        }
        defer { pendingMutationIds.remove(entry.id) }
        do {
            try await client.deleteKnowledgeEntry(id: entry.id)
            errorMessage = nil
            load()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

struct KnowledgeHeadingItem: Equatable, Identifiable {
    var id: Int { range.location }

    let level: Int
    let title: String
    let range: NSRange
}

struct KnowledgeWikiLinkContext: Equatable {
    let replaceRange: NSRange
    let query: String
}

struct KnowledgeNoteConflict: Equatable, Identifiable {
    let id = UUID()
    let reason: String
    let remoteContent: String
    let remoteUpdatedAt: String?
    let localDraft: String
}

struct KnowledgeDraftRecord: Codable, Equatable {
    let fileId: String
    var draft: String
    var baseUpdatedAt: String?
    var savedAt: String
}

struct ConversationComposerDraftRecord: Codable, Equatable {
    let draftKey: String
    var promptText: String
    var images: [ConversationComposerDraftImage]
    var attachmentRefs: [PromptAttachmentReference]
    var savedAt: String
}

struct ConversationComposerDraftImage: Codable, Equatable {
    let name: String
    let mimeType: String
    let base64Data: String

    init(_ draft: PromptImageDraft) {
        self.name = draft.name
        self.mimeType = draft.mimeType
        self.base64Data = draft.base64Data
    }

    var promptImageDraft: PromptImageDraft {
        PromptImageDraft(
            name: name,
            mimeType: mimeType,
            base64Data: base64Data,
            previewData: Data(base64Encoded: base64Data) ?? Data()
        )
    }
}

final class ConversationComposerDraftStore {
    static let shared = ConversationComposerDraftStore()

    private let fileManager: FileManager
    private let directoryURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(fileManager: FileManager = .default, baseURL: URL? = nil) {
        self.fileManager = fileManager
        let root = baseURL
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.directoryURL = root.appendingPathComponent("ConversationComposerDrafts", isDirectory: true)
    }

    func load(draftKey: String) -> ConversationComposerDraftRecord? {
        let url = fileURL(for: draftKey)
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? decoder.decode(ConversationComposerDraftRecord.self, from: data)
    }

    func save(_ record: ConversationComposerDraftRecord) {
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let data = try encoder.encode(record)
            try data.write(to: fileURL(for: record.draftKey), options: [.atomic])
        } catch {
            // Keep draft storage best-effort so editing continues even if persistence fails.
        }
    }

    func remove(draftKey: String) {
        try? fileManager.removeItem(at: fileURL(for: draftKey))
    }

    func removeAll() {
        try? fileManager.removeItem(at: directoryURL)
    }

    private func fileURL(for draftKey: String) -> URL {
        let safeName = draftKey.replacingOccurrences(of: #"[^a-zA-Z0-9._-]"#, with: "_", options: .regularExpression)
        return directoryURL.appendingPathComponent("\(safeName).json")
    }
}

final class KnowledgeDraftStore {
    static let shared = KnowledgeDraftStore()

    private let fileManager: FileManager
    private let directoryURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(fileManager: FileManager = .default, baseURL: URL? = nil) {
        self.fileManager = fileManager
        let root = baseURL
            ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.directoryURL = root.appendingPathComponent("KnowledgeDrafts", isDirectory: true)
    }

    func load(fileId: String) -> KnowledgeDraftRecord? {
        let url = fileURL(for: fileId)
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }
        return try? decoder.decode(KnowledgeDraftRecord.self, from: data)
    }

    func save(_ record: KnowledgeDraftRecord) {
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            let data = try encoder.encode(record)
            try data.write(to: fileURL(for: record.fileId), options: [.atomic])
        } catch {
            // Keep draft storage best-effort so editing continues even if persistence fails.
        }
    }

    func remove(fileId: String) {
        try? fileManager.removeItem(at: fileURL(for: fileId))
    }

    func rename(from oldFileId: String, to newFileId: String) {
        guard oldFileId != newFileId, let record = load(fileId: oldFileId) else {
            return
        }
        remove(fileId: oldFileId)
        save(KnowledgeDraftRecord(fileId: newFileId, draft: record.draft, baseUpdatedAt: record.baseUpdatedAt, savedAt: record.savedAt))
    }

    private func fileURL(for fileId: String) -> URL {
        let safeName = fileId.replacingOccurrences(of: #"[^a-zA-Z0-9._-]"#, with: "_", options: .regularExpression)
        return directoryURL.appendingPathComponent("\(safeName).json")
    }
}

@MainActor
final class KnowledgeNoteViewModel: ObservableObject {
    @Published private(set) var content: String = ""
    @Published private(set) var updatedAt: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published private(set) var fileId: String
    @Published private(set) var statusMessage: String?
    @Published private(set) var currentWikiLinkContext: KnowledgeWikiLinkContext?
    @Published private(set) var linkSuggestions: [CompanionKnowledgeSearchResult] = []
    @Published var draft: String = "" {
        didSet {
            guard draft != oldValue else {
                return
            }
            handleDraftDidChange()
        }
    }
    @Published var conflict: KnowledgeNoteConflict?
    @Published var errorMessage: String?

    private let client: CompanionClientProtocol
    private let draftStore: KnowledgeDraftStore
    private var baseUpdatedAt: String?
    private var loadTask: Task<Void, Never>?
    private var loadRequestId = 0
    private var autosaveTask: Task<Void, Never>?
    private var linkSearchTask: Task<Void, Never>?
    private var currentSelectionRange = NSRange(location: 0, length: 0)
    private var isApplyingRemoteState = false
    private var pendingImageMarkdownCreateKeys: Set<String> = []
    private var pendingRenameKeys: Set<String> = []
    private var pendingDeleteIds: Set<String> = []

    init(client: CompanionClientProtocol, fileId: String, draftStore: KnowledgeDraftStore = .shared) {
        self.client = client
        self.fileId = fileId
        self.draftStore = draftStore
    }

    deinit {
        loadTask?.cancel()
        autosaveTask?.cancel()
        linkSearchTask?.cancel()
    }

    var fileNameTitle: String {
        knowledgeDisplayName(for: fileId)
    }

    var title: String {
        knowledgePrimaryHeading(in: draft).nilIfBlank ?? fileNameTitle
    }

    var isDirty: Bool {
        draft != content
    }

    var outline: [KnowledgeHeadingItem] {
        knowledgeOutlineHeadings(in: draft)
    }

    var suggestedFileName: String? {
        guard let heading = knowledgePrimaryHeading(in: draft)?.nilIfBlank else {
            return nil
        }
        let suggested = knowledgeSuggestedFileName(from: heading)
        return suggested.caseInsensitiveCompare(knowledgeMarkdownFileName(for: fileId)) == .orderedSame ? nil : suggested
    }

    var hasConflict: Bool {
        conflict != nil
    }

    func load() {
        loadTask?.cancel()
        loadRequestId += 1
        let requestId = loadRequestId
        isLoading = true
        loadTask = Task {
            defer {
                if loadRequestId == requestId {
                    isLoading = false
                }
            }
            do {
                let result = try await client.readKnowledgeFile(fileId: fileId)
                if !Task.isCancelled, loadRequestId == requestId {
                    applyRemoteFile(result)
                    errorMessage = nil
                }
            } catch {
                if !Task.isCancelled, loadRequestId == requestId {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func stop() {
        loadRequestId += 1
        loadTask?.cancel()
        loadTask = nil
        autosaveTask?.cancel()
        autosaveTask = nil
        linkSearchTask?.cancel()
        linkSearchTask = nil
        isLoading = false
    }

    func reload() {
        load()
    }

    func updateSelection(_ selectedRange: NSRange) {
        currentSelectionRange = selectedRange
        refreshWikiLinkAutocomplete()
    }

    func discardChanges() {
        autosaveTask?.cancel()
        linkSearchTask?.cancel()
        isApplyingRemoteState = true
        draft = content
        isApplyingRemoteState = false
        draftStore.remove(fileId: fileId)
        currentWikiLinkContext = nil
        linkSuggestions = []
        conflict = nil
        statusMessage = "Reverted to the last synced version."
        errorMessage = nil
    }

    @discardableResult
    func rename(to rawName: String) async -> Bool {
        let trimmed = rawName.trimmed
        guard !trimmed.isEmpty else {
            errorMessage = "Note name is required."
            return false
        }
        let finalName = trimmed.lowercased().hasSuffix(".md") ? trimmed : "\(trimmed).md"
        let renameKey = [fileId, finalName].joined(separator: "\u{1f}")
        guard pendingRenameKeys.insert(renameKey).inserted else {
            return false
        }
        defer { pendingRenameKeys.remove(renameKey) }
        do {
            let oldFileId = fileId
            let renamed = try await client.renameKnowledgeEntry(id: fileId, newName: finalName, parentId: nil)
            fileId = renamed.id
            updatedAt = renamed.updatedAt
            baseUpdatedAt = renamed.updatedAt
            draftStore.rename(from: oldFileId, to: renamed.id)
            errorMessage = nil
            statusMessage = "Renamed note."
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func renameFileToMatchTitle() async -> Bool {
        guard let suggestedFileName else {
            return false
        }
        return await rename(to: suggestedFileName)
    }

    @discardableResult
    func delete() async -> Bool {
        let deleteId = fileId
        guard pendingDeleteIds.insert(deleteId).inserted else {
            return false
        }
        defer { pendingDeleteIds.remove(deleteId) }
        do {
            try await client.deleteKnowledgeEntry(id: deleteId)
            autosaveTask?.cancel()
            draftStore.remove(fileId: deleteId)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func save() async -> Bool {
        await save(trigger: .manual)
    }

    @discardableResult
    func flushAutosaveIfNeeded() async -> Bool {
        guard isDirty else {
            return true
        }
        return await save(trigger: .background)
    }

    func acceptRemoteConflictVersion() {
        guard let conflict else {
            return
        }
        baseUpdatedAt = conflict.remoteUpdatedAt
        updatedAt = conflict.remoteUpdatedAt
        content = conflict.remoteContent
        isApplyingRemoteState = true
        draft = conflict.remoteContent
        isApplyingRemoteState = false
        draftStore.remove(fileId: fileId)
        self.conflict = nil
        errorMessage = nil
        statusMessage = "Loaded the newer host version."
    }

    func keepLocalConflictDraft() {
        guard let conflict else {
            return
        }
        baseUpdatedAt = conflict.remoteUpdatedAt
        updatedAt = conflict.remoteUpdatedAt
        content = conflict.remoteContent
        isApplyingRemoteState = true
        draft = conflict.localDraft
        isApplyingRemoteState = false
        persistDraftLocally()
        self.conflict = nil
        errorMessage = nil
        statusMessage = "Kept the local draft. Saving again will replace the host version."
    }

    func insertWikiLink(_ result: CompanionKnowledgeSearchResult) -> String {
        "[[\(result.title)]]"
    }

    func buildMarkdownLink(label: String, destination: String) -> String {
        let trimmedLabel = label.trimmed.nilIfBlank ?? destination
        return "[\(trimmedLabel)](\(destination))"
    }

    func searchKnowledge(query: String, limit: Int = 20) async -> [CompanionKnowledgeSearchResult] {
        do {
            let response = try await client.searchKnowledge(query: query, limit: limit)
            return response.results.filter { $0.id != fileId }
        } catch {
            return []
        }
    }

    func createImageMarkdown(data: Data, mimeType: String?, fileName: String?) async -> String? {
        let dataBase64 = data.base64EncodedString()
        let createKey = [fileName?.trimmed ?? "", mimeType?.trimmed ?? "", dataBase64].joined(separator: "\u{1f}")
        guard pendingImageMarkdownCreateKeys.insert(createKey).inserted else {
            return nil
        }
        defer { pendingImageMarkdownCreateKeys.remove(createKey) }
        do {
            let response = try await client.createKnowledgeImageAsset(
                fileName: fileName,
                mimeType: mimeType,
                dataBase64: dataBase64
            )
            let relativePath = knowledgeRelativePath(from: fileId, to: response.id)
            let alt = (fileName ?? response.id)
                .replacingOccurrences(of: #"\.[^.]+$"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: "-", with: " ")
            errorMessage = nil
            return "![\(alt)](\(relativePath))"
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    private enum SaveTrigger {
        case manual
        case autosave
        case background
    }

    @discardableResult
    private func save(trigger: SaveTrigger) async -> Bool {
        autosaveTask?.cancel()
        guard !isSaving else {
            return false
        }
        guard !hasConflict else {
            return false
        }
        guard isDirty else {
            return true
        }
        let draftToSave = draft
        isSaving = true
        defer { isSaving = false }
        do {
            let latest = try await client.readKnowledgeFile(fileId: fileId)
            if latest.updatedAt != baseUpdatedAt && latest.content != content {
                if latest.content == draftToSave {
                    applyRemoteFile(latest)
                    statusMessage = trigger == .autosave ? "Already up to date." : "Loaded latest host version."
                    return true
                }
                conflict = KnowledgeNoteConflict(
                    reason: "This note changed on the host while you were editing it.",
                    remoteContent: latest.content,
                    remoteUpdatedAt: latest.updatedAt,
                    localDraft: draftToSave
                )
                errorMessage = "This note changed on the host. Choose which version to keep."
                return false
            }

            let updated = try await client.writeKnowledgeFile(fileId: fileId, content: draftToSave)
            content = draftToSave
            updatedAt = updated.updatedAt
            baseUpdatedAt = updated.updatedAt
            errorMessage = nil
            if draft == draftToSave {
                draftStore.remove(fileId: fileId)
                statusMessage = switch trigger {
                case .manual: "Saved to the host."
                case .autosave: "Autosaved."
                case .background: "Saved before leaving the editor."
                }
            } else {
                persistDraftLocally()
                scheduleAutosave()
                statusMessage = "Saved previous edit. Still editing…"
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func applyRemoteFile(_ result: CompanionKnowledgeFileResponse) {
        let recoveredDraft = draftStore.load(fileId: fileId)
        content = result.content
        updatedAt = result.updatedAt
        baseUpdatedAt = result.updatedAt
        conflict = nil
        isApplyingRemoteState = true
        if let recoveredDraft, recoveredDraft.draft != result.content {
            if recoveredDraft.baseUpdatedAt != nil,
               recoveredDraft.baseUpdatedAt != result.updatedAt,
               result.content != recoveredDraft.draft {
                draft = recoveredDraft.draft
                conflict = KnowledgeNoteConflict(
                    reason: "Recovered an unsaved local draft, but the host note changed too.",
                    remoteContent: result.content,
                    remoteUpdatedAt: result.updatedAt,
                    localDraft: recoveredDraft.draft
                )
                statusMessage = "Recovered an unsaved local draft."
            } else {
                draft = recoveredDraft.draft
                statusMessage = "Recovered an unsaved local draft."
            }
        } else {
            draft = result.content
            draftStore.remove(fileId: fileId)
        }
        isApplyingRemoteState = false
        refreshWikiLinkAutocomplete()
    }

    private func handleDraftDidChange() {
        guard !isApplyingRemoteState else {
            return
        }
        conflict = nil
        if draft == content {
            autosaveTask?.cancel()
            draftStore.remove(fileId: fileId)
            statusMessage = nil
        } else {
            persistDraftLocally()
            scheduleAutosave()
            statusMessage = "Editing…"
        }
        refreshWikiLinkAutocomplete()
    }

    private func persistDraftLocally() {
        draftStore.save(KnowledgeDraftRecord(
            fileId: fileId,
            draft: draft,
            baseUpdatedAt: baseUpdatedAt,
            savedAt: ISO8601DateFormatter.flexible.string(from: .now)
        ))
    }

    private func scheduleAutosave() {
        autosaveTask?.cancel()
        guard isDirty else {
            return
        }
        autosaveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else {
                return
            }
            await self?.save(trigger: .autosave)
        }
    }

    private func refreshWikiLinkAutocomplete() {
        linkSearchTask?.cancel()
        guard let context = knowledgeCurrentWikiLinkContext(in: draft, selectedRange: currentSelectionRange) else {
            currentWikiLinkContext = nil
            linkSuggestions = []
            return
        }
        currentWikiLinkContext = context
        let query = context.query
        linkSearchTask = Task { [weak self] in
            guard let self else {
                return
            }
            let results = await self.searchKnowledge(query: query, limit: 8)
            guard !Task.isCancelled else {
                return
            }
            if self.currentWikiLinkContext == context {
                self.linkSuggestions = results
            }
        }
    }
}

func knowledgeDisplayName(for fileId: String) -> String {
    fileId
        .split(separator: "/")
        .last
        .map(String.init)?
        .replacingOccurrences(of: #"\.md$"#, with: "", options: .regularExpression)
        ?? "Note"
}

func knowledgeMarkdownFileName(for fileId: String) -> String {
    fileId
        .split(separator: "/")
        .last
        .map(String.init)
        ?? "note.md"
}

func knowledgeSuggestedFileName(from title: String) -> String {
    let slug = title
        .lowercased()
        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        .nilIfBlank ?? "note"
    return "\(slug).md"
}

func knowledgeOutlineHeadings(in text: String) -> [KnowledgeHeadingItem] {
    let nsText = text as NSString
    let fullRange = NSRange(location: 0, length: nsText.length)
    let regex = try? NSRegularExpression(pattern: #"^(#{1,6})\s+(.+?)\s*$"#, options: [.anchorsMatchLines])
    let matches = regex?.matches(in: text, options: [], range: fullRange) ?? []
    return matches.compactMap { match in
        guard match.numberOfRanges >= 3 else {
            return nil
        }
        let hashes = nsText.substring(with: match.range(at: 1))
        let title = nsText.substring(with: match.range(at: 2)).trimmed
        return KnowledgeHeadingItem(level: hashes.count, title: title, range: match.range)
    }
}

func knowledgePrimaryHeading(in text: String) -> String? {
    knowledgeOutlineHeadings(in: text).first(where: { $0.level == 1 })?.title
}

func knowledgeSelectionWordCount(in text: String, selectedRange: NSRange) -> Int {
    guard selectedRange.location != NSNotFound,
          selectedRange.location <= (text as NSString).length,
          selectedRange.length > 0 else {
        return 0
    }
    let safeRange = NSRange(location: selectedRange.location, length: min(selectedRange.length, (text as NSString).length - selectedRange.location))
    let substring = (text as NSString).substring(with: safeRange)
    return knowledgeWordCount(in: substring)
}

func knowledgeWordCount(in text: String) -> Int {
    text.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.count
}

func knowledgeFindRanges(of query: String, in text: String) -> [NSRange] {
    let trimmed = query.trimmed
    guard !trimmed.isEmpty else {
        return []
    }
    let nsText = text as NSString
    let lowerText = text.lowercased() as NSString
    let lowerQuery = trimmed.lowercased()
    var searchRange = NSRange(location: 0, length: nsText.length)
    var matches: [NSRange] = []
    while true {
        let found = lowerText.range(of: lowerQuery, options: [], range: searchRange)
        if found.location == NSNotFound {
            break
        }
        matches.append(found)
        let nextLocation = found.location + max(found.length, 1)
        guard nextLocation < nsText.length else {
            break
        }
        searchRange = NSRange(location: nextLocation, length: nsText.length - nextLocation)
    }
    return matches
}

func knowledgeCurrentWikiLinkContext(in text: String, selectedRange: NSRange) -> KnowledgeWikiLinkContext? {
    guard selectedRange.length == 0, selectedRange.location != NSNotFound else {
        return nil
    }
    let nsText = text as NSString
    guard selectedRange.location <= nsText.length else {
        return nil
    }
    let prefix = nsText.substring(to: selectedRange.location)
    guard let openRange = prefix.range(of: "[[", options: .backwards) else {
        return nil
    }
    let query = String(prefix[openRange.upperBound...])
    guard !query.contains("]"), !query.contains("\n"), !query.contains("|") else {
        return nil
    }
    let location = NSRange(openRange, in: prefix).location
    return KnowledgeWikiLinkContext(replaceRange: NSRange(location: location, length: selectedRange.location - location), query: query)
}

func knowledgeRelativePath(from sourceFileId: String, to targetId: String) -> String {
    let sourceComponents = sourceFileId.split(separator: "/").dropLast().map(String.init)
    let targetComponents = targetId.split(separator: "/").map(String.init)
    var commonPrefix = 0
    while commonPrefix < sourceComponents.count,
          commonPrefix < targetComponents.count,
          sourceComponents[commonPrefix] == targetComponents[commonPrefix] {
        commonPrefix += 1
    }
    let parentTraversal = Array(repeating: "..", count: sourceComponents.count - commonPrefix)
    let remainingTarget = Array(targetComponents.dropFirst(commonPrefix))
    let pathComponents = parentTraversal + remainingTarget
    return pathComponents.isEmpty ? "." : pathComponents.joined(separator: "/")
}

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published private(set) var title: String
    @Published private(set) var sessionMeta: SessionMeta?
    @Published private(set) var blocks: [DisplayBlock] = []
    @Published private(set) var executionTargets: [ExecutionTargetSummary]
    @Published private(set) var workspacePaths: [String]
    @Published private(set) var modelState: CompanionModelState?
    @Published private(set) var currentExecutionTargetId: String = "local"
    @Published private(set) var savedAttachments: [ConversationAttachmentSummary] = []
    @Published private(set) var presenceState: LiveSessionPresenceState?
    @Published private(set) var queuedSteeringPrompts: [QueuedPromptPreview] = []
    @Published private(set) var queuedFollowUpPrompts: [QueuedPromptPreview] = []
    @Published private(set) var parallelJobs: [ParallelPromptPreview] = []
    @Published private(set) var connectedRuns: [DurableRunSummary] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isStreaming = false
    @Published private(set) var isSubmittingPrompt = false
    @Published var errorMessage: String?
    @Published var composerNotice: String?
    @Published var promptText: String = "" {
        didSet {
            guard promptText != oldValue else {
                return
            }
            handleComposerDraftDidChange()
        }
    }
    @Published var promptImages: [PromptImageDraft] = [] {
        didSet {
            guard promptImages != oldValue else {
                return
            }
            handleComposerDraftDidChange()
        }
    }
    @Published var promptAttachmentRefs: [PromptAttachmentReference] = [] {
        didSet {
            guard promptAttachmentRefs != oldValue else {
                return
            }
            handleComposerDraftDidChange()
        }
    }

    let conversationId: String
    let installationSurfaceId: String

    private static let bootstrapTailBlocks = ConversationBootstrapRequestOptions.defaultTailBlocks

    private let client: CompanionClientProtocol
    private let composerDraftStore: ConversationComposerDraftStore
    private let composerDraftKey: String
    private let autoStartRunningSimulation: Bool
    private var didAutoStartRunningSimulation = false
    private var didRestoreComposerDraft = false
    private var isApplyingComposerDraft = false
    private var bootstrapLoadTask: Task<Void, Never>?
    private var attachmentRefreshTask: Task<Void, Never>?
    private var modelRefreshTask: Task<Void, Never>?
    private var streamTask: Task<Void, Never>?
    private var activityRefreshTask: Task<Void, Never>?
    private var activityRunsRefreshTask: Task<Void, Never>?
    private var executionTargetChangeTask: Task<Void, Never>?
    private var renameConversationTask: Task<Void, Never>?
    private var composerNoticeTask: Task<Void, Never>?
    private var composerDraftSaveTask: Task<Void, Never>?
    private var lastStreamingTextBlockId: String?
    private var lastStreamingThinkingBlockId: String?
    private var transcriptImageCache: [String: Data] = [:]
    private var liveConversationId: String?
    private var liveEventRevision = 0
    private var bootstrapLoadRequestId = 0
    private var attachmentRefreshRequestId = 0
    private var modelRefreshRequestId = 0
    private var activityRunsRefreshRequestId = 0
    private var executionTargetChangeRequestId = 0
    private var renameConversationRequestId = 0
    private var initialBootstrap: ConversationBootstrapEnvelope?
    private var firedDeferredResumeIds: Set<String> = []
    private var restoringQueuedPromptKeys: Set<String> = []
    private var pendingParallelJobActionKeys: Set<String> = []
    private var pendingCheckpointCreateKeys: Set<String> = []
    private var pendingDuplicateConversation = false
    private var pendingAbortConversation = false
    private var pendingTakeOverConversation = false
    private var pendingWorkingDirectoryChangeKeys: Set<String> = []
    private var pendingAutoModeSaveKeys: Set<String> = []
    private var pendingDeferredResumeFireIds: Set<String> = []
    private var pendingAttachmentCreateKeys: Set<String> = []
    private var pendingDeferredResumeCancelIds: Set<String> = []

    init(
        client: CompanionClientProtocol,
        conversationId: String,
        installationSurfaceId: String,
        initialSession: SessionMeta?,
        initialExecutionTargets: [ExecutionTargetSummary],
        initialWorkspacePaths: [String] = [],
        initialModelState: CompanionModelState? = nil,
        initialBootstrap: ConversationBootstrapEnvelope? = nil,
        composerDraftStore: ConversationComposerDraftStore = .shared
    ) {
        self.client = client
        self.conversationId = conversationId
        self.installationSurfaceId = installationSurfaceId
        self.sessionMeta = initialSession
        self.title = initialSession?.title ?? "Conversation"
        self.executionTargets = initialExecutionTargets
        self.workspacePaths = initialWorkspacePaths
        self.modelState = initialModelState
        self.initialBootstrap = initialBootstrap
        self.currentExecutionTargetId = initialSession?.remoteHostId ?? "local"
        self.composerDraftStore = composerDraftStore
        self.composerDraftKey = "\(client.host.hostInstanceId)::\(conversationId)"
        self.autoStartRunningSimulation = ProcessInfo.processInfo.environment["PA_IOS_AUTO_START_MOCK_RUNNING"] == "1"
    }

    var canSimulateRunningConversation: Bool {
        client.supportsRunningConversationSimulation
    }

    func start() {
        restoreComposerDraftIfNeeded()
        if let initialBootstrap {
            self.initialBootstrap = nil
            applyBootstrap(initialBootstrap)
        } else {
            loadBootstrap()
        }
        refreshModelState()
        refreshActivityRuns()
        startActivityRefreshLoop()
        updateConversationSubscription(isLive: sessionMeta?.isLive == true)
    }

    func stop() {
        bootstrapLoadTask?.cancel()
        bootstrapLoadTask = nil
        isLoading = false
        attachmentRefreshTask?.cancel()
        attachmentRefreshTask = nil
        modelRefreshTask?.cancel()
        modelRefreshTask = nil
        composerDraftSaveTask?.cancel()
        persistComposerDraftIfNeeded()
        streamTask?.cancel()
        streamTask = nil
        activityRefreshTask?.cancel()
        activityRefreshTask = nil
        activityRunsRefreshTask?.cancel()
        activityRunsRefreshTask = nil
        executionTargetChangeTask?.cancel()
        executionTargetChangeTask = nil
        renameConversationTask?.cancel()
        renameConversationTask = nil
        composerNoticeTask?.cancel()
        composerNoticeTask = nil
        transcriptImageCache.removeAll()
    }

    func loadBootstrap() {
        bootstrapLoadTask?.cancel()
        bootstrapLoadRequestId += 1
        let requestId = bootstrapLoadRequestId
        isLoading = true
        bootstrapLoadTask = Task {
            let eventRevisionAtRequest = liveEventRevision
            defer {
                if bootstrapLoadRequestId == requestId {
                    isLoading = false
                }
            }
            do {
                let envelope = try await client.conversationBootstrap(
                    conversationId: conversationId,
                    options: ConversationBootstrapRequestOptions(tailBlocks: Self.bootstrapTailBlocks)
                )
                if !Task.isCancelled && bootstrapLoadRequestId == requestId {
                    errorMessage = nil
                    applyBootstrap(envelope, eventRevisionAtRequest: eventRevisionAtRequest)
                }
            } catch {
                if !Task.isCancelled && bootstrapLoadRequestId == requestId {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func refreshAttachments() {
        attachmentRefreshTask?.cancel()
        attachmentRefreshRequestId += 1
        let requestId = attachmentRefreshRequestId
        attachmentRefreshTask = Task {
            do {
                let result = try await client.listAttachments(conversationId: conversationId)
                if !Task.isCancelled, attachmentRefreshRequestId == requestId {
                    savedAttachments = result.attachments
                }
            } catch {
                if !Task.isCancelled, attachmentRefreshRequestId == requestId {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func refreshModelState() {
        modelRefreshTask?.cancel()
        modelRefreshRequestId += 1
        let requestId = modelRefreshRequestId
        modelRefreshTask = Task {
            do {
                let state = try await client.readModels()
                if !Task.isCancelled, modelRefreshRequestId == requestId {
                    modelState = state
                }
            } catch {
                if !Task.isCancelled, modelRefreshRequestId == requestId {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    func sendPrompt(mode requestedMode: ConversationPromptSubmissionMode? = nil) {
        guard !isSubmittingPrompt else {
            return
        }
        let currentText = promptText
        let currentImages = promptImages
        let currentRefs = promptAttachmentRefs
        guard currentText.nilIfBlank != nil || !currentImages.isEmpty || !currentRefs.isEmpty else {
            return
        }
        let resolvedMode = requestedMode ?? (isStreaming ? .steer : .submit)
        isSubmittingPrompt = true
        Task {
            defer { isSubmittingPrompt = false }
            do {
                let targetConversationId = try await ensureLiveConversationForPrompt()
                try await client.promptConversation(
                    conversationId: targetConversationId,
                    text: currentText,
                    images: currentImages,
                    attachmentRefs: currentRefs,
                    mode: resolvedMode,
                    surfaceId: installationSurfaceId
                )
                clearComposerDraftState(
                    ifText: currentText,
                    images: currentImages,
                    attachmentRefs: currentRefs
                )
                if let notice = resolvedMode.noticeMessage {
                    showComposerNotice(notice)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func submitPlainPrompt(_ text: String, mode: ConversationPromptSubmissionMode = .submit) {
        guard !isSubmittingPrompt else {
            return
        }
        guard let trimmed = text.trimmed.nilIfBlank else {
            return
        }
        isSubmittingPrompt = true
        Task {
            defer { isSubmittingPrompt = false }
            do {
                let targetConversationId = try await ensureLiveConversationForPrompt()
                try await client.promptConversation(
                    conversationId: targetConversationId,
                    text: trimmed,
                    images: [],
                    attachmentRefs: [],
                    mode: mode,
                    surfaceId: installationSurfaceId
                )
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func ensureLiveConversationForPrompt() async throws -> String {
        if sessionMeta?.isLive == true {
            return liveConversationId ?? conversationId
        }

        guard let meta = sessionMeta else {
            return liveConversationId ?? conversationId
        }

        let envelope = try await client.resumeConversation(
            ResumeConversationRequest(
                sessionFile: meta.file,
                cwd: meta.cwd,
                executionTargetId: meta.remoteHostId ?? "local"
            )
        )
        applyBootstrap(envelope)
        return envelope.bootstrap.conversationId
    }

    func restoreQueuedPrompt(behavior: String, index: Int, previewId: String?) {
        let restoreKey = "\(behavior):\(previewId?.nilIfBlank ?? String(index))"
        guard restoringQueuedPromptKeys.insert(restoreKey).inserted else {
            return
        }
        Task {
            defer { restoringQueuedPromptKeys.remove(restoreKey) }
            do {
                let restored = try await client.restoreQueuedPrompt(
                    conversationId: conversationId,
                    behavior: behavior,
                    index: index,
                    previewId: previewId,
                    surfaceId: installationSurfaceId
                )
                let restoredImages = restored.images.map {
                    PromptImageDraft(
                        name: $0.name ?? "Image",
                        mimeType: $0.mimeType,
                        base64Data: $0.data,
                        previewData: Data(base64Encoded: $0.data) ?? Data()
                    )
                }
                let parts = [restored.text.trimmed.nilIfBlank, promptText.trimmed.nilIfBlank].compactMap { $0 }
                promptText = parts.joined(separator: "\n\n")
                if !restoredImages.isEmpty {
                    promptImages = restoredImages + promptImages
                }
                showComposerNotice("Queued prompt restored.")
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func manageParallelJob(_ jobId: String, action: String) {
        let actionKey = "\(jobId):\(action)"
        guard pendingParallelJobActionKeys.insert(actionKey).inserted else {
            return
        }
        Task {
            defer { pendingParallelJobActionKeys.remove(actionKey) }
            do {
                let result = try await client.manageParallelJob(
                    conversationId: conversationId,
                    jobId: jobId,
                    action: action,
                    surfaceId: installationSurfaceId
                )
                switch result.status {
                case "imported":
                    showComposerNotice("Parallel response imported.")
                    loadBootstrap()
                case "queued":
                    showComposerNotice("Parallel response queued.")
                case "skipped":
                    showComposerNotice("Parallel response skipped.")
                case "cancelled":
                    showComposerNotice("Parallel prompt cancelled.")
                default:
                    break
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func cancelConnectedRun(_ runId: String) {
        Task {
            do {
                _ = try await client.cancelRun(runId: runId)
                refreshActivityRuns()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func cancelDeferredResume(_ resumeId: String) {
        guard pendingDeferredResumeCancelIds.insert(resumeId).inserted else {
            return
        }
        Task {
            defer { pendingDeferredResumeCancelIds.remove(resumeId) }
            do {
                let result = try await client.cancelDeferredResume(conversationId: liveConversationId ?? conversationId, resumeId: resumeId)
                updateDeferredResumes(result.resumes)
                loadBootstrap()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func fireDeferredResume(_ resumeId: String) {
        guard pendingDeferredResumeFireIds.insert(resumeId).inserted else {
            return
        }
        Task {
            defer { pendingDeferredResumeFireIds.remove(resumeId) }
            do {
                let result = try await client.fireDeferredResume(conversationId: liveConversationId ?? conversationId, resumeId: resumeId)
                firedDeferredResumeIds.insert(resumeId)
                updateDeferredResumes(result.resumes)
                loadBootstrap()
                refreshActivityRuns()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func refreshActivityRuns() {
        activityRunsRefreshTask?.cancel()
        activityRunsRefreshRequestId += 1
        let requestId = activityRunsRefreshRequestId
        activityRunsRefreshTask = Task {
            do {
                let result = try await client.listRuns()
                let runs = result.runs.filter { run in
                    guard isActiveRunStatus(run.status?.status) else { return false }
                    let source = run.manifest?.source
                    if source?.id == conversationId || source?.id == liveConversationId {
                        return true
                    }
                    if source?.type == "deferred-resume",
                       let sourceId = source?.id,
                       (sessionMeta?.deferredResumes?.contains(where: { $0.id == sourceId }) == true || firedDeferredResumeIds.contains(sourceId)) {
                        return true
                    }
                    return false
                }
                if !Task.isCancelled, activityRunsRefreshRequestId == requestId {
                    connectedRuns = runs
                }
            } catch {
                // Activity runs are auxiliary; leave the conversation usable if this refresh misses.
            }
        }
    }

    private func startActivityRefreshLoop() {
        activityRefreshTask?.cancel()
        activityRefreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                if Task.isCancelled { break }
                self?.refreshActivityRuns()
            }
        }
    }

    private func updateDeferredResumes(_ resumes: [DeferredResumeSummary]) {
        guard var meta = sessionMeta else { return }
        meta.deferredResumes = resumes
        sessionMeta = meta
    }

    func abort() {
        guard !pendingAbortConversation else {
            return
        }
        pendingAbortConversation = true
        Task {
            defer { pendingAbortConversation = false }
            do {
                try await client.abortConversation(conversationId: conversationId)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func takeOver() {
        guard !pendingTakeOverConversation else {
            return
        }
        pendingTakeOverConversation = true
        Task {
            defer { pendingTakeOverConversation = false }
            do {
                try await client.takeOverConversation(conversationId: conversationId, surfaceId: installationSurfaceId)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func renameConversation(_ name: String) {
        let trimmed = name.trimmed
        guard !trimmed.isEmpty else { return }
        renameConversationTask?.cancel()
        renameConversationRequestId += 1
        let requestId = renameConversationRequestId
        renameConversationTask = Task {
            do {
                try await client.renameConversation(conversationId: conversationId, name: trimmed, surfaceId: installationSurfaceId)
                if !Task.isCancelled, renameConversationRequestId == requestId {
                    title = trimmed
                    renameConversationTask = nil
                }
            } catch {
                if !Task.isCancelled, renameConversationRequestId == requestId {
                    errorMessage = error.localizedDescription
                    renameConversationTask = nil
                }
            }
        }
    }

    func changeExecutionTarget(_ targetId: String) {
        if currentExecutionTargetId == targetId, executionTargetChangeTask == nil {
            return
        }
        executionTargetChangeTask?.cancel()
        executionTargetChangeRequestId += 1
        let requestId = executionTargetChangeRequestId
        if currentExecutionTargetId == targetId {
            executionTargetChangeTask = nil
            return
        }
        executionTargetChangeTask = Task {
            do {
                let envelope = try await client.changeExecutionTarget(conversationId: conversationId, executionTargetId: targetId)
                if !Task.isCancelled, executionTargetChangeRequestId == requestId {
                    applyBootstrap(envelope)
                    executionTargetChangeTask = nil
                }
            } catch {
                if !Task.isCancelled, executionTargetChangeRequestId == requestId {
                    errorMessage = error.localizedDescription
                    executionTargetChangeTask = nil
                }
            }
        }
    }

    func startRunningConversationSimulation() {
        guard canSimulateRunningConversation, !isStreaming else {
            return
        }
        Task {
            do {
                try await client.simulateRunningConversation(conversationId: conversationId)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func duplicateConversation() async -> String? {
        guard !pendingDuplicateConversation else {
            return nil
        }
        pendingDuplicateConversation = true
        defer { pendingDuplicateConversation = false }
        do {
            let duplicateId = try await client.duplicateConversation(conversationId: conversationId)
            errorMessage = nil
            return duplicateId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func changeWorkingDirectory(_ cwd: String) async -> ConversationCwdChangeResult? {
        let changeKey = cwd.trimmed
        guard pendingWorkingDirectoryChangeKeys.insert(changeKey).inserted else {
            return nil
        }
        defer { pendingWorkingDirectoryChangeKeys.remove(changeKey) }
        do {
            let result = try await client.changeConversationCwd(conversationId: conversationId, cwd: cwd, surfaceId: installationSurfaceId)
            errorMessage = nil
            return result
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRemoteDirectory(targetId: String, path: String?) async -> CompanionRemoteDirectoryListing? {
        do {
            return try await client.readRemoteDirectory(targetId: targetId, path: path)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func loadAutoModeState() async -> ConversationAutoModeState? {
        do {
            return try await client.readConversationAutoMode(conversationId: conversationId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveAutoMode(enabled: Bool) async -> ConversationAutoModeState? {
        let saveKey = enabled ? "enabled" : "disabled"
        guard pendingAutoModeSaveKeys.insert(saveKey).inserted else {
            return nil
        }
        defer { pendingAutoModeSaveKeys.remove(saveKey) }
        do {
            let state = try await client.updateConversationAutoMode(
                conversationId: conversationId,
                enabled: enabled,
                surfaceId: installationSurfaceId
            )
            errorMessage = nil
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func loadModelPreferences() async -> ConversationModelPreferencesState? {
        modelRefreshRequestId += 1
        let requestId = modelRefreshRequestId
        do {
            async let preferences = client.readConversationModelPreferences(conversationId: conversationId)
            async let models = client.readModels()
            let state = try await preferences
            let nextModels = try await models
            if modelRefreshRequestId == requestId {
                modelState = nextModels
            }
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveModelPreferences(model: String?, thinkingLevel: String?, serviceTier: String?) async -> ConversationModelPreferencesState? {
        modelRefreshRequestId += 1
        let requestId = modelRefreshRequestId
        do {
            let state = try await client.updateConversationModelPreferences(
                conversationId: conversationId,
                model: model?.nilIfBlank,
                thinkingLevel: thinkingLevel?.nilIfBlank,
                serviceTier: serviceTier?.nilIfBlank,
                surfaceId: installationSurfaceId
            )
            guard modelRefreshRequestId == requestId else {
                return state
            }
            if let model = model?.nilIfBlank, var meta = sessionMeta {
                let deferredResumes = meta.deferredResumes
                meta = SessionMeta(
                    id: meta.id,
                    file: meta.file,
                    timestamp: meta.timestamp,
                    cwd: meta.cwd,
                    cwdSlug: meta.cwdSlug,
                    model: model,
                    title: meta.title,
                    messageCount: meta.messageCount,
                    isRunning: meta.isRunning,
                    isLive: meta.isLive,
                    lastActivityAt: meta.lastActivityAt,
                    parentSessionFile: meta.parentSessionFile,
                    parentSessionId: meta.parentSessionId,
                    sourceRunId: meta.sourceRunId,
                    remoteHostId: meta.remoteHostId,
                    remoteHostLabel: meta.remoteHostLabel,
                    remoteConversationId: meta.remoteConversationId,
                    automationTaskId: meta.automationTaskId,
                    automationTitle: meta.automationTitle,
                    needsAttention: meta.needsAttention,
                    attentionUpdatedAt: meta.attentionUpdatedAt,
                    attentionUnreadMessageCount: meta.attentionUnreadMessageCount,
                    attentionUnreadActivityCount: meta.attentionUnreadActivityCount,
                    attentionActivityIds: meta.attentionActivityIds
                )
                meta.deferredResumes = deferredResumes
                sessionMeta = meta
            }
            errorMessage = nil
            refreshModelState()
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listArtifacts() async -> [ConversationArtifactSummary] {
        do {
            let artifacts = try await client.listConversationArtifacts(conversationId: conversationId)
            errorMessage = nil
            return artifacts
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readArtifact(_ artifactId: String) async -> ConversationArtifactRecord? {
        do {
            let artifact = try await client.readConversationArtifact(conversationId: conversationId, artifactId: artifactId)
            errorMessage = nil
            return artifact
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listCheckpoints() async -> [ConversationCommitCheckpointSummary] {
        do {
            let checkpoints = try await client.listConversationCheckpoints(conversationId: conversationId)
            errorMessage = nil
            return checkpoints
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readCheckpoint(_ checkpointId: String) async -> ConversationCommitCheckpointRecord? {
        do {
            let checkpoint = try await client.readConversationCheckpoint(conversationId: conversationId, checkpointId: checkpointId)
            errorMessage = nil
            return checkpoint
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createCheckpoint(message: String, paths: [String]) async -> ConversationCommitCheckpointRecord? {
        let normalizedPaths = paths.map { $0.trimmed }.sorted().joined(separator: "\u{1f}")
        let createKey = "\(message.trimmed)::\(normalizedPaths)"
        guard pendingCheckpointCreateKeys.insert(createKey).inserted else {
            return nil
        }
        defer { pendingCheckpointCreateKeys.remove(createKey) }
        do {
            let checkpoint = try await client.createConversationCheckpoint(conversationId: conversationId, message: message, paths: paths)
            errorMessage = nil
            return checkpoint
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func loadAttachment(_ attachmentId: String) async -> ConversationAttachmentRecord? {
        do {
            let attachment = try await client.readAttachment(conversationId: conversationId, attachmentId: attachmentId).attachment
            errorMessage = nil
            return attachment
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func downloadAttachmentAsset(attachmentId: String, asset: String, revision: Int?) async -> AttachmentAssetDownload? {
        do {
            let download = try await client.downloadAttachmentAsset(conversationId: conversationId, attachmentId: attachmentId, asset: asset, revision: revision)
            errorMessage = nil
            return download
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
            let draft = AttachmentEditorDraft(
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
            errorMessage = nil
            return draft
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveNewAttachment(_ draft: AttachmentEditorDraft) async -> Bool {
        let createKey = attachmentCreateKey(for: draft)
        guard pendingAttachmentCreateKeys.insert(createKey).inserted else {
            return false
        }
        defer { pendingAttachmentCreateKeys.remove(createKey) }
        do {
            let result = try await client.createAttachment(conversationId: conversationId, draft: draft)
            attachmentRefreshRequestId += 1
            savedAttachments = result.attachments
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func saveNewAttachmentAndAttach(_ draft: AttachmentEditorDraft) async -> Bool {
        let createKey = attachmentCreateKey(for: draft)
        guard pendingAttachmentCreateKeys.insert(createKey).inserted else {
            return false
        }
        defer { pendingAttachmentCreateKeys.remove(createKey) }
        do {
            let result = try await client.createAttachment(conversationId: conversationId, draft: draft)
            attachmentRefreshRequestId += 1
            savedAttachments = result.attachments
            attachDrawingReference(attachment: result.attachment.summary, revision: result.attachment.currentRevision)
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func attachmentCreateKey(for draft: AttachmentEditorDraft) -> String {
        [
            draft.title.trimmed,
            draft.note.trimmed,
            draft.sourceAsset?.fileName ?? "",
            draft.sourceAsset?.mimeType ?? "",
            draft.sourceAsset?.base64Data ?? "",
            draft.previewAsset?.fileName ?? "",
            draft.previewAsset?.mimeType ?? "",
            draft.previewAsset?.base64Data ?? ""
        ].joined(separator: "\u{1f}")
    }

    func saveExistingAttachment(attachmentId: String, draft: AttachmentEditorDraft) async -> Bool {
        do {
            let result = try await client.updateAttachment(conversationId: conversationId, attachmentId: attachmentId, draft: draft)
            attachmentRefreshRequestId += 1
            savedAttachments = result.attachments
            errorMessage = nil
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

    func loadTranscriptImageData(src: String?) async -> Data? {
        if let data = dataURLData(src) {
            return data
        }
        guard let assetPath = companionTranscriptImageAssetPath(src) else {
            return nil
        }
        if let cached = transcriptImageCache[assetPath] {
            return cached
        }
        do {
            let asset = try await client.downloadCompanionAsset(path: assetPath)
            transcriptImageCache[assetPath] = asset.data
            return asset.data
        } catch {
            return nil
        }
    }

    private func showComposerNotice(_ message: String) {
        composerNoticeTask?.cancel()
        composerNotice = message
        composerNoticeTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            if !Task.isCancelled {
                composerNotice = nil
            }
        }
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

    private var hasComposerDraftContent: Bool {
        promptText.trimmed.nilIfBlank != nil || !promptImages.isEmpty || !promptAttachmentRefs.isEmpty
    }

    private func restoreComposerDraftIfNeeded() {
        guard !didRestoreComposerDraft else {
            return
        }
        didRestoreComposerDraft = true
        guard let record = composerDraftStore.load(draftKey: composerDraftKey) else {
            return
        }
        isApplyingComposerDraft = true
        promptText = record.promptText
        promptImages = record.images.map(\.promptImageDraft)
        promptAttachmentRefs = record.attachmentRefs
        isApplyingComposerDraft = false
    }

    private func handleComposerDraftDidChange() {
        guard !isApplyingComposerDraft else {
            return
        }
        composerDraftSaveTask?.cancel()
        composerDraftSaveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else {
                return
            }
            self.persistComposerDraftIfNeeded()
        }
    }

    private func persistComposerDraftIfNeeded() {
        guard hasComposerDraftContent else {
            composerDraftStore.remove(draftKey: composerDraftKey)
            return
        }
        composerDraftStore.save(ConversationComposerDraftRecord(
            draftKey: composerDraftKey,
            promptText: promptText,
            images: promptImages.map(ConversationComposerDraftImage.init),
            attachmentRefs: promptAttachmentRefs,
            savedAt: ISO8601DateFormatter.flexible.string(from: .now)
        ))
    }

    private func clearComposerDraftState(
        ifText submittedText: String,
        images submittedImages: [PromptImageDraft],
        attachmentRefs submittedAttachmentRefs: [PromptAttachmentReference]
    ) {
        guard promptText == submittedText,
              promptImages == submittedImages,
              promptAttachmentRefs == submittedAttachmentRefs else {
            persistComposerDraftIfNeeded()
            return
        }
        composerDraftSaveTask?.cancel()
        isApplyingComposerDraft = true
        promptText = ""
        promptImages.removeAll()
        promptAttachmentRefs.removeAll()
        isApplyingComposerDraft = false
        composerDraftStore.remove(draftKey: composerDraftKey)
    }

    private func updateConversationSubscription(isLive: Bool) {
        if isLive {
            if streamTask == nil {
                subscribeConversationEvents()
            }
            return
        }

        streamTask?.cancel()
        streamTask = nil
    }

    private func subscribeConversationEvents() {
        streamTask?.cancel()
        streamTask = Task {
            do {
                let stream = try await client.subscribeConversationEvents(conversationId: liveConversationId ?? conversationId, surfaceId: installationSurfaceId)
                for await event in stream {
                    if Task.isCancelled { break }
                    applyEvent(event)
                }
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                    streamTask = nil
                }
            }
        }
    }

    private func applyBootstrap(_ envelope: ConversationBootstrapEnvelope, eventRevisionAtRequest: Int? = nil) {
        errorMessage = nil
        let shouldApplyLiveSnapshot = eventRevisionAtRequest == nil || liveEventRevision == eventRevisionAtRequest
        liveConversationId = envelope.bootstrap.conversationId
        if shouldApplyLiveSnapshot {
            sessionMeta = envelope.sessionMeta ?? envelope.bootstrap.sessionDetail?.meta ?? sessionMeta
            title = sessionMeta?.title ?? envelope.bootstrap.liveSession.title ?? title
        }
        executionTargets = envelope.executionTargets
        if shouldApplyLiveSnapshot {
            currentExecutionTargetId = sessionMeta?.remoteHostId ?? envelope.bootstrap.sessionDetail?.meta.remoteHostId ?? "local"
        }
        savedAttachments = envelope.attachments?.attachments ?? savedAttachments
        if shouldApplyLiveSnapshot {
            isStreaming = envelope.bootstrap.liveSession.isStreaming ?? false
        }
        if let currentModel = sessionMeta?.model, let existingModelState = modelState {
            modelState = CompanionModelState(
                currentModel: currentModel,
                currentThinkingLevel: existingModelState.currentThinkingLevel,
                currentServiceTier: existingModelState.currentServiceTier,
                models: existingModelState.models
            )
        }

        if shouldApplyLiveSnapshot {
            if let detail = envelope.bootstrap.sessionDetail {
                blocks = detail.blocks
            } else if let appendOnly = envelope.bootstrap.sessionDetailAppendOnly {
                blocks.append(contentsOf: appendOnly.blocks)
            }
        }

        let isLiveConversation = envelope.bootstrap.liveSession.live || sessionMeta?.isLive == true
        updateConversationSubscription(isLive: isLiveConversation)
        maybeAutoStartRunningSimulation()
    }

    private func maybeAutoStartRunningSimulation() {
        guard autoStartRunningSimulation,
              canSimulateRunningConversation,
              !didAutoStartRunningSimulation,
              !isStreaming else {
            return
        }
        didAutoStartRunningSimulation = true
        startRunningConversationSimulation()
    }

    private func applyEvent(_ event: CompanionConversationEvent) {
        switch event {
        case .snapshot(let snapshotBlocks, _, _, let snapshotIsStreaming):
            errorMessage = nil
            liveEventRevision += 1
            blocks = snapshotBlocks
            if let snapshotIsStreaming {
                isStreaming = snapshotIsStreaming
            }
            lastStreamingTextBlockId = nil
            lastStreamingThinkingBlockId = nil
        case .agentStart:
            liveEventRevision += 1
            isStreaming = true
        case .agentEnd, .turnEnd:
            liveEventRevision += 1
            isStreaming = false
            lastStreamingTextBlockId = nil
            lastStreamingThinkingBlockId = nil
        case .userMessage(let block):
            liveEventRevision += 1
            blocks.append(block)
        case .queueState(let steering, let followUp):
            queuedSteeringPrompts = steering
            queuedFollowUpPrompts = followUp
        case .parallelState(let jobs):
            parallelJobs = jobs
        case .textDelta(let delta):
            liveEventRevision += 1
            appendStreamingDelta(type: "text", delta: delta)
        case .thinkingDelta(let delta):
            liveEventRevision += 1
            appendStreamingDelta(type: "thinking", delta: delta)
        case .toolStart(let toolCallId, let toolName, let args):
            liveEventRevision += 1
            let block = DisplayBlock(type: "tool_use", id: toolCallId, ts: ISO8601DateFormatter.flexible.string(from: .now), tool: toolName, input: args, output: "", toolCallId: toolCallId)
            blocks.append(block)
        case .toolUpdate(let toolCallId, let partialResult):
            liveEventRevision += 1
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
            liveEventRevision += 1
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
            liveEventRevision += 1
            title = nextTitle
        case .presenceState(let nextState):
            presenceState = nextState
        case .error(let message):
            liveEventRevision += 1
            errorMessage = message
            isStreaming = false
        case .open:
            errorMessage = nil
        case .close:
            break
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
