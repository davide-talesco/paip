# PAIP

**PAIP** (read pipe) is a lightweight microservice toolkit built around NATS and let `server services` **expose** local methods on NATS subjects
so that `client services` can **send request** to them remotely. You can also define `middleware services` that proxy incoming request to backend services
and proxy the response back to the caller.

`paip services` can also **send** `notice` message and **observe** `notice`

Each **paip** service must provide a service name and an optional namespace. All the subjects exposed by that service
will be namespaced under **[NAMESPACE.]SERVICE_NAME**

All the 'notice' message will also be namespaced under **[NAMESPACE.]SERVICE_NAME**.

# Messages

Paip services communicate by exchanging messages. We have 3 kind of messages: **request**, **response** and **notice**.

## Request

Property Name | Type | Description
-------- | -------- | ------- |
`service` | string | this is the name of the service making the request
`subject` | string | this is the subject of the request
`args` | array | this is the arguments to be passed to the remote method
`metadata`? | any | this is an optional metadata object
`tx` | string | this is the transaction Id of the request
`time` | date | this is the time the request was made
`isPaipRequest` | Boolean | always set to true to indicate this is a request message

## Response

Property Name | Type | Description
-------- | -------- | ------- |
`service` | string | this is the name of the service sending the response
`subject` | string | this is the subject of the request this response belong go
`statusCode` | number | this is the statusCode of the response
`payload` | any | this is the optional content of the response
`error` | object | this is the optional error object only present if this is an error response
`tx` | string | this is the transaction Id of the request
`time` | date | this is the time the response was sent
`isPaipRequest` | Boolean | always set to true to indicate this is a response message

## Notice

Property Name | Type  | Description
-------- | -------- |  ------- |
`service` | string |this is the name of the service making the request
`subject` | string | this is the subject of the notice
`payload` | object | this is the payload of the message
`metadata`? | any | this is an optional metadata object
`tx` | string |this is the transaction Id of the request
`time` | date | this is time the message was broadcasted
`isPaipNotice` | Boolean | always set to true to indicate this is a notice message

## Usage

This is how you initialize a paip service:

```javascript
const P = require('paip').Paip;

const server = P({ name: 'server'});
```

Now you can register a method to be exposed over nats:

```javascript
function add(x, y){
  return x + y
}

server.expose('add', r => {
  const args = r.getArgs();
  return add(...args);
})
```

We extract the args from the request, call our local method and return its result to the caller.

Now we need to boot the paip service and wait to be ready:

```javascript
async function boot(){
  await server.ready();
}

boot();
```

Somewhere else we have a client paip service that wants to execute the remote method add:

```javascript
const P = require('paip').Paip;

const client = P({ name: 'client'});

async function boot(){
  await client.ready();
  
  client.sendRequest({ subject: 'server.add', args: []})
  .then(res => res.getPayload())
  .then(console.log)
  .catch(console.error)
}

boot();
```

We need to specify the full subject name of the exposed remote method, that as said before its always namespaced after **[NAMESPACE.]SERVICE_NAME**.
We extract the payload of the response before being able to work on it.

Please note client.request returns a Promise that only rejects if there was a Nats error, but will resolve even if the remote method threw an error.
In this case res.getPayload() when executed will throw the original remote error.

Its also important to notice that both the **expose** and the **request** method, will automatically generate a notice log entry under a well known 
formatted subject: 

a notice message whose payload contains both request and response messages will be published under `server.__EXPOSE__.add`;

a notice message whose payload contains both request and response messages will also be published under `client.__INVOKE__.server.add`;

This way you can easily build a monitoring system for your mesh of paip microservices.

### Incoming Messages Interfaces

As you have seen the different incoming messages the paip service receives are wrapped around a small interface that provides 
methods to retrieve the different property of the message + some additional useful methods.

#### Incoming Request

