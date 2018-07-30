const Paip = require('./index4');
const S = Paip({ name: 'server', timeout: 5000});
const C = Paip({ name: 'client', timeout: 5000});

S.expose('test', function(req){
  throw new Error('sync');
  return req.getArgs();
});

Promise.all([S.ready(), C.ready()])
  .then(() => {
    return C.sendRequest({ subject: 'server.test', args: [5, 3]})
  })
  .then(res => {
    console.log(res.getPayload())})
  .catch(err => {
    console.log(err)
  })

