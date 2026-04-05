import Foundation
import AppKit
import ApplicationServices

struct AppTarget {
    let query: String
    let app: NSRunningApplication
    let axApplication: AXUIElement

    var displayName: String {
        app.localizedName ?? app.bundleIdentifier ?? "pid-\(app.processIdentifier)"
    }

    var cacheKey: String {
        let raw = app.bundleIdentifier ?? app.localizedName ?? "pid-\(app.processIdentifier)"
        return raw.map { character in
            if character.isLetter || character.isNumber || character == "-" || character == "_" || character == "." {
                return character
            }
            return "-"
        }.reduce(into: "") { partialResult, character in
            partialResult.append(character)
        }
    }
}

enum CLIError: LocalizedError {
    case usage(String)
    case message(String)

    var errorDescription: String? {
        switch self {
        case .usage(let message), .message(let message):
            return message
        }
    }
}

struct SnapshotCache: Codable {
    struct WindowRecord: Codable {
        let index: Int
        let title: String?
        let refCount: Int
    }

    struct NodeRecord: Codable {
        let ref: String
        let windowIndex: Int
        let path: [Int]
        let role: String?
        let label: String?
        let value: String?
        let identifier: String?
    }

    let appQuery: String
    let appName: String
    let bundleIdentifier: String?
    let processIdentifier: pid_t
    let createdAt: Date
    let windows: [WindowRecord]
    let nodes: [NodeRecord]
}

struct JSONWindowSummary: Encodable {
    let index: Int
    let title: String?
    let nodes: [JSONNodeSummary]
}

struct JSONNodeSummary: Encodable {
    let ref: String
    let path: [Int]
    let depth: Int
    let role: String?
    let roleDescription: String?
    let label: String?
    let value: String?
    let identifier: String?
    let enabled: Bool?
    let focused: Bool?
    let selected: Bool?
    let position: CGPoint?
    let size: CGSize?
}

struct SnapshotResult {
    struct WindowSummary {
        let index: Int
        let title: String?
        let nodes: [NodeSummary]
    }

    struct NodeSummary {
        let ref: String
        let path: [Int]
        let depth: Int
        let role: String?
        let roleDescription: String?
        let label: String?
        let value: String?
        let identifier: String?
        let enabled: Bool?
        let focused: Bool?
        let selected: Bool?
        let position: CGPoint?
        let size: CGSize?
    }

    final class LiveNode {
        let ref: String
        let windowIndex: Int
        let path: [Int]
        let depth: Int
        let element: AXUIElement
        let role: String?
        let roleDescription: String?
        let label: String?
        let value: String?
        let identifier: String?
        let enabled: Bool?
        let focused: Bool?
        let selected: Bool?
        let position: CGPoint?
        let size: CGSize?

        init(
            ref: String,
            windowIndex: Int,
            path: [Int],
            depth: Int,
            element: AXUIElement,
            role: String?,
            roleDescription: String?,
            label: String?,
            value: String?,
            identifier: String?,
            enabled: Bool?,
            focused: Bool?,
            selected: Bool?,
            position: CGPoint?,
            size: CGSize?
        ) {
            self.ref = ref
            self.windowIndex = windowIndex
            self.path = path
            self.depth = depth
            self.element = element
            self.role = role
            self.roleDescription = roleDescription
            self.label = label
            self.value = value
            self.identifier = identifier
            self.enabled = enabled
            self.focused = focused
            self.selected = selected
            self.position = position
            self.size = size
        }
    }

    let windows: [WindowSummary]
    let liveNodes: [LiveNode]
    let cache: SnapshotCache
}

enum Locator {
    case ref(String)
    case label(String)
    case identifier(String)
}

