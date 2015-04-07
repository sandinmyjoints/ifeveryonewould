'use strict';
/* eslint no-console: 0 */

var config = require('config');
var Twitter = require('twitter');
var emitStream = require('emit-stream');
var es = require('event-stream');
var debug = require('debug')('debug');

var client = new Twitter({
  consumer_key: config.get('twitter.consumerKey'),
  consumer_secret: config.get('twitter.consumerSecret'),
  access_token_key: config.get('twitter.accessTokenKey'),
  access_token_secret: config.get('twitter.accessTokenSecret')
});

var RE = /if\s+everyone\s+would/gi;
var track = 'if everyone would';
var retryCount = 0;
var tweetCount = 99;
var memory = [];

function streamLog() {
  process.stdout.write('\n');
  console.log.apply(console, arguments);
}

function resetRetryCount(data, cb) {
  retryCount = 0;
  cb(null, data);
}

function countTweet(data, cb) {
  if (tweetCount % 10 === 0) {
    debug('tweetCount: ', tweetCount);
  }

  if (++tweetCount >= 100) {
    process.stdout.write('.');
    debug('resetting tweet count to zero.');
    tweetCount = 0;
  }
  cb(null, data);
}

function pickTweet(data, cb) {
  if (data[1]) {
    return cb(null, data[1]);
  }
  return cb();
}

function dropMTs(tweet, cb) {
  if (/^\s*MT:/.test(tweet.text)) {
    debug('dropping MT: ', tweet.text);
    return cb();
  }
  return cb(null, tweet);
}

function filter(tweet, cb) {
  if (RE.test(tweet.text)) {
    return cb(null, tweet);
  }
  return cb();
}

function _textFromRetweet(text) {
  /* RT @voguezayn_: STOP HATING */
  /* RT @mt_newman That's amazing. */
  var re = /^\s*RT\s+@\S+(?::)?\s*(.*)$/;
  var result = re.exec(text);
  if (result) {
    return result[1] || null;
  }
  return text;
}

function canonicalize(tweet, cb) {
  var textFromRetweet = _textFromRetweet(tweet.text);
  debug('textFromRetweet: ', textFromRetweet);
  if (!textFromRetweet) {
    return cb();
  }

  var canonicalized = {
    tweet: tweet,
    canonical: textFromRetweet
  };

  return cb(null, canonicalized);
}

function dropRepeats(canonTweet, cb) {
  if (memory.indexOf(canonTweet.canonical) > -1) {
    debug('dropping repeat');
    return cb();
  }
  return cb(null, canonTweet);
}

function remember(canonTweet, cb) {
  memory.push(canonTweet.canonical);
  debug('remembering. memory length is ', memory.length);

  if (memory.length > 10000) {
    debug('forgetting.');
    memory.shift();
  }

  cb(null, canonTweet);
}

function retweet(canonTweet, cb) {
  var tweet = canonTweet.tweet;
  var canonical = canonTweet.canonical;
  streamLog('retweeting: ', canonical);

  client.post('statuses/retweet/' + tweet.id_str, {}, function(err) {
    if (err) {
      console.log('error: ', err);
      return cb(err);
    }
    console.log('success');
    return cb(null);
  });
}

function retry(error) {
  if (error) {
    streamLog('error: ', error);
  }
  streamLog('retry ' + retryCount);
  setTimeout(connect, 5000 * retryCount++);
}

function connect() {
  console.log('connecting');
  client.stream('statuses/filter', {track: track}, function(stream) {
    var streamStream = emitStream(stream)
      .pipe(es.map(resetRetryCount))
      .pipe(es.map(countTweet))
      .pipe(es.map(pickTweet))
      .pipe(es.map(dropMTs))
      .pipe(es.map(filter))
      .pipe(es.map(canonicalize))
      .pipe(es.map(dropRepeats))
      .pipe(es.map(remember))
      .pipe(es.map(retweet));

    streamStream.on('error', function(err) {
      console.log('streamStream error: ', err);
    });

    stream.on('error', retry);
  });
}

connect();
