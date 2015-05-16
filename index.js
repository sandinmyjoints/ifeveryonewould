'use strict';
/* eslint no-console: 0 */

var config = require('config');
var Twit = require('twit');
var emitStream = require('emit-stream');
var es = require('event-stream');
var debug = require('debug')('debug');
var leveldb = require('level');
var db = leveldb('./tweetdb');

var RE = /if\s+everyone\s+would/gi;
var track = 'if everyone would';
var retryCount = 0;
var tweetCount = 99;
var memory = [];
var memoryTweets = [];
var T;

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
  debug('event type', data[0]);
  if (data[0] === 'tweet') {
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
  resetRetryCount();
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

  T.post('statuses/retweet/' + tweet.id_str, {}, function(err) {
    if (err) {
      console.log('error posting retweet: ', err);
      return cb(err);
    }
    return cb(null);
  });
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
    console.log('plain old stream error: ', err);
    console.log('doing nothing.');

  });

  return stream;
}

function createClient() {
  return new Twit({
    consumer_key: config.get('twitter.consumerKey'),
    consumer_secret: config.get('twitter.consumerSecret'),
    access_token: config.get('twitter.accessTokenKey'),
    access_token_secret: config.get('twitter.accessTokenSecret')
  });
}

function retry() {
  streamLog('retry ' + retryCount);
  setTimeout(connect, 5000 * retryCount++);
}

function connect(T) {
  console.log('connecting');
  var tweetStream = T.stream('statuses/filter', {track: track});
  var streamStream = createStream(tweetStream);
  tweetStream.on('error', function(err) {
    console.log('tweetStream error: ', err);
    console.log('retrying.');
    retry(err);
  });

  streamStream.on('error', function(err) {
    console.log('streamStream error: ', err);
    console.log('doing nothing.');
    //retry(err);
  });
}

// Autodisconnect.
// function disconnect() {
//   console.log('disconnecting');
//   client = null;
//   T = createClient();
//   connect(T);
// }

// setTimeout(disconnect, 1000 * 60 * 60 * 4);

// Ping server.
var http = require('http');
var ipAddress = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';
var port = process.env.OPENSHIFT_NODEJS_PORT || 8080;

http.createServer(function (req, res) {
  debug('pinged at ' + req.url);
  res.writeHead(204);
  res.end();
}).listen(port, ipAddress);

// Main.
var T = createClient();
connect(T);