@main
struct MacAXCLI {
    static func main() {
        do {
            try run()
        } catch let error as CLIError {
            fputs("mac-ax: \(error.localizedDescription)\n", stderr)
            exit(1)
        } catch {
            fputs("mac-ax: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        var arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.isEmpty || arguments[0] == "help" || arguments[0] == "--help" || arguments[0] == "-h" {
            printUsage()
            return
        }

        let command = arguments.removeFirst()
        switch command {
        case "list-apps":
            try listApps()
        case "windows":
            guard let query = arguments.first else {
                throw CLIError.usage("Usage: mac-ax windows <app>")
            }
            try ensureAccessibility(prompt: true)
            try printWindows(for: resolveApp(query: query))
        case "snapshot":
            guard let query = arguments.first else {
                throw CLIError.usage("Usage: mac-ax snapshot <app> [--json]")
            }
            let json = arguments.dropFirst().contains("--json")
            try ensureAccessibility(prompt: true)
            let target = try resolveApp(query: query)
            let snapshot = try captureSnapshot(for: target)
            try writeSnapshotCache(snapshot.cache, cacheKey: target.cacheKey)
            if json {
                try printJSONSnapshot(snapshot)
            } else {
                printTextSnapshot(snapshot, target: target)
            }
        case "click":
            try ensureAccessibility(prompt: true)
            let parsed = try parseLocatorCommand(arguments: arguments, usage: "Usage: mac-ax click --app <app> (--id <ref> | --label <text> | --identifier <id>)")
            try click(locator: parsed.locator, appQuery: parsed.appQuery)
        case "focus":
            try ensureAccessibility(prompt: true)
            let parsed = try parseLocatorCommand(arguments: arguments, usage: "Usage: mac-ax focus --app <app> (--id <ref> | --label <text> | --identifier <id>)")
            try focus(locator: parsed.locator, appQuery: parsed.appQuery)
        case "set-value":
            try ensureAccessibility(prompt: true)
            let parsed = try parseSetValue(arguments: arguments)
            try setValue(locator: parsed.locator, appQuery: parsed.appQuery, value: parsed.value)
        case "type":
            try ensureAccessibility(prompt: true)
            let parsed = try parseAppAndTrailingValue(arguments: arguments, usage: "Usage: mac-ax type --app <app> <text>")
            try typeText(parsed.value, appQuery: parsed.appQuery)
        case "press":
            try ensureAccessibility(prompt: true)
            let parsed = try parseAppAndTrailingValue(arguments: arguments, usage: "Usage: mac-ax press --app <app> <key>")
            try pressKey(parsed.value, appQuery: parsed.appQuery)
        case "screenshot":
            let parsed = try parseAppAndTrailingValue(arguments: arguments, usage: "Usage: mac-ax screenshot --app <app> <path>")
            try takeScreenshot(appQuery: parsed.appQuery, outputPath: parsed.value)
        default:
            throw CLIError.usage("Unknown command: \(command)\n\n\(usageText())")
        }
    }
}

private extension MacAXCLI {
    static func usageText() -> String {
        """
        Usage:
          mac-ax list-apps
          mac-ax windows <app>
          mac-ax snapshot <app> [--json]
          mac-ax click --app <app> (--id <ref> | --label <text> | --identifier <id>)
          mac-ax focus --app <app> (--id <ref> | --label <text> | --identifier <id>)
          mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>
          mac-ax type --app <app> <text>
          mac-ax press --app <app> <key>
          mac-ax screenshot --app <app> <path>
        """
    }

    static func printUsage() {
        print(usageText())
    }

    static func ensureAccessibility(prompt: Bool) throws {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
            throw CLIError.message("Accessibility permission missing. Grant access to this helper in System Settings > Privacy & Security > Accessibility, then run the command again.")
        }
    }

    static func listApps() throws {
        let apps = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy != .prohibited }
            .sorted {
                let lhs = $0.localizedName ?? $0.bundleIdentifier ?? ""
                let rhs = $1.localizedName ?? $1.bundleIdentifier ?? ""
                return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
            }

