'use strict';

// Mocha setup
var chai = require('chai');
var expect = chai.expect;
var _ = require('highland');

var Picom = require('../');

describe('picom', function () {
	var service1 = new Picom('service1');
	var service2 = new Picom('service2');
	var service3 = new Picom('service3', {autoStart: true});
	var roundRobinA = new Picom('round');
	var roundRobinB = new Picom('round');
	var REQUEST_ERROR = 'Function throws an error over the wire';

	before(function () {
		service1.expose('method1-service1', function (args, inStream, outStream) {
			outStream.end('method1-service1-reply');
		});
		service1.expose('wait', function (args, inStream, outStream) {
			setTimeout(function () {
				outStream.end('done');
			}, args.timeout);
		});

		service1.expose('add', function (args, inStream, outStream) {
			outStream.end(args.a + args.b);
		});
		service1.expose('echo', function (args, inStream, outStream) {
			outStream.end(args.text);
		});

		service1.expose('streamEcho', function (args, inStream, outStream) {
			inStream.pipe(outStream);
		});

		service1.expose('never-reply', function () {
			// Empty on purpose
		});
		service2.expose('method1-service2', function (args, inStream, outStream) {
			outStream.end('method1-service2-reply');
		});
		service2.expose('streamEchoNext', function (args, inStream, outStream) {
			service2.stream({
				service: 'service1',
				cmd: 'streamEcho',
				args: args
			}, inStream).pipe(outStream);
		});
		service2.expose('emptyResponse', function (args, inStream, outStream) {
			service2.fetch({
				service: 'service1',
				cmd: 'streamEcho',
				args: args
			}, inStream).then(function (data) {
				outStream.end();
			});
		});

		service2.expose('add-and-multiple', function (args, inStream, outStream) {
			service2.stream({
				service: 'service1',
				cmd: 'add',
				args: args
			}).pull(function (innerErr, response) {
				outStream.end(response * args.c);
			});
		});
		service2.expose('method2-service2', function (args, inStream, outStream) {
			service2.stream({
				service: 'service1',
				cmd: 'method1-service1'
			}, inStream).pipe(outStream);
		});
		service2.expose('throws', function () {
			throw new Error(REQUEST_ERROR);
		});
		roundRobinA.expose('name', function (args, inStream, outStream) {
			outStream.end('round robin A');
		});

		roundRobinB.expose('name', function (args, inStream, outStream) {
			outStream.end('round robin B');
		});

		service1.start();
		service2.start();
		roundRobinA.start();
		roundRobinB.start();
	});

	describe('messaging', function () {

		it('should call method1-service1 and get a reply', function (done) {
			service2.stream({
				service: 'service1',
				cmd: 'method1-service1'
			}).pull(function (err, response) {
				expect(response).to.equal('method1-service1-reply');
				done(err);
			});
		});

		it('should call add and get a reply', function (done) {
			service2.stream({
				service: 'service1',
				cmd: 'add',
				args: {a: 2, b: 3}
			}).pull(function (err, response) {
				expect(response).to.equal(5);
				done(err);
			});
		});

		it('should call add-and-multiple which calls other service and get a reply', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'add-and-multiple',
				args: {a: 2, b: 3, c: 10}
			}).pull(function (err, response) {
				expect(response).to.equal(50);
				done(err);
			});
		});

		it('should call service 2 from service 3', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'method1-service2'
			}).pull(function (err, response) {
				expect(response).to.equal('method1-service2-reply');
				done(err);
			});
		});

		it('should call service 2 from service 3 using promise api', function (done) {
			service3.fetch({
				service: 'service2',
				cmd: 'method1-service2'
			}).then(function (response) {
				expect(response).to.equal('method1-service2-reply');
				done();
			}).catch(done);
		});

		it.skip('should call a service using promise api and catch an error', function (done) {
			service3.fetch({
				service: 'service2',
				cmd: 'throws'
			}).catch(function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should call service which in turn calls other service', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'method2-service2'
			}).pull(function (err, response) {
				expect(response).to.equal('method1-service1-reply');
				done(err);
			});
		});

		it('should call service with a stream payload', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, payload).toArray(function (response) {
				expect(response).to.deep.equal(arr);
				done();
			});
		});

		it('should stream a stream through 2 services and get a reply', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);

			service3.stream({
				service: 'service2',
				cmd: 'streamEchoNext'
			}, payload).toArray(function (response) {
				expect(response).to.deep.equal(arr);
				done();
			});
		});

		it('should stream a stream through 2 services and get an empty reply', function (done) {
			let arr = [1];
			let payload = _(arr);

			service3.fetch({
				service: 'service2',
				cmd: 'emptyResponse'
			}, payload).then(function (response) {
				expect(response).to.be.undefined;
				done();
			}).catch(done);
		});

		it('should call using the promise api and get a reply', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);
			service3.fetch({
				service: 'service1',
				cmd: 'streamEcho',
				multiple: true
			}, payload).then(function (response) {
				expect(response).to.deep.equal(arr);
				done();
			}).catch(done);
		});

		it('should call wait for fetch to complete', function (done) {
			let timeout = 5000;
			let isOk = false;

			this.timeout(timeout * 2);

			service3.fetch({
				service: 'service1',
				cmd: 'wait',
				args: {
					timeout: timeout
				}
			}).then(function (response) {
				expect(response).to.equal('done');
				expect(isOk).to.equal(true);
				done();
			}).catch(done);

			// When enough time passed - signal everything is ok
			setTimeout(function () {
				isOk = true;
			}, timeout - 100);
		});

		it('should call with a large stream as payload', function (done) {
			let arr = [];

			for (let i = 0; i < 5000; i++) {
				arr.push({index: i});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, payload).toArray(function (response) {
				expect(response).to.deep.equal(arr);
				done();
			});
		});

		it('should call with a large generated stream as payload', function (done) {
			this.timeout(0);
			let SIZE = 2;
			let index = 0;
			let stream = _(function (push, next) {
				if (index >= SIZE) {
					return push(null, service1._.nil);
				}
				push(null, index++);
				next();
			});

			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, stream).toArray(function (response) {
				expect(response.length).to.equal(SIZE);
				done();
			});
		});

		it('should call wait for fetch to complete with a stream parameter', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);
			let timeout = 5000;
			let isOk = false;

			this.timeout(timeout * 2);

			service3.fetch({
				service: 'service1',
				cmd: 'wait',
				args: {
					timeout: timeout
				}
			}, payload).then(function (response) {
				expect(response).to.equal('done');
				expect(isOk).to.equal(true);
				done();
			}).catch(done);

			// When enough time passed - signal everything is ok
			setTimeout(function () {
				isOk = true;
			}, timeout - 100);
		});


		it('should call service 1 from service 2 with multiple echo asynchronous calls', function (done) {
			let requests = [];
			let responses = [];
			for (let i = 0; i < 50; i++) {
				requests.push(service2.stream({
					service: 'service1',
					cmd: 'echo',
					args: {text: '' + i}
				}));
				responses.push('' + i);
			}
			_.merge(requests).toArray(function (combined) {
				expect(combined).to.deep.equals(responses);
				done();
			});
		});

		it('should call service 2 from service 3 with multiple asynchronous calls', function (done) {
			let requests = [];
			let responses = [];
			for (let i = 0; i < 50; i++) {
				requests.push(service3.stream({
					service: 'service2',
					cmd: 'method1-service2'
				}));
				responses.push('method1-service2-reply');
			}
			_.merge(requests).toArray(function (combined) {
				expect(combined).to.deep.equals(responses);
				done();
			});
		});

		it('should receive error parameter on call to invalid cmd', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'not-real'
			}).pull(function (err) {
				expect(err.message).to.equal('service2:not-real Does not exist');
				done();
			});
		});

		it('should throw on call to invalid service', function (done) {
			try {
				service3.stream({
					service: 'service5',
					cmd: 'not-real'
				});
			} catch (err) {
				done();
			}
		});

		it('should get a failed response from service', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'throws'
			}).pull(function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should round robin between 2 services', function (done) {
			service1.fetch({
				service: 'round',
				cmd: 'name'
			}).then(function (name) {
				expect(name).to.equal('round robin A');

				return service1.fetch({
					service: 'round',
					cmd: 'name'
				}).then(function (name) {
					expect(name).to.equal('round robin B');

					return service1.fetch({
						service: 'round',
						cmd: 'name'
					}).then(function (name) {
						expect(name).to.equal('round robin A');
						done();
					});
				});
			}).catch(done);
		});

		it.skip('should stop a service and check if we can still reach it', function (done) {
			service2.stream({
				service: 'service1',
				cmd: 'never-reply'
			}).pull(function (err) {
				expect(err).to.equal('service2:not-real Does not exist');
				done();
			});
		});

		it.skip('should timeout', function (done) {
			service2.stream({
				service: 'service1',
				cmd: 'never-reply'
			}).pull(function (err) {
				expect(err).to.equal('service2:not-real Does not exist');
				done();
			});
		});
	});
});
