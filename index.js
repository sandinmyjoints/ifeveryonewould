'use strict';
/* eslint no-console: 0 */

var config = require('config');
var Twitter = require('twitter');
var emitStream = require('emit-stream');
var es = require('event-stream');
var debug = require('debug')('debug');
var leveldb = require('level');
var db = leveldb('./tweetdb');

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
var memoryTweets = [];

function streamLog() {
  process.stdout.write('\n');
  console.log.apply(console, arguments);
}

function resetRetryCount() {
  retryCount = 0;
}

function countTweet(data, cb) {
  if (++tweetCount >= 100) {
    process.stdout.write('.');
    tweetCount = 0;
  }
  cb(null, data);
}

function pickTweet(data, cb) {
  if (data[1]) {
    resetRetryCount();
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
  var tweet = canonTweet.tweet;

  if (tweet.retweeted_status) {
    debug('new tweet with id_str ' + tweet.id_str + ' was in reply to ' + tweet.retweeted_status.id_str);
    db.get(tweet.retweeted_status.id_str, function(err, wasAlreadyRetweeted) {
      if(wasAlreadyRetweeted) {
        return cb();
      }
      return cb(null, canonTweet);
    });

  } else {
    return cb(null, canonTweet);
  }
}

function remember(canonTweet, cb) {
  debug('remembering.');
  var tweet = canonTweet.tweet;
  db.put(tweet.id_str, true, function(err) {
    return cb(err, canonTweet);
  });
}

function retweet(canonTweet, cb) {
  var tweet = canonTweet.tweet;
  var canonical = canonTweet.canonical;
  streamLog('retweeting: ', canonical);

  client.post('statuses/retweet/' + tweet.id_str, {}, function(err) {
    if (err) {
      console.log('error posting retweet: ', err);
      return cb(err);
    }
    return cb(null);
  });
}

function retry(error) {
  if (error) {
    streamLog('retry: error: ', error);
  }
  streamLog('retry ' + retryCount);
  setTimeout(connect, 5000 * retryCount++);
}

function createStream(tweetStream) {
  streamLog('creating stream');

  var stream = emitStream(tweetStream)
    .pipe(es.map(countTweet))
    .pipe(es.map(pickTweet))
    .pipe(es.map(dropMTs))
    .pipe(es.map(filter))
    .pipe(es.map(canonicalize))
    .pipe(es.map(dropRepeats))
    .pipe(es.map(remember))
    .pipe(es.map(retweet));

  stream.on('error', function(err) {
    console.log('stream error: ', err);
    stream.end();
    createStream(tweetStream);
  });

  return stream;
}

function connect() {
  console.log('connecting');
  client.stream('statuses/filter', {track: track}, function(tweetStream) {
    createStream(tweetStream);
    tweetStream.on('tweetStream error', retry);
  });
}

function terminator(sig){
  if (typeof sig === "string") {
    console.log('%s: Received %s - terminating sample app ...',
                Date(Date.now()), sig);
    process.exit(1);
  }
  console.log('%s: Node server stopped.', Date(Date.now()) );
};

process.on('exit', function() { terminator(); });

['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
].forEach(function(element, index, array) {
  process.on(element, function() { terminator(element); });
});

connect();