        for app in apps {
            let name = app.localizedName ?? "(unknown)"
            let bundleIdentifier = app.bundleIdentifier ?? "-"
            print("\(name)\tpid=\(app.processIdentifier)\tbundle=\(bundleIdentifier)")
        }
    }

    static func resolveApp(query: String) throws -> AppTarget {
        let apps = NSWorkspace.shared.runningApplications
        let matchedApp: NSRunningApplication?

        if let pid = Int32(query) {
            matchedApp = apps.first { $0.processIdentifier == pid }
        } else {
            matchedApp = apps.first(where: { $0.bundleIdentifier == query })
                ?? apps.first(where: { ($0.localizedName ?? "").localizedCaseInsensitiveCompare(query) == .orderedSame })
                ?? apps.first(where: { ($0.bundleIdentifier ?? "").localizedCaseInsensitiveContains(query) })
                ?? apps.first(where: { ($0.localizedName ?? "").localizedCaseInsensitiveContains(query) })
        }

        guard let app = matchedApp else {
            throw CLIError.message("App not found: \(query)")
        }

        let axApplication = AXUIElementCreateApplication(app.processIdentifier)
        return AppTarget(query: query, app: app, axApplication: axApplication)
    }

    static func printWindows(for target: AppTarget) throws {
        let windows = try appWindows(for: target)
        guard !windows.isEmpty else {
            print("No windows found for \(target.displayName)")
            return
        }

        for (index, window) in windows.enumerated() {
            let title = bestLabel(for: window) ?? "(untitled)"
            let position = pointAttribute(window, attribute: kAXPositionAttribute as String)
            let size = sizeAttribute(window, attribute: kAXSizeAttribute as String)
            let focused = boolAttribute(window, attribute: kAXFocusedAttribute as String)
            let main = boolAttribute(window, attribute: kAXMainAttribute as String)
            var suffix: [String] = []
            if focused == true { suffix.append("focused") }
            if main == true { suffix.append("main") }
            let stateText = suffix.isEmpty ? "" : " {\(suffix.joined(separator: ", "))}"
            if let position, let size {
                print("\(index + 1). \"\(title)\" @ (\(Int(position.x)), \(Int(position.y))) size (\(Int(size.width))x\(Int(size.height)))\(stateText)")
            } else {
                print("\(index + 1). \"\(title)\"\(stateText)")
            }
        }
    }

    static func captureSnapshot(for target: AppTarget) throws -> SnapshotResult {
        let windows = try appWindows(for: target)
        guard !windows.isEmpty else {
            throw CLIError.message("No windows found for \(target.displayName)")
        }

        var nextID = 1
        var liveNodes: [SnapshotResult.LiveNode] = []
        var windowSummaries: [SnapshotResult.WindowSummary] = []
        var cacheWindows: [SnapshotCache.WindowRecord] = []
        var cacheNodes: [SnapshotCache.NodeRecord] = []
        let limits = TraversalLimits(maxDepth: 12, maxNodes: 4000)

        for (windowIndex, window) in windows.enumerated() {
            let title = bestLabel(for: window)
            let children = childElements(of: window)
            var nodeSummaries: [SnapshotResult.NodeSummary] = []
            let beforeCount = nextID
            for (childIndex, child) in children.enumerated() {
                nextID = try traverse(
                    element: child,
                    windowIndex: windowIndex,
                    path: [childIndex],
                    depth: 0,
                    nextID: nextID,
                    liveNodes: &liveNodes,
                    nodeSummaries: &nodeSummaries,
                    cacheNodes: &cacheNodes,
                    limits: limits
                )
            }
            let refCount = nextID - beforeCount
            cacheWindows.append(.init(index: windowIndex, title: title, refCount: refCount))
            windowSummaries.append(.init(index: windowIndex, title: title, nodes: nodeSummaries))
        }

        let cache = SnapshotCache(
            appQuery: target.query,
            appName: target.displayName,
            bundleIdentifier: target.app.bundleIdentifier,
            processIdentifier: target.app.processIdentifier,
            createdAt: Date(),
            windows: cacheWindows,
            nodes: cacheNodes
        )

        return SnapshotResult(windows: windowSummaries, liveNodes: liveNodes, cache: cache)
    }

    static func traverse(
        element: AXUIElement,
        windowIndex: Int,
        path: [Int],
        depth: Int,
        nextID: Int,
        liveNodes: inout [SnapshotResult.LiveNode],
        nodeSummaries: inout [SnapshotResult.NodeSummary],
        cacheNodes: inout [SnapshotCache.NodeRecord],
        limits: TraversalLimits
    ) throws -> Int {
        guard depth <= limits.maxDepth else {
            return nextID
        }
        guard liveNodes.count < limits.maxNodes else {
            return nextID
        }

        let role = stringAttribute(element, attribute: kAXRoleAttribute as String)
        let roleDescription = stringAttribute(element, attribute: kAXRoleDescriptionAttribute as String)
        let label = bestLabel(for: element)
        let value = bestValue(for: element)
        let identifier = stringAttribute(element, attribute: kAXIdentifierAttribute as String)
        let enabled = boolAttribute(element, attribute: kAXEnabledAttribute as String)
        let focused = boolAttribute(element, attribute: kAXFocusedAttribute as String)
        let selected = boolAttribute(element, attribute: kAXSelectedAttribute as String)
        let position = pointAttribute(element, attribute: kAXPositionAttribute as String)
        let size = sizeAttribute(element, attribute: kAXSizeAttribute as String)
        let ref = "e\(nextID)"

        let liveNode = SnapshotResult.LiveNode(
            ref: ref,
            windowIndex: windowIndex,
            path: path,
            depth: depth,
            element: element,
            role: role,
            roleDescription: roleDescription,
            label: label,
            value: value,
            identifier: identifier,
            enabled: enabled,
            focused: focused,
            selected: selected,
            position: position,
            size: size
        )
        liveNodes.append(liveNode)
        nodeSummaries.append(
            .init(
                ref: ref,
                path: path,
                depth: depth,
                role: role,
                roleDescription: roleDescription,
                label: label,
                value: value,
                identifier: identifier,
                enabled: enabled,
                focused: focused,
                selected: selected,
                position: position,
                size: size
            )
        )
        cacheNodes.append(
            .init(
                ref: ref,
                windowIndex: windowIndex,
                path: path,
                role: role,
                label: label,
                value: value,
                identifier: identifier
            )
        )

        var currentID = nextID + 1
        let children = childElements(of: element)
        for (childIndex, child) in children.enumerated() {
            currentID = try traverse(
                element: child,
                windowIndex: windowIndex,
                path: path + [childIndex],
                depth: depth + 1,
                nextID: currentID,
                liveNodes: &liveNodes,
                nodeSummaries: &nodeSummaries,
                cacheNodes: &cacheNodes,
                limits: limits
            )
        }

        return currentID
    }

    static func printTextSnapshot(_ snapshot: SnapshotResult, target: AppTarget) {
        print("App: \(target.displayName) (pid \(target.app.processIdentifier))")
        if let bundleIdentifier = target.app.bundleIdentifier {
            print("Bundle: \(bundleIdentifier)")
        }
        for window in snapshot.windows {
            let title = window.title ?? "(untitled)"
            print("Window \(window.index + 1): \"\(title)\"")
            if window.nodes.isEmpty {
                print("  (no accessible descendants found)")
                continue
            }
            for node in window.nodes {
                let indent = String(repeating: "  ", count: node.depth + 1)
                var line = "\(indent)\(node.ref) [\(prettyRole(node.role, description: node.roleDescription))]"
                if let identifier = node.identifier, !identifier.isEmpty {
                    line += " id=\(identifier)"
                }
                if let label = node.label, !label.isEmpty {
                    line += " \"\(escaped(label))\""
                }
                if let value = node.value, !value.isEmpty, value != node.label {
                    line += " value=\"\(escaped(value))\""
                }
                var flags: [String] = []
                if node.focused == true { flags.append("focused") }
                if node.selected == true { flags.append("selected") }
                if node.enabled == false { flags.append("disabled") }
                if !flags.isEmpty {
                    line += " {\(flags.joined(separator: ", "))}"
                }
                print(line)
            }
        }
    }

    static func printJSONSnapshot(_ snapshot: SnapshotResult) throws {
        let windows = snapshot.windows.map { window in
            JSONWindowSummary(
                index: window.index,
                title: window.title,
                nodes: window.nodes.map { node in
                    JSONNodeSummary(
                        ref: node.ref,
                        path: node.path,
                        depth: node.depth,
                        role: node.role,
                        roleDescription: node.roleDescription,
                        label: node.label,
                        value: node.value,
                        identifier: node.identifier,
                        enabled: node.enabled,
                        focused: node.focused,
                        selected: node.selected,
                        position: node.position,
                        size: node.size
                    )
                }
            )
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(windows)
        guard let text = String(data: data, encoding: .utf8) else {
            throw CLIError.message("Failed to encode snapshot JSON")
        }
        print(text)
    }

    static func parseLocatorCommand(arguments: [String], usage: String) throws -> (appQuery: String, locator: Locator) {
        var appQuery: String?
        var ref: String?
        var label: String?
        var identifier: String?
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--app":
                index += 1
                guard index < arguments.count else { throw CLIError.usage(usage) }
                appQuery = arguments[index]
            case "--id":
                index += 1
                guard index < arguments.count else { throw CLIError.usage(usage) }
                ref = arguments[index]
            case "--label":
                index += 1
                guard index < arguments.count else { throw CLIError.usage(usage) }
                label = arguments[index]
            case "--identifier":
                index += 1
                guard index < arguments.count else { throw CLIError.usage(usage) }
                identifier = arguments[index]
            default:
                throw CLIError.usage(usage)
            }
            index += 1
        }

        guard let appQuery else { throw CLIError.usage(usage) }
        let populated = [ref != nil, label != nil, identifier != nil].filter { $0 }.count
        guard populated == 1 else {
            throw CLIError.usage(usage)
        }
        if let ref {
            return (appQuery, .ref(ref))
        }
        if let label {
            return (appQuery, .label(label))
        }
        return (appQuery, .identifier(identifier!))
    }

    static func parseSetValue(arguments: [String]) throws -> (appQuery: String, locator: Locator, value: String) {
        var appQuery: String?
        var ref: String?
        var label: String?
        var identifier: String?
        var trailing: [String] = []
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--app":
                index += 1
                guard index < arguments.count else { throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>") }
                appQuery = arguments[index]
            case "--id":
                index += 1
                guard index < arguments.count else { throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>") }
                ref = arguments[index]
            case "--label":
                index += 1
                guard index < arguments.count else { throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>") }
                label = arguments[index]
            case "--identifier":
                index += 1
                guard index < arguments.count else { throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>") }
                identifier = arguments[index]
            default:
                trailing = Array(arguments[index...])
                index = arguments.count
                continue
            }
            index += 1
        }

        guard let appQuery, trailing.count == 1 else {
            throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>")
        }

        let populated = [ref != nil, label != nil, identifier != nil].filter { $0 }.count
        guard populated == 1 else {
            throw CLIError.usage("Usage: mac-ax set-value --app <app> (--id <ref> | --label <text> | --identifier <id>) <text>")
        }

        if let ref {
            return (appQuery, .ref(ref), trailing[0])
        }
        if let label {
            return (appQuery, .label(label), trailing[0])
        }
        return (appQuery, .identifier(identifier!), trailing[0])
    }

    static func parseAppAndTrailingValue(arguments: [String], usage: String) throws -> (appQuery: String, value: String) {
        guard arguments.count >= 3, arguments[0] == "--app" else {
            throw CLIError.usage(usage)
        }
        let appQuery = arguments[1]
        let trailing = Array(arguments.dropFirst(2))
        guard trailing.count == 1 else {
            throw CLIError.usage(usage)
        }
        return (appQuery, trailing[0])
    }

    static func click(locator: Locator, appQuery: String) throws {
        let target = try resolveApp(query: appQuery)
        let element = try resolveElement(locator: locator, target: target)
        _ = target.app.activate(options: [.activateIgnoringOtherApps])
        usleep(120_000)
        if performAction(.press, on: element) {
            print("Clicked \(describe(locator: locator)) in \(target.displayName)")
            return
        }
        if let point = clickableCenter(for: element) {
            try postMouseClick(at: point)
            print("Clicked \(describe(locator: locator)) in \(target.displayName)")
            return
        }
        throw CLIError.message("Element is not clickable: \(describe(locator: locator))")
    }

    static func focus(locator: Locator, appQuery: String) throws {
        let target = try resolveApp(query: appQuery)
        let element = try resolveElement(locator: locator, target: target)
        _ = target.app.activate(options: [.activateIgnoringOtherApps])
        usleep(120_000)
        if AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success {
            print("Focused \(describe(locator: locator)) in \(target.displayName)")
            return
        }
        if let point = clickableCenter(for: element) {
            try postMouseClick(at: point)
            print("Focused \(describe(locator: locator)) in \(target.displayName)")
            return
        }
        throw CLIError.message("Element cannot be focused: \(describe(locator: locator))")
    }

    static func setValue(locator: Locator, appQuery: String, value: String) throws {
        let target = try resolveApp(query: appQuery)
        let element = try resolveElement(locator: locator, target: target)
        _ = target.app.activate(options: [.activateIgnoringOtherApps])
        usleep(120_000)
        let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        guard result == .success else {
            throw CLIError.message("Failed to set value on \(describe(locator: locator)); accessibility result was \(result.rawValue)")
        }
        print("Updated value for \(describe(locator: locator)) in \(target.displayName)")
    }

    static func typeText(_ text: String, appQuery: String) throws {
        let target = try resolveApp(query: appQuery)
        _ = target.app.activate(options: [.activateIgnoringOtherApps])
        usleep(150_000)
        try postUnicodeText(text)
        print("Typed into \(target.displayName)")
    }

    static func pressKey(_ key: String, appQuery: String) throws {
        let target = try resolveApp(query: appQuery)
        _ = target.app.activate(options: [.activateIgnoringOtherApps])
        usleep(150_000)
        try postKeyPress(named: key)
        print("Pressed \(key) in \(target.displayName)")
    }

    static func takeScreenshot(appQuery: String, outputPath: String) throws {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
            throw CLIError.message("Screen Recording permission missing. Grant access to your terminal or wrapper in System Settings > Privacy & Security > Screen Recording, then run the command again.")
        }

        let target = try resolveApp(query: appQuery)
        let windows = try appWindows(for: target)
        guard !windows.isEmpty else {
            throw CLIError.message("No windows found for \(target.displayName)")
        }
        let desiredTitle = bestLabel(for: windows.first!)
        guard let windowNumber = frontmostWindowNumber(for: target.app.processIdentifier, title: desiredTitle) else {
            throw CLIError.message("Could not find an on-screen window for \(target.displayName). If Screen Recording permission is missing, macOS may also block the capture.")
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-l", String(windowNumber), outputURL.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw CLIError.message("screencapture failed with exit code \(process.terminationStatus)")
        }
        print(outputURL.path)
    }

    static func resolveElement(locator: Locator, target: AppTarget) throws -> AXUIElement {
        switch locator {
        case .ref(let ref):
            let cache = try readSnapshotCache(cacheKey: target.cacheKey)
            guard let record = cache.nodes.first(where: { $0.ref == ref }) else {
                throw CLIError.message("Stale ref: \(ref). Run snapshot again.")
            }
            let windows = try appWindows(for: target)
            guard record.windowIndex < windows.count else {
                throw CLIError.message("Stale ref: \(ref). Run snapshot again.")
            }
            var current = windows[record.windowIndex]
            for childIndex in record.path {
                let children = childElements(of: current)
                guard childIndex < children.count else {
                    throw CLIError.message("Stale ref: \(ref). Run snapshot again.")
                }
                current = children[childIndex]
            }
            return current
        case .label(let label):
            let snapshot = try captureSnapshot(for: target)
            let matches = snapshot.liveNodes.filter { $0.label == label }
            let match = try exactSingleMatch(matches: matches, locatorDescription: "label: \(label)")
            return match.element
        case .identifier(let identifier):
            let snapshot = try captureSnapshot(for: target)
            let matches = snapshot.liveNodes.filter { $0.identifier == identifier }
            let match = try exactSingleMatch(matches: matches, locatorDescription: "identifier: \(identifier)")
            return match.element
        }
    }

    static func exactSingleMatch(matches: [SnapshotResult.LiveNode], locatorDescription: String) throws -> SnapshotResult.LiveNode {
        guard !matches.isEmpty else {
            throw CLIError.message("No element matched \(locatorDescription)")
        }
        guard matches.count == 1 else {
            throw CLIError.message("Ambiguous locator: \(matches.count) elements matched \(locatorDescription)")
        }
        return matches[0]
    }
}

