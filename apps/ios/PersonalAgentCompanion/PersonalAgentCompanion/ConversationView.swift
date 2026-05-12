import PencilKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import WebKit

struct ConversationScreen: View {
    @StateObject private var viewModel: ConversationViewModel
    private var onOpenConversation: (String) -> Void

    init(viewModel: ConversationViewModel, onOpenConversation: @escaping (String) -> Void = { _ in }) {
        _viewModel = StateObject(wrappedValue: viewModel)
        self.onOpenConversation = onOpenConversation
    }

    @State private var showingAttachments = false
    @State private var showingRename = false
    @State private var renameText = ""
    @State private var importedPhotoItems: [PhotosPickerItem] = []
    @State private var showingPhotoLibraryPicker = false
    @State private var showingImageFileImporter = false
    @State private var showingDrawingEditor = false
    @State private var drawingDraft = AttachmentEditorDraft(title: "Drawing")
    @State private var showingCwdEditor = false
    @State private var cwdText = ""
    @State private var showingModelPreferences = false
    @State private var showingArtifacts = false
    @State private var showingCheckpoints = false
    @State private var showingForkBranch = false
    @State private var composerTextHeight: CGFloat = 32

    private var currentExecutionTargetLabel: String {
        viewModel.executionTargets.first(where: { $0.id == viewModel.currentExecutionTargetId })?.label ?? "Local"
    }

    private var transcriptItems: [TranscriptRenderItem] {
        buildTranscriptRenderItems(viewModel.blocks)
    }

    private var composerHasContent: Bool {
        viewModel.promptText.trimmed.nilIfBlank != nil || !viewModel.promptImages.isEmpty || !viewModel.promptAttachmentRefs.isEmpty
    }

    private var presencePresentation: ConversationPresencePresentation? {
        viewModel.presenceState.map {
            ConversationPresencePresentation(state: $0, installationSurfaceId: viewModel.installationSurfaceId)
        }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if viewModel.blocks.isEmpty && !viewModel.isLoading {
                        EmptyConversationState(
                            meta: viewModel.sessionMeta,
                            canStartSimulation: viewModel.canSimulateRunningConversation && !viewModel.isStreaming,
                            startSimulation: {
                                viewModel.startRunningConversationSimulation()
                            }
                        )
                    }

                    if let presencePresentation, presencePresentation.shouldDisplay {
                        PresenceBannerView(
                            presentation: presencePresentation,
                            onTakeOver: viewModel.takeOver
                        )
                    }

                    ForEach(transcriptItems) { item in
                        switch item {
                        case .message(let block):
                            ConversationBlockView(block: block, viewModel: viewModel)
                                .id(item.id)
                        case .traceCluster(let cluster):
                            TraceClusterView(cluster: cluster, live: isLiveTraceCluster(cluster))
                                .id(item.id)
                        }
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("conversation-bottom")
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
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingAttachments = true
                    } label: {
                        Image(systemName: "paperclip")
                    }
                    .accessibilityLabel("Attachments")
                }
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
                            if viewModel.canSimulateRunningConversation && !viewModel.isStreaming {
                                Button {
                                    viewModel.startRunningConversationSimulation()
                                } label: {
                                    Label("Start simulated run", systemImage: "bolt.horizontal.circle")
                                }
                            }
                            Button {
                                Task {
                                    if let nextId = await viewModel.duplicateConversation() {
                                        onOpenConversation(nextId)
                                    }
                                }
                            } label: {
                                Label("Duplicate", systemImage: "plus.square.on.square")
                            }
                            Button {
                                cwdText = viewModel.sessionMeta?.cwd ?? ""
                                showingCwdEditor = true
                            } label: {
                                Label("Change working directory", systemImage: "folder")
                            }
                            Button {
                                showingModelPreferences = true
                            } label: {
                                Label("Model preferences", systemImage: "slider.horizontal.3")
                            }
                            Button {
                                showingForkBranch = true
                            } label: {
                                Label("Fork / Branch", systemImage: "arrow.triangle.branch")
                            }
                            Button {
                                showingArtifacts = true
                            } label: {
                                Label("Artifacts", systemImage: "doc.richtext")
                            }
                            Button {
                                showingCheckpoints = true
                            } label: {
                                Label("Checkpoints", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
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
                        .foregroundStyle(CompanionTheme.textPrimary)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                composer
            }
            .overlay(alignment: .top) {
                VStack(spacing: 8) {
                    if let message = viewModel.errorMessage {
                        Text(message)
                            .font(.footnote)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.red.opacity(0.92), in: Capsule())
                            .foregroundStyle(.white)
                    }
                    if let message = viewModel.composerNotice {
                        Text(message)
                            .font(.footnote)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(CompanionTheme.accent, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
                .padding(.top, 8)
            }
            .sheet(isPresented: $showingAttachments) {
                AttachmentBrowserView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingDrawingEditor) {
                AttachmentEditorView(draft: $drawingDraft, title: "Drawing", showsMetadata: false, saveButtonTitle: "Attach") {
                    if await viewModel.saveNewAttachmentAndAttach(drawingDraft) {
                        drawingDraft = AttachmentEditorDraft(title: "Drawing")
                        showingDrawingEditor = false
                    }
                }
            }
            .sheet(isPresented: $showingRename) {
                RenameConversationView(title: $renameText) {
                    viewModel.renameConversation(renameText)
                    showingRename = false
                }
            }
            .sheet(isPresented: $showingCwdEditor) {
                ConversationCwdEditorView(
                    cwd: $cwdText,
                    workspacePaths: viewModel.workspacePaths,
                    executionTargetId: viewModel.currentExecutionTargetId,
                    browseDirectory: { targetId, path in
                        await viewModel.readRemoteDirectory(targetId: targetId, path: path)
                    }
                ) {
                    if let result = await viewModel.changeWorkingDirectory(cwdText), result.changed {
                        showingCwdEditor = false
                        onOpenConversation(result.id)
                    }
                }
            }
            .sheet(isPresented: $showingModelPreferences) {
                ConversationModelPreferencesView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingArtifacts) {
                ArtifactBrowserView(viewModel: viewModel)
            }
            .sheet(isPresented: $showingForkBranch) {
                ForkBranchBrowserView(viewModel: viewModel, onOpenConversation: onOpenConversation)
            }
            .sheet(isPresented: $showingCheckpoints) {
                CheckpointBrowserView(viewModel: viewModel)
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
            .photosPicker(isPresented: $showingPhotoLibraryPicker, selection: $importedPhotoItems, maxSelectionCount: 6, matching: .images)
            .onChange(of: importedPhotoItems) { _, newItems in
                Task {
                    await importPromptPhotos(newItems)
                }
            }
            .task(id: viewModel.conversationId) {
                viewModel.start()
            }
            .onDisappear {
                viewModel.stop()
            }
            .onChange(of: viewModel.blocks.count) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("conversation-bottom", anchor: .bottom)
                }
            }
        }
    }

    private func isLiveTraceCluster(_ cluster: TraceCluster) -> Bool {
        if cluster.summary.hasRunning {
            return true
        }
        guard viewModel.isStreaming, let lastClusterBlock = cluster.blocks.last else {
            return false
        }
        return lastClusterBlock.type == "thinking" && viewModel.blocks.last?.id == lastClusterBlock.id
    }

