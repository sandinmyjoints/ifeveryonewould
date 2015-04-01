var _ = require('lodash');

var config = {};

try {
  var local = require('../local/default');
  config = _.merge(local);
} catch (ex) {
}

module.exports = config;
