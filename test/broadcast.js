const Paip = require('../index');

const client = Paip({name: 'broadcast', timeout:5000, logLevel: 'off'});

client.broadcast('math.add', 'I am a bastard')
  .then(console.log)
  .then(()=>{
    client.close();
  })
  .catch(err => {
    console.log(err);
    client.close();
  });