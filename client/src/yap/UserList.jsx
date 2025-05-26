import { createSignal } from 'solid-js';
import styles from './UserList.module.css';

export default function UserList() {
    // Mock data for now - this would come from WebSocket in real implementation
    const [users] = createSignal([
        { id: 1, name: 'Alice', isSpeaking: true },
        { id: 2, name: 'Bob', isSpeaking: false },
        { id: 3, name: 'Charlie', isSpeaking: false },
        { id: 4, name: 'Diana', isSpeaking: true },
    ]);

    return (
        <div class={styles.userListContainer}>
            <h3 class={styles.title}>Users ({users().length})</h3>
            <div class={styles.userGrid}>
                {users().map(user => (
                    <div class={styles.userCard} key={user.id}>
                        <div class={styles.userImageContainer}>
                            <img
                                src="https://github.com/pion/webrtc/raw/master/.github/pion-gopher-webrtc.png"
                                alt={user.name}
                                class={`${styles.userImage} ${user.isSpeaking ? styles.speaking : styles.listening}`}
                            />
                            <div class={`${styles.statusIndicator} ${user.isSpeaking ? styles.speaking : styles.listening}`}>
                                {user.isSpeaking ? '🎤' : '👂'}
                            </div>
                        </div>
                        <span class={styles.userName}>{user.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
} 