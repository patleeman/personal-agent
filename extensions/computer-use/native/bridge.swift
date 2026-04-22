import Foundation
import AppKit
import ApplicationServices
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct BridgeFailure: Error {
	let message: String
	let code: String
}

struct MouseMapping {
	let button: CGMouseButton
	let downType: CGEventType
	let upType: CGEventType
	let buttonNumber: Int64
}

struct ElementObservationSnapshot {
	let pid: Int32
	let windowId: UInt32
	let elementsById: [String: AXUIElement]
}

final class Bridge {
	private var stdinBuffer = Data()
	private var observations: [String: ElementObservationSnapshot] = [:]
	private var observationOrder: [String] = []

	private let keyCodeMap: [String: CGKeyCode] = [
		"A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5,
		"Z": 6, "X": 7, "C": 8, "V": 9, "B": 11,
		"Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17,
		"1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
		"=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
		"]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35,
		"L": 37, "J": 38, "'": 39, "K": 40, ";": 41, "\\": 42,
		",": 43, "/": 44, "N": 45, "M": 46, ".": 47, "`": 50,
		"ENTER": 36, "RETURN": 36,
		"TAB": 48,
		"SPACE": 49,
		"DELETE": 51,
		"BACKSPACE": 51,
		"FORWARD_DELETE": 117,
		"ESCAPE": 53,
		"LEFT": 123,
		"RIGHT": 124,
		"DOWN": 125,
		"UP": 126,
		"HOME": 115,
		"END": 119,
		"PAGEUP": 116,
		"PAGEDOWN": 121,
		"F1": 122,
		"F2": 120,
		"F3": 99,
		"F4": 118,
		"F5": 96,
		"F6": 97,
		"F7": 98,
		"F8": 100,
		"F9": 101,
		"F10": 109,
		"F11": 103,
		"F12": 111,
	]

	func run() {
		while true {
			autoreleasepool {
				let data = FileHandle.standardInput.availableData
				if data.isEmpty {
					exit(0)
				}
				stdinBuffer.append(data)
				processBufferedInput()
			}
		}
	}

	private func processBufferedInput() {
		let newline = Data([0x0A])
		while let range = stdinBuffer.range(of: newline) {
			let lineData = stdinBuffer.subdata(in: 0..<range.lowerBound)
			stdinBuffer.removeSubrange(0..<range.upperBound)
			guard !lineData.isEmpty else { continue }
			guard let line = String(data: lineData, encoding: .utf8) else { continue }
			handleLine(line)
		}
	}

