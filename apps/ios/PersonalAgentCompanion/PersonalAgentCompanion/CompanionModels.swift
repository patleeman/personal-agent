import Foundation
import SwiftUI

enum CompanionTheme {
    static let canvas = Color(red: 0.06, green: 0.07, blue: 0.11)
    static let panel = Color(red: 0.10, green: 0.12, blue: 0.18)
    static let panelRaised = Color(red: 0.14, green: 0.16, blue: 0.23)
    static let panelBorder = Color(red: 0.23, green: 0.25, blue: 0.35)
    static let accent = Color(red: 0.53, green: 0.46, blue: 0.86)
    static let accentSurface = Color(red: 0.20, green: 0.17, blue: 0.31)
    static let textPrimary = Color.white
    static let textSecondary = Color(red: 0.68, green: 0.71, blue: 0.80)
    static let textDim = Color(red: 0.51, green: 0.55, blue: 0.66)
}

struct CompanionHostRecord: Codable, Identifiable, Equatable {
    var id: UUID
    var baseURL: String
    var hostLabel: String
    var hostInstanceId: String
    var deviceId: String
    var deviceLabel: String
    var createdAt: Date
    var lastUsedAt: Date

    init(
        id: UUID = UUID(),
        baseURL: String,
        hostLabel: String,
        hostInstanceId: String,
        deviceId: String,
        deviceLabel: String,
        createdAt: Date = .now,
        lastUsedAt: Date = .now
    ) {
        self.id = id
        self.baseURL = baseURL
        self.hostLabel = hostLabel
        self.hostInstanceId = hostInstanceId
        self.deviceId = deviceId
        self.deviceLabel = deviceLabel
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }

