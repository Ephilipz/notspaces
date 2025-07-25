package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"

	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newWSServer(t *testing.T, h http.Handler, params string) (*httptest.Server, *websocket.Conn) {
	t.Helper()

	s := httptest.NewServer(h)
	re := regexp.MustCompile(`^http(s?)://`)
	wsURL := re.ReplaceAllString(s.URL, "ws$1://") + params

	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Server failed %v", err)
	}

	return s, ws
}

func TestMain(t *testing.T) {
	handler := http.HandlerFunc(websocketHandler)
	_, ws := newWSServer(t, handler, "?name=bruceWayne")

	defer ws.Close()

	// expect the server to send us an ID
	t.Log("Done")
	ws.SetReadDeadline(time.Now().Add(time.Second * 2))
	_, msg, err := ws.ReadMessage()
	if err != nil {
		t.Error(err)
	}

	var message websocketMessage
	json.Unmarshal(msg, &message)
	t.Logf("we got the message back %v", message)
}
