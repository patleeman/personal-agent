import SwiftUI
import VisionKit

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
        .onOpenURL { url in
            Task {
                await appModel.handleIncomingSetupURL(url)
            }
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
                            .foregroundStyle(CompanionTheme.textPrimary)
                        Text(session.host.baseURL)
                            .font(.footnote)
                            .foregroundStyle(CompanionTheme.textSecondary)
                        Text("Paired as \(session.host.deviceLabel)")
                            .font(.footnote)
                            .foregroundStyle(CompanionTheme.textSecondary)
                    }
                    .padding(.vertical, 8)
                    .listRowBackground(CompanionTheme.panel)
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                    }
                }

                ForEach(session.sections) { section in
                    Section(section.title) {
                        ForEach(section.sessions) { item in
                            NavigationLink(value: item.id) {
                                ConversationRow(session: item)
                            }
                            .listRowBackground(CompanionTheme.panel)
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
                        .foregroundStyle(CompanionTheme.textSecondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .listStyle(.insetGrouped)
            .navigationTitle("Personal Agent")
            .toolbarBackground(CompanionTheme.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
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
                try await uiViewController.startScanning()
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
