"use strict";
const _ = require("lodash");
const Paip = require("../index");
const Lab = require("lab");
const ldapjs = require('ldapjs');
var SuperError = require('super-error');
const { expect, fail } = require("code");

// Test files must require the lab module, and export a test script
const lab = (exports.lab = Lab.script());

// shortcuts to functions from lab
const experiment = lab.experiment;
const test = lab.test;

// some tests relay on time and this might cause tests to fail if nats is too slow to respond.
const delay = 200;

experiment("send Request API:", () => {
  const server = Paip({ name: "server", log: "off" });
  const client = Paip({ name: "client", log: "off" });

  lab.before(async () => {
    server.expose("echo", r => r.getArgs());
    await server.ready();
    await client.ready();
  });

  lab.after(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('send a request with no subject', async () => {
    try{
      await client.sendRequest({ args: [5, 4] });
      fail('This should never be executed');
    }
    catch(e){
      expect(e).to.be.an.error("subject is required to create a Message object");
    }
  });
  test('send a request with args not an array', async () => {
    const res = await client.sendRequest({ subject: "server.echo", args: 5 });
    expect(res.getPayload()).to.equal([5]);
  });
  test('send a simple request', async () => {
    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);
  });
});

experiment('expose API:', ()=> {
  var server;
  var client;

  lab.beforeEach(async () => {
    server = Paip({ name: "server", log: "off" });
    client = Paip({ name: "client", log: "off" });
  });

  lab.afterEach(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('expose a method that returns synchronously', async () => {

    server.expose("echo", r => r.getArgs());

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);

  });
  test('expose a method that returns asynchronously', async () => {

    server.expose("echo", r => new Promise(resolve => setTimeout(() => resolve(r.getArgs()), 100)));

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);

  });
  test('expose a method that throws synchronously', async () => {

    server.expose("echo", r => { throw new Error('sync') });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('sync')

  });
  test('expose a method that throws asynchronously', async () => {

    server.expose("echo", r => new Promise((resolve, reject) => setTimeout(() => reject( new Error('async')), 100)));

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('async')

  });
  test('expose a method that throws an LDAP Error', async () => {

    server.expose("echo", r => new Promise((resolve, reject) => setTimeout(() => reject( new ldapjs.InvalidCredentialsError()), 100)));

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('InvalidCredentialsError')

  });
  test('expose a method that throws a custom error should allow usage of instanceof [EXPECTED TO FAIL AT THE MOMENT]', async () => {
    var MyError = SuperError.subclass('MyError', function(code, message) {
      this.code = code;
      this.message = message;
    });

    var error = new MyError(420, 'Enhance Your Calm');

    server.expose("echo", r => new Promise((resolve, reject) => setTimeout(() => reject( error), 100)));

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    try {
      res.getPayload();
    }catch(e){

      expect(e).to.be.an.instanceof(MyError)
    }

  });
  test('receive a request with metadata', async () => {

    server.expose("echo", r => r.getMetadata());

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4], metadata: 'test' });
    expect(res.getPayload()).to.equal('test');

  });
  test('receive a request with custom transactionId', async () => {

    server.expose("echo", r => r.getMetadata());

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.echo", args: [5, 4], tx: 'test' });
    expect(res.getTx()).to.equal('test');

  });
  test('multiple instances of the same service will load balance requests', async()=>{
    const server2 = Paip({ name: "server", log: "off" });

    var count = 0;

    server.expose("echo", r => {
      count++;
    });
    server2.expose("echo", r => {
      count++;
    });

    await server.ready();
    await server2.ready();
    await client.ready();

    // send multiple request just to be sure
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });
    await client.sendRequest({ subject: "server.echo", args: [5, 4] });

    expect(count).to.equal(6);

    await server2.shutdown();
  });
  test('notice message does not trigger exposed method', async()=>{
    var count = 0;

    server.expose("echo", function(){
      count++;
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: "echo", payload: {} })
    await server.sendNotice({ subject: "echo", payload: {} })
    await server.sendNotice({ subject: "echo", payload: {} })

    expect(count).to.be.equal(0)
  });
});

