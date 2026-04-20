import CoreImage.CIFilterBuiltins
import SwiftUI
import VisionKit

struct RootView: View {
    @ObservedObject var appModel: CompanionAppModel

    var body: some View {
        Group {
            if let session = appModel.activeSession {
                HostDashboardView(appModel: appModel, session: session)
            } else {
                HostChooserRootView(appModel: appModel)
            }
        }
        .sheet(isPresented: $appModel.hostSelectionPresented) {
            HostSelectionView(appModel: appModel)
        }
        .alert("Companion", isPresented: Binding(get: {
            appModel.bannerMessage != nil
        }, set: { newValue in
            if !newValue { appModel.bannerMessage = nil }
        })) {
            Button("OK", role: .cancel) {
                appModel.bannerMessage = nil
            }
        } message: {
            Text(appModel.bannerMessage ?? "")
        }
    }
}

private struct HostChooserRootView: View {
    @ObservedObject var appModel: CompanionAppModel
    @State private var editingHost: CompanionHostRecord?
    @State private var showingPairHost = false

    var body: some View {
        NavigationStack {
            List {
                if appModel.hosts.isEmpty {
                    ContentUnavailableView {
                        Label("Pair a host", systemImage: "server.rack")
                    } description: {
                        Text("Choose a Personal Agent host first, then work with chats, automations, and settings for that host.")
                    } actions: {
                        Button("Pair host") {
                            showingPairHost = true
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 36)
                    .listRowBackground(Color.clear)
                } else {
                    Section("Hosts") {
                        ForEach(appModel.hosts, id: \.id) { host in
                            HStack(alignment: .top, spacing: 12) {
                                Button {
                                    Task {
                                        await appModel.selectHost(host.id)
                                    }
                                } label: {
                                    HostSummaryView(host: host, isActive: appModel.activeHostId == host.id)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)

                                Menu {
                                    Button {
                                        editingHost = host
                                    } label: {
                                        Label("Edit", systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        appModel.removeHost(host)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                        .font(.title3)
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                Button {
                                    editingHost = host
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                .tint(.accentColor)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    appModel.removeHost(host)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Hosts")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingPairHost = true
                    } label: {
                        Label("Pair host", systemImage: "plus")
                    }
                }
            }
            .sheet(item: $editingHost) { host in
                HostEditorView(appModel: appModel, host: host)
            }
            .sheet(isPresented: $showingPairHost) {
                PairHostView(appModel: appModel)
            }
        }
    }
}

struct HostDashboardView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel

    var body: some View {
        TabView {
            ConversationListView(appModel: appModel, session: session)
                .tabItem {
                    Label("Chat", systemImage: "message")
                }

            AutomationListView(session: session)
                .tabItem {
                    Label("Automations", systemImage: "clock.arrow.circlepath")
                }

            HostSettingsView(appModel: appModel, session: session)
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(CompanionTheme.accent)
    }
}

struct ConversationListView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    @State private var path: [String] = []
    @State private var showingHostSelection = false
    @State private var isCreatingConversation = false
    @State private var autoOpenedDemoConversation = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                ForEach(session.sections) { section in
                    Section(section.title) {
                        ForEach(section.sessions) { item in
                            NavigationLink(value: item.id) {
                                ConversationRow(session: item)
                            }
                            .listRowBackground(CompanionTheme.panel)
                            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                Button {
                                    Task { await session.togglePinned(item.id) }
                                } label: {
                                    Label(section.id == "pinned" ? "Unpin" : "Pin", systemImage: section.id == "pinned" ? "pin.slash" : "pin")
                                }
                                .tint(.accentColor)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button {
                                    Task { await session.toggleArchived(item.id) }
                                } label: {
                                    Label(section.id == "archived" ? "Restore" : "Archive", systemImage: section.id == "archived" ? "tray.and.arrow.up" : "archivebox")
                                }
                                .tint(.orange)
                            }
                            .contextMenu {
                                Button {
                                    Task { await session.togglePinned(item.id) }
                                } label: {
                                    Label(section.id == "pinned" ? "Unpin" : "Pin", systemImage: section.id == "pinned" ? "pin.slash" : "pin")
                                }
                                Button {
                                    Task { await session.toggleArchived(item.id) }
                                } label: {
                                    Label(section.id == "archived" ? "Restore" : "Archive", systemImage: section.id == "archived" ? "tray.and.arrow.up" : "archivebox")
                                }
                                Button {
                                    Task {
                                        if let duplicated = await session.duplicateConversation(item.id) {
                                            path.append(duplicated)
                                        }
                                    }
                                } label: {
                                    Label("Duplicate", systemImage: "plus.square.on.square")
                                }
                            }
                        }
                    }
                }

                if session.sections.isEmpty && !session.isLoading {
                    Section {
                        ContentUnavailableView(
                            "No conversations",
                            systemImage: "message",
                            description: Text("Create a new conversation on \(session.host.hostLabel).")
                        )
                        .foregroundStyle(CompanionTheme.textSecondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .listStyle(.insetGrouped)
            .navigationTitle("Chat")
            .toolbarBackground(CompanionTheme.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .navigationDestination(for: String.self) { conversationId in
                ConversationScreen(
                    viewModel: session.makeConversationModel(conversationId: conversationId, initialSession: session.sessions[conversationId]),
                    onOpenConversation: { nextId in
                        path.append(nextId)
                        session.refresh()
                    }
                )
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingHostSelection = true
                    } label: {
                        Label("Hosts", systemImage: "server.rack")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        guard !isCreatingConversation else {
                            return
                        }
                        Task {
                            isCreatingConversation = true
                            defer { isCreatingConversation = false }
                            if let id = await session.createConversation(NewConversationRequest()) {
                                path.append(id)
                            }
                        }
                    } label: {
                        if isCreatingConversation {
                            ProgressView()
                        } else {
                            Image(systemName: "square.and.pencil")
                        }
                    }
                    .disabled(isCreatingConversation)
                    .accessibilityLabel("New conversation")
                }
            }
            .overlay(alignment: .bottom) {
                if let message = session.errorMessage {
                    ErrorBanner(message: message)
                        .padding()
                }
            }
            .refreshable {
                session.refresh()
            }
            .sheet(isPresented: $showingHostSelection) {
                HostSelectionView(appModel: appModel)
            }
            .onAppear {
                autoOpenFirstConversationIfNeeded()
            }
            .onChange(of: session.sections) { _, _ in
                autoOpenFirstConversationIfNeeded()
            }
        }
    }

    private func autoOpenFirstConversationIfNeeded() {
        guard !autoOpenedDemoConversation,
              ProcessInfo.processInfo.environment["PA_IOS_AUTO_OPEN_FIRST_MOCK_CONVERSATION"] == "1",
              let firstConversationId = session.sections.first?.sessions.first?.id else {
            return
        }
        autoOpenedDemoConversation = true
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard path.isEmpty else {
                return
            }
            path = [firstConversationId]
        }
    }
}

private struct ConversationRow: View {
    let session: SessionMeta

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(session.title)
                    .font(.headline)
                    .foregroundStyle(CompanionTheme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if session.needsAttention == true {
                    Text(attentionLabel)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.red)
                }
            }
            HStack(spacing: 8) {
                Text(session.cwdSlug)
                Text(session.model)
                if let remoteLabel = session.remoteHostLabel?.nilIfBlank {
                    Text(remoteLabel)
                }
                if let automationTitle = session.automationTitle?.nilIfBlank {
                    Text("Auto: \(automationTitle)")
                }
            }
            .font(.caption)
            .foregroundStyle(CompanionTheme.textSecondary)
            HStack {
                Text(formatRelativeCompanionDate(session.lastActivityAt ?? session.timestamp))
                    .font(.caption)
                    .foregroundStyle(CompanionTheme.textDim)
                Spacer()
                if session.isLive == true {
                    Label("Live", systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption)
                        .foregroundStyle(CompanionTheme.textSecondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var attentionLabel: String {
        let count = max(session.attentionUnreadMessageCount ?? 0, session.attentionUnreadActivityCount ?? 0)
        return count > 0 ? "\(count) new" : "Needs attention"
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.red.opacity(0.92), in: Capsule())
            .shadow(radius: 8, y: 4)
    }
}

struct AutomationListView: View {
    @ObservedObject var session: HostSessionModel
    @State private var path: [String] = []
    @State private var tasks: [ScheduledTaskSummary] = []
    @State private var selectedTask: ScheduledTaskDetail?
    @State private var editingTaskId: String?
    @State private var editorDraft = ScheduledTaskEditorDraft()
    @State private var showingEditor = false
    @State private var isLoading = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if tasks.isEmpty && !isLoading {
                    ContentUnavailableView("No automations", systemImage: "clock.arrow.circlepath", description: Text("Create an automation to match the desktop Automations workspace."))
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(tasks) { task in
                        Button {
                            Task {
                                selectedTask = await session.readTask(task.id)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(task.title)
                                    .font(.headline)
                                Text(task.prompt?.nilIfBlank ?? "No prompt")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                HStack(spacing: 8) {
                                    if let schedule = task.cron ?? task.at {
                                        Text(schedule)
                                    }
                                    Text(task.enabled ? "Enabled" : "Disabled")
                                    if task.running == true {
                                        Text("Running")
                                    }
                                }
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .navigationTitle("Automations")
            .navigationDestination(for: String.self) { conversationId in
                ConversationScreen(
                    viewModel: session.makeConversationModel(conversationId: conversationId, initialSession: session.sessions[conversationId]),
                    onOpenConversation: { nextId in
                        path.append(nextId)
                        session.refresh()
                    }
                )
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editingTaskId = nil
                        editorDraft = ScheduledTaskEditorDraft()
                        showingEditor = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .overlay {
                if isLoading {
                    ProgressView()
                }
            }
            .refreshable {
                await reload()
            }
            .task {
                await reload()
            }
            .sheet(item: $selectedTask) { task in
                AutomationDetailView(session: session, task: task, onEdit: { detail in
                    editingTaskId = detail.id
                    editorDraft = ScheduledTaskEditorDraft(detail: detail)
                    showingEditor = true
                }, onOpenConversation: { conversationId in
                    path.append(conversationId)
                }, onChanged: {
                    await reload()
                })
            }
            .sheet(isPresented: $showingEditor) {
                AutomationEditorView(draft: $editorDraft, session: session, title: editingTaskId == nil ? "New automation" : "Edit automation") {
                    if await session.saveTask(taskId: editingTaskId, draft: editorDraft) != nil {
                        showingEditor = false
                        await reload()
                    }
                }
            }
        }
    }

    private func reload() async {
        isLoading = true
        tasks = await session.listTasks()
        isLoading = false
    }
}

private struct AutomationDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var session: HostSessionModel
    let task: ScheduledTaskDetail
    let onEdit: (ScheduledTaskDetail) -> Void
    let onOpenConversation: (String) -> Void
    let onChanged: () async -> Void

    @State private var log: DurableRunLogResponse?
    @State private var isLoadingLog = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    LabeledContent("Title") { Text(task.title) }
                    if let schedule = task.cron ?? task.at {
                        LabeledContent("Schedule") { Text(schedule) }
                    }
                    if let targetType = task.targetType?.nilIfBlank {
                        LabeledContent("Target") { Text(targetType) }
                    }
                    if let model = task.model?.nilIfBlank {
                        LabeledContent("Model") { Text(model) }
                    }
                    if let cwd = task.cwd?.nilIfBlank {
                        LabeledContent("Cwd") { Text(cwd).multilineTextAlignment(.trailing) }
                    }
                }
                Section("Prompt") {
                    Text(task.prompt ?? "")
                        .font(.body)
                }
                if let log {
                    Section("Last log") {
                        ScrollView(.horizontal) {
                            Text(log.log)
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle(task.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .confirmationAction) {
                    Button("Run") {
                        Task {
                            _ = await session.runTask(task.id)
                            await onChanged()
                        }
                    }
                    Button("Edit") {
                        onEdit(task)
                        dismiss()
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    if let threadConversationId = task.threadConversationId?.nilIfBlank {
                        Button("Open thread") {
                            dismiss()
                            onOpenConversation(threadConversationId)
                        }
                        .buttonStyle(.bordered)
                    }
                    Button(isLoadingLog ? "Loading log…" : "View log") {
                        Task {
                            isLoadingLog = true
                            log = await session.readTaskLog(task.id)
                            isLoadingLog = false
                        }
                    }
                    .buttonStyle(.bordered)
                    Button("Delete", role: .destructive) {
                        Task {
                            if await session.deleteTask(task.id) {
                                await onChanged()
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .padding()
                .background(.ultraThinMaterial)
            }
        }
    }
}

private struct AutomationEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var draft: ScheduledTaskEditorDraft
    @ObservedObject var session: HostSessionModel
    let title: String
    let onSave: () async -> Void

    private var modelOptions: [CompanionPickerOption] {
        companionModelOptions(current: draft.model, defaultLabel: "Host default")
    }

    private var thinkingLevelOptions: [CompanionPickerOption] {
        companionThinkingLevelOptions(current: draft.thinkingLevel, unsetLabel: "Unset")
    }

    private var workingDirectoryOptions: [CompanionPickerOption] {
        var options = [CompanionPickerOption(value: "", label: "Host default")]
        for path in session.workspacePathOptions {
            options.append(CompanionPickerOption(value: path, label: path))
        }
        if let current = draft.cwd.nilIfBlank, !options.contains(where: { $0.value == current }) {
            options.append(CompanionPickerOption(value: current, label: current))
        }
        return options
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Basics") {
                    TextField("Title", text: $draft.title)
                    Toggle("Enabled", isOn: $draft.enabled)
                    Picker("Target", selection: $draft.targetType) {
                        Text("Background job").tag("background-agent")
                        Text("Conversation").tag("conversation")
                    }
                    if draft.targetType == "conversation" {
                        Picker("Thread", selection: $draft.threadMode) {
                            Text("Dedicated").tag("dedicated")
                            Text("Existing").tag("existing")
                            Text("None").tag("none")
                        }
                        if draft.threadMode == "existing" {
                            Picker("Conversation", selection: $draft.threadConversationId) {
                                Text("Select thread").tag("")
                                ForEach(Array(session.sessions.values).sorted { $0.title < $1.title }, id: \.id) { meta in
                                    Text(meta.title).tag(meta.id)
                                }
                            }
                        }
                    }
                }
                Section("Schedule") {
                    Picker("Mode", selection: $draft.scheduleMode) {
                        Text("Cron").tag("cron")
                        Text("At").tag("at")
                    }
                    if draft.scheduleMode == "cron" {
                        TextField("0 9 * * 1-5", text: $draft.cron)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } else {
                        TextField("2026-04-20T09:00:00-04:00", text: $draft.at)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                }
                Section("Prompt") {
                    TextField("Prompt", text: $draft.prompt, axis: .vertical)
                        .lineLimit(4...10)
                }
                Section("Runtime") {
                    Picker("Model", selection: $draft.model) {
                        ForEach(modelOptions) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Thinking level", selection: $draft.thinkingLevel) {
                        ForEach(thinkingLevelOptions) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Working directory", selection: $draft.cwd) {
                        ForEach(workingDirectoryOptions) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave()
                        }
                    }
                    .disabled(draft.prompt.trimmed.isEmpty)
                }
            }
        }
    }
}

struct RunsListView: View {
    @ObservedObject var session: HostSessionModel
    @State private var runs: [DurableRunSummary] = []
    @State private var isLoading = false
    @State private var selectedRun: DurableRunDetailResponse?

    var body: some View {
        NavigationStack {
            List {
                if runs.isEmpty && !isLoading {
                    ContentUnavailableView("No runs", systemImage: "bolt.horizontal.circle", description: Text("Durable background runs show up here."))
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(runs) { run in
                        Button {
                            Task {
                                selectedRun = await session.readRun(run.runId)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(run.manifest?.source?.id ?? run.runId)
                                    .font(.headline)
                                HStack(spacing: 8) {
                                    Text(run.manifest?.kind ?? "run")
                                    Text(run.status?.status ?? "unknown")
                                    Text(formatRelativeCompanionDate(run.status?.updatedAt ?? run.manifest?.createdAt))
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .navigationTitle("Runs")
            .overlay {
                if isLoading {
                    ProgressView()
                }
            }
            .refreshable {
                await reload()
            }
            .task {
                await reload()
            }
            .sheet(item: $selectedRun) { detail in
                RunDetailView(session: session, detail: detail) {
                    await reload()
                }
            }
        }
    }

    private func reload() async {
        isLoading = true
        runs = (await session.listRuns())?.runs ?? []
        isLoading = false
    }
}

private struct RunDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var session: HostSessionModel
    let detail: DurableRunDetailResponse
    let onChanged: () async -> Void

    @State private var log: DurableRunLogResponse?

    var body: some View {
        NavigationStack {
            Form {
                Section("Run") {
                    LabeledContent("Run ID") { Text(detail.run.runId) }
                    LabeledContent("Kind") { Text(detail.run.manifest?.kind ?? "unknown") }
                    LabeledContent("Status") { Text(detail.run.status?.status ?? "unknown") }
                    if let sourceId = detail.run.manifest?.source?.id?.nilIfBlank {
                        LabeledContent("Source") { Text(sourceId) }
                    }
                    if let lastError = detail.run.status?.lastError?.nilIfBlank {
                        LabeledContent("Last error") { Text(lastError) }
                    }
                }
                if let log {
                    Section("Log") {
                        ScrollView(.horizontal) {
                            Text(log.log)
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle(detail.run.runId)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .confirmationAction) {
                    Button("Log") {
                        Task {
                            log = await session.readRunLog(detail.run.runId)
                        }
                    }
                    if detail.run.status?.status == "running" {
                        Button("Cancel", role: .destructive) {
                            Task {
                                _ = await session.cancelRun(detail.run.runId)
                                await onChanged()
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
    }
}

struct HostSettingsView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    @State private var showingHostSelection = false
    @State private var showingPairHost = false
    @State private var deviceState: CompanionDeviceAdminState?
    @State private var setupState: CompanionSetupState?
    @State private var editingDevice: CompanionPairedDeviceSummary?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                Section("Host") {
                    LabeledContent("Label") { Text(session.host.hostLabel) }
                    LabeledContent("URL") { Text(session.host.baseURL) }
                    LabeledContent("This device") { Text(session.host.deviceLabel) }
                    Button("Choose saved host") {
                        showingHostSelection = true
                    }
                    Button("Pair another host") {
                        showingPairHost = true
                    }
                }

                Section("Add another device") {
                    Button("Generate pairing setup") {
                        Task {
                            isLoading = true
                            setupState = await session.createSetupState()
                            isLoading = false
                        }
                    }
                    if let setupState {
                        Text(setupState.pairing.code)
                            .font(.title3.monospaced().weight(.semibold))
                        if let firstLink = setupState.links.first {
                            QRCodeView(text: firstLink.setupUrl)
                                .frame(maxWidth: .infinity)
                                .frame(height: 220)
                            Text(firstLink.baseUrl)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(setupState.warnings, id: \.self) { warning in
                            Text(warning)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                }

                Section("Paired devices") {
                    if let currentDeviceState = deviceState {
                        ForEach(currentDeviceState.devices) { device in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(device.deviceLabel)
                                    Text("Last used \(formatRelativeCompanionDate(device.lastUsedAt))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Menu {
                                    Button("Rename") {
                                        editingDevice = device
                                    }
                                    Button("Revoke", role: .destructive) {
                                        Task {
                                            self.deviceState = await session.deletePairedDevice(device.id)
                                        }
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } else if isLoading {
                        ProgressView()
                    } else {
                        Text("No devices")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .refreshable {
                await reload()
            }
            .task {
                await reload()
            }
            .sheet(isPresented: $showingHostSelection) {
                HostSelectionView(appModel: appModel)
            }
            .sheet(isPresented: $showingPairHost) {
                PairHostView(appModel: appModel)
            }
            .sheet(item: $editingDevice) { device in
                DeviceRenameView(device: device) { nextLabel in
                    deviceState = await session.updatePairedDevice(device.id, label: nextLabel)
                }
            }
        }
    }

    private func reload() async {
        isLoading = true
        deviceState = await session.readDeviceAdminState()
        isLoading = false
    }
}

private struct DeviceRenameView: View {
    @Environment(\.dismiss) private var dismiss
    let device: CompanionPairedDeviceSummary
    let onSave: (String) async -> Void
    @State private var label: String

    init(device: CompanionPairedDeviceSummary, onSave: @escaping (String) async -> Void) {
        self.device = device
        self.onSave = onSave
        _label = State(initialValue: device.deviceLabel)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Device label", text: $label)
            }
            .navigationTitle("Rename device")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(label)
                            dismiss()
                        }
                    }
                    .disabled(label.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct QRCodeView: View {
    let text: String
    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        Group {
            if let image = generateImage() {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 18)
                    .fill(.secondary.opacity(0.12))
                    .overlay {
                        Text("QR unavailable")
                            .foregroundStyle(.secondary)
                    }
            }
        }
    }

    private func generateImage() -> UIImage? {
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)), let cgImage = context.createCGImage(output, from: output.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}

private extension ScheduledTaskEditorDraft {
    init(detail: ScheduledTaskDetail) {
        self.title = detail.title
        self.enabled = detail.enabled
        self.scheduleMode = detail.scheduleType == "at" ? "at" : "cron"
        self.cron = detail.cron ?? ""
        self.at = detail.at ?? ""
        self.model = detail.model ?? ""
        self.thinkingLevel = detail.thinkingLevel ?? ""
        self.cwd = detail.cwd ?? ""
        self.timeoutSeconds = detail.timeoutSeconds.map(String.init) ?? ""
        self.prompt = detail.prompt ?? ""
        self.targetType = detail.targetType ?? "background-agent"
        self.threadMode = detail.threadConversationId == nil ? "dedicated" : "existing"
        self.threadConversationId = detail.threadConversationId ?? ""
    }
}

struct PairHostView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var appModel: CompanionAppModel
    @State private var baseURL = ProcessInfo.processInfo.environment["PA_IOS_DEFAULT_HOST"] ?? "https://"
    @State private var code = ""
    @State private var deviceLabel = UIDevice.current.name
    @State private var isPairing = false
    @State private var showingScanner = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Host") {
                    TextField("https://your-host.example.ts.net", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Pairing code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("Device label", text: $deviceLabel)
                }
                Section("Instant setup") {
                    Button {
                        showingScanner = true
                    } label: {
                        Label("Scan setup QR", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(isPairing)
                }
                Section {
                    Text("Use the host’s companion settings panel to generate a setup QR or pairing code. Scanning the QR will pair this device immediately.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Pair host")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isPairing ? "Pairing…" : "Pair") {
                        Task {
                            await submitManualPairing()
                        }
                    }
                    .disabled(isPairing || baseURL.trimmed.isEmpty || code.trimmed.isEmpty)
                }
            }
        }
        .sheet(isPresented: $showingScanner) {
            SetupQrScannerSheet(
                onScan: { rawValue in
                    guard let setupLink = CompanionSetupLink(rawString: rawValue) else {
                        appModel.bannerMessage = "That QR code is not a valid Personal Agent companion setup code."
                        return
                    }
                    Task {
                        showingScanner = false
                        isPairing = true
                        await appModel.pairSetupLink(setupLink, deviceLabel: deviceLabel)
                        isPairing = false
                        if appModel.activeSession != nil {
                            dismiss()
                        }
                    }
                },
                onError: { message in
                    appModel.bannerMessage = message
                }
            )
        }
    }

    private func submitManualPairing() async {
        isPairing = true
        await appModel.pairHost(baseURLString: baseURL, code: code, deviceLabel: deviceLabel)
        isPairing = false
        if appModel.activeSession != nil {
            dismiss()
        }
    }
}

struct HostSelectionView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var appModel: CompanionAppModel
    @State private var editingHost: CompanionHostRecord?

    var body: some View {
        NavigationStack {
            List {
                ForEach(appModel.hosts, id: \.id) { (host: CompanionHostRecord) in
                    HStack(alignment: .top, spacing: 12) {
                        Button {
                            Task {
                                await appModel.selectHost(host.id)
                                dismiss()
                            }
                        } label: {
                            HostSummaryView(host: host, isActive: appModel.activeHostId == host.id)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)

                        Menu {
                            Button {
                                editingHost = host
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                appModel.removeHost(host)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        Button {
                            editingHost = host
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .tint(.accentColor)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            appModel.removeHost(host)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            editingHost = host
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            appModel.removeHost(host)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Hosts")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(item: $editingHost) { host in
                HostEditorView(appModel: appModel, host: host)
            }
        }
    }
}

private struct HostSummaryView: View {
    let host: CompanionHostRecord
    let isActive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(host.hostLabel)
                    .font(.headline)
                Spacer()
                if isActive {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
            }
            Text(host.baseURL)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text("\(host.deviceLabel) · last used \(formatRelativeCompanionDate(ISO8601DateFormatter.flexible.string(from: host.lastUsedAt)))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct HostEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var appModel: CompanionAppModel
    let host: CompanionHostRecord

    @State private var baseURL: String
    @State private var displayName: String
    @State private var isSaving = false

    init(appModel: CompanionAppModel, host: CompanionHostRecord) {
        self.appModel = appModel
        self.host = host
        _baseURL = State(initialValue: host.baseURL)
        _displayName = State(initialValue: host.hostLabel)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("https://your-host.example.ts.net", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Display name", text: $displayName)
                    LabeledContent("Paired device") {
                        Text(host.deviceLabel)
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    Text("Edit the saved host URL or the local display name for this pairing. Delete removes the saved token from this phone and you can pair again later.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Edit host")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task {
                            isSaving = true
                            let saved = await appModel.updateHost(host, baseURLString: baseURL, displayName: displayName)
                            isSaving = false
                            if saved {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isSaving || baseURL.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct SetupQrScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onScan: (String) -> Void
    let onError: (String) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    SetupQrScannerView(onScan: { rawValue in
                        onScan(rawValue)
                        dismiss()
                    }, onError: { message in
                        onError(message)
                    })
                    .ignoresSafeArea(edges: .bottom)
                } else {
                    ContentUnavailableView(
                        "Scanner unavailable",
                        systemImage: "qrcode.viewfinder",
                        description: Text("This device cannot scan setup QR codes in-app. Use manual pairing instead.")
                    )
                    .padding()
                }
            }
            .navigationTitle("Scan setup QR")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

private struct SetupQrScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan, onError: onError)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        context.coordinator.onScan = onScan
        context.coordinator.onError = onError
        guard !context.coordinator.hasStarted else {
            return
        }
        context.coordinator.hasStarted = true
        Task {
            do {
                try uiViewController.startScanning()
            } catch {
                context.coordinator.onError(error.localizedDescription)
            }
        }
    }

    static func dismantleUIViewController(_ uiViewController: DataScannerViewController, coordinator: Coordinator) {
        uiViewController.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScan: (String) -> Void
        var onError: (String) -> Void
        var hasStarted = false
        private var hasScanned = false

        init(onScan: @escaping (String) -> Void, onError: @escaping (String) -> Void) {
            self.onScan = onScan
            self.onError = onError
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !hasScanned else {
                return
            }

            for item in addedItems {
                guard case .barcode(let barcode) = item, let payload = barcode.payloadStringValue?.trimmed, !payload.isEmpty else {
                    continue
                }
                hasScanned = true
                dataScanner.stopScanning()
                onScan(payload)
                return
            }
        }

        func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            onError(error.localizedDescription)
        }
    }
}

enum ConversationLaunchAction {
    case create(NewConversationRequest)
    case resume(ResumeConversationRequest)
}

struct ConversationLaunchView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case create = "New"
        case resume = "Resume"

        var id: String { rawValue }
    }

    @Environment(\.dismiss) private var dismiss
    let executionTargets: [ExecutionTargetSummary]
    let onSubmit: (ConversationLaunchAction) async -> Void

    @State private var mode: Mode = .create
    @State private var createRequest = NewConversationRequest()
    @State private var resumeRequest = ResumeConversationRequest()
    @State private var isSubmitting = false

    private var createModelOptions: [CompanionPickerOption] {
        companionModelOptions(current: createRequest.model, defaultLabel: "Host default")
    }

    private var createThinkingLevelOptions: [CompanionPickerOption] {
        companionThinkingLevelOptions(current: createRequest.thinkingLevel, unsetLabel: "Host default")
    }

    private var createFastModeBinding: Binding<Bool> {
        Binding(
            get: { companionFastModeEnabled(serviceTier: createRequest.serviceTier) },
            set: { createRequest.serviceTier = $0 ? "priority" : "" }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if mode == .create {
                    Section("Conversation") {
                        TextField("Optional initial prompt", text: $createRequest.promptText, axis: .vertical)
                            .lineLimit(3...6)
                        TextField("Working directory", text: $createRequest.cwd)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Picker("Model", selection: $createRequest.model) {
                            ForEach(createModelOptions) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.menu)
                        Picker("Thinking level", selection: $createRequest.thinkingLevel) {
                            ForEach(createThinkingLevelOptions) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.menu)
                        Toggle("Fast mode", isOn: createFastModeBinding)
                        Picker("Execution target", selection: $createRequest.executionTargetId) {
                            ForEach(targetOptions) { target in
                                Text(target.label).tag(target.id)
                            }
                        }
                    }
                } else {
                    Section("Resume") {
                        TextField("Session file", text: $resumeRequest.sessionFile)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Working directory", text: $resumeRequest.cwd)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Picker("Execution target", selection: $resumeRequest.executionTargetId) {
                            ForEach(targetOptions) { target in
                                Text(target.label).tag(target.id)
                            }
                        }
                    }
                }
            }
            .navigationTitle(mode == .create ? "New conversation" : "Resume conversation")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "Working…" : (mode == .create ? "Create" : "Resume")) {
                        Task {
                            isSubmitting = true
                            if mode == .create {
                                await onSubmit(.create(createRequest))
                            } else {
                                await onSubmit(.resume(resumeRequest))
                            }
                            isSubmitting = false
                            dismiss()
                        }
                    }
                    .disabled(isSubmitting || (mode == .resume && resumeRequest.sessionFile.trimmed.isEmpty))
                }
            }
        }
    }

    private var targetOptions: [ExecutionTargetSummary] {
        executionTargets.isEmpty ? [ExecutionTargetSummary(id: "local", label: "Local", kind: "local")] : executionTargets
    }
}
