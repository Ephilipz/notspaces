package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
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

	var parsedMsg websocketMessage
	if err = json.Unmarshal(msg, &parsedMsg); err != nil {
		t.Error(err)
	}

	// we expect an id message (might be flaky since an offer can be sent first?)
	if parsedMsg.Event != "id" {
		t.Errorf("Expected id, but got %s", parsedMsg.Event)
	}
}

func testMain(t *testing.T) {
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

	var parsedMsg websocketMessage
	if err = json.Unmarshal(msg, &parsedMsg); err != nil {
		t.Error(err)
	}

	// we expect an id message (might be flaky since an offer can be sent first?)
	if parsedMsg.Event != "id" {
		t.Errorf("Expected id, but got %s", parsedMsg.Event)
	}
}

func TestRateLimit(t *testing.T) {
	handler := http.HandlerFunc(websocketHandler)
	server := httptest.NewServer(handler)
	defer server.Close()

	// Try to exceed rate limit
	for i := 0; i < 15; i++ {
		resp, err := http.Get(server.URL + "/websocket?name=test")
		if err != nil {
			continue
		}
		if i > 10 && resp.StatusCode == http.StatusTooManyRequests {
			t.Log("Rate limiting working correctly")
			resp.Body.Close()
			return
		}
		resp.Body.Close()
	}
	t.Error("Rate limiting not working")
}

func TestUserCleanup(t *testing.T) {
	// Reset state for test
	stateLock.Lock()
	users = map[uuid.UUID]*connectedUser{}
	connections = []peerConnectionState{}
	stateLock.Unlock()

	handler := http.HandlerFunc(websocketHandler)
	_, ws1 := newWSServer(t, handler, "?name=user1")
	_, ws2 := newWSServer(t, handler, "?name=user2")

	// Check users are added
	stateLock.RLock()
	userCount := len(users)
	connCount := len(connections)
	stateLock.RUnlock()

	if userCount != 2 || connCount != 2 {
		t.Errorf("Expected 2 users and connections, got %d users, %d connections", userCount, connCount)
	}

	// Close one connection
	ws1.Close()
	time.Sleep(100 * time.Millisecond) // Allow cleanup

	// Check cleanup happened
	stateLock.RLock()
	userCount = len(users)
	connCount = len(connections)
	stateLock.RUnlock()

	if userCount != 1 || connCount != 1 {
		t.Errorf("Expected 1 user and connection after cleanup, got %d users, %d connections", userCount, connCount)
	}

	ws2.Close()
}
