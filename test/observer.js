const Paip = require('../index');

const observer = Paip({name: 'observer', logLevel:'off'});

observer.observe('math._LOG.>', function(request){
  console.log(JSON.stringify(request))
})