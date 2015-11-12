'use strict';

/* eslint no-console: 0 */
const Picom = require('../');
const service = new Picom('pong');

service.expose({
	get: function (msg, reply) {
		console.log('Got Ping. Sent Pong');
		reply(null, {message: 'response from pong'});
	}
});

console.log('Pong is ready');