Method Name | Input Type | Return Type |  Description
-------- | -------- | ------- | -----
`get` | N/A | object  | get the entire message,
`getSubject` | N/A | string  | get the subject of the message
`setSubject` | string | this  | set the subject of the message
`getArgs` | N/A | array  | get the args of the request
`setArgs(args)` | array  | this | set request args
`getMetadata(path)` | any  | any | Retrieve the value at a given path of the message metadata object. path must be an array of strings ie. get(['requestor', id]) => return message.metadata.requestor.id
`setMetadata(value)` | any  | Set the metadata property
`getTx` | N/A  | string |get the transaction Id of the message
`setTx` | string  | this | set the transaction Id of the message
`getService` | N/A  | string | get the service of the message
`setService` | string  | this | set the service of the message
`getTime` | N/A  | string | get the time of the message
`setTime` | date  | this | set the time of the message
`sendRequest` | Promise(result)  | this is the method to send another request in line with the same transactionId of the incoming message
`sendNotice` | Promise(result)  | this is the method to send a notice message in line with the same transactionId of the incoming message

#### Incoming Response

Method Name | Input Type | Return Type |  Description
-------- | -------- | ------- | -----
`get` | N/A | object  | get the entire message,
`getSubject` | N/A | string  | get the subject of the message
`setSubject` | string | this  | set the subject of the message
`getMetadata(path)` | any  | any | Retrieve the value at a given path of the message metadata object. path must be an array of strings ie. get(['requestor', id]) => return message.metadata.requestor.id
`setMetadata(value)` | any  | Set the metadata property
`getTx` | N/A  | string |get the transaction Id of the message
`setTx` | string  | this | set the transaction Id of the message
`getService` | N/A  | string | get the service of the message
`setService` | string  | this | set the service of the message
`getTime` | N/A  | string | get the time of the message
`setTime` | date  | this | set the time of the message
`getStatusCode` | N/A  | number | get the statusCode of the response
`getPayload` | N/A  | any | get the payload of the response, throws the remote error if the response is an error
`sendRequest` | Promise(result)  | this is the method to send another request in line with the same transactionId of the incoming message
`sendNotice` | Promise(result)  | this is the method to send a notice message in line with the same transactionId of the incoming message

#### Incoming Notice

Method Name | Input Type | Return Type |  Description
-------- | -------- | ------- | -----
`get` | N/A | object  | get the entire message,
`getSubject` | N/A | string  | get the subject of the message
`setSubject` | string | this  | set the subject of the message
`getMetadata(path)` | any  | any | Retrieve the value at a given path of the message metadata object. path must be an array of strings ie. get(['requestor', id]) => return message.metadata.requestor.id
`setMetadata(value)` | any  | Set the metadata property
`getTx` | N/A  | string |get the transaction Id of the message
`setTx` | string  | this | set the transaction Id of the message
`getService` | N/A  | string | get the service of the message
`setService` | string  | this | set the service of the message
`getTime` | N/A  | string | get the time of the message
`setTime` | date  | this | set the time of the message
`getPayload` | N/A  | any | get the payload of the notice message
`sendRequest` | Promise(result)  | this is the method to send another request in line with the same transactionId of the incoming message
`sendNotice` | Promise(result)  | this is the method to send a notice message in line with the same transactionId of the incoming message

All set methods return the request object so they can be chained.

### Transactions

Whenever you use the sendRequest / sendNotice methods of any incoming message, the newly generated message will keep the same transaction ID
of the incoming one, so we can track multi hop requests.

# API

## options 

This are the global options supported: 

Property Name | Type | Required |  Default | Description
-------- | -------- | ----------- | -------- | ------- |
`name` | string | **true** | N/A |  this is name of the paip service. 
`namespace` | string | **false** | '' | this is the base name space for the service
`nats` | url or url, url or [url] | **false** | {} | this is the node-nats connection url. it can be a single url, a comma separated url or an array of url ["nats://localhost:4222", "nats://localhost:4223"] https://github.com/nats-io/node-nats
`timeout` | number | **false** | 25000 | this is the milliseconds paip wait before declaring a request timed out
`log` | string | **false** | info | valid values are off, info, debug, trace

### Environment Variables

All options are also configurable through environment variables:

