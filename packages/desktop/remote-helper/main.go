package main

import (
    "bufio"
    "encoding/json"
    "errors"
    "flag"
    "fmt"
    "io"
    "net"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
    "strings"
    "sync"
    "sync/atomic"
    "syscall"
    "time"
)

const helperVersion = "1"

type runtimeState struct {
    HelperVersion string `json:"helperVersion"`
    PID           int    `json:"pid"`
    Port          int    `json:"port"`
    Cwd           string `json:"cwd"`
    SessionFile   string `json:"sessionFile"`
    PiPath        string `json:"piPath"`
    PiPID         int    `json:"piPid,omitempty"`
    IsStreaming   bool   `json:"isStreaming"`
    StartedAt     string `json:"startedAt"`
}

type launchOptions struct {
    RunDir      string
    PiPath      string
    SessionFile string
    Cwd         string
}

type commandEnvelope struct {
    ID      string          `json:"id,omitempty"`
    Type    string          `json:"type"`
    Command json.RawMessage `json:"command,omitempty"`
    Cwd     string          `json:"cwd,omitempty"`
}

type responseEnvelope struct {
    Type  string      `json:"type"`
    ID    string      `json:"id,omitempty"`
    Ok    bool        `json:"ok"`
    Data  interface{} `json:"data,omitempty"`
    Error string      `json:"error,omitempty"`
}

type eventEnvelope struct {
    Type  string      `json:"type"`
    Event interface{} `json:"event"`
}

type listDirEntry struct {
    Name     string `json:"name"`
    Path     string `json:"path"`
    IsDir    bool   `json:"isDir"`
    IsHidden bool   `json:"isHidden"`
}

type listDirResult struct {
    Path    string         `json:"path"`
    Parent  string         `json:"parent,omitempty"`
    Entries []listDirEntry `json:"entries"`
}

type pendingRPC struct {
    client   *clientConn
    clientID string
}

type clientConn struct {
    conn   net.Conn
    encMu  sync.Mutex
    closed atomic.Bool
}

func (c *clientConn) writeJSON(value interface{}) error {
    if c.closed.Load() {
        return errors.New("client closed")
    }
    payload, err := json.Marshal(value)
    if err != nil {
        return err
    }
    c.encMu.Lock()
    defer c.encMu.Unlock()
    if c.closed.Load() {
        return errors.New("client closed")
    }
    _, err = c.conn.Write(append(payload, '\n'))
    return err
}

func (c *clientConn) close() {
    if c.closed.CompareAndSwap(false, true) {
        _ = c.conn.Close()
    }
}

type server struct {
    runDir      string
    runtimePath string
    piPath      string
    sessionFile string
    cwd         string
    port        int
    startedAt   string

    listener net.Listener

    mu          sync.Mutex
    clients     map[*clientConn]struct{}
    pending     map[string]pendingRPC
    nextRPCID   uint64
    piCmd       *exec.Cmd
    piStdin     io.WriteCloser
    isStreaming bool
    shuttingDown bool
}

func newServer(runDir, piPath, sessionFile, cwd string, listener net.Listener) (*server, error) {
    addr, ok := listener.Addr().(*net.TCPAddr)
    if !ok {
        return nil, fmt.Errorf("unexpected listener address: %T", listener.Addr())
    }
    return &server{
        runDir:      runDir,
        runtimePath: filepath.Join(runDir, "runtime.json"),
        piPath:      piPath,
        sessionFile: sessionFile,
        cwd:         cwd,
        port:        addr.Port,
        startedAt:   time.Now().UTC().Format(time.RFC3339),
        listener:    listener,
        clients:     map[*clientConn]struct{}{},
        pending:     map[string]pendingRPC{},
    }, nil
}

func (s *server) writeRuntimeState() error {
    s.mu.Lock()
    defer s.mu.Unlock()
    state := runtimeState{
        HelperVersion: helperVersion,
        PID:           os.Getpid(),
        Port:          s.port,
        Cwd:           s.cwd,
        SessionFile:   s.sessionFile,
        PiPath:        s.piPath,
        IsStreaming:   s.isStreaming,
        StartedAt:     s.startedAt,
    }
    if s.piCmd != nil && s.piCmd.Process != nil {
        state.PiPID = s.piCmd.Process.Pid
    }
    payload, err := json.MarshalIndent(state, "", "  ")
    if err != nil {
        return err
    }
    return os.WriteFile(s.runtimePath, append(payload, '\n'), 0o600)
}

