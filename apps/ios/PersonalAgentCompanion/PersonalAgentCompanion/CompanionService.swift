import Foundation
import Security

@MainActor
protocol CompanionClientProtocol: AnyObject {
    var host: CompanionHostRecord { get }
    var supportsRunningConversationSimulation: Bool { get }

    func hello() async throws -> CompanionHello
    func simulateRunningConversation(conversationId: String) async throws
    func connect() async throws
    func disconnect()
    func listConversations() async throws -> ConversationListState
    func updateConversationTabs(ordering: ConversationOrdering) async throws
    func duplicateConversation(conversationId: String) async throws -> String
    func listExecutionTargets() async throws -> [ExecutionTargetSummary]
    func readModels() async throws -> CompanionModelState
    func listSshTargets() async throws -> CompanionSshTargetState
    func saveSshTarget(id: String?, label: String, sshTarget: String) async throws -> CompanionSshTargetState
    func deleteSshTarget(targetId: String) async throws -> CompanionSshTargetState
    func testSshTarget(sshTarget: String) async throws -> CompanionSshTargetTestResult
    func readRemoteDirectory(targetId: String, path: String?) async throws -> CompanionRemoteDirectoryListing
    func conversationBootstrap(conversationId: String, options: ConversationBootstrapRequestOptions) async throws -> ConversationBootstrapEnvelope
    func createConversation(_ input: NewConversationRequest, surfaceId: String) async throws -> ConversationBootstrapEnvelope
    func resumeConversation(_ input: ResumeConversationRequest) async throws -> ConversationBootstrapEnvelope
    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], mode: ConversationPromptSubmissionMode, surfaceId: String) async throws
    func restoreQueuedPrompt(conversationId: String, behavior: String, index: Int, previewId: String?, surfaceId: String) async throws -> CompanionQueueRestoreResult
    func manageParallelJob(conversationId: String, jobId: String, action: String, surfaceId: String) async throws -> CompanionParallelJobActionResult
    func cancelDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse
    func fireDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse
    func abortConversation(conversationId: String) async throws
    func takeOverConversation(conversationId: String, surfaceId: String) async throws
    func renameConversation(conversationId: String, name: String, surfaceId: String) async throws
    func changeConversationCwd(conversationId: String, cwd: String, surfaceId: String) async throws -> ConversationCwdChangeResult
    func readConversationAutoMode(conversationId: String) async throws -> ConversationAutoModeState
    func updateConversationAutoMode(conversationId: String, enabled: Bool, surfaceId: String) async throws -> ConversationAutoModeState
    func readConversationModelPreferences(conversationId: String) async throws -> ConversationModelPreferencesState
    func updateConversationModelPreferences(conversationId: String, model: String?, thinkingLevel: String?, serviceTier: String?, surfaceId: String) async throws -> ConversationModelPreferencesState
    func listConversationArtifacts(conversationId: String) async throws -> [ConversationArtifactSummary]
    func readConversationArtifact(conversationId: String, artifactId: String) async throws -> ConversationArtifactRecord
    func listConversationCheckpoints(conversationId: String) async throws -> [ConversationCommitCheckpointSummary]
    func readConversationCheckpoint(conversationId: String, checkpointId: String) async throws -> ConversationCommitCheckpointRecord
    func createConversationCheckpoint(conversationId: String, message: String, paths: [String]) async throws -> ConversationCommitCheckpointRecord
    func changeExecutionTarget(conversationId: String, executionTargetId: String) async throws -> ConversationBootstrapEnvelope
    func listAttachments(conversationId: String) async throws -> ConversationAttachmentListResponse
    func readAttachment(conversationId: String, attachmentId: String) async throws -> ConversationAttachmentDetailResponse
    func downloadAttachmentAsset(conversationId: String, attachmentId: String, asset: String, revision: Int?) async throws -> AttachmentAssetDownload
    func downloadCompanionAsset(path: String) async throws -> AttachmentAssetDownload
    func createAttachment(conversationId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse
    func updateAttachment(conversationId: String, attachmentId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse
    func listKnowledgeEntries(directoryId: String?) async throws -> CompanionKnowledgeTreeResponse
    func searchKnowledge(query: String, limit: Int) async throws -> CompanionKnowledgeSearchResponse
    func readKnowledgeFile(fileId: String) async throws -> CompanionKnowledgeFileResponse
    func writeKnowledgeFile(fileId: String, content: String) async throws -> CompanionKnowledgeEntry
    func createKnowledgeFolder(folderId: String) async throws -> CompanionKnowledgeEntry
    func renameKnowledgeEntry(id: String, newName: String, parentId: String?) async throws -> CompanionKnowledgeEntry
    func deleteKnowledgeEntry(id: String) async throws
    func createKnowledgeImageAsset(fileName: String?, mimeType: String?, dataBase64: String) async throws -> CompanionKnowledgeImageAssetResponse
    func importKnowledge(_ input: CompanionKnowledgeImportRequest) async throws -> CompanionKnowledgeImportResponse
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

struct ConversationBootstrapRequestOptions: Equatable {
    static let defaultTailBlocks = 120

    let tailBlocks: Int?
    let knownSessionSignature: String?
    let knownBlockOffset: Int?
    let knownTotalBlocks: Int?
    let knownLastBlockId: String?

    init(
        tailBlocks: Int? = nil,
        knownSessionSignature: String? = nil,
        knownBlockOffset: Int? = nil,
        knownTotalBlocks: Int? = nil,
        knownLastBlockId: String? = nil
    ) {
        self.tailBlocks = tailBlocks
        self.knownSessionSignature = knownSessionSignature
        self.knownBlockOffset = knownBlockOffset
        self.knownTotalBlocks = knownTotalBlocks
        self.knownLastBlockId = knownLastBlockId
    }
}

extension CompanionClientProtocol {
    func conversationBootstrap(conversationId: String) async throws -> ConversationBootstrapEnvelope {
        try await conversationBootstrap(conversationId: conversationId, options: ConversationBootstrapRequestOptions())
    }
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
    var supportsRunningConversationSimulation: Bool { false }
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

    func simulateRunningConversation(conversationId: String) async throws {
        throw CompanionClientError.notImplementedInMock
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

    func readModels() async throws -> CompanionModelState {
        try await authorizedJSON(path: "/companion/v1/models", method: "GET", body: nil, decode: CompanionModelState.self)
    }

    func listSshTargets() async throws -> CompanionSshTargetState {
        try await authorizedJSON(path: "/companion/v1/ssh-targets", method: "GET", body: nil, decode: CompanionSshTargetState.self)
    }

    func saveSshTarget(id: String?, label: String, sshTarget: String) async throws -> CompanionSshTargetState {
        let path = if let id = id?.trimmed.nilIfBlank {
            "/companion/v1/ssh-targets/\(id)"
        } else {
            "/companion/v1/ssh-targets"
        }
        let method = id?.trimmed.nilIfBlank == nil ? "POST" : "PATCH"
        var body: [String: Any] = [
            "label": label,
            "sshTarget": sshTarget,
        ]
        if let id = id?.trimmed.nilIfBlank, method == "POST" {
            body["id"] = id
        }
        return try await authorizedJSON(path: path, method: method, body: body, decode: CompanionSshTargetState.self)
    }

    func deleteSshTarget(targetId: String) async throws -> CompanionSshTargetState {
        try await authorizedJSON(path: "/companion/v1/ssh-targets/\(targetId)", method: "DELETE", body: nil, decode: CompanionSshTargetState.self)
    }

    func testSshTarget(sshTarget: String) async throws -> CompanionSshTargetTestResult {
        try await authorizedJSON(path: "/companion/v1/ssh-targets/test", method: "POST", body: ["sshTarget": sshTarget], decode: CompanionSshTargetTestResult.self)
    }

    func readRemoteDirectory(targetId: String, path: String?) async throws -> CompanionRemoteDirectoryListing {
        try await authorizedJSON(path: companionRemoteDirectoryEndpoint(targetId: targetId, path: path), method: "GET", body: nil, decode: CompanionRemoteDirectoryListing.self)
    }

    func conversationBootstrap(conversationId: String, options: ConversationBootstrapRequestOptions) async throws -> ConversationBootstrapEnvelope {
        var payload: [String: Any] = ["conversationId": conversationId]
        if let tailBlocks = options.tailBlocks, tailBlocks > 0 {
            payload["tailBlocks"] = tailBlocks
        }
        if let knownSessionSignature = options.knownSessionSignature.nilIfBlank {
            payload["knownSessionSignature"] = knownSessionSignature
        }
        if let knownBlockOffset = options.knownBlockOffset, knownBlockOffset >= 0 {
            payload["knownBlockOffset"] = knownBlockOffset
        }
        if let knownTotalBlocks = options.knownTotalBlocks, knownTotalBlocks >= 0 {
            payload["knownTotalBlocks"] = knownTotalBlocks
        }
        if let knownLastBlockId = options.knownLastBlockId.nilIfBlank {
            payload["knownLastBlockId"] = knownLastBlockId
        }
        return try await sendCommand(name: "conversation.bootstrap", payload: payload, as: ConversationBootstrapEnvelope.self)
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

    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], mode: ConversationPromptSubmissionMode, surfaceId: String) async throws {
        var payload: [String: Any] = [
            "conversationId": conversationId,
            "surfaceId": surfaceId,
        ]
        if let trimmed = text.nilIfBlank {
            payload["text"] = trimmed
        }
        if let behavior = mode.behaviorValue {
            payload["behavior"] = behavior
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
        let commandName = mode == .parallel ? "conversation.parallel_prompt" : "conversation.prompt"
        _ = try await sendCommand(name: commandName, payload: payload, as: ResponsePayload.self)
    }

    func restoreQueuedPrompt(conversationId: String, behavior: String, index: Int, previewId: String?, surfaceId: String) async throws -> CompanionQueueRestoreResult {
        var body: [String: Any] = [
            "behavior": behavior,
            "index": index,
            "surfaceId": surfaceId,
        ]
        if let previewId = previewId?.nilIfBlank {
            body["previewId"] = previewId
        }
        return try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/dequeue", method: "POST", body: body, decode: CompanionQueueRestoreResult.self)
    }

    func manageParallelJob(conversationId: String, jobId: String, action: String, surfaceId: String) async throws -> CompanionParallelJobActionResult {
        try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/parallel-jobs/\(jobId)", method: "POST", body: ["action": action, "surfaceId": surfaceId], decode: CompanionParallelJobActionResult.self)
    }

    func cancelDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse {
        try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/deferred-resumes/\(resumeId)", method: "DELETE", body: nil, decode: DeferredResumeListResponse.self)
    }

    func fireDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse {
        try await authorizedJSON(path: "/companion/v1/conversations/\(conversationId)/deferred-resumes/\(resumeId)/fire", method: "POST", body: nil, decode: DeferredResumeListResponse.self)
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

    func readConversationAutoMode(conversationId: String) async throws -> ConversationAutoModeState {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/auto-mode",
            method: "GET",
            body: nil,
            decode: ConversationAutoModeState.self
        )
    }

    func updateConversationAutoMode(conversationId: String, enabled: Bool, surfaceId: String) async throws -> ConversationAutoModeState {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/auto-mode",
            method: "PATCH",
            body: [
                "enabled": enabled,
                "surfaceId": surfaceId,
            ],
            decode: ConversationAutoModeState.self
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

    func createConversationCheckpoint(conversationId: String, message: String, paths: [String]) async throws -> ConversationCommitCheckpointRecord {
        try await authorizedJSON(
            path: "/companion/v1/conversations/\(conversationId)/checkpoints",
            method: "POST",
            body: [
                "message": message,
                "paths": paths,
            ],
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
        var path = "/companion/v1/conversations/\(conversationId)/attachments/\(attachmentId)/assets/\(asset)"
        if let revision {
            path += "?revision=\(revision)"
        }
        return try await downloadCompanionAsset(path: path)
    }

    func downloadCompanionAsset(path: String) async throws -> AttachmentAssetDownload {
        let url = try authorizedURL(path: path)
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

    func listKnowledgeEntries(directoryId: String?) async throws -> CompanionKnowledgeTreeResponse {
        try await authorizedJSON(path: companionKnowledgeTreeEndpoint(directoryId: directoryId), method: "GET", body: nil, decode: CompanionKnowledgeTreeResponse.self)
    }

    func searchKnowledge(query: String, limit: Int) async throws -> CompanionKnowledgeSearchResponse {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 50)))),
        ]
        if let trimmed = query.trimmed.nilIfBlank {
            components.queryItems?.append(URLQueryItem(name: "q", value: trimmed))
        }
        let suffix = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        return try await authorizedJSON(path: "/companion/v1/knowledge/search\(suffix)", method: "GET", body: nil, decode: CompanionKnowledgeSearchResponse.self)
    }

    func readKnowledgeFile(fileId: String) async throws -> CompanionKnowledgeFileResponse {
        try await authorizedJSON(path: companionKnowledgeFileEndpoint(fileId: fileId), method: "GET", body: nil, decode: CompanionKnowledgeFileResponse.self)
    }

    func writeKnowledgeFile(fileId: String, content: String) async throws -> CompanionKnowledgeEntry {
        try await authorizedJSON(path: "/companion/v1/knowledge/file", method: "PUT", body: ["id": fileId, "content": content], decode: CompanionKnowledgeEntry.self)
    }

    func createKnowledgeFolder(folderId: String) async throws -> CompanionKnowledgeEntry {
        try await authorizedJSON(path: "/companion/v1/knowledge/folder", method: "POST", body: ["id": folderId], decode: CompanionKnowledgeEntry.self)
    }

    func renameKnowledgeEntry(id: String, newName: String, parentId: String?) async throws -> CompanionKnowledgeEntry {
        var body: [String: Any] = ["id": id, "newName": newName]
        if let parentId {
            body["parentId"] = parentId.trimmed
        }
        return try await authorizedJSON(path: "/companion/v1/knowledge/rename", method: "POST", body: body, decode: CompanionKnowledgeEntry.self)
    }

    func deleteKnowledgeEntry(id: String) async throws {
        struct DeleteResponse: Decodable { let ok: Bool }
        _ = try await authorizedJSON(path: companionKnowledgeEntryEndpoint(id: id), method: "DELETE", body: nil, decode: DeleteResponse.self)
    }

    func createKnowledgeImageAsset(fileName: String?, mimeType: String?, dataBase64: String) async throws -> CompanionKnowledgeImageAssetResponse {
        var body: [String: Any] = [
            "dataBase64": dataBase64,
        ]
        if let fileName = fileName?.nilIfBlank {
            body["fileName"] = fileName
        }
        if let mimeType = mimeType?.nilIfBlank {
            body["mimeType"] = mimeType
        }
        return try await authorizedJSON(path: "/companion/v1/knowledge/image", method: "POST", body: body, decode: CompanionKnowledgeImageAssetResponse.self)
    }

    func importKnowledge(_ input: CompanionKnowledgeImportRequest) async throws -> CompanionKnowledgeImportResponse {
        var body: [String: Any] = [
            "kind": input.kind.rawValue,
        ]
        if let directoryId = input.directoryId?.nilIfBlank {
            body["directoryId"] = directoryId
        }
        if let title = input.title?.nilIfBlank {
            body["title"] = title
        }
        if let text = input.text?.nilIfBlank {
            body["text"] = text
        }
        if let url = input.url?.nilIfBlank {
            body["url"] = url
        }
        if let mimeType = input.mimeType?.nilIfBlank {
            body["mimeType"] = mimeType
        }
        if let fileName = input.fileName?.nilIfBlank {
            body["fileName"] = fileName
        }
        if let dataBase64 = input.dataBase64?.nilIfBlank {
            body["dataBase64"] = dataBase64
        }
        if let sourceApp = input.sourceApp?.nilIfBlank {
            body["sourceApp"] = sourceApp
        }
        if let createdAt = input.createdAt?.nilIfBlank {
            body["createdAt"] = createdAt
        }
        return try await authorizedJSON(path: "/companion/v1/knowledge/import", method: "POST", body: body, decode: CompanionKnowledgeImportResponse.self)
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
                            "tailBlocks": ConversationBootstrapRequestOptions.defaultTailBlocks,
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
        if let conversationBehavior = draft.conversationBehavior.nilIfBlank {
            body["conversationBehavior"] = conversationBehavior
        }
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
        if draft.targetType == "background-agent", let callbackConversationId = draft.callbackConversationId.nilIfBlank {
            body["callbackConversationId"] = callbackConversationId
            body["deliverOnSuccess"] = draft.deliverOnSuccess
            body["deliverOnFailure"] = draft.deliverOnFailure
            body["notifyOnSuccess"] = draft.notifyOnSuccess.nilIfBlank ?? "disruptive"
            body["notifyOnFailure"] = draft.notifyOnFailure.nilIfBlank ?? "disruptive"
            body["requireAck"] = draft.requireAck
            body["autoResumeIfOpen"] = draft.autoResumeIfOpen
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
        components.queryItems = [URLQueryItem(name: "token", value: token)]
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
                totalBlocks: event["totalBlocks"] as? Int ?? blocks.count,
                isStreaming: event["isStreaming"] as? Bool
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
        case "queue_state":
            let steering = (event["steering"] as? [Any])?.compactMap { try? decodeModel(QueuedPromptPreview.self, from: $0) } ?? []
            let followUp = (event["followUp"] as? [Any])?.compactMap { try? decodeModel(QueuedPromptPreview.self, from: $0) } ?? []
            return .queueState(steering: steering, followUp: followUp)
        case "parallel_state":
            let jobs = (event["jobs"] as? [Any])?.compactMap { try? decodeModel(ParallelPromptPreview.self, from: $0) } ?? []
            return .parallelState(jobs)
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

    private func authorizedURL(path: String) throws -> URL {
        guard let baseURL = host.normalizedBaseURL,
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw CompanionClientError.invalidHostURL
        }

        let trimmedPath = path.trimmed
        if let querySeparator = trimmedPath.firstIndex(of: "?") {
            components.path = String(trimmedPath[..<querySeparator])
            components.percentEncodedQuery = String(trimmedPath[trimmedPath.index(after: querySeparator)...])
        } else {
            components.path = trimmedPath
            components.query = nil
        }

        guard let url = components.url else {
            throw CompanionClientError.invalidHostURL
        }
        return url
    }

    private func authorizedJSON<T: Decodable>(path: String, method: String, body: [String: Any]?, decode type: T.Type) async throws -> T {
        let url = try authorizedURL(path: path)
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

private struct MockCompanionSnapshot: Decodable {
    let hostLabel: String?
    let generatedAt: String?
    let conversations: [MockCompanionSnapshotConversation]
}

private struct MockCompanionSnapshotConversation: Decodable {
    let sessionMeta: SessionMeta
    let blocks: [DisplayBlock]
    let toolUseCount: Int?
}

private struct MockCompanionSeed {
    let host: CompanionHostRecord
    let listState: ConversationListState
    let conversations: [String: ConversationBootstrapEnvelope]
    let attachmentsByConversation: [String: [ConversationAttachmentRecord]]
    let artifactsByConversation: [String: [ConversationArtifactRecord]]
    let checkpointsByConversation: [String: [ConversationCommitCheckpointRecord]]
}

@MainActor
final class MockCompanionClient: CompanionClientProtocol {
    let host: CompanionHostRecord
    var supportsRunningConversationSimulation: Bool { true }
    var simulateRunningConversationFailureQueueMessages: [String] = []
    var listConversationsDelayNanoseconds: UInt64 = 0
    var listConversationsDelayQueueNanoseconds: [UInt64] = []
    var updateConversationTabsDelayNanoseconds: UInt64 = 0
    var updateConversationTabsFailureQueueMessages: [String] = []
    var listKnowledgeEntriesDelayNanoseconds: UInt64 = 0
    var listKnowledgeEntriesDelayQueueNanoseconds: [UInt64] = []
    var listAttachmentsDelayNanoseconds: UInt64 = 0
    var listAttachmentsFailureQueueMessages: [String] = []
    var readModelsDelayNanoseconds: UInt64 = 0
    var readModelsFailureQueueMessages: [String] = []
    var listTasksFailureQueueMessages: [String] = []
    var readTaskLogFailureQueueMessages: [String] = []
    var readRunLogFailureQueueMessages: [String] = []
    private(set) var lastConversationBootstrapOptions: ConversationBootstrapRequestOptions?
    var conversationBootstrapDelayNanoseconds: UInt64 = 0
    var conversationBootstrapDelayQueueNanoseconds: [UInt64] = []
    var createConversationDelayNanoseconds: UInt64 = 0
    var createConversationFailureQueueMessages: [String] = []
    var readKnowledgeFileDelayNanoseconds: UInt64 = 0
    var readKnowledgeFileDelayQueueNanoseconds: [UInt64] = []
    var writeKnowledgeFileDelayNanoseconds: UInt64 = 0
    var createKnowledgeImageAssetDelayNanoseconds: UInt64 = 0
    var renameKnowledgeEntryDelayNanoseconds: UInt64 = 0
    var promptSubmissionDelayNanoseconds: UInt64 = 0
    var promptSubmissionFailureQueueMessages: [String] = []
    var createAttachmentDelayNanoseconds: UInt64 = 0
    var createAttachmentFailureQueueMessages: [String] = []
    var updateAttachmentFailureQueueMessages: [String] = []
    var saveSshTargetDelayNanoseconds: UInt64 = 0
    var saveSshTargetFailureQueueMessages: [String] = []
    var deleteSshTargetDelayNanoseconds: UInt64 = 0
    var deleteSshTargetFailureQueueMessages: [String] = []
    var restoreQueuedPromptDelayNanoseconds: UInt64 = 0
    var restoreQueuedPromptFailureQueueMessages: [String] = []
    var manageParallelJobDelayNanoseconds: UInt64 = 0
    var manageParallelJobFailureQueueMessages: [String] = []
    var createConversationCheckpointDelayNanoseconds: UInt64 = 0
    var createConversationCheckpointFailureQueueMessages: [String] = []
    var createTaskDelayNanoseconds: UInt64 = 0
    var createTaskFailureQueueMessages: [String] = []
    var deleteTaskDelayNanoseconds: UInt64 = 0
    var deleteTaskFailureQueueMessages: [String] = []
    var runTaskDelayNanoseconds: UInt64 = 0
    var runTaskFailureQueueMessages: [String] = []
    var cancelRunDelayNanoseconds: UInt64 = 0
    var cancelRunFailureQueueMessages: [String] = []
    var listSshTargetsFailureQueueMessages: [String] = []
    var testSshTargetFailureQueueMessages: [String] = []
    var readRemoteDirectoryFailureQueueMessages: [String] = []
    var readDeviceAdminStateFailureQueueMessages: [String] = []
    var createPairingCodeDelayNanoseconds: UInt64 = 0
    var createPairingCodeFailureQueueMessages: [String] = []
    var createSetupStateDelayNanoseconds: UInt64 = 0
    var createSetupStateFailureQueueMessages: [String] = []
    var updatePairedDeviceDelayNanoseconds: UInt64 = 0
    var updatePairedDeviceFailureQueueMessages: [String] = []
    var deletePairedDeviceDelayNanoseconds: UInt64 = 0
    var deletePairedDeviceFailureQueueMessages: [String] = []
    var cancelDeferredResumeDelayNanoseconds: UInt64 = 0
    var cancelDeferredResumeFailureQueueMessages: [String] = []
    var fireDeferredResumeDelayNanoseconds: UInt64 = 0
    var fireDeferredResumeFailureQueueMessages: [String] = []
    var abortConversationDelayNanoseconds: UInt64 = 0
    var abortConversationFailureQueueMessages: [String] = []
    var takeOverConversationDelayNanoseconds: UInt64 = 0
    var takeOverConversationFailureQueueMessages: [String] = []
    var listRunsDelayNanoseconds: UInt64 = 0
    var listRunsFailureQueueMessages: [String] = []
    var changeExecutionTargetDelayNanoseconds: UInt64 = 0
    var changeExecutionTargetDelayQueueNanoseconds: [UInt64] = []
    var renameConversationDelayNanoseconds: UInt64 = 0
    var renameConversationDelayQueueNanoseconds: [UInt64] = []
    var renameConversationFailureQueueMessages: [String] = []
    var duplicateConversationDelayNanoseconds: UInt64 = 0
    var duplicateConversationFailureQueueMessages: [String] = []
    var changeConversationCwdDelayNanoseconds: UInt64 = 0
    var changeConversationCwdFailureQueueMessages: [String] = []
    var readConversationAutoModeFailureQueueMessages: [String] = []
    var updateConversationAutoModeDelayNanoseconds: UInt64 = 0
    var updateConversationAutoModeFailureQueueMessages: [String] = []
    var readConversationModelPreferencesFailureQueueMessages: [String] = []
    var updateConversationModelPreferencesDelayNanoseconds: UInt64 = 0
    var updateConversationModelPreferencesDelayQueueNanoseconds: [UInt64] = []
    var updateConversationModelPreferencesFailureQueueMessages: [String] = []
    var listConversationArtifactsFailureQueueMessages: [String] = []
    var readConversationArtifactFailureQueueMessages: [String] = []
    var listConversationCheckpointsFailureQueueMessages: [String] = []
    var readConversationCheckpointFailureQueueMessages: [String] = []
    var readAttachmentFailureQueueMessages: [String] = []
    var downloadAttachmentAssetFailureQueueMessages: [String] = []
    var deleteKnowledgeEntryDelayNanoseconds: UInt64 = 0
    private(set) var createConversationCount = 0
    private(set) var duplicateConversationCount = 0
    private(set) var changeConversationCwdCount = 0
    private(set) var updateConversationAutoModeCount = 0
    private(set) var updateConversationTabsCount = 0
    private(set) var writeKnowledgeFileCount = 0
    private(set) var createKnowledgeImageAssetCount = 0
    private(set) var renameKnowledgeEntryCount = 0
    private(set) var deleteKnowledgeEntryCount = 0
    private(set) var createTaskCount = 0
    private(set) var deleteTaskCount = 0
    private(set) var runTaskCount = 0
    private(set) var cancelRunCount = 0
    private(set) var saveSshTargetCount = 0
    private(set) var deleteSshTargetCount = 0
    private(set) var createPairingCodeCount = 0
    private(set) var createSetupStateCount = 0
    private(set) var updatePairedDeviceCount = 0
    private(set) var deletePairedDeviceCount = 0
    private(set) var promptSubmissionCount = 0
    private(set) var cancelDeferredResumeCount = 0
    private(set) var simulateRunningConversationCount = 0
    private(set) var abortConversationCount = 0
    private(set) var takeOverConversationCount = 0

    private var listState: ConversationListState
    private var conversations: [String: ConversationBootstrapEnvelope]
    private var attachmentsByConversation: [String: [ConversationAttachmentRecord]]
    private var artifactsByConversation: [String: [ConversationArtifactRecord]]
    private var checkpointsByConversation: [String: [ConversationCommitCheckpointRecord]]
    private var autoModeByConversation: [String: ConversationAutoModeState] = [:]
    private var knowledgeFiles: [String: String]
    private var knowledgeFolders: Set<String>
    private var knowledgeRootPath: String
    private var tasks: [ScheduledTaskDetail]
    private var runs: [DurableRunSummary]
    private var runLogs: [String: String]
    private var deviceAdminState: CompanionDeviceAdminState
    private var setupState: CompanionSetupState
    private var modelState: CompanionModelState
    private var sshTargetState: CompanionSshTargetState
    private var queuedPromptsByConversation: [String: (steering: [QueuedPromptPreview], followUp: [QueuedPromptPreview])] = [:]
    private var parallelJobsByConversation: [String: [ParallelPromptPreview]] = [:]
    private var appContinuations: [UUID: AsyncStream<CompanionAppEvent>.Continuation] = [:]
    private var conversationContinuations: [String: [UUID: AsyncStream<CompanionConversationEvent>.Continuation]] = [:]
    private var simulatedConversationTasks: [String: Task<Void, Never>] = [:]

    init() {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        if let deviceDemoSeed = Self.loadDeviceDemoSeed() {
            self.host = deviceDemoSeed.host
            self.listState = deviceDemoSeed.listState
            self.conversations = deviceDemoSeed.conversations
            self.attachmentsByConversation = deviceDemoSeed.attachmentsByConversation
            self.artifactsByConversation = deviceDemoSeed.artifactsByConversation
            self.checkpointsByConversation = deviceDemoSeed.checkpointsByConversation
        } else {
            let host = CompanionHostRecord(
                baseURL: "https://demo.personal-agent.invalid",
                hostLabel: "Demo Host",
                hostInstanceId: "host_demo",
                deviceId: "device_demo",
                deviceLabel: "iPhone Demo"
            )
            self.host = host

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
                cwd: "/home/user/project",
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
                cwd: "/home/user/other-project",
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
                workspacePaths: ["/home/user/project"]
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
                            DisplayBlock(type: "thinking", id: "t1", ts: now, text: "Audit the current companion client surface, compare it to desktop, and focus on the transcript and composer experience first."),
                            DisplayBlock(type: "tool_use", id: "tool-1", ts: now, title: "read AGENTS.md", tool: "read", input: .object(["path": .string("AGENTS.md")]), output: "# personal-agent repo instructions\n\nPrefer correct full implementations and validate UI changes visually.", durationMs: 780),
                            DisplayBlock(type: "tool_use", id: "tool-2", ts: now, title: "inspect ConversationView.swift", tool: "read", input: .object(["path": .string("apps/ios/PersonalAgentCompanion/PersonalAgentCompanion/ConversationView.swift")]), output: "ConversationScreen currently renders message bubbles and a compact composer with attachment affordances.", durationMs: 1420),
                            DisplayBlock(type: "text", id: "a1", ts: now, text: "The daemon-backed companion API is ready. The next step is to bring the conversation screen closer to desktop, tighten the composer, and make tool activity legible in the transcript."),
                        ],
                        blockOffset: 0,
                        totalBlocks: 5,
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
                            DisplayBlock(type: "thinking", id: "t2", ts: now, text: "Confirm the macOS assets are notarized, then double-check the public release repo before announcing it."),
                            DisplayBlock(type: "tool_use", id: "tool-3", ts: now, title: "release log", tool: "bash", input: .object(["command": .string("npm run release:desktop:patch")]), output: "Published v0.4.2 to user/personal-agent-releases and stapled the DMG.", durationMs: 6910),
                            DisplayBlock(type: "text", id: "a2", ts: now, text: "Sign the build, upload the blockmaps, and update the GitHub release body."),
                        ],
                        blockOffset: 0,
                        totalBlocks: 4,
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
                    cwd: "/home/user/project",
                    commitSha: "abc1234def567890",
                    shortSha: "abc1234",
                    subject: "Add iOS companion parity",
                    body: "Implements richer conversation controls and companion admin screens.",
                    authorName: "Test User",
                    authorEmail: "user@example.com",
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
                            authorName: "Test User",
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
        }
        self.autoModeByConversation = Dictionary(uniqueKeysWithValues: self.conversations.keys.map {
            ($0, ConversationAutoModeState(enabled: false, stopReason: nil, updatedAt: nil))
        })
        self.knowledgeRootPath = "/home/user/Documents/vault"
        self.knowledgeFiles = Self.defaultKnowledgeFiles()
        self.knowledgeFolders = Self.buildKnowledgeFolderSet(from: self.knowledgeFiles.keys)
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
                cwd: "/home/user/project",
                timeoutSeconds: 900,
                prompt: "Review outstanding work and summarize priorities.",
                conversationBehavior: nil,
                callbackConversationId: nil,
                deliverOnSuccess: nil,
                deliverOnFailure: nil,
                notifyOnSuccess: nil,
                notifyOnFailure: nil,
                requireAck: nil,
                autoResumeIfOpen: nil,
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
        self.modelState = CompanionModelState(
            currentModel: "gpt-5.4",
            currentThinkingLevel: "medium",
            currentServiceTier: "",
            models: [
                CompanionModelInfo(id: "gpt-5.5", provider: "openai", name: "GPT-5.5", context: 128000, supportedServiceTiers: ["auto", "priority"]),
                CompanionModelInfo(id: "gpt-5.4", provider: "openai", name: "GPT-5.4", context: 128000, supportedServiceTiers: ["auto", "priority"]),
                CompanionModelInfo(id: "gpt-5.4-mini", provider: "openai", name: "GPT-5.4 Mini", context: 128000, supportedServiceTiers: ["auto", "priority"]),
                CompanionModelInfo(id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6", context: 200000, supportedServiceTiers: nil),
                CompanionModelInfo(id: "gemini-2.5-pro", provider: "google", name: "Gemini 2.5 Pro", context: 1000000, supportedServiceTiers: ["default"]),
            ]
        )
        self.sshTargetState = CompanionSshTargetState(hosts: [
            CompanionSshTargetRecord(id: "ssh-1", label: "Buildbox", kind: "ssh", sshTarget: "user@buildbox")
        ])
    }

    private static func loadDeviceDemoSeed() -> MockCompanionSeed? {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PA_IOS_USE_DEVICE_DEMO_DATA"] == "1" else {
            return nil
        }

        let snapshotPath = environment["PA_IOS_DEMO_SNAPSHOT_FILE"]?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
            ?? defaultDeviceDemoSnapshotPath()
        let snapshotURL = URL(fileURLWithPath: snapshotPath)
        guard let data = try? Data(contentsOf: snapshotURL) else {
            return nil
        }
        guard let snapshot = try? JSONDecoder().decode(MockCompanionSnapshot.self, from: data), !snapshot.conversations.isEmpty else {
            return nil
        }

        let sessions = snapshot.conversations.map(\.sessionMeta)
        let executionTargets = buildExecutionTargets(from: sessions)
        let workspacePaths = Array(NSOrderedSet(array: sessions.map(\.cwd))).compactMap { $0 as? String }
        let ordering = ConversationOrdering(
            sessionIds: sessions.map(\.id),
            pinnedSessionIds: sessions.first.map { [$0.id] } ?? [],
            archivedSessionIds: [],
            workspacePaths: workspacePaths
        )
        let host = CompanionHostRecord(
            baseURL: "https://demo.personal-agent.invalid",
            hostLabel: snapshot.hostLabel?.nilIfBlank ?? "Device Demo",
            hostInstanceId: "host_device_demo",
            deviceId: "device_demo",
            deviceLabel: "iPhone Demo"
        )

        var conversations: [String: ConversationBootstrapEnvelope] = [:]
        var attachmentsByConversation: [String: [ConversationAttachmentRecord]] = [:]
        for conversation in snapshot.conversations {
            let signature = "device-demo-\(conversation.sessionMeta.id)"
            conversations[conversation.sessionMeta.id] = ConversationBootstrapEnvelope(
                bootstrap: ConversationBootstrapState(
                    conversationId: conversation.sessionMeta.id,
                    sessionDetail: SessionDetail(
                        meta: conversation.sessionMeta,
                        blocks: conversation.blocks,
                        blockOffset: 0,
                        totalBlocks: conversation.blocks.count,
                        signature: signature
                    ),
                    sessionDetailSignature: signature,
                    sessionDetailUnchanged: false,
                    sessionDetailAppendOnly: nil,
                    liveSession: ConversationBootstrapLiveSession(
                        live: conversation.sessionMeta.isLive ?? false,
                        id: conversation.sessionMeta.id,
                        cwd: conversation.sessionMeta.cwd,
                        sessionFile: conversation.sessionMeta.file,
                        title: conversation.sessionMeta.title,
                        isStreaming: conversation.sessionMeta.isRunning,
                        hasPendingHiddenTurn: false
                    )
                ),
                sessionMeta: conversation.sessionMeta,
                attachments: ConversationAttachmentListResponse(conversationId: conversation.sessionMeta.id, attachments: []),
                executionTargets: executionTargets
            )
            attachmentsByConversation[conversation.sessionMeta.id] = []
        }

        return MockCompanionSeed(
            host: host,
            listState: ConversationListState(sessions: sessions, ordering: ordering, executionTargets: executionTargets),
            conversations: conversations,
            attachmentsByConversation: attachmentsByConversation,
            artifactsByConversation: [:],
            checkpointsByConversation: [:]
        )
    }

    private static func buildExecutionTargets(from sessions: [SessionMeta]) -> [ExecutionTargetSummary] {
        var targets: [ExecutionTargetSummary] = [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")]
        var seen = Set(targets.map(\.id))
        for session in sessions {
            guard let remoteId = session.remoteHostId?.nilIfBlank, !seen.contains(remoteId) else {
                continue
            }
            seen.insert(remoteId)
            targets.append(ExecutionTargetSummary(id: remoteId, label: session.remoteHostLabel?.nilIfBlank ?? remoteId, kind: "ssh"))
        }
        return targets
    }

    private static func defaultDeviceDemoSnapshotPath() -> String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("demo-data")
            .appendingPathComponent("local-transcripts.json")
            .path
    }

    private static func defaultKnowledgeFiles() -> [String: String] {
        [
            "notes/ios-companion.md": "# iOS companion\n\n- Pair to the daemon-backed host\n- Browse chats, automations, and settings\n- Mobile KB browsing now lives in the companion app\n",
            "systems/runtime-model.md": "# Runtime model\n\nThe daemon owns the companion API and shared conversation state.\n",
            "references/release-checklist.md": "# Release checklist\n\n- Build the desktop app\n- Notarize and staple assets\n- Publish the release metadata\n",
        ]
    }

    private static func buildKnowledgeFolderSet(from fileIds: Dictionary<String, String>.Keys) -> Set<String> {
        var folders: Set<String> = []
        for fileId in fileIds {
            let components = fileId.split(separator: "/").map(String.init)
            guard components.count > 1 else {
                continue
            }
            for index in 1..<components.count {
                folders.insert(components.prefix(index).joined(separator: "/"))
            }
        }
        return folders
    }

    private func normalizeKnowledgeId(_ value: String?) -> String? {
        guard let trimmed = value?.trimmed.nilIfBlank else {
            return nil
        }
        return trimmed.replacingOccurrences(of: #"^/+|/+$"#, with: "", options: .regularExpression)
    }

    private func knowledgeDisplayName(for id: String) -> String {
        let normalized = id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        return normalized.split(separator: "/").last.map(String.init) ?? normalized
    }

    private func knowledgeParentDirectory(for id: String) -> String? {
        let normalized = id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        guard let slashIndex = normalized.lastIndex(of: "/") else {
            return nil
        }
        return String(normalized[..<slashIndex])
    }

    private func ensureKnowledgeParentFolders(for id: String) {
        let normalized = normalizeKnowledgeId(id) ?? id
        let components = normalized.split(separator: "/").map(String.init)
        guard components.count > 1 else {
            return
        }
        for index in 1..<components.count {
            knowledgeFolders.insert(components.prefix(index).joined(separator: "/"))
        }
    }

    private func makeKnowledgeEntry(id: String, kind: String, sizeBytes: Int) -> CompanionKnowledgeEntry {
        CompanionKnowledgeEntry(
            id: kind == "folder" ? "\(id)/" : id,
            kind: kind,
            name: knowledgeDisplayName(for: id),
            sizeBytes: kind == "folder" ? 0 : sizeBytes,
            updatedAt: ISO8601DateFormatter.flexible.string(from: .now)
        )
    }

    private func renameKnowledgeNode(from sourceId: String, to destinationId: String, isDirectory: Bool) {
        if isDirectory {
            let sourcePrefix = "\(sourceId)/"
            let destinationPrefix = "\(destinationId)/"
            var nextFolders: Set<String> = []
            for folderId in knowledgeFolders {
                if folderId == sourceId {
                    nextFolders.insert(destinationId)
                } else if folderId.hasPrefix(sourcePrefix) {
                    nextFolders.insert(destinationPrefix + folderId.dropFirst(sourcePrefix.count))
                } else {
                    nextFolders.insert(folderId)
                }
            }
            knowledgeFolders = nextFolders

            var nextFiles: [String: String] = [:]
            for (fileId, content) in knowledgeFiles {
                if fileId.hasPrefix(sourcePrefix) {
                    nextFiles[destinationPrefix + fileId.dropFirst(sourcePrefix.count)] = content
                } else {
                    nextFiles[fileId] = content
                }
            }
            knowledgeFiles = nextFiles
        } else if let content = knowledgeFiles.removeValue(forKey: sourceId) {
            knowledgeFiles[destinationId] = content
        }
        ensureKnowledgeParentFolders(for: destinationId)
    }

    private func deleteKnowledgeNode(_ id: String, isDirectory: Bool) {
        if isDirectory {
            let prefix = "\(id)/"
            knowledgeFolders = knowledgeFolders.filter { $0 != id && !$0.hasPrefix(prefix) }
            knowledgeFiles = knowledgeFiles.filter { key, _ in !key.hasPrefix(prefix) }
        } else {
            knowledgeFiles.removeValue(forKey: id)
        }
    }

    private func knowledgeEntries(in directoryId: String?) -> [CompanionKnowledgeEntry] {
        let normalizedDirectory = normalizeKnowledgeId(directoryId)
        var nextEntries: [CompanionKnowledgeEntry] = []
        var seenIds = Set<String>()
        let now = ISO8601DateFormatter.flexible.string(from: .now)

        for folderId in knowledgeFolders {
            let parentDirectory = knowledgeParentDirectory(for: folderId)
            guard parentDirectory == normalizedDirectory else {
                continue
            }
            let entryId = folderId.hasSuffix("/") ? folderId : "\(folderId)/"
            guard seenIds.insert(entryId).inserted else {
                continue
            }
            nextEntries.append(CompanionKnowledgeEntry(
                id: entryId,
                kind: "folder",
                name: knowledgeDisplayName(for: folderId),
                sizeBytes: 0,
                updatedAt: now
            ))
        }

        for (fileId, content) in knowledgeFiles {
            let parentDirectory = knowledgeParentDirectory(for: fileId)
            guard parentDirectory == normalizedDirectory else {
                continue
            }
            guard seenIds.insert(fileId).inserted else {
                continue
            }
            nextEntries.append(CompanionKnowledgeEntry(
                id: fileId,
                kind: "file",
                name: knowledgeDisplayName(for: fileId),
                sizeBytes: content.utf8.count,
                updatedAt: now
            ))
        }

        return nextEntries.sorted { lhs, rhs in
            if lhs.kind != rhs.kind {
                return lhs.kind == "folder"
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    func hello() async throws -> CompanionHello {
        CompanionHello(
            hostInstanceId: host.hostInstanceId,
            hostLabel: host.hostLabel,
            daemonVersion: "0.3.8",
            protocolVersion: "v1",
            transport: .init(websocket: true, singleSocket: true, httpAvailable: true),
            auth: .init(pairingRequired: true, bearerTokens: true),
            capabilities: .init(fullConversationLifecycle: true, executionTargets: true, executionTargetSwitching: true, attachments: true, attachmentWrite: true, knowledge: true, knowledgeWrite: true, knowledgeImport: true, deviceAdmin: true)
        )
    }

    func simulateRunningConversation(conversationId: String) async throws {
        simulateRunningConversationCount += 1
        if !simulateRunningConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(simulateRunningConversationFailureQueueMessages.removeFirst())
        }
        guard simulatedConversationTasks[conversationId] == nil else {
            return
        }
        guard conversations[conversationId]?.bootstrap.sessionDetail != nil else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }

        let startTime = ISO8601DateFormatter.flexible.string(from: .now)
        let thinkingBlockId = "sim-thinking-\(UUID().uuidString)"
        let firstToolCallId = "sim-tool-\(UUID().uuidString)"

        mutateConversation(conversationId: conversationId, isStreaming: true) { blocks in
            blocks.append(DisplayBlock(
                type: "thinking",
                id: thinkingBlockId,
                ts: startTime,
                text: "Continuing a simulated turn so you can test steer, follow-up, and parallel prompt behavior while the conversation is still running."
            ))
            blocks.append(DisplayBlock(
                type: "tool_use",
                id: firstToolCallId,
                ts: startTime,
                title: "Inspect queued prompt state",
                tool: "read",
                input: .object(["path": .string("apps/ios/PersonalAgentCompanion/PersonalAgentCompanion/CompanionStore.swift")]),
                output: "Loaded the conversation store to confirm queued prompt handling during the simulated run.",
                durationMs: 640,
                toolCallId: firstToolCallId
            ))
        }
        emitConversation(conversationId, .agentStart)
        emitConversationSnapshot(conversationId)

        simulatedConversationTasks[conversationId] = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else {
                return
            }
            self.mutateConversation(conversationId: conversationId, isStreaming: true) { blocks in
                if let index = blocks.lastIndex(where: { $0.id == thinkingBlockId }) {
                    let existing = blocks[index]
                    blocks[index] = DisplayBlock(
                        type: existing.type,
                        id: existing.id,
                        ts: existing.ts,
                        text: (existing.text ?? "") + " Still working while you try queued prompt modes.",
                        title: existing.title,
                        kind: existing.kind,
                        detail: existing.detail,
                        tool: existing.tool,
                        input: existing.input,
                        output: existing.output,
                        durationMs: existing.durationMs,
                        toolCallId: existing.toolCallId,
                        details: existing.details,
                        outputDeferred: existing.outputDeferred,
                        alt: existing.alt,
                        src: existing.src,
                        mimeType: existing.mimeType,
                        width: existing.width,
                        height: existing.height,
                        caption: existing.caption,
                        deferred: existing.deferred,
                        message: existing.message,
                        customType: existing.customType,
                        images: existing.images
                    )
                }
            }
            self.emitConversationSnapshot(conversationId)

            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else {
                return
            }
            let secondToolCallId = "sim-tool-\(UUID().uuidString)"
            let updateTime = ISO8601DateFormatter.flexible.string(from: .now)
            self.mutateConversation(conversationId: conversationId, isStreaming: true) { blocks in
                blocks.append(DisplayBlock(
                    type: "tool_use",
                    id: secondToolCallId,
                    ts: updateTime,
                    title: "Queue demo controls",
                    tool: "bash",
                    input: .object(["command": .string("simulate queued prompt controls")]),
                    output: "The simulated turn is still active. Use the send button menu to try steer, follow-up, or parallel prompts.",
                    durationMs: 920,
                    toolCallId: secondToolCallId
                ))
            }
            self.emitConversationSnapshot(conversationId)
        }
    }

    func connect() async throws {}

    func disconnect() {}

    func addMockDeferredResume(conversationId: String, resumeId: String) {
        guard var meta = conversations[conversationId]?.sessionMeta else {
            return
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let resume = DeferredResumeSummary(
            id: resumeId,
            sessionFile: meta.file,
            prompt: "Continue from the iOS demo deferred resume.",
            dueAt: now,
            createdAt: now,
            attempts: 0,
            status: "pending",
            readyAt: nil,
            kind: "follow-up",
            title: "iOS demo resume",
            behavior: "followUp",
            delivery: DeferredResumeDelivery(alertLevel: "disruptive", autoResumeIfOpen: true, requireAck: false)
        )
        meta.deferredResumes = (meta.deferredResumes ?? []).filter { $0.id != resumeId } + [resume]
        replaceConversationMeta(conversationId: conversationId, meta: meta)
    }

    func listConversations() async throws -> ConversationListState {
        let state = listState
        let delay = listConversationsDelayQueueNanoseconds.isEmpty ? listConversationsDelayNanoseconds : listConversationsDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        return state
    }

    func updateConversationTabs(ordering: ConversationOrdering) async throws {
        updateConversationTabsCount += 1
        if updateConversationTabsDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: updateConversationTabsDelayNanoseconds)
        }
        if !updateConversationTabsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(updateConversationTabsFailureQueueMessages.removeFirst())
        }
        listState = ConversationListState(sessions: listState.sessions, ordering: ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
    }

    func duplicateConversation(conversationId: String) async throws -> String {
        duplicateConversationCount += 1
        if duplicateConversationDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: duplicateConversationDelayNanoseconds)
        }
        if !duplicateConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(duplicateConversationFailureQueueMessages.removeFirst())
        }
        guard let source = conversations[conversationId],
              let sourceMeta = source.sessionMeta ?? source.bootstrap.sessionDetail?.meta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let duplicateId = "conv-\(Int.random(in: 100...999))"
        var duplicateMeta = SessionMeta(
            id: duplicateId,
            file: "/tmp/\(duplicateId).jsonl",
            timestamp: now,
            cwd: sourceMeta.cwd,
            cwdSlug: sourceMeta.cwdSlug,
            model: sourceMeta.model,
            title: sourceMeta.title,
            messageCount: sourceMeta.messageCount,
            isRunning: false,
            isLive: true,
            lastActivityAt: now,
            parentSessionFile: sourceMeta.parentSessionFile,
            parentSessionId: sourceMeta.parentSessionId,
            sourceRunId: sourceMeta.sourceRunId,
            remoteHostId: sourceMeta.remoteHostId,
            remoteHostLabel: sourceMeta.remoteHostLabel,
            remoteConversationId: sourceMeta.remoteConversationId,
            automationTaskId: sourceMeta.automationTaskId,
            automationTitle: sourceMeta.automationTitle,
            needsAttention: false,
            attentionUpdatedAt: nil,
            attentionUnreadMessageCount: nil,
            attentionUnreadActivityCount: nil,
            attentionActivityIds: nil
        )
        duplicateMeta.deferredResumes = sourceMeta.deferredResumes
        let blocks = source.bootstrap.sessionDetail?.blocks ?? []
        let duplicateAttachments = (attachmentsByConversation[conversationId] ?? []).map { attachment in
            ConversationAttachmentRecord(
                id: attachment.id,
                conversationId: duplicateId,
                kind: attachment.kind,
                title: attachment.title,
                createdAt: attachment.createdAt,
                updatedAt: attachment.updatedAt,
                currentRevision: attachment.currentRevision,
                latestRevision: attachment.latestRevision,
                revisions: attachment.revisions
            )
        }
        let duplicateArtifacts = (artifactsByConversation[conversationId] ?? []).map { artifact in
            ConversationArtifactRecord(
                id: artifact.id,
                conversationId: duplicateId,
                title: artifact.title,
                kind: artifact.kind,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt,
                revision: artifact.revision,
                content: artifact.content
            )
        }
        let duplicate = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: duplicateId,
                sessionDetail: SessionDetail(meta: duplicateMeta, blocks: blocks, blockOffset: 0, totalBlocks: blocks.count, signature: UUID().uuidString),
                sessionDetailSignature: UUID().uuidString,
                sessionDetailUnchanged: false,
                sessionDetailAppendOnly: nil,
                liveSession: ConversationBootstrapLiveSession(live: true, id: duplicateId, cwd: duplicateMeta.cwd, sessionFile: duplicateMeta.file, title: duplicateMeta.title, isStreaming: false, hasPendingHiddenTurn: false)
            ),
            sessionMeta: duplicateMeta,
            attachments: ConversationAttachmentListResponse(conversationId: duplicateId, attachments: duplicateAttachments.map(\.summary)),
            executionTargets: source.executionTargets
        )
        conversations[duplicateId] = duplicate
        attachmentsByConversation[duplicateId] = duplicateAttachments
        artifactsByConversation[duplicateId] = duplicateArtifacts
        checkpointsByConversation[duplicateId] = []
        autoModeByConversation[duplicateId] = autoModeByConversation[conversationId] ?? ConversationAutoModeState(enabled: false, stopReason: nil, updatedAt: nil)
        listState = ConversationListState(
            sessions: [duplicateMeta] + listState.sessions,
            ordering: ConversationOrdering(
                sessionIds: [duplicateId] + listState.ordering.sessionIds,
                pinnedSessionIds: listState.ordering.pinnedSessionIds,
                archivedSessionIds: listState.ordering.archivedSessionIds,
                workspacePaths: listState.ordering.workspacePaths
            ),
            executionTargets: listState.executionTargets
        )
        emitApp(.conversationListState(listState))
        return duplicateId
    }

    func listExecutionTargets() async throws -> [ExecutionTargetSummary] { listState.executionTargets ?? [] }

    func readModels() async throws -> CompanionModelState {
        let state = modelState
        if readModelsDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: readModelsDelayNanoseconds)
        }
        if !readModelsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readModelsFailureQueueMessages.removeFirst())
        }
        return state
    }

    func listSshTargets() async throws -> CompanionSshTargetState {
        if !listSshTargetsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listSshTargetsFailureQueueMessages.removeFirst())
        }
        return sshTargetState
    }

    func saveSshTarget(id: String?, label: String, sshTarget: String) async throws -> CompanionSshTargetState {
        saveSshTargetCount += 1
        if saveSshTargetDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: saveSshTargetDelayNanoseconds)
        }
        if !saveSshTargetFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(saveSshTargetFailureQueueMessages.removeFirst())
        }
        let targetId = id?.trimmed.nilIfBlank ?? "ssh-\(Int.random(in: 100...999))"
        let record = CompanionSshTargetRecord(id: targetId, label: label.trimmed, kind: "ssh", sshTarget: sshTarget.trimmed)
        sshTargetState = CompanionSshTargetState(hosts: sshTargetState.hosts.filter { $0.id != targetId } + [record])
        listState = ConversationListState(
            sessions: listState.sessions,
            ordering: listState.ordering,
            executionTargets: [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + sshTargetState.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
        )
        emitApp(.conversationListState(listState))
        return sshTargetState
    }

    func deleteSshTarget(targetId: String) async throws -> CompanionSshTargetState {
        deleteSshTargetCount += 1
        if deleteSshTargetDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: deleteSshTargetDelayNanoseconds)
        }
        if !deleteSshTargetFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(deleteSshTargetFailureQueueMessages.removeFirst())
        }
        sshTargetState = CompanionSshTargetState(hosts: sshTargetState.hosts.filter { $0.id != targetId })
        listState = ConversationListState(
            sessions: listState.sessions,
            ordering: listState.ordering,
            executionTargets: [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] + sshTargetState.hosts.map { ExecutionTargetSummary(id: $0.id, label: $0.label, kind: "ssh") }
        )
        emitApp(.conversationListState(listState))
        return sshTargetState
    }

    func testSshTarget(sshTarget: String) async throws -> CompanionSshTargetTestResult {
        if !testSshTargetFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(testSshTargetFailureQueueMessages.removeFirst())
        }
        return CompanionSshTargetTestResult(ok: true, sshTarget: sshTarget, os: "linux", arch: "arm64", platformKey: "linux-arm64", homeDirectory: "/home/user", tempDirectory: "/tmp", cacheDirectory: "/home/user/.cache", message: "SSH target reachable.")
    }

    func readRemoteDirectory(targetId: String, path: String?) async throws -> CompanionRemoteDirectoryListing {
        if !readRemoteDirectoryFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readRemoteDirectoryFailureQueueMessages.removeFirst())
        }
        let currentPath = path?.trimmed.nilIfBlank ?? "/home/user/workspace"
        switch currentPath {
        case "/home/user/workspace":
            return CompanionRemoteDirectoryListing(path: currentPath, parent: "/home/user", entries: [
                CompanionRemoteDirectoryEntry(name: "personal-agent", path: "/home/user/project", isDir: true, isHidden: false),
                CompanionRemoteDirectoryEntry(name: "familiar", path: "/home/user/other-project", isDir: true, isHidden: false),
            ])
        case "/home/user/project":
            return CompanionRemoteDirectoryListing(path: currentPath, parent: "/home/user/workspace", entries: [
                CompanionRemoteDirectoryEntry(name: "apps", path: "\(currentPath)/apps", isDir: true, isHidden: false),
                CompanionRemoteDirectoryEntry(name: "packages", path: "\(currentPath)/packages", isDir: true, isHidden: false),
                CompanionRemoteDirectoryEntry(name: "docs", path: "\(currentPath)/docs", isDir: true, isHidden: false),
            ])
        default:
            return CompanionRemoteDirectoryListing(path: currentPath, parent: URL(fileURLWithPath: currentPath).deletingLastPathComponent().path.nilIfBlank, entries: [])
        }
    }

    func conversationBootstrap(conversationId: String, options: ConversationBootstrapRequestOptions) async throws -> ConversationBootstrapEnvelope {
        lastConversationBootstrapOptions = options
        guard let value = conversations[conversationId] else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let delay = conversationBootstrapDelayQueueNanoseconds.isEmpty ? conversationBootstrapDelayNanoseconds : conversationBootstrapDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        return value
    }

    func emitUserMessage(conversationId: String, text: String) {
        let block = DisplayBlock(
            type: "user",
            id: "mock-user-\(UUID().uuidString)",
            ts: ISO8601DateFormatter.flexible.string(from: .now),
            text: text
        )
        mutateConversation(conversationId: conversationId) { blocks in
            blocks.append(block)
        }
        emitConversation(conversationId, .userMessage(block))
    }

    func emitTitleUpdate(conversationId: String, title: String) {
        emitConversation(conversationId, .titleUpdate(title))
    }

    func emitToolEnd(conversationId: String, toolCallId: String, toolName: String, isError: Bool, output: String) {
        emitConversation(conversationId, .toolEnd(toolCallId: toolCallId, toolName: toolName, isError: isError, durationMs: 100, output: output, details: nil))
    }

    func emitToolUpdate(conversationId: String, toolCallId: String, partialResult: JSONValue?) {
        emitConversation(conversationId, .toolUpdate(toolCallId: toolCallId, partialResult: partialResult))
    }

    func createConversation(_ input: NewConversationRequest, surfaceId: String) async throws -> ConversationBootstrapEnvelope {
        createConversationCount += 1
        if createConversationDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createConversationDelayNanoseconds)
        }
        if !createConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createConversationFailureQueueMessages.removeFirst())
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let conversationId = "conv-\(Int.random(in: 100...999))"
        let session = SessionMeta(
            id: conversationId,
            file: "/tmp/\(conversationId).jsonl",
            timestamp: now,
            cwd: input.cwd.nilIfBlank ?? "/home/user/project",
            cwdSlug: URL(fileURLWithPath: input.cwd.nilIfBlank ?? "/home/user/project").lastPathComponent,
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
        autoModeByConversation[conversationId] = ConversationAutoModeState(enabled: false, stopReason: nil, updatedAt: nil)
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

    func promptConversation(conversationId: String, text: String, images: [PromptImageDraft], attachmentRefs: [PromptAttachmentReference], mode: ConversationPromptSubmissionMode, surfaceId: String) async throws {
        promptSubmissionCount += 1
        if promptSubmissionDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: promptSubmissionDelayNanoseconds)
        }
        if !promptSubmissionFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(promptSubmissionFailureQueueMessages.removeFirst())
        }
        guard var envelope = conversations[conversationId], let detail = envelope.bootstrap.sessionDetail else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)

        if mode == .steer || mode == .followUp {
            let preview = QueuedPromptPreview(
                id: "queue-\(Int.random(in: 100...999))",
                text: text.nilIfBlank ?? "(empty prompt)",
                imageCount: images.count,
                restorable: true,
                pending: true
            )
            var queueState = queuedPromptsByConversation[conversationId] ?? (steering: [], followUp: [])
            if mode == .steer {
                queueState.steering.insert(preview, at: 0)
            } else {
                queueState.followUp.insert(preview, at: 0)
            }
            queuedPromptsByConversation[conversationId] = queueState
            emitConversation(conversationId, .queueState(steering: queueState.steering, followUp: queueState.followUp))
            return
        }

        if mode == .parallel {
            let childConversationId = "parallel-\(Int.random(in: 100...999))"
            let parallelTitle = text.nilIfBlank ?? "Parallel prompt"
            let childMeta = SessionMeta(
                id: childConversationId,
                file: "/tmp/\(childConversationId).jsonl",
                timestamp: now,
                cwd: detail.meta.cwd,
                cwdSlug: detail.meta.cwdSlug,
                model: detail.meta.model,
                title: "Parallel: \(parallelTitle)",
                messageCount: text.nilIfBlank == nil ? 0 : 1,
                isRunning: false,
                isLive: true,
                lastActivityAt: now,
                parentSessionFile: detail.meta.file,
                parentSessionId: detail.meta.id,
                sourceRunId: nil,
                remoteHostId: detail.meta.remoteHostId,
                remoteHostLabel: detail.meta.remoteHostLabel,
                remoteConversationId: nil,
                automationTaskId: nil,
                automationTitle: nil,
                needsAttention: false,
                attentionUpdatedAt: nil,
                attentionUnreadMessageCount: nil,
                attentionUnreadActivityCount: nil,
                attentionActivityIds: nil
            )
            let childBlocks = [
                text.nilIfBlank.map {
                    DisplayBlock(type: "user", id: UUID().uuidString, ts: now, text: $0)
                },
                DisplayBlock(type: "text", id: UUID().uuidString, ts: now, text: "This mock host started a parallel prompt in a separate conversation.")
            ].compactMap { $0 }
            conversations[childConversationId] = ConversationBootstrapEnvelope(
                bootstrap: ConversationBootstrapState(
                    conversationId: childConversationId,
                    sessionDetail: SessionDetail(meta: childMeta, blocks: childBlocks, blockOffset: 0, totalBlocks: childBlocks.count, signature: UUID().uuidString),
                    sessionDetailSignature: UUID().uuidString,
                    sessionDetailUnchanged: false,
                    sessionDetailAppendOnly: nil,
                    liveSession: ConversationBootstrapLiveSession(live: true, id: childConversationId, cwd: childMeta.cwd, sessionFile: childMeta.file, title: childMeta.title, isStreaming: false, hasPendingHiddenTurn: false)
                ),
                sessionMeta: childMeta,
                attachments: ConversationAttachmentListResponse(conversationId: childConversationId, attachments: []),
                executionTargets: envelope.executionTargets
            )
            attachmentsByConversation[childConversationId] = []
            artifactsByConversation[childConversationId] = []
            checkpointsByConversation[childConversationId] = []
            listState = ConversationListState(
                sessions: [childMeta] + listState.sessions,
                ordering: ConversationOrdering(
                    sessionIds: [childConversationId] + listState.ordering.sessionIds,
                    pinnedSessionIds: listState.ordering.pinnedSessionIds,
                    archivedSessionIds: listState.ordering.archivedSessionIds,
                    workspacePaths: listState.ordering.workspacePaths
                ),
                executionTargets: listState.executionTargets
            )
            emitApp(.conversationListState(listState))
            let preview = ParallelPromptPreview(
                id: "job-\(Int.random(in: 100...999))",
                prompt: text.nilIfBlank ?? "Parallel prompt",
                childConversationId: childConversationId,
                status: "ready",
                imageCount: images.count,
                attachmentRefs: attachmentRefs.map(\.title),
                touchedFiles: ["apps/ios/PersonalAgentCompanion/PersonalAgentCompanion/ConversationView.swift"],
                parentTouchedFiles: [],
                overlapFiles: [],
                sideEffects: [],
                resultPreview: "This mock host started a parallel prompt in a separate conversation.",
                error: nil
            )
            parallelJobsByConversation[conversationId, default: []].insert(preview, at: 0)
            emitConversation(conversationId, .parallelState(parallelJobsByConversation[conversationId] ?? []))
            return
        }

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
        let replyText: String
        switch mode {
        case .submit:
            replyText = "Native companion prompt accepted. This mock host is simulating a streamed assistant response over the daemon companion socket."
        case .steer:
            replyText = "This mock host queued a steer prompt for the running conversation."
        case .followUp:
            replyText = "This mock host queued a follow-up prompt after the current turn."
        case .parallel:
            replyText = "This mock host started a parallel prompt."
        }
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
        for chunk in replyText.split(separator: " ").map({ String($0) + " " }) {
            emitConversation(conversationId, .textDelta(chunk))
        }
        emitConversation(conversationId, .agentEnd)
        emitConversation(conversationId, .turnEnd)
    }

    func restoreQueuedPrompt(conversationId: String, behavior: String, index: Int, previewId: String?, surfaceId: String) async throws -> CompanionQueueRestoreResult {
        if restoreQueuedPromptDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: restoreQueuedPromptDelayNanoseconds)
        }
        if !restoreQueuedPromptFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(restoreQueuedPromptFailureQueueMessages.removeFirst())
        }
        var queueState = queuedPromptsByConversation[conversationId] ?? (steering: [], followUp: [])
        let source = behavior == "followUp" ? queueState.followUp : queueState.steering
        guard source.indices.contains(index) else {
            throw CompanionClientError.requestFailed("Queued prompt changed before it could be restored. Try again.")
        }
        let candidate = source[index]
        if let previewId = previewId?.nilIfBlank, candidate.id != previewId {
            throw CompanionClientError.requestFailed("Queued prompt changed before it could be restored. Try again.")
        }
        if behavior == "followUp" {
            queueState.followUp.remove(at: index)
        } else {
            queueState.steering.remove(at: index)
        }
        queuedPromptsByConversation[conversationId] = queueState
        emitConversation(conversationId, .queueState(steering: queueState.steering, followUp: queueState.followUp))
        return CompanionQueueRestoreResult(ok: true, text: candidate.text, images: [])
    }

    func manageParallelJob(conversationId: String, jobId: String, action: String, surfaceId: String) async throws -> CompanionParallelJobActionResult {
        if manageParallelJobDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: manageParallelJobDelayNanoseconds)
        }
        if !manageParallelJobFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(manageParallelJobFailureQueueMessages.removeFirst())
        }
        var jobs = parallelJobsByConversation[conversationId] ?? []
        guard let index = jobs.firstIndex(where: { $0.id == jobId }) else {
            throw CompanionClientError.requestFailed("Parallel prompt no longer exists.")
        }
        switch action {
        case "cancel":
            jobs.remove(at: index)
            parallelJobsByConversation[conversationId] = jobs
            emitConversation(conversationId, .parallelState(jobs))
            return CompanionParallelJobActionResult(ok: true, status: "cancelled")
        case "skip":
            jobs.remove(at: index)
            parallelJobsByConversation[conversationId] = jobs
            emitConversation(conversationId, .parallelState(jobs))
            return CompanionParallelJobActionResult(ok: true, status: "skipped")
        case "importNow":
            var job = jobs[index]
            job = ParallelPromptPreview(
                id: job.id,
                prompt: job.prompt,
                childConversationId: job.childConversationId,
                status: "importing",
                imageCount: job.imageCount,
                attachmentRefs: job.attachmentRefs,
                touchedFiles: job.touchedFiles,
                parentTouchedFiles: job.parentTouchedFiles,
                overlapFiles: job.overlapFiles,
                sideEffects: job.sideEffects,
                resultPreview: job.resultPreview,
                error: job.error
            )
            jobs[index] = job
            parallelJobsByConversation[conversationId] = jobs
            emitConversation(conversationId, .parallelState(jobs))
            jobs.remove(at: index)
            parallelJobsByConversation[conversationId] = jobs
            emitConversation(conversationId, .parallelState(jobs))
            if let childEnvelope = conversations[job.childConversationId],
               let childDetail = childEnvelope.bootstrap.sessionDetail,
               let parentEnvelope = conversations[conversationId],
               let parentDetail = parentEnvelope.bootstrap.sessionDetail {
                conversations[conversationId] = ConversationBootstrapEnvelope(
                    bootstrap: ConversationBootstrapState(
                        conversationId: parentEnvelope.bootstrap.conversationId,
                        sessionDetail: SessionDetail(
                            meta: parentDetail.meta,
                            blocks: parentDetail.blocks + childDetail.blocks.filter { $0.type == "text" },
                            blockOffset: 0,
                            totalBlocks: parentDetail.blocks.count + childDetail.blocks.filter { $0.type == "text" }.count,
                            signature: UUID().uuidString
                        ),
                        sessionDetailSignature: UUID().uuidString,
                        sessionDetailUnchanged: false,
                        sessionDetailAppendOnly: nil,
                        liveSession: parentEnvelope.bootstrap.liveSession
                    ),
                    sessionMeta: parentEnvelope.sessionMeta,
                    attachments: parentEnvelope.attachments,
                    executionTargets: parentEnvelope.executionTargets
                )
            }
            return CompanionParallelJobActionResult(ok: true, status: "imported")
        default:
            throw CompanionClientError.requestFailed("Unsupported parallel job action.")
        }
    }

    func cancelDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse {
        cancelDeferredResumeCount += 1
        if cancelDeferredResumeDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: cancelDeferredResumeDelayNanoseconds)
        }
        if !cancelDeferredResumeFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(cancelDeferredResumeFailureQueueMessages.removeFirst())
        }
        guard var meta = conversations[conversationId]?.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let remaining = (meta.deferredResumes ?? []).filter { $0.id != resumeId }
        meta.deferredResumes = remaining
        replaceConversationMeta(conversationId: conversationId, meta: meta)
        return DeferredResumeListResponse(conversationId: conversationId, resumes: remaining)
    }

    func fireDeferredResume(conversationId: String, resumeId: String) async throws -> DeferredResumeListResponse {
        if fireDeferredResumeDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: fireDeferredResumeDelayNanoseconds)
        }
        if !fireDeferredResumeFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(fireDeferredResumeFailureQueueMessages.removeFirst())
        }
        guard var meta = conversations[conversationId]?.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let remaining = (meta.deferredResumes ?? []).filter { $0.id != resumeId }
        meta.deferredResumes = remaining
        replaceConversationMeta(conversationId: conversationId, meta: meta)
        addMockRun(runId: "deferred-\(resumeId)", sourceType: "deferred-resume", sourceId: resumeId)
        return DeferredResumeListResponse(conversationId: conversationId, resumes: remaining)
    }

    func abortConversation(conversationId: String) async throws {
        abortConversationCount += 1
        if abortConversationDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: abortConversationDelayNanoseconds)
        }
        if !abortConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(abortConversationFailureQueueMessages.removeFirst())
        }
        let simulationTask = simulatedConversationTasks.removeValue(forKey: conversationId)
        simulationTask?.cancel()
        guard simulationTask != nil else {
            return
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        mutateConversation(conversationId: conversationId, isStreaming: false) { blocks in
            blocks.append(DisplayBlock(type: "summary", id: UUID().uuidString, ts: now, text: "Stopped the simulated running turn.", title: "Simulation stopped", kind: "related"))
        }
        emitConversationSnapshot(conversationId)
        emitConversation(conversationId, .agentEnd)
        emitConversation(conversationId, .turnEnd)
    }

    func takeOverConversation(conversationId: String, surfaceId: String) async throws {
        takeOverConversationCount += 1
        if takeOverConversationDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: takeOverConversationDelayNanoseconds)
        }
        if !takeOverConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(takeOverConversationFailureQueueMessages.removeFirst())
        }
        emitConversation(conversationId, .presenceState(.init(surfaces: [.init(surfaceId: surfaceId, surfaceType: "ios_native", connectedAt: ISO8601DateFormatter.flexible.string(from: .now))], controllerSurfaceId: surfaceId, controllerSurfaceType: "ios_native", controllerAcquiredAt: ISO8601DateFormatter.flexible.string(from: .now))))
    }

    func renameConversation(conversationId: String, name: String, surfaceId: String) async throws {
        let delay = renameConversationDelayQueueNanoseconds.isEmpty ? renameConversationDelayNanoseconds : renameConversationDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        if !renameConversationFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(renameConversationFailureQueueMessages.removeFirst())
        }
        guard var envelope = conversations[conversationId], let sessionMeta = envelope.sessionMeta else { return }
        var renamedMeta = SessionMeta(
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
        renamedMeta.deferredResumes = sessionMeta.deferredResumes
        replaceConversationMeta(conversationId: conversationId, meta: renamedMeta)
        emitConversation(conversationId, .titleUpdate(name))
        emitApp(.conversationListState(listState))
    }

    func changeConversationCwd(conversationId: String, cwd: String, surfaceId: String) async throws -> ConversationCwdChangeResult {
        changeConversationCwdCount += 1
        if changeConversationCwdDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: changeConversationCwdDelayNanoseconds)
        }
        if !changeConversationCwdFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(changeConversationCwdFailureQueueMessages.removeFirst())
        }
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let nextId = conversationId == "conv-1" ? "conv-1-cwd" : conversationId
        var updatedMeta = SessionMeta(
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
        updatedMeta.deferredResumes = meta.deferredResumes
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

    func readConversationAutoMode(conversationId: String) async throws -> ConversationAutoModeState {
        if !readConversationAutoModeFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readConversationAutoModeFailureQueueMessages.removeFirst())
        }
        guard conversations[conversationId] != nil else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        return autoModeByConversation[conversationId] ?? ConversationAutoModeState(enabled: false, stopReason: nil, updatedAt: nil)
    }

    func updateConversationAutoMode(conversationId: String, enabled: Bool, surfaceId: String) async throws -> ConversationAutoModeState {
        updateConversationAutoModeCount += 1
        if updateConversationAutoModeDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: updateConversationAutoModeDelayNanoseconds)
        }
        if !updateConversationAutoModeFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(updateConversationAutoModeFailureQueueMessages.removeFirst())
        }
        guard conversations[conversationId] != nil else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        let nextState = ConversationAutoModeState(
            enabled: enabled,
            stopReason: enabled ? nil : autoModeByConversation[conversationId]?.stopReason,
            updatedAt: ISO8601DateFormatter.flexible.string(from: .now)
        )
        autoModeByConversation[conversationId] = nextState
        return nextState
    }

    func readConversationModelPreferences(conversationId: String) async throws -> ConversationModelPreferencesState {
        if !readConversationModelPreferencesFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readConversationModelPreferencesFailureQueueMessages.removeFirst())
        }
        guard let meta = conversations[conversationId]?.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        return ConversationModelPreferencesState(
            currentModel: meta.model,
            currentThinkingLevel: modelState.currentThinkingLevel,
            currentServiceTier: modelState.currentServiceTier,
            hasExplicitServiceTier: !modelState.currentServiceTier.trimmed.isEmpty
        )
    }

    func updateConversationModelPreferences(conversationId: String, model: String?, thinkingLevel: String?, serviceTier: String?, surfaceId: String) async throws -> ConversationModelPreferencesState {
        let delay = updateConversationModelPreferencesDelayQueueNanoseconds.isEmpty ? updateConversationModelPreferencesDelayNanoseconds : updateConversationModelPreferencesDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        if !updateConversationModelPreferencesFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(updateConversationModelPreferencesFailureQueueMessages.removeFirst())
        }
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        var updatedMeta = SessionMeta(
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
        updatedMeta.deferredResumes = meta.deferredResumes
        conversations[conversationId] = ConversationBootstrapEnvelope(bootstrap: envelope.bootstrap, sessionMeta: updatedMeta, attachments: envelope.attachments, executionTargets: envelope.executionTargets)
        listState = ConversationListState(sessions: listState.sessions.map { $0.id == conversationId ? updatedMeta : $0 }, ordering: listState.ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
        modelState = CompanionModelState(
            currentModel: model?.nilIfBlank ?? updatedMeta.model,
            currentThinkingLevel: thinkingLevel?.nilIfBlank ?? modelState.currentThinkingLevel,
            currentServiceTier: serviceTier?.nilIfBlank ?? "",
            models: modelState.models
        )
        return ConversationModelPreferencesState(
            currentModel: updatedMeta.model,
            currentThinkingLevel: modelState.currentThinkingLevel,
            currentServiceTier: modelState.currentServiceTier,
            hasExplicitServiceTier: !modelState.currentServiceTier.trimmed.isEmpty
        )
    }

    func listConversationArtifacts(conversationId: String) async throws -> [ConversationArtifactSummary] {
        if !listConversationArtifactsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listConversationArtifactsFailureQueueMessages.removeFirst())
        }
        return (artifactsByConversation[conversationId] ?? []).map { artifact in
            ConversationArtifactSummary(id: artifact.id, conversationId: artifact.conversationId, title: artifact.title, kind: artifact.kind, createdAt: artifact.createdAt, updatedAt: artifact.updatedAt, revision: artifact.revision)
        }
    }

    func readConversationArtifact(conversationId: String, artifactId: String) async throws -> ConversationArtifactRecord {
        if !readConversationArtifactFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readConversationArtifactFailureQueueMessages.removeFirst())
        }
        guard let artifact = artifactsByConversation[conversationId]?.first(where: { $0.id == artifactId }) else {
            throw CompanionClientError.requestFailed("Artifact not found.")
        }
        return artifact
    }

    func listConversationCheckpoints(conversationId: String) async throws -> [ConversationCommitCheckpointSummary] {
        if !listConversationCheckpointsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listConversationCheckpointsFailureQueueMessages.removeFirst())
        }
        return (checkpointsByConversation[conversationId] ?? []).map { checkpoint in
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
        if !readConversationCheckpointFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readConversationCheckpointFailureQueueMessages.removeFirst())
        }
        guard let checkpoint = checkpointsByConversation[conversationId]?.first(where: { $0.id == checkpointId }) else {
            throw CompanionClientError.requestFailed("Checkpoint not found.")
        }
        return checkpoint
    }

    func createConversationCheckpoint(conversationId: String, message: String, paths: [String]) async throws -> ConversationCommitCheckpointRecord {
        if createConversationCheckpointDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createConversationCheckpointDelayNanoseconds)
        }
        if !createConversationCheckpointFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createConversationCheckpointFailureQueueMessages.removeFirst())
        }
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let normalizedPaths = paths.map { $0.trimmed }.filter { !$0.isEmpty }
        let record = ConversationCommitCheckpointRecord(
            id: UUID().uuidString.lowercased(),
            conversationId: conversationId,
            title: message,
            cwd: conversations[conversationId]?.sessionMeta?.cwd ?? "/home/user/project",
            commitSha: UUID().uuidString.replacingOccurrences(of: "-", with: ""),
            shortSha: String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(7)),
            subject: message,
            body: nil,
            authorName: "Test User",
            authorEmail: "user@example.com",
            committedAt: now,
            createdAt: now,
            updatedAt: now,
            fileCount: max(1, normalizedPaths.count),
            linesAdded: max(1, normalizedPaths.count * 5),
            linesDeleted: max(0, normalizedPaths.count),
            commentCount: 0,
            files: (normalizedPaths.isEmpty ? ["."] : normalizedPaths).map {
                ConversationCommitCheckpointFile(path: $0, previousPath: nil, status: "modified", additions: 5, deletions: 1, patch: "diff --git a/\($0) b/\($0)\n+mock checkpoint\n")
            },
            comments: []
        )
        checkpointsByConversation[conversationId, default: []].insert(record, at: 0)
        return record
    }

    func changeExecutionTarget(conversationId: String, executionTargetId: String) async throws -> ConversationBootstrapEnvelope {
        let delay = changeExecutionTargetDelayQueueNanoseconds.isEmpty ? changeExecutionTargetDelayNanoseconds : changeExecutionTargetDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        guard let envelope = conversations[conversationId], let meta = envelope.sessionMeta else {
            throw CompanionClientError.requestFailed("Conversation not found.")
        }
        var updatedMeta = SessionMeta(
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
        updatedMeta.deferredResumes = meta.deferredResumes
        let updated = ConversationBootstrapEnvelope(bootstrap: envelope.bootstrap, sessionMeta: updatedMeta, attachments: envelope.attachments, executionTargets: envelope.executionTargets)
        conversations[conversationId] = updated
        listState = ConversationListState(sessions: listState.sessions.map { $0.id == conversationId ? updatedMeta : $0 }, ordering: listState.ordering, executionTargets: listState.executionTargets)
        emitApp(.conversationListState(listState))
        return updated
    }

    func listAttachments(conversationId: String) async throws -> ConversationAttachmentListResponse {
        let attachments = (attachmentsByConversation[conversationId] ?? []).map(\.summary)
        if listAttachmentsDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: listAttachmentsDelayNanoseconds)
        }
        if !listAttachmentsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listAttachmentsFailureQueueMessages.removeFirst())
        }
        return ConversationAttachmentListResponse(conversationId: conversationId, attachments: attachments)
    }

    func readAttachment(conversationId: String, attachmentId: String) async throws -> ConversationAttachmentDetailResponse {
        if !readAttachmentFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readAttachmentFailureQueueMessages.removeFirst())
        }
        guard let attachment = attachmentsByConversation[conversationId]?.first(where: { $0.id == attachmentId }) else {
            throw CompanionClientError.requestFailed("Attachment not found.")
        }
        return ConversationAttachmentDetailResponse(conversationId: conversationId, attachment: attachment)
    }

    func downloadAttachmentAsset(conversationId: String, attachmentId: String, asset: String, revision: Int?) async throws -> AttachmentAssetDownload {
        if !downloadAttachmentAssetFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(downloadAttachmentAssetFailureQueueMessages.removeFirst())
        }
        if asset == "preview" {
            let pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W2KIiQAAAAASUVORK5CYII="
            return AttachmentAssetDownload(data: Data(base64Encoded: pngBase64) ?? Data(), mimeType: "image/png", fileName: "Preview.png")
        }
        let json = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"https://personal-agent.invalid\",\"elements\":[],\"appState\":{},\"files\":{}}"
        return AttachmentAssetDownload(data: Data(json.utf8), mimeType: "application/vnd.excalidraw+json", fileName: "Whiteboard.excalidraw")
    }

    func downloadCompanionAsset(path: String) async throws -> AttachmentAssetDownload {
        if let data = dataURLData(path) {
            return AttachmentAssetDownload(data: data, mimeType: "image/png", fileName: nil)
        }
        let pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W2KIiQAAAAASUVORK5CYII="
        return AttachmentAssetDownload(data: Data(base64Encoded: pngBase64) ?? Data(), mimeType: "image/png", fileName: "Image.png")
    }

    func createAttachment(conversationId: String, draft: AttachmentEditorDraft) async throws -> ConversationAttachmentMutationResponse {
        if createAttachmentDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createAttachmentDelayNanoseconds)
        }
        if !createAttachmentFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createAttachmentFailureQueueMessages.removeFirst())
        }
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
        if !updateAttachmentFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(updateAttachmentFailureQueueMessages.removeFirst())
        }
        guard let index = attachmentsByConversation[conversationId]?.firstIndex(where: { $0.id == attachmentId }) else {
            throw CompanionClientError.requestFailed("Attachment not found.")
        }
        guard let sourceAsset = draft.sourceAsset, let previewAsset = draft.previewAsset else {
            throw CompanionClientError.requestFailed("Source and preview assets are required.")
        }
        let existing = attachmentsByConversation[conversationId]![index]
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let nextRevision = existing.currentRevision + 1
        let revision = ConversationAttachmentRevision(
            revision: nextRevision,
            createdAt: now,
            sourceName: sourceAsset.fileName,
            sourceMimeType: sourceAsset.mimeType,
            sourceDownloadPath: existing.latestRevision.sourceDownloadPath,
            previewName: previewAsset.fileName,
            previewMimeType: previewAsset.mimeType,
            previewDownloadPath: existing.latestRevision.previewDownloadPath,
            note: draft.note.nilIfBlank
        )
        let updated = ConversationAttachmentRecord(
            id: existing.id,
            conversationId: existing.conversationId,
            kind: existing.kind,
            title: draft.title.nilIfBlank ?? existing.title,
            createdAt: existing.createdAt,
            updatedAt: now,
            currentRevision: nextRevision,
            latestRevision: revision,
            revisions: existing.revisions + [revision]
        )
        attachmentsByConversation[conversationId]![index] = updated
        let attachments = (attachmentsByConversation[conversationId] ?? []).map(\.summary)
        return ConversationAttachmentMutationResponse(conversationId: conversationId, attachment: updated, attachments: attachments)
    }

    func listKnowledgeEntries(directoryId: String?) async throws -> CompanionKnowledgeTreeResponse {
        let delay = listKnowledgeEntriesDelayQueueNanoseconds.isEmpty ? listKnowledgeEntriesDelayNanoseconds : listKnowledgeEntriesDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        return CompanionKnowledgeTreeResponse(
            root: knowledgeRootPath,
            entries: knowledgeEntries(in: directoryId)
        )
    }

    func searchKnowledge(query: String, limit: Int) async throws -> CompanionKnowledgeSearchResponse {
        let normalized = query.trimmed.lowercased()
        let results = knowledgeFiles.keys
            .filter { $0.lowercased().hasSuffix(".md") }
            .compactMap { fileId -> CompanionKnowledgeSearchResult? in
                let name = knowledgeDisplayName(for: fileId)
                let title = name.replacingOccurrences(of: #"\.md$"#, with: "", options: .regularExpression)
                let content = knowledgeFiles[fileId] ?? ""
                if normalized.isEmpty {
                    return CompanionKnowledgeSearchResult(id: fileId, name: name, title: title, excerpt: fileId)
                }
                let haystacks = [title.lowercased(), fileId.lowercased(), content.lowercased()]
                guard haystacks.contains(where: { $0.contains(normalized) }) else {
                    return nil
                }
                let excerpt: String
                if let range = content.lowercased().range(of: normalized) {
                    let start = content.distance(from: content.startIndex, to: range.lowerBound)
                    let nsContent = content as NSString
                    let windowStart = max(0, start - 40)
                    let windowLength = min(nsContent.length - windowStart, normalized.count + 80)
                    excerpt = nsContent.substring(with: NSRange(location: windowStart, length: windowLength)).replacingOccurrences(of: "\n", with: " ")
                } else {
                    excerpt = fileId
                }
                return CompanionKnowledgeSearchResult(id: fileId, name: name, title: title, excerpt: excerpt)
            }
            .sorted { lhs, rhs in
                lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
        return CompanionKnowledgeSearchResponse(results: Array(results.prefix(max(1, min(limit, 50)))))
    }

    func readKnowledgeFile(fileId: String) async throws -> CompanionKnowledgeFileResponse {
        guard let normalizedFileId = normalizeKnowledgeId(fileId), let content = knowledgeFiles[normalizedFileId] else {
            throw CompanionClientError.requestFailed("Knowledge file not found.")
        }
        let delay = readKnowledgeFileDelayQueueNanoseconds.isEmpty ? readKnowledgeFileDelayNanoseconds : readKnowledgeFileDelayQueueNanoseconds.removeFirst()
        if delay > 0 {
            try await Task.sleep(nanoseconds: delay)
        }
        return CompanionKnowledgeFileResponse(
            id: normalizedFileId,
            content: content,
            updatedAt: ISO8601DateFormatter.flexible.string(from: .now)
        )
    }

    func writeKnowledgeFile(fileId: String, content: String) async throws -> CompanionKnowledgeEntry {
        guard let normalizedFileId = normalizeKnowledgeId(fileId) else {
            throw CompanionClientError.requestFailed("Knowledge file id is required.")
        }
        writeKnowledgeFileCount += 1
        if writeKnowledgeFileDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: writeKnowledgeFileDelayNanoseconds)
        }
        ensureKnowledgeParentFolders(for: normalizedFileId)
        knowledgeFiles[normalizedFileId] = content
        return CompanionKnowledgeEntry(
            id: normalizedFileId,
            kind: "file",
            name: knowledgeDisplayName(for: normalizedFileId),
            sizeBytes: content.utf8.count,
            updatedAt: ISO8601DateFormatter.flexible.string(from: .now)
        )
    }

    func createKnowledgeFolder(folderId: String) async throws -> CompanionKnowledgeEntry {
        guard let normalizedFolderId = normalizeKnowledgeId(folderId) else {
            throw CompanionClientError.requestFailed("Knowledge folder id is required.")
        }
        ensureKnowledgeParentFolders(for: normalizedFolderId)
        knowledgeFolders.insert(normalizedFolderId)
        return makeKnowledgeEntry(id: normalizedFolderId, kind: "folder", sizeBytes: 0)
    }

    func renameKnowledgeEntry(id: String, newName: String, parentId: String?) async throws -> CompanionKnowledgeEntry {
        renameKnowledgeEntryCount += 1
        if renameKnowledgeEntryDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: renameKnowledgeEntryDelayNanoseconds)
        }
        guard let normalizedId = normalizeKnowledgeId(id) else {
            throw CompanionClientError.requestFailed("Knowledge entry id is required.")
        }
        let trimmedName = newName.trimmed
        guard !trimmedName.isEmpty, !trimmedName.contains("/"), !trimmedName.contains("\\") else {
            throw CompanionClientError.requestFailed("Knowledge entry names cannot contain path separators.")
        }
        let parentDirectory = parentId == nil ? knowledgeParentDirectory(for: normalizedId) : normalizeKnowledgeId(parentId)
        let destinationId = [parentDirectory, trimmedName].compactMap { $0 }.joined(separator: "/")
        let isDirectory = knowledgeFolders.contains(normalizedId)
        if isDirectory, let parentDirectory, (parentDirectory == normalizedId || parentDirectory.hasPrefix("\(normalizedId)/")) {
            throw CompanionClientError.requestFailed("A folder cannot be moved into itself.")
        }
        guard destinationId != normalizedId else {
            if knowledgeFiles[normalizedId] != nil {
                return makeKnowledgeEntry(id: normalizedId, kind: "file", sizeBytes: knowledgeFiles[normalizedId]?.utf8.count ?? 0)
            }
            return makeKnowledgeEntry(id: normalizedId, kind: "folder", sizeBytes: 0)
        }
        if knowledgeFiles[destinationId] != nil || knowledgeFolders.contains(destinationId) {
            throw CompanionClientError.requestFailed("A file or folder with that name already exists.")
        }
        guard isDirectory || knowledgeFiles[normalizedId] != nil else {
            throw CompanionClientError.requestFailed("Knowledge entry not found.")
        }
        renameKnowledgeNode(from: normalizedId, to: destinationId, isDirectory: isDirectory)
        if isDirectory {
            return makeKnowledgeEntry(id: destinationId, kind: "folder", sizeBytes: 0)
        }
        return makeKnowledgeEntry(id: destinationId, kind: "file", sizeBytes: knowledgeFiles[destinationId]?.utf8.count ?? 0)
    }

    func deleteKnowledgeEntry(id: String) async throws {
        guard let normalizedId = normalizeKnowledgeId(id) else {
            throw CompanionClientError.requestFailed("Knowledge entry id is required.")
        }
        deleteKnowledgeEntryCount += 1
        if deleteKnowledgeEntryDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: deleteKnowledgeEntryDelayNanoseconds)
        }
        let isDirectory = knowledgeFolders.contains(normalizedId)
        guard isDirectory || knowledgeFiles[normalizedId] != nil else {
            throw CompanionClientError.requestFailed("Knowledge entry not found.")
        }
        deleteKnowledgeNode(normalizedId, isDirectory: isDirectory)
    }

    func createKnowledgeImageAsset(fileName: String?, mimeType: String?, dataBase64: String) async throws -> CompanionKnowledgeImageAssetResponse {
        createKnowledgeImageAssetCount += 1
        if createKnowledgeImageAssetDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createKnowledgeImageAssetDelayNanoseconds)
        }
        let baseName = fileName?.trimmed.nilIfBlank ?? "image.png"
        let safeName = baseName.replacingOccurrences(of: #"[^a-zA-Z0-9._-]"#, with: "-", options: .regularExpression)
        let assetId = "_attachments/\(safeName)"
        return CompanionKnowledgeImageAssetResponse(id: assetId, url: "shared-image://\(safeName)?mime=\(mimeType?.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "image/png")&data=\(dataBase64)")
    }

    func importKnowledge(_ input: CompanionKnowledgeImportRequest) async throws -> CompanionKnowledgeImportResponse {
        let now = input.createdAt ?? ISO8601DateFormatter.flexible.string(from: .now)
        let directoryId = normalizeKnowledgeId(input.directoryId ?? "Inbox") ?? "Inbox"
        ensureKnowledgeParentFolders(for: directoryId)
        let baseName: String = {
            if let title = input.title?.trimmed.nilIfBlank {
                return title
            }
            switch input.kind {
            case .text:
                return input.text?.trimmed.nilIfBlank?.split(separator: "\n").first.map(String.init) ?? "Shared text"
            case .url:
                return input.url?.trimmed.nilIfBlank ?? "Shared link"
            case .image:
                return input.fileName?.trimmed.nilIfBlank?.replacingOccurrences(of: #"\.[^.]+$"#, with: "", options: .regularExpression) ?? "Shared image"
            }
        }()
        let slugBase = baseName
            .lowercased()
            .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            .nilIfBlank ?? "shared-note"
        var fileId = "\(directoryId)/\(slugBase).md"
        var suffix = 2
        while knowledgeFiles[fileId] != nil {
            fileId = "\(directoryId)/\(slugBase)-\(suffix).md"
            suffix += 1
        }
        let content: String = {
            switch input.kind {
            case .text:
                return input.text?.trimmed.nilIfBlank ?? "Shared from iOS on \(now)."
            case .url:
                let url = input.url?.trimmed.nilIfBlank ?? ""
                return "Source: [\(url)](\(url))"
            case .image:
                return "![\(baseName)](shared-image://\(slugBase))\n\nImported from iOS."
            }
        }()
        let entry = try await writeKnowledgeFile(fileId: fileId, content: content)
        return CompanionKnowledgeImportResponse(note: entry, sourceKind: input.kind.rawValue, title: baseName, asset: nil)
    }

    func listTasks() async throws -> [ScheduledTaskSummary] {
        if !listTasksFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listTasksFailureQueueMessages.removeFirst())
        }
        return tasks.map { task in
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
                conversationBehavior: task.conversationBehavior,
                callbackConversationId: task.callbackConversationId,
                deliverOnSuccess: task.deliverOnSuccess,
                deliverOnFailure: task.deliverOnFailure,
                notifyOnSuccess: task.notifyOnSuccess,
                notifyOnFailure: task.notifyOnFailure,
                requireAck: task.requireAck,
                autoResumeIfOpen: task.autoResumeIfOpen,
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
        if !readTaskLogFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readTaskLogFailureQueueMessages.removeFirst())
        }
        return DurableRunLogResponse(path: "/tmp/\(taskId).log", log: runLogs[taskId] ?? "[info] Task \(taskId) completed.\n")
    }

    func createTask(draft: ScheduledTaskEditorDraft) async throws -> ScheduledTaskDetail {
        createTaskCount += 1
        if createTaskDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createTaskDelayNanoseconds)
        }
        if !createTaskFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createTaskFailureQueueMessages.removeFirst())
        }
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
            conversationBehavior: draft.conversationBehavior.nilIfBlank,
            callbackConversationId: draft.callbackConversationId.nilIfBlank,
            deliverOnSuccess: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.deliverOnSuccess,
            deliverOnFailure: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.deliverOnFailure,
            notifyOnSuccess: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.notifyOnSuccess.nilIfBlank,
            notifyOnFailure: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.notifyOnFailure.nilIfBlank,
            requireAck: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.requireAck,
            autoResumeIfOpen: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.autoResumeIfOpen,
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
            conversationBehavior: draft.conversationBehavior.nilIfBlank,
            callbackConversationId: draft.callbackConversationId.nilIfBlank,
            deliverOnSuccess: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.deliverOnSuccess,
            deliverOnFailure: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.deliverOnFailure,
            notifyOnSuccess: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.notifyOnSuccess.nilIfBlank,
            notifyOnFailure: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.notifyOnFailure.nilIfBlank,
            requireAck: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.requireAck,
            autoResumeIfOpen: draft.callbackConversationId.nilIfBlank == nil ? nil : draft.autoResumeIfOpen,
            lastStatus: previous.lastStatus,
            lastRunAt: previous.lastRunAt,
            threadConversationId: draft.threadConversationId.nilIfBlank,
            threadTitle: listState.sessions.first(where: { $0.id == draft.threadConversationId.nilIfBlank })?.title
        )
        tasks[index] = updated
        return updated
    }

    func deleteTask(taskId: String) async throws {
        deleteTaskCount += 1
        if deleteTaskDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: deleteTaskDelayNanoseconds)
        }
        if !deleteTaskFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(deleteTaskFailureQueueMessages.removeFirst())
        }
        tasks.removeAll { $0.id == taskId }
    }

    func runTask(taskId: String) async throws -> ScheduledTaskRunResponse {
        runTaskCount += 1
        if runTaskDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: runTaskDelayNanoseconds)
        }
        if !runTaskFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(runTaskFailureQueueMessages.removeFirst())
        }
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
        let snapshot = runs
        if listRunsDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: listRunsDelayNanoseconds)
        }
        if !listRunsFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(listRunsFailureQueueMessages.removeFirst())
        }
        let statuses = Dictionary(grouping: snapshot.compactMap { $0.status?.status }, by: { $0 }).mapValues(\.count)
        let recoveryActions = Dictionary(grouping: snapshot.map(\.recoveryAction), by: { $0 }).mapValues(\.count)
        return DurableRunsListResponse(scannedAt: ISO8601DateFormatter.flexible.string(from: .now), runs: snapshot, summary: DurableRunsSummary(total: snapshot.count, recoveryActions: recoveryActions, statuses: statuses))
    }

    func addMockRun(runId: String, sourceType: String = "conversation", sourceId: String, status: String = "running") {
        let now = ISO8601DateFormatter.flexible.string(from: .now)
        let summary = DurableRunSummary(
            runId: runId,
            paths: DurableRunPaths(root: "/runs/\(runId)", manifestPath: "/runs/\(runId)/manifest.json", statusPath: "/runs/\(runId)/status.json", checkpointPath: "/runs/\(runId)/checkpoint.json", eventsPath: "/runs/\(runId)/events.jsonl", outputLogPath: "/runs/\(runId)/output.log", resultPath: "/runs/\(runId)/result.json"),
            manifest: DurableRunManifest(version: 1, id: runId, kind: "background-agent", resumePolicy: "manual", createdAt: now, spec: [:], parentId: nil, rootId: nil, source: DurableRunManifestSource(type: sourceType, id: sourceId, filePath: nil)),
            status: DurableRunStatusRecord(version: 1, runId: runId, status: status, createdAt: now, updatedAt: now, activeAttempt: 1, startedAt: now, completedAt: nil, checkpointKey: nil, lastError: nil),
            checkpoint: nil,
            problems: [],
            recoveryAction: "none"
        )
        runs.insert(summary, at: 0)
        runLogs[runId] = "[info] Started run \(runId).\n"
    }

    func readRun(runId: String) async throws -> DurableRunDetailResponse {
        guard let run = runs.first(where: { $0.runId == runId }) else {
            throw CompanionClientError.requestFailed("Run not found.")
        }
        return DurableRunDetailResponse(scannedAt: ISO8601DateFormatter.flexible.string(from: .now), run: run)
    }

    func readRunLog(runId: String, tail: Int?) async throws -> DurableRunLogResponse {
        if !readRunLogFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readRunLogFailureQueueMessages.removeFirst())
        }
        return DurableRunLogResponse(path: "/tmp/\(runId).log", log: runLogs[runId] ?? "")
    }

    func cancelRun(runId: String) async throws -> DurableRunCancelResponse {
        cancelRunCount += 1
        if cancelRunDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: cancelRunDelayNanoseconds)
        }
        if !cancelRunFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(cancelRunFailureQueueMessages.removeFirst())
        }
        if let index = runs.firstIndex(where: { $0.runId == runId }) {
            let run = runs[index]
            let updatedStatus = DurableRunStatusRecord(version: run.status?.version, runId: runId, status: "cancelled", createdAt: run.status?.createdAt ?? ISO8601DateFormatter.flexible.string(from: .now), updatedAt: ISO8601DateFormatter.flexible.string(from: .now), activeAttempt: run.status?.activeAttempt ?? 1, startedAt: run.status?.startedAt, completedAt: ISO8601DateFormatter.flexible.string(from: .now), checkpointKey: run.status?.checkpointKey, lastError: run.status?.lastError)
            runs[index] = DurableRunSummary(runId: run.runId, paths: run.paths, manifest: run.manifest, status: updatedStatus, checkpoint: run.checkpoint, problems: run.problems, recoveryAction: run.recoveryAction)
        }
        return DurableRunCancelResponse(cancelled: true, runId: runId, reason: nil)
    }

    func readDeviceAdminState() async throws -> CompanionDeviceAdminState {
        if !readDeviceAdminStateFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(readDeviceAdminStateFailureQueueMessages.removeFirst())
        }
        return deviceAdminState
    }

    func createPairingCode() async throws -> CompanionPairingCodeRecord {
        createPairingCodeCount += 1
        if createPairingCodeDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createPairingCodeDelayNanoseconds)
        }
        if !createPairingCodeFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createPairingCodeFailureQueueMessages.removeFirst())
        }
        let next = CompanionPairingCodeRecord(id: "pair-\(Int.random(in: 10...999))", code: "WXYZ-QRST-UVWX", createdAt: ISO8601DateFormatter.flexible.string(from: .now), expiresAt: ISO8601DateFormatter.flexible.string(from: .now.addingTimeInterval(600)))
        deviceAdminState = CompanionDeviceAdminState(pendingPairings: [CompanionPendingPairing(id: next.id, createdAt: next.createdAt, expiresAt: next.expiresAt)] + deviceAdminState.pendingPairings, devices: deviceAdminState.devices)
        setupState = CompanionSetupState(pairing: next, links: setupState.links, warnings: setupState.warnings)
        return next
    }

    func createSetupState() async throws -> CompanionSetupState {
        createSetupStateCount += 1
        if createSetupStateDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: createSetupStateDelayNanoseconds)
        }
        if !createSetupStateFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(createSetupStateFailureQueueMessages.removeFirst())
        }
        return setupState
    }

    func updatePairedDevice(deviceId: String, deviceLabel: String) async throws -> CompanionDeviceAdminState {
        updatePairedDeviceCount += 1
        if updatePairedDeviceDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: updatePairedDeviceDelayNanoseconds)
        }
        if !updatePairedDeviceFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(updatePairedDeviceFailureQueueMessages.removeFirst())
        }
        deviceAdminState = CompanionDeviceAdminState(pendingPairings: deviceAdminState.pendingPairings, devices: deviceAdminState.devices.map { device in
            device.id == deviceId
                ? CompanionPairedDeviceSummary(id: device.id, deviceLabel: deviceLabel, createdAt: device.createdAt, lastUsedAt: device.lastUsedAt, expiresAt: device.expiresAt, revokedAt: device.revokedAt)
                : device
        })
        return deviceAdminState
    }

    func deletePairedDevice(deviceId: String) async throws -> CompanionDeviceAdminState {
        deletePairedDeviceCount += 1
        if deletePairedDeviceDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: deletePairedDeviceDelayNanoseconds)
        }
        if !deletePairedDeviceFailureQueueMessages.isEmpty {
            throw CompanionClientError.requestFailed(deletePairedDeviceFailureQueueMessages.removeFirst())
        }
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
            continuation.yield(.open)
            let queueState = self.queuedPromptsByConversation[conversationId] ?? (steering: [], followUp: [])
            continuation.yield(.queueState(steering: queueState.steering, followUp: queueState.followUp))
            continuation.yield(.parallelState(self.parallelJobsByConversation[conversationId] ?? []))
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

    private func emitConversationSnapshot(_ conversationId: String) {
        guard let envelope = conversations[conversationId], let detail = envelope.bootstrap.sessionDetail else {
            return
        }
        emitConversation(conversationId, .snapshot(blocks: detail.blocks, blockOffset: detail.blockOffset, totalBlocks: detail.totalBlocks, isStreaming: envelope.bootstrap.liveSession.isStreaming))
    }

    private func replaceConversationMeta(conversationId: String, meta: SessionMeta) {
        guard let envelope = conversations[conversationId] else {
            return
        }
        conversations[conversationId] = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: envelope.bootstrap.conversationId,
                sessionDetail: envelope.bootstrap.sessionDetail.map { detail in
                    SessionDetail(meta: meta, blocks: detail.blocks, blockOffset: detail.blockOffset, totalBlocks: detail.totalBlocks, signature: detail.signature)
                },
                sessionDetailSignature: envelope.bootstrap.sessionDetailSignature,
                sessionDetailUnchanged: envelope.bootstrap.sessionDetailUnchanged,
                sessionDetailAppendOnly: envelope.bootstrap.sessionDetailAppendOnly,
                liveSession: envelope.bootstrap.liveSession
            ),
            sessionMeta: meta,
            attachments: envelope.attachments,
            executionTargets: envelope.executionTargets
        )
        listState = ConversationListState(
            sessions: listState.sessions.map { $0.id == conversationId ? meta : $0 },
            ordering: listState.ordering,
            executionTargets: listState.executionTargets
        )
    }

    private func mutateConversation(conversationId: String, isStreaming: Bool? = nil, mutateBlocks: (inout [DisplayBlock]) -> Void) {
        guard let envelope = conversations[conversationId], let detail = envelope.bootstrap.sessionDetail else {
            return
        }
        let previousMeta = envelope.sessionMeta ?? detail.meta
        var blocks = detail.blocks
        mutateBlocks(&blocks)
        let updatedAt = ISO8601DateFormatter.flexible.string(from: .now)
        var nextMeta = SessionMeta(
            id: previousMeta.id,
            file: previousMeta.file,
            timestamp: previousMeta.timestamp,
            cwd: previousMeta.cwd,
            cwdSlug: previousMeta.cwdSlug,
            model: previousMeta.model,
            title: previousMeta.title,
            messageCount: previousMeta.messageCount,
            isRunning: isStreaming ?? previousMeta.isRunning,
            isLive: previousMeta.isLive,
            lastActivityAt: updatedAt,
            parentSessionFile: previousMeta.parentSessionFile,
            parentSessionId: previousMeta.parentSessionId,
            sourceRunId: previousMeta.sourceRunId,
            remoteHostId: previousMeta.remoteHostId,
            remoteHostLabel: previousMeta.remoteHostLabel,
            remoteConversationId: previousMeta.remoteConversationId,
            automationTaskId: previousMeta.automationTaskId,
            automationTitle: previousMeta.automationTitle,
            needsAttention: previousMeta.needsAttention,
            attentionUpdatedAt: previousMeta.attentionUpdatedAt,
            attentionUnreadMessageCount: previousMeta.attentionUnreadMessageCount,
            attentionUnreadActivityCount: previousMeta.attentionUnreadActivityCount,
            attentionActivityIds: previousMeta.attentionActivityIds
        )
        nextMeta.deferredResumes = previousMeta.deferredResumes
        let liveSession = ConversationBootstrapLiveSession(
            live: envelope.bootstrap.liveSession.live,
            id: envelope.bootstrap.liveSession.id,
            cwd: envelope.bootstrap.liveSession.cwd,
            sessionFile: envelope.bootstrap.liveSession.sessionFile,
            title: envelope.bootstrap.liveSession.title,
            isStreaming: isStreaming ?? envelope.bootstrap.liveSession.isStreaming,
            hasPendingHiddenTurn: envelope.bootstrap.liveSession.hasPendingHiddenTurn
        )
        conversations[conversationId] = ConversationBootstrapEnvelope(
            bootstrap: ConversationBootstrapState(
                conversationId: envelope.bootstrap.conversationId,
                sessionDetail: SessionDetail(meta: nextMeta, blocks: blocks, blockOffset: detail.blockOffset, totalBlocks: blocks.count, signature: UUID().uuidString),
                sessionDetailSignature: UUID().uuidString,
                sessionDetailUnchanged: false,
                sessionDetailAppendOnly: nil,
                liveSession: liveSession
            ),
            sessionMeta: nextMeta,
            attachments: envelope.attachments,
            executionTargets: envelope.executionTargets
        )
        listState = ConversationListState(
            sessions: listState.sessions.map { $0.id == conversationId ? nextMeta : $0 },
            ordering: listState.ordering,
            executionTargets: listState.executionTargets
        )
        emitApp(.conversationListState(listState))
    }

    private func emitApp(_ event: CompanionAppEvent) {
        appContinuations.values.forEach { $0.yield(event) }
    }

    private func emitConversation(_ conversationId: String, _ event: CompanionConversationEvent) {
        conversationContinuations[conversationId]?.values.forEach { $0.yield(event) }
    }
}
