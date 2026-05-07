FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /nextclip ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /nextclip .
COPY --from=builder /app/client/dist ./dist/public
EXPOSE 5000
ENV PORT=5000
CMD ["./nextclip"]
