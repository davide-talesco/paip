const NATS = require("nats");
const uuidv4 = require("uuid/v4");
const stampit = require("@stamp/it");
const InstanceOf = require("@stamp/instanceof");
const Privatize = require("@stamp/privatize");
const R = require("ramda");
const Errio = require("errio");
const assert = require("assert");
Errio.setDefaults({ stack: true });

const LOG_LEVEL_MAP = {
  off: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20
};

const Nats = stampit({
  initializers: [
    function({ options, timeout, logger }) {
      if (options) this.options = R.mergeDeepLeft(this.options, options);
      if (timeout) this.timeout = timeout;
      if (logger) this.logger = logger;
    }
  ],
  methods: {
    connect() {
      // create a new logger instance
      const log = this.logger
        .child()
        .set({ component: "nats", api: "connect" });

      this.connection = NATS.connect(this.options);

      this.connection.on("error", function(err) {
        log
          .child()
          .set({ message: "Nats Connection Error" })
          .error(err);
      });

      this.connection.on("connect", function(nc) {
        log
          .child()
          .set({ message: "connected to Nats" })
          .info();
      });

      this.connection.on("disconnect", function(e) {
        log
          .child()
          .set({ message: "disconnected from Nats" })
          .warn();
      });

      this.connection.on("reconnecting", function() {
        log
          .child()
          .set({ message: "reconnecting to Nats" })
          .info();
      });

      this.connection.on("reconnect", function(nc) {
        log
          .child()
          .set({ message: "reconnected to Nats" })
          .info();
      });

      this.connection.on("close", function() {
        log
          .child()
          .set({ message: "closed Nats connection" })
          .warn();
      });


      return new Promise((resolve, reject)=>{
        var err;

        this.connection.once('connect', function(){
          resolve();
        });
        this.connection.once('error', function(e){
          err = e;
        });

        // set a timeout and if by then resolve has not yet been called crash it
        setTimeout(()=> {
          reject(Errio.fromObject(err || {message: 'Could not connect to Nats Server on start!'}))
        }, this.timeout)
      });
    },
    invoke(subject, request) {
      return new Promise(resolve => {
        this.connection.requestOne(
          subject,
          request,
          {},
          this.timeout,
          response => {
            return resolve(response);
          }
        );
      });
    },
    publish(subject, message) {
      return new Promise((resolve, reject) => {
        this.connection.publish(subject, message, () => {
          resolve();
        });
      });
    },
    expose(subject, queue, handler) {
      // make sure they are available in callbacks
      const nats = this.connection;
      // create a new logger instance
      const log = this.logger.child().set({ component: "nats", api: "expose" });

      nats.subscribe(subject, { queue }, function(request, replyTo) {
        // if no replyTo? ie. a broadcast message on this subject? simply discard the request
        if (!replyTo) {
          // we can reuse the same logger child instance
          log
            .set({ message: "request is missing replyTo subject", request })
            .warn();
          return;
        }
        // pass the request to the Paip handler
        handler(request, replyTo);

        // this function return nothing
      });
    },
    subscribe(subject, queue, handler) {
      const nats = this.connection;
      nats.subscribe(subject, { queue }, handler);
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
    function({ namespace, name, logLevel }) {
      assert(name, "name is required to initialize Paip service");

      if (logLevel) {
        assert(
          Object.keys(LOG_LEVEL_MAP).includes(logLevel),
          "logLevel must be one of LOG_LEVEL_MAP"
        );
        this.logLevel = LOG_LEVEL_MAP[logLevel];
      }

      // build the full service
      this.name = name;
      this.namespace = namespace;
      this.fullName = this.namespace
        ? this.namespace + "." + this.name
        : this.name;

      // Initialize the root logger
      this.logger = Logger({ service: this.fullName, logLevel: this.logLevel });
    }
  ],
  props: {
    logLevel: 30
  }
});

const Paip = stampit({
  initializers: [
    ({ name, namespace, logLevel }, { instance }) => {
      // merge environment variables if set
      name = process.env.PAIP_NAME || name;
      namespace = process.env.PAIP_NAMESPACE || namespace;
      logLevel = process.env.PAIP_LOG_LEVEL || logLevel;

      instance.service = Service({ name, namespace, logLevel });
    },
    ({ nats, timeout }, { instance }) => {
      // merge environment variables if set
      timeout = process.env.PAIP_TIMEOUT || timeout;
      nats = process.env.PAIP_NATS || nats;

      // nats option might be an object or a string so should try to parse it
      try {
        nats = JSON.parse(nats);
      } catch (e) {}

      instance.nats = Nats({
        options: nats,
        timeout,
        logger: instance.service.logger
      });
      // connect to NATS
      instance.nats.connect()
    }
  ],
  methods: {
    getConnection() {
      return this.nats.connection;
    },
    invoke(request) {
      const paip = this;
      // create a new logger instance
      const logger = this.service.logger
        .child()
        .set({ component: "paip", api: "invoke" });

      return new Promise(resolve => {
        // if subject is already a Request it means this is a related request being invoked
        // from within expose hence it is already a Request object
        if (request instanceof Request) {
          return resolve(request);
        }
        // else this is a new request
        // TODO update Request to accept only request
        return resolve(Request({ service: paip.service.name, request }));
      }).then(request => {
        // build the subject where to publish service logs like **SERVICENAME**.**_LOG**.`subject`
        const logSubject = paip.service.name + "._LOG." + request.subject;

        // publish it to subject and wait for the response
        return paip.nats
          .invoke(request.subject, request)
          .then(response => {
            // if response its NATS error throw it so we can wrap it around a paipResponse Object
            if (response instanceof NATS.NatsError) {
              // this is to monitor if request never left or timed out
              paip.nats.publish(
                logSubject,
                ErrorResponse({
                  service: paip.service.name,
                  request,
                  error: response
                })
              );

              throw response;
            }
            // parse response into a paipResponse object
            return IncomingResponse({ response });
          })
          .catch(err => {
            return ErrorResponse({
              service: paip.service.name,
              request,
              error: err
            });
          })
          .then(paipResponse => {
            if (/^2/.test("" + paipResponse.getStatusCode())) {
              // Status Codes equal 2xx
              logger
                .child()
                .set(RequestStatus({ request, response: paipResponse }))
                .info();
            } else if (/^4/.test("" + paipResponse.getStatusCode())) {
              // Status Codes equal 4xx
              logger
                .child()
                .set(RequestStatus({ request, response: paipResponse }))
                .warn();
            } else if (/^5/.test("" + paipResponse.getStatusCode())) {
              // Status Codes equal 5xx
              logger
                .child()
                .set(RequestStatus({ request, response: paipResponse }))
                .error();
            }

            // always log the full request - response couple
            logger
              .child()
              .set({ request, response: paipResponse })
              .debug();

            return paipResponse.getResult();
          });
      });
    },
    expose(subject, appHandler) {
      const paip = this;

      const logger = this.service.logger
        .child()
        .set({ component: "paip", api: "expose" });

      assert(subject, "subject is required when exposing a remote method");
      assert(
        typeof appHandler === "function",
        "appHandler is required and should be a function"
      );

      // the name of the queue map to the name of the service
      const queue = paip.service.fullName;

      // namespace subject under service full name
      const fullSubjectName = paip.service.fullName + "." + subject;

      // build the subject where to publish service logs like **SERVICENAME**.**_LOG**.`subject`
      const logSubject = paip.service.name + "._LOG." + subject;

      // subscribe to subject
      paip.nats.expose(fullSubjectName, queue, function(request, replyTo) {
        return Promise.resolve(request).then(request => {
          // build the IncomingRequestObject
          const incomingRequest = IncomingRequest({ paip: paip, request });
          // call application handler with IncomingPaipRequest
          return (
            Promise.resolve(incomingRequest)
              .then(appHandler)
              // build a paipResponse out of handler result
              .then(result =>
                OutgoingResponse({
                  service: paip.service.name,
                  request,
                  result
                })
              )
              // if any error build an ErrorPaipResponse
              .catch(err => {
                return ErrorResponse({
                  service: paip.service.name,
                  request,
                  error: err
                });
              })
              // send it back to the caller
              .then(response => {
                paip.nats.publish(replyTo, response);
                // also publish the tuple request response for monitoring
                paip.nats.publish(logSubject, { request, response });

                // also log it
                if (/^2/.test("" + response.getStatusCode())) {
                  // Status Codes equal 2xx
                  logger
                    .child()
                    .set({
                      IncomingRequest: RequestStatus({ request }),
                      OutgoingResponse: ResponseStatus({ response })
                    })
                    .info();
                } else if (/^4/.test("" + response.getStatusCode())) {
                  // Status Codes equal 4xx
                  logger
                    .child()
                    .set({
                      IncomingRequest: RequestStatus({ request }),
                      OutgoingResponse: ResponseStatus({ response })
                    })
                    .warn();
                } else if (/^5/.test("" + response.getStatusCode())) {
                  // Status Codes equal 5xx
                  logger
                    .child()
                    .set({
                      IncomingRequest: RequestStatus({ request }),
                      OutgoingResponse: ResponseStatus({ response })
                    })
                    .error();
                }
                // always log the full request - response couple in debug
                logger
                  .child()
                  .set({ request, response })
                  .debug();
              })
              // TODO this should never happen! but should we log it ?
              .catch(() => {})
          );
        });
      });

      logger
        .child()
        .set({ message: "Exposed local method", subject })
        .info();
    },
    broadcast(subject, payload, metadata = {}) {
      const paip = this;

      return new Promise(resolve => {
        resolve(BroadcastMessage({ subject, payload, metadata }));
      }).then(message => {
        return paip.nats.publish(subject, message);
      });
    },
    observe(subject, handler) {
      const paip = this;

      assert(subject, "subject is required when observing");
      assert(
        typeof handler === "function",
        "handler is required and should be a function"
      );

      // the name of the queue map to the name of the service
      const queue = paip.service.fullName;

      this.nats.subscribe(subject, queue, function(message) {
        Promise.resolve(message).then(handler);
        // TODO should we catch ?
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        const connection = this.nats.connection;
        connection.flush(function() {
          connection.close();
          resolve();
        });
      });
    }
  }
}).compose(Privatize);

const BroadcastMessage = stampit({
  initializers: [
    function({ subject, payload, metadata }) {
      if (subject) this.subject = subject;
      if (payload) this.payload = payload;
      if (metadata) this.metadata = metadata;

      assert(this.subject, "subject must exists in Broadcast Message");
      assert(this.payload, "payload must exists in Broadcast Message");

      if (!this.transactionId) this.transactionId = uuidv4();
      this.time = new Date();
    }
  ]
});

const IncomingRequest = stampit({
  initializers: [
    function({ paip, request }) {
      // request should be a valid request
      if (request) this.request = R.clone(request);
      if (paip) this.paip = paip;

      assert(this.paip, "paip must exists in Request object");
      assert(this.request, "request must exists in Request object");
    }
  ],
  methods: {
    getArgs() {
      return this.request.args;
    },
    getMetadata() {
      return this.request.metadata;
    },
    getTransactionId() {
      return this.request.tx;
    },
    invoke(request) {
      return this.paip.invoke(
        Request({
          service: this.paip.service.name,
          request,
          tx: this.request.tx
        })
      );
    }
  }
});

const RequestStatus = stampit({
  initializers: [
    function({ request }) {
      this.service = request.service;
      this.subject = request.subject;
      this.tx = request.tx;
    }
  ]
});

const ResponseStatus = stampit({
  initializers: [
    function({ response }) {
      this.service = response.service;
      this.statusCode = response.statusCode;
      if (response.error) {
        this.error = response.error;
      }
    }
  ]
});

const Request = stampit({
  initializers: [
    function({ service, request, tx }) {
      if (request) {
        this.args = request.args;
        this.subject = request.subject;
        this.metadata = request.metadata;
      }
      if (service) this.service = service;
      if (tx) this.tx = tx;

      if (!this.tx) this.tx = uuidv4();
      this.time = new Date();
      if (!this.args) this.args = [];

      assert(this.service, "service must exists in Request object");
      assert(this.subject, "subject must exists in Request object");
      assert(
        Array.isArray(this.args),
        "args if exists must be an Array in Request object"
      );
    }
  ],
  props: {
    args: []
  }
}).compose(InstanceOf);

const Response = stampit({
  initializers: [
    function({ service, subject, tx, time, result, statusCode }) {
      // required props
      if (service) this.service = service;
      if (subject) this.subject = subject;
      if (tx) this.tx = tx;
      if (time) this.time = time;
      if (statusCode) this.statusCode = statusCode;

      // optional props
      if (result) this.result = result;

      assert(this.service, "service must exists in Response object");
      assert(this.subject, "subject must exists in Response object");
      assert(this.tx, "tx must exists in Response object");
      assert(this.time, "time must exists in Response object");
      assert(this.statusCode, "statusCode must exists in Response object");
    }
  ],
  methods: {
    getResult() {
      if (this.error) throw Errio.fromObject(this.error);

      return this.result;
    },
    getStatusCode() {
      return this.statusCode;
    }
  }
});

const IncomingResponse = stampit({
  initializers: [
    function({ response }) {
      Object.keys(response).map(n => (this[n] = response[n]));
    }
  ]
}).compose(Response);

const OutgoingResponse = stampit({
  initializers: [
    function({ request, result }) {
      if (result) this.result = result;
      // set request related props
      this.tx = request.tx;
      this.subject = request.subject;
      this.statusCode = 200;
      this.time = new Date();
    }
  ]
}).compose(Response);

const ErrorResponse = stampit({
  initializers: [
    function({ request, error }) {
      if (request) {
        if (request.subject) this.subject = request.subject;
        if (request.tx) this.tx = request.tx;
      }
      if (error) {
        this.error = JSON.parse(Errio.stringify(error));
        error.statusCode
          ? (this.statusCode = error.statusCode)
          : (this.statusCode = 500);
        this.error.statusCode = this.statusCode;
      }
      // set time
      this.time = new Date();
    }
  ]
}).compose(Response);

const Logger = stampit({
  initializers: [
    function({ service, logLevel }) {
      // initialize options and payload
      //this.options = {};
      this._payload = {};

      if (service) {
        this.options.service = service;
        // also set it in the payload
        this._payload.service = service;
      }
      if (logLevel) {
        this.options.logLevel = logLevel;
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
      if (err) this._payload.error = err;
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
      // 20 === debug, 30 === info , 40 === warn, 50 === error
      logLevel: 30
    }
  }
});

module.exports = Paip;