'use strict';

let net = require('net');
let Polo = require('polo');
let polo = new Polo();
let through2 = require('through2');
let _ = require('highland');
let msgpack = require('msgpack');
let lengthPrefixedStream = require('length-prefixed-stream');
let RoundRobin = require('./roundrobin');
let availableServices = {};

// Add a service to the services repository
function onServiceUp(remotesServiceName, remoteServiceProperties) {

	if (!availableServices[remotesServiceName]) {
		availableServices[remotesServiceName] = new RoundRobin();
	}

	availableServices[remotesServiceName].push({
		host: remoteServiceProperties.host,
		port: remoteServiceProperties.port
	});
}

// Remove a service from the services repository
function onServiceDown(remoteServiceName, remoteServiceProperties) {

	if (availableServices[remoteServiceName]) {

		// Find the service index
		let index = availableServices[remoteServiceName].findIndex(function (service) {
			// We are matching the service by host and port
			return service.host === remoteServiceProperties.host && service.port === remoteServiceProperties.port;
		});

		// Remove it
		availableServices[remoteServiceName].splice(index, 1);
	}
}

function decodeStream() {
	// TODO use consume when https://github.com/caolan/highland/issues/265 is fixed
	return through2.obj(function (chunk, enc, callback) {
		try {
			//callback(null, JSON.parse(chunk.toString()));
			callback(null, msgpack.unpack(chunk));
		} catch (err) {
			callback(err);
		}
	});
}

function encodeStream() {
	// TODO use consume when https://github.com/caolan/highland/issues/265 is fixed
	return through2.obj(function (chunk, enc, callback) {
		//callback(null, JSON.stringify(chunk));
		callback(null, msgpack.pack(chunk));
	});
}

// Start listening for remote services
polo.on('up', onServiceUp);
polo.on('down', onServiceDown);

// We are load balancing between same service type
module.exports = function (localServiceName, options) {
	let methods = {};

	options = options || {};

	function stream(args, streamingPayload) {
		// Try round robin a service
		let remoteService = availableServices[args.service] ? availableServices[args.service].next() : null;
		if (!remoteService) {
			throw new Error('Invalid service name "' + args.service + '" or service is down.');
		}

		let socket = net.connect(remoteService,
			function () {
				// Create an out stream with all the necessary transformations
				let outStream = encodeStream();
				outStream.pipe(lengthPrefixedStream.encode()).pipe(this);

				// Write the command type
				outStream.write({
					cmd: args.cmd,
					args: args.args
				});

				// Write or stream the payload
				if (streamingPayload) {
					streamingPayload.pipe(outStream);
				}
			});

		// Return highland stream
		return _(socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(through2.obj(function (data, enc, callback) {
			if (data._type_ === 'error') {
				callback(new Error(data._message_));
				return;
			}

			callback(null, data);
		})));
	}

	function fetch(args, payload) {
		return new Promise(function (resolve, reject) {
			let s = stream(args, payload);
			s.on('error', function(err) {
				reject(err);
			});
			s.toArray(function(result) {
				if (args.multiple) {
					resolve(result);
				} else {
					if (result && result[0]) {
						resolve(result[0]);
					} else {
						resolve();
					}
				}
			});
		});
	}

	function expose(methodName, callback) {
		methods[methodName] = callback;
	}

	function start() {
		portPromise.then(function (value) {
			// Publish the service type and random port
			polo.put({
				name: localServiceName,
				port: value
			});

			process.on('exit', function () {
				polo.stop();
			});
		});
	}

	let server = net.createServer({allowHalfOpen: true}, function (socket) {

		let isFirstMessage = true;
		let inStream = _(encodeStream());
		let outStream = encodeStream();
		outStream.pipe(lengthPrefixedStream.encode()).pipe(socket);
		socket.on('close', function(hadError) {
			console.error('socket got closed', hadError);
			inStream.end();
		});
		socket.on('error', function(err) {
			console.error('socket error', err);
		});
		socket.
			pipe(lengthPrefixedStream.decode()).
			pipe(decodeStream()).
			pipe(through2.obj(function (data, enc, callback) {
				if (isFirstMessage) {
					isFirstMessage = false;
					let method = methods[data.cmd];

					if (method) {
						try {
							method(data.args, inStream, outStream);
							callback();
						} catch (err) {
							outStream.end({
								_type_: 'error',
								_message_: err.message
							});
							callback(err.message);
						}
					} else {
						outStream.end({
							_type_: 'error',
							_message_: localServiceName + ':' + data.cmd + ' Does not exist'
						});
						callback(localServiceName + ':' + data.cmd + ' Does not exist');
					}
				} else {
					callback(null, data);
				}
			})).
			pipe(inStream);
	});

	let portPromise = new Promise(function (resolve, reject) {
		// Start listening on a random port
		server.listen(function (err) {

			if (err) {
				return reject(err);
			}
			let address = server.address();
			resolve(address.port);
		});
	});

	portPromise.then(function () {
		if (options.autoStart) {
			start();
		}
	});

	return {
		stream: stream,
		fetch: fetch,
		expose: expose,
		start: start,
		_: _
	};
};
