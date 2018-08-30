const stampit = require("@stamp/it");
const Privatize = require("@stamp/privatize");
const uuidv4 = require("uuid/v4");
const R = require("ramda");
const NATS = require("nats");
const _ = require("lodash");
const assert = require('assert');
const Errio = require("errio");
Errio.setDefaults({ stack: true });

const Logger = stampit({
  initializers: [
    function({ log }) {
      const LOG_LEVEL_MAP = {
        off: 60,
        error: 50,
        warn: 40,
        info: 30,
        debug: 20,
        trace: 10
      };

      log = process.env.PAIP_LOG || log;

      this._payload = {};

      if (log) {
        assert(
          Object.keys(LOG_LEVEL_MAP).includes(log),
          `log must be one of [ ${Object.keys(LOG_LEVEL_MAP)} ]`
        );
        this.options.logLevel = LOG_LEVEL_MAP[log];
      }
    }
  ],
  methods: {
    child() {
      // children logger should get parent options and parent _.payload
      const childLogger = Logger(this.options);
      childLogger.set(this._payload);
      return childLogger;
    },
    trace() {
      this._payload.level = 10;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    debug() {
      this._payload.level = 20;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    info() {
      this._payload.level = 30;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    warn() {
      this._payload.level = 40;
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    error(err) {
      this._payload.level = 50;
      if (err) this._payload.error = Errio.stringify(err);
      if (this.options.logLevel <= this._payload.level)
        console.log(JSON.stringify(this._payload));
    },
    set(props) {
      if (typeof props !== "object") return this;
      // stamp this object with each property of props
      Object.keys(props).map(n => (this._payload[n] = props[n]));

      return this;
    }
  },
  props: {
    options: {
      // 10 === trace, 20 === debug, 30 === info , 40 === warn, 50 === error
      logLevel: 30
    }
  }
});

const isMessage = function(message){
  assert(message.subject, 'subject is required in Message');
  assert(message.metadata, 'metadata is required in Message');
  assert(message.time, 'time is required in Message');
  assert(message.service, 'service is required in Message');
};

const Message = stampit({
  initializers: [
    function({ subject,  metadata = {}, tx, service,  time }) {
      assert(subject, "subject is required to create a Message object");
      assert(service, "service is required to create a Message object");

      this.tx = tx || uuidv4();
      this.time = time || new Date();
      this.metadata = metadata;
      this.service = service;
      this.subject = subject;
    }
  ],
  methods: {
    get: function(){
      return JSON.parse(JSON.stringify(this))
    },

    getSubject: function(){ return this.subject },

    setSubject: function(subject) {
      this.subject = subject;
      return this;
    },

    getTx: function(){ return this.tx },

    setTx: function(tx){
      this.tx = tx;
      return this;
    },

    getService: function(){ return this.service },

    setService: function(service) {
      this.service = service;
      return this;
    },

    getMetadata: function(path) {
      if (!path) return _.cloneDeep(this.metadata);
      // make sure it works also if user specify just a string
      path = _.castArray(path);
      return _.cloneDeep(R.path(path, this.metadata));
    },

    setMetadata: function(metadata) {
      this.metadata = _.cloneDeep(metadata);
      return this;
    },

    mergeMetadata: function(metadata) {
      this.metadata = _.merge(_.cloneDeep(metadata), this.metadata)
      return this;
    },

    getTime: function(){ return this.time },

    setTime: function(time) {
      this.time = time;
      return this;
    },
  }
});

const isRequest = function(request){
  try {
    isMessage(request);
    assert(request.args, 'args is required in Request');
    assert(request.isPaipRequest, 'isPaipRequest is required in Request');

    return true
  }
  catch(e){
    // TODO log it ?
    return false
  }
};

// generic request Constructor
const Request = stampit(Message, {
  initializers: [
    function({ args = []}){
      this.args = _.castArray(args);
      this.isPaipRequest = true;
    }
  ],
  methods: {
    getSummary: function(){
      const summary = {};

      summary.service = this.service;
      summary.subject = this.subject

      return summary;
    },
    getArgs: function() { return _.cloneDeep(this.args)},

    setArgs: function(args) {
      this.args = _.castArray(_.cloneDeep(args));
      return this;
    }
  }
});

const IncomingRequest = function(nats, service, rawRequest){
  // build the request
  const incomingRequest = stampit(Request, Privatize)(rawRequest);

  // extend request with additional methods
  incomingRequest.sendRequest = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingRequest.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };

  incomingRequest.sendNotice = function(message){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Notice(_.extend({ service: service.getFullName(), tx: incomingRequest.getTx() }, message)));
    })
      .then(makeSendNotice(nats, service))
  };

  return incomingRequest;
};

