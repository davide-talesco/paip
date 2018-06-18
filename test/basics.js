/**
 * Created by davide_talesco on 13/6/18.
 * This file contains the unit tests of paip
 */

'use strict';
const _ = require('lodash');
const Paip = require('../index');
const Lab = require('lab');
const { expect } = require('code');

// Test files must require the lab module, and export a test script
const lab = (exports.lab = Lab.script());

// shortcuts to functions from lab
const experiment = lab.experiment;
const test = lab.test;

experiment('invoke api,', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off'});

  lab.before(() => {

    server.expose('add', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    server.expose('throwSync', function(r){
      throw new Error('SyncError')
    });

    server.expose('throwAsync', function(r){
      return new Promise((_,r) =>r(new Error('AsyncError')));
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    server.close();
  });

  test('invoke a remote method', async ()=>{
    const res = await client.invoke({subject: 'server.add', args: [5, 4]});
    expect(res).to.equal(9);
  });

  test('invoke a remote method that throws synchronously', async ()=>{
    try{
      await client.invoke({subject: 'server.throwSync'})
    }
    catch(e){
      expect(e).to.be.an.error('SyncError');
    }

  });

  test('invoke a remote method that throws asynchronously', async ()=>{
    try{
      await client.invoke({subject: 'server.throwAsync'})
    }
    catch(e){
      expect(e).to.be.an.error('AsyncError');
    }

  });

  test('invoke with no subject', async ()=>{
    try{
      await client.invoke()
    }
    catch(e){
      expect(e).to.be.an.error('subject must exists in Request object');
    }

  });

  test('invoke with args !== Array', async ()=>{
    try{
      await client.invoke({subject: 'server.add', args: 3})
    }
    catch(e){
      expect(e).to.be.an.error('args if exists must be an Array in Request object');
    }

  });
});

experiment('broadcast api', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off'});

  lab.after(()=>{
    client.close();
    server.close();
  });

  test('send a broadcast message', async()=>{
    const msg1 = new Promise((resolve)=>{
      client.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });

    // TODO broadcast msg are not caught by observe run at the same tick. why? (even nextThick doesn't work!) check crap/broadcast-observe-race-condition.js
    setTimeout(()=> server.broadcast('greetings', 'ciao'), 100);

    return Promise.all([msg1])
  });
});

experiment('expose api', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const serverb = Paip({name:'server', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off'});

  lab.before(() => {

    server.expose('add', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    serverb.expose('add', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    server.close();
  });

  test('2 instances of the same service exposing a local method only one will receive it', async ()=>{
    const res = await client.invoke({subject: 'server.add', args: [5, 4]});
    expect(res).to.equal(9);
  });
});

experiment('observe api', () => {
  var server;
  var client;
  var client2;
  var client2b;

  lab.beforeEach(()=>{
    server = Paip({name:'server', logLevel:'off'});
    client = Paip({name:'client', logLevel:'off'});
    client2 = Paip({name:'client2', logLevel:'off'});
    client2b = Paip({name:'client2', logLevel:'off'});
  });

  lab.afterEach(()=>{
    client.close();
    client2.close();
    client2b.close();
    server.close();
  });

  test('2 separate service observing the same subject they both get it', async()=>{
    const msg1 = new Promise((resolve)=>{
      client.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });

    const msg2 = new Promise((resolve)=>{
      client2.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });
    // TODO broadcast msg are not caught by observe run at the same tick. why? (even nextThick doesn't work!) check crap/broadcast-observe-race-condition.js
    setTimeout(()=> server.broadcast('greetings', 'ciao'), 100);

    return Promise.all([msg1, msg2])
  });

  test('2 separate service observing the same subject they both get it', async()=>{
    const msg1 = new Promise((resolve)=>{
      client.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });

    const msg2 = new Promise((resolve)=>{
      client2.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });
    // TODO broadcast msg are not caught by observe run at the same tick. why? (even nextThick doesn't work!) check crap/broadcast-observe-race-condition.js
    setTimeout(()=> server.broadcast('greetings', 'ciao'), 100);

    return Promise.all([msg1, msg2])
  });

  test('2 instances of the same service observing a subject only one will get it', async()=>{
    const msg1 = new Promise((resolve)=>{
      client2.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve(msg.payload);
      });
      // resolve the promise after some time as we don't know which one will response
      setTimeout(()=> resolve(''), 200)
    });

    const msg2 = new Promise((resolve)=>{
      client2b.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve(msg.payload);
      });
      // resolve the promise after some time as we don't know which one will response
      setTimeout(()=> resolve(''), 200)
    });
    // TODO broadcast msg are not caught by observe run at the same tick. why? (even nextThick doesn't work!) check crap/broadcast-observe-race-condition.js
    setTimeout(()=> server.broadcast('greetings', 'ciao'), 100);

    return Promise.all([msg1, msg2])
      .then(results => {
        // only one ciao should be received
        expect(results.reduce((a,b) => a + b, '')).to.be.equal('ciao');
      })
  });
});

experiment('transaction ID', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const proxy = Paip({name:'proxy', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off'});

  const IDs = [];

  lab.before(() => {

    server.expose('add', function(r){
      const [x, y] = r.getArgs();
      IDs.push(r.getTransactionId());
      return x + y;
    });

    proxy.expose('add', function(r){
      IDs.push(r.getTransactionId());
      return r.invoke({subject: 'server.add', args: r.getArgs()})
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    proxy.close();
    server.close();
  });

  test('invoke a remote method from within an exposed local method ', async()=>{

    await client.invoke({subject: 'proxy.add', args: [3, 4]});
    expect(_.uniq(IDs).length).to.equal(1);
  });
});

experiment('log messages', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off', timeout: 500});

  var serverLog;
  var clientLog;

  lab.before(() => {

    server.expose('add', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    server.expose('throwSync', function(r){
      throw new Error('SyncError')
    });

    server.observe('server._LOG.>', function(msg){
      serverLog = msg;
    });

    client.observe('client._LOG.>', function(msg){
      clientLog = msg;
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    server.close();
  });

  test('successful response', async()=>{
    await client.invoke({subject: 'server.add', args: [3, 4]});
    await new Promise((r)=> setTimeout(r, 200));
    expect(serverLog.request.args).to.equal([3,4]);
    expect(serverLog.response.result).to.equal(7);
    expect(serverLog.response.statusCode).to.equal(200);
    // invoke does not generate any log
    expect(clientLog).to.be.undefined();
    serverLog = undefined;
    clientLog = undefined;
  });

  test('error response', async()=>{
    try {
      await client.invoke({subject: 'server.throwSync', args: [3, 4]});
    }
    catch(e){

    }
    await new Promise((r)=> setTimeout(r, 200));
    expect(serverLog.request.args).to.equal([3,4]);
    expect(serverLog.response.statusCode).to.equal(500);
    expect(serverLog.response.error.message).to.equal('SyncError');
    // invoke does not generate any log
    expect(clientLog).to.be.undefined();
    serverLog = undefined;
    clientLog = undefined;

  });

  test('request subject unavailable', async()=>{
    try {
      await client.invoke({subject: 'server.whatever', args: [3, 4]});
    }
    catch(e){

    }
    await new Promise((r)=> setTimeout(r, 200));
    // server does not get the request at all
    expect(serverLog).to.be.undefined();
    // invoke does not generate any log
    expect(clientLog.error.name).to.equal('NatsError');
  });
});