Option Name | ENV Key Name | 
-------- | -------- |
name | `PAIP_NAME` | 
namespace | `PAIP_NAMESPACE` | 
nats | `PAIP_NATS` | 
timeout | `PAIP_TIMEOUT` | 
log | `PAIP_LOG` | 

If both are passed environment variables have precedence and will overwrite the value passed programmatically.

*Note* PAIP_NATS should be stringified

## METHODS

### expose

With expose you can ... expose a function on a NATS subject:

`paip.expose(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the NATS subject where to expose the function
`handler` | **true** | this is the handler that will be called whenever paip receive a new `request message` on `subject`

**paip** internally subscribes on `subject` (namespaced under the full service name) and whenever a `IncomingRequest` 
is received it invokes the `handler` with the message and wait for a result. 
Check [incoming request api](#Incoming-Request) to understand how to interact with it.

It then wraps the result returned (or the error thrown) by the handler within a `Response` and publishes it back to the caller
via the `IncomingRequest` unique _INBOX reply To subject. check official nats client documentation for more info on what _INBOX subject is.

The `handler` function should return a value, a promise or simply throw an error.

Also, for simplicity if the exposed method make another paip request, it can return directly the corresponding paip Response 
and the framework will extract the result of the response automatically.

ie. the following code behave the same:
```javascript
server.expose('test', function(req){
  return req.sendRequest({ subject: 'somethingelse'})
})
```

```javascript
server.expose('test', function(req){
  return req.sendRequest({ subject: 'somethingelse'})
  .then(res => res.getPayload())
})
```

For known error , the handler should provide a **statusCode** (http status codes) property. If the error has no statusCode 
**paip** will set it to 500.

**IMPORTANT**
If the service calls expose twice with the same subject, with 2 different handlers, incoming messages will be load balanced between the 2
handlers, which is probably not what you want. 

**IMPORTANT**
If 2 instance of the same service are running, they will load balance the requests. (2 services are considered the same 
if they have the same namespace and name property)

## observe
**PAIP** can also observe messages passively, without interacting with the caller.
 
`paip.observe(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the subject to subscribe to
`handler` | **true** | this is the handler function to bind the incoming message to

ie. server send a notice and client receives it.

```javascript
server.sendNotice({ subject: 'login', user: 'pippo@pippo.com'});

client.observe('server.login', function(notice){
  const payload = notice.getPayload();
})
```

## sendRequest

With sendRequest a service can execute a remote method exposed over nats:
 
`paip.sendRequest(request)`

This method return a Promise that fulfills with a Response object.

## sendNotice

With sendRequest a service can execute a remote method exposed over nats:
 
`paip.sendRequest(request)`

This method return a Promise that fulfills with a Response object.

**IMPORTANT**
Please note the subject of the request gets namespaced after the service full name as we want to avoid a service to 
send notice regarding some other service namespace.

## ready

Observe and expose do only register locally the handlers, only when you call the ready method paip will initialize nats 
connection and subscribe all handlers.

This method return a promise that fulfills only when all handlers are subscribed to nats.

## shutdown

This method flush paip cache and shutdown the paip service. It returns a promise that fulfill once the shutdown has completed.

## Message Interface

Paip provides an additional interface for working with paip message to simplify your application code.

the following block of code behave the same:

```javascript
const Paip = require("paip").Paip;

const client = Paip({ name: "client" });
const server = Paip({ name: "server" });

server.expose('echo', function(r){
  return r.getArgs()
});

async function boot(){

  await client.ready();
  await server.ready();

  await client.sendRequest({ subject: 'server.echo', args: [ 'ciao' ]})
    .then(res => res.getPayload())
    .then(console.log)
}

boot();
```

```javascript
const Paip = require("paip").Paip;
const U = require('paip').utils;

const client = Paip({ name: "client" });
const server = Paip({ name: "server" });

server.expose('echo', U.getArgs);

async function boot(){

  await client.ready();
  await server.ready();

  await client.sendRequest({ subject: 'server.echo', args: [ 'ciao' ]})
    .then(U.getPayload)
    .then(console.log)
}

boot();
```