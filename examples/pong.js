'use strict';

let Picom = require('../');
let service = new Picom('pong');

console.log('Pong is ready');
service.expose('pong', function(args, inStream, outStream) {
	console.log('Got Ping. Sent Pong');
	outStream.end('PONG');
});
service.start();
