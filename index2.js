const NATS = require('nats');
const uuidv4 = require('uuid/v4');
const stampit = require('@stamp/it');
const InstanceOf = require('@stamp/instanceof');
const Privatize = require('@stamp/privatize');
const R = require('ramda');
const Errio = require('errio');
const assert = require('assert');
Errio.setDefaults({stack:true});

const logLevelNameMap = {
  off: 0,
  info: 30,
  debug: 50
};

const Nats = stampit({
  initializers: [
    function ({options, timeout, Log}){
      if (options) this.options = R.mergeDeepLeft(this.options, options);
      if (timeout) this.timeout = timeout;
      if (Log) this.Log = Log;
  }],
  methods: {
    connect() {
      // create a new logger instance
      const log = this.Log().set({component: 'nats'});

      this.connection = NATS.connect(this.options);

      this.connection.on('error', function(err) {
        log.set({message: 'Nats Connection Error'}).error(err);
      });

      this.connection.on('connect', function(nc) {
        log.set({message: 'connected to Nats'}).info();
      });

      this.connection.on('disconnect', function() {
        log.set({message: 'disconnected from Nats'}).info();
      });

      this.connection.on('reconnecting', function() {
        log.set({message: 'reconnecting to Nats'}).info();
      });

      this.connection.on('reconnect', function(nc) {
        log.set({message: 'reconnected to Nats'}).info();
      });

      this.connection.on('close', function() {
        log.set({message: 'closed Nats connection'}).info();
      });
    },
    invoke(subject, request){

      return new Promise((resolve) => {
        this.connection.requestOne(subject, request, {}, this.timeout, response => {
          return resolve(response);
        });
      });
    },
    publish(subject, message){
      return new Promise((resolve, reject) => {
        this.connection.publish(subject, message, () => {
          resolve();
        });
      });
    },
    expose (subject, queue, handler){
      // make sure they are available in callbacks
      const nats = this.connection;
      const log = this.Log().set({component: 'nats'});

      nats.subscribe(subject, {queue}, function(request, replyTo) {

        // if no replyTo? ie. a broadcast message on this subject? simply discard the request
        if (!replyTo){
          log.set({message:'request is missing replyTo subject', request}).warn();
          return
        }
        // pass the request to the Paip handler
        handler(request, replyTo)

      // this function return nothing
      });
    },
    subscribe (subject, queue, handler){
      const nats = this.connection;
      nats.subscribe(subject, {queue}, handler);
    }
  },
  props: {
    options: {
      json: true
    },
    timeout: 5000
  }
});

const Service = stampit({
  initializers: [
    function({namespace, name}){
      assert(name, 'name is required to initialize Paip service');
      // build the full service
      this.name = name;
      this.namespace = namespace;
      this.fullName = this.namespace ? this.namespace + '.' + this.name : this.name
    }
  ]
});

const Paip = stampit({
  initializers: [
    ({name, namespace}, { instance }) => {
     instance.service = Service({name, namespace});
  },
    ({logLevel}, { instance }) => {
      const conf = {client: instance.service.name};
      if (logLevel){
        assert(['off', 'info', 'debug'].includes(logLevel), 'logLevel must be one of off | info | debug');
        conf.logLevel= logLevelNameMap[logLevel];
      }
      instance.Log = Logger.conf(conf);
  },
    ({nats, timeout}, { instance }) => {
      instance.nats = Nats({options: nats, timeout, Log:instance.Log});
      // connect to NATS
      instance.nats.connect();
  }],
  methods: {
    getConnection() {
      return this.nats.connection;
    },
    invoke(subject, ...args) {
      const paip = this;

      // build the subject where to publish service logs like **SERVICENAME**.**_LOG**.`subject`
      const logSubject = paip.service.name + '._LOG.' + subject;

      return new Promise((resolve)=>{

        // if subject is already a Request it means this is a related request being invoked
        // from within expose hence it is already a Request object
        if (subject instanceof Request){
          const request = subject;
          return resolve(request);
        }
        // else this is a new request
        return resolve(Request({service: paip.service.name, subject, args}));
      })
        .then(request => {
          // publish it to subject and wait for the response
          return paip.nats.invoke(subject, request)
            .then(response => {
              // if response its NATS error throw it so we can wrap it around a paipResponse Object
              if(response instanceof NATS.NatsError) {
                // this is to monitor if request never left or timed out
                paip.nats.publish(logSubject, ErrorResponse({service: paip.service.name, request, error:response}));

                throw response
              }
              // parse response into a paipResponse object
              return IncomingResponse({response});
            })
            .catch(err => {
              return ErrorResponse({service: paip.service.name, request, error:err});
            })
            .then(paipResponse => {
              return paipResponse.getResult()
            })
        })
    },
    expose(subject, appHandler){

      const paip = this;

      assert(subject, 'subject is required when exposing a remote method');
      assert(typeof appHandler === 'function', 'appHandler is required and should be a function');

      // the name of the queue map to the name of the service
      const queue = paip.service.fullName;

      // namespace subject under service full name
      const fullSubjectName = paip.service.fullName + '.' + subject;

      // build the subject where to publish service logs like **SERVICENAME**.**_LOG**.`subject`
      const logSubject = paip.service.name + '._LOG.' + subject;

      // subscribe to subject
      paip.nats.expose(fullSubjectName, queue, function(request, replyTo){

        return Promise.resolve(request)
          .then(request => {
            // build the IncomingRequestObject
            const incomingRequest = IncomingRequest({paip: paip, request});
            // call application handler with IncomingPaipRequest
            return Promise.resolve(incomingRequest)
              .then(appHandler)
              // build a paipResponse out of handler result
              .then(result => OutgoingResponse({service: paip.service.name, request, result}))
              // if any error build an ErrorPaipResponse
              .catch(err => {
                return ErrorResponse({service: paip.service.name, request, error:err})
              })
              // send it back to the caller
              .then(response => {
                paip.nats.publish(replyTo, response);
                // also publish the tuple request response for monitoring
                paip.nats.publish(logSubject, {request: request, response});
              })
              // TODO this should never happen! but should we log it ?
              .catch(()=>{})
          })
      });
    },
    broadcast(subject, payload){
      const paip = this;

      return new Promise((resolve)=>{
        resolve(BroadcastMessage({subject, payload}))
      })
        .then(message => {
          return paip.nats.publish(subject, message);
        })
    },
    observe(subject, handler){
      const paip = this;

      assert(subject, 'subject is required when observing');
      assert(typeof handler === 'function', 'handler is required and should be a function');

      // the name of the queue map to the name of the service
      const queue = paip.service.fullName;

      this.nats.subscribe(subject, queue, function(message){

        Promise.resolve(message)
          .then(handler)
          // TODO should we catch ?
      });
    },
    close(){
      return new Promise((resolve, reject)=> {
        const connection = this.nats.connection;
        connection.flush(function() {
          connection.close();
          resolve();
        });
      });
    },
  }
})
  .compose(Privatize);