    var normalizedBaseURL: URL? {
        URL(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

struct CompanionHello: Codable, Equatable {
    struct Transport: Codable, Equatable {
        let websocket: Bool
        let singleSocket: Bool
        let httpAvailable: Bool
    }

    struct Auth: Codable, Equatable {
        let pairingRequired: Bool
        let bearerTokens: Bool
    }

    struct Capabilities: Codable, Equatable {
        let fullConversationLifecycle: Bool
        let executionTargets: Bool
        let executionTargetSwitching: Bool
        let attachments: Bool
        let attachmentWrite: Bool
        let deviceAdmin: Bool
    }

    let hostInstanceId: String
    let hostLabel: String
    let daemonVersion: String
    let protocolVersion: String
    let transport: Transport
    let auth: Auth
    let capabilities: Capabilities
}

struct CompanionPairedDeviceSummary: Codable, Equatable, Identifiable {
    let id: String
    let deviceLabel: String
    let createdAt: String
    let lastUsedAt: String
    let expiresAt: String
    let revokedAt: String?
}

struct CompanionPairResult: Codable, Equatable {
    let bearerToken: String
    let device: CompanionPairedDeviceSummary
    let hello: CompanionHello?
}

struct CompanionSetupLink: Equatable {
    static let scheme = "pa-companion"

    let baseURL: String
    let code: String
    let hostLabel: String?
    let hostInstanceId: String?

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme?.lowercased() == Self.scheme,
              url.host?.lowercased() == "pair" || components.path == "/pair" else {
            return nil
        }

        func queryValue(_ name: String) -> String? {
            components.queryItems?.first(where: { $0.name == name })?.value?.trimmed.nilIfBlank
        }

        guard let baseURL = queryValue("base") ?? queryValue("baseUrl"),
              let code = queryValue("code") else {
            return nil
        }

        self.baseURL = baseURL
        self.code = code
        self.hostLabel = queryValue("label")
        self.hostInstanceId = queryValue("hostInstanceId")
    }

    init?(rawString: String) {
        guard let url = URL(string: rawString.trimmed) else {
            return nil
        }
        self.init(url: url)
    }
}

struct ExecutionTargetSummary: Codable, Equatable, Identifiable {
    let id: String
    let label: String
    let kind: String
}

struct ConversationOrdering: Codable, Equatable {
    var sessionIds: [String]
    var pinnedSessionIds: [String]
    var archivedSessionIds: [String]
    var workspacePaths: [String]
}

struct ConversationListState: Codable, Equatable {
    let sessions: [SessionMeta]
    let ordering: ConversationOrdering
    let executionTargets: [ExecutionTargetSummary]?
}

struct SessionMeta: Codable, Equatable, Identifiable {
    let id: String
    let file: String
    let timestamp: String
    let cwd: String
    let cwdSlug: String
    let model: String
    let title: String
    let messageCount: Int
    let isRunning: Bool?
    let isLive: Bool?
    let lastActivityAt: String?
    let parentSessionFile: String?
    let parentSessionId: String?
    let sourceRunId: String?
    let remoteHostId: String?
    let remoteHostLabel: String?
    let remoteConversationId: String?
    let automationTaskId: String?
    let automationTitle: String?
    let needsAttention: Bool?
    let attentionUpdatedAt: String?
    let attentionUnreadMessageCount: Int?
    let attentionUnreadActivityCount: Int?
    let attentionActivityIds: [String]?

    var effectiveActivityDate: Date? {
        ISO8601DateFormatter.flexible.date(from: lastActivityAt ?? timestamp)
    }
}

struct MessageImage: Codable, Equatable, Identifiable {
    var id: String { src ?? [alt, caption].compactMap { $0 }.joined(separator: "-") }

    let alt: String
    let src: String?
    let mimeType: String?
    let width: Double?
    let height: Double?
    let caption: String?
    let deferred: Bool?
}

struct DisplayBlock: Codable, Equatable, Identifiable {
    let type: String
    let id: String
    let ts: String
    let text: String?
    let title: String?
    let kind: String?
    let detail: String?
    let tool: String?
    let input: JSONValue?
    let output: String?
    let durationMs: Double?
    let toolCallId: String?
    let details: JSONValue?
    let outputDeferred: Bool?
    let alt: String?
    let src: String?
    let mimeType: String?
    let width: Double?
    let height: Double?
    let caption: String?
    let deferred: Bool?
    let message: String?
    let customType: String?
    let images: [MessageImage]?

    private enum CodingKeys: String, CodingKey {
        case type
        case id
        case ts
        case text
        case title
        case kind
        case detail
        case tool
        case input
        case output
        case durationMs
        case toolCallId
        case details
        case outputDeferred
        case alt
        case src
        case mimeType
        case width
        case height
        case caption
        case deferred
        case message
        case customType
        case images
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.type = try container.decode(String.self, forKey: .type)
        self.id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.ts = try container.decodeIfPresent(String.self, forKey: .ts) ?? ISO8601DateFormatter.flexible.string(from: .now)
        self.text = try container.decodeIfPresent(String.self, forKey: .text)
        self.title = try container.decodeIfPresent(String.self, forKey: .title)
        self.kind = try container.decodeIfPresent(String.self, forKey: .kind)
        self.detail = try container.decodeIfPresent(String.self, forKey: .detail)
        self.tool = try container.decodeIfPresent(String.self, forKey: .tool)
        self.input = try container.decodeIfPresent(JSONValue.self, forKey: .input)
        self.output = try container.decodeIfPresent(String.self, forKey: .output)
        self.durationMs = try container.decodeIfPresent(Double.self, forKey: .durationMs)
        self.toolCallId = try container.decodeIfPresent(String.self, forKey: .toolCallId)
        self.details = try container.decodeIfPresent(JSONValue.self, forKey: .details)
        self.outputDeferred = try container.decodeIfPresent(Bool.self, forKey: .outputDeferred)
        self.alt = try container.decodeIfPresent(String.self, forKey: .alt)
        self.src = try container.decodeIfPresent(String.self, forKey: .src)
        self.mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType)
        self.width = try container.decodeIfPresent(Double.self, forKey: .width)
        self.height = try container.decodeIfPresent(Double.self, forKey: .height)
        self.caption = try container.decodeIfPresent(String.self, forKey: .caption)
        self.deferred = try container.decodeIfPresent(Bool.self, forKey: .deferred)
        self.message = try container.decodeIfPresent(String.self, forKey: .message)
        self.customType = try container.decodeIfPresent(String.self, forKey: .customType)
        self.images = try container.decodeIfPresent([MessageImage].self, forKey: .images)
    }

    init(type: String, id: String = UUID().uuidString, ts: String = ISO8601DateFormatter.flexible.string(from: .now), text: String? = nil, title: String? = nil, kind: String? = nil, detail: String? = nil, tool: String? = nil, input: JSONValue? = nil, output: String? = nil, durationMs: Double? = nil, toolCallId: String? = nil, details: JSONValue? = nil, outputDeferred: Bool? = nil, alt: String? = nil, src: String? = nil, mimeType: String? = nil, width: Double? = nil, height: Double? = nil, caption: String? = nil, deferred: Bool? = nil, message: String? = nil, customType: String? = nil, images: [MessageImage]? = nil) {
        self.type = type
        self.id = id
        self.ts = ts
        self.text = text
        self.title = title
        self.kind = kind
        self.detail = detail
        self.tool = tool
        self.input = input
        self.output = output
        self.durationMs = durationMs
        self.toolCallId = toolCallId
        self.details = details
        self.outputDeferred = outputDeferred
        self.alt = alt
        self.src = src
        self.mimeType = mimeType
        self.width = width
        self.height = height
        self.caption = caption
        self.deferred = deferred
        self.message = message
        self.customType = customType
        self.images = images
    }
}

struct SessionDetail: Codable, Equatable {
    let meta: SessionMeta
    let blocks: [DisplayBlock]
    let blockOffset: Int
    let totalBlocks: Int
    let signature: String?
}

struct SessionDetailAppendOnlyResponse: Codable, Equatable {
    let appendOnly: Bool
    let meta: SessionMeta
    let blocks: [DisplayBlock]
    let blockOffset: Int
    let totalBlocks: Int
    let signature: String?
}

struct LiveSessionMeta: Codable, Equatable {
    let id: String
    let cwd: String
    let sessionFile: String
    let title: String?
    let isStreaming: Bool
    let hasPendingHiddenTurn: Bool?
}

struct ConversationBootstrapLiveSession: Codable, Equatable {
    let live: Bool
    let id: String?
    let cwd: String?
    let sessionFile: String?
    let title: String?
    let isStreaming: Bool?
    let hasPendingHiddenTurn: Bool?
}

struct ConversationBootstrapState: Codable, Equatable {
    let conversationId: String
    let sessionDetail: SessionDetail?
    let sessionDetailSignature: String?
    let sessionDetailUnchanged: Bool?
    let sessionDetailAppendOnly: SessionDetailAppendOnlyResponse?
    let liveSession: ConversationBootstrapLiveSession
}

struct ConversationBootstrapEnvelope: Codable, Equatable {
    let bootstrap: ConversationBootstrapState
    let sessionMeta: SessionMeta?
    let attachments: ConversationAttachmentListResponse?
    let executionTargets: [ExecutionTargetSummary]
}

struct ConversationAttachmentRevision: Codable, Equatable, Identifiable {
    var id: Int { revision }

