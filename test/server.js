const Paip = require('../index');

const server = Paip({name: 'math', logLevel:'debug'});

server.expose('add', 'add 2 numbers', function(request){
  //throw new Error('Unexpected error')

  return Promise.resolve(request.args[0] + request.args[1]);
});

function add(x, y){
  return x + y;
}