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
    invoke(request){

      return new Promise((resolve, reject) => {
        this.connection.requestOne(request.subject, request, {}, this.timeout, response => {

          // response can be an instance of NatsError
          if(response instanceof NATS.NatsError) {
            response.statusCode = 500;
            return reject(response);
          }
          // statusCode is set to 200 from the expose method if its handler resolved
          else if(response.statusCode !== 200){
            return reject(Errio.fromObject(response));
          }
          else {
            return resolve(response);
          }
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
    expose (subject, queue, description, handler){
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
      if (!name){
        throw new Error('name is required to initialize Paip service')
      }
      this.name = namespace ? namespace + '.' + name : name
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
      // initialize logger instance for current invoke call TODO is this slow ??
      const log = this.Log().set({method: 'invoke'});

      var request;

      // if subject is already a IncomingRequest it means invoke has been called from within expose hence it is already a Request object
      if (subject instanceof IncomingRequest){
        request = subject;
      }
      else{
        try{
          request = Request({client: this.service.name, subject, args});
        }
        catch(e){
          return Promise.reject(e)
        }
      }

      // set the request
      log.set({request});

      return this.nats.invoke(request.serialize())
        .then(response => IncomingResponse({response}))
        .then(response => {
          // set the response and log the content of log
          log.set({response}).info();

          return response.getPayload();
        })
        .catch(err => {
          // set the error and log the content of log
          //const error = ErrorResponse({error: err});
          log.error(err);
          throw err
        });
    },
    broadcast(subject, payload) {

      const log = this.Log().set({method: 'broadcast'});

      var message;

      // if subject is already a BroadcastMessage it means broadcast has been called from within expose
      if (subject instanceof BroadcastMessage){
        message = subject;
      }
      else{
        try{
          message = BroadcastMessage({subject, payload});
        }
        catch(e){
          return Promise.reject(e)
        }
      }

      log.set({message});

      // run this at next tick

      return this.nats.publish(subject, message)
        .then(() => {
          log.info();
        })
        .catch(err => {
          // set the error and log the content of log
          log.error(err);
          throw err
        });
    },
    expose(subject, description, handler){
      // get an handle to the Paip Log stamp
      const Log = this.Log;
      const paip = this;

      // if no handler maybe description has not been passed
      if(!handler){
        handler = description;
        description = 'Not available';
      }

      assert(subject, 'subject is required when exposing a remote method');
      assert(typeof handler === 'function', 'handler is required and should be a function');

      // the name of the queue map to the name of the service
      const queue = this.service.name;
      // make sure nats is available within expose closure
      const nats = this.nats;
      const service = this.service;
      const fullSubjectName = service.name + '.' + subject;

      this.nats.expose(fullSubjectName, queue, description, function(originalRequest, replyTo){

        // we need to parse the request message into a Request Object
        const request = IncomingRequest({client: paip.service.name, request: originalRequest, paip});

        // initialize a logger instance for current request call TODO is this slow ??
        const log = Log().set({method: 'expose', request});

        // build the subject where to publish service logs like **SERVICENAME**.**_LOG**.`subject`
        const logSubject = service.name + '._LOG.' + subject;

        return Promise.resolve(request)
          .then(handler)
          .then(responsePayload => {

            const response = SuccessResponse({request, message: description, payload: responsePayload });

            // publish reply
            nats.publish(replyTo, response.serialize());
            // also publish the tuple request response for monitoring

            log.set({response}).info();

            // also publish the tuple request response for monitoring
            nats.publish(logSubject, {request: request.serialize(), response: response.serialize()});
          })
          .catch(err => {
            // handler threw an error we need to wrap it around a response message

            const response = ErrorResponse({request, error: err});

            nats.publish(replyTo, response.serialize());

            log.error(response);

            nats.publish(logSubject, {request: request.serialize(), response: response.serialize()});
          })
      });

      Log().set({info: 'Exposed method on NATS', subject, queue, description}).info();
    },
    observe(subject, handler){
      const Log = this.Log;

      assert(subject, 'subject is required when observing');
      assert(typeof handler === 'function', 'handler is required and should be a function');

      const queue = this.service.name;
      this.nats.subscribe(subject, queue, function(message){

        Log().set({method: 'observe', message, subject});

        Promise.resolve(message)
          .then(handler)
          .catch(err => Log().set({method: 'observe', message, subject}).error(err))
      });

      Log().set({info: 'observing NATS subject', subject, queue}).info();
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

const Request = stampit({
  initializers: [
    function({client, subject, args, transactionId}){

      if (args) this.args = args;
      if (subject) this.subject = subject;
      if (client) this.client = client;
      if (transactionId) this.client = transactionId;

      assert(this.client, 'client must exists in Request object');
      assert(this.subject, 'subject must exists in Request object');
      assert(this.args, 'args must exists in Request object');

      if (!this.transactionId)
        this.transactionId = uuidv4();
      }
  ],
  methods: {
    getArgs(){ return this.args},
    getTransactionId(){ return this.transactionId},
    getSubject(){ return this.subject},
    serialize(){
      return {
        client: this.client,
        transactionId: this.transactionId,
        subject: this.subject,
        args: this.args
      }
    }
  }
})
  .compose(InstanceOf)

const IncomingRequest = stampit({
  initializers: [
    function({request, paip}){

      if (request && request.args) this.args = request.args;
      if (request && request.subject) this.subject = request.subject;
      if (request && request.transactionId) this.transactionId = request.transactionId;
      if (paip) this.paip = paip;

      assert(this.paip, 'paip client must exists in Incoming Request object');
    }
  ],

  methods:{
    invoke(subject, args){

      const request = Request({client: this.client, subject, args, transactionId: this.transactionId});

      return paip.invoke(request)
    },
    broadcast(subject, message){

      const broadcastMessage = BroadcastMessage({client: this.client, subject, message, transactionId: this.transactionId});

      return paip.broadcast(broadcastMessage)
    }
  }
})
  .compose(Request);

const BroadcastMessage = stampit({
  initializers: [
    function({subject, payload, transactionId}){

      if (subject) this.subject = subject;
      if (payload) this.payload = payload;
      if (transactionId) this.transactionId = transactionId;

      assert(this.subject, 'subject must exists in Broadcast Message');
      assert(this.payload, 'payload must exists in Broadcast Message');

      if (!this.transactionId)
        this.transactionId = uuidv4();
    }
  ],
});

const Response = stampit({
  initializers: [
    // this is used to build a response
    function({request, message, payload}){

      if (request) this.transactionId = request.getTransactionId();
      if (message) this.message = message;
      if (payload) this.payload = payload;
    }
  ],
  methods: {
    getStatusCode(){ return this.statusCode},
    getTransactionId(){ return this.transactionId},
    getMessage(){ return this.message},
    getPayload(){ return this.payload},
    serialize(){
      return {
        transactionId: this.transactionId,
        message: this.message,
        payload: this.payload,
        statusCode:this.statusCode
      }
    }
  }
})
  .compose(InstanceOf)

const IncomingResponse = stampit({
  initializers: [
    // this is used to build a Response object
    function({response}){
      if (response) {
        Object.keys(response).map(n => this[n] = response[n]);
      }
    }
  ],
})
  .compose(Response);

const ErrorResponse = stampit({
  initializers: [
    function({error}){
      if (error && error.statusCode)
        this.statusCode = error.statusCode;
      else this.statusCode = 500;
      if (error && error.message)
        this.message = error.message;
      if (error) this.payload =  JSON.parse(Errio.stringify(error))
    }
  ],
})
  .compose(Response);

const SuccessResponse = stampit({
  initializers: [
    function(){
      this.statusCode = 200;
    }
  ],
})
  .compose(Response);

// :: Request, Response, error
const RequestStatus = stampit({
  initializers:[
    function({request, response, error}){
      if (request) {
        this.subject = request.getSubject();
        this.transactionId=  request.getTransactionId();
      }
      if (response){
        this.statusCode=  response.getStatusCode();
        this.message=  response.getMessage();
      }
      if (error){
        this.error = error;
      }
    }
  ]
});

// TODO log is not printing client name
const Logger = stampit({
  initializers: [
    function (opts, { stamp }) {
      const configuration = stamp.compose.configuration;

      // make sure we create the _payload at every initialization
      this._payload= {};
      // inject the stamp configuration into the object
      this._payload.client = configuration.client;
      this.logLevel = configuration.logLevel;
    },
    function() {
      if (this.logLevel === 'off'){
        this.info = ()=>{};
        this.error = ()=>{};
        this.warn = ()=>{};
      }
    }
  ],
  methods:{
    info(){
      this._payload.time = new Date();
      // info level
      this._payload.level = 30;
      if (this._payload.method === 'expose' || this._payload.method === 'invoke'){
        // this is a request - response log entry type
        if (this.logLevel >= 30){
          // log only the final request status
          const status = RequestStatus({request: this._payload.request, response: this._payload.response});

          Object.keys(status).map(n => this._payload[n] = status[n]);

          // delete response and request
          delete this._payload.response;
          delete this._payload.request
        }
        else {
          // serialize request and response object
          this._payload.request = this._payload.request.serialize();
          this._payload.response = this._payload.response.serialize();
        }

      }
      else if (this.logLevel >= 30 && this._payload.method === 'broadcast' ){
        // remove message payload
        this._payload.message = R.omit(['payload'], this._payload.message);
      }
      else if (this.logLevel >= 30 && this._payload.method === 'broadcast' ){
        // remove message
        delete this._payload.message;
      }
      console.log(JSON.stringify(this._payload))
    },
    warn(error){
      this._payload.time = new Date();
      // info level
      this._payload.level = 40;
      this._payload.error = error;

      console.log(JSON.stringify(this._payload))
    },
    error(error){
      this._payload.time = new Date();
      // info level
      this._payload.level = 50;
      if (this._payload.method === 'expose' || this._payload.method === 'invoke') {
        // this is a request - response log entry type
        if(this.logLevel >= 30){
          // build status
          const status = RequestStatus({request: this._payload.request, response: error, error});

          // spread status object props on this
          Object.keys(status).map(n => this._payload[n] = status[n]);

          // delete request
          delete this._payload.request
        }
        else{
          // serialize request and response object
          this._payload.request = this._payload.request.serialize();
        }

      }
      else if (this.logLevel >= 30 && this._payload.broadcastMessage ){

        // build status
        const status = {
          subject: this._payload.broadcastMessage.subject,
          transactionId: this._payload.broadcastMessage.transactionId,
          error: error
        };

        Object.keys(status).map(n => this._payload[n] = status[n]);

        // delete the full broadcastMessage
        delete this._payload.broadcastMessage;
      }
      else {
        // any other case just set the error object in the payload
        this._payload.error = error;
      }

      console.log(JSON.stringify(this._payload))
    },
    set(props){
      // stamp this object with each property of props
      Object.keys(props).map(n => this._payload[n] = props[n]);
      return this;
    }
  },
  conf:{
    // 20 === debug, 30 === info , 40 === warn, 50 === error
    logLevel: 30
  }
});

module.exports = Paip;