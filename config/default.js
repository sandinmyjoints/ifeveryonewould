var _ = require('lodash');

var config = {
  twitter: {
    'consumerKey': '' || process.env.TWITTER_CONSUMER_KEY,
    'consumerSecret': '' || process.env.TWITTER_CONSUMER_SECRET,
    'accessTokenKey': '' || process.env.TWITTER_ACCESS_TOKEN_KEY,
    'accessTokenSecret': ''  || process.env.TWITTER_ACCESS_TOKEN_SECRET
  }
};

try {
  var local = require('../local/default');
  config = _.merge(local);
} catch (ex) {
}

module.exports = config;
