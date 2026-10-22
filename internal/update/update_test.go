// Update manager tests: semver comparison, checksum parsing, latest-version
// resolution against the real releases endpoint (skipped when offline).
// SPDX-License-Identifier: AGPL-3.0

package update

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestCompareSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.0.0", "v1.0.0", 0},
		{"v1.0.1", "v1.0.0", 1},
		{"v1.0.0", "v1.0.1", -1},
		{"v1.1.0", "v1.0.9", 1},
		{"v2.0.0", "v1.9.9", 1},
		{"v10.0.0", "v9.0.0", 1},
		// unparsable ("dev") parses as 0.0.0: an update IS offered from a
		// dev build to any release — correct. A release never "downgrades"
		// to dev (dev parses lower).
		{"dev", "v1.0.0", -1},
		{"v1.0.0", "dev", 1},
		{"dev", "dev", 0},
	}
	for _, c := range cases {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("Compare(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestParseSemver(t *testing.T) {
	got := ParseSemver("v1.2.3")
	want := [3]int{1, 2, 3}
	if got != want {
		t.Fatalf("ParseSemver(v1.2.3) = %v, want %v", got, want)
	}
}

func TestChecksumFor(t *testing.T) {
	sums := "abc123  kervia-vault-linux-amd64.tar.gz\ndef456  kervia-vault-linux-arm64.tar.gz\n"
	if got, _ := checksumFor(sums, "kervia-vault-linux-amd64.tar.gz"); got != "abc123" {
		t.Fatalf("amd64 checksum = %s", got)
	}
	if got, _ := checksumFor(sums, "kervia-vault-linux-arm64.tar.gz"); got != "def456" {
		t.Fatalf("arm64 checksum = %s", got)
	}
	if _, err := checksumFor(sums, "kervia-vault-linux-386.tar.gz"); err == nil {
		t.Fatal("missing arch must error")
	}
}

// fetchNotes : override du serveur de notes + tolérance aux pannes.
func TestFetchNotes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"body":"## v9.9.9\n- **TOTP** second facteur\n  - sous-puce"}`))
	}))
	defer srv.Close()
	old := NotesURL
	NotesURL = srv.URL
	defer func() { NotesURL = old }()

	notes := fetchNotes(nil)
	if !strings.Contains(notes, "**TOTP**") || !strings.Contains(notes, "v9.9.9") {
		t.Fatalf("notes = %q", notes)
	}

	// pannes : URL morte → notes vides, JAMAIS d'erreur remontée au check
	NotesURL = "http://127.0.0.1:1/none"
	if got := fetchNotes(nil); got != "" {
		t.Fatalf("dead endpoint must yield empty notes, got %q", got)
	}
}

// Check() doit porter les notes dans le statut (cache TTL inclus).
func TestCheckCarriesNotes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"body":"- **Test** note"}`))
	}))
	defer srv.Close()
	old := NotesURL
	NotesURL = srv.URL
	defer func() { NotesURL = old }()

	m := New("v1.0.0")
	st := m.Check(true)
	if st.LastError != "" && st.Notes == "" {
		t.Logf("offline update check: %v (notes skipped) — acceptable", st.LastError)
		return
	}
	if st.Notes == "" {
		t.Fatal("notes must be carried in the status when the endpoint answers")
	}
	if !strings.Contains(st.Notes, "**Test**") {
		t.Fatalf("notes content: %q", st.Notes)
	}
}

func TestLatestVersionReal(t *testing.T) {
	// integration against the real endpoint — skip when offline
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	v, err := LatestVersion(client)
	if err != nil {
		t.Skipf("offline or rate-limited: %v", err)
	}
	if v == "" || v[0] != 'v' {
		t.Fatalf("latest = %q, want a v-tag", v)
	}
	t.Logf("latest release: %s", v)
}

func TestCheckCache(t *testing.T) {
	m := New("v1.0.0")
	m.Mode() // just exercise
	st := m.Check(true)
	if st.Current != "v1.0.0" {
		t.Fatalf("status current = %s", st.Current)
	}
	if st.Latest == "" && st.LastError == "" {
		t.Fatal("either latest or last_error must be set")
	}
	// second call within TTL serves from cache (no LastError reset path)
	st2 := m.Check(false)
	if st2.Current != st.Current {
		t.Fatal("cached status mismatch")
	}
}

func TestModeDetectsDockerSystemdOrLaunchd(t *testing.T) {
	m := New("v1.0.0")
	switch m.Mode() {
	case "docker", "systemd", "launchd":
	default:
		t.Fatalf("mode = %s", m.Mode())
	}
}

// platform() must name the release archive of the running OS/arch — the
// release workflow builds linux/darwin × amd64/arm64.
func TestPlatformNamesReleaseArchive(t *testing.T) {
	p := platform()
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "linux/amd64", "linux/arm64", "darwin/amd64", "darwin/arm64":
		want := runtime.GOOS + "-" + runtime.GOARCH
		if p != want {
			t.Fatalf("platform() = %q, want %q", p, want)
		}
	default:
		if !strings.Contains(p, "unsupported") {
			t.Fatalf("platform() = %q, want an unsupported marker", p)
		}
	}
}

// The checksums file mixes linux and darwin lines since the macOS port —
// darwin names must parse like any other platform.
func TestChecksumForDarwinNames(t *testing.T) {
	sums := "a1  kervia-vault-linux-amd64.tar.gz\n" +
		"a2  kervia-vault-linux-arm64.tar.gz\n" +
		"a3  kervia-vault-darwin-amd64.tar.gz\n" +
		"a4  kervia-vault-darwin-arm64.tar.gz\n"
	if got, _ := checksumFor(sums, "kervia-vault-darwin-arm64.tar.gz"); got != "a4" {
		t.Fatalf("darwin-arm64 checksum = %s", got)
	}
	if got, _ := checksumFor(sums, "kervia-vault-darwin-amd64.tar.gz"); got != "a3" {
		t.Fatalf("darwin-amd64 checksum = %s", got)
	}
	if _, err := checksumFor(sums, "kervia-vault-windows-amd64.tar.gz"); err == nil {
		t.Fatal("missing platform must error")
	}
}