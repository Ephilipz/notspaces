package main

import (
	"encoding/json"
	"flag"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/logging"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	addr     = flag.String("addr", ":8080", "address to listen on")
	retries  = flag.Int("retries", 20, "number of retries to attempt to sync peer connections")
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	// lock for peer connections
	listLock        sync.Mutex
	peerConnections []peerConnectionState
	trackLocals     map[string]*webrtc.TrackLocalStaticRTP

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

	trackLocals = map[string]*webrtc.TrackLocalStaticRTP{}

	// websocket handler
	http.HandleFunc("/websocket", websocketHandler)

	// start http server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Errorf("Failed to start http server: %v", err)
		return
	}
}

func signalPeerConnections() {
	listLock.Lock()
	defer listLock.Unlock()

	for attempt := 0; ; attempt++ {
		if attempt >= *retries {
			// we've tried too many times, release the lock for 3 seconds and try again
			go func() {
				time.Sleep(3 * time.Second)
				signalPeerConnections()
			}()
			return
		}

		if !attemptSync() {
			break
		}
	}
}

// Attempt to sync all peer connections. Returns true if should try again.
func attemptSync() (tryagain bool) {
	for i := range peerConnections {
		pc := &peerConnections[i]
		if pc.peerConnection.ConnectionState() == webrtc.PeerConnectionStateClosed {
			peerConnections = append(peerConnections[:i], peerConnections[i+1:]...)
			return true
		}

		// check what we're sending to this peer so we can avoid sending the same track twice
		existingSenders := map[string]struct{}{}
		for _, sender := range pc.peerConnection.GetSenders() {
			if sender.Track() == nil {
				continue
			}

			existingSenders[sender.Track().ID()] = struct{}{}

			// if we have a track which we're not sending to this peer, remove it and try again
			if _, ok := trackLocals[sender.Track().ID()]; !ok {
				if err := pc.peerConnection.RemoveTrack(sender); err != nil {
					return true
				}
			}
		}

		// check what we're receiving so we don't send one we're receiving (feedback loop)
		for _, receiver := range pc.peerConnection.GetReceivers() {
			if receiver.Track() == nil {
				continue
			}

			existingSenders[receiver.Track().ID()] = struct{}{}
		}

		// add all tracks we're not sending to this peer
		for _, track := range trackLocals {
			if _, ok := existingSenders[track.ID()]; !ok {
				if _, err := pc.peerConnection.AddTrack(track); err != nil {
					return true
				}
			}
		}

		// send offer and discriptor to peer
		offer, err := pc.peerConnection.CreateOffer(nil)
		if err != nil {
			return true
		}

		if err := pc.peerConnection.SetLocalDescription(offer); err != nil {
			return true
		}

		offerString, err := json.Marshal(offer)
		if err != nil {
			log.Errorf("Failed to marshal offer to json: %v", err)

			return true
		}

		log.Infof("Send offer to client: %v", offer)

		if err = pc.websocket.WriteJSON(&websocketMessage{
			Event: "offer",
			Data:  string(offerString),
		}); err != nil {
			return true
		}
	}

	return false
}

// Add track to the list of tracks and fire negotiation for all PeerConnections.
func addTrack(t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP {
	// if the incoming track is not audio, return
	if t.Codec().MimeType != "audio/opus" {
		log.Infof("Incoming track is not audio: %v", t.Codec())
		return nil
	}

	listLock.Lock()
	defer func() {
		listLock.Unlock()
		signalPeerConnections()
	}()

	// Create a new TrackLocal with the same codec as our incoming
	trackLocal, err := webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability, t.ID(), t.StreamID())
	if err != nil {
		panic(err)
	}

	trackLocals[t.ID()] = trackLocal

	return trackLocal
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

	// Accept audio track from incoming stream and allow sending back
	for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio} {
		if _, err := peerConn.AddTransceiverFromKind(typ, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			log.Errorf("Failed to add transceiver: %v", err)
			writer.WriteJSON(websocketMessage{
				Event: "error",
				Data:  "Failed to add transceiver",
			})
			return
		}
	}

	// Add our new peer connection to the global list
	listLock.Lock()
	peerConnections = append(peerConnections, peerConnectionState{
		peerConnection: peerConn,
		websocket:      writer,
	})
	listLock.Unlock()

	// ICE - emit server candidates to client
	peerConn.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			log.Info("ICE candidate is nil")
			return
		}

		candidateStr, err := json.Marshal(candidate.ToJSON())
		if err != nil {
			log.Errorf("Failed to marshal ICE candidate: %v", err)
			return
		}

		log.Infof("ICE candidate: %s", string(candidateStr))
		writer.WriteJSON(websocketMessage{
			Event: "candidate",
			Data:  string(candidateStr),
		})
	})

	// if peer connection is closed remove it from the global list
	peerConn.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateClosed {
			signalPeerConnections()
			return
		}
		if state == webrtc.PeerConnectionStateFailed {
			peerConn.Close()
			log.Errorf("Peer connection failed")
			return
		}
	})

	peerConn.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Infof("Received track: %v", track)
		trackLocal := addTrack(track)
		if trackLocal == nil {
			return
		}

		// read RTP packets from the track
		buf := make([]byte, 1500) // apparently the max size of an RTP packet on the wire
		rtp := rtp.Packet{}

		for {
			n, _, err := track.Read(buf)
			if err != nil {
				log.Errorf("Failed to read RTP packet: %v", err)
				return
			}

			if err := rtp.Unmarshal(buf[:n]); err != nil {
				log.Errorf("Failed to unmarshal RTP packet: %v", err)
				return
			}

			// clear the packet extensions header
			rtp.Header.Extension = false
			rtp.Header.Extensions = nil

			// write the packet to the track
			if err := trackLocal.WriteRTP(&rtp); err != nil {
				log.Errorf("Failed to write RTP packet to track: %v", err)
				return
			}
		}
	})

	peerConn.OnICEConnectionStateChange(func(is webrtc.ICEConnectionState) {
		log.Infof("ICE connection state changed: %s", is)
	})

	// signal for the new peer connection
	signalPeerConnections()

	// loop reading messages from the websocket
	for {
		message := &websocketMessage{}
		_, rawMsg, err := writer.ReadMessage()
		if err != nil {
			log.Errorf("Failed to read message from websocket: %v", err)
			return
		}

		if err := json.Unmarshal(rawMsg, message); err != nil {
			log.Errorf("Failed to unmarshal message from websocket: %v", err)
			return
		}

		switch message.Event {
		// this is the client's ICE candidate
		case "candidate":
			candidate := webrtc.ICECandidateInit{}
			if err := json.Unmarshal([]byte(message.Data), &candidate); err != nil {
				log.Errorf("Failed to unmarshal ICE candidate: %v", err)
				return
			}

			log.Infof("Adding ICE candidate: %v", candidate)
			if err := peerConn.AddICECandidate(candidate); err != nil {
				log.Errorf("Failed to add ICE candidate: %v", err)
			}
		// the client answered our ICE offer
		case "answer":
			answer := webrtc.SessionDescription{}
			if err := json.Unmarshal([]byte(message.Data), &answer); err != nil {
				log.Errorf("Failed to unmarshal answer: %v", err)
				return
			}

			log.Infof("Setting remote description: %v", answer)
			if err := peerConn.SetRemoteDescription(answer); err != nil {
				log.Errorf("Failed to set remote description: %v", err)
				return
			}

		default:
			log.Infof("Unknown message: %v", message)
		}
	}
}
