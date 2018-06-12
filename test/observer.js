const Paip = require('../index');

const observer = Paip({name: 'observer'});
observer.nats.connect();

observer.observe('server._LOG.add', function(request){
  console.log(JSON.stringify(request))
})