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
    let url: String?
}

private struct MenuBarPayload: Decodable {
    let image: String
    let label: String
    let accounts: [MenuBarAccount]
    let rows: [MenuBarRow]
}

// A small status-item host with a click menu and saved account selection.
final class UsageConsoleMenuBar: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    private let lockFD: Int32
    private let chinese: Bool
    private let dashboard: URL
    private let stateURL: URL
    private var selectedIDs: [String]?
    private var allAccounts = false
    private var accounts: [(id: String, name: String)] = []
    private var accountMenu: NSMenu?
    private var pendingRefresh = false
    private var item: NSStatusItem!
    private var timer: Timer?
    private var process: Process?
    private var signalSources: [DispatchSourceSignal] = []

    init(arguments: [String], lockFD: Int32, stateURL: URL) {
        self.arguments = arguments
        self.lockFD = lockFD
        self.stateURL = stateURL
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
        RunLoop.main.add(timer!, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(refresh), name: NSWorkspace.didWakeNotification, object: nil)
        for value in [SIGTERM, SIGINT] {
            Darwin.signal(value, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: value, queue: .main)
            source.setEventHandler { NSApplication.shared.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        if let child = process, child.isRunning { kill(child.processIdentifier, SIGKILL) }
        close(lockFD)
    }

    @objc private func refresh() {
        guard process == nil else { return }
        let child = Process()
        let output = Pipe()
        child.executableURL = URL(fileURLWithPath: arguments[0])
        var childArguments: [String] = []
        var index = 1
        while index < arguments.count {
            let value = arguments[index]
            if value == "--account" || value == "--accounts" { index += 2; continue }
            if !value.hasPrefix("--account=") && !value.hasPrefix("--accounts=") { childArguments.append(value) }
            index += 1
        }
        if allAccounts { childArguments += ["--accounts", "all"] }
        else if let ids = selectedIDs, let data = try? JSONSerialization.data(withJSONObject: ids), let value = String(data: data, encoding: .utf8) {
            childArguments += ["--accounts", value]
        }
        child.arguments = childArguments
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice
        process = child
        do { try child.run() } catch {
            process = nil
            showOffline()
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
                if self.pendingRefresh { self.pendingRefresh = false; self.refresh() }
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
        guard let payload = try? JSONDecoder().decode(MenuBarPayload.self, from: content),
              let data = Data(base64Encoded: payload.image), let image = NSImage(data: data),
              image.size.width.isFinite, image.size.height.isFinite,
              image.size.width > 0, image.size.height > 0 else { showOffline(); return }
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
            if row.action == .dashboard, let href = row.url, let url = Self.localURL(href) {
                let entry = action(title, selector: #selector(openDashboard(_:)))
                entry.representedObject = url
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
        if process != nil { pendingRefresh = true } else { refresh() }
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

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 4, arguments[2] == "menubar", arguments.contains("--data") else {
    fputs("Usage: UsageConsoleMenuBar <node> <usage-console.js> menubar --data [options]\n", stderr)
    exit(1)
}
let cache = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".usage-console/menubar", isDirectory: true)
do { try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true) } catch {
    fputs("Cannot create Usage Console menu-bar cache.\n", stderr)
    exit(1)
}
let digest = SHA256.hash(data: Data(arguments.joined(separator: "\0").utf8)).map { String(format: "%02x", $0) }.joined()
let lock = cache.appendingPathComponent(digest + ".lock").path
let lockFD = open(lock, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
guard lockFD >= 0 else { fputs("Cannot create menu-bar instance lock.\n", stderr); exit(1) }
guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { close(lockFD); exit(0) }
fchmod(lockFD, S_IRUSR | S_IWUSR)
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let controller = UsageConsoleMenuBar(arguments: arguments, lockFD: lockFD, stateURL: URL(fileURLWithPath: lock + ".json"))
application.delegate = controller
application.run()
