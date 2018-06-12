# paip

**paip** (read pipe) is a lightweight wrapper around NATS and let `server services` **expose** local methods on NATS subjects
so that `client services` can **invoke** them remotely. 

`paip services` can also **broadcast** `messages` and **observe** `messages`

In a microservice architecture each **paip** service **exposing**  functionalities must define its `root subject space`
composed as follow:

**BASE_SUBJECT_SPACE.SERVICE_NAME** === **SERVICE_ID**

# API

## CONNECT

`const paip = Paip.connect(options)`

### OPTIONS SCHEMA

Property Name | Type | Required |  Default | Description
-------- | -------- | ----------- | -------- | ------- |
`name` | string | **false** | random |  this is name of the paip service. 
`baseSubjectSpace` | **false** | '' | this is the base name all the services expose subjects will be prefixed with
`nats` | object | **false** | {} | this is the node-nats client connect option object. https://github.com/nats-io/node-nats

## EXPOSE

`paip.expose(subject, description, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the NATS subject where to expose the function
`description` | **true** | this is the description of this remote method
`handler` | **true** | this is the handler that will be called whenever paip receive a new `request message` on `subject`

**paip** internally subscribes on `subject` and whenever a `request message` is received it invokes the `handler` with the message
and wait a `response message` back.

It then publishes the `response message` (or if `handler` throws an error wraps it around a `response message`) back to caller
at the `request message` unique _INBOX subject.

The `handler` function should return a value, a promise or simply throw an error.

If the handler function, in order to responde, needs to call another remote method it can use the `request message` invoke method
so the new `request message` will maintain the same transactionId

**pipe** also publishes the `request - response cycle message` (`request message` and `response message`) under **BASE_SUBJECT_SPACE**.**_LOG**.`subject`

**NOTE**
The underlying NATS subscription has {'queue':**SERVICE_ID**}. Multiple instance instance of the same service will load balance
the incoming messages.

**IMPORTANT**
If the service calls expose twice with the same subject, with 2 different handlers, incoming messages will be load balanced between the 2
handlers, which is probably not what you probably. 

## INVOKE

`paip.request().invoke(subject, message)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | string | **true** | this is the subject where to publish the message
`message` | **true** | this is the `request message` to be sent

The function returns a Promise that resolves with just the result of the remote method or reject if any error sending, 
receiving the messages or any error thrown by the remote method.

## BROADCAST

`paip.broadcast(subject, message)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | string | **true** | this is the subject where to publish the message
`message` | **true** | this is the `broadcast message` to be sent

The function return a Promise that resolves with no result or reject if any error publishing the message;

# MESSAGES

## REQUEST OBJECT

Property Name | Type |  Description
-------- | -------- | ------- |
`getArgs` | method  | this is the method to get the args of the request
`invoke` | method  | this is the method to make another request with the same transactionId of the incoming request (transaction)
`broadcast` | method  | this is the method to send a broadcast message

## RESPONSE OBJECT

Property Name | Type | Required | Description
-------- | -------- | ----------- | ------- |
`statusCode` | number | **true** | this is the statusCode of the request
`payload` | object | **false** | this is the optional data of the response
`message` | string | **false** | this is an optional message the server can add

# USAGE

Expose a local method `add` remotely on subject `add`:

```javascript
const Paip = require('paip');

const server = Paip();

function add(x, y){
  return x + y;
}

server.expose('add', 'add 2 numbers', add);
```

On a client call the remote method:

```javascript
const Paip = require('paip');

const client = Paip();

client.request().invoke('add', 3, 4)
  .then(console.log)
  .catch(console.error)
```

  
















## OBSERVE MAYBE TO BE IMPLEMENTED INTERNALLY ONLY AND EXPOSED VIA THE SNIFF METHOD

`paip.observe(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the NATS subject where to expose the function
`handler` | **true** | this is the handler that will be called whenever paip observes a new message on `subject`

Depending on subject the message can either be `request message`, `response message`, `broadcast message`

**pipe** also publishes the `message - observe handler result` (`message` and `observe handler result`) under **SERVICE_ID**.**_OBSERVE**.`subject`

**NOTE**
The `handler` function return value is discarded because we are only interested that the observe function completed
successfully or not.


The transport framework (paip) should **broadcast** each service `request-reply-status` under the service root namespace
**monitor**. Other service can observe such subject (for each request-reply cycle on a specific subject a message with 
{request, reply, status}) will be published under monitor.[original request subject]

Should be a JS module that connect to NATS and return an object with following API:

should the code using paip be aware of the message entity or not? 

- send a synchronous request expecting one response(and hopefully receive a response)
- send a syncrhonous request expecting X responses (use case login )
- publish a message asynchronously expecting no reply
- subscribe to a specific request pattern in a specific queue (so that if there are multiple instances requests are load balanced)
- monitor a specific pattern (should not join any queue so that multiple instances can monitor the same subjects and 
should be readonly, you don't have access to the reply inbox subject)

Every NATS error should be considered fatal? 

# Improvements Details

Modify expose so it wirks even if handler does not return a Promise or if it throws an error synchronously

For every message created Should extend every message with a correlationId, if they do not have one already.

Can use INBOX as root namespace for all the reply inbox subject that subscribers can use to send a response back to the publisher/requestor.
https://nats.io/documentation/internals/nats-protocol/#PUB

If the request time out paip should write it to a specific namespace so we can monitor! NO ALL THE REQUESTS - RESPONSE should be written to an internal topic