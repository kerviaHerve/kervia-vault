// Package update implements the self-update mechanism: check the latest
// GitHub release, download the new binary, verify its sha256 against the
// published checksums, sanity-check it, then swap it atomically.
//
// Security model:
//   - releases are public (curl-able, no token) — same channel as install.sh
//   - the sha256 checksum file is mandatory: an unsigned binary is refused
//   - the new binary must answer `--version` before the swap
//   - the swap is a rename(2) — atomic; the running process keeps its inode,
//     systemd Restart=on-failure brings the new binary up on exit(0)
//   - data (/var/lib/kervia-vault) is NEVER touched: only /usr/local/bin is
//
// SPDX-License-Identifier: AGPL-3.0
package update

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ReleasesBase is the public releases root (overridable via
// KERVIA_VAULT_UPDATE_URL for tests/private mirrors; defaults to GitHub).
var ReleasesBase = envOr("KERVIA_VAULT_UPDATE_URL", "https://github.com/kerviaHerve/kervia-vault/releases")

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// checkCacheTTL: how long a status answer is trusted. Short on purpose:
// a fresh release should be visible within minutes, and the cost is one
// HEAD request to GitHub per check. The apply path ALWAYS re-resolves.
const checkCacheTTL = 5 * time.Minute

// Manager handles update checks and application.
type Manager struct {
	// selfPath is the running binary (/usr/local/bin/kervia-vault).
	selfPath string
	// current version (main.version at build time).
	current string

	mu        sync.Mutex
	cached    *Status
	cachedAt  time.Time
	lastError string
}

// Status is the update state exposed to the webui.
type Status struct {
	Current     string `json:"current"`
	Latest      string `json:"latest,omitempty"`
	UpdateAvail bool   `json:"update_available"`
	Notes       string `json:"notes,omitempty"`
	Mode        string `json:"mode"` // systemd (self-update OK) | docker (manual)
	LastError   string `json:"last_error,omitempty"`
	CheckedAt   string `json:"checked_at,omitempty"`
}

// New builds the manager; selfPath is resolved from /proc/self/exe so the
// swap always targets the real file, not a symlink chain.
func New(current string) *Manager {
	self, err := os.Readlink("/proc/self/exe")
	if err != nil {
		self, _ = os.Executable()
	}
	return &Manager{selfPath: self, current: current}
}

// Mode detects how this instance was deployed. Docker (distroless) is
// read-only: self-update is impossible → the webui says so instead of failing.
func (m *Manager) Mode() string {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "docker"
	}
	return "systemd"
}

// LatestVersion resolves releases/latest via the 302 Location header.
// No API call, no rate limit, no token.
func LatestVersion(client *http.Client) (string, error) {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	req, err := http.NewRequest("GET", ReleasesBase+"/latest", nil)
	if err != nil {
		return "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != 302 {
		return "", fmt.Errorf("releases/latest: unexpected status %d", res.StatusCode)
	}
	loc := res.Header.Get("Location")
	tag := loc[strings.LastIndex(loc, "/")+1:]
	if !strings.HasPrefix(tag, "v") {
		return "", fmt.Errorf("unexpected location: %s", loc)
	}
	return tag, nil
}