private struct TraversalLimits {
    let maxDepth: Int
    let maxNodes: Int
}

private func appWindows(for target: AppTarget) throws -> [AXUIElement] {
    if let windows = arrayAttribute(target.axApplication, attribute: kAXWindowsAttribute as String), !windows.isEmpty {
        return windows
    }
    if let focusedWindow = elementAttribute(target.axApplication, attribute: kAXFocusedWindowAttribute as String) {
        return [focusedWindow]
    }
    return []
}

private func childElements(of element: AXUIElement) -> [AXUIElement] {
    arrayAttribute(element, attribute: kAXChildrenAttribute as String) ?? []
}

private func arrayAttribute(_ element: AXUIElement, attribute: String) -> [AXUIElement]? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value else {
        return nil
    }
    return value as? [AXUIElement]
}

private func elementAttribute(_ element: AXUIElement, attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value else {
        return nil
    }
    return value as! AXUIElement?
}

private func stringAttribute(_ element: AXUIElement, attribute: String) -> String? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value else {
        return nil
    }
    if let string = value as? String, !string.isEmpty {
        return string
    }
    if let number = value as? NSNumber {
        return number.stringValue
    }
    return nil
}

private func boolAttribute(_ element: AXUIElement, attribute: String) -> Bool? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value else {
        return nil
    }
    if let bool = value as? Bool {
        return bool
    }
    if let number = value as? NSNumber {
        return number.boolValue
    }
    return nil
}

