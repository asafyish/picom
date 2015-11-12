'use strict';

const Promise = require('bluebird');
const nats = require('nats');

// Try-catch can deoptimize a function. So we have a function just for that
function tryParse(maybeJson) {
	try {
		return JSON.parse(maybeJson);
	} catch (err) {
		return null;
	}
}

function Picom(serviceName, options) {
	// TODO Maybe expose service name using define property as read only?
	this.serviceName = serviceName;

	// Ensure options is not null
	options = options || {};

	// Default timeout for all requests
	options.timeout = options.timeout || 30000;

	// Cheap cloning
	this.options = JSON.parse(JSON.stringify(options));

	// Tell nats the service name
	this.options.name = serviceName;
}

Picom.prototype.expose = function (methods) {

	this.connect();
	const nats = this.nats;
	const subjectName = this.serviceName + '.>';

	nats.subscribe(subjectName, {
		queue: this.serviceName
	}, function (requestString, replyTo, subject) {

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
			handler(msg, function sendResponse(error, payload) {

				// If error, send it back to caller
				if (error) {
					nats.publish(replyTo, JSON.stringify({
						error: error
					}));
				} else {

					// No error, send the payload back
					nats.publish(replyTo, JSON.stringify({
						payload: payload
					}));
				}
			});
		} else {

			// We got a queue message
			handler(msg);
		}
	});
};

Picom.prototype.request = function (methodName, message, options) {
	const nats = this.nats;

	// Ensure options is not null
	options = options || {};

	// Default options
	options.timeout = options.timeout || this.options.timeout;

	return new Promise(function (resolve, reject) {
		const sid = nats.request(methodName, JSON.stringify(message), function (responseString) {

			// Try parsing the string into a JSON
			const response = tryParse(responseString);

			// If json parsing failed and we indeed got a response string
			if (!response && responseString) {
				return reject('Bad JSON response');
			}

			if (response.error) {
				reject(response.error);
			} else {
				resolve(response.payload);
			}
		});

		nats.timeout(sid, options.timeout, 1, function () {
			reject('Request timed out');
		});
	});
};

// Publish jobs to a queue, without waiting for a response
Picom.prototype.publish = function (methodName, message) {
	const nats = this.nats;

	return new Promise(function (resolve, reject) {
		nats.publish(methodName, JSON.stringify(message), function (err) {
			if (err) {
				return reject(err);
			}

			resolve();
		});
	});
};

Picom.prototype.connect = function () {

	// Connect to nats if not already connected
	if (!this.nats) {
		this.nats = nats.connect(this.options);
	}
};

Picom.prototype.close = function () {
	this.nats.close();
};

module.exports = Picom;