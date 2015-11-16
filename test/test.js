'use strict';

/* global describe, before, it */

// Mocha setup
var chai = require('chai');
var Promise = require('bluebird');
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
			'method-1': function (msg) {
				return new Promise(function (resolve, reject) {
					resolve({
						hello: 'method-1'
					});
				});
			},
			'not-a-promise': function (msg) {
			},
			'never-reply': function () {
				// Should timeout
				return new Promise(function () {

				});
			},
			'text-response': function (msg) {
				return new Promise(function (resolve) {
					resolve('text response');
				})
			},
			'throws-a-string': function () {
				return new Promise(function () {
					throw 'Something is not right';
				});
			},
			'throws-an-object': function () {
				return new Promise(function () {
					throw {message: 'not good'};
				});
			},
			'queue-method': function () {
			}
		});

		service2.expose({
			'method-2': function (msg) {
				return new Promise(function (resolve, reject) {
					resolve({
						hello: 'method-2'
					});
				});
			},
			'error-out': function (msg) {
				return new Promise(function (resolve, reject) {
					reject('something bad happened');
				});
			},
			'reply-null': function (msg) {
				return new Promise(function (resolve) {
					resolve();
				});
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

	it('should catch a throwed exception', function (done) {
		service2.
			request('service1.throws-a-string').
			catch(function (err) {

				expect(err.message).to.equal('Something is not right');

				done();
			});
	});

	it('show catch a throwed object from the other service', function (done) {
		service2.
			request('service1.throws-an-object').
			catch(function (err) {
				expect(JSON.parse(err.message)).to.deep.equal({message: 'not good'});
				done();
			})
	});

	it('should catch a reject from the other service', function (done) {
		service1.
			request('service2.error-out').
			catch(function (err) {
				expect(err.message).to.deep.equal('something bad happened');
				done();
			});
	});

	it('should disconnect service 1', function (done) {
		service1.close();
		done();
	});

	it('should fail to send a request from service1 since its disconnected', function (done) {
		service1.
			request('service2.method-2').
			catch(function (err) {
				done();
			});
	});

	it('should fail to publish from service1 since its disconnected', function (done) {
		service1.
			publish('service2.method-2').
			catch(function (err) {
				done();
			});
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
