'use strict';

let Picom = require('../');
let service = new Picom('ping');
service.start();

setTimeout(function() {
	console.log('Sending pong');

	service.fetch({
		service: 'pong',
		cmd: 'pong'
	}).then(function(response) {
		console.log('Got %s', response);
	});
}, 5000);
