# paip

**paip** (read pipe) is a lightweight wrapper around NATS and let `server services` **expose** local methods on NATS subjects
so that `client services` can **invoke** them remotely. 

`paip services` can also **broadcast** `messages` and **observe** `messages`

Each **paip** service  must provide a service name and an optional namespace. All the subjects exposed by that service
will be namespaced under **[NAMESPACE.]SERVICE_NAME**

# API

## CONSTRUCT

`const paip = Paip(options)`

### OPTIONS SCHEMA

Property Name | Type | Required |  Default | Description
-------- | -------- | ----------- | -------- | ------- |
`name` | string | **true** | N/A |  this is name of the paip service. 
`namespace` | **false** | '' | this is the base name space for the service
`nats` | object | **false** | {} | this is the node-nats client connect option object. https://github.com/nats-io/node-nats

## EXPOSE

`paip.expose(subject, description, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the NATS subject where to expose the function
`description` | **true** | this is the description of this remote method
`handler` | **true** | this is the handler that will be called whenever paip receive a new `request message` on `subject`

**paip** internally subscribes on `subject` and whenever a `request message` is received it invokes the `handler` with the message
and wait a result.

It then wraps the result (or the error thrown by the handler) within a `response message`and publishes it back to the caller
via the `request message` unique _INBOX subject.

The `handler` function should return a value, a promise or simply throw an error.

The `handler`, for known error should provide a statusCode (http status codes) property. If the error has no statusCode 
**paip** will set it to 500.

If the handler function, to respond needs to call another remote method it can use the `request message` *invoke* method
so the new `request message` will maintain the same transactionId as the incoming request, and we can trace it.

**pipe** for each received `request message` publishes the `request - response cycle message` (`request message` and `response message`) 
under **[NAMESPACE.]NAME**.**_LOG**.`subject`

**NOTE**
The underlying NATS subscription has {'queue':**SERVICE_ID**}. Multiple instance instance of the same service will load balance
the incoming messages.

**IMPORTANT**
If the service calls expose twice with the same subject, with 2 different handlers, incoming messages will be load balanced between the 2
handlers, which is probably not what you want. 

## OBSERVE

`paip.observe(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the subject to subscribe to
`handler` | **true** | this is the handler function to bind the incoming message to

## INVOKE

`paip.invoke(subject, ...args)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the subject where to publish the message
`...args` | **true** | this is the list of arguments to send to the remote method

The function returns a Promise that resolves with just the result of the remote method or reject if 
the remote method threw any error or if there was any error sending, receiving the messages .

## BROADCAST

`paip.broadcast(subject, message)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | string | **true** | this is the subject where to publish the message
`message` | **true** | this is the `broadcast message` to be sent

The function return a Promise that resolves with no result or reject if any error publishing the message;

# MESSAGES

## REQUEST OBJECT

Property Name | Type | Required | Description
-------- | -------- | ----------- | ------- |
`args` | number | **true** | this is the arguments to be passed to the remote method
`subject` | object | **false** | this is the subject where to publish the request
`service` | string | **false** | this is the name of the service making the request
`transactionId` | string | **false** | this is the transactionId of the request

## RESPONSE OBJECT

Property Name | Type | Required | Description
-------- | -------- | ----------- | ------- |
`statusCode` | number | **true** | this is the statusCode of the request
`payload` | object | **false** | this is the optional data of the response
`message` | string | **false** | this is an optional message the server can add
`transactionId` | string | **false** | this is the transactionId of the request

## REQUEST API

The request object that expose handlers will receive has the following interfaces:

Property Name | Return Type |  Description
-------- | -------- | ------- |
`getArgs` | array  | this is the method to get the args of the request
`invoke` | Promise(result)  | this is the method to make another request with the same transactionId of the incoming request (transaction)
`broadcast` | Promise()  | this is the method to send a broadcast message

# USAGE

Expose a local method `add` remotely on subject `add`:

```javascript
const Paip = require('paip');

const server = Paip({name:'server'});

function add(x, y){
  return x + y;
}

server.expose('add', 'add 2 numbers', add);
```

On a client call the remote method:

```javascript
const Paip = require('paip');

const client = Paip({name:'client'});

client.invoke('add', 3, 4)
  .then(console.log)
  .catch(console.error)
```