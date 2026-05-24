package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/models"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
	"github.com/google/uuid"
)

type contextKey string

const (
	UserContextKey    contextKey = "currentUser"
	SessionContextKey contextKey = "sessionID"
	CSRFCookieName              = "csrf-token"
	SessionCookieName           = "connect.sid"
)

// ===== Rate Limiting =====

type rateBucket struct {
	count   int
	resetAt time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*rateBucket
}

func NewRateLimiter() *RateLimiter {
	rl := &RateLimiter{buckets: make(map[string]*rateBucket)}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for k, v := range rl.buckets {
			if v.resetAt.Before(now) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *RateLimiter) Allow(keyPrefix, ip string, limit int, window time.Duration) bool {
	key := keyPrefix + ":" + ip
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[key]
	if !exists || bucket.resetAt.Before(now) {
		rl.buckets[key] = &rateBucket{count: 1, resetAt: now.Add(window)}
		return true
	}

	if bucket.count >= limit {
		return false
	}
	bucket.count++
	return true
}

func RateLimit(rl *RateLimiter, keyPrefix string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getClientIP(r)
			if !rl.Allow(keyPrefix, ip, limit, window) {
				writeJSON(w, http.StatusTooManyRequests, map[string]string{"message": "Too many requests, please try again later."})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ===== Security Headers =====

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "DENY")

		if os.Getenv("NODE_ENV") == "production" {
			csp := strings.Join([]string{
				"default-src 'self'",
				"connect-src 'self' ws: wss:",
				"img-src 'self' data: blob:",
				"style-src 'self' 'unsafe-inline'",
				"script-src 'self' 'unsafe-inline'",
				"font-src 'self' data:",
				"object-src 'none'",
				"frame-ancestors 'none'",
				"base-uri 'self'",
				"form-action 'self'",
			}, "; ")
			w.Header().Set("Content-Security-Policy", csp)
		}

		next.ServeHTTP(w, r)
	})
}

// ===== CSRF =====

func EnsureCSRFCookie(w http.ResponseWriter, r *http.Request) string {
	if cookie, err := r.Cookie(CSRFCookieName); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	token := uuid.New().String()
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("NODE_ENV") == "production",
		Path:     "/",
	})
	return token
}

func CSRFMiddleware(store *storage.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only check for session-mutating methods
			method := r.Method
			if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
				next.ServeHTTP(w, r)
				return
			}
			if !strings.HasPrefix(r.URL.Path, "/api") {
				next.ServeHTTP(w, r)
				return
			}

			// Skip for auth endpoints
			if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/register" {
				next.ServeHTTP(w, r)
				return
			}

			// Only enforce for authenticated users
			user := GetCurrentUser(r)
			if user == nil {
				next.ServeHTTP(w, r)
				return
			}

			cookieToken := ""
			if cookie, err := r.Cookie(CSRFCookieName); err == nil {
				cookieToken = cookie.Value
			}
			headerToken := r.Header.Get("X-Csrf-Token")

			if cookieToken == "" || headerToken == "" || cookieToken != headerToken {
				writeJSON(w, http.StatusForbidden, map[string]string{"message": "Invalid CSRF token"})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// ===== Session/Auth Middleware =====

func AttachCurrentUser(store *storage.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/api") {
				next.ServeHTTP(w, r)
				return
			}

			cookie, err := r.Cookie(SessionCookieName)
			if err != nil || cookie.Value == "" {
				next.ServeHTTP(w, r)
				return
			}

			session, err := store.GetSession(cookie.Value)
			if err != nil || session == nil || session.UserID == "" {
				next.ServeHTTP(w, r)
				return
			}

			user, err := store.GetUserByID(session.UserID)
			if err != nil || user == nil {
				next.ServeHTTP(w, r)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, user)
			ctx = context.WithValue(ctx, SessionContextKey, cookie.Value)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetCurrentUser(r)
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequireAuthHandler(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := GetCurrentUser(r)
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
			return
		}
		handler(w, r)
	}
}

// ===== Request Logging =====

func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = uuid.New().String()
		}
		w.Header().Set("X-Request-Id", requestID)

		if !strings.HasPrefix(r.URL.Path, "/api") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: 200}
		next.ServeHTTP(rw, r)

		latency := time.Since(start)
		formattedTime := time.Now().Format("3:04:05 PM")
		log.Printf("%s [express] %s", formattedTime, toJSON(map[string]interface{}{
			"route":      r.URL.Path,
			"status":     rw.statusCode,
			"latency":    fmt.Sprintf("%dms", latency.Milliseconds()),
			"request-id": requestID,
		}))
	})
}

// ===== CORS for WebSocket =====

func CORSMiddleware(next http.Handler) http.Handler {
	allowedOrigins := strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			allowed := len(allowedOrigins) == 0 || allowedOrigins[0] == ""
			for _, o := range allowedOrigins {
				if strings.TrimSpace(o) == origin {
					allowed = true
					break
				}
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Csrf-Token, X-Room-Token, X-Request-Id, X-Idempotency-Key")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			}
		}

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ===== Helpers =====

func GetCurrentUser(r *http.Request) *models.User {
	user, ok := r.Context().Value(UserContextKey).(*models.User)
	if !ok {
		return nil
	}
	return user
}

func GetSessionID(r *http.Request) string {
	sid, _ := r.Context().Value(SessionContextKey).(string)
	return sid
}

func CreateSessionCookie(w http.ResponseWriter, store *storage.Store, userID string) string {
	sid := generateSessionID()
	expiresAt := time.Now().Add(7 * 24 * time.Hour).UnixMilli()
	store.SetSession(sid, userID, expiresAt)

	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    sid,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   os.Getenv("NODE_ENV") == "production",
		MaxAge:   7 * 24 * 60 * 60,
		Path:     "/",
	})
	return sid
}

func DestroySessionCookie(w http.ResponseWriter, r *http.Request, store *storage.Store) {
	cookie, err := r.Cookie(SessionCookieName)
	if err == nil && cookie.Value != "" {
		store.DestroySession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		HttpOnly: true,
		MaxAge:   -1,
		Path:     "/",
	})
}

func generateSessionID() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-Ip"); xri != "" {
		return xri
	}
	// Strip port
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx > 0 {
		return addr[:idx]
	}
	return addr
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func toJSON(v interface{}) string {
	data, _ := json.Marshal(v)
	return string(data)
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
