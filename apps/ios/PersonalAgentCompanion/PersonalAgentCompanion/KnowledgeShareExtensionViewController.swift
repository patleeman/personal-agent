import Foundation
import UIKit
import UniformTypeIdentifiers

final class KnowledgeShareExtensionViewController: UIViewController {
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    private let statusLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private var didStartImport = false

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = .systemBackground

        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        activityIndicator.startAnimating()

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.text = "Preparing share…"

        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.isHidden = true
        cancelButton.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)

        view.addSubview(activityIndicator)
        view.addSubview(statusLabel)
        view.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -32),
            statusLabel.topAnchor.constraint(equalTo: activityIndicator.bottomAnchor, constant: 18),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            cancelButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 18),
            cancelButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didStartImport else {
            return
        }
        didStartImport = true
        Task {
            await beginImport()
        }
    }

    @MainActor
    private func beginImport() async {
        do {
            updateStatus("Preparing share…")
            let envelope = try await loadShareEnvelope()
            guard !envelope.items.isEmpty else {
                throw NSError(domain: "KnowledgeShareExtension", code: 1, userInfo: [NSLocalizedDescriptionKey: "Nothing shareable was found. Try sharing text, a URL, or an image."])
            }
            try KnowledgeShareInboxStore.save(envelope)
            updateStatus("Opening Personal Agent…")
            let opened = await openPersonalAgent()
            if !opened {
                updateStatus("Saved. Open Personal Agent to finish importing.")
                try? await Task.sleep(for: .milliseconds(700))
            }
            extensionContext?.completeRequest(returningItems: nil)
        } catch {
            activityIndicator.stopAnimating()
            updateStatus(error.localizedDescription)
            cancelButton.isHidden = false
        }
    }

    @objc
    private func cancelShare() {
        extensionContext?.cancelRequest(withError: NSError(domain: "KnowledgeShareExtension", code: 3, userInfo: [NSLocalizedDescriptionKey: "Share cancelled."]))
    }

    @MainActor
    private func updateStatus(_ text: String) {
        statusLabel.text = text
    }

    private func openPersonalAgent() async -> Bool {
        await withCheckedContinuation { continuation in
            extensionContext?.open(CompanionIncomingShareLink.url) { opened in
                continuation.resume(returning: opened)
            }
        }
    }

    private func loadShareEnvelope() async throws -> PendingKnowledgeShareEnvelope {
        let inputItems = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        var collected: [PendingKnowledgeShareItem] = []
        var seenURLs = Set<String>()
        var seenTexts = Set<String>()

        for inputItem in inputItems {
            for provider in inputItem.attachments ?? [] {
                if collected.count >= 6 {
                    break
                }
                if let item = try await loadSharedItem(from: provider) {
                    switch item.kind {
                    case .url:
                        let value = item.url ?? ""
                        guard seenURLs.insert(value).inserted else { continue }
                    case .text:
                        let value = item.text ?? ""
                        guard seenTexts.insert(value).inserted else { continue }
                    case .image:
                        break
                    }
                    collected.append(item)
                }
            }
        }

        return PendingKnowledgeShareEnvelope(items: collected)
    }

    private func loadSharedItem(from provider: NSItemProvider) async throws -> PendingKnowledgeShareItem? {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = try await loadURL(from: provider) {
            return PendingKnowledgeShareItem(kind: .url, title: provider.suggestedName, url: url.absoluteString)
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           let text = try await loadText(from: provider)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            return PendingKnowledgeShareItem(kind: .text, title: provider.suggestedName, text: text)
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
           let image = try await loadImage(from: provider) {
            return PendingKnowledgeShareItem(
                kind: .image,
                title: provider.suggestedName,
                mimeType: image.mimeType,
                fileName: image.fileName,
                dataBase64: image.data.base64EncodedString()
            )
        }

        return nil
    }

    private func loadURL(from provider: NSItemProvider) async throws -> URL? {
        let item = try await loadItem(provider, typeIdentifier: UTType.url.identifier)
        if let url = item as? URL {
            return url
        }
        if let url = item as? NSURL {
            return url as URL
        }
        if let text = item as? String {
            return URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if let text = item as? NSString {
            return URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if let data = item as? Data,
           let text = String(data: data, encoding: .utf8) {
            return URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return nil
    }

    private func loadText(from provider: NSItemProvider) async throws -> String? {
        let item = try await loadItem(provider, typeIdentifier: UTType.plainText.identifier)
        if let text = item as? String {
            return text
        }
        if let text = item as? NSString {
            return text as String
        }
        if let url = item as? URL {
            return try? String(contentsOf: url, encoding: .utf8)
        }
        if let data = item as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }

    private func loadImage(from provider: NSItemProvider) async throws -> (data: Data, mimeType: String, fileName: String?)? {
        let imageTypeIdentifier = provider.registeredTypeIdentifiers.first(where: { identifier in
            UTType(identifier)?.conforms(to: .image) == true
        }) ?? UTType.image.identifier

        if let data = try? await loadDataRepresentation(from: provider, typeIdentifier: imageTypeIdentifier) {
            let type = UTType(imageTypeIdentifier)
            let mimeType = type?.preferredMIMEType ?? "image/png"
            let ext = type?.preferredFilenameExtension ?? "png"
            let fileName = provider.suggestedName.nilIfBlank ?? "SharedImage.\(ext)"
            return (data, mimeType, fileName)
        }

        if let fileURL = try? await loadFileRepresentation(from: provider, typeIdentifier: imageTypeIdentifier) {
            let data = try Data(contentsOf: fileURL)
            let type = UTType(filenameExtension: fileURL.pathExtension) ?? UTType(imageTypeIdentifier)
            let mimeType = type?.preferredMIMEType ?? "image/png"
            let fileName = provider.suggestedName.nilIfBlank ?? fileURL.lastPathComponent
            return (data, mimeType, fileName)
        }

        let item = try? await loadItem(provider, typeIdentifier: imageTypeIdentifier)
        if let image = item as? UIImage,
           let data = image.pngData() {
            return (data, "image/png", provider.suggestedName.nilIfBlank ?? "SharedImage.png")
        }
        if let url = item as? URL {
            let data = try Data(contentsOf: url)
            let type = UTType(filenameExtension: url.pathExtension)
            return (data, type?.preferredMIMEType ?? "image/png", provider.suggestedName.nilIfBlank ?? url.lastPathComponent)
        }
        return nil
    }

    private func loadItem(_ provider: NSItemProvider, typeIdentifier: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: item)
            }
        }
    }

    private func loadDataRepresentation(from provider: NSItemProvider, typeIdentifier: String) async throws -> Data? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: data)
            }
        }
    }

    private func loadFileRepresentation(from provider: NSItemProvider, typeIdentifier: String) async throws -> URL? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: url)
            }
        }
    }
}

private extension Optional where Wrapped == String {
    var nilIfBlank: String? {
        switch self?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case .some(let value) where !value.isEmpty:
            return value
        default:
            return nil
        }
    }
}
