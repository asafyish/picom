'use strict';

const net = require('net');
const domain = require('domain');
const Consul = require('consul');
const through2 = require('through2');
const msgpack = require('msgpack5')();
const lengthPrefixedStream = require('length-prefixed-stream');
const pipe = require('multipipe');

let roundRobin = {};

function decodeStream() {
	return pipe(lengthPrefixedStream.decode(), msgpack.decoder());
}

function encodeStream() {
	return pipe(msgpack.encoder(), lengthPrefixedStream.encode());
}

let Picom = function (serviceName, options) {
	this.serviceName = serviceName;
	this.methods = {};
	this.server = null;
	options = options || {};

	this.options = {
		ttl: options.ttl ? options.ttl : 30
	};

	this.consul = new Consul({
		host: options.consulHost || '127.0.0.1',
		port: options.consulPort || 8500
	});
};

Picom.prototype.stream = function (args, streamPayload) {
	let pipedStream = pipe(decodeStream(), through2.obj(function (data, enc, callback) {
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

	// Try round robin a service
	this.getNextService(args.service).then(function (remoteService) {
		if (!remoteService) {
			pipedStream.emit('error', new Error('The service "' + args.service + '" is down'));
		}

		let connection = net.connect({host: remoteService.host, port: remoteService.port});
		connection.once('error', function (err) {
			pipedStream.emit(err);
		});
		connection.once('connect', function () {
			// Create an out stream with all the necessary transformations
			let outStream = encodeStream();
			outStream.pipe(this);

			// Write the command type
			outStream.write({
				cmd: args.cmd,
				args: args.args
			});

			// Pipe the payload
			if (streamPayload && streamPayload.pipe) {
				streamPayload.pipe(outStream);
			}

			this.pipe(pipedStream);
		});
	});

	return pipedStream;
};

Picom.prototype.fetch = function (args, streamPayload) {
	let self = this;
	return new Promise(function (resolve, reject) {
		let response = [];
		let s = self.stream(args, streamPayload);
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
		});
	});
};

Picom.prototype.expose = function (methods) {

	if (this.server) {
		throw new Error('Service already started');
	}

	let self = this;
	let server = net.createServer({allowHalfOpen: true}, this.onConnection.bind(this));

	this.server = server.listen(function (listenError) {

		// TODO Check if err works
		if (listenError) {
			throw listenError;
		}
		let address = server.address();
		let serviceId = self.serviceName + '-' + address.port;
		let checkId = 'check:' + serviceId;

		// Register the service to consul
		self.consul.agent.service.register({id: serviceId, name: self.serviceName, port: address.port}, function (registerError) {
			if (registerError) {
				throw registerError;
			}

			// Register a check
			self.consul.agent.check.register({
				name: 'check:' + serviceId,
				id: checkId,
				serviceid: serviceId,
				ttl: self.options.ttl + 's'
			}, function (checkError) {
				if (checkError) {
					throw checkError;
				}

				// Immediately after registering a check - pass it
				self.consul.agent.check.pass({id: checkId}, function () {
					// Ignore error
				});

				// Every 80% of ttl, pass the check
				setInterval(function () {
					self.consul.agent.check.pass({id: checkId}, function () {
					});
				}, parseInt(self.options.ttl * 0.8) * 1000).unref();
			});

			self.methods = methods;
		});
	});
};

Picom.prototype.onConnection = function (socket) {

	let self = this;
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

		// In case of error, we need to manually close the socket
		this.end();
	});

	// OutStream encodes the data and pipe it to socket
	outStream.pipe(socket);

	socket.
		pipe(decode).
		pipe(through2.obj(function (data, enc, callback) {
			let method = self.methods[data.cmd];

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
					_message_: self.serviceName + ':' + data.cmd + ' Does not exist'
				});

				this.end();
			}
		}));
};

Picom.prototype.getNextService = function (remoteServiceName) {
	let self = this;

	return new Promise(function (resolve, reject) {
		self.consul.health.service({service: remoteServiceName, passing: true}, function (err, services) {
			if (err) {
				return reject(err);
			}

			// Empty services found is a valid state
			if (services.length === 0) {
				return resolve();
			}

			// is relatively small memory footprint
			// Store a round-robin index for each service
			if (!roundRobin[remoteServiceName]) {
				roundRobin[remoteServiceName] = 0;
			}

			// If round-robin index is out of bounds
			if (services.length <= roundRobin[remoteServiceName]) {
				roundRobin[remoteServiceName] = 0;
			}

			// Return the service and increment the round-robin index
			resolve({
				host: services[roundRobin[remoteServiceName]].Node.Address,
				port: services[roundRobin[remoteServiceName]].Service.Port
			});

			// Incrment to next service
			roundRobin[remoteServiceName]++;
		});
	});
};

module.exports = Picom;
