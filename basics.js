/**
 * Created by davide_talesco on 13/6/18.
 * This file contains the unit tests of paip
 */

"use strict";
const _ = require("lodash");
const Paip = require("../index");
const Lab = require("lab");
const { expect } = require("code");

// Test files must require the lab module, and export a test script
const lab = (exports.lab = Lab.script());

// shortcuts to functions from lab
const experiment = lab.experiment;
const test = lab.test;

experiment("log messages", () => {
  const server = Paip({ name: "server", logLevel: "off" });
  const client = Paip({ name: "client", logLevel: "off", timeout: 500 });

  var serverLog;
  var clientLog;

  lab.before(() => {
    server.expose("add", function(r) {
      const [x, y] = r.getArgs();
      return x + y;
    });

    server.expose("throwSync", function(r) {
      throw new Error("SyncError");
    });

    server.observe("server._LOG.EXPOSE.>", function(msg) {
      serverLog = msg.getPayload();
    });

    client.observe("client._LOG.INVOKE.>", function(msg) {
      clientLog = msg.getPayload();
    });

    return new Promise(resolve => setTimeout(resolve, 100));
  });

  lab.after(() => {
    client.close();
    server.close();
  });

  test("successful response", async () => {
    await client.invoke({ subject: "server.add", args: [3, 4] });
    await new Promise(r => setTimeout(r, 200));
    expect(serverLog.request.args).to.equal([3, 4]);
    expect(serverLog.response.result).to.equal(7);
    expect(serverLog.response.statusCode).to.equal(200);
    // invoke generate similar logs
    expect(clientLog.request.args).to.equal([3, 4]);
    expect(clientLog.response.result).to.equal(7);
    expect(clientLog.response.statusCode).to.equal(200);
    serverLog = undefined;
    clientLog = undefined;
  });

  test("error response", async () => {
    try {
      await client.invoke({ subject: "server.throwSync", args: [3, 4] });
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
    expect(serverLog.request.args).to.equal([3, 4]);
    expect(serverLog.response.statusCode).to.equal(500);
    expect(serverLog.response.error.message).to.equal("SyncError");
    // invoke generate similar logs
    expect(clientLog.request.args).to.equal([3, 4]);
    expect(clientLog.response.statusCode).to.equal(500);
    expect(clientLog.response.error.message).to.equal("SyncError");
    serverLog = undefined;
    clientLog = undefined;
  });

  test("request subject unavailable", async () => {
    try {
      await client.invoke({ subject: "server.whatever", args: [3, 4] });
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
    // server does not get the request at all
    expect(serverLog).to.be.undefined();
    // invoke does not generate any log
    expect(clientLog.response.error.name).to.equal("NatsError");
  });
});
