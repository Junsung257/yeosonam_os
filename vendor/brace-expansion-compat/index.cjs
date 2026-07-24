'use strict';

const secureImplementation = require('brace-expansion-secure');
const expand =
  typeof secureImplementation === 'function'
    ? secureImplementation
    : secureImplementation.expand;

// minimatch <=9 requires the package itself as a function, while minimatch 10
// imports the named `expand` export. Keep both APIs on the patched implementation.
module.exports = expand;
module.exports.expand = expand;
