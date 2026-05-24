package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/XingLingQAQ/NextClip/go-server/handlers"
	"github.com/XingLingQAQ/NextClip/go-server/middleware"
	"github.com/XingLingQAQ/NextClip/go-server/storage"
	ws "github.com/XingLingQAQ/NextClip/go-server/websocket"
	"github.com/go-chi/chi/v5"
)

func main() {
	// Determine port
	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	// Session secret check
	sessionSecret := os.Getenv("SESSION_SECRET")
	if sessionSecret == "" {
		sessionSecret = os.Getenv("AUTH_SIGNING_SECRET")
	}
	if sessionSecret == "" {
		log.Fatal("Missing session secret. Set SESSION_SECRET or AUTH_SIGNING_SECRET before startup.")
	}

	// Database path
	dbPath := filepath.Join(".", "clipboard.db")

	// Initialize storage
	store, err := storage.New(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	// Initialize shared components
	rateLimiter := middleware.NewRateLimiter()
	tokenMgr := handlers.NewRoomTokenManager()
	hub := ws.NewHub(store, tokenMgr)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(store, rateLimiter)
	roomHandler := handlers.NewRoomHandler(store, tokenMgr, rateLimiter)
	clipHandler := handlers.NewClipHandler(store, tokenMgr, hub, rateLimiter)

	// Router setup
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.CORSMiddleware)
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.RequestLogger)
	r.Use(middleware.AttachCurrentUser(store))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			middleware.EnsureCSRFCookie(w, req)
			next.ServeHTTP(w, req)
		})
	})
	r.Use(middleware.CSRFMiddleware(store))

	// Health endpoints
	r.Get("/healthz", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ready":true}`))
	})

	// WebSocket endpoint
	r.Get("/ws", hub.HandleWebSocket)

	// API Routes
	r.Route("/api", func(api chi.Router) {
		// Auth routes
		api.Get("/auth/csrf", authHandler.CSRF)
		api.With(middleware.RateLimit(rateLimiter, "auth-register", 20, 10*time.Minute)).
			Post("/auth/register", authHandler.Register)
		api.With(middleware.RateLimit(rateLimiter, "auth-login", 30, 10*time.Minute)).
			Post("/auth/login", authHandler.Login)
		api.Get("/auth/me", middleware.RequireAuthHandler(authHandler.Me))
		api.Post("/auth/logout", middleware.RequireAuthHandler(authHandler.Logout))

		// Room routes
		api.Get("/rooms/{roomCode}", roomHandler.GetRoom)
		api.With(middleware.RateLimit(rateLimiter, "room-join", 60, 10*time.Minute)).
			Post("/rooms/{roomCode}/join", roomHandler.JoinRoom)
		api.With(middleware.RateLimit(rateLimiter, "room-password", 20, 10*time.Minute)).
			Post("/rooms/{roomCode}/password", middleware.RequireAuthHandler(roomHandler.SetPassword))
		api.With(middleware.RateLimit(rateLimiter, "room-expiry", 20, 10*time.Minute)).
			Post("/rooms/{roomCode}/expiry", middleware.RequireAuthHandler(roomHandler.SetExpiry))

		// Clip routes
		api.With(middleware.RateLimit(rateLimiter, "clips-post", 200, 10*time.Minute)).
			Post("/rooms/{roomCode}/clips", clipHandler.CreateClip)
		api.Get("/rooms/{roomCode}/clips", clipHandler.GetClips)
		api.Get("/rooms/{roomCode}/clips/since/{timestamp}", clipHandler.GetClipsSince)
		api.Delete("/rooms/{roomCode}/clips/{clipId}", clipHandler.DeleteClip)
		api.Delete("/rooms/{roomCode}/clips", clipHandler.ClearClips)
		api.Post("/rooms/{roomCode}/clips/{clipId}/restore", clipHandler.RestoreClip)

		// Pin routes
		api.Post("/rooms/{roomCode}/pins/{clipId}", clipHandler.SetPinned)

		// Audit route
		api.Get("/rooms/{roomCode}/audit", middleware.RequireAuthHandler(clipHandler.GetAudit))
	})

	// Serve static files (production)
	staticDir := filepath.Join(".", "dist", "public")
	if _, err := os.Stat(staticDir); err == nil {
		fileServer := http.FileServer(http.Dir(staticDir))
		r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Try to serve static file first
			path := filepath.Join(staticDir, req.URL.Path)
			if _, err := os.Stat(path); err == nil {
				fileServer.ServeHTTP(w, req)
				return
			}
			// Fallback to index.html for SPA routing
			http.ServeFile(w, req, filepath.Join(staticDir, "index.html"))
		}))
	}

	// Start server
	addr := fmt.Sprintf("0.0.0.0:%s", port)
	formattedTime := time.Now().Format("3:04:05 PM")
	log.Printf("%s [go-server] serving on port %s", formattedTime, port)

	server := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