    private func importPromptPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let draft = try? await PromptImageDraft.fromPhotosItem(item) {
                viewModel.addPromptImage(draft)
            }
        }
        importedPhotoItems.removeAll()
    }

    private func attachPromptImage(data: Data, mimeType: String?, fileName: String?) {
        guard let draft = PromptImageDraft.fromImportedData(data: data, mimeType: mimeType, fileName: fileName) else {
            viewModel.errorMessage = "Couldn't attach that image."
            return
        }
        viewModel.addPromptImage(draft)
    }

    private func pasteClipboardImage() {
        guard let image = UIPasteboard.general.image,
              let data = image.pngData() else {
            return
        }
        attachPromptImage(data: data, mimeType: "image/png", fileName: "clipboard-image.png")
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if let presencePresentation, presencePresentation.shouldBlockComposer {
                TakeOverComposerView(
                    summary: presencePresentation.summary,
                    onTakeOver: viewModel.takeOver
                )
            } else {
                if ConversationActivityShelf.hasItems(viewModel) {
                    ConversationActivityShelf(viewModel: viewModel, onOpenConversation: onOpenConversation)
                        .padding(.horizontal, 14)
                        .padding(.top, 10)
                }

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

                HStack(alignment: .center, spacing: 8) {
                    HStack(alignment: .center, spacing: 8) {
                        Menu {
                            Button {
                                showingPhotoLibraryPicker = true
                            } label: {
                                Label("Photo library", systemImage: "photo.on.rectangle")
                            }
                            Button {
                                showingImageFileImporter = true
                            } label: {
                                Label("Image file", systemImage: "folder.badge.plus")
                            }
                            if UIPasteboard.general.image != nil {
                                Button {
                                    pasteClipboardImage()
                                } label: {
                                    Label("Paste image", systemImage: "doc.on.clipboard")
                                }
                            }
                            Button {
                                drawingDraft = AttachmentEditorDraft(title: "Drawing")
                                showingDrawingEditor = true
                            } label: {
                                Label("Drawing", systemImage: "scribble.variable")
                            }
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(CompanionTheme.accent)
                                .frame(width: 26, height: 26)
                        }

                        ZStack(alignment: .topLeading) {
                            if viewModel.promptText.isEmpty {
                                Text("Message")
                                    .foregroundStyle(CompanionTheme.textSecondary)
                                    .padding(.top, 6)
                            }
                            ConversationComposerTextEditor(
                                text: $viewModel.promptText,
                                height: $composerTextHeight,
                                onPasteImage: attachPromptImage
                            )
                            .frame(height: composerTextHeight)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                    }

                    composerActions
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
        }
        .background(CompanionTheme.panel)
        .overlay(alignment: .top) {
            Divider()
                .overlay(CompanionTheme.panelBorder)
        }
    }

    @ViewBuilder
    private var composerActions: some View {
        if viewModel.isStreaming {
            HStack(spacing: 8) {
                stopButton
                if composerHasContent {
                    promptSendButton(defaultMode: .steer, showStreamingOptions: true)
                }
            }
        } else {
            promptSendButton(defaultMode: .submit, showStreamingOptions: false)
        }
    }

    private var stopButton: some View {
        Button(role: .destructive) {
            viewModel.abort()
        } label: {
            Image(systemName: "stop.fill")
                .font(.headline)
                .frame(width: 36, height: 36)
                .background(.red.opacity(0.9), in: Circle())
                .foregroundStyle(.white)
        }
    }

    private func promptSendButton(defaultMode: ConversationPromptSubmissionMode, showStreamingOptions: Bool) -> some View {
        let buttonMode: ConversationPromptSubmissionMode = showStreamingOptions ? .submit : defaultMode

        return Group {
            if showStreamingOptions {
                Menu {
                    queuedPromptActions
                } label: {
                    sendButtonLabel(defaultMode: buttonMode)
                } primaryAction: {
                    viewModel.sendPrompt(mode: defaultMode)
                }
            } else {
                Button {
                    viewModel.sendPrompt(mode: defaultMode)
                } label: {
                    sendButtonLabel(defaultMode: buttonMode)
                }
            }
        }
        .disabled(!composerHasContent || viewModel.isSubmittingPrompt)
    }

    private func sendButtonLabel(defaultMode: ConversationPromptSubmissionMode) -> some View {
        Image(systemName: defaultMode.systemImage)
            .font(.headline.weight(.bold))
            .frame(width: 36, height: 36)
            .background(composerHasContent ? CompanionTheme.accent : CompanionTheme.panelBorder, in: Circle())
            .foregroundStyle(.white)
    }

    @ViewBuilder
    private var queuedPromptActions: some View {
        Button {
            viewModel.sendPrompt(mode: .steer)
        } label: {
            Label(ConversationPromptSubmissionMode.steer.title, systemImage: ConversationPromptSubmissionMode.steer.systemImage)
        }

        Button {
            viewModel.sendPrompt(mode: .followUp)
        } label: {
            Label(ConversationPromptSubmissionMode.followUp.title, systemImage: ConversationPromptSubmissionMode.followUp.systemImage)
        }

        Button {
            viewModel.sendPrompt(mode: .parallel)
        } label: {
            Label(ConversationPromptSubmissionMode.parallel.title, systemImage: ConversationPromptSubmissionMode.parallel.systemImage)
        }
    }
}

private enum TranscriptRenderItem: Identifiable {
    case message(DisplayBlock)
    case traceCluster(TraceCluster)

    var id: String {
        switch self {
        case .message(let block):
            return "message:\(block.id)"
        case .traceCluster(let cluster):
            return cluster.id
        }
    }
}

private struct TraceCluster: Identifiable {
    let id: String
    let blocks: [DisplayBlock]
    let summary: TraceClusterSummary
}

private struct TraceClusterSummary {
    let stepCount: Int
    let categories: [TraceSummaryCategory]
    let durationMs: Double?
    let hasError: Bool
    let hasRunning: Bool
}

private struct TraceSummaryCategory: Identifiable {
    enum Kind {
        case thinking
        case tool
    }

    let id: String
    let kind: Kind
    let label: String
    var count: Int
    let tool: String?
}

private enum DisclosurePreference {
    case auto
    case open
    case closed
}

private struct ToolDisplayMeta {
    let label: String
    let icon: String
    let tint: Color
    let background: Color
}

private let maxVisibleTraceBlocks = 5
private let liveExpandedTraceTailCount = 3

private func buildTranscriptRenderItems(_ blocks: [DisplayBlock]) -> [TranscriptRenderItem] {
    var items: [TranscriptRenderItem] = []
    var pendingTraceBlocks: [DisplayBlock] = []

    func flushPendingTraceBlocks() {
        guard !pendingTraceBlocks.isEmpty else {
            return
        }
        let cluster = TraceCluster(
            id: "trace:\(pendingTraceBlocks.first?.id ?? UUID().uuidString)",
            blocks: pendingTraceBlocks,
            summary: summarizeTraceCluster(pendingTraceBlocks)
        )
        items.append(.traceCluster(cluster))
        pendingTraceBlocks.removeAll()
    }

    for block in blocks {
        if isTraceConversationBlock(block) {
            pendingTraceBlocks.append(block)
        } else {
            flushPendingTraceBlocks()
            items.append(.message(block))
        }
    }

    flushPendingTraceBlocks()
    return items
}

private func isTraceConversationBlock(_ block: DisplayBlock) -> Bool {
    switch block.type {
    case "thinking":
        return true
    case "tool_use":
        let userFacingTools: Set<String> = ["artifact", "checkpoint", "ask_user_question"]
        return !userFacingTools.contains(block.tool?.nilIfBlank ?? "")
    default:
        return false
    }
}

private func summarizeTraceCluster(_ blocks: [DisplayBlock]) -> TraceClusterSummary {
    var categories: [TraceSummaryCategory] = []
    var totalDurationMs = 0.0
    var hasDuration = false
    var hasError = false
    var hasRunning = false

    func appendCategory(id: String, kind: TraceSummaryCategory.Kind, label: String, tool: String? = nil) {
        if let index = categories.firstIndex(where: { $0.id == id }) {
            categories[index].count += 1
            return
        }
        categories.append(TraceSummaryCategory(id: id, kind: kind, label: label, count: 1, tool: tool))
    }

    for block in blocks {
        switch block.type {
        case "thinking":
            appendCategory(id: "thinking", kind: .thinking, label: "thinking")
        case "tool_use":
            let toolName = block.tool?.nilIfBlank ?? "tool"
            appendCategory(id: "tool:\(toolName)", kind: .tool, label: toolName, tool: toolName)
            if let durationMs = block.durationMs, durationMs > 0 {
                totalDurationMs += durationMs
                hasDuration = true
            } else {
                hasRunning = true
            }
            if block.message?.nilIfBlank != nil {
                hasError = true
            }
        default:
            break
        }
    }

    return TraceClusterSummary(
        stepCount: blocks.count,
        categories: categories,
        durationMs: hasDuration ? totalDurationMs : nil,
        hasError: hasError,
        hasRunning: hasRunning
    )
}

private func resolveDisclosureOpen(autoOpen: Bool, preference: DisclosurePreference) -> Bool {
    switch preference {
    case .auto:
        return autoOpen
    case .open:
        return true
    case .closed:
        return false
    }
}

private func toggleDisclosurePreference(autoOpen: Bool, preference: DisclosurePreference) -> DisclosurePreference {
    resolveDisclosureOpen(autoOpen: autoOpen, preference: preference) ? .closed : .open
}

private func toolMeta(_ tool: String?) -> ToolDisplayMeta {
    switch tool?.nilIfBlank {
    case "bash":
        return ToolDisplayMeta(label: "bash", icon: "terminal", tint: .orange, background: .orange.opacity(0.08))
    case "read":
        return ToolDisplayMeta(label: "read", icon: "doc.text.magnifyingglass", tint: .indigo, background: .indigo.opacity(0.08))
    case "edit":
        return ToolDisplayMeta(label: "edit", icon: "square.and.pencil", tint: .blue, background: .blue.opacity(0.08))
    case "write":
        return ToolDisplayMeta(label: "write", icon: "doc.badge.plus", tint: .green, background: .green.opacity(0.08))
    case "web_search":
        return ToolDisplayMeta(label: "web_search", icon: "globe", tint: .teal, background: .teal.opacity(0.08))
    case "run":
        return ToolDisplayMeta(label: "run", icon: "bolt.horizontal.circle", tint: .purple, background: .purple.opacity(0.08))
    case "scheduled_task":
        return ToolDisplayMeta(label: "scheduled_task", icon: "clock.arrow.circlepath", tint: .purple, background: .purple.opacity(0.08))
    case "artifact":
        return ToolDisplayMeta(label: "artifact", icon: "doc.richtext", tint: .pink, background: .pink.opacity(0.08))
    default:
        let label = tool?.nilIfBlank ?? "tool"
        return ToolDisplayMeta(label: label, icon: "wrench.adjustable", tint: .gray, background: .gray.opacity(0.08))
    }
}

private func traceCategoryTint(_ category: TraceSummaryCategory) -> Color {
    switch category.kind {
    case .thinking:
        return CompanionTheme.textSecondary
    case .tool:
        return toolMeta(category.tool).tint
    }
}

private func previewText(_ text: String?, maxLength: Int = 84) -> String {
    let normalized = (text ?? "")
        .split(whereSeparator: \Character.isNewline)
        .joined(separator: " ")
        .replacingOccurrences(of: "\t", with: " ")
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmed
    guard !normalized.isEmpty else {
        return ""
    }
    if normalized.count <= maxLength {
        return normalized
    }
    let endIndex = normalized.index(normalized.startIndex, offsetBy: maxLength - 1)
    return "\(normalized[..<endIndex])…"
}

private func formatDurationLabel(_ durationMs: Double?) -> String? {
    guard let durationMs, durationMs > 0 else {
        return nil
    }
    if durationMs >= 1000 {
        return String(format: "%.1fs", durationMs / 1000)
    }
    return "\(Int(durationMs.rounded()))ms"
}

private func toolPreview(for block: DisplayBlock) -> String {
    guard let input = block.input?.objectValue else {
        return ""
    }

    if let command = input["command"]?.stringValue?.split(separator: "\n").first {
        return previewText(String(command), maxLength: 72)
    }
    if let path = input["path"]?.stringValue {
        return previewText(path, maxLength: 72)
    }
    if let url = input["url"]?.stringValue {
        return previewText(url.replacingOccurrences(of: "https://", with: ""), maxLength: 72)
    }
    if let query = input["query"]?.stringValue {
        return previewText(query, maxLength: 72)
    }
    if let action = input["action"]?.stringValue {
        return previewText(action, maxLength: 72)
    }
    return ""
}

private func prettyJSONString(_ value: JSONValue?) -> String? {
    guard let value else {
        return nil
    }
    if case .string(let string) = value {
        return string
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(value), let string = String(data: data, encoding: .utf8) else {
        return nil
    }
    return string
}

private func shouldAutoOpenTraceRow(block: DisplayBlock, index: Int, total: Int, live: Bool) -> Bool {
    if block.type == "tool_use", block.durationMs == nil {
        return true
    }
    guard live else {
        return false
    }
    return index >= max(0, total - liveExpandedTraceTailCount)
}

private struct TraceSummaryChip: View {
    let category: TraceSummaryCategory

    var body: some View {
        let tint = traceCategoryTint(category)
        Text(category.count > 1 ? "\(category.label) ×\(category.count)" : category.label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

private struct TraceClusterView: View {
    let cluster: TraceCluster
    let live: Bool

    @State private var preference: DisclosurePreference = .auto
    @State private var showAllBlocks = false

    private var autoOpen: Bool { live || cluster.summary.hasRunning }
    private var open: Bool { resolveDisclosureOpen(autoOpen: autoOpen, preference: preference) }
    private var hiddenBlockCount: Int { max(0, cluster.blocks.count - maxVisibleTraceBlocks) }

    private var visibleBlocks: [DisplayBlock] {
        if showAllBlocks || hiddenBlockCount == 0 {
            return cluster.blocks
        }
        return Array(cluster.blocks.suffix(maxVisibleTraceBlocks))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                preference = toggleDisclosurePreference(autoOpen: autoOpen, preference: preference)
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        if autoOpen {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(cluster.summary.hasError ? .red : CompanionTheme.accent)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: cluster.summary.hasError ? "exclamationmark.circle" : "ellipsis")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(cluster.summary.hasError ? .red : CompanionTheme.textSecondary)
                        }

                        Text(autoOpen ? "Working" : "Internal work")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(CompanionTheme.textPrimary)
                        Text("· \(cluster.summary.stepCount) step\(cluster.summary.stepCount == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundStyle(CompanionTheme.textSecondary)
                        Spacer()
                        if live {
                            Text("live")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(CompanionTheme.accent)
                        }
                        if let duration = formatDurationLabel(cluster.summary.durationMs), !autoOpen {
                            Text(duration)
                                .font(.caption2)
                                .foregroundStyle(CompanionTheme.textSecondary)
                        }
                        Text(open ? "Hide" : "Show")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }

                    if !cluster.summary.categories.isEmpty {
                        HStack(spacing: 6) {
                            ForEach(Array(cluster.summary.categories.prefix(3))) { category in
                                TraceSummaryChip(category: category)
                            }
                            let remaining = max(0, cluster.summary.categories.count - 3)
                            if remaining > 0 {
                                Text("+\(remaining) more")
                                    .font(.caption2)
                                    .foregroundStyle(CompanionTheme.textSecondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(cluster.summary.hasError ? Color.red.opacity(0.06) : CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(cluster.summary.hasError ? Color.red.opacity(0.22) : CompanionTheme.panelBorder, lineWidth: 1)
                }
            }
            .buttonStyle(.plain)

            if open {
                VStack(alignment: .leading, spacing: 8) {
                    if hiddenBlockCount > 0 {
                        HStack(spacing: 8) {
                            Text(showAllBlocks ? "Showing all \(cluster.blocks.count) steps." : "\(hiddenBlockCount) earlier step\(hiddenBlockCount == 1 ? "" : "s") summarized above.")
                                .font(.caption)
                                .foregroundStyle(CompanionTheme.textSecondary)
                            Spacer()
                            Button(showAllBlocks ? "Show latest \(maxVisibleTraceBlocks)" : "Show all") {
                                showAllBlocks.toggle()
                            }
                            .font(.caption.weight(.semibold))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(CompanionTheme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(visibleBlocks.enumerated()), id: \.element.id) { index, block in
                            switch block.type {
                            case "thinking":
                                ThinkingTraceRow(
                                    block: block,
                                    autoOpen: shouldAutoOpenTraceRow(block: block, index: index, total: visibleBlocks.count, live: live)
                                )
                            case "tool_use":
                                ToolTraceRow(
                                    block: block,
                                    autoOpen: shouldAutoOpenTraceRow(block: block, index: index, total: visibleBlocks.count, live: live)
                                )
                            default:
                                EmptyView()
                            }
                        }
                    }
                    .padding(.leading, 14)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(CompanionTheme.panelBorder)
                            .frame(width: 1)
                            .padding(.vertical, 4)
                    }
                }
            }
        }
    }
}

private struct ThinkingTraceRow: View {
    let block: DisplayBlock
    let autoOpen: Bool

    @State private var preference: DisclosurePreference = .auto

    private var open: Bool { resolveDisclosureOpen(autoOpen: autoOpen, preference: preference) }

    var body: some View {
        Button {
            preference = toggleDisclosurePreference(autoOpen: autoOpen, preference: preference)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "brain.head.profile")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textSecondary)
                    Text("Thinking")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textSecondary)
                    Spacer()
                    if autoOpen {
                        Text("live")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }
                    Text(open ? "Hide" : "Show")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textSecondary)
                }

                if open {
                    MarkdownText(block.text ?? "")
                        .font(.callout)
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .textSelection(.enabled)
                } else {
                    Text(previewText(block.text))
                        .font(.caption)
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(CompanionTheme.panel.opacity(0.85), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(CompanionTheme.panelBorder, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct ToolTraceRow: View {
    let block: DisplayBlock
    let autoOpen: Bool

    @State private var preference: DisclosurePreference = .auto

    private var meta: ToolDisplayMeta { toolMeta(block.tool) }
    private var isRunning: Bool { block.durationMs == nil }
    private var isError: Bool { block.message?.nilIfBlank != nil }
    private var open: Bool { resolveDisclosureOpen(autoOpen: autoOpen || isRunning, preference: preference) }
    private var preview: String { toolPreview(for: block) }

    var body: some View {
        Button {
            preference = toggleDisclosurePreference(autoOpen: autoOpen || isRunning, preference: preference)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if isRunning {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(meta.tint)
                            .scaleEffect(0.75)
                    } else {
                        Image(systemName: meta.icon)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isError ? .red : meta.tint)
                    }
                    Text(meta.label)
                        .font(.caption.weight(.semibold).monospaced())
                        .foregroundStyle(isError ? .red : meta.tint)
                    if !preview.isEmpty {
                        Text(preview)
                            .font(.caption)
                            .foregroundStyle(CompanionTheme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if let duration = formatDurationLabel(block.durationMs), !isRunning {
                        Text(duration)
                            .font(.caption2)
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }
                    if isRunning {
                        Text("running…")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(meta.tint)
                    }
                    Text(open ? "Hide" : "Show")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textSecondary)
                }

                if open {
                    VStack(alignment: .leading, spacing: 10) {
                        if let input = prettyJSONString(block.input), !input.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                TranscriptSectionLabel(title: "Input", tint: meta.tint)
                                Text(input)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(CompanionTheme.textPrimary)
                                    .textSelection(.enabled)
                            }
                        }

                        if let output = block.output?.nilIfBlank {
                            VStack(alignment: .leading, spacing: 4) {
                                TranscriptSectionLabel(title: isRunning ? "Live output" : "Output", tint: meta.tint)
                                Text(output)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(isError ? .red : CompanionTheme.textPrimary)
                                    .textSelection(.enabled)
                            }
                        } else if isRunning {
                            Text("Waiting for output…")
                                .font(.caption)
                                .foregroundStyle(CompanionTheme.textSecondary)
                        } else if block.outputDeferred == true {
                            Text("Older tool output is available on desktop.")
                                .font(.caption)
                                .foregroundStyle(CompanionTheme.textSecondary)
                        }

                        if let message = block.message?.nilIfBlank, message != block.output?.nilIfBlank {
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background((isError ? Color.red.opacity(0.08) : meta.background), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isError ? Color.red.opacity(0.2) : meta.tint.opacity(0.14), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct TranscriptSectionLabel: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
    }
}

private struct ConversationBlockView: View {
    let block: DisplayBlock
    let viewModel: ConversationViewModel?

    private var isUser: Bool { block.type == "user" }
    private var showsHeader: Bool { block.type != "user" && block.type != "text" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: .leading, spacing: showsHeader ? 10 : 8) {
                if showsHeader {
                    header(roleTitle, color: roleColor)
                }

                content

                Text(formatCompanionDate(block.ts))
                    .font(.caption2)
                    .foregroundStyle(CompanionTheme.textDim)
            }
            .padding(12)
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
                            TranscriptImageView(src: image.src, viewModel: viewModel)
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
            if block.tool == "ask_user_question", let viewModel, let presentation = readAskUserQuestionPresentation(block) {
                AskUserQuestionCard(block: block, presentation: presentation, onSubmit: { reply in
                    viewModel.submitPlainPrompt(reply)
                })
            } else {
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
            TranscriptImageView(src: block.src, viewModel: viewModel)
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
        case "thinking": return CompanionTheme.textSecondary
        case "tool_use": return toolMeta(block.tool).tint
        case "context": return .purple
        case "summary": return .teal
        case "image": return .indigo
        case "error": return .red
        default: return CompanionTheme.textSecondary
        }
    }

    private var backgroundColor: Color {
        if isUser {
            return CompanionTheme.accentSurface
        }
        return block.type == "text" ? CompanionTheme.panelRaised : CompanionTheme.panel
    }

    private var borderColor: Color {
        isUser ? CompanionTheme.accent.opacity(0.18) : CompanionTheme.panelBorder
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

struct ConversationPresencePresentation {
    let state: LiveSessionPresenceState
    let installationSurfaceId: String

    var controllingHere: Bool {
        state.controllerSurfaceId?.nilIfBlank == installationSurfaceId
    }

    var controllingElsewhere: Bool {
        guard let controller = state.controllerSurfaceId?.nilIfBlank else {
            return false
        }
        return controller != installationSurfaceId
    }

    var shouldDisplay: Bool {
        controllingElsewhere || state.surfaces.count > 1
    }

    var shouldBlockComposer: Bool {
        controllingElsewhere
    }

    var summary: String {
        if controllingHere {
            return state.surfaces.count > 1
                ? "This phone controls the conversation. \(state.surfaces.count) surfaces are connected."
                : "This phone controls the conversation."
        }
        if controllingElsewhere {
            return state.surfaces.count > 1
                ? "Another surface controls the conversation. \(state.surfaces.count) surfaces are connected."
                : "Another surface controls the conversation."
        }
        return state.surfaces.count == 1
            ? "1 surface is connected."
            : "\(state.surfaces.count) surfaces are connected."
    }
}

private struct PresenceBannerView: View {
    let presentation: ConversationPresencePresentation
    let onTakeOver: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: presentation.controllingHere ? "hand.raised.fill" : "person.2")
                .foregroundStyle(presentation.controllingElsewhere ? .orange : CompanionTheme.accent)
            Text(presentation.summary)
                .font(.footnote)
                .foregroundStyle(CompanionTheme.textSecondary)
            Spacer()
            if presentation.controllingElsewhere {
                Button("Take over") {
                    onTakeOver()
                }
                .font(.footnote.weight(.semibold))
            }
        }
        .padding(12)
        .background(presentation.controllingElsewhere ? Color.orange.opacity(0.08) : CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(presentation.controllingElsewhere ? Color.orange.opacity(0.18) : CompanionTheme.panelBorder, lineWidth: 1)
        }
    }
}

private struct TakeOverComposerView: View {
    let summary: String
    let onTakeOver: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "hand.raised.fill")
                    .foregroundStyle(.orange)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Take over to reply from this phone")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textPrimary)
                    Text(summary)
                        .font(.footnote)
                        .foregroundStyle(CompanionTheme.textSecondary)
                }
                Spacer(minLength: 0)
            }

            Button(action: onTakeOver) {
                Label("Take over here", systemImage: "hand.raised.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }
}

private struct ConversationActivityShelf: View {
    @ObservedObject var viewModel: ConversationViewModel
    let onOpenConversation: (String) -> Void

    private struct QueuedItem: Identifiable {
        let id: String
        let behavior: String
        let index: Int
        let preview: QueuedPromptPreview
    }

    private var queuedItems: [QueuedItem] {
        let steering = viewModel.queuedSteeringPrompts.enumerated().map {
            QueuedItem(id: "steer-\($0.element.id)", behavior: "steer", index: $0.offset, preview: $0.element)
        }
        let followUp = viewModel.queuedFollowUpPrompts.enumerated().map {
            QueuedItem(id: "followUp-\($0.element.id)", behavior: "followUp", index: $0.offset, preview: $0.element)
        }
        return steering + followUp
    }

    static func hasItems(_ viewModel: ConversationViewModel) -> Bool {
        !viewModel.queuedSteeringPrompts.isEmpty
            || !viewModel.queuedFollowUpPrompts.isEmpty
            || !(viewModel.sessionMeta?.deferredResumes ?? []).isEmpty
            || !viewModel.connectedRuns.isEmpty
            || !viewModel.parallelJobs.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "bolt.horizontal")
                    .font(.caption.weight(.semibold))
                Text("Activity")
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(CompanionTheme.textSecondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 8) {
                    ForEach(queuedItems) { item in
                        ActivityTile(
                            title: item.behavior == "steer" ? "Steer queued" : "Follow-up queued",
                            detail: previewText(item.preview.text, maxLength: 90),
                            status: item.preview.imageCount > 0 ? "\(item.preview.imageCount) image\(item.preview.imageCount == 1 ? "" : "s")" : nil,
                            tint: item.behavior == "steer" ? .orange : .teal
                        ) {
                            if item.preview.restorable != false {
                                Button("Restore") {
                                    viewModel.restoreQueuedPrompt(behavior: item.behavior, index: item.index, previewId: item.preview.id)
                                }
                            }
                        }
                    }

                    ForEach(viewModel.sessionMeta?.deferredResumes ?? []) { resume in
                        ActivityTile(
                            title: resume.title?.nilIfBlank ?? "Deferred resume",
                            detail: previewText(resume.prompt, maxLength: 90),
                            status: formatRelativeCompanionDate(resume.dueAt),
                            tint: .purple
                        ) {
                            Button("Run now") { viewModel.fireDeferredResume(resume.id) }
                            Button("Cancel", role: .destructive) { viewModel.cancelDeferredResume(resume.id) }
                        }
                    }

                    ForEach(viewModel.connectedRuns) { run in
                        ActivityTile(
                            title: run.manifest?.kind.nilIfBlank ?? "Run",
                            detail: run.runId,
                            status: runStatusLabel(run.status?.status),
                            tint: runStatusTint(run.status?.status)
                        ) {
                            Button("Cancel", role: .destructive) { viewModel.cancelConnectedRun(run.runId) }
                        }
                    }

                    ForEach(viewModel.parallelJobs) { job in
                        ActivityTile(
                            title: "Parallel",
                            detail: previewText(job.prompt, maxLength: 90),
                            status: parallelStatusLabel(job.status),
                            tint: parallelStatusTint(job.status)
                        ) {
                            if job.status == "ready" || job.status == "failed" {
                                Button("Import") { viewModel.manageParallelJob(job.id, action: "importNow") }
                            }
                            if job.status == "running" {
                                Button("Cancel", role: .destructive) { viewModel.manageParallelJob(job.id, action: "cancel") }
                            } else if job.status != "importing" {
                                Button("Skip", role: .destructive) { viewModel.manageParallelJob(job.id, action: "skip") }
                            }
                            Button("Open") { onOpenConversation(job.childConversationId) }
                        }
                    }
                }
                .padding(.vertical, 1)
            }
        }
    }
}

private struct ActivityTile<Actions: View>: View {
    let title: String
    let detail: String
    let status: String?
    let tint: Color
    @ViewBuilder let actions: Actions

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(CompanionTheme.textPrimary)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(CompanionTheme.textSecondary)
                    .lineLimit(2)
                    .frame(width: 136, alignment: .leading)
                if let status {
                    Text(status)
                        .font(.caption2)
                        .foregroundStyle(tint)
                        .lineLimit(1)
                }
            }
            Menu {
                actions
            } label: {
                Image(systemName: "ellipsis")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(CompanionTheme.textSecondary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private func runStatusLabel(_ status: String?) -> String {
    switch status {
    case "running": return "Running"
    case "queued": return "Queued"
    case "waiting": return "Waiting"
    default: return status?.capitalized ?? "Active"
    }
}

private func runStatusTint(_ status: String?) -> Color {
    switch status {
    case "running": return .blue
    case "queued": return .orange
    case "waiting": return .purple
    default: return CompanionTheme.textSecondary
    }
}

private func parallelStatusLabel(_ status: String) -> String {
    switch status {
    case "running": return "Running"
    case "ready": return "Ready"
    case "failed": return "Failed"
    case "importing": return "Importing"
    default: return status.capitalized
    }
}

private func parallelStatusTint(_ status: String) -> Color {
    switch status {
    case "running": return .blue
    case "ready": return CompanionTheme.accent
    case "failed": return .red
    case "importing": return .orange
    default: return CompanionTheme.textSecondary
    }
}

private struct QueuedPromptsShelf: View {
    @ObservedObject var viewModel: ConversationViewModel

    private struct Item: Identifiable {
        let id: String
        let behavior: String
        let index: Int
        let preview: QueuedPromptPreview
    }

    private var items: [Item] {
        let steering = viewModel.queuedSteeringPrompts.enumerated().map { Item(id: "steer-\($0.element.id)", behavior: "steer", index: $0.offset, preview: $0.element) }
        let followUp = viewModel.queuedFollowUpPrompts.enumerated().map { Item(id: "followUp-\($0.element.id)", behavior: "followUp", index: $0.offset, preview: $0.element) }
        return steering + followUp
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Queued")
                .font(.caption.weight(.semibold))
                .foregroundStyle(CompanionTheme.textSecondary)
            ForEach(items) { item in
                HStack(alignment: .top, spacing: 10) {
                    Text(item.behavior == "steer" ? "Steer" : "Follow up")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(item.behavior == "steer" ? .orange : .teal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background((item.behavior == "steer" ? Color.orange : Color.teal).opacity(0.12), in: Capsule())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(previewText(item.preview.text, maxLength: 160))
                            .font(.footnote)
                            .foregroundStyle(CompanionTheme.textPrimary)
                        if item.preview.imageCount > 0 {
                            Text("\(item.preview.imageCount) image\(item.preview.imageCount == 1 ? "" : "s")")
                                .font(.caption2)
                                .foregroundStyle(CompanionTheme.textDim)
                        }
                    }
                    Spacer(minLength: 8)
                    if item.preview.restorable != false {
                        Button("Restore") {
                            viewModel.restoreQueuedPrompt(behavior: item.behavior, index: item.index, previewId: item.preview.id)
                        }
                        .font(.caption.weight(.semibold))
                    }
                }
                .padding(12)
                .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                }
            }
        }
    }
}

private struct ParallelJobsShelf: View {
    @ObservedObject var viewModel: ConversationViewModel
    let onOpenConversation: (String) -> Void

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "running": return "Running"
        case "ready": return "Ready"
        case "failed": return "Failed"
        case "importing": return "Importing"
        default: return status.capitalized
        }
    }

    private func statusTint(_ status: String) -> Color {
        switch status {
        case "running": return .blue
        case "ready": return CompanionTheme.accent
        case "failed": return .red
        case "importing": return .orange
        default: return CompanionTheme.textSecondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Parallel")
                .font(.caption.weight(.semibold))
                .foregroundStyle(CompanionTheme.textSecondary)
            ForEach(viewModel.parallelJobs) { job in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Text(statusLabel(job.status))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(statusTint(job.status))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(statusTint(job.status).opacity(0.12), in: Capsule())
                        Text(previewText(job.prompt, maxLength: 160))
                            .font(.footnote)
                            .foregroundStyle(CompanionTheme.textPrimary)
                        Spacer()
                    }
                    if let preview = job.resultPreview?.nilIfBlank {
                        Text(preview)
                            .font(.caption)
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }
                    if let error = job.error?.nilIfBlank {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    HStack(spacing: 14) {
                        if job.status == "ready" || job.status == "failed" {
                            Button("Import") { viewModel.manageParallelJob(job.id, action: "importNow") }
                                .font(.caption.weight(.semibold))
                        }
                        if job.status == "running" {
                            Button("Cancel") { viewModel.manageParallelJob(job.id, action: "cancel") }
                                .font(.caption.weight(.semibold))
                        } else if job.status != "importing" {
                            Button("Skip") { viewModel.manageParallelJob(job.id, action: "skip") }
                                .font(.caption.weight(.semibold))
                        }
                        Button("Open") { onOpenConversation(job.childConversationId) }
                            .font(.caption.weight(.semibold))
                    }
                }
                .padding(12)
                .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                }
            }
        }
    }
}

