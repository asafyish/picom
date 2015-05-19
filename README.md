# Introduction

Picom(pico-message) is a high performance, self-discovery([consul](https://www.consul.io/)), micro services communication layer.

## Inner workings
Picom uses a TCP connection to transfer data between services.  

TCP connections are a "bytestream", they have no start/end notation, we need to frame the stream,  
for that, we are using length-prefix which means we are putting the stream length in the first byte, this is more  
efficient then using a end-delimiter because we can create a buffer with the exact stream size upfront, with  
no need to resize.

[Msgpack](http://msgpack.org/) is used as a serialization format, it allows us to send more data per request.   

Discovery is been made through consul, when calling expose the service registers itself to consul, with health  
checks, afterwards, every 'ttl' seconds picom inform consul it's still alive. If a service misses the ttl,  
it's moved into a "failing" state and won't receive further requests until it pass the health check.  
The first few versions used UDP discovery and Multicast DNS discovery for discovering other services  
on the network, it worked great until we tried it in a cloud provider (AWS & Azure), they simply  
block this kind of communication.

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
 * port (Integer, default: random): Used to specify a port, if omitted, a random port will be chosen

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

Stop all timers, inform consul.io, stops the server from accepting new connections and keeps existing connections.
