package main

import (
	"encoding/json"
	"flag"
	"math/rand/v2"
	"net/http"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/logging"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"golang.org/x/time/rate"
)

type Config struct {
	MaxConnections int `json:"maxConnections"`
}

var (
	addr    = flag.String("addr", ":8080", "http service address")
	config  Config
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	// Global state with proper synchronization
	stateLock   sync.RWMutex
	connections []*peerConnectionState
	trackLocals map[string]*webrtc.TrackLocalStaticRTP
	users       map[uuid.UUID]*connectedUser
	userTracks  map[uuid.UUID]string // userID -> trackID mapping
	speakers    map[uuid.UUID]bool   // Active speakers only

	// Rate limiting
	connectionLimiter = rate.NewLimiter(rate.Every(time.Second), 10) // 10 connections per second

	log          = logging.NewDefaultLoggerFactory().NewLogger("sfu-ws")
	webrtcConfig = webrtc.Configuration{
		SDPSemantics: webrtc.SDPSemanticsUnifiedPlanWithFallback,
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{
					"stun:stun.l.google.com:19302",
				},
			},
			{
				URLs: []string{
					"stun:stun.l.google.com:443?transport=udp",
					"stun:stun.l.google.com:443?transport=tcp",
				},
			},
		},
	}
)

type UserState string

const (
	LISTENING UserState = "listening"
	SPEAKING  UserState = "speaking"
	MUTED     UserState = "muted"
)

type websocketMessage struct {
	Event string `json:"event"`
	Data  string `json:"data"`
}

type peerConnectionState struct {
	peerConnection *webrtc.PeerConnection
	websocket      *threadSafeWriter
	userID         uuid.UUID
}

type connectedUser struct {
	Id    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	State UserState `json:"state"`
}

func main() {
	// Parse the flags passed to program
	flag.Parse()

	// Load config
	data, _ := os.ReadFile("config.json")
	json.Unmarshal(data, &config)

	// Init other state
	trackLocals = map[string]*webrtc.TrackLocalStaticRTP{}
	users = map[uuid.UUID]*connectedUser{}
	userTracks = map[uuid.UUID]string{}
	speakers = map[uuid.UUID]bool{}
	connections = []*peerConnectionState{}

	// websocket handler
	http.HandleFunc("/websocket", websocketHandler)

	// request a keyframe every 3 seconds
	go func() {
		for range time.NewTicker(time.Second * 3).C {
			dispatchKeyFrame()
		}
	}()

	// start HTTP server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Errorf("Failed to start http server: %v", err)
	}
}

