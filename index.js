const NATS = require('nats');
const catNames = require('cat-names');
const uuidv4 = require('uuid/v4');
const shortid = require('shortid');
const stampit = require('stampit');
const Errio = require('errio');
Errio.setDefaults({stack:true});

const Nats = stampit({
  initializers: [configureNats],
  methods: {
    connect() {
      this.connection = NATS.connect(this.options);
      return this;
    },
    // TODO to make private ?
    request(request){
      // TODO we should be able to pass options like timeout if needed or revert to defaults

      return new Promise((resolve, reject) => {
        this.connection.requestOne(request.subject, request, {}, 100000, message => {
          // response can be an instance of NatsError
          if(message instanceof NATS.NatsError) {
            // TODO why if I throw the response instead it doesn't get catched by the invoker catch ?
            return reject(message);
          }
          if(message.statusCode !== 200){
            const test = Errio.fromObject(message)

            // we got an error from the remote service
            return reject(test);
          }
          resolve(message.payload)
        });
      });
    },
    publish(message){
      return new Promise((resolve, reject) => {
        this.connection.publish(message.subject, message, () => {
          resolve();
        });
      });
    },
    expose (namespacedSubject, queue, description, handler){
      // TODO we need to check if the connection exists and is valid
      // make sure nats is available in callbacks
      const nats = this.connection;

      // build the exposed subject
      const exposedSubject = namespacedSubject.baseSubjectSpace ? namespacedSubject.baseSubjectSpace + '.' + namespacedSubject.subject : namespacedSubject.subject;

      // build the subject to follow **BASE_SUBJECT_SPACE**.**_LOG**.`subject`
      const logSubject = namespacedSubject.baseSubjectSpace ? namespacedSubject.baseSubjectSpace + '._LOG.' + namespacedSubject.subject : '_LOG.' +namespacedSubject.subject;

      nats.subscribe(exposedSubject, {queue}, function(request, replyTo) {
        // TODO what happens if request is invalid. ie.
        // TODO what happen if no replyTo? ie. a broadcast message on this subject?
        // TODO what happen if handler return a response / error / throw error and not a promise
        // TODO what happen if the nats.publish fails? should we differentiate from when handler fails?

        Promise.resolve(request)
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
            // TODO how do we get the right subject where to write the request - response
            // also publish the tuple request response for monitoring


            nats.publish(logSubject, {request, response});
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
            nats.publish(logSubject, {request, response});
          })
      });

      // this function return nothing
    },
    subscribe (subject, queue, handler){
      const nats = this.connection;
      nats.subscribe(subject, {queue}, handler);
    }
  },
  props: {
    options: {
      json: true
    }
  }
});

const Service = stampit({
  initializers: [randomizeName],
  props: {
    name: ''
  }
});

const Paip = stampit({
  initializers: [
    ({nats}, { instance }) => {
     instance.nats = Nats({nats});
  },
    ({name, baseSubjectSpace}, { instance }) => {
     instance.service = Service({name, baseSubjectSpace});
  }],
  methods: {
    request() {
      return Request({nats: this.nats, service: this.service})
    },
    expose(subject, description, handler){
      // the name of the queue to join map to the service id (composed as BASE_SUBJECT_SPACE.SERVICE_NAME)
      const queue = this.service.id;
      // make sure nats is available within expose closure
      const nats = this.nats;
      const service = this.service;

      const namespacedSubject = {
        baseSubjectSpace: this.service.baseSubjectSpace,
        subject
      };

      this.nats.expose(namespacedSubject, queue, description, function(message){

        // we need to parse the request message into a Request Object
        const request = Request({
          nats: nats,
          service: service,
          transactionId: message.transactionId,
          subject: message.subject,
          args: message.args
        });

        return Promise.resolve(request)
          .then(handler);
      });
    },
    // TODO add the subject to sniff need first to fix issue @ line 69
    sniff(subject, handler){
      // the name of the queue to join map to the service id (composed as BASE_SUBJECT_SPACE.SERVICE_NAME)
      const queue = this.service.id;
      // TODO what happens if handler fails?
      this.nats.subscribe(subject, queue, function(msg){
        Promise.resolve(msg)
          .then(handler)
          .catch(console.error)
      })
    },
    close(){
      return new Promise((resolve, reject)=> {
        const connection = this.nats.connection;
        connection.flush(function() {
          connection.close();
        });
      });
    }
  }
});

const Request = stampit({
  initializers: [
    generateTransactionId,
    // this is to make the nats api available within the request closure
    function({nats}){
      this.nats = nats;
    },
    // this is to make the service api available within the request closure
    function({service}){
      this.service = service;
    },
    // this is to make sure args are initialized if passed
    function({args}){
      this.args = args;
    },
    // this is to make sure subject is initialized if passed
    function({subject}){
      this.subject = subject;
    }],
  props: {
    nats: {},
    service: {},
    subject: '',
    args: []
  },
  methods: {
    invoke(subject, ...args){
      // to call the invoke on the client
      const request = {
        subject,
        args,
        service: this.service.id,
        transactionId: this.transactionId
      };

      return this.nats.request(request)
    },
    broadcast(subject, payload){
      // to call the invoke on the client
      const message = {
        subject,
        service: this.service.id,
        payload: payload
      };

      return this.nats.publish(message)
    },
    getArgs(){ return this.args}
  }
});

// make sure a service always has name and id
function randomizeName({name, baseSubjectSpace}) {
  if (name) {
    this.name = name
  }
  else {
    this.name = catNames.random() + '-' + shortid.generate()
  };

  if (baseSubjectSpace) {
    this.baseSubjectSpace = baseSubjectSpace
  };

  this.id = this.baseSubjectSpace ? this.baseSubjectSpace + '.' + this.name : this.name
}

function configureNats({nats}){
  if (nats) this.options = nats;
}

function generateTransactionId({transactionId}){
  if (!transactionId) {
    this.transactionId = uuidv4()
  }
  else {
    this.transactionId = transactionId;
  }
}

module.exports = Paip;

/*
// client shoule be able to expose a function
client.expose('login', function(request){
  // once we get a request we should be able to extract its arguments
  const [username, password] = request.getArgs();
  // client can also make other request using the request object so the request keeps the same transactionId
  request.make('user', username)
  // response should be the payload of the response if the exposer returned an error it should be thrown
    .then(response => {

    })
  // no catch here as if this fails this is the error paip will return to the caller
});

// client can create a request send it
client.request().make('login', 'davide', '1234')
  .then(user => {})
  .catch(err => {})*/

