import { createSignal, onCleanup, onMount } from 'solid-js';
import styles from './Room.module.css';

export default function Room() {
  const setupPeerConnection = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const pc = new RTCPeerConnection();
    const ws = new WebSocket('http://localhost:8080/websocket');
    pc.onicecandidate = e => {
      if (!e.candidate) {
        return
      }

      ws.send(JSON.stringify({ event: 'candidate', data: JSON.stringify(e.candidate) }))
    }

    ws.onclose = function(evt) {
      window.alert("Websocket has closed")
    }

    ws.onmessage = function(evt) {
      let msg = JSON.parse(evt.data)
      if (!msg) {
        return console.log('failed to parse msg')
      }

      switch (msg.event) {
        case 'offer':
          let offer = JSON.parse(msg.data)
          if (!offer) {
            return console.log('failed to parse answer')
          }
          pc.setRemoteDescription(offer)
          pc.createAnswer().then(answer => {
            pc.setLocalDescription(answer)
            ws.send(JSON.stringify({ event: 'answer', data: JSON.stringify(answer) }))
          })
          return

        case 'candidate':
          let candidate = JSON.parse(msg.data)
          if (!candidate) {
            return console.log('failed to parse candidate')
          }

          pc.addIceCandidate(candidate)
      }
    }

    ws.onerror = function(evt) {
      console.log("ERROR: " + evt.data)
    }
  };

  onMount(() => {
    setupPeerConnection();
  })

  return (
    <div>
      <img
        src="https://github.com/pion/webrtc/raw/master/.github/pion-gopher-webrtc.png"
        height="200px"
      />
      <img src="https://media.tenor.com/X1nlfLKP6toAAAAM/cat-eat.gif" height="200px" style={{ "border-radius": "50%" }} />

    </div>
  );
}