const BroadcastMessage = stampit({
  initializers: [
    function({subject, payload}){

      if (subject) this.subject = subject;
      if (payload) this.payload = payload;

      assert(this.subject, 'subject must exists in Broadcast Message');
      assert(this.payload, 'payload must exists in Broadcast Message');

      if (!this.transactionId)
        this.transactionId = uuidv4();
    }
  ],
});

const IncomingRequest = stampit({
  initializers: [
    function({paip, request}){
      // request should be a valid request
      if (request) this.request = Request(request);
      if (paip) this.paip = paip;

      assert(this.paip, 'paip must exists in Request object');
      assert(this.request, 'request must exists in Request object');

    }
  ],
  methods: {
    getArgs(){
      return this.request.args;
    },
    invoke(subject, args){

      const request = Request({service: this.paip.service.name, subject, args, tx: this.request.tx});

      return paip.invoke(request)
    },
  }
});

const Request = stampit({
  initializers: [
    function({service, subject, args}){

      if (args) this.args = args;
      if (subject) this.subject = subject;
      if (service) this.service = service;

      assert(this.service, 'service must exists in Request object');
      assert(this.subject, 'subject must exists in Request object');
      assert(this.args, 'args must exists in Request object');

      if (!this.tx)
        this.tx = uuidv4();
      this.time = new Date();
    }
  ]
})
  .compose(InstanceOf);

const Response = stampit({
  initializers: [
    function({service, subject, tx, time, result, statusCode}){
      // required props
      if (service) this.service = service;
      if (subject) this.subject = subject;
      if (tx) this.tx = tx;
      if (time) this.time = time;
      if (statusCode) this.statusCode = statusCode;

      // optional props
      if (result) this.result = result;

      assert(this.service, 'service must exists in Response object');
      assert(this.subject, 'subject must exists in Response object');
      assert(this.tx, 'tx must exists in Response object');
      assert(this.time, 'time must exists in Response object');
      assert(this.statusCode, 'statusCode must exists in Response object');

    }
  ],
  methods: {
    getResult(){
      if (this.error)
        throw Errio.fromObject(this.error);

      return this.result;
    }
  }
});

const IncomingResponse = stampit({
  initializers:[
    function({response}){
      Object.keys(response).map(n => this[n] = response[n]);
    }
  ]
})
  .compose(Response);

const OutgoingResponse = stampit({
  initializers: [
    function({request, result}) {
      if (result) this.result = result;
      // set request related props
      this.tx = request.tx;
      this.subject = request.subject;
      this.statusCode = 200;
      this.time = new Date();
    }
  ]
})
  .compose(Response);

const ErrorResponse = stampit({
  initializers:[
    function({request, error}){
      if (request){
        if (request.subject) this.subject = request.subject;
        if (request.tx) this.tx = request.tx;
      }
      if (error){
        this.error = JSON.parse(Errio.stringify(error));
        error.statusCode ? this.statusCode = error.statusCode : this.statusCode = 500;
        this.error.statusCode = this.statusCode;
      }
      // set time
      this.time = new Date();
    }
  ]
})
  .compose(Response);

const Logger = stampit({
  initializers:[
    function({service, logLevel}){
      // initialize options and payload
      this.options = {};
      this._payload = {};

      if (service){
        this.options.service = service;
        // also set it in the payload
        this._payload.service = service;
      }
      if (logLevel){
        this.options.logLevel = logLevel
      }
    }
  ],
  methods: {
    child(){
      // children logger should get parent options and parent _.payload
      const childLogger =  Logger(this.options);
      childLogger.set(this._payload);
      return childLogger;
    },
    info(){
      this._payload.level = 30;
      console.log(JSON.stringify(this._payload))
    },
    set(props){
      if (typeof props !== 'object')
        return this;
      // stamp this object with each property of props
      Object.keys(props).map(n => this._payload[n] = props[n]);
      return this;
    }
  }
});

module.exports = Paip;