// Add to list of tracks and fire renegotation for all PeerConnections.
func addTrack(t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP {
	stateLock.Lock()
	defer func() {
		// seems better to have a random delay between [100 and 300) milliseconds
		delay := rand.Int32N(300-100) + 100
		time.Sleep(time.Duration(delay) * time.Millisecond)
		stateLock.Unlock()
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

// Remove from list of tracks and fire renegotation for all PeerConnections.
func removeTrack(t *webrtc.TrackLocalStaticRTP) {
	stateLock.Lock()
	defer func() {
		stateLock.Unlock()
		signalPeerConnections()
	}()

	delete(trackLocals, t.ID())
}

// signalPeerConnections updates each PeerConnection so that it is getting all the expected media tracks.
func signalPeerConnections() {
	stateLock.Lock()
	defer func() {
		stateLock.Unlock()
		dispatchKeyFrame()
	}()

	attemptSync := func() (tryAgain bool) {
		for i := range connections {
			if connections[i].peerConnection.ConnectionState() == webrtc.PeerConnectionStateClosed {
				// remove the connection
				connections = slices.Delete(connections, i, i+1)
				return true // We modified the slice, start from the beginning
			}

			// map of sender we already are seanding, so we don't double send
			existingSenders := map[string]bool{}

			for _, sender := range connections[i].peerConnection.GetSenders() {
				if sender.Track() == nil {
					continue
				}

				existingSenders[sender.Track().ID()] = true

				// If we have a RTPSender that doesn't map to a existing track remove and signal
				if _, ok := trackLocals[sender.Track().ID()]; !ok {
					if err := connections[i].peerConnection.RemoveTrack(sender); err != nil {
						return true
					}
				}
			}

			// Don't receive media we are sending, make sure we don't have loopback
			for _, receiver := range connections[i].peerConnection.GetReceivers() {
				if receiver.Track() == nil {
					continue
				}

				existingSenders[receiver.Track().ID()] = true
			}

			// Add all track we aren't sending yet to the PeerConnection
			for trackID := range trackLocals {
				if _, ok := existingSenders[trackID]; !ok {
					if _, err := connections[i].peerConnection.AddTrack(trackLocals[trackID]); err != nil {
						return true
					}
				}
			}

			// send the offer to the client
			offer, err := connections[i].peerConnection.CreateOffer(nil)
			if err != nil {
				return true
			}

			if err = connections[i].peerConnection.SetLocalDescription(offer); err != nil {
				return true
			}

			offerString, err := json.Marshal(offer)
			if err != nil {
				log.Errorf("Failed to marshal offer to json: %v", err)
				return true
			}

			if err = connections[i].websocket.WriteJSON(&websocketMessage{
				Event: "offer",
				Data:  string(offerString),
			}); err != nil {
				return true
			}
		}

		return tryAgain
	}

	for syncAttempt := 0; ; syncAttempt++ {
		if syncAttempt == 25 {
			// Release the lock and attempt a sync in 1 -> 3 seconds. We might be blocking a RemoveTrack or AddTrack
			go func() {
				time.Sleep(time.Duration(rand.IntN(3-1)+1) * time.Second)
				signalPeerConnections()
			}()

			return
		}

		if !attemptSync() {
			break
		}
	}
}

// dispatchKeyFrame sends a keyframe to all PeerConnections, used everytime a new user joins the call.
func dispatchKeyFrame() {
	stateLock.Lock()
	defer stateLock.Unlock()

	for i := range connections {
		for _, receiver := range connections[i].peerConnection.GetReceivers() {
			if receiver.Track() == nil {
				continue
			}

			_ = connections[i].peerConnection.WriteRTCP([]rtcp.Packet{
				&rtcp.PictureLossIndication{
					MediaSSRC: uint32(receiver.Track().SSRC()),
				},
			})
		}
	}
}

// broadcastUserStates sends updated user list to all connected clients
func broadcastUserStates() {
	usersList := make([]*connectedUser, 0, len(users))
	for _, u := range users {
		usersList = append(usersList, u)
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"users": usersList,
	})

	for _, conn := range connections {
		conn.websocket.WriteJSON(&websocketMessage{
			Event: "user_states_updated",
			Data:  string(payload),
		})
	}
}

// toggleUserState switches user between listening and speaking
func toggleUserState(userID uuid.UUID, newState UserState) {
	stateLock.Lock()
	defer stateLock.Unlock()

	if user, exists := users[userID]; exists {
		oldState := user.State
		user.State = newState

		// Update speakers map
		if newState == SPEAKING {
			speakers[userID] = true
		} else {
			delete(speakers, userID)
			// He Stopped Yapping, Romove his track
			if trackID, exists := userTracks[userID]; exists {
				if track, exists := trackLocals[trackID]; exists {
					removeTrack(track)
				}
				delete(userTracks, userID)
			}
		}

		log.Infof("User %s state changed: %s -> %s", userID, oldState, newState)
		
		// Broadcast updated states to all users
		broadcastUserStates()
	}
}

// removeUser safely removes a user and their connection
func removeUser(userID uuid.UUID) {
	stateLock.Lock()
	defer stateLock.Unlock()

	// Clean up user's track if they have one
	if trackID, exists := userTracks[userID]; exists {
		if track, exists := trackLocals[trackID]; exists {
			removeTrack(track)
		}
		delete(userTracks, userID)
	}

	// Remove from speakers and users
	delete(speakers, userID)
	delete(users, userID)

	// Remove connection
	for i, conn := range connections {
		if conn.userID == userID {
			connections = slices.Delete(connections, i, i+1)
			break
			}
	}

	log.Infof("User %s removed, %d users remaining", userID, len(users))
}

// Handle incoming websockets.
func websocketHandler(w http.ResponseWriter, r *http.Request) {
	// Rate limiting
	if !connectionLimiter.Allow() {
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	// Check max connections
	stateLock.RLock()
	currentConnections := len(connections)
	stateLock.RUnlock()

	if currentConnections >= config.MaxConnections {
		http.Error(w, "Server at capacity", http.StatusServiceUnavailable)
		return
	}

	// Upgrade HTTP request to Websocket
	unsafeConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Errorf("Failed to upgrade HTTP to Websocket: ", err)
		return
	}

	c := &threadSafeWriter{unsafeConn, sync.Mutex{}}

	// When this frame returns close the Websocket
	defer c.Close()

	// Create new PeerConnection between the server and the client that just connected
	peerConnection, err := webrtc.NewPeerConnection(webrtcConfig)
	if err != nil {
		log.Errorf("Failed to creates a PeerConnection: %v", err)

		return
	}

	// When this frame returns close the PeerConnection
	defer peerConnection.Close()

	// Accept one audio and one video track incoming
	for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo, webrtc.RTPCodecTypeAudio} {
		if _, err := peerConnection.AddTransceiverFromKind(typ, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			log.Errorf("Failed to add transceiver: %v", err)

			return
		}
	}

	// Read current user
	name := r.URL.Query().Get("name")
	if name == "" {
		log.Error("name required")
		return
	}

	user := &connectedUser{
		Id:    uuid.New(),
		Name:  name,
		State: LISTENING, // Everyone starts listening
	}

	// Create connection state with user ID
	pcState := peerConnectionState{peerConnection, c, user.Id}

	// Add user and connection
	stateLock.Lock()
	users[user.Id] = user
	connections = append(connections, &pcState)
	usersList := make([]*connectedUser, 0, len(users))
	for _, u := range users {
		usersList = append(usersList, u)
	}
	stateLock.Unlock()

	// Ensure cleanup on disconnect
	defer removeUser(user.Id)

	payload, _ := json.Marshal(map[string]interface{}{
		"id": user.Id,
		"users": usersList,
	})

	// send the id back to the user
	c.WriteJSON(&websocketMessage{
		Event: "id",
		Data: string(payload),
	})

	// Trickle ICE. Emit server candidate to client
	peerConnection.OnICECandidate(func(i *webrtc.ICECandidate) {
		if i == nil {
			return
		}
		// If you are serializing a candidate make sure to use ToJSON
		// Using Marshal will result in errors around `sdpMid`
		candidateString, err := json.Marshal(i.ToJSON())
		if err != nil {
			log.Errorf("Failed to marshal candidate to json: %v", err)

			return
		}

		if writeErr := c.WriteJSON(&websocketMessage{
			Event: "candidate",
			Data:  string(candidateString),
		}); writeErr != nil {
			log.Errorf("Failed to write JSON: %v", writeErr)
		}
	})

	// If PeerConnection is closed remove it from global list
	peerConnection.OnConnectionStateChange(func(p webrtc.PeerConnectionState) {
		switch p {
		case webrtc.PeerConnectionStateFailed:
			if err := peerConnection.Close(); err != nil {
				log.Errorf("Failed to close PeerConnection: %v", err)
			}
		case webrtc.PeerConnectionStateClosed:
			signalPeerConnections()
		default:
		}
	})

	peerConnection.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		log.Infof("Got remote track: Kind=%s, ID=%s, PayloadType=%d", t.Kind(), t.ID(), t.PayloadType())

		// Check if user is currently speaking
		stateLock.RLock()
		userID := pcState.userID
		isSpeaking := speakers[userID]
		stateLock.RUnlock()

		if !isSpeaking {
			log.Infof("Rejecting track from non-speaking user %s", userID)
			return
		}

		// Create a track to fan out our incoming media to all peers
		trackLocal := addTrack(t)
		
		// Track ownership
		stateLock.Lock()
		userTracks[userID] = t.ID()
		stateLock.Unlock()
		
		defer func() {
			removeTrack(trackLocal)
			stateLock.Lock()
			delete(userTracks, userID)
			stateLock.Unlock()
		}()

		buf := make([]byte, 1500)
		rtpPkt := &rtp.Packet{}

		for {
			i, _, err := t.Read(buf)
			if err != nil {
				return
			}

			if err = rtpPkt.Unmarshal(buf[:i]); err != nil {
				log.Errorf("Failed to unmarshal incoming RTP packet: %v", err)
				return
			}

			rtpPkt.Extension = false
			rtpPkt.Extensions = nil

			if err = trackLocal.WriteRTP(rtpPkt); err != nil {
				return
			}
		}
	})

	// Signal for the new PeerConnection
	signalPeerConnections()

	// respond with its id
	c.WriteJSON(&websocketMessage{
		Event: "id",
		Data:  user.Id.String(),
	})

	handleIncomingWebsocketMessages(peerConnection, c, &pcState)
}

