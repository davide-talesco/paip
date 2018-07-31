const {Paip, msg} = require("./index");
const _ = require('lodash');
const server = Paip({ name: "server", log: "off" });
const client = Paip({ name: "client", log: "off" });

server.expose('echo', function(r){
  return 1
});

server.observe('server._LOG.EXPOSE.echo', function(notice){
  const n = notice.get();
  console.log(notice.getSubject());
  const clean = _.omit(n, ['time', 'tx', 'payload.request.time', 'payload.request.tx', 'payload.response.time', 'payload.response.tx'])
  console.log(clean)
});

async function boot(){

  await server.ready();
  await client.ready();

  const res = await client.request({ subject: 'server.echo' });

}

boot();

