import styles from './App.module.css';
import Room from './yap/Room';

function App() {
  return (
    <div class={styles.App}>
      <header class={styles.header}>
        <h1>This is notspaces</h1>
        <h2>
          You can speak, but don't yap too much.
        </h2>
      </header>
      <main class={styles.main}>
        <Room />
      </main>
    </div>
  );
}

export default App;