const isIncomingResponse = function(response){
  try {

    assert(typeof response.getStatusCode === 'function');
    assert(typeof response.getPayload === 'function');
    return true
  }
  catch(e){
    // TODO log it ?
    return false
  }
};

const Response = stampit(Message, {
  initializers: [
    function({ error, payload, to }){
      if (error) {
        this.error = typeof error === 'string' ? error : Errio.stringify(error);
        // if error has statusCode use it otherwise set it to 500
        error.statusCode
          ? (this.statusCode = error.statusCode)
          : (this.statusCode = 500);
        this.error.statusCode = this.statusCode;
      }
      else {
        this.statusCode = 200;
        this.payload = payload;
      }

      if (to) this.to = to;
      this.isPaipResponse = true;
    }
  ],
  methods: {
    getSummary: function(){
      const summary = {};

      summary.statusCode = this.statusCode;
      if (this.error) summary.error = _.cloneDeep(this.error);

      return summary
    },
    getStatusCode : function(){ return this.statusCode },
    getPayload : function(){
      if (this.statusCode === 200) return _.cloneDeep(this.payload);
      throw Errio.parse(this.error);
    }
  }
});

const IncomingResponse = function(nats, service, rawResponse){
  // build the response
  const incomingResponse = stampit(Response, Privatize)(rawResponse);

  // extend response with additional methods
  // TODO
  incomingResponse.sendRequest = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingResponse.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };

  incomingResponse.sendNotice = function(message){
    return new Promise((resolve) => {
      // build outgoing notice
      return resolve(Notice(_.extend({ service: service.getFullName(), tx: incomingResponse.getTx() }, message)));
    })
      .then(makeSendNotice(nats, service))
  };

  return incomingResponse;
};

const isNotice = function(notice){
  try {
    isMessage(notice);
    assert(notice.payload, 'payload is required in Notice');
    assert(notice.isPaipNotice, 'isPaipNotice is required in Notice');

    return true
  }
  catch(e){
    // TODO log it ?
    return false
  }
};

const Notice = stampit(Message, {
  initializers: [
    function({ subject, payload, service,  }) {

      assert(payload, "payload is required to create a Notice object");
      this.payload = payload;
      // namespace notice messages under service namespace
      this.subject = service + '.' + subject;

      this.isPaipNotice = true;
    },
    function({ subject, isPaipNotice  }) {

      // if this is object is already a paipNotice there is no need to namespace the subject once again
      if (isPaipNotice) {
        this.subject = subject;
      }

      this.isPaipNotice = true;
    },
    function({ isLog  }) {

      // if this is a log notice just prepend the subject with LOG namespace
      if (isLog) {
        this.subject = '__LOG.' + this.subject;
      }

      this.isPaipNotice = true;
    }
  ],
  methods: {
    getSummary: function(){
      const summary = {};

      summary.service = this.service;
      summary.subject = this.subject;

      return summary
    },
    getPayload: function() { return _.cloneDeep(this.payload)}
  }
});

const IncomingNotice = function(nats, service, rawNotice){
  // build the notice
  const incomingNotice = stampit(Notice, Privatize)(rawNotice);

  // extend notice with additional methods

  incomingNotice.sendRequest = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingNotice.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };

  incomingNotice.sendNotice = function(message){
    return new Promise((resolve) => {
      // build outgoing notice
      return resolve(Notice(_.extend({ service: service.getFullName(), tx: incomingNotice.getTx() }, message)));
    })
      .then(makeSendNotice(nats, service))
  };

  return incomingNotice;
};

