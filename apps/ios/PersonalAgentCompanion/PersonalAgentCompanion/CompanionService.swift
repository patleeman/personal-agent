import Foundation
import Security

@MainActor
protocol CompanionClientProtocol: AnyObject {
    var host: CompanionHostRecord { get }

    func hello() async throws -> CompanionHello
    func connect() async throws
    func disconnect()
    func listConversations() async throws -> ConversationListState
    func updateConversationTabs(ordering: ConversationOrdering) async throws
    func duplicateConversation(conversationId: String) async throws -> String
    func listExecutionTargets() async throws -> [ExecutionTargetSummary]
    func conversationBootstrap(conversationId: String) async throws -> ConversationBootstrapEnvelope
    func createConversation(_ input: NewConversationRequest, surfaceId: String) async throws -> ConversationBootstrapEnvelope
    func resumeConversation(_ input: ResumeConversationRequest) async throws -> ConversationBootstrapEnvelope
    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], surfaceId: String) async throws
    func abortConversation(conversationId: String) async throws
    func takeOverConversation(conversationId: String, surfaceId: String) async throws
    func renameConversation(conversationId: String, name: String, surfaceId: String) async throws
    func changeConversationCwd(conversationId: String, cwd: String, surfaceId: String) async throws -> ConversationCwdChangeResult
    func readConversationModelPreferences(conversationId: String) async throws -> ConversationModelPreferencesState
    func updateConversationModelPreferences(conversationId: String, model: String?, thinkingLevel: String?, serviceTier: String?, surfaceId: String) async throws -> ConversationModelPreferencesState
    func listConversationArtifacts(conversationId: String) async throws -> [ConversationArtifactSummary]
    func readConversationArtifact(conversationId: String, artifactId: String) async throws -> ConversationArtifactRecord
    func listConversationCheckpoints(conversationId: String) async throws -> [ConversationCommitCheckpointSummary]
    func readConversationCheckpoint(conversationId: String, checkpointId: String) async throws -> ConversationCommitCheckpointRecord
    func changeExecutionTarget(conversationId: String, executionTargetId: String) async throws -> ConversationBootstrapEnvelope
    func listAttachments(conversationId: String) async throws -> ConversationAttachmentListResponse
    func readAttachment(conversationId: String, attachmentId: String) async throws -> ConversationAttachmentDetailResponse
    func downloadAttachmentAsset(conversationId: String, attachmentId: String, asset: String, revision: Int?) async throws -> AttachmentAssetDownload
    func createAttachment(conversationId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse
    func updateAttachment(conversationId: String, attachmentId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse
    func listTasks() async throws -> [ScheduledTaskSummary]
    func readTask(taskId: String) async throws -> ScheduledTaskDetail
    func readTaskLog(taskId: String) async throws -> DurableRunLogResponse
    func createTask(draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail
    func updateTask(taskId: String, draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail
    func deleteTask(taskId: String) async throws
    func runTask(taskId: String) async throws -> ScheduledTaskRunResponse
    func listRuns() async throws -> DurableRunsListResponse
    func readRun(runId: String) async throws -> DurableRunDetailResponse
    func readRunLog(runId: String, tail: Int?) async throws -> DurableRunLogResponse
    func cancelRun(runId: String) async throws -> DurableRunCancelResponse
    func readDeviceAdminState() async throws -> CompanionDeviceAdminState
    func createPairingCode() async throws -> CompanionPairingCodeRecord
    func createSetupState() async throws -> CompanionSetupState
    func updatePairedDevice(deviceId: String, deviceLabel: String) async throws -> CompanionDeviceAdminState
    func deletePairedDevice(deviceId: String) async throws -> CompanionDeviceAdminState
    func subscribeAppEvents() async throws -> AsyncStream<CompanionAppEvent>
    func subscribeConversationEvents(conversationId: String, surfaceId: String) async throws -> AsyncStream<CompanionConversationEvent>
}

struct AttachmentAssetDownload: Equatable {
    let data: Data
    let mimeType: String
    let fileName: String?
}

enum CompanionAppEvent: Equatable {
    case conversationListState(ConversationListState)
    case conversationListChanged
    case open
    case close
    case error(String)
}

enum CompanionClientError: LocalizedError, Equatable {
    case invalidHostURL
    case missingToken
    case transportUnavailable
    case requestFailed(String)
    case invalidResponse
    case socketClosed
    case notImplementedInMock

    var errorDescription: String? {
        switch self {
        case .invalidHostURL:
            return "The host URL is invalid."
        case .missingToken:
            return "This host is missing a paired device token. Pair it again."
        case .transportUnavailable:
            return "The companion connection is unavailable."
        case .requestFailed(let message):
            return message
        case .invalidResponse:
            return "The host returned a malformed response."
        case .socketClosed:
            return "The companion socket closed."
        case .notImplementedInMock:
            return "This action is unavailable in mock mode."
        }
    }
}

final class KeychainStore {
    static let shared = KeychainStore()

    private init() {}

    func token(for hostId: UUID) -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.personalagent.ios.companion.token",
            kSecAttrAccount: hostId.uuidString,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            return nil
        }
        guard let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func setToken(_ token: String, for hostId: UUID) -> Bool {
        let account = hostId.uuidString
        let data = Data(token.utf8)
        let baseQuery: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.personalagent.ios.companion.token",
            kSecAttrAccount: account,
        ]
        SecItemDelete(baseQuery as CFDictionary)
        let attributes: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd((baseQuery.merging(attributes) { _, new in new }) as CFDictionary, nil)
        return status == errSecSuccess
    }

    func removeToken(for hostId: UUID) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.personalagent.ios.companion.token",
            kSecAttrAccount: hostId.uuidString,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

@MainActor
final class LiveCompanionClient: CompanionClientProtocol {
    private struct PendingResponse {
        let complete: (Result<Any, Error>) -> Void
    }

    let host: CompanionHostRecord

    private let token: String
    private let urlSession: URLSession
    private let decoder = JSONDecoder()
    private var socket: URLSessionWebSocketTask?
    private var connectionState: ConnectionState = .disconnected
    private var connectionWaiters: [CheckedContinuation<Void, Error>] = []
    private var pendingResponses: [String: PendingResponse] = [:]
    private var appContinuations: [UUID: AsyncStream<CompanionAppEvent>.Continuation] = [:]
    private var conversationContinuations: [String: [UUID: AsyncStream<CompanionConversationEvent>.Continuation]] = [:]
    private var appSubscriptionActive = false
    private var conversationSubscriptionCounts: [String: Int] = [:]

    private enum ConnectionState {
        case disconnected
        case connecting
        case connected
    }

    init(host: CompanionHostRecord, token: String, urlSession: URLSession = .shared) {
        self.host = host
        self.token = token
        self.urlSession = urlSession
    }

    static func hello(baseURL: URL, urlSession: URLSession = .shared) async throws -> CompanionHello {
        let url = baseURL.appending(path: "/companion/v1/hello")
        let (data, response) = try await urlSession.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(CompanionHello.self, from: data)
    }

    static func pair(baseURL: URL, code: String, deviceLabel: String, urlSession: URLSession = .shared) async throws -> CompanionPairResult {
        let url = baseURL.appending(path: "/companion/v1/auth/pair")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "code": code,
            "deviceLabel": deviceLabel,
        ])
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(CompanionPairResult.self, from: data)
    }

    func hello() async throws -> CompanionHello {
        guard let url = host.normalizedBaseURL else {
            throw CompanionClientError.invalidHostURL
        }
        return try await Self.hello(baseURL: url, urlSession: urlSession)
    }

    func connect() async throws {
        try await connectIfNeeded()
    }

    func disconnect() {
        closeSocket(error: nil)
    }

    func listConversations() async throws -> ConversationListState {
        try await authorizedJSON(path: "/companion/v1/conversations", method: "GET", body: nil, decode: ConversationListState.self)
    }

    func updateConversationTabs(ordering: ConversationOrdering) async throws {
        struct ResponsePayload: Decodable {}
        _ = try await authorizedJSON(path: "/companion/v1/conversations/layout", method: "PATCH", body: [
            "sessionIds": ordering.sessionIds,
            "pinnedSessionIds": ordering.pinnedSessionIds,
            "archivedSessionIds": ordering.archivedSessionIds,
            "workspacePaths": ordering.workspacePaths,
        ], decode: ResponsePayload.self)
    }

    func duplicateConversation(conversationId: String) async throws -> String {
        struct ResponsePayload: Decodable {
            let newSessionId: String
        }

        return try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/duplicate",
            method: "POST",
            body: nil,
            decode: ResponsePayload.self
        ).newSessionId
    }

    func listExecutionTargets() async throws -> [ExecutionTargetSummary] {
        struct ResultPayload: Decodable { let executionTargets: [ExecutionTargetSummary] }
        return try await sendCommand(name: "executionTargets.list", payload: [:], as: ResultPayload.self).executionTargets
    }

    func conversationBootstrap(conversationId: String) async throws -> ConversationBootstrapEnvelope {
        try await sendCommand(name: "conversation.bootstrap", payload: ["conversationId": conversationId], as: ConversationBootstrapEnvelope.self)
    }

    func createConversation(_ input: NewConversationRequest, surfaceId: String) async throws -> ConversationBootstrapEnvelope {
        var payload: [String: Any] = [
            "executionTargetId": input.executionTargetId,
        ]
        if let cwd = input.cwd.nilIfBlank {
            payload["cwd"] = cwd
        }
        if let model = input.model.nilIfBlank {
            payload["model"] = model
        }
        if let thinkingLevel = input.thinkingLevel.nilIfBlank {
            payload["thinkingLevel"] = thinkingLevel
        }
        if let serviceTier = input.serviceTier.nilIfBlank {
            payload["serviceTier"] = serviceTier
        }
        if let promptText = input.promptText.nilIfBlank {
            payload["prompt"] = [
                "text": promptText,
                "surfaceId": surfaceId,
            ]
        }
        return try await sendCommand(name: "conversation.create", payload: payload, as: ConversationBootstrapEnvelope.self)
    }

    func resumeConversation(_ input: ResumeConversationRequest) async throws -> ConversationBootstrapEnvelope {
        var payload: [String: Any] = [
            "sessionFile": input.sessionFile,
            "executionTargetId": input.executionTargetId,
        ]
        if let cwd = input.cwd.nilIfBlank {
            payload["cwd"] = cwd
        }
        return try await sendCommand(name: "conversation.resume", payload: payload, as: ConversationBootstrapEnvelope.self)
    }

    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], surfaceId: String) async throws {
        var payload: [String: Any] = [
            "conversationId": conversationId,
            "surfaceId": surfaceId,
        ]
        if let trimmed = text.nilIfBlank {
            payload["text"] = trimmed
        }
        if !images.isEmpty {
            payload["images"] = images.map { image in
                [
                    "name": image.name,
                    "mimeType": image.mimeType,
                    "data": image.base64Data,
                ]
            }
        }
        if !attachmentRefs.isEmpty {
            payload["attachmentRefs"] = attachmentRefs.map { ref in
                var object: [String: Any] = ["attachmentId": ref.attachmentId]
                if let revision = ref.revision {
                    object["revision"] = revision
                }
                return object
            }
        }
        struct ResponsePayload: Decodable { let ok: Bool }
        _ = try await sendCommand(name: "conversation.prompt", payload: payload, as: ResponsePayload.self)
    }

    func abortConversation(conversationId: String) async throws {
        struct ResponsePayload: Decodable { let ok: Bool }
        _ = try await sendCommand(name: "conversation.abort", payload: ["conversationId": conversationId], as: ResponsePayload.self)
    }

    func takeOverConversation(conversationId: String, surfaceId: String) async throws {
        struct ResponsePayload: Decodable { let ok: Bool }
        _ = try await sendCommand(name: "conversation.takeover", payload: [
            "conversationId": conversationId,
            "surfaceId": surfaceId,
        ], as: ResponsePayload.self)
    }

    func renameConversation(conversationId: String, name: String, surfaceId: String) async throws {
        struct ResponsePayload: Decodable { let ok: Bool }
        _ = try await sendCommand(name: "conversation.rename", payload: [
            "conversationId": conversationId,
            "name": name,
            "surfaceId": surfaceId,
        ], as: ResponsePayload.self)
    }

    func changeConversationCwd(conversationId: String, cwd: String, surfaceId: String) async throws -> ConversationCwdChangeResult {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/cwd",
            method: "POST",
            body: [
                "cwd": cwd,
                "surfaceId": surfaceId,
            ],
            decode: ConversationCwdChangeResult.self
        )
    }

    func readConversationModelPreferences(conversationId: String) async throws -> ConversationModelPreferencesState {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/model-preferences",
            method: "GET",
            body: nil,
            decode: ConversationModelPreferencesState.self
        )
    }

    func updateConversationModelPreferences(conversationId: String, model: String?, thinkingLevel: String?, serviceTier: String?, surfaceId: String) async throws -> ConversationModelPreferencesState {
        var body: [String: Any] = ["surfaceId": surfaceId]
        if let model {
            body["model"] = model
        }
        if let thinkingLevel {
            body["thinkingLevel"] = thinkingLevel
        }
        if let serviceTier {
            body["serviceTier"] = serviceTier
        }
        return try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/model-preferences",
            method: "PATCH",
            body: body,
            decode: ConversationModelPreferencesState.self
        )
    }

    func listConversationArtifacts(conversationId: String) async throws -> [ConversationArtifactSummary] {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/artifacts",
            method: "GET",
            body: nil,
            decode: [ConversationArtifactSummary].self
        )
    }

    func readConversationArtifact(conversationId: String, artifactId: String) async throws -> ConversationArtifactRecord {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/artifacts/\(artifactId)",
            method: "GET",
            body: nil,
            decode: ConversationArtifactRecord.self
        )
    }

    func listConversationCheckpoints(conversationId: String) async throws -> [ConversationCommitCheckpointSummary] {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/checkpoints",
            method: "GET",
            body: nil,
            decode: [ConversationCommitCheckpointSummary].self
        )
    }

    func readConversationCheckpoint(conversationId: String, checkpointId: String) async throws -> ConversationCommitCheckpointRecord {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/checkpoints/\(checkpointId)",
            method: "GET",
            body: nil,
            decode: ConversationCommitCheckpointRecord.self
        )
    }

    func changeExecutionTarget(conversationId: String, executionTargetId: String) async throws -> ConversationBootstrapEnvelope {
        try await sendCommand(name: "conversation.change_execution_target", payload: [
            "conversationId": conversationId,
            "executionTargetId": executionTargetId,
        ], as: ConversationBootstrapEnvelope.self)
    }

    func listAttachments(conversationId: String) async throws -> ConversationAttachmentListResponse {
        try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/attachments", method: "GET", body: nil, decode: ConversationAttachmentListResponse.self)
    }

    func readAttachment(conversationId: String, attachmentId: String) async throws -> ConversationAttachmentDetailResponse {
        try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/attachments/\(attachmentId)", method: "GET", body: nil, decode: ConversationAttachmentDetailResponse.self)
    }

    func downloadAttachmentAsset(conversationId: String, attachmentId: String, asset: String, revision: Int?) async throws -> AttachmentAssetDownload {
        guard let baseURL = host.normalizedBaseURL else {
            throw CompanionClientError.invalidHostURL
        }
        var url = baseURL.appending(path: "/companion/v1/conversations/\(conversationId)/attachments/\(attachmentId)/assets/\(asset)")
        if let revision {
            url.append(queryItems: [URLQueryItem(name: "revision", value: String(revision))])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await urlSession.data(for: request)
        try Self.validate(response: response, data: data)
        let http = response as? HTTPURLResponse
        let mimeType = http?.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        let contentDisposition = http?.value(forHTTPHeaderField: "Content-Disposition")
        let fileName = contentDisposition.flatMap(Self.parseFileName(fromContentDisposition:))
        return AttachmentAssetDownload(data: data, mimeType: mimeType, fileName: fileName)
    }

    func createAttachment(conversationId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        try await saveAttachment(path: "/companion/v1/conversations/\(conversationId)/attachments", method: "POST", draft: draft)
    }

    func updateAttachment(conversationId: String, attachmentId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        try await saveAttachment(path: "/companion/v1/conversations/\(conversationId)/attachments/\(attachmentId)", method: "PATCH", draft: draft)
    }

    func listTasks() async throws -> [ScheduledTaskSummary] {
        try await authorizedJSON(path: "/companion/v1/tasks", method: "GET", body: nil, decode: [ScheduledTaskSummary].self)
    }

    func readTask(taskId: String) async throws -> ScheduledTaskDetail {
        try await authorizedJSON(path: "/companion/v1/tasks/\(taskId)", method: "GET", body: nil, decode: ScheduledTaskDetail.self)
    }

    func readTaskLog(taskId: String) async throws -> DurableRunLogResponse {
        try await authorizedJSON(path: "/companion/v1/tasks/\(taskId)/log", method: "GET", body: nil, decode: DurableRunLogResponse.self)
    }

    func createTask(draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail {
        try await authorizedJSON(path: "/companion/v1/tasks", method: "POST", body: scheduledTaskBody(from: draft), decode: ScheduledTaskMutationEnvelope.self).task
    }

    func updateTask(taskId: String, draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail {
        try await authorizedJSON(path: "/companion/v1/tasks/\(taskId)", method: "PATCH", body: scheduledTaskBody(from: draft), decode: ScheduledTaskMutationEnvelope.self).task
    }

    func deleteTask(taskId: String) async throws {
        struct DeleteResponse: Decodable { let ok: Bool }
        _ = try await authorizedJSON(path: "/companion/v1/tasks/\(taskId)", method: "DELETE", body: nil, decode: DeleteResponse.self)
    }

    func runTask(taskId: String) async throws -> ScheduledTaskRunResponse {
        try await authorizedJSON(path: "/companion/v1/tasks/\(taskId)/run", method: "POST", body: nil, decode: ScheduledTaskRunResponse.self)
    }

    func listRuns() async throws -> DurableRunsListResponse {
        try await authorizedJSON(path: "/companion/v1/runs", method: "GET", body: nil, decode: DurableRunsListResponse.self)
    }

    func readRun(runId: String) async throws -> DurableRunDetailResponse {
        try await authorizedJSON(path: "/companion/v1/runs/\(runId)", method: "GET", body: nil, decode: DurableRunDetailResponse.self)
    }

    func readRunLog(runId: String, tail: Int?) async throws -> DurableRunLogResponse {
        let path: String
        if let tail {
            path = "/companion/v1/runs/\(runId)/log?tail=\(tail)"
        } else {
            path = "/companion/v1/runs/\(runId)/log"
        }
        return try await authorizedJSON(path: path, method: "GET", body: nil, decode: DurableRunLogResponse.self)
    }

    func cancelRun(runId: String) async throws -> DurableRunCancelResponse {
        try await authorizedJSON(path: "/companion/v1/runs/\(runId)/cancel", method: "POST", body: nil, decode: DurableRunCancelResponse.self)
    }

    func readDeviceAdminState() async throws -> CompanionDeviceAdminState {
        try await authorizedJSON(path: "/companion/v1/admin/devices", method: "GET", body: nil, decode: CompanionDeviceAdminState.self)
    }

    func createPairingCode() async throws -> CompanionPairingCodeRecord {
        try await authorizedJSON(path: "/companion/v1/admin/pairing-codes", method: "POST", body: nil, decode: CompanionPairingCodeRecord.self)
    }

    func createSetupState() async throws -> CompanionSetupState {
        try await authorizedJSON(path: "/companion/v1/admin/setup", method: "POST", body: nil, decode: CompanionSetupState.self)
    }

    func updatePairedDevice(deviceId: String, deviceLabel: String) async throws -> CompanionDeviceAdminState {
        struct ResponsePayload: Decodable { let devices: [CompanionPairedDeviceSummary] }
        _ = try await authorizedJSON(
            path: "/companion/v1/admin/devices/\(deviceId)",
            method: "PATCH",
            body: ["deviceLabel": deviceLabel],
            decode: ResponsePayload.self
        )
        return try await readDeviceAdminState()
    }

    func deletePairedDevice(deviceId: String) async throws -> CompanionDeviceAdminState {
        struct ResponsePayload: Decodable { let devices: [CompanionPairedDeviceSummary] }
        _ = try await authorizedJSON(
            path: "/companion/v1/admin/devices/\(deviceId)",
            method: "DELETE",
            body: nil,
            decode: ResponsePayload.self
        )
        return try await readDeviceAdminState()
    }

    func subscribeAppEvents() async throws -> AsyncStream<CompanionAppEvent> {
        try await connectIfNeeded()
        let id = UUID()
        return AsyncStream { continuation in
            self.appContinuations[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    self?.appContinuations.removeValue(forKey: id)
                    if self?.appContinuations.isEmpty == true {
                        self?.appSubscriptionActive = false
                        await self?.sendUnsubscribe(topic: "app", key: nil)
                    }
                }
            }
            Task { @MainActor in
                if !self.appSubscriptionActive {
                    do {
                        self.appSubscriptionActive = true
                        struct Subscribed: Decodable { let subscribed: Bool }
                        _ = try await self.sendMessageAndDecode(topic: "app", key: nil, payload: nil, type: "subscribe", as: Subscribed.self)
                    } catch {
                        self.appSubscriptionActive = false
                        continuation.yield(.error(error.localizedDescription))
                    }
                }
            }
        }
    }

    func subscribeConversationEvents(conversationId: String, surfaceId: String) async throws -> AsyncStream<CompanionConversationEvent> {
        try await connectIfNeeded()
        let id = UUID()
        return AsyncStream { continuation in
            var bucket = self.conversationContinuations[conversationId] ?? [:]
            bucket[id] = continuation
            self.conversationContinuations[conversationId] = bucket
            self.conversationSubscriptionCounts[conversationId, default: 0] += 1

            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    var bucket = self.conversationContinuations[conversationId] ?? [:]
                    bucket.removeValue(forKey: id)
                    if bucket.isEmpty {
                        self.conversationContinuations.removeValue(forKey: conversationId)
                    } else {
                        self.conversationContinuations[conversationId] = bucket
                    }
                    let nextCount = max(0, (self.conversationSubscriptionCounts[conversationId] ?? 1) - 1)
                    if nextCount == 0 {
                        self.conversationSubscriptionCounts.removeValue(forKey: conversationId)
                        await self.sendUnsubscribe(topic: "conversation", key: conversationId)
                    } else {
                        self.conversationSubscriptionCounts[conversationId] = nextCount
                    }
                }
            }

            Task { @MainActor in
                if self.conversationSubscriptionCounts[conversationId] == 1 {
                    do {
                        struct Subscribed: Decodable { let subscribed: Bool }
                        _ = try await self.sendMessageAndDecode(topic: "conversation", key: conversationId, payload: [
                            "surfaceId": surfaceId,
                            "surfaceType": "ios_native",
                            "tailBlocks": 200,
                        ], type: "subscribe", as: Subscribed.self)
                    } catch {
                        continuation.yield(.error(error.localizedDescription))
                    }
                }
            }
        }
    }

    private func saveAttachment(path: String, method: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        guard let sourceAsset = draft.sourceAsset, let previewAsset = draft.previewAsset else {
            throw CompanionClientError.requestFailed("Source and preview assets are required.")
        }
        var body: [String: Any] = [
            "kind": "excalidraw",
            "sourceData": sourceAsset.base64Data,
            "sourceName": sourceAsset.fileName,
            "sourceMimeType": sourceAsset.mimeType,
            "previewData": previewAsset.base64Data,
            "previewName": previewAsset.fileName,
            "previewMimeType": previewAsset.mimeType,
        ]
        if let title = draft.title.nilIfBlank {
            body["title"] = title
        }
        if let note = draft.note.nilIfBlank {
            body["note"] = note
        }
        return try await authorizedJSON(path: path, method: method, body: body, decode: ConversationAttachmentMutationResponse.self)
    }

    private func scheduledTaskBody(from draft: ScheduledTaskEditorDraft) -> [String: Any] {
        var body: [String: Any] = [
            "enabled": draft.enabled,
            "targetType": draft.targetType,
            "threadMode": draft.threadMode,
        ]
        if let title = draft.title.nilIfBlank {
            body["title"] = title
        }
        if draft.scheduleMode == "cron" {
            body["cron"] = draft.cron.nilIfBlank
            body["at"] = NSNull()
        } else {
            body["at"] = draft.at.nilIfBlank
            body["cron"] = NSNull()
        }
        if let model = draft.model.nilIfBlank {
            body["model"] = model
        }
        if let thinkingLevel = draft.thinkingLevel.nilIfBlank {
            body["thinkingLevel"] = thinkingLevel
        }
        if let cwd = draft.cwd.nilIfBlank {
            body["cwd"] = cwd
        }
        if let timeout = Int(draft.timeoutSeconds.trimmed), timeout > 0 {
            body["timeoutSeconds"] = timeout
        }
        if let prompt = draft.prompt.nilIfBlank {
            body["prompt"] = prompt
        }
        if draft.targetType == "conversation" && draft.threadMode == "existing", let threadConversationId = draft.threadConversationId.nilIfBlank {
            body["threadConversationId"] = threadConversationId
        }
        return body
    }

    private func connectIfNeeded() async throws {
        switch connectionState {
        case .connected:
            return
        case .connecting:
            try await withCheckedThrowingContinuation { continuation in
                connectionWaiters.append(continuation)
            }
        case .disconnected:
            guard let baseURL = host.normalizedBaseURL else {
                throw CompanionClientError.invalidHostURL
            }
            guard !token.isEmpty else {
                throw CompanionClientError.missingToken
            }
            connectionState = .connecting
            let socketURL = websocketURL(from: baseURL)
            var request = URLRequest(url: socketURL)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let task = urlSession.webSocketTask(with: request)
            socket = task
            task.resume()
            receiveNextMessage()
            try await withCheckedThrowingContinuation { continuation in
                connectionWaiters.append(continuation)
            }
        }
    }

    private func websocketURL(from baseURL: URL) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/companion/v1/socket"
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        return components.url!
    }

    private func receiveNextMessage() {
        guard let socket else { return }
        Task {
            do {
                let message = try await socket.receive()
                let data: Data
                switch message {
                case .data(let payload):
                    data = payload
                case .string(let string):
                    data = Data(string.utf8)
                @unknown default:
                    throw CompanionClientError.invalidResponse
                }
                try await self.handleIncomingMessage(data)
                await MainActor.run {
                    self.receiveNextMessage()
                }
            } catch {
                await MainActor.run {
                    self.closeSocket(error: error)
                }
            }
        }
    }

    private func handleIncomingMessage(_ data: Data) async throws {
        let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        guard let dictionary = object as? [String: Any], let type = dictionary["type"] as? String else {
            throw CompanionClientError.invalidResponse
        }

        switch type {
        case "ready":
            connectionState = .connected
            let waiters = connectionWaiters
            connectionWaiters.removeAll()
            waiters.forEach { $0.resume() }
        case "response":
            guard let id = dictionary["id"] as? String else {
                throw CompanionClientError.invalidResponse
            }
            guard let pending = pendingResponses.removeValue(forKey: id) else {
                return
            }
            if let ok = dictionary["ok"] as? Bool, ok {
                pending.complete(.success(dictionary["result"] ?? NSNull()))
            } else {
                let message = dictionary["error"] as? String ?? "Unknown companion error."
                pending.complete(.failure(CompanionClientError.requestFailed(message)))
            }
        case "event":
            try routeEvent(dictionary)
        default:
            break
        }
    }

    private func routeEvent(_ dictionary: [String: Any]) throws {
        guard let topic = dictionary["topic"] as? String, let eventObject = dictionary["event"] else {
            throw CompanionClientError.invalidResponse
        }

        if topic == "app" {
            let appEvent = (try? decodeAppEvent(from: eventObject)) ?? .close
            for continuation in appContinuations.values {
                continuation.yield(appEvent)
            }
            return
        }

        guard let key = dictionary["key"] as? String else {
            throw CompanionClientError.invalidResponse
        }
        let event = (try? decodeConversationEvent(from: eventObject)) ?? .unknown
        if let continuations = conversationContinuations[key]?.values {
            for continuation in continuations {
                continuation.yield(event)
            }
        }
    }

    private func decodeAppEvent(from object: Any) throws -> CompanionAppEvent {
        guard let event = object as? [String: Any], let type = event["type"] as? String else {
            throw CompanionClientError.invalidResponse
        }

        switch type {
        case "conversation_list_state":
            guard let stateObject = event["state"] else {
                throw CompanionClientError.invalidResponse
            }
            return .conversationListState(try decodeModel(ConversationListState.self, from: stateObject))
        case "conversation_list_changed":
            return .conversationListChanged
        case "open":
            return .open
        case "close":
            return .close
        case "error":
            return .error(event["message"] as? String ?? "Unknown app event error")
        default:
            return .error("Unsupported app event: \(type)")
        }
    }

    private func decodeConversationEvent(from object: Any) throws -> CompanionConversationEvent {
        guard let event = object as? [String: Any], let type = event["type"] as? String else {
            throw CompanionClientError.invalidResponse
        }

        switch type {
        case "snapshot":
            let blocks = decodeBlocksLossy(from: event["blocks"])
            return .snapshot(
                blocks: blocks,
                blockOffset: event["blockOffset"] as? Int ?? 0,
                totalBlocks: event["totalBlocks"] as? Int ?? blocks.count
            )
        case "agent_start":
            return .agentStart
        case "agent_end":
            return .agentEnd
        case "turn_end":
            return .turnEnd
        case "user_message":
            guard let block = event["block"], let decoded = try? decodeModel(DisplayBlock.self, from: block) else { return .unknown }
            return .userMessage(decoded)
        case "text_delta":
            return .textDelta(event["delta"] as? String ?? "")
        case "thinking_delta":
            return .thinkingDelta(event["delta"] as? String ?? "")
        case "tool_start":
            return .toolStart(
                toolCallId: event["toolCallId"] as? String ?? UUID().uuidString,
                toolName: event["toolName"] as? String ?? "tool",
                args: try? decodeModel(JSONValue.self, from: event["args"] ?? NSNull())
            )
        case "tool_update":
            return .toolUpdate(
                toolCallId: event["toolCallId"] as? String ?? UUID().uuidString,
                partialResult: try? decodeModel(JSONValue.self, from: event["partialResult"] ?? NSNull())
            )
        case "tool_end":
            return .toolEnd(
                toolCallId: event["toolCallId"] as? String ?? UUID().uuidString,
                toolName: event["toolName"] as? String ?? "tool",
                isError: event["isError"] as? Bool ?? false,
                durationMs: event["durationMs"] as? Double ?? Double(event["durationMs"] as? Int ?? 0),
                output: event["output"] as? String ?? "",
                details: try? decodeModel(JSONValue.self, from: event["details"] ?? NSNull())
            )
        case "title_update":
            return .titleUpdate(event["title"] as? String ?? "Conversation")
        case "presence_state":
            guard let state = event["state"], let decoded = try? decodeModel(LiveSessionPresenceState.self, from: state) else { return .unknown }
            return .presenceState(decoded)
        case "error":
            return .error(event["message"] as? String ?? "Conversation event error")
        case "open":
            return .open
        case "close":
            return .close
        default:
            return .unknown
        }
    }

    private func decodeBlocksLossy(from object: Any?) -> [DisplayBlock] {
        guard let rawBlocks = object as? [Any] else {
            return []
        }

        return rawBlocks.compactMap { block in
            try? decodeModel(DisplayBlock.self, from: block)
        }
    }

    private func closeSocket(error: Error?) {
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connectionState = .disconnected

        let waiters = connectionWaiters
        connectionWaiters.removeAll()
        let failure = error ?? CompanionClientError.socketClosed
        waiters.forEach { $0.resume(throwing: failure) }

        let responses = pendingResponses.values
        pendingResponses.removeAll()
        responses.forEach { $0.complete(.failure(failure)) }

        if appSubscriptionActive {
            appContinuations.values.forEach { $0.yield(.close) }
        }
        conversationContinuations.values.forEach { bucket in
            bucket.values.forEach { $0.yield(.close) }
        }
        appSubscriptionActive = false
        conversationSubscriptionCounts.removeAll()
    }

    private func sendCommand<T: Decodable>(name: String, payload: [String: Any], as type: T.Type) async throws -> T {
        let object = try await sendMessage(kind: "command", topic: nil, key: nil, name: name, payload: payload)
        if object is NSNull, T.self == EmptyResult.self {
            return EmptyResult() as! T
        }
        return try decodeModel(T.self, from: object)
    }

    private func sendMessageAndDecode<T: Decodable>(topic: String, key: String?, payload: [String: Any]?, type: String, as decodeType: T.Type) async throws -> T {
        let object = try await sendMessage(kind: type, topic: topic, key: key, name: nil, payload: payload)
        if object is NSNull, T.self == EmptyResult.self {
            return EmptyResult() as! T
        }
        return try decodeModel(T.self, from: object)
    }

    private func sendUnsubscribe(topic: String, key: String?) async {
        do {
            struct Unsubscribed: Decodable { let unsubscribed: Bool }
            _ = try await sendMessageAndDecode(topic: topic, key: key, payload: nil, type: "unsubscribe", as: Unsubscribed.self)
        } catch {
            // Best effort.
        }
    }

    private func sendMessage(kind: String, topic: String?, key: String?, name: String?, payload: [String: Any]?) async throws -> Any {
        try await connectIfNeeded()
        guard let socket else {
            throw CompanionClientError.transportUnavailable
        }
        let id = UUID().uuidString
        var message: [String: Any] = [
            "id": id,
            "type": kind,
        ]
        if let name {
            message["name"] = name
        }
        if let topic {
            message["topic"] = topic
        }
        if let key {
            message["key"] = key
        }
        if let payload {
            message["payload"] = payload
        }
        let data = try jsonObjectData(message)

        return try await withCheckedThrowingContinuation { continuation in
            pendingResponses[id] = PendingResponse { result in
                continuation.resume(with: result)
            }
            Task { @MainActor in
                do {
                    try await socket.send(.data(data))
                } catch {
                    let pending = self.pendingResponses.removeValue(forKey: id)
                    pending?.complete(.failure(error))
                }
            }
        }
    }

    private func authorizedJSON<T: Decodable>(path: String, method: String, body: [String: Any]?, decode type: T.Type) async throws -> T {
        guard let baseURL = host.normalizedBaseURL else {
            throw CompanionClientError.invalidHostURL
        }
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await urlSession.data(for: request)
        try Self.validate(response: response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    private struct ErrorResponse: Decodable { let error: String }
    private struct EmptyResult: Decodable {}

    static func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw CompanionClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw CompanionClientError.requestFailed(decoded.error)
            }
            let raw = String(data: data, encoding: .utf8)?.trimmed
            throw CompanionClientError.requestFailed(raw.nilIfBlank ?? "Request failed with status \(http.statusCode).")
        }
    }

    private static func parseFileName(fromContentDisposition value: String) -> String? {
        let parts = value.split(separator: ";").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard let filePart = parts.first(where: { $0.lowercased().hasPrefix("filename=") }) else {
            return nil
        }
        return filePart.dropFirst("filename=".count).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }
}

