'use strict';

let net = require('net');
let Polo = require('polo');
let polo = new Polo();
let through2 = require('through2');
let _ = require('highland');
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

		// Return highland stream
		return _(socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(through2.obj(function (data, enc, callback) {
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
		})));
	}

	function fetch(args, payload) {
		return new Promise(function (resolve, reject) {
			let s = stream(args, payload);
			s.on('error', reject);
			s.toArray(function (result) {
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

		socket.on('close', function (hadError) {
			inStream.destroy();
		});
		socket.on('error', function (err) {
			inStream.destroy();
		});

		let realEnd = outStream.end;

		// Monkey patching stream
		// TODO Called twice for some odd reason
		outStream.end = function (data, encoding, callback) {
			if (data) {
				outStream.write(data, encoding);
			}

			outStream.write({
				_type_: 'end'
			});

			realEnd.call(outStream, undefined, undefined, callback);
			outStream.end = function () {
			};
		};

		socket.
			pipe(lengthPrefixedStream.decode()).
			pipe(decodeStream()).
			pipe(through2.obj(function (data, enc, callback) {
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
		start: start,
		_: _
	};
};