experiment('send Notice API:', ()=> {
  var server;
  var client;

  lab.beforeEach(async () => {
    server = Paip({ name: "server", log: "off" });
    client = Paip({ name: "client", log: "off" });
  });

  lab.afterEach(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('send a simple notice', async()=>{

    client.observe("server.echo", function(notice){
      expect(notice.getPayload()).to.be.equal(1)
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: "echo", payload: 1 })

  });
  test('send a notice with no payload', async()=>{

    await server.ready();
    await client.ready();

    try{
      await server.sendNotice({ subject: "echo" })
    }catch(e){
      expect(e).to.be.an.error('payload is required to create a Notice object')
    }
  });
  test('send a notice with no subject', async()=>{

    await server.ready();
    await client.ready();

    try{
      await server.sendNotice({ payload: {} })
    }catch(e){
      expect(e).to.be.an.error('subject is required to create a Message object')
    }
  });
});

experiment('observe API:', ()=> {
  var server;
  var client;

  lab.beforeEach(async () => {
    server = Paip({ name: "server", log: "off" });
    client = Paip({ name: "client", log: "off" });
  });

  lab.afterEach(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('observe a notice with metadata', async()=>{

    client.observe("server.echo", function(notice){
      expect(notice.getMetadata()).to.be.equal(1)
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: "echo", payload: {}, metadata: 1 })
  });
  test('multiple instance of the same service will load balance observed notice messages', async()=>{
    const client2 = Paip({ name: "client", log: "off" });

    var count = 0;

    client.observe("server.echo", function(){
      ++count;
    });

    client2.observe("server.echo", function(){
      ++count;
    });

    await server.ready();
    await client.ready();
    await client2.ready();

    await server.sendNotice({ subject: "echo", payload: {} });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(count).to.be.equal(1)

    await client2.shutdown();
  });
  test('multiple different services will all get the notice message', async()=>{
    const client2 = Paip({ name: "client2", log: "off" });

    var count = 0;

    client.observe("server.echo2", function(){
      ++count;
    });

    client2.observe("server.echo2", function(notice){
      ++count;
    });

    await server.ready();
    await client.ready();
    await client2.ready();

    server.sendNotice({ subject: "echo2", payload: {} })

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(count).to.be.equal(2)

    await client2.shutdown();
  });
  test('request message does not trigger observed method', async()=>{
    var count = 0;

    server.expose('echo', function(){
      count++;
    });

    server.observe('server.echo', function(){
      count++;
    });

    await server.ready();
    await client.ready();

    await client.sendRequest({ subject: 'server.echo' });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(count).to.be.equal(1)
  })
});

experiment('transaction Id:', ()=> {
  var server;
  var client;

  lab.beforeEach(async () => {
    server = Paip({ name: "server", log: "off" });
    client = Paip({ name: "client", log: "off" });
  });

  lab.afterEach(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('a request sent via an incomingRequest keep same transaction Id', async () => {

    const proxy = Paip({ name: 'proxy', log: 'off'});

    proxy.expose('echo', function(r){
      return r.sendRequest({ subject: 'server.echo', args: r.getTx()})
    });

    server.expose('echo', function(r){
      const args = r.getArgs();
      args.push(r.getTx());
      return args;
    });

    await server.ready();
    await proxy.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: 'proxy.echo', tx: 1 });
    expect(res.getPayload()).to.be.equal([1, 1]);

    await proxy.shutdown()
  });
  test('a notice sent via an incomingRequest keep same transaction Id', async () => {
    var tx;

    server.expose('echo', async function(r){
      r.sendNotice({ subject: 'notice', payload: r.getTx()})
    });

    client.observe('server.notice', function(notice){
      tx = notice.getTx();
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: 'server.echo', tx: 1 });
    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal(1);
  });
  test('a request sent via an incomingNotice keep same transaction Id', async () => {
    var tx;

    server.expose('echo', async function(r){
      tx = r.getTx();
    });

    client.observe('server.notice', async function(notice){
      await notice.sendRequest({ subject: 'server.echo'})
    });

    await server.ready();
    await client.ready();

    const res = await server.sendNotice({ subject: 'notice', payload: {}, tx: 1 });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal(1);
  });
  test('a notice sent via an incomingNotice keep same transaction Id', async () => {
    var tx;

    server.observe('client.notice', async function(r){
      tx = r.getTx();
    });

    client.observe('server.notice', async function(notice){
      await notice.sendNotice({ subject: 'notice', payload: {}})
    });

    await server.ready();
    await client.ready();

    const res = await server.sendNotice({ subject: 'notice', payload: {}, tx: 1 });
    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal(1);
  });
  test('a request sent via an incomingResponse keep same transaction Id', async () => {
    var tx = [];

    server.expose('echo', async function(r){
      tx.push(r.getTx())
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: 'server.echo', tx: 1 });
    await res.sendRequest({ subject: 'server.echo'});

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal([1,1]);
  });
  test('a notice sent via an incomingResponse keep same transaction Id', async () => {
    var tx = [];

    server.expose('echo', async function(r){
      tx.push(r.getTx())
    });

    server.observe('client.echo', async function(r){
      tx.push(r.getTx())
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: 'server.echo', tx: 1 });
    await res.sendNotice({ subject: 'echo', payload: {}});

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal([1,1]);
  });
});

experiment('log notice messages using options:', ()=>{

  test('exposed method generates __LOG.<SERVICE_FULLNAME>.__EXPOSE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });
    const client = Paip({ name: "client", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });

    var expectedLog = {
      "subject": "__LOG.server.__EXPOSE__.echo",
      "metadata": {},
      "service": "server",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "server.echo",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "server",
          "subject": "server.echo",
          "statusCode": 200,
          "payload": 1,
          "to": "client",
          "isPaipResponse": true
        }
      },
      'isPaipNotice': true
    };

    var actualLog = {};

    server.expose('echo', function(r){
      return 1
    });

    client.observe('__LOG.server.__EXPOSE__.echo', function(notice){
      // clean up log from random properties
      actualLog = _.omit(notice.get(), ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx']);
    });

    await server.ready();
    await client.ready();

    await client.sendRequest({ subject: 'server.echo' });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
  test('request generates __LOG.<SERVICE_FULLNAME>.__REQUEST__.<REQUEST_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });
    const client = Paip({ name: "client", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });

    var expectedLog = {
      "metadata": {},
      "service": "client",
      "subject": "__LOG.client.__REQUEST__.server.echo",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "server.echo",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "server",
          "subject": "server.echo",
          "statusCode": 200,
          "payload": 1,
          "to": "client",
          "isPaipResponse": true
        }
      },
      "isPaipNotice": true
    }


    var actualLog = {};

    server.expose('echo', function(r){
      return 1
    });

    server.observe('__LOG.client.__REQUEST__.server.echo', function(notice){
      // clean up log from random properties
      actualLog = _.omit(notice.get(), ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx']);
    });

    await server.ready();
    await client.ready();

    await client.sendRequest({ subject: 'server.echo' });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();

  });
  test('request time out generates __LOG.<SERVICE_FULLNAME>.__REQUEST__.<REQUEST_SUBJECT>', async()=>{
    const client = Paip({ name: "client", log: "off", timeout: 100, enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });

    var expectedLog = {
      "metadata": {},
      "service": "client",
      "subject": "__LOG.client.__REQUEST__.unknown",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "unknown",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "client",
          "subject": "unknown",
          "error": {
            "name": "NatsError",
            "message": "The request timed out for subscription id: -1",
            "code": "REQ_TIMEOUT",
            "statusCode": 500
          },
          "statusCode": 500,
          "to": "client",
          "isPaipResponse": true
        }
      },
      "isPaipNotice": true
    }

    var actualLog = {};

    client.observe('__LOG.client.__REQUEST__.unknown', function(notice){
      const log = notice.get();

      // clean up log from random properties
      actualLog = _.omit(log, ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.response.error.stack']);

    });

    await client.ready();

    try {
      await client.sendRequest({ subject: 'unknown' }).then(r => r.getPayload())
    }catch(e){
      expect(e).to.be.an.error()
    }

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await client.shutdown();
  });
  test('observe method generates __LOG.<SERVICE_FULLNAME>.__OBSERVE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });
    const client = Paip({ name: "client", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });

    var expectedLog = {
      metadata: {},
      service: 'client',
      subject: '__LOG.client.__OBSERVE__.server.login',
      payload:
        { request:
            { metadata: {},
              service: 'server',
              subject: 'server.login',
              isPaipNotice: true },
          response:
            { metadata: {},
              service: 'client',
              subject: 'server.login',
              statusCode: 200,
              isPaipResponse: true } },
      isPaipNotice: true };

    var actualLog = {};

    client.observe('server.login', function(notice){
      // do not return anything
    });

    client.observe('__LOG.client.__OBSERVE__.server.login', function(notice){
      actualLog = _.omit(notice.get(), ['time','tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.request.payload' ]);
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: 'login', payload: { user: 'pippo'} });

    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
  test('observe method that throws generates __LOG.<SERVICE_FULLNAME>.__OBSERVE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });
    const client = Paip({ name: "client", log: "off", enableObserveNatsLog: true, enableRequestNatsLog: true, enableExposeNatsLog: true });

    var expectedLog = {
      metadata: {},
      service: 'client',
      subject: '__LOG.client.__OBSERVE__.server.login',
      payload:
        { request:
            { metadata: {},
              service: 'server',
              subject: 'server.login',
              payload: { "user": "pippo"},
              isPaipNotice: true },
          response:
            { metadata: {},
              service: 'client',
              subject: 'server.login',
              error: {
                "name": "Error",
                "message": "pippone",
                "statusCode": 500
              },
              statusCode: 500,
              isPaipResponse: true } },
      isPaipNotice: true };

    var actualLog = {};

    client.observe('server.login', function(notice){
      throw new Error('pippone')
    });

    client.observe('__LOG.client.__OBSERVE__.server.login', function(notice){
      actualLog = _.omit(notice.get(), ['time','tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.response.error.stack' ]);
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: 'login', payload: { user: 'pippo'} });

    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
});

