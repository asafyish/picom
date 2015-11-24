'use strict';

const Promise = require('bluebird');
const nats = require('nats');
const isPlainObject = require('is-plain-object');

// Try-catch can deoptimize a function. So we have a function just for that
function tryParse(maybeJson) {
	try {
		return JSON.parse(maybeJson);
	} catch (err) {
		return null;
	}
}

function assignDefault(options, otherOptions, name, value) {
	options[name] = otherOptions[name] || value;
}

function Picom(serviceName, options) {
	// TODO Maybe expose service name using define property as read only?
	this.serviceName = serviceName;

	if (options && !isPlainObject(options)) {
		throw new Error('Options must be an object');
	}

	options = options || {};
	this.options = {};

	// Defaults
	assignDefault(this.options, options, 'timeout', 30000);
	assignDefault(this.options, options, 'servers', ['nats://127.0.0.1:4222']);

	// Tell nats the service name
	this.options.name = serviceName;
}

Picom.prototype.expose = function(methods) {

	this.connect();
	const nats = this.nats;
	const subjectName = this.serviceName + '.>';

	nats.subscribe(subjectName, {
		queue: this.serviceName
	}, function(requestString, replyTo, subject) {

		const methodName = subject.substr(subject.lastIndexOf('.') + 1);
		const handler = methods[methodName];

		// Check if the requested method is exposed
		if (!handler) {

			// If we can reply, send error back
			if (replyTo) {
				return nats.publish(replyTo, JSON.stringify({
					error: 'Method not found "' + methodName + '"'
				}));
			} else {
				return;
			}
		}

		// Use try-catch in other function, thus enabling V8 to optimize this entire function
		const msg = tryParse(requestString);

		// If json parsing failed and we indeed got a request string
		if (!msg && requestString) {

			// If we can reply, send error back
			if (replyTo) {
				return nats.publish(replyTo, JSON.stringify({
					error: 'Bad JSON request'
				}));
			} else {
				return;
			}
		}

		// If we have a replyTo, it means we got a request and we need to respond
		if (replyTo) {
			const maybePromise = handler(msg);

			if (!maybePromise || typeof maybePromise.then !== 'function' || typeof maybePromise.catch !== 'function') {
				throw new Error('Method "' + methodName + '" is not exposed as a promise');
			}

			maybePromise.
			then(function sendPayload(payload) {

				// Send the payload back
				nats.publish(replyTo, JSON.stringify({
					payload: payload
				}));
			}).
			catch(function sendError(error) {
				let message;

				if (error instanceof Error) {
					const stringifiedError = JSON.stringify(error);
					message = error.message;

					if (stringifiedError !== '{}') {
						message += ' ' + stringifiedError;
					}
				} else if (typeof error === 'string') {
					message = error;
				} else {
					message = JSON.stringify(error);
				}

				// Send an error back
				nats.publish(replyTo, JSON.stringify({
					error: message
				}));
			});
		} else {

			// We got a queue message
			handler(msg);
		}
	});
};

Picom.prototype.request = function(methodName, message, options) {
	const nats = this.nats;

	// Ensure options is not null
	options = options || {};

	// Default options
	options.timeout = options.timeout || this.options.timeout;

	return new Promise(function(resolve, reject) {
		const sid = nats.request(methodName, JSON.stringify(message), {
			max: 1
		}, function(responseString) {

			// Try parsing the string into a JSON
			const response = tryParse(responseString);

			// If json parsing failed and we indeed got a response string
			if (!response && responseString) {
				return reject(new Error('Bad JSON response'));
			}

			if (response.error) {
				reject(new Error(response.error));
			} else {
				resolve(response.payload);
			}
		});

		nats.timeout(sid, options.timeout, 1, function() {
			reject(new Error('Request ' + methodName + ' timed out'));
		});
	});
};

// Publish jobs to a queue, without waiting for a response
Picom.prototype.publish = function(methodName, message) {
	const nats = this.nats;

	return new Promise(function(resolve, reject) {
		nats.publish(methodName, JSON.stringify(message), function(err) {
			if (err) {
				return reject(err);
			}

			resolve();
		});
	});
};

Picom.prototype.connect = function() {

	// Connect to nats if not already connected
	if (!this.nats) {
		this.nats = nats.connect(this.options);
	}
};

Picom.prototype.close = function() {
	this.nats.close();
};

module.exports = Picom;
