'use strict';

var path = require('path');

var fs = require('graceful-fs');
var assign = require('lodash.assign');
var through = require('through2');
var isValidGlob = require('is-valid-glob');
var defaultTo = require('lodash.defaultto');
var File = require('vinyl');
var gs = require('glob-stream');
var valueOrFunction = require('value-or-function');

var boolean = valueOrFunction.boolean;
var number = valueOrFunction.number;
var string = valueOrFunction.string;
var date = valueOrFunction.date;


function prepareRead(glob, opt) {
  if (!opt) {
    opt = {};
  }

  if (!isValidGlob(glob)) {
    throw new Error('Invalid glob argument: ' + glob);
  }

  var resolveSymlinks = defaultTo(boolean(opt.resolveSymlinks), true);

  // A stat property is exposed on file objects as a (wanted) side effect
  function normalize(globFile, enc, callback) {

    fs.lstat(globFile.path, onStat);

    function onStat(statErr, stat) {
      if (statErr) {
        return callback(statErr);
      }

      globFile.stat = stat;

      if (resolveSymlinks && stat.isSymbolicLink()) {
        // Recurse until all symbolic links on the path are resolved
        return fs.realpath(globFile.path, onRealpath);
      }

      var file = new File(globFile);

      // Skip this file if since option is set and current file is too old
      if (opt.since != null) {
        var since = date(opt.since, file);
        if (since === null) {
          throw new Error('expected since option to be a date or timestamp');
        }
        if (stat.mtime <= since) {
          return callback();
        }
      }

      if (globFile.originalSymlinkPath) {
        // If we reach here, it means there was at least one
        // symlink on the path and we need to rewrite the path
        // to its original value.
        // Updated file stats will tell readContents() to actually read it.
        file.path = globFile.originalSymlinkPath;
      }

      return callback(null, file);
    }

    function onRealpath(realpathErr, filePath) {
      if (realpathErr) {
        return callback(realpathErr);
      }

      if (!globFile.originalSymlinkPath) {
        // Store the original symlink path before the recursive call
        // to later rewrite it back.
        globFile.originalSymlinkPath = globFile.path;
      }
      globFile.path = filePath;

      // Recurse to get real file stat
      normalize(globFile, enc, callback);
    }
  }

  var globStream = gs.create(glob, opt);
  var outputStream = globStream.pipe(through.obj(opt, normalize));

  globStream.on('error', outputStream.emit.bind(outputStream, 'error'));

  return outputStream;
}


function prepareWrite(outFolder, opt) {
  if (!opt) {
    opt = {};
  }

  if (!outFolder) {
    throw new Error('Invalid output folder');
  }

  function normalize(file, enc, cb) {
    var defaultMode = file.stat ? file.stat.mode : null;

    var options = assign({}, opt, {
      cwd: defaultTo(string(opt.cwd, file), process.cwd()),
      mode: defaultTo(number(opt.mode, file), defaultMode),
      overwrite: defaultTo(boolean(opt.overwrite, file), true),
    });

    options.flag = (options.overwrite ? 'w' : 'wx');

    var cwd = path.resolve(options.cwd);

    var outFolderPath = string(outFolder, file);
    if (!outFolderPath) {
      return cb(new Error('Invalid output folder'));
    }
    var basePath = path.resolve(cwd, outFolderPath);
    var writePath = path.resolve(basePath, file.relative);

    // Wire up new properties
    file.stat = (file.stat || new fs.Stats());
    file.stat.mode = options.mode;
    file.flag = options.flag;
    file.cwd = cwd;
    // Ensure the base always ends with a separator
    // TODO: add a test for this
    file.base = path.normalize(basePath + path.sep);
    file.path = writePath;

    cb(null, file);
  }

  return through.obj(opt, normalize);
}


module.exports = {
  read: prepareRead,
  write: prepareWrite,
};
