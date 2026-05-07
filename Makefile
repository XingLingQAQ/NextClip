.PHONY: build dev test vet clean client-install client-build run

# Go backend
build:
	go build -o bin/nextclip ./cmd/server

dev:
	SESSION_SECRET=dev-secret-change-me go run ./cmd/server

test:
	go test ./... -v

vet:
	go vet ./...

clean:
	rm -rf bin/ dist/ client/node_modules/.vite clipboard.db

# Frontend (React SPA)
client-install:
	cd client && npm install

client-build:
	cd client && npm run build
	mkdir -p dist/public
	cp -r client/dist/* dist/public/ 2>/dev/null || true

# Full build: frontend + backend
all: client-build build

# Run in production mode
run: all
	SESSION_SECRET=$${SESSION_SECRET:-please-set-me} NODE_ENV=production ./bin/nextclip
