// Session cookie security tests: Secure must follow the transport.
// HTTP first-boot wizard (LAN/VPN IP) → cookie without Secure (browsers
// reject Secure cookies on plain HTTP); HTTPS (direct or X-Forwarded-Proto
// from the reverse proxy) → Secure cookie.
// SPDX-License-Identifier: AGPL-3.0

package api

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSessionCookiePlainHTTP(t *testing.T) {
	r := httptest.NewRequest("POST", "/admin/login", nil)
	c := sessionCookie("sid123", r, 3600)
	if c.Secure {
		t.Fatal("plain HTTP request: Secure must be false — browsers reject Secure cookies on non-localhost HTTP")
	}
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
		t.Fatal("HttpOnly and SameSite=Strict are mandatory in all cases")
	}
	if c.Value != "sid123" || c.Path != "/" || c.MaxAge != 3600 {
		t.Fatalf("unexpected cookie fields: %+v", c)
	}
}

func TestSessionCookieForwardedHTTPS(t *testing.T) {
	r := httptest.NewRequest("POST", "/admin/login", nil)
	r.Header.Set("X-Forwarded-Proto", "https")
	c := sessionCookie("sid123", r, 3600)
	if !c.Secure {
		t.Fatal("behind the reverse proxy (X-Forwarded-Proto: https): Secure must be true")
	}
}

func TestSessionCookieDirectTLS(t *testing.T) {
	r := httptest.NewRequest("POST", "/admin/login", nil)
	r.TLS = &tls.ConnectionState{}
	c := sessionCookie("sid123", r, 3600)
	if !c.Secure {
		t.Fatal("direct TLS: Secure must be true")
	}
}

func TestSessionCookieLogoutExpiry(t *testing.T) {
	r := httptest.NewRequest("POST", "/admin/logout", nil)
	c := sessionCookie("", r, 0)
	if c.MaxAge != 0 || c.Value != "" {
		t.Fatalf("logout cookie must clear: %+v", c)
	}
}
