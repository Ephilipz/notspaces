import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import styles from './Room.module.css'
import Ascii from './ascii'

const Room = () => {
	const name = localStorage.getItem('name') || 'anon'
	const [id, setId] = createSignal('')
	const [userState, setUserState] = createSignal('listening')
	const [users, setUsers] = createSignal([])

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
					try {
						const data = JSON.parse(msg.data)
						setId(data.id)
						setUsers(data.users || [])
						// Set initial user state
						const currentUser = data.users?.find(u => u.id === data.id)
						if (currentUser) {
							setUserState(currentUser.state)
						}
					} catch {
						// Fallback for old format
						setId(msg.data)
					}
					break
				}
				case 'user_states_updated': {
					const data = JSON.parse(msg.data)
					setUsers(data.users || [])
					// Update current user's state
					const currentUser = data.users?.find(u => u.id === id())
					if (currentUser) {
						const newState = currentUser.state
						setUserState(newState)
						
						// Update audio track based on state
						if (localStream() && localStream().getAudioTracks().length > 0) {
							if (newState === 'speaking') {
								localStream().getAudioTracks()[0].enabled = true
							} else {
								localStream().getAudioTracks()[0].enabled = false
							}
						}
					}
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

	function toggleSpeaking() {
		console.log('toggleSpeaking clicked, current state:', userState())
		if (ws && ws.readyState === WebSocket.OPEN) {
			console.log('Sending toggle_speaking message')
			ws.send(JSON.stringify({ event: 'toggle_speaking', data: '' }))
		} else {
			console.log('WebSocket not ready:', ws?.readyState)
		}
	}

	function toggleMute() {
		if (userState() === 'speaking' || userState() === 'muted') {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ event: 'toggle_mute', data: '' }))
			}
		}
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
				<div class="pill" classList={{ 
					muted: userState() === 'listening' || userState() === 'muted', 
					attention: userState() === 'speaking'
				}}>
					<svg width="20" height="20" classList={{ pulse: userState() === 'speaking' }}>
						<circle cx="10" cy="10" r="8" fill="currentcolor" />
					</svg>
					<span>
						<Show when={userState() === 'listening'}>
							You are <strong>Listening</strong>
						</Show>
						<Show when={userState() === 'speaking'}>
							You are <strong>Speaking</strong>
						</Show>
						<Show when={userState() === 'muted'}>
							You are <strong>Muted</strong>
						</Show>
					</span>
				</div>
				<button class="btn primary" onClick={toggleSpeaking} classList={{ glow: userState() === 'listening' }}>
					{userState() === 'listening' ? 'Start Speaking' : 'Stop Speaking'}
				</button>
				<Show when={userState() === 'speaking' || userState() === 'muted'}>
					<button class="btn" onClick={toggleMute}>
						{userState() === 'muted' ? 'Unmute' : 'Mute'}
					</button>
				</Show>
			</div>
			<hr />
			<Show when={remoteStreams().length === 0}>
				<p class="muted">You're here alone. Look at this beautiful art until someone joins</p>
				<Ascii />
			</Show>
			<h3 class="muted">
				<strong>{users()?.length}</strong>
				{' '}
				Users Connected
			</h3>
			<Show when={users().length > 1}>
				<div style="margin: 1rem 0;">
					<h4>Other Users</h4>
					<For each={users().filter(u => u.id !== id())}>
						{user => (
							<div style="display: flex; align-items: center; gap: 1rem; margin: 0.5rem 0; padding: 0.5rem; border: 1px solid #333; border-radius: 4px;">
								<span>{user.name}</span>
								<span class="pill" classList={{
									muted: user.state === 'listening' || user.state === 'muted',
									attention: user.state === 'speaking'
								}}>
									{user.state}
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
			<h4 class="muted">
				<strong>{remoteStreams()?.length}</strong>
				{' '}
				Active Speakers
			</h4>
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