const Nats = stampit({
  initializers: [
    function({ nats, timeout, logger }) {

      nats = process.env.PAIP_NATS || nats;
      timeout = process.env.PAIP_TIMEOUT || timeout;

      function parse(nats){
        // check if it is an array
        if (_.isArray(nats)) return nats;
        // try to parse in case is a stringified array
        try{
          return JSON.parse(nats);
        }catch(e){}
        // try to split it into an array in case is a comma separated list of servers
        try{
          // split any comma separated url
          return nats.split(',')
          // trim any whitespace
            .map(url => url.trim());
        }catch(e){}

        throw new Error('unsupported nats configuration format')
      };

      if (nats) {
        this.options = R.mergeDeepLeft(this.options, { servers: parse(nats) });
      }

      if (timeout) this.timeout = timeout;

      this.logger = logger.child({ component: 'Nats' })
    }
  ],
  methods: {
    connect() {
      return new Promise((resolve, reject) => {
        const logger = this.logger;

        this.socket = NATS.connect(this.options);

        this.socket.once('connect', function(){
          logger.child().set({ message: 'connected'}).trace();
          resolve();
        });

        this.socket.once('error', function(e){
          logger.child().set({ message: 'error'}).error(e);
          reject(e);
        });

        this.socket.on('disconnect', function() {
          logger.child().set({ message: 'disconnected'}).warn();
        });

        this.socket.on('reconnecting', function() {
          logger.child().set({ message: 'reconnecting'}).warn();
        });

        this.socket.on('reconnect', function(nc) {
          logger.child().set({ message: 'reconnected'}).info();
        });

        this.socket.on('close', function() {
          const err = new Error('Unable to reconnect to Nats');
          logger.child().set({ message: 'reconnected'}).error(err);
          throw err
        });

      });
    },
    shutdown(){
      return new Promise((resolve, reject) => {
        const nats = this.socket;
        const logger = this.logger;

        nats.flush(function() {
          nats.close();
          logger.child().set({ message: 'shutdown'}).trace();
          resolve();
        });
      })
    },
    sendRequest(request) {
      return new Promise((resolve, reject) => {
        const logger = this.logger;

        assert(_.isObject(request), 'request must be an object in SendRequest');
        assert(_.isString(request.subject), 'request.subject must be a string in SendRequest');
        this.socket.requestOne(
          request.subject,
          request,
          {},
          this.timeout,
          response => {
            // if response its NATS error throw it so we can wrap it around a paipResponse Object
            if (response instanceof NATS.NatsError) {
              logger.child().set({ message: 'received response', request, response }).trace();
               reject(response);
            }
            logger.child().set({ message: 'received response', request, response }).trace();
            return resolve(response);
          }
        );
        logger.child().set({ message: 'sent Request', request }).trace();
      });
    },
    sendResponse(replyTo, response) {
      return new Promise((resolve, reject) => {
        const logger = this.logger;

        this.socket.publish(replyTo, response, () => {
          logger.child().set({ message: 'sent Response', response }).trace();
          resolve();
        });
      });
    },
    sendNotice(notice) {
      const logger = this.logger;

      return new Promise((resolve) => {
        assert(_.isObject(notice), 'message must be an object in sendNotice');
        assert(_.isString(notice.subject), 'message.subject must be a string in sendNotice');
        this.socket.publish(notice.subject, notice, () => {
          logger.child().set({ message: 'sent Notice', notice }).trace();
          resolve();
        });
      });
    },
    expose(subject, queue, handler) {
      return new Promise((resolve, reject) => {
        const logger = this.logger;

        const sid = this.socket.subscribe(subject, { queue }, function(
          request,
          replyTo
        ) {
          // if no replyTo? ie. a broadcast message on this subject? simply discard the request
          if (!replyTo) {
            // TODO log it ?
            return;
          }
          // pass the request to the Paip handler
          handler(request, replyTo);
        });
        this.socket.flush(function() {
          logger.child().set({ message: 'Subscribed Expose Method', subject, queue }).trace();
          resolve(sid);
        });
      })
    },
    observe(subject, queue, handler){
      return new Promise((resolve) => {
        const logger = this.logger;

        const sid =  this.socket.subscribe(subject, { queue }, handler);

        this.socket.flush(function() {
          logger.child().set({ message: 'Subscribed Observe Method', subject, queue }).trace();
          resolve(sid);
        });
      });
    }
  },
  props: {
    options: {
      json: true
    },
    timeout: 25000
  }
});

