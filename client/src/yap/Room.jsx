import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import styles from './Room.module.css'
import Ascii from './ascii'

const Room = () => {
	const name = localStorage.getItem('name') || 'anon'
	const [id, setId] = createSignal('')
	const [speakerState, setSpeakerState] = createSignal('muted')

	const [localStream, setLocalStream] = createSignal(null)
	const [remoteStreams, setRemoteStreams] = createSignal([])
	let pc = new RTCPeerConnection()
	let ws = null

	onMount(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
		stream.getAudioTracks()[0].enabled = false
		setLocalStream(stream)
		stream.getTracks().forEach(track => pc.addTrack(track, stream))

		pc.ontrack = (event) => {
			setRemoteStreams(prevStreams => [...prevStreams, event.streams[0]])

			event.track.onmute = () => {
				setRemoteStreams(prevStreams => prevStreams.filter(s => s.id !== event.streams[0].id))
			}
		}

		ws = new WebSocket(import.meta.env.VITE_API_URL + 'websocket?name=' + name)

		ws.onclose = () => {
			stream.getTracks().forEach((track) => {
				track.stop()
			})
		}

		ws.onmessage = (e) => {
			const msg = JSON.parse(e.data)
			if (!msg) {
				return console.log('failed to parse msg')
			}

			switch (msg.event) {
				case 'offer': {
					const offer = JSON.parse(msg.data)
					if (!offer) {
						return console.log('failed to parse answer')
					}
					pc.setRemoteDescription(offer)
					pc.createAnswer().then((answer) => {
						pc.setLocalDescription(answer)
						ws.send(JSON.stringify({ event: 'answer', data: JSON.stringify(answer) }))
					})
					return
				}
				case 'candidate': {
					const candidate = JSON.parse(msg.data)
					if (!candidate) {
						return console.log('failed to parse candidate')
					}
					pc.addIceCandidate(candidate)
					break
				}
				case 'id': {
					const id = msg.data
					setId(id)
					break
				}
				default:
					console.log('received message', msg)
			}
		}

		pc.onicecandidate = (e) => {
			if (!e.candidate) {
				return
			}
			ws.send(JSON.stringify({ event: 'candidate', data: JSON.stringify(e.candidate) }))
		}
	})

	onCleanup(() => {
		ws?.close()
		pc?.close()
	})

	function toggleMute() {
		localStream().getAudioTracks()[0].enabled = !localStream().getAudioTracks()[0].enabled
		setSpeakerState(prev => prev === 'muted' ? 'speaking' : 'muted')
	}

	return (
		<div class={styles.roomContainer}>
			<h1>
				Welcome,
				<strong>
					{' '}
					{name}
				</strong>
			</h1>
			<div class="row hcenter">
				<div class="pill" classList={{ muted: speakerState() === 'muted', attention: speakerState() === 'speaking' }}>
					<svg width="20" height="20" classList={{ pulse: speakerState() === 'speaking' }}>
						<circle cx="10" cy="10" r="8" fill="currentcolor" />
					</svg>
					<span>
						You are
						{' '}
						<strong>{speakerState() === 'muted' ? 'Muted' : 'Speaking'}</strong>
					</span>
				</div>
				<button class="btn primary" onClick={toggleMute} classList={{ glow: speakerState() === 'muted' }}>
					{speakerState() === 'muted' ? 'Unmute' : 'Mute'}
				</button>
			</div>
			<hr />
			<Show when={remoteStreams().length === 0}>
				<p class="muted">You're here alone. Look at this beautiful art until someone joins</p>
				<Ascii />
			</Show>
			<h3 class="muted">
				<strong>{remoteStreams()?.length}</strong>
				{' '}
				Users Connected
			</h3>
			<div>
				<For each={remoteStreams()}>
					{stream => (
						<div>
							<audio
								ref={(audio) => {
									if (audio) {
										audio.srcObject = stream
									}
								}}
								autoPlay
								controls={false}
							/>
							{stream.id}
						</div>
					)}
				</For>
			</div>
		</div>
	)
}

export default Room
