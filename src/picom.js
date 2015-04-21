'use strict';

let net = require('net');
let domain = require('domain');
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

		let isConnectionTerminatedCorrectly = false;

		return socket.pipe(lengthPrefixedStream.decode()).pipe(decodeStream()).pipe(through2.obj(function (data, enc, callback) {
			if (data._type_ === 'error') {
				callback(new Error(data._message_));
			} else if (data._type_ === 'end') {

				// Mark connection terminated correctly
				isConnectionTerminatedCorrectly = true;

				// Close the connection, so the flush function will be called
				this.end();
				callback();
			} else {

				// Regular data, pipe it through
				this.push(data);
				callback();
			}
		}, function (callback) {
			if (isConnectionTerminatedCorrectly) {
				return callback();
			}

			callback(new Error('Connection dropped'));
		}));
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
				on('error', function (err) {
					this.end();
					reject(err);
				});
		});
	}

	function expose(methodName, callback) {
		methods[methodName] = callback;
	}

	let server = net.createServer({allowHalfOpen: true}, function (socket) {

		let decode = decodeStream();

		// If we reach the flush function, it means everything went ok - send the end marker
		let outStream = encodeStream(function (callback) {
			this.end({
				_type_: 'end'
			});
			try {
				// Most of the times it works, but when streaming big data, it crashes
				callback();
			} catch (err) {
				console.error(err);
			}
		});

		let errorHandler = domain.create();
		errorHandler.on('error', function (err) {

			// Inform the other side about the error and close the connection.
			outStream.end({
				_type_: 'error',
				_message_: err.message
			});

			socket.end();
		});

		outStream.on('end', function () {
			console.log('outStream end: %s', outStream.cmd);
		});

		socket.on('error', function () {
			console.error('socket error');

			// Incase of error, we need to manually close the socket
			this.end();
		});

		// Outstream encodes the data and pipe it to socket
		outStream.pipe(lengthPrefixedStream.encode()).pipe(socket);

		socket.
			pipe(lengthPrefixedStream.decode()).
			pipe(decode).
			pipe(through2.obj(function (data, enc, callback) {
				let method = methods[data.cmd];

				if (method) {
					outStream.cmd = data.cmd;

					// After parsing the header, remove this handler from processing
					decode.unpipe(this);

					// Catch sync and async errors
					errorHandler.run(function () {
						method(data.args, decode, outStream);
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