private typealias AskUserQuestionAnswers = [String: [String]]

private struct AskUserQuestionOption: Identifiable {
    let value: String
    let label: String
    let details: String?
    var id: String { value }
}

private struct AskUserQuestionPrompt: Identifiable {
    let id: String
    let label: String
    let details: String?
    let style: String
    let options: [AskUserQuestionOption]
}

private struct AskUserQuestionPresentation {
    let details: String?
    let questions: [AskUserQuestionPrompt]
}

private struct AskUserQuestionCard: View {
    let block: DisplayBlock
    let presentation: AskUserQuestionPresentation
    let onSubmit: (String) -> Void

    @State private var answers: AskUserQuestionAnswers = [:]

    private var canSubmit: Bool {
        presentation.questions.allSatisfy { !(answers[$0.id] ?? []).isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let details = presentation.details?.nilIfBlank {
                Text(details)
                    .font(.footnote)
                    .foregroundStyle(CompanionTheme.textSecondary)
            }
            ForEach(presentation.questions) { question in
                VStack(alignment: .leading, spacing: 8) {
                    Text(question.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(CompanionTheme.textPrimary)
                    if let details = question.details?.nilIfBlank {
                        Text(details)
                            .font(.caption)
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }
                    ForEach(question.options) { option in
                        Button {
                            toggle(option: option.value, for: question)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: isSelected(option.value, for: question)
                                    ? (question.style == "check" ? "checkmark.square.fill" : "largecircle.fill.circle")
                                    : (question.style == "check" ? "square" : "circle"))
                                    .foregroundStyle(CompanionTheme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(option.label)
                                        .foregroundStyle(CompanionTheme.textPrimary)
                                    if let details = option.details?.nilIfBlank {
                                        Text(details)
                                            .font(.caption)
                                            .foregroundStyle(CompanionTheme.textSecondary)
                                    }
                                }
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Button("Submit") {
                onSubmit(buildAskUserQuestionReplyText(presentation: presentation, answers: answers))
            }
            .disabled(!canSubmit)
        }
        .padding(.vertical, 4)
    }

    private func isSelected(_ value: String, for question: AskUserQuestionPrompt) -> Bool {
        answers[question.id]?.contains(value) == true
    }

    private func toggle(option value: String, for question: AskUserQuestionPrompt) {
        if question.style == "check" {
            var selected = answers[question.id] ?? []
            if selected.contains(value) {
                selected.removeAll { $0 == value }
            } else {
                selected.append(value)
            }
            answers[question.id] = selected
        } else {
            answers[question.id] = [value]
        }
    }
}

private func readAskUserQuestionPresentation(_ block: DisplayBlock) -> AskUserQuestionPresentation? {
    guard block.tool == "ask_user_question" else {
        return nil
    }
    if let details = normalizeAskUserQuestionPresentation(from: block.details) {
        return details
    }
    return normalizeAskUserQuestionPresentation(from: block.input)
}

private func normalizeAskUserQuestionPresentation(from value: JSONValue?) -> AskUserQuestionPresentation? {
    guard let object = value?.objectValue else {
        return nil
    }
    if let questionsValue = object["questions"]?.arrayValue {
        let details = object["details"]?.stringValue
        let questions = questionsValue.enumerated().compactMap { index, entry -> AskUserQuestionPrompt? in
            guard let questionObject = entry.objectValue else { return nil }
            let label = questionObject["label"]?.stringValue ?? questionObject["question"]?.stringValue
            guard let label, let options = questionObject["options"]?.arrayValue else { return nil }
            let normalizedOptions = options.compactMap { option -> AskUserQuestionOption? in
                if let string = option.stringValue?.nilIfBlank {
                    return AskUserQuestionOption(value: string, label: string, details: nil)
                }
                guard let optionObject = option.objectValue else { return nil }
                let value = optionObject["value"]?.stringValue ?? optionObject["label"]?.stringValue
                guard let value else { return nil }
                return AskUserQuestionOption(
                    value: value,
                    label: optionObject["label"]?.stringValue ?? value,
                    details: optionObject["details"]?.stringValue ?? optionObject["description"]?.stringValue
                )
            }
            guard !normalizedOptions.isEmpty else { return nil }
            return AskUserQuestionPrompt(
                id: questionObject["id"]?.stringValue ?? "question-\(index + 1)",
                label: label,
                details: questionObject["details"]?.stringValue ?? questionObject["description"]?.stringValue,
                style: questionObject["style"]?.stringValue == "check" || questionObject["style"]?.stringValue == "checkbox" ? "check" : "radio",
                options: normalizedOptions
            )
        }
        return questions.isEmpty ? nil : AskUserQuestionPresentation(details: details, questions: questions)
    }
    if let question = object["question"]?.stringValue ?? object["label"]?.stringValue,
       let options = object["options"]?.arrayValue {
        let normalizedOptions = options.compactMap { option -> AskUserQuestionOption? in
            if let string = option.stringValue?.nilIfBlank {
                return AskUserQuestionOption(value: string, label: string, details: nil)
            }
            guard let optionObject = option.objectValue else { return nil }
            let value = optionObject["value"]?.stringValue ?? optionObject["label"]?.stringValue
            guard let value else { return nil }
            return AskUserQuestionOption(value: value, label: optionObject["label"]?.stringValue ?? value, details: optionObject["details"]?.stringValue)
        }
        return normalizedOptions.isEmpty ? nil : AskUserQuestionPresentation(
            details: object["details"]?.stringValue,
            questions: [AskUserQuestionPrompt(id: "question-1", label: question, details: object["details"]?.stringValue, style: "radio", options: normalizedOptions)]
        )
    }
    return nil
}

private func buildAskUserQuestionReplyText(presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) -> String {
    let entries = presentation.questions.compactMap { question -> String? in
        let selectedValues = answers[question.id] ?? []
        guard !selectedValues.isEmpty else { return nil }
        let labels = question.options.filter { selectedValues.contains($0.value) }.map(\.label)
        if presentation.questions.count == 1 && question.style == "radio" && labels.count == 1 {
            return labels[0]
        }
        return "\(question.label): \(labels.joined(separator: ", "))"
    }
    if entries.count == 1 {
        return entries[0]
    }
    return (["Answers:"] + entries.map { "- \($0)" }).joined(separator: "\n")
}

private extension JSONValue {
    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else {
            return nil
        }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else {
            return nil
        }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else {
            return nil
        }
        return value
    }
}

func renderTranscriptMarkdown(_ text: String) -> AttributedString? {
    try? AttributedString(
        markdown: text,
        options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
    )
}

private struct MarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        if let attributed = renderTranscriptMarkdown(text) {
            Text(attributed)
        } else {
            Text(verbatim: text)
        }
    }
}

private struct TranscriptImageView: View {
    let src: String?
    let viewModel: ConversationViewModel?