func (s *server) broadcast(event interface{}) {
    s.mu.Lock()
    clients := make([]*clientConn, 0, len(s.clients))
    for client := range s.clients {
        clients = append(clients, client)
    }
    s.mu.Unlock()

    message := eventEnvelope{Type: "event", Event: event}
    for _, client := range clients {
        if err := client.writeJSON(message); err != nil {
            client.close()
            s.removeClient(client)
        }
    }
}

func (s *server) removeClient(client *clientConn) {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.clients, client)
    for key, pending := range s.pending {
        if pending.client == client {
            delete(s.pending, key)
        }
    }
}

func (s *server) startPiIfNeeded() error {
    s.mu.Lock()
    if s.piCmd != nil && s.piCmd.Process != nil {
        s.mu.Unlock()
        return nil
    }
    s.mu.Unlock()
    return s.startPi()
}

func (s *server) startPi() error {
    if err := os.MkdirAll(filepath.Dir(s.sessionFile), 0o700); err != nil {
        return err
    }

    cmd := exec.Command(s.piPath, "--mode", "rpc", "--session", s.sessionFile)
    cmd.Dir = s.cwd
    stdout, err := cmd.StdoutPipe()
    if err != nil {
        return err
    }
    stderr, err := cmd.StderrPipe()
    if err != nil {
        return err
    }
    stdin, err := cmd.StdinPipe()
    if err != nil {
        return err
    }
    if err := cmd.Start(); err != nil {
        return err
    }

    s.mu.Lock()
    s.piCmd = cmd
    s.piStdin = stdin
    s.mu.Unlock()
    _ = s.writeRuntimeState()

    go s.readPiOutput(stdout)
    go s.readPiStderr(stderr)
    go s.waitForPi(cmd)
    return nil
}

func (s *server) stopPi() {
    s.mu.Lock()
    cmd := s.piCmd
    stdin := s.piStdin
    s.piCmd = nil
    s.piStdin = nil
    s.isStreaming = false
    s.mu.Unlock()

    if stdin != nil {
        _ = stdin.Close()
    }
    if cmd == nil || cmd.Process == nil {
        _ = s.writeRuntimeState()
        return
    }

    _ = cmd.Process.Signal(syscall.SIGTERM)
    done := make(chan struct{})
    go func() {
        _, _ = cmd.Process.Wait()
        close(done)
    }()

    select {
    case <-done:
    case <-time.After(2 * time.Second):
        _ = cmd.Process.Kill()
        <-done
    }
    _ = s.writeRuntimeState()
}

func (s *server) readPiOutput(r io.Reader) {
    scanner := bufio.NewScanner(r)
    buf := make([]byte, 0, 64*1024)
    scanner.Buffer(buf, 4*1024*1024)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" {
            continue
        }

        var payload map[string]interface{}
        if err := json.Unmarshal([]byte(line), &payload); err != nil {
            s.broadcast(map[string]interface{}{"type": "error", "message": fmt.Sprintf("Remote Pi emitted invalid JSON: %v", err)})
            continue
        }

        if rawType, ok := payload["type"].(string); ok {
            switch rawType {
            case "agent_start":
                s.mu.Lock()
                s.isStreaming = true
                s.mu.Unlock()
                _ = s.writeRuntimeState()
            case "agent_end":
                s.mu.Lock()
                s.isStreaming = false
                s.mu.Unlock()
                _ = s.writeRuntimeState()
            }
        }

        if responseType, ok := payload["type"].(string); ok && responseType == "response" {
            if rawID, ok := payload["id"].(string); ok {
                s.mu.Lock()
                pending, found := s.pending[rawID]
                if found {
                    delete(s.pending, rawID)
                }
                s.mu.Unlock()
                if found {
                    _ = pending.client.writeJSON(responseEnvelope{Type: "response", ID: pending.clientID, Ok: true, Data: payload})
                    continue
                }
            }
        }

        s.broadcast(payload)
    }
}

func (s *server) readPiStderr(r io.Reader) {
    scanner := bufio.NewScanner(r)
    buf := make([]byte, 0, 64*1024)
    scanner.Buffer(buf, 4*1024*1024)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" {
            continue
        }
        s.broadcast(map[string]interface{}{"type": "error", "message": line})
    }
}