const Service = stampit({
  initializers: [
    function({ namespace, name }) {

      name = process.env.PAIP_NAME || name;
      namespace = process.env.PAIP_NAMESPACE || namespace;

      assert(name, "name is required to initialize a Service");

      // build the full service
      this.name = name;
      this.namespace = namespace;
      this.fullName = this.namespace
        ? this.namespace + "." + this.name
        : this.name;
    }
  ],
  methods: {
    getFullName: function() {
      return this.fullName;
    }
  }
});

const Handler = stampit({
  initializers: [
    function({ subject, handler, fullServiceName }) {

      assert(subject, "subject is required in a Handler");
      assert(
        typeof subject === "string",
        "subject must be a string in a Handler"
      );
      assert(typeof handler === "function", "handler is required in a Handler");
      assert(fullServiceName, "fullServiceName is required in a Handler");
      assert(
        typeof fullServiceName === "string",
        "fullServiceName must be a string in a Handler"
      );

      this.subject = subject;
      this.handler = handler;
      this.fullServiceName = fullServiceName;
    }
  ],
  methods: {
    get: function(){
      return JSON.parse(JSON.stringify(this))
    },
    getSubject(){ return this.subject },
    getFullSubject() { return this.fullSubject },
    getQueue(){ return this.queue },
    getHandler(){ return this.handler }
  }
});

const ExposeHandler = stampit(Handler, {
  initializers: [
    function({ subject, fullServiceName }) {

      // namespace subject under service full name cause we don't want a service to expose subjects outside its namespace
      this.fullSubject = fullServiceName + "." + subject;

      // the name of the queue map to the full name of the service + expose to distinguish from observe subscriptions
      this.queue = fullServiceName + ".__EXPOSE__"
    }
  ],
  methods: {
    expose(nats, service){
      const that = this;
      // call the expose and register callback handler
      return nats.expose(that.getFullSubject(), that.getQueue(), function(request, replyTo){
        // discard any message that is not a paip request
        if (!isRequest(request))
          return;
        // TODO wrap request in Request interface!
        // we need to build the incomingRequest
        const incomingRequest = IncomingRequest(nats, service, request );
        return Promise.resolve(incomingRequest)
        // pass the request to the handler
          .then(that.handler)
          .then(rawResponse => {
            // if this is already an incomingResponse object just get its payload (an exposed method make another request and return its response directly)
            if (isIncomingResponse(rawResponse))
              return rawResponse.getPayload();
            return rawResponse;
          })
          // build the response both if it was successful or not
          .then(rawResponse => Response({
            service: service.getFullName(),
            payload: rawResponse,
            tx: incomingRequest.getTx(),
            to: incomingRequest.getService(),
            subject: incomingRequest.getSubject()
          }))
          .catch(rawResponse => Response({
            service: service.getFullName(),
            error: rawResponse,
            to: incomingRequest.getService(),
            tx: incomingRequest.getTx(),
            subject: incomingRequest.getSubject()
          }))

          // send it back to the caller
          .then(outgoingResponse => {
            nats.sendResponse(replyTo, outgoingResponse);

            // build the subject where to publish service logs
            const logSubject = "__EXPOSE__" + '.' + that.getSubject();
            const notice = Notice({
              isLog: true,
              subject: logSubject,
              payload: {request: request, response: outgoingResponse},
              tx: incomingRequest.getTx(),
              service: service.getFullName()
            });
            // also publish the tuple request response for monitoring
            nats.sendNotice(notice);

            // log it to console
            service.logger.child()
              .set({ message: 'sent Response'})
              .set({ request: Request(request).get()})
              .set({ response: Response(outgoingResponse).get()}).debug();

            // log it to console
            service.logger.child()
              .set({ message: 'sent Response'})
              .set({ request: Request(request).getSummary()})
              .set({ response: Response(outgoingResponse).getSummary()}).info();
          })
      })
        .then(sid => {
          that.subscriptionId = sid;
        })
    }
  }
});

