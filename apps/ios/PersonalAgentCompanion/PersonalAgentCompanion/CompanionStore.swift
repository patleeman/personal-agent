import Foundation
import Network
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
    private let environment: [String: String]
    private var transientTokens: [UUID: String] = [:]
    private let useMockMode: Bool

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

    func handleIncomingSetupURL(_ url: URL) async {
        guard let setupLink = CompanionSetupLink(url: url) else {
            bannerMessage = "That QR code or setup link is not a valid Personal Agent companion pairing link."
            return
        }

        await pairSetupLink(setupLink)
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
        guard let token = KeychainStore.shared.token(for: record.id) ?? transientTokens[record.id] else {
            bannerMessage = "The paired token for \(record.hostLabel) is missing. Pair it again."
            return
        }
        let client = LiveCompanionClient(host: record, token: token)
        let session = HostSessionModel(client: client, installationSurfaceId: installationSurfaceId)
        activeSession = session
        session.start()
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
            activeHostId = hosts.first?.id
            persistHosts()
        }
    }

    func refreshActiveSession() {
        activeSession?.refresh()
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
    private let client: CompanionClientProtocol
    private var currentOrdering = ConversationOrdering(sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [], workspacePaths: [])
    private var appEventsTask: Task<Void, Never>?

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
                async let conversationState = client.listConversations()
                async let models = client.readModels()
                async let sshTargetState = client.listSshTargets()
                let state = try await conversationState
                let nextModels = try await models
                let nextSshTargets = try await sshTargetState
                errorMessage = nil
                modelState = nextModels
                sshTargets = nextSshTargets.hosts
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
            initialExecutionTargets: executionTargets,
            initialWorkspacePaths: workspacePathOptions,
            initialModelState: modelState
        )
    }

    func createConversation(_ request: NewConversationRequest) async -> String? {
        do {
            let envelope = try await client.createConversation(request, surfaceId: installationSurfaceId)
            if let meta = envelope.sessionMeta {
                sessions[meta.id] = meta
            }
            refresh()
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
            refresh()
            return envelope.bootstrap.conversationId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func togglePinned(_ conversationId: String) async {
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
        var next = currentOrdering
        next.archivedSessionIds.removeAll { $0 == conversationId }
        if !next.sessionIds.contains(conversationId) {
            next.sessionIds.append(conversationId)
        }
        await saveOrdering(next)
    }

    func duplicateConversation(_ conversationId: String) async -> String? {
        do {
            let nextId = try await client.duplicateConversation(conversationId: conversationId)
            refresh()
            return nextId
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listTasks() async -> [ScheduledTaskSummary] {
        do {
            return try await client.listTasks()
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readTask(_ taskId: String) async -> ScheduledTaskDetail? {
        do {
            return try await client.readTask(taskId: taskId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readTaskLog(_ taskId: String) async -> DurableRunLogResponse? {
        do {
            return try await client.readTaskLog(taskId: taskId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveTask(taskId: String?, draft: ScheduledTaskEditorDraft) async -> ScheduledTaskDetail? {
        do {
            let task = if let taskId {
                try await client.updateTask(taskId: taskId, draft: draft)
            } else {
                try await client.createTask(draft: draft)
            }
            return task
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deleteTask(_ taskId: String) async -> Bool {
        do {
            try await client.deleteTask(taskId: taskId)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func runTask(_ taskId: String) async -> ScheduledTaskRunResponse? {
        do {
            return try await client.runTask(taskId: taskId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listRuns() async -> DurableRunsListResponse? {
        do {
            return try await client.listRuns()
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRun(_ runId: String) async -> DurableRunDetailResponse? {
        do {
            return try await client.readRun(runId: runId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func readRunLog(_ runId: String, tail: Int? = 200) async -> DurableRunLogResponse? {
        do {
            return try await client.readRunLog(runId: runId, tail: tail)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func cancelRun(_ runId: String) async -> DurableRunCancelResponse? {
        do {
            return try await client.cancelRun(runId: runId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listSshTargets() async -> [CompanionSshTargetRecord] {
        do {
            let state = try await client.listSshTargets()
            sshTargets = state.hosts
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func saveSshTarget(id: String?, label: String, sshTarget: String) async -> [CompanionSshTargetRecord] {
        do {
            let state = try await client.saveSshTarget(id: id, label: label, sshTarget: sshTarget)
            sshTargets = state.hosts
            executionTargets = [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + state.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return sshTargets
        }
    }

    func deleteSshTarget(_ targetId: String) async -> [CompanionSshTargetRecord] {
        do {
            let state = try await client.deleteSshTarget(targetId: targetId)
            sshTargets = state.hosts
            executionTargets = [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + state.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
            return state.hosts
        } catch {
            errorMessage = error.localizedDescription
            return sshTargets
        }
    }

    func testSshTarget(_ sshTarget: String) async -> CompanionSshTargetTestResult? {
        do {
            return try await client.testSshTarget(sshTarget: sshTarget)
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

    func readDeviceAdminState() async -> CompanionDeviceAdminState? {
        do {
            return try await client.readDeviceAdminState()
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createPairingCode() async -> CompanionPairingCodeRecord? {
        do {
            return try await client.createPairingCode()
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createSetupState() async -> CompanionSetupState? {
        do {
            return try await client.createSetupState()
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func updatePairedDevice(_ deviceId: String, label: String) async -> CompanionDeviceAdminState? {
        do {
            return try await client.updatePairedDevice(deviceId: deviceId, deviceLabel: label)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deletePairedDevice(_ deviceId: String) async -> CompanionDeviceAdminState? {
        do {
            return try await client.deletePairedDevice(deviceId: deviceId)
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
                    case .conversationListChanged:
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
        } catch {
            errorMessage = error.localizedDescription
        }
    }
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
    @Published private(set) var isLoading = false
    @Published private(set) var isStreaming = false
    @Published var errorMessage: String?
    @Published var composerNotice: String?
    @Published var promptText: String = ""
    @Published var promptImages: [PromptImageDraft] = []
    @Published var promptAttachmentRefs: [PromptAttachmentReference] = []

    let conversationId: String
    let installationSurfaceId: String

    private let client: CompanionClientProtocol
    private let autoStartRunningSimulation: Bool
    private var didAutoStartRunningSimulation = false
    private var streamTask: Task<Void, Never>?
    private var composerNoticeTask: Task<Void, Never>?
    private var lastStreamingTextBlockId: String?
    private var lastStreamingThinkingBlockId: String?

    init(
        client: CompanionClientProtocol,
        conversationId: String,
        installationSurfaceId: String,
        initialSession: SessionMeta?,
        initialExecutionTargets: [ExecutionTargetSummary],
        initialWorkspacePaths: [String] = [],
        initialModelState: CompanionModelState? = nil
    ) {
        self.client = client
        self.conversationId = conversationId
        self.installationSurfaceId = installationSurfaceId
        self.sessionMeta = initialSession
        self.title = initialSession?.title ?? "Conversation"
        self.executionTargets = initialExecutionTargets
        self.workspacePaths = initialWorkspacePaths
        self.modelState = initialModelState
        self.currentExecutionTargetId = initialSession?.remoteHostId ?? "local"
        self.autoStartRunningSimulation = ProcessInfo.processInfo.environment["PA_IOS_AUTO_START_MOCK_RUNNING"] == "1"
    }

    var canSimulateRunningConversation: Bool {
        client.supportsRunningConversationSimulation
    }

    func start() {
        loadBootstrap()
        refreshModelState()
        subscribeConversationEvents()
    }

    func stop() {
        streamTask?.cancel()
        streamTask = nil
        composerNoticeTask?.cancel()
        composerNoticeTask = nil
    }

    func loadBootstrap() {
        Task {
            isLoading = true
            defer { isLoading = false }
            do {
                let envelope = try await client.conversationBootstrap(conversationId: conversationId)
                errorMessage = nil
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

    func refreshModelState() {
        Task {
            do {
                modelState = try await client.readModels()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func sendPrompt(mode requestedMode: ConversationPromptSubmissionMode? = nil) {
        let currentText = promptText
        let currentImages = promptImages
        let currentRefs = promptAttachmentRefs
        guard currentText.nilIfBlank != nil || !currentImages.isEmpty || !currentRefs.isEmpty else {
            return
        }
        let resolvedMode = requestedMode ?? (isStreaming ? .steer : .submit)
        Task {
            do {
                try await client.promptConversation(
                    conversationId: conversationId,
                    text: currentText,
                    images: currentImages,
                    attachmentRefs: currentRefs,
                    mode: resolvedMode,
                    surfaceId: installationSurfaceId
                )
                promptText = ""
                promptImages.removeAll()
                promptAttachmentRefs.removeAll()
                if let notice = resolvedMode.noticeMessage {
                    showComposerNotice(notice)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func submitPlainPrompt(_ text: String, mode: ConversationPromptSubmissionMode = .submit) {
        guard let trimmed = text.trimmed.nilIfBlank else {
            return
        }
        Task {
            do {
                try await client.promptConversation(
                    conversationId: conversationId,
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

    func restoreQueuedPrompt(behavior: String, index: Int, previewId: String?) {
        Task {
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
        Task {
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
        do {
            return try await client.duplicateConversation(conversationId: conversationId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func changeWorkingDirectory(_ cwd: String) async -> ConversationCwdChangeResult? {
        do {
            return try await client.changeConversationCwd(conversationId: conversationId, cwd: cwd, surfaceId: installationSurfaceId)
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

    func loadModelPreferences() async -> ConversationModelPreferencesState? {
        do {
            async let preferences = client.readConversationModelPreferences(conversationId: conversationId)
            async let models = client.readModels()
            let state = try await preferences
            modelState = try await models
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func saveModelPreferences(model: String?, thinkingLevel: String?, serviceTier: String?) async -> ConversationModelPreferencesState? {
        do {
            let state = try await client.updateConversationModelPreferences(
                conversationId: conversationId,
                model: model?.nilIfBlank,
                thinkingLevel: thinkingLevel?.nilIfBlank,
                serviceTier: serviceTier?.nilIfBlank,
                surfaceId: installationSurfaceId
            )
            if let model = model?.nilIfBlank, var meta = sessionMeta {
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
                sessionMeta = meta
            }
            refreshModelState()
            return state
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listArtifacts() async -> [ConversationArtifactSummary] {
        do {
            return try await client.listConversationArtifacts(conversationId: conversationId)
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readArtifact(_ artifactId: String) async -> ConversationArtifactRecord? {
        do {
            return try await client.readConversationArtifact(conversationId: conversationId, artifactId: artifactId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func listCheckpoints() async -> [ConversationCommitCheckpointSummary] {
        do {
            return try await client.listConversationCheckpoints(conversationId: conversationId)
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func readCheckpoint(_ checkpointId: String) async -> ConversationCommitCheckpointRecord? {
        do {
            return try await client.readConversationCheckpoint(conversationId: conversationId, checkpointId: checkpointId)
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func createCheckpoint(message: String, paths: [String]) async -> ConversationCommitCheckpointRecord? {
        do {
            return try await client.createConversationCheckpoint(conversationId: conversationId, message: message, paths: paths)
        } catch {
            errorMessage = error.localizedDescription
            return nil
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
        errorMessage = nil
        sessionMeta = envelope.sessionMeta ?? envelope.bootstrap.sessionDetail?.meta ?? sessionMeta
        title = sessionMeta?.title ?? envelope.bootstrap.liveSession.title ?? title
        executionTargets = envelope.executionTargets
        currentExecutionTargetId = sessionMeta?.remoteHostId ?? envelope.bootstrap.sessionDetail?.meta.remoteHostId ?? "local"
        savedAttachments = envelope.attachments?.attachments ?? savedAttachments
        isStreaming = envelope.bootstrap.liveSession.isStreaming ?? false
        if let currentModel = sessionMeta?.model, let existingModelState = modelState {
            modelState = CompanionModelState(
                currentModel: currentModel,
                currentThinkingLevel: existingModelState.currentThinkingLevel,
                currentServiceTier: existingModelState.currentServiceTier,
                models: existingModelState.models
            )
        }

        if let detail = envelope.bootstrap.sessionDetail {
            blocks = detail.blocks
        } else if let appendOnly = envelope.bootstrap.sessionDetailAppendOnly {
            blocks.append(contentsOf: appendOnly.blocks)
        }

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
        case .snapshot(let snapshotBlocks, _, _):
            errorMessage = nil
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
        case .queueState(let steering, let followUp):
            queuedSteeringPrompts = steering
            queuedFollowUpPrompts = followUp
        case .parallelState(let jobs):
            parallelJobs = jobs
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
            errorMessage = nil
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