private func pointAttribute(_ element: AXUIElement, attribute: String) -> CGPoint? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let rawValue = value, CFGetTypeID(rawValue) == AXValueGetTypeID() else {
        return nil
    }
    let axValue = rawValue as! AXValue
    guard AXValueGetType(axValue) == .cgPoint else {
        return nil
    }
    var point = CGPoint.zero
    return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
}

private func sizeAttribute(_ element: AXUIElement, attribute: String) -> CGSize? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let rawValue = value, CFGetTypeID(rawValue) == AXValueGetTypeID() else {
        return nil
    }
    let axValue = rawValue as! AXValue
    guard AXValueGetType(axValue) == .cgSize else {
        return nil
    }
    var size = CGSize.zero
    return AXValueGetValue(axValue, .cgSize, &size) ? size : nil
}

private func bestLabel(for element: AXUIElement) -> String? {
    let candidates = [
        kAXTitleAttribute as String,
        kAXDescriptionAttribute as String,
        kAXLabelValueAttribute as String,
        kAXRoleDescriptionAttribute as String
    ]
    for attribute in candidates {
        if let value = stringAttribute(element, attribute: attribute)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
    }
    return nil
}

private func bestValue(for element: AXUIElement) -> String? {
    let candidates = [
        kAXValueAttribute as String,
        kAXPlaceholderValueAttribute as String,
        kAXHelpAttribute as String
    ]
    for attribute in candidates {
        if let value = stringAttribute(element, attribute: attribute)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
    }
    return nil
}