const ObserveHandler = stampit(Handler, {
  initializers: [
    function({ subject, fullServiceName }) {

      // when observing no need to namespace as we should be free to observe other services subject
      this.fullSubject = subject;

      // the name of the queue map to the full name of the service + observe to distinguish from expose subscriptions
      this.queue = fullServiceName + ".__OBSERVE__"
    }
  ],
  methods: {
    observe(nats, service){
      const that = this;
      return nats.observe(that.getFullSubject(), that.getQueue(), function(notice){
        // discard any message that is not a paip notice
        if (!isNotice(notice))
          return;
        // we need to build the incomingRequest
        return Promise.resolve(IncomingNotice( nats, service, notice ))
          .then(IncomingNotice => {
            // pass the request to the handler
            return Promise.resolve(IncomingNotice)
              .then(that.handler)
            // build the response both if it was successful or not
              .then(payload => {
                return Response({
                  service: service.getFullName(),
                  payload: payload,
                  tx: IncomingNotice.getTx(),
                  subject: IncomingNotice.getSubject()
                })
              })
              .catch(error => Response({
                service: service.getFullName(),
                error: error,
                tx: IncomingNotice.getTx(),
                subject: IncomingNotice.getSubject()
              }))
              .then(response => {
                // build the subject where to publish service logs
                const logSubject = "__OBSERVE__" + '.' + IncomingNotice.getSubject();
                const log = Notice({
                  isLog: true,
                  subject: logSubject,
                  payload: {request: IncomingNotice.get(), response: response},
                  tx: IncomingNotice.getTx(),
                  service: service.getFullName()
                });

                if (notice.subject.startsWith('__LOG')){
                  // unless we are observing a log entry otherwise we risk an observe loop
                }
                else{
                  // publish the tuple request response for monitoring
                  nats.sendNotice(log);
                }

                // log it to console
                service.logger.child()
                  .set({ message: 'received Notice'})
                  .set({ notice: log}).debug()

                // log it to console
                service.logger.child()
                  .set({ message: 'received Notice'})
                  .set({ notice: log.getSummary()}).info()
              })
          })
          .catch(e => {
            console.log(e)
          })
      })
        .then(sid => {
          that.subscriptionId = sid;
        })
    }
  }
}).compose(Handler);

const makeSendRequest = (nats, service) =>
    outgoingRequest => {
      return nats.sendRequest(outgoingRequest)
        // if there was an error sending the request, typically a NATS timeout error wrap it around a Response Object
        .catch(err => Response({
          service: outgoingRequest.getService(),
          error: err,
          tx: outgoingRequest.getTx(),
          to: outgoingRequest.getService(),
          subject: outgoingRequest.getSubject()
        }))
        // build incoming response and return it to the caller
        .then(rawResponse => Response(rawResponse))
        .then(rawResponse => {
          // build the subject where to publish service logs
          const logSubject = "__REQUEST__" + '.' + rawResponse.getSubject();

          // also publish the tuple request response for monitoring
          nats.sendNotice(Notice({
            isLog: true,
            subject: logSubject,
            payload: { request: outgoingRequest, response: rawResponse },
            tx: outgoingRequest.getTx(),
            service: service.getFullName()
          }));

          // log it to console
          service.logger.child()
            .set({ message: 'sent Request'})
            .set({ request: outgoingRequest.get()})
            .set({ response: rawResponse.get()}).debug();

          // log it to console
          service.logger.child()
            .set({ message: 'sent Request'})
            .set({ request: outgoingRequest.getSummary()})
            .set({ response: rawResponse.getSummary()}).info();

          return IncomingResponse(nats, service, rawResponse)
        })
};

const makeSendNotice = (nats, service) =>
  outgoingNotice => {
    return nats.sendNotice(outgoingNotice)
      .then(() => {
        // log it to console
        service.logger.child()
          .set({ message: 'sent Notice'})
          .set({ notice: outgoingNotice.get()}).debug();

        // log it to console
        service.logger.child()
          .set({ message: 'sent Notice'})
          .set({ notice: outgoingNotice.getSummary()}).info();
      })
  };

