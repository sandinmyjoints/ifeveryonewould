'use strict';
/* eslint no-console: 0 */

var config = require('config');
var Twit = require('twit');
var emitStream = require('emit-stream');
var es = require('event-stream');
var _ = require('lodash');

var debug = require('debug')('debug');
var Firebase = require('firebase');

var RE = /if\s+everyone\s+would/gi;
var track = 'if everyone would';
var tweetCount = 99;

var T;
var tweetStream;
var lastEvent;
var lastRetweetId;

// Firebase.
var FIREBASE_ROOT = 'https://boiling-heat-5264.firebaseio.com/ifeveryonewould';
var fdb = new Firebase(FIREBASE_ROOT);
var memoryRef = fdb.child('memory');
var memory = [];

// Pipeline.
function streamLog() {
  process.stdout.write('\n');
  console.log.apply(console, arguments);
}

function countTweet(data, cb) {
  if (++tweetCount >= 100) {
    if (!process.env.DEBUG) {
      process.stdout.write('.');
    }
    tweetCount = 0;
  }
  cb(null, data);
}

function pickTweet(data, cb) {
  var eventType = data[0];

  if (eventType === 'tweet') {
    debug('event type %s', eventType);
    return cb(null, data[1]);
  }
  if (lastEvent !== 'connected' || eventType !== 'connected') {
    debug('event: %s', eventType);
    lastEvent = eventType;
  }
  return cb();
}

function dropMTs(tweet, cb) {
  if (/^\s*MT:/.test(tweet.text)) {
    debug('dropping MT: %s', tweet.text);
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
    lastRetweetId = tweet.retweeted_status.id_str;
    debug('new tweet ' + tweet.id_str + ' was in reply to ' + lastRetweetId);

    if (memory.indexOf(lastRetweetId) > -1) {
      return cb();
    }
    return cb(null, canonTweet);

  } else {
    return cb(null, canonTweet);
  }
}

function remember(canonTweet, cb) {
  debug('remembering.');
  var tweet = canonTweet.tweet;
  memoryRef.push(tweet.id_str, function(err) {
    if (err) {
      console.error('error remembering: %s', err);
    }
    cb(null, canonTweet);
  });
}

function retweet(canonTweet, cb) {
  var tweet = canonTweet.tweet;
  var canonical = canonTweet.canonical;
  streamLog('retweeting: ', canonTweet.tweet.id_str, canonical);

  T.post('statuses/retweet/' + tweet.id_str, {}, function(err) {
    if (err) {
      console.error('error posting retweet: %s', err);

      // Save it so we don't try to retweet it again.
      memoryRef.push(lastRetweetId);

      return cb(err);
    }
    return cb(null);
  });
}

function createStream(tweetStream) {
  streamLog('creating stream');

  return emitStream(tweetStream)
    .pipe(es.map(countTweet))
    .pipe(es.map(pickTweet))
    .pipe(es.map(dropMTs))
    .pipe(es.map(filter))
    .pipe(es.map(canonicalize))
    .pipe(es.map(dropRepeats))
    .pipe(es.map(remember))
    .pipe(es.map(retweet));
}

function createClient() {
  return new Twit({
    consumer_key: config.get('twitter.consumerKey'),
    consumer_secret: config.get('twitter.consumerSecret'),
    access_token: config.get('twitter.accessTokenKey'),
    access_token_secret: config.get('twitter.accessTokenSecret')
  });
}

function connect() {
  console.log('connecting');
  tweetStream = T.stream('statuses/filter', {track: track});
  var streamStream = createStream(tweetStream);

  tweetStream.on('error', function(err) {
    console.error('tweetStream error: ', err);
  });

  streamStream.on('error', function(err) {
    console.error('streamStream error: ', err);
  });
}

['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
].forEach(function(signal) {
  process.on(signal, function() {
    debug('caught %s, stopping', signal);
    tweetStream.stop();
    setTimeout(function() {
      throw new Error('stopped');
    }, 1000);
  });
});

// Ping server.
var http = require('http');
var ipAddress = process.env.IP || '0.0.0.0';
var port = process.env.PORT || 8080;

http.createServer(function (req, res) {
  debug('pinged at ' + req.url);
  res.writeHead(204);
  res.end();
}).listen(port, ipAddress);

// Main.
memoryRef.once('value', function(snapAll) {
  memory = _.values(snapAll.val()) || [];
  // debug('all known retweets: ', memory);
  console.log('known retweets: %d', memory.length);

  T = createClient();
  connect();

  memoryRef.on('child_added', function(snap) {
    debug('added child %s %s', snap.key(), snap.val());
    memory.push(snap.val());
  });
});
