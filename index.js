const stampit = require("@stamp/it");
const Privatize = require("@stamp/privatize");
const uuidv4 = require("uuid/v4");
const R = require("ramda");
const NATS = require("nats");
const _ = require("lodash");
const assert = require('assert');
const Errio = require("errio");
Errio.setDefaults({ stack: true });

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
  incomingRequest.request = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingRequest.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };

  incomingRequest.notice = function(message){
    return new Promise((resolve) => {
      // build outgoing request
      const outgoingNotice = Notice(_.extend({ service: service.getFullName(), tx: incomingRequest.getTx() }, message));

      return nats.sendNotice(outgoingNotice)
        .then(resolve)
    });
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
        this.error = JSON.parse(Errio.stringify(error));
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
    getStatusCode : function(){ return this.statusCode },
    getPayload : function(){
      if (this.statusCode === 200) return _.cloneDeep(this.payload);
      throw Errio.fromObject(this.error);
    }
  }
})

const IncomingResponse = function(nats, service, rawResponse){
  // build the response
  const incomingResponse = stampit(Response, Privatize)(rawResponse);

  // extend response with additional methods
  // TODO
  incomingResponse.request = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingResponse.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };
  incomingResponse.notice = function(message){
    return new Promise((resolve) => {
      // build outgoing notice
      const outgoingNotice = Notice(_.extend({ service: service.getFullName(), tx: incomingResponse.getTx() }, message));

      return nats.sendNotice(outgoingNotice)
        .then(resolve)
    });
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
    function({ subject, payload, service }) {

      assert(payload, "payload is required to create a Notice object");
      this.payload = payload;
      // namespace notice messages under service namespace
      this.subject = service + '.' + subject;

      this.isPaipNotice = true;
    }
  ],
  methods: {
    getPayload: function() { return _.cloneDeep(this.payload)}
  }
});

const IncomingNotice = function(nats, service, rawNotice){
  // build the notice
  const incomingNotice = stampit(Notice, Privatize)(rawNotice);

  // extend notice with additional methods
  // TODO
  incomingNotice.request = function(request){
    return new Promise((resolve) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: service.getFullName(), tx: incomingNotice.getTx() }, request)));
    })
      .then(makeSendRequest(nats, service))
  };

  incomingNotice.notice = function(message){
    return new Promise((resolve) => {
      // build outgoing notice
      const outgoingNotice = Notice(_.extend({ service: service.getFullName(), tx: incomingNotice.getTx() }, message));

      return nats.sendNotice(outgoingNotice)
        .then(resolve)
    });
  };

  return incomingNotice;
};

