const Errio = require('errio');
Errio.setDefaults({stack:true});

console.log(Errio.stringify(new Error('serialize me')));