// Time Tower for the Mac: the web app in a window of its own. A small server
// in the app hands the built page to WebKit at http://localhost on a fixed
// port, so saved plans keep one origin across launches and Outlook sign-in
// has an address to come back to. desktop/build.sh builds it.

import AppKit
import Network
import ServiceManagement
import WebKit

// MARK: Local server

/// Serves the files under `root` for GET and HEAD, to this Mac only.
final class LocalServer: @unchecked Sendable {
  private let root: URL
  private let port: UInt16
  private let hosts: Set<String>
  private let queue = DispatchQueue(label: "timetower.server")
  private var listener: NWListener?

  init(root: URL, port: UInt16) {
    self.root = root.standardizedFileURL
    self.port = port
    hosts = ["localhost:\(port)", "127.0.0.1:\(port)", "[::1]:\(port)"]
  }

  /// Calls back once listening, or with the reason it cannot.
  func start(_ done: @escaping @MainActor (Error?) -> Void) {
    let parameters = NWParameters.tcp
    parameters.requiredInterfaceType = .loopback
    // Lets a quick quit and reopen bind while old connections wind down.
    parameters.allowLocalEndpointReuse = true
    let listener: NWListener
    do {
      listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
    } catch {
      Task { @MainActor in done(error) }
      return
    }
    var reported = false
    listener.stateUpdateHandler = { state in
      let result: Error??
      switch state {
      case .ready: result = .some(nil)
      case .failed(let error), .waiting(let error): result = .some(error)
      default: result = nil
      }
      guard let result, !reported else { return }
      reported = true
      Task { @MainActor in done(result) }
    }
    listener.newConnectionHandler = { [self] connection in
      connection.start(queue: queue)
      receive(on: connection, buffer: Data())
    }
    listener.start(queue: queue)
    self.listener = listener
  }

