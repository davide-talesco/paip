const Paip = require('../index');

const client = Paip({name: 'client'});

client.nats.connect();

client.invoke('server.add', 5, 3)
  .then(console.log)
  .then(()=>{
    client.close();
  })
  .catch(err => {
    console.log(err);
    client.close();
  });