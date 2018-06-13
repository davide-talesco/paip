const Paip = require('../index');

const server = Paip({name: 'math', logLevel:'debug'});

server.expose('add', 'add 2 numbers', r => add(...r.getArgs()));

function add(x, y){
  return x + y;
}