    @State private var data: Data?

    var body: some View {
        Group {
            if let data, let image = UIImage(data: data) {
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
        .task(id: src) {
            data = await viewModel?.loadTranscriptImageData(src: src) ?? dataURLData(src)
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

private struct EmptyConversationState: View {
    let meta: SessionMeta?
    let canStartSimulation: Bool
    let startSimulation: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "message")
                .font(.system(size: 52, weight: .regular))
                .foregroundStyle(CompanionTheme.textDim)
            Text("No transcript yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(CompanionTheme.textPrimary)
            Text(canStartSimulation ? "Send a prompt or start a simulated running turn to test queued prompt behavior." : "Send a prompt to start this conversation.")
                .font(.body)
                .foregroundStyle(CompanionTheme.textSecondary)
                .multilineTextAlignment(.center)
            if canStartSimulation {
                Button {
                    startSimulation()
                } label: {
                    Label("Start simulated run", systemImage: "bolt.horizontal.circle")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(CompanionTheme.accent, in: Capsule())
                        .foregroundStyle(.white)
                }
                .padding(.top, 6)
            }
            if let meta {
                VStack(spacing: 4) {
                    Text(meta.model)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(CompanionTheme.textSecondary)
                    Text(meta.cwd)
                        .font(.caption)
                        .foregroundStyle(CompanionTheme.textDim)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 88)
        .padding(.horizontal, 20)
    }
}


private struct ConversationCwdEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var cwd: String
    let workspacePaths: [String]
    let executionTargetId: String
    let browseDirectory: (String, String?) async -> CompanionRemoteDirectoryListing?
    let onSave: () async -> Void

    @State private var browserPath: String?
    @State private var showingDirectoryBrowser = false

    var body: some View {
        NavigationStack {
            Form {
                if !workspacePaths.isEmpty {
                    Section("Suggested") {
                        ForEach(workspacePaths, id: \.self) { path in
                            Button(path) {
                                cwd = path
                            }
                            .foregroundStyle(cwd == path ? CompanionTheme.accent : CompanionTheme.textPrimary)
                        }
                    }
                }

                Section("Working directory") {
                    TextField("Working directory", text: $cwd)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button(executionTargetId == "local" ? "Browse directories" : "Browse remote directories") {
                        browserPath = cwd.trimmed.nilIfBlank
                        showingDirectoryBrowser = true
                    }
                }
            }
            .navigationTitle("Change cwd")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave()
                            dismiss()
                        }
                    }
                    .disabled(cwd.trimmed.isEmpty)
                }
            }
            .sheet(isPresented: $showingDirectoryBrowser) {
                RemoteDirectoryBrowserView(
                    targetId: executionTargetId,
                    initialPath: browserPath,
                    browse: browseDirectory,
                    onSelect: { selectedPath in
                        cwd = selectedPath
                        showingDirectoryBrowser = false
                    }
                )
            }
        }
    }
}

private struct RemoteDirectoryBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    let targetId: String
    let initialPath: String?
    let browse: (String, String?) async -> CompanionRemoteDirectoryListing?
    let onSelect: (String) -> Void

