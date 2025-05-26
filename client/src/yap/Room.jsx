import { createSignal, onCleanup } from 'solid-js';
import styles from './Room.module.css';
import ConnectionOverlay from './ConnectionOverlay';
import UserList from './UserList';

export default function Room() {
  const [isMuted, setIsMuted] = createSignal(true);
  const [stream, setStream] = createSignal(null);
  const [peerConnection, setPeerConnection] = createSignal(null);
  const [ws, setWs] = createSignal(null);
  const [showOverlay, setShowOverlay] = createSignal(false);

  const setupWebSocket = () => {
    const socket = new WebSocket('ws://localhost:8080/websocket');

    socket.onopen = () => {
      console.log('WebSocket connection established');
      setShowOverlay(true);
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);

      if (message.event === 'offer') {
        const pc = peerConnection();
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: message.data }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.send(JSON.stringify({ event: 'answer', data: answer.sdp }));
        }
      } else if (message.event === 'ice-candidate') {
        const pc = peerConnection();
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(message.data)));
        }
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };

    setWs(socket);
  };

  const setupPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = ws();
        if (socket) {
          socket.send(JSON.stringify({
            event: 'ice-candidate',
            data: JSON.stringify(event.candidate)
          }));
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setShowOverlay(true);
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
    };

    setPeerConnection(pc);
  };

  const toggleMic = async () => {
    if (isMuted()) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(audioStream);

        // Add audio track to peer connection
        const pc = peerConnection();
        if (pc) {
          audioStream.getTracks().forEach(track => {
            pc.addTrack(track, audioStream);
          });
        }

        setIsMuted(false);
      } catch (err) {
        console.error('Error accessing microphone:', err);
      }
    } else {
      const currentStream = stream();
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      setIsMuted(true);
    }
  };

  // Initialize WebSocket and PeerConnection when component mounts
  setupWebSocket();
  setupPeerConnection();

  onCleanup(() => {
    const currentStream = stream();
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }

    const pc = peerConnection();
    if (pc) {
      pc.close();
    }

    const socket = ws();
    if (socket) {
      socket.close();
    }
  });

  return (
    <div class={styles.roomContainer}>
      <img src="https://github.com/pion/webrtc/raw/master/.github/pion-gopher-webrtc.png" height="200px" class={isMuted() ? styles.muted : ''} />
      <button
        onClick={toggleMic}
        class={`${styles.micButton} ${isMuted() ? styles.muted : ''}`}
        aria-label={isMuted() ? 'Unmute microphone' : 'Mute microphone'}
      >
        {isMuted() ? '🎤' : '🔇'}
      </button>
      <p>{isMuted() ? 'Click to yap' : 'Click to mute'}</p>

      <hr />

      <UserList />

      {showOverlay() && <ConnectionOverlay onClose={() => setShowOverlay(false)} />}
    </div>
  );
}
