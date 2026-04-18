import SwiftUI

struct RootView: View {
    @StateObject private var appModel = CompanionAppModel()
    @State private var showingPairHost = false

    var body: some View {
        Group {
            if let session = appModel.activeSession {
                ConversationListView(appModel: appModel, session: session)
            } else {
                ContentUnavailableView {
                    Label("Connect to a host", systemImage: "iphone.and.arrow.forward")
                } description: {
                    Text("Pair this device with a Personal Agent companion host and the app will mirror the host’s open and pinned conversations.")
                } actions: {
                    Button("Pair host") {
                        showingPairHost = true
                    }
                    if !appModel.hosts.isEmpty {
                        Button("Choose saved host") {
                            appModel.hostSelectionPresented = true
                        }
                    }
                }
                .padding()
            }
        }
        .sheet(isPresented: $showingPairHost) {
            PairHostView(appModel: appModel)
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

struct ConversationListView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    @State private var path: [String] = []
    @State private var showingHostSelection = false
    @State private var showingPairHost = false
    @State private var showingLaunchSheet = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(session.host.hostLabel)
                            .font(.headline)
                        Text(session.host.baseURL)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text("Paired as \(session.host.deviceLabel)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                ForEach(session.sections) { section in
                    Section(section.title) {
                        ForEach(section.sessions) { item in
                            NavigationLink(value: item.id) {
                                ConversationRow(session: item)
                            }
                        }
                    }
                }

                if session.sections.isEmpty && !session.isLoading {
                    Section {
                        ContentUnavailableView(
                            "No conversations",
                            systemImage: "message",
                            description: Text("Create a new conversation on \(session.host.hostLabel) or resume one from a session file.")
                        )
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Personal Agent")
            .navigationDestination(for: String.self) { conversationId in
                ConversationScreen(viewModel: session.makeConversationModel(conversationId: conversationId, initialSession: session.sessions[conversationId]))
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
                    Menu {
                        Button {
                            showingLaunchSheet = true
                        } label: {
                            Label("New conversation", systemImage: "square.and.pencil")
                        }
                        Button {
                            showingLaunchSheet = true
                        } label: {
                            Label("Resume from session file", systemImage: "arrow.clockwise")
                        }
                        Divider()
                        Button {
                            session.refresh()
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise.circle")
                        }
                        Button {
                            showingPairHost = true
                        } label: {
                            Label("Pair another host", systemImage: "plus")
                        }
                    } label: {
                        Image(systemName: "plus.circle")
                    }
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
            .sheet(isPresented: $showingPairHost) {
                PairHostView(appModel: appModel)
            }
            .sheet(isPresented: $showingLaunchSheet) {
                ConversationLaunchView(executionTargets: session.executionTargets) { action in
                    switch action {
                    case .create(let request):
                        if let id = await session.createConversation(request) {
                            path.append(id)
                        }
                    case .resume(let request):
                        if let id = await session.resumeConversation(request) {
                            path.append(id)
                        }
                    }
                }
            }
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
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            HStack {
                Text(formatRelativeCompanionDate(session.lastActivityAt ?? session.timestamp))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if session.isLive == true {
                    Label("Live", systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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

struct PairHostView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var appModel: CompanionAppModel
    @State private var baseURL = ProcessInfo.processInfo.environment["PA_IOS_DEFAULT_HOST"] ?? "https://"
    @State private var code = ""
    @State private var deviceLabel = UIDevice.current.name
    @State private var isPairing = false

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
                Section {
                    Text("Use the host’s companion settings panel to generate a pairing code, then enter the host URL and code here.")
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
                            isPairing = true
                            await appModel.pairHost(baseURLString: baseURL, code: code, deviceLabel: deviceLabel)
                            isPairing = false
                            if appModel.activeSession != nil {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isPairing || baseURL.trimmed.isEmpty || code.trimmed.isEmpty)
                }
            }
        }
    }
}

struct HostSelectionView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var appModel: CompanionAppModel

    var body: some View {
        NavigationStack {
            List {
                ForEach(appModel.hosts, id: \.id) { (host: CompanionHostRecord) in
                    Button {
                        Task {
                            await appModel.selectHost(host.id)
                            dismiss()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(host.hostLabel)
                                    .font(.headline)
                                Spacer()
                                if appModel.activeHostId == host.id {
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
                    .buttonStyle(.plain)
                    .swipeActions {
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
