import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

struct ConversationScreen: View {
    @ObservedObject var viewModel: ConversationViewModel

    @State private var showingAttachments = false
    @State private var showingRename = false
    @State private var renameText = ""
    @State private var importedPhotoItems: [PhotosPickerItem] = []
    @State private var showingImageFileImporter = false

    private var currentExecutionTargetLabel: String {
        viewModel.executionTargets.first(where: { $0.id == viewModel.currentExecutionTargetId })?.label ?? "Local"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if viewModel.blocks.isEmpty && !viewModel.isLoading {
                        ContentUnavailableView(
                            "No transcript yet",
                            systemImage: "message",
                            description: Text("Send a prompt to start this conversation.")
                        )
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                    }

                    ForEach(viewModel.blocks) { block in
                        ConversationBlockView(block: block)
                            .id(block.id)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 132)
            }
            .background(CompanionTheme.canvas.ignoresSafeArea())
            .navigationTitle(viewModel.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(CompanionTheme.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Section("Execution target") {
                            ForEach(viewModel.executionTargets) { target in
                                Button {
                                    viewModel.changeExecutionTarget(target.id)
                                } label: {
                                    if viewModel.currentExecutionTargetId == target.id {
                                        Label(target.label, systemImage: "checkmark")
                                    } else {
                                        Text(target.label)
                                    }
                                }
                            }
                        }

                        Section("Conversation") {
                            Button {
                                viewModel.takeOver()
                            } label: {
                                Label("Take over here", systemImage: "hand.raised")
                            }
                            Button {
                                showingAttachments = true
                            } label: {
                                Label("Saved drawings", systemImage: "paperclip")
                            }
                            Button {
                                renameText = viewModel.title
                                showingRename = true
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "desktopcomputer")
                            Text(currentExecutionTargetLabel)
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.semibold))
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(CompanionTheme.panelRaised, in: Capsule())
                        .overlay {
                            Capsule()
                                .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                        }
                        .foregroundStyle(CompanionTheme.textPrimary)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                composer
            }
            .overlay(alignment: .top) {
                if let message = viewModel.errorMessage {
                    Text(message)
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.red.opacity(0.92), in: Capsule())
                        .foregroundStyle(.white)
                        .padding(.top, 8)
                }
            }
            .sheet(isPresented: $showingAttachments) {
                AttachmentBrowserView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingRename) {
                RenameConversationView(title: $renameText) {
                    viewModel.renameConversation(renameText)
                    showingRename = false
                }
            }
            .fileImporter(isPresented: $showingImageFileImporter, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls):
                    Task {
                        for url in urls {
                            if let draft = try? await PromptImageDraft.fromImageFile(url: url) {
                                viewModel.addPromptImage(draft)
                            }
                        }
                    }
                case .failure(let error):
                    viewModel.errorMessage = error.localizedDescription
                }
            }
            .onChange(of: importedPhotoItems) { _, newItems in
                Task {
                    for item in newItems {
                        if let draft = try? await PromptImageDraft.fromPhotosItem(item) {
                            viewModel.addPromptImage(draft)
                        }
                    }
                    importedPhotoItems.removeAll()
                }
            }
            .onAppear {
                viewModel.start()
            }
            .onDisappear {
                viewModel.stop()
            }
            .onChange(of: viewModel.blocks.count) { _, _ in
                guard let last = viewModel.blocks.last else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if !viewModel.promptImages.isEmpty || !viewModel.promptAttachmentRefs.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    if !viewModel.promptImages.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(viewModel.promptImages) { image in
                                    VStack(alignment: .leading, spacing: 6) {
                                        if let uiImage = UIImage(data: image.previewData) {
                                            Image(uiImage: uiImage)
                                                .resizable()
                                                .scaledToFill()
                                                .frame(width: 92, height: 68)
                                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                        }
                                        HStack {
                                            Text(image.name)
                                                .font(.caption2)
                                                .foregroundStyle(CompanionTheme.textPrimary)
                                                .lineLimit(1)
                                            Spacer(minLength: 4)
                                            Button(role: .destructive) {
                                                viewModel.removePromptImage(image.id)
                                            } label: {
                                                Image(systemName: "xmark.circle.fill")
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                    .frame(width: 96)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }

                    if !viewModel.promptAttachmentRefs.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(viewModel.promptAttachmentRefs) { ref in
                                    HStack(spacing: 6) {
                                        Image(systemName: "scribble.variable")
                                        Text(ref.title)
                                            .lineLimit(1)
                                        Button {
                                            viewModel.removeAttachmentReference(ref.id)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .font(.caption)
                                    .foregroundStyle(CompanionTheme.textPrimary)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(CompanionTheme.panelRaised, in: Capsule())
                                    .overlay {
                                        Capsule()
                                            .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 12) {
                TextField("Message", text: $viewModel.promptText, axis: .vertical)
                    .lineLimit(1...6)
                    .foregroundStyle(CompanionTheme.textPrimary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(CompanionTheme.canvas, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                    }

                Menu {
                    PhotosPicker(selection: $importedPhotoItems, maxSelectionCount: 6, matching: .images) {
                        Label("Photo library", systemImage: "photo.on.rectangle")
                    }
                    Button {
                        showingImageFileImporter = true
                    } label: {
                        Label("Image file", systemImage: "folder.badge.plus")
                    }
                    Button {
                        showingAttachments = true
                    } label: {
                        Label("Saved drawing", systemImage: "paperclip")
                    }
                } label: {
                    Image(systemName: "plus.circle")
                        .font(.title2)
                        .foregroundStyle(CompanionTheme.textSecondary)
                }

                if viewModel.isStreaming {
                    Button(role: .destructive) {
                        viewModel.abort()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.headline)
                            .frame(width: 42, height: 42)
                            .background(.red.opacity(0.9), in: Circle())
                            .foregroundStyle(.white)
                    }
                } else {
                    Button {
                        viewModel.sendPrompt()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.headline.weight(.bold))
                            .frame(width: 42, height: 42)
                            .background(
                                (viewModel.promptText.trimmed.isEmpty && viewModel.promptImages.isEmpty && viewModel.promptAttachmentRefs.isEmpty)
                                    ? CompanionTheme.panelBorder
                                    : CompanionTheme.accent,
                                in: Circle()
                            )
                            .foregroundStyle(.white)
                    }
                    .disabled(viewModel.promptText.trimmed.isEmpty && viewModel.promptImages.isEmpty && viewModel.promptAttachmentRefs.isEmpty)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 14)
        }
        .background(CompanionTheme.panel)
        .overlay(alignment: .top) {
            Divider()
                .overlay(CompanionTheme.panelBorder)
        }
    }
}

private struct ConversationBlockView: View {
    let block: DisplayBlock

    private var isUser: Bool { block.type == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: .leading, spacing: 10) {
                header(roleTitle, color: roleColor)

                content

                Text(formatCompanionDate(block.ts))
                    .font(.caption2)
                    .foregroundStyle(CompanionTheme.textDim)
            }
            .padding(14)
            .frame(maxWidth: 560, alignment: .leading)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            }

            if !isUser { Spacer(minLength: 48) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch block.type {
        case "user":
            if let text = block.text?.nilIfBlank {
                MarkdownText(text)
                    .foregroundStyle(CompanionTheme.textPrimary)
                    .textSelection(.enabled)
            }
            if let images = block.images, !images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(images) { image in
                            DataURLImageView(dataURL: image.src)
                                .frame(width: 140, height: 100)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
            }
        case "text":
            MarkdownText(block.text ?? "")
                .foregroundStyle(CompanionTheme.textPrimary)
                .textSelection(.enabled)
        case "thinking":
            MarkdownText(block.text ?? "")
                .font(.callout)
                .foregroundStyle(CompanionTheme.textSecondary)
                .textSelection(.enabled)
        case "tool_use":
            if let output = block.output?.nilIfBlank {
                Text(output)
                    .font(.footnote.monospaced())
                    .foregroundStyle(CompanionTheme.textPrimary)
                    .textSelection(.enabled)
            }
            if let message = block.message?.nilIfBlank {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        case "context":
            MarkdownText(block.text ?? "")
                .font(.callout)
                .foregroundStyle(CompanionTheme.textSecondary)
        case "summary":
            MarkdownText(block.text ?? "")
                .foregroundStyle(CompanionTheme.textPrimary)
            if let detail = block.detail?.nilIfBlank {
                MarkdownText(detail)
                    .font(.footnote)
                    .foregroundStyle(CompanionTheme.textSecondary)
            }
        case "image":
            DataURLImageView(dataURL: block.src)
                .frame(maxWidth: .infinity)
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            if let caption = block.caption?.nilIfBlank {
                Text(caption)
                    .font(.footnote)
                    .foregroundStyle(CompanionTheme.textSecondary)
            }
        case "error":
            Text(block.message ?? block.text ?? "Unknown error")
                .foregroundStyle(.red)
        default:
            MarkdownText(block.text ?? block.output ?? block.message ?? "")
                .foregroundStyle(CompanionTheme.textPrimary)
                .textSelection(.enabled)
        }
    }

    private var roleTitle: String {
        switch block.type {
        case "user": return "You"
        case "text": return "Assistant"
        case "thinking": return "Thinking"
        case "tool_use": return block.tool ?? "Tool"
        case "context": return block.customType ?? "Context"
        case "summary": return block.title ?? "Summary"
        case "image": return block.caption ?? block.alt ?? "Image"
        case "error": return "Error"
        default: return block.type.capitalized
        }
    }

    private var roleColor: Color {
        switch block.type {
        case "user": return CompanionTheme.accent
        case "text": return .green
        case "thinking": return CompanionTheme.textSecondary
        case "tool_use": return .orange
        case "context": return .purple
        case "summary": return .teal
        case "image": return .indigo
        case "error": return .red
        default: return CompanionTheme.textSecondary
        }
    }

    private var backgroundColor: Color {
        isUser ? CompanionTheme.accentSurface : CompanionTheme.panel
    }

    private var borderColor: Color {
        isUser ? CompanionTheme.accent.opacity(0.45) : CompanionTheme.panelBorder
    }

    @ViewBuilder
    private func header(_ title: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(CompanionTheme.textPrimary)
        }
    }
}

private struct MarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        if let attributed = try? AttributedString(markdown: text) {
            Text(attributed)
        } else {
            Text(text)
        }
    }
}

private struct DataURLImageView: View {
    let dataURL: String?

    var body: some View {
        Group {
            if let data = dataURLData(dataURL), let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.secondary.opacity(0.12))
                    .overlay {
                        Image(systemName: "photo")
                            .foregroundStyle(.secondary)
                    }
            }
        }
    }
}