	private func handleLine(_ line: String) {
		let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		let fallbackId = "invalid"

		do {
			guard let jsonData = trimmed.data(using: .utf8) else {
				throw BridgeFailure(message: "Input was not valid UTF-8", code: "invalid_request")
			}
			guard let object = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
				throw BridgeFailure(message: "Request must be a JSON object", code: "invalid_request")
			}
			let id = (object["id"] as? String) ?? fallbackId

			do {
				let result = try handleRequest(object)
				send([
					"id": id,
					"ok": true,
					"result": result,
				])
			} catch let failure as BridgeFailure {
				send([
					"id": id,
					"ok": false,
					"error": [
						"message": failure.message,
						"code": failure.code,
					],
				])
			} catch {
				send([
					"id": id,
					"ok": false,
					"error": [
						"message": error.localizedDescription,
						"code": "internal_error",
					],
				])
			}
		} catch let failure as BridgeFailure {
			send([
				"id": fallbackId,
				"ok": false,
				"error": [
					"message": failure.message,
					"code": failure.code,
				],
			])
		} catch {
			send([
				"id": fallbackId,
				"ok": false,
				"error": [
					"message": error.localizedDescription,
					"code": "internal_error",
				],
			])
		}
	}

	private func send(_ payload: [String: Any]) {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload),
			let line = String(data: data, encoding: .utf8),
			let output = (line + "\n").data(using: .utf8)
		else {
			return
		}

		FileHandle.standardOutput.write(output)
	}

	private func handleRequest(_ request: [String: Any]) throws -> Any {
		let cmd = try stringArg(request, "cmd")

		switch cmd {
		case "check_permissions":
			return checkPermissions()
		case "list_apps":
			return listApps()
		case "list_windows":
			return try listWindows(pid: Int32(try intArg(request, "pid")))
		case "get_frontmost":
			return try getFrontmost()
		case "capture_window_state":
			return try captureWindowState(request)
		case "move_window_mouse":
			return try moveWindowMouse(request)
		case "click_window":
			return try clickWindow(request)
		case "click_element":
			return try clickElement(request)
		case "perform_element_action":
			return try performElementAction(request)
		case "drag_window_mouse":
			return try dragWindowMouse(request)
		case "scroll_window_mouse":
			return try scrollWindowMouse(request)
		case "keypress":
			return try keypress(request)
		case "type_text":
			return try typeText(request)
		case "set_element_value":
			return try setElementValue(request)
		default:
			throw BridgeFailure(message: "Unknown command '\(cmd)'", code: "unknown_command")
		}
	}

	private func stringArg(_ request: [String: Any], _ key: String) throws -> String {
		if let value = request[key] as? String {
			return value
		}
		throw BridgeFailure(message: "Missing string argument '\(key)'", code: "invalid_args")
	}

	private func optionalStringArg(_ request: [String: Any], _ key: String) -> String? {
		request[key] as? String
	}

	private func boolArg(_ request: [String: Any], _ key: String, default defaultValue: Bool) -> Bool {
		if let value = request[key] as? Bool {
			return value
		}
		if let value = request[key] as? NSNumber {
			return value.boolValue
		}
		return defaultValue
	}

	private func intArg(_ request: [String: Any], _ key: String) throws -> Int {
		if let value = request[key] as? Int {
			return value
		}
		if let value = request[key] as? NSNumber {
			return value.intValue
		}
		if let value = request[key] as? Double {
			return Int(value)
		}
		throw BridgeFailure(message: "Missing integer argument '\(key)'", code: "invalid_args")
	}

	private func doubleArg(_ request: [String: Any], _ key: String) throws -> Double {
		if let value = request[key] as? Double {
			return value
		}
		if let value = request[key] as? NSNumber {
			return value.doubleValue
		}
		throw BridgeFailure(message: "Missing numeric argument '\(key)'", code: "invalid_args")
	}

	private func optionalIntArg(_ request: [String: Any], _ key: String) -> Int? {
		if let value = request[key] as? Int {
			return value
		}
		if let value = request[key] as? NSNumber {
			return value.intValue
		}
		if let value = request[key] as? Double {
			return Int(value)
		}
		return nil
	}

	private func checkPermissions() -> [String: Any] {
		let accessibility = AXIsProcessTrusted()
		let screenRecording: Bool
		if #available(macOS 10.15, *) {
			screenRecording = CGPreflightScreenCaptureAccess()
		} else {
			screenRecording = true
		}
		return [
			"accessibility": accessibility,
			"screenRecording": screenRecording,
		]
	}

	private func listApps() -> [[String: Any]] {
		let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
		let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
		return apps.map { app in
			var result: [String: Any] = [
				"appName": app.localizedName ?? "Unknown App",
				"pid": Int(app.processIdentifier),
				"isFrontmost": app.processIdentifier == frontmostPid,
			]
			if let bundleId = app.bundleIdentifier {
				result["bundleId"] = bundleId
			}
			return result
		}
	}

	private func getFrontmost() throws -> [String: Any] {
		guard let app = NSWorkspace.shared.frontmostApplication else {
			throw BridgeFailure(message: "No frontmost app is available", code: "frontmost_unavailable")
		}
		let pid = app.processIdentifier
		let windows = try listWindows(pid: pid)
		let chosen = windows.first

		var result: [String: Any] = [
			"appName": app.localizedName ?? "Unknown App",
			"pid": Int(pid),
		]
		if let bundleId = app.bundleIdentifier {
			result["bundleId"] = bundleId
		}
		if let chosen {
			result["windowTitle"] = chosen["title"]
			result["windowId"] = chosen["windowId"]
		}
		return result
	}

	private func listWindows(pid: Int32) throws -> [[String: Any]] {
		guard let entries = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
			return []
		}

		var windows: [[String: Any]] = []
		for entry in entries {
			guard let ownerPid = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
				ownerPid == pid
			else {
				continue
			}
			let layer = (entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
			if layer != 0 {
				continue
			}
			guard let windowId = (entry[kCGWindowNumber as String] as? NSNumber)?.uint32Value else {
				continue
			}
			guard let boundsDict = entry[kCGWindowBounds as String] as? [String: Any],
				let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
			else {
				continue
			}
			if bounds.width < 40 || bounds.height < 40 {
				continue
			}
			let title = (entry[kCGWindowName as String] as? String) ?? ""
			let isOnscreen = (entry[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? true
			windows.append([
				"windowId": Int(windowId),
				"title": title,
				"x": bounds.origin.x,
				"y": bounds.origin.y,
				"width": bounds.size.width,
				"height": bounds.size.height,
				"isOnscreen": isOnscreen,
			])
		}
		return windows
	}

	private func captureWindowState(_ request: [String: Any]) throws -> [String: Any] {
		let pid = Int32(try intArg(request, "pid"))
		let windowId = UInt32(try intArg(request, "windowId"))
		let includeAccessibility = boolArg(request, "includeAccessibility", default: false)
		let cgImage = try captureWindowImage(windowId: windowId)
		let pngData = try pngData(for: cgImage)

		var result: [String: Any] = [
			"pngBase64": pngData.base64EncodedString(),
			"width": cgImage.width,
			"height": cgImage.height,
		]

		if includeAccessibility {
			let observation = try buildObservation(pid: pid, windowId: windowId, captureWidth: cgImage.width, captureHeight: cgImage.height)
			result["snapshotId"] = observation.snapshotId
			result["elements"] = observation.elements
			if let focusedElementId = observation.focusedElementId {
				result["focusedElementId"] = focusedElementId
			}
		}

		return result
	}

	private func captureWindowImage(windowId: UInt32) throws -> CGImage {
		if #available(macOS 14.0, *) {
			if let image = try? captureWindowImageWithScreenCaptureKit(windowId: windowId) {
				return image
			}
		}

		return try captureWindowImageWithScreencapture(windowId: windowId)
	}

	@available(macOS 14.0, *)
	private func captureWindowImageWithScreenCaptureKit(windowId: UInt32) throws -> CGImage {
		let semaphore = DispatchSemaphore(value: 0)
		var result: Result<CGImage, Error>?

		Task {
			do {
				let shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
				guard let window = shareableContent.windows.first(where: { $0.windowID == windowId }) else {
					throw BridgeFailure(message: "Target window is no longer available", code: "window_not_found")
				}

				let filter = SCContentFilter(desktopIndependentWindow: window)
				let configuration = SCStreamConfiguration()
				configuration.showsCursor = false
				configuration.captureResolution = .automatic
				let scale = backingScaleFactor(for: window.frame)
				configuration.width = max(1, Int(window.frame.width * scale))
				configuration.height = max(1, Int(window.frame.height * scale))

				let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
				result = .success(image)
			} catch {
				result = .failure(error)
			}
			semaphore.signal()
		}

		semaphore.wait()
		switch result {
		case .success(let image):
			return image
		case .failure(let error):
			if let failure = error as? BridgeFailure {
				throw failure
			}
			throw BridgeFailure(message: error.localizedDescription, code: "capture_failed")
		case .none:
			throw BridgeFailure(message: "The screen capture failed.", code: "capture_failed")
		}
	}

	@available(macOS 14.0, *)
	private func backingScaleFactor(for frame: CGRect) -> Double {
		if let screen = NSScreen.screens.first(where: { $0.frame.intersects(frame) }) {
			return screen.backingScaleFactor
		}
		return Double(NSScreen.main?.backingScaleFactor ?? 2.0)
	}

	private func captureWindowImageWithScreencapture(windowId: UInt32) throws -> CGImage {
		let tempURL = URL(fileURLWithPath: NSTemporaryDirectory())
			.appendingPathComponent("computer-use-\(UUID().uuidString).png")
		defer {
			try? FileManager.default.removeItem(at: tempURL)
		}

		let process = Process()
		let stderrPipe = Pipe()
		process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
		process.arguments = ["-x", "-o", "-l", String(windowId), tempURL.path]
		process.standardError = stderrPipe

		do {
			try process.run()
			process.waitUntilExit()
		} catch {
			throw BridgeFailure(message: "Failed to launch screencapture: \(error.localizedDescription)", code: "capture_failed")
		}

		let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
		let stderrText = String(data: stderrData, encoding: .utf8)?
			.trimmingCharacters(in: .whitespacesAndNewlines)

		guard process.terminationStatus == 0 else {
			if let stderrText, !stderrText.isEmpty {
				throw BridgeFailure(message: stderrText, code: "capture_failed")
			}
			throw BridgeFailure(message: "screencapture failed for window \(windowId)", code: "capture_failed")
		}

		guard let data = try? Data(contentsOf: tempURL),
			let source = CGImageSourceCreateWithData(data as CFData, nil),
			let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
		else {
			throw BridgeFailure(message: "No screenshot was produced for window \(windowId)", code: "capture_failed")
		}

		return image
	}

	private func pngData(for image: CGImage) throws -> Data {
		let mutable = NSMutableData()
		guard let destination = CGImageDestinationCreateWithData(mutable, UTType.png.identifier as CFString, 1, nil) else {
			throw BridgeFailure(message: "Failed to encode screenshot", code: "capture_failed")
		}
		CGImageDestinationAddImage(destination, image, nil)
		guard CGImageDestinationFinalize(destination) else {
			throw BridgeFailure(message: "Failed to encode screenshot", code: "capture_failed")
		}
		return mutable as Data
	}

	private func currentWindowBounds(windowId: UInt32) -> CGRect? {
		if let descriptions = CGWindowListCreateDescriptionFromArray([NSNumber(value: windowId)] as CFArray) as? [[String: Any]],
			let first = descriptions.first,
			let boundsDict = first[kCGWindowBounds as String] as? [String: Any],
			let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
		{
			return bounds
		}

		guard let entries = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
			return nil
		}

		for entry in entries {
			guard let number = entry[kCGWindowNumber as String] as? NSNumber,
				number.uint32Value == windowId,
				let boundsDict = entry[kCGWindowBounds as String] as? [String: Any],
				let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary)
			else {
				continue
			}
			return bounds
		}

		return nil
	}

	private func currentWindowTitle(windowId: UInt32) -> String? {
		guard let entries = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
			return nil
		}

		for entry in entries {
			guard let number = entry[kCGWindowNumber as String] as? NSNumber,
				number.uint32Value == windowId
			else {
				continue
			}
			return entry[kCGWindowName as String] as? String
		}

		return nil
	}

	private func mapWindowPoint(
		windowId: UInt32,
		x: Double,
		y: Double,
		captureWidth: Double,
		captureHeight: Double
	) throws -> CGPoint {
		guard let bounds = currentWindowBounds(windowId: windowId) else {
			throw BridgeFailure(message: "Target window is no longer available", code: "window_not_found")
		}
		let relX = min(max(x / max(captureWidth, 1), 0), 1)
		let relY = min(max(y / max(captureHeight, 1), 0), 1)
		return CGPoint(
			x: bounds.origin.x + bounds.size.width * relX,
			y: bounds.origin.y + bounds.size.height * relY
		)
	}

	private func buildObservation(pid: Int32, windowId: UInt32, captureWidth: Int, captureHeight: Int) throws -> (snapshotId: String, elements: [[String: Any]], focusedElementId: String?) {
		guard let windowBounds = currentWindowBounds(windowId: windowId) else {
			throw BridgeFailure(message: "Target window is no longer available", code: "window_not_found")
		}
		let appElement = AXUIElementCreateApplication(pid)
		let axWindow = try resolveAXWindow(appElement: appElement, pid: pid, windowId: windowId, cgWindowBounds: windowBounds)
		let focusedElement = focusedUIElement(appElement: appElement)

		var visited: Set<String> = []
		var flatElements: [[String: Any]] = []
		var elementsById: [String: AXUIElement] = [:]
		var nextIndex = 1
		var focusedElementId: String?

		func visit(_ element: AXUIElement, depth: Int) {
			if depth > 12 || flatElements.count >= 200 {
				return
			}

			let identity = elementIdentity(element)
			if visited.contains(identity) {
				return
			}
			visited.insert(identity)

			let actions = actionNames(for: element)
			let role = stringAttribute(element, kAXRoleAttribute as CFString)
			let subrole = stringAttribute(element, kAXSubroleAttribute as CFString)
			let title = stringAttribute(element, kAXTitleAttribute as CFString)
			let help = stringAttribute(element, kAXDescriptionAttribute as CFString)
			let value = summarizedValue(for: element)
			let enabled = boolAttribute(element, kAXEnabledAttribute as CFString)
			let settable = isAttributeSettable(element, kAXValueAttribute as CFString)
			let frame = relativeFrame(for: element, within: windowBounds, captureWidth: captureWidth, captureHeight: captureHeight)
			let focused = isSameElement(element, focusedElement)

			if shouldIncludeElement(role: role, title: title, help: help, value: value, actions: actions, settable: settable, frame: frame, focused: focused) {
				let elementId = "e\(nextIndex)"
				nextIndex += 1
				elementsById[elementId] = element

				var item: [String: Any] = [
					"elementId": elementId,
					"depth": depth,
					"actions": actions,
					"settable": settable,
				]
				if let role {
					item["role"] = role
				}
				if let subrole, !subrole.isEmpty {
					item["subrole"] = subrole
				}
				if let title, !title.isEmpty {
					item["title"] = title
				}
				if let help, !help.isEmpty {
					item["description"] = help
				}
				if let value, !value.isEmpty {
					item["value"] = value
				}
				if let enabled {
					item["enabled"] = enabled
				}
				if focused {
					item["focused"] = true
					focusedElementId = elementId
				}
				if let frame {
					item["frame"] = [
						"x": frame.origin.x,
						"y": frame.origin.y,
						"width": frame.size.width,
						"height": frame.size.height,
					]
				}

				flatElements.append(item)
			}

			for child in childElements(for: element) {
				visit(child, depth: depth + 1)
			}
		}

		visit(axWindow, depth: 0)

		let snapshotId = UUID().uuidString
		observations[snapshotId] = ElementObservationSnapshot(pid: pid, windowId: windowId, elementsById: elementsById)
		observationOrder.append(snapshotId)
		trimObservations()

		return (snapshotId, flatElements, focusedElementId)
	}

	private func resolveAXWindow(appElement: AXUIElement, pid: Int32, windowId: UInt32, cgWindowBounds: CGRect) throws -> AXUIElement {
		let title = currentWindowTitle(windowId: windowId)?.trimmingCharacters(in: .whitespacesAndNewlines)
		let windows = childElements(attribute: kAXWindowsAttribute as CFString, from: appElement)
		if windows.isEmpty {
			throw BridgeFailure(message: "No accessibility window was found for app pid \(pid)", code: "window_not_found")
		}
		if windows.count == 1 {
			return windows[0]
		}

		let sorted = windows.sorted { left, right in
			scoreAXWindow(left, targetBounds: cgWindowBounds, targetTitle: title) > scoreAXWindow(right, targetBounds: cgWindowBounds, targetTitle: title)
		}
		guard let chosen = sorted.first else {
			throw BridgeFailure(message: "No accessibility window was found for app pid \(pid)", code: "window_not_found")
		}
		return chosen
	}

	private func scoreAXWindow(_ element: AXUIElement, targetBounds: CGRect, targetTitle: String?) -> Double {
		var score = 0.0
		if let frame = absoluteFrame(for: element) {
			let intersection = frame.intersection(targetBounds)
			if !intersection.isNull && !intersection.isEmpty {
				score += Double(intersection.width * intersection.height)
			}
		}
		if let title = targetTitle,
			let axTitle = stringAttribute(element, kAXTitleAttribute as CFString)?.trimmingCharacters(in: .whitespacesAndNewlines),
			!title.isEmpty,
			!axTitle.isEmpty,
			title.caseInsensitiveCompare(axTitle) == .orderedSame
		{
			score += 1_000_000
		}
		return score
	}

	private func childElements(for element: AXUIElement) -> [AXUIElement] {
		let attributes: [CFString] = [
			kAXChildrenAttribute as CFString,
			kAXVisibleChildrenAttribute as CFString,
			kAXRowsAttribute as CFString,
			kAXTabsAttribute as CFString,
			kAXContentsAttribute as CFString,
		]
		var result: [AXUIElement] = []
		var seen: Set<String> = []
		for attribute in attributes {
			for child in childElements(attribute: attribute, from: element) {
				let identity = elementIdentity(child)
				if seen.contains(identity) {
					continue
				}
				seen.insert(identity)
				result.append(child)
			}
		}
		return result
	}

	private func childElements(attribute: CFString, from element: AXUIElement) -> [AXUIElement] {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, attribute, &value)
		guard error == .success else {
			return []
		}
		if let array = value as? [AXUIElement] {
			return array
		}
		if let single = value, CFGetTypeID(single) == AXUIElementGetTypeID() {
			return [unsafeBitCast(single, to: AXUIElement.self)]
		}
		return []
	}

	private func stringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, attribute, &value)
		guard error == .success else {
			return nil
		}
		return value as? String
	}

	private func boolAttribute(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, attribute, &value)
		guard error == .success else {
			return nil
		}
		if let number = value as? NSNumber {
			return number.boolValue
		}
		return nil
	}

	private func summarizedValue(for element: AXUIElement) -> String? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
		guard error == .success, let unwrapped = value else {
			return nil
		}
		if let string = unwrapped as? String {
			return trimmedSummary(string)
		}
		if let number = unwrapped as? NSNumber {
			return number.stringValue
		}
		if CFGetTypeID(unwrapped) == AXValueGetTypeID() {
			return nil
		}
		return trimmedSummary(CFCopyDescription(unwrapped) as String)
	}

	private func trimmedSummary(_ value: String) -> String {
		let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.count <= 120 {
			return trimmed
		}
		let end = trimmed.index(trimmed.startIndex, offsetBy: 117)
		return String(trimmed[..<end]) + "..."
	}

	private func isAttributeSettable(_ element: AXUIElement, _ attribute: CFString) -> Bool {
		var settable = DarwinBoolean(false)
		let error = AXUIElementIsAttributeSettable(element, attribute, &settable)
		return error == .success && settable.boolValue
	}

	private func actionNames(for element: AXUIElement) -> [String] {
		var value: CFArray?
		let error = AXUIElementCopyActionNames(element, &value)
		guard error == .success, let array = value as? [String] else {
			return []
		}
		return array
	}

	private func focusedUIElement(appElement: AXUIElement) -> AXUIElement? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &value)
		guard error == .success else {
			return nil
		}
		return value as! AXUIElement?
	}

	private func elementIdentity(_ element: AXUIElement) -> String {
		String(UInt(bitPattern: Unmanaged.passUnretained(element).toOpaque()))
	}

	private func isSameElement(_ left: AXUIElement, _ right: AXUIElement?) -> Bool {
		guard let right else {
			return false
		}
		return elementIdentity(left) == elementIdentity(right)
	}

	private func absoluteFrame(for element: AXUIElement) -> CGRect? {
		guard let position = pointAttribute(element, kAXPositionAttribute as CFString),
			let size = sizeAttribute(element, kAXSizeAttribute as CFString)
		else {
			return nil
		}
		return CGRect(origin: position, size: size)
	}

	private func relativeFrame(for element: AXUIElement, within windowBounds: CGRect, captureWidth: Int, captureHeight: Int) -> CGRect? {
		guard let absoluteFrame = absoluteFrame(for: element) else {
			return nil
		}
		let intersection = absoluteFrame.intersection(windowBounds)
		if intersection.isNull || intersection.isEmpty || intersection.width < 1 || intersection.height < 1 {
			return nil
		}
		let scaleX = Double(captureWidth) / Double(max(windowBounds.width, 1))
		let scaleY = Double(captureHeight) / Double(max(windowBounds.height, 1))
		return CGRect(
			x: (intersection.origin.x - windowBounds.origin.x) * scaleX,
			y: (intersection.origin.y - windowBounds.origin.y) * scaleY,
			width: intersection.size.width * scaleX,
			height: intersection.size.height * scaleY
		)
	}

	private func pointAttribute(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, attribute, &value)
		guard error == .success,
			let axValue = value,
			CFGetTypeID(axValue) == AXValueGetTypeID()
		else {
			return nil
		}
		let casted = unsafeBitCast(axValue, to: AXValue.self)
		if AXValueGetType(casted) != .cgPoint {
			return nil
		}
		var point = CGPoint.zero
		guard AXValueGetValue(casted, .cgPoint, &point) else {
			return nil
		}
		return point
	}

	private func sizeAttribute(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
		var value: CFTypeRef?
		let error = AXUIElementCopyAttributeValue(element, attribute, &value)
		guard error == .success,
			let axValue = value,
			CFGetTypeID(axValue) == AXValueGetTypeID()
		else {
			return nil
		}
		let casted = unsafeBitCast(axValue, to: AXValue.self)
		if AXValueGetType(casted) != .cgSize {
			return nil
		}
		var size = CGSize.zero
		guard AXValueGetValue(casted, .cgSize, &size) else {
			return nil
		}
		return size
	}

	private func shouldIncludeElement(role: String?, title: String?, help: String?, value: String?, actions: [String], settable: Bool, frame: CGRect?, focused: Bool) -> Bool {
		if focused {
			return true
		}
		guard frame != nil else {
			return false
		}
		if let role, excludedRoles.contains(role) {
			return false
		}
		if settable || !actions.isEmpty {
			return true
		}
		guard let role else {
			return false
		}
		if interestingRoles.contains(role) {
			let hasLabel = !(title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
				|| !(help?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
				|| !(value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
			return hasLabel || structuralRoles.contains(role)
		}
		return false
	}

	private let interestingRoles: Set<String> = [
		kAXButtonRole as String,
		kAXCheckBoxRole as String,
		kAXComboBoxRole as String,
		"AXLink",
		kAXMenuButtonRole as String,
		kAXMenuItemRole as String,
		kAXPopUpButtonRole as String,
		kAXRadioButtonRole as String,
		kAXRowRole as String,
		kAXStaticTextRole as String,
		"AXTabButton",
		kAXTextAreaRole as String,
		kAXTextFieldRole as String,
		"AXCell",
		"AXDisclosureTriangle",
		"AXOutlineRow",
	]

	private let structuralRoles: Set<String> = [
		kAXRowRole as String,
		"AXCell",
		"AXOutlineRow",
	]

	private let excludedRoles: Set<String> = [
		kAXWindowRole as String,
		kAXScrollAreaRole as String,
		kAXScrollBarRole as String,
		"AXRuler",
		"AXRulerMarker",
		"AXValueIndicator",
	]

	private func trimObservations(maxCount: Int = 6) {
		while observationOrder.count > maxCount {
			let removed = observationOrder.removeFirst()
			observations.removeValue(forKey: removed)
		}
	}

	private func observation(snapshotId: String) throws -> ElementObservationSnapshot {
		guard let observation = observations[snapshotId] else {
			throw BridgeFailure(message: "The requested accessibility snapshot is no longer available. Use observe again to refresh the current app state.", code: "invalid_snapshot")
		}
		return observation
	}

	private func observedElement(snapshotId: String, elementId: String) throws -> (snapshot: ElementObservationSnapshot, element: AXUIElement) {
		let snapshot = try observation(snapshotId: snapshotId)
		guard let element = snapshot.elementsById[elementId] else {
			throw BridgeFailure(message: "Element ID '\(elementId)' is no longer valid. Use observe again to refresh the current app state.", code: "invalid_element_id")
		}
		return (snapshot, element)
	}

	private func mouseMapping(for buttonName: String) throws -> MouseMapping {
		switch buttonName.lowercased() {
		case "left":
			return MouseMapping(button: .left, downType: .leftMouseDown, upType: .leftMouseUp, buttonNumber: 0)
		case "right":
			return MouseMapping(button: .right, downType: .rightMouseDown, upType: .rightMouseUp, buttonNumber: 1)
		case "wheel", "middle":
			return MouseMapping(button: .center, downType: .otherMouseDown, upType: .otherMouseUp, buttonNumber: 2)
		case "back":
			return MouseMapping(button: .center, downType: .otherMouseDown, upType: .otherMouseUp, buttonNumber: 3)
		case "forward":
			return MouseMapping(button: .center, downType: .otherMouseDown, upType: .otherMouseUp, buttonNumber: 4)
		default:
			throw BridgeFailure(message: "Unsupported mouse button '\(buttonName)'", code: "invalid_args")
		}
	}

	private func postEvent(_ event: CGEvent, pid: Int32) {
		event.postToPid(pid)
	}

	private func postMouseEvent(_ event: CGEvent) {
		event.post(tap: .cghidEventTap)
	}

	private func activateApp(pid: Int32) {
		guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
			return
		}
		if #available(macOS 14.0, *) {
			_ = app.activate()
		} else {
			app.activate(options: [.activateIgnoringOtherApps])
		}
		usleep(80_000)
	}

	private func postMouseMove(to point: CGPoint, pid: Int32) throws {
		activateApp(pid: pid)
		guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
			throw BridgeFailure(message: "Failed to create mouse move event", code: "input_failed")
		}
		postMouseEvent(move)
	}

	private func postMouseClick(at point: CGPoint, buttonName: String, clickCount: Int, pid: Int32) throws {
		let mapping = try mouseMapping(for: buttonName)
		try postMouseMove(to: point, pid: pid)

		for _ in 0..<max(1, clickCount) {
			guard let down = CGEvent(mouseEventSource: nil, mouseType: mapping.downType, mouseCursorPosition: point, mouseButton: mapping.button),
				let up = CGEvent(mouseEventSource: nil, mouseType: mapping.upType, mouseCursorPosition: point, mouseButton: mapping.button)
			else {
				throw BridgeFailure(message: "Failed to create mouse click event", code: "input_failed")
			}
			down.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
			up.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
			down.setIntegerValueField(.mouseEventButtonNumber, value: mapping.buttonNumber)
			up.setIntegerValueField(.mouseEventButtonNumber, value: mapping.buttonNumber)
			postMouseEvent(down)
			usleep(12_000)
			postMouseEvent(up)
			usleep(45_000)
		}
	}

	private func postMouseDrag(points: [CGPoint], pid: Int32) throws {
		guard let first = points.first, let last = points.last else {
			throw BridgeFailure(message: "Drag path is empty", code: "invalid_args")
		}
		guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: first, mouseButton: .left) else {
			throw BridgeFailure(message: "Failed to start drag", code: "input_failed")
		}
		activateApp(pid: pid)
		postMouseEvent(down)
		usleep(12_000)
		for point in points.dropFirst() {
			guard let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) else {
				throw BridgeFailure(message: "Failed during drag", code: "input_failed")
			}
			postMouseEvent(drag)
			usleep(8_000)
		}
		guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: last, mouseButton: .left) else {
			throw BridgeFailure(message: "Failed to finish drag", code: "input_failed")
		}
		postMouseEvent(up)
	}

	private func postMouseScroll(scrollX: Int32, scrollY: Int32, pid: Int32) throws {
		activateApp(pid: pid)
		if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: scrollY, wheel2: scrollX, wheel3: 0) {
			postMouseEvent(event)
			return
		}
		if let fallback = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: scrollY, wheel2: 0, wheel3: 0) {
			postMouseEvent(fallback)
			return
		}
		throw BridgeFailure(message: "Failed to create scroll event", code: "input_failed")
	}

	private func modifierFlags(for key: String) -> CGEventFlags? {
		switch key {
		case "CMD", "COMMAND", "META":
			return .maskCommand
		case "CTRL", "CONTROL":
			return .maskControl
		case "ALT", "OPTION", "OPT":
			return .maskAlternate
		case "SHIFT":
			return .maskShift
		case "FN":
			return .maskSecondaryFn
		default:
			return nil
		}
	}

	private func postKeyEvent(keyCode: CGKeyCode, flags: CGEventFlags, pid: Int32) throws {
		activateApp(pid: pid)
		guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
			let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
		else {
			throw BridgeFailure(message: "Failed to create key event", code: "input_failed")
		}
		down.flags = flags
		up.flags = flags
		postEvent(down, pid: pid)
		usleep(10_000)
		postEvent(up, pid: pid)
	}

	private func setUnicodeString(event: CGEvent, text: String) {
		var utf16 = Array(text.utf16)
		utf16.withUnsafeMutableBufferPointer { buffer in
			guard let base = buffer.baseAddress else { return }
			event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
		}
	}

	private func postUnicodeText(_ text: String, pid: Int32) throws {
		activateApp(pid: pid)
		for scalar in text.unicodeScalars {
			let character = String(scalar)
			guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
				let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
			else {
				throw BridgeFailure(message: "Failed to create unicode key event", code: "input_failed")
			}
			setUnicodeString(event: down, text: character)
			setUnicodeString(event: up, text: character)
			postEvent(down, pid: pid)
			usleep(8_000)
			postEvent(up, pid: pid)
		}
	}

	private func moveWindowMouse(_ request: [String: Any]) throws -> [String: Any] {
		let windowId = UInt32(try intArg(request, "windowId"))
		let pid = Int32(try intArg(request, "pid"))
		let x = try doubleArg(request, "x")
		let y = try doubleArg(request, "y")
		let captureWidth = try doubleArg(request, "captureWidth")
		let captureHeight = try doubleArg(request, "captureHeight")
		let point = try mapWindowPoint(windowId: windowId, x: x, y: y, captureWidth: captureWidth, captureHeight: captureHeight)
		try postMouseMove(to: point, pid: pid)
		return ["moved": true]
	}

	private func clickWindow(_ request: [String: Any]) throws -> [String: Any] {
		let windowId = UInt32(try intArg(request, "windowId"))
		let pid = Int32(try intArg(request, "pid"))
		let x = try doubleArg(request, "x")
		let y = try doubleArg(request, "y")
		let captureWidth = try doubleArg(request, "captureWidth")
		let captureHeight = try doubleArg(request, "captureHeight")
		let buttonName = (try? stringArg(request, "button")) ?? "left"
		let clickCount = max(1, optionalIntArg(request, "clicks") ?? 1)
		let point = try mapWindowPoint(windowId: windowId, x: x, y: y, captureWidth: captureWidth, captureHeight: captureHeight)
		try postMouseClick(at: point, buttonName: buttonName, clickCount: clickCount, pid: pid)
		return ["clicked": true, "via": "mouse"]
	}

	private func clickElement(_ request: [String: Any]) throws -> [String: Any] {
		let snapshotId = try stringArg(request, "snapshotId")
		let elementId = try stringArg(request, "elementId")
		let buttonName = (try? stringArg(request, "button")) ?? "left"
		let clickCount = max(1, optionalIntArg(request, "clicks") ?? 1)
		let resolved = try observedElement(snapshotId: snapshotId, elementId: elementId)

		if buttonName.lowercased() == "left" && clickCount == 1 {
			let actions = actionNames(for: resolved.element)
			if actions.contains(kAXPressAction as String) {
				activateApp(pid: resolved.snapshot.pid)
				let error = AXUIElementPerformAction(resolved.element, kAXPressAction as CFString)
				if error == .success {
					return ["clicked": true, "via": "ax_press"]
				}
			}
		}

		guard let frame = absoluteFrame(for: resolved.element) else {
			throw BridgeFailure(message: "Element '\(elementId)' does not have a clickable frame. Use observe again or fall back to coordinates.", code: "element_not_interactable")
		}
		let point = CGPoint(x: frame.midX, y: frame.midY)
		try postMouseClick(at: point, buttonName: buttonName, clickCount: clickCount, pid: resolved.snapshot.pid)
		return ["clicked": true, "via": "mouse"]
	}

	private func performElementAction(_ request: [String: Any]) throws -> [String: Any] {
		let snapshotId = try stringArg(request, "snapshotId")
		let elementId = try stringArg(request, "elementId")
		let requestedAction = optionalStringArg(request, "accessibilityAction")
		let resolved = try observedElement(snapshotId: snapshotId, elementId: elementId)
		let actions = actionNames(for: resolved.element)
		guard !actions.isEmpty else {
			throw BridgeFailure(message: "Element '\(elementId)' does not expose any accessibility actions.", code: "element_not_interactable")
		}

		let chosenAction: String
		if let requestedAction, actions.contains(requestedAction) {
			chosenAction = requestedAction
		} else if let requestedAction {
			throw BridgeFailure(message: "Element '\(elementId)' does not expose accessibility action '\(requestedAction)'.", code: "invalid_args")
		} else if let secondary = actions.first(where: { $0 != (kAXPressAction as String) }) {
			chosenAction = secondary
		} else if let primary = actions.first {
			chosenAction = primary
		} else {
			throw BridgeFailure(message: "Element '\(elementId)' does not expose any accessibility actions.", code: "element_not_interactable")
		}

		activateApp(pid: resolved.snapshot.pid)
		let error = AXUIElementPerformAction(resolved.element, chosenAction as CFString)
		guard error == .success else {
			throw BridgeFailure(message: "Failed to perform accessibility action '\(chosenAction)' on element '\(elementId)'.", code: "input_failed")
		}
		return ["performed": chosenAction]
	}

	private func dragWindowMouse(_ request: [String: Any]) throws -> [String: Any] {
		let windowId = UInt32(try intArg(request, "windowId"))
		let pid = Int32(try intArg(request, "pid"))
		let captureWidth = try doubleArg(request, "captureWidth")
		let captureHeight = try doubleArg(request, "captureHeight")
		guard let path = request["path"] as? [[String: Any]], path.count >= 2 else {
			throw BridgeFailure(message: "Drag requires a path with at least two points", code: "invalid_args")
		}
		let points = try path.map { point -> CGPoint in
			guard let x = point["x"] as? NSNumber, let y = point["y"] as? NSNumber else {
				throw BridgeFailure(message: "Drag path points need x and y", code: "invalid_args")
			}
			return try mapWindowPoint(windowId: windowId, x: x.doubleValue, y: y.doubleValue, captureWidth: captureWidth, captureHeight: captureHeight)
		}
		try postMouseDrag(points: points, pid: pid)
		return ["dragged": true]
	}

	private func scrollWindowMouse(_ request: [String: Any]) throws -> [String: Any] {
		let windowId = UInt32(try intArg(request, "windowId"))
		let pid = Int32(try intArg(request, "pid"))
		let x = try doubleArg(request, "x")
		let y = try doubleArg(request, "y")
		let captureWidth = try doubleArg(request, "captureWidth")
		let captureHeight = try doubleArg(request, "captureHeight")
		let scrollX = Int32(try intArg(request, "scrollX"))
		let scrollY = Int32(try intArg(request, "scrollY"))
		let point = try mapWindowPoint(windowId: windowId, x: x, y: y, captureWidth: captureWidth, captureHeight: captureHeight)
		try postMouseMove(to: point, pid: pid)
		try postMouseScroll(scrollX: scrollX, scrollY: scrollY, pid: pid)
		return ["scrolled": true]
	}

	private func keypress(_ request: [String: Any]) throws -> [String: Any] {
		let pid = Int32(try intArg(request, "pid"))
		guard let keys = request["keys"] as? [String], !keys.isEmpty else {
			throw BridgeFailure(message: "keypress requires a non-empty keys array", code: "invalid_args")
		}

		var flags: CGEventFlags = []
		var primaryKey: String?
		for key in keys.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }) {
			if let modifier = modifierFlags(for: key) {
				flags.insert(modifier)
			} else {
				primaryKey = key
			}
		}
		guard let primaryKey else {
			throw BridgeFailure(message: "keypress requires at least one non-modifier key", code: "invalid_args")
		}
		guard let keyCode = keyCodeMap[primaryKey] else {
			throw BridgeFailure(message: "Unsupported key '\(primaryKey)'", code: "invalid_args")
		}
		try postKeyEvent(keyCode: keyCode, flags: flags, pid: pid)
		return ["pressed": true]
	}

	private func typeText(_ request: [String: Any]) throws -> [String: Any] {
		let pid = Int32(try intArg(request, "pid"))
		let text = try stringArg(request, "text")
		try postUnicodeText(text, pid: pid)
		return ["typed": true]
	}

	private func setElementValue(_ request: [String: Any]) throws -> [String: Any] {
		let snapshotId = try stringArg(request, "snapshotId")
		let elementId = try stringArg(request, "elementId")
		let text = try stringArg(request, "text")
		let resolved = try observedElement(snapshotId: snapshotId, elementId: elementId)
		if !isAttributeSettable(resolved.element, kAXValueAttribute as CFString) {
			throw BridgeFailure(message: "Element '\(elementId)' does not allow setting its value. Use click/type instead.", code: "value_not_settable")
		}

		activateApp(pid: resolved.snapshot.pid)
		let error = AXUIElementSetAttributeValue(resolved.element, kAXValueAttribute as CFString, text as CFTypeRef)
		guard error == .success else {
			throw BridgeFailure(message: "Failed to set the value of element '\(elementId)'.", code: "input_failed")
		}
		return ["set": true]
	}
}

let bridge = Bridge()
bridge.run()
