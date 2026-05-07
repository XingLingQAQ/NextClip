package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/XingLingQAQ/NextClip/internal/config"
	"github.com/XingLingQAQ/NextClip/internal/handler"
	"github.com/XingLingQAQ/NextClip/internal/middleware"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/XingLingQAQ/NextClip/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	db, err := store.NewSQLiteStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("database error: %v", err)
	}
	defer db.Close()

	hub := ws.NewHub(db)
	go hub.Run()

	mux := http.NewServeMux()

	// Health checks
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ready":true}`))
	})

	// Register API routes
	handler.RegisterAuthRoutes(mux, db, cfg)
	handler.RegisterRoomRoutes(mux, db, cfg, hub)
	handler.RegisterClipRoutes(mux, db, cfg, hub)
	handler.RegisterWSRoute(mux, hub, db, cfg)

	// Static file serving for SPA
	handler.RegisterStaticRoutes(mux, cfg)

	// Build middleware chain
	var h http.Handler = mux
	h = middleware.RequestID(h)
	h = middleware.Logger(h, cfg)
	h = middleware.SecurityHeaders(h, cfg)
	h = middleware.CORS(h, cfg)
	h = middleware.RateLimit(h)

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: h,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		server.Close()
	}()

	fmt.Printf("NextClip Go server listening on :%s\n", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
