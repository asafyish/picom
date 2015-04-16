'use strict';

let net = require('net');
let Polo = require('polo');
let polo = new Polo();
//let through2 = require('through2');
let transform = require('stream-transform');
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
	return transform(function (chunk, callback) {
		try {
			callback(null, msgpack.unpack(chunk));
		} catch (err) {
			callback(err);
		}
	});
}

function encodeStream(flushFunction) {
	return transform(function (chunk, callback) {
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
				if (streamingPayload) {
					streamingPayload.pipe(outStream);
				}
			});

		let isConnectionTerminatedCorrectly = false;

		let newSocket = socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(transform(function (data, callback) {
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
		// Return "plain" socket
		if (args.noWrapping) {
			return newSocket;
		}

		// Return highland stream
		return _(newSocket);
	}

	function fetch(args, payload) {
		return new Promise(function (resolve, reject) {
			let arr = [];
			args.noWrapping = true;
			let s = stream(args, payload);
			s.on('error', reject);
			s.pipe(transform(function (chunk, callback) {
				arr.push(chunk);
				callback();
			}, function (callback) {
				if (args.multiple) {
					resolve(arr);
				} else {
					if (arr && arr[0]) {
						resolve(arr[0]);
					} else {
						resolve();
					}
				}
				callback();
			}));
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
		let inStream = encodeStream();

		// If we reach the flush function, it means everything went ok - send the end marker
		let outStream = encodeStream(function (callback) {
			this.end({
				_type_: 'end'
			});
			callback();
		});

		// Outstream encodes the data and pipe it to socket
		outStream.pipe(lengthPrefixedStream.encode()).pipe(socket);

		socket.on('close', function (hadError) {
			inStream.destroy();
		});
		socket.on('error', function (err) {
			inStream.destroy();
		});

		socket.
			pipe(lengthPrefixedStream.decode()).
			pipe(decodeStream()).
			pipe(transform(function (data, callback) {
				if (isFirstMessage) {
					isFirstMessage = false;
					let method = methods[data.cmd];

					if (method) {
						try {
							let result = method(data.args, inStream, outStream);
							if (result && result.then && result.catch) {
								result.
									then(function () {
										callback();
									}).catch(function (err) {
										outStream.end({
											_type_: 'error',
											_message_: err.message
										});
									});
							} else {
								callback();
							}
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
