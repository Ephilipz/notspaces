import { createSignal, For, onMount } from 'solid-js';
import styles from './Room.module.css';

export default function Room() {
  const [tracks, setTracks] = createSignal([])
  const [localStream, setLocalStream] = createSignal(null);
  const [ws, setWs] = createSignal(null);
  const [pc, setPc] = createSignal(null);

  const setupPeerConnection = async () => {
    const _userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setLocalStream(_userStream);
    setPc(new RTCPeerConnection())

    for (const track of _userStream.getTracks()) {
      pc().addTrack(track, _userStream);
    }

    pc().ontrack = function(event) {
      console.log("Received track:", event.track, event.streams);
      const stream = event.streams[0]
      const id = stream.id

      stream.onremovetrack = ({ track }) => {
        setTracks(prev => prev.filter(item => item.id !== track.id));
      };

      setTracks(prev => [
        prev.filter(item => item.id !== id),
        { id: id, track: event.track, stream: stream }
      ])

    }

    // websocket connection
    const _socket = new WebSocket('ws://localhost:8080/websocket');
    setWs(_socket);

    // send ICE candidate to server when we have a new one
    pc().onicecandidate = (event) => {
      const cand = event.candidate
      if (!cand) return

      ws().send(JSON.stringify({
        event: 'candidate',
        data: JSON.stringify(cand)
      }));
    }

    ws().onmessage = async function(event) {
      const msg = JSON.parse(event.data);
      if (!msg) return

      switch (msg.event) {
        case 'offer':
          let offer = JSON.parse(msg.data)
          if (!offer)
            return console.error("Failed to parse offer")
          pc().setRemoteDescription(offer)
          const answer = await pc().createAnswer()
          pc().setLocalDescription(answer)

          ws().send(JSON.stringify({
            event: 'answer',
            data: JSON.stringify(answer)
          }))
          return

        case 'candidate':
          let cand = JSON.parse(msg.data)
          if (!cand)
            return console.error("Failed to parse candidate")
          pc().addIceCandidate(cand)
      }
    }

    ws().onclose = () => {
      console.log("WebSocket connection closed");
      setWs(null);
      setPc(null);
      setTracks({});
    }
  }

  onMount(() => {
    setupPeerConnection();
  })

  return (
    <div>
      {localStream() &&
        <Track stream={localStream()} muted />
      }

      <hr />

      <h2>Others</h2>
      <For each={tracks().filter(x => x.stream)}>{(item) =>
        <Track stream={item.stream} track={item.track} key={item.id} />
      }</For>
    </div>
  );
}

function Track(props) {
  let el;
  const volumeFunc = volumeFromStream(props.stream);
  const [volume, setVolume] = createSignal(0);

  function updateVolume() {
    const currentVolume = volumeFunc.getVolume();
    setVolume(currentVolume);
    requestAnimationFrame(updateVolume);
  }

  onMount(() => {
    if (el) {
      el.srcObject = props.stream;
      updateVolume();
    }
  });

  return (
    <div>
      <img src="https://media.tenor.com/X1nlfLKP6toAAAAM/cat-eat.gif"
        height="80px"
        style={{
          "border-radius": "50%",
          "border": props.muted ? "none" : `2px solid rgba(0, 255, 0, ${volume()})`,
          // glow effect
          "box-shadow": props.muted ? "" : `0 0 10px rgba(0, 255, 0, ${volume() * 1.5})`,
          transition: "border 1s, box-shadow 2s"
        }} />
      <audio
        autoplay
        controls={false}
        muted={props.muted}
        ref={el}
      />
      <p>Volume: {volume().toFixed(2)}</p>
    </div>
  )
}

// returns a signal from 0 to 1 based on the current volume
function volumeFromStream(stream) {
  if (!stream) return 0;

  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 256

  source.connect(analyser);

  function getVolume() {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const sum = data.reduce((a, b) => a + b, 0);
    // Normalize to 0-1
    const norm = sum / data.length / 128;
    // if it's lower than 0.2 return 0
    return norm < 0.2 ? 0 : norm;
  }

  return {
    getVolume,
  }
}
