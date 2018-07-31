const {Paip, msg} = require("./index");
const R = require('ramda');
const S = Paip({ name: 'server', timeout: 10000});
const C = Paip({ name: 'client', timeout: 10000});
const P = Paip({ name: 'proxy', timeout: 10000});

S.expose('test', msg.getArgs);

P.expose('test', function(req){
  /*  return new Promise((r,rej) => setTimeout(()=> rej(new Error('async')))) */
  //throw new Error('sync');
  return req.request({ subject: 'server.test', args: req.getArgs()})
  // how to avoid calling _.getPayload ?
    .then(msg.getPayload)
});

Promise.all([S.ready(), C.ready(), P.ready()])
  .then(() => {
    return C.request({ subject: 'proxy.test', args: [5, 3]})
  })
  .then(res => {
    console.log(res.getPayload())})
  .catch(err => {
    console.log(err)
  })