    let revision: Int
    let createdAt: String
    let sourceName: String
    let sourceMimeType: String
    let sourceDownloadPath: String
    let previewName: String
    let previewMimeType: String
    let previewDownloadPath: String
    let note: String?
}

struct ConversationAttachmentSummary: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let kind: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let currentRevision: Int
    let latestRevision: ConversationAttachmentRevision
}

struct ConversationAttachmentRecord: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let kind: String
    let title: String
    let createdAt: String
    let updatedAt: String
    let currentRevision: Int
    let latestRevision: ConversationAttachmentRevision
    let revisions: [ConversationAttachmentRevision]

    var summary: ConversationAttachmentSummary {
        ConversationAttachmentSummary(
            id: id,
            conversationId: conversationId,
            kind: kind,
            title: title,
            createdAt: createdAt,
            updatedAt: updatedAt,
            currentRevision: currentRevision,
            latestRevision: latestRevision
        )
    }
}

struct ConversationAttachmentListResponse: Codable, Equatable {
    let conversationId: String
    let attachments: [ConversationAttachmentSummary]
}

struct ConversationAttachmentDetailResponse: Codable, Equatable {
    let conversationId: String
    let attachment: ConversationAttachmentRecord
}

struct ConversationAttachmentMutationResponse: Codable, Equatable {
    let conversationId: String
    let attachment: ConversationAttachmentRecord
    let attachments: [ConversationAttachmentSummary]
}

