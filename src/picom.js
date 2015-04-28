'use strict';

let net = require('net');
let domain = require('domain');
let Polo = require('polo');
let polo = new Polo({
	heartbeat: 10 * 60 * 1000
});
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
		this.push(msgpack.unpack(chunk));
		callback();
	});
}

function encodeStream(flushFunction) {
	return through2.obj(null, function (chunk, enc, callback) {
		this.push(msgpack.pack(chunk));
		callback();
	}, flushFunction);
}

// We are load balancing between same service type
module.exports = function (localServiceName, options) {
	let methods = {};

	options = options || {};

	function stream(args, streamPayload) {

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

				// Pipe the payload
				if (streamPayload && streamPayload.pipe) {
					streamPayload.pipe(outStream);
				}
			});

		return socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(through2.obj(function (data, enc, callback) {
			if (data._type_ === 'error') {
				callback(new Error(data._message_));
			} else if (data._type_ === 'end') {

				// Mark connection terminated correctly
				this.isEndSeen = true;

				// Close the connection, so the flush function will be called
				this.end();
				callback();
			} else {

				// Regular data, pipe it through
				this.push(data);
				callback();
			}
		}, function (callback) {
			if (this.isEndSeen) {
				return callback();
			}

			callback(new Error('Connection dropped by other side'));
		}));
	}

	function fetch(args, payload) {
		return new Promise(function (resolve, reject) {
			let response = [];
			let s = stream(args, payload);
			s.pipe(through2.obj(function (chunk, enc, callback) {
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
			}));
			s.once('error', function (err) {
				reject(err);
				//this.end();
			});
		});
	}

	function expose(methodName, callback) {
		methods[methodName] = callback;
	}

	function onConnection(socket) {

		let decode = decodeStream();

		let outStream = encodeStream();

		// Monkey patch the end method. Couldn't make all the tests pass without it
		outStream.originalEnd = outStream.end;
		outStream.end = function (chunk, enc, callback) {
			if (chunk) {
				this.write(chunk);
			}
			this.write({
				_type_: 'end'
			});
			outStream.end = outStream.originalEnd;
			outStream.end(null, enc, callback);
		};

		function transmitError(error, stream, socket) {
			let packet = {
				_type_: 'error'
			};

			if (error instanceof Error) {
				packet._message_ = error.message;
			} else {
				packet._message_ = error;
			}

			stream.end(packet);
			socket.end();
		}

		let errorHandler = domain.create();
		errorHandler.once('error', function (err) {

			// Inform the other side about the error and close the connection.
			transmitError(err, outStream, socket);
		});

		socket.on('error', function () {
			console.error('socket error');

			// In case of error, we need to manually close the socket
			this.end();
		});

		// OutStream encodes the data and pipe it to socket
		outStream.pipe(lengthPrefixedStream.encode()).pipe(socket);

		socket.
			pipe(lengthPrefixedStream.decode()).
			pipe(decode).
			pipe(through2.obj(function (data, enc, callback) {
				let method = methods[data.cmd];

				if (method) {
					// After parsing the header, remove this handler from processing any more work
					decode.unpipe(this);

					// Catch sync and async errors
					errorHandler.run(function () {
						let maybePromise = method(data.args, decode, outStream);

						if (maybePromise && maybePromise.catch) {
							maybePromise.catch(function (err) {
								transmitError(err, outStream, socket);
							});
						}
					});

					callback();
				} else {
					// Method not found
					outStream.end({
						_type_: 'error',
						_message_: localServiceName + ':' + data.cmd + ' Does not exist'
					});

					this.end();
				}
			}));
	}

	let server = net.createServer({allowHalfOpen: true}, onConnection);

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