@MainActor
final class MockCompanionClient: CompanionClientProtocol {
    let host: CompanionHostRecord

    private var listState: ConversationListState
    private var conversations: [String: ConversationBootstrapEnvelope]
    private var attachmentsByConversation: [String: [ConversationAttachmentRecord]]
    private var artifactsByConversation: [String: [ConversationArtifactRecord]]
    private var checkpointsByConversation: [String: [ConversationCommitCheckpointRecord]]
    private var tasks: [ScheduledTaskDetail]
    private var runs: [DurableRunSummary]
    private var runLogs: [String: String]
    private var deviceAdminState: CompanionDeviceAdminState
    private var setupState: CompanionSetupState
    private var appContinuations: [UUID: AsyncStream<CompanionAppEvent>.Continuation] = [:]
    private var conversationContinuations: [String: [UUID: AsyncStream<CompanionConversationEvent>.Continuation]] = [:]

    init() {
        let host = CompanionHostRecord(
            baseURL: "https://demo.personal-agent.invalid",
            hostLabel: "Demo Host",
            hostInstanceId: "host_demo",
            deviceId: "device_demo",
            deviceLabel: "iPhone Demo"
        )
        self.host = host

        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let sourceRevision = ConversationAttachmentRevision(
            revision: 1,
            createdAt: now,
            sourceName: "Whiteboard.excalidraw",
            sourceMimeType: "application/vnd.excalidraw+json",
            sourceDownloadPath: "/companion/v1/conversations/conv-1/attachments/att-1/assets/source",
            previewName: "Whiteboard.png",
            previewMimeType: "image/png",
            previewDownloadPath: "/companion/v1/conversations/conv-1/attachments/att-1/assets/preview",
            note: "Sketch for the host-connected iOS app."
        )
        let attachment = ConversationAttachmentRecord(
            id: "att-1",
            conversationId: "conv-1",
            kind: "excalidraw",
            title: "Whiteboard",
            createdAt: now,
            updatedAt: now,
            currentRevision: 1,
            latestRevision: sourceRevision,
            revisions: [sourceRevision]
        )

        let sessions = [
            SessionMeta(
                id: "conv-1",
                file: "/tmp/conv-1.jsonl",
                timestamp: now,
                cwd: "/Users/patrick/workingdir/personal-agent",
                cwdSlug: "personal-agent",
                model: "gpt-5.4",
                title: "iOS companion app",
                messageCount: 12,
                isRunning: false,
                isLive: true,
                lastActivityAt: now,
                parentSessionFile: nil,
                parentSessionId: nil,
                sourceRunId: nil,
                remoteHostId: nil,
                remoteHostLabel: nil,
                remoteConversationId: nil,
                automationTaskId: nil,
                automationTitle: nil,
                needsAttention: true,
                attentionUpdatedAt: now,
                attentionUnreadMessageCount: 1,
                attentionUnreadActivityCount: 1,
                attentionActivityIds: nil
            ),
            SessionMeta(
                id: "conv-2",
                file: "/tmp/conv-2.jsonl",
                timestamp: now,
                cwd: "/Users/patrick/workingdir/familiar",
                cwdSlug: "familiar",
                model: "gpt-5.4",
                title: "Release notes",
                messageCount: 4,
                isRunning: false,
                isLive: false,
                lastActivityAt: now,
                parentSessionFile: nil,
                parentSessionId: nil,
                sourceRunId: nil,
                remoteHostId: "ssh-1",
                remoteHostLabel: "Buildbox",
                remoteConversationId: "remote-2",
                automationTaskId: nil,
                automationTitle: nil,
                needsAttention: false,
                attentionUpdatedAt: nil,
                attentionUnreadMessageCount: nil,
                attentionUnreadActivityCount: nil,
                attentionActivityIds: nil
            ),
        ]

        self.listState = ConversationListState(
            sessions: sessions,
            ordering: ConversationOrdering(
                sessionIds: ["conv-1", "conv-2"],
                pinnedSessionIds: ["conv-1"],
                archivedSessionIds: [],
                workspacePaths: ["/Users/patrick/workingdir/personal-agent"]
            ),
            executionTargets: [
                ExecutionTargetSummary(id: "local", label: "Local", kind: "local"),
                ExecutionTargetSummary(id: "ssh-1", label: "Buildbox", kind: "ssh"),
            ]
        )

        self.conversations = [
            "conv-1": ConversationBootstrapEnvelope(
                bootstrap: ConversationBootstrapState(
                    conversationId: "conv-1",
                    sessionDetail: SessionDetail(
                        meta: sessions[0],
                        blocks: [
                            DisplayBlock(type: "user", id: "u1", ts: now, text: "Build the iOS companion app", images: nil),
                            DisplayBlock(type: "text", id: "a1", ts: now, text: "The daemon-backed companion API is ready. The iOS client now needs a native host list, conversation list, transcript, composer, and attachment views."),
                            DisplayBlock(type: "thinking", id: "t1", ts: now, text: "Focus on the native host client API, keep execution target switching in the conversation toolbar, and make attachment handling feel first-class on mobile."),
                        ],
                        blockOffset: 0,
                        totalBlocks: 3,
                        signature: "demo-1"
                    ),
                    sessionDetailSignature: "demo-1",
                    sessionDetailUnchanged: false,
                    sessionDetailAppendOnly: nil,
                    liveSession: ConversationBootstrapLiveSession(
                        live: true,
                        id: "conv-1",
                        cwd: sessions[0].cwd,
                        sessionFile: sessions[0].file,
                        title: sessions[0].title,
                        isStreaming: false,
                        hasPendingHiddenTurn: false
                    )
                ),
                sessionMeta: sessions[0],
                attachments: ConversationAttachmentListResponse(conversationId: "conv-1", attachments: [attachment.summary]),
                executionTargets: listState.executionTargets ?? []
            ),
            "conv-2": ConversationBootstrapEnvelope(
                bootstrap: ConversationBootstrapState(
                    conversationId: "conv-2",
                    sessionDetail: SessionDetail(
                        meta: sessions[1],
                        blocks: [
                            DisplayBlock(type: "summary", id: "s1", ts: now, text: "Release checklist is nearly finished.", title: "Summary", kind: "related"),
                            DisplayBlock(type: "text", id: "a2", ts: now, text: "Sign the build, upload the blockmaps, and update the GitHub release body."),
                        ],
                        blockOffset: 0,
                        totalBlocks: 2,
                        signature: "demo-2"
                    ),
                    sessionDetailSignature: "demo-2",
                    sessionDetailUnchanged: false,
                    sessionDetailAppendOnly: nil,
                    liveSession: ConversationBootstrapLiveSession(
                        live: true,
                        id: "conv-2",
                        cwd: sessions[1].cwd,
                        sessionFile: sessions[1].file,
                        title: sessions[1].title,
                        isStreaming: false,
                        hasPendingHiddenTurn: false
                    )
                ),
                sessionMeta: sessions[1],
                attachments: ConversationAttachmentListResponse(conversationId: "conv-2", attachments: []),
                executionTargets: listState.executionTargets ?? []
            ),
        ]
        self.attachmentsByConversation = ["conv-1": [attachment], "conv-2": []]
        self.artifactsByConversation = [
            "conv-1": [
                ConversationArtifactRecord(
                    id: "artifact-1",
                    conversationId: "conv-1",
                    title: "Implementation memo",
                    kind: "html",
                    createdAt: now,
                    updatedAt: now,
                    revision: 1,
                    content: "<html><body style=\"font-family: -apple-system; color: white; background: #111827; padding: 24px;\"><h1>Implementation memo</h1><p>The iOS companion now mirrors the desktop conversation workflow.</p></body></html>"
                )
            ],
            "conv-2": []
        ]
        self.checkpointsByConversation = [
            "conv-1": [
                ConversationCommitCheckpointRecord(
                    id: "abc1234",
                    conversationId: "conv-1",
                    title: "Ship companion parity",
                    cwd: "/Users/patrick/workingdir/personal-agent",
                    commitSha: "abc1234def567890",
                    shortSha: "abc1234",
                    subject: "Add iOS companion parity",
                    body: "Implements richer conversation controls and companion admin screens.",
                    authorName: "Patrick Lee",
                    authorEmail: "patrick@example.com",
                    committedAt: now,
                    createdAt: now,
                    updatedAt: now,
                    fileCount: 2,
                    linesAdded: 120,
                    linesDeleted: 12,
                    commentCount: 1,
                    files: [
                        ConversationCommitCheckpointFile(
                            path: "apps/ios/PersonalAgentCompanion/PersonalAgentCompanion/ConversationView.swift",
                            previousPath: nil,
                            status: "modified",
                            additions: 80,
                            deletions: 10,
                            patch: "@@ -1,5 +1,12 @@\n+ Added richer conversation controls\n- Old line"
                        )
                    ],
                    comments: [
                        ConversationCommitCheckpointComment(
                            id: "comment-1",
                            authorName: "Patrick Lee",
                            authorProfile: "assistant",
                            body: "Looks good.",
                            filePath: nil,
                            createdAt: now,
                            updatedAt: now
                        )
                    ]
                )
            ],
            "conv-2": []
        ]
        self.tasks = [
            ScheduledTaskDetail(
                id: "task-1",
                title: "Morning review",
                filePath: "/tasks/task-1.md",
                scheduleType: "cron",
                targetType: "conversation",
                running: false,
                enabled: true,
                cron: "0 9 * * 1-5",
                at: nil,
                model: "gpt-5.4",
                thinkingLevel: "medium",
                cwd: "/Users/patrick/workingdir/personal-agent",
                timeoutSeconds: 900,
                prompt: "Review outstanding work and summarize priorities.",
                lastStatus: "completed",
                lastRunAt: now,
                threadConversationId: "conv-1",
                threadTitle: "iOS companion app"
            )
        ]
        let runSummary = DurableRunSummary(
            runId: "run-1",
            paths: DurableRunPaths(
                root: "/runs/run-1",
                manifestPath: "/runs/run-1/manifest.json",
                statusPath: "/runs/run-1/status.json",
                checkpointPath: "/runs/run-1/checkpoint.json",
                eventsPath: "/runs/run-1/events.jsonl",
                outputLogPath: "/runs/run-1/output.log",
                resultPath: "/runs/run-1/result.json"
            ),
            manifest: DurableRunManifest(
                version: 1,
                id: "run-1",
                kind: "background-run",
                resumePolicy: "manual",
                createdAt: now,
                spec: [:],
                parentId: nil,
                rootId: nil,
                source: DurableRunManifestSource(type: "task", id: "task-1", filePath: "/tasks/task-1.md")
            ),
            status: DurableRunStatusRecord(
                version: 1,
                runId: "run-1",
                status: "completed",
                createdAt: now,
                updatedAt: now,
                activeAttempt: 1,
                startedAt: now,
                completedAt: now,
                checkpointKey: nil,
                lastError: nil
            ),
            checkpoint: nil,
            problems: [],
            recoveryAction: "none"
        )
        self.runs = [runSummary]
        self.runLogs = ["run-1": "[info] Morning review completed successfully.\n"]
        self.deviceAdminState = CompanionDeviceAdminState(
            pendingPairings: [],
            devices: [CompanionPairedDeviceSummary(id: "device-demo", deviceLabel: "iPhone Demo", createdAt: now, lastUsedAt: now, expiresAt: now, revokedAt: nil)]
        )
        let pairing = CompanionPairingCodeRecord(id: "pair-1", code: "ABCD-EFGH-IJKL", createdAt: now, expiresAt: now)
        self.setupState = CompanionSetupState(
            pairing: pairing,
            links: [CompanionSetupLinkRecord(id: "link-1", label: "Tailnet", baseUrl: "https://demo.personal-agent.invalid", setupUrl: "pa-companion://pair?base=https%3A%2F%2Fdemo.personal-agent.invalid&code=ABCD-EFGH-IJKL")],
            warnings: []
        )
    }

