'use strict';

/* global describe, before, it */

// Mocha setup
var chai = require('chai');
var expect = chai.expect;

var Picom = require('../');

describe('picom', function () {
	var service1 = new Picom('service1');
	var service2 = new Picom('service2');
	var shortFuse = new Picom('shortFuse', {
		timeout: 1000
	});

	before(function (done) {
		service1.expose({
			'method-1': function (msg, reply) {
				reply(null, {
					hello: 'method-1'
				});
			},
			'never-reply': function () {
				// Should timeout
			},
			'text-response': function (msg, reply) {
				reply(null, 'text response');
			},
			'queue-method': function () {
			}
		});

		service2.expose({
			'method-2': function (msg, reply) {
				reply(null, {
					hello: 'method-2'
				});
			},
			'erorr-out': function (msg, reply) {
				reply({message: 'something bad happened'});
			},
			'reply-null': function (msg, reply) {
				reply();
			}
		});

		// Give the services a chance to connect
		setTimeout(done, 500);
	});

	it('should fail creating picom with invalid options', function (done) {
		try {
			/* eslint no-new: 0 */
			new Picom('wontWork', 'aaaaa');
		} catch (err) {
			done();
		}
	});

	it('should send a request with payload from service1 to service2', function (done) {
		service1.
			request('service2.method-2', {
				hello: 'from service1'
			}).
			then(function (response) {

				expect(response).to.deep.equal({
					hello: 'method-2'
				});

				done();
			}).
			catch(done);
	});

	it('should send a request without payload from service1 to service2', function (done) {
		service1.
			request('service2.method-2').
			then(function (response) {

				expect(response).to.deep.equal({
					hello: 'method-2'
				});

				done();
			}).
			catch(done);
	});

	it('should send a request with a 1 second timeout', function (done) {

		// Set timeout slightly larger then the request timeout
		this.timeout(1200);

		service2.
			request('service1.never-reply', {
				msg: 'aaa'
			}, {
				timeout: 1000
			}).
			catch(function () {
				done();
			});
	});

	it('should send a request using a short-fuse service', function (done) {

		// Set timeout slightly larger then the request timeout
		this.timeout(1200);

		shortFuse.
			request('service1.never-reply', {
				msg: 'aaa'
			}).
			catch(function () {
				done();
			});
	});

	it('should queue with a payload for service1', function (done) {
		service2.
			publish('service1.queue-method', {
				msg: 'hello'
			}).
			then(done).
			catch(done);
	});

	it('should queue without a payload for service1', function (done) {
		service2.
			publish('service1.queue-method').
			then(done).
			catch(done);
	});

	it('should send a request and get null reply', function (done) {
		service1.
			request('service2.reply-null').
			then(function (msg) {

				/* eslint no-unused-expressions: 0 */
				expect(msg).to.be.undefined;

				done();
			}).
			catch(done);
	});

	it('should get a bad response', function (done) {
		service2.
			request('service1.text-response', 'sending text').
			then(function (msg) {
				expect(msg).to.equal('text response');
				done();
			});
	});

	it('should get an error message from a method on the other service', function (done) {
		service1.
			request('service2.erorr-out').
			catch(function (err) {
				expect(err).to.deep.equal({message: 'something bad happened'});
				done();
			});
	});

	it('should disconnect service 1', function (done) {
		service1.close();
		done();
	});

	it('should fail messaging service 1 because it was disconnected', function (done) {
		// Set timeout slightly larger then the request timeout
		this.timeout(1200);

		shortFuse.request('service1.method-1').
			catch(function () {
				done();
			});
	});
});
