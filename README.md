# Introduction

Picom is a high performance ([nanomsg](http://nanomsg.org/) based), self-discovery([mdns](https://www.npmjs.com/package/mdns)), micro services communication layer

## Quick start

	npm install picom

Then, on device 1:

```js
var Picom = require('picom');
var myService = new Picom('service-name');
myService.expose('add', function(args, callback) {
	callback(null, args.a + args.b);
});
```

On device 2:

```js
var Picom = require('picom');
var myService = new Picom('other-service-name', {depends: ['service-name']});
myService.request({service: 'service-name', cmd: 'add'}, {a: 2, b: 5}).then(function(response) {
	// Response = 7
});
```

## Browsers
