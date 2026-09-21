// Rate limiter: token bucket per agent key (in-memory).
// SPDX-License-Identifier: AGPL-3.0

package auth

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	perMin  int
	buckets map[string]*bucket
}

func newRateLimiter(perMin int) *rateLimiter {
	return &rateLimiter{perMin: perMin, buckets: make(map[string]*bucket)}
}

// allow consumes one token; refills at perMin/60 per second.
func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(rl.perMin), last: now}
		rl.buckets[key] = b
	}
	// refill
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * float64(rl.perMin) / 60.0
	if b.tokens > float64(rl.perMin) {
		b.tokens = float64(rl.perMin)
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// failLimiter rate-limits failed AUTHENTICATION attempts (global + per-source),
// protecting the Argon2id verification from CPU-targeted brute force.
// Failed attempts have no resolved agent, so the per-agent bucket cannot apply.
type failLimiter struct {
	mu      sync.Mutex
	perMin  float64
	buckets map[string]*bucket
}

func newFailLimiter(perMin int) *failLimiter {
	return &failLimiter{perMin: float64(perMin), buckets: make(map[string]*bucket)}
}

// allow consumes one token for the given source (IP or "global").
func (f *failLimiter) allow(source string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	b, ok := f.buckets[source]
	if !ok {
		b = &bucket{tokens: f.perMin, last: now}
		f.buckets[source] = b
	}
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * f.perMin / 60.0
	if b.tokens > f.perMin {
		b.tokens = f.perMin
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