struct PromptAttachmentReference: Codable, Equatable, Identifiable {
    var id: String { "\(attachmentId)#\(revision ?? 0)" }

    let attachmentId: String
    let revision: Int?
    let title: String
}

struct PromptImageDraft: Equatable, Identifiable {
    let id: UUID
    let name: String
    let mimeType: String
    let base64Data: String
    let previewData: Data

    init(id: UUID = UUID(), name: String, mimeType: String, base64Data: String, previewData: Data) {
        self.id = id
        self.name = name
        self.mimeType = mimeType
        self.base64Data = base64Data
        self.previewData = previewData
    }
}

struct AttachmentDraftAsset: Equatable {
    let fileName: String
    let mimeType: String
    let base64Data: String
    let rawData: Data
}

struct NewConversationRequest: Equatable {
    var promptText: String = ""
    var cwd: String = ""
    var executionTargetId: String = "local"
    var model: String = ""
    var thinkingLevel: String = ""
    var serviceTier: String = ""
}

struct ResumeConversationRequest: Equatable {
    var sessionFile: String = ""
    var cwd: String = ""
    var executionTargetId: String = "local"
}

struct AttachmentEditorDraft: Equatable {
    var title: String = ""
    var note: String = ""
    var sourceAsset: AttachmentDraftAsset?
    var previewAsset: AttachmentDraftAsset?
}

struct ConversationModelPreferencesState: Codable, Equatable {
    let currentModel: String
    let currentThinkingLevel: String
    let currentServiceTier: String
    let hasExplicitServiceTier: Bool
}

struct ConversationCwdChangeResult: Codable, Equatable {
    let id: String
    let sessionFile: String
    let cwd: String
    let changed: Bool
}

struct ConversationArtifactSummary: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let title: String
    let kind: String
    let createdAt: String
    let updatedAt: String
    let revision: Int
}

struct ConversationArtifactRecord: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let title: String
    let kind: String
    let createdAt: String
    let updatedAt: String
    let revision: Int
    let content: String
}

struct ConversationCommitCheckpointFile: Codable, Equatable, Identifiable {
    var id: String { path }

    let path: String
    let previousPath: String?
    let status: String
    let additions: Int
    let deletions: Int
    let patch: String
}

struct ConversationCommitCheckpointComment: Codable, Equatable, Identifiable {
    let id: String
    let authorName: String
    let authorProfile: String?
    let body: String
    let filePath: String?
    let createdAt: String
    let updatedAt: String
}

struct ConversationCommitCheckpointSummary: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let title: String
    let cwd: String
    let commitSha: String
    let shortSha: String
    let subject: String
    let body: String?
    let authorName: String
    let authorEmail: String?
    let committedAt: String
    let createdAt: String
    let updatedAt: String
    let fileCount: Int
    let linesAdded: Int
    let linesDeleted: Int
    let commentCount: Int
}

struct ConversationCommitCheckpointRecord: Codable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let title: String
    let cwd: String
    let commitSha: String
    let shortSha: String
    let subject: String
    let body: String?
    let authorName: String
    let authorEmail: String?
    let committedAt: String
    let createdAt: String
    let updatedAt: String
    let fileCount: Int
    let linesAdded: Int
    let linesDeleted: Int
    let commentCount: Int
    let files: [ConversationCommitCheckpointFile]
    let comments: [ConversationCommitCheckpointComment]
}

