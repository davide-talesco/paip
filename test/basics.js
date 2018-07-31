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
      expect(e).to.be.an.error("subject is required to create a Request object");
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

  test('expose a method that return synchronously', async () => {

    server.expose("echo", r => r.getArgs());

    await server.ready();
    await client.ready();

    const res = await client.request({ subject: "server.echo", args: [5, 4] });
    expect(res.getPayload()).to.equal([5, 4]);

  });
  test('expose a method that return asynchronously', async () => {

    server.expose("echo", r => new Promise(resolve => setTimeout(() => resolve(r.getArgs()), 10)));

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

    server.expose("echo", r => new Promise((resolve, reject) => setTimeout(() => reject( new Error('async')), 10)));

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

    server.expose("echo", r => { count++; return r.getPayload() });
    server2.expose("echo", r => { count++; return r.getPayload() });

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
  })
});

experiment('send Notice API:', ()=> {

})