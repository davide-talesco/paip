const actual = {
  subject: 'server.server._LOG.EXPOSE.echo',
};

var expected = {
  "subject": "server._LOG.EXPOSE.echo",
};

const Code = require('code');
const expect = Code.expect;

expect(5).to.equal(5);
expect(actual).to.equal(expected);