struct ScheduledTaskSummary: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let filePath: String?
    let scheduleType: String?
    let targetType: String?
    let running: Bool?
    let enabled: Bool
    let cron: String?
    let at: String?
    let prompt: String?
    let model: String?
    let thinkingLevel: String?
    let cwd: String?
    let threadConversationId: String?
    let threadTitle: String?
    let lastStatus: String?
    let lastRunAt: String?
    let lastSuccessAt: String?
    let lastAttemptCount: Int?
}

struct ScheduledTaskDetail: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let filePath: String?
    let scheduleType: String?
    let targetType: String?
    let running: Bool?
    let enabled: Bool
    let cron: String?
    let at: String?
    let model: String?
    let thinkingLevel: String?
    let cwd: String?
    let timeoutSeconds: Int?
    let prompt: String?
    let lastStatus: String?
    let lastRunAt: String?
    let threadConversationId: String?
    let threadTitle: String?
}

struct ScheduledTaskMutationEnvelope: Codable, Equatable {
    let ok: Bool
    let task: ScheduledTaskDetail
}

struct ScheduledTaskRunResponse: Codable, Equatable {
    let ok: Bool
    let accepted: Bool
    let runId: String?
}

struct ScheduledTaskEditorDraft: Equatable {
    var title: String = ""
    var enabled: Bool = true
    var scheduleMode: String = "cron"
    var cron: String = ""
    var at: String = ""
    var model: String = ""
    var thinkingLevel: String = ""
    var cwd: String = ""
    var timeoutSeconds: String = ""
    var prompt: String = ""
    var targetType: String = "background-agent"
    var threadMode: String = "dedicated"
    var threadConversationId: String = ""
}

struct DurableRunPaths: Codable, Equatable {
    let root: String
    let manifestPath: String
    let statusPath: String
    let checkpointPath: String
    let eventsPath: String
    let outputLogPath: String
    let resultPath: String
}

struct DurableRunManifestSource: Codable, Equatable {
    let type: String
    let id: String?
    let filePath: String?
}

struct DurableRunManifest: Codable, Equatable {
    let version: Int?
    let id: String
    let kind: String
    let resumePolicy: String
    let createdAt: String
    let spec: [String: JSONValue]
    let parentId: String?
    let rootId: String?
    let source: DurableRunManifestSource?
}

struct DurableRunStatusRecord: Codable, Equatable {
    let version: Int?
    let runId: String
    let status: String
    let createdAt: String
    let updatedAt: String
    let activeAttempt: Int
    let startedAt: String?
    let completedAt: String?
    let checkpointKey: String?
    let lastError: String?
}

struct DurableRunCheckpointRecord: Codable, Equatable {
    let version: Int?
    let runId: String
    let updatedAt: String
    let step: String?
    let cursor: String?
    let payload: [String: JSONValue]?
}

struct DurableRunSummary: Codable, Equatable, Identifiable {
    var id: String { runId }

    let runId: String
    let paths: DurableRunPaths
    let manifest: DurableRunManifest?
    let status: DurableRunStatusRecord?
    let checkpoint: DurableRunCheckpointRecord?
    let problems: [String]
    let recoveryAction: String
}

struct DurableRunsSummary: Codable, Equatable {
    let total: Int
    let recoveryActions: [String: Int]
    let statuses: [String: Int]
}

struct DurableRunsListResponse: Codable, Equatable {
    let scannedAt: String
    let runs: [DurableRunSummary]
    let summary: DurableRunsSummary
}

struct DurableRunDetailResponse: Codable, Equatable, Identifiable {
    var id: String { run.runId }

    let scannedAt: String
    let run: DurableRunSummary
}

struct DurableRunLogResponse: Codable, Equatable {
    let path: String
    let log: String
}