private struct RenameConversationView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var title: String
    let onSave: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
            }
            .navigationTitle("Rename conversation")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave()
                        dismiss()
                    }
                    .disabled(title.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct AttachmentBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel

    @State private var selectedRecord: ConversationAttachmentRecord?
    @State private var editorDraft = AttachmentEditorDraft()
    @State private var editingAttachmentId: String?
    @State private var showingEditor = false
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                if viewModel.savedAttachments.isEmpty {
                    ContentUnavailableView(
                        "No saved attachments",
                        systemImage: "scribble.variable",
                        description: Text("Create a drawing attachment or reuse an existing one in the composer.")
                    )
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(viewModel.savedAttachments) { attachment in
                        Button {
                            Task { await openAttachment(attachment.id) }
                        } label: {
                            AttachmentSummaryRow(viewModel: viewModel, attachment: attachment)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                viewModel.attachDrawingReference(attachment: attachment, revision: attachment.currentRevision)
                                dismiss()
                            } label: {
                                Label("Use in prompt", systemImage: "plus.bubble")
                            }
                            Button {
                                Task { await beginEditing(attachment.id) }
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                        }
                    }
                }
            }
            .navigationTitle("Attachments")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        editingAttachmentId = nil
                        editorDraft = AttachmentEditorDraft()
                        showingEditor = true
                    } label: {
                        Label("New", systemImage: "plus")
                    }
                }
            }
            .overlay {
                if isLoading {
                    ProgressView()
                }
            }
            .sheet(item: $selectedRecord) { record in
                AttachmentDetailView(viewModel: viewModel, record: record) { action in
                    switch action {
                    case .useInPrompt(let revision):
                        viewModel.attachDrawingReference(attachment: record.toSummary, revision: revision)
                        dismiss()
                    case .edit:
                        Task { await beginEditing(record.id) }
                    }
                }
            }
            .sheet(isPresented: $showingEditor) {
                AttachmentEditorView(draft: $editorDraft, title: editingAttachmentId == nil ? "New attachment" : "Edit attachment") {
                    let success: Bool
                    if let editingAttachmentId {
                        success = await viewModel.saveExistingAttachment(attachmentId: editingAttachmentId, draft: editorDraft)
                    } else {
                        success = await viewModel.saveNewAttachment(editorDraft)
                    }
                    if success {
                        showingEditor = false
                    }
                }
            }
            .task {
                viewModel.refreshAttachments()
            }
        }
    }

    private func openAttachment(_ id: String) async {
        isLoading = true
        defer { isLoading = false }
        selectedRecord = await viewModel.loadAttachment(id)
    }

    private func beginEditing(_ id: String) async {
        isLoading = true
        defer { isLoading = false }
        guard let record = await viewModel.loadAttachment(id), let draft = await viewModel.buildDraftForEditing(record) else {
            return
        }
        editingAttachmentId = id
        editorDraft = draft
        showingEditor = true
    }
}

