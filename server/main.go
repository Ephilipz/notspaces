package main

import (
	"flag"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/pion/logging"
	"github.com/pion/webrtc/v4"
)

var (
	addr     = flag.String("addr", ":8080", "address to listen on")
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	// lock for peer connections
	listLock        sync.Mutex
	peerConnections []peerConnectionState
	// trackLocals     map[string]*webrtc.TrackLocalStaticRTP

	log = logging.NewDefaultLoggerFactory().NewLogger("sfu-ws")
)

type websocketMessage struct {
	Event string `json:"event"`
	Data  string `json:"data"`
}

type peerConnectionState struct {
	peerConnection *webrtc.PeerConnection
	websocket      *threadSafeWriter
}

// Helper to make Gorilla Websockets threadsafe.
type threadSafeWriter struct {
	*websocket.Conn
	sync.Mutex
}

func (t *threadSafeWriter) WriteJSON(v any) error {
	t.Lock()
	defer t.Unlock()

	return t.Conn.WriteJSON(v)
}

func main() {
	flag.Parse()

	// trackLocals = map[string]*webrtc.TrackLocalStaticRTP{}

	// websocket handler
	http.HandleFunc("/websocket", websocketHandler)

	// start http server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Errorf("Failed to start http server: %v", err)
		return
	}
}

func websocketHandler(w http.ResponseWriter, r *http.Request) {
	// Upgrade the http request to a websocket connection
	unsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Errorf("Failed to upgrade http request to websocket: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Failed to upgrade http request to websocket"))
	}

	writer := &threadSafeWriter{unsConn, sync.Mutex{}}
	defer writer.Close()

	peerConn, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		log.Errorf("Failed to create peer connection: %v", err)
		writer.WriteJSON(websocketMessage{
			Event: "error",
			Data:  "Failed to create peer connection",
		})
		return
	}
	defer peerConn.Close()

	// // Accept audio track from incoming stream
	// for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio} {
	// 	if _, err := peerConn.AddTransceiver(typ, webrtc.RtpTransceiverInit{
	// 		Direction: webrtc.RtpTransceiverDirectionRecvonly,
	// 	}); err != nil {
	// 		log.Errorf("Failed to add transceiver: %v", err)
	// 		writer.WriteJSON(websocketMessage{
	// 			Event: "error",
	// 			Data:  "Failed to add transceiver",
	// 		})
	// 		return
	// 	}
	// }

	// Add our new peer connection to the global list
	listLock.Lock()
	peerConnections = append(peerConnections, peerConnectionState{
		peerConnection: peerConn,
		websocket:      writer,
	})
	listLock.Unlock()

	// Send a message to the client to indicate that the connection is established
	writer.WriteJSON(websocketMessage{
		Event: "connected",
		Data:  "Connected to the server",
	})
}