private func prettyRole(_ role: String?, description: String?) -> String {
    if let description, !description.isEmpty {
        return description.lowercased()
    }
    guard let role, !role.isEmpty else {
        return "element"
    }
    let trimmed = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
    return trimmed.replacingOccurrences(of: "_", with: " ").lowercased()
}

private func escaped(_ value: String) -> String {
    value.replacingOccurrences(of: "\n", with: "\\n")
}

private func cacheDirectory() throws -> URL {
    let base = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Caches", isDirectory: true)
        .appendingPathComponent("personal-agent", isDirectory: true)
        .appendingPathComponent("mac-ax", isDirectory: true)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
}

private func cacheURL(for cacheKey: String) throws -> URL {
    try cacheDirectory().appendingPathComponent("\(cacheKey).json")
}

private func writeSnapshotCache(_ snapshot: SnapshotCache, cacheKey: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(snapshot)
    try data.write(to: cacheURL(for: cacheKey), options: .atomic)
}

private func readSnapshotCache(cacheKey: String) throws -> SnapshotCache {
    let data = try Data(contentsOf: cacheURL(for: cacheKey))
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(SnapshotCache.self, from: data)
}

private enum UIAction {
    case press
}

private func performAction(_ action: UIAction, on element: AXUIElement) -> Bool {
    var actionNamesCF: CFArray?
    let result = AXUIElementCopyActionNames(element, &actionNamesCF)
    guard result == .success, let actionNames = actionNamesCF as? [String] else {
        return false
    }
    let desiredAction: String
    switch action {
    case .press:
        desiredAction = kAXPressAction as String
    }
    guard actionNames.contains(desiredAction) else {
        return false
    }
    return AXUIElementPerformAction(element, desiredAction as CFString) == .success
}

