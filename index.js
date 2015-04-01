var config = require('config');
var Twitter = require('twitter');

var client = new Twitter({
  consumer_key: config.get('twitter.consumerKey') || process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: config.get('twitter.consumerSecret') || process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: config.get('twitter.accessTokenKey') || process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: config.get('twitter.accessTokenSecret') || process.env.TWITTER_ACCESS_TOKEN_SECRET
});
