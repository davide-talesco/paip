/**
 * Created by davide_talesco on 13/6/18.
 * This file contains the unit tests of paip
 */

'use strict';
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

    server.expose('add', 'this is a test remote function', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    server.expose('throwSync', 'this function throw an error synchronously', function(r){
      throw new Error('SyncError')
    });

    server.expose('throwAsync', 'this function throws an error asynchronously', function(r){
      return new Promise((_,r) =>r(new Error('AsyncError')));
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    server.close();
  });

  test('invoke a remote method', async ()=>{
    const res = await client.invoke('server.add', 5, 4);
    expect(res).to.equal(9);
  });

  test('invoke a remote method that throws synchronously', async ()=>{
    try{
      await client.invoke('server.throwSync')
    }
    catch(e){
      expect(e).to.be.an.error('SyncError');
    }

  });

  test('invoke a remote method that throws asynchronously', async ()=>{
    try{
      await client.invoke('server.throwAsync')
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
});

experiment('broadcast api', () => {
  const server = Paip({name:'server', logLevel:'off'});
  const client = Paip({name:'client', logLevel:'off'});
  const client2 = Paip({name:'client2', logLevel:'off'});

  lab.before(() => {

    server.expose('add', 'this is a test remote function', function(r){
      const [x, y] = r.getArgs();
      return x + y;
    });

    server.expose('throwSync', 'this function throw an error synchronously', function(r){
      throw new Error('SyncError')
    });

    server.expose('throwAsync', 'this function throws an error asynchronously', function(r){
      return new Promise((_,r) =>r(new Error('AsyncError')));
    });

    return new Promise((resolve)=>setTimeout(resolve, 100))
  });

  lab.after(()=>{
    client.close();
    client2.close();
    server.close();
  });

  test('send a broadcast message', async()=>{
    const msg1 = new Promise((resolve,_)=>{
      client.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });

    const msg2 = new Promise((resolve,_)=>{
      client2.observe('greetings', msg => {
        expect(msg.payload).to.be.equal('ciao');
        resolve()
      });
    });

    server.broadcast('greetings', 'ciao');
    return Promise.all([msg1, msg2])
  });
});

experiment('expose api', () => {
  test('expose a local method');
});

experiment('observe api', () => {
  test('observe a subject');
});

experiment('transaction ID', () => {
  test('expose a local method that calls a remote method');
});

experiment('log messages', () => {

});