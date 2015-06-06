var babel = require('babel-core');

function work(opts) {
  if (! 'data' in opts) throw TypeError('data must exist');
  if (! 'opts' in opts) throw TypeError('opts must exist');

  return JSON.stringify(babel.transform(opts.data, opts.opts));
}
