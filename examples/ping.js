'use strict';

/* eslint no-console: 0 */
const Picom = require('../');
const service = new Picom('ping');

// We need to call start because we are not using expose
service.connect();

// Wait a few seconds till we are connected to local nats
setTimeout(function () {
	console.log('Sending ping');

	service.request('pong.get', {message: 'request from ping'}).
		then(function (response) {
			console.log('Got %s', JSON.stringify(response));
		});
}, 200);
