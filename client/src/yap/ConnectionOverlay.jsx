import { createSignal, onMount, onCleanup } from 'solid-js';
import styles from './ConnectionOverlay.module.css';

export default function ConnectionOverlay(props) {
    const [isVisible, setIsVisible] = createSignal(false);
    let timeoutId;

    onMount(() => {
        // Trigger fade in
        requestAnimationFrame(() => {
            setIsVisible(true);
        });

        // Start fade out after delay
        timeoutId = setTimeout(() => {
            setIsVisible(false);
            // Wait for fade out animation to complete before unmounting
            setTimeout(() => {
                props.onClose?.();
            }, 400); // Match the transition duration
        }, 2000);
    });

    onCleanup(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });

    return (
        <div class={`${styles.content} ${isVisible() ? styles.visible : ''}`}>
            <div class={styles.icon}>🔌</div>
            <div class={styles.title}>
                Connected to Server
                <div class={styles.statusIndicator} />
            </div>
        </div>
    );
} 