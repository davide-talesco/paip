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
  test('invoke an existing remote method', async ()=>{
    const server = Paip({name:'server', logLevel:'off'});
    const client = Paip({name:'client', logLevel:'off'});

    server.expose('add', 'test', function(r){
      const [x, y] = r.args();
      return
    })

  });
  test('invoke a non existing remote method');
});

experiment('broadcast api', () => {
  test('send a broadcast message');
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