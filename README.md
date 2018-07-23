# PAIP

**PAIP** (read pipe) is a lightweight microservice toolkit built around NATS and let `server services` **expose** local methods on NATS subjects
so that `client services` can **invoke** them remotely.

`paip services` can also **broadcast** `messages` and **observe** `messages`

Each **paip** service must provide a service name and an optional namespace. All the subjects exposed by that service
will be namespaced under **[NAMESPACE.]SERVICE_NAME**

# API

## CONSTRUCTOR

`const paip = Paip(options)`

### OPTIONS 

Property Name | Type | Required |  Default | Description
-------- | -------- | ----------- | -------- | ------- |
`name` | string | **true** | N/A |  this is name of the paip service. 
`namespace` | string | **false** | '' | this is the base name space for the service
`nats` | url or url, url or [url] | **false** | {} | this is the node-nats connection url. it can be a single url, a comma separated url or an array of url ["nats://localhost:4222", "nats://localhost:4223"] https://github.com/nats-io/node-nats
`timeout` | number | **false** | 25000 | this is the milliseconds paip wait before declaring a request timed out
`logLevel` | string | **false** | info | valid values are off, info, debug

#### Environment Variables

All options are also configurable through environment variables:

Option Name | ENV Key Name | 
-------- | -------- |
name | `PAIP_NAME` | 
namespace | `PAIP_NAMESPACE` | 
nats | `PAIP_NATS` | 
timeout | `PAIP_TIMEOUT` | 
logLevel | `PAIP_LOG_LEVEL` | 

If both are passed environment variables have precedence and will overwrite the value passed programmatically.

*Note* PAIP_NATS should be stringified as it is an object

## NATS Socket Connection Reference (for connection error handling)

Paip connect to Nats, so you don't need to do anything about that. Anyway the microservice code should get a reference to 
the underlying Nats socket connection so can decide how to handle disconnections / NATS errors.

This is how you get a reference to the Nats connection:

`const paip.getConnection()`