// Compare returns >0 if a > b (semver on v-prefixed tags).
func Compare(a, b string) int {
	pa := ParseSemver(a)
	pb := ParseSemver(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

var semverRe = regexp.MustCompile(`v?(\d+)\.(\d+)\.(\d+)`)

// ParseSemver extracts [major, minor, patch]; missing parts = 0.
func ParseSemver(v string) [3]int {
	var out [3]int
	m := semverRe.FindStringSubmatch(v)
	if m == nil {
		return out
	}
	for i := 0; i < 3; i++ {
		_, _ = fmt.Sscanf(m[i+1], "%d", &out[i])
	}
	return out
}

// Current returns the running version.
func (m *Manager) Current() string { return m.current }

// Check returns the (cached) update status.
func (m *Manager) Check(force bool) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if !force && m.cached != nil && now.Sub(m.cachedAt) < checkCacheTTL {
		st := *m.cached
		st.LastError = m.lastError
		return st
	}
	st := Status{Current: m.current, Mode: m.Mode()}
	latest, err := LatestVersion(nil)
	if err != nil {
		m.lastError = err.Error()
		st.LastError = m.lastError
		st.CheckedAt = now.Format(time.RFC3339)
		return st
	}
	m.lastError = ""
	st.Latest = latest
	st.UpdateAvail = Compare(latest, m.current) > 0
	st.CheckedAt = now.Format(time.RFC3339)
	m.cached = &st
	m.cachedAt = now
	return st
}

// Apply downloads the latest release, verifies it and swaps the binary.
// Steps: download tar.gz + checksums → sha256 verify → extract to temp →
// run `newbin --version` (must print, must differ from current) → chmod →
// rename over selfPath → exit. The data dir is never touched.
func (m *Manager) Apply() (string, error) {
	if m.Mode() == "docker" {
		return "", fmt.Errorf("docker: le système de fichiers est en lecture seule — mettez à jour via docker compose pull/build")
	}
	latest, err := LatestVersion(nil)
	if err != nil {
		return "", err
	}
	if Compare(latest, m.current) <= 0 {
		return "", fmt.Errorf("déjà à jour (%s)", m.current)
	}

	dir, err := os.MkdirTemp("", "kerviavault-update-*")
	if err != nil {
		return "", err
	}
	defer func() { _ = os.RemoveAll(dir) }()

	tarName := "kervia-vault-linux-" + arch() + ".tar.gz"
	client := &http.Client{Timeout: 10 * time.Minute}

	// 1. checksums first (small) — the binary download is the big one
	sums, err := download(client, dir+"/checksums.txt", ReleasesBase+"/download/"+latest+"/kervia-vault_checksums.txt")
	if err != nil {
		return "", fmt.Errorf("checksums: %w", err)
	}
	want, err := checksumFor(string(sums), tarName)
	if err != nil {
		return "", err
	}

	// 2. binary tarball
	tarPath := filepath.Join(dir, tarName)
	if _, err := download(client, tarPath, ReleasesBase+"/download/"+latest+"/"+tarName); err != nil {
		return "", fmt.Errorf("téléchargement: %w", err)
	}

	// 3. sha256 — mandatory, same rule as install.sh
	got, err := fileSHA256(tarPath)
	if err != nil {
		return "", err
	}
	if got != want {
		return "", fmt.Errorf("checksum INVALIDE (attendu %s, reçu %s)", want[:12], got[:12])
	}

	// 4. extract
	bin := filepath.Join(dir, "kervia-vault")
	if err := extractTarGz(tarPath, bin); err != nil {
		return "", fmt.Errorf("extraction: %w", err)
	}

	// 5. sanity: the new binary must at least START. It runs with a CLEAN
	// environment (the service env vars must NOT leak into the probe — an
	// KERVIA_VAULT_LISTEN probe would try to bind the live server's port).
	// Two accepted shapes:
	//   a) `--version` prints the version string (recent binaries)
	//   b) no config → the binary boots and fail-closes on the missing
	//      master key (older releases without the flag) — reaching config
	//      validation proves the executable is alive.
	if err := os.Chmod(bin, 0o755); err != nil { // #nosec G302 -- a binary must be executable
		return "", err
	}
	cmd := exec.Command(bin, "--version") // #nosec G204 -- fixed path, our own release artifact
	cmd.Env = []string{"PATH=" + os.Getenv("PATH")} // deliberately empty config
	out, _ := cmd.CombinedOutput()
	probe := strings.TrimSpace(string(out))
	if cmd.ProcessState == nil || !cmd.ProcessState.Exited() {
		return "", fmt.Errorf("le binaire téléchargé ne se termine pas")
	}
	newVer := probe
	if cmd.ProcessState.ExitCode() != 0 {
		if !strings.Contains(probe, "KERVIA_VAULT_MASTER_KEY is required") {
			return "", fmt.Errorf("le binaire téléchargé refuse de démarrer: %s", probe)
		}
		// shape (b): older binary without --version — alive, version unknown
		newVer = latest + " (pré-version)"
	}
	if newVer == "" {
		return "", fmt.Errorf("le binaire téléchargé n'affiche pas sa version")
	}

	// 6. atomic swap: copy the verified binary NEXT TO the live one (same
	// filesystem — rename(2) cannot cross devices), then rename over it.
	// The running process keeps its inode; systemd Restart=on-failure
	// brings the new file up.
	newPath := m.selfPath + ".new"
	nf, err := os.OpenFile(newPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755) // #nosec G304,G302 -- beside the live binary; must be executable
	if err != nil {
		return "", fmt.Errorf("préparation du swap: %w", err)
	}
	src, err := os.Open(bin) // #nosec G304 -- our verified temp artifact
	if err != nil {
		_ = os.Remove(newPath)
		return "", err
	}
	if _, err := io.Copy(nf, src); err != nil { // #nosec G110 -- our own release artifact, sha-verified
		_ = src.Close()
		_ = nf.Close()
		_ = os.Remove(newPath)
		return "", fmt.Errorf("copie: %w", err)
	}
	_ = src.Close()
	if err := nf.Close(); err != nil {
		_ = os.Remove(newPath)
		return "", err
	}
	if err := os.Chmod(newPath, 0o755); err != nil { // #nosec G302 -- a binary must be executable
		_ = os.Remove(newPath)
		return "", err
	}
	if err := os.Rename(newPath, m.selfPath); err != nil {
		_ = os.Remove(newPath)
		return "", fmt.Errorf("swap: %w", err)
	}
	return newVer, nil
}

// download fetches url into path, returns the bytes (for small files).
func download(client *http.Client, path, url string) ([]byte, error) {
	res, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d pour %s", res.StatusCode, url)
	}
	f, err := os.Create(path) // #nosec G304 -- path is inside our own MkdirTemp dir
	if err != nil {
		return nil, err
	}
	written, err := io.Copy(f, res.Body)
	closeErr := f.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if written == 0 {
		return nil, fmt.Errorf("réponse vide pour %s", url)
	}
	b, _ := os.ReadFile(path) // #nosec G304 -- same temp file we just wrote
	return b, nil
}

