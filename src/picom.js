'use strict';

const net = require('net');
const domain = require('domain');
const Consul = require('consul');
const through2 = require('through2');
const msgpack = require('msgpack5')();
const lengthPrefixedStream = require('length-prefixed-stream');
const pipe = require('multipipe');

// Register date type
msgpack.register(0x42, Date, encodeDate, decodeDate);

function encodeDate(date) {
	let buf = new Buffer(8);
	buf.writeDoubleLE(date.getTime());
	return buf;
}

function decodeDate(buf) {
	return new Date(buf.readDoubleLE(0));
}

let roundRobin = {};

function decodeStream() {
	return pipe(lengthPrefixedStream.decode(), msgpack.decoder());
}

function encodeStream() {
	return pipe(msgpack.encoder(), lengthPrefixedStream.encode());
}

let Picom = function (serviceName, options) {
	this.serviceName = serviceName;
	this.serviceId = '';
	this.methods = {};
	this.server = null;
	options = options || {};

	this.options = {
		ttl: options.ttl ? options.ttl : 30,
		retries: options.retries ? options.retries : 3,
		port: options.port ? options.port : 0
	};

	this.consul = new Consul({
		host: options.consulHost || '127.0.0.1',
		port: options.consulPort || 8500
	});
};

Picom.prototype.stream = function (service, args, streamPayload) {

	if (args && args.pipe && !args.hasOwnProperty('pipe')) {
		streamPayload = args;
		args = null;
	}

	let self = this;
	let retries = self.options.retries;

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

	function streamError(err) {
		pipedStream.emit('error', err);
	}

	function streamData(remoteService) {
		if (!remoteService) {
			pipedStream.emit('error', new Error('The service "' + service.service + '" is down'));
			return;
		}

		let connection = net.connect({host: remoteService.host, port: remoteService.port});

		connection.once('error', function (err) {

			// If connection failed, retry
			if (err.code === 'ECONNREFUSED' && retries > 0) {
				retries--;
				self.getNextService(service.service).then(streamData).catch(streamError);
			} else {

				// We reached maximum number of retries
				pipedStream.emit('error', err);
			}
		});

		connection.once('connect', function () {
			// Create an out stream with all the necessary transformations
			let outStream = encodeStream();

			// Stream through the socket
			outStream.pipe(this);

			// Write the header
			outStream.write({
				cmd: service.cmd,
				args: args
			});

			// Stream the payload
			if (streamPayload && streamPayload.pipe) {
				streamPayload.pipe(outStream);
			}

			// Read from the socket
			this.pipe(pipedStream);
		});
	}

	// Try round robin a service
	this.getNextService(service.service).then(streamData).catch(streamError);

	return pipedStream;
};

Picom.prototype.fetch = function (service, args, streamPayload) {
	let self = this;
	return new Promise(function (resolve, reject) {
		let response = [];

		if (args && args.pipe && !args.hasOwnProperty('pipe')) {
			streamPayload = args;
			args = null;
		}

		let s = self.stream(service, args, streamPayload);

		s.once('error', function (err) {
			reject(err);
		});

		s.pipe(through2.obj(function (chunk, enc, callback) {
			response.push(chunk);
			callback();
		}, function (callback) {
			if (service.multiple) {
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
	});
};

Picom.prototype.expose = function (methods) {

	if (this.server) {
		throw new Error('Service already started');
	}

	let self = this;
	let server = net.createServer({allowHalfOpen: true}, this.onConnection.bind(this));

	this.server = server.listen(self.options.port, function (listenError) {

		// TODO Check if err works
		if (listenError) {
			throw listenError;
		}
		let address = server.address();
		self.serviceId = self.serviceName + '-' + address.port;
		let checkId = 'check:' + self.serviceId;

		// Register the service to consul
		self.consul.agent.service.register({
			id: self.serviceId,
			name: self.serviceName,
			port: address.port
		}, function (registerError) {
			if (registerError) {
				throw registerError;
			}

			// Register a check
			self.consul.agent.check.register({
				name: 'check:' + self.serviceId,
				id: checkId,
				serviceid: self.serviceId,
				ttl: self.options.ttl + 's'
			}, function (checkError) {

				// If the service terminated before this callback was called
				if (!self.server) {
					return;
				}

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
			packet._message_ = '[' + self.serviceName + '] ' + error.message;
		} else {
			packet._message_ = '[' + self.serviceName + '] ' + error;
		}

		stream.end(packet);
		socket.end();
	}

	let errorHandler = domain.create();
	errorHandler.once('error', function (err) {

		// Inform the other side about the error and close the connection.
		transmitError(err, outStream, socket);
	});

	socket.once('error', function () {

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
			process.nextTick(function () {

				// If we call resolve directly (without nextTick) then the request is not yet over,
				// which can cause some weird errors
				resolve({
					host: services[roundRobin[remoteServiceName]].Node.Address,
					port: services[roundRobin[remoteServiceName]].Service.Port
				});

				// Increment to next service
				roundRobin[remoteServiceName]++;
			});
		});
	});
};

Picom.prototype.close = function () {
	let self = this;

	return new Promise(function (resolve, reject) {

		// Notify consul we are not accepting new connections
		self.consul.agent.service.deregister({id: self.serviceId}, function (err) {
			if (err) {
				return reject(err);
			}

			// Gracefully stop the server, while waiting for existing connections to terminate
			self.server.close(function () {
				self.server = null;
				resolve();
			});
		});
	});
};

module.exports = Picom;