(its the object returned by NATS.connect() in https://github.com/nats-io/node-nats)

## EXPOSE

With expose you can ... expose a function on a NATS subject:

`paip.expose(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the NATS subject where to expose the function
`handler` | **true** | this is the handler that will be called whenever paip receive a new `request message` on `subject`

**paip** internally subscribes on `subject` and whenever a `IncomingRequest` is received it invokes the `handler` with the message
and wait a result. Check [incoming request api](#incoming-request-api) to understand how to interact with it.

It then wraps the result returned (or the error thrown) by the handler within a `Response` and publishes it back to the caller
via the `IncomingRequest` unique _INBOX reply To subject. check official nats client documentation for more info on what _INBOX subject is.

The `handler` function should return a value, a promise or simply throw an error.

For known error , the handler should provide a **statusCode** (http status codes) property. If the error has no statusCode 
**paip** will set it to 500.

If the handler function, to respond, needs to call another remote method it can use the `IncomingRequest` *invoke* method
so that every `Request` invoked in line will maintain the same transaction Id as the `IncomingRequest`, so can be traced.

The **expose** method, for each received `Request` - `Request` couple  publishes also a log message
 {`Request`, `Request`} under **[NAMESPACE.]SERVICE_NAME**.**_LOG**.`subject`.

**NOTE**
The underlying NATS subscription has {'queue':**SERVICE_NAME**}. Multiple instances of the same service will load balance
the incoming messages.

**IMPORTANT**
If the service calls expose twice with the same subject, with 2 different handlers, incoming messages will be load balanced between the 2
handlers, which is probably not what you want. 

## OBSERVE
**PAIP** can also observe messages passively, without interacting with the caller.
 
`paip.observe(subject, handler)`

Argument | Required | Description
-------- | -------- | -----------
`subject` | **true** | this is the subject to subscribe to
`handler` | **true** | this is the handler function to bind the incoming message to

## INVOKE
With invoke a service can execute a remote method exposed over nats:
 
`paip.invoke(request)`

### REQUEST SCHEMA

Argument | Required | Type | Description
-------- | -------- | ----------- | ----
`subject` | **true** | string | this is the subject where to publish the message
`args` | **false** | list | this is the list of arguments to send to the remote method and if passed must be an Array

The function returns a Promise that resolves with just the result of the remote method or reject if 
the remote method threw any error or if there was any error sending /receiving the messages .

## BROADCAST
A service can publish a message without expecting any reply:

`paip.broadcast(subject, payload, metadata)`

Argument | Required | Type | Description
-------- | -------- | -----------
`subject` | **true** | string | this is the subject where to publish the message
`payload` | **true** | any | this is the payload of the message to be sent
`metadata`? | **false** | any | this is the payload of the message to be sent

The function returns a Promise that resolves with no result or reject if any error publishing the message;

# MESSAGES

## BROADCAST MESSAGE

Property Name | Type  | Description
-------- | -------- |  ------- |
`service` | string |this is the name of the service making the request
`subject` | string | this is the subject where to publish the request
`payload` | object | this is the payload of the message
`metadata`? | any | this is an optional metadata object
`tx` | string |this is the transaction Id of the request
`time` | date | this is time the message was broadcasted

## REQUEST MESSAGE

Property Name | Type | Description
-------- | -------- | ------- |
`service` | string | this is the name of the service making the request
`subject` | string | this is the subject where to publish the request
`args` | array | this is the arguments to be passed to the remote method
`metadata`? | any | this is an optional metadata object
`tx` | string | this is the transaction Id of the request
`time` | date | this is the time the request was made

## RESPONSE MESSAGE

Property Name | Type | Description
-------- | -------- | ------- |
`service` | string | this is the name of the service sending the response
`subject` | string | this is the subject of the request this response belong go
`statusCode` | number | this is the statusCode of the response
`result` | any | this is the optional result data of the response
`error` | object | this is the optional error object only present if this is an error respone
`tx` | string | this is the transaction Id of the request
`time` | date | this is the time the response was sent

## INCOMING REQUEST API

The request object that **expose** handlers will receive has the following interfaces:

Property Name | Input Type | Return Type |  Description
-------- | -------- | ------- |
`getArgs` | N/A | array  | this is the method to get the args of the request
`setArgs(args)` | array  | this | override request.args with args
`getMetadata(path)` | any  | any | Retrieve the value at a given path of the request metadata object. path must be an array of strings ie. get(['requestor', id]) => return request.metadata.requestor.id
`setMetadata(path, value)` | any  | Set a specific metadata path to value. return the request object so can be chained
`getTransactionId` | string  | this is the method to get the transaction Id of the request
`invoke` | Promise(result)  | this is the method to make another request with the same transactionId of the incoming request

# USAGE

Expose a local method `add` remotely on subject `add`:

```javascript
const Paip = require('paip');

const server = Paip({name:'math', logLevel:'debug'});

function add(x, y){
  return x + y;
}

server.expose('add', req => add(...req.getArgs()));
```

On a client call the remote method:

```javascript
const Paip = require('paip');

const client = Paip({name:'client'});

client.invoke({subject: 'math.add', args: [3, 4]})
  .then(console.log)
  .catch(console.error)
  .then(()=> client.close());
```


# Request - Response objects internals

**What is a Request ?**

For the Application Business code

`A function name (the nats subject) and a list of arguments`
 
For paip

`The name of the 'Application Business code' the nats subject and the list of arguments`

for nats

`A subject and a message`

Outgoing request flow (service client)
- Application Business code send the request ({subject: 'add', args:[3,5]})
- Paip build a Request object {service: 'client', subject:'add', args:[3,5], time: Date, tx: 1234} and publish it to `subject`

Incoming request flow (service math)
- Paip receives the Request along with replyTo subject
- Paip builds an IncomingRequest object {paip: paipInstance, request: {service: 'client', subject:'add', args:[3,5], time: Date, tx:1234}, getArgs:()=>{}, invoke:()=>{}} and pass it to Application Code
- application code can call .invoke method and the Request sent out will keep the same tx property as the IncomingRequest so we can track the transaction. simple.
- if any error Paip build a ErrorResponse {service:'math', request.subject, request.tx:1234, time, error, statusCode, getResult:()=>{}} and publish it back to replyTo

Outgoing Response (service math)
- Application code return a result (or throw an error)
- Paip build a OutgoingResponse {service:'math', subject, tx:1234, time, result, statusCode} and publish it on replyTo
- if any error Paip build a ErrorResponse {service:'math', request.subject, tx:1234, time, error, statusCode, getResult:()=>{}} and publish it to replyTo

Incoming response (service client)
- Paip receive the serialized Response or a NATS error
- Paip build a IncomingResponse object out of the Response
- if NATS error Paip build a ErrorResponse {service:'client', subject, tx:1234, time, error, statusCode, getResult()=>{}}
- Paip return to the application code getResult() which return the content of result if exists or throws error. 