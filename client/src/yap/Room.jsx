import { createSignal, For, onCleanup, onMount } from 'solid-js';
import styles from './Room.module.css';

export default function Room() {
	const name = localStorage.getItem('name') || 'anon';
	const [users, setUsers] = createSignal([])

	return (
		<main>
			<h1>Welcome to the Room, <strong>{name}</strong></h1>
			<p class='muted'>{users().length || 'No'} Yappers in the room</p>
			<button class='btn primary' type="button">Start speaking</button>
		</main>
	);
}
