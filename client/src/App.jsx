import styles from './App.module.css';
import Room from './yap/Room';
import { children, onCleanup, onMount } from 'solid-js';

function App() {
	return (
		<div>
			<header class={styles.header}>
				<h1>This is <strong>notspaces</strong></h1>
				<h2>
					You can speak, but don't <strong>yap</strong> too much.
				</h2>
			</header>
			<MouseTilt>
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
			</MouseTilt>
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

function MouseTilt(props) {
	let el
	const resetMargin = 1000;
	const maxTilt = 10;
	onMount(() => {
		document.body.addEventListener('mousemove', mouseMove)
	})

	onCleanup(() => {
		document.body.removeEventListener('mousemove', mouseMove)
	})

	const mouseMove = (e) => {
		const rect = el.getBoundingClientRect(); // Get current size and position of the card

		// Get mouse coordinates relative to the viewport
		const mouseX = e.clientX;
		const mouseY = e.clientY;

		// Define the boundaries of the active tilt zone (card bounds + resetMargin)
		const activeAreaLeft = rect.left - resetMargin;
		const activeAreaRight = rect.right + resetMargin;
		const activeAreaTop = rect.top - resetMargin;
		const activeAreaBottom = rect.bottom + resetMargin;

		// Check if the mouse is within the defined active area
		if (mouseX >= activeAreaLeft && mouseX <= activeAreaRight &&
			mouseY >= activeAreaTop && mouseY <= activeAreaBottom) {

			// Calculate mouse position relative to the card's top-left corner
			const x = mouseX - rect.left;
			const y = mouseY - rect.top;

			// Normalize x and y to a range of -0.5 to 0.5 relative to the card's center
			// 0.0 is the left/top edge, 1.0 is the right/bottom edge, 0.5 is the center
			const xAxis = (x / rect.width) - 0.5;
			const yAxis = (y / rect.height) - 0.5;

			// Calculate tilt angles
			// rotateX: tilts around the horizontal axis (based on vertical mouse position)
			// We negate yAxis so moving the mouse up tilts the top edge away (intuitive 3D)
			const tiltX = -yAxis * (maxTilt * 2);
			// rotateY: tilts around the vertical axis (based on horizontal mouse position)
			// Moving the mouse right tilts the right edge away
			const tiltY = xAxis * (maxTilt * 2);

			// Apply the 3D transform to the card
			el.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
		} else {
			// If the mouse is outside the active area, reset the card's tilt
			el.style.transform = `rotateX(0deg) rotateY(0deg)`;
		}
	}

	const c = children(() => props.children);

	return (
		<div ref={el}>
			{c()}
		</div>
	)
}


export default App;