struct DurableRunCancelResponse: Codable, Equatable {
    let cancelled: Bool
    let runId: String
    let reason: String?
}

struct CompanionPendingPairing: Codable, Equatable, Identifiable {
    let id: String
    let createdAt: String
    let expiresAt: String
}

struct CompanionDeviceAdminState: Codable, Equatable {
    let pendingPairings: [CompanionPendingPairing]
    let devices: [CompanionPairedDeviceSummary]
}

struct CompanionPairingCodeRecord: Codable, Equatable, Identifiable {
    let id: String
    let code: String
    let createdAt: String
    let expiresAt: String
}

struct CompanionSetupLinkRecord: Codable, Equatable, Identifiable {
    let id: String
    let label: String
    let baseUrl: String
    let setupUrl: String
}

struct CompanionSetupState: Codable, Equatable {
    let pairing: CompanionPairingCodeRecord
    let links: [CompanionSetupLinkRecord]
    let warnings: [String]
}

struct ConversationListSection: Identifiable, Equatable {
    let id: String
    let title: String
    let sessions: [SessionMeta]
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

enum CompanionConversationEvent: Equatable {
    case snapshot(blocks: [DisplayBlock], blockOffset: Int, totalBlocks: Int)
    case agentStart
    case agentEnd
    case turnEnd
    case userMessage(DisplayBlock)
    case textDelta(String)
    case thinkingDelta(String)
    case toolStart(toolCallId: String, toolName: String, args: JSONValue?)
    case toolUpdate(toolCallId: String, partialResult: JSONValue?)
    case toolEnd(toolCallId: String, toolName: String, isError: Bool, durationMs: Double, output: String, details: JSONValue?)
    case titleUpdate(String)
    case presenceState(LiveSessionPresenceState)
    case error(String)
    case open
    case close
    case unknown
}

struct LiveSessionPresenceState: Codable, Equatable {
    struct PresenceSurface: Codable, Equatable, Identifiable {
        var id: String { surfaceId }

        let surfaceId: String
        let surfaceType: String
        let connectedAt: String
    }

    let surfaces: [PresenceSurface]
    let controllerSurfaceId: String?
    let controllerSurfaceType: String?
    let controllerAcquiredAt: String?
}

extension ISO8601DateFormatter {
    static let flexible: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let fallback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

extension DateFormatter {
    static let conversationTimestamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    static let relativeTimestamp: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()
}

extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var nilIfBlank: String? {
        let value = trimmed
        return value.isEmpty ? nil : value
    }
}

extension Optional where Wrapped == String {
    var nilIfBlank: String? {
        guard let value = self?.trimmed, !value.isEmpty else {
            return nil
        }
        return value
    }
}

func decodeModel<T: Decodable>(_ type: T.Type, from jsonObject: Any) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: jsonObject, options: [.fragmentsAllowed])
    let decoder = JSONDecoder()
    return try decoder.decode(type, from: data)
}

func jsonObjectData(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [])
}

func dataURLData(_ string: String?) -> Data? {
    guard let string, let range = string.range(of: ",") else {
        return nil
    }
    return Data(base64Encoded: String(string[range.upperBound...]))
}

func makeDataURL(mimeType: String, base64Data: String) -> String {
    "data:\(mimeType);base64,\(base64Data)"
}

func parseCompanionDate(_ string: String?) -> Date? {
    guard let value = string?.trimmed, !value.isEmpty else {
        return nil
    }
    return ISO8601DateFormatter.flexible.date(from: value) ?? ISO8601DateFormatter.fallback.date(from: value)
}

func formatCompanionDate(_ string: String?) -> String {
    guard let date = parseCompanionDate(string) else {
        return string ?? "—"
    }
    return DateFormatter.conversationTimestamp.string(from: date)
}

func formatRelativeCompanionDate(_ string: String?) -> String {
    guard let date = parseCompanionDate(string) else {
        return string ?? "—"
    }
    return DateFormatter.relativeTimestamp.localizedString(for: date, relativeTo: .now)
}
