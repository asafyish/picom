'use strict';

// Mocha setup
var chai = require('chai');
var fs = require('fs');
var expect = chai.expect;
var _ = require('highland');
var through = require('through2');
var Promise = require('bluebird');

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

		service1.expose('ignore', function (args, inStream, outStream) {
			_(inStream).batch(5000).consume(function (err, x, push, next) {
				if (err) {
					push(err);
					next();
				}
				else if (x === _.nil) {
					// pass nil (end event) along the stream
					push(null, x);
					outStream.end();
				}
				else {
					console.log('chunk');
					setTimeout(function() {
						next();
					}, 1000);
				}
			}).resume();
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

		service1.expose('streamEchoMultiply', function(args, inStream, outStream) {
			let arr = [];
			let size = parseInt(args.size * args.multiply);

			for (let i = 0; i <= size; i++) {
				arr.push({index: i, irjdjem4fk: 'akkejkjkrjekjr', almfjtl4: 23984934, kfkenrk5: 'mmakkucudhneje749'});
			}

			let payload = _(arr);

			// Drain inStream
			inStream.pipe(through.obj(function(chunk, enc, callback) {
				callback();
			}));
			payload.pipe(outStream);
		});
		service1.expose('never-reply', function () {
			// Empty on purpose
		});

		service1.expose('async-fail', Promise.coroutine(function*(args, inStream, outStream) {
			setTimeout(function() {
				throw new Error(REQUEST_ERROR);
			}, 1000);
		}));

		service1.expose('promise-yield-fetch', Promise.coroutine(function*(args, inStream, outStream) {
			let response = yield service2.fetch({
				service: 'service1',
				cmd: 'streamEcho',
				multiple: true
			}, inStream);

			outStream.end(response);
		}));
		service1.expose('promise-stream', Promise.coroutine(function*(args, inStream, outStream) {
			service1.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, inStream).pipe(through.obj(function (chunk, enc, callback) {
				callback(null, chunk);
			})).pipe(outStream);
		}));
		service1.expose('promise', Promise.coroutine(function*(args, inStream, outStream) {
			service1.fetch({
				service: 'service1',
				cmd: 'streamEcho',
				multiple: true
			}, inStream).then(function (response) {
				outStream.end(response);
			});
		}));

		service1.expose('promise-reject', Promise.coroutine(function*(args, inStream, outStream) {
			return new Promise(function(resolve, reject) {
				setTimeout(function() {
					reject(new Error(REQUEST_ERROR));
				}, 500);
			});
		}));

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
		service2.expose('fetchEchoNext', function (args, inStream, outStream) {
			inStream = _(inStream);
			let fork1 = inStream.fork();
			let fork2 = inStream.fork();

			service2.fetch({
				service: 'service1',
				cmd: 'streamEcho',
				multiple: true,
				args: args
			}, fork1).then(function (response) {
				service2.fetch({
					service: 'service1',
					cmd: 'streamEcho',
					multiple: true,
					args: args
				}, fork2).then(function (data) {
					outStream.end(data);
				});
			});

			inStream.resume();
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
			}).pipe(through.obj(function (chunk, enc, callback) {
				//outStream.end(response * args.c);
				callback(null, chunk * args.c);
			})).pipe(outStream);
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

		service2.expose('responder1', function (args, inStream, outStream) {
			service2.stream({
				service: 'service3',
				cmd: 'responder2',
				args: {
					hello: 123
				}
			}, inStream).pipe(outStream);
		});

		service3.expose('responder2', function (args, inStream, outStream) {
			inStream.pipe(through.obj(null, function (chunk, enc, callback) {
				callback(null, chunk);
			}, function (callback) {
				callback();
			})).pipe(outStream);
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
			}).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.equal('method1-service1-reply');
				done();
				callback();
			}));
		});

		it('should call add and get a reply', function (done) {
			service2.stream({
				service: 'service1',
				cmd: 'add',
				args: {a: 2, b: 3}
			}).pipe(through.obj(function (chunk, enc, callback) {
				expect(chunk).to.equal(5);
				done();
				callback();
			}));
		});

		it('should call add-and-multiple which calls other service and get a reply', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'add-and-multiple',
				args: {a: 2, b: 3, c: 10}
			}).pipe(through.obj(function (chunk, enc, callback) {
				expect(chunk).to.equal(50);
				done();
				callback();
			}));
		});

		it('should call service 2 from service 3', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'method1-service2'
			}).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.equal('method1-service2-reply');
				done();
				callback();
			}));
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

		it('should call a service using promise api and catch an error', function (done) {
			service3.fetch({
				service: 'service2',
				cmd: 'throws'
			}).then(function(response) {

				// This is an error
				done(response);
			}).catch(function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should call a service using promise api and catch a rejection', function (done) {
			service3.fetch({
				service: 'service1',
				cmd: 'promise-reject'
			}).catch(function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should call service which in turn calls other service', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'method2-service2'
			}).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.equal('method1-service1-reply');
				done();
				callback();
			}));
		});

		it('should call service with a stream payload', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);
			let response = [];

			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
		});

		it.skip('should call service with a file stream', function (done) {
			let payload = fs.createReadStream('./test/dummy.txt');
			let content = fs.readFileSync('./test/dummy.txt');

			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, payload).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.deep.equal(content);
				done();
				callback();
			}));
		});

		it('should stream a stream through 2 services and get a reply', function (done) {
			let arr = [1, 2, 3, 4];
			let response = [];
			let payload = _(arr);

			service3.stream({
				service: 'service2',
				cmd: 'streamEchoNext'
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
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

		it('should call using the promise api and spread the stream to multiple services', function (done) {
			let arr = [1, 2, 3, 4];
			let payload = _(arr);

			service2.fetch({
				service: 'service2',
				cmd: 'fetchEchoNext'
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

		it.skip('should tcp timeout while streaming', function (done) {
			let timeout = 1000 * 60 * 5;
			let isOk = false;
			let index = 0;
			let SIZE = 100000000;

			let stream = _(function (push, next) {
				if (index >= SIZE) {
					return push(null, _.nil);
				}
				setTimeout(function() {
					push(null, index++);
					next();
				}, 0);
			});

			this.timeout(0);

			service3.fetch({
				service: 'service1',
				cmd: 'ignore',
				args: {
					timeout: timeout
				}
			}, stream).then(function (response) {
				expect(response).to.equal('done');
				expect(isOk).to.equal(true);
				done();
			}).catch(done);

			// When enough time passed - signal everything is ok
			setTimeout(function () {
				isOk = true;
			}, timeout - 100);
		});

		it.skip('should tcp timeout', function (done) {
			let timeout = 1000 * 60 * 5;
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

		it('should stream a large chunk, and receive smaller one', function (done) {
			this.timeout(0);
			let multiply = 0.2;
			let arr = [];
			let expectedResponse = [];
			let response = [];
			let size = 100000;

			for (let i = 0; i <= size; i++) {
				arr.push({index: i, dmdsjksjkdjfefjkef: 'akkejkjkrjekjr', kjekjkrjekrjke: 23984934, kekfjkejjtjt: 'mmakkucudhneje749'});
			}

			for (let i = 0; i <= size * multiply; i++) {
				expectedResponse.push({index: i, irjdjem4fk: 'akkejkjkrjekjr', almfjtl4: 23984934, kfkenrk5: 'mmakkucudhneje749'});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'streamEchoMultiply',
				args: {
					size: size,
					multiply: multiply
				}
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equal(expectedResponse);
				done();
				callback();
			}));
		});

		it('should stream a large chunk, and receive even larger one', function (done) {
			this.timeout(0);
			let multiply = 10;
			let arr = [];
			let expectedResponse = [];
			let response = [];
			let size = 5000;

			for (let i = 0; i <= size; i++) {
				arr.push({index: i, mfkmkef: 'akkejkjkrjekjr', u48rowoe: 23984934, xbjj: 'mmakkucudhneje749'});
			}

			for (let i = 0; i <= size * multiply; i++) {
				expectedResponse.push({index: i, irjdjem4fk: 'akkejkjkrjekjr', almfjtl4: 23984934, kfkenrk5: 'mmakkucudhneje749'});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'streamEchoMultiply',
				args: {
					size: size,
					multiply: multiply
				}
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equal(expectedResponse);
				done();
				callback();
			}));
		});

		it.skip('should call with a large stream as payload', function (done) {
			let arr = [];
			let response = [];

			for (let i = 0; i < 100000; i++) {
				arr.push({index: i, dmdsjksjkdjfefjkef: 'akkejkjkrjekjr', kjekjkrjekrjke: 23984934, kekfjkejjtjt: 'mmakkucudhneje749'});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
		});

		it('promise', function (done) {
			let arr = [];

			for (let i = 0; i < 5; i++) {
				arr.push({index: i});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'promise'
			}, payload).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
		});

		it('promise-yield-fetch', function (done) {
			let arr = [];

			for (let i = 0; i < 5; i++) {
				arr.push({index: i});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'promise-yield-fetch'
			}, payload).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
		});

		it('promise-stream', function (done) {
			let arr = [];

			for (let i = 0; i < 5; i++) {
				arr.push({index: i});
			}

			let payload = _(arr);
			service3.stream({
				service: 'service1',
				cmd: 'promise-yield-fetch'
			}, payload).pipe(through.obj(function (response, enc, callback) {
				expect(response).to.deep.equal(arr);
				done();
				callback();
			}));
		});

		it('should call with a large generated stream as payload', function (done) {
			this.timeout(0);
			let SIZE = 2;
			let index = 0;
			let response = [];
			let stream = _(function (push, next) {
				if (index >= SIZE) {
					return push(null, _.nil);
				}
				push(null, index++);
				next();
			});

			service3.stream({
				service: 'service1',
				cmd: 'streamEcho'
			}, stream).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response.length).to.deep.equal(SIZE);
				done();
				callback();
			}));
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


		it.skip('should call service 1 from service 2 with multiple echo asynchronous calls', function (done) {
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

		it.skip('should call service 2 from service 3 with multiple asynchronous calls', function (done) {
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
			}).on('error', function (err) {
				expect(err.message).to.equal('service2:not-real Does not exist');
				done();
			})
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

		it('should get a failed response from async service', function (done) {
			service3.stream({
				service: 'service1',
				cmd: 'async-fail'
			}).on('error', function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should get a failed response from service', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'throws'
			}).on('error', function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('should get a failed response from service', function (done) {
			service3.stream({
				service: 'service2',
				cmd: 'throws'
			}).on('error', function (err) {
				expect(err.message).to.equal(REQUEST_ERROR);
				done();
			});
		});

		it('pipe multiple services', function (done) {
			let arr = [1, 2, 3, 4];
			let response = [];
			let payload = _(arr);

			service1.stream({
				service: 'service2',
				cmd: 'responder1'
			}, payload).pipe(through.obj(function (chunk, enc, callback) {
				response.push(chunk);
				callback();
			}, function (callback) {
				expect(response).to.deep.equals(arr);
				done();
				callback();
			}));
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
