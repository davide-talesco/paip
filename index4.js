const stampit = require("@stamp/it");
const Privatize = require("@stamp/privatize");
const uuidv4 = require("uuid/v4");
const Errio = require("errio");
const R = require("ramda");
const NATS = require("nats");
const _ = require("lodash");
const assert = require('assert');

const isMessage = function(message){
  assert(message.subject, 'subject is required in Message');
  assert(message.metadata, 'metadata is required in Message');
  assert(message.time, 'time is required in Message');
  assert(message.service, 'service is required in Message');
};

const Message = stampit({
  initializers: [
    function({ subject,  metadata = {}, tx, service,  time }) {
      assert(subject, "subject is required to create a Request object");
      assert(service, "service is required to create a Request object");

      this.subject = subject;

      this.tx = tx || uuidv4();
      this.service = service;
      this.time = time || new Date();
      this.metadata = metadata;
    }
  ],
  methods: {
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
const Request = stampit({
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
}).compose(Message);

const IncomingRequest = function(nats, service, rawRequest){
  // build the request
  const request = stampit(Request, Privatize)(rawRequest);

  // extend request with additional methods
  // TODO
  request.sendRequest = function(){};
  request.sendNotice = function(){};

  return request;
};

const isResponse = function(response){
  try {
    isMessage(response);
    assert(response.statusCode);
    assert(response.isPaipResponse);
    assert(response.error || response.payload)

    return true
  }
  catch(e){
    // TODO log it ?
    return false
  }
};

const Response = stampit({
  initializers: [
    function({ error, payload }){
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
}).compose(Message);

const IncomingResponse = function(nats, service, rawResponse){
  // build the response
  const response = stampit(Response, Privatize)(rawResponse);

  // extend response with additional methods
  // TODO
  response.sendRequest = function(){};
  response.sendNotice = function(){};

  return response;
};

const isNotice = function(notice){
  try {
    isMessage(notice);
    assert(notice.payload, 'payload is required in Notice');

    return true
  }
  catch(e){
    // TODO log it ?
    return false
  }
};

const Notice = stampit({
  initializers: [
    function({ payload }) {

      this.payload = payload;

      assert(payload, "payload is required to create a Notice object");

    }
  ],
  methods: {
    getPayload: function() { return _.cloneDeep(this.payload)}
  }
}).compose(Message);

const IncomingNotice = function(nats, service, rawNotice){
  // build the notice
  const notice = stampit(Notice, Privatize)(rawNotice);

  // extend notice with additional methods
  // TODO
  notice.sendRequest = function(){};
  notice.sendNotice = function(){};

  return notice;
};

const Nats = stampit({
  initializers: [
    function({ nats, timeout }) {
      if (nats) {
        this.options = R.mergeDeepLeft(this.options, { servers: nats });
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
    sendRequest(request) {
      return new Promise(resolve => {
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
              throw response;
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
    function({ namespace = "", name }) {
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

const ExposeHandler = stampit({
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
          // build the response both if it was successful or not
          .then(rawResponse => Response({
            service: service.getFullName(),
            payload: rawResponse,
            tx: incomingRequest.getTx(),
            subject: incomingRequest.getSubject()
          }))
          .catch(rawResponse => Response({
            service: service.getFullName(),
            error: rawResponse,
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
            const logSubject = service.getFullName() + '.' + "_LOG.EXPOSE" + '.' + that.getSubject();

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
}).compose(Handler);

const ObserveHandler = stampit({
  initializers: [
    function({ subject }) {

      // when observing no need to namespace as we should be free to observe other services subject
      this.subject = subject;
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
        const incomingNotice = IncomingNotice( nats, service, notice );
        return Promise.resolve(incomingNotice)
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

module.exports = function( options ){

  // initialize nats Interface
  const _nats = Nats(options);

  // initialize paip service details
  const _service = Service( options );

  const _exposeHandlers = {};
  const _observeHandlers = {};

  // send the request at request.subject and return a response object
  const sendRequest = function(request){
    return new Promise((resolve, reject) => {
      // build outgoing request
      return resolve(Request(_.extend({ service: _service.getFullName() }, request)));
    })
    .then(outgoingRequest => {
      return _nats.sendRequest(outgoingRequest)
        // if there was an error sending the request, typically a NATS timeout error wrap it around a Response Object
        .catch(err => Response({
          service: outgoingRequest.getService(),
          error: err,
          tx: outgoingRequest.getTx(),
          subject: outgoingRequest.getSubject()
        }))
        // build incoming response and return it to the caller
        .then(rawResponse => Response(rawResponse))
        .then(rawResponse => IncomingResponse(_nats, _service, rawResponse))
    })
  };

  // send the notice at message.subject, namespaced under service full name and return nothing
  const sendNotice = function(message){
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

  return {
    sendRequest,
    sendNotice,
    observe,
    expose,
    ready
  }
};