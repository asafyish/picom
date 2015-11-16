# Introduction
Picom(pico-message) is a high performance, self-discovery([nats.io](http://nats.io/)), micro services communication layer.

## Inner workings
Picom uses ([nats.io](http://nats.io/)) to send messages between services.  

Each service has a name, and exposed methods.<br>Services sharing the same name, are expected to expose the same methods and be the same, because they will be load balanced.   

Each message is a JSON, and it's expected to be relatively small (a few kb's).

## Quick start

```
npm install picom
```

Then, on device 1:

```js
var Picom = require('picom');
var service1 = new Picom('service1');
service1.expose({
    add: function(msg) {
      return Promise.reslove({hello: 'from service 1', result: msg.a + msg.b});
    },
    returnError: function(msg) {
      return Promise.reject('something went wrong');
    }
});
```

On device 2:

```js
var Picom = require('picom');
var service2 = new Picom('service2');
service2.request('service1.add', {
    a: 2,
    b: 5
}).then(function(msg) {

    // Prints 7
    console.log(msg.result);
});

myService.request('service1.returnError').
catch(function(err) {
    // err is instance of Error with message: 'something went wrong'
    console.log(err);
});
```

## API
### Picom('serviceName', [options])
Initialize a new picom service.

Parameters:
- servers ([String], default: ['127.0.0.1:4222']): Nats.io address
- ttl (Integer, default: 30): After how many seconds of no response the server is considered "failing"
- retries (Integer, default: 3): How many times try reconnect (to different hosts)
- port (Integer, default: random): Used to specify a port, if omitted, a random port will be chosen

### picom.expose(methods)
Expose methods and start listening.

Usage

```js
myService.expose({
    add: function(msg) {
      return Promise.resolve(msg.a + msg.b);
    }
});
```   

### picom.request(service, [msg], [options])
Send request to remote service

Parameters:
- service (String, mandatory): Service name + method name, like 'serviceName.methodName'
- msg (Object, optional): Will become msg in remote service
- options (Object, options): for now, you can only define request timeout

Usage

```js
// Service 1
const Picom = require('picom');
const service1 = new Picom('service1');
service1.expose({
    add: function(msg) {
      return Promise.resolve({result: msg.a + msg.b});
    }
});
```

```js
// Service 2
const Picom = require('picom');
const service2 = new Picom('service2');
service2.request('service1.add', {
    a: 2,
    b: 5
}, {
    timeout: 30 * 1000 // 30 seconds timeout
}
});
```

### picom.publish(service, [msg])
Send request to remote service, without waiting for a reply

Parameters:
- service (String, mandatory): Service name + method name, like 'serviceName.methodName'
- msg (Object, optional): Will become msg in remote service

Usage

```js
const Picom = require('picom');
const service1 = new Picom('service1');

service1.expose({
    fib: function(msg) {
        // Do heavy lifting calculations, then notify service2, using picom or other channel
    }
});
```

```js
const Picom = require('picom');
const service2 = new Picom('service2');

service2.publish('service1.fib', {
    x: 9000
}
});
```

### picom.close()
Inform nats.io to not send anymore requests here, and disconnect.