func handleIncomingWebsocketMessages(pc *webrtc.PeerConnection, c *threadSafeWriter, pcState *peerConnectionState) {
	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			log.Errorf("Failed to read message: %v", err)

			return
		}

		message := &websocketMessage{}

		if err := json.Unmarshal(raw, &message); err != nil {
			log.Errorf("Failed to unmarshal json to message: %v", err)
			return
		}

		switch message.Event {

		// ICE candidate from the client
		case "candidate":
			candidate := webrtc.ICECandidateInit{}
			if err := json.Unmarshal([]byte(message.Data), &candidate); err != nil {
				log.Errorf("Failed to unmarshal json to candidate: %v", err)
				return
			}

			if err := pc.AddICECandidate(candidate); err != nil {
				log.Errorf("Failed to add ICE candidate: %v", err)
				return
			}

		// answer from the client. We need
		case "answer":
			answer := webrtc.SessionDescription{}
			if err := json.Unmarshal([]byte(message.Data), &answer); err != nil {
				log.Errorf("Failed to unmarshal json to answer: %v", err)
				return
			}

			log.Infof("Got answer")

			if err := pc.SetRemoteDescription(answer); err != nil {
				log.Errorf("Failed to set remote description: %v", err)
				return
			}

		// renegotiation from the client
		// the server should be "impolite"; ignoring incoming offers that collide with its own
		case "offer":
			offer := webrtc.SessionDescription{}
			if err := json.Unmarshal([]byte(message.Data), &offer); err != nil {
				log.Errorf("Failed to unmarshal json to offer: %v", err)
				return
			}

			if err := pc.SetRemoteDescription(offer); err != nil {
				log.Errorf("Failed to set remote description: %v", err)
				return
			}

			ans, err := pc.CreateAnswer(nil)
			if err != nil {
				log.Errorf("Failed to create answer: %v", err)
				return
			}

			if err = pc.SetLocalDescription(ans); err != nil {
				log.Errorf("Failed to set local description: %v", err)
				return
			}

			log.Info("Done setting offer.\n\n")

			// send answer to client
			answerString, err := json.Marshal(ans)
			if err != nil {
				log.Errorf("Failed to marshal answer to json: %v", err)
				return
			}
			log.Info("Send answer to client")
			if err = c.WriteJSON(&websocketMessage{
				Event: "answer",
				Data:  string(answerString),
			}); err != nil {
				log.Errorf("Failed to write JSON: %v", err)
				return
			}

		// User toggles between listening and speaking
		case "toggle_speaking":
			userID := pcState.userID
			stateLock.RLock()
			user := users[userID]
			currentState := user.State
			stateLock.RUnlock()
			
			// Toggle between listening and speaking
			var newState UserState
			if currentState == LISTENING || currentState == MUTED {
				newState = SPEAKING
			} else {
				newState = LISTENING
			}
			
			toggleUserState(userID, newState)

		// User mutes/unmutes while speaking
		case "toggle_mute":
			userID := pcState.userID
			stateLock.RLock()
			user := users[userID]
			currentState := user.State
			stateLock.RUnlock()
			
			// Only toggle mute if user is speaking
			if currentState == SPEAKING {
				toggleUserState(userID, MUTED)
			} else if currentState == MUTED {
				toggleUserState(userID, SPEAKING)
			}

		default:
			log.Errorf("unknown message: %+v", message)
		}
	}
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