experiment('log notice messages using environment variables:', ()=>{
  process.env.PAIP_ENABLE_OBSERVE_NATS_LOG = 'true'
  process.env.PAIP_ENABLE_REQUEST_NATS_LOG = 'true'
  process.env.PAIP_ENABLE_EXPOSE_NATS_LOG = 'true'

  test('exposed method generates __LOG.<SERVICE_FULLNAME>.__EXPOSE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off" });
    const client = Paip({ name: "client", log: "off"});

    var expectedLog = {
      "subject": "__LOG.server.__EXPOSE__.echo",
      "metadata": {},
      "service": "server",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "server.echo",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "server",
          "subject": "server.echo",
          "statusCode": 200,
          "payload": 1,
          "to": "client",
          "isPaipResponse": true
        }
      },
      'isPaipNotice': true
    };

    var actualLog = {};

    server.expose('echo', function(r){
      return 1
    });

    client.observe('__LOG.server.__EXPOSE__.echo', function(notice){
      // clean up log from random properties
      actualLog = _.omit(notice.get(), ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx']);
    });

    await server.ready();
    await client.ready();

    await client.sendRequest({ subject: 'server.echo' });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
  test('request generates __LOG.<SERVICE_FULLNAME>.__REQUEST__.<REQUEST_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off"});
    const client = Paip({ name: "client", log: "off"});

    var expectedLog = {
      "metadata": {},
      "service": "client",
      "subject": "__LOG.client.__REQUEST__.server.echo",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "server.echo",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "server",
          "subject": "server.echo",
          "statusCode": 200,
          "payload": 1,
          "to": "client",
          "isPaipResponse": true
        }
      },
      "isPaipNotice": true
    }


    var actualLog = {};

    server.expose('echo', function(r){
      return 1
    });

    server.observe('__LOG.client.__REQUEST__.server.echo', function(notice){
      // clean up log from random properties
      actualLog = _.omit(notice.get(), ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx']);
    });

    await server.ready();
    await client.ready();

    await client.sendRequest({ subject: 'server.echo' });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();

  });
  test('request time out generates __LOG.<SERVICE_FULLNAME>.__REQUEST__.<REQUEST_SUBJECT>', async()=>{
    const client = Paip({ name: "client", log: "off", timeout: 100});

    var expectedLog = {
      "metadata": {},
      "service": "client",
      "subject": "__LOG.client.__REQUEST__.unknown",
      "payload": {
        "request": {
          "metadata": {},
          "service": "client",
          "subject": "unknown",
          "args": [],
          "isPaipRequest": true
        },
        "response": {
          "metadata": {},
          "service": "client",
          "subject": "unknown",
          "error": {
            "name": "NatsError",
            "message": "The request timed out for subscription id: -1",
            "code": "REQ_TIMEOUT",
            "statusCode": 500
          },
          "statusCode": 500,
          "to": "client",
          "isPaipResponse": true
        }
      },
      "isPaipNotice": true
    }

    var actualLog = {};

    client.observe('__LOG.client.__REQUEST__.unknown', function(notice){
      const log = notice.get();

      // clean up log from random properties
      actualLog = _.omit(log, ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.response.error.stack']);

    });

    await client.ready();

    try {
      await client.sendRequest({ subject: 'unknown' }).then(r => r.getPayload())
    }catch(e){
      expect(e).to.be.an.error()
    }

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await client.shutdown();
  });
  test('observe method generates __LOG.<SERVICE_FULLNAME>.__OBSERVE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off"});
    const client = Paip({ name: "client", log: "off"});

    var expectedLog = {
      metadata: {},
      service: 'client',
      subject: '__LOG.client.__OBSERVE__.server.login',
      payload:
        { request:
            { metadata: {},
              service: 'server',
              subject: 'server.login',
              isPaipNotice: true },
          response:
            { metadata: {},
              service: 'client',
              subject: 'server.login',
              statusCode: 200,
              isPaipResponse: true } },
      isPaipNotice: true };

    var actualLog = {};

    client.observe('server.login', function(notice){
      // do not return anything
    });

    client.observe('__LOG.client.__OBSERVE__.server.login', function(notice){
      actualLog = _.omit(notice.get(), ['time','tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.request.payload' ]);
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: 'login', payload: { user: 'pippo'} });

    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
  test('observe method that throws generates __LOG.<SERVICE_FULLNAME>.__OBSERVE__.<METHOD_SUBJECT>', async()=>{
    const server = Paip({ name: "server", log: "off"});
    const client = Paip({ name: "client", log: "off"});

    var expectedLog = {
      metadata: {},
      service: 'client',
      subject: '__LOG.client.__OBSERVE__.server.login',
      payload:
        { request:
            { metadata: {},
              service: 'server',
              subject: 'server.login',
              payload: { "user": "pippo"},
              isPaipNotice: true },
          response:
            { metadata: {},
              service: 'client',
              subject: 'server.login',
              error: {
                "name": "Error",
                "message": "pippone",
                "statusCode": 500
              },
              statusCode: 500,
              isPaipResponse: true } },
      isPaipNotice: true };

    var actualLog = {};

    client.observe('server.login', function(notice){
      throw new Error('pippone')
    });

    client.observe('__LOG.client.__OBSERVE__.server.login', function(notice){
      actualLog = _.omit(notice.get(), ['time','tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx', 'payload.response.error.stack' ]);
    });

    await server.ready();
    await client.ready();

    await server.sendNotice({ subject: 'login', payload: { user: 'pippo'} });

    await new Promise(r => setTimeout(() => r(), delay));
    expect(actualLog).to.be.equal(expectedLog);

    await server.shutdown();
    await client.shutdown();
  });
});

