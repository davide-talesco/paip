"use strict";
const _ = require("lodash");
const { Paip, msg } = require("../index");
const Lab = require("lab");
const { expect, fail } = require("code");

// Test files must require the lab module, and export a test script
const lab = (exports.lab = Lab.script());

// shortcuts to functions from lab
const experiment = lab.experiment;
const test = lab.test;

// some tests relay on time and this might cause tests to fail if nats is too slow to respond.
const delay = 1000;

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
      await client.request({ args: [5, 4] });
      fail('This should never be executed');
    }
    catch(e){
      expect(e).to.be.an.error("subject is required to create a Message object");
    }
  });
  test('send a request with args not an array', async () => {
    const res = await client.request({ subject: "server.echo", args: 5 });
    expect(res.getPayload()).to.equal([5]);
  });
  test('send a simple request', async () => {
    const res = await client.request({ subject: "server.echo", args: [5, 4] });
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

    const res = await client.request({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);

  });
  test('expose a method that returns asynchronously', async () => {

    server.expose("echo", r => new Promise(resolve => setTimeout(() => resolve(r.getArgs()), 100)));

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);

  });
  test('expose a method that throws synchronously', async () => {

    server.expose("echo", r => { throw new Error('sync') });

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('sync')

  });
  test('expose a method that throws asynchronously', async () => {

    server.expose("echo", r => new Promise((resolve, reject) => setTimeout(() => reject( new Error('async')), 100)));

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4] });
    expect(() => res.getPayload()).to.throw('async')

  });
  test('receive a request with metadata', async () => {

    server.expose("echo", r => r.getMetadata());

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4], metadata: 'test' });
    expect(res.getPayload()).to.equal('test');

  });
  test('receive a request with custom transactionId', async () => {

    server.expose("echo", r => r.getMetadata());

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4], tx: 'test' });
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
    await client.request({ subject: "server.echo", args: [5, 4] });
    await client.request({ subject: "server.echo", args: [5, 4] });
    await client.request({ subject: "server.echo", args: [5, 4] });
    await client.request({ subject: "server.echo", args: [5, 4] });
    await client.request({ subject: "server.echo", args: [5, 4] });
    await client.request({ subject: "server.echo", args: [5, 4] });

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

    await server.notice({ subject: "echo", payload: {} })
    await server.notice({ subject: "echo", payload: {} })
    await server.notice({ subject: "echo", payload: {} })

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

    await server.notice({ subject: "echo", payload: 1 })

  });
  test('send a notice with no payload', async()=>{

    await server.ready();
    await client.ready();

    try{
      await server.notice({ subject: "echo" })
    }catch(e){
      expect(e).to.be.an.error('payload is required to create a Notice object')
    }
  });
  test('send a notice with no subject', async()=>{

    await server.ready();
    await client.ready();

    try{
      await server.notice({ payload: {} })
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

    await server.notice({ subject: "echo", payload: {}, metadata: 1 })
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

    await server.notice({ subject: "echo", payload: {} });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(count).to.be.equal(1)

  });
  test('multiple different services will all get the notice message', async()=>{
    const client2 = Paip({ name: "client2", log: "off" });

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

    await server.notice({ subject: "echo", payload: {} });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(count).to.be.equal(2)

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

    await client.request({ subject: 'server.echo' });

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
      return r.request({ subject: 'server.echo', args: r.getTx()})
    });

    server.expose('echo', function(r){
      const args = r.getArgs();
      args.push(r.getTx());
      return args;
    });

    await server.ready();
    await proxy.ready();
    await client.ready();

    const res = await client.request({ subject: 'proxy.echo', tx: 1 });
    expect(res.getPayload()).to.be.equal([1, 1]);

    await proxy.shutdown()
  });
  test('a notice sent via an incomingRequest keep same transaction Id', async () => {
    var tx;

    server.expose('echo', async function(r){
      r.notice({ subject: 'notice', payload: r.getTx()})
    });

    client.observe('server.notice', function(notice){
      tx = notice.getTx();
    });

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: 'server.echo', tx: 1 });
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
      await notice.request({ subject: 'server.echo'})
    });

    await server.ready();
    await client.ready();

    const res = await server.notice({ subject: 'notice', payload: {}, tx: 1 });
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
      await notice.notice({ subject: 'notice', payload: {}})
    });

    await server.ready();
    await client.ready();

    const res = await server.notice({ subject: 'notice', payload: {}, tx: 1 });
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

    const res = await client.request({ subject: 'server.echo', tx: 1 });
    await res.request({ subject: 'server.echo'});

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

    const res = await client.request({ subject: 'server.echo', tx: 1 });
    await res.notice({ subject: 'echo', payload: {}});

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(tx).to.be.equal([1,1]);
  });
});

experiment('log notice messages:', ()=>{
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

  test.only('exposed method generates <SERVICE_FULLNAME>._LOG.EXPOSE.<METHOD_SUBJECT>', async()=>{

    var expectedLog = {
      "subject": "server._LOG.EXPOSE.echo",
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


    var actualLog = {
      metadata: {},
      service: 'server',
      subject: 'server.server._LOG.EXPOSE.echo',
      payload:
        { request:
            { metadata: {},
              service: 'client',
              subject: 'server.echo',
              args: [],
              isPaipRequest: true },
          response:
            { metadata: {},
              service: 'server',
              subject: 'server.echo',
              statusCode: 200,
              payload: 1,
              to: 'client',
              isPaipResponse: true } },
      isPaipNotice: true }

    server.expose('echo', function(r){
      return 1
    });

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: 'server.echo' });

    server.observe('server._LOG.EXPOSE.echo', function(notice){
      // clean up log from random properties
      actualLog = _.omit(notice.get(), ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx']);
    });

    // TODO can I avoid to base this test on time?
    await new Promise(r => setTimeout(() => r(), delay));
    expect(expectedLog).to.be.equal(actualLog);

  });
  test('request generates <SERVICE_FULLNAME>._LOG.REQUEST.<REQUEST_SUBJECT>');
  test('request generates <SERVICE_FULLNAME>._LOG.REQUEST.<REQUEST_SUBJECT>');
});