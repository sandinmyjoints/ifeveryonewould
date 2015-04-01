var config = require('config');
var Twitter = require('twitter');
var emitStream = require('emit-stream');
var es = require('event-stream');

var client = new Twitter({
  consumer_key: config.get('twitter.consumerKey') || process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: config.get('twitter.consumerSecret') || process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: config.get('twitter.accessTokenKey') || process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: config.get('twitter.accessTokenSecret') || process.env.TWITTER_ACCESS_TOKEN_SECRET
});


function receive(tweet) {
  console.log('Tweet: ', tweet.text);
}

var RE = /if\s+everyone\s+would/gi;
var track = 'if everyone would';
var retryCount = 0;
var tweetCount = 99;

function streamLog() {
  process.stdout.write('\n');
  console.log.apply(console, arguments);
}

function resetRetryCount(data, cb) {
  retryCount = 0;
  cb(null, data);
}

function countTweet(data, cb) {
  if(++tweetCount >= 100) {
    process.stdout.write('.');
    tweetCount = 0;
  }
  cb(null, data);
}

function pickTweet(data, cb) {
  if(data[1]) {
    return cb(null, data[1]);
  } else {
    return cb();
  }
}

function filter(tweet, cb) {
  if(RE.test(tweet.text)) {
    return cb(null, tweet);
  } else {
    return cb();
  }
}

function retweet(tweet, cb) {
  streamLog('DEBUG: ' + 'retweeting: ', tweet.text);
}


function retry(error) {
  if(error) {
    streamLog('error: ', error);
  }
  streamLog('retry ' + retryCount);
  setTimeout(5000 * retryCount++, connect);
}

function connect() {
  console.log('connecting');
  client.stream('statuses/filter', {track: track}, function(stream) {
    var streamStream = emitStream(stream)
      .pipe(es.map(resetRetryCount))
      .pipe(es.map(countTweet))
      .pipe(es.map(pickTweet))
      .pipe(es.map(filter))
      .pipe(es.map(retweet));

    streamStream.on('error', retry);
    stream.on('error', retry);
  });
}

connect();