experiment('expose middleware:', ()=> {
  var server;
  var client;

  lab.beforeEach(async () => {
    server = Paip({ name: "server", log: "off" });
    client = Paip({ name: "client", log: "off" });
  });

  lab.afterEach(async () => {
    await server.shutdown();
    await client.shutdown();
  });

  test('middleware that modify req sync', async function(){
    server.expose('add', function(req){
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req){
      const [x,y] = req.getArgs();
      // increase the result by 10
      return req.setArgs([ x, y + 10])
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(res.getPayload()).to.equal(19);
  });

  test('2 middlewares one after the other', async function(){
    server.expose('add', function(req){
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req){
      const [x,y] = req.getArgs();
      // increase the result by 10
      return req.setArgs([ x, y + 10])
    });

    server.exposeMiddleware(function(req){
      const [x,y] = req.getArgs();
      // increase the result by 10
      return req.setArgs([ x, y + 10])
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(res.getPayload()).to.equal(29);
  });

  test('middleware that modify req async', async function(){
    server.expose('add', function(req){
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req){
      const [x,y] = req.getArgs();

      return new Promise(r => {
        setTimeout(() => {
          // increase the result by 10
          r(req.setArgs([ x, y + 10]))
        }, 10);
      })
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(res.getPayload()).to.equal(19);
  });

  test('middleware that end req sync', async function(){
    server.expose('add', function(req){
      fail('This should never be executed');
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req, end){
      const [x,y] = req.getArgs();
      // always end 
      return end(0);
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(res.getPayload()).to.equal(0);
  });

  test('middleware that end req async', async function(){
    server.expose('add', function(req){
      fail('This should never be executed');
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req, end){
      const [x,y] = req.getArgs();

      return new Promise(r => {
        setTimeout(() => {
          // end request - response cycle and always return 0
          end(0);
        }, 10);
      })
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(res.getPayload()).to.equal(0);
  });

  test('middleware that throw sync', async function(){
    server.expose('add', function(req){
      fail('This should never be executed');
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req){
      throw new Error('middleware error');
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('middleware error');
  });

  test('middleware that throw async', async function(){
    server.expose('add', function(req){
      fail('This should never be executed');
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req, end){
      const [x,y] = req.getArgs();

      return new Promise((res, rej) => {
        setTimeout(() => {
          // end request - response cycle and always reject
          rej(new Error('middleware error'))
        }, 10);
      })
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('middleware error');
  });

  test('middleware that doesn\' return a req object', async function(){
    server.expose('add', function(req){
      const [x,y] = req.getArgs();
      return x + y;
    });

    server.exposeMiddleware(function(req){
      // do not return a valid paip req object
      return {}
    });

    await server.ready();
    await client.ready();

    const res = await client.sendRequest({ subject: "server.add", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('Middleware returned non request object')
  });

});