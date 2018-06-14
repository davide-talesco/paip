const Paip = require('../index');

const client = Paip({name: 'client', timeout:5000, logLevel: '20'});

client.invoke('math.add', 5, 3)
  .then(console.log)
  .then(()=>{
    client.close();
  })
  .catch(err => {
    console.log(err);
    client.close();
  });