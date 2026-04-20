import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import WebKit

struct ConversationScreen: View {
    @ObservedObject var viewModel: ConversationViewModel
    var onOpenConversation: (String) -> Void = { _ in }

    @State private var showingAttachments = false
    @State private var showingRename = false
    @State private var renameText = ""
    @State private var importedPhotoItems: [PhotosPickerItem] = []
    @State private var showingImageFileImporter = false
    @State private var showingCwdEditor = false
    @State private var cwdText = ""
    @State private var showingModelPreferences = false
    @State private var showingArtifacts = false
    @State private var showingCheckpoints = false

    private var currentExecutionTargetLabel: String {
        viewModel.executionTargets.first(where: { $0.id == viewModel.currentExecutionTargetId })?.label ?? "Local"
    }

    private var transcriptItems: [TranscriptRenderItem] {
        buildTranscriptRenderItems(viewModel.blocks)
    }

    private var composerHasContent: Bool {
        viewModel.promptText.trimmed.nilIfBlank != nil || !viewModel.promptImages.isEmpty || !viewModel.promptAttachmentRefs.isEmpty
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if viewModel.blocks.isEmpty && !viewModel.isLoading {
                        EmptyConversationState(meta: viewModel.sessionMeta)
                    }

                    ForEach(transcriptItems) { item in
                        switch item {
                        case .message(let block):
                            ConversationBlockView(block: block)
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
                    Menu {
                        if let meta = viewModel.sessionMeta {
                            Section("Current session") {
                                SessionMenuSummaryRow(label: "Model", value: meta.model)
                                SessionMenuSummaryRow(label: "Working directory", value: meta.cwd)
                            }
                        }

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
            .sheet(isPresented: $showingRename) {
                RenameConversationView(title: $renameText) {
                    viewModel.renameConversation(renameText)
                    showingRename = false
                }
            }
            .sheet(isPresented: $showingCwdEditor) {
                ConversationCwdEditorView(cwd: $cwdText) {
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
            .onChange(of: importedPhotoItems) { _, newItems in
                Task {
                    await importPromptPhotos(newItems)
                }
            }
            .onAppear {
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
                HStack(alignment: .bottom, spacing: 10) {
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
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundStyle(CompanionTheme.accent)
                            .frame(width: 28, height: 28)
                    }

                    TextField("Message", text: $viewModel.promptText, axis: .vertical)
                        .lineLimit(1...6)
                        .foregroundStyle(CompanionTheme.textPrimary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                }

                composerActions
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

    @ViewBuilder
    private var composerActions: some View {
        if viewModel.isStreaming {
            HStack(spacing: 10) {
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
                .frame(width: 42, height: 42)
                .background(.red.opacity(0.9), in: Circle())
                .foregroundStyle(.white)
        }
    }

    private func promptSendButton(defaultMode: ConversationPromptSubmissionMode, showStreamingOptions: Bool) -> some View {
        Button {
            viewModel.sendPrompt(mode: defaultMode)
        } label: {
            Image(systemName: defaultMode.systemImage)
                .font(.headline.weight(.bold))
                .frame(width: 42, height: 42)
                .background(composerHasContent ? CompanionTheme.accent : CompanionTheme.panelBorder, in: Circle())
                .foregroundStyle(.white)
        }
        .disabled(!composerHasContent)
        .contextMenu {
            if showStreamingOptions {
                queuedPromptActions
            }
        }
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
    case "thinking", "tool_use":
        return true
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

private extension JSONValue {
    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else {
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

private struct EmptyConversationState: View {
    let meta: SessionMeta?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "message")
                .font(.system(size: 52, weight: .regular))
                .foregroundStyle(CompanionTheme.textDim)
            Text("No transcript yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(CompanionTheme.textPrimary)
            Text("Send a prompt to start this conversation.")
                .font(.body)
                .foregroundStyle(CompanionTheme.textSecondary)
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

private struct SessionMenuSummaryRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(CompanionTheme.textDim)
            Text(value)
                .font(.footnote)
                .foregroundStyle(CompanionTheme.textPrimary)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }
}

private struct ConversationCwdEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var cwd: String
    let onSave: () async -> Void

    var body: some View {
        NavigationStack {
            Form {
                TextField("Working directory", text: $cwd)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
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
        }
    }
}

private struct ConversationModelPreferencesView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: ConversationViewModel
    @State private var model = ""
    @State private var thinkingLevel = ""
    @State private var fastModeEnabled = false
    @State private var isLoading = false

    private var modelOptions: [CompanionPickerOption] {
        companionModelOptions(current: model)
    }

    private var thinkingLevelOptions: [CompanionPickerOption] {
        companionThinkingLevelOptions(current: thinkingLevel)
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

                    Toggle("Fast mode", isOn: $fastModeEnabled)
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
                            _ = await viewModel.saveModelPreferences(
                                model: model,
                                thinkingLevel: thinkingLevel,
                                serviceTier: fastModeEnabled ? "priority" : ""
                            )
                            isLoading = false
                            dismiss()
                        }
                    }
                }
            }
            .task {
                guard let state = await viewModel.loadModelPreferences() else { return }
                model = state.currentModel
                thinkingLevel = state.currentThinkingLevel
                fastModeEnabled = companionFastModeEnabled(serviceTier: state.currentServiceTier)
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
