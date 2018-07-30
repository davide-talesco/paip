const NATS = require("nats");

const n = NATS.connect();

n.subscribe('>', function(m){
  console.log(m);
})

