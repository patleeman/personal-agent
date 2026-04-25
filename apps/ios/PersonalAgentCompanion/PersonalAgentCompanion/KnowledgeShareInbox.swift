import Foundation

let personalAgentKnowledgeShareAppGroupIdentifier = "group.com.personalagent.ios.companion.shared"

private func knowledgeShareCurrentTimestamp() -> String {
    ISO8601DateFormatter().string(from: .now)
}

struct PendingKnowledgeShareEnvelope: Codable, Identifiable, Equatable {
    let id: String
    let createdAt: String
    let sourceApp: String?
    let items: [PendingKnowledgeShareItem]

    init(id: String = UUID().uuidString.lowercased(), createdAt: String = knowledgeShareCurrentTimestamp(), sourceApp: String? = nil, items: [PendingKnowledgeShareItem]) {
        self.id = id
        self.createdAt = createdAt
        self.sourceApp = sourceApp
        self.items = items
    }
}

struct PendingKnowledgeShareItem: Codable, Identifiable, Equatable {
    enum Kind: String, Codable {
        case text
        case url
        case image
    }

    let id: String
    let kind: Kind
    let title: String?
    let text: String?
    let url: String?
    let mimeType: String?
    let fileName: String?
    let dataBase64: String?
    let createdAt: String

    init(
        id: String = UUID().uuidString.lowercased(),
        kind: Kind,
        title: String? = nil,
        text: String? = nil,
        url: String? = nil,
        mimeType: String? = nil,
        fileName: String? = nil,
        dataBase64: String? = nil,
        createdAt: String = knowledgeShareCurrentTimestamp()
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.text = text
        self.url = url
        self.mimeType = mimeType
        self.fileName = fileName
        self.dataBase64 = dataBase64
        self.createdAt = createdAt
    }
}

enum KnowledgeShareInboxError: LocalizedError, Equatable {
    case appGroupUnavailable

    var errorDescription: String? {
        switch self {
        case .appGroupUnavailable:
            return "The Personal Agent app group container is unavailable."
        }
    }
}

enum KnowledgeShareInboxStore {
    private static let pendingDirectoryName = "pending-knowledge-shares"

    static func pendingDirectoryURL(fileManager: FileManager = .default) throws -> URL {
        guard let containerURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: personalAgentKnowledgeShareAppGroupIdentifier) else {
            throw KnowledgeShareInboxError.appGroupUnavailable
        }
        let directoryURL = containerURL.appendingPathComponent(pendingDirectoryName, isDirectory: true)
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        return directoryURL
    }

    @discardableResult
    static func save(_ envelope: PendingKnowledgeShareEnvelope, fileManager: FileManager = .default) throws -> URL {
        let directoryURL = try pendingDirectoryURL(fileManager: fileManager)
        let fileURL = directoryURL.appendingPathComponent("\(envelope.id).json", isDirectory: false)
        let data = try JSONEncoder().encode(envelope)
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

    static func loadAll(fileManager: FileManager = .default) throws -> [PendingKnowledgeShareEnvelope] {
        let directoryURL = try pendingDirectoryURL(fileManager: fileManager)
        let fileURLs = try fileManager.contentsOfDirectory(at: directoryURL, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
        let decoder = JSONDecoder()
        let envelopes: [PendingKnowledgeShareEnvelope] = fileURLs.compactMap { fileURL in
            guard fileURL.pathExtension.lowercased() == "json" else {
                return nil
            }
            do {
                let data = try Data(contentsOf: fileURL)
                return try decoder.decode(PendingKnowledgeShareEnvelope.self, from: data)
            } catch {
                return nil
            }
        }
        return envelopes.sorted { lhs, rhs in
            if lhs.createdAt == rhs.createdAt {
                return lhs.id < rhs.id
            }
            return lhs.createdAt < rhs.createdAt
        }
    }

    static func remove(_ envelope: PendingKnowledgeShareEnvelope, fileManager: FileManager = .default) throws {
        let directoryURL = try pendingDirectoryURL(fileManager: fileManager)
        let fileURL = directoryURL.appendingPathComponent("\(envelope.id).json", isDirectory: false)
        if fileManager.fileExists(atPath: fileURL.path) {
            try fileManager.removeItem(at: fileURL)
        }
    }
}

struct CompanionIncomingShareLink: Equatable {
    static let scheme = "pa-companion"

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme?.lowercased() == Self.scheme,
              url.host?.lowercased() == "share" || components.path == "/share" else {
            return nil
        }
    }

    static var url: URL {
        URL(string: "\(scheme)://share")!
    }
}
