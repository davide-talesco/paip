const Paip = require('../index');

const observer = Paip({name: 'observer'});
observer.nats.connect();

observer.sniff('_LOG.add', function(request){
  console.log(request)
})