private struct AttachmentSummaryRow: View {
    @ObservedObject var viewModel: ConversationViewModel
    let attachment: ConversationAttachmentSummary

    var body: some View {
        HStack(spacing: 12) {
            AttachmentPreviewThumbnail(viewModel: viewModel, attachmentId: attachment.id, revision: attachment.currentRevision)
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 6) {
                Text(attachment.title)
                    .font(.headline)
                    .lineLimit(2)
                Text("rev \(attachment.currentRevision) · updated \(formatRelativeCompanionDate(attachment.updatedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let note = attachment.latestRevision.note?.nilIfBlank {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct AttachmentPreviewThumbnail: View {
    @ObservedObject var viewModel: ConversationViewModel
    let attachmentId: String
    let revision: Int?

    @State private var data: Data?

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: 14)
                    .fill(.secondary.opacity(0.12))
                    .overlay {
                        Image(systemName: "scribble.variable")
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .task(id: attachmentId) {
            if data == nil, let asset = await viewModel.downloadAttachmentAsset(attachmentId: attachmentId, asset: "preview", revision: revision) {
                data = asset.data
            }
        }
    }
}

private struct AttachmentDetailView: View {
    enum Action {
        case useInPrompt(Int)
        case edit
    }

    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    let record: ConversationAttachmentRecord
    let onAction: (Action) -> Void

    @State private var previewData: Data?
    @State private var sourceText: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Group {
                        if let previewData, let image = UIImage(data: previewData) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: .infinity)
                                .clipShape(RoundedRectangle(cornerRadius: 18))
                        } else {
                            RoundedRectangle(cornerRadius: 18)
                                .fill(.secondary.opacity(0.12))
                                .frame(height: 220)
                                .overlay {
                                    ProgressView()
                                }
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(record.title)
                            .font(.title2.weight(.semibold))
                        Text("Updated \(formatCompanionDate(record.updatedAt))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let note = record.latestRevision.note?.nilIfBlank {
                            Text(note)
                                .font(.body)
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Source asset")
                            .font(.headline)
                        if let sourceText = sourceText?.nilIfBlank {
                            ScrollView(.horizontal) {
                                Text(sourceText)
                                    .font(.footnote.monospaced())
                                    .textSelection(.enabled)
                            }
                        } else {
                            ProgressView()
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Revisions")
                            .font(.headline)
                        ForEach(record.revisions.reversed()) { revision in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("Revision \(revision.revision)")
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Button("Use in prompt") {
                                        onAction(.useInPrompt(revision.revision))
                                        dismiss()
                                    }
                                }
                                Text(formatCompanionDate(revision.createdAt))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("\(revision.sourceName) · \(revision.previewName)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let note = revision.note?.nilIfBlank {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(12)
                            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Attachment")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Edit") {
                        onAction(.edit)
                    }
                }
            }
            .task {
                if previewData == nil, let asset = await viewModel.downloadAttachmentAsset(attachmentId: record.id, asset: "preview", revision: record.currentRevision) {
                    previewData = asset.data
                }
                if sourceText == nil, let asset = await viewModel.downloadAttachmentAsset(attachmentId: record.id, asset: "source", revision: record.currentRevision) {
                    sourceText = String(data: asset.data, encoding: .utf8)
                }
            }
        }
    }
}

