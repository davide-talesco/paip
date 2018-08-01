const {Paip, msg} = require("./index");
const Code = require('code');
const expect = Code.expect;
const _ = require('lodash');

const client = Paip({ name: "client", log: "off", timeout: 1000 });

async function boot(){

  await client.ready();

  expect( await client.request({ subject: 'unknown' }).then(r => r.getPayload())).to.throw()
}

boot();

