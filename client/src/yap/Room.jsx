import { createSignal, For, onCleanup, onMount } from 'solid-js';
import styles from './Room.module.css';

export default function Room() {

	const [tracks, setTracks] = createSignal([])
	const [localStream, setLocalStream] = createSignal(null);
	const [ws, setWs] = createSignal(null);

	// peerconnection data
	// the client is always the polite peer. the server is the impolite peer
	const [pc, setPc] = createSignal(null);
	const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
	let makingOffer = false
	let isSettingRemoteAnswerPending = false

	const setupWebsocket = async () => {
		// websocket connection
		const _socket = new WebSocket('ws://localhost:8080/websocket');
		setWs(_socket);

		ws().onmessage = async function(event) {
			const msg = JSON.parse(event.data);
			if (!msg) return
			const payload = JSON.parse(msg.data)

			switch (msg.event) {
				case 'offer':
					try {
						const offer = payload
						await pc().setRemoteDescription(offer)

						// we use implicit description instead of manually creating an answer
						await pc().setLocalDescription()
						ws().send(JSON.stringify({
							event: 'answer',
							data: JSON.stringify(pc().localDescription)
						}))
					} catch (e) {
						console.error('failed to set incoming offer', e, payload.sdp)
					}
					return

				case 'candidate':
					let cand = payload
					await pc().addIceCandidate(cand)
					return

				case 'answer':
					try {
						const incomingAns = payload

						// idk why this is, but we set remote answer as pending until we update the remote desc. asynchronously
						isSettingRemoteAnswerPending = true
						await pc().setRemoteDescription(incomingAns)
						isSettingRemoteAnswerPending = false
					} catch (e) {
						console.error('failed to set incoming answer', e, payload.sdp)
					}
					return
			}
		}

		ws().onclose = () => {
			console.log("WebSocket connection closed");
			setWs(null);
			setPc(null);
			setTracks([]);
		}
	}

	const setupPeerConnection = async () => {
		setPc(new RTCPeerConnection(pcConfig))
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

		// send ICE candidate to server when we have a new one
		pc().onicecandidate = (event) => {
			const cand = event.candidate
			if (!cand) return

			ws().send(JSON.stringify({
				event: 'candidate',
				data: JSON.stringify(cand)
			}));
		}

		// we want to renegotiate when the track is added
		pc().onnegotiationneeded = async () => {
			try {
				makingOffer = true
				await pc().setLocalDescription()
				ws().send(JSON.stringify({
					event: 'offer',
					data: JSON.stringify(pc().localDescription)
				}))
			} finally {
				makingOffer = false
			}
		}
	}

	const addAudio = async () => {
		const _userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		setLocalStream(_userStream);

		for (const track of _userStream.getTracks()) {
			pc().addTrack(track, _userStream);
		}
	}

	const removeAudio = async () => {
		for (const track of _userStream.getTracks()) {
			pc().removeTrack(track)
		}
	}

	onMount(() => {
		setupWebsocket()
		setupPeerConnection()
	})

	return (
		<div>
			{localStream() &&
				<Track stream={localStream()} muted />
			}

			<button type="button" class="btn" onclick={addAudio}>Start Yapping</button>

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
	const volumeFunc = volumeFromStream(props.stream)
	const [volume, setVolume] = createSignal(0)

	function updateVolume() {
		const currentVolume = volumeFunc()
		setVolume(currentVolume)
		requestAnimationFrame(updateVolume)
	}

	onMount(() => {
		if (el) {
			el.srcObject = props.stream;
			updateVolume();
		}
	});

	return (
		<div>
			<p>{props.stream.id}</p>
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
	source.connect(analyser)

	const pcmData = new Float32Array(analyser.fftSize)

	const onFrame = () => {
		analyser.getFloatFrequencyData(pcmData)
		let sumSqr = 0.0
		for (const amplitude of pcmData) {
			sumSqr += amplitude * amplitude
		}
		return Math.sqrt(sumSqr / pcmData.length)
	}

	return onFrame
}
