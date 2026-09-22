// Sentinel fix tests: (1) the webui reveal is audited (every decrypted
// read leaves a trace), (2) expired admin sessions are swept from memory.
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"testing"
	"time"
)

func TestSessionSweeperRemovesExpired(t *testing.T) {
	svc, _, _ := newTestAuth(t)

	// create a session and force it to expire
	id := svc.NewAdminSession()
	if id == "" {
		t.Fatal("session id expected")
	}
	svc.sessions.Store(id, time.Now().Add(-1*time.Second)) // already expired

	stop := svc.StartSessionSweeper(10 * time.Millisecond)
	defer close(stop)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := svc.sessions.Load(id); !ok {
			return // swept ✓
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("expired session still in the map after sweep window")
}

func TestSessionSweeperKeepsLiveSessions(t *testing.T) {
	svc, _, _ := newTestAuth(t)

	id := svc.NewAdminSession()
	stop := svc.StartSessionSweeper(10 * time.Millisecond)
	defer close(stop)

	time.Sleep(100 * time.Millisecond) // several sweep ticks
	if _, ok := svc.sessions.Load(id); !ok {
		t.Fatal("live session was swept — sweeper is too aggressive")
	}
}