// this is the only exposed function
const Paip = function( options = {} ){

  // initialize paip service details
  const _service = Service( options );

  const _logger = Logger(options).set({service: _service.getFullName()});

  // extend service with logger
  _service.logger = _logger;

  // initialize nats Interface extending options with logger
  const _nats = Nats(_.extend({logger: _logger}, options));

  const _exposeHandlers = {};
  const _observeHandlers = {};

  // send the request at request.subject and return a response object
  const sendRequest = function(request){
    return new Promise((resolve, reject) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: _service.getFullName() }, request)));
    })
      .then(makeSendRequest(_nats, _service))
  };

  // send the notice at message.subject, namespaced under service full name and return nothing
  const sendNotice = function(message){
    return new Promise((resolve, reject) => {
      // build outgoing request
      return resolve(Notice(_.extend({ service: _service.getFullName() }, message)))
    })
      .then(makeSendNotice(_nats, _service))
  };

  // expose subject under service full name to listen for request messages
  const expose = function(subject, handler){
    // add this handler to the expose handler list
    _exposeHandlers[subject] = ExposeHandler({
      subject,
      handler,
      fullServiceName: _service.getFullName()
    });
  };

  // observe subject for notice messages
  const observe = function(subject, handler){
    // add this handler to the expose handler list
    _observeHandlers[subject] = ObserveHandler({
      subject,
      handler,
      fullServiceName: _service.getFullName()
    });
  };

  // return a promise that resolve once the paip service is ready
  const ready = function(){
    return _nats
      .connect()
      .then(() => _logger.child().set({ message: 'connected to nats'}).info())
      .then(() =>
        Promise.all(
          Object.keys(_exposeHandlers).map(handlerName =>
            // subscribe all expose handlers
            _exposeHandlers[handlerName].expose( _nats, _service)
              .then(() => _logger.child().set({ message: 'Registered Expose handler', handler:  _exposeHandlers[handlerName].get()}).info())
          )
        )
      )
      .then(() =>
        Promise.all(
          Object.keys(_observeHandlers).map(handlerName =>
            // subscribe all expose handlers
            _observeHandlers[handlerName].observe(_nats, _service)
              .then(() => _logger.child().set({ message: 'Registered Observe handler', handler: _observeHandlers[handlerName].get() }).info())
          )
        )
      )
      .then(() => _logger.child().set({ message: 'Paip ready' }).info())
  };

  const shutdown = function(){
    return _nats.shutdown()
      .then(() => _logger.child().set({ message: 'Paip shutdown' }).info())
  };

  return {
    expose,
    observe,
    ready,
    sendRequest,
    sendNotice,
    shutdown,
    getFullName: _service.getFullName.bind(_service)
  }
};

const utils = {

  get: function(o){ return o.get()},

  getSubject: function(o){ return o.getSubject() },

  setSubject: R.curry(function(subject, o){ return o.setSubject() }),

  getTx: function(o){ return o.getTx() },

  setTx: R.curry(function(tx, o){ return o.setTx(tx) }),

  getService: function(o){ return o.getService() },

  setService: R.curry(function(service, o){ return o.setService(service) }),

  getMetadata: function(o){ return o.getMetadata() },

  setMetadata: R.curry(function(metadata, o){ return o.setMetadata(metadata) }),

  mergeMetadata: R.curry(function(metadata, o){ return o.mergeMetadata(metadata) }),

  getTime: function(o){ return o.getTime() },

  setTime: R.curry(function(time, o){ return o.setTime(time) }),

  getArgs: function(o){ return o.getArgs() },

  setArgs: R.curry(function(args, o){ return o.setArgs(args) }),

  getStatusCode : function(o){ return o.getStatusCode() },

  getPayload : function(o)
  {
    return o.getPayload() },

  sendRequest: R.curry(function(request, o){ return o.sendRequest(request) }),

  sendNotice: R.curry(function(notice, o){ return o.sendNotice(notice) }),

  ready: service => () => service.ready(),

  shutdown: service => () => service.shutdown(),
};

Paip.utils = utils;
Paip.Response = Response;

module.exports = Paip;