  private func receive(on connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [self] data, _, isComplete, error in
      var buffer = buffer
      if let data { buffer.append(data) }
      if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
        respond(on: connection, to: String(decoding: buffer[..<end.lowerBound], as: UTF8.self))
      } else if isComplete || error != nil || buffer.count > 65_536 {
        connection.cancel()
      } else {
        receive(on: connection, buffer: buffer)
      }
    }
  }

  private func respond(on connection: NWConnection, to head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let request = lines[0].split(separator: " ")
    guard request.count == 3 else { return send(400, on: connection) }
    let host = lines.dropFirst()
      .first { $0.lowercased().hasPrefix("host:") }
      .map { $0.dropFirst(5).trimmingCharacters(in: .whitespaces).lowercased() }
    // Pages elsewhere that point their own name at this Mac get nothing.
    guard let host, hosts.contains(host) else { return send(403, on: connection) }
    let method = request[0]
    guard method == "GET" || method == "HEAD" else { return send(405, on: connection) }
    let path = request[1].prefix { $0 != "?" && $0 != "#" }
    guard path.hasPrefix("/"), var relative = String(path.dropFirst()).removingPercentEncoding else {
      return send(400, on: connection)
    }
    if relative.isEmpty || relative.hasSuffix("/") { relative += "index.html" }
    let file = root.appendingPathComponent(relative).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let body = try? Data(contentsOf: file) else {
      return send(404, on: connection)
    }
    send(200, type: Self.type(of: file), body: method == "HEAD" ? nil : body, length: body.count, on: connection)
  }

  private func send(_ status: Int, type: String = "text/plain; charset=utf-8", body: Data? = nil, length: Int? = nil, on connection: NWConnection) {
    let reasons = [200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"]
    let reason = reasons[status] ?? "Error"
    let content = body ?? (status == 200 ? Data() : Data(reason.utf8))
    var head = "HTTP/1.1 \(status) \(reason)\r\n"
    head += "Content-Type: \(type)\r\n"
    head += "Content-Length: \(length ?? content.count)\r\n"
    head += "Cache-Control: no-cache\r\n"
    head += "X-Content-Type-Options: nosniff\r\n"
    head += "Connection: close\r\n\r\n"
    connection.send(content: Data(head.utf8) + content, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  private static func type(of file: URL) -> String {
    switch file.pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "wasm": return "application/wasm"
    case "txt": return "text/plain; charset=utf-8"
    default: return "application/octet-stream"
    }
  }
}

// MARK: App

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private let defaults = UserDefaults.standard
  private let port = (Bundle.main.object(forInfoDictionaryKey: "TimeTowerPort") as? NSNumber)?.uint16Value ?? 5199
  private var home: URL { URL(string: "http://localhost:\(port)/")! }
  private var server: LocalServer?
  private var window: NSWindow!
  private var webView: WKWebView!

  private static let zoomSteps: [Double] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMenu()
    makeWindow()
    let server = LocalServer(root: Bundle.main.resourceURL!.appendingPathComponent("web"), port: port)
    server.start { [weak self] error in
      guard let self else { return }
      if let error { self.cannotServe(error) } else { self.goHome(nil) }
    }
    self.server = server
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

  private func makeWindow() {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    // Some sign-in pages turn away browsers they do not recognize.
    configuration.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15"
    #if TESTING
    configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "testClick")
    #endif
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Safari's Develop menu can inspect the page.
    webView.isInspectable = true
    webView.pageZoom = defaults.object(forKey: "pageZoom") as? Double ?? 1

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false)
    window.title = "Time Tower"
    window.contentMinSize = NSSize(width: 480, height: 360)
    window.contentView = webView
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    // Opens where it was last left, or centered the first time.
    if !window.setFrameUsingName("Time Tower") { window.center() }
    window.setFrameAutosaveName("Time Tower")
    applyWindowOptions()
    window.makeKeyAndOrderFront(nil)
  }

  private func cannotServe(_ error: Error) {
    let alert = NSAlert()
    alert.messageText = "Time Tower could not open"
    alert.informativeText = "It shows its page through port \(port) on this Mac, and another program may be using it. Quit that program, then open Time Tower again.\n\n\(error.localizedDescription)"
    alert.runModal()
    NSApp.terminate(nil)
  }

  // MARK: Window options

  private var keepOnTop: Bool {
    get { defaults.bool(forKey: "keepOnTop") }
    set { defaults.set(newValue, forKey: "keepOnTop"); applyWindowOptions() }
  }

  private var everyDesktop: Bool {
    get { defaults.bool(forKey: "everyDesktop") }
    set { defaults.set(newValue, forKey: "everyDesktop"); applyWindowOptions() }
  }

  private func applyWindowOptions() {
    window.level = keepOnTop ? .floating : .normal
    if everyDesktop {
      window.collectionBehavior.insert(.canJoinAllSpaces)
    } else {
      window.collectionBehavior.remove(.canJoinAllSpaces)
    }
  }

  // MARK: Menu

  private func makeMenu() -> NSMenu {
    let bar = NSMenu()
    func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      let holder = NSMenuItem()
      holder.submenu = menu
      bar.addItem(holder)
      return menu
    }
    func item(_ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
      item.keyEquivalentModifierMask = modifiers
      return item
    }

    _ = menu("Time Tower", [
      item("About Time Tower", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Open at login", #selector(toggleOpenAtLogin(_:))),
      .separator(),
      item("Hide Time Tower", #selector(NSApplication.hide(_:)), "h"),
      item("Hide others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show all", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit Time Tower", #selector(NSApplication.terminate(_:)), "q"),
    ])
    // Typing in the page's fields needs these for copy and paste to work.
    _ = menu("Edit", [
      item("Undo", Selector(("undo:")), "z"),
      item("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select all", #selector(NSText.selectAll(_:)), "a"),
    ])
    _ = menu("View", [
      item("Reload", #selector(goHome(_:)), "r"),
      .separator(),
      item("Actual size", #selector(resetZoom(_:)), "0"),
      item("Zoom in", #selector(zoomIn(_:)), "="),
      item("Zoom out", #selector(zoomOut(_:)), "-"),
    ])
    NSApp.windowsMenu = menu("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("Keep on top", #selector(toggleKeepOnTop(_:)), "t", [.command, .option]),
      item("Show on every desktop", #selector(toggleEveryDesktop(_:))),
      .separator(),
      item("Bring all to front", #selector(NSApplication.arrangeInFront(_:))),
    ])
    return bar
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    switch item.action {
    case #selector(toggleKeepOnTop(_:)): item.state = keepOnTop ? .on : .off
    case #selector(toggleEveryDesktop(_:)): item.state = everyDesktop ? .on : .off
    case #selector(toggleOpenAtLogin(_:)): item.state = SMAppService.mainApp.status == .enabled ? .on : .off
    case #selector(resetZoom(_:)): return webView.pageZoom != 1
    case #selector(zoomIn(_:)): return webView.pageZoom < Self.zoomSteps.last!
    case #selector(zoomOut(_:)): return webView.pageZoom > Self.zoomSteps.first!
    default: break
    }
    return true
  }

  /// Loads the page afresh, which is also the way back from any other page.
  @objc func goHome(_ sender: Any?) {
    webView.load(URLRequest(url: home))
  }

  @objc func toggleKeepOnTop(_ sender: Any?) { keepOnTop.toggle() }

  @objc func toggleEveryDesktop(_ sender: Any?) { everyDesktop.toggle() }

  @objc func toggleOpenAtLogin(_ sender: Any?) {
    let service = SMAppService.mainApp
    do {
      if service.status == .enabled {
        try service.unregister()
      } else {
        try service.register()
        if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
      }
    } catch {
      let alert = NSAlert()
      alert.messageText = "Could not change Open at login"
      alert.informativeText = "Add Time Tower in System Settings, General, Login items instead.\n\n\(error.localizedDescription)"
      alert.beginSheetModal(for: window)
    }
  }

  @objc func resetZoom(_ sender: Any?) { setZoom(1) }

  @objc func zoomIn(_ sender: Any?) {
    setZoom(Self.zoomSteps.first { $0 > webView.pageZoom + 0.001 } ?? Self.zoomSteps.last!)
  }

  @objc func zoomOut(_ sender: Any?) {
    setZoom(Self.zoomSteps.last { $0 < webView.pageZoom - 0.001 } ?? Self.zoomSteps.first!)
  }

  private func setZoom(_ zoom: Double) {
    webView.pageZoom = zoom
    defaults.set(zoom, forKey: "pageZoom")
  }

  // MARK: Page

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    goHome(nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    #if TESTING
    runTest()
    #endif
  }

  /// Links that ask for a new window open in the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme ?? "") {
      NSWorkspace.shared.open(url)
    }
    return nil
  }

  /// Import JSON.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
    #if TESTING
    if let folder = testFolder { return completionHandler([folder.appendingPathComponent("import.json")]) }
    #endif
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  // MARK: Downloads

  /// Export JSON: asks where to save, starting in Downloads.
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
    #if TESTING
    if let folder = testFolder { return completionHandler(folder.appendingPathComponent(suggestedFilename)) }
    #endif
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { result in
      guard result == .OK, let url = panel.url else { return completionHandler(nil) }
      // The panel has already asked about replacing, and a download stops
      // if its file exists.
      try? FileManager.default.removeItem(at: url)
      completionHandler(url)
    }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let alert = NSAlert()
    alert.messageText = "Could not save the file"
    alert.informativeText = error.localizedDescription
    alert.beginSheetModal(for: window)
  }

  // MARK: Testing

  #if TESTING
  // Test builds (swiftc -D TESTING) let a script drive the page without
  // clicking. TIMETOWER_TEST_FOLDER stands in for the save and open panels
  // (import reads import.json there). TIMETOWER_TEST_JS names a file of
  // JavaScript, run as an async function once the page loads, whose result
  // is printed as JSON; then TIMETOWER_TEST_SNAPSHOT, if set, saves a PNG of
  // the page there, and the app quits. Script clicks do not count as the
  // user's, so the file picker ignores them; the script can await
  // webkit.messageHandlers.testClick.postMessage({ x, y }) for a real mouse
  // click at a point in the page.

  private static var testStarted = false

  private var testFolder: URL? {
    ProcessInfo.processInfo.environment["TIMETOWER_TEST_FOLDER"].map { URL(fileURLWithPath: $0) }
  }

  private func runTest() {
    let environment = ProcessInfo.processInfo.environment
    guard !Self.testStarted, let scriptPath = environment["TIMETOWER_TEST_JS"] else { return }
    Self.testStarted = true
    let script = (try? String(contentsOfFile: scriptPath, encoding: .utf8)) ?? "return 'no script'"
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [self] result in
      let value: Any
      switch result {
      case .success(let returned): value = returned
      case .failure(let error): value = ["error": "\(error)"]
      }
      let json = (try? JSONSerialization.data(withJSONObject: ["result": value], options: [.fragmentsAllowed, .sortedKeys]))
        .map { String(decoding: $0, as: UTF8.self) } ?? "{\"result\":\"unprintable\"}"
      print(json)
      fflush(stdout)
      guard let snapshotPath = environment["TIMETOWER_TEST_SNAPSHOT"] else { return NSApp.terminate(nil) }
      webView.takeSnapshot(with: nil) { image, _ in
        if let image, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
          try? png.write(to: URL(fileURLWithPath: snapshotPath))
        }
        NSApp.terminate(nil)
      }
    }
  }
  #endif
}

#if TESTING
extension AppDelegate: WKScriptMessageHandlerWithReply {
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
    guard let point = message.body as? [String: Double], let x = point["x"], let y = point["y"] else {
      return replyHandler(nil, "testClick needs x and y")
    }
    let zoom = webView.pageZoom
    let inView = NSPoint(x: x * zoom, y: webView.isFlipped ? y * zoom : webView.bounds.height - y * zoom)
    let location = webView.convert(inView, to: nil)
    for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
      guard let event = NSEvent.mouseEvent(
        with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
      else { return replyHandler(nil, "could not make a mouse event") }
      if type == .leftMouseDown { webView.mouseDown(with: event) } else { webView.mouseUp(with: event) }
    }
    replyHandler(true, nil)
  }
}
#endif

@main
enum TimeTowerApp {
  @MainActor
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
  }
}