private struct AttachmentEditorView: View {
    @Environment(\.dismiss) private var dismiss

    @Binding var draft: AttachmentEditorDraft
    let title: String
    let onSave: () async -> Void

    @State private var showingSourceImporter = false
    @State private var showingPreviewImporter = false
    @State private var previewPhotoItem: PhotosPickerItem?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Metadata") {
                    TextField("Title", text: $draft.title)
                    TextField("Note", text: $draft.note, axis: .vertical)
                        .lineLimit(3...6)
                }
                Section("Assets") {
                    Button {
                        showingSourceImporter = true
                    } label: {
                        HStack {
                            Label("Choose source file", systemImage: "doc.badge.plus")
                            Spacer()
                            Text(draft.sourceAsset?.fileName ?? "Required")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    PhotosPicker(selection: $previewPhotoItem, matching: .images) {
                        HStack {
                            Label("Pick preview image", systemImage: "photo")
                            Spacer()
                            Text(draft.previewAsset?.fileName ?? "Required")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Button {
                        showingPreviewImporter = true
                    } label: {
                        HStack {
                            Label("Import preview file", systemImage: "folder.badge.plus")
                            Spacer()
                            Text(draft.previewAsset?.fileName ?? "Required")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                if let previewAsset = draft.previewAsset, let image = UIImage(data: previewAsset.rawData) {
                    Section("Preview") {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task {
                            isSaving = true
                            await onSave()
                            isSaving = false
                        }
                    }
                    .disabled(isSaving || draft.sourceAsset == nil || draft.previewAsset == nil)
                }
            }
            .fileImporter(isPresented: $showingSourceImporter, allowedContentTypes: [.json, .data], allowsMultipleSelection: false) { result in
                handleSourceImport(result)
            }
            .fileImporter(isPresented: $showingPreviewImporter, allowedContentTypes: [.image], allowsMultipleSelection: false) { result in
                handlePreviewImport(result)
            }
            .onChange(of: previewPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let asset = try? await AttachmentDraftAsset.fromPreviewPhoto(newItem) {
                        draft.previewAsset = asset
                    }
                    previewPhotoItem = nil
                }
            }
        }
    }

    private func handleSourceImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task {
                if let asset = try? await AttachmentDraftAsset.fromSourceFile(url: url) {
                    draft.sourceAsset = asset
                }
            }
        case .failure:
            break
        }
    }

    private func handlePreviewImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task {
                if let asset = try? await AttachmentDraftAsset.fromPreviewFile(url: url) {
                    draft.previewAsset = asset
                }
            }
        case .failure:
            break
        }
    }
}

