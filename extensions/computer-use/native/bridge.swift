import Foundation
import AppKit
import ApplicationServices
import ImageIO

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

final class Bridge {
	private var stdinBuffer = Data()

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
		case "capture_window":
			return try captureWindow(windowId: UInt32(try intArg(request, "windowId")))
		case "move_window_mouse":
			return try moveWindowMouse(request)
		case "click_window":
			return try clickWindow(request)
		case "drag_window_mouse":
			return try dragWindowMouse(request)
		case "scroll_window_mouse":
			return try scrollWindowMouse(request)
		case "keypress":
			return try keypress(request)
		case "type_text":
			return try typeText(request)
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

	private func captureWindow(windowId: UInt32) throws -> [String: Any] {
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

		guard let data = try? Data(contentsOf: tempURL), !data.isEmpty else {
			if let stderrText, !stderrText.isEmpty {
				throw BridgeFailure(message: stderrText, code: "capture_failed")
			}
			throw BridgeFailure(message: "No screenshot was produced for window \(windowId)", code: "capture_failed")
		}

		guard let source = CGImageSourceCreateWithData(data as CFData, nil),
			let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
			let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
			let height = properties[kCGImagePropertyPixelHeight] as? NSNumber
		else {
			throw BridgeFailure(message: "Failed to read screenshot dimensions", code: "capture_failed")
		}

		return [
			"pngBase64": data.base64EncodedString(),
			"width": width.intValue,
			"height": height.intValue,
		]
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

	private func postMouseMove(to point: CGPoint, pid: Int32) throws {
		guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
			throw BridgeFailure(message: "Failed to create mouse move event", code: "input_failed")
		}
		postEvent(move, pid: pid)
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
			postEvent(down, pid: pid)
			usleep(12_000)
			postEvent(up, pid: pid)
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
		postEvent(down, pid: pid)
		usleep(12_000)
		for point in points.dropFirst() {
			guard let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) else {
				throw BridgeFailure(message: "Failed during drag", code: "input_failed")
			}
			postEvent(drag, pid: pid)
			usleep(8_000)
		}
		guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: last, mouseButton: .left) else {
			throw BridgeFailure(message: "Failed to finish drag", code: "input_failed")
		}
		postEvent(up, pid: pid)
	}

	private func postMouseScroll(scrollX: Int32, scrollY: Int32, pid: Int32) throws {
		if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: scrollY, wheel2: scrollX, wheel3: 0) {
			postEvent(event, pid: pid)
			return
		}
		if let fallback = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: scrollY, wheel2: 0, wheel3: 0) {
			postEvent(fallback, pid: pid)
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
		return ["clicked": true]
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
}

let bridge = Bridge()
bridge.run()
