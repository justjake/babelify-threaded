var through = require("through2");
var assign  = require("object-assign");
var babel   = require("babel-core");
var path    = require("path");
var threads = require('threads_a_gogo');
var Promise = require('bluebird');

var browserify = module.exports = function (filename, opts) {
  return browserify.configure(opts)(filename);
};

/**
 * This fork of Babelify uses `threads_a_gogo` to run Babel off of the main
 * event loop thread. Hopefully this is faster for large bundles than blocking
 * the main loop.
 *
 * threads introduces two new options:
 *  - threadpool: pass in a pre-configured threadpool here if you want to share
 *                pools across several browserify bundles or other tasks
 *  - threadPoolSize: pass an int here if you'd prefer that we create our own
 *    threadpool.
 */
browserify.configure = function (opts) {
  opts = assign({}, opts);
  var extensions = opts.extensions ? babel.util.arrayify(opts.extensions) : null;
  var sourceMapRelative = opts.sourceMapRelative;
  if (opts.sourceMap !== false) opts.sourceMap = "inline";

  var threadPool = getThreadPool(opts);

  // babelify specific options
  delete opts.sourceMapRelative;
  delete opts.extensions;
  delete opts.filename;

  // browserify specific options
  delete opts._flags;
  delete opts.basedir;
  delete opts.global;

  // babelify-threaded specific options
  delete opts.threadPool;
  delete opts.threadPoolSize;

  return function (filename) {
    if (!babel.canCompile(filename, extensions)) {
      return through();
    }

    if (sourceMapRelative) {
      filename = path.relative(sourceMapRelative, filename);
    }

    var data = "";

    var write = function (buf, enc, callback) {
      data += buf;
      callback();
    };

    var end = function (callback) {
      var _this = this;
      opts.filename = filename;
      threadPool._babelify.compile(data, opts).then(function(result) {
        _this.push(result.code);
      }).catch(function(err) {
        _this.emit('error', err);
      }).always(callback);
    };

    return through(write, end);
  };
};

function getThreadPool(opts) {
  var threadPool = opts.threadPool ?
    opts.threadPool : threads.createPool(opts.threadPoolSize || 0);

  // load code into thread pool if needed
  // this is a hacky way to see if the pool was wangdoodled previously
  if (threadPool._babelify) return threadPool;

  threadPool._babelify = new ThreadPomiseInterface(threadPool);
  threadPool._babelify.load();

  return threadPool;
}

function ThreadPomiseInterface(threadPool) {
  this.threadPool = threadPool;
  this.status = null;
}

/**
 * load our worker code into the thread.
 *
 * defines an interface `work(our_opts)` where our_opts is a JSON string
 * containing { data: String, opts: Babel opts (object) }
 */
ThreadPomiseInterface.prototype.load = function load() {
  this.status = 'loading';
  var _this = this;
  this.loaded = new Promise(function(resolve, reject) {
    _this.threadPool.load(path.join(__dirname, 'worker.js'), function(err, value) {
      if (err) {
        _this.status = 'error';
        return reject(err);
      }
      _this.status = 'ready';
      resolve(true);
    });
  });
};

/**
 * run Babel on some code.
 * returns a promise containing the error or result
 */
ThreadPomiseInterface.prototype.compile = function compile(data, opts) {
  return this.loaded.then(this._run.bind(this, data, opts));
};

ThreadPomiseInterface.prototype._run = function(data, opts) {
  var _this = this;
  var ourOpts = { data: data, opts: opts };
  var code = 'work( ' + JSON.stringify(ourOpts) + ' )';
  return new Promise(function(resolve, reject) {
    this.threadPool.eval(code, function(err, result) {
      if (err) {
        console.error(err);
        return reject(err);
      }

      resolve(JSON.parse(result));
    });
  });
};
