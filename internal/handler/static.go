package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/XingLingQAQ/NextClip/internal/config"
)

func RegisterStaticRoutes(mux *http.ServeMux, cfg *config.Config) {
	distDir := "dist/public"
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		distDir = "client/dist"
	}

	// Serve static files, fall back to index.html for SPA routing
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Skip API and WS routes
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			http.NotFound(w, r)
			return
		}

		// Try to serve the file directly
		filePath := filepath.Join(distDir, r.URL.Path)
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}

		// SPA fallback: serve index.html
		indexPath := filepath.Join(distDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}

		http.NotFound(w, r)
	})
}