private func clickableCenter(for element: AXUIElement) -> CGPoint? {
    guard let position = pointAttribute(element, attribute: kAXPositionAttribute as String),
          let size = sizeAttribute(element, attribute: kAXSizeAttribute as String) else {
        return nil
    }
    return CGPoint(x: position.x + size.width / 2, y: position.y + size.height / 2)
}

private func postMouseClick(at point: CGPoint) throws {
    guard let mouseDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
          let mouseUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
        throw CLIError.message("Failed to create mouse events")
    }
    mouseDown.post(tap: .cghidEventTap)
    mouseUp.post(tap: .cghidEventTap)
}

private func postUnicodeText(_ text: String) throws {
    let utf16 = Array(text.utf16)
    guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
        throw CLIError.message("Failed to create keyboard events")
    }
    keyDown.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    keyUp.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
}

private func postKeyPress(named key: String) throws {
    if let keyCode = keyCode(for: key) {
        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
            throw CLIError.message("Failed to create keyboard events")
        }
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
        return
    }

    guard key.count == 1 else {
        throw CLIError.message("Unsupported key: \(key)")
    }
    try postUnicodeText(key)
}

private func keyCode(for key: String) -> CGKeyCode? {
    switch key.lowercased() {
    case "enter", "return": return 36
    case "tab": return 48
    case "space": return 49
    case "escape", "esc": return 53
    case "delete", "backspace": return 51
    case "forwarddelete": return 117
    case "left": return 123
    case "right": return 124
    case "down": return 125
    case "up": return 126
    case "home": return 115
    case "end": return 119
    case "pageup": return 116
    case "pagedown": return 121
    default: return nil
    }
}

private func describe(locator: Locator) -> String {
    switch locator {
    case .ref(let ref): return ref
    case .label(let label): return "label \"\(label)\""
    case .identifier(let identifier): return "identifier \"\(identifier)\""
    }
}

private func frontmostWindowNumber(for processIdentifier: pid_t, title: String?) -> Int? {
    guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }

    let matchingWindows = windowInfo.filter { info in
        guard let pid = info[kCGWindowOwnerPID as String] as? pid_t else {
            return false
        }
        return pid == processIdentifier
    }

    if let title,
       let titled = matchingWindows.first(where: { ($0[kCGWindowName as String] as? String) == title }),
       let number = titled[kCGWindowNumber as String] as? Int {
        return number
    }

    if let first = matchingWindows.first,
       let number = first[kCGWindowNumber as String] as? Int {
        return number
    }

    return nil
}
