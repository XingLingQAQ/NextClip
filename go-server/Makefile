.PHONY: build run dev clean test

# Build the Go server binary
build:
	CGO_ENABLED=1 go build -o bin/server .

# Run in development mode
run: build
	SESSION_SECRET=dev-secret ./bin/server

# Run with hot reload (requires air)
dev:
	SESSION_SECRET=dev-secret air

# Clean build artifacts
clean:
	rm -rf bin/

# Run tests
test:
	go test ./...

# Download dependencies
deps:
	go mod download
	go mod tidy
