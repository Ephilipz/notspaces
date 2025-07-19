/* @refresh reload */
import { render } from 'solid-js/web';
import { Router, Route } from "@solidjs/router";
import './index.css';
import App from './App';
import Home from './Home';
import Room from './yap/Room';

function Routes() {
	return (
		<Router root={App}>
			<Route path="/" component={Home} />
			<Route path="/room" component={Room} />
		</Router>
	)
}

render(() => <Routes />, document.getElementById("root"));
