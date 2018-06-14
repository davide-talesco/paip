const Paip = require('../index');

const server = Paip({name: 'math', logLevel: 'off'});

server.expose('add', 'add 2 numbers', r => add(...r.getArgs()));

function add(x, y){
  throw new Error('this is a server error')
  return x + y;
}