func (s *server) waitForPi(cmd *exec.Cmd) {
    _ = cmd.Wait()
    s.mu.Lock()
    if s.piCmd == cmd {
        s.piCmd = nil
        s.piStdin = nil
        s.isStreaming = false
    }
    shuttingDown := s.shuttingDown
    s.mu.Unlock()
    _ = s.writeRuntimeState()
    if !shuttingDown {
        s.broadcast(map[string]interface{}{"type": "error", "message": "Remote Pi process exited."})
    }
}

func (s *server) nextInnerRPCID() string {
    return fmt.Sprintf("rpc-%d", atomic.AddUint64(&s.nextRPCID, 1))
}

func (s *server) sendRPC(client *clientConn, clientID string, raw json.RawMessage) error {
    if err := s.startPiIfNeeded(); err != nil {
        return err
    }

    var payload map[string]interface{}
    if err := json.Unmarshal(raw, &payload); err != nil {
        return err
    }
    innerID := s.nextInnerRPCID()
    payload["id"] = innerID
    encoded, err := json.Marshal(payload)
    if err != nil {
        return err
    }

    s.mu.Lock()
    s.pending[innerID] = pendingRPC{client: client, clientID: clientID}
    stdin := s.piStdin
    s.mu.Unlock()

    if stdin == nil {
        s.mu.Lock()
        delete(s.pending, innerID)
        s.mu.Unlock()
        return errors.New("remote Pi stdin unavailable")
    }

    if _, err := stdin.Write(append(encoded, '\n')); err != nil {
        s.mu.Lock()
        delete(s.pending, innerID)
        s.mu.Unlock()
        return err
    }
    return nil
}

func (s *server) restart(cwd string) error {
    normalized := strings.TrimSpace(cwd)
    if normalized == "" {
        return errors.New("cwd is required")
    }
    if err := updateSessionHeaderCwd(s.sessionFile, normalized); err != nil {
        return err
    }
    s.stopPi()
    s.mu.Lock()
    s.cwd = normalized
    s.mu.Unlock()
    if err := s.writeRuntimeState(); err != nil {
        return err
    }
    return s.startPiIfNeeded()
}

func (s *server) info() runtimeState {
    s.mu.Lock()
    defer s.mu.Unlock()
    state := runtimeState{
        HelperVersion: helperVersion,
        PID:           os.Getpid(),
        Port:          s.port,
        Cwd:           s.cwd,
        SessionFile:   s.sessionFile,
        PiPath:        s.piPath,
        IsStreaming:   s.isStreaming,
        StartedAt:     s.startedAt,
    }
    if s.piCmd != nil && s.piCmd.Process != nil {
        state.PiPID = s.piCmd.Process.Pid
    }
    return state
}

func (s *server) serveConnection(conn net.Conn) {
    client := &clientConn{conn: conn}
    s.mu.Lock()
    s.clients[client] = struct{}{}
    s.mu.Unlock()

    _ = client.writeJSON(responseEnvelope{Type: "response", Ok: true, Data: map[string]interface{}{"connected": true, "helperVersion": helperVersion}})

    scanner := bufio.NewScanner(conn)
    buf := make([]byte, 0, 64*1024)
    scanner.Buffer(buf, 4*1024*1024)
    for scanner.Scan() {
        line := strings.TrimSpace(scanner.Text())
        if line == "" {
            continue
        }

        var command commandEnvelope
        if err := json.Unmarshal([]byte(line), &command); err != nil {
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: false, Error: err.Error()})
            continue
        }

        switch command.Type {
        case "ping":
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: true, Data: s.info()})
        case "get_info":
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: true, Data: s.info()})
        case "rpc":
            if err := s.sendRPC(client, command.ID, command.Command); err != nil {
                _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: false, Error: err.Error()})
            }
        case "restart":
            if err := s.restart(command.Cwd); err != nil {
                _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: false, Error: err.Error()})
                continue
            }
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: true, Data: s.info()})
        case "shutdown":
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: true})
            go func() {
                time.Sleep(150 * time.Millisecond)
                s.shutdown()
            }()
            return
        default:
            _ = client.writeJSON(responseEnvelope{Type: "response", ID: command.ID, Ok: false, Error: fmt.Sprintf("unsupported command: %s", command.Type)})
        }
    }

    client.close()
    s.removeClient(client)
}

func (s *server) shutdown() {
    s.mu.Lock()
    if s.shuttingDown {
        s.mu.Unlock()
        return
    }
    s.shuttingDown = true
    clients := make([]*clientConn, 0, len(s.clients))
    for client := range s.clients {
        clients = append(clients, client)
    }
    s.mu.Unlock()

    s.stopPi()
    _ = os.Remove(s.runtimePath)
    if s.listener != nil {
        _ = s.listener.Close()
    }
    for _, client := range clients {
        client.close()
    }
    os.Exit(0)
}

func (s *server) run() error {
    if err := s.writeRuntimeState(); err != nil {
        return err
    }
    if err := s.startPiIfNeeded(); err != nil {
        return err
    }

    for {
        conn, err := s.listener.Accept()
        if err != nil {
            if s.shuttingDown {
                return nil
            }
            if ne, ok := err.(net.Error); ok && ne.Temporary() {
                time.Sleep(100 * time.Millisecond)
                continue
            }
            return err
        }
        go s.serveConnection(conn)
    }
}

func updateSessionHeaderCwd(sessionFile, cwd string) error {
    contents, err := os.ReadFile(sessionFile)
    if err != nil {
        if errors.Is(err, os.ErrNotExist) {
            return nil
        }
        return err
    }
    lines := strings.Split(string(contents), "\n")
    headerIndex := -1
    for index, line := range lines {
        if strings.TrimSpace(line) != "" {
            headerIndex = index
            break
        }
    }
    if headerIndex == -1 {
        return nil
    }
    var header map[string]interface{}
    if err := json.Unmarshal([]byte(lines[headerIndex]), &header); err != nil {
        return nil
    }
    if header["type"] != "session" {
        return nil
    }
    header["cwd"] = cwd
    encoded, err := json.Marshal(header)
    if err != nil {
        return err
    }
    lines[headerIndex] = string(encoded)
    return os.WriteFile(sessionFile, []byte(strings.TrimRight(strings.Join(lines, "\n"), "\n")+"\n"), 0o600)
}

func readRuntimeState(path string) (*runtimeState, error) {
    contents, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    var state runtimeState
    if err := json.Unmarshal(contents, &state); err != nil {
        return nil, err
    }
    return &state, nil
}

func processAlive(pid int) bool {
    if pid <= 0 {
        return false
    }
    err := syscall.Kill(pid, 0)
    return err == nil
}

func waitForRuntime(path string, timeout time.Duration) (*runtimeState, error) {
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        state, err := readRuntimeState(path)
        if err == nil && state != nil && state.Port > 0 && processAlive(state.PID) {
            conn, dialErr := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", state.Port), 200*time.Millisecond)
            if dialErr == nil {
                _ = conn.Close()
                return state, nil
            }
        }
        time.Sleep(100 * time.Millisecond)
    }
    return nil, errors.New("timed out waiting for helper runtime")
}

func launchServer(opts launchOptions) error {
    if err := os.MkdirAll(opts.RunDir, 0o700); err != nil {
        return err
    }
    runtimePath := filepath.Join(opts.RunDir, "runtime.json")
    if state, err := readRuntimeState(runtimePath); err == nil && state != nil && processAlive(state.PID) {
        payload, _ := json.Marshal(state)
        _, _ = os.Stdout.Write(append(payload, '\n'))
        return nil
    }

    listener, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        return err
    }
    addr := listener.Addr().(*net.TCPAddr)
    _ = listener.Close()

    logFilePath := filepath.Join(opts.RunDir, "helper.log")
    logFile, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
    if err != nil {
        return err
    }
    defer logFile.Close()

    selfPath, err := os.Executable()
    if err != nil {
        return err
    }

    cmd := exec.Command(
        selfPath,
        "server",
        "--run-dir", opts.RunDir,
        "--pi", opts.PiPath,
        "--session", opts.SessionFile,
        "--cwd", opts.Cwd,
        "--listen", fmt.Sprintf("127.0.0.1:%d", addr.Port),
    )
    cmd.Stdout = logFile
    cmd.Stderr = logFile
    cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
    if err := cmd.Start(); err != nil {
        return err
    }

    state, err := waitForRuntime(runtimePath, 10*time.Second)
    if err != nil {
        return err
    }
    payload, _ := json.Marshal(state)
    _, _ = os.Stdout.Write(append(payload, '\n'))
    return nil
}

func runServer(runDir, piPath, sessionFile, cwd, listenAddr string) error {
    if err := os.MkdirAll(runDir, 0o700); err != nil {
        return err
    }
    listener, err := net.Listen("tcp", listenAddr)
    if err != nil {
        return err
    }
    server, err := newServer(runDir, piPath, sessionFile, cwd, listener)
    if err != nil {
        _ = listener.Close()
        return err
    }
    return server.run()
}

func expandPath(path string) (string, error) {
    trimmed := strings.TrimSpace(path)
    if trimmed == "" {
        home, err := os.UserHomeDir()
        if err != nil {
            return "", err
        }
        return home, nil
    }
    if trimmed == "~" || strings.HasPrefix(trimmed, "~/") {
        home, err := os.UserHomeDir()
        if err != nil {
            return "", err
        }
        if trimmed == "~" {
            return home, nil
        }
        return filepath.Join(home, strings.TrimPrefix(trimmed, "~/")), nil
    }
    return filepath.Clean(trimmed), nil
}

func listDirectory(path string) error {
    resolved, err := expandPath(path)
    if err != nil {
        return err
    }
    entries, err := os.ReadDir(resolved)
    if err != nil {
        return err
    }
    result := listDirResult{
        Path:    resolved,
        Entries: make([]listDirEntry, 0, len(entries)),
    }
    parent := filepath.Dir(resolved)
    if parent != resolved {
        result.Parent = parent
    }
    sort.Slice(entries, func(i, j int) bool {
        leftDir := entries[i].IsDir()
        rightDir := entries[j].IsDir()
        if leftDir != rightDir {
            return leftDir
        }
        return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
    })
    for _, entry := range entries {
        name := entry.Name()
        result.Entries = append(result.Entries, listDirEntry{
            Name:     name,
            Path:     filepath.Join(resolved, name),
            IsDir:    entry.IsDir(),
            IsHidden: strings.HasPrefix(name, "."),
        })
    }
    payload, err := json.Marshal(result)
    if err != nil {
        return err
    }
    _, err = os.Stdout.Write(append(payload, '\n'))
    return err
}

func stopRuntime(runDir string) error {
    runtimePath := filepath.Join(runDir, "runtime.json")
    state, err := readRuntimeState(runtimePath)
    if err != nil {
        if errors.Is(err, os.ErrNotExist) {
            return nil
        }
        return err
    }
    if !processAlive(state.PID) {
        _ = os.Remove(runtimePath)
        return nil
    }
    return syscall.Kill(state.PID, syscall.SIGTERM)
}

func main() {
    if len(os.Args) < 2 {
        fmt.Fprintln(os.Stderr, "usage: pa-ssh-remote-helper <launch|server|list-dir|stop> ...")
        os.Exit(1)
    }

    var err error
    switch os.Args[1] {
    case "launch":
        flags := flag.NewFlagSet("launch", flag.ExitOnError)
        runDir := flags.String("run-dir", "", "Run directory")
        piPath := flags.String("pi", "", "Path to pi binary")
        sessionFile := flags.String("session", "", "Path to pi session file")
        cwd := flags.String("cwd", "", "Working directory")
        _ = flags.Parse(os.Args[2:])
        err = launchServer(launchOptions{RunDir: *runDir, PiPath: *piPath, SessionFile: *sessionFile, Cwd: *cwd})
    case "server":
        flags := flag.NewFlagSet("server", flag.ExitOnError)
        runDir := flags.String("run-dir", "", "Run directory")
        piPath := flags.String("pi", "", "Path to pi binary")
        sessionFile := flags.String("session", "", "Path to pi session file")
        cwd := flags.String("cwd", "", "Working directory")
        listen := flags.String("listen", "127.0.0.1:0", "Listen address")
        _ = flags.Parse(os.Args[2:])
        err = runServer(*runDir, *piPath, *sessionFile, *cwd, *listen)
    case "list-dir":
        flags := flag.NewFlagSet("list-dir", flag.ExitOnError)
        path := flags.String("path", "", "Directory path")
        _ = flags.Parse(os.Args[2:])
        err = listDirectory(*path)
    case "stop":
        flags := flag.NewFlagSet("stop", flag.ExitOnError)
        runDir := flags.String("run-dir", "", "Run directory")
        _ = flags.Parse(os.Args[2:])
        err = stopRuntime(*runDir)
    default:
        err = fmt.Errorf("unsupported helper command: %s", os.Args[1])
    }

    if err != nil {
        fmt.Fprintln(os.Stderr, err.Error())
        os.Exit(1)
    }
}
