import CoreImage.CIFilterBuiltins
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var editingHost: CompanionHostRecord?
    @State private var showingPairHost = false

    var body: some View {
        NavigationStack {
            List {
                if appModel.hosts.isEmpty {
                    emptyHostRow
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

    @ViewBuilder
    private var emptyHostRow: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "server.rack")
                    .font(.system(size: 52, weight: .semibold))
                    .foregroundStyle(CompanionTheme.textSecondary)
                Text("Pair a host")
                    .font(.title.weight(.bold))
                    .foregroundStyle(CompanionTheme.textPrimary)
                Text("Connect to a Personal Agent host to use chats, automations, and settings.")
                    .font(.body)
                    .foregroundStyle(CompanionTheme.textSecondary)
                Button("Pair host") {
                    showingPairHost = true
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 24)
            .listRowBackground(Color.clear)
        } else {
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
        }
    }
}

struct HostDashboardView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel

    var body: some View {
        TabView(selection: $appModel.selectedDashboardTab) {
            ConversationListView(appModel: appModel, session: session)
                .tabItem {
                    Label("Chat", systemImage: "message")
                }
                .tag(HostDashboardTab.chat)

            KnowledgeRootView(appModel: appModel, session: session)
                .tabItem {
                    Label("Knowledge", systemImage: "book.closed")
                }
                .tag(HostDashboardTab.knowledge)

            ArchivedConversationListView(session: session)
                .tabItem {
                    Label("Archived", systemImage: "archivebox")
                }
                .tag(HostDashboardTab.archived)

            AutomationListView(session: session)
                .tabItem {
                    Label("Automations", systemImage: "clock.arrow.circlepath")
                }
                .tag(HostDashboardTab.automations)

            HostSettingsView(appModel: appModel, session: session)
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
                .tag(HostDashboardTab.settings)
        }
        .tint(CompanionTheme.accent)
    }
}

private struct ConversationListCwdGroup: Identifiable {
    let key: String
    let cwd: String?
    let label: String
    let sessions: [SessionMeta]

    var id: String { key }
}

private struct ConversationListSectionGroup: Identifiable {
    let id: String
    let title: String
    let cwdGroups: [ConversationListCwdGroup]
}

private final class DemoConversationAutoOpenCoordinator: ObservableObject {
    var didOpen = false
}

