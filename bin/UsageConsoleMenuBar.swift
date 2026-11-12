import AppKit
import CryptoKit
import Darwin

private struct MenuBarAccount: Decodable {
    let id: String
    let name: String
}

private struct MenuBarRow: Decodable {
    enum Action: String, Decodable { case dashboard, refresh }
    let title: String?
    let separator: Bool?
    let action: Action?
}

private struct MenuBarPayload: Decodable {
    let image: String
    let label: String
    let accounts: [MenuBarAccount]
    let rows: [MenuBarRow]
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct ManagedService {
    let process: Process
    let lifetime: FileHandle

    func stop() {
        try? lifetime.close()
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
    }
}

private func startService(_ script: String, node: String, url: String) throws -> ManagedService? {
    let process = Process()
    let lifetime = Pipe()
    let status = Pipe()
    process.executableURL = URL(fileURLWithPath: node)
    process.arguments = [script, url]
    process.standardInput = lifetime
    process.standardOutput = status
    process.standardError = FileHandle.nullDevice
    try process.run()

    let reader = status.fileHandleForReading
    var output = Data()
    while !output.contains(10), output.count < 4096 {
        let chunk = reader.availableData
        if chunk.isEmpty { break }
        output.append(chunk)
    }
    try? reader.close()
    let result = String(decoding: output.prefix { $0 != 10 }, as: UTF8.self)
    if result == "owned" { return ManagedService(process: process, lifetime: lifetime.fileHandleForWriting) }
    try? lifetime.fileHandleForWriting.close()
    if result == "reused" { return nil }
    let message = result.isEmpty ? "Local Usage Console service exited during startup." : result
    throw NSError(domain: "UsageConsoleMenuBar", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func launchStatus(_ message: String) {
    FileHandle.standardOutput.write(Data((message + "\n").utf8))
}

// A small status-item host with a click menu and saved account selection.
final class UsageConsoleMenuBar: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    private let lockFD: Int32
    private let chinese: Bool
    private let dashboard: URL
    private let stateURL: URL
    private let service: ManagedService?
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        configuration.connectionProxyDictionary = [
            "HTTPEnable": 0, "HTTPSEnable": 0, "SOCKSEnable": 0,
            "ProxyAutoConfigEnable": 0, "ProxyAutoDiscoveryEnable": 0,
        ]
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()
    private var selectedIDs: [String]?
    private var allAccounts = false
    private var accounts: [(id: String, name: String)] = []
    private var accountMenu: NSMenu?
    private var pendingRefresh = false
    private var item: NSStatusItem!
    private var timer: Timer?
    private var request: URLSessionDataTask?
    private var process: Process?
    private var lastContent: Data?
    private var signalSources: [DispatchSourceSignal] = []

    fileprivate init(arguments: [String], lockFD: Int32, stateURL: URL, service: ManagedService?) {
        self.arguments = arguments
        self.lockFD = lockFD
        self.stateURL = stateURL
        self.service = service
        func option(_ name: String) -> String? {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        chinese = option("--lang") != "en"
        dashboard = Self.localURL(option("--url") ?? "http://127.0.0.1:3001")!
        let saved = (try? Data(contentsOf: stateURL)).flatMap { try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) }
        if let ids = saved as? [String] { selectedIDs = ids }
        else if saved as? String == "all" { allAccounts = true }
        else if let value = option("--accounts") {
            allAccounts = value == "all"
            selectedIDs = value.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String]
        } else if let id = option("--account") { selectedIDs = [id] }
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        showOffline()
        refresh()
        timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in self?.refresh() }
        timer?.tolerance = 5
        RunLoop.main.add(timer!, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(refresh), name: NSWorkspace.didWakeNotification, object: nil)
        for value in [SIGTERM, SIGINT] {
            Darwin.signal(value, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: value, queue: .main)
            source.setEventHandler { NSApplication.shared.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
        launchStatus("ready")
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        request?.cancel()
        if let child = process, child.isRunning { kill(child.processIdentifier, SIGKILL) }
        service?.stop()
        close(lockFD)
    }

    private var selectionArgument: String? {
        if allAccounts { return "all" }
        guard let ids = selectedIDs, let data = try? JSONSerialization.data(withJSONObject: ids) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @objc private func refresh() {
        guard request == nil, process == nil else { return }
        var components = URLComponents(url: dashboard, resolvingAgainstBaseURL: false)!
        components.path = "/api/menubar"
        var query = [URLQueryItem(name: "lang", value: chinese ? "zh" : "en")]
        if let selection = selectionArgument { query.append(URLQueryItem(name: "accounts", value: selection)) }
        components.queryItems = query
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        let task = session.dataTask(with: components.url!) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.request = nil
                if error != nil, self.dashboard.scheme == "https" {
                    self.refreshViaCLI()
                    return
                }
                if let response = response as? HTTPURLResponse {
                    if [404, 414, 431].contains(response.statusCode) || (response.statusCode == 200 && response.mimeType == "text/html") {
                        // Older servers and selections too large for a query can use the original data command.
                        self.refreshViaCLI()
                        return
                    }
                    if response.statusCode == 200, response.mimeType == "application/json", let data, data.count <= 2 * 1024 * 1024 {
                        self.update(data)
                        self.finishRefresh()
                        return
                    }
                }
                self.showOffline()
                self.finishRefresh()
            }
        }
        request = task
        task.resume()
    }

    private func finishRefresh() {
        if pendingRefresh {
            pendingRefresh = false
            refresh()
        }
    }

    private func refreshViaCLI() {
        let child = Process()
        let output = Pipe()
        child.executableURL = URL(fileURLWithPath: arguments[0])
        var childArguments = [arguments[1], "menubar", "--data", "--url", dashboard.absoluteString, "--lang", chinese ? "zh" : "en"]
        if let selection = selectionArgument { childArguments += ["--accounts", selection] }
        child.arguments = childArguments
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice
        process = child
        do { try child.run() } catch {
            process = nil
            showOffline()
            finishRefresh()
            return
        }
        // Read while the process runs, so a full stdout pipe cannot block its exit.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            child.waitUntilExit()
            DispatchQueue.main.async {
                guard let self, self.process === child else { return }
                self.process = nil
                if child.terminationStatus == 0 {
                    self.update(data)
                } else { self.showOffline() }
                self.finishRefresh()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self, self.process === child, child.isRunning else { return }
            kill(child.processIdentifier, SIGKILL)
        }
    }

    private static func localURL(_ text: String) -> URL? {
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host?.lowercased(), ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host),
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    private func update(_ content: Data) {
        guard content != lastContent else { return }
        guard let payload = try? JSONDecoder().decode(MenuBarPayload.self, from: content),
              let data = Data(base64Encoded: payload.image), let image = NSImage(data: data),
              image.size.width.isFinite, image.size.height.isFinite,
              image.size.width > 0, image.size.height > 0 else { showOffline(); return }
        lastContent = content
        image.size = NSSize(width: image.size.width * 16 / image.size.height, height: 16)
        image.isTemplate = true
        item.button?.title = ""
        item.button?.image = image
        item.button?.setAccessibilityLabel(payload.label)
        accounts = payload.accounts.map { ($0.id, $0.name) }
        if selectedIDs == nil && !allAccounts, let first = accounts.first { selectedIDs = [first.id] }
        let menu = NSMenu()
        addAccountChooser(to: menu)
        var dashboardAdded = false
        var refreshAdded = false
        for row in payload.rows {
            if row.separator == true {
                if !menu.items.isEmpty, menu.items.last?.isSeparatorItem != true { menu.addItem(.separator()) }
                continue
            }
            let title = String((row.title ?? "").prefix(180))
            if title.isEmpty { continue }
            if row.action == .dashboard {
                let entry = action(title, selector: #selector(openDashboard(_:)))
                entry.representedObject = dashboard
                menu.addItem(entry)
                dashboardAdded = true
            } else if row.action == .refresh {
                menu.addItem(action(title, selector: #selector(refresh)))
                refreshAdded = true
            } else {
                let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                entry.isEnabled = false
                menu.addItem(entry)
            }
        }
        addActions(to: menu, dashboardAdded: dashboardAdded, refreshAdded: refreshAdded)
        item.menu = menu
    }

    private func action(_ title: String, selector: Selector) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        entry.target = self
        return entry
    }

    private func addAccountChooser(to menu: NSMenu) {
        let chooser = NSMenuItem(title: chinese ? "显示账户" : "Visible accounts", action: nil, keyEquivalent: "")
        accountMenu = NSMenu()
        chooser.submenu = accountMenu
        menu.addItem(chooser)
        updateAccountChoices()
    }

    private func updateAccountChoices() {
        guard let menu = accountMenu else { return }
        menu.removeAllItems()
        let all = action(chinese ? "全部显示" : "Show all", selector: #selector(selectAllAccounts))
        all.state = allAccounts ? .on : .off
        menu.addItem(all)
        if !accounts.isEmpty { menu.addItem(.separator()) }
        for account in accounts {
            let entry = action(String(account.name.prefix(100)), selector: #selector(toggleAccount(_:)))
            entry.representedObject = account.id
            entry.state = allAccounts || selectedIDs?.contains(account.id) == true ? .on : .off
            menu.addItem(entry)
        }
    }

    @objc private func selectAllAccounts() { allAccounts = true; selectedIDs = nil; selectionChanged() }

    @objc private func toggleAccount(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        var ids = allAccounts ? accounts.map(\.id) : selectedIDs ?? []
        if ids.contains(id) { ids.removeAll { $0 == id } } else { ids.append(id) }
        allAccounts = false
        selectedIDs = ids
        selectionChanged()
    }

    private func selectionChanged() {
        updateAccountChoices()
        let temporary = stateURL.appendingPathExtension(UUID().uuidString)
        do {
            let data = try JSONSerialization.data(withJSONObject: allAccounts ? "all" : selectedIDs ?? [], options: .fragmentsAllowed)
            guard FileManager.default.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
            guard rename(temporary.path, stateURL.path) == 0 else { throw CocoaError(.fileWriteUnknown) }
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            NSSound.beep()
        }
        if process != nil || request != nil { pendingRefresh = true } else { refresh() }
    }

    private func addActions(to menu: NSMenu, dashboardAdded: Bool = false, refreshAdded: Bool = false) {
        if !dashboardAdded {
            let entry = action(chinese ? "打开完整看板" : "Open dashboard", selector: #selector(openDashboard(_:)))
            entry.representedObject = dashboard
            menu.addItem(entry)
        }
        if !refreshAdded { menu.addItem(action(chinese ? "刷新显示" : "Refresh display", selector: #selector(refresh))) }
        if menu.items.last?.isSeparatorItem != true { menu.addItem(.separator()) }
        menu.addItem(action(chinese ? "退出菜单栏" : "Quit menu bar", selector: #selector(quit)))
    }

    private func showOffline() {
        lastContent = nil
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
            NSColor.black.setStroke()
            let ring = NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2))
            ring.lineWidth = 1.75
            ring.setLineDash([2, 2], count: 2, phase: 0)
            ring.stroke()
            return true
        }
        image.isTemplate = true
        let text = chinese ? "Usage Console：服务离线或读取失败" : "Usage Console: Offline or read failed"
        item.button?.title = ""
        item.button?.image = image
        item.button?.setAccessibilityLabel(text)
        let menu = NSMenu()
        addAccountChooser(to: menu)
        menu.addItem(NSMenuItem(title: text, action: nil, keyEquivalent: ""))
        menu.addItem(.separator())
        addActions(to: menu)
        item.menu = menu
    }

    @objc private func openDashboard(_ sender: NSMenuItem) {
        NSWorkspace.shared.open(sender.representedObject as? URL ?? dashboard)
    }

    @objc private func quit() { NSApplication.shared.terminate(nil) }
}

let arguments = Array(CommandLine.arguments.dropFirst(3))
guard arguments.count >= 8, arguments[2] == "menubar", arguments[3] == "--data", arguments[4] == "--url" else {
    launchStatus("Invalid arguments for the Usage Console menu bar helper.")
    exit(1)
}
let cache = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let script = CommandLine.arguments[2]
let digest = SHA256.hash(data: Data(arguments.joined(separator: "\0").utf8)).map { String(format: "%02x", $0) }.joined()
let lock = cache.appendingPathComponent(digest + (script.isEmpty ? ".attached.lock" : ".lock")).path
let lockFD = open(lock, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
guard lockFD >= 0 else { launchStatus("Cannot create menu bar instance lock."); exit(1) }
guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
    let held = errno == EWOULDBLOCK
    close(lockFD)
    launchStatus(held ? "already running" : "Cannot acquire menu bar instance lock.")
    exit(held ? 0 : 1)
}
fchmod(lockFD, S_IRUSR | S_IWUSR)
private let service: ManagedService?
do {
    service = script.isEmpty ? nil : try startService(script, node: arguments[0], url: arguments[5])
} catch {
    launchStatus(error.localizedDescription)
    exit(1)
}
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let stateURL = cache.appendingPathComponent(digest + ".lock.json")
let controller = UsageConsoleMenuBar(arguments: arguments, lockFD: lockFD, stateURL: stateURL, service: service)
application.delegate = controller
application.run()