    @State private var listing: CompanionRemoteDirectoryListing?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            List {
                if let listing {
                    Section {
                        Button("Use \(listing.path)") {
                            onSelect(listing.path)
                        }
                    }
                    if let parent = listing.parent?.nilIfBlank {
                        Section {
                            Button("..") {
                                Task { await load(path: parent) }
                            }
                        }
                    }
                    Section(listing.path) {
                        ForEach(listing.entries.filter({ $0.isDir })) { entry in
                            Button(entry.name) {
                                Task { await load(path: entry.path) }
                            }
                        }
                    }
                } else if loading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Remote directories")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await load(path: initialPath)
            }
        }
    }

    private func load(path: String?) async {
        loading = true
        listing = await browse(targetId, path)
        loading = false
    }
}

private struct ConversationModelPreferencesView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    @State private var model = ""
    @State private var thinkingLevel = ""
    @State private var fastModeEnabled = false
    @State private var autoModeEnabled = false
    @State private var isLoading = false

    private var modelOptions: [CompanionPickerOption] {
        if let models = viewModel.modelState?.models, !models.isEmpty {
            var options = models.map { CompanionPickerOption(value: $0.id, label: $0.name) }
            if let current = model.nilIfBlank, !options.contains(where: { $0.value == current }) {
                options.append(CompanionPickerOption(value: current, label: current))
            }
            return options
        }
        return companionModelOptions(current: model)
    }

    private var thinkingLevelOptions: [CompanionPickerOption] {
        companionThinkingLevelOptions(current: thinkingLevel)
    }

    private var selectedModel: CompanionModelInfo? {
        viewModel.modelState?.models.first(where: { $0.id == model })
    }

    private var supportsFastMode: Bool {
        companionSelectableServiceTierOptions(for: selectedModel).contains(where: { $0.value == "priority" })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Preferences") {
                    Picker("Model", selection: $model) {
                        ForEach(modelOptions) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Thinking level", selection: $thinkingLevel) {
                        ForEach(thinkingLevelOptions) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)

                    if supportsFastMode {
                        Toggle("Fast mode", isOn: $fastModeEnabled)
                    }

                    Toggle("Auto mode", isOn: $autoModeEnabled)
                        .tint(.orange)
                }
            }
            .navigationTitle("Model preferences")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isLoading ? "Saving…" : "Save") {
                        Task {
                            isLoading = true
                            let savedPreferences = await viewModel.saveModelPreferences(
                                model: model,
                                thinkingLevel: thinkingLevel,
                                serviceTier: fastModeEnabled ? "priority" : ""
                            )
                            let savedAutoMode = await viewModel.saveAutoMode(enabled: autoModeEnabled)
                            isLoading = false
                            if savedPreferences != nil && savedAutoMode != nil {
                                dismiss()
                            }
                        }
                    }
                }
            }
            .task {
                async let preferencesTask = viewModel.loadModelPreferences()
                async let autoModeTask = viewModel.loadAutoModeState()

                if let state = await preferencesTask {
                    model = state.currentModel
                    thinkingLevel = state.currentThinkingLevel
                    fastModeEnabled = companionFastModeEnabled(serviceTier: state.currentServiceTier)
                }
                if let autoModeState = await autoModeTask {
                    autoModeEnabled = autoModeState.enabled
                }
            }
        }
    }
}

