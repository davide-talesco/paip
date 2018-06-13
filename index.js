const NATS = require('nats');
const uuidv4 = require('uuid/v4');
const stampit = require('@stamp/it');
const Privatize = require('@stamp/privatize');
const Errio = require('errio');
const assert = require('assert');
Errio.setDefaults({stack:true});
const bunyan = require('bunyan');

const Nats = stampit({
  initializers: [
    function ({nats, timeout, log}){
      if (nats) this.options = nats;
      if (timeout) this.timeout = timeout;
      if (log) this.log = log;
  }],
  methods: {
    connect() {
      const log = this.log;

      this.connection = NATS.connect(this.options);

      this.connection.on('error', function(err) {
        log.error({info: 'Nats Connection Error', err});
      });

      this.connection.on('connect', function(nc) {
        log.info({info: 'connected to Nats'});
      });

      this.connection.on('disconnect', function() {
        log.info({info: 'disconnected from Nats'});
      });

      this.connection.on('reconnecting', function() {
        log.info({info: 'reconnecting to Nats'});
      });

      this.connection.on('reconnect', function(nc) {
        log.info({info: 'reconnected to Nats'});
      });

      this.connection.on('close', function() {
        log.info({info: 'closed Nats connection'});
      });
    },
    invoke(request){
      const log = this.log;

      log.debug({method:'invoke', request});

      return new Promise((resolve, reject) => {
        this.connection.requestOne(request.subject, request, {}, this.timeout, response => {

          // response can be an instance of NatsError
          if(response instanceof NATS.NatsError) {
            log.debug({method:'invoke', response});
            log.error({
              method:'invoke',
              subject:request.subject,
              statusCode:response.statusCode,
              transactionId:request.transactionId,
              msg:response.message});
            return reject(response);
          }
          else if(response.statusCode !== 200){
            log.debug({method:'invoke', response});
            log.error({
              method:'invoke',
              subject:request.subject,
              statusCode:response.statusCode,
              transactionId:request.transactionId,
              msg:response.message});
            // we got an error from the remote service
            return reject(Errio.fromObject(response));
          }
          else {
            log.debug({method:'invoke', response});
            log.info({
              method:'invoke',
              subject:request.subject,
              statusCode:response.statusCode,
              transactionId:request.transactionId,
              msg:response.message});
            return resolve(response.payload);
          }
        });
      });
    },
    publish(subject, message){
      return new Promise((resolve, reject) => {
        this.connection.publish(subject, message, () => {
          resolve(message);
        });
      });
    },
    expose (subject, queue, description, handler){
      // make sure they are available in callbacks
      const nats = this.connection;
      const log = this.log;

      nats.subscribe(subject, {queue}, function(request, replyTo) {

        log.debug({method:'expose', request});
        // if no replyTo? ie. a broadcast message on this subject? simply discard the request
        if (!replyTo){
          log.warn({method: 'expose', info:'request is missing replyTo subject', request});
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

const Request = stampit({
  initializers: [
    // this is to make the nats api available within the request closure
    function({nats}){
      this.nats = nats;
    },
    // this is to make the service api available within the request closure
    function({service}){
      this.service = service;
    },
    // this is the case when we are reconstructing a request from a serialized message
    function({message}){
      if (message && message.transactionId){
        this.transactionId = message.transactionId;
      }
      else{
        this.transactionId = uuidv4();
      }
      if (message && message.args){
        this.args = message.args;
      }
      if (message && message.subject){
        this.subject = message.subject;
      }
    }],
  methods: {
    invoke(subject, ...args){
      // to call the invoke on the client
      const request = {
        subject,
        args,
        service: this.service.name,
        transactionId: this.transactionId
      };

      return this.nats.invoke(request)
    },
    broadcast(subject, payload){
      // to call the invoke on the client
      const message = {
        subject,
        service: this.service.name,
        payload: payload,
        transactionId: this.transactionId
      };

      return this.nats.publish(subject, message)
    },
    getArgs(){ return this.args}
  }
});

const Paip = stampit({
  initializers: [
    ({name, namespace}, { instance }) => {
     instance.service = Service({name, namespace});
  },
    ({logLevel}, { instance }) => {
      // TODO test if it brakes when logLevel is an unsupported thing
      // support turning off completely logging
      if (logLevel === 'off'){
        logLevel = bunyan.FATAL + 1;
      }
      instance.log = bunyan.createLogger({name: instance.service.name, level: logLevel || 'info'});
  },
    ({nats, timeout}, { instance }) => {
      instance.nats = Nats({nats, timeout, log:instance.log});
      // connect to NATS
      instance.nats.connect();
  }],
  methods: {
    getConnection() {
      return this.nats.connect();
    },
    invoke(subject, ...args) {

      const log = this.log;

      try{
        assert(subject, 'subject is required when invoking a remote method')
      }
      catch(e){
        return Promise.reject(e)
      }

      return Request({nats: this.nats, service: this.service})
        .invoke(subject, ...args)
    },
    broadcast(subject, message) {

      const log = this.log;

      try{
        assert(subject, 'subject is required when broadcasting a message')
      }
      catch(e){
        return Promise.reject(e)
      }
      return Request({nats: this.nats, service: this.service})
        .broadcast(subject, message)
        .then(message =>{
          log.info({
            method:'broadcast',
            subject:message.subject,
            transactionId:message.transactionId});
          log.debug({method:'broadcast', message});
          return message
        })
        .catch(err=> {
          log.error({method: 'broadcast', subject, err});
          throw err
        })
    },
    expose(subject, description, handler){
      const log = this.log;

      // if no handler maybe description has not been passed
      if(!handler){
        handler = description;
        description = '';
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
        const request = Request({
          nats: nats,
          service: service,
          message: originalRequest
        });

        // build the subject to follow **SERVICENAME**.**_LOG**.`subject`
        const logSubject = service.name + '._LOG.' + subject;

        return Promise.resolve(request)
          .then(handler)
          .then(responsePayload => {
            const response = {
              transactionId: request.transactionId,
              statusCode: 200,
              message: description,
              payload: responsePayload
            };
            // publish reply
            nats.publish(replyTo, response);
            // also publish the tuple request response for monitoring

            log.debug({method:'expose', response});
            log.info({
              method:'expose',
              service:request.service,
              subject:request.subject,
              statusCode:response.statusCode,
              transactionId:request.transactionId,
              msg:response.message});
              // we should use the original request we got from the wire and not the one we recreated locally as that ones contains methods as well
            nats.publish(logSubject, {request:originalRequest, response});
          })
          .catch(err => {
            // handler threw an error we need to wrap it around a response message
            const response = {
              transactionId: request.transactionId,
              statusCode: err.statusCode || 500,
              message: err.message,
              payload: Errio.stringify(err)
            };
            nats.publish(replyTo, response);
            log.error({
              method:'expose',
              service:request.service,
              subject:request.subject,
              statusCode:response.statusCode,
              transactionId:request.transactionId,
              msg:response.message});
            log.debug({method:'expose', response});
            nats.publish(logSubject, {request:originalRequest, response});
          })
      });

      log.info({info: 'Exposed method on NATS', subject, queue, description})
    },
    observe(subject, handler){
      const log = this.log;

      assert(subject, 'subject is required when observing...');
      assert(typeof handler === 'function', 'handler is required and should be a function');

      const queue = this.service.id;
      this.nats.subscribe(subject, queue, function(message){

        log.info({method: 'observe', subject});
        log.debug({method: 'observe', subject, message});

        Promise.resolve(message)
          .then(handler)
          .catch(err => log.error({method: 'observe', err}))
      });
      log.info({info: 'observing NATS subject', subject, queue})
    },
    close(){
      return new Promise((resolve, reject)=> {
        const connection = this.nats.connection;
        connection.flush(function() {
          connection.close();
          resolve();
        });
      });
    }
  }
}).compose(Privatize);

module.exports = Paip;