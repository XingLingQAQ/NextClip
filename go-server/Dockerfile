# Standalone Go server build (without client)
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o /app/server .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates sqlite-libs
WORKDIR /app
COPY --from=builder /app/server ./server

ENV PORT=5000
EXPOSE 5000

CMD ["./server"]
