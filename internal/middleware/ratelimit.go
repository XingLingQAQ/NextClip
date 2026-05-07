package middleware

import (
	"net/http"
	"sync"
	"time"
)

type bucket struct {
	count   int
	resetAt time.Time
}

var (
	buckets = make(map[string]*bucket)
	mu      sync.Mutex
)

// RateLimit applies a global 200 req/10min per IP limit on API routes.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only rate-limit API paths
		if len(r.URL.Path) < 4 || r.URL.Path[:4] != "/api" {
			next.ServeHTTP(w, r)
			return
		}

		ip := r.RemoteAddr
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			ip = forwarded
		}

		mu.Lock()
		b, ok := buckets[ip]
		now := time.Now()
		if !ok || now.After(b.resetAt) {
			buckets[ip] = &bucket{count: 1, resetAt: now.Add(10 * time.Minute)}
			mu.Unlock()
			next.ServeHTTP(w, r)
			return
		}
		if b.count >= 600 {
			mu.Unlock()
			http.Error(w, `{"message":"Too many requests, please try again later."}`, http.StatusTooManyRequests)
			return
		}
		b.count++
		mu.Unlock()
		next.ServeHTTP(w, r)
	})
}
