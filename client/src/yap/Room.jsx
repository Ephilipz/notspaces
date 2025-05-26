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
  const [isConnected, setIsConnected] = createSignal(false);

  const setupWebSocket = () => {
    const socket = new WebSocket('ws://localhost:8080/websocket');

    socket.onopen = () => {
      console.log('WebSocket connection established');
      setIsConnected(true);
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message);

      const pc = peerConnection();
      if (!pc) return;

      switch (message.event) {
        case 'offer':
          const offer = JSON.parse(message.data);
          if (!offer) {
            console.log('Failed to parse offer');
            return;
          }

          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.send(JSON.stringify({
            event: 'answer',
            data: JSON.stringify(answer)
          }));
          break;

        case 'candidate':
          const candidate = JSON.parse(message.data);
          if (!candidate) {
            console.log('Failed to parse candidate');
            return;
          }
          await pc.addIceCandidate(candidate);
          break;

        case 'error':
          console.error('Server error:', message.data);
          break;

        default:
          console.log('Unknown message:', message);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      setIsConnected(false);
    };

    setWs(socket);
  };

  const setupPeerConnection = async () => {
    const pc = new RTCPeerConnection();

    // Handle incoming audio tracks
    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (event.track.kind === 'audio') {
        // For audio-only, we could create an audio element or handle audio visualization
        console.log('Received audio track from remote peer');

        // Create audio element for remote audio
        const audioElement = document.createElement('audio');
        audioElement.srcObject = event.streams[0];
        audioElement.autoplay = true;
        audioElement.style.display = 'none'; // Hide audio element
        document.body.appendChild(audioElement);

        // Clean up when track ends
        event.track.onmute = () => {
          audioElement.play();
        };

        event.streams[0].onremovetrack = () => {
          if (audioElement.parentNode) {
            audioElement.parentNode.removeChild(audioElement);
          }
        };
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const socket = ws();
      if (socket) {
        socket.send(JSON.stringify({
          event: 'candidate',
          data: JSON.stringify(event.candidate)
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setShowOverlay(true);
      } else if (pc.connectionState === 'failed') {
        console.error('Peer connection failed');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    setPeerConnection(pc);
    console.log('Peer connection ready - no audio access yet');
  };

  const toggleMic = async () => {
    const pc = peerConnection();
    const connected = isConnected();

    // Don't allow unmuting if not connected
    if (!connected && isMuted()) {
      console.log('Cannot unmute: not connected to server');
      return;
    }

    if (!pc) return;

    if (isMuted()) {
      // Unmuting: request audio access and add to peer connection
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(audioStream);

        const audioTrack = audioStream.getAudioTracks()[0];
        if (audioTrack) {
          pc.addTrack(audioTrack, audioStream);
          setIsMuted(false);
          console.log('Unmuted: Audio access granted and track added to peer connection');
        }
      } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Could not access microphone. Please check permissions.');
      }
    } else {
      // Muting: remove track from peer connection and stop stream
      const currentStream = stream();
      if (currentStream) {
        const senders = pc.getSenders();
        const audioSender = senders.find(sender =>
          sender.track && sender.track.kind === 'audio'
        );
        if (audioSender) {
          pc.removeTrack(audioSender);
        }

        // Stop all tracks to release microphone
        currentStream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      setIsMuted(true);
      console.log('Muted: Audio track removed and microphone released');
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

    // Clean up any audio elements
    const audioElements = document.querySelectorAll('audio[autoplay]');
    audioElements.forEach(el => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    });
  });

  return (
    <div class={styles.roomContainer}>
      <img
        src="https://github.com/pion/webrtc/raw/master/.github/pion-gopher-webrtc.png"
        height="200px"
        class={isMuted() ? styles.muted : ''}
      />
      <button
        onClick={toggleMic}
        class={`${styles.micButton} ${isMuted() ? styles.muted : ''}`}
        aria-label={isMuted() ? 'Unmute microphone' : 'Mute microphone'}
        disabled={!isConnected() && isMuted()}
      >
        {isMuted() ? '🎤' : '🔇'}
      </button>
      <p>
        {!isConnected() && isMuted() ? 'Connect to server first' :
          isMuted() ? 'Click to yap' : 'Click to mute'}
      </p>
      <p class={styles.status}>
        {isConnected() ? '🟢 Connected' : '🔴 Disconnected'}
      </p>
      <UserList />
      {showOverlay() && <ConnectionOverlay onClose={() => setShowOverlay(false)} />}
    </div>
  );
}
