/**
 * @author xiaojue[designsor@gmail.com]
 * @fileoverview combine file
 */
var utils = require('./utils');
var path = require('path');
var fs = require('fs');
var byline = require('byline').LineStream;
var request = require('request');
var combineTarget = require('./combineTarget');
var svn = require('svn-interface');
var through2 = require('through2');
var Readable = require('stream').Readable;
var uglify = require('uglify-stream');
var cwd = process.cwd();

function combine(svninfo) {
  this.svninfo = svninfo;
  this.deps = [];
}

utils.definePublicPros(combine.prototype, {
  concat: function(filepath, keyword, ext) {
    var line = new byline();
    this.deps = [];
    return fs.createReadStream(filepath, {
        encoding: 'utf-8'
      })
      .pipe(line)
      .pipe(combineStream({
        svninfo: this.svninfo,
        deps: this.deps,
        keyword: keyword,
        ext: ext,
        filepath: filepath
      }));
  }
});

combine.build = function(filepath,config,output,beautify){
  var ext = path.extname(filepath),target;
  var filestream = new combine({
    username:config.svninfo.username,
    password:config.svninfo.password,
    command:config.svninfo.command
  }).concat(filepath,config.keywords[ext],ext);
  if(beautify){
    target = path.resolve(cwd,beautify);
    filestream.pipe(fs.createWriteStream(target));
  }
  if(output){
    target = path.resolve(cwd,output); 
    filestream.pipe(uglify()).pipe(fs.createWriteStream(target));
  }
};

function pipeFile(file, params) {
  var line = new byline(),
    target = new combineTarget();
  file.pipe(line)
    .pipe(combineStream(params))
    .pipe(target)
    .on('finish', function() {
      params.cb(null, this.file);
    });
}

function getRequireString(params) {
  if (params.type === 'local') {
    pipeFile(fs.createReadStream(params.filepath, {
      encoding: 'utf-8'
    }), params);
  } else if (params.type === 'http') {
    pipeFile(request(params.filepath), params);
  } else if (params.type === 'svn') {
    svn._setCommand(params.svninfo.command || 'svn');
    var filepath = params.filepath.replace(/^svn\:/, '');
    svn.cat(filepath, {
      username: params.svninfo.username,
      password: params.svninfo.password
    }, function(err, result) {
      var rs = new Readable;
      rs.push(result);
      rs.push(null);
      pipeFile(rs, params);
    });
  }
}

function combineStream(params) {
  return through2(function(line, enc, cb) {
    var reg = new RegExp('^\\s*' + params.keyword + '\\s*\\(\\s*([\'|\"])([\\w\\-\\.\\/\\_\:]*)\\1\\s*\\)\\s*;?', 'gi');
    line = line.toString() + '\n';
    var matches = reg.exec(line);
    if (matches && matches[2]) {
      var requireName = matches[2];
      var extname = path.extname(requireName);
      if (extname === params.ext) {
        //先放入堆栈，有重复的不放，忽略，算循环引用，结束之后剔除堆栈
        var type = utils.getRquireType(requireName);
        if (type === 'local' || type === 'svn' || type === 'http') {
          if (params.deps.indexOf(requireName) === -1) {
            params.deps.push(requireName);
            getRequireString({
              svninfo: params.svninfo,
              deps: params.deps,
              keyword: params.keyword,
              ext: params.ext,
              type: type,
              filepath: type === 'local' ? path.resolve(path.dirname(params.filepath), requireName) : requireName,
              cb: cb
            });
          } else {
            cb();
          }
        } else {
          cb(new Error('type is illegal ' + type + ' , ' + requireName));
        }
      } else {
        cb(new Error('extname is illegal ' + requireName));
      }
    } else {
      cb(null, line);
    }
  });
}

module.exports = combine;