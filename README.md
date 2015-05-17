# Introduction

Picom(pico-message) is a high performance, self-discovery([consul](https://www.consul.io/)), micro services communication layer.
For communication we are using msgpack with Date support(plain msgpack doesn't support Date).

## Quick start

	npm install picom

Then, on device 1:

```js
var Picom = require('picom');
var myService = new Picom('service1');
myService.expose({
	add: function(args, inStream, outStream) {

		// Must call end, or pipe into outStream
		outStream.end(args.a + args.b);
	}
});
```

On device 2:

```js
var Picom = require('picom');
var myService = new Picom('service2');
myService.stream({
	service: 'service1', 
	cmd: 'add', 
}, {
	a: 2, 
	b: 5
}).stream();
```

## API

### Picom('serviceName', [options])

Initialize a new picom service.

Parameters:

 * consulHost (String, default: '127.0.0.1'): Consul.io address
 * consulPort (Integer, default: 8500): Consul.io port
 * ttl (Integer, default: 30): After how many seconds of no response the server is considered "failing"
 * retries (Integer, default: 3): How many times try reconnect (to different hosts)

### picom.expose(methods)

Expose methods and start listening.

Usage

```js
myService.expose({
	add: function(args, inStream, outStream) {
		outStream.end(args.a + args.b);
	}
});
```

### picom.stream(service, [args], [stream])

Stream data from remote service.

Parameters:

Service

 * service (String, mandatory): Service name
 * cmd (String, mandatory): Command to execute

args (Object, optional): Will become args in remote service
stream (Stream, options): Will become inStream in remote service

Usage

```js
myService.stream({
	service: 'service1', 
	cmd: 'add'
}, {
	a: 2, 
	b: 5}
});
```

### picom.fetch(service, [args], [stream])

Fetch data from remote service, like stream, but returns the entire result in a single array,
useful when working with small data, and we don't want to mess with streams.

Parameters:

Service

 * service (String, mandatory): Service name
 * cmd (String, mandatory): Command to execute
 * multiple (Boolean, default: false): If true will collect the entire stream

args (Object, optional): Will become args in remote service
stream (Stream, options): Will become inStream in remote service

Usage

```js
myService.fetch({
	service: 'service1', 
	cmd: 'add'
}, {
	a: 2, 
	b: 5}
});
```

### picom.end()

Stop all timers, stops the server from accepting new connections and keeps existing connections and inform consul.io.
