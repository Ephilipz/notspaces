import { A } from '@solidjs/router'
import { createSignal, Show } from 'solid-js'
import styles from './Home.module.css'

export default function Home() {
	const [name, setName] = createSignal(localStorage.getItem('name') || null)
	return (
		<div class={styles.wackyLand}>
			<div class={styles.gopherFloat}>
				<img
					src="/src/assets/pion-gopher-webrtc.png"
					alt="WebRTC Gopher mascot"
					class={styles.gopher}
				/>
			</div>

			<header class={styles.header}>
				<h1 class={styles.wackyTitle}>
					NOTSPACES
				</h1>
				<p class={styles.tagline}>
					talk into the void (with friends)
				</p>

				<div class={styles.nameSection}>
					<label class={styles.nameLabel} for="name-input">
						HELLO MY NAME IS
					</label>
					<input
						id="name-input"
						autofocus
						placeholder="type your name here..."
						value={name()}
						onInput={(e) => {
							setName(e.target.value)
							localStorage.setItem('name', e.target.value)
						}}
					/>
				</div>
			</header>

			<Show when={name() && name().length > 2}>
				<div class={styles.enterSection}>
					<A href="/room" class={styles.enterLink}>
						<div class={styles.enterButton}>
							<span class={styles.enterText}>ENTER THE ROOM</span>
							<div class={styles.enterArrow}>
								<ArrowSVG />
							</div>
						</div>
					</A>
					<p class={styles.enterHint}>click to start yapping!</p>
				</div>
			</Show>

			<Show when={!name() || name().length <= 2}>
				<div class={styles.waitingSection}>
					<div class={styles.waitingBlob}>(◉︵◉)</div>
					<p>waiting for you to type a name...</p>
				</div>
			</Show>

			<div class={styles.decorations}>
				<div class={styles.star}>★</div>
				<div class={styles.sparkle}>✦</div>
				<div class={styles.circle}>●</div>
			</div>
		</div>
	)
}

function ArrowSVG() {
	return (
		<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<title>Arrow pointing right</title>
			<path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	)
}