const Nats = stampit({
  initializers: [
    function({ nats, timeout }) {
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
    }
  ],
  methods: {
    connect() {
      return new Promise((resolve, reject) => {

        this.nats = NATS.connect(this.options);

        this.nats.once('connect', function(){
          resolve();
        });

        this.nats.once('error', function(e){
          reject(e);
        });

      });
    },
    shutdown(){
      return new Promise((resolve, reject) => {
        const nats = this.nats;
        nats.flush(function() {
          nats.close();
          resolve();
        });
      })
    },
    sendRequest(request) {
      return new Promise((resolve, reject) => {
        assert(_.isObject(request), 'request must be an object in SendRequest');
        assert(_.isString(request.subject), 'request.subject must be a string in SendRequest');
        this.nats.requestOne(
          request.subject,
          request,
          {},
          this.timeout,
          response => {
            // if response its NATS error throw it so we can wrap it around a paipResponse Object
            if (response instanceof NATS.NatsError) {
               reject(response);
            }
            return resolve(response);
          }
        );
      });
    },
    sendResponse(replyTo, response) {
      return new Promise((resolve, reject) => {
        this.nats.publish(replyTo, response, () => {
          resolve();
        });
      });
    },
    sendNotice(message) {
      return new Promise((resolve) => {
        assert(_.isObject(message), 'message must be an object in sendNotice');
        assert(_.isString(message.subject), 'message.subject must be a string in sendNotice');
        this.nats.publish(message.subject, message, () => {
          resolve();
        });
      });
    },
    expose(subject, queue, handler) {
      return new Promise((resolve, reject) => {

        const sid = this.nats.subscribe(subject, { queue }, function(
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
        this.nats.flush(function() {
          resolve(sid);
        });
      })
    },
    observe(subject, queue, handler){
      return new Promise((resolve) => {
        const sid =  this.nats.subscribe(subject, { queue }, handler);

        this.nats.flush(function() {
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
      this.queue = fullServiceName + "-expose"
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
          .catch(err => {
            throw err;
          })
          // send it back to the caller
          .then(outgoingResponse => {
            nats.sendResponse(replyTo, outgoingResponse);

            // build the subject where to publish service logs
            const logSubject = "_LOG.EXPOSE" + '.' + that.getSubject();

            // also publish the tuple request response for monitoring
            nats.sendNotice(Notice({
              subject: logSubject,
              payload: {request: request, response: outgoingResponse},
              tx: incomingRequest.getTx(),
              service: service.getFullName()
            }));
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
      this.queue = fullServiceName + "-observe"
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
        // pass the request to the handler
          .then(that.handler)
          // discard any kind of handler return values
          .then(() => {})
          .catch(() => {})
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
          const logSubject = "_LOG.REQUEST" + '.' + rawResponse.getSubject();

          // also publish the tuple request response for monitoring
          nats.sendNotice(Notice({
            subject: logSubject,
            payload: { request: outgoingRequest, response: rawResponse },
            tx: outgoingRequest.getTx(),
            service: service.getFullName()
          }));

          return IncomingResponse(nats, service, rawResponse)
        })
};

// this is the only exposed function
const Paip = function( options ){

  // initialize nats Interface
  const _nats = Nats(options);

  // initialize paip service details
  const _service = Service( options );

  const _exposeHandlers = {};
  const _observeHandlers = {};

  // send the request at request.subject and return a response object
  const request = function(request){
    return new Promise((resolve, reject) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: _service.getFullName() }, request)));
    })
      .then(makeSendRequest(_nats, _service))
  };

  // send the notice at message.subject, namespaced under service full name and return nothing
  const notice = function(message){
    return new Promise((resolve, reject) => {
      // build outgoing request
      const outgoingNotice = Notice(_.extend({ service: _service.getFullName() }, message));

      return _nats.sendNotice(outgoingNotice)
        .then(resolve)
    });
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
      .then(() =>
        Promise.all(
          Object.keys(_exposeHandlers).map(handlerName =>
            // subscribe all expose handlers
            _exposeHandlers[handlerName].expose( _nats, _service)
          )
        )
      )
      .then(() => {
        Promise.all(
          Object.keys(_observeHandlers).map(handlerName =>
            // subscribe all expose handlers
            _observeHandlers[handlerName].observe(_nats, _service)
          )
        )
      })
  };

  const shutdown = function(){
    return _nats.shutdown();
  };

  return {
    request,
    notice,
    observe,
    expose,
    ready,
    shutdown
  }
};

const msg = {

  get: function(o){ return o.get()},

  getSubject: function(o){ return o.getSubject() },

  setSubject: R.curry(function(subject, o){ return o.setSubject() }),

  getTx: function(o){ return o.getTx() },

  setTx: R.curry(function(tx, o){ return o.setTx(tx) }),

  getService: function(o){ return o.getService() },

  setService: R.curry(function(service, o){ return o.setService(service) }),

  getMetadata: function(o){ return o.getMetadata() },

  setMetadata: R.curry(function(metadata, o){ return o.setMetadata(metadata) }),

  getTime: function(o){ return o.getTime() },

  setTime: R.curry(function(time, o){ return o.setTime(time) }),

  getArgs: function(o){ return o.getArgs() },

  setArgs: R.curry(function(args, o){ return o.setArgs(args) }),

  getStatusCode : function(o){ return o.getStatusCode() },

  getPayload : function(o){ return o.getPayload() },

  sendRequest: R.curry(function(request, o){ return o.sendRequest(request) }),

  sendNotice: R.curry(function(notice, o){ return o.sendNotice(notice) })
};

module.exports = {
  Paip: Paip,
  msg: msg
};