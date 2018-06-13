const Paip = require('../index');

const server = Paip({name:'server', logLevel:'off'});
const client = Paip({name:'client', logLevel:'off'});

server.expose('add', 'test', function(r){
  const [x, y] = r.args();
  return x + y;
})

setTimeout(function(){
  client.invoke('server.add', 5, 4)
    .then(console.log)
    .then(() => client.close())
}, 100)