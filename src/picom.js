'use strict';

let net = require('net');
let Polo = require('polo');
let polo = new Polo();
let through2 = require('through2');
let msgpack = require('msgpack');
let lengthPrefixedStream = require('length-prefixed-stream');

function getNextService(remoteServiceName) {
	let allServices = polo.all();

	if (allServices && allServices[remoteServiceName]) {
		if (allServices[remoteServiceName].hasOwnProperty('index')) {
			if (allServices[remoteServiceName].index >= allServices[remoteServiceName].length) {
				allServices[remoteServiceName].index = 0;
			}
			return allServices[remoteServiceName][allServices[remoteServiceName].index++];
		} else {
			allServices[remoteServiceName].index = 0;
			return getNextService((remoteServiceName));
		}
	}
}

function decodeStream() {
	return through2.obj(function (chunk, enc, callback) {
		callback(null, msgpack.unpack(chunk));
	});
}

function encodeStream(flushFunction) {
	return through2.obj(null, function (chunk, enc, callback) {
		callback(null, msgpack.pack(chunk));
	}, flushFunction);
}

// We are load balancing between same service type
module.exports = function (localServiceName, options) {
	let methods = {};

	options = options || {};

	function stream(args, streamingPayload) {

		// Try round robin a service
		let remoteService = getNextService(args.service);
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
				if (streamingPayload && streamingPayload.pipe) {
					streamingPayload.pipe(outStream);
				}
			});

		let isConnectionTerminatedCorrectly = false;

		let newSocket = socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(through2.obj(function (data, enc, callback) {
			if (data._type_ === 'error') {
				return callback(new Error(data._message_));
			} else if (data._type_ === 'end') {

				// Mark connection terminated correctly
				isConnectionTerminatedCorrectly = true;
				return callback();
			}

			callback(null, data);
		}, function (callback) {
			if (isConnectionTerminatedCorrectly) {
				return callback();
			}

			callback(new Error('Connection droped'));
		}));

		return newSocket;
	}

	function fetch(args, payload) {
		return new Promise(function (resolve, reject) {
			let response = [];
			stream(args, payload).
				pipe(through2.obj(function (chunk, enc, callback) {
					response.push(chunk);
					callback();
				}, function (callback) {
					if (args.multiple) {
						resolve(response);
					} else {
						if (response.length > 0) {
							resolve(response[0]);
						} else {
							resolve();
						}
					}
					callback();
				})).
				on('error', reject);
		});
	}

	function expose(methodName, callback) {
		methods[methodName] = callback;
	}

	let server = net.createServer({allowHalfOpen: true}, function (socket) {

		let isFirstMessage = true;
		let inStream = through2.obj(function (chunk, enc, callback) {
			callback(null, chunk);
		});

		// If we reach the flush function, it means everything went ok - send the end marker
		let outStream = encodeStream(function (callback) {
			this.write({
				_type_: 'end'
			});
			callback();
		});

		// Outstream encodes the data and pipe it to socket
		outStream.pipe(lengthPrefixedStream.encode()).pipe(socket);

		socket.on('close', function () {
			inStream.destroy();
		});
		socket.on('error', function () {
			inStream.destroy();
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
						}
					} else {
						outStream.end({
							_type_: 'error',
							_message_: localServiceName + ':' + data.cmd + ' Does not exist'
						});
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

	portPromise.then(function () {
		if (options.autoStart) {
			start();
		}
	});

	return {
		stream: stream,
		fetch: fetch,
		expose: expose,
		start: start
	};
};
