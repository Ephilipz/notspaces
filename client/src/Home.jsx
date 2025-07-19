import { A } from '@solidjs/router';
import styles from './Home.module.css';
import { MouseTilt } from './MouseTilt';
import Room from './yap/Room';
import { createSignal, Show } from 'solid-js';

export default function Home() {
	const [name, setName] = createSignal(localStorage.getItem('name') || null)
	return (
		<div>
			<header class={styles.header}>
				<h1>This is <strong>notspaces</strong></h1>
				<h2>
					You can speak, but don't <strong>yap</strong> too much.
				</h2>
				<hr />
				<input autofocus placeholder='Enter your name' value={name()} oninput={(e) => {
					setName(e.target.value)
					localStorage.setItem('name', e.target.value)
				}} />
			</header>
			<Show when={name() && name().length > 2}>
				<MouseTilt>
					<A href="/room" style={{ "text-decoration": 'none' }} aria-disabled={!name()}>
						<div class={styles.cardWrapper}>
							<p class={styles.indicator}>Enter</p>
							<div class={styles.playingCard}>
								<div class={`${styles.corner} ${styles.topLeft}`}>
									<span>A</span>
									<MicSVG />
								</div>
								<div class={styles.center}>
									<MicSVG />
								</div>
								<div class={`${styles.corner} ${styles.btmRight}`}>
									<span>A</span>
									<MicSVG />
								</div>
							</div>
						</div>
					</A>
				</MouseTilt>
			</Show>
		</div>
	);
}

function MicSVG() {
	return (
		<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="8" y="2" width="8" height="13" rx="4" fill="currentcolor" />
			<path d="M5 11C5 12.8565 5.7375 14.637 7.05025 15.9497C8.36301 17.2625 10.1435 18 12 18C13.8565 18 15.637 17.2625 16.9497 15.9497C18.2625 14.637 19 12.8565 19 11" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill-rule="inherit" />
			<path d="M12 21V19" stroke="#222222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	)
}
