import { createSignal, For, onCleanup, onMount } from 'solid-js'
import styles from './Room.module.css'

const Room = () => {
	const name = localStorage.getItem('name') || 'anon'
	const [localStream, setLocalStream] = createSignal(null)
	const [remoteStreams, setRemoteStreams] = createSignal([])
	let pc = new RTCPeerConnection()
	let ws = null

	onMount(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
		setLocalStream(stream)
		toggleMute()
		stream.getTracks().forEach(track => pc.addTrack(track, stream))

		pc.ontrack = (event) => {
			setRemoteStreams(prevStreams => [...prevStreams, event.streams[0]])

			event.track.onmute = () => {
				setRemoteStreams(prevStreams => prevStreams.filter(s => s.id !== event.streams[0].id))
			}
		}

		ws = new WebSocket(import.meta.env.VITE_API_URL + 'websocket')

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
				}
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
			<div class="row">
				<span class="pill muted">
					You are
					{' '}
					<strong>Muted</strong>
				</span>
				<button class="btn primary glow" onClick={toggleMute}>
					Unmute
				</button>
			</div>
			<hr />
			<p class="pill info">
				<strong>{remoteStreams()?.length}</strong>
				{' '}
				Users Connected
			</p>
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