private extension ConversationAttachmentRecord {
    var toSummary: ConversationAttachmentSummary {
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

private extension PromptImageDraft {
    static func fromPhotosItem(_ item: PhotosPickerItem) async throws -> PromptImageDraft? {
        let data = try await item.loadTransferable(type: Data.self)
        guard let data, let mimeType = item.supportedContentTypes.first?.preferredMIMEType else {
            return nil
        }
        let name = item.itemIdentifier ?? "Image"
        return PromptImageDraft(name: name, mimeType: mimeType, base64Data: data.base64EncodedString(), previewData: data)
    }

    static func fromImageFile(url: URL) async throws -> PromptImageDraft? {
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted { url.stopAccessingSecurityScopedResource() }
        }
        let data = try Data(contentsOf: url)
        let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return PromptImageDraft(name: url.lastPathComponent, mimeType: mimeType, base64Data: data.base64EncodedString(), previewData: data)
    }
}

private extension AttachmentDraftAsset {
    static func fromSourceFile(url: URL) async throws -> AttachmentDraftAsset {
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted { url.stopAccessingSecurityScopedResource() }
        }
        let data = try Data(contentsOf: url)
        let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/vnd.excalidraw+json"
        return AttachmentDraftAsset(fileName: url.lastPathComponent, mimeType: mimeType, base64Data: data.base64EncodedString(), rawData: data)
    }

    static func fromPreviewFile(url: URL) async throws -> AttachmentDraftAsset {
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted { url.stopAccessingSecurityScopedResource() }
        }
        let data = try Data(contentsOf: url)
        let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/png"
        return AttachmentDraftAsset(fileName: url.lastPathComponent, mimeType: mimeType, base64Data: data.base64EncodedString(), rawData: data)
    }

    static func fromPreviewPhoto(_ item: PhotosPickerItem) async throws -> AttachmentDraftAsset? {
        let data = try await item.loadTransferable(type: Data.self)
        guard let data else { return nil }
        let mimeType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/png"
        let suffix = UTType(mimeType: mimeType)?.preferredFilenameExtension ?? "png"
        return AttachmentDraftAsset(fileName: "Preview.\(suffix)", mimeType: mimeType, base64Data: data.base64EncodedString(), rawData: data)
    }
}