    func hello() async throws -> CompanionHello {
        CompanionHello(
            hostInstanceId: host.hostInstanceId,
            hostLabel: host.hostLabel,
            daemonVersion: "0.3.8",
            protocolVersion: "v1",
            transport: .init(websocket: true, singleSocket: true, httpAvailable: true),
            auth: .init(pairingRequired: true, bearerTokens: true),
            capabilities: .init(fullConversationLifecycle: true, executionTargets: true, executionTargetSwitching: true, attachments: true, attachmentWrite: true, deviceAdmin: true)
        )
    }

    func connect() async throws {}

    func disconnect() {}

    func listConversations() async throws -> ConversationListState { listState }

    func updateConversationTabs(ordering: ConversationOrdering) async throws {
        listState = ConversationListState(sessions: listState.sessions, ordering: ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
    }

    func duplicateConversation(conversationId: String) async throws -> String {
        let source = try await conversationBootstrap(conversationId: conversationId)
        let duplicated = try await createConversation(.init(promptText: source.sessionMeta?.title ?? "Duplicate", cwd: source.sessionMeta?.cwd ?? "", executionTargetId: source.sessionMeta?.remoteHostId ?? "local", model: source.sessionMeta?.model ?? "", thinkingLevel: "", serviceTier: ""), surfaceId: "ios-mock")
        return duplicated.bootstrap.conversationId
    }

    func listExecutionTargets() async throws -> [ExecutionTargetSummary] { listState.executionTargets ?? [] }

    func conversationBootstrap(conversationId: String) async throws -> ConversationBootstrapEnvelope {
        guard let value = conversations[conversationId] else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        return value
    }

    func createConversation(_ input: NewConversationRequest, surfaceId: String) async throws -> ConversationBootstrapEnvelope {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let conversationId = "conv-\(Int.random(in: 100...999))"
        let session = SessionMeta(
            id: conversationId,
            file: "/tmp/\(conversationId).jsonl",
            timestamp: now,
            cwd: input.cwd.nilIfBlank ?? "/Users/patrick/workingdir/personal-agent",
            cwdSlug: URL(fileURLWithPath: input.cwd.nilIfBlank ?? "/Users/patrick/workingdir/personal-agent").lastPathComponent,
            model: input.model.nilIfBlank ?? "gpt-5.4",
            title: input.promptText.nilIfBlank ?? "New conversation",
            messageCount: input.promptText.nilIfBlank == nil ? 0 : 1,
            isRunning: false,
            isLive: true,
            lastActivityAt: now,
            parentSessionFile: nil,
            parentSessionId: nil,
            sourceRunId: nil,
            remoteHostId: input.executionTargetId == "local" ? nil : input.executionTargetId,
            remoteHostLabel: input.executionTargetId == "local" ? nil : "Buildbox",
            remoteConversationId: nil,
            automationTaskId: nil,
            automationTitle: nil,
            needsAttention: false,
            attentionUpdatedAt: nil,
            attentionUnreadMessageCount: nil,
            attentionUnreadActivityCount: nil,
            attentionActivityIds: nil
        )
        let blocks = input.promptText.nilIfBlank.map { [DisplayBlock(type: "user", id: UUID().uuidString, ts: now, text: $0)] } ?? []
        let envelope = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: conversationId,
                sessionDetail: SessionDetail(meta: session, blocks: blocks, blockOffset: 0, totalBlocks: blocks.count, signature: UUID().uuidString),
                sessionDetailSignature: UUID().uuidString,
                sessionDetailUnchanged: false,
                sessionDetailAppendOnly: nil,
                liveSession: ConversationBootstrapLiveSession(live: true, id: conversationId, cwd: session.cwd, sessionFile: session.file, title: session.title, isStreaming: false, hasPendingHiddenTurn: false)
            ),
            sessionMeta: session,
            attachments: ConversationAttachmentListResponse(conversationId: conversationId, attachments: []),
            executionTargets: listState.executionTargets ?? []
        )
        conversations[conversationId] = envelope
        attachmentsByConversation[conversationId] = []
        artifactsByConversation[conversationId] = []
        checkpointsByConversation[conversationId] = []
        listState = ConversationListState(
            sessions: [session] + listState.sessions,
            ordering: ConversationOrdering(
                sessionIds: [conversationId] + listState.ordering.sessionIds,
                pinnedSessionIds: listState.ordering.pinnedSessionIds,
                archivedSessionIds: listState.ordering.archivedSessionIds,
                workspacePaths: listState.ordering.workspacePaths
            ),
            executionTargets: listState.executionTargets
        )
        emitApp(.conversationListState(listState))
        return envelope
    }

    func resumeConversation(_ input: ResumeConversationRequest) async throws -> ConversationBootstrapEnvelope {
        try await createConversation(.init(promptText: "", cwd: input.cwd, executionTargetId: input.executionTargetId), surfaceId: "ios-mock")
    }

    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], surfaceId: String) async throws {
        guard var envelope = conversations[conversationId], let detail = envelope.bootstrap.sessionDetail else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        var blocks = detail.blocks
        if let trimmed = text.nilIfBlank {
            let userBlock = DisplayBlock(type: "user", id: UUID().uuidString, ts: now, text: trimmed, images: images.map { draft in
                MessageImage(alt: draft.name, src: makeDataURL(mimeType: draft.mimeType, base64Data: draft.base64Data), mimeType: draft.mimeType, width: nil, height: nil, caption: draft.name, deferred: false)
            })
            blocks.append(userBlock)
            emitConversation(conversationId, .userMessage(userBlock))
        }
        if !attachmentRefs.isEmpty {
            let contextBlock = DisplayBlock(type: "context", id: UUID().uuidString, ts: now, text: "Attached drawings: \(attachmentRefs.map(\.title).joined(separator: ", "))")
            blocks.append(contextBlock)
        }
        let replyId = UUID().uuidString
        let replyText = "Native companion prompt accepted. This mock host is simulating a streamed assistant response over the daemon companion socket."
        envelope = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: envelope.bootstrap.conversationId,
                sessionDetail: SessionDetail(meta: detail.meta, blocks: blocks + [DisplayBlock(type: "text", id: replyId, ts: now, text: replyText)], blockOffset: 0, totalBlocks: blocks.count + 1, signature: UUID().uuidString),
                sessionDetailSignature: UUID().uuidString,
                sessionDetailUnchanged: false,
                sessionDetailAppendOnly: nil,
                liveSession: envelope.bootstrap.liveSession
            ),
            sessionMeta: envelope.sessionMeta,
            attachments: envelope.attachments,
            executionTargets: envelope.executionTargets
        )
        conversations[conversationId] = envelope
        emitConversation(conversationId, .agentStart)
        for chunk in ["Native companion prompt ", "accepted. This mock host ", "is simulating a streamed ", "assistant response over the daemon companion socket."] {
            emitConversation(conversationId, .textDelta(chunk))
        }
        emitConversation(conversationId, .agentEnd)
        emitConversation(conversationId, .turnEnd)
    }

    func abortConversation(conversationId: String) async throws {}

    func takeOverConversation(conversationId: String, surfaceId: String) async throws {
        emitConversation(conversationId, .presenceState(.init(surfaces: [.init(surfaceId: surfaceId, surfaceType: "ios_native", connectedAt: ISO8601DateFormatter.flexible.string(from: .now))], controllerSurfaceId: surfaceId, controllerSurfaceType: "ios_native", controllerAcquiredAt: ISO8601DateFormatter.flexible.string(from: .now))))
    }

    func renameConversation(conversationId: String, name: String, surfaceId: String) async throws {
        guard var envelope = conversations[conversationId], let sessionMeta = envelope.sessionMeta else { return }
        let renamedMeta = SessionMeta(
            id: sessionMeta.id,
            file: sessionMeta.file,
            timestamp: sessionMeta.timestamp,
            cwd: sessionMeta.cwd,
            cwdSlug: sessionMeta.cwdSlug,
            model: sessionMeta.model,
            title: name,
            messageCount: sessionMeta.messageCount,
            isRunning: sessionMeta.isRunning,
            isLive: sessionMeta.isLive,
            lastActivityAt: sessionMeta.lastActivityAt,
            parentSessionFile: sessionMeta.parentSessionFile,
            parentSessionId: sessionMeta.parentSessionId,
            sourceRunId: sessionMeta.sourceRunId,
            remoteHostId: sessionMeta.remoteHostId,
            remoteHostLabel: sessionMeta.remoteHostLabel,
            remoteConversationId: sessionMeta.remoteConversationId,
            automationTaskId: sessionMeta.automationTaskId,
            automationTitle: sessionMeta.automationTitle,
            needsAttention: sessionMeta.needsAttention,
            attentionUpdatedAt: sessionMeta.attentionUpdatedAt,
            attentionUnreadMessageCount: sessionMeta.attentionUnreadMessageCount,
            attentionUnreadActivityCount: sessionMeta.attentionUnreadActivityCount,
            attentionActivityIds: sessionMeta.attentionActivityIds
        )
        envelope = ConversationBootstrapEnvelope(bootstrap: envelope.bootstrap, sessionMeta: renamedMeta, attachments: envelope.attachments, executionTargets: envelope.executionTargets)
        conversations[conversationId] = envelope
        listState = ConversationListState(sessions: listState.sessions.map { $0.id == conversationId ? renamedMeta : $0 }, ordering: listState.ordering, executionTargets: listState.executionTargets)
        emitConversation(conversationId, .titleUpdate(name))
        emitApp(.conversationListState(listState))
    }

    func changeConversationCwd(conversationId: String, cwd: String, surfaceId: String) async throws -> ConversationCwdChangeResult {
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let nextId = conversationId == "conv-1" ? "conv-1-cwd" : conversationId
        let updatedMeta = SessionMeta(
            id: nextId,
            file: meta.file,
            timestamp: meta.timestamp,
            cwd: cwd,
            cwdSlug: URL(fileURLWithPath: cwd).lastPathComponent,
            model: meta.model,
            title: meta.title,
            messageCount: meta.messageCount,
            isRunning: meta.isRunning,
            isLive: meta.isLive,
            lastActivityAt: ISO8601DateFormatter.flexible.string(from: .now),
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
        let updated = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: nextId,
                sessionDetail: envelope.bootstrap.sessionDetail.map { detail in
                    SessionDetail(meta: updatedMeta, blocks: detail.blocks, blockOffset: detail.blockOffset, totalBlocks: detail.totalBlocks, signature: detail.signature)
                },
                sessionDetailSignature: envelope.bootstrap.sessionDetailSignature,
                sessionDetailUnchanged: envelope.bootstrap.sessionDetailUnchanged,
                sessionDetailAppendOnly: envelope.bootstrap.sessionDetailAppendOnly,
                liveSession: ConversationBootstrapLiveSession(live: true, id: nextId, cwd: cwd, sessionFile: meta.file, title: updatedMeta.title, isStreaming: envelope.bootstrap.liveSession.isStreaming, hasPendingHiddenTurn: envelope.bootstrap.liveSession.hasPendingHiddenTurn)
            ),
            sessionMeta: updatedMeta,
            attachments: envelope.attachments,
            executionTargets: envelope.executionTargets
        )
        conversations[nextId] = updated
        listState = ConversationListState(
            sessions: listState.sessions.map { $0.id == conversationId ? updatedMeta : $0 },
            ordering: ConversationOrdering(
                sessionIds: listState.ordering.sessionIds.map { $0 == conversationId ? nextId : $0 },
                pinnedSessionIds: listState.ordering.pinnedSessionIds.map { $0 == conversationId ? nextId : $0 },
                archivedSessionIds: listState.ordering.archivedSessionIds.map { $0 == conversationId ? nextId : $0 },
                workspacePaths: listState.ordering.workspacePaths
            ),
            executionTargets: listState.executionTargets
        )
        emitApp(.conversationListState(listState))
        return ConversationCwdChangeResult(id: nextId, sessionFile: meta.file, cwd: cwd, changed: true)
    }

    func readConversationModelPreferences(conversationId: String) async throws -> ConversationModelPreferencesState {
        guard let meta = conversations[conversationId]?.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        return ConversationModelPreferencesState(currentModel: meta.model, currentThinkingLevel: "medium", currentServiceTier: "standard", hasExplicitServiceTier: false)
    }

    func updateConversationModelPreferences(conversationId: String, model: String?, thinkingLevel: String?, serviceTier: String?, surfaceId: String) async throws -> ConversationModelPreferencesState {
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let updatedMeta = SessionMeta(
            id: meta.id,
            file: meta.file,
            timestamp: meta.timestamp,
            cwd: meta.cwd,
            cwdSlug: meta.cwdSlug,
            model: model?.nilIfBlank ?? meta.model,
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
        conversations[conversationId] = ConversationBootstrapEnvelope(bootstrap: envelope.bootstrap, sessionMeta: updatedMeta, attachments: envelope.attachments, executionTargets: envelope.executionTargets)
        listState = ConversationListState(sessions: listState.sessions.map { $0.id == conversationId ? updatedMeta : $0 }, ordering: listState.ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
        return ConversationModelPreferencesState(currentModel: updatedMeta.model, currentThinkingLevel: thinkingLevel?.nilIfBlank ?? "medium", currentServiceTier: serviceTier?.nilIfBlank ?? "standard", hasExplicitServiceTier: serviceTier?.nilIfBlank != nil)
    }

    func listConversationArtifacts(conversationId: String) async throws -> [ConversationArtifactSummary] {
        (artifactsByConversation[conversationId] ?? []).map { artifact in
            ConversationArtifactSummary(id: artifact.id, conversationId: artifact.conversationId, title: artifact.title, kind: artifact.kind, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt, revision: artifact.revision)
        }
    }

    func readConversationArtifact(conversationId: String, artifactId: String) async throws -> ConversationArtifactRecord {
        guard let artifact = artifactsByConversation[conversationId]?.first(where: { $0.id == artifactId }) else {
            throw CompanionClientError.requestFailed("Artifact not found.")
        }
        return artifact
    }

    func listConversationCheckpoints(conversationId: String) async throws -> [ConversationCommitCheckpointSummary] {
        (checkpointsByConversation[conversationId] ?? []).map { checkpoint in
            ConversationCommitCheckpointSummary(
                id: checkpoint.id,
                conversationId: checkpoint.conversationId,
                title: checkpoint.title,
                cwd: checkpoint.cwd,
                commitSha: checkpoint.commitSha,
                shortSha: checkpoint.shortSha,
                subject: checkpoint.subject,
                body: checkpoint.body,
                authorName: checkpoint.authorName,
                authorEmail: checkpoint.authorEmail,
                committedAt: checkpoint.committedAt,
                createdAt: checkpoint.createdAt,
                updatedAt: checkpoint.updatedAt,
                fileCount: checkpoint.fileCount,
                linesAdded: checkpoint.linesAdded,
                linesDeleted: checkpoint.linesDeleted,
                commentCount: checkpoint.commentCount
            )
        }
    }

    func readConversationCheckpoint(conversationId: String, checkpointId: String) async throws -> ConversationCommitCheckpointRecord {
        guard let checkpoint = checkpointsByConversation[conversationId]?.first(where: { $0.id == checkpointId }) else {
            throw CompanionClientError.requestFailed("Checkpoint not found.")
        }
        return checkpoint
    }

    func changeExecutionTarget(conversationId: String, executionTargetId: String) async throws -> ConversationBootstrapEnvelope {
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let updatedMeta = SessionMeta(
            id: meta.id,
            file: meta.file,
            timestamp: meta.timestamp,
            cwd: meta.cwd,
            cwdSlug: meta.cwdSlug,
            model: meta.model,
            title: meta.title,
            messageCount: meta.messageCount,
            isRunning: meta.isRunning,
            isLive: meta.isLive,
            lastActivityAt: meta.lastActivityAt,
            parentSessionFile: meta.parentSessionFile,
            parentSessionId: meta.parentSessionId,
            sourceRunId: meta.sourceRunId,
            remoteHostId: executionTargetId == "local" ? nil : executionTargetId,
            remoteHostLabel: executionTargetId == "local" ? nil : "Buildbox",
            remoteConversationId: executionTargetId == "local" ? nil : "remote-demo",
            automationTaskId: meta.automationTaskId,
            automationTitle: meta.automationTitle,
            needsAttention: meta.needsAttention,
            attentionUpdatedAt: meta.attentionUpdatedAt,
            attentionUnreadMessageCount: meta.attentionUnreadMessageCount,
            attentionUnreadActivityCount: meta.attentionUnreadActivityCount,
            attentionActivityIds: meta.attentionActivityIds
        )
        let updated = ConversationBootstrapEnvelope(bootstrap: envelope.bootstrap, sessionMeta: updatedMeta, attachments: envelope.attachments, executionTargets: envelope.executionTargets)
        conversations[conversationId] = updated
        listState = ConversationListState(sessions: listState.sessions.map { $0.id == conversationId ? updatedMeta : $0 }, ordering: listState.ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
        return updated
    }

    func listAttachments(conversationId: String) async throws -> ConversationAttachmentListResponse {
        ConversationAttachmentListResponse(conversationId: conversationId, attachments: (attachmentsByConversation[conversationId] ?? []).map(\.summary))
    }

    func readAttachment(conversationId: String, attachmentId: String) async throws -> ConversationAttachmentDetailResponse {
        guard let attachment = attachmentsByConversation[conversationId]?.first(where: { $0.id == attachmentId }) else {
            throw CompanionClientError.requestFailed("Attachment not found.")
        }
        return ConversationAttachmentDetailResponse(conversationId: conversationId, attachment: attachment)
    }

    func downloadAttachmentAsset(conversationId: String, attachmentId: String, asset: String, revision: Int?) async throws -> AttachmentAssetDownload {
        if asset == "preview" {
            let pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W2KIiQAAAAASUVORK5CYII="
            return AttachmentAssetDownload(data: Data(base64Encoded: pngBase64) ?? Data(), mimeType: "image/png", fileName: "Preview.png")
        }
        let json = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"https://personal-agent.invalid\",\"elements\":[],\"appState\":{},\"files\":{}}"
        return AttachmentAssetDownload(data: Data(json.utf8), mimeType: "application/vnd.excalidraw+json", fileName: "Whiteboard.excalidraw")
    }

    func createAttachment(conversationId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let attachmentId = "att-\(Int.random(in: 10...999))"
        guard let sourceAsset = draft.sourceAsset, let previewAsset = draft.previewAsset else {
            throw CompanionClientError.requestFailed("Source and preview assets are required.")
        }
        let revision = ConversationAttachmentRevision(revision: 1, createdAt: now, sourceName: sourceAsset.fileName, sourceMimeType: sourceAsset.mimeType, sourceDownloadPath: "/source", previewName: previewAsset.fileName, previewMimeType: previewAsset.mimeType, previewDownloadPath: "/preview", note: draft.note.nilIfBlank)
        let record = ConversationAttachmentRecord(id: attachmentId, conversationId: conversationId, kind: "excalidraw", title: draft.title.nilIfBlank ?? "Drawing", createdAt: now, updatedAt: now, currentRevision: 1, latestRevision: revision, revisions: [revision])
        attachmentsByConversation[conversationId, default: []].append(record)
        let attachments = (attachmentsByConversation[conversationId] ?? []).map(\.summary)
        return ConversationAttachmentMutationResponse(conversationId: conversationId, attachment: record, attachments: attachments)
    }

    func updateAttachment(conversationId: String, attachmentId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        let created = try await createAttachment(conversationId: conversationId, draft: draft)
        return ConversationAttachmentMutationResponse(conversationId: conversationId, attachment: created.attachment, attachments: created.attachments)
    }

    func listTasks() async throws -> [ScheduledTaskSummary] {
        tasks.map { task in
            ScheduledTaskSummary(
                id: task.id,
                title: task.title,
                filePath: task.filePath,
                scheduleType: task.scheduleType,
                targetType: task.targetType,
                running: task.running,
                enabled: task.enabled,
                cron: task.cron,
                at: task.at,
                prompt: task.prompt,
                model: task.model,
                thinkingLevel: task.thinkingLevel,
                cwd: task.cwd,
                threadConversationId: task.threadConversationId,
                threadTitle: task.threadTitle,
                lastStatus: task.lastStatus,
                lastRunAt: task.lastRunAt,
                lastSuccessAt: task.lastRunAt,
                lastAttemptCount: 1
            )
        }
    }

    func readTask(taskId: String) async throws -> ScheduledTaskDetail {
        guard let task = tasks.first(where: { $0.id == taskId }) else {
            throw CompanionClientError.requestFailed("Task not found.")
        }
        return task
    }

    func readTaskLog(taskId: String) async throws -> DurableRunLogResponse {
        DurableRunLogResponse(path: "/tmp/\(taskId).log", log: runLogs[taskId] ?? "[info] Task \(taskId) completed.\n")
    }

    func createTask(draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail {
        let created = ScheduledTaskDetail(
            id: "task-\(Int.random(in: 10...999))",
            title: draft.title.nilIfBlank ?? "Mock task",
            filePath: nil,
            scheduleType: draft.scheduleMode,
            targetType: draft.targetType,
            running: false,
            enabled: draft.enabled,
            cron: draft.scheduleMode == "cron" ? draft.cron.nilIfBlank : nil,
            at: draft.scheduleMode == "at" ? draft.at.nilIfBlank : nil,
            model: draft.model.nilIfBlank,
            thinkingLevel: draft.thinkingLevel.nilIfBlank,
            cwd: draft.cwd.nilIfBlank,
            timeoutSeconds: Int(draft.timeoutSeconds.trimmed),
            prompt: draft.prompt.nilIfBlank,
            lastStatus: nil,
            lastRunAt: nil,
            threadConversationId: draft.threadConversationId.nilIfBlank,
            threadTitle: listState.sessions.first(where: { $0.id == draft.threadConversationId.nilIfBlank })?.title
        )
        tasks.insert(created, at: 0)
        return created
    }

    func updateTask(taskId: String, draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail {
        guard let index = tasks.firstIndex(where: { $0.id == taskId }) else {
            throw CompanionClientError.requestFailed("Task not found.")
        }
        let previous = tasks[index]
        let updated = ScheduledTaskDetail(
            id: taskId,
            title: draft.title.nilIfBlank ?? previous.title,
            filePath: previous.filePath,
            scheduleType: draft.scheduleMode,
            targetType: draft.targetType,
            running: previous.running,
            enabled: draft.enabled,
            cron: draft.scheduleMode == "cron" ? draft.cron.nilIfBlank : nil,
            at: draft.scheduleMode == "at" ? draft.at.nilIfBlank : nil,
            model: draft.model.nilIfBlank,
            thinkingLevel: draft.thinkingLevel.nilIfBlank,
            cwd: draft.cwd.nilIfBlank,
            timeoutSeconds: Int(draft.timeoutSeconds.trimmed),
            prompt: draft.prompt.nilIfBlank,
            lastStatus: previous.lastStatus,
            lastRunAt: previous.lastRunAt,
            threadConversationId: draft.threadConversationId.nilIfBlank,
            threadTitle: listState.sessions.first(where: { $0.id == draft.threadConversationId.nilIfBlank })?.title
        )
        tasks[index] = updated
        return updated
    }

    func deleteTask(taskId: String) async throws {
        tasks.removeAll { $0.id == taskId }
    }

    func runTask(taskId: String) async throws -> ScheduledTaskRunResponse {
        guard let task = tasks.first(where: { $0.id == taskId }) else {
            throw CompanionClientError.requestFailed("Task not found.")
        }
        let runId = "run-\(Int.random(in: 100...999))"
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let summary = DurableRunSummary(
            runId: runId,
            paths: DurableRunPaths(root: "/runs/\(runId)", manifestPath: "/runs/\(runId)/manifest.json", statusPath: "/runs/\(runId)/status.json", checkpointPath: "/runs/\(runId)/checkpoint.json", eventsPath: "/runs/\(runId)/events.jsonl", outputLogPath: "/runs/\(runId)/output.log", resultPath: "/runs/\(runId)/result.json"),
            manifest: DurableRunManifest(version: 1, id: runId, kind: "scheduled-task", resumePolicy: "manual", createdAt: now, spec: [:], parentId: nil, rootId: nil, source: DurableRunManifestSource(type: "task", id: task.id, filePath: task.filePath)),
            status: DurableRunStatusRecord(version: 1, runId: runId, status: "running", createdAt: now, updatedAt: now, activeAttempt: 1, startedAt: now, completedAt: nil, checkpointKey: nil, lastError: nil),
            checkpoint: nil,
            problems: [],
            recoveryAction: "none"
        )
        runs.insert(summary, at: 0)
        runLogs[runId] = "[info] Started task \(task.title).\n"
        return ScheduledTaskRunResponse(ok: true, accepted: true, runId: runId)
    }

    func listRuns() async throws -> DurableRunsListResponse {
        let statuses = Dictionary(grouping: runs.compactMap { $0.status?.status }, by: { $0 }).mapValues(\.count)
        let recoveryActions = Dictionary(grouping: runs.map(\.recoveryAction), by: { $0 }).mapValues(\.count)
        return DurableRunsListResponse(scannedAt: ISO8601DateFormatter.flexible.string(from: .now), runs: runs, summary: DurableRunsSummary(total: runs.count, recoveryActions: recoveryActions, statuses: statuses))
    }

    func readRun(runId: String) async throws -> DurableRunDetailResponse {
        guard let run = runs.first(where: { $0.runId == runId }) else {
            throw CompanionClientError.requestFailed("Run not found.")
        }
        return DurableRunDetailResponse(scannedAt: ISO8601DateFormatter.flexible.string(from: .now), run: run)
    }

    func readRunLog(runId: String, tail: Int?) async throws -> DurableRunLogResponse {
        DurableRunLogResponse(path: "/tmp/\(runId).log", log: runLogs[runId] ?? "")
    }

    func cancelRun(runId: String) async throws -> DurableRunCancelResponse {
        if let index = runs.firstIndex(where: { $0.runId == runId }) {
            let run = runs[index]
            let updatedStatus = DurableRunStatusRecord(version: run.status?.version, runId: runId, status: "cancelled", createdAt: run.status?.createdAt ?? ISO8601DateFormatter.flexible.string(from: .now), updatedAt: ISO8601DateFormatter.flexible.string(from: .now), activeAttempt: run.status?.activeAttempt ?? 1, startedAt: run.status?.startedAt, completedAt: ISO8601DateFormatter.flexible.string(from: .now), checkpointKey: run.status?.checkpointKey, lastError: run.status?.lastError)
            runs[index] = DurableRunSummary(runId: run.runId, paths: run.paths, manifest: run.manifest, status: updatedStatus, checkpoint: run.checkpoint, problems: run.problems, recoveryAction: run.recoveryAction)
        }
        return DurableRunCancelResponse(cancelled: true, runId: runId, reason: nil)
    }

    func readDeviceAdminState() async throws -> CompanionDeviceAdminState {
        deviceAdminState
    }

    func createPairingCode() async throws -> CompanionPairingCodeRecord {
        let next = CompanionPairingCodeRecord(id: "pair-\(Int.random(in: 10...999))", code: "WXYZ-QRST-UVWX", createdAt: ISO8601DateFormatter.flexible.string(from: .now), expiresAt: ISO8601DateFormatter.flexible.string(from: .now.addingTimeInterval(600)))
        deviceAdminState = CompanionDeviceAdminState(pendingPairings: [CompanionPendingPairing(id: next.id, createdAt: next.createdAt, expiresAt: next.expiresAt)] + deviceAdminState.pendingPairings, devices: deviceAdminState.devices)
        setupState = CompanionSetupState(pairing: next, links: setupState.links, warnings: setupState.warnings)
        return next
    }

    func createSetupState() async throws -> CompanionSetupState {
        setupState
    }

    func updatePairedDevice(deviceId: String, deviceLabel: String) async throws -> CompanionDeviceAdminState {
        deviceAdminState = CompanionDeviceAdminState(pendingPairings: deviceAdminState.pendingPairings, devices: deviceAdminState.devices.map { device in
            device.id == deviceId
                ? CompanionPairedDeviceSummary(id: device.id, deviceLabel: deviceLabel, createdAt: device.createdAt, lastUsedAt: device.lastUsedAt, expiresAt: device.expiresAt, revokedAt: device.revokedAt)
                : device
        })
        return deviceAdminState
    }

    func deletePairedDevice(deviceId: String) async throws -> CompanionDeviceAdminState {
        deviceAdminState = CompanionDeviceAdminState(pendingPairings: deviceAdminState.pendingPairings, devices: deviceAdminState.devices.filter { $0.id != deviceId })
        return deviceAdminState
    }

    func subscribeAppEvents() async throws -> AsyncStream<CompanionAppEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            self.appContinuations[id] = continuation
            continuation.yield(.conversationListState(self.listState))
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.appContinuations.removeValue(forKey: id) }
            }
        }
    }

    func subscribeConversationEvents(conversationId: String, surfaceId: String) async throws -> AsyncStream<CompanionConversationEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            var bucket = self.conversationContinuations[conversationId] ?? [:]
            bucket[id] = continuation
            self.conversationContinuations[conversationId] = bucket
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    var bucket = self.conversationContinuations[conversationId] ?? [:]
                    bucket.removeValue(forKey: id)
                    self.conversationContinuations[conversationId] = bucket
                }
            }
        }
    }

    private func emitApp(_ event: CompanionAppEvent) {
        appContinuations.values.forEach { $0.yield(event) }
    }

    private func emitConversation(_ conversationId: String, _ event: CompanionConversationEvent) {
        conversationContinuations[conversationId]?.values.forEach { $0.yield(event) }
    }
}
