package handler

import (
	"net/http"

	"github.com/XingLingQAQ/NextClip/internal/config"
	"github.com/XingLingQAQ/NextClip/internal/store"
	"github.com/XingLingQAQ/NextClip/internal/ws"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS handled at middleware level
	},
}

func RegisterWSRoute(mux *http.ServeMux, hub *ws.Hub, db *store.SQLiteStore, cfg *config.Config) {
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := ws.NewClient(hub, conn, db)
		hub.Register(client)
		go client.WritePump()
		go client.ReadPump()
	})
}