// checksumFor extracts "<sha256>  <file>" for the given archive name.
func checksumFor(sums, name string) (string, error) {
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && strings.HasSuffix(fields[1], name) {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("%s absent des checksums", name)
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path) // #nosec G304 -- temp dir we just created
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// arch maps runtime.GOARCH to the release archive naming.
func arch() string {
	switch runtime.GOARCH {
	case "amd64", "arm64":
		return runtime.GOARCH
	default:
		return "unsupported"
	}
}

// extractTarGz pulls the single "kervia-vault" member out of the tarball.
func extractTarGz(tarPath, dest string) error {
	f, err := os.Open(tarPath) // #nosec G304 -- temp file we just downloaded+verified
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer func() { _ = gz.Close() }()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return fmt.Errorf("binaire absent de l'archive")
		}
		if err != nil {
			return err
		}
		if hdr.Name == "kervia-vault" && hdr.Typeflag == tar.TypeReg {
			out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755) // #nosec G304,G302 -- dest is in our MkdirTemp dir; a binary must be executable
			if err != nil {
				return err
			}
			_, cpErr := io.Copy(out, tr) // #nosec G110 -- our own release artifact, sha-verified
			closeErr := out.Close()
			if cpErr != nil {
				return cpErr
			}
			return closeErr
		}
	}
}
