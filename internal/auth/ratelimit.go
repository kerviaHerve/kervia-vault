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
