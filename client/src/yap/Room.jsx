import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import styles from './Room.module.css'

const Room = () => {
	const name = localStorage.getItem('name') || 'anon'
	const [id, setId] = createSignal('')
	const [speakerState, setSpeakerState] = createSignal('muted')
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
		ws.onclose = () => stream.getTracks().forEach(track => track.stop())

		ws.onmessage = (e) => {
			const msg = JSON.parse(e.data)
			if (!msg) return console.log('failed to parse msg')

			switch (msg.event) {
				case 'offer': {
					const offer = JSON.parse(msg.data)
					if (!offer) return console.log('failed to parse answer')
					pc.setRemoteDescription(offer)
					pc.createAnswer().then((answer) => {
						pc.setLocalDescription(answer)
						ws.send(JSON.stringify({ event: 'answer', data: JSON.stringify(answer) }))
					})
					return
				}
				case 'candidate': {
					const candidate = JSON.parse(msg.data)
					if (!candidate) return console.log('failed to parse candidate')
					pc.addIceCandidate(candidate)
					break
				}
				case 'id': {
					setId(msg.data)
					break
				}
				case 'users': {
					const data = JSON.parse(msg.data)
					if (data && data.users) setUsers(data.users)
					break
				}
				default:
					console.log('received message', msg)
				}
		}

		pc.onicecandidate = (e) => {
			if (!e.candidate) return
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

	function getInitials(username) {
		return username.slice(0, 2).toUpperCase()
	}

	function getUserStyle(username) {
		const styles = ['cherry', 'lemon', 'berry', 'lime', 'grape']
		let hash = 0
		for (let i = 0; i < username.length; i++) {
			hash = username.charCodeAt(i) + ((hash << 5) - hash)
		}
		return styles[Math.abs(hash) % styles.length]
	}

	return (
		<div class={styles.wackyLand}>
			<div class={styles.gopherFloat}>
				<img 
					src="/src/assets/pion-gopher-webrtc.png" 
					alt="WebRTC Gopher mascot" 
					class={styles.gopher}
				/>
			</div>

			<div class={styles.headerBlob}>
				<div class={styles.logo}>NOTSPACES</div>
				<div class={styles.tagline}>talk into the void (with friends)</div>
			</div>

			<div class={styles.controlPanel}>
				<div class={styles.idCard}>
					<div class={styles.idCardHole}></div>
					<div class={styles.idCardHeader}>
						<span class={styles.idCardStar}>★</span>
						<span>HELLO MY NAME IS</span>
						<span class={styles.idCardStar}>★</span>
					</div>
					<div class={styles.idCardBody}>
						<div class={styles.yourName}>{name}</div>
					</div>
					<div class={styles.idCardFooter}>
						<span class={styles.idCardBadge}>MEMBER</span>
						<span class={styles.idCardId}>ID: {(Math.random() * 10000).toFixed(0).padStart(4, '0')}</span>
					</div>
				</div>

				<button 
					type="button"
					class={speakerState() === 'muted' ? styles.muteBtn : styles.talkBtn}
					onClick={toggleMute}
				>
					<Show when={speakerState() === 'muted'}>
						<span class={styles.btnIcon}>
							<MuteIcon />
						</span>
						<span>SHHHH</span>
					</Show>
					<Show when={speakerState() === 'speaking'}>
						<span class={styles.btnIcon}>
							<MicIcon />
						</span>
						<span>YAP YAP YAP</span>
					</Show>
				</button>
			</div>

			<Show when={users().length <= 1}>
				<div class={styles.lonelyZone}>
					<div class={styles.sadBlob}>(◉︵◉)</div>
					<p>it's just you here...</p>
					<p class={styles.subtext}>invite a friend or talk to yourself!</p>
				</div>
			</Show>

			<Show when={users().length > 1}>
				<div class={styles.partyZone}>
					<div class={styles.counterBlob}>
						<div class={styles.bigNumber}>{users().length}</div>
						<div class={styles.peopleLabel}>weirdos in the room</div>
					</div>

					<div class={styles.userBlobContainer}>
						<For each={users()}>
							{(user) => (
								<div class={styles[user.Id === id() ? 'meBlob' : 'userBlob']}>
									<div class={styles[`blob${getUserStyle(user.Name)}`]}>
										<div class={styles.initials}>{getInitials(user.Name)}</div>
										{user.Id === id() && <div class={styles.meBadge}>ME</div>}
									</div>
									<div class={styles.userName}>{user.Name}</div>
								</div>
							)}
						</For>
					</div>
				</div>
			</Show>

			<div class={styles.hiddenAudio}>
				<For each={remoteStreams()}>
					{stream => (
						<audio
							ref={(audio) => { if (audio) audio.srcObject = stream }}
							autoPlay
							controls={false}
						>
							<track kind="captions" src="" label="Audio track" />
						</audio>
					)}
				</For>
			</div>
		</div>
	)
}

function MuteIcon() {
	return (
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<title>Mute icon</title>
			<rect x="8" y="4" width="8" height="11" rx="4" fill="currentColor"/>
			<path d="M5 12C5 13.8565 5.7375 15.637 7.05025 16.9497C8.36301 18.2625 10.1435 19 12 19C13.8565 19 15.637 18.2625 16.9497 16.9497C18.2625 15.637 19 13.8565 19 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
			<path d="M2 2L22 22" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
		</svg>
	)
}

function MicIcon() {
	return (
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<title>Microphone icon</title>
			<rect x="8" y="2" width="8" height="13" rx="4" fill="currentColor"/>
			<path d="M5 11C5 12.8565 5.7375 14.637 7.05025 15.9497C8.36301 17.2625 10.1435 18 12 18C13.8565 18 15.637 17.2625 16.9497 15.9497C18.2625 14.637 19 12.8565 19 11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
			<path d="M12 22V19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
		</svg>
	)
}

export default Room