private struct ArtifactBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    @State private var artifacts: [ConversationArtifactSummary] = []
    @State private var selectedArtifact: ConversationArtifactRecord?

    var body: some View {
        NavigationStack {
            List {
                if artifacts.isEmpty {
                    ContentUnavailableView("No artifacts", systemImage: "doc.richtext", description: Text("Rendered conversation artifacts appear here."))
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(artifacts) { artifact in
                        Button {
                            Task {
                                selectedArtifact = await viewModel.readArtifact(artifact.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(artifact.title)
                                    .font(.headline)
                                Text(artifact.kind)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Artifacts")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                artifacts = await viewModel.listArtifacts()
            }
            .sheet(item: $selectedArtifact) { artifact in
                ArtifactDetailView(artifact: artifact)
            }
        }
    }
}

private struct ArtifactDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let artifact: ConversationArtifactRecord

    var body: some View {
        NavigationStack {
            Group {
                if artifact.kind == "html" {
                    HTMLArtifactView(html: artifact.content)
                } else {
                    ScrollView {
                        Text(artifact.content)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                }
            }
            .navigationTitle(artifact.title)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct HTMLArtifactView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        uiView.loadHTMLString(html, baseURL: nil)
    }
}

private struct CheckpointBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    @State private var checkpoints: [ConversationCommitCheckpointSummary] = []
    @State private var selectedCheckpoint: ConversationCommitCheckpointRecord?
    @State private var showingCreateCheckpoint = false

    var body: some View {
        NavigationStack {
            List {
                if checkpoints.isEmpty {
                    ContentUnavailableView("No checkpoints", systemImage: "point.topleft.down.curvedto.point.bottomright.up", description: Text("Commit checkpoints from the conversation appear here."))
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(checkpoints) { checkpoint in
                        Button {
                            Task {
                                selectedCheckpoint = await viewModel.readCheckpoint(checkpoint.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(checkpoint.title)
                                    .font(.headline)
                                Text("\(checkpoint.shortSha) · \(checkpoint.fileCount) files")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Checkpoints")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingCreateCheckpoint = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                checkpoints = await viewModel.listCheckpoints()
            }
            .sheet(item: $selectedCheckpoint) { checkpoint in
                CheckpointDetailView(checkpoint: checkpoint)
            }
            .sheet(isPresented: $showingCreateCheckpoint) {
                CheckpointCreateView(viewModel: viewModel) { created in
                    if let created {
                        selectedCheckpoint = created
                        checkpoints = await viewModel.listCheckpoints()
                    }
                }
            }
        }
    }
}

private struct CheckpointCreateView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    let onSaved: (ConversationCommitCheckpointRecord?) async -> Void

    @State private var message = ""
    @State private var pathsText = "."
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Checkpoint") {
                    TextField("Commit message", text: $message)
                    TextField("Paths", text: $pathsText, axis: .vertical)
                        .lineLimit(3...8)
                    Text("Enter one path per line. Use . for the whole current repo.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("New checkpoint")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task {
                            isSaving = true
                            let paths = pathsText
                                .split(whereSeparator: \.isNewline)
                                .map { String($0).trimmed }
                                .filter { !$0.isEmpty }
                            let created = await viewModel.createCheckpoint(message: message.trimmed, paths: paths)
                            isSaving = false
                            await onSaved(created)
                            if created != nil {
                                dismiss()
                            }
                        }
                    }
                    .disabled(message.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct CheckpointDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let checkpoint: ConversationCommitCheckpointRecord

    var body: some View {
        NavigationStack {
            List {
                Section("Commit") {
                    LabeledContent("Title") { Text(checkpoint.title) }
                    LabeledContent("SHA") { Text(checkpoint.shortSha) }
                    LabeledContent("Subject") { Text(checkpoint.subject) }
                    LabeledContent("Files") { Text("\(checkpoint.fileCount)") }
                }
                Section("Files") {
                    ForEach(checkpoint.files) { file in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(file.path)
                                .font(.subheadline.weight(.semibold))
                            Text(file.patch)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 4)
                    }
                }
                if !checkpoint.comments.isEmpty {
                    Section("Comments") {
                        ForEach(checkpoint.comments) { comment in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(comment.authorName)
                                    .font(.subheadline.weight(.semibold))
                                Text(comment.body)
                                    .font(.body)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .navigationTitle(checkpoint.title)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
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
    var showsMetadata = true
    var saveButtonTitle = "Save"
    let onSave: () async -> Void

    @State private var drawing = PKDrawing()
    @State private var backgroundPreviewData: Data?
    @State private var originalSceneObject: [String: Any]?
    @State private var canvasSize = CGSize(width: 1024, height: 768)
    @State private var didLoadInitialState = false
    @State private var isSaving = false

    private var canSave: Bool {
        let hasExistingAttachment = draft.sourceAsset != nil && draft.previewAsset != nil
        return hasExistingAttachment || !drawing.strokes.isEmpty || backgroundPreviewData != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if showsMetadata {
                    Section("Metadata") {
                        TextField("Title", text: $draft.title)
                        TextField("Note", text: $draft.note, axis: .vertical)
                            .lineLimit(3...6)
                    }
                }

                Section("Drawing") {
                    HStack {
                        Text("Canvas")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Clear") {
                            drawing = PKDrawing()
                        }
                        .font(.caption.weight(.semibold))
                        .disabled(drawing.strokes.isEmpty)
                    }

                    ScrollView([.horizontal, .vertical], showsIndicators: true) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 16)
                                .fill(.white)
                            if let backgroundPreviewData, let image = UIImage(data: backgroundPreviewData) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: canvasSize.width, height: canvasSize.height)
                                    .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                            NativeDrawingCanvasView(drawing: $drawing)
                                .frame(width: canvasSize.width, height: canvasSize.height)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .frame(width: canvasSize.width, height: canvasSize.height)
                        .overlay {
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                        }
                    }
                    .frame(height: min(420, max(260, canvasSize.height * 0.35)))

                    if backgroundPreviewData != nil {
                        Text("Existing drawing content is shown as a background layer. Your pen strokes are saved as an editable overlay.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Use Apple Pencil or touch to sketch directly in the attachment editor.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : saveButtonTitle) {
                        Task {
                            isSaving = true
                            if let assets = buildNativeDrawingAttachmentAssets(
                                title: draft.title,
                                drawing: drawing,
                                canvasSize: canvasSize,
                                originalSceneObject: originalSceneObject,
                                backgroundPreviewData: backgroundPreviewData
                            ) {
                                draft.sourceAsset = assets.source
                                draft.previewAsset = assets.preview
                                await onSave()
                            }
                            isSaving = false
                        }
                    }
                    .disabled(isSaving || !canSave)
                }
            }
            .task {
                guard !didLoadInitialState else { return }
                didLoadInitialState = true
                let loaded = loadNativeDrawingEditorState(from: draft)
                drawing = loaded.drawing
                backgroundPreviewData = loaded.backgroundPreviewData
                originalSceneObject = loaded.originalSceneObject
                canvasSize = loaded.canvasSize
            }
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

private final class ConversationComposerTextView: UITextView {
    var onPasteImage: ((Data, String?, String?) -> Void)?
    var onLayoutWidthChange: ((UITextView) -> Void)?
    private var lastLayoutWidth: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()

        let currentWidth = bounds.width
        guard abs(currentWidth - lastLayoutWidth) > 0.5 else {
            return
        }
        lastLayoutWidth = currentWidth
        onLayoutWidthChange?(self)
    }

    override func paste(_ sender: Any?) {
        if let image = UIPasteboard.general.image,
           let data = image.pngData() {
            onPasteImage?(data, "image/png", "clipboard-image.png")
            return
        }
        super.paste(sender)
    }
}

private struct ConversationComposerTextEditor: UIViewRepresentable {
    static let minHeight: CGFloat = 32
    static let maxHeight: CGFloat = 116

    @Binding var text: String
    @Binding var height: CGFloat
    let onPasteImage: (Data, String?, String?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> ConversationComposerTextView {
        let view = ConversationComposerTextView(frame: .zero)
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.autocorrectionType = .default
        view.smartDashesType = .no
        view.smartQuotesType = .no
        view.smartInsertDeleteType = .no
        view.font = .preferredFont(forTextStyle: .body)
        view.textColor = UIColor(CompanionTheme.textPrimary)
        view.tintColor = UIColor(CompanionTheme.accent)
        view.keyboardDismissMode = .interactive
        view.textContainerInset = UIEdgeInsets(top: 5, left: 0, bottom: 5, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.onPasteImage = onPasteImage
        view.onLayoutWidthChange = { [weak coordinator = context.coordinator] textView in
            coordinator?.updateHeight(for: textView)
        }
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        context.coordinator.apply(text: text, to: view)
        context.coordinator.updateHeight(for: view)
        return view
    }

    func updateUIView(_ uiView: ConversationComposerTextView, context: Context) {
        context.coordinator.parent = self
        uiView.onPasteImage = onPasteImage
        uiView.textColor = UIColor(CompanionTheme.textPrimary)
        uiView.tintColor = UIColor(CompanionTheme.accent)
        uiView.onLayoutWidthChange = { [weak coordinator = context.coordinator] textView in
            coordinator?.updateHeight(for: textView)
        }
        if !context.coordinator.isApplyingProgrammaticChange, uiView.text != text {
            context.coordinator.apply(text: text, to: uiView)
        }
        context.coordinator.updateHeight(for: uiView)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ConversationComposerTextEditor
        var isApplyingProgrammaticChange = false

        init(parent: ConversationComposerTextEditor) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            guard !isApplyingProgrammaticChange else {
                return
            }
            parent.text = textView.text
            updateHeight(for: textView)
            DispatchQueue.main.async { [weak self, weak textView] in
                guard let self, let textView else {
                    return
                }
                self.updateHeight(for: textView)
            }
        }

        func apply(text: String, to textView: UITextView) {
            guard textView.text != text else {
                return
            }
            isApplyingProgrammaticChange = true
            textView.text = text
            isApplyingProgrammaticChange = false
        }

        func updateHeight(for textView: UITextView) {
            let measuredWidth = textView.bounds.width > 1 ? textView.bounds.width : UIScreen.main.bounds.width - 120
            let targetWidth = max(1, measuredWidth)
            let measuredHeight = ceil(textView.sizeThatFits(CGSize(width: targetWidth, height: .greatestFiniteMagnitude)).height)
            let clampedHeight = min(ConversationComposerTextEditor.maxHeight, max(ConversationComposerTextEditor.minHeight, measuredHeight))
            textView.isScrollEnabled = measuredHeight > ConversationComposerTextEditor.maxHeight
            DispatchQueue.main.async { [weak self] in
                guard let self, abs(self.parent.height - clampedHeight) > 0.5 else {
                    return
                }
                self.parent.height = clampedHeight
            }
        }
    }
}

private extension PromptImageDraft {
    static func fromImportedData(data: Data, mimeType: String?, fileName: String?) -> PromptImageDraft? {
        let resolvedName = fileName?.nilIfBlank ?? "Image"
        let resolvedMimeType = mimeType?.nilIfBlank
            ?? UTType(filenameExtension: URL(fileURLWithPath: resolvedName).pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        return PromptImageDraft(name: resolvedName, mimeType: resolvedMimeType, base64Data: data.base64EncodedString(), previewData: data)
    }

    static func fromPhotosItem(_ item: PhotosPickerItem) async throws -> PromptImageDraft? {
        let data = try await item.loadTransferable(type: Data.self)
        guard let data else {
            return nil
        }
        return fromImportedData(
            data: data,
            mimeType: item.supportedContentTypes.first?.preferredMIMEType,
            fileName: item.itemIdentifier ?? "Image"
        )
    }

    static func fromImageFile(url: URL) async throws -> PromptImageDraft? {
        let granted = url.startAccessingSecurityScopedResource()
        defer {
            if granted { url.stopAccessingSecurityScopedResource() }
        }
        let data = try Data(contentsOf: url)
        return fromImportedData(
            data: data,
            mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType,
            fileName: url.lastPathComponent
        )
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

private let nativeDrawingMetadataKey = "personalAgentNativeDrawingV1"
private let nativeDrawingOverlayGroupId = "pa-native-drawing-overlay"
private let defaultNativeCanvasSize = CGSize(width: 1024, height: 768)

private struct NativeDrawingMetadata: Codable {
    let version: Int
    let drawingData: String
    let backgroundPreviewData: String?
    let canvasWidth: Double?
    let canvasHeight: Double?
}

private struct NativeDrawingEditorState {
    let drawing: PKDrawing
    let backgroundPreviewData: Data?
    let originalSceneObject: [String: Any]?
    let canvasSize: CGSize
}

private struct NativeDrawingCanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing

    func makeCoordinator() -> Coordinator {
        Coordinator(drawing: $drawing)
    }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvasView = PKCanvasView()
        canvasView.delegate = context.coordinator
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .anyInput
        canvasView.alwaysBounceVertical = false
        canvasView.alwaysBounceHorizontal = false
        canvasView.showsVerticalScrollIndicator = false
        canvasView.showsHorizontalScrollIndicator = false
        canvasView.drawing = drawing
        canvasView.tool = PKInkingTool(.pen, color: .label, width: 4)
        context.coordinator.installToolPicker(for: canvasView)
        return canvasView
    }

    func updateUIView(_ uiView: PKCanvasView, context: Context) {
        if uiView.drawing != drawing {
            uiView.drawing = drawing
        }
        context.coordinator.installToolPicker(for: uiView)
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        @Binding private var drawing: PKDrawing
        private let toolPicker = PKToolPicker()

        init(drawing: Binding<PKDrawing>) {
            _drawing = drawing
        }

        func installToolPicker(for canvasView: PKCanvasView) {
            toolPicker.addObserver(canvasView)
            toolPicker.setVisible(true, forFirstResponder: canvasView)
            canvasView.becomeFirstResponder()
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            drawing = canvasView.drawing
        }
    }
}

private func loadNativeDrawingEditorState(from draft: AttachmentEditorDraft) -> NativeDrawingEditorState {
    let sourceObject = draft.sourceAsset.flatMap { try? JSONSerialization.jsonObject(with: $0.rawData, options: [.fragmentsAllowed]) as? [String: Any] }
    var drawing = PKDrawing()
    var backgroundPreviewData = draft.previewAsset?.rawData
    var canvasSize = defaultNativeCanvasSize

    if let sourceObject,
       let rawMetadata = sourceObject[nativeDrawingMetadataKey],
       let metadata = try? decodeModel(NativeDrawingMetadata.self, from: rawMetadata),
       let drawingData = Data(base64Encoded: metadata.drawingData),
       let loadedDrawing = try? PKDrawing(data: drawingData) {
        drawing = loadedDrawing
        if let backgroundBase64 = metadata.backgroundPreviewData, let decoded = Data(base64Encoded: backgroundBase64) {
            backgroundPreviewData = decoded
        }
        if let width = metadata.canvasWidth, let height = metadata.canvasHeight, width > 0, height > 0 {
            canvasSize = CGSize(width: width, height: height)
        }
    } else if let previewData = backgroundPreviewData, let image = UIImage(data: previewData) {
        canvasSize = image.size
    }

    return NativeDrawingEditorState(
        drawing: drawing,
        backgroundPreviewData: backgroundPreviewData,
        originalSceneObject: sourceObject,
        canvasSize: normalizedCanvasSize(canvasSize)
    )
}

private func normalizedCanvasSize(_ size: CGSize) -> CGSize {
    let width = max(640, size.width.isFinite ? size.width : defaultNativeCanvasSize.width)
    let height = max(480, size.height.isFinite ? size.height : defaultNativeCanvasSize.height)
    return CGSize(width: width, height: height)
}

private func buildNativeDrawingAttachmentAssets(
    title: String,
    drawing: PKDrawing,
    canvasSize: CGSize,
    originalSceneObject: [String: Any]?,
    backgroundPreviewData: Data?
) -> (source: AttachmentDraftAsset, preview: AttachmentDraftAsset)? {
    let normalizedTitle = title.trimmed.nilIfBlank ?? "Drawing"
    let fileNames = buildDrawingFileNames(normalizedTitle)
    let effectiveCanvasSize = normalizedCanvasSize(canvasSize)

    let previewData = renderNativeDrawingPreview(
        drawing: drawing,
        canvasSize: effectiveCanvasSize,
        backgroundPreviewData: backgroundPreviewData
    )
    guard let previewData else {
        return nil
    }

    var sceneObject = originalSceneObject ?? [
        "type": "excalidraw",
        "version": 2,
        "source": "personal-agent-ios",
        "elements": [],
        "appState": ["viewBackgroundColor": "#ffffff"],
        "files": [:],
    ]

    let existingElements = ((sceneObject["elements"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.filter { element in
        let groupIds = element["groupIds"] as? [String] ?? []
        return !groupIds.contains(nativeDrawingOverlayGroupId)
    }
    sceneObject["elements"] = existingElements + buildNativeDrawingOverlayElements(from: drawing)

    let metadata = NativeDrawingMetadata(
        version: 1,
        drawingData: drawing.dataRepresentation().base64EncodedString(),
        backgroundPreviewData: backgroundPreviewData?.base64EncodedString(),
        canvasWidth: effectiveCanvasSize.width,
        canvasHeight: effectiveCanvasSize.height
    )
    guard let metadataData = try? JSONEncoder().encode(metadata),
          let metadataObject = try? JSONSerialization.jsonObject(with: metadataData) else {
        return nil
    }
    sceneObject[nativeDrawingMetadataKey] = metadataObject

    guard let sourceData = try? jsonObjectData(sceneObject) else {
        return nil
    }

    return (
        source: AttachmentDraftAsset(
            fileName: fileNames.sourceName,
            mimeType: "application/vnd.excalidraw+json",
            base64Data: sourceData.base64EncodedString(),
            rawData: sourceData
        ),
        preview: AttachmentDraftAsset(
            fileName: fileNames.previewName,
            mimeType: "image/png",
            base64Data: previewData.base64EncodedString(),
            rawData: previewData
        )
    )
}

private func buildDrawingFileNames(_ title: String) -> (sourceName: String, previewName: String) {
    let normalized = title
        .trimmed
        .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        .replacingOccurrences(of: "[^a-zA-Z0-9._-]+", with: "-", options: .regularExpression)
        .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    let base = normalized.nilIfBlank ?? "drawing"
    return ("\(base).excalidraw", "\(base).png")
}

private func renderNativeDrawingPreview(drawing: PKDrawing, canvasSize: CGSize, backgroundPreviewData: Data?) -> Data? {
    let effectiveCanvasSize = normalizedCanvasSize(canvasSize)
    let backgroundImage = backgroundPreviewData.flatMap(UIImage.init(data:))
    let renderer = UIGraphicsImageRenderer(size: effectiveCanvasSize)
    let image = renderer.image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: effectiveCanvasSize))
        backgroundImage?.draw(in: CGRect(origin: .zero, size: effectiveCanvasSize))
        drawing.image(from: CGRect(origin: .zero, size: effectiveCanvasSize), scale: 1).draw(in: CGRect(origin: .zero, size: effectiveCanvasSize))
    }
    return image.pngData()
}

private func buildNativeDrawingOverlayElements(from drawing: PKDrawing) -> [[String: Any]] {
    drawing.strokes.compactMap { stroke in
        let sampledPoints = Array(stroke.path).map(\.location)
        guard sampledPoints.count >= 2 else {
            return nil
        }

        let minX = sampledPoints.map(\.x).min() ?? 0
        let minY = sampledPoints.map(\.y).min() ?? 0
        let maxX = sampledPoints.map(\.x).max() ?? minX
        let maxY = sampledPoints.map(\.y).max() ?? minY
        let relativePoints = sampledPoints.map { point in
            [point.x - minX, point.y - minY]
        }
        let strokeWidth = max(1, sampledPoints.count > 0 ? stroke.path.first?.size.width ?? 3 : 3)

        return [
            "id": UUID().uuidString.lowercased(),
            "type": "freedraw",
            "x": minX,
            "y": minY,
            "width": maxX - minX,
            "height": maxY - minY,
            "angle": 0,
            "strokeColor": hexString(for: stroke.ink.color),
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": strokeWidth,
            "strokeStyle": "solid",
            "roughness": 0,
            "opacity": 100,
            "groupIds": [nativeDrawingOverlayGroupId],
            "frameId": NSNull(),
            "roundness": NSNull(),
            "seed": Int.random(in: 1...Int.max / 2),
            "version": 1,
            "versionNonce": Int.random(in: 1...Int.max / 2),
            "isDeleted": false,
            "boundElements": NSNull(),
            "updated": Int(Date().timeIntervalSince1970 * 1000),
            "link": NSNull(),
            "locked": false,
            "points": relativePoints,
            "pressures": Array(repeating: 0.5, count: relativePoints.count),
            "simulatePressure": true,
            "lastCommittedPoint": relativePoints.last ?? [0, 0],
        ]
    }
}

private func hexString(for color: UIColor) -> String {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    return String(format: "#%02X%02X%02X", Int(red * 255), Int(green * 255), Int(blue * 255))
}

// MARK: - Fork / Branch

private struct ForkBranchBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    let onOpenConversation: (String) -> Void

    @State private var forkEntries: [CompanionForkEntry] = []
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                } else if forkEntries.isEmpty {
                    ContentUnavailableView(
                        "No fork points",
                        systemImage: "arrow.triangle.branch",
                        description: Text("Send a message first, then return here to fork or branch.")
                    )
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } else {
                    Section("Fork from a message") {
                        ForEach(forkEntries) { entry in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(entry.text)
                                    .lineLimit(3)
                                    .font(.body)

                                HStack(spacing: 12) {
                                    Button {
                                        Task {
                                            if let nextId = await viewModel.forkConversation(entryId: entry.entryId) {
                                                dismiss()
                                                onOpenConversation(nextId)
                                            }
                                        }
                                    } label: {
                                        Label("Fork", systemImage: "arrow.branch")
                                            .font(.subheadline.weight(.medium))
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(CompanionTheme.accent)

                                    Button {
                                        Task {
                                            if let nextId = await viewModel.forkConversation(entryId: entry.entryId, beforeEntry: true) {
                                                dismiss()
                                                onOpenConversation(nextId)
                                            }
                                        }
                                    } label: {
                                        Label("Fork before", systemImage: "arrow.up.to.line")
                                            .font(.subheadline.weight(.medium))
                                    }
                                    .buttonStyle(.bordered)

                                    Button {
                                        Task {
                                            if let nextId = await viewModel.branchConversation(entryId: entry.entryId) {
                                                dismiss()
                                                onOpenConversation(nextId)
                                            }
                                        }
                                    } label: {
                                        Label("Branch here", systemImage: "arrow.turn.down.right")
                                            .font(.subheadline.weight(.medium))
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .navigationTitle("Fork / Branch")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await load()
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        forkEntries = await viewModel.listForkEntries()
    }
}