struct ConversationListView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    @State private var path: [String] = []
    @State private var showingHostSelection = false
    @State private var isCreatingConversation = false
    @StateObject private var demoAutoOpenCoordinator = DemoConversationAutoOpenCoordinator()

    private var groupedChatSections: [ConversationListSectionGroup] {
        let labelsByCwd = buildCompanionConversationGroupLabels(
            session.chatSections.flatMap { $0.sessions.map(\.cwd) }
        )

        return session.chatSections.map { section in
            var sessionsByGroupKey: [String: [SessionMeta]] = [:]
            var orderedGroupKeys: [String] = []

            for item in section.sessions {
                let normalizedCwd = normalizeCompanionConversationGroupCwd(item.cwd)
                let groupKey = normalizedCwd.isEmpty ? "__no-cwd__" : normalizedCwd
                if sessionsByGroupKey[groupKey] == nil {
                    orderedGroupKeys.append(groupKey)
                }
                sessionsByGroupKey[groupKey, default: []].append(item)
            }

            return ConversationListSectionGroup(
                id: section.id,
                title: section.title,
                cwdGroups: orderedGroupKeys.map { groupKey in
                    let normalizedCwd = groupKey == "__no-cwd__" ? nil : groupKey
                    return ConversationListCwdGroup(
                        key: groupKey,
                        cwd: normalizedCwd,
                        label: companionConversationGroupLabel(normalizedCwd, labelsByCwd: labelsByCwd),
                        sessions: sessionsByGroupKey[groupKey] ?? []
                    )
                }
            )
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                conversationListHeader()

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        if session.isLoading && session.chatSections.isEmpty {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(.top, 48)
                        } else if session.chatSections.isEmpty {
                            ContentUnavailableView(
                                session.archivedSessions.isEmpty ? "No conversations" : "No open conversations",
                                systemImage: "message",
                                description: Text(
                                    session.archivedSessions.isEmpty
                                        ? "Create a new conversation on \(session.host.hostLabel)."
                                        : "Create a new conversation on \(session.host.hostLabel), or open Archived to restore an older thread."
                                )
                            )
                            .foregroundStyle(CompanionTheme.textSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                        } else {
                            ForEach(groupedChatSections) { section in
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(section.title)
                                        .font(.title.weight(.semibold))
                                        .foregroundStyle(CompanionTheme.textSecondary)

                                    VStack(alignment: .leading, spacing: 18) {
                                        ForEach(section.cwdGroups) { group in
                                            VStack(alignment: .leading, spacing: 10) {
                                                Text(group.label)
                                                    .font(.subheadline.weight(.semibold))
                                                    .foregroundStyle(CompanionTheme.textSecondary)

                                                VStack(spacing: 12) {
                                                    ForEach(group.sessions) { item in
                                                        conversationListCard(item, in: section, includeCwdInSubtitle: false)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 140)
                }
                .refreshable {
                    session.refresh()
                }
                .scrollBounceBehavior(.always)
            }
            .background(CompanionTheme.canvas)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { conversationId in
                ConversationScreen(
                    viewModel: session.makeConversationModel(conversationId: conversationId, initialSession: session.sessions[conversationId]),
                    onOpenConversation: { nextId in
                        path.append(nextId)
                        session.refresh()
                    }
                )
            }
            .overlay(alignment: .bottom) {
                if let message = session.errorMessage {
                    ErrorBanner(message: message)
                        .padding()
                }
            }
            .sheet(isPresented: $showingHostSelection) {
                HostSelectionView(appModel: appModel)
            }
            .onAppear {
                autoOpenFirstConversationIfNeeded()
            }
            .onChange(of: session.chatSections) { _, _ in
                autoOpenFirstConversationIfNeeded()
            }
            .task(id: session.chatSections.first?.sessions.first?.id) {
                autoOpenFirstConversationIfNeeded()
            }
        }
    }

    @ViewBuilder
    private func conversationListCard(_ item: SessionMeta, in section: ConversationListSectionGroup, includeCwdInSubtitle: Bool) -> some View {
        SwipeableConversationCard(
            leadingTitle: section.id == "pinned" ? "Unpin" : "Pin",
            leadingSystemImage: section.id == "pinned" ? "pin.slash" : "pin",
            leadingTint: CompanionTheme.accent,
            leadingAction: { Task { await session.togglePinned(item.id) } },
            trailingTitle: "Archive",
            trailingSystemImage: "archivebox",
            trailingTint: .orange,
            trailingAction: { Task { await session.toggleArchived(item.id) } }
        ) {
            HStack(spacing: 10) {
                Button {
                    path.append(item.id)
                } label: {
                    HStack(spacing: 14) {
                        ConversationRow(session: item, includeCwdInSubtitle: includeCwdInSubtitle)
                        Spacer(minLength: 12)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(CompanionTheme.textDim)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Menu {
                    Button {
                        Task { await session.togglePinned(item.id) }
                    } label: {
                        Label(section.id == "pinned" ? "Unpin" : "Pin", systemImage: section.id == "pinned" ? "pin.slash" : "pin")
                    }
                    Button {
                        Task { await session.toggleArchived(item.id) }
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Conversation actions")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(CompanionTheme.panelRaised, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(CompanionTheme.panelBorder, lineWidth: 1)
            }
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
                Label("Archive", systemImage: "archivebox")
            }
            Button {
                Task { @MainActor in
                    if let duplicated = await session.duplicateConversation(item.id) {
                        path.append(duplicated)
                    }
                }
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
            }
        }
    }

    private func conversationListHeader() -> some View {
        HStack {
            Button {
                showingHostSelection = true
            } label: {
                Image(systemName: "server.rack")
                    .font(.system(size: 28, weight: .medium))
                    .frame(width: 56, height: 56)
                    .background(CompanionTheme.panelRaised, in: Circle())
                    .overlay {
                        Circle()
                            .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            .foregroundStyle(CompanionTheme.accent)
            .accessibilityLabel("Hosts")

            Spacer(minLength: 16)

            Button {
                startConversationCreation()
            } label: {
                Group {
                    if isCreatingConversation {
                        ProgressView()
                            .tint(CompanionTheme.accent)
                    } else {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 28, weight: .medium))
                    }
                }
                .frame(width: 56, height: 56)
                .background(CompanionTheme.panelRaised, in: Circle())
                .overlay {
                    Circle()
                        .stroke(CompanionTheme.panelBorder, lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(CompanionTheme.accent)
            .disabled(isCreatingConversation)
            .accessibilityLabel("New conversation")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 4)
        .background(CompanionTheme.canvas)
    }

    private func startConversationCreation() {
        guard !isCreatingConversation else {
            return
        }
        Task { @MainActor in
            isCreatingConversation = true
            defer { isCreatingConversation = false }
            if let id = await session.createConversation(NewConversationRequest()) {
                path.append(id)
            }
        }
    }

    private func autoOpenFirstConversationIfNeeded() {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PA_IOS_AUTO_OPEN_FIRST_CONVERSATION"] == "1" || environment["PA_IOS_AUTO_OPEN_FIRST_MOCK_CONVERSATION"] == "1",
              let firstConversationId = session.chatSections.first?.sessions.first?.id else {
            return
        }
        DispatchQueue.main.async {
            guard !demoAutoOpenCoordinator.didOpen else {
                return
            }
            demoAutoOpenCoordinator.didOpen = true
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                guard path.isEmpty else {
                    return
                }
                path = [firstConversationId]
            }
        }
    }
}

struct CompanionSwipeActionState: Equatable {
    static let actionWidth: CGFloat = 96
    static let openThreshold: CGFloat = 44

    private(set) var offset: CGFloat = 0

    mutating func update(translationWidth: CGFloat) {
        offset = Self.clamped(translationWidth)
    }

    mutating func settle(translationWidth: CGFloat) {
        if translationWidth > Self.openThreshold {
            offset = Self.actionWidth
        } else if translationWidth < -Self.openThreshold {
            offset = -Self.actionWidth
        } else {
            offset = 0
        }
    }

    mutating func close() {
        offset = 0
    }

    private static func clamped(_ value: CGFloat) -> CGFloat {
        min(max(value, -actionWidth), actionWidth)
    }
}

private struct SwipeableConversationCard<Content: View>: View {
    let leadingTitle: String
    let leadingSystemImage: String
    let leadingTint: Color
    let leadingAction: () -> Void
    let trailingTitle: String
    let trailingSystemImage: String
    let trailingTint: Color
    let trailingAction: () -> Void
    @ViewBuilder var content: () -> Content

    @State private var swipeState = CompanionSwipeActionState()

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                swipeButton(title: leadingTitle, systemImage: leadingSystemImage, tint: leadingTint) {
                    leadingAction()
                    swipeState.close()
                }

                Spacer(minLength: 0)

                swipeButton(title: trailingTitle, systemImage: trailingSystemImage, tint: trailingTint) {
                    trailingAction()
                    swipeState.close()
                }
            }
            .background(CompanionTheme.panel, in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            content()
                .offset(x: swipeState.offset)
                .simultaneousGesture(
                    DragGesture(minimumDistance: 12, coordinateSpace: .local)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            swipeState.update(translationWidth: value.translation.width)
                        }
                        .onEnded { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            swipeState.settle(translationWidth: value.translation.width)
                        }
                )
                .animation(.spring(response: 0.24, dampingFraction: 0.88), value: swipeState.offset)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func swipeButton(title: String, systemImage: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.headline.weight(.semibold))
                Text(title)
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.white)
            .frame(width: CompanionSwipeActionState.actionWidth)
            .frame(maxHeight: .infinity)
            .background(tint)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

private struct ArchivedEmptyState: View {
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "archivebox")
                .font(.system(size: 48, weight: .semibold))
            Text("No archived conversations")
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
            Text("Archived and older hidden threads show up here. Unarchive one to move it back into Chat.")
                .font(.body)
                .multilineTextAlignment(.center)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(CompanionTheme.textSecondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
        .padding(.horizontal, 12)
        .accessibilityElement(children: .combine)
    }
}

struct ArchivedConversationListView: View {
    @ObservedObject var session: HostSessionModel
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if session.archivedSessions.isEmpty && !session.isLoading {
                    Section {
                        ArchivedEmptyState()
                    }
                } else {
                    Section("Archived") {
                        ForEach(session.archivedSessions) { item in
                            NavigationLink(value: item.id) {
                                ConversationRow(session: item)
                            }
                            .listRowBackground(CompanionTheme.panel)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    Task { await session.restoreConversation(item.id) }
                                } label: {
                                    Label("Unarchive", systemImage: "tray.and.arrow.up")
                                }
                                .tint(.accentColor)
                            }
                            .contextMenu {
                                Button {
                                    Task { await session.restoreConversation(item.id) }
                                } label: {
                                    Label("Unarchive", systemImage: "tray.and.arrow.up")
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .listStyle(.insetGrouped)
            .navigationTitle("Archived")
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
            .overlay(alignment: .bottom) {
                if let message = session.errorMessage {
                    ErrorBanner(message: message)
                        .padding()
                }
            }
            .refreshable {
                session.refresh()
            }
        }
    }
}

private enum KnowledgeRoute: Hashable {
    case directory(String)
    case note(String)
}

private enum KnowledgeCreationKind: String, Identifiable {
    case note
    case folder

    var id: String { rawValue }

    var title: String {
        switch self {
        case .note:
            return "New note"
        case .folder:
            return "New folder"
        }
    }

    var placeholder: String {
        switch self {
        case .note:
            return "daily.md"
        case .folder:
            return "research"
        }
    }
}

struct KnowledgeRootView: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    @State private var path: [KnowledgeRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            KnowledgeDirectoryScreen(appModel: appModel, session: session, directoryId: nil) { route in
                path.append(route)
            }
            .navigationDestination(for: KnowledgeRoute.self) { route in
                switch route {
                case .directory(let directoryId):
                    KnowledgeDirectoryScreen(appModel: appModel, session: session, directoryId: directoryId) { nextRoute in
                        path.append(nextRoute)
                    }
                case .note(let fileId):
                    KnowledgeNoteScreen(appModel: appModel, session: session, fileId: fileId)
                }
            }
        }
        .onChange(of: appModel.knowledgeNavigationRequest?.id) { _, _ in
            guard let request = appModel.knowledgeNavigationRequest else {
                return
            }
            openKnowledgeNavigationRequest(request)
        }
        .task {
            if let request = appModel.knowledgeNavigationRequest {
                openKnowledgeNavigationRequest(request)
            }
        }
    }

    private func openKnowledgeNavigationRequest(_ request: KnowledgeNavigationRequest) {
        let route: [KnowledgeRoute] = [.note(request.fileId)]
        if path != route {
            path = route
        }
        DispatchQueue.main.async {
            appModel.consumeKnowledgeNavigationRequest(request)
        }
    }
}

private func editableKnowledgeName(for entry: CompanionKnowledgeEntry) -> String {
    if entry.isDirectory {
        return entry.name
    }
    return entry.name.replacingOccurrences(of: #"\.md$"#, with: "", options: .regularExpression)
}

private struct KnowledgeDirectoryScreen: View {
    @ObservedObject var appModel: CompanionAppModel
    @ObservedObject var session: HostSessionModel
    let directoryId: String?
    let onOpenRoute: (KnowledgeRoute) -> Void

    @StateObject private var viewModel: KnowledgeDirectoryViewModel
    @State private var creationKind: KnowledgeCreationKind?
    @State private var renameEntry: CompanionKnowledgeEntry?
    @State private var moveEntry: CompanionKnowledgeEntry?
    @State private var deleteEntry: CompanionKnowledgeEntry?

    init(appModel: CompanionAppModel, session: HostSessionModel, directoryId: String?, onOpenRoute: @escaping (KnowledgeRoute) -> Void) {
        self.appModel = appModel
        self.session = session
        self.directoryId = directoryId
        self.onOpenRoute = onOpenRoute
        _viewModel = StateObject(wrappedValue: session.makeKnowledgeDirectoryModel(directoryId: directoryId))
    }

    var body: some View {
        List {
            if viewModel.entries.isEmpty && !viewModel.isLoading {
                ContentUnavailableView(
                    directoryId == nil ? "No notes yet" : "This folder is empty",
                    systemImage: "book.closed",
                    description: Text(directoryId == nil
                        ? "Create a note or folder to start building your knowledge base on this host."
                        : "Create a note or folder here, or go back to another directory.")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(viewModel.entries) { entry in
                    Button {
                        if entry.isDirectory {
                            onOpenRoute(.directory(entry.id))
                        } else {
                            onOpenRoute(.note(entry.id))
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: entry.isDirectory ? "folder" : "doc.text")
                                .font(.system(size: 24, weight: .regular))
                                .foregroundStyle(entry.isDirectory ? .accentColor : CompanionTheme.textSecondary)
                                .frame(width: 32)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(editableKnowledgeName(for: entry))
                                    .foregroundStyle(CompanionTheme.textPrimary)
                                Text(entry.isDirectory
                                     ? "Folder"
                                     : "Updated \(formatRelativeCompanionDate(entry.updatedAt))")
                                    .font(.caption)
                                    .foregroundStyle(CompanionTheme.textSecondary)
                            }
                            Spacer()
                            if entry.isDirectory {
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(CompanionTheme.textDim)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(CompanionTheme.panel)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            renameEntry = entry
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        .tint(.accentColor)

                        Button {
                            moveEntry = entry
                        } label: {
                            Label("Move", systemImage: "folder")
                        }
                        .tint(.blue)

                        Button(role: .destructive) {
                            deleteEntry = entry
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            renameEntry = entry
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        Button {
                            moveEntry = entry
                        } label: {
                            Label("Move", systemImage: "folder")
                        }
                        Button(role: .destructive) {
                            deleteEntry = entry
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(CompanionTheme.canvas)
        .listStyle(.insetGrouped)
        .refreshable {
            await viewModel.reload()
        }
        .navigationTitle(viewModel.title)
        .toolbarBackground(CompanionTheme.canvas, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            if directoryId == nil {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        appModel.hostSelectionPresented = true
                    } label: {
                        Label("Hosts", systemImage: "server.rack")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        creationKind = .note
                    } label: {
                        Label("New note", systemImage: "square.and.pencil")
                    }
                    Button {
                        creationKind = .folder
                    } label: {
                        Label("New folder", systemImage: "folder.badge.plus")
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Create knowledge item")
            }
        }
        .overlay(alignment: .bottom) {
            if let message = viewModel.errorMessage {
                ErrorBanner(message: message)
                    .padding()
            }
        }
        .sheet(item: $creationKind) { kind in
            KnowledgeCreateSheet(kind: kind) { name in
                switch kind {
                case .note:
                    if let created = await viewModel.createNote(named: name) {
                        onOpenRoute(.note(created.id))
                        return true
                    }
                    return false
                case .folder:
                    if let created = await viewModel.createFolder(named: name) {
                        onOpenRoute(.directory(created.id))
                        return true
                    }
                    return false
                }
            }
        }
        .sheet(item: $renameEntry) { entry in
            KnowledgeRenameSheet(
                title: entry.isDirectory ? "Rename folder" : "Rename note",
                placeholder: entry.isDirectory ? "Folder name" : "Note name",
                initialName: editableKnowledgeName(for: entry)
            ) { name in
                await viewModel.rename(entry: entry, to: name) != nil
            }
        }
        .sheet(item: $moveEntry) { entry in
            KnowledgeMoveSheet(entry: entry, session: session) { destinationFolder in
                await viewModel.move(entry: entry, to: destinationFolder) != nil
            }
        }
        .alert(
            deleteEntry?.isDirectory == true ? "Delete folder?" : "Delete note?",
            isPresented: Binding(get: { deleteEntry != nil }, set: { if !$0 { deleteEntry = nil } })
        ) {
            Button("Cancel", role: .cancel) {
                deleteEntry = nil
            }
            Button("Delete", role: .destructive) {
                guard let entry = deleteEntry else { return }
                deleteEntry = nil
                Task {
                    _ = await viewModel.delete(entry: entry)
                }
            }
        } message: {
            if let entry = deleteEntry {
                Text(entry.isDirectory ? "Delete \(entry.name) and everything inside it?" : "Delete \(editableKnowledgeName(for: entry))?")
            }
        }
        .onAppear {
            viewModel.load()
        }
        .onDisappear {
            viewModel.stop()
        }
    }
}

private struct KnowledgeMoveSheet: View {
    @Environment(\.dismiss) private var dismiss
    let entry: CompanionKnowledgeEntry
    let session: HostSessionModel
    let onMove: (String) async -> Bool

    @State private var path: [String] = []
    @State private var isMoving = false

    private var excludedFolderId: String? {
        guard entry.isDirectory else {
            return nil
        }
        return entry.id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
    }

    var body: some View {
        NavigationStack(path: $path) {
            KnowledgeMoveFolderScreen(
                session: session,
                directoryId: nil,
                excludedFolderId: excludedFolderId,
                isMoving: isMoving,
                onOpenFolder: { folderId in path.append(folderId) },
                onMoveHere: { move(to: "") }
            )
            .navigationDestination(for: String.self) { folderId in
                KnowledgeMoveFolderScreen(
                    session: session,
                    directoryId: folderId,
                    excludedFolderId: excludedFolderId,
                    isMoving: isMoving,
                    onOpenFolder: { nextFolderId in path.append(nextFolderId) },
                    onMoveHere: { move(to: folderId) }
                )
            }
            .navigationTitle("Move \(editableKnowledgeName(for: entry))")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func move(to destinationFolder: String) {
        guard !isMoving else {
            return
        }
        Task {
            isMoving = true
            let moved = await onMove(destinationFolder)
            isMoving = false
            if moved {
                dismiss()
            }
        }
    }
}

private struct KnowledgeMoveFolderScreen: View {
    @ObservedObject var session: HostSessionModel
    let directoryId: String?
    let excludedFolderId: String?
    let isMoving: Bool
    let onOpenFolder: (String) -> Void
    let onMoveHere: () -> Void

    @StateObject private var viewModel: KnowledgeFolderPickerViewModel

    init(
        session: HostSessionModel,
        directoryId: String?,
        excludedFolderId: String?,
        isMoving: Bool,
        onOpenFolder: @escaping (String) -> Void,
        onMoveHere: @escaping () -> Void
    ) {
        self.session = session
        self.directoryId = directoryId
        self.excludedFolderId = excludedFolderId
        self.isMoving = isMoving
        self.onOpenFolder = onOpenFolder
        self.onMoveHere = onMoveHere
        _viewModel = StateObject(wrappedValue: session.makeKnowledgeFolderPickerModel(directoryId: directoryId, excludedFolderId: excludedFolderId))
    }

    var body: some View {
        List {
            Section {
                Button {
                    onMoveHere()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.down.folder")
                            .foregroundStyle(CompanionTheme.accent)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Move here")
                                .foregroundStyle(CompanionTheme.textPrimary)
                            Text(directoryId?.nilIfBlank ?? "Knowledge root")
                                .font(.caption)
                                .foregroundStyle(CompanionTheme.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .disabled(isMoving)
            }

            Section("Folders") {
                if viewModel.isLoading && viewModel.folders.isEmpty {
                    ProgressView()
                } else if viewModel.folders.isEmpty {
                    Text("No folders here")
                        .foregroundStyle(CompanionTheme.textSecondary)
                } else {
                    ForEach(viewModel.folders) { folder in
                        Button {
                            onOpenFolder(folder.id.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression))
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "folder")
                                    .foregroundStyle(CompanionTheme.accent)
                                    .frame(width: 20)
                                Text(folder.name)
                                    .foregroundStyle(CompanionTheme.textPrimary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(CompanionTheme.textDim)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(CompanionTheme.canvas)
        .listStyle(.insetGrouped)
        .refreshable {
            await viewModel.reload()
        }
        .navigationTitle(viewModel.title)
        .overlay(alignment: .bottom) {
            if let message = viewModel.errorMessage {
                ErrorBanner(message: message)
                    .padding()
            }
        }
        .onAppear {
            viewModel.load()
        }
        .onDisappear {
            viewModel.stop()
        }
    }
}

private struct KnowledgeCreateSheet: View {
    @Environment(\.dismiss) private var dismiss
    let kind: KnowledgeCreationKind
    let onCreate: (String) async -> Bool

    @State private var name: String
    @State private var isSaving = false

    init(kind: KnowledgeCreationKind, onCreate: @escaping (String) async -> Bool) {
        self.kind = kind
        self.onCreate = onCreate
        _name = State(initialValue: kind.placeholder)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(kind.title) {
                    TextField(kind.placeholder, text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Text(kind == .note
                         ? "Notes are plain markdown files in the host knowledge vault."
                         : "Folders help organize related notes inside the knowledge vault.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle(kind.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Create") {
                        Task {
                            isSaving = true
                            let created = await onCreate(name)
                            isSaving = false
                            if created {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isSaving || name.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct KnowledgeRenameSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let placeholder: String
    let initialName: String
    let onSave: (String) async -> Bool

    @State private var name: String
    @State private var isSaving = false

    init(title: String, placeholder: String, initialName: String, onSave: @escaping (String) async -> Bool) {
        self.title = title
        self.placeholder = placeholder
        self.initialName = initialName
        self.onSave = onSave
        _name = State(initialValue: initialName)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(title) {
                    TextField(placeholder, text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
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
                            let saved = await onSave(name)
                            isSaving = false
                            if saved {
                                dismiss()
                            }
                        }
                    }
                    .disabled(isSaving || name.trimmed.isEmpty || name.trimmed == initialName.trimmed)
                }
            }
        }
    }
}

private struct KnowledgeNoteScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    let fileId: String

    @StateObject private var viewModel: KnowledgeNoteViewModel
    @State private var showingRenameSheet = false
    @State private var showingDeleteConfirmation = false
    @State private var showingFindBar = false
    @State private var showingOutlineSheet = false
    @State private var showingLinkComposer = false
    @State private var showingLinkPicker = false
    @State private var showingCamera = false
    @State private var showingPhotoPicker = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var editorSelection = NSRange(location: 0, length: 0)
    @State private var pendingEditorCommand: KnowledgeEditorCommand?
    @State private var findQuery = ""
    @State private var findMatches: [NSRange] = []
    @State private var currentFindMatchIndex = 0
    @State private var linkDraft = KnowledgeLinkComposerDraft()

    init(appModel _: CompanionAppModel, session: HostSessionModel, fileId: String) {
        self.fileId = fileId
        _viewModel = StateObject(wrappedValue: session.makeKnowledgeNoteModel(fileId: fileId))
    }

    private var conflictBinding: Binding<KnowledgeNoteConflict?> {
        Binding(
            get: { viewModel.conflict },
            set: { nextValue in
                if nextValue == nil {
                    viewModel.conflict = nil
                }
            }
        )
    }

    private var statsText: String {
        let totalWords = knowledgeWordCount(in: viewModel.draft)
        let selectedWords = knowledgeSelectionWordCount(in: viewModel.draft, selectedRange: editorSelection)
        let selectedCharacters = editorSelection.length
        if selectedCharacters > 0 {
            return "\(totalWords) words · \(selectedWords) selected · \(selectedCharacters) chars"
        }
        return "\(totalWords) words"
    }

    private var selectedText: String {
        let nsText = viewModel.draft as NSString
        guard editorSelection.location != NSNotFound,
              editorSelection.location <= nsText.length,
              editorSelection.length > 0 else {
            return ""
        }
        let safeRange = NSRange(location: editorSelection.location, length: min(editorSelection.length, nsText.length - editorSelection.location))
        return nsText.substring(with: safeRange)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showingFindBar {
                KnowledgeFindBar(
                    query: $findQuery,
                    matchCount: findMatches.count,
                    currentMatchIndex: findMatches.isEmpty ? 0 : currentFindMatchIndex + 1,
                    onPrevious: navigateFindMatchBackward,
                    onNext: navigateFindMatchForward,
                    onClose: {
                        showingFindBar = false
                        findQuery = ""
                    }
                )
            }

            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(CompanionTheme.canvas)
            } else {
                KnowledgeMarkdownTextEditor(
                    text: $viewModel.draft,
                    selectedRange: $editorSelection,
                    command: pendingEditorCommand,
                    onCommandHandled: { handled in
                        if pendingEditorCommand?.id == handled.id {
                            pendingEditorCommand = nil
                        }
                    },
                    onPasteImage: { data, mimeType, fileName in
                        Task {
                            await insertImage(data: data, mimeType: mimeType, fileName: fileName)
                        }
                    }
                )
                .background(CompanionTheme.canvas)
            }
        }
        .background(CompanionTheme.canvas)
        .navigationTitle(viewModel.title)
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(CompanionTheme.canvas, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    if let suggestedFileName = viewModel.suggestedFileName {
                        Button {
                            Task { _ = await viewModel.renameFileToMatchTitle() }
                        } label: {
                            Label("Rename file to \(suggestedFileName)", systemImage: "text.document")
                        }
                    }

                    Button {
                        showingFindBar = true
                    } label: {
                        Label("Find in note", systemImage: "magnifyingglass")
                    }

                    if !viewModel.outline.isEmpty {
                        Button {
                            showingOutlineSheet = true
                        } label: {
                            Label("Heading outline", systemImage: "list.bullet.indent")
                        }
                    }

                    Button {
                        prepareLinkComposer()
                    } label: {
                        Label("Insert link", systemImage: "link")
                    }

                    Button {
                        showingLinkPicker = true
                    } label: {
                        Label("Link to note", systemImage: "book")
                    }

                    Menu("Insert image") {
                        Button {
                            showingPhotoPicker = true
                        } label: {
                            Label("Photos", systemImage: "photo.on.rectangle")
                        }
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button {
                                showingCamera = true
                            } label: {
                                Label("Camera", systemImage: "camera")
                            }
                        }
                        if UIPasteboard.general.image != nil {
                            Button {
                                pasteClipboardImage()
                            } label: {
                                Label("Paste image", systemImage: "doc.on.clipboard")
                            }
                        }
                    }

                    Button {
                        showingRenameSheet = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }

                    Button(role: .destructive) {
                        showingDeleteConfirmation = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .disabled(viewModel.isSaving)

                Button {
                    viewModel.reload()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Reload note")
                .disabled(viewModel.isSaving)

                if viewModel.isDirty {
                    Button("Discard") {
                        viewModel.discardChanges()
                    }
                    .disabled(viewModel.isSaving)
                }

                Button(viewModel.isSaving ? "Saving…" : "Save") {
                    Task {
                        _ = await viewModel.save()
                    }
                }
                .disabled(viewModel.isSaving || !viewModel.isDirty || viewModel.hasConflict)
            }

            ToolbarItem(placement: .keyboard) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        Button("#") {
                            pendingEditorCommand = .init(kind: .prefixCurrentLine("# "))
                        }
                        Button("-") {
                            pendingEditorCommand = .init(kind: .prefixSelectedLines("- "))
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .toggleChecklist)
                        } label: {
                            Image(systemName: "checklist")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .prefixSelectedLines("> "))
                        } label: {
                            Image(systemName: "text.quote")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .wrapSelection(prefix: "`", suffix: "`", placeholder: "code"))
                        } label: {
                            Image(systemName: "chevron.left.forwardslash.chevron.right")
                        }
                        Button("[[") {
                            showingLinkPicker = true
                        }
                        Button {
                            prepareLinkComposer()
                        } label: {
                            Image(systemName: "link")
                        }
                        Button {
                            showingPhotoPicker = true
                        } label: {
                            Image(systemName: "photo")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .indentSelection)
                        } label: {
                            Image(systemName: "increase.indent")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .outdentSelection)
                        } label: {
                            Image(systemName: "decrease.indent")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .undo)
                        } label: {
                            Image(systemName: "arrow.uturn.backward")
                        }
                        Button {
                            pendingEditorCommand = .init(kind: .redo)
                        } label: {
                            Image(systemName: "arrow.uturn.forward")
                        }
                    }
                    .padding(.horizontal, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 10) {
                if let context = viewModel.currentWikiLinkContext,
                   !viewModel.linkSuggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(viewModel.linkSuggestions) { result in
                            Button {
                                pendingEditorCommand = .init(kind: .insertWikiLink(title: result.title, replaceRange: context.replaceRange))
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(result.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(CompanionTheme.textPrimary)
                                    Text(result.excerpt)
                                        .font(.caption)
                                        .foregroundStyle(CompanionTheme.textSecondary)
                                        .lineLimit(2)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 10)
                                .padding(.horizontal, 12)
                            }
                            .buttonStyle(.plain)
                            if result.id != viewModel.linkSuggestions.last?.id {
                                Divider()
                            }
                        }
                    }
                    .background(CompanionTheme.panel)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(viewModel.statusMessage ?? "")
                        .font(.caption)
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .lineLimit(2)
                    Spacer(minLength: 12)
                    Text(statsText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(CompanionTheme.textSecondary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
        .sheet(isPresented: $showingRenameSheet) {
            KnowledgeRenameSheet(
                title: "Rename note",
                placeholder: "Note name",
                initialName: viewModel.fileNameTitle
            ) { name in
                await viewModel.rename(to: name)
            }
        }
        .sheet(isPresented: $showingOutlineSheet) {
            KnowledgeOutlineSheet(headings: viewModel.outline) { heading in
                pendingEditorCommand = .init(kind: .select(heading.range))
                showingOutlineSheet = false
            }
        }
        .sheet(isPresented: $showingLinkComposer) {
            KnowledgeLinkComposerSheet(draft: $linkDraft) { label, destination in
                pendingEditorCommand = .init(kind: .insertMarkdownLink(label: label, url: destination))
            }
        }
        .sheet(isPresented: $showingLinkPicker) {
            KnowledgeNoteLinkPickerSheet { query in
                await viewModel.searchKnowledge(query: query)
            } onPick: { result in
                pendingEditorCommand = .init(kind: .insertWikiLink(title: result.title, replaceRange: viewModel.currentWikiLinkContext?.replaceRange))
                showingLinkPicker = false
            }
        }
        .sheet(item: conflictBinding) { conflict in
            KnowledgeConflictSheet(conflict: conflict) {
                viewModel.acceptRemoteConflictVersion()
            } onKeepLocal: {
                viewModel.keepLocalConflictDraft()
            }
        }
        .photosPicker(isPresented: $showingPhotoPicker, selection: $selectedPhotoItem, matching: .images)
        .sheet(isPresented: $showingCamera) {
            KnowledgeCameraImagePicker { image in
                Task {
                    if let data = image.jpegData(compressionQuality: 0.92) {
                        await insertImage(data: data, mimeType: "image/jpeg", fileName: "photo-\(Int(Date().timeIntervalSince1970)).jpg")
                    }
                }
            }
        }
        .alert("Delete note?", isPresented: $showingDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    if await viewModel.delete() {
                        dismiss()
                    }
                }
            }
        } message: {
            Text("Delete \(viewModel.title)?")
        }
        .overlay(alignment: .bottom) {
            if let message = viewModel.errorMessage {
                ErrorBanner(message: message)
                    .padding()
            }
        }
        .onChange(of: editorSelection) { _, newValue in
            viewModel.updateSelection(newValue)
        }
        .onChange(of: viewModel.draft) { _, _ in
            refreshFindMatches(selectFirst: false)
        }
        .onChange(of: findQuery) { _, _ in
            refreshFindMatches(selectFirst: true)
        }
        .onChange(of: selectedPhotoItem) { _, item in
            guard let item else {
                return
            }
            Task {
                defer { selectedPhotoItem = nil }
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    return
                }
                let mimeType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
                let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                await insertImage(data: data, mimeType: mimeType, fileName: "photo-\(Int(Date().timeIntervalSince1970)).\(ext)")
            }
        }
        .onChange(of: scenePhase) { _, newValue in
            if newValue == .inactive || newValue == .background {
                Task {
                    _ = await viewModel.flushAutosaveIfNeeded()
                }
            }
        }
        .task(id: viewModel.fileId) {
            if viewModel.content.isEmpty && viewModel.draft.isEmpty {
                viewModel.load()
            }
        }
        .onDisappear {
            viewModel.stop()
        }
    }

    private func refreshFindMatches(selectFirst: Bool) {
        findMatches = knowledgeFindRanges(of: findQuery, in: viewModel.draft)
        if findMatches.isEmpty {
            currentFindMatchIndex = 0
            return
        }
        currentFindMatchIndex = min(currentFindMatchIndex, max(0, findMatches.count - 1))
        if selectFirst {
            currentFindMatchIndex = 0
            pendingEditorCommand = .init(kind: .select(findMatches[currentFindMatchIndex]))
        }
    }

    private func navigateFindMatchForward() {
        guard !findMatches.isEmpty else {
            return
        }
        currentFindMatchIndex = (currentFindMatchIndex + 1) % findMatches.count
        pendingEditorCommand = .init(kind: .select(findMatches[currentFindMatchIndex]))
    }

    private func navigateFindMatchBackward() {
        guard !findMatches.isEmpty else {
            return
        }
        currentFindMatchIndex = (currentFindMatchIndex - 1 + findMatches.count) % findMatches.count
        pendingEditorCommand = .init(kind: .select(findMatches[currentFindMatchIndex]))
    }

    private func prepareLinkComposer() {
        linkDraft = KnowledgeLinkComposerDraft(
            label: selectedText.nilIfBlank ?? viewModel.title,
            destination: UIPasteboard.general.url?.absoluteString ?? ""
        )
        showingLinkComposer = true
    }

    private func pasteClipboardImage() {
        guard let image = UIPasteboard.general.image,
              let data = image.pngData() else {
            return
        }
        Task {
            await insertImage(data: data, mimeType: "image/png", fileName: "clipboard-image.png")
        }
    }

    private func insertImage(data: Data, mimeType: String?, fileName: String?) async {
        guard let markdown = await viewModel.createImageMarkdown(data: data, mimeType: mimeType, fileName: fileName) else {
            return
        }
        let insertion = editorSelection.location > 0 ? "\n\n\(markdown)\n" : "\(markdown)\n"
        pendingEditorCommand = .init(kind: .insertText(insertion))
    }
}

private struct KnowledgeFindBar: View {
    @Binding var query: String
    let matchCount: Int
    let currentMatchIndex: Int
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(CompanionTheme.textSecondary)
            TextField("Find in note", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !query.trimmed.isEmpty {
                Text(matchCount == 0 ? "No matches" : "\(currentMatchIndex)/\(matchCount)")
                    .font(.caption)
                    .foregroundStyle(CompanionTheme.textSecondary)
            }
            Button(action: onPrevious) {
                Image(systemName: "chevron.up")
            }
            .disabled(matchCount == 0)
            Button(action: onNext) {
                Image(systemName: "chevron.down")
            }
            .disabled(matchCount == 0)
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(CompanionTheme.textSecondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(CompanionTheme.panel)
    }
}

private struct KnowledgeLinkComposerDraft {
    var label: String = ""
    var destination: String = ""
}

private struct KnowledgeLinkComposerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var draft: KnowledgeLinkComposerDraft
    let onSave: (String, String) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Link") {
                    TextField("Label", text: $draft.label)
                    TextField("https://example.com", text: $draft.destination)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                            .keyboardType(.URL)
                }
            }
            .navigationTitle("Insert link")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Insert") {
                        onSave(draft.label, draft.destination)
                        dismiss()
                    }
                    .disabled(draft.destination.trimmed.isEmpty)
                }
            }
        }
    }
}

private struct KnowledgeOutlineSheet: View {
    @Environment(\.dismiss) private var dismiss
    let headings: [KnowledgeHeadingItem]
    let onPick: (KnowledgeHeadingItem) -> Void

    var body: some View {
        NavigationStack {
            List(headings) { heading in
                Button {
                    onPick(heading)
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        Text(String(repeating: "#", count: heading.level))
                            .font(.caption.monospaced())
                            .foregroundStyle(CompanionTheme.textDim)
                        Text(heading.title)
                            .foregroundStyle(CompanionTheme.textPrimary)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(CompanionTheme.panel)
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .navigationTitle("Outline")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct KnowledgeConflictSheet: View {
    @Environment(\.dismiss) private var dismiss
    let conflict: KnowledgeNoteConflict
    let onUseRemote: () -> Void
    let onKeepLocal: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(conflict.reason)
                        .font(.body)
                    Group {
                        Text("Host version")
                            .font(.headline)
                        ScrollView(.horizontal, showsIndicators: false) {
                            Text(conflict.remoteContent)
                                .font(.system(.footnote, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(CompanionTheme.panel)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    }
                    Group {
                        Text("Local draft")
                            .font(.headline)
                        ScrollView(.horizontal, showsIndicators: false) {
                            Text(conflict.localDraft)
                                .font(.system(.footnote, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(CompanionTheme.panel)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    }
                }
                .padding(16)
            }
            .background(CompanionTheme.canvas)
            .navigationTitle("Resolve conflict")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Use host") {
                        onUseRemote()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Keep local") {
                        onKeepLocal()
                        dismiss()
                    }
                }
            }
        }
    }
}

private struct KnowledgeNoteLinkPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let search: (String) async -> [CompanionKnowledgeSearchResult]
    let onPick: (CompanionKnowledgeSearchResult) -> Void

    @State private var query = ""
    @State private var results: [CompanionKnowledgeSearchResult] = []
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List {
                if results.isEmpty && !isLoading {
                    ContentUnavailableView(
                        query.trimmed.isEmpty ? "No notes yet" : "No matching notes",
                        systemImage: "book.closed",
                        description: Text(query.trimmed.isEmpty ? "Create a note first, then link it here." : "Try a different note title or keyword.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(results) { result in
                        Button {
                            onPick(result)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.title)
                                    .foregroundStyle(CompanionTheme.textPrimary)
                                Text(result.excerpt)
                                    .font(.caption)
                                    .foregroundStyle(CompanionTheme.textSecondary)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(CompanionTheme.panel)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(CompanionTheme.canvas)
            .navigationTitle("Link to note")
            .searchable(text: $query, prompt: "Search notes")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task(id: query) {
                isLoading = true
                results = await search(query)
                isLoading = false
            }
        }
    }
}

private struct KnowledgeCameraImagePicker: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let onCapture: (UIImage) -> Void

        init(onCapture: @escaping (UIImage) -> Void) {
            self.onCapture = onCapture
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            picker.dismiss(animated: true)
        }
    }
}

private struct KnowledgeEditorCommand: Identifiable, Equatable {
    enum Kind: Equatable {
        case insertText(String)
        case replace(range: NSRange, text: String, selection: NSRange)
        case select(NSRange)
        case prefixCurrentLine(String)
        case prefixSelectedLines(String)
        case toggleChecklist
        case wrapSelection(prefix: String, suffix: String, placeholder: String)
        case insertMarkdownLink(label: String, url: String)
        case insertWikiLink(title: String, replaceRange: NSRange?)
        case indentSelection
        case outdentSelection
        case undo
        case redo
    }

    let id = UUID()
    let kind: Kind
}

struct KnowledgeTextMutation: Equatable {
    let text: String
    let selection: NSRange
}

private final class KnowledgeEditorTextView: UITextView {
    var onPasteImage: ((Data, String?, String?) -> Void)?

    override func paste(_ sender: Any?) {
        if let image = UIPasteboard.general.image,
           let data = image.pngData() {
            onPasteImage?(data, "image/png", "clipboard-image.png")
            return
        }
        super.paste(sender)
    }
}

private struct KnowledgeMarkdownTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var selectedRange: NSRange
    let command: KnowledgeEditorCommand?
    let onCommandHandled: (KnowledgeEditorCommand) -> Void
    let onPasteImage: (Data, String?, String?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> KnowledgeEditorTextView {
        let view = KnowledgeEditorTextView(frame: .zero)
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.autocorrectionType = .default
        view.smartDashesType = .no
        view.smartQuotesType = .no
        view.smartInsertDeleteType = .no
        view.adjustsFontForContentSizeCategory = true
        view.alwaysBounceVertical = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 16, right: 12)
        view.keyboardDismissMode = .interactive
        view.onPasteImage = onPasteImage
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleCheckboxTap(_:)))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
        context.coordinator.apply(text: text, selection: selectedRange, to: view)
        return view
    }

    func updateUIView(_ uiView: KnowledgeEditorTextView, context: Context) {
        context.coordinator.parent = self
        uiView.onPasteImage = onPasteImage
        if !context.coordinator.isApplyingProgrammaticChange,
           (uiView.text != text || uiView.selectedRange != selectedRange) {
            context.coordinator.apply(text: text, selection: selectedRange, to: uiView)
        }
        if let command, command.id != context.coordinator.lastHandledCommandId {
            context.coordinator.handle(command: command, in: uiView)
            onCommandHandled(command)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: KnowledgeMarkdownTextEditor
        var isApplyingProgrammaticChange = false
        var lastHandledCommandId: UUID?

        init(parent: KnowledgeMarkdownTextEditor) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            guard !isApplyingProgrammaticChange else {
                return
            }
            parent.text = textView.text
            parent.selectedRange = textView.selectedRange
            restyle(textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !isApplyingProgrammaticChange else {
                return
            }
            parent.selectedRange = textView.selectedRange
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            if replacement == "\n", let mutation = knowledgeSmartReturnMutation(text: textView.text, selectedRange: textView.selectedRange) {
                apply(mutation: mutation, to: textView)
                return false
            }
            if let mutation = knowledgeAutoPairMutation(text: textView.text, selectedRange: range, replacement: replacement) {
                apply(mutation: mutation, to: textView)
                return false
            }
            return true
        }

        @objc func handleCheckboxTap(_ recognizer: UITapGestureRecognizer) {
            guard let textView = recognizer.view as? UITextView else {
                return
            }
            let point = recognizer.location(in: textView)
            guard point.x <= 72 else {
                return
            }
            let adjustedPoint = CGPoint(x: point.x - textView.textContainerInset.left, y: point.y - textView.textContainerInset.top)
            let index = textView.layoutManager.characterIndex(for: adjustedPoint, in: textView.textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
            if let mutation = knowledgeToggleChecklistMutation(text: textView.text, selectedRange: NSRange(location: index, length: 0)) {
                apply(mutation: mutation, to: textView)
            }
        }

        func handle(command: KnowledgeEditorCommand, in textView: UITextView) {
            lastHandledCommandId = command.id
            switch command.kind {
            case .undo:
                textView.undoManager?.undo()
                parent.text = textView.text
                parent.selectedRange = textView.selectedRange
                restyle(textView)
            case .redo:
                textView.undoManager?.redo()
                parent.text = textView.text
                parent.selectedRange = textView.selectedRange
                restyle(textView)
            default:
                guard let mutation = knowledgeApplyEditorCommand(command.kind, text: textView.text, selectedRange: textView.selectedRange) else {
                    return
                }
                apply(mutation: mutation, to: textView)
            }
        }

        func apply(text: String, selection: NSRange, to textView: UITextView) {
            isApplyingProgrammaticChange = true
            textView.attributedText = knowledgeHighlightedAttributedText(text: text)
            textView.selectedRange = selection
            textView.typingAttributes = knowledgeTypingAttributes()
            isApplyingProgrammaticChange = false
        }

        func apply(mutation: KnowledgeTextMutation, to textView: UITextView) {
            isApplyingProgrammaticChange = true
            textView.attributedText = knowledgeHighlightedAttributedText(text: mutation.text)
            textView.selectedRange = mutation.selection
            textView.typingAttributes = knowledgeTypingAttributes()
            isApplyingProgrammaticChange = false
            parent.text = mutation.text
            parent.selectedRange = mutation.selection
            textView.scrollRangeToVisible(mutation.selection)
        }

        private func restyle(_ textView: UITextView) {
            let selection = textView.selectedRange
            isApplyingProgrammaticChange = true
            textView.attributedText = knowledgeHighlightedAttributedText(text: textView.text)
            textView.selectedRange = selection
            textView.typingAttributes = knowledgeTypingAttributes()
            isApplyingProgrammaticChange = false
        }
    }
}

private func knowledgeTypingAttributes() -> [NSAttributedString.Key: Any] {
    [
        .font: UIFont.monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize, weight: .regular),
        .foregroundColor: UIColor.label,
    ]
}

private func knowledgeHighlightedAttributedText(text: String) -> NSAttributedString {
    let baseFont = UIFont.monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize, weight: .regular)
    let attributed = NSMutableAttributedString(string: text, attributes: [
        .font: baseFont,
        .foregroundColor: UIColor.label,
    ])
    let fullRange = NSRange(location: 0, length: (text as NSString).length)

    if text.hasPrefix("---\n"), let endRange = text.range(of: "\n---", range: text.index(text.startIndex, offsetBy: 4)..<text.endIndex) {
        let nsRange = NSRange(text.startIndex..<endRange.upperBound, in: text)
        attributed.addAttributes([
            .foregroundColor: UIColor.secondaryLabel,
        ], range: nsRange)
    }

    let headingRegex = try? NSRegularExpression(pattern: #"^(#{1,6})\s+(.+)$"#, options: [.anchorsMatchLines])
    headingRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match, match.numberOfRanges >= 3 else { return }
        let level = max(1, min(6, match.range(at: 1).length))
        let size = max(baseFont.pointSize + CGFloat(8 - level), baseFont.pointSize)
        attributed.addAttributes([
            .font: UIFont.monospacedSystemFont(ofSize: size, weight: .semibold),
            .foregroundColor: UIColor.label,
        ], range: match.range)
    }

    let codeFenceRegex = try? NSRegularExpression(pattern: #"```[\s\S]*?```"#, options: [])
    codeFenceRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match else { return }
        attributed.addAttributes([
            .foregroundColor: UIColor.systemIndigo,
            .backgroundColor: UIColor.secondarySystemBackground,
        ], range: match.range)
    }

    let inlineCodeRegex = try? NSRegularExpression(pattern: #"`[^`\n]+`"#, options: [])
    inlineCodeRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match else { return }
        attributed.addAttributes([
            .foregroundColor: UIColor.systemIndigo,
            .backgroundColor: UIColor.tertiarySystemFill,
        ], range: match.range)
    }

    let linkRegex = try? NSRegularExpression(pattern: #"(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^\)]+\))"#, options: [])
    linkRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match else { return }
        attributed.addAttribute(.foregroundColor, value: UIColor.systemPurple, range: match.range)
    }

    let checklistRegex = try? NSRegularExpression(pattern: #"^\s*[-*+] \[( |x|X)\]"#, options: [.anchorsMatchLines])
    checklistRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match else { return }
        let checked = ((text as NSString).substring(with: match.range)).lowercased().contains("[x]")
        attributed.addAttribute(.foregroundColor, value: checked ? UIColor.systemGreen : UIColor.systemOrange, range: match.range)
    }

    let quoteRegex = try? NSRegularExpression(pattern: #"^>.*$"#, options: [.anchorsMatchLines])
    quoteRegex?.enumerateMatches(in: text, options: [], range: fullRange) { match, _, _ in
        guard let match else { return }
        attributed.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: match.range)
    }

    return attributed
}

private func knowledgeApplyEditorCommand(_ kind: KnowledgeEditorCommand.Kind, text: String, selectedRange: NSRange) -> KnowledgeTextMutation? {
    switch kind {
    case .insertText(let insertion):
        return knowledgeReplaceText(in: text, range: selectedRange, with: insertion, selectionAfterInsert: NSRange(location: selectedRange.location + insertion.utf16.count, length: 0))
    case .replace(let range, let replacement, let selection):
        return knowledgeReplaceText(in: text, range: range, with: replacement, selectionAfterInsert: selection)
    case .select(let range):
        return KnowledgeTextMutation(text: text, selection: range)
    case .prefixCurrentLine(let prefix):
        return knowledgePrefixLines(text: text, selectedRange: selectedRange, prefix: prefix, currentLineOnly: true)
    case .prefixSelectedLines(let prefix):
        return knowledgePrefixLines(text: text, selectedRange: selectedRange, prefix: prefix, currentLineOnly: false)
    case .toggleChecklist:
        return knowledgeToggleChecklistMutation(text: text, selectedRange: selectedRange)
    case .wrapSelection(let prefix, let suffix, let placeholder):
        return knowledgeWrapSelection(text: text, selectedRange: selectedRange, prefix: prefix, suffix: suffix, placeholder: placeholder)
    case .insertMarkdownLink(let label, let url):
        let effectiveLabel = label.trimmed.nilIfBlank ?? url
        return knowledgeWrapSelection(text: text, selectedRange: selectedRange, prefix: "[", suffix: "](\(url))", placeholder: effectiveLabel)
    case .insertWikiLink(let title, let replaceRange):
        let range = replaceRange ?? selectedRange
        let markup = "[[\(title)]]"
        let selection = NSRange(location: range.location + markup.utf16.count, length: 0)
        return knowledgeReplaceText(in: text, range: range, with: markup, selectionAfterInsert: selection)
    case .indentSelection:
        return knowledgeIndentLines(text: text, selectedRange: selectedRange, amount: 2)
    case .outdentSelection:
        return knowledgeOutdentLines(text: text, selectedRange: selectedRange, amount: 2)
    case .undo, .redo:
        return nil
    }
}

private func knowledgeReplaceText(in text: String, range: NSRange, with replacement: String, selectionAfterInsert: NSRange) -> KnowledgeTextMutation {
    let nsText = text as NSString
    let safeRange = knowledgeSafeRange(range, length: nsText.length)
    let updated = nsText.replacingCharacters(in: safeRange, with: replacement)
    let maxLocation = (updated as NSString).length
    let safeSelection = knowledgeSafeRange(selectionAfterInsert, length: maxLocation)
    return KnowledgeTextMutation(text: updated, selection: safeSelection)
}

private func knowledgeSafeRange(_ range: NSRange, length: Int) -> NSRange {
    let location = min(max(0, range.location), length)
    let safeLength = min(max(0, range.length), length - location)
    return NSRange(location: location, length: safeLength)
}

private func knowledgeCurrentLineContentRange(in nsText: NSString, selectedRange: NSRange) -> NSRange {
    let rawRange = nsText.lineRange(for: selectedRange)
    let rawLine = nsText.substring(with: rawRange)
    if rawLine.hasSuffix("\r\n") {
        return NSRange(location: rawRange.location, length: max(0, rawRange.length - 2))
    }
    if rawLine.hasSuffix("\n") || rawLine.hasSuffix("\r") {
        return NSRange(location: rawRange.location, length: max(0, rawRange.length - 1))
    }
    return rawRange
}

private func knowledgeWrapSelection(text: String, selectedRange: NSRange, prefix: String, suffix: String, placeholder: String) -> KnowledgeTextMutation {
    let nsText = text as NSString
    let safeRange = knowledgeSafeRange(selectedRange, length: nsText.length)
    let selected = safeRange.length > 0 ? nsText.substring(with: safeRange) : placeholder
    let replacement = "\(prefix)\(selected)\(suffix)"
    let selection: NSRange
    if safeRange.length > 0 {
        selection = NSRange(location: safeRange.location + prefix.utf16.count, length: selected.utf16.count)
    } else {
        selection = NSRange(location: safeRange.location + prefix.utf16.count, length: selected.utf16.count)
    }
    return knowledgeReplaceText(in: text, range: safeRange, with: replacement, selectionAfterInsert: selection)
}

private func knowledgePrefixLines(text: String, selectedRange: NSRange, prefix: String, currentLineOnly: Bool) -> KnowledgeTextMutation {
    let nsText = text as NSString
    let baseRange = knowledgeSafeRange(selectedRange, length: nsText.length)
    let anchorRange = currentLineOnly
        ? NSRange(location: baseRange.location, length: 0)
        : baseRange
    let lineRange = knowledgeCurrentLineContentRange(in: nsText, selectedRange: anchorRange)
    let lineText = nsText.substring(with: lineRange)
    let lines = lineText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let replacement = lines.map { "\(prefix)\($0)" }.joined(separator: "\n")
    let selection = NSRange(location: lineRange.location, length: min((replacement as NSString).length, max((replacement as NSString).length, baseRange.length + prefix.utf16.count)))
    return knowledgeReplaceText(in: text, range: lineRange, with: replacement, selectionAfterInsert: selection)
}

private func knowledgeIndentLines(text: String, selectedRange: NSRange, amount: Int) -> KnowledgeTextMutation {
    knowledgePrefixLines(text: text, selectedRange: selectedRange, prefix: String(repeating: " ", count: amount), currentLineOnly: false)
}

private func knowledgeOutdentLines(text: String, selectedRange: NSRange, amount: Int) -> KnowledgeTextMutation {
    let nsText = text as NSString
    let safeRange = knowledgeSafeRange(selectedRange, length: nsText.length)
    let lineRange = knowledgeCurrentLineContentRange(in: nsText, selectedRange: safeRange)
    let lineText = nsText.substring(with: lineRange)
    let lines = lineText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    let transformed = lines.map { line -> String in
        if line.hasPrefix(String(repeating: " ", count: amount)) {
            return String(line.dropFirst(amount))
        }
        if line.hasPrefix("\t") {
            return String(line.dropFirst())
        }
        return line
    }
    let replacement = transformed.joined(separator: "\n")
    return knowledgeReplaceText(in: text, range: lineRange, with: replacement, selectionAfterInsert: NSRange(location: lineRange.location, length: min((replacement as NSString).length, safeRange.length)))
}

func knowledgeToggleChecklistMutation(text: String, selectedRange: NSRange) -> KnowledgeTextMutation? {
    let nsText = text as NSString
    let safeRange = knowledgeSafeRange(selectedRange, length: nsText.length)
    let lineRange = knowledgeCurrentLineContentRange(in: nsText, selectedRange: safeRange)
    let line = nsText.substring(with: lineRange)
    if let range = line.range(of: #"^(\s*[-*+] )\[( |x|X)\]"#, options: .regularExpression) {
        let prefix = String(line[..<range.lowerBound])
        let marker = String(line[range])
        let toggled = marker.lowercased().contains("[x]")
            ? marker.replacingOccurrences(of: #"\[(x|X)\]"#, with: "[ ]", options: .regularExpression)
            : marker.replacingOccurrences(of: "[ ]", with: "[x]")
        let suffix = String(line[range.upperBound...])
        let replacement = "\(prefix)\(toggled)\(suffix)"
        return knowledgeReplaceText(in: text, range: lineRange, with: replacement, selectionAfterInsert: NSRange(location: lineRange.location, length: replacement.utf16.count))
    }
    let replacement = line.isEmpty ? "- [ ] " : "- [ ] \(line)"
    return knowledgeReplaceText(in: text, range: lineRange, with: replacement, selectionAfterInsert: NSRange(location: lineRange.location + replacement.utf16.count, length: 0))
}

private func knowledgeAutoPairMutation(text: String, selectedRange: NSRange, replacement: String) -> KnowledgeTextMutation? {
    let pairs = ["[": "]", "(": ")", "{": "}", "\"": "\""]
    guard let closing = pairs[replacement] else {
        return nil
    }
    return knowledgeWrapSelection(text: text, selectedRange: selectedRange, prefix: replacement, suffix: closing, placeholder: "")
}

func knowledgeSmartReturnMutation(text: String, selectedRange: NSRange) -> KnowledgeTextMutation? {
    guard selectedRange.length == 0 else {
        return nil
    }
    let nsText = text as NSString
    let safeRange = knowledgeSafeRange(selectedRange, length: nsText.length)
    let rawLineRange = nsText.lineRange(for: safeRange)
    let lineRange = knowledgeCurrentLineContentRange(in: nsText, selectedRange: safeRange)
    let line = nsText.substring(with: lineRange)
    let linePrefixRange = NSRange(location: lineRange.location, length: max(0, safeRange.location - lineRange.location))
    let prefixText = nsText.substring(with: knowledgeSafeRange(linePrefixRange, length: nsText.length))
    let fencePrefix = text.prefix(safeRange.location)
    let codeFenceCount = fencePrefix.components(separatedBy: "```").count - 1
    if codeFenceCount % 2 == 1 {
        let indentation = prefixText.prefix { $0 == " " || $0 == "\t" }
        let insertion = "\n\(indentation)"
        return knowledgeReplaceText(in: text, range: safeRange, with: insertion, selectionAfterInsert: NSRange(location: safeRange.location + insertion.utf16.count, length: 0))
    }
    if let match = line.firstMatch(of: /^(\s*[-*+] )\[( |x|X)\](\s*)(.*)$/) {
        let indent = String(match.output.1)
        let spacer = String(match.output.3)
        let remainder = String(match.output.4).trimmed
        if remainder.isEmpty {
            return knowledgeReplaceText(in: text, range: rawLineRange, with: "\n", selectionAfterInsert: NSRange(location: rawLineRange.location + 1, length: 0))
        }
        let insertion = "\n\(indent)[ ]\(spacer)"
        return knowledgeReplaceText(in: text, range: safeRange, with: insertion, selectionAfterInsert: NSRange(location: safeRange.location + insertion.utf16.count, length: 0))
    }
    if let match = line.firstMatch(of: /^(\s*)([-*+])\s+(.*)$/) {
        let indent = String(match.output.1)
        let bullet = String(match.output.2)
        let remainder = String(match.output.3).trimmed
        if remainder.isEmpty {
            return knowledgeReplaceText(in: text, range: rawLineRange, with: "\n", selectionAfterInsert: NSRange(location: rawLineRange.location + 1, length: 0))
        }
        let insertion = "\n\(indent)\(bullet) "
        return knowledgeReplaceText(in: text, range: safeRange, with: insertion, selectionAfterInsert: NSRange(location: safeRange.location + insertion.utf16.count, length: 0))
    }
    if let match = line.firstMatch(of: /^(\s*)(\d+)\.\s+(.*)$/) {
        let indent = String(match.output.1)
        let number = (Int(match.output.2) ?? 0) + 1
        let remainder = String(match.output.3).trimmed
        if remainder.isEmpty {
            return knowledgeReplaceText(in: text, range: rawLineRange, with: "\n", selectionAfterInsert: NSRange(location: rawLineRange.location + 1, length: 0))
        }
        let insertion = "\n\(indent)\(number). "
        return knowledgeReplaceText(in: text, range: safeRange, with: insertion, selectionAfterInsert: NSRange(location: safeRange.location + insertion.utf16.count, length: 0))
    }
    if let match = line.firstMatch(of: /^(\s*(?:>\s*)+)(.*)$/) {
        let quotePrefix = String(match.output.1)
        let remainder = String(match.output.2).trimmed
        if remainder.isEmpty {
            return knowledgeReplaceText(in: text, range: rawLineRange, with: "\n", selectionAfterInsert: NSRange(location: rawLineRange.location + 1, length: 0))
        }
        let insertion = "\n\(quotePrefix)"
        return knowledgeReplaceText(in: text, range: safeRange, with: insertion, selectionAfterInsert: NSRange(location: safeRange.location + insertion.utf16.count, length: 0))
    }
    return nil
}

struct ConversationRowPresentation {
    let session: SessionMeta
    var includeCwdInSubtitle = true

    var hasUnreadMessages: Bool {
        let unreadCount = max(session.attentionUnreadMessageCount ?? 0, session.attentionUnreadActivityCount ?? 0)
        return unreadCount > 0 || session.needsAttention == true
    }

    var showsRunningIndicator: Bool {
        session.isRunning == true
    }

    var subtitle: String? {
        let fragments = [
            includeCwdInSubtitle ? session.cwdDisplayName : nil,
            session.remoteHostLabel?.nilIfBlank,
            session.automationTitle?.nilIfBlank.map { "Auto: \($0)" },
        ].compactMap { $0 }
        return fragments.isEmpty ? nil : fragments.joined(separator: " · ")
    }
}

private struct ConversationRow: View {
    let session: SessionMeta
    var includeCwdInSubtitle = true

    private var presentation: ConversationRowPresentation {
        ConversationRowPresentation(session: session, includeCwdInSubtitle: includeCwdInSubtitle)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(session.title)
                .font(.headline)
                .foregroundStyle(CompanionTheme.textPrimary)
                .lineLimit(2)

            HStack(alignment: .center, spacing: 8) {
                if let subtitle = presentation.subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(CompanionTheme.textSecondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Text(formatRelativeCompanionDate(session.lastActivityAt ?? session.timestamp))
                    .font(.caption)
                    .foregroundStyle(CompanionTheme.textDim)

                if presentation.hasUnreadMessages {
                    Circle()
                        .fill(CompanionTheme.accent)
                        .frame(width: 8, height: 8)
                }

                if presentation.showsRunningIndicator {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(.orange)
                            .frame(width: 8, height: 8)
                        Text("Running")
                            .font(.caption2.weight(.semibold))
                    }
                    .foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 2)
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
                    if let deliverAs = task.conversationBehavior?.nilIfBlank {
                        LabeledContent("Deliver as") { Text(deliverAs) }
                    }
                    if let model = task.model?.nilIfBlank {
                        LabeledContent("Model") { Text(model) }
                    }
                    if let cwd = task.cwd?.nilIfBlank {
                        LabeledContent("Cwd") { Text(cwd).multilineTextAlignment(.trailing) }
                    }
                }
                if let callbackConversationId = task.callbackConversationId?.nilIfBlank {
                    Section("Callback") {
                        LabeledContent("Conversation") { Text(callbackConversationId) }
                        LabeledContent("Deliver on success") { Text((task.deliverOnSuccess ?? true) ? "Yes" : "No") }
                        LabeledContent("Deliver on failure") { Text((task.deliverOnFailure ?? true) ? "Yes" : "No") }
                        if let notifyOnSuccess = task.notifyOnSuccess?.nilIfBlank {
                            LabeledContent("Notify on success") { Text(notifyOnSuccess) }
                        }
                        if let notifyOnFailure = task.notifyOnFailure?.nilIfBlank {
                            LabeledContent("Notify on failure") { Text(notifyOnFailure) }
                        }
                        LabeledContent("Require ack") { Text((task.requireAck ?? true) ? "Yes" : "No") }
                        LabeledContent("Auto resume") { Text((task.autoResumeIfOpen ?? true) ? "Yes" : "No") }
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
        if let models = session.modelState?.models, !models.isEmpty {
            var options = [CompanionPickerOption(value: "", label: "Host default")]
            options += models.map { CompanionPickerOption(value: $0.id, label: $0.name) }
            if let current = draft.model.nilIfBlank, !options.contains(where: { $0.value == current }) {
                options.append(CompanionPickerOption(value: current, label: current))
            }
            return options
        }
        return companionModelOptions(current: draft.model, defaultLabel: "Host default")
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
                        Picker("Deliver as", selection: $draft.conversationBehavior) {
                            Text("Default").tag("")
                            Text("Steer").tag("steer")
                            Text("Follow up").tag("followUp")
                        }
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
                        AutomationCronScheduleEditor(cron: $draft.cron)
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
                if draft.targetType == "background-agent" {
                    Section("Callback") {
                        Toggle("Report back to conversation", isOn: Binding(
                            get: { draft.callbackConversationId.nilIfBlank != nil },
                            set: { enabled in
                                if enabled {
                                    draft.callbackConversationId = draft.callbackConversationId.nilIfBlank ?? session.sections.first?.sessions.first?.id ?? ""
                                } else {
                                    draft.callbackConversationId = ""
                                }
                            }
                        ))
                        if draft.callbackConversationId.nilIfBlank != nil {
                            Picker("Conversation", selection: $draft.callbackConversationId) {
                                Text("Choose conversation").tag("")
                                ForEach(Array(session.sessions.values).sorted { $0.title < $1.title }, id: \.id) { meta in
                                    Text(meta.title).tag(meta.id)
                                }
                            }
                            Toggle("Deliver on success", isOn: $draft.deliverOnSuccess)
                            Toggle("Deliver on failure", isOn: $draft.deliverOnFailure)
                            Picker("Notify on success", selection: $draft.notifyOnSuccess) {
                                Text("None").tag("none")
                                Text("Passive").tag("passive")
                                Text("Disruptive").tag("disruptive")
                            }
                            Picker("Notify on failure", selection: $draft.notifyOnFailure) {
                                Text("None").tag("none")
                                Text("Passive").tag("passive")
                                Text("Disruptive").tag("disruptive")
                            }
                            Toggle("Require acknowledgment", isOn: $draft.requireAck)
                            Toggle("Auto resume if open", isOn: $draft.autoResumeIfOpen)
                        }
                    }
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
    @State private var editingSshTarget: CompanionSshTargetRecord?
    @State private var showingNewSshTarget = false
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

                Section("Execution targets") {
                    ForEach(session.sshTargets) { target in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(target.label)
                                Text(target.sshTarget)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Menu {
                                Button("Test") {
                                    Task {
                                        if let result = await session.testSshTarget(target.sshTarget) {
                                            appModel.bannerMessage = result.message
                                        }
                                    }
                                }
                                Button("Edit") {
                                    editingSshTarget = target
                                }
                                Button("Delete", role: .destructive) {
                                    Task {
                                        _ = await session.deleteSshTarget(target.id)
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Button("Add SSH target") {
                        showingNewSshTarget = true
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
            .sheet(item: $editingSshTarget) { target in
                SshTargetEditorView(target: target) { id, label, sshTarget in
                    _ = await session.saveSshTarget(id: id, label: label, sshTarget: sshTarget)
                }
            }
            .sheet(isPresented: $showingNewSshTarget) {
                SshTargetEditorView(target: nil) { id, label, sshTarget in
                    _ = await session.saveSshTarget(id: id, label: label, sshTarget: sshTarget)
                }
            }
        }
    }

    private func reload() async {
        isLoading = true
        _ = await session.listSshTargets()
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

private struct SshTargetEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let target: CompanionSshTargetRecord?
    let onSave: (String?, String, String) async -> Void

    @State private var id: String
    @State private var label: String
    @State private var sshTarget: String

    init(target: CompanionSshTargetRecord?, onSave: @escaping (String?, String, String) async -> Void) {
        self.target = target
        self.onSave = onSave
        _id = State(initialValue: target?.id ?? "")
        _label = State(initialValue: target?.label ?? "")
        _sshTarget = State(initialValue: target?.sshTarget ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Target id", text: $id)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Label", text: $label)
                TextField("user@buildbox", text: $sshTarget)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .navigationTitle(target == nil ? "Add SSH target" : "Edit SSH target")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await onSave(id.nilIfBlank, label, sshTarget)
                            dismiss()
                        }
                    }
                    .disabled(id.trimmed.isEmpty || label.trimmed.isEmpty || sshTarget.trimmed.isEmpty)
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

private enum AutomationCronScheduleKind: String, CaseIterable, Identifiable {
    case hourly
    case daily
    case weekdays
    case weekly
    case monthly
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .hourly: "Hourly"
        case .daily: "Daily"
        case .weekdays: "Weekdays"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .custom: "Custom cron"
        }
    }
}

private struct AutomationCronScheduleEditor: View {
    @Binding var cron: String

    private var selection: Binding<AutomationCronScheduleKind> {
        Binding(
            get: { Self.kind(for: cron) },
            set: { kind in
                cron = Self.defaultCron(for: kind, currentCron: cron)
            }
        )
    }

    private var time: Binding<Date> {
        Binding(
            get: { Self.date(hour: Self.cronParts(cron)?.hour ?? 9, minute: Self.cronParts(cron)?.minute ?? 0) },
            set: { date in
                let components = Calendar.current.dateComponents([.hour, .minute], from: date)
                updateCron(hour: components.hour ?? 9, minute: components.minute ?? 0)
            }
        )
    }

    private var minute: Binding<Int> {
        Binding(
            get: { Self.cronParts(cron)?.minute ?? 0 },
            set: { updateCron(minute: $0) }
        )
    }

    private var weekday: Binding<Int> {
        Binding(
            get: { Self.cronParts(cron)?.weekday ?? 1 },
            set: { updateCron(weekday: $0) }
        )
    }

    private var dayOfMonth: Binding<Int> {
        Binding(
            get: { Self.cronParts(cron)?.dayOfMonth ?? 1 },
            set: { updateCron(dayOfMonth: $0) }
        )
    }

    var body: some View {
        Picker("Repeats", selection: selection) {
            ForEach(AutomationCronScheduleKind.allCases) { kind in
                Text(kind.label).tag(kind)
            }
        }

        switch selection.wrappedValue {
        case .hourly:
            Picker("Minute", selection: minute) {
                ForEach([0, 15, 30, 45], id: \.self) { value in
                    Text(":\(String(format: "%02d", value))").tag(value)
                }
            }
        case .daily, .weekdays:
            DatePicker("Time", selection: time, displayedComponents: .hourAndMinute)
        case .weekly:
            Picker("Day", selection: weekday) {
                ForEach(Self.weekdayOptions, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            DatePicker("Time", selection: time, displayedComponents: .hourAndMinute)
        case .monthly:
            Picker("Day", selection: dayOfMonth) {
                ForEach(1...28, id: \.self) { value in
                    Text("Day \(value)").tag(value)
                }
            }
            DatePicker("Time", selection: time, displayedComponents: .hourAndMinute)
        case .custom:
            TextField("0 9 * * 1-5", text: $cron)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(.body, design: .monospaced))
            Text("Use custom only for schedules the simple editor cannot describe.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }

        Text("Runs \(Self.summary(for: cron))")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private func updateCron(hour: Int? = nil, minute: Int? = nil, weekday: Int? = nil, dayOfMonth: Int? = nil) {
        let parts = Self.cronParts(cron)
        let resolvedHour = hour ?? parts?.hour ?? 9
        let resolvedMinute = minute ?? parts?.minute ?? 0
        let resolvedWeekday = weekday ?? parts?.weekday ?? 1
        let resolvedDayOfMonth = dayOfMonth ?? parts?.dayOfMonth ?? 1

        switch selection.wrappedValue {
        case .hourly:
            cron = "\(resolvedMinute) * * * *"
        case .daily:
            cron = "\(resolvedMinute) \(resolvedHour) * * *"
        case .weekdays:
            cron = "\(resolvedMinute) \(resolvedHour) * * 1-5"
        case .weekly:
            cron = "\(resolvedMinute) \(resolvedHour) * * \(resolvedWeekday)"
        case .monthly:
            cron = "\(resolvedMinute) \(resolvedHour) \(resolvedDayOfMonth) * *"
        case .custom:
            break
        }
    }

    private static let weekdayOptions: [(value: Int, label: String)] = [
        (0, "Sunday"),
        (1, "Monday"),
        (2, "Tuesday"),
        (3, "Wednesday"),
        (4, "Thursday"),
        (5, "Friday"),
        (6, "Saturday")
    ]

    private static func kind(for cron: String) -> AutomationCronScheduleKind {
        guard let parts = cronParts(cron) else {
            return .custom
        }
        if parts.hourText == "*", parts.dayOfMonthText == "*", parts.monthText == "*", parts.weekdayText == "*" {
            return .hourly
        }
        if parts.dayOfMonthText == "*", parts.monthText == "*", parts.weekdayText == "*" {
            return .daily
        }
        if parts.dayOfMonthText == "*", parts.monthText == "*", parts.weekdayText == "1-5" {
            return .weekdays
        }
        if parts.dayOfMonthText == "*", parts.monthText == "*", parts.weekday != nil {
            return .weekly
        }
        if parts.dayOfMonth != nil, parts.monthText == "*", parts.weekdayText == "*" {
            return .monthly
        }
        return .custom
    }

    private static func defaultCron(for kind: AutomationCronScheduleKind, currentCron: String) -> String {
        let parts = cronParts(currentCron)
        let minute = parts?.minute ?? 0
        let hour = parts?.hour ?? 9
        switch kind {
        case .hourly:
            return "\(minute) * * * *"
        case .daily:
            return "\(minute) \(hour) * * *"
        case .weekdays:
            return "\(minute) \(hour) * * 1-5"
        case .weekly:
            return "\(minute) \(hour) * * \(parts?.weekday ?? 1)"
        case .monthly:
            return "\(minute) \(hour) \(parts?.dayOfMonth ?? 1) * *"
        case .custom:
            return currentCron.nilIfBlank ?? "0 9 * * 1-5"
        }
    }

    private static func summary(for cron: String) -> String {
        guard let parts = cronParts(cron) else {
            return "on the custom cron schedule"
        }
        let time = String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
        switch kind(for: cron) {
        case .hourly:
            return String(format: "hourly at :%02d", parts.minute ?? 0)
        case .daily:
            return "daily at \(time)"
        case .weekdays:
            return "weekdays at \(time)"
        case .weekly:
            let label = weekdayOptions.first(where: { $0.value == parts.weekday })?.label ?? "weekly"
            return "every \(label) at \(time)"
        case .monthly:
            return "monthly on day \(parts.dayOfMonth ?? 1) at \(time)"
        case .custom:
            return "on \(cron)"
        }
    }

    private static func date(hour: Int, minute: Int) -> Date {
        Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
    }

    private static func cronParts(_ cron: String) -> (minuteText: String, hourText: String, dayOfMonthText: String, monthText: String, weekdayText: String, minute: Int?, hour: Int?, dayOfMonth: Int?, weekday: Int?)? {
        let fields = cron.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").map(String.init)
        guard fields.count == 5 else {
            return nil
        }
        return (
            minuteText: fields[0],
            hourText: fields[1],
            dayOfMonthText: fields[2],
            monthText: fields[3],
            weekdayText: fields[4],
            minute: Int(fields[0]),
            hour: Int(fields[1]),
            dayOfMonth: Int(fields[2]),
            weekday: Int(fields[4])
        )
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
        self.conversationBehavior = detail.conversationBehavior ?? ""
        self.callbackConversationId = detail.callbackConversationId ?? ""
        self.deliverOnSuccess = detail.deliverOnSuccess ?? true
        self.deliverOnFailure = detail.deliverOnFailure ?? true
        self.notifyOnSuccess = detail.notifyOnSuccess ?? "disruptive"
        self.notifyOnFailure = detail.notifyOnFailure ?? "disruptive"
        self.requireAck = detail.requireAck ?? true
        self.autoResumeIfOpen = detail.autoResumeIfOpen ?? true
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
    @State private var errorMessage: String?

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
                        errorMessage = nil
                        showingScanner = true
                    } label: {
                        Label("Scan setup QR", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(isPairing)
                }
                if isPairing {
                    Section {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Pairing host…")
                                .foregroundStyle(.secondary)
                        }
                    }
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
                onScanSetupLink: { setupLink in
                    baseURL = setupLink.baseURL
                    code = setupLink.code
                    Task {
                        await submitSetupLinkPairing(setupLink)
                    }
                },
                onError: { message in
                    errorMessage = message
                }
            )
        }
        .alert("Companion", isPresented: Binding(get: {
            errorMessage != nil
        }, set: { newValue in
            if !newValue {
                errorMessage = nil
            }
        })) {
            Button("OK", role: .cancel) {
                errorMessage = nil
            }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func submitSetupLinkPairing(_ setupLink: CompanionSetupLink) async {
        await performPairing {
            await appModel.pairSetupLink(setupLink, deviceLabel: deviceLabel)
        }
    }

    private func submitManualPairing() async {
        await performPairing {
            await appModel.pairHost(baseURLString: baseURL, code: code, deviceLabel: deviceLabel)
        }
    }

    private func performPairing(_ action: () async -> Void) async {
        errorMessage = nil
        appModel.bannerMessage = nil
        isPairing = true
        await action()
        let nextBannerMessage = appModel.bannerMessage?.trimmed.nilIfBlank
        appModel.bannerMessage = nil
        isPairing = false

        if appModel.activeSession != nil {
            if let nextBannerMessage {
                appModel.bannerMessage = nextBannerMessage
            }
            dismiss()
            return
        }

        errorMessage = nextBannerMessage
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
    let onScanSetupLink: (CompanionSetupLink) -> Void
    let onError: (String) -> Void
    @State private var invalidQrMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    SetupQrScannerView(onScan: { rawValue in
                        guard let setupLink = CompanionSetupLink(rawString: rawValue) else {
                            invalidQrMessage = "That QR code is not a valid Personal Agent companion setup code."
                            return false
                        }
                        onScanSetupLink(setupLink)
                        dismiss()
                        return true
                    }, onError: { message in
                        onError(message)
                        dismiss()
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
        .alert("Companion", isPresented: Binding(get: {
            invalidQrMessage != nil
        }, set: { newValue in
            if !newValue {
                invalidQrMessage = nil
            }
        })) {
            Button("OK", role: .cancel) {
                invalidQrMessage = nil
            }
        } message: {
            Text(invalidQrMessage ?? "")
        }
    }
}

private struct SetupQrScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Bool
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
        var onScan: (String) -> Bool
        var onError: (String) -> Void
        var hasStarted = false
        private var hasScanned = false

        init(onScan: @escaping (String) -> Bool, onError: @escaping (String) -> Void) {
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
                guard onScan(payload) else {
                    continue
                }
                hasScanned = true
                dataScanner.stopScanning()
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
    let modelState: CompanionModelState?
    let onSubmit: (ConversationLaunchAction) async -> Void

    @State private var mode: Mode = .create
    @State private var createRequest = NewConversationRequest()
    @State private var resumeRequest = ResumeConversationRequest()
    @State private var isSubmitting = false

    private var createModelOptions: [CompanionPickerOption] {
        if let models = modelState?.models, !models.isEmpty {
            var options = [CompanionPickerOption(value: "", label: "Host default")]
            options += models.map { CompanionPickerOption(value: $0.id, label: $0.name) }
            if let current = createRequest.model.nilIfBlank, !options.contains(where: { $0.value == current }) {
                options.append(CompanionPickerOption(value: current, label: current))
            }
            return options
        }
        return companionModelOptions(current: createRequest.model, defaultLabel: "Host default")
    }

    private var createThinkingLevelOptions: [CompanionPickerOption] {
        companionThinkingLevelOptions(current: createRequest.thinkingLevel, unsetLabel: "Host default")
    }

    private var selectedCreateModel: CompanionModelInfo? {
        modelState?.models.first(where: { $0.id == createRequest.model })
    }

    private var createSupportsFastMode: Bool {
        companionSelectableServiceTierOptions(for: selectedCreateModel).contains(where: { $0.value == "priority" })
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
                        if createSupportsFastMode {
                            Toggle("Fast mode", isOn: createFastModeBinding)
                        }
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
