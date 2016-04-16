(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// =============================================================================
// = CustomTrack, an object representing a custom track as understood by UCSC. =
// =============================================================================
//
// This class *does* depend on global objects and therefore must be required as a 
// function that is executed on the global object.

module.exports = function(global) {

var _ = require('../underscore.min.js');

var utils = require('./track-types/utils/utils.js'),
  parseInt10 = utils.parseInt10;

function CustomTrack(opts, browserOpts) {
  if (!opts) { return; } // This is an empty customTrack that will be hydrated with values from a serialized object
  this._type = (opts.type && opts.type.toLowerCase()) || "bed";
  var type = this.type();
  if (type === null) { throw new Error("Unsupported track type '"+opts.type+"' encountered on line " + opts.lineNum); }
  this.opts = _.extend({}, this.constructor.defaults, type.defaults || {}, opts);
  _.extend(this, {
    browserOpts: browserOpts,
    stretchHeight: false,
    heights: {},
    sizes: ['dense'],
    mapSizes: [],
    areas: {},
    scales: {},
    noAreaLabels: false,
    expectsSequence: false,
    onSyncProps: null
  });
  this.init();
}

CustomTrack.defaults = {
  name: 'User Track',
  description: 'User Supplied Track',
  color: '0,0,0'
};

CustomTrack.types = {
  bed: require('./track-types/bed.js'),
  featuretable: require('./track-types/featuretable.js'),
  bedgraph: require('./track-types/bedgraph.js'),
  wiggle_0: require('./track-types/wiggle_0.js'),
  vcftabix: require('./track-types/vcftabix.js'),
  bigbed: require('./track-types/bigbed.js'),
  bam: require('./track-types/bam.js'),
  bigwig: require('./track-types/bigwig.js')
};

// ==========================================================================
// = bedDetail format: https://genome.ucsc.edu/FAQ/FAQformat.html#format1.7 =
// ==========================================================================  

CustomTrack.types.beddetail = _.clone(CustomTrack.types.bed);
CustomTrack.types.beddetail.defaults = _.extend({}, CustomTrack.types.beddetail.defaults, {detail: true});

// These functions branch to different methods depending on the .type() of the track
_.each(['init', 'parse', 'render', 'renderSequence', 'prerender'], function(fn) {
  CustomTrack.prototype[fn] = function() {
    var args = _.toArray(arguments),
      type = this.type();
    if (!type[fn]) { return false; }
    return type[fn].apply(this, args);
  }
});

// Loads CustomTrack options into the track options dialog UI when it is opened
CustomTrack.prototype.loadOpts = function($dialog) {
  var type = this.type(),
    o = this.opts;
  $dialog.find('.custom-opts-form').hide();
  $dialog.find('.custom-opts-form.'+this._type).show();
  $dialog.find('.custom-name').text(o.name);
  $dialog.find('.custom-desc').text(o.description);
  $dialog.find('.custom-format').text(this._type);
  $dialog.find('[name=color]').val(o.color).change();
  if (type.loadOpts) { type.loadOpts.call(this, $dialog); }
  $dialog.find('.enabler').change();
};

// Saves options changed in the track options dialog UI back to the CustomTrack object
CustomTrack.prototype.saveOpts = function($dialog) {
  var type = this.type(),
    o = this.opts;
  o.color = $dialog.find('[name=color]').val();
  if (!this.validateColor(o.color)) { o.color = '0,0,0'; }
  if (type.saveOpts) { type.saveOpts.call(this, $dialog); }
  this.applyOpts();
  global.CustomTracks.worker() && this.applyOptsAsync(); // Apply the changes to the worker too!
};

// Sometimes newly set options (provided as the first arg) need to be transformed before use or have side effects.
// This function is run for newly set options in both the DOM and Web Worker scopes (see applyOptsAsync below).
CustomTrack.prototype.applyOpts = function(opts) {
  var type = this.type();
  if (opts) { this.opts = opts; }
  if (type.applyOpts) { type.applyOpts.call(this); }
};

// Copies the properties of the CustomTrack (listed in props) from the Web Worker side to the DOM side.
// This is useful if the Web Worker computes something (like draw boundaries) that both sides need to be aware of.
// If a callback is saved in this.onSyncProps, this will run the callback afterward.
// If Web Workers are disabled, this is effectively a no-op, although the callback still fires.
CustomTrack.prototype.syncProps = function(props, receiving) {
  var self = this;
  if (receiving === true) {
    if (!_.isObject(props) || _.isArray(props)) { return false; }
    _.extend(self, props);
    if (_.isFunction(self.onSyncProps) && global.HTMLDocument) { self.onSyncProps(props); }
    return self;
  } else {    
    if (_.isArray(props)) { props =_.object(props, _.map(props, function(p) { return self[p]; })); }
    // Which side of the fence are we on?  HTMLDocument implies we're *not* in the Web Worker scope.
    if (global.HTMLDocument) {
      if (!global.CustomTracks.worker()) { return self.syncProps(props, true); }
    } else if (global.CustomTrackWorker) {
      global.CustomTrackWorker.syncPropsAsync(self, props);
    }
  }
};

CustomTrack.prototype.erase = function(canvas) {
  var self = this,
    ctx = canvas.getContext && canvas.getContext('2d');
  if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

CustomTrack.prototype.type = function(type) {
  if (_.isUndefined(type)) { type = this._type; }
  return this.constructor.types[type] || null;
};

CustomTrack.prototype.warn = function(warning) {
  if (this.opts.strict) {
    throw new Error(warning);
  } else {
    if (!this.warnings) { this.warnings = []; }
    this.warnings.push(warning);
  }
};

CustomTrack.prototype.isOn = function(val) {
  return /^(on|yes|true|t|y|1)$/i.test(val.toString());
};

CustomTrack.prototype.chrList = function() {
  if (!this._chrList) {
    this._chrList = _.sortBy(_.map(this.browserOpts.chrPos, function(pos, chr) { return [pos, chr]; }), function(v) { return v[0]; });
  }
  return this._chrList;
}

CustomTrack.prototype.chrAt = function(pos) {
  var chrList = this.chrList(),
    chrIndex = _.sortedIndex(chrList, [pos], function(v) { return v[0]; }),
    chr = chrIndex > 0 ? chrList[chrIndex - 1][1] : null;
  return {i: chrIndex - 1, c: chr, p: pos - this.browserOpts.chrPos[chr]};
};

CustomTrack.prototype.chrRange = function(start, end) {
  var chrLengths = this.browserOpts.chrLengths,
    startChr = this.chrAt(start),
    endChr = this.chrAt(end),
    range;
  if (startChr.c && startChr.i === endChr.i) { return [startChr.c + ':' + startChr.p + '-' + endChr.p]; }
  else {
    range = _.map(this.chrList().slice(startChr.i + 1, endChr.i), function(v) {
      return v[1] + ':1-' + chrLengths[v[1]];
    });
    startChr.c && range.unshift(startChr.c + ':' + startChr.p + '-' + chrLengths[startChr.c]);
    endChr.c && range.push(endChr.c + ':1-' + endChr.p);
    return range;
  }
}

CustomTrack.prototype.prerenderAsync = function() {
  global.CustomTracks.async(this, 'prerender', arguments, [this.id]);
};

CustomTrack.prototype.applyOptsAsync = function() {
  global.CustomTracks.async(this, 'applyOpts', [this.opts, function(){}], [this.id]);
};

CustomTrack.prototype.ajaxDir = function() {
  // Web Workers fetch URLs relative to the JS file itself.
  return (global.HTMLDocument ? '' : '../') + this.browserOpts.ajaxDir;
};

CustomTrack.prototype.rgbToHsl = function(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;

  if (max == min) {
    h = s = 0; // achromatic
  } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch(max){
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h, s, l];
}

CustomTrack.prototype.hslToRgb = function(h, s, l) {
  var r, g, b;

  if (s == 0) {
    r = g = b = l; // achromatic
  } else {
    function hue2rgb(p, q, t) {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6) return p + (q - p) * 6 * t;
      if(t < 1/2) return q;
      if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }

    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [r * 255, g * 255, b * 255];
}

CustomTrack.prototype.validateColor = function(color) {
  var m = color.match(/(\d+),(\d+),(\d+)/);
  if (!m) { return false; }
  m.shift();
  return _.all(_.map(m, parseInt10), function(v) { return v >=0 && v <= 255; });
}

return CustomTrack;

};
},{"../underscore.min.js":19,"./track-types/bam.js":5,"./track-types/bed.js":6,"./track-types/bedgraph.js":7,"./track-types/bigbed.js":8,"./track-types/bigwig.js":9,"./track-types/featuretable.js":10,"./track-types/utils/utils.js":16,"./track-types/vcftabix.js":17,"./track-types/wiggle_0.js":18}],2:[function(require,module,exports){
var global = self;  // grab global scole for Web Workers
require('./jquery.nodom.min.js')(global);
global._ = require('../underscore.min.js');
require('./CustomTracks.js')(global);

if (!global.console || !global.console.log) {
  global.console = global.console || {};
  global.console.log = function() {
    global.postMessage({log: JSON.stringify(_.toArray(arguments))});
  };
}

var CustomTrackWorker = {
  _tracks: [],
  _throwErrors: false,
  parse: function(text, browserOpts) {
    var self = this,
      tracks = CustomTracks.parse(text, browserOpts);
    return _.map(tracks, function(t) {
      // we want to keep the track object in our private store, and delete the data from the copy that
      // is sent back over the fence, since it is expensive/impossible to serialize
      t.id = self._tracks.push(t) - 1;
      var serializable = _.extend({}, t);
      delete serializable.data;
      return serializable;
    });
  },
  prerender: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.prerender.apply(track, _.rest(args));
  },
  applyOpts: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.applyOpts.apply(track, _.rest(args));
  },
  syncPropsAsync: function(track, props) {
    global.postMessage({id: track.id, syncProps: props});
  },
  throwErrors: function(toggle) {
    this._throwErrors = toggle;
  }
};

global.CustomTrackWorker = CustomTrackWorker;

global.addEventListener('message', function(e) {
  var data = e.data,
    callback = function(r) { global.postMessage({id: data.id, ret: JSON.stringify(r || null)}); },
    ret;

  if (CustomTrackWorker._throwErrors || true) {  // FIXME
    ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback));
  } else {
    try { ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback)); } 
    catch (err) { global.postMessage({id: data.id, error: JSON.stringify({message: err.message})}); }
  }
  
  if (!_.isUndefined(ret)) { callback(ret); }
});
},{"../underscore.min.js":19,"./CustomTracks.js":3,"./jquery.nodom.min.js":4}],3:[function(require,module,exports){
module.exports = (function(global){
  
  var _ = require('../underscore.min.js');
  
  // Some utility functions.
  var utils = require('./track-types/utils/utils.js'),
    parseDeclarationLine = utils.parseDeclarationLine;
  
  // The class that represents a singular custom track object
  var CustomTrack = require('./CustomTrack.js')(global);

  // ========================================================================
  // = CustomTracks, the module that is exported to the global environment. =
  // ========================================================================
  //
  // Broadly speaking this is a factory for parsing data into CustomTrack objects,
  // and it can delegate this work to a worker thread.

  var CustomTracks = {
    _tracks: {},
    
    parse: function(chunks, browserOpts) {
      var customTracks = [],
        data = [],
        track, opts, m;
      
      if (typeof chunks == "string") { chunks = [chunks]; }
      
      function pushTrack() {
        if (track.parse(data)) { customTracks.push(track); }
      }
      
      customTracks.browser = {};
      _.each(chunks, function(text) {
        _.each(text.split("\n"), function(line, lineno) {
          if (/^#/.test(line)) {
            // comment line
          } else if (/^browser\s+/.test(line)) {
            // browser lines
            m = line.match(/^browser\s+(\w+)\s+(\S*)/);
            if (!m) { throw new Error("Could not parse browser line found at line " + (lineno + 1)); }
            customTracks.browser[m[1]] = m[2];
          } else if (/^track\s+/i.test(line)) {
            if (track) { pushTrack(); }
            opts = parseDeclarationLine(line, (/^track\s+/i));
            if (!opts) { throw new Error("Could not parse track line found at line " + (lineno + 1)); }
            opts.lineNum = lineno + 1;
            track = new CustomTrack(opts, browserOpts);
            data = [];
          } else if (/\S/.test(line)) {
            if (!track) { throw new Error("Found data on line "+(lineno+1)+" but no preceding track definition"); }
            data.push(line);
          }
        });
      });
      if (track) { pushTrack(); }
      return customTracks;
    },
    
    parseDeclarationLine: parseDeclarationLine,
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      // Note: this is overridden by ui.genobrowser during UI setup.
      console.log(e);
    },
    
    _workerScript: 'build/CustomTrackWorker.js',
    // NOTE: To temporarily disable Web Worker usage, set this to true.
    _disableWorkers: false,
    
    worker: function() { 
      var self = this,
        callbacks = [];
      if (!self._worker && global.Worker) { 
        self._worker = new global.Worker(self._workerScript);
        self._worker.addEventListener('error', function(e) { self.error(e); }, false);
        self._worker.addEventListener('message', function(e) {
          if (e.data.log) { console.log(JSON.parse(e.data.log)); return; }
          if (e.data.error) {
            if (e.data.id) { delete callbacks[e.data.id]; }
            self.error(JSON.parse(e.data.error));
            return;
          }
          if (e.data.syncProps) {
            self._tracks[e.data.id].syncProps(e.data.syncProps, true);
            return;
          }
          callbacks[e.data.id](JSON.parse(e.data.ret));
          delete callbacks[e.data.id];
        });
        self._worker.call = function(op, args, callback) {
          var id = callbacks.push(callback) - 1;
          this.postMessage({op: op, id: id, args: args});
        };
        // To have the worker throw errors instead of passing them nicely back, call this with toggle=true
        self._worker.throwErrors = function(toggle) {
          this.postMessage({op: 'throwErrors', args: [toggle]});
        };
      }
      return self._disableWorkers ? null : self._worker;
    },
    
    async: function(self, fn, args, asyncExtraArgs, wrapper) {
      args = _.toArray(args);
      wrapper = wrapper || _.identity;
      var argsExceptLastOne = _.initial(args),
        callback = _.last(args),
        w = this.worker();
      // Fallback if web workers are not supported.
      // This could also be tweaked to not use web workers when there would be no performance gain;
      //   activating this branch disables web workers entirely and everything happens synchronously.
      if (!w) { return callback(self[fn].apply(self, argsExceptLastOne)); }
      Array.prototype.unshift.apply(argsExceptLastOne, asyncExtraArgs);
      w.call(fn, argsExceptLastOne, function(ret) { callback(wrapper(ret)); });
    },
    
    parseAsync: function() {
      var self = this;
      self.async(self, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          self._tracks[t.id] = _.extend(new CustomTrack(), t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
          return self._tracks[t.id];
        });
      });
    }
  };

  global.CustomTracks = CustomTracks;

});
},{"../underscore.min.js":19,"./CustomTrack.js":1,"./track-types/utils/utils.js":16}],4:[function(require,module,exports){
module.exports = function(global){global.window=global.window||global;global.window.document=global.window.document||{};(function(a,b){function N(){try{return new a.ActiveXObject("Microsoft.XMLHTTP")}catch(b){}}function M(){try{return new a.XMLHttpRequest}catch(b){}}function I(a,c){if(a.dataFilter){c=a.dataFilter(c,a.dataType)}var d=a.dataTypes,e={},g,h,i=d.length,j,k=d[0],l,m,n,o,p;for(g=1;g<i;g++){if(g===1){for(h in a.converters){if(typeof h==="string"){e[h.toLowerCase()]=a.converters[h]}}}l=k;k=d[g];if(k==="*"){k=l}else if(l!=="*"&&l!==k){m=l+" "+k;n=e[m]||e["* "+k];if(!n){p=b;for(o in e){j=o.split(" ");if(j[0]===l||j[0]==="*"){p=e[j[1]+" "+k];if(p){o=e[o];if(o===true){n=p}else if(p===true){n=o}break}}}}if(!(n||p)){f.error("No conversion from "+m.replace(" "," to "))}if(n!==true){c=n?n(c):p(o(c))}}}return c}function H(a,c,d){var e=a.contents,f=a.dataTypes,g=a.responseFields,h,i,j,k;for(i in g){if(i in d){c[g[i]]=d[i]}}while(f[0]==="*"){f.shift();if(h===b){h=a.mimeType||c.getResponseHeader("content-type")}}if(h){for(i in e){if(e[i]&&e[i].test(h)){f.unshift(i);break}}}if(f[0]in d){j=f[0]}else{for(i in d){if(!f[0]||a.converters[i+" "+f[0]]){j=i;break}if(!k){k=i}}j=j||k}if(j){if(j!==f[0]){f.unshift(j)}return d[j]}}function G(a,b,c,d){if(f.isArray(b)){f.each(b,function(b,e){if(c||j.test(a)){d(a,e)}else{G(a+"["+(typeof e==="object"||f.isArray(e)?b:"")+"]",e,c,d)}})}else if(!c&&b!=null&&typeof b==="object"){for(var e in b){G(a+"["+e+"]",b[e],c,d)}}else{d(a,b)}}function F(a,c){var d,e,g=f.ajaxSettings.flatOptions||{};for(d in c){if(c[d]!==b){(g[d]?a:e||(e={}))[d]=c[d]}}if(e){f.extend(true,a,e)}}function E(a,c,d,e,f,g){f=f||c.dataTypes[0];g=g||{};g[f]=true;var h=a[f],i=0,j=h?h.length:0,k=a===y,l;for(;i<j&&(k||!l);i++){l=h[i](c,d,e);if(typeof l==="string"){if(!k||g[l]){l=b}else{c.dataTypes.unshift(l);l=E(a,c,d,e,l,g)}}}if((k||!l)&&!g["*"]){l=E(a,c,d,e,"*",g)}return l}function D(a){return function(b,c){if(typeof b!=="string"){c=b;b="*"}if(f.isFunction(c)){var d=b.toLowerCase().split(u),e=0,g=d.length,h,i,j;for(;e<g;e++){h=d[e];j=/^\+/.test(h);if(j){h=h.substr(1)||"*"}i=a[h]=a[h]||[];i[j?"unshift":"push"](c)}}}}var c=a.document,d=a.navigator,e=a.location;var f=function(){function J(){if(e.isReady){return}try{c.documentElement.doScroll("left")}catch(a){setTimeout(J,1);return}e.ready()}var e=function(a,b){return new e.fn.init(a,b,h)},f=a.jQuery,g=a.$,h,i=/^(?:[^<]*(<[\w\W]+>)[^>]*$|#([\w\-]*)$)/,j=/\S/,k=/^\s+/,l=/\s+$/,m=/\d/,n=/^<(\w+)\s*\/?>(?:<\/\1>)?$/,o=/^[\],:{}\s]*$/,p=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,q=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,r=/(?:^|:|,)(?:\s*\[)+/g,s=/(webkit)[ \/]([\w.]+)/,t=/(opera)(?:.*version)?[ \/]([\w.]+)/,u=/(msie) ([\w.]+)/,v=/(mozilla)(?:.*? rv:([\w.]+))?/,w=/-([a-z])/ig,x=function(a,b){return b.toUpperCase()},y=d.userAgent,z,A,B,C=Object.prototype.toString,D=Object.prototype.hasOwnProperty,E=Array.prototype.push,F=Array.prototype.slice,G=String.prototype.trim,H=Array.prototype.indexOf,I={};e.fn=e.prototype={constructor:e,init:function(a,d,f){var g,h,j,k;if(!a){return this}if(a.nodeType){this.context=this[0]=a;this.length=1;return this}if(a==="body"&&!d&&c.body){this.context=c;this[0]=c.body;this.selector=a;this.length=1;return this}if(typeof a==="string"){if(a.charAt(0)==="<"&&a.charAt(a.length-1)===">"&&a.length>=3){g=[null,a,null]}else{g=i.exec(a)}if(g&&(g[1]||!d)){if(g[1]){d=d instanceof e?d[0]:d;k=d?d.ownerDocument||d:c;j=n.exec(a);if(j){if(e.isPlainObject(d)){a=[c.createElement(j[1])];e.fn.attr.call(a,d,true)}else{a=[k.createElement(j[1])]}}else{j=e.buildFragment([g[1]],[k]);a=(j.cacheable?e.clone(j.fragment):j.fragment).childNodes}return e.merge(this,a)}else{h=c.getElementById(g[2]);if(h&&h.parentNode){if(h.id!==g[2]){return f.find(a)}this.length=1;this[0]=h}this.context=c;this.selector=a;return this}}else if(!d||d.jquery){return(d||f).find(a)}else{return this.constructor(d).find(a)}}else if(e.isFunction(a)){return f.ready(a)}if(a.selector!==b){this.selector=a.selector;this.context=a.context}return e.makeArray(a,this)},selector:"",jquery:"1.6.3pre",length:0,size:function(){return this.length},toArray:function(){return F.call(this,0)},get:function(a){return a==null?this.toArray():a<0?this[this.length+a]:this[a]},pushStack:function(a,b,c){var d=this.constructor();if(e.isArray(a)){E.apply(d,a)}else{e.merge(d,a)}d.prevObject=this;d.context=this.context;if(b==="find"){d.selector=this.selector+(this.selector?" ":"")+c}else if(b){d.selector=this.selector+"."+b+"("+c+")"}return d},each:function(a,b){return e.each(this,a,b)},ready:function(a){e.bindReady();A.done(a);return this},eq:function(a){return a===-1?this.slice(a):this.slice(a,+a+1)},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},slice:function(){return this.pushStack(F.apply(this,arguments),"slice",F.call(arguments).join(","))},map:function(a){return this.pushStack(e.map(this,function(b,c){return a.call(b,c,b)}))},end:function(){return this.prevObject||this.constructor(null)},push:E,sort:[].sort,splice:[].splice};e.fn.init.prototype=e.fn;e.extend=e.fn.extend=function(){var a,c,d,f,g,h,i=arguments[0]||{},j=1,k=arguments.length,l=false;if(typeof i==="boolean"){l=i;i=arguments[1]||{};j=2}if(typeof i!=="object"&&!e.isFunction(i)){i={}}if(k===j){i=this;--j}for(;j<k;j++){if((a=arguments[j])!=null){for(c in a){d=i[c];f=a[c];if(i===f){continue}if(l&&f&&(e.isPlainObject(f)||(g=e.isArray(f)))){if(g){g=false;h=d&&e.isArray(d)?d:[]}else{h=d&&e.isPlainObject(d)?d:{}}i[c]=e.extend(l,h,f)}else if(f!==b){i[c]=f}}}}return i};e.extend({noConflict:function(b){if(a.$===e){a.$=g}if(b&&a.jQuery===e){a.jQuery=f}return e},isReady:false,readyWait:1,holdReady:function(a){if(a){e.readyWait++}else{e.ready(true)}},ready:function(a){if(a===true&&!--e.readyWait||a!==true&&!e.isReady){if(!c.body){return setTimeout(e.ready,1)}e.isReady=true;if(a!==true&&--e.readyWait>0){return}A.resolveWith(c,[e]);if(e.fn.trigger){e(c).trigger("ready").unbind("ready")}}},bindReady:function(){if(A){return}A=e._Deferred();if(c.readyState==="complete"){return setTimeout(e.ready,1)}if(c.addEventListener){c.addEventListener("DOMContentLoaded",B,false);a.addEventListener("load",e.ready,false)}else if(c.attachEvent){c.attachEvent("onreadystatechange",B);a.attachEvent("onload",e.ready);var b=false;try{b=a.frameElement==null}catch(d){}if(c.documentElement.doScroll&&b){J()}}},isFunction:function(a){return e.type(a)==="function"},isArray:Array.isArray||function(a){return e.type(a)==="array"},isWindow:function(a){return a&&typeof a==="object"&&"setInterval"in a},isNaN:function(a){return a==null||!m.test(a)||isNaN(a)},type:function(a){return a==null?String(a):I[C.call(a)]||"object"},isPlainObject:function(a){if(!a||e.type(a)!=="object"||a.nodeType||e.isWindow(a)){return false}if(a.constructor&&!D.call(a,"constructor")&&!D.call(a.constructor.prototype,"isPrototypeOf")){return false}var c;for(c in a){}return c===b||D.call(a,c)},isEmptyObject:function(a){for(var b in a){return false}return true},error:function(a){throw a},parseJSON:function(b){if(typeof b!=="string"||!b){return null}b=e.trim(b);if(a.JSON&&a.JSON.parse){return a.JSON.parse(b)}if(o.test(b.replace(p,"@").replace(q,"]").replace(r,""))){return(new Function("return "+b))()}e.error("Invalid JSON: "+b)},parseXML:function(c){var d,f;try{if(a.DOMParser){f=new DOMParser;d=f.parseFromString(c,"text/xml")}else{d=new ActiveXObject("Microsoft.XMLDOM");d.async="false";d.loadXML(c)}}catch(g){d=b}if(!d||!d.documentElement||d.getElementsByTagName("parsererror").length){e.error("Invalid XML: "+c)}return d},noop:function(){},globalEval:function(b){if(b&&j.test(b)){(a.execScript||function(b){a["eval"].call(a,b)})(b)}},camelCase:function(a){return a.replace(w,x)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toUpperCase()===b.toUpperCase()},each:function(a,c,d){var f,g=0,h=a.length,i=h===b||e.isFunction(a);if(d){if(i){for(f in a){if(c.apply(a[f],d)===false){break}}}else{for(;g<h;){if(c.apply(a[g++],d)===false){break}}}}else{if(i){for(f in a){if(c.call(a[f],f,a[f])===false){break}}}else{for(;g<h;){if(c.call(a[g],g,a[g++])===false){break}}}}return a},trim:G?function(a){return a==null?"":G.call(a)}:function(a){return a==null?"":a.toString().replace(k,"").replace(l,"")},makeArray:function(a,b){var c=b||[];if(a!=null){var d=e.type(a);if(a.length==null||d==="string"||d==="function"||d==="regexp"||e.isWindow(a)){E.call(c,a)}else{e.merge(c,a)}}return c},inArray:function(a,b){if(H){return H.call(b,a)}for(var c=0,d=b.length;c<d;c++){if(b[c]===a){return c}}return-1},merge:function(a,c){var d=a.length,e=0;if(typeof c.length==="number"){for(var f=c.length;e<f;e++){a[d++]=c[e]}}else{while(c[e]!==b){a[d++]=c[e++]}}a.length=d;return a},grep:function(a,b,c){var d=[],e;c=!!c;for(var f=0,g=a.length;f<g;f++){e=!!b(a[f],f);if(c!==e){d.push(a[f])}}return d},map:function(a,c,d){var f,g,h=[],i=0,j=a.length,k=a instanceof e||j!==b&&typeof j==="number"&&(j>0&&a[0]&&a[j-1]||j===0||e.isArray(a));if(k){for(;i<j;i++){f=c(a[i],i,d);if(f!=null){h[h.length]=f}}}else{for(g in a){f=c(a[g],g,d);if(f!=null){h[h.length]=f}}}return h.concat.apply([],h)},guid:1,proxy:function(a,c){if(typeof c==="string"){var d=a[c];c=a;a=d}if(!e.isFunction(a)){return b}var f=F.call(arguments,2),g=function(){return a.apply(c,f.concat(F.call(arguments)))};g.guid=a.guid=a.guid||g.guid||e.guid++;return g},access:function(a,c,d,f,g,h){var i=a.length;if(typeof c==="object"){for(var j in c){e.access(a,j,c[j],f,g,d)}return a}if(d!==b){f=!h&&f&&e.isFunction(d);for(var k=0;k<i;k++){g(a[k],c,f?d.call(a[k],k,g(a[k],c)):d,h)}return a}return i?g(a[0],c):b},now:function(){return(new Date).getTime()},uaMatch:function(a){a=a.toLowerCase();var b=s.exec(a)||t.exec(a)||u.exec(a)||a.indexOf("compatible")<0&&v.exec(a)||[];return{browser:b[1]||"",version:b[2]||"0"}},sub:function(){function a(b,c){return new a.fn.init(b,c)}e.extend(true,a,this);a.superclass=this;a.fn=a.prototype=this();a.fn.constructor=a;a.sub=this.sub;a.fn.init=function d(c,d){if(d&&d instanceof e&&!(d instanceof a)){d=a(d)}return e.fn.init.call(this,c,d,b)};a.fn.init.prototype=a.fn;var b=a(c);return a},browser:{}});e.each("Boolean Number String Function Array Date RegExp Object".split(" "),function(a,b){I["[object "+b+"]"]=b.toLowerCase()});z=e.uaMatch(y);if(z.browser){e.browser[z.browser]=true;e.browser.version=z.version}if(e.browser.webkit){e.browser.safari=true}if(j.test(" ")){k=/^[\s\xA0]+/;l=/[\s\xA0]+$/}h=e(c);if(c.addEventListener){B=function(){c.removeEventListener("DOMContentLoaded",B,false);e.ready()}}else if(c.attachEvent){B=function(){if(c.readyState==="complete"){c.detachEvent("onreadystatechange",B);e.ready()}}}return e}();var g="done fail isResolved isRejected promise then always pipe".split(" "),h=[].slice;f.extend({_Deferred:function(){var a=[],b,c,d,e={done:function(){if(!d){var c=arguments,g,h,i,j,k;if(b){k=b;b=0}for(g=0,h=c.length;g<h;g++){i=c[g];j=f.type(i);if(j==="array"){e.done.apply(e,i)}else if(j==="function"){a.push(i)}}if(k){e.resolveWith(k[0],k[1])}}return this},resolveWith:function(e,f){if(!d&&!b&&!c){f=f||[];c=1;try{while(a[0]){a.shift().apply(e,f)}}finally{b=[e,f];c=0}}return this},resolve:function(){e.resolveWith(this,arguments);return this},isResolved:function(){return!!(c||b)},cancel:function(){d=1;a=[];return this}};return e},Deferred:function(a){var b=f._Deferred(),c=f._Deferred(),d;f.extend(b,{then:function(a,c){b.done(a).fail(c);return this},always:function(){return b.done.apply(b,arguments).fail.apply(this,arguments)},fail:c.done,rejectWith:c.resolveWith,reject:c.resolve,isRejected:c.isResolved,pipe:function(a,c){return f.Deferred(function(d){f.each({done:[a,"resolve"],fail:[c,"reject"]},function(a,c){var e=c[0],g=c[1],h;if(f.isFunction(e)){b[a](function(){h=e.apply(this,arguments);if(h&&f.isFunction(h.promise)){h.promise().then(d.resolve,d.reject)}else{d[g+"With"](this===b?d:this,[h])}})}else{b[a](d[g])}})}).promise()},promise:function(a){if(a==null){if(d){return d}d=a={}}var c=g.length;while(c--){a[g[c]]=b[g[c]]}return a}});b.done(c.cancel).fail(b.cancel);delete b.cancel;if(a){a.call(b,b)}return b},when:function(a){function i(a){return function(c){b[a]=arguments.length>1?h.call(arguments,0):c;if(!--e){g.resolveWith(g,h.call(b,0))}}}var b=arguments,c=0,d=b.length,e=d,g=d<=1&&a&&f.isFunction(a.promise)?a:f.Deferred();if(d>1){for(;c<d;c++){if(b[c]&&f.isFunction(b[c].promise)){b[c].promise().then(i(c),g.reject)}else{--e}}if(!e){g.resolveWith(g,b)}}else if(g!==a){g.resolveWith(g,d?[a]:[])}return g.promise()}});f.support=f.support||{};var i=/%20/g,j=/\[\]$/,k=/\r?\n/g,l=/#.*$/,m=/^(.*?):[ \t]*([^\r\n]*)\r?$/mg,n=/^(?:color|date|datetime|email|hidden|month|number|password|range|search|tel|text|time|url|week)$/i,o=/^(?:about|app|app\-storage|.+\-extension|file|res|widget):$/,p=/^(?:GET|HEAD)$/,q=/^\/\//,r=/\?/,s=/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,t=/^(?:select|textarea)/i,u=/\s+/,v=/([?&])_=[^&]*/,w=/^([\w\+\.\-]+:)(?:\/\/([^\/?#:]*)(?::(\d+))?)?/,x=f.fn.load,y={},z={},A,B;try{A=e.href}catch(C){A=c.createElement("a");A.href="";A=A.href}B=w.exec(A.toLowerCase())||[];f.fn.extend({load:function(a,c,d){if(typeof a!=="string"&&x){return x.apply(this,arguments)}else if(!this.length){return this}var e=a.indexOf(" ");if(e>=0){var g=a.slice(e,a.length);a=a.slice(0,e)}var h="GET";if(c){if(f.isFunction(c)){d=c;c=b}else if(typeof c==="object"){c=f.param(c,f.ajaxSettings.traditional);h="POST"}}var i=this;f.ajax({url:a,type:h,dataType:"html",data:c,complete:function(a,b,c){c=a.responseText;if(a.isResolved()){a.done(function(a){c=a});i.html(g?f("<div>").append(c.replace(s,"")).find(g):c)}if(d){i.each(d,[c,b,a])}}});return this},serialize:function(){return f.param(this.serializeArray())},serializeArray:function(){return this.map(function(){return this.elements?f.makeArray(this.elements):this}).filter(function(){return this.name&&!this.disabled&&(this.checked||t.test(this.nodeName)||n.test(this.type))}).map(function(a,b){var c=f(this).val();return c==null?null:f.isArray(c)?f.map(c,function(a,c){return{name:b.name,value:a.replace(k,"\r\n")}}):{name:b.name,value:c.replace(k,"\r\n")}}).get()}});f.each("ajaxStart ajaxStop ajaxComplete ajaxError ajaxSuccess ajaxSend".split(" "),function(a,b){f.fn[b]=function(a){return this.bind(b,a)}});f.each(["get","post"],function(a,c){f[c]=function(a,d,e,g){if(f.isFunction(d)){g=g||e;e=d;d=b}return f.ajax({type:c,url:a,data:d,success:e,dataType:g})}});f.extend({getScript:function(a,c){return f.get(a,b,c,"script")},getJSON:function(a,b,c){return f.get(a,b,c,"json")},ajaxSetup:function(a,b){if(b){F(a,f.ajaxSettings)}else{b=a;a=f.ajaxSettings}F(a,b);return a},ajaxSettings:{url:A,isLocal:o.test(B[1]),global:true,type:"GET",contentType:"application/x-www-form-urlencoded",processData:true,async:true,accepts:{xml:"application/xml, text/xml",html:"text/html",text:"text/plain",json:"application/json, text/javascript","*":"*/*"},contents:{xml:/xml/,html:/html/,json:/json/},responseFields:{xml:"responseXML",text:"responseText"},converters:{"* text":a.String,"text html":true,"text json":f.parseJSON,"text xml":f.parseXML},flatOptions:{context:true,url:true}},ajaxPrefilter:D(y),ajaxTransport:D(z),ajax:function(a,c){function K(a,c,l,m){if(D===2){return}D=2;if(A){clearTimeout(A)}x=b;s=m||"";J.readyState=a>0?4:0;var n,o,p,q=c,r=l?H(d,J,l):b,t,u;if(a>=200&&a<300||a===304){if(d.ifModified){if(t=J.getResponseHeader("Last-Modified")){f.lastModified[k]=t}if(u=J.getResponseHeader("Etag")){f.etag[k]=u}}if(a===304){q="notmodified";n=true}else{try{o=I(d,r);q="success";n=true}catch(v){q="parsererror";p=v}}}else{p=q;if(!q||a){q="error";if(a<0){a=0}}}J.status=a;J.statusText=""+(c||q);if(n){h.resolveWith(e,[o,q,J])}else{h.rejectWith(e,[J,q,p])}J.statusCode(j);j=b;if(F){g.trigger("ajax"+(n?"Success":"Error"),[J,d,n?o:p])}i.resolveWith(e,[J,q]);if(F){g.trigger("ajaxComplete",[J,d]);if(!--f.active){f.event.trigger("ajaxStop")}}}if(typeof a==="object"){c=a;a=b}c=c||{};var d=f.ajaxSetup({},c),e=d.context||d,g=e!==d&&(e.nodeType||e instanceof f)?f(e):f.event,h=f.Deferred(),i=f._Deferred(),j=d.statusCode||{},k,n={},o={},s,t,x,A,C,D=0,F,G,J={readyState:0,setRequestHeader:function(a,b){if(!D){var c=a.toLowerCase();a=o[c]=o[c]||a;n[a]=b}return this},getAllResponseHeaders:function(){return D===2?s:null},getResponseHeader:function(a){var c;if(D===2){if(!t){t={};while(c=m.exec(s)){t[c[1].toLowerCase()]=c[2]}}c=t[a.toLowerCase()]}return c===b?null:c},overrideMimeType:function(a){if(!D){d.mimeType=a}return this},abort:function(a){a=a||"abort";if(x){x.abort(a)}K(0,a);return this}};h.promise(J);J.success=J.done;J.error=J.fail;J.complete=i.done;J.statusCode=function(a){if(a){var b;if(D<2){for(b in a){j[b]=[j[b],a[b]]}}else{b=a[J.status];J.then(b,b)}}return this};d.url=((a||d.url)+"").replace(l,"").replace(q,B[1]+"//");d.dataTypes=f.trim(d.dataType||"*").toLowerCase().split(u);if(d.crossDomain==null){C=w.exec(d.url.toLowerCase());d.crossDomain=!!(C&&(C[1]!=B[1]||C[2]!=B[2]||(C[3]||(C[1]==="http:"?80:443))!=(B[3]||(B[1]==="http:"?80:443))))}if(d.data&&d.processData&&typeof d.data!=="string"){d.data=f.param(d.data,d.traditional)}E(y,d,c,J);if(D===2){return false}F=d.global;d.type=d.type.toUpperCase();d.hasContent=!p.test(d.type);if(F&&f.active++===0){f.event.trigger("ajaxStart")}if(!d.hasContent){if(d.data){d.url+=(r.test(d.url)?"&":"?")+d.data;delete d.data}k=d.url;if(d.cache===false){var L=f.now(),M=d.url.replace(v,"$1_="+L);d.url=M+(M===d.url?(r.test(d.url)?"&":"?")+"_="+L:"")}}if(d.data&&d.hasContent&&d.contentType!==false||c.contentType){J.setRequestHeader("Content-Type",d.contentType)}if(d.ifModified){k=k||d.url;if(f.lastModified[k]){J.setRequestHeader("If-Modified-Since",f.lastModified[k])}if(f.etag[k]){J.setRequestHeader("If-None-Match",f.etag[k])}}J.setRequestHeader("Accept",d.dataTypes[0]&&d.accepts[d.dataTypes[0]]?d.accepts[d.dataTypes[0]]+(d.dataTypes[0]!=="*"?", */*; q=0.01":""):d.accepts["*"]);for(G in d.headers){J.setRequestHeader(G,d.headers[G])}if(d.beforeSend&&(d.beforeSend.call(e,J,d)===false||D===2)){J.abort();return false}for(G in{success:1,error:1,complete:1}){J[G](d[G])}x=E(z,d,c,J);if(!x){K(-1,"No Transport")}else{J.readyState=1;if(F){g.trigger("ajaxSend",[J,d])}if(d.async&&d.timeout>0){A=setTimeout(function(){J.abort("timeout")},d.timeout)}try{D=1;x.send(n,K)}catch(N){if(D<2){K(-1,N)}else{f.error(N)}}}return J},param:function(a,c){var d=[],e=function(a,b){b=f.isFunction(b)?b():b;d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(c===b){c=f.ajaxSettings.traditional}if(f.isArray(a)||a.jquery&&!f.isPlainObject(a)){f.each(a,function(){e(this.name,this.value)})}else{for(var g in a){G(g,a[g],c,e)}}return d.join("&").replace(i,"+")}});f.extend({active:0,lastModified:{},etag:{}});var J=a.ActiveXObject?function(){for(var a in L){L[a](0,1)}}:false,K=0,L;f.ajaxSettings.xhr=a.ActiveXObject?function(){return!this.isLocal&&M()||N()}:M;(function(a){f.extend(f.support,{ajax:!!a,cors:!!a&&"withCredentials"in a})})(f.ajaxSettings.xhr());if(f.support.ajax){f.ajaxTransport(function(c){if(!c.crossDomain||f.support.cors){var d;return{send:function(e,g){var h=c.xhr(),i,j;if(c.username){h.open(c.type,c.url,c.async,c.username,c.password)}else{h.open(c.type,c.url,c.async)}if(c.xhrFields){for(j in c.xhrFields){h[j]=c.xhrFields[j]}}if(c.mimeType&&h.overrideMimeType){h.overrideMimeType(c.mimeType)}if(!c.crossDomain&&!e["X-Requested-With"]){e["X-Requested-With"]="XMLHttpRequest"}try{for(j in e){h.setRequestHeader(j,e[j])}}catch(k){}h.send(c.hasContent&&c.data||null);d=function(a,e){var j,k,l,m,n;try{if(d&&(e||h.readyState===4)){d=b;if(i){h.onreadystatechange=f.noop;if(J){delete L[i]}}if(e){if(h.readyState!==4){h.abort()}}else{j=h.status;l=h.getAllResponseHeaders();m={};n=h.responseXML;if(n&&n.documentElement){m.xml=n}m.text=h.responseText;try{k=h.statusText}catch(o){k=""}if(!j&&c.isLocal&&!c.crossDomain){j=m.text?200:404}else if(j===1223){j=204}}}}catch(p){if(!e){g(-1,p)}}if(m){g(j,k,m,l)}};if(!c.async||h.readyState===4){d()}else{i=++K;if(J){if(!L){L={};f(a).unload(J)}L[i]=d}h.onreadystatechange=d}},abort:function(){if(d){d(0,1)}}}}})}f.ajaxSettings.global=false;a.jQuery=a.$=f})(global)}
},{}],5:[function(require,module,exports){
// ==============================================================
// = BAM format: https://samtools.github.io/hts-specs/SAMv1.pdf =
// ==============================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10,
  deepClone = utils.deepClone;
var PairedIntervalTree = require('./utils/PairedIntervalTree.js').PairedIntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

var BamFormat = {
  defaults: {
    chromosomes: '',
    itemRgb: 'off',
    color: '188,188,188',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    viewLimits: '',  // analogous to viewLimits in wiggle_0, applicable here to the coverage subtrack
    url: '',
    htmlUrl: '',
    drawLimit: {squish: 2000, pack: 2000},
    covHeight: {dense: 24, squish: 38, pack: 38},
    // If a nucleotide differs from the reference sequence in greater than 20% of quality weighted reads, 
    // IGV colors the bar in proportion to the read count of each base; the following changes that threshold for chromozoom
    alleleFreqThreshold: 0.2,
    // Data for how many nts should be fetched in one go?
    optimalFetchWindow: 0,
    // Above what tile width (in nts) do we avoid fetching data altogether?
    maxFetchWindow: 0,
    // The following can be "ensembl_ucsc" or "ucsc_ensembl" to attempt auto-crossmapping of reference contig names
    // between the two schemes, which IGV does, but is a perennial issue: https://www.biostars.org/p/10062/
    // I hope not to need all the mappings in here https://github.com/dpryan79/ChromosomeMappings but it may be necessary
    convertChrScheme: "auto",
    // Draw paired ends within a range of expected insert sizes as a continuous feature?
    // See https://www.broadinstitute.org/igv/AlignmentData#paired for how this works
    viewAsPairs: false,
    expectedInsertSizePercentiles: [0.005, 0.995]
  },
  
  // The FLAG column for BAM/SAM is a combination of bitwise flags
  flags: {
    isReadPaired: 0x1,
    isReadProperlyAligned: 0x2,
    isReadUnmapped: 0x4,
    isMateUnmapped: 0x8,
    readStrandReverse: 0x10,
    mateStrandReverse: 0x20,
    isReadFirstOfPair: 0x40,
    isReadLastOfPair: 0x80,
    isSecondaryAlignment: 0x100,
    isReadFailingVendorQC: 0x200,
    isDuplicateRead: 0x400,
    isSupplementaryAlignment: 0x800
  },

  init: function() {
    var browserChrs = _.keys(this.browserOpts);
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for BAM track at " +
          JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type().initOpts.call(this);
    this.browserChrScheme = this.type("bam").guessChrScheme(_.keys(this.browserOpts.chrPos));
  },
  
  initOpts: function() {
    var o = this.opts;
    o.viewAsPairs = this.isOn(o.viewAsPairs);
    if (!_.isArray(o.viewLimits)) {
      o.viewLimits = _.map(o.viewLimits.split(':'), parseFloat);
    }
  },
  
  // TODO: If the pairing interval changed, we should toss the entire cache and reset the RemoteTrack bins,
  //         *and* blow up the areaIndex.
  applyOpts: function() {
    var self = this,
      o = this.opts;
    // When we change opts.viewAsPairs, we *need* to throw out this.data.pileup.
    if (o.viewAsPairs != this.prevOpts.viewAsPairs && this.data && this.data.pileup) { 
      this.data.pileup = {};
    }
    this.drawRange = o.autoScale || o.viewLimits.length < 2 ? this.coverageRange : o.viewLimits;
    this.scales = _.mapObject({dense: 0, squish: 0, pack: 0}, function(v, k) {
      return [{limits: self.drawRange, top: 0, height: o.covHeight[k] || 24}];
    });
    // TODO: Setup this.scales here
    
    // Ensures that options and derived properties set by the above are equal across Web Worker and DOM contexts
    this.syncProps(['opts', 'drawRange', 'coverageRange', 'scales']);
    
    this.prevOpts = deepClone(this.opts);
  },
  
  guessChrScheme: function(chrs) {
    limit = Math.min(chrs.length * 0.8, 20);
    if (_.filter(chrs, function(chr) { return (/^chr/).test(chr); }).length > limit) { return 'ucsc'; }
    if (_.filter(chrs, function(chr) { return (/^\d\d?$/).test(chr); }).length > limit) { return 'ensembl'; }
    return null;
  },
  
  parse: function(lines) {
    var self = this,
      o = self.opts,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new PairedIntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}, 
          {startKey: 'templateStart', endKey: 'templateEnd', pairedLengthKey: 'tlen', pairingKey: 'qname'}),
      ajaxUrl = self.ajaxDir() + 'bam.php',
      infoChrRange = self.chrRange(Math.round(self.browserOpts.pos), Math.round(self.browserOpts.pos + 10000)),
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
      // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
      switch (o.convertChrScheme == "auto" ? self.data.info.convertChrScheme : o.convertChrScheme) {
        case 'ensembl_ucsc': range = _.map(range, function(r) { return r.replace(/^chr/, ''); }); break;
        case 'ucsc_ensembl': range = _.map(range, function(r) { return r.replace(/^(\d\d?|X):/, 'chr$1:'); }); break;
      }
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl},
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          
          // Parse the SAM format into intervals that can be inserted into the IntervalTree cache
          var intervals = _.map(lines, function(l) { return self.type('bam').parseLine.call(self, l); });
          storeIntervals(intervals);
        }
      });
    });
    
    self.data = {cache: cache, remote: remote, pileup: {}, info: {}};
    self.heights = {max: null, min: 24, start: 24};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    self.noAreaLabels = true;
    self.expectsSequence = true;
    self.renderSequenceCallbacks = {};
    self.coverageRange = [0, 0];
    self.prevOpts = deepClone(o);  // used to detect which drawing options have been changed by the user
    
    // Get general info on the bam (e.g. `samtools idxstats`), use mapped reads per reference sequence
    // to estimate maxFetchWindow and optimalFetchWindow, and setup binning on the RemoteTrack.
    // We also fetch a bunch of reads from around infoChrRange (by default, where the browser is when
    // it first loads this track) to estimate meanItemLength, mate pairing, and the insert size distribution.
    $.ajax(ajaxUrl, {
      data: {info: 1, range: infoChrRange, url: o.bigDataUrl},
      success: function(data) {
        var mappedReads = 0,
          maxItemsToDraw = _.max(_.values(o.drawLimit)),
          bamChrs = [],
          infoParts = data.split("\n\n"),
          estimatedInsertSizes = [],
          pctiles = o.expectedInsertSizePercentiles,
          lowerBound = 10, 
          upperBound = 5000, 
          sampleIntervals, meanItemLength, hasAMatePair, chrScheme, meanItemsPerBp;
        
        _.each(infoParts[0].split("\n"), function(line) {
          var fields = line.split("\t"),
            readsMappedToContig = parseInt(fields[2], 10);
          if (fields.length == 1 && fields[0] == '') { return; } // blank line
          bamChrs.push(fields[0]);
          if (_.isNaN(readsMappedToContig)) { throw new Error("Invalid output for samtools idxstats on this BAM track."); }
          mappedReads += readsMappedToContig;
        });
        
        self.data.info.chrScheme = chrScheme = self.type("bam").guessChrScheme(bamChrs);
        if (chrScheme && self.browserChrScheme) {
          self.data.info.convertChrScheme = chrScheme != self.browserChrScheme ? chrScheme + '_' + self.browserChrScheme : null;
        }
        
        sampleIntervals = _.compact(_.map(infoParts[1].split("\n"), function(line) {
          return self.type('bam').parseLine.call(self, line);
        }));
        if (sampleIntervals.length) {
          meanItemLength = _.reduce(sampleIntervals, function(memo, next) { return memo + (next.end - next.start); }, 0);
          meanItemLength = Math.round(meanItemLength / sampleIntervals.length);
          hasAMatePair = _.some(sampleIntervals, function(itvl) { 
            return itvl.flags.isReadFirstOfPair || itvl.flags.isReadLastOfPair;
          });
          estimatedInsertSizes = _.compact(_.map(sampleIntervals, function(itvl) { 
            return itvl.tlen ? Math.abs(itvl.tlen) : 0; 
          }));
          estimatedInsertSizes.sort(function(a, b) { return a - b; });  // NOTE: JavaScript does string sorting by default -_-
        }
        
        self.data.info.meanItemsPerBp = meanItemsPerBp = mappedReads / self.browserOpts.genomeSize;
        self.data.info.meanItemLength = meanItemLength = _.isUndefined(meanItemLength) ? 100 : meanItemLength;
        if (!o.optimalFetchWindow || !o.maxFetchWindow) {
          o.optimalFetchWindow = Math.floor(maxItemsToDraw / meanItemsPerBp / (Math.max(meanItemLength, 100) / 100) * 0.5);
          o.maxFetchWindow = o.optimalFetchWindow * 2;
        }
        if (!self.coverageRange[1]) { self.coverageRange[1] = Math.ceil(meanItemsPerBp * meanItemLength * 2); }
        self.type('bam').applyOpts.call(self);
        
        // If there is pairing, we need to tell the PairedIntervalTree what range of insert sizes should trigger pairing.
        if (hasAMatePair) {
          if (estimatedInsertSizes.length) {
            lowerBound = estimatedInsertSizes[Math.floor(estimatedInsertSizes.length * pctiles[0])];
            upperBound = estimatedInsertSizes[Math.floor(estimatedInsertSizes.length * pctiles[1])];
          }
          self.data.cache.setPairingInterval(lowerBound, upperBound);
        } else {
          // If we don't see any paired reads in this BAM, deactivate the pairing functionality of the PairedIntervalTree 
          self.data.cache.disablePairing();
        }
        remote.setupBins(self.browserOpts.genomeSize, o.optimalFetchWindow, o.maxFetchWindow);
      }
    });
    
    return true;
  },
  
  // Sets feature.flags[...] to a human interpretable version of feature.flag (expanding the bitwise flags)
  parseFlags: function(feature, lineno) {
    feature.flags = {};
    _.each(this.type('bam').flags, function(bit, flag) {
      feature.flags[flag] = !!(feature.flag & bit);
    });
  },
  
  // Sets feature.blocks and feature.end based on feature.cigar
  // See section 1.4 of https://samtools.github.io/hts-specs/SAMv1.pdf for an explanation of CIGAR 
  parseCigar: function(feature, lineno) {        
    var cigar = feature.cigar,
      seq = (!feature.seq || feature.seq == '*') ? "" : feature.seq,
      refLen = 0,
      seqPos = 0,
      operations, lengths;
    
    feature.blocks = [];
    feature.insertions = [];
    
    ops = cigar.split(/\d+/).slice(1);
    lengths = cigar.split(/[A-Z=]/).slice(0, -1);
    if (ops.length != lengths.length) { this.warn("Invalid CIGAR '" + cigar + "' for " + feature.desc); return; }
    lengths = _.map(lengths, parseInt10);
    
    _.each(ops, function(op, i) {
      var len = lengths[i],
        block, insertion;
      if (/^[MX=]$/.test(op)) {
        // Alignment match, sequence match, sequence mismatch
        block = {start: feature.start + refLen};
        block.end = block.start + len;
        block.type = op;
        block.seq = seq.slice(seqPos, seqPos + len);
        feature.blocks.push(block);
        refLen += len;
        seqPos += len;
      } else if (/^[ND]$/.test(op)) {
        // Skipped reference region, deletion from reference
        refLen += len;
      } else if (op == 'I') {
        // Insertion
        insertion = {start: feature.start + refLen, end: feature.start + refLen};
        insertion.seq = seq.slice(seqPos, seqPos + len);
        feature.insertions.push(insertion);
        seqPos += len;
      } else if (op == 'S') {
        // Soft clipping; simply skip these bases in SEQ, position on reference is unchanged.
        seqPos += len;
      }
      // The other two CIGAR ops, H and P, are not relevant to drawing alignments.
    });
    
    feature.end = feature.start + refLen;
  },
  
  parseLine: function(line, lineno) {
    var o = this.opts,
      cols = ['qname', 'flag', 'rname', 'pos', 'mapq', 'cigar', 'rnext', 'pnext', 'tlen', 'seq', 'qual'],
      feature = {},
      fields = line.split("\t"),
      availFlags = this.type('bam').flags,
      chrPos, blockSizes;
    
    _.each(_.first(fields, cols.length), function(v, i) { feature[cols[i]] = v; });
    // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
    // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
    switch (o.convertChrScheme == "auto" ? this.data.info.convertChrScheme : o.convertChrScheme) {
      case 'ucsc_ensembl': feature.rname = feature.rname.replace(/^chr/, ''); break;
      case 'ensembl_ucsc': feature.rname = (/^(\d\d?|X)$/.test(feature.rname) ? 'chr' : '') + feature.rname; break;
    }
    feature.name = feature.qname;
    feature.flag = parseInt10(feature.flag);
    chrPos = this.browserOpts.chrPos[feature.rname];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) {
      this.warn("Invalid RNAME '"+feature.rname+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else if (feature.pos === '0' || !feature.cigar || feature.cigar == '*' || feature.flag & availFlags.isReadUnmapped) {
      // Unmapped read. Since we can't draw these at all, we don't bother parsing them further.
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.pos);        // POS is 1-based, hence no increment as for parsing BED
      feature.desc = feature.qname + ' at ' + feature.rname + ':' + feature.pos;
      feature.tlen = parseInt10(feature.tlen);
      this.type('bam').parseFlags.call(this, feature, lineno);
      feature.strand = feature.flags.readStrandReverse ? '-' : '+';
      this.type('bam').parseCigar.call(this, feature, lineno); // This also sets .end appropriately
    }
    // We have to come up with something that is a unique label for every line to dedupe rows.
    // The following is technically not guaranteed by a valid BAM (even at GATK standards), but it's the best I got.
    feature.id = [feature.qname, feature.flag, feature.rname, feature.pos, feature.cigar].join("\t");
    
    return feature;
  },
  
  pileup: function(intervals, start, end) {
    var pileup = this.data.pileup,
      positionsToCalculate = {},
      numPositionsToCalculate = 0,
      i;
    
    for (i = start; i < end; i++) {
      // No need to pileup again on already-piled-up nucleotide positions
      if (!pileup[i]) { positionsToCalculate[i] = true; numPositionsToCalculate++; }
    }
    if (numPositionsToCalculate === 0) { return; } // All positions already piled up!
    
    _.each(intervals, function(interval) {
      var blockSets = [interval.data.blocks];
      if (interval.data.drawAsMates && interval.data.mate) { blockSets.push(interval.data.mate.blocks); }
      _.each(blockSets, function(blocks) {
        _.each(blocks, function(block) {
          var nt, i;
          for (i = Math.max(block.start, start); i < Math.min(block.end, end); i++) {
            if (!positionsToCalculate[i]) { continue; }
            nt = (block.seq[i - block.start] || '').toUpperCase();
            pileup[i] = pileup[i] || {A: 0, C: 0, G: 0, T: 0, N: 0, cov: 0};
            pileup[i][(/[ACTG]/).test(nt) ? nt : 'N'] += 1;
            pileup[i].cov += 1;
          }
        });
      });
    });
  },
  
  coverage: function(start, width, bppp) {
    // Compare with binning on the fly in .type('wiggle_0').prerender(...)
    var j = start,
      curr = this.data.pileup[j],
      bars = [],
      next, bin, i;
    for (i = 0; i < width; i++) {
      bin = curr && (j + 1 >= i * bppp + start) ? [curr.cov] : [];
      next = this.data.pileup[j + 1];
      while (j + 1 < (i + 1) * bppp + start && j + 2 >= i * bppp + start) { 
        if (next) { bin.push(next.cov); }
        ++j;
        curr = next;
        next = this.data.pileup[j + 1];
      }
      bars.push(utils.wigBinFunctions.maximum(bin));
    }
    return bars;
  },
  
  alleles: function(start, sequence, bppp) {
    var pileup = this.data.pileup,
      alleleFreqThreshold = this.opts.alleleFreqThreshold,
      alleleSplits = [],
      split, refNt, i, pile;
      
    for (i = 0; i < sequence.length; i++) {
      refNt = sequence[i].toUpperCase();
      pile = pileup[start + i];
      if (pile && pile.cov && pile[refNt] / (pile.cov - pile.N) < (1 - alleleFreqThreshold)) {
        split = {
          x: i / bppp,
          splits: []
        };
        _.each(['A', 'C', 'G', 'T'], function(nt) {
          if (pile[nt] > 0) { split.splits.push({nt: nt, h: pile[nt]}); }
        });
        alleleSplits.push(split);
      }
    }
    
    return alleleSplits;
  },
  
  mismatches: function(start, sequence, bppp, intervals, width, lineNum, viewAsPairs) {
    var mismatches = [],
      viewAsPairs = this.opts.viewAsPairs;
    sequence = sequence.toUpperCase();
    _.each(intervals, function(interval) {
      var blockSets = [interval.data.blocks];
      if (viewAsPairs && interval.data.drawAsMates && interval.data.mate) { 
        blockSets.push(interval.data.mate.blocks);
      }
      _.each(blockSets, function(blocks) {
        _.each(blocks, function(block) {
          var line = lineNum(interval.data),
            nt, i, x;
          for (i = Math.max(block.start, start); i < Math.min(block.end, start + width * bppp); i++) {
            x = (i - start) / bppp;
            nt = (block.seq[i - block.start] || '').toUpperCase();
            if (nt && nt != sequence[i - start] && line) { mismatches.push({x: x, nt: nt, line: line}); }
          }
        });
      });
    });
    return mismatches;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      sequence = precalc.sequence,
      data = self.data,
      viewAsPairs = self.opts.viewAsPairs,
      startKey = viewAsPairs ? 'templateStart' : 'start',
      endKey = viewAsPairs ? 'templateEnd' : 'end',
      bppp = (end - start) / width;
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density + '_' + (viewAsPairs ? 'p' : 'u');
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch an insane amount of rows 
    // (>500 alignments), as this will only hold up other requests.
    if (self.opts.maxFetchWindow && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      // Fetch from the RemoteTrack and call the above when the data is available.
      self.data.remote.fetchAsync(start, end, viewAsPairs, function(intervals) {
        var drawSpec = {sequence: !!sequence, width: width},
          calcPixIntervalMated = new utils.pixIntervalCalculator(start, width, bppp, 4, false, startKey, endKey),
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, 4);
        
        if (intervals.tooMany) { return callback(intervals); }

        if (!sequence) {
          // First drawing pass, with features that don't depend on sequence.
          self.type('bam').pileup.call(self, intervals, start, end);
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixIntervalMated, lineNum);
          _.each(drawSpec.layout, function(lines) {
            _.each(lines, function(interval) {
              interval.insertionPts = _.map(interval.d.insertions, calcPixInterval);
              if (!viewAsPairs) { return; }
              if (interval.d.drawAsMates && interval.d.mate) {
                interval.mateInts = _.map([interval.d, interval.d.mate], calcPixInterval);
                interval.mateBlockInts = _.map(interval.d.mate.blocks, calcPixInterval);
                interval.mateInsertionPts = _.map(interval.d.mate.insertionPts, calcPixInterval);
              } else if (interval.d.mateExpected) {
                interval.mateInts = [calcPixInterval(interval)];
                interval.mateBlockInts = [];
                interval.mateInsertionPts = [];
              }
            });
          });
          drawSpec.coverage = self.type('bam').coverage.call(self, start, width, bppp);
        } else {
          // Second drawing pass, to draw things that are dependent on sequence, like mismatches (potential SNPs).
          drawSpec.bppp = bppp;  
          // Find allele splits within the coverage graph.
          drawSpec.alleles = self.type('bam').alleles.call(self, start, sequence, bppp);
          // Find mismatches within each aligned block.
          drawSpec.mismatches = self.type('bam').mismatches.call(self, start, sequence, bppp, intervals, width, lineNum);
        }
        
        callback(drawSpec);
      });
    }
  },
  
  // special formatter for content in tooltips for features
  tipTipData: function(data) {
    var o = this.opts,
      content = {},
      firstMate = data.d,
      secondMate = data.d.mate,
      mateHeaders = ["this alignment", "mate pair alignment"],
      leftMate, rightMate, pairOrientation;
    function yesNo(bool) { return bool ? "yes" : "no"; }
    function addAlignedSegmentInfo(content, seg, prefix) {
      var cigarAbbrev = seg.cigar && seg.cigar.length > 25 ? seg.cigar.substr(0, 24) + '...' : seg.cigar;
      prefix = prefix || "";
      
      _.each({
        "position": seg.rname + ':' + seg.pos,
        "cigar": cigarAbbrev,
        "read strand": seg.flags.readStrandReverse ? '(-)' : '(+)',
        "mapped": yesNo(!seg.flags.isReadUnmapped),
        "map quality": seg.mapq,
        "secondary": yesNo(seg.flags.isSecondaryAlignment),
        "supplementary": yesNo(seg.flags.isSupplementaryAlignment),
        "duplicate": yesNo(seg.flags.isDuplicateRead),
        "failed QC": yesNo(seg.flags.isReadFailingVendorQC)
      }, function(v, k) { content[prefix + k] = v; });
    }
    
    if (data.d.mate && data.d.mate.flags) {
      leftMate = data.d.start < data.d.mate.start ? data.d : data.d.mate;
      rightMate = data.d.start < data.d.mate.start ? data.d.mate : data.d;
      pairOrientation = (leftMate.flags.readStrandReverse ? "R" : "F") + (leftMate.flags.isReadFirstOfPair ? "1" : "2");
      pairOrientation += (rightMate.flags.readStrandReverse ? "R" : "F") + (rightMate.flags.isReadLastOfPair ? "2" : "1");
    }
    
    if (o.viewAsPairs && data.d.drawAsMates && data.d.mate) {
      firstMate = leftMate;
      secondMate = rightMate;
      mateHeaders = ["left alignment", "right alignment"];
    }
    if (secondMate) {
      if (!_.isUndefined(data.d.insertSize)) { content["insert size"] = data.d.insertSize; }
      if (!_.isUndefined(pairOrientation)) { content["pair orientation"] = pairOrientation; }
      content[mateHeaders[0]] = "---";
      addAlignedSegmentInfo(content, firstMate);
      content[mateHeaders[1]] = "---";
      addAlignedSegmentInfo(content, secondMate, " ");
    } else {
      addAlignedSegmentInfo(content, data.d);
    }
    
    return content;
  },
  
  // See https://www.broadinstitute.org/igv/AlignmentData#coverage for an idea of what we're imitating
  drawCoverage: function(ctx, coverage, height) {
    var vScale = this.drawRange[1];
    _.each(coverage, function(d, x) {
      if (d === null) { return; }
      var h = d * height / vScale;
      ctx.fillRect(x, Math.max(height - h, 0), 1, Math.min(h, height));
    });
  },
  
  drawStrandIndicator: function(ctx, x, blockY, blockHeight, xScale, bigStyle) {
    var prevFillStyle = ctx.fillStyle;
    if (bigStyle) {
      ctx.beginPath();
      ctx.moveTo(x - (2 * xScale), blockY);
      ctx.lineTo(x + (3 * xScale), blockY + blockHeight/2);
      ctx.lineTo(x - (2 * xScale), blockY + blockHeight);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgb(140,140,140)';
      ctx.fillRect(x + (xScale > 0 ? -2 : 1), blockY, 1, blockHeight);
      ctx.fillRect(x + (xScale > 0 ? -1 : 0), blockY + 1, 1, blockHeight - 2);
      ctx.fillStyle = prevFillStyle;
    }
  },
  
  drawAlignment: function(ctx, width, data, i, lineHeight) {
    var self = this,
      drawMates = data.mateInts,
      color = self.opts.color,
      lineGap = lineHeight > 6 ? 2 : 0,
      blockY = i * lineHeight + lineGap/2,
      blockHeight = lineHeight - lineGap,
      deletionLineWidth = 2,
      insertionCaretLineWidth = lineHeight > 6 ? 2 : 1,
      halfHeight = Math.round(0.5 * lineHeight) - deletionLineWidth * 0.5,
      blockSets = [{blockInts: data.blockInts, strand: data.d.strand}];
    
    // For mate pairs, the full pixel interval represents the line linking the mates
    if (drawMates) {
      ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
      ctx.fillRect(data.pInt.x, i * lineHeight + halfHeight, data.pInt.w, deletionLineWidth);
    }
    
    // Draw the lines that show the full alignment for each segment, including deletions
    ctx.fillStyle = ctx.strokeStyle = 'rgb(0,0,0)';
    _.each(drawMates || [data.pInt], function(pInt) {
      if (pInt.w <= 0) { return; }
      // Note that the "- 1" below fixes rounding issues but gambles on there never being a deletion at the right edge
      ctx.fillRect(pInt.x, i * lineHeight + halfHeight, pInt.w - 1, deletionLineWidth);
    });
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
    ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
    
    // Draw the [mis]match (M/X/=) blocks
    if (drawMates && data.d.mate) { blockSets.push({blockInts: data.mateBlockInts, strand: data.d.mate.strand}); }
    _.each(blockSets, function(blockSet) {
      var strand = blockSet.strand;
      _.each(blockSet.blockInts, function(bInt, blockNum) {
      
        // Skip drawing blocks that aren't inside the canvas
        if (bInt.x + bInt.w < 0 || bInt.x > width) { return; }
      
        if (blockNum == 0 && blockSet.strand == '-' && !bInt.oPrev) {
          ctx.fillRect(bInt.x + 2, blockY, bInt.w - 2, blockHeight);
          self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x, blockY, blockHeight, -1, lineHeight > 6);
        } else if (blockNum == blockSet.blockInts.length - 1 && blockSet.strand == '+' && !bInt.oNext) {
          ctx.fillRect(bInt.x, blockY, bInt.w - 2, blockHeight);
          self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x + bInt.w, blockY, blockHeight, 1, lineHeight > 6);
        } else {
          ctx.fillRect(bInt.x, blockY, bInt.w, blockHeight);
        }
      });
    });
    
    // Draw insertions
    ctx.fillStyle = ctx.strokeStyle = "rgb(114,41,218)";
    _.each(drawMates ? [data.insertionPts, data.mateInsertionPts] : [data.insertionPts], function(insertionPts) {
      _.each(insertionPts, function(insert) {
        if (insert.x + insert.w < 0 || insert.x > width) { return; }
        ctx.fillRect(insert.x - 1, i * lineHeight, 2, lineHeight);
        ctx.fillRect(insert.x - 2, i * lineHeight, 4, insertionCaretLineWidth);
        ctx.fillRect(insert.x - 2, (i + 1) * lineHeight - insertionCaretLineWidth, 4, insertionCaretLineWidth);
      });
    });
  },
  
  drawAlleles: function(ctx, alleles, height, barWidth) {
    // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
    var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
      vScale = this.drawRange[1],
      yPos;
    _.each(alleles, function(allelesForPosition) {
      yPos = height;
      _.each(allelesForPosition.splits, function(split) {
        var h = split.h * height / vScale;
        ctx.fillStyle = 'rgb('+colors[split.nt]+')';
        ctx.fillRect(allelesForPosition.x, yPos -= h, Math.max(barWidth, 1), h);
      });
    });
  },
  
  drawMismatch: function(ctx, mismatch, lineOffset, lineHeight, ppbp) {
    // ppbp == pixels per base pair (inverse of bppp)
    // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
    var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
      lineGap = lineHeight > 6 ? 2 : 0,
      yPos;
    ctx.fillStyle = 'rgb('+colors[mismatch.nt]+')';
    ctx.fillRect(mismatch.x, (mismatch.line + lineOffset) * lineHeight + lineGap / 2, Math.max(ppbp, 1), lineHeight - lineGap);
    // Do we have room to print a whole letter?
    if (ppbp > 7 && lineHeight > 10) {
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillText(mismatch.nt, mismatch.x + ppbp * 0.5, (mismatch.line + lineOffset + 1) * lineHeight - lineGap);
    }
  },
  
  drawSpec: function(canvas, drawSpec, density) {
    var self = this,
      ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = 'javascript:void("'+self.opts.name+':$$")',
      drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
      lineHeight = density == 'pack' ? 14 : 4,
      covHeight = self.opts.covHeight[density] || 38,
      covMargin = 7,
      lineOffset = ((covHeight + covMargin) / lineHeight), 
      color = self.opts.color,
      areas = null;
            
    if (!ctx) { throw "Canvas not supported"; }
    
    if (!drawSpec.sequence) {
      // First drawing pass, with features that don't depend on sequence.
      
      // If necessary, indicate there was too much data to load/draw and that the user needs to zoom to see more
      if (drawSpec.tooMany || (drawLimit && drawSpec.layout.length > drawLimit)) { 
        canvas.height = 0;
        canvas.className = canvas.className + ' too-many';
        return;
      }
      
      // Only store areas for the "pack" density.
      // We have to empty this for every render, because areas can change if BAM display options change.
      if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
      // Set the expected height for the canvas (this also erases it).
      canvas.height = covHeight + ((density == 'dense') ? 0 : covMargin + drawSpec.layout.length * lineHeight);
      
      // First draw the coverage graph
      ctx.fillStyle = "rgb(159,159,159)";
      self.type('bam').drawCoverage.call(self, ctx, drawSpec.coverage, covHeight);
                
      // Now, draw alignments below it
      if (density != 'dense') {
        // Border between coverage
        ctx.fillStyle = "rgb(109,109,109)";
        ctx.fillRect(0, covHeight + 1, drawSpec.width, 1); 
        ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
        
        _.each(drawSpec.layout, function(l, i) {
          i += lineOffset; // hackish method for leaving space at the top for the coverage graph
          _.each(l, function(data) {
            self.type('bam').drawAlignment.call(self, ctx, drawSpec.width, data, i, lineHeight, drawSpec.viewAsPairs);
            self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
          });
        });
      }
    } else {
      // Second drawing pass, to draw things that are dependent on sequence:
      // (1) allele splits over coverage
      self.type('bam').drawAlleles.call(self, ctx, drawSpec.alleles, covHeight, 1 / drawSpec.bppp);
      // (2) mismatches over the alignments
      ctx.font = "12px 'Menlo','Bitstream Vera Sans Mono','Consolas','Lucida Console',monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'baseline';
      _.each(drawSpec.mismatches, function(mismatch) {
        self.type('bam').drawMismatch.call(self, ctx, mismatch, lineOffset, lineHeight, 1 / drawSpec.bppp);
      });
    }

  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      var callbackKey = start + '-' + end + '-' + density;
      self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
      
      // Have we been waiting to draw sequence data too? If so, do that now, too.
      if (_.isFunction(self.renderSequenceCallbacks[callbackKey])) {
        self.renderSequenceCallbacks[callbackKey]();
        delete self.renderSequenceCallbacks[callbackKey];
      }
      
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  renderSequence: function(canvas, start, end, density, sequence, callback) {
    var self = this;
    
    // If we weren't able to fetch sequence for some reason, there is no reason to proceed.
    if (!sequence) { return false; }

    function renderSequenceCallback() {
      self.prerender(start, end, density, {width: canvas.width, sequence: sequence}, function(drawSpec) {
        self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
        if (_.isFunction(callback)) { callback(); }
      });
    }
    
    // Check if the canvas was already rendered (by lack of the class 'unrendered').
    // If yes, go ahead and execute renderSequenceCallback(); if not, save it for later.
    if ((' ' + canvas.className + ' ').indexOf(' unrendered ') > -1) {
      self.renderSequenceCallbacks[start + '-' + end + '-' + density] = renderSequenceCallback;
    } else {
      renderSequenceCallback();
    }
  },
  
  loadOpts: function($dialog) {
    var o = this.opts;
    $dialog.find('[name=viewAsPairs]').attr('checked', !!o.viewAsPairs);
    $dialog.find('[name=convertChrScheme]').val(o.convertChrScheme).change();
  },

  saveOpts: function($dialog) {
    var o = this.opts;
    o.viewAsPairs = $dialog.find('[name=viewAsPairs]').is(':checked');
    o.convertChrScheme = $dialog.find('[name=convertChrScheme]').val();
    this.type().initOpts.call(this);
    
    // If o.viewAsPairs was changed, we *need* to blow away the genobrowser's areaIndex 
    // and our locally cached areas, as all the areas will change.
    if (o.viewAsPairs != this.prevOpts.viewAsPairs) {
      this.areas = {};
      delete $dialog.data('genobrowser').genobrowser('areaIndex')[$dialog.data('track').n];
    }
  }
  
};

module.exports = BamFormat;
},{"./utils/PairedIntervalTree.js":13,"./utils/RemoteTrack.js":14,"./utils/utils.js":16}],6:[function(require,module,exports){
// =================================================================
// = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
// =================================================================
//
// bedDetail is a trivial extension of BED that is defined separately,
// although a BED file with >12 columns is assumed to be bedDetail track regardless of type.

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var LineMask = require('./utils/LineMask.js').LineMask;

// Intended to be loaded into CustomTrack.types.bed
var BedFormat = {
  defaults: {
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: null, pack: null}
  },
  
  init: function() {
    this.type().initOpts.call(this);
  },
  
  initOpts: function() {
    var self = this,
      altColors = self.opts.colorByStrand.split(/\s+/),
      validColorByStrand = altColors.length > 1 && _.all(altColors, self.validateColor);
    self.opts.useScore = self.isOn(self.opts.useScore);
    self.opts.itemRgb = self.isOn(self.opts.itemRgb);
    if (!validColorByStrand) { self.opts.colorByStrand = ''; self.opts.altColor = null; }
    else { self.opts.altColor = altColors[1]; }
  },

  parseLine: function(line, lineno) {
    var cols = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'itemRgb',
      'blockCount', 'blockSizes', 'blockStarts', 'id', 'description'],
      feature = {},
      fields = /\t/.test(line) ? line.split("\t") : line.split(/\s+/),
      chrPos, blockSizes;
    
    if (this.opts.detail) {
      cols[fields.length - 2] = 'id';
      cols[fields.length - 1] = 'description';
    }
    _.each(fields, function(v, i) { feature[cols[i]] = v; });
    chrPos = this.browserOpts.chrPos[feature.chrom];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) { 
      this.warn("Invalid chromosome '"+feature.chrom+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.chromStart) + 1;
      feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
      feature.blocks = null;
      // fancier BED features to express coding regions and exons/introns
      if (/^\d+$/.test(feature.thickStart) && /^\d+$/.test(feature.thickEnd)) {
        feature.thickStart = chrPos + parseInt10(feature.thickStart) + 1;
        feature.thickEnd = chrPos + parseInt10(feature.thickEnd) + 1;
        if (/^\d+(,\d*)*$/.test(feature.blockSizes) && /^\d+(,\d*)*$/.test(feature.blockStarts)) {
          feature.blocks = [];
          blockSizes = feature.blockSizes.split(/,/);
          _.each(feature.blockStarts.split(/,/), function(start, i) {
            if (start === '') { return; }
            var block = {start: feature.start + parseInt10(start)};
            block.end = block.start + parseInt10(blockSizes[i]);
            feature.blocks.push(block);
          });
        }
      } else {
        feature.thickStart = feature.thickEnd = null;
      }
    }
    
    return feature;
  },

  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'});
    _.each(lines, function(line, lineno) {
      var feature = self.type().parseLine.call(self, line, lineno);
      if (feature) { data.add(feature); }
    });
    self.data = data;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    return true;
  },
  
  stackedLayout: function(intervals, width, calcPixInterval, lineNum) {
    // A lineNum function can be provided which can set/retrieve the line of already rendered datapoints
    // so as to not break a ranged feature that extends over multiple tiles.
    lineNum = _.isFunction(lineNum) ? lineNum : function() { return; };
    var lines = [],
      maxExistingLine = _.max(_.map(intervals, function(v) { return lineNum(v.data) || 0; })) + 1,
      sortedIntervals = _.sortBy(intervals, function(v) { var ln = lineNum(v.data); return _.isUndefined(ln) ? 1 : -ln; });
    
    while (maxExistingLine-->0) { lines.push(new LineMask(width, 5)); }
    _.each(sortedIntervals, function(v) {
      var d = v.data,
        ln = lineNum(d),
        pInt = calcPixInterval(d),
        thickInt = d.thickStart !== null && calcPixInterval({start: d.thickStart, end: d.thickEnd}),
        blockInts = d.blocks !== null &&  _.map(d.blocks, calcPixInterval),
        i = 0,
        l = lines.length;
      if (!_.isUndefined(ln)) {
        if (lines[ln].conflict(pInt.tx, pInt.tw)) { console.log("Unresolvable LineMask conflict!"); }
        lines[ln].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      } else {
        while (i < l && lines[i].conflict(pInt.tx, pInt.tw)) { ++i; }
        if (i == l) { lines.push(new LineMask(width, 5)); }
        lineNum(d, i);
        lines[i].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      }
    });
    return _.map(lines, function(l) { return _.pluck(l.items, 'data'); });
  },
  
  prerender: function(start, end, density, precalc, callback) {
    var width = precalc.width,
      bppp = (end - start) / width,
      intervals = this.data.search(start, end),
      drawSpec = [],
      calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density=='pack');
    
    function lineNum(d, set) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(set)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = set);
      }
      return d.line && d.line[key]; 
    }
    
    if (density == 'dense') {
      _.each(intervals, function(v) {
        var pInt = calcPixInterval(v.data);
        pInt.v = v.data.score;
        drawSpec.push(pInt);
      });
    } else {
      drawSpec = {layout: this.type('bed').stackedLayout.call(this, intervals, width, calcPixInterval, lineNum)};
      drawSpec.width = width;
    }
    return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
  },
  
  addArea: function(areas, data, i, lineHeight, urlTemplate) {
    var tipTipData = {},
      tipTipDataCallback = this.type().tipTipData;
    if (!areas) { return; }
    if (_.isFunction(tipTipDataCallback)) {
      tipTipData = tipTipDataCallback.call(this, data);
    } else {
      if (!_.isUndefined(data.d.description)) { tipTipData.description = data.d.description; }
      if (!_.isUndefined(data.d.score)) { tipTipData.score = data.d.score; }
      _.extend(tipTipData, {
        position: data.d.chrom + ':' + data.d.chromStart, 
        size: data.d.chromEnd - data.d.chromStart
      });
      // Display the ID column (from bedDetail), unless it contains a tab character, which means it was autogenerated
      if (!_.isUndefined(data.d.id) && !(/\t/).test(data.d.id)) { tipTipData.id = data.d.id; }
    }
    areas.push([
      data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, x2, y1, y2
      data.d.name || data.d.id || '',                                                   // name
      urlTemplate.replace('$$', _.isUndefined(data.d.id) ? data.d.name : data.d.id),    // href
      data.pInt.oPrev,                                                                  // continuation from previous tile?
      null,
      null,
      tipTipData
    ]);
  },
  
  // Scales a score from 0-1000 into an alpha value between 0.2 and 1.0
  calcAlpha: function(value) { return Math.max(value, 166)/1000; },
  
  // Scales a score from 0-1000 into a color scaled between #cccccc and max Color
  calcGradient: function(maxColor, value) {
    var minColor = [230,230,230],
      valueColor = [];
    if (!_.isArray(maxColor)) { maxColor = _.map(maxColor.split(','), parseInt10); }
    _.each(minColor, function(v, i) { valueColor[i] = (v - maxColor[i]) * ((1000 - value) / 1000.0) + maxColor[i]; });
    return _.map(valueColor, parseInt10).join(',');
  },
  
  drawArrows: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, direction) {
    var arrowHeight = Math.min(halfHeight, 3),
      X1, X2;
    startX = Math.max(startX, 0);
    endX = Math.min(endX, canvasWidth);
    if (endX - startX < 5) { return; } // can't draw arrows in that narrow of a space
    if (direction !== '+' && direction !== '-') { return; } // invalid direction
    ctx.beginPath();
    // All the 0.5's here are due to <canvas>'s somewhat silly coordinate system 
    // http://diveintohtml5.info/canvas.html#pixel-madness
    X1 = direction == '+' ? 0.5 : arrowHeight + 0.5;
    X2 = direction == '+' ? arrowHeight + 0.5 : 0.5;
    for (var i = Math.floor(startX) + 2; i < endX - arrowHeight; i += 7) {
      ctx.moveTo(i + X1, lineY + halfHeight - arrowHeight + 0.5);
      ctx.lineTo(i + X2, lineY + halfHeight + 0.5);
      ctx.lineTo(i + X1, lineY + halfHeight + arrowHeight + 0.5);
    }
    ctx.stroke();
  },
  
  drawFeature: function(ctx, width, data, i, lineHeight) {
    var self = this,
      color = self.opts.color,
      y = i * lineHeight,
      halfHeight = Math.round(0.5 * (lineHeight - 1)),
      quarterHeight = Math.ceil(0.25 * (lineHeight - 1)),
      lineGap = lineHeight > 6 ? 2 : 1,
      thickOverlap = null,
      prevBInt = null;
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
    
    if (self.opts.itemRgb && data.d.itemRgb && this.validateColor(data.d.itemRgb)) { color = data.d.itemRgb; }
    
    if (self.opts.useScore) { color = self.type('bed').calcGradient(color, data.d.score); }
    
    if (self.opts.itemRgb || self.opts.altColor || self.opts.useScore) { ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")"; }
    
    if (data.thickInt) {
      // The coding region is drawn as a thicker line within the gene
      if (data.blockInts) {
        // If there are exons and introns, draw the introns with a 1px line
        prevBInt = null;
        ctx.fillRect(data.pInt.x, y + halfHeight, data.pInt.w, 1);
        ctx.strokeStyle = color;
        _.each(data.blockInts, function(bInt) {
          if (bInt.x + bInt.w <= width && bInt.x >= 0) {
            ctx.fillRect(bInt.x, y + halfHeight - quarterHeight + 1, bInt.w, quarterHeight * 2 - 1);
          }
          thickOverlap = utils.pixIntervalOverlap(bInt, data.thickInt);
          if (thickOverlap) {
            ctx.fillRect(thickOverlap.x, y + 1, thickOverlap.w, lineHeight - lineGap);
          }
          // If there are introns, arrows are drawn on the introns, not the exons...
          if (data.d.strand && prevBInt) {
            ctx.strokeStyle = "rgb(" + color + ")";
            self.type('bed').drawArrows(ctx, width, y, halfHeight, prevBInt.x + prevBInt.w, bInt.x, data.d.strand);
          }
          prevBInt = bInt;
        });
        // ...unless there were no introns. Then it is drawn on the coding region.
        if (data.blockInts.length == 1) {
          ctx.strokeStyle = "white";
          self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
        }
      } else {
        // We have a coding region but no introns/exons
        ctx.fillRect(data.pInt.x, y + halfHeight - quarterHeight + 1, data.pInt.w, quarterHeight * 2 - 1);
        ctx.fillRect(data.thickInt.x, y + 1, data.thickInt.w, lineHeight - lineGap);
        ctx.strokeStyle = "white";
        self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
      }
    } else {
      // Nothing fancy.  It's a box.
      ctx.fillRect(data.pInt.x, y + 1, data.pInt.w, lineHeight - lineGap);
      ctx.strokeStyle = "white";
      self.type('bed').drawArrows(ctx, width, y, halfHeight, data.pInt.x, data.pInt.x + data.pInt.w, data.d.strand);
    }
  },
  
  drawSpec: function(canvas, drawSpec, density) {
    var self = this,
      ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = self.opts.url ? self.opts.url : 'javascript:void("'+self.opts.name+':$$")',
      drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
      lineHeight = density == 'pack' ? 15 : 6,
      color = self.opts.color,
      areas = null;
    
    if (!ctx) { throw "Canvas not supported"; }
    // TODO: I disabled regenerating areas here, which assumes that lineNum remains stable across re-renders. Should check on this.
    if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
    
    if (density == 'dense') {
      canvas.height = 15;
      ctx.fillStyle = "rgb("+color+")";
      _.each(drawSpec, function(pInt) {
        if (self.opts.useScore) { ctx.fillStyle = "rgba("+self.type('bed').calcGradient(color, pInt.v)+")"; }
        ctx.fillRect(pInt.x, 1, pInt.w, 13);
      });
    } else {
      if ((drawLimit && drawSpec.layout && drawSpec.layout.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
        return;
      }
      canvas.height = drawSpec.layout.length * lineHeight;
      ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
      _.each(drawSpec.layout, function(l, i) {
        _.each(l, function(data) {
          self.type('bed').drawFeature.call(self, ctx, drawSpec.width, data, i, lineHeight);              
          self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
        });
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      self.type().drawSpec.call(self, canvas, drawSpec, density);
      if (_.isFunction(callback)) { callback(); }
    });
  },

  loadOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = /\d+,\d+,\d+\s+\d+,\d+,\d+/.test(o.colorByStrand),
      colorByStrand = colorByStrandOn ? o.colorByStrand.split(/\s+/)[1] : '0,0,0';
    $dialog.find('[name=colorByStrandOn]').attr('checked', !!colorByStrandOn);
    $dialog.find('[name=colorByStrand]').val(colorByStrand).change();
    $dialog.find('[name=useScore]').attr('checked', this.isOn(o.useScore));    
    $dialog.find('[name=url]').val(o.url);
  },
  
  saveOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = $dialog.find('[name=colorByStrandOn]').is(':checked'),
      colorByStrand = $dialog.find('[name=colorByStrand]').val(),
      validColorByStrand = this.validateColor(colorByStrand);
    o.colorByStrand = colorByStrandOn && validColorByStrand ? o.color + ' ' + colorByStrand : '';
    o.useScore = $dialog.find('[name=useScore]').is(':checked') ? 1 : 0;
    o.url = $dialog.find('[name=url]').val();
    this.type('bed').initOpts.call(this);
  }
};

module.exports = BedFormat;
},{"./utils/IntervalTree.js":11,"./utils/LineMask.js":12,"./utils/utils.js":16}],7:[function(require,module,exports){
// =========================================================================
// = bedGraph format: http://genome.ucsc.edu/goldenPath/help/bedgraph.html =
// =========================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.bedgraph
var BedGraphFormat = {
  defaults: {
    altColor: '',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() { return this.type('wiggle_0').init.call(this); },
  
  _binFunctions: utils.wigBinFunctions,
  
  initOpts: function() { return this.type('wiggle_0').initOpts.call(this); },
  
  applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },
  
  parse: function(lines) {
    var self = this,
      genomeSize = this.browserOpts.genomeSize,
      data = {all: []},
      mode, modeOpts, chrPos, m;
    self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
  
    _.each(lines, function(line, lineno) {
      var cols = ['chrom', 'chromStart', 'chromEnd', 'dataValue'],
        datum = {},
        chrPos, start, end, val;
      _.each(line.split(/\s+/), function(v, i) { datum[cols[i]] = v; });
      chrPos = self.browserOpts.chrPos[datum.chrom];
      if (_.isUndefined(chrPos)) {
        self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
      }
      start = parseInt10(datum.chromStart);
      end = parseInt10(datum.chromEnd);
      val = parseFloat(datum.dataValue);
      data.all.push({start: chrPos + start, end: chrPos + end, val: val});
    });

    return self.type('wiggle_0').finishParse.call(self, data);
  },
  
  initDrawSpec: function() { return this.type('wiggle_0').initDrawSpec.apply(this, arguments); },
  
  drawBars: function() { return this.type('wiggle_0').drawBars.apply(this, arguments); },

  prerender: function(start, end, density, precalc, callback) {
    return this.type('wiggle_0').prerender.call(this, start, end, density, precalc, callback);
  },

  render: function(canvas, start, end, density, callback) {
    this.type('wiggle_0').render.call(this, canvas, start, end, density, callback);
  },
  
  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
  
};

module.exports = BedGraphFormat;
},{"./utils/utils.js":16}],8:[function(require,module,exports){
// =====================================================================
// = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
// =====================================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

// Intended to be loaded into CustomTrack.types.bigbed
var BigBedFormat = {
  defaults: {
    chromosomes: '',
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: 500, pack: 100},
    maxFetchWindow: 0
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigBed track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
  },
  
  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'bigbed.php',
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      range = self.chrRange(start, end);
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl, density: 'pack'},
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          var intervals = _.map(lines, function(l) { 
            var itvl = self.type('bed').parseLine.call(self, l); 
            // Use BioPerl's Bio::DB:BigBed strategy for deduplicating re-fetched intervals:
            // "Because BED files don't actually use IDs, the ID is constructed from the feature's name (if any), chromosome coordinates, strand and block count."
            if (_.isUndefined(itvl.id)) {
              itvl.id = [itvl.name, itvl.chrom, itvl.chromStart, itvl.chromEnd, itvl.strand, itvl.blockCount].join("\t");
            }
            return itvl;
          });
          storeIntervals(intervals);
        }
      });
    });
    
    self.data = {cache: cache, remote: remote};
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    
    // Get general info on the bigBed and setup the binning scheme for the RemoteTrack
    $.ajax(ajaxUrl, {
      data: { url: self.opts.bigDataUrl },
      success: function(data) {
        // Set maxFetchWindow to avoid overfetching data.
        if (!self.opts.maxFetchWindow) {
          var meanItemsPerBp = data.itemCount / self.browserOpts.genomeSize,
            maxItemsToDraw = _.max(_.values(self.opts.drawLimit));
          self.opts.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
          self.opts.optimalFetchWindow = Math.floor(self.opts.maxFetchWindow / 3);
        }
        remote.setupBins(self.browserOpts.genomeSize, self.opts.optimalFetchWindow, self.opts.maxFetchWindow);
      }
    });
    
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = this.chrRange(start, end);
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    function parseDenseData(data) {
      var drawSpec = [], 
        lines;
      lines = data.split(/\s+/g);
      _.each(lines, function(line, x) { 
        if (line != 'n/a' && line.length) { drawSpec.push({x: x, w: 1, v: parseFloat(line) * 1000}); } 
      });
      callback(drawSpec);
    }
    
    // Don't even attempt to fetch the data if density is not 'dense' and we can reasonably
    // estimate that we will fetch too many rows (>500 features), as this will only delay other requests.
    if (density != 'dense' && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      if (density == 'dense') {
        $.ajax(self.ajaxDir() + 'bigbed.php', {
          data: {range: range, url: self.opts.bigDataUrl, width: width, density: density},
          success: parseDenseData
        });
      } else {
        self.data.remote.fetchAsync(start, end, function(intervals) {
          var calcPixInterval, drawSpec = {};
          if (intervals.tooMany) { return callback(intervals); }
          calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density == 'pack');
          drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
          drawSpec.width = width;
          callback(drawSpec);
        });
      }
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
};

module.exports = BigBedFormat;
},{"./utils/IntervalTree.js":11,"./utils/RemoteTrack.js":14,"./utils/utils.js":16}],9:[function(require,module,exports){


// =====================================================================
// = bigWig format: http://genome.ucsc.edu/goldenPath/help/bigWig.html =
// =====================================================================

var BigWigFormat = {
  defaults: {
    altColor: '128,128,128',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigWig track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type('wiggle_0').initOpts.call(this);
  },
  
  _binFunctions: {'minimum':1, 'maximum':1, 'mean':1, 'min':1, 'max':1, 'std':1, 'coverage':1},
  
  applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },

  parse: function(lines) {
    var self = this;
    self.stretchHeight = true;
    self.range = self.isOn(self.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {info: 1, url: this.opts.bigDataUrl},
      async: false,  // This is cool since parsing normally happens in a Web Worker
      success: function(data) {
        var rows = data.split("\n");
        _.each(rows, function(r) {
          var keyval = r.split(': ');
          if (keyval[0]=='min') { self.range[0] = Math.min(parseFloat(keyval[1]), self.range[0]); }
          if (keyval[0]=='max') { self.range[1] = Math.max(parseFloat(keyval[1]), self.range[1]); }
        });
      }
    });
    self.type('wiggle_0').applyOpts.apply(self);
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      chrRange = self.chrRange(start, end);
  
    function success(data) {
      var drawSpec = self.type('wiggle_0').initDrawSpec.call(self, precalc),
        lines = data.split(/\s+/g);
      _.each(lines, function(line) {
        if (line == 'n/a') { drawSpec.bars.push(null); }
        else if (line.length) { drawSpec.bars.push((parseFloat(line) - self.drawRange[0]) / drawSpec.vScale); }
      });
      callback(drawSpec);
    }
  
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {range: chrRange, url: self.opts.bigDataUrl, width: width, winFunc: self.opts.windowingFunction},
      success: success
    });
  },

  render: function(canvas, start, end, density, callback) {
    var self = this,
      height = canvas.height,
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
      self.type('wiggle_0').drawBars.call(self, ctx, drawSpec, height, width);
      _.isFunction(callback) && callback();
    });
  },

  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },

  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
};

module.exports = BigWigFormat;
},{}],10:[function(require,module,exports){
// ======================================================================
// = featureTable format: http://www.insdc.org/files/feature_table.html =
// ======================================================================

var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var utils = require('./utils/utils.js'),
  strip = utils.strip,
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.featuretable
var FeatureTableFormat = {
  defaults: {
    collapseByGene: 'off',
    keyColumnWidth: 21,
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    url: '',
    htmlUrl: '',
    drawLimit: {squish: null, pack: null}
  },
  
  init: function() {
    this.type('bed').initOpts.call(this);
    this.opts.collapseByGene = this.isOn(this.opts.collapseByGene);
    this.featureTypeCounts = {};
  },
  
  // parses one feature key + location/qualifiers row from the feature table
  parseEntry: function(chrom, lines, startLineNo) {
    var feature = {
        chrom: chrom,
        score: '?',
        blocks: null,
        qualifiers: {}
      },
      keyColumnWidth = this.opts.keyColumnWidth,
      qualifier = null,
      fullLocation = [],
      collapseKeyQualifiers = ['locus_tag', 'gene', 'db_xref'],
      qualifiersThatAreNames = ['gene', 'locus_tag', 'db_xref'],
      RNATypes = ['rrna', 'trna'],
      alsoTryForRNATypes = ['product'],
      locationPositions, chrPos, blockSizes;
    
    chrPos = this.browserOpts.chrPos[chrom];
    startLineNo = startLineNo || 0;
    if (_.isUndefined(chrPos)) {
      this.warn("Invalid chromosome at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    }
    
    // fill out feature's keys with info from these lines
    _.each(lines, function(line, lineno) {
      var key = line.substr(0, keyColumnWidth),
        restOfLine = line.substr(keyColumnWidth),
        qualifierMatch = restOfLine.match(/^\/(\w+)(=?)(.*)/);
      if (key.match(/\w/)) {
        feature.type = strip(key);
        qualifier = null;
        fullLocation.push(restOfLine);
      } else {
        if (qualifierMatch) {
          qualifier = qualifierMatch[1];
          if (!feature.qualifiers[qualifier]) { feature.qualifiers[qualifier] = []; }
          feature.qualifiers[qualifier].push([qualifierMatch[2] ? qualifierMatch[3] : true]);
        } else {
          if (qualifier !== null) { 
            _.last(feature.qualifiers[qualifier]).push(restOfLine);
          } else {
            fullLocation.push(restOfLine);
          }
        }
      }
    });
    
    feature.fullLocation = fullLocation = fullLocation.join('');
    locationPositions = _.map(_.filter(fullLocation.split(/\D+/), _.identity), parseInt10);
    feature.chromStart =  _.min(locationPositions);
    feature.chromEnd = _.max(locationPositions) + 1; // Feature table ranges are *inclusive* of the end base
                                                     // chromEnd columns in BED format are *not*.
    feature.start = chrPos + feature.chromStart;
    feature.end = chrPos + feature.chromEnd; 
    feature.strand = /complement/.test(fullLocation) ? "-" : "+";
    
    // Until we merge by gene name, we don't care about these
    feature.thickStart = feature.thickEnd = null;
    feature.blocks = null;
    
    // Parse the qualifiers properly
    _.each(feature.qualifiers, function(v, k) {
      _.each(v, function(entryLines, i) {
        v[i] = strip(entryLines.join(' '));
        if (/^"[\s\S]*"$/.test(v[i])) {
          // Dequote free text
          v[i] = v[i].replace(/^"|"$/g, '').replace(/""/g, '"');
        }
      });
      //if (v.length == 1) { feature.qualifiers[k] = v[0]; }
    });
    
    // Find something that can serve as a name
    feature.name = feature.type;
    if (_.contains(RNATypes, feature.type.toLowerCase())) { 
      Array.prototype.push.apply(qualifiersThatAreNames, alsoTryForRNATypes); 
    }
    _.find(qualifiersThatAreNames, function(k) {
      if (feature.qualifiers[k] && feature.qualifiers[k][0]) { return (feature.name = feature.qualifiers[k][0]); }
    });
    // In the worst case, add a counter to disambiguate features named only by type
    if (feature.name == feature.type) {
      if (!this.featureTypeCounts[feature.type]) { this.featureTypeCounts[feature.type] = 1; }
      feature.name = feature.name + '_' + this.featureTypeCounts[feature.type]++;
    }
    
    // Find a key that is appropriate for collapsing
    if (this.opts.collapseByGene) {
      _.find(collapseKeyQualifiers, function(k) {
        if (feature.qualifiers[k] && feature.qualifiers[k][0]) { 
          return (feature._collapseKey = feature.qualifiers[k][0]);
        }
      });
    }
    
    return feature;
  },
  
  // collapses multiple features that are about the same gene into one drawable feature
  collapseFeatures: function(features) {
    var chrPos = this.browserOpts.chrPos,
      preferredTypeToMergeInto = ['mrna', 'gene', 'cds'],
      preferredTypeForExons = ['exon', 'cds'],
      mergeInto = features[0],
      blocks = [],
      foundType, cds, exons;
    foundType = _.find(preferredTypeToMergeInto, function(type) {
      var found = _.find(features, function(feat) { return feat.type.toLowerCase() == type; });
      if (found) { mergeInto = found; return true; }
    });
    
    // Look for exons (eukaryotic) or a CDS (prokaryotic)
    _.find(preferredTypeForExons, function(type) {
      exons = _.select(features, function(feat) { return feat.type.toLowerCase() == type; });
      if (exons.length) { return true; }
    });
    cds = _.find(features, function(feat) { return feat.type.toLowerCase() == "cds"; });
    
    _.each(exons, function(exonFeature) {
      exonFeature.fullLocation.replace(/(\d+)\.\.[><]?(\d+)/g, function(fullMatch, start, end) {
        blocks.push({
          start: chrPos[exonFeature.chrom] + Math.min(start, end), 
          // Feature table ranges are *inclusive* of the end base.
          end: chrPos[exonFeature.chrom] +  Math.max(start, end) + 1
        });
      });
    });
    
    // Convert exons and CDS into blocks, thickStart and thickEnd (in BED terminology)
    if (blocks.length) { 
      mergeInto.blocks = _.sortBy(blocks, function(b) { return b.start; });
      mergeInto.thickStart = cds ? cds.start : feature.start;
      mergeInto.thickEnd = cds ? cds.end : feature.end;
    }
    
    // finally, merge all the qualifiers
    _.each(features, function(feat) {
      if (feat === mergeInto) { return; }
      _.each(feat.qualifiers, function(values, k) {
        if (!mergeInto.qualifiers[k]) { mergeInto.qualifiers[k] = []; }
        _.each(values, function(v) {
          if (!_.contains(mergeInto.qualifiers[k], v)) { mergeInto.qualifiers[k].push(v); }
        });
      });
    });
    
    return mergeInto;
  },

  parse: function(lines) {
    var self = this,
      o = self.opts,
      middleishPos = this.browserOpts.genomeSize / 2,
      data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      numLines = lines.length,
      chrom = null,
      lastEntryStart = null,
      featuresByCollapseKey = {},
      feature;
    
    function collectLastEntry(lineno) {
      if (lastEntryStart !== null) {
        feature = self.type().parseEntry.call(self, chrom, lines.slice(lastEntryStart, lineno), lastEntryStart);
        if (feature) { 
          if (o.collapseByGene) {
            featuresByCollapseKey[feature._collapseKey] = featuresByCollapseKey[feature._collapseKey] || [];
            featuresByCollapseKey[feature._collapseKey].push(feature);
          } else { data.add(feature); }
        }
      }
    }
    
    // Chunk the lines into entries and parse each of them
    _.each(lines, function(line, lineno) {
      if (line.substr(0, 12) == "ACCESSION   ") {
        collectLastEntry(lineno);
        chrom = line.substr(12);
        lastEntryStart = null;
      } else if (chrom !== null && line.substr(5, 1).match(/\w/)) {
        collectLastEntry(lineno);
        lastEntryStart = lineno;
      }
    });
    // parse the last entry
    if (chrom !== null) { collectLastEntry(lines.length); }
    
    if (o.collapseByGene) {
      _.each(featuresByCollapseKey, function(features, gene) {
        data.add(self.type().collapseFeatures.call(self, features));
      });
    }
    
    self.data = data;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    return true;
  },
  
  // special formatter for content in tooltips for features
  tipTipData: function(data) {
    var qualifiersToAbbreviate = {translation: 1},
      content = {
        type: data.d.type,
        position: data.d.chrom + ':' + data.d.chromStart, 
        size: data.d.chromEnd - data.d.chromStart
      };
    if (data.d.qualifiers.note && data.d.qualifiers.note[0]) {  }
    _.each(data.d.qualifiers, function(v, k) {
      if (k == 'note') { content.description = v.join('; '); return; }
      content[k] = v.join('; ');
      if (qualifiersToAbbreviate[k] && content[k].length > 25) { content[k] = content[k].substr(0, 25) + '...'; }
    });
    return content;
  },
  
  prerender: function(start, end, density, precalc, callback) {
    return this.type('bed').prerender.call(this, start, end, density, precalc, callback);
  },
  
  drawSpec: function() { return this.type('bed').drawSpec.apply(this, arguments); },
  
  render: function(canvas, start, end, density, callback) {
    this.type('bed').render.call(this, canvas, start, end, density, callback);
  },
  
  loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
};

module.exports = FeatureTableFormat;
},{"./utils/IntervalTree.js":11,"./utils/utils.js":16}],11:[function(require,module,exports){
(function(exports){
  
var SortedList = require('./SortedList.js').SortedList;  

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * By Shin Suzuki, MIT license
 * https://github.com/shinout/interval-tree
 * IntervalTree
 *
 * @param (object) data:
 * @param (number) center:
 * @param (object) options:
 *   center:
 *
 **/
function IntervalTree(center, options) {
  options || (options = {});

  this.startKey     = options.startKey || 0; // start key
  this.endKey       = options.endKey   || 1; // end key
  this.intervalHash = {};                    // id => interval object
  this.pointTree = new SortedList({          // b-tree of start, end points 
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a[0]- b[0];
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this._autoIncrement = 0;

  // index of the root node
  if (!center || typeof center != 'number') {
    throw new Error('you must specify center index as the 2nd argument.');
  }

  this.root = new Node(center, this);
}


/**
 * public methods
 **/


/**
 * add new range
 **/
IntervalTree.prototype.add = function(data, id) {
  if (this.contains(id)) {
    throw new DuplicateError('id ' + id + ' is already registered.');
  }

  if (id == undefined) {
    while (this.intervalHash[this._autoIncrement]) {
      this._autoIncrement++;
    }
    id = this._autoIncrement;
  }

  var itvl = new Interval(data, id, this.startKey, this.endKey);
  this.pointTree.insert([itvl.start, id]);
  this.pointTree.insert([itvl.end,   id]);
  this.intervalHash[id] = itvl;
  this._autoIncrement++;
  
  _insert.call(this, this.root, itvl);
};


/**
 * check if range is already present, based on its id
 **/
IntervalTree.prototype.contains = function(id) {
  return !!this.get(id);
}


/**
 * retrieve an interval by its id; returns null if it does not exist
 **/
IntervalTree.prototype.get = function(id) {
  return this.intervalHash[id] || null;
}


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
IntervalTree.prototype.addIfNew = function(data, id) {
  try {
    this.add(data, id);
  } catch (e) {
    if (e instanceof DuplicateError) { return; }
    throw e;
  }
}


/**
 * search
 *
 * @param (integer) val:
 * @return (array)
 **/
IntervalTree.prototype.search = function(val1, val2) {
  var ret = [];
  if (typeof val1 != 'number') {
    throw new Error(val1 + ': invalid input');
  }

  if (val2 == undefined) {
    _pointSearch.call(this, this.root, val1, ret);
  }
  else if (typeof val2 == 'number') {
    _rangeSearch.call(this, val1, val2, ret);
  }
  else {
    throw new Error(val1 + ',' + val2 + ': invalid input');
  }
  return ret;
};


/**
 * remove: 
 **/
IntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};



/**
 * private methods
 **/

// the shift-right-and-fill operator, extended beyond the range of an int32
function _bitShiftRight(num) {
  if (num > 2147483647 || num < -2147483648) { return Math.floor(num / 2); }
  return num >>> 1;
}

/**
 * _insert
 **/
function _insert(node, itvl) {
  while (true) {
    if (itvl.end < node.idx) {
      if (!node.left) {
        node.left = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.left;
    } else if (node.idx < itvl.start) {
      if (!node.right) {
        node.right = new Node(_bitShiftRight(itvl.start + itvl.end), this);
      }
      node = node.right;
    } else {
      return node.insert(itvl);
    }
  }
}


/**
 * _pointSearch
 * @param (Node) node
 * @param (integer) idx 
 * @param (Array) arr
 **/
function _pointSearch(node, idx, arr) {
  while (true) {
    if (!node) break;
    if (idx < node.idx) {
      node.starts.arr.every(function(itvl) {
        var bool = (itvl.start <= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.left;
    } else if (idx > node.idx) {
      node.ends.arr.every(function(itvl) {
        var bool = (itvl.end >= idx);
        if (bool) arr.push(itvl.result());
        return bool;
      });
      node = node.right;
    } else {
      node.starts.arr.map(function(itvl) { arr.push(itvl.result()) });
      break;
    }
  }
}



/**
 * _rangeSearch
 * @param (integer) start
 * @param (integer) end
 * @param (Array) arr
 **/
function _rangeSearch(start, end, arr) {
  if (end - start <= 0) {
    throw new Error('end must be greater than start. start: ' + start + ', end: ' + end);
  }
  var resultHash = {};

  var wholeWraps = [];
  _pointSearch.call(this, this.root, _bitShiftRight(start + end), wholeWraps, true);

  wholeWraps.forEach(function(result) {
    resultHash[result.id] = true;
  });


  var idx1 = this.pointTree.bsearch([start, null]);
  while (idx1 >= 0 && this.pointTree.arr[idx1][0] == start) {
    idx1--;
  }

  var idx2 = this.pointTree.bsearch([end,   null]);
  var len = this.pointTree.arr.length - 1;
  while (idx2 == -1 || (idx2 <= len && this.pointTree.arr[idx2][0] <= end)) {
    idx2++;
  }

  this.pointTree.arr.slice(idx1 + 1, idx2).forEach(function(point) {
    var id = point[1];
    resultHash[id] = true;
  }, this);

  Object.keys(resultHash).forEach(function(id) {
    var itvl = this.intervalHash[id];
    arr.push(itvl.result(start, end));
  }, this);

}



/**
 * subclasses
 * 
 **/


/**
 * Node : prototype of each node in a interval tree
 * 
 **/
function Node(idx) {
  this.idx = idx;
  this.starts = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.start - b.start;
      return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });

  this.ends = new SortedList({
    compare: function(a, b) {
      if (a == null) return -1;
      if (b == null) return  1;
      var c = a.end - b.end;
      return (c < 0) ? 1 : (c == 0)  ? 0 : -1;
    }
  });
};

/**
 * insert an Interval object to this node
 **/
Node.prototype.insert = function(interval) {
  this.starts.insert(interval);
  this.ends.insert(interval);
};



/**
 * Interval : prototype of interval info
 **/
function Interval(data, id, s, e) {
  this.id     = id;
  this.start  = data[s];
  this.end    = data[e];
  this.data   = data;

  if (typeof this.start != 'number' || typeof this.end != 'number') {
    throw new Error('start, end must be number. start: ' + this.start + ', end: ' + this.end);
  }

  if ( this.start >= this.end) {
    throw new Error('start must be smaller than end. start: ' + this.start + ', end: ' + this.end);
  }
}

/**
 * get result object
 **/
Interval.prototype.result = function(start, end) {
  var ret = {
    id   : this.id,
    data : this.data
  };
  if (typeof start == 'number' && typeof end == 'number') {
    /**
     * calc overlapping rate
     **/
    var left  = Math.max(this.start, start);
    var right = Math.min(this.end,   end);
    var lapLn = right - left;
    ret.rate1 = lapLn / (end - start);
    ret.rate2 = lapLn / (this.end - this.start);
  }
  return ret;
};

function DuplicateError(message) {
    this.name = 'DuplicateError';
    this.message = message;
    this.stack = (new Error()).stack;
}
DuplicateError.prototype = new Error;

exports.IntervalTree = IntervalTree;

})(module && module.exports || this);
},{"./SortedList.js":15}],12:[function(require,module,exports){
(function (global){
(function(exports){

// ==============================================================================================
// = LineMask: A (very cheap) alternative to IntervalTree: a small, 1D pixel buffer of objects. =
// ==============================================================================================
  
var utils = require('./utils.js'),
  floorHack = utils.floorHack;

function LineMask(width, fudge) {
  this.fudge = fudge = (fudge || 1);
  this.items = [];
  this.length = Math.ceil(width / fudge);
  this.mask = global.Uint8Array ? new Uint8Array(this.length) : new Array(this.length);
}

LineMask.prototype.add = function(x, w, data) {
  var upTo = Math.ceil((x + w) / this.fudge);
  this.items.push({x: x, w: w, data: data});
  for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { this.mask[i] = 1; }
};

LineMask.prototype.conflict = function(x, w) {
  var upTo = Math.ceil((x + w) / this.fudge);
  for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { if (this.mask[i]) return true; }
  return false;
};

exports.LineMask = LineMask;

})(module && module.exports || this);
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils.js":16}],13:[function(require,module,exports){
(function(exports){
  
var IntervalTree = require('./IntervalTree.js').IntervalTree;  
var _ = require('../../../underscore.min.js');
var parseInt10 = require('./utils.js').parseInt10;

var PAIRING_CANNOT_MATE = 0,
  PAIRING_MATE_ONLY = 1,
  PAIRING_DRAW_AS_MATES = 2;

// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * Wraps two of Shin Suzuki's IntervalTrees to store intervals that *may*
 * be paired.
 *
 * @see IntervalTree()
 **/
function PairedIntervalTree(center, unpairedOptions, pairedOptions) {
  var defaultOptions = {startKey: 0, endKey: 1};
  
  this.unpaired = new IntervalTree(center, unpairedOptions);
  this.unpairedOptions = _.extend({}, defaultOptions, unpairedOptions);
  
  this.paired = new IntervalTree(center, pairedOptions);
  this.pairedOptions = _.extend({pairingKey: 'qname', pairedLengthKey: 'tlen'}, defaultOptions, pairedOptions);
  if (this.pairedOptions.startKey === this.unpairedOptions.startKey) {
    throw new Error('startKey for unpairedOptions and pairedOptions must be different in a PairedIntervalTree');
  }
  if (this.pairedOptions.endKey === this.unpairedOptions.endKey) {
    throw new Error('endKey for unpairedOptions and pairedOptions must be different in a PairedIntervalTree');
  }
  
  this.pairingDisabled = false;
  this.pairingMinDistance = this.pairingMaxDistance = null;
}


/**
 * public methods
 **/


/**
 * Disables pairing. Effectively makes this equivalent, externally, to an IntervalTree.
 * This is useful if we discover that this data source doesn't contain paired reads.
 **/
PairedIntervalTree.prototype.disablePairing = function() {
  this.pairingDisabled = true;
  this.paired = this.unpaired;
};


/**
 * Set an interval within which paired mates will be saved as a continuous feature in .paired
 *
 * @param (number) min: Minimum distance, in bp
 * @param (number) max: Maximum distance, in bp
 **/
PairedIntervalTree.prototype.setPairingInterval = function(min, max) {
  if (typeof min != 'number') { throw new Error('you must specify min as the 1st argument.'); }
  if (typeof max != 'number') { throw new Error('you must specify max as the 2nd argument.'); }
  if (this.pairingMinDistance !== null) { throw new Error('Can only be called once. You can\'t change the pairing interval.'); }
  
  this.pairingMinDistance = min;
  this.pairingMaxDistance = max;
};


/**
 * add new range only if it is new, based on whether the id was already registered
 **/
PairedIntervalTree.prototype.addIfNew = function(data, id) {
  var mated = false,
    increment = 0,
    unpairedStart = this.unpairedOptions.startKey,
    unpairedEnd = this.unpairedOptions.endKey,
    pairedStart = this.pairedOptions.startKey,
    pairedEnd = this.pairedOptions.endKey,
    pairedLength = data[this.pairedOptions.pairedLengthKey],
    pairingState = PAIRING_CANNOT_MATE,
    newId, potentialMate;
  
  // .unpaired contains every alignment as a separate interval.
  // If it already contains this id, we've seen this read before and should disregard.
  if (this.unpaired.contains(id)) { return; }
  this.unpaired.add(data, id);
  
  // .paired contains alignments that may be mated into one interval if they are within the pairing range
  if (!this.pairingDisabled && _eligibleForPairing(this, data)) {
    if (this.pairingMinDistance === null) { 
      throw new Error('Can only add paired data after the pairing interval has been set!');
    }
    
    // instead of storing them with the given id, the pairingKey (for BAM, QNAME) is used as the id.
    // As intervals are added, we check if a read with the same pairingKey already exists in the .paired IntervalTree.
    newId = data[this.pairedOptions.pairingKey];
    potentialMate = this.paired.get(newId);
    
    if (potentialMate !== null) {
      potentialMate = potentialMate.data;
      pairingState = _pairingState(this, data, potentialMate);
      // Are the reads suitable for mating?
      if (pairingState === PAIRING_DRAW_AS_MATES || pairingState === PAIRING_MATE_ONLY) {
        // If yes: mate the reads
        potentialMate.mate = data;
        // In the other direction, has to be a selective shallow copy to avoid circular references.
        data.mate = _.extend({}, _.omit(potentialMate, function(v, k) { return _.isObject(v)}));
        data.mate.flags = _.clone(potentialMate.flags);
      }
    }
    
    // Are the mated reads within drawable range? If so, simply flag that they should be drawn together, and they will.
    // Alternatively, if the potentialMate expected a mate, we should mate them anyway.
    // The only reason we wouldn't get .drawAsMates is if the mate was on the threshold of the insert size range.
    if (pairingState === PAIRING_DRAW_AS_MATES || (pairingState === PAIRING_MATE_ONLY && potentialMate.mateExpected)) {
      data.drawAsMates = potentialMate.drawAsMates = true;
    } else {
      // Otherwise, need to insert this read into this.paired as a separate read.
      // Ensure the id is unique first.
      while (this.paired.contains(newId)) {
        newId = newId.replace(/\t.*/, '') + "\t" + (++increment);
      }
      
      data.mateExpected = _pairingState(this, data) === PAIRING_DRAW_AS_MATES;
      // FIXME: The following is perhaps a bit too specific to how TLEN for BAM files works; could generalize later
      // When inserting into .paired, the interval's .start and .end shouldn't be based on POS and the CIGAR string;
      // we must adjust them for TLEN, if it is nonzero, depending on its sign, and set new bounds for the interval.
      if (data.mateExpected && pairedLength > 0) {
        data[pairedStart] = data[unpairedStart];
        data[pairedEnd] = data[unpairedStart] + pairedLength;
      } else if (data.mateExpected && pairedLength < 0) {
        data[pairedEnd] = data[unpairedEnd];
        data[pairedStart] = data[unpairedEnd] + pairedLength;
      } else { // !data.mateExpected || pairedLength == 0
        data[pairedStart] = data[unpairedStart];
        data[pairedEnd] = data[unpairedEnd];
      }
      
      this.paired.add(data, newId);
    }
  }

};


/**
 * alias .add() to .addIfNew()
 **/
PairedIntervalTree.prototype.add = PairedIntervalTree.prototype.addIfNew;


/**
 * search
 *
 * @param (number) val:
 * @return (array)
 **/
PairedIntervalTree.prototype.search = function(val1, val2, paired) {
  if (paired && !this.pairingDisabled) {
    return this.paired.search(val1, val2);
  } else {
    return this.unpaired.search(val1, val2);
  }
};


/**
 * remove: unimplemented for now
 **/
PairedIntervalTree.prototype.remove = function(interval_id) {
  throw ".remove() is currently unimplemented";
};


/**
 * private methods
 **/

// Check if an itvl is eligible for pairing. 
// For now, this means that if any FLAG's 0x100 or higher are set, we totally discard this alignment and interval.
// FIXME: The following is entangled with bam.js internals; perhaps allow this to be generalized, overridden,
//        or set alongside .setPairingInterval()
//
// @return (boolean)
function _eligibleForPairing(pairedItvlTree, itvl) {
  var flags = itvl.flags;
  if (flags.isSecondaryAlignment || flags.isReadFailingVendorQC || flags.isDuplicateRead || flags.isSupplementaryAlignment) {
    return false;
  }
  return true;
}

// Check if an itvl and its potentialMate are within the right distance, and orientation, to be mated.
// If potentialMate isn't given, takes a best guess if a mate is expected, given the information in itvl alone.
// FIXME: The following is entangled with bam.js internals; perhaps allow this to be generalized, overridden,
//        or set alongside .setPairingInterval()
// 
// @return (number)
function _pairingState(pairedItvlTree, itvl, potentialMate) {
  var tlen = itvl[pairedItvlTree.pairedOptions.pairedLengthKey],
    itvlLength = itvl.end - itvl.start,
    itvlIsLater, inferredInsertSize;

  if (_.isUndefined(potentialMate)) {
    // Create the most receptive hypothetical mate, given the information in itvl.
    potentialMate = {
      _mocked: true,
      flags: {
        isReadPaired: true,
        isReadProperlyAligned: true,
        isReadFirstOfPair: itvl.flags.isReadLastOfPair,
        isReadLastOfPair: itvl.flags.isReadFirstOfPair
      }
    };
  }

  // First check a whole host of FLAG's. To make a long story short, we expect paired ends to be either
  // 99-147 or 163-83, depending on whether the rightmost or leftmost segment is primary.
  if (!itvl.flags.isReadPaired || !potentialMate.flags.isReadPaired) { return PAIRING_CANNOT_MATE; }
  if (!itvl.flags.isReadProperlyAligned || !potentialMate.flags.isReadProperlyAligned) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadUnmapped || potentialMate.flags.isReadUnmapped) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isMateUnmapped || potentialMate.flags.isMateUnmapped) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadFirstOfPair && !potentialMate.flags.isReadLastOfPair) { return PAIRING_CANNOT_MATE; }
  if (itvl.flags.isReadLastOfPair && !potentialMate.flags.isReadFirstOfPair) { return PAIRING_CANNOT_MATE; }
    
  if (potentialMate._mocked) {
    _.extend(potentialMate, {
      rname: itvl.rnext == '=' ? itvl.rname : itvl.rnext,
      pos: itvl.pnext,
      start: itvl.rnext == '=' ? parseInt10(itvl.pnext) + (itvl.start - parseInt10(itvl.pos)) : 0,
      end: tlen > 0 ? itvl.start + tlen : (tlen < 0 ? itvl.end + tlen + itvlLength : 0),
      rnext: itvl.rnext == '=' ? '=' : itvl.rname,
      pnext: itvl.pos
    });
  }
  
  // Check that the alignments are on the same reference sequence
  if (itvl.rnext != '=' || potentialMate.rnext != '=') { 
    // and if not, do the coordinates match at all?
    if (itvl.rnext != potentialMate.rname || itvl.rnext != potentialMate.rname) { return PAIRING_CANNOT_MATE; }
    if (itvl.pnext != potentialMate.pos || itvl.pos != potentialMate.pnext) { return PAIRING_CANNOT_MATE; }
    return PAIRING_MATE_ONLY;
  }
  
  if (potentialMate._mocked) {
    _.extend(potentialMate.flags, {
      readStrandReverse: itvl.flags.mateStrandReverse,
      mateStrandReverse: itvl.flags.readStrandReverse
    });
  } 
  
  itvlIsLater = itvl.start > potentialMate.start;
  inferredInsertSize = Math.abs(tlen);
  
  // Check that the alignments are --> <--
  if (itvlIsLater) {
    if (!itvl.flags.readStrandReverse || itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (potentialMate.flags.readStrandReverse || !potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  } else {
    if (itvl.flags.readStrandReverse || !itvl.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
    if (!potentialMate.flags.readStrandReverse || potentialMate.flags.mateStrandReverse) { return PAIRING_MATE_ONLY; }
  }
  
  // Check that the inferredInsertSize is within the acceptable range.
  itvl.insertSize = potentialMate.insertSize = inferredInsertSize;
  if (inferredInsertSize > this.pairingMaxDistance || inferredInsertSize < this.pairingMinDistance) { return PAIRING_MATE_ONLY; }
  
  return PAIRING_DRAW_AS_MATES;
}

exports.PairedIntervalTree = PairedIntervalTree;

})(module && module.exports || this);
},{"../../../underscore.min.js":19,"./IntervalTree.js":11,"./utils.js":16}],14:[function(require,module,exports){
(function(exports){

var _ = require('../../../underscore.min.js');

/**
  * RemoteTrack
  *
  * A helper class built for caching data fetched from a remote track (data aligned to a genome).
  * The genome is divided into bins of optimalFetchWindow nts, for each of which data will only be fetched once.
  * To setup the bins, call .setupBins(...) after initializing the class.
  *
  * There is one main public method for this class: .fetchAsync(start, end, callback)
  * (For consistency with CustomTracks.js, all `start` and `end` positions are 1-based, oriented to
  * the start of the genome, and intervals are right-open.)
  *
  * This method will request and cache data for the given interval that is not already cached, and call 
  * callback(intervals) as soon as data for all intervals is available. (If the data is already available, 
  * it will call the callback immediately.)
  **/

var BIN_LOADING = 1,
  BIN_LOADED = 2;

/**
  * RemoteTrack constructor.
  *
  * Note you still must call `.setupBins(...)` before the RemoteTrack is ready to fetch data.
  *
  * @param (IntervalTree) cache: An cache store that will receive intervals fetched for each bin.
  *                              Should be an IntervalTree or equivalent, that implements `.addIfNew(...)` and 
  *                              `.search(start, end)` methods. If it is an *extension* of an IntervalTree, note 
  *                              the `extraArgs` param permitted for `.fetchAsync()`, which are passed along as 
  *                              extra arguments to `.search()`.
  * @param (function) fetcher: A function that will be called to fetch data for each bin.
  *                            This function should take three arguments, `start`, `end`, and `storeIntervals`.
  *                            `start` and `end` are 1-based genomic coordinates forming a right-open interval.
  *                            `storeIntervals` is a callback that `fetcher` MUST call on the array of intervals
  *                            once they have been fetched from the remote data source and parsed.
  * @see _fetchBin for how `fetcher` is utilized.
  **/
function RemoteTrack(cache, fetcher) {
  if (typeof cache != 'object' || (!cache.addIfNew && (!_.keys(cache).length || cache[_.keys(cache)[0]].addIfNew))) { 
    throw new Error('you must specify an IntervalTree cache, or an object/array containing IntervalTrees, as the 1st argument.'); 
  }
  if (typeof fetcher != 'function') { throw new Error('you must specify a fetcher function as the 2nd argument.'); }
  
  this.cache = cache;
  this.fetcher = fetcher;
  
  this.callbacks = [];
  this.afterBinSetup = [];
  this.binsLoaded = null;
}

/**
 * public methods
 **/

// Setup the binning scheme for this RemoteTrack. This can occur anytime after initialization, and in fact,
// can occur after calls to `.fetchAsync()` have been made, in which case they will be waiting on this method
// to be called to proceed. But it MUST be called before data will be received by callbacks passed to 
// `.fetchAsync()`.
RemoteTrack.prototype.setupBins = function(genomeSize, optimalFetchWindow, maxFetchWindow) {
  var self = this;
  if (self.binsLoaded) { throw new Error('you cannot run setupBins more than once.'); }
  if (typeof genomeSize != 'number') { throw new Error('you must specify the genomeSize as the 1st argument.'); }
  if (typeof optimalFetchWindow != 'number') { throw new Error('you must specify optimalFetchWindow as the 2nd argument.'); }
  if (typeof maxFetchWindow != 'number') { throw new Error('you must specify maxFetchWindow as the 3rd argument.'); }
  
  self.genomeSize = genomeSize;
  self.optimalFetchWindow = optimalFetchWindow;
  self.maxFetchWindow = maxFetchWindow;
  
  self.numBins = Math.ceil(genomeSize / optimalFetchWindow);
  self.binsLoaded = {};
  
  // Fire off ranges saved to afterBinSetup
  _.each(this.afterBinSetup, function(range) {
    self.fetchAsync(range.start, range.end, range.extraArgs);
  });
  _clearCallbacksForTooBigIntervals(self);
}


// Fetches data (if necessary) for unfetched bins overlapping with the interval from `start` to `end`.
// Then, run `callback` on all stored subintervals that overlap with the interval from `start` to `end`.
// `extraArgs` is an *optional* parameter that can contain arguments passed to the `.search()` function of the cache.
//
// @param (number) start:       1-based genomic coordinate to start fetching from
// @param (number) end:         1-based genomic coordinate (right-open) to start fetching *until*
// @param (Array) [extraArgs]:  optional, passed along to the `.search()` calls on the .cache as arguments 3 and up; 
//                              perhaps useful if the .cache has overridden this method
// @param (function) callback:  A function that will be called once data is ready for this interval. Will be passed
//                              all interval features that have been fetched for this interval, or {tooMany: true}
//                              if more data was requested than could be reasonably fetched.
RemoteTrack.prototype.fetchAsync = function(start, end, extraArgs, callback) {
  var self = this;
  if (_.isFunction(extraArgs) && _.isUndefined(callback)) { callback = extraArgs; extraArgs = undefined; }
  if (!self.binsLoaded) {
    // If bins *aren't* setup yet:
    // Save the callback onto the queue
    if (_.isFunction(callback)) { 
      self.callbacks.push({start: start, end: end, extraArgs: extraArgs, callback: callback}); 
    }
    
    // Save this fetch for when the bins are loaded
    self.afterBinSetup.push({start: start, end: end, extraArgs: extraArgs});
  } else {
    // If bins *are* setup, first calculate which bins correspond to this interval, 
    // and what state those bins are in
    var bins = _binOverlap(self, start, end),
      loadedBins = _.filter(bins, function(i) { return self.binsLoaded[i] === BIN_LOADED; }),
      binsToFetch = _.filter(bins, function(i) { return !self.binsLoaded[i]; });
    
    if (loadedBins.length == bins.length) {
      // If we've already loaded data for all the bins in question, short-circuit and run the callback now
      extraArgs = _.isUndefined(extraArgs) ? [] : extraArgs;
      return _.isFunction(callback) && callback(self.cache.search.apply(self.cache, [start, end].concat(extraArgs)));
    } else if (end - start > self.maxFetchWindow) {
      // else, if this interval is too big (> maxFetchWindow), fire the callback right away with {tooMany: true}
      return _.isFunction(callback) && callback({tooMany: true});
    }
    
    // else, push the callback onto the queue
    if (_.isFunction(callback)) { 
      self.callbacks.push({start: start, end: end, extraArgs: extraArgs, callback: callback}); 
    }
    
    // then run fetches for the unfetched bins, which should call _fireCallbacks after they complete,
    // which will automatically fire callbacks from the above queue as they acquire all needed data.
    _.each(binsToFetch, function(binIndex) {
      _fetchBin(self, binIndex, function() { _fireCallbacks(self); });
    });
  }
}


/**
 * private methods
 **/

// Calculates which bins overlap with an interval given by `start` and `end`.
// `start` and `end` are 1-based coordinates forming a right-open interval.
function _binOverlap(remoteTrk, start, end) {
  if (!remoteTrk.binsLoaded) { throw new Error('you cannot calculate bin overlap before setupBins is called.'); }
  // Internally, for assigning coordinates to bins, we use 0-based coordinates for easier calculations.
  var startBin = Math.floor((start - 1) / remoteTrk.optimalFetchWindow),
    endBin = Math.floor((end - 1) / remoteTrk.optimalFetchWindow);
  return _.range(startBin, endBin + 1);
}

// Runs the fetcher function on a given bin.
// The fetcher function is obligated to run a callback function `storeIntervals`, 
//    passed as its third argument, on a set of intervals that will be inserted into the 
//    remoteTrk.cache IntervalTree.
// The `storeIntervals` function may accept a second argument called `cacheIndex`, in case
//    remoteTrk.cache is actually a container for multiple IntervalTrees, indicating which 
//    one to store it in.
// We then call the `callback` given here after that is complete.
function _fetchBin(remoteTrk, binIndex, callback) {
  var start = binIndex * remoteTrk.optimalFetchWindow + 1,
    end = (binIndex + 1) * remoteTrk.optimalFetchWindow + 1;
  remoteTrk.binsLoaded[binIndex] = BIN_LOADING;
  remoteTrk.fetcher(start, end, function storeIntervals(intervals) {
    _.each(intervals, function(interval) {
      if (!interval) { return; }
      remoteTrk.cache.addIfNew(interval, interval.id);
    });
    remoteTrk.binsLoaded[binIndex] = BIN_LOADED;
    _.isFunction(callback) && callback();
  });
}

// Runs through all saved callbacks and fires any callbacks where all the required data is ready
// Callbacks that are fired are removed from the queue.
function _fireCallbacks(remoteTrk) {
  remoteTrk.callbacks = _.filter(remoteTrk.callbacks, function(afterLoad) {
    var callback = afterLoad.callback,
      extraArgs = _.isUndefined(afterLoad.extraArgs) ? [] : afterLoad.extraArgs,
      bins, stillLoadingBins;
        
    if (afterLoad.end - afterLoad.start > remoteTrk.maxFetchWindow) {
      callback({tooMany: true});
      return false;
    }
    
    bins = _binOverlap(remoteTrk, afterLoad.start, afterLoad.end);
    stillLoadingBins = _.filter(bins, function(i) { return remoteTrk.binsLoaded[i] !== BIN_LOADED; }).length > 0;
    if (!stillLoadingBins) {
      callback(remoteTrk.cache.search.apply(remoteTrk.cache, [afterLoad.start, afterLoad.end].concat(extraArgs)));
      return false;
    }
    return true;
  });
}

// Runs through all saved callbacks and fires any callbacks for which we won't load data since the amount
// requested is too large. Callbacks that are fired are removed from the queue.
function _clearCallbacksForTooBigIntervals(remoteTrk) {
  remoteTrk.callbacks = _.filter(remoteTrk.callbacks, function(afterLoad) {
    var callback = afterLoad.callback;
    if (afterLoad.end - afterLoad.start > remoteTrk.maxFetchWindow) {
      callback({tooMany: true});
      return false;
    }
    return true;
  });
}


exports.RemoteTrack = RemoteTrack;

})(module && module.exports || this);
},{"../../../underscore.min.js":19}],15:[function(require,module,exports){
(function(exports){
// TODO: backport this code for JavaScript 1.5? using underscore.js
/**
 * By Shin Suzuki, MIT license
 * https://github.com/shinout/SortedList
 *
 * SortedList : constructor
 * 
 * @param arr : Array or null : an array to set
 *
 * @param options : object  or null
 *         (function) filter  : filter function called before inserting data.
 *                              This receives a value and returns true if the value is valid.
 *
 *         (function) compare : function to compare two values, 
 *                              which is used for sorting order.
 *                              the same signature as Array.prototype.sort(fn).
 *                              
 *         (string)   compare : if you'd like to set a common comparison function,
 *                              you can specify it by string:
 *                              "number" : compares number
 *                              "string" : compares string
 */
function SortedList() {
  var arr     = null,
      options = {},
      args    = arguments;

  ["0","1"].forEach(function(n) {
    var val = args[n];
    if (Array.isArray(val)) {
      arr = val;
    }
    else if (val && typeof val == "object") {
      options = val;
    }
  });
  this.arr = [];

  ["filter", "compare"].forEach(function(k) {
    if (typeof options[k] == "function") {
      this[k] = options[k];
    }
    else if (options[k] && SortedList[k][options[k]]) {
      this[k] = SortedList[k][options[k]];
    }
  }, this);
  if (arr) this.massInsert(arr);
};

// Binary search for the index of the item equal to `val`, or if no such item exists, the next lower item
// This can be -1 if `val` is lower than the lowest item in the SortedList
SortedList.prototype.bsearch = function(val) {
  var mpos,
      spos = 0,
      epos = this.arr.length;
  while (epos - spos > 1) {
    mpos = Math.floor((spos + epos)/2);
    mval = this.arr[mpos];
    switch (this.compare(val, mval)) {
    case 1  :
    default :
      spos = mpos;
      break;
    case -1 :
      epos = mpos;
      break;
    case 0  :
      return mpos;
    }
  }
  return (this.arr[0] == null || spos == 0 && this.arr[0] != null && this.compare(this.arr[0], val) == 1) ? -1 : spos;
};

SortedList.prototype.get = function(pos) {
  return this.arr[pos];
};

SortedList.prototype.toArray = function(pos) {
  return this.arr.slice();
};

SortedList.prototype.slice = function() {
  return this.arr.slice.apply(this.arr, arguments);
}

SortedList.prototype.size = function() {
  return this.arr.length;
};

SortedList.prototype.head = function() {
  return this.arr[0];
};

SortedList.prototype.tail = function() {
  return (this.arr.length == 0) ? null : this.arr[this.arr.length -1];
};

SortedList.prototype.massInsert = function(items) {
  // This loop avoids call stack overflow because of too many arguments
  for (var i = 0; i < items.length; i += 4096) {
    Array.prototype.push.apply(this.arr, Array.prototype.slice.call(items, i, i + 4096));
  }
  this.arr.sort(this.compare);
}

SortedList.prototype.insert = function() {
  if (arguments.length > 100) {
    // .bsearch + .splice is too expensive to repeat for so many elements.
    // Let's just append them all to this.arr and resort.
    this.massInsert(arguments);
  } else {
    Array.prototype.forEach.call(arguments, function(val) {
      var pos = this.bsearch(val);
      if (this.filter(val, pos)) {
        this.arr.splice(pos+1, 0, val);
      }
    }, this);
  }
};

SortedList.prototype.filter = function(val, pos) {
  return true;
};

SortedList.prototype.add = SortedList.prototype.insert;

SortedList.prototype["delete"] = function(pos) {
  this.arr.splice(pos, 1);
};

SortedList.prototype.remove = SortedList.prototype["delete"];

SortedList.prototype.massRemove = function(startPos, count) {
  this.arr.splice(startPos, count);
};

/**
 * default compare functions 
 **/
SortedList.compare = {
  "number": function(a, b) {
    var c = a - b;
    return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
  },

  "string": function(a, b) {
    return (a > b) ? 1 : (a == b)  ? 0 : -1;
  }
};

SortedList.prototype.compare = SortedList.compare["number"];

exports.SortedList = SortedList;

})(module && module.exports || this);
},{}],16:[function(require,module,exports){
var _ = require('../../../underscore.min.js');

// Parse a track declaration line, which is in the format of:
// track name="blah" optname1="value1" optname2="value2" ...
// into a hash of options
module.exports.parseDeclarationLine = function(line, start) {
  var opts = {}, optname = '', value = '', state = 'optname';
  function pushValue(quoting) {
    state = 'optname';
    opts[optname.replace(/^\s+|\s+$/g, '')] = value;
    optname = value = '';
  }
  for (i = line.match(start)[0].length; i < line.length; i++) {
    c = line[i];
    if (state == 'optname') {
      if (c == '=') { state = 'startvalue'; }
      else { optname += c; }
    } else if (state == 'startvalue') {
      if (/'|"/.test(c)) { state = c; }
      else { value += c; state = 'value'; }
    } else if (state == 'value') {
      if (/\s/.test(c)) { pushValue(); }
      else { value += c; }
    } else if (/'|"/.test(state)) {
      if (c == state) { pushValue(state); }
      else { value += c; }
    }
  }
  if (state == 'value') { pushValue(); }
  if (state != 'optname') { return false; }
  return opts;
}

// Constructs a mapping function that converts bp intervals into pixel intervals, with optional calculations for text too
module.exports.pixIntervalCalculator = function(start, width, bppp, withText, nameFunc, startkey, endkey) {
  if (!_.isFunction(nameFunc)) { nameFunc = function(d) { return d.name || ''; }; }
  if (_.isUndefined(startkey)) { startkey = 'start'; }
  if (_.isUndefined(endkey)) { endkey = 'end'; }
  return function(d) {
    var itvlStart = _.isUndefined(d[startkey]) ? d.start : d[startkey],
      itvlEnd = _.isUndefined(d[endkey]) ? d.end : d[endkey];
    var pInt = {
      x: Math.round((itvlStart - start) / bppp),
      w: Math.round((itvlEnd - itvlStart) / bppp) + 1,
      t: 0,          // calculated width of text
      oPrev: false,  // overflows into previous tile?
      oNext: false   // overflows into next tile?
    };
    pInt.tx = pInt.x;
    pInt.tw = pInt.w;
    if (pInt.x < 0) { pInt.w += pInt.x; pInt.x = 0; pInt.oPrev = true; }
    else if (withText) {
      pInt.t = _.isNumber(withText) ? withText : Math.min(nameFunc(d).length * 10 + 2, pInt.x);
      pInt.tx -= pInt.t;
      pInt.tw += pInt.t;  
    }
    if (pInt.x + pInt.w > width) { pInt.w = width - pInt.x; pInt.oNext = true; }
    return pInt;
  };
};

// For two given objects of the form {x: 1, w: 2} (pixel intervals), describe the overlap.
// Returns null if there is no overlap.
module.exports.pixIntervalOverlap = function(pInt1, pInt2) {
  var overlap = {},
    tmp;
  if (pInt1.x > pInt2.x) { tmp = pInt2; pInt2 = pInt1; pInt1 = tmp; }       // swap so that pInt1 is always lower
  if (!pInt1.w || !pInt2.w || pInt1.x + pInt1.w < pInt2.x) { return null; } // detect no-overlap conditions
  overlap.x = pInt2.x;
  overlap.w = Math.min(pInt1.w - pInt2.x + pInt1.x, pInt2.w);
  return overlap;
};

// Common functions for summarizing data in bins while plotting wiggle tracks
module.exports.wigBinFunctions = {
  minimum: function(bin) { return bin.length ? Math.min.apply(Math, bin) : 0; },
  mean: function(bin) { return _.reduce(bin, function(a,b) { return a + b; }, 0) / bin.length; },
  maximum: function(bin) { return bin.length ? Math.max.apply(Math, bin) : 0; }
};

// Faster than Math.floor (http://webdood.com/?p=219)
module.exports.floorHack = function(num) { return (num << 0) - (num < 0 ? 1 : 0); }

// Other tiny functions that we need for odds and ends...
module.exports.strip = function(str) { return str.replace(/^\s+|\s+$/g, ''); }
module.exports.parseInt10 = function(val) { return parseInt(val, 10); }
module.exports.deepClone = function(obj) { return JSON.parse(JSON.stringify(obj)); }
},{"../../../underscore.min.js":19}],17:[function(require,module,exports){
// ====================================================================
// = vcfTabix format: http://genome.ucsc.edu/goldenPath/help/vcf.html =
// ====================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.vcftabix
var VcfTabixFormat = {
  defaults: {
    priority: 100,
    drawLimit: {squish: 500, pack: 100},
    maxFetchWindow: 100000,
    chromosomes: ''
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for vcfTabix track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
  },

  parse: function(lines) {
    var self = this;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    // TODO: Set maxFetchWindow using some heuristic based on how many items are in the tabix index
    return true;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = this.chrRange(start, end);
    
    function lineToInterval(line) {
      var fields = line.split('\t'), data = {}, info = {};
      if (fields[7]) {
        _.each(fields[7].split(';'), function(l) { l = l.split('='); if (l.length > 1) { info[l[0]] = l[1]; } });
      }
      data.start = self.browserOpts.chrPos[fields[0]] + parseInt10(fields[1]);
      data.id = fields[2]=='.' ? 'vcf-' + Math.floor(Math.random() * 100000000) : fields[2];
      data.end = data.start + 1;
      data.ref = fields[3];
      data.alt = fields[4];
      data.qual = parseFloat(fields[5]);
      data.info = info;
      return {data: data};
    }
    function nameFunc(fields) {
      var ref = fields.ref || '',
        alt = fields.alt || '';
      return (ref.length > alt.length ? ref : alt) || '';
    }
  
    function success(data) {
      var drawSpec = [],
        lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length > 8; }),
        calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density=='pack', nameFunc);
      if (density == 'dense') {
        _.each(lines, function(line) {
          drawSpec.push(calcPixInterval(lineToInterval(line).data));
        });
      } else {
        drawSpec = {layout: self.type('bed').stackedLayout(_.map(lines, lineToInterval), width, calcPixInterval)};
        drawSpec.width = width;
      }
      callback(drawSpec);
    }
  
    // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch too much data, as this will only delay other requests.
    // TODO: cache results so we aren't refetching the same regions over and over again.
    if ((end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      $.ajax(this.ajaxDir() + 'tabix.php', {
        data: {range: range, url: this.opts.bigDataUrl},
        success: success
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = this.opts.url ? this.opts.url : 'javascript:void("'+this.opts.name+':$$")',
      lineHeight = density == 'pack' ? 27 : 6,
      colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,255,0'},
      drawLimit = this.opts.drawLimit && this.opts.drawLimit[density],
      areas = null;
    if (!ctx) { throw "Canvas not supported"; }
    if (density == 'pack') { areas = this.areas[canvas.id] = []; }
    ctx.fillStyle = "rgb(0,0,0)";
    this.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      if ((drawLimit && drawSpec.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
      } else if (density == 'dense') {
        canvas.height = 15;
        _.each(drawSpec, function(pInt) {
          ctx.fillRect(pInt.x, 1, pInt.w, 13);
        });
      } else {
        canvas.height = drawSpec.layout.length * lineHeight;
        _.each(drawSpec.layout, function(l, i) {
          _.each(l, function(data) {
            var altColor, refColor;
            if (areas) {
              refColor = colors[data.d.ref.toLowerCase()] || '255,0,0';
              altColor = colors[data.d.alt.toLowerCase()] || '255,0,0';
              ctx.fillStyle = "rgb(" + altColor + ")"; 
            }
            ctx.fillRect(data.pInt.x, i * lineHeight + 1, data.pInt.w, lineHeight - 1);
            if (areas) {
              areas.push([
                data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, //x1, x2, y1, y2
                data.d.ref + ' > ' + data.d.alt, // title
                urlTemplate.replace('$$', data.d.id), // href
                data.pInt.oPrev, // continuation from previous tile?
                altColor, // label color
                '<span style="color: rgb(' + refColor + ')">' + data.d.ref + '</span><br/>' + data.d.alt, // label
                data.d.info
              ]);
            }
          });
        });
      }
      if (_.isFunction(callback)) { callback(); }
    });
  }
};

module.exports = VcfTabixFormat;


},{"./utils/utils.js":16}],18:[function(require,module,exports){
(function (global){
// ==================================================================
// = WIG format: http://genome.ucsc.edu/goldenPath/help/wiggle.html =
// ==================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  parseDeclarationLine = utils.parseDeclarationLine;
var SortedList = require('./utils/SortedList.js').SortedList;

// Intended to be loaded into CustomTrack.types.wiggle_0
var WiggleFormat = {
  defaults: {
    altColor: '',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },

  init: function() {
    this.type().initOpts.call(this);
  },
  
  _binFunctions: utils.wigBinFunctions,
  
  initOpts: function() {
    var o = this.opts,
      _binFunctions = this.type()._binFunctions;
    if (!this.validateColor(o.altColor)) { o.altColor = ''; }
    o.viewLimits = _.map(o.viewLimits.split(':'), parseFloat);
    o.maxHeightPixels = _.map(o.maxHeightPixels.split(':'), parseInt10);
    o.yLineOnOff = this.isOn(o.yLineOnOff);
    o.yLineMark = parseFloat(o.yLineMark);
    o.autoScale = this.isOn(o.autoScale);
    if (_binFunctions && !_binFunctions[o.windowingFunction]) {
      throw new Error("invalid windowingFunction at line " + o.lineNum); 
    }
    if (_.isNaN(o.yLineMark)) { o.yLineMark = 0.0; }
  },
  
  applyOpts: function() {
    var self = this,
      o = self.opts;
    self.drawRange = o.autoScale || o.viewLimits.length < 2 ? self.range : o.viewLimits;
    _.each({max: 0, min: 2, start: 1}, function(v, k) { self.heights[k] = o.maxHeightPixels[v]; });
    if (!o.altColor) {
      var hsl = this.rgbToHsl.apply(this, o.color.split(/,\s*/g));
      hsl[0] = hsl[0] + 0.02 % 1;
      hsl[1] = hsl[1] * 0.7;
      hsl[2] = 1 - (1 - hsl[2]) * 0.7;
      self.altColor = _.map(this.hslToRgb.apply(this, hsl), parseInt10).join(',');
    }
  },

  parse: function(lines) {
    var self = this,
      genomeSize = this.browserOpts.genomeSize,
      data = {all: []},
      mode, modeOpts, chrPos, m;
    self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
  
    _.each(lines, function(line, lineno) {
      var val, start;
      
      m = line.match(/^(variable|fixed)Step\s+/i);
      if (m) {
        mode = m[1].toLowerCase();
        modeOpts = parseDeclarationLine(line, /^(variable|fixed)Step\s+/i);
        modeOpts.start = parseInt10(modeOpts.start);
        if (mode == 'fixed' && (_.isNaN(modeOpts.start) || !modeOpts.start)) {
          throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero start parameter"); 
        }
        modeOpts.step = parseInt10(modeOpts.step);
        if (mode == 'fixed' && (_.isNaN(modeOpts.step) || !modeOpts.step)) {
          throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero step parameter"); 
        }
        modeOpts.span = parseInt10(modeOpts.span) || 1;
        chrPos = self.browserOpts.chrPos[modeOpts.chrom];
        if (_.isUndefined(chrPos)) {
          self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
        }
      } else {
        if (!mode) { 
          throw new Error("Wiggle format at " + (lineno + 1 + self.opts.lineNum) + " has no preceding mode declaration"); 
        } else if (_.isUndefined(chrPos)) {
          // invalid chromosome
        } else {
          if (mode == 'fixed') {
            val = parseFloat(line);
            data.all.push({start: chrPos + modeOpts.start, end: chrPos + modeOpts.start + modeOpts.span, val: val});
            modeOpts.start += modeOpts.step;
          } else {
            line = line.split(/\s+/);
            if (line.length < 2) {
              throw new Error("variableStep at line " + (lineno + 1 + self.opts.lineNum) + " requires two values per line"); 
            }
            start = parseInt10(line[0]);
            val = parseFloat(line[1]);
            data.all.push({start: chrPos + start, end: chrPos + start + modeOpts.span, val: val});
          }
        }
      }
    });
    
    return self.type().finishParse.call(self, data);
  },
  
  finishParse: function(data) {
    var self = this,
      binFunction = self.type()._binFunctions[self.opts.windowingFunction];
    if (data.all.length > 0) {
      self.range[0] = _.min(data.all, function(d) { return d.val; }).val;
      self.range[1] = _.max(data.all, function(d) { return d.val; }).val;
    }
    data.all = new SortedList(data.all, {
      compare: function(a, b) {
        if (a === null) return -1;
        if (b === null) return  1;
        var c = a.start - b.start;
        return (c > 0) ? 1 : (c === 0)  ? 0 : -1;
      }
    });
  
    // Pre-optimize data for high bppps by downsampling
    _.each(self.browserOpts.bppps, function(bppp) {
      if (self.browserOpts.genomeSize / bppp > 1000000) { return; }
      var pixLen = Math.ceil(self.browserOpts.genomeSize / bppp),
        downsampledData = (data[bppp] = (global.Float32Array ? new Float32Array(pixLen) : new Array(pixLen))),
        j = 0,
        curr = data.all.get(0),
        bin, next;
      for (var i = 0; i < pixLen; i++) {
        bin = curr && (curr.start <= i * bppp && curr.end > i * bppp) ? [curr.val] : [];
        while ((next = data.all.get(j + 1)) && next.start < (i + 1) * bppp && next.end > i * bppp) { 
          bin.push(next.val); ++j; curr = next; 
        }
        downsampledData[i] = binFunction(bin);
      }
      data._binFunction = self.opts.windowingFunction;
    });
    self.data = data;
    self.stretchHeight = true;
    self.type('wiggle_0').applyOpts.apply(self);
    return true; // success!
  },
  
  initDrawSpec: function(precalc) {
    var vScale = (this.drawRange[1] - this.drawRange[0]) / precalc.height,
      drawSpec = {
        bars: [],
        vScale: vScale,
        yLine: this.isOn(this.opts.yLineOnOff) ? Math.round((this.opts.yLineMark - this.drawRange[0]) / vScale) : null, 
        zeroLine: -this.drawRange[0] / vScale
      };
    return drawSpec;
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      bppp = (end - start) / precalc.width,
      drawSpec = self.type().initDrawSpec.call(self, precalc),
      binFunction = self.type()._binFunctions[self.opts.windowingFunction],
      downsampledData;
    if (self.data._binFunction == self.opts.windowingFunction && (downsampledData = self.data[bppp])) {
      // We've already pre-optimized for this bppp
      drawSpec.bars = _.map(_.range((start - 1) / bppp, (end - 1) / bppp), function(xFromOrigin, x) {
        return ((downsampledData[xFromOrigin] || 0) - self.drawRange[0]) / drawSpec.vScale;
      });
    } else {
      // We have to do the binning on the fly
      var j = self.data.all.bsearch({start: start}),
        curr = self.data.all.get(j), next, bin;
      for (var i = 0; i < precalc.width; i++) {
        bin = curr && (curr.end >= i * bppp + start) ? [curr.val] : [];
        while ((next = self.data.all.get(j + 1)) && next.start < (i + 1) * bppp + start && next.end >= i * bppp + start) { 
          bin.push(next.val); ++j; curr = next; 
        }
        drawSpec.bars.push((binFunction(bin) - self.drawRange[0]) / drawSpec.vScale);
      }
    }
    return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
  },
  
  drawBars: function(ctx, drawSpec, height, width) {
    var zeroLine = drawSpec.zeroLine, // pixel position of the data value 0
      color = "rgb("+this.opts.color+")",
      altColor = "rgb("+(this.opts.altColor || this.altColor)+")",
      pointGraph = this.opts.graphType==='points';
    
    ctx.fillStyle = color;
    _.each(drawSpec.bars, function(d, x) {
      if (d === null) { return; }
      else if (d > zeroLine) { 
        if (pointGraph) { ctx.fillRect(x, height - d, 1, 1); }
        else { ctx.fillRect(x, height - d, 1, zeroLine > 0 ? (d - zeroLine) : d); }
      } else {
        ctx.fillStyle = altColor;
        if (pointGraph) { ctx.fillRect(x, zeroLine - d - 1, 1, 1); } 
        else { ctx.fillRect(x, height - zeroLine, 1, zeroLine - d); }
        ctx.fillStyle = color;
      }
    });
    if (drawSpec.yLine !== null) {
      ctx.fillStyle = "rgb(0,0,0)";
      ctx.fillRect(0, height - drawSpec.yLine, width, 1);
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this,
      height = canvas.height,
      width = canvas.width,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
      self.type().drawBars.call(self, ctx, drawSpec, height, width);
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  loadOpts: function($dialog) {
    var o = this.opts,
      $viewLimits = $dialog.find('.view-limits'),
      $maxHeightPixels = $dialog.find('.max-height-pixels'),
      altColorOn = this.validateColor(o.altColor);
    $dialog.find('[name=altColorOn]').attr('checked', altColorOn).change();
    $dialog.find('[name=altColor]').val(altColorOn ? o.altColor :'128,128,128').change();
    $dialog.find('[name=autoScale]').attr('checked', !this.isOn(o.autoScale)).change();
    $viewLimits.slider("option", "min", this.range[0]);
    $viewLimits.slider("option", "max", this.range[1]);
    $dialog.find('[name=viewLimitsMin]').val(this.drawRange[0]).change();
    $dialog.find('[name=viewLimitsMax]').val(this.drawRange[1]).change();
    $dialog.find('[name=yLineOnOff]').attr('checked', this.isOn(o.yLineOnOff)).change();
    $dialog.find('[name=yLineMark]').val(o.yLineMark).change();
    $dialog.find('[name=graphType]').val(o.graphType).change();
    $dialog.find('[name=windowingFunction]').val(o.windowingFunction).change();
    $dialog.find('[name=maxHeightPixelsOn]').attr('checked', o.maxHeightPixels.length >= 3);
    $dialog.find('[name=maxHeightPixelsMin]').val(o.maxHeightPixels[2]).change();
    $dialog.find('[name=maxHeightPixelsMax]').val(o.maxHeightPixels[0]).change();
  },
  
  saveOpts: function($dialog) {
    var o = this.opts,
      altColorOn = $dialog.find('[name=altColorOn]').is(':checked'),
      maxHeightPixelsOn = $dialog.find('[name=maxHeightPixelsOn]').is(':checked'),
      maxHeightPixelsMax = $dialog.find('[name=maxHeightPixelsMax]').val();
    o.altColor = altColorOn ? $dialog.find('[name=altColor]').val() : '';
    o.autoScale = !$dialog.find('[name=autoScale]').is(':checked');
    o.viewLimits = $dialog.find('[name=viewLimitsMin]').val() + ':' + $dialog.find('[name=viewLimitsMax]').val();
    o.yLineOnOff = $dialog.find('[name=yLineOnOff]').is(':checked');
    o.yLineMark = $dialog.find('[name=yLineMark]').val();
    o.graphType = $dialog.find('[name=graphType]').val();
    o.windowingFunction = $dialog.find('[name=windowingFunction]').val();
    o.maxHeightPixels = maxHeightPixelsOn ? 
      [maxHeightPixelsMax, maxHeightPixelsMax, $dialog.find('[name=maxHeightPixelsMin]').val()].join(':') : '';
    this.type('wiggle_0').initOpts.call(this);
  }
  
};

module.exports = WiggleFormat;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./utils/SortedList.js":15,"./utils/utils.js":16}],19:[function(require,module,exports){
//     Underscore.js 1.8.3
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.
(function(){function n(n){function t(t,r,e,u,i,o){for(;i>=0&&o>i;i+=n){var a=u?u[i]:i;e=r(e,t[a],a,t)}return e}return function(r,e,u,i){e=b(e,i,4);var o=!k(r)&&m.keys(r),a=(o||r).length,c=n>0?0:a-1;return arguments.length<3&&(u=r[o?o[c]:c],c+=n),t(r,e,u,o,c,a)}}function t(n){return function(t,r,e){r=x(r,e);for(var u=O(t),i=n>0?0:u-1;i>=0&&u>i;i+=n)if(r(t[i],i,t))return i;return-1}}function r(n,t,r){return function(e,u,i){var o=0,a=O(e);if("number"==typeof i)n>0?o=i>=0?i:Math.max(i+a,o):a=i>=0?Math.min(i+1,a):i+a+1;else if(r&&i&&a)return i=r(e,u),e[i]===u?i:-1;if(u!==u)return i=t(l.call(e,o,a),m.isNaN),i>=0?i+o:-1;for(i=n>0?o:a-1;i>=0&&a>i;i+=n)if(e[i]===u)return i;return-1}}function e(n,t){var r=I.length,e=n.constructor,u=m.isFunction(e)&&e.prototype||a,i="constructor";for(m.has(n,i)&&!m.contains(t,i)&&t.push(i);r--;)i=I[r],i in n&&n[i]!==u[i]&&!m.contains(t,i)&&t.push(i)}var u=this,i=u._,o=Array.prototype,a=Object.prototype,c=Function.prototype,f=o.push,l=o.slice,s=a.toString,p=a.hasOwnProperty,h=Array.isArray,v=Object.keys,g=c.bind,y=Object.create,d=function(){},m=function(n){return n instanceof m?n:this instanceof m?void(this._wrapped=n):new m(n)};"undefined"!=typeof exports?("undefined"!=typeof module&&module.exports&&(exports=module.exports=m),exports._=m):u._=m,m.VERSION="1.8.3";var b=function(n,t,r){if(t===void 0)return n;switch(null==r?3:r){case 1:return function(r){return n.call(t,r)};case 2:return function(r,e){return n.call(t,r,e)};case 3:return function(r,e,u){return n.call(t,r,e,u)};case 4:return function(r,e,u,i){return n.call(t,r,e,u,i)}}return function(){return n.apply(t,arguments)}},x=function(n,t,r){return null==n?m.identity:m.isFunction(n)?b(n,t,r):m.isObject(n)?m.matcher(n):m.property(n)};m.iteratee=function(n,t){return x(n,t,1/0)};var _=function(n,t){return function(r){var e=arguments.length;if(2>e||null==r)return r;for(var u=1;e>u;u++)for(var i=arguments[u],o=n(i),a=o.length,c=0;a>c;c++){var f=o[c];t&&r[f]!==void 0||(r[f]=i[f])}return r}},j=function(n){if(!m.isObject(n))return{};if(y)return y(n);d.prototype=n;var t=new d;return d.prototype=null,t},w=function(n){return function(t){return null==t?void 0:t[n]}},A=Math.pow(2,53)-1,O=w("length"),k=function(n){var t=O(n);return"number"==typeof t&&t>=0&&A>=t};m.each=m.forEach=function(n,t,r){t=b(t,r);var e,u;if(k(n))for(e=0,u=n.length;u>e;e++)t(n[e],e,n);else{var i=m.keys(n);for(e=0,u=i.length;u>e;e++)t(n[i[e]],i[e],n)}return n},m.map=m.collect=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=Array(u),o=0;u>o;o++){var a=e?e[o]:o;i[o]=t(n[a],a,n)}return i},m.reduce=m.foldl=m.inject=n(1),m.reduceRight=m.foldr=n(-1),m.find=m.detect=function(n,t,r){var e;return e=k(n)?m.findIndex(n,t,r):m.findKey(n,t,r),e!==void 0&&e!==-1?n[e]:void 0},m.filter=m.select=function(n,t,r){var e=[];return t=x(t,r),m.each(n,function(n,r,u){t(n,r,u)&&e.push(n)}),e},m.reject=function(n,t,r){return m.filter(n,m.negate(x(t)),r)},m.every=m.all=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(!t(n[o],o,n))return!1}return!0},m.some=m.any=function(n,t,r){t=x(t,r);for(var e=!k(n)&&m.keys(n),u=(e||n).length,i=0;u>i;i++){var o=e?e[i]:i;if(t(n[o],o,n))return!0}return!1},m.contains=m.includes=m.include=function(n,t,r,e){return k(n)||(n=m.values(n)),("number"!=typeof r||e)&&(r=0),m.indexOf(n,t,r)>=0},m.invoke=function(n,t){var r=l.call(arguments,2),e=m.isFunction(t);return m.map(n,function(n){var u=e?t:n[t];return null==u?u:u.apply(n,r)})},m.pluck=function(n,t){return m.map(n,m.property(t))},m.where=function(n,t){return m.filter(n,m.matcher(t))},m.findWhere=function(n,t){return m.find(n,m.matcher(t))},m.max=function(n,t,r){var e,u,i=-1/0,o=-1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],e>i&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(u>o||u===-1/0&&i===-1/0)&&(i=n,o=u)});return i},m.min=function(n,t,r){var e,u,i=1/0,o=1/0;if(null==t&&null!=n){n=k(n)?n:m.values(n);for(var a=0,c=n.length;c>a;a++)e=n[a],i>e&&(i=e)}else t=x(t,r),m.each(n,function(n,r,e){u=t(n,r,e),(o>u||1/0===u&&1/0===i)&&(i=n,o=u)});return i},m.shuffle=function(n){for(var t,r=k(n)?n:m.values(n),e=r.length,u=Array(e),i=0;e>i;i++)t=m.random(0,i),t!==i&&(u[i]=u[t]),u[t]=r[i];return u},m.sample=function(n,t,r){return null==t||r?(k(n)||(n=m.values(n)),n[m.random(n.length-1)]):m.shuffle(n).slice(0,Math.max(0,t))},m.sortBy=function(n,t,r){return t=x(t,r),m.pluck(m.map(n,function(n,r,e){return{value:n,index:r,criteria:t(n,r,e)}}).sort(function(n,t){var r=n.criteria,e=t.criteria;if(r!==e){if(r>e||r===void 0)return 1;if(e>r||e===void 0)return-1}return n.index-t.index}),"value")};var F=function(n){return function(t,r,e){var u={};return r=x(r,e),m.each(t,function(e,i){var o=r(e,i,t);n(u,e,o)}),u}};m.groupBy=F(function(n,t,r){m.has(n,r)?n[r].push(t):n[r]=[t]}),m.indexBy=F(function(n,t,r){n[r]=t}),m.countBy=F(function(n,t,r){m.has(n,r)?n[r]++:n[r]=1}),m.toArray=function(n){return n?m.isArray(n)?l.call(n):k(n)?m.map(n,m.identity):m.values(n):[]},m.size=function(n){return null==n?0:k(n)?n.length:m.keys(n).length},m.partition=function(n,t,r){t=x(t,r);var e=[],u=[];return m.each(n,function(n,r,i){(t(n,r,i)?e:u).push(n)}),[e,u]},m.first=m.head=m.take=function(n,t,r){return null==n?void 0:null==t||r?n[0]:m.initial(n,n.length-t)},m.initial=function(n,t,r){return l.call(n,0,Math.max(0,n.length-(null==t||r?1:t)))},m.last=function(n,t,r){return null==n?void 0:null==t||r?n[n.length-1]:m.rest(n,Math.max(0,n.length-t))},m.rest=m.tail=m.drop=function(n,t,r){return l.call(n,null==t||r?1:t)},m.compact=function(n){return m.filter(n,m.identity)};var S=function(n,t,r,e){for(var u=[],i=0,o=e||0,a=O(n);a>o;o++){var c=n[o];if(k(c)&&(m.isArray(c)||m.isArguments(c))){t||(c=S(c,t,r));var f=0,l=c.length;for(u.length+=l;l>f;)u[i++]=c[f++]}else r||(u[i++]=c)}return u};m.flatten=function(n,t){return S(n,t,!1)},m.without=function(n){return m.difference(n,l.call(arguments,1))},m.uniq=m.unique=function(n,t,r,e){m.isBoolean(t)||(e=r,r=t,t=!1),null!=r&&(r=x(r,e));for(var u=[],i=[],o=0,a=O(n);a>o;o++){var c=n[o],f=r?r(c,o,n):c;t?(o&&i===f||u.push(c),i=f):r?m.contains(i,f)||(i.push(f),u.push(c)):m.contains(u,c)||u.push(c)}return u},m.union=function(){return m.uniq(S(arguments,!0,!0))},m.intersection=function(n){for(var t=[],r=arguments.length,e=0,u=O(n);u>e;e++){var i=n[e];if(!m.contains(t,i)){for(var o=1;r>o&&m.contains(arguments[o],i);o++);o===r&&t.push(i)}}return t},m.difference=function(n){var t=S(arguments,!0,!0,1);return m.filter(n,function(n){return!m.contains(t,n)})},m.zip=function(){return m.unzip(arguments)},m.unzip=function(n){for(var t=n&&m.max(n,O).length||0,r=Array(t),e=0;t>e;e++)r[e]=m.pluck(n,e);return r},m.object=function(n,t){for(var r={},e=0,u=O(n);u>e;e++)t?r[n[e]]=t[e]:r[n[e][0]]=n[e][1];return r},m.findIndex=t(1),m.findLastIndex=t(-1),m.sortedIndex=function(n,t,r,e){r=x(r,e,1);for(var u=r(t),i=0,o=O(n);o>i;){var a=Math.floor((i+o)/2);r(n[a])<u?i=a+1:o=a}return i},m.indexOf=r(1,m.findIndex,m.sortedIndex),m.lastIndexOf=r(-1,m.findLastIndex),m.range=function(n,t,r){null==t&&(t=n||0,n=0),r=r||1;for(var e=Math.max(Math.ceil((t-n)/r),0),u=Array(e),i=0;e>i;i++,n+=r)u[i]=n;return u};var E=function(n,t,r,e,u){if(!(e instanceof t))return n.apply(r,u);var i=j(n.prototype),o=n.apply(i,u);return m.isObject(o)?o:i};m.bind=function(n,t){if(g&&n.bind===g)return g.apply(n,l.call(arguments,1));if(!m.isFunction(n))throw new TypeError("Bind must be called on a function");var r=l.call(arguments,2),e=function(){return E(n,e,t,this,r.concat(l.call(arguments)))};return e},m.partial=function(n){var t=l.call(arguments,1),r=function(){for(var e=0,u=t.length,i=Array(u),o=0;u>o;o++)i[o]=t[o]===m?arguments[e++]:t[o];for(;e<arguments.length;)i.push(arguments[e++]);return E(n,r,this,this,i)};return r},m.bindAll=function(n){var t,r,e=arguments.length;if(1>=e)throw new Error("bindAll must be passed function names");for(t=1;e>t;t++)r=arguments[t],n[r]=m.bind(n[r],n);return n},m.memoize=function(n,t){var r=function(e){var u=r.cache,i=""+(t?t.apply(this,arguments):e);return m.has(u,i)||(u[i]=n.apply(this,arguments)),u[i]};return r.cache={},r},m.delay=function(n,t){var r=l.call(arguments,2);return setTimeout(function(){return n.apply(null,r)},t)},m.defer=m.partial(m.delay,m,1),m.throttle=function(n,t,r){var e,u,i,o=null,a=0;r||(r={});var c=function(){a=r.leading===!1?0:m.now(),o=null,i=n.apply(e,u),o||(e=u=null)};return function(){var f=m.now();a||r.leading!==!1||(a=f);var l=t-(f-a);return e=this,u=arguments,0>=l||l>t?(o&&(clearTimeout(o),o=null),a=f,i=n.apply(e,u),o||(e=u=null)):o||r.trailing===!1||(o=setTimeout(c,l)),i}},m.debounce=function(n,t,r){var e,u,i,o,a,c=function(){var f=m.now()-o;t>f&&f>=0?e=setTimeout(c,t-f):(e=null,r||(a=n.apply(i,u),e||(i=u=null)))};return function(){i=this,u=arguments,o=m.now();var f=r&&!e;return e||(e=setTimeout(c,t)),f&&(a=n.apply(i,u),i=u=null),a}},m.wrap=function(n,t){return m.partial(t,n)},m.negate=function(n){return function(){return!n.apply(this,arguments)}},m.compose=function(){var n=arguments,t=n.length-1;return function(){for(var r=t,e=n[t].apply(this,arguments);r--;)e=n[r].call(this,e);return e}},m.after=function(n,t){return function(){return--n<1?t.apply(this,arguments):void 0}},m.before=function(n,t){var r;return function(){return--n>0&&(r=t.apply(this,arguments)),1>=n&&(t=null),r}},m.once=m.partial(m.before,2);var M=!{toString:null}.propertyIsEnumerable("toString"),I=["valueOf","isPrototypeOf","toString","propertyIsEnumerable","hasOwnProperty","toLocaleString"];m.keys=function(n){if(!m.isObject(n))return[];if(v)return v(n);var t=[];for(var r in n)m.has(n,r)&&t.push(r);return M&&e(n,t),t},m.allKeys=function(n){if(!m.isObject(n))return[];var t=[];for(var r in n)t.push(r);return M&&e(n,t),t},m.values=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=n[t[u]];return e},m.mapObject=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=u.length,o={},a=0;i>a;a++)e=u[a],o[e]=t(n[e],e,n);return o},m.pairs=function(n){for(var t=m.keys(n),r=t.length,e=Array(r),u=0;r>u;u++)e[u]=[t[u],n[t[u]]];return e},m.invert=function(n){for(var t={},r=m.keys(n),e=0,u=r.length;u>e;e++)t[n[r[e]]]=r[e];return t},m.functions=m.methods=function(n){var t=[];for(var r in n)m.isFunction(n[r])&&t.push(r);return t.sort()},m.extend=_(m.allKeys),m.extendOwn=m.assign=_(m.keys),m.findKey=function(n,t,r){t=x(t,r);for(var e,u=m.keys(n),i=0,o=u.length;o>i;i++)if(e=u[i],t(n[e],e,n))return e},m.pick=function(n,t,r){var e,u,i={},o=n;if(null==o)return i;m.isFunction(t)?(u=m.allKeys(o),e=b(t,r)):(u=S(arguments,!1,!1,1),e=function(n,t,r){return t in r},o=Object(o));for(var a=0,c=u.length;c>a;a++){var f=u[a],l=o[f];e(l,f,o)&&(i[f]=l)}return i},m.omit=function(n,t,r){if(m.isFunction(t))t=m.negate(t);else{var e=m.map(S(arguments,!1,!1,1),String);t=function(n,t){return!m.contains(e,t)}}return m.pick(n,t,r)},m.defaults=_(m.allKeys,!0),m.create=function(n,t){var r=j(n);return t&&m.extendOwn(r,t),r},m.clone=function(n){return m.isObject(n)?m.isArray(n)?n.slice():m.extend({},n):n},m.tap=function(n,t){return t(n),n},m.isMatch=function(n,t){var r=m.keys(t),e=r.length;if(null==n)return!e;for(var u=Object(n),i=0;e>i;i++){var o=r[i];if(t[o]!==u[o]||!(o in u))return!1}return!0};var N=function(n,t,r,e){if(n===t)return 0!==n||1/n===1/t;if(null==n||null==t)return n===t;n instanceof m&&(n=n._wrapped),t instanceof m&&(t=t._wrapped);var u=s.call(n);if(u!==s.call(t))return!1;switch(u){case"[object RegExp]":case"[object String]":return""+n==""+t;case"[object Number]":return+n!==+n?+t!==+t:0===+n?1/+n===1/t:+n===+t;case"[object Date]":case"[object Boolean]":return+n===+t}var i="[object Array]"===u;if(!i){if("object"!=typeof n||"object"!=typeof t)return!1;var o=n.constructor,a=t.constructor;if(o!==a&&!(m.isFunction(o)&&o instanceof o&&m.isFunction(a)&&a instanceof a)&&"constructor"in n&&"constructor"in t)return!1}r=r||[],e=e||[];for(var c=r.length;c--;)if(r[c]===n)return e[c]===t;if(r.push(n),e.push(t),i){if(c=n.length,c!==t.length)return!1;for(;c--;)if(!N(n[c],t[c],r,e))return!1}else{var f,l=m.keys(n);if(c=l.length,m.keys(t).length!==c)return!1;for(;c--;)if(f=l[c],!m.has(t,f)||!N(n[f],t[f],r,e))return!1}return r.pop(),e.pop(),!0};m.isEqual=function(n,t){return N(n,t)},m.isEmpty=function(n){return null==n?!0:k(n)&&(m.isArray(n)||m.isString(n)||m.isArguments(n))?0===n.length:0===m.keys(n).length},m.isElement=function(n){return!(!n||1!==n.nodeType)},m.isArray=h||function(n){return"[object Array]"===s.call(n)},m.isObject=function(n){var t=typeof n;return"function"===t||"object"===t&&!!n},m.each(["Arguments","Function","String","Number","Date","RegExp","Error"],function(n){m["is"+n]=function(t){return s.call(t)==="[object "+n+"]"}}),m.isArguments(arguments)||(m.isArguments=function(n){return m.has(n,"callee")}),"function"!=typeof/./&&"object"!=typeof Int8Array&&(m.isFunction=function(n){return"function"==typeof n||!1}),m.isFinite=function(n){return isFinite(n)&&!isNaN(parseFloat(n))},m.isNaN=function(n){return m.isNumber(n)&&n!==+n},m.isBoolean=function(n){return n===!0||n===!1||"[object Boolean]"===s.call(n)},m.isNull=function(n){return null===n},m.isUndefined=function(n){return n===void 0},m.has=function(n,t){return null!=n&&p.call(n,t)},m.noConflict=function(){return u._=i,this},m.identity=function(n){return n},m.constant=function(n){return function(){return n}},m.noop=function(){},m.property=w,m.propertyOf=function(n){return null==n?function(){}:function(t){return n[t]}},m.matcher=m.matches=function(n){return n=m.extendOwn({},n),function(t){return m.isMatch(t,n)}},m.times=function(n,t,r){var e=Array(Math.max(0,n));t=b(t,r,1);for(var u=0;n>u;u++)e[u]=t(u);return e},m.random=function(n,t){return null==t&&(t=n,n=0),n+Math.floor(Math.random()*(t-n+1))},m.now=Date.now||function(){return(new Date).getTime()};var B={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#x27;","`":"&#x60;"},T=m.invert(B),R=function(n){var t=function(t){return n[t]},r="(?:"+m.keys(n).join("|")+")",e=RegExp(r),u=RegExp(r,"g");return function(n){return n=null==n?"":""+n,e.test(n)?n.replace(u,t):n}};m.escape=R(B),m.unescape=R(T),m.result=function(n,t,r){var e=null==n?void 0:n[t];return e===void 0&&(e=r),m.isFunction(e)?e.call(n):e};var q=0;m.uniqueId=function(n){var t=++q+"";return n?n+t:t},m.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};var K=/(.)^/,z={"'":"'","\\":"\\","\r":"r","\n":"n","\u2028":"u2028","\u2029":"u2029"},D=/\\|'|\r|\n|\u2028|\u2029/g,L=function(n){return"\\"+z[n]};m.template=function(n,t,r){!t&&r&&(t=r),t=m.defaults({},t,m.templateSettings);var e=RegExp([(t.escape||K).source,(t.interpolate||K).source,(t.evaluate||K).source].join("|")+"|$","g"),u=0,i="__p+='";n.replace(e,function(t,r,e,o,a){return i+=n.slice(u,a).replace(D,L),u=a+t.length,r?i+="'+\n((__t=("+r+"))==null?'':_.escape(__t))+\n'":e?i+="'+\n((__t=("+e+"))==null?'':__t)+\n'":o&&(i+="';\n"+o+"\n__p+='"),t}),i+="';\n",t.variable||(i="with(obj||{}){\n"+i+"}\n"),i="var __t,__p='',__j=Array.prototype.join,"+"print=function(){__p+=__j.call(arguments,'');};\n"+i+"return __p;\n";try{var o=new Function(t.variable||"obj","_",i)}catch(a){throw a.source=i,a}var c=function(n){return o.call(this,n,m)},f=t.variable||"obj";return c.source="function("+f+"){\n"+i+"}",c},m.chain=function(n){var t=m(n);return t._chain=!0,t};var P=function(n,t){return n._chain?m(t).chain():t};m.mixin=function(n){m.each(m.functions(n),function(t){var r=m[t]=n[t];m.prototype[t]=function(){var n=[this._wrapped];return f.apply(n,arguments),P(this,r.apply(m,n))}})},m.mixin(m),m.each(["pop","push","reverse","shift","sort","splice","unshift"],function(n){var t=o[n];m.prototype[n]=function(){var r=this._wrapped;return t.apply(r,arguments),"shift"!==n&&"splice"!==n||0!==r.length||delete r[0],P(this,r)}}),m.each(["concat","join","slice"],function(n){var t=o[n];m.prototype[n]=function(){return P(this,t.apply(this._wrapped,arguments))}}),m.prototype.value=function(){return this._wrapped},m.prototype.valueOf=m.prototype.toJSON=m.prototype.value,m.prototype.toString=function(){return""+this._wrapped},"function"==typeof define&&define.amd&&define("underscore",[],function(){return m})}).call(this);
},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL3dhdGNoaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2suanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tXb3JrZXIuanMiLCJqcy9jdXN0b20vQ3VzdG9tVHJhY2tzLmpzIiwianMvY3VzdG9tL2pxdWVyeS5ub2RvbS5taW4uanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmFtLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2JlZC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iZWRncmFwaC5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy9iaWdiZWQuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvYmlnd2lnLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL2ZlYXR1cmV0YWJsZS5qcyIsImpzL2N1c3RvbS90cmFjay10eXBlcy91dGlscy9JbnRlcnZhbFRyZWUuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvTGluZU1hc2suanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1JlbW90ZVRyYWNrLmpzIiwianMvY3VzdG9tL3RyYWNrLXR5cGVzL3V0aWxzL1NvcnRlZExpc3QuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdXRpbHMvdXRpbHMuanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvdmNmdGFiaXguanMiLCJqcy9jdXN0b20vdHJhY2stdHlwZXMvd2lnZ2xlXzAuanMiLCJqcy91bmRlcnNjb3JlLm1pbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0SUE7O0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxd0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5VkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4UUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQzdVQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzlCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDM1FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQ3VzdG9tVHJhY2ssIGFuIG9iamVjdCByZXByZXNlbnRpbmcgYSBjdXN0b20gdHJhY2sgYXMgdW5kZXJzdG9vZCBieSBVQ1NDLiA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIFRoaXMgY2xhc3MgKmRvZXMqIGRlcGVuZCBvbiBnbG9iYWwgb2JqZWN0cyBhbmQgdGhlcmVmb3JlIG11c3QgYmUgcmVxdWlyZWQgYXMgYSBcbi8vIGZ1bmN0aW9uIHRoYXQgaXMgZXhlY3V0ZWQgb24gdGhlIGdsb2JhbCBvYmplY3QuXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZ2xvYmFsKSB7XG5cbnZhciBfID0gcmVxdWlyZSgnLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuZnVuY3Rpb24gQ3VzdG9tVHJhY2sob3B0cywgYnJvd3Nlck9wdHMpIHtcbiAgaWYgKCFvcHRzKSB7IHJldHVybjsgfSAvLyBUaGlzIGlzIGFuIGVtcHR5IGN1c3RvbVRyYWNrIHRoYXQgd2lsbCBiZSBoeWRyYXRlZCB3aXRoIHZhbHVlcyBmcm9tIGEgc2VyaWFsaXplZCBvYmplY3RcbiAgdGhpcy5fdHlwZSA9IChvcHRzLnR5cGUgJiYgb3B0cy50eXBlLnRvTG93ZXJDYXNlKCkpIHx8IFwiYmVkXCI7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCk7XG4gIGlmICh0eXBlID09PSBudWxsKSB7IHRocm93IG5ldyBFcnJvcihcIlVuc3VwcG9ydGVkIHRyYWNrIHR5cGUgJ1wiK29wdHMudHlwZStcIicgZW5jb3VudGVyZWQgb24gbGluZSBcIiArIG9wdHMubGluZU51bSk7IH1cbiAgdGhpcy5vcHRzID0gXy5leHRlbmQoe30sIHRoaXMuY29uc3RydWN0b3IuZGVmYXVsdHMsIHR5cGUuZGVmYXVsdHMgfHwge30sIG9wdHMpO1xuICBfLmV4dGVuZCh0aGlzLCB7XG4gICAgYnJvd3Nlck9wdHM6IGJyb3dzZXJPcHRzLFxuICAgIHN0cmV0Y2hIZWlnaHQ6IGZhbHNlLFxuICAgIGhlaWdodHM6IHt9LFxuICAgIHNpemVzOiBbJ2RlbnNlJ10sXG4gICAgbWFwU2l6ZXM6IFtdLFxuICAgIGFyZWFzOiB7fSxcbiAgICBzY2FsZXM6IHt9LFxuICAgIG5vQXJlYUxhYmVsczogZmFsc2UsXG4gICAgZXhwZWN0c1NlcXVlbmNlOiBmYWxzZSxcbiAgICBvblN5bmNQcm9wczogbnVsbFxuICB9KTtcbiAgdGhpcy5pbml0KCk7XG59XG5cbkN1c3RvbVRyYWNrLmRlZmF1bHRzID0ge1xuICBuYW1lOiAnVXNlciBUcmFjaycsXG4gIGRlc2NyaXB0aW9uOiAnVXNlciBTdXBwbGllZCBUcmFjaycsXG4gIGNvbG9yOiAnMCwwLDAnXG59O1xuXG5DdXN0b21UcmFjay50eXBlcyA9IHtcbiAgYmVkOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZC5qcycpLFxuICBmZWF0dXJldGFibGU6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvZmVhdHVyZXRhYmxlLmpzJyksXG4gIGJlZGdyYXBoOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JlZGdyYXBoLmpzJyksXG4gIHdpZ2dsZV8wOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3dpZ2dsZV8wLmpzJyksXG4gIHZjZnRhYml4OiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL3ZjZnRhYml4LmpzJyksXG4gIGJpZ2JlZDogcmVxdWlyZSgnLi90cmFjay10eXBlcy9iaWdiZWQuanMnKSxcbiAgYmFtOiByZXF1aXJlKCcuL3RyYWNrLXR5cGVzL2JhbS5qcycpLFxuICBiaWd3aWc6IHJlcXVpcmUoJy4vdHJhY2stdHlwZXMvYmlnd2lnLmpzJylcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJlZERldGFpbCBmb3JtYXQ6IGh0dHBzOi8vZ2Vub21lLnVjc2MuZWR1L0ZBUS9GQVFmb3JtYXQuaHRtbCNmb3JtYXQxLjcgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gIFxuXG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwgPSBfLmNsb25lKEN1c3RvbVRyYWNrLnR5cGVzLmJlZCk7XG5DdXN0b21UcmFjay50eXBlcy5iZWRkZXRhaWwuZGVmYXVsdHMgPSBfLmV4dGVuZCh7fSwgQ3VzdG9tVHJhY2sudHlwZXMuYmVkZGV0YWlsLmRlZmF1bHRzLCB7ZGV0YWlsOiB0cnVlfSk7XG5cbi8vIFRoZXNlIGZ1bmN0aW9ucyBicmFuY2ggdG8gZGlmZmVyZW50IG1ldGhvZHMgZGVwZW5kaW5nIG9uIHRoZSAudHlwZSgpIG9mIHRoZSB0cmFja1xuXy5lYWNoKFsnaW5pdCcsICdwYXJzZScsICdyZW5kZXInLCAncmVuZGVyU2VxdWVuY2UnLCAncHJlcmVuZGVyJ10sIGZ1bmN0aW9uKGZuKSB7XG4gIEN1c3RvbVRyYWNrLnByb3RvdHlwZVtmbl0gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgdHlwZSA9IHRoaXMudHlwZSgpO1xuICAgIGlmICghdHlwZVtmbl0pIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgcmV0dXJuIHR5cGVbZm5dLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG59KTtcblxuLy8gTG9hZHMgQ3VzdG9tVHJhY2sgb3B0aW9ucyBpbnRvIHRoZSB0cmFjayBvcHRpb25zIGRpYWxvZyBVSSB3aGVuIGl0IGlzIG9wZW5lZFxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmxvYWRPcHRzID0gZnVuY3Rpb24oJGRpYWxvZykge1xuICB2YXIgdHlwZSA9IHRoaXMudHlwZSgpLFxuICAgIG8gPSB0aGlzLm9wdHM7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0nKS5oaWRlKCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1vcHRzLWZvcm0uJyt0aGlzLl90eXBlKS5zaG93KCk7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1uYW1lJykudGV4dChvLm5hbWUpO1xuICAkZGlhbG9nLmZpbmQoJy5jdXN0b20tZGVzYycpLnRleHQoby5kZXNjcmlwdGlvbik7XG4gICRkaWFsb2cuZmluZCgnLmN1c3RvbS1mb3JtYXQnKS50ZXh0KHRoaXMuX3R5cGUpO1xuICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yXScpLnZhbChvLmNvbG9yKS5jaGFuZ2UoKTtcbiAgaWYgKHR5cGUubG9hZE9wdHMpIHsgdHlwZS5sb2FkT3B0cy5jYWxsKHRoaXMsICRkaWFsb2cpOyB9XG4gICRkaWFsb2cuZmluZCgnLmVuYWJsZXInKS5jaGFuZ2UoKTtcbn07XG5cbi8vIFNhdmVzIG9wdGlvbnMgY2hhbmdlZCBpbiB0aGUgdHJhY2sgb3B0aW9ucyBkaWFsb2cgVUkgYmFjayB0byB0aGUgQ3VzdG9tVHJhY2sgb2JqZWN0XG5DdXN0b21UcmFjay5wcm90b3R5cGUuc2F2ZU9wdHMgPSBmdW5jdGlvbigkZGlhbG9nKSB7XG4gIHZhciB0eXBlID0gdGhpcy50eXBlKCksXG4gICAgbyA9IHRoaXMub3B0cztcbiAgby5jb2xvciA9ICRkaWFsb2cuZmluZCgnW25hbWU9Y29sb3JdJykudmFsKCk7XG4gIGlmICghdGhpcy52YWxpZGF0ZUNvbG9yKG8uY29sb3IpKSB7IG8uY29sb3IgPSAnMCwwLDAnOyB9XG4gIGlmICh0eXBlLnNhdmVPcHRzKSB7IHR5cGUuc2F2ZU9wdHMuY2FsbCh0aGlzLCAkZGlhbG9nKTsgfVxuICB0aGlzLmFwcGx5T3B0cygpO1xuICBnbG9iYWwuQ3VzdG9tVHJhY2tzLndvcmtlcigpICYmIHRoaXMuYXBwbHlPcHRzQXN5bmMoKTsgLy8gQXBwbHkgdGhlIGNoYW5nZXMgdG8gdGhlIHdvcmtlciB0b28hXG59O1xuXG4vLyBTb21ldGltZXMgbmV3bHkgc2V0IG9wdGlvbnMgKHByb3ZpZGVkIGFzIHRoZSBmaXJzdCBhcmcpIG5lZWQgdG8gYmUgdHJhbnNmb3JtZWQgYmVmb3JlIHVzZSBvciBoYXZlIHNpZGUgZWZmZWN0cy5cbi8vIFRoaXMgZnVuY3Rpb24gaXMgcnVuIGZvciBuZXdseSBzZXQgb3B0aW9ucyBpbiBib3RoIHRoZSBET00gYW5kIFdlYiBXb3JrZXIgc2NvcGVzIChzZWUgYXBwbHlPcHRzQXN5bmMgYmVsb3cpLlxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0cyA9IGZ1bmN0aW9uKG9wdHMpIHtcbiAgdmFyIHR5cGUgPSB0aGlzLnR5cGUoKTtcbiAgaWYgKG9wdHMpIHsgdGhpcy5vcHRzID0gb3B0czsgfVxuICBpZiAodHlwZS5hcHBseU9wdHMpIHsgdHlwZS5hcHBseU9wdHMuY2FsbCh0aGlzKTsgfVxufTtcblxuLy8gQ29waWVzIHRoZSBwcm9wZXJ0aWVzIG9mIHRoZSBDdXN0b21UcmFjayAobGlzdGVkIGluIHByb3BzKSBmcm9tIHRoZSBXZWIgV29ya2VyIHNpZGUgdG8gdGhlIERPTSBzaWRlLlxuLy8gVGhpcyBpcyB1c2VmdWwgaWYgdGhlIFdlYiBXb3JrZXIgY29tcHV0ZXMgc29tZXRoaW5nIChsaWtlIGRyYXcgYm91bmRhcmllcykgdGhhdCBib3RoIHNpZGVzIG5lZWQgdG8gYmUgYXdhcmUgb2YuXG4vLyBJZiBhIGNhbGxiYWNrIGlzIHNhdmVkIGluIHRoaXMub25TeW5jUHJvcHMsIHRoaXMgd2lsbCBydW4gdGhlIGNhbGxiYWNrIGFmdGVyd2FyZC5cbi8vIElmIFdlYiBXb3JrZXJzIGFyZSBkaXNhYmxlZCwgdGhpcyBpcyBlZmZlY3RpdmVseSBhIG5vLW9wLCBhbHRob3VnaCB0aGUgY2FsbGJhY2sgc3RpbGwgZmlyZXMuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuc3luY1Byb3BzID0gZnVuY3Rpb24ocHJvcHMsIHJlY2VpdmluZykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChyZWNlaXZpbmcgPT09IHRydWUpIHtcbiAgICBpZiAoIV8uaXNPYmplY3QocHJvcHMpIHx8IF8uaXNBcnJheShwcm9wcykpIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgXy5leHRlbmQoc2VsZiwgcHJvcHMpO1xuICAgIGlmIChfLmlzRnVuY3Rpb24oc2VsZi5vblN5bmNQcm9wcykgJiYgZ2xvYmFsLkhUTUxEb2N1bWVudCkgeyBzZWxmLm9uU3luY1Byb3BzKHByb3BzKTsgfVxuICAgIHJldHVybiBzZWxmO1xuICB9IGVsc2UgeyAgICBcbiAgICBpZiAoXy5pc0FycmF5KHByb3BzKSkgeyBwcm9wcyA9Xy5vYmplY3QocHJvcHMsIF8ubWFwKHByb3BzLCBmdW5jdGlvbihwKSB7IHJldHVybiBzZWxmW3BdOyB9KSk7IH1cbiAgICAvLyBXaGljaCBzaWRlIG9mIHRoZSBmZW5jZSBhcmUgd2Ugb24/ICBIVE1MRG9jdW1lbnQgaW1wbGllcyB3ZSdyZSAqbm90KiBpbiB0aGUgV2ViIFdvcmtlciBzY29wZS5cbiAgICBpZiAoZ2xvYmFsLkhUTUxEb2N1bWVudCkge1xuICAgICAgaWYgKCFnbG9iYWwuQ3VzdG9tVHJhY2tzLndvcmtlcigpKSB7IHJldHVybiBzZWxmLnN5bmNQcm9wcyhwcm9wcywgdHJ1ZSk7IH1cbiAgICB9IGVsc2UgaWYgKGdsb2JhbC5DdXN0b21UcmFja1dvcmtlcikge1xuICAgICAgZ2xvYmFsLkN1c3RvbVRyYWNrV29ya2VyLnN5bmNQcm9wc0FzeW5jKHNlbGYsIHByb3BzKTtcbiAgICB9XG4gIH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5lcmFzZSA9IGZ1bmN0aW9uKGNhbnZhcykge1xuICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgY3R4ID0gY2FudmFzLmdldENvbnRleHQgJiYgY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gIGlmIChjdHgpIHsgY3R4LmNsZWFyUmVjdCgwLCAwLCBjYW52YXMud2lkdGgsIGNhbnZhcy5oZWlnaHQpOyB9XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS50eXBlID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAoXy5pc1VuZGVmaW5lZCh0eXBlKSkgeyB0eXBlID0gdGhpcy5fdHlwZTsgfVxuICByZXR1cm4gdGhpcy5jb25zdHJ1Y3Rvci50eXBlc1t0eXBlXSB8fCBudWxsO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLndhcm4gPSBmdW5jdGlvbih3YXJuaW5nKSB7XG4gIGlmICh0aGlzLm9wdHMuc3RyaWN0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHdhcm5pbmcpO1xuICB9IGVsc2Uge1xuICAgIGlmICghdGhpcy53YXJuaW5ncykgeyB0aGlzLndhcm5pbmdzID0gW107IH1cbiAgICB0aGlzLndhcm5pbmdzLnB1c2god2FybmluZyk7XG4gIH1cbn07XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5pc09uID0gZnVuY3Rpb24odmFsKSB7XG4gIHJldHVybiAvXihvbnx5ZXN8dHJ1ZXx0fHl8MSkkL2kudGVzdCh2YWwudG9TdHJpbmcoKSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyTGlzdCA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuX2Nockxpc3QpIHtcbiAgICB0aGlzLl9jaHJMaXN0ID0gXy5zb3J0QnkoXy5tYXAodGhpcy5icm93c2VyT3B0cy5jaHJQb3MsIGZ1bmN0aW9uKHBvcywgY2hyKSB7IHJldHVybiBbcG9zLCBjaHJdOyB9KSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2Nockxpc3Q7XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5jaHJBdCA9IGZ1bmN0aW9uKHBvcykge1xuICB2YXIgY2hyTGlzdCA9IHRoaXMuY2hyTGlzdCgpLFxuICAgIGNockluZGV4ID0gXy5zb3J0ZWRJbmRleChjaHJMaXN0LCBbcG9zXSwgZnVuY3Rpb24odikgeyByZXR1cm4gdlswXTsgfSksXG4gICAgY2hyID0gY2hySW5kZXggPiAwID8gY2hyTGlzdFtjaHJJbmRleCAtIDFdWzFdIDogbnVsbDtcbiAgcmV0dXJuIHtpOiBjaHJJbmRleCAtIDEsIGM6IGNociwgcDogcG9zIC0gdGhpcy5icm93c2VyT3B0cy5jaHJQb3NbY2hyXX07XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuY2hyUmFuZ2UgPSBmdW5jdGlvbihzdGFydCwgZW5kKSB7XG4gIHZhciBjaHJMZW5ndGhzID0gdGhpcy5icm93c2VyT3B0cy5jaHJMZW5ndGhzLFxuICAgIHN0YXJ0Q2hyID0gdGhpcy5jaHJBdChzdGFydCksXG4gICAgZW5kQ2hyID0gdGhpcy5jaHJBdChlbmQpLFxuICAgIHJhbmdlO1xuICBpZiAoc3RhcnRDaHIuYyAmJiBzdGFydENoci5pID09PSBlbmRDaHIuaSkgeyByZXR1cm4gW3N0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgZW5kQ2hyLnBdOyB9XG4gIGVsc2Uge1xuICAgIHJhbmdlID0gXy5tYXAodGhpcy5jaHJMaXN0KCkuc2xpY2Uoc3RhcnRDaHIuaSArIDEsIGVuZENoci5pKSwgZnVuY3Rpb24odikge1xuICAgICAgcmV0dXJuIHZbMV0gKyAnOjEtJyArIGNockxlbmd0aHNbdlsxXV07XG4gICAgfSk7XG4gICAgc3RhcnRDaHIuYyAmJiByYW5nZS51bnNoaWZ0KHN0YXJ0Q2hyLmMgKyAnOicgKyBzdGFydENoci5wICsgJy0nICsgY2hyTGVuZ3Roc1tzdGFydENoci5jXSk7XG4gICAgZW5kQ2hyLmMgJiYgcmFuZ2UucHVzaChlbmRDaHIuYyArICc6MS0nICsgZW5kQ2hyLnApO1xuICAgIHJldHVybiByYW5nZTtcbiAgfVxufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucHJlcmVuZGVyQXN5bmMgPSBmdW5jdGlvbigpIHtcbiAgZ2xvYmFsLkN1c3RvbVRyYWNrcy5hc3luYyh0aGlzLCAncHJlcmVuZGVyJywgYXJndW1lbnRzLCBbdGhpcy5pZF0pO1xufTtcblxuQ3VzdG9tVHJhY2sucHJvdG90eXBlLmFwcGx5T3B0c0FzeW5jID0gZnVuY3Rpb24oKSB7XG4gIGdsb2JhbC5DdXN0b21UcmFja3MuYXN5bmModGhpcywgJ2FwcGx5T3B0cycsIFt0aGlzLm9wdHMsIGZ1bmN0aW9uKCl7fV0sIFt0aGlzLmlkXSk7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUuYWpheERpciA9IGZ1bmN0aW9uKCkge1xuICAvLyBXZWIgV29ya2VycyBmZXRjaCBVUkxzIHJlbGF0aXZlIHRvIHRoZSBKUyBmaWxlIGl0c2VsZi5cbiAgcmV0dXJuIChnbG9iYWwuSFRNTERvY3VtZW50ID8gJycgOiAnLi4vJykgKyB0aGlzLmJyb3dzZXJPcHRzLmFqYXhEaXI7XG59O1xuXG5DdXN0b21UcmFjay5wcm90b3R5cGUucmdiVG9Ic2wgPSBmdW5jdGlvbihyLCBnLCBiKSB7XG4gIHIgLz0gMjU1LCBnIC89IDI1NSwgYiAvPSAyNTU7XG4gIHZhciBtYXggPSBNYXRoLm1heChyLCBnLCBiKSwgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIHZhciBoLCBzLCBsID0gKG1heCArIG1pbikgLyAyO1xuXG4gIGlmIChtYXggPT0gbWluKSB7XG4gICAgaCA9IHMgPSAwOyAvLyBhY2hyb21hdGljXG4gIH0gZWxzZSB7XG4gICAgdmFyIGQgPSBtYXggLSBtaW47XG4gICAgcyA9IGwgPiAwLjUgPyBkIC8gKDIgLSBtYXggLSBtaW4pIDogZCAvIChtYXggKyBtaW4pO1xuICAgIHN3aXRjaChtYXgpe1xuICAgICAgY2FzZSByOiBoID0gKGcgLSBiKSAvIGQgKyAoZyA8IGIgPyA2IDogMCk7IGJyZWFrO1xuICAgICAgY2FzZSBnOiBoID0gKGIgLSByKSAvIGQgKyAyOyBicmVhaztcbiAgICAgIGNhc2UgYjogaCA9IChyIC0gZykgLyBkICsgNDsgYnJlYWs7XG4gICAgfVxuICAgIGggLz0gNjtcbiAgfVxuXG4gIHJldHVybiBbaCwgcywgbF07XG59XG5cbkN1c3RvbVRyYWNrLnByb3RvdHlwZS5oc2xUb1JnYiA9IGZ1bmN0aW9uKGgsIHMsIGwpIHtcbiAgdmFyIHIsIGcsIGI7XG5cbiAgaWYgKHMgPT0gMCkge1xuICAgIHIgPSBnID0gYiA9IGw7IC8vIGFjaHJvbWF0aWNcbiAgfSBlbHNlIHtcbiAgICBmdW5jdGlvbiBodWUycmdiKHAsIHEsIHQpIHtcbiAgICAgIGlmKHQgPCAwKSB0ICs9IDE7XG4gICAgICBpZih0ID4gMSkgdCAtPSAxO1xuICAgICAgaWYodCA8IDEvNikgcmV0dXJuIHAgKyAocSAtIHApICogNiAqIHQ7XG4gICAgICBpZih0IDwgMS8yKSByZXR1cm4gcTtcbiAgICAgIGlmKHQgPCAyLzMpIHJldHVybiBwICsgKHEgLSBwKSAqICgyLzMgLSB0KSAqIDY7XG4gICAgICByZXR1cm4gcDtcbiAgICB9XG5cbiAgICB2YXIgcSA9IGwgPCAwLjUgPyBsICogKDEgKyBzKSA6IGwgKyBzIC0gbCAqIHM7XG4gICAgdmFyIHAgPSAyICogbCAtIHE7XG4gICAgciA9IGh1ZTJyZ2IocCwgcSwgaCArIDEvMyk7XG4gICAgZyA9IGh1ZTJyZ2IocCwgcSwgaCk7XG4gICAgYiA9IGh1ZTJyZ2IocCwgcSwgaCAtIDEvMyk7XG4gIH1cblxuICByZXR1cm4gW3IgKiAyNTUsIGcgKiAyNTUsIGIgKiAyNTVdO1xufVxuXG5DdXN0b21UcmFjay5wcm90b3R5cGUudmFsaWRhdGVDb2xvciA9IGZ1bmN0aW9uKGNvbG9yKSB7XG4gIHZhciBtID0gY29sb3IubWF0Y2goLyhcXGQrKSwoXFxkKyksKFxcZCspLyk7XG4gIGlmICghbSkgeyByZXR1cm4gZmFsc2U7IH1cbiAgbS5zaGlmdCgpO1xuICByZXR1cm4gXy5hbGwoXy5tYXAobSwgcGFyc2VJbnQxMCksIGZ1bmN0aW9uKHYpIHsgcmV0dXJuIHYgPj0wICYmIHYgPD0gMjU1OyB9KTtcbn1cblxucmV0dXJuIEN1c3RvbVRyYWNrO1xuXG59OyIsInZhciBnbG9iYWwgPSBzZWxmOyAgLy8gZ3JhYiBnbG9iYWwgc2NvbGUgZm9yIFdlYiBXb3JrZXJzXG5yZXF1aXJlKCcuL2pxdWVyeS5ub2RvbS5taW4uanMnKShnbG9iYWwpO1xuZ2xvYmFsLl8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xucmVxdWlyZSgnLi9DdXN0b21UcmFja3MuanMnKShnbG9iYWwpO1xuXG5pZiAoIWdsb2JhbC5jb25zb2xlIHx8ICFnbG9iYWwuY29uc29sZS5sb2cpIHtcbiAgZ2xvYmFsLmNvbnNvbGUgPSBnbG9iYWwuY29uc29sZSB8fCB7fTtcbiAgZ2xvYmFsLmNvbnNvbGUubG9nID0gZnVuY3Rpb24oKSB7XG4gICAgZ2xvYmFsLnBvc3RNZXNzYWdlKHtsb2c6IEpTT04uc3RyaW5naWZ5KF8udG9BcnJheShhcmd1bWVudHMpKX0pO1xuICB9O1xufVxuXG52YXIgQ3VzdG9tVHJhY2tXb3JrZXIgPSB7XG4gIF90cmFja3M6IFtdLFxuICBfdGhyb3dFcnJvcnM6IGZhbHNlLFxuICBwYXJzZTogZnVuY3Rpb24odGV4dCwgYnJvd3Nlck9wdHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB0cmFja3MgPSBDdXN0b21UcmFja3MucGFyc2UodGV4dCwgYnJvd3Nlck9wdHMpO1xuICAgIHJldHVybiBfLm1hcCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgIC8vIHdlIHdhbnQgdG8ga2VlcCB0aGUgdHJhY2sgb2JqZWN0IGluIG91ciBwcml2YXRlIHN0b3JlLCBhbmQgZGVsZXRlIHRoZSBkYXRhIGZyb20gdGhlIGNvcHkgdGhhdFxuICAgICAgLy8gaXMgc2VudCBiYWNrIG92ZXIgdGhlIGZlbmNlLCBzaW5jZSBpdCBpcyBleHBlbnNpdmUvaW1wb3NzaWJsZSB0byBzZXJpYWxpemVcbiAgICAgIHQuaWQgPSBzZWxmLl90cmFja3MucHVzaCh0KSAtIDE7XG4gICAgICB2YXIgc2VyaWFsaXphYmxlID0gXy5leHRlbmQoe30sIHQpO1xuICAgICAgZGVsZXRlIHNlcmlhbGl6YWJsZS5kYXRhO1xuICAgICAgcmV0dXJuIHNlcmlhbGl6YWJsZTtcbiAgICB9KTtcbiAgfSxcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgdHJhY2sgPSB0aGlzLl90cmFja3NbaWRdO1xuICAgIHRyYWNrLnByZXJlbmRlci5hcHBseSh0cmFjaywgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXJncyA9IF8udG9BcnJheShhcmd1bWVudHMpLFxuICAgICAgaWQgPSBfLmZpcnN0KGFyZ3MpLFxuICAgICAgdHJhY2sgPSB0aGlzLl90cmFja3NbaWRdO1xuICAgIHRyYWNrLmFwcGx5T3B0cy5hcHBseSh0cmFjaywgXy5yZXN0KGFyZ3MpKTtcbiAgfSxcbiAgc3luY1Byb3BzQXN5bmM6IGZ1bmN0aW9uKHRyYWNrLCBwcm9wcykge1xuICAgIGdsb2JhbC5wb3N0TWVzc2FnZSh7aWQ6IHRyYWNrLmlkLCBzeW5jUHJvcHM6IHByb3BzfSk7XG4gIH0sXG4gIHRocm93RXJyb3JzOiBmdW5jdGlvbih0b2dnbGUpIHtcbiAgICB0aGlzLl90aHJvd0Vycm9ycyA9IHRvZ2dsZTtcbiAgfVxufTtcblxuZ2xvYmFsLkN1c3RvbVRyYWNrV29ya2VyID0gQ3VzdG9tVHJhY2tXb3JrZXI7XG5cbmdsb2JhbC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24oZSkge1xuICB2YXIgZGF0YSA9IGUuZGF0YSxcbiAgICBjYWxsYmFjayA9IGZ1bmN0aW9uKHIpIHsgZ2xvYmFsLnBvc3RNZXNzYWdlKHtpZDogZGF0YS5pZCwgcmV0OiBKU09OLnN0cmluZ2lmeShyIHx8IG51bGwpfSk7IH0sXG4gICAgcmV0O1xuXG4gIGlmIChDdXN0b21UcmFja1dvcmtlci5fdGhyb3dFcnJvcnMgfHwgdHJ1ZSkgeyAgLy8gRklYTUVcbiAgICByZXQgPSBDdXN0b21UcmFja1dvcmtlcltkYXRhLm9wXS5hcHBseShDdXN0b21UcmFja1dvcmtlciwgZGF0YS5hcmdzLmNvbmNhdChjYWxsYmFjaykpO1xuICB9IGVsc2Uge1xuICAgIHRyeSB7IHJldCA9IEN1c3RvbVRyYWNrV29ya2VyW2RhdGEub3BdLmFwcGx5KEN1c3RvbVRyYWNrV29ya2VyLCBkYXRhLmFyZ3MuY29uY2F0KGNhbGxiYWNrKSk7IH0gXG4gICAgY2F0Y2ggKGVycikgeyBnbG9iYWwucG9zdE1lc3NhZ2Uoe2lkOiBkYXRhLmlkLCBlcnJvcjogSlNPTi5zdHJpbmdpZnkoe21lc3NhZ2U6IGVyci5tZXNzYWdlfSl9KTsgfVxuICB9XG4gIFxuICBpZiAoIV8uaXNVbmRlZmluZWQocmV0KSkgeyBjYWxsYmFjayhyZXQpOyB9XG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbihnbG9iYWwpe1xuICBcbiAgdmFyIF8gPSByZXF1aXJlKCcuLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuICBcbiAgLy8gU29tZSB1dGlsaXR5IGZ1bmN0aW9ucy5cbiAgdmFyIHV0aWxzID0gcmVxdWlyZSgnLi90cmFjay10eXBlcy91dGlscy91dGlscy5qcycpLFxuICAgIHBhcnNlRGVjbGFyYXRpb25MaW5lID0gdXRpbHMucGFyc2VEZWNsYXJhdGlvbkxpbmU7XG4gIFxuICAvLyBUaGUgY2xhc3MgdGhhdCByZXByZXNlbnRzIGEgc2luZ3VsYXIgY3VzdG9tIHRyYWNrIG9iamVjdFxuICB2YXIgQ3VzdG9tVHJhY2sgPSByZXF1aXJlKCcuL0N1c3RvbVRyYWNrLmpzJykoZ2xvYmFsKTtcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gPSBDdXN0b21UcmFja3MsIHRoZSBtb2R1bGUgdGhhdCBpcyBleHBvcnRlZCB0byB0aGUgZ2xvYmFsIGVudmlyb25tZW50LiA9XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBCcm9hZGx5IHNwZWFraW5nIHRoaXMgaXMgYSBmYWN0b3J5IGZvciBwYXJzaW5nIGRhdGEgaW50byBDdXN0b21UcmFjayBvYmplY3RzLFxuICAvLyBhbmQgaXQgY2FuIGRlbGVnYXRlIHRoaXMgd29yayB0byBhIHdvcmtlciB0aHJlYWQuXG5cbiAgdmFyIEN1c3RvbVRyYWNrcyA9IHtcbiAgICBfdHJhY2tzOiB7fSxcbiAgICBcbiAgICBwYXJzZTogZnVuY3Rpb24oY2h1bmtzLCBicm93c2VyT3B0cykge1xuICAgICAgdmFyIGN1c3RvbVRyYWNrcyA9IFtdLFxuICAgICAgICBkYXRhID0gW10sXG4gICAgICAgIHRyYWNrLCBvcHRzLCBtO1xuICAgICAgXG4gICAgICBpZiAodHlwZW9mIGNodW5rcyA9PSBcInN0cmluZ1wiKSB7IGNodW5rcyA9IFtjaHVua3NdOyB9XG4gICAgICBcbiAgICAgIGZ1bmN0aW9uIHB1c2hUcmFjaygpIHtcbiAgICAgICAgaWYgKHRyYWNrLnBhcnNlKGRhdGEpKSB7IGN1c3RvbVRyYWNrcy5wdXNoKHRyYWNrKTsgfVxuICAgICAgfVxuICAgICAgXG4gICAgICBjdXN0b21UcmFja3MuYnJvd3NlciA9IHt9O1xuICAgICAgXy5lYWNoKGNodW5rcywgZnVuY3Rpb24odGV4dCkge1xuICAgICAgICBfLmVhY2godGV4dC5zcGxpdChcIlxcblwiKSwgZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgICAgICAgaWYgKC9eIy8udGVzdChsaW5lKSkge1xuICAgICAgICAgICAgLy8gY29tbWVudCBsaW5lXG4gICAgICAgICAgfSBlbHNlIGlmICgvXmJyb3dzZXJcXHMrLy50ZXN0KGxpbmUpKSB7XG4gICAgICAgICAgICAvLyBicm93c2VyIGxpbmVzXG4gICAgICAgICAgICBtID0gbGluZS5tYXRjaCgvXmJyb3dzZXJcXHMrKFxcdyspXFxzKyhcXFMqKS8pO1xuICAgICAgICAgICAgaWYgKCFtKSB7IHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBwYXJzZSBicm93c2VyIGxpbmUgZm91bmQgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxKSk7IH1cbiAgICAgICAgICAgIGN1c3RvbVRyYWNrcy5icm93c2VyW21bMV1dID0gbVsyXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9edHJhY2tcXHMrL2kudGVzdChsaW5lKSkge1xuICAgICAgICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICAgICAgICBvcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgKC9edHJhY2tcXHMrL2kpKTtcbiAgICAgICAgICAgIGlmICghb3B0cykgeyB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgcGFyc2UgdHJhY2sgbGluZSBmb3VuZCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEpKTsgfVxuICAgICAgICAgICAgb3B0cy5saW5lTnVtID0gbGluZW5vICsgMTtcbiAgICAgICAgICAgIHRyYWNrID0gbmV3IEN1c3RvbVRyYWNrKG9wdHMsIGJyb3dzZXJPcHRzKTtcbiAgICAgICAgICAgIGRhdGEgPSBbXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKC9cXFMvLnRlc3QobGluZSkpIHtcbiAgICAgICAgICAgIGlmICghdHJhY2spIHsgdGhyb3cgbmV3IEVycm9yKFwiRm91bmQgZGF0YSBvbiBsaW5lIFwiKyhsaW5lbm8rMSkrXCIgYnV0IG5vIHByZWNlZGluZyB0cmFjayBkZWZpbml0aW9uXCIpOyB9XG4gICAgICAgICAgICBkYXRhLnB1c2gobGluZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHRyYWNrKSB7IHB1c2hUcmFjaygpOyB9XG4gICAgICByZXR1cm4gY3VzdG9tVHJhY2tzO1xuICAgIH0sXG4gICAgXG4gICAgcGFyc2VEZWNsYXJhdGlvbkxpbmU6IHBhcnNlRGVjbGFyYXRpb25MaW5lLFxuICAgIFxuICAgIGVycm9yOiBmdW5jdGlvbihlKSB7XG4gICAgICAvLyBDYW4gYmUgb3ZlcnJpZGRlbiBieSBhIHBhcmVudCBsaWJyYXJ5IHRvIGhhbmRsZSBlcnJvcnMgbW9yZSBncmFjZWZ1bGx5LlxuICAgICAgLy8gTm90ZTogdGhpcyBpcyBvdmVycmlkZGVuIGJ5IHVpLmdlbm9icm93c2VyIGR1cmluZyBVSSBzZXR1cC5cbiAgICAgIGNvbnNvbGUubG9nKGUpO1xuICAgIH0sXG4gICAgXG4gICAgX3dvcmtlclNjcmlwdDogJ2J1aWxkL0N1c3RvbVRyYWNrV29ya2VyLmpzJyxcbiAgICAvLyBOT1RFOiBUbyB0ZW1wb3JhcmlseSBkaXNhYmxlIFdlYiBXb3JrZXIgdXNhZ2UsIHNldCB0aGlzIHRvIHRydWUuXG4gICAgX2Rpc2FibGVXb3JrZXJzOiBmYWxzZSxcbiAgICBcbiAgICB3b3JrZXI6IGZ1bmN0aW9uKCkgeyBcbiAgICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgICAgY2FsbGJhY2tzID0gW107XG4gICAgICBpZiAoIXNlbGYuX3dvcmtlciAmJiBnbG9iYWwuV29ya2VyKSB7IFxuICAgICAgICBzZWxmLl93b3JrZXIgPSBuZXcgZ2xvYmFsLldvcmtlcihzZWxmLl93b3JrZXJTY3JpcHQpO1xuICAgICAgICBzZWxmLl93b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBmdW5jdGlvbihlKSB7IHNlbGYuZXJyb3IoZSk7IH0sIGZhbHNlKTtcbiAgICAgICAgc2VsZi5fd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgaWYgKGUuZGF0YS5sb2cpIHsgY29uc29sZS5sb2coSlNPTi5wYXJzZShlLmRhdGEubG9nKSk7IHJldHVybjsgfVxuICAgICAgICAgIGlmIChlLmRhdGEuZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChlLmRhdGEuaWQpIHsgZGVsZXRlIGNhbGxiYWNrc1tlLmRhdGEuaWRdOyB9XG4gICAgICAgICAgICBzZWxmLmVycm9yKEpTT04ucGFyc2UoZS5kYXRhLmVycm9yKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChlLmRhdGEuc3luY1Byb3BzKSB7XG4gICAgICAgICAgICBzZWxmLl90cmFja3NbZS5kYXRhLmlkXS5zeW5jUHJvcHMoZS5kYXRhLnN5bmNQcm9wcywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGNhbGxiYWNrc1tlLmRhdGEuaWRdKEpTT04ucGFyc2UoZS5kYXRhLnJldCkpO1xuICAgICAgICAgIGRlbGV0ZSBjYWxsYmFja3NbZS5kYXRhLmlkXTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNlbGYuX3dvcmtlci5jYWxsID0gZnVuY3Rpb24ob3AsIGFyZ3MsIGNhbGxiYWNrKSB7XG4gICAgICAgICAgdmFyIGlkID0gY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spIC0gMTtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogb3AsIGlkOiBpZCwgYXJnczogYXJnc30pO1xuICAgICAgICB9O1xuICAgICAgICAvLyBUbyBoYXZlIHRoZSB3b3JrZXIgdGhyb3cgZXJyb3JzIGluc3RlYWQgb2YgcGFzc2luZyB0aGVtIG5pY2VseSBiYWNrLCBjYWxsIHRoaXMgd2l0aCB0b2dnbGU9dHJ1ZVxuICAgICAgICBzZWxmLl93b3JrZXIudGhyb3dFcnJvcnMgPSBmdW5jdGlvbih0b2dnbGUpIHtcbiAgICAgICAgICB0aGlzLnBvc3RNZXNzYWdlKHtvcDogJ3Rocm93RXJyb3JzJywgYXJnczogW3RvZ2dsZV19KTtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZWxmLl9kaXNhYmxlV29ya2VycyA/IG51bGwgOiBzZWxmLl93b3JrZXI7XG4gICAgfSxcbiAgICBcbiAgICBhc3luYzogZnVuY3Rpb24oc2VsZiwgZm4sIGFyZ3MsIGFzeW5jRXh0cmFBcmdzLCB3cmFwcGVyKSB7XG4gICAgICBhcmdzID0gXy50b0FycmF5KGFyZ3MpO1xuICAgICAgd3JhcHBlciA9IHdyYXBwZXIgfHwgXy5pZGVudGl0eTtcbiAgICAgIHZhciBhcmdzRXhjZXB0TGFzdE9uZSA9IF8uaW5pdGlhbChhcmdzKSxcbiAgICAgICAgY2FsbGJhY2sgPSBfLmxhc3QoYXJncyksXG4gICAgICAgIHcgPSB0aGlzLndvcmtlcigpO1xuICAgICAgLy8gRmFsbGJhY2sgaWYgd2ViIHdvcmtlcnMgYXJlIG5vdCBzdXBwb3J0ZWQuXG4gICAgICAvLyBUaGlzIGNvdWxkIGFsc28gYmUgdHdlYWtlZCB0byBub3QgdXNlIHdlYiB3b3JrZXJzIHdoZW4gdGhlcmUgd291bGQgYmUgbm8gcGVyZm9ybWFuY2UgZ2FpbjtcbiAgICAgIC8vICAgYWN0aXZhdGluZyB0aGlzIGJyYW5jaCBkaXNhYmxlcyB3ZWIgd29ya2VycyBlbnRpcmVseSBhbmQgZXZlcnl0aGluZyBoYXBwZW5zIHN5bmNocm9ub3VzbHkuXG4gICAgICBpZiAoIXcpIHsgcmV0dXJuIGNhbGxiYWNrKHNlbGZbZm5dLmFwcGx5KHNlbGYsIGFyZ3NFeGNlcHRMYXN0T25lKSk7IH1cbiAgICAgIEFycmF5LnByb3RvdHlwZS51bnNoaWZ0LmFwcGx5KGFyZ3NFeGNlcHRMYXN0T25lLCBhc3luY0V4dHJhQXJncyk7XG4gICAgICB3LmNhbGwoZm4sIGFyZ3NFeGNlcHRMYXN0T25lLCBmdW5jdGlvbihyZXQpIHsgY2FsbGJhY2sod3JhcHBlcihyZXQpKTsgfSk7XG4gICAgfSxcbiAgICBcbiAgICBwYXJzZUFzeW5jOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgIHNlbGYuYXN5bmMoc2VsZiwgJ3BhcnNlJywgYXJndW1lbnRzLCBbXSwgZnVuY3Rpb24odHJhY2tzKSB7XG4gICAgICAgIC8vIFRoZXNlIGhhdmUgYmVlbiBzZXJpYWxpemVkLCBzbyB0aGV5IG11c3QgYmUgaHlkcmF0ZWQgaW50byByZWFsIEN1c3RvbVRyYWNrIG9iamVjdHMuXG4gICAgICAgIC8vIFdlIHJlcGxhY2UgLnByZXJlbmRlcigpIHdpdGggYW4gYXN5bmNocm9ub3VzIHZlcnNpb24uXG4gICAgICAgIHJldHVybiBfLm1hcCh0cmFja3MsIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICBzZWxmLl90cmFja3NbdC5pZF0gPSBfLmV4dGVuZChuZXcgQ3VzdG9tVHJhY2soKSwgdCwge1xuICAgICAgICAgICAgcHJlcmVuZGVyOiBmdW5jdGlvbigpIHsgQ3VzdG9tVHJhY2sucHJvdG90eXBlLnByZXJlbmRlckFzeW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gc2VsZi5fdHJhY2tzW3QuaWRdO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBnbG9iYWwuQ3VzdG9tVHJhY2tzID0gQ3VzdG9tVHJhY2tzO1xuXG59KTsiLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdsb2JhbCl7Z2xvYmFsLndpbmRvdz1nbG9iYWwud2luZG93fHxnbG9iYWw7Z2xvYmFsLndpbmRvdy5kb2N1bWVudD1nbG9iYWwud2luZG93LmRvY3VtZW50fHx7fTsoZnVuY3Rpb24oYSxiKXtmdW5jdGlvbiBOKCl7dHJ5e3JldHVybiBuZXcgYS5BY3RpdmVYT2JqZWN0KFwiTWljcm9zb2Z0LlhNTEhUVFBcIil9Y2F0Y2goYil7fX1mdW5jdGlvbiBNKCl7dHJ5e3JldHVybiBuZXcgYS5YTUxIdHRwUmVxdWVzdH1jYXRjaChiKXt9fWZ1bmN0aW9uIEkoYSxjKXtpZihhLmRhdGFGaWx0ZXIpe2M9YS5kYXRhRmlsdGVyKGMsYS5kYXRhVHlwZSl9dmFyIGQ9YS5kYXRhVHlwZXMsZT17fSxnLGgsaT1kLmxlbmd0aCxqLGs9ZFswXSxsLG0sbixvLHA7Zm9yKGc9MTtnPGk7ZysrKXtpZihnPT09MSl7Zm9yKGggaW4gYS5jb252ZXJ0ZXJzKXtpZih0eXBlb2YgaD09PVwic3RyaW5nXCIpe2VbaC50b0xvd2VyQ2FzZSgpXT1hLmNvbnZlcnRlcnNbaF19fX1sPWs7az1kW2ddO2lmKGs9PT1cIipcIil7az1sfWVsc2UgaWYobCE9PVwiKlwiJiZsIT09ayl7bT1sK1wiIFwiK2s7bj1lW21dfHxlW1wiKiBcIitrXTtpZighbil7cD1iO2ZvcihvIGluIGUpe2o9by5zcGxpdChcIiBcIik7aWYoalswXT09PWx8fGpbMF09PT1cIipcIil7cD1lW2pbMV0rXCIgXCIra107aWYocCl7bz1lW29dO2lmKG89PT10cnVlKXtuPXB9ZWxzZSBpZihwPT09dHJ1ZSl7bj1vfWJyZWFrfX19fWlmKCEobnx8cCkpe2YuZXJyb3IoXCJObyBjb252ZXJzaW9uIGZyb20gXCIrbS5yZXBsYWNlKFwiIFwiLFwiIHRvIFwiKSl9aWYobiE9PXRydWUpe2M9bj9uKGMpOnAobyhjKSl9fX1yZXR1cm4gY31mdW5jdGlvbiBIKGEsYyxkKXt2YXIgZT1hLmNvbnRlbnRzLGY9YS5kYXRhVHlwZXMsZz1hLnJlc3BvbnNlRmllbGRzLGgsaSxqLGs7Zm9yKGkgaW4gZyl7aWYoaSBpbiBkKXtjW2dbaV1dPWRbaV19fXdoaWxlKGZbMF09PT1cIipcIil7Zi5zaGlmdCgpO2lmKGg9PT1iKXtoPWEubWltZVR5cGV8fGMuZ2V0UmVzcG9uc2VIZWFkZXIoXCJjb250ZW50LXR5cGVcIil9fWlmKGgpe2ZvcihpIGluIGUpe2lmKGVbaV0mJmVbaV0udGVzdChoKSl7Zi51bnNoaWZ0KGkpO2JyZWFrfX19aWYoZlswXWluIGQpe2o9ZlswXX1lbHNle2ZvcihpIGluIGQpe2lmKCFmWzBdfHxhLmNvbnZlcnRlcnNbaStcIiBcIitmWzBdXSl7aj1pO2JyZWFrfWlmKCFrKXtrPWl9fWo9anx8a31pZihqKXtpZihqIT09ZlswXSl7Zi51bnNoaWZ0KGopfXJldHVybiBkW2pdfX1mdW5jdGlvbiBHKGEsYixjLGQpe2lmKGYuaXNBcnJheShiKSl7Zi5lYWNoKGIsZnVuY3Rpb24oYixlKXtpZihjfHxqLnRlc3QoYSkpe2QoYSxlKX1lbHNle0coYStcIltcIisodHlwZW9mIGU9PT1cIm9iamVjdFwifHxmLmlzQXJyYXkoZSk/YjpcIlwiKStcIl1cIixlLGMsZCl9fSl9ZWxzZSBpZighYyYmYiE9bnVsbCYmdHlwZW9mIGI9PT1cIm9iamVjdFwiKXtmb3IodmFyIGUgaW4gYil7RyhhK1wiW1wiK2UrXCJdXCIsYltlXSxjLGQpfX1lbHNle2QoYSxiKX19ZnVuY3Rpb24gRihhLGMpe3ZhciBkLGUsZz1mLmFqYXhTZXR0aW5ncy5mbGF0T3B0aW9uc3x8e307Zm9yKGQgaW4gYyl7aWYoY1tkXSE9PWIpeyhnW2RdP2E6ZXx8KGU9e30pKVtkXT1jW2RdfX1pZihlKXtmLmV4dGVuZCh0cnVlLGEsZSl9fWZ1bmN0aW9uIEUoYSxjLGQsZSxmLGcpe2Y9Znx8Yy5kYXRhVHlwZXNbMF07Zz1nfHx7fTtnW2ZdPXRydWU7dmFyIGg9YVtmXSxpPTAsaj1oP2gubGVuZ3RoOjAsaz1hPT09eSxsO2Zvcig7aTxqJiYoa3x8IWwpO2krKyl7bD1oW2ldKGMsZCxlKTtpZih0eXBlb2YgbD09PVwic3RyaW5nXCIpe2lmKCFrfHxnW2xdKXtsPWJ9ZWxzZXtjLmRhdGFUeXBlcy51bnNoaWZ0KGwpO2w9RShhLGMsZCxlLGwsZyl9fX1pZigoa3x8IWwpJiYhZ1tcIipcIl0pe2w9RShhLGMsZCxlLFwiKlwiLGcpfXJldHVybiBsfWZ1bmN0aW9uIEQoYSl7cmV0dXJuIGZ1bmN0aW9uKGIsYyl7aWYodHlwZW9mIGIhPT1cInN0cmluZ1wiKXtjPWI7Yj1cIipcIn1pZihmLmlzRnVuY3Rpb24oYykpe3ZhciBkPWIudG9Mb3dlckNhc2UoKS5zcGxpdCh1KSxlPTAsZz1kLmxlbmd0aCxoLGksajtmb3IoO2U8ZztlKyspe2g9ZFtlXTtqPS9eXFwrLy50ZXN0KGgpO2lmKGope2g9aC5zdWJzdHIoMSl8fFwiKlwifWk9YVtoXT1hW2hdfHxbXTtpW2o/XCJ1bnNoaWZ0XCI6XCJwdXNoXCJdKGMpfX19fXZhciBjPWEuZG9jdW1lbnQsZD1hLm5hdmlnYXRvcixlPWEubG9jYXRpb247dmFyIGY9ZnVuY3Rpb24oKXtmdW5jdGlvbiBKKCl7aWYoZS5pc1JlYWR5KXtyZXR1cm59dHJ5e2MuZG9jdW1lbnRFbGVtZW50LmRvU2Nyb2xsKFwibGVmdFwiKX1jYXRjaChhKXtzZXRUaW1lb3V0KEosMSk7cmV0dXJufWUucmVhZHkoKX12YXIgZT1mdW5jdGlvbihhLGIpe3JldHVybiBuZXcgZS5mbi5pbml0KGEsYixoKX0sZj1hLmpRdWVyeSxnPWEuJCxoLGk9L14oPzpbXjxdKig8W1xcd1xcV10rPilbXj5dKiR8IyhbXFx3XFwtXSopJCkvLGo9L1xcUy8saz0vXlxccysvLGw9L1xccyskLyxtPS9cXGQvLG49L148KFxcdyspXFxzKlxcLz8+KD86PFxcL1xcMT4pPyQvLG89L15bXFxdLDp7fVxcc10qJC8scD0vXFxcXCg/OltcIlxcXFxcXC9iZm5ydF18dVswLTlhLWZBLUZdezR9KS9nLHE9L1wiW15cIlxcXFxcXG5cXHJdKlwifHRydWV8ZmFsc2V8bnVsbHwtP1xcZCsoPzpcXC5cXGQqKT8oPzpbZUVdWytcXC1dP1xcZCspPy9nLHI9Lyg/Ol58OnwsKSg/OlxccypcXFspKy9nLHM9Lyh3ZWJraXQpWyBcXC9dKFtcXHcuXSspLyx0PS8ob3BlcmEpKD86Lip2ZXJzaW9uKT9bIFxcL10oW1xcdy5dKykvLHU9Lyhtc2llKSAoW1xcdy5dKykvLHY9Lyhtb3ppbGxhKSg/Oi4qPyBydjooW1xcdy5dKykpPy8sdz0vLShbYS16XSkvaWcseD1mdW5jdGlvbihhLGIpe3JldHVybiBiLnRvVXBwZXJDYXNlKCl9LHk9ZC51c2VyQWdlbnQseixBLEIsQz1PYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLEQ9T2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSxFPUFycmF5LnByb3RvdHlwZS5wdXNoLEY9QXJyYXkucHJvdG90eXBlLnNsaWNlLEc9U3RyaW5nLnByb3RvdHlwZS50cmltLEg9QXJyYXkucHJvdG90eXBlLmluZGV4T2YsST17fTtlLmZuPWUucHJvdG90eXBlPXtjb25zdHJ1Y3RvcjplLGluaXQ6ZnVuY3Rpb24oYSxkLGYpe3ZhciBnLGgsaixrO2lmKCFhKXtyZXR1cm4gdGhpc31pZihhLm5vZGVUeXBlKXt0aGlzLmNvbnRleHQ9dGhpc1swXT1hO3RoaXMubGVuZ3RoPTE7cmV0dXJuIHRoaXN9aWYoYT09PVwiYm9keVwiJiYhZCYmYy5ib2R5KXt0aGlzLmNvbnRleHQ9Yzt0aGlzWzBdPWMuYm9keTt0aGlzLnNlbGVjdG9yPWE7dGhpcy5sZW5ndGg9MTtyZXR1cm4gdGhpc31pZih0eXBlb2YgYT09PVwic3RyaW5nXCIpe2lmKGEuY2hhckF0KDApPT09XCI8XCImJmEuY2hhckF0KGEubGVuZ3RoLTEpPT09XCI+XCImJmEubGVuZ3RoPj0zKXtnPVtudWxsLGEsbnVsbF19ZWxzZXtnPWkuZXhlYyhhKX1pZihnJiYoZ1sxXXx8IWQpKXtpZihnWzFdKXtkPWQgaW5zdGFuY2VvZiBlP2RbMF06ZDtrPWQ/ZC5vd25lckRvY3VtZW50fHxkOmM7aj1uLmV4ZWMoYSk7aWYoail7aWYoZS5pc1BsYWluT2JqZWN0KGQpKXthPVtjLmNyZWF0ZUVsZW1lbnQoalsxXSldO2UuZm4uYXR0ci5jYWxsKGEsZCx0cnVlKX1lbHNle2E9W2suY3JlYXRlRWxlbWVudChqWzFdKV19fWVsc2V7aj1lLmJ1aWxkRnJhZ21lbnQoW2dbMV1dLFtrXSk7YT0oai5jYWNoZWFibGU/ZS5jbG9uZShqLmZyYWdtZW50KTpqLmZyYWdtZW50KS5jaGlsZE5vZGVzfXJldHVybiBlLm1lcmdlKHRoaXMsYSl9ZWxzZXtoPWMuZ2V0RWxlbWVudEJ5SWQoZ1syXSk7aWYoaCYmaC5wYXJlbnROb2RlKXtpZihoLmlkIT09Z1syXSl7cmV0dXJuIGYuZmluZChhKX10aGlzLmxlbmd0aD0xO3RoaXNbMF09aH10aGlzLmNvbnRleHQ9Yzt0aGlzLnNlbGVjdG9yPWE7cmV0dXJuIHRoaXN9fWVsc2UgaWYoIWR8fGQuanF1ZXJ5KXtyZXR1cm4oZHx8ZikuZmluZChhKX1lbHNle3JldHVybiB0aGlzLmNvbnN0cnVjdG9yKGQpLmZpbmQoYSl9fWVsc2UgaWYoZS5pc0Z1bmN0aW9uKGEpKXtyZXR1cm4gZi5yZWFkeShhKX1pZihhLnNlbGVjdG9yIT09Yil7dGhpcy5zZWxlY3Rvcj1hLnNlbGVjdG9yO3RoaXMuY29udGV4dD1hLmNvbnRleHR9cmV0dXJuIGUubWFrZUFycmF5KGEsdGhpcyl9LHNlbGVjdG9yOlwiXCIsanF1ZXJ5OlwiMS42LjNwcmVcIixsZW5ndGg6MCxzaXplOmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubGVuZ3RofSx0b0FycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIEYuY2FsbCh0aGlzLDApfSxnZXQ6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/dGhpcy50b0FycmF5KCk6YTwwP3RoaXNbdGhpcy5sZW5ndGgrYV06dGhpc1thXX0scHVzaFN0YWNrOmZ1bmN0aW9uKGEsYixjKXt2YXIgZD10aGlzLmNvbnN0cnVjdG9yKCk7aWYoZS5pc0FycmF5KGEpKXtFLmFwcGx5KGQsYSl9ZWxzZXtlLm1lcmdlKGQsYSl9ZC5wcmV2T2JqZWN0PXRoaXM7ZC5jb250ZXh0PXRoaXMuY29udGV4dDtpZihiPT09XCJmaW5kXCIpe2Quc2VsZWN0b3I9dGhpcy5zZWxlY3RvcisodGhpcy5zZWxlY3Rvcj9cIiBcIjpcIlwiKStjfWVsc2UgaWYoYil7ZC5zZWxlY3Rvcj10aGlzLnNlbGVjdG9yK1wiLlwiK2IrXCIoXCIrYytcIilcIn1yZXR1cm4gZH0sZWFjaDpmdW5jdGlvbihhLGIpe3JldHVybiBlLmVhY2godGhpcyxhLGIpfSxyZWFkeTpmdW5jdGlvbihhKXtlLmJpbmRSZWFkeSgpO0EuZG9uZShhKTtyZXR1cm4gdGhpc30sZXE6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PT0tMT90aGlzLnNsaWNlKGEpOnRoaXMuc2xpY2UoYSwrYSsxKX0sZmlyc3Q6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5lcSgwKX0sbGFzdDpmdW5jdGlvbigpe3JldHVybiB0aGlzLmVxKC0xKX0sc2xpY2U6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5wdXNoU3RhY2soRi5hcHBseSh0aGlzLGFyZ3VtZW50cyksXCJzbGljZVwiLEYuY2FsbChhcmd1bWVudHMpLmpvaW4oXCIsXCIpKX0sbWFwOmZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLnB1c2hTdGFjayhlLm1hcCh0aGlzLGZ1bmN0aW9uKGIsYyl7cmV0dXJuIGEuY2FsbChiLGMsYil9KSl9LGVuZDpmdW5jdGlvbigpe3JldHVybiB0aGlzLnByZXZPYmplY3R8fHRoaXMuY29uc3RydWN0b3IobnVsbCl9LHB1c2g6RSxzb3J0OltdLnNvcnQsc3BsaWNlOltdLnNwbGljZX07ZS5mbi5pbml0LnByb3RvdHlwZT1lLmZuO2UuZXh0ZW5kPWUuZm4uZXh0ZW5kPWZ1bmN0aW9uKCl7dmFyIGEsYyxkLGYsZyxoLGk9YXJndW1lbnRzWzBdfHx7fSxqPTEsaz1hcmd1bWVudHMubGVuZ3RoLGw9ZmFsc2U7aWYodHlwZW9mIGk9PT1cImJvb2xlYW5cIil7bD1pO2k9YXJndW1lbnRzWzFdfHx7fTtqPTJ9aWYodHlwZW9mIGkhPT1cIm9iamVjdFwiJiYhZS5pc0Z1bmN0aW9uKGkpKXtpPXt9fWlmKGs9PT1qKXtpPXRoaXM7LS1qfWZvcig7ajxrO2orKyl7aWYoKGE9YXJndW1lbnRzW2pdKSE9bnVsbCl7Zm9yKGMgaW4gYSl7ZD1pW2NdO2Y9YVtjXTtpZihpPT09Zil7Y29udGludWV9aWYobCYmZiYmKGUuaXNQbGFpbk9iamVjdChmKXx8KGc9ZS5pc0FycmF5KGYpKSkpe2lmKGcpe2c9ZmFsc2U7aD1kJiZlLmlzQXJyYXkoZCk/ZDpbXX1lbHNle2g9ZCYmZS5pc1BsYWluT2JqZWN0KGQpP2Q6e319aVtjXT1lLmV4dGVuZChsLGgsZil9ZWxzZSBpZihmIT09Yil7aVtjXT1mfX19fXJldHVybiBpfTtlLmV4dGVuZCh7bm9Db25mbGljdDpmdW5jdGlvbihiKXtpZihhLiQ9PT1lKXthLiQ9Z31pZihiJiZhLmpRdWVyeT09PWUpe2EualF1ZXJ5PWZ9cmV0dXJuIGV9LGlzUmVhZHk6ZmFsc2UscmVhZHlXYWl0OjEsaG9sZFJlYWR5OmZ1bmN0aW9uKGEpe2lmKGEpe2UucmVhZHlXYWl0Kyt9ZWxzZXtlLnJlYWR5KHRydWUpfX0scmVhZHk6ZnVuY3Rpb24oYSl7aWYoYT09PXRydWUmJiEtLWUucmVhZHlXYWl0fHxhIT09dHJ1ZSYmIWUuaXNSZWFkeSl7aWYoIWMuYm9keSl7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1lLmlzUmVhZHk9dHJ1ZTtpZihhIT09dHJ1ZSYmLS1lLnJlYWR5V2FpdD4wKXtyZXR1cm59QS5yZXNvbHZlV2l0aChjLFtlXSk7aWYoZS5mbi50cmlnZ2VyKXtlKGMpLnRyaWdnZXIoXCJyZWFkeVwiKS51bmJpbmQoXCJyZWFkeVwiKX19fSxiaW5kUmVhZHk6ZnVuY3Rpb24oKXtpZihBKXtyZXR1cm59QT1lLl9EZWZlcnJlZCgpO2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7cmV0dXJuIHNldFRpbWVvdXQoZS5yZWFkeSwxKX1pZihjLmFkZEV2ZW50TGlzdGVuZXIpe2MuYWRkRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTthLmFkZEV2ZW50TGlzdGVuZXIoXCJsb2FkXCIsZS5yZWFkeSxmYWxzZSl9ZWxzZSBpZihjLmF0dGFjaEV2ZW50KXtjLmF0dGFjaEV2ZW50KFwib25yZWFkeXN0YXRlY2hhbmdlXCIsQik7YS5hdHRhY2hFdmVudChcIm9ubG9hZFwiLGUucmVhZHkpO3ZhciBiPWZhbHNlO3RyeXtiPWEuZnJhbWVFbGVtZW50PT1udWxsfWNhdGNoKGQpe31pZihjLmRvY3VtZW50RWxlbWVudC5kb1Njcm9sbCYmYil7SigpfX19LGlzRnVuY3Rpb246ZnVuY3Rpb24oYSl7cmV0dXJuIGUudHlwZShhKT09PVwiZnVuY3Rpb25cIn0saXNBcnJheTpBcnJheS5pc0FycmF5fHxmdW5jdGlvbihhKXtyZXR1cm4gZS50eXBlKGEpPT09XCJhcnJheVwifSxpc1dpbmRvdzpmdW5jdGlvbihhKXtyZXR1cm4gYSYmdHlwZW9mIGE9PT1cIm9iamVjdFwiJiZcInNldEludGVydmFsXCJpbiBhfSxpc05hTjpmdW5jdGlvbihhKXtyZXR1cm4gYT09bnVsbHx8IW0udGVzdChhKXx8aXNOYU4oYSl9LHR5cGU6ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/U3RyaW5nKGEpOklbQy5jYWxsKGEpXXx8XCJvYmplY3RcIn0saXNQbGFpbk9iamVjdDpmdW5jdGlvbihhKXtpZighYXx8ZS50eXBlKGEpIT09XCJvYmplY3RcInx8YS5ub2RlVHlwZXx8ZS5pc1dpbmRvdyhhKSl7cmV0dXJuIGZhbHNlfWlmKGEuY29uc3RydWN0b3ImJiFELmNhbGwoYSxcImNvbnN0cnVjdG9yXCIpJiYhRC5jYWxsKGEuY29uc3RydWN0b3IucHJvdG90eXBlLFwiaXNQcm90b3R5cGVPZlwiKSl7cmV0dXJuIGZhbHNlfXZhciBjO2ZvcihjIGluIGEpe31yZXR1cm4gYz09PWJ8fEQuY2FsbChhLGMpfSxpc0VtcHR5T2JqZWN0OmZ1bmN0aW9uKGEpe2Zvcih2YXIgYiBpbiBhKXtyZXR1cm4gZmFsc2V9cmV0dXJuIHRydWV9LGVycm9yOmZ1bmN0aW9uKGEpe3Rocm93IGF9LHBhcnNlSlNPTjpmdW5jdGlvbihiKXtpZih0eXBlb2YgYiE9PVwic3RyaW5nXCJ8fCFiKXtyZXR1cm4gbnVsbH1iPWUudHJpbShiKTtpZihhLkpTT04mJmEuSlNPTi5wYXJzZSl7cmV0dXJuIGEuSlNPTi5wYXJzZShiKX1pZihvLnRlc3QoYi5yZXBsYWNlKHAsXCJAXCIpLnJlcGxhY2UocSxcIl1cIikucmVwbGFjZShyLFwiXCIpKSl7cmV0dXJuKG5ldyBGdW5jdGlvbihcInJldHVybiBcIitiKSkoKX1lLmVycm9yKFwiSW52YWxpZCBKU09OOiBcIitiKX0scGFyc2VYTUw6ZnVuY3Rpb24oYyl7dmFyIGQsZjt0cnl7aWYoYS5ET01QYXJzZXIpe2Y9bmV3IERPTVBhcnNlcjtkPWYucGFyc2VGcm9tU3RyaW5nKGMsXCJ0ZXh0L3htbFwiKX1lbHNle2Q9bmV3IEFjdGl2ZVhPYmplY3QoXCJNaWNyb3NvZnQuWE1MRE9NXCIpO2QuYXN5bmM9XCJmYWxzZVwiO2QubG9hZFhNTChjKX19Y2F0Y2goZyl7ZD1ifWlmKCFkfHwhZC5kb2N1bWVudEVsZW1lbnR8fGQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoXCJwYXJzZXJlcnJvclwiKS5sZW5ndGgpe2UuZXJyb3IoXCJJbnZhbGlkIFhNTDogXCIrYyl9cmV0dXJuIGR9LG5vb3A6ZnVuY3Rpb24oKXt9LGdsb2JhbEV2YWw6ZnVuY3Rpb24oYil7aWYoYiYmai50ZXN0KGIpKXsoYS5leGVjU2NyaXB0fHxmdW5jdGlvbihiKXthW1wiZXZhbFwiXS5jYWxsKGEsYil9KShiKX19LGNhbWVsQ2FzZTpmdW5jdGlvbihhKXtyZXR1cm4gYS5yZXBsYWNlKHcseCl9LG5vZGVOYW1lOmZ1bmN0aW9uKGEsYil7cmV0dXJuIGEubm9kZU5hbWUmJmEubm9kZU5hbWUudG9VcHBlckNhc2UoKT09PWIudG9VcHBlckNhc2UoKX0sZWFjaDpmdW5jdGlvbihhLGMsZCl7dmFyIGYsZz0wLGg9YS5sZW5ndGgsaT1oPT09Ynx8ZS5pc0Z1bmN0aW9uKGEpO2lmKGQpe2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuYXBwbHkoYVtmXSxkKT09PWZhbHNlKXticmVha319fWVsc2V7Zm9yKDtnPGg7KXtpZihjLmFwcGx5KGFbZysrXSxkKT09PWZhbHNlKXticmVha319fX1lbHNle2lmKGkpe2ZvcihmIGluIGEpe2lmKGMuY2FsbChhW2ZdLGYsYVtmXSk9PT1mYWxzZSl7YnJlYWt9fX1lbHNle2Zvcig7ZzxoOyl7aWYoYy5jYWxsKGFbZ10sZyxhW2crK10pPT09ZmFsc2Upe2JyZWFrfX19fXJldHVybiBhfSx0cmltOkc/ZnVuY3Rpb24oYSl7cmV0dXJuIGE9PW51bGw/XCJcIjpHLmNhbGwoYSl9OmZ1bmN0aW9uKGEpe3JldHVybiBhPT1udWxsP1wiXCI6YS50b1N0cmluZygpLnJlcGxhY2UoayxcIlwiKS5yZXBsYWNlKGwsXCJcIil9LG1ha2VBcnJheTpmdW5jdGlvbihhLGIpe3ZhciBjPWJ8fFtdO2lmKGEhPW51bGwpe3ZhciBkPWUudHlwZShhKTtpZihhLmxlbmd0aD09bnVsbHx8ZD09PVwic3RyaW5nXCJ8fGQ9PT1cImZ1bmN0aW9uXCJ8fGQ9PT1cInJlZ2V4cFwifHxlLmlzV2luZG93KGEpKXtFLmNhbGwoYyxhKX1lbHNle2UubWVyZ2UoYyxhKX19cmV0dXJuIGN9LGluQXJyYXk6ZnVuY3Rpb24oYSxiKXtpZihIKXtyZXR1cm4gSC5jYWxsKGIsYSl9Zm9yKHZhciBjPTAsZD1iLmxlbmd0aDtjPGQ7YysrKXtpZihiW2NdPT09YSl7cmV0dXJuIGN9fXJldHVybi0xfSxtZXJnZTpmdW5jdGlvbihhLGMpe3ZhciBkPWEubGVuZ3RoLGU9MDtpZih0eXBlb2YgYy5sZW5ndGg9PT1cIm51bWJlclwiKXtmb3IodmFyIGY9Yy5sZW5ndGg7ZTxmO2UrKyl7YVtkKytdPWNbZV19fWVsc2V7d2hpbGUoY1tlXSE9PWIpe2FbZCsrXT1jW2UrK119fWEubGVuZ3RoPWQ7cmV0dXJuIGF9LGdyZXA6ZnVuY3Rpb24oYSxiLGMpe3ZhciBkPVtdLGU7Yz0hIWM7Zm9yKHZhciBmPTAsZz1hLmxlbmd0aDtmPGc7ZisrKXtlPSEhYihhW2ZdLGYpO2lmKGMhPT1lKXtkLnB1c2goYVtmXSl9fXJldHVybiBkfSxtYXA6ZnVuY3Rpb24oYSxjLGQpe3ZhciBmLGcsaD1bXSxpPTAsaj1hLmxlbmd0aCxrPWEgaW5zdGFuY2VvZiBlfHxqIT09YiYmdHlwZW9mIGo9PT1cIm51bWJlclwiJiYoaj4wJiZhWzBdJiZhW2otMV18fGo9PT0wfHxlLmlzQXJyYXkoYSkpO2lmKGspe2Zvcig7aTxqO2krKyl7Zj1jKGFbaV0saSxkKTtpZihmIT1udWxsKXtoW2gubGVuZ3RoXT1mfX19ZWxzZXtmb3IoZyBpbiBhKXtmPWMoYVtnXSxnLGQpO2lmKGYhPW51bGwpe2hbaC5sZW5ndGhdPWZ9fX1yZXR1cm4gaC5jb25jYXQuYXBwbHkoW10saCl9LGd1aWQ6MSxwcm94eTpmdW5jdGlvbihhLGMpe2lmKHR5cGVvZiBjPT09XCJzdHJpbmdcIil7dmFyIGQ9YVtjXTtjPWE7YT1kfWlmKCFlLmlzRnVuY3Rpb24oYSkpe3JldHVybiBifXZhciBmPUYuY2FsbChhcmd1bWVudHMsMiksZz1mdW5jdGlvbigpe3JldHVybiBhLmFwcGx5KGMsZi5jb25jYXQoRi5jYWxsKGFyZ3VtZW50cykpKX07Zy5ndWlkPWEuZ3VpZD1hLmd1aWR8fGcuZ3VpZHx8ZS5ndWlkKys7cmV0dXJuIGd9LGFjY2VzczpmdW5jdGlvbihhLGMsZCxmLGcsaCl7dmFyIGk9YS5sZW5ndGg7aWYodHlwZW9mIGM9PT1cIm9iamVjdFwiKXtmb3IodmFyIGogaW4gYyl7ZS5hY2Nlc3MoYSxqLGNbal0sZixnLGQpfXJldHVybiBhfWlmKGQhPT1iKXtmPSFoJiZmJiZlLmlzRnVuY3Rpb24oZCk7Zm9yKHZhciBrPTA7azxpO2srKyl7ZyhhW2tdLGMsZj9kLmNhbGwoYVtrXSxrLGcoYVtrXSxjKSk6ZCxoKX1yZXR1cm4gYX1yZXR1cm4gaT9nKGFbMF0sYyk6Yn0sbm93OmZ1bmN0aW9uKCl7cmV0dXJuKG5ldyBEYXRlKS5nZXRUaW1lKCl9LHVhTWF0Y2g6ZnVuY3Rpb24oYSl7YT1hLnRvTG93ZXJDYXNlKCk7dmFyIGI9cy5leGVjKGEpfHx0LmV4ZWMoYSl8fHUuZXhlYyhhKXx8YS5pbmRleE9mKFwiY29tcGF0aWJsZVwiKTwwJiZ2LmV4ZWMoYSl8fFtdO3JldHVybnticm93c2VyOmJbMV18fFwiXCIsdmVyc2lvbjpiWzJdfHxcIjBcIn19LHN1YjpmdW5jdGlvbigpe2Z1bmN0aW9uIGEoYixjKXtyZXR1cm4gbmV3IGEuZm4uaW5pdChiLGMpfWUuZXh0ZW5kKHRydWUsYSx0aGlzKTthLnN1cGVyY2xhc3M9dGhpczthLmZuPWEucHJvdG90eXBlPXRoaXMoKTthLmZuLmNvbnN0cnVjdG9yPWE7YS5zdWI9dGhpcy5zdWI7YS5mbi5pbml0PWZ1bmN0aW9uIGQoYyxkKXtpZihkJiZkIGluc3RhbmNlb2YgZSYmIShkIGluc3RhbmNlb2YgYSkpe2Q9YShkKX1yZXR1cm4gZS5mbi5pbml0LmNhbGwodGhpcyxjLGQsYil9O2EuZm4uaW5pdC5wcm90b3R5cGU9YS5mbjt2YXIgYj1hKGMpO3JldHVybiBhfSxicm93c2VyOnt9fSk7ZS5lYWNoKFwiQm9vbGVhbiBOdW1iZXIgU3RyaW5nIEZ1bmN0aW9uIEFycmF5IERhdGUgUmVnRXhwIE9iamVjdFwiLnNwbGl0KFwiIFwiKSxmdW5jdGlvbihhLGIpe0lbXCJbb2JqZWN0IFwiK2IrXCJdXCJdPWIudG9Mb3dlckNhc2UoKX0pO3o9ZS51YU1hdGNoKHkpO2lmKHouYnJvd3Nlcil7ZS5icm93c2VyW3ouYnJvd3Nlcl09dHJ1ZTtlLmJyb3dzZXIudmVyc2lvbj16LnZlcnNpb259aWYoZS5icm93c2VyLndlYmtpdCl7ZS5icm93c2VyLnNhZmFyaT10cnVlfWlmKGoudGVzdChcIsKgXCIpKXtrPS9eW1xcc1xceEEwXSsvO2w9L1tcXHNcXHhBMF0rJC99aD1lKGMpO2lmKGMuYWRkRXZlbnRMaXN0ZW5lcil7Qj1mdW5jdGlvbigpe2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIkRPTUNvbnRlbnRMb2FkZWRcIixCLGZhbHNlKTtlLnJlYWR5KCl9fWVsc2UgaWYoYy5hdHRhY2hFdmVudCl7Qj1mdW5jdGlvbigpe2lmKGMucmVhZHlTdGF0ZT09PVwiY29tcGxldGVcIil7Yy5kZXRhY2hFdmVudChcIm9ucmVhZHlzdGF0ZWNoYW5nZVwiLEIpO2UucmVhZHkoKX19fXJldHVybiBlfSgpO3ZhciBnPVwiZG9uZSBmYWlsIGlzUmVzb2x2ZWQgaXNSZWplY3RlZCBwcm9taXNlIHRoZW4gYWx3YXlzIHBpcGVcIi5zcGxpdChcIiBcIiksaD1bXS5zbGljZTtmLmV4dGVuZCh7X0RlZmVycmVkOmZ1bmN0aW9uKCl7dmFyIGE9W10sYixjLGQsZT17ZG9uZTpmdW5jdGlvbigpe2lmKCFkKXt2YXIgYz1hcmd1bWVudHMsZyxoLGksaixrO2lmKGIpe2s9YjtiPTB9Zm9yKGc9MCxoPWMubGVuZ3RoO2c8aDtnKyspe2k9Y1tnXTtqPWYudHlwZShpKTtpZihqPT09XCJhcnJheVwiKXtlLmRvbmUuYXBwbHkoZSxpKX1lbHNlIGlmKGo9PT1cImZ1bmN0aW9uXCIpe2EucHVzaChpKX19aWYoayl7ZS5yZXNvbHZlV2l0aChrWzBdLGtbMV0pfX1yZXR1cm4gdGhpc30scmVzb2x2ZVdpdGg6ZnVuY3Rpb24oZSxmKXtpZighZCYmIWImJiFjKXtmPWZ8fFtdO2M9MTt0cnl7d2hpbGUoYVswXSl7YS5zaGlmdCgpLmFwcGx5KGUsZil9fWZpbmFsbHl7Yj1bZSxmXTtjPTB9fXJldHVybiB0aGlzfSxyZXNvbHZlOmZ1bmN0aW9uKCl7ZS5yZXNvbHZlV2l0aCh0aGlzLGFyZ3VtZW50cyk7cmV0dXJuIHRoaXN9LGlzUmVzb2x2ZWQ6ZnVuY3Rpb24oKXtyZXR1cm4hIShjfHxiKX0sY2FuY2VsOmZ1bmN0aW9uKCl7ZD0xO2E9W107cmV0dXJuIHRoaXN9fTtyZXR1cm4gZX0sRGVmZXJyZWQ6ZnVuY3Rpb24oYSl7dmFyIGI9Zi5fRGVmZXJyZWQoKSxjPWYuX0RlZmVycmVkKCksZDtmLmV4dGVuZChiLHt0aGVuOmZ1bmN0aW9uKGEsYyl7Yi5kb25lKGEpLmZhaWwoYyk7cmV0dXJuIHRoaXN9LGFsd2F5czpmdW5jdGlvbigpe3JldHVybiBiLmRvbmUuYXBwbHkoYixhcmd1bWVudHMpLmZhaWwuYXBwbHkodGhpcyxhcmd1bWVudHMpfSxmYWlsOmMuZG9uZSxyZWplY3RXaXRoOmMucmVzb2x2ZVdpdGgscmVqZWN0OmMucmVzb2x2ZSxpc1JlamVjdGVkOmMuaXNSZXNvbHZlZCxwaXBlOmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuRGVmZXJyZWQoZnVuY3Rpb24oZCl7Zi5lYWNoKHtkb25lOlthLFwicmVzb2x2ZVwiXSxmYWlsOltjLFwicmVqZWN0XCJdfSxmdW5jdGlvbihhLGMpe3ZhciBlPWNbMF0sZz1jWzFdLGg7aWYoZi5pc0Z1bmN0aW9uKGUpKXtiW2FdKGZ1bmN0aW9uKCl7aD1lLmFwcGx5KHRoaXMsYXJndW1lbnRzKTtpZihoJiZmLmlzRnVuY3Rpb24oaC5wcm9taXNlKSl7aC5wcm9taXNlKCkudGhlbihkLnJlc29sdmUsZC5yZWplY3QpfWVsc2V7ZFtnK1wiV2l0aFwiXSh0aGlzPT09Yj9kOnRoaXMsW2hdKX19KX1lbHNle2JbYV0oZFtnXSl9fSl9KS5wcm9taXNlKCl9LHByb21pc2U6ZnVuY3Rpb24oYSl7aWYoYT09bnVsbCl7aWYoZCl7cmV0dXJuIGR9ZD1hPXt9fXZhciBjPWcubGVuZ3RoO3doaWxlKGMtLSl7YVtnW2NdXT1iW2dbY11dfXJldHVybiBhfX0pO2IuZG9uZShjLmNhbmNlbCkuZmFpbChiLmNhbmNlbCk7ZGVsZXRlIGIuY2FuY2VsO2lmKGEpe2EuY2FsbChiLGIpfXJldHVybiBifSx3aGVuOmZ1bmN0aW9uKGEpe2Z1bmN0aW9uIGkoYSl7cmV0dXJuIGZ1bmN0aW9uKGMpe2JbYV09YXJndW1lbnRzLmxlbmd0aD4xP2guY2FsbChhcmd1bWVudHMsMCk6YztpZighLS1lKXtnLnJlc29sdmVXaXRoKGcsaC5jYWxsKGIsMCkpfX19dmFyIGI9YXJndW1lbnRzLGM9MCxkPWIubGVuZ3RoLGU9ZCxnPWQ8PTEmJmEmJmYuaXNGdW5jdGlvbihhLnByb21pc2UpP2E6Zi5EZWZlcnJlZCgpO2lmKGQ+MSl7Zm9yKDtjPGQ7YysrKXtpZihiW2NdJiZmLmlzRnVuY3Rpb24oYltjXS5wcm9taXNlKSl7YltjXS5wcm9taXNlKCkudGhlbihpKGMpLGcucmVqZWN0KX1lbHNley0tZX19aWYoIWUpe2cucmVzb2x2ZVdpdGgoZyxiKX19ZWxzZSBpZihnIT09YSl7Zy5yZXNvbHZlV2l0aChnLGQ/W2FdOltdKX1yZXR1cm4gZy5wcm9taXNlKCl9fSk7Zi5zdXBwb3J0PWYuc3VwcG9ydHx8e307dmFyIGk9LyUyMC9nLGo9L1xcW1xcXSQvLGs9L1xccj9cXG4vZyxsPS8jLiokLyxtPS9eKC4qPyk6WyBcXHRdKihbXlxcclxcbl0qKVxccj8kL21nLG49L14oPzpjb2xvcnxkYXRlfGRhdGV0aW1lfGVtYWlsfGhpZGRlbnxtb250aHxudW1iZXJ8cGFzc3dvcmR8cmFuZ2V8c2VhcmNofHRlbHx0ZXh0fHRpbWV8dXJsfHdlZWspJC9pLG89L14oPzphYm91dHxhcHB8YXBwXFwtc3RvcmFnZXwuK1xcLWV4dGVuc2lvbnxmaWxlfHJlc3x3aWRnZXQpOiQvLHA9L14oPzpHRVR8SEVBRCkkLyxxPS9eXFwvXFwvLyxyPS9cXD8vLHM9LzxzY3JpcHRcXGJbXjxdKig/Oig/ITxcXC9zY3JpcHQ+KTxbXjxdKikqPFxcL3NjcmlwdD4vZ2ksdD0vXig/OnNlbGVjdHx0ZXh0YXJlYSkvaSx1PS9cXHMrLyx2PS8oWz8mXSlfPVteJl0qLyx3PS9eKFtcXHdcXCtcXC5cXC1dKzopKD86XFwvXFwvKFteXFwvPyM6XSopKD86OihcXGQrKSk/KT8vLHg9Zi5mbi5sb2FkLHk9e30sej17fSxBLEI7dHJ5e0E9ZS5ocmVmfWNhdGNoKEMpe0E9Yy5jcmVhdGVFbGVtZW50KFwiYVwiKTtBLmhyZWY9XCJcIjtBPUEuaHJlZn1CPXcuZXhlYyhBLnRvTG93ZXJDYXNlKCkpfHxbXTtmLmZuLmV4dGVuZCh7bG9hZDpmdW5jdGlvbihhLGMsZCl7aWYodHlwZW9mIGEhPT1cInN0cmluZ1wiJiZ4KXtyZXR1cm4geC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9ZWxzZSBpZighdGhpcy5sZW5ndGgpe3JldHVybiB0aGlzfXZhciBlPWEuaW5kZXhPZihcIiBcIik7aWYoZT49MCl7dmFyIGc9YS5zbGljZShlLGEubGVuZ3RoKTthPWEuc2xpY2UoMCxlKX12YXIgaD1cIkdFVFwiO2lmKGMpe2lmKGYuaXNGdW5jdGlvbihjKSl7ZD1jO2M9Yn1lbHNlIGlmKHR5cGVvZiBjPT09XCJvYmplY3RcIil7Yz1mLnBhcmFtKGMsZi5hamF4U2V0dGluZ3MudHJhZGl0aW9uYWwpO2g9XCJQT1NUXCJ9fXZhciBpPXRoaXM7Zi5hamF4KHt1cmw6YSx0eXBlOmgsZGF0YVR5cGU6XCJodG1sXCIsZGF0YTpjLGNvbXBsZXRlOmZ1bmN0aW9uKGEsYixjKXtjPWEucmVzcG9uc2VUZXh0O2lmKGEuaXNSZXNvbHZlZCgpKXthLmRvbmUoZnVuY3Rpb24oYSl7Yz1hfSk7aS5odG1sKGc/ZihcIjxkaXY+XCIpLmFwcGVuZChjLnJlcGxhY2UocyxcIlwiKSkuZmluZChnKTpjKX1pZihkKXtpLmVhY2goZCxbYyxiLGFdKX19fSk7cmV0dXJuIHRoaXN9LHNlcmlhbGl6ZTpmdW5jdGlvbigpe3JldHVybiBmLnBhcmFtKHRoaXMuc2VyaWFsaXplQXJyYXkoKSl9LHNlcmlhbGl6ZUFycmF5OmZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMubWFwKGZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuZWxlbWVudHM/Zi5tYWtlQXJyYXkodGhpcy5lbGVtZW50cyk6dGhpc30pLmZpbHRlcihmdW5jdGlvbigpe3JldHVybiB0aGlzLm5hbWUmJiF0aGlzLmRpc2FibGVkJiYodGhpcy5jaGVja2VkfHx0LnRlc3QodGhpcy5ub2RlTmFtZSl8fG4udGVzdCh0aGlzLnR5cGUpKX0pLm1hcChmdW5jdGlvbihhLGIpe3ZhciBjPWYodGhpcykudmFsKCk7cmV0dXJuIGM9PW51bGw/bnVsbDpmLmlzQXJyYXkoYyk/Zi5tYXAoYyxmdW5jdGlvbihhLGMpe3JldHVybntuYW1lOmIubmFtZSx2YWx1ZTphLnJlcGxhY2UoayxcIlxcclxcblwiKX19KTp7bmFtZTpiLm5hbWUsdmFsdWU6Yy5yZXBsYWNlKGssXCJcXHJcXG5cIil9fSkuZ2V0KCl9fSk7Zi5lYWNoKFwiYWpheFN0YXJ0IGFqYXhTdG9wIGFqYXhDb21wbGV0ZSBhamF4RXJyb3IgYWpheFN1Y2Nlc3MgYWpheFNlbmRcIi5zcGxpdChcIiBcIiksZnVuY3Rpb24oYSxiKXtmLmZuW2JdPWZ1bmN0aW9uKGEpe3JldHVybiB0aGlzLmJpbmQoYixhKX19KTtmLmVhY2goW1wiZ2V0XCIsXCJwb3N0XCJdLGZ1bmN0aW9uKGEsYyl7ZltjXT1mdW5jdGlvbihhLGQsZSxnKXtpZihmLmlzRnVuY3Rpb24oZCkpe2c9Z3x8ZTtlPWQ7ZD1ifXJldHVybiBmLmFqYXgoe3R5cGU6Yyx1cmw6YSxkYXRhOmQsc3VjY2VzczplLGRhdGFUeXBlOmd9KX19KTtmLmV4dGVuZCh7Z2V0U2NyaXB0OmZ1bmN0aW9uKGEsYyl7cmV0dXJuIGYuZ2V0KGEsYixjLFwic2NyaXB0XCIpfSxnZXRKU09OOmZ1bmN0aW9uKGEsYixjKXtyZXR1cm4gZi5nZXQoYSxiLGMsXCJqc29uXCIpfSxhamF4U2V0dXA6ZnVuY3Rpb24oYSxiKXtpZihiKXtGKGEsZi5hamF4U2V0dGluZ3MpfWVsc2V7Yj1hO2E9Zi5hamF4U2V0dGluZ3N9RihhLGIpO3JldHVybiBhfSxhamF4U2V0dGluZ3M6e3VybDpBLGlzTG9jYWw6by50ZXN0KEJbMV0pLGdsb2JhbDp0cnVlLHR5cGU6XCJHRVRcIixjb250ZW50VHlwZTpcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLHByb2Nlc3NEYXRhOnRydWUsYXN5bmM6dHJ1ZSxhY2NlcHRzOnt4bWw6XCJhcHBsaWNhdGlvbi94bWwsIHRleHQveG1sXCIsaHRtbDpcInRleHQvaHRtbFwiLHRleHQ6XCJ0ZXh0L3BsYWluXCIsanNvbjpcImFwcGxpY2F0aW9uL2pzb24sIHRleHQvamF2YXNjcmlwdFwiLFwiKlwiOlwiKi8qXCJ9LGNvbnRlbnRzOnt4bWw6L3htbC8saHRtbDovaHRtbC8sanNvbjovanNvbi99LHJlc3BvbnNlRmllbGRzOnt4bWw6XCJyZXNwb25zZVhNTFwiLHRleHQ6XCJyZXNwb25zZVRleHRcIn0sY29udmVydGVyczp7XCIqIHRleHRcIjphLlN0cmluZyxcInRleHQgaHRtbFwiOnRydWUsXCJ0ZXh0IGpzb25cIjpmLnBhcnNlSlNPTixcInRleHQgeG1sXCI6Zi5wYXJzZVhNTH0sZmxhdE9wdGlvbnM6e2NvbnRleHQ6dHJ1ZSx1cmw6dHJ1ZX19LGFqYXhQcmVmaWx0ZXI6RCh5KSxhamF4VHJhbnNwb3J0OkQoeiksYWpheDpmdW5jdGlvbihhLGMpe2Z1bmN0aW9uIEsoYSxjLGwsbSl7aWYoRD09PTIpe3JldHVybn1EPTI7aWYoQSl7Y2xlYXJUaW1lb3V0KEEpfXg9YjtzPW18fFwiXCI7Si5yZWFkeVN0YXRlPWE+MD80OjA7dmFyIG4sbyxwLHE9YyxyPWw/SChkLEosbCk6Yix0LHU7aWYoYT49MjAwJiZhPDMwMHx8YT09PTMwNCl7aWYoZC5pZk1vZGlmaWVkKXtpZih0PUouZ2V0UmVzcG9uc2VIZWFkZXIoXCJMYXN0LU1vZGlmaWVkXCIpKXtmLmxhc3RNb2RpZmllZFtrXT10fWlmKHU9Si5nZXRSZXNwb25zZUhlYWRlcihcIkV0YWdcIikpe2YuZXRhZ1trXT11fX1pZihhPT09MzA0KXtxPVwibm90bW9kaWZpZWRcIjtuPXRydWV9ZWxzZXt0cnl7bz1JKGQscik7cT1cInN1Y2Nlc3NcIjtuPXRydWV9Y2F0Y2godil7cT1cInBhcnNlcmVycm9yXCI7cD12fX19ZWxzZXtwPXE7aWYoIXF8fGEpe3E9XCJlcnJvclwiO2lmKGE8MCl7YT0wfX19Si5zdGF0dXM9YTtKLnN0YXR1c1RleHQ9XCJcIisoY3x8cSk7aWYobil7aC5yZXNvbHZlV2l0aChlLFtvLHEsSl0pfWVsc2V7aC5yZWplY3RXaXRoKGUsW0oscSxwXSl9Si5zdGF0dXNDb2RlKGopO2o9YjtpZihGKXtnLnRyaWdnZXIoXCJhamF4XCIrKG4/XCJTdWNjZXNzXCI6XCJFcnJvclwiKSxbSixkLG4/bzpwXSl9aS5yZXNvbHZlV2l0aChlLFtKLHFdKTtpZihGKXtnLnRyaWdnZXIoXCJhamF4Q29tcGxldGVcIixbSixkXSk7aWYoIS0tZi5hY3RpdmUpe2YuZXZlbnQudHJpZ2dlcihcImFqYXhTdG9wXCIpfX19aWYodHlwZW9mIGE9PT1cIm9iamVjdFwiKXtjPWE7YT1ifWM9Y3x8e307dmFyIGQ9Zi5hamF4U2V0dXAoe30sYyksZT1kLmNvbnRleHR8fGQsZz1lIT09ZCYmKGUubm9kZVR5cGV8fGUgaW5zdGFuY2VvZiBmKT9mKGUpOmYuZXZlbnQsaD1mLkRlZmVycmVkKCksaT1mLl9EZWZlcnJlZCgpLGo9ZC5zdGF0dXNDb2RlfHx7fSxrLG49e30sbz17fSxzLHQseCxBLEMsRD0wLEYsRyxKPXtyZWFkeVN0YXRlOjAsc2V0UmVxdWVzdEhlYWRlcjpmdW5jdGlvbihhLGIpe2lmKCFEKXt2YXIgYz1hLnRvTG93ZXJDYXNlKCk7YT1vW2NdPW9bY118fGE7blthXT1ifXJldHVybiB0aGlzfSxnZXRBbGxSZXNwb25zZUhlYWRlcnM6ZnVuY3Rpb24oKXtyZXR1cm4gRD09PTI/czpudWxsfSxnZXRSZXNwb25zZUhlYWRlcjpmdW5jdGlvbihhKXt2YXIgYztpZihEPT09Mil7aWYoIXQpe3Q9e307d2hpbGUoYz1tLmV4ZWMocykpe3RbY1sxXS50b0xvd2VyQ2FzZSgpXT1jWzJdfX1jPXRbYS50b0xvd2VyQ2FzZSgpXX1yZXR1cm4gYz09PWI/bnVsbDpjfSxvdmVycmlkZU1pbWVUeXBlOmZ1bmN0aW9uKGEpe2lmKCFEKXtkLm1pbWVUeXBlPWF9cmV0dXJuIHRoaXN9LGFib3J0OmZ1bmN0aW9uKGEpe2E9YXx8XCJhYm9ydFwiO2lmKHgpe3guYWJvcnQoYSl9SygwLGEpO3JldHVybiB0aGlzfX07aC5wcm9taXNlKEopO0ouc3VjY2Vzcz1KLmRvbmU7Si5lcnJvcj1KLmZhaWw7Si5jb21wbGV0ZT1pLmRvbmU7Si5zdGF0dXNDb2RlPWZ1bmN0aW9uKGEpe2lmKGEpe3ZhciBiO2lmKEQ8Mil7Zm9yKGIgaW4gYSl7altiXT1baltiXSxhW2JdXX19ZWxzZXtiPWFbSi5zdGF0dXNdO0oudGhlbihiLGIpfX1yZXR1cm4gdGhpc307ZC51cmw9KChhfHxkLnVybCkrXCJcIikucmVwbGFjZShsLFwiXCIpLnJlcGxhY2UocSxCWzFdK1wiLy9cIik7ZC5kYXRhVHlwZXM9Zi50cmltKGQuZGF0YVR5cGV8fFwiKlwiKS50b0xvd2VyQ2FzZSgpLnNwbGl0KHUpO2lmKGQuY3Jvc3NEb21haW49PW51bGwpe0M9dy5leGVjKGQudXJsLnRvTG93ZXJDYXNlKCkpO2QuY3Jvc3NEb21haW49ISEoQyYmKENbMV0hPUJbMV18fENbMl0hPUJbMl18fChDWzNdfHwoQ1sxXT09PVwiaHR0cDpcIj84MDo0NDMpKSE9KEJbM118fChCWzFdPT09XCJodHRwOlwiPzgwOjQ0MykpKSl9aWYoZC5kYXRhJiZkLnByb2Nlc3NEYXRhJiZ0eXBlb2YgZC5kYXRhIT09XCJzdHJpbmdcIil7ZC5kYXRhPWYucGFyYW0oZC5kYXRhLGQudHJhZGl0aW9uYWwpfUUoeSxkLGMsSik7aWYoRD09PTIpe3JldHVybiBmYWxzZX1GPWQuZ2xvYmFsO2QudHlwZT1kLnR5cGUudG9VcHBlckNhc2UoKTtkLmhhc0NvbnRlbnQ9IXAudGVzdChkLnR5cGUpO2lmKEYmJmYuYWN0aXZlKys9PT0wKXtmLmV2ZW50LnRyaWdnZXIoXCJhamF4U3RhcnRcIil9aWYoIWQuaGFzQ29udGVudCl7aWYoZC5kYXRhKXtkLnVybCs9KHIudGVzdChkLnVybCk/XCImXCI6XCI/XCIpK2QuZGF0YTtkZWxldGUgZC5kYXRhfWs9ZC51cmw7aWYoZC5jYWNoZT09PWZhbHNlKXt2YXIgTD1mLm5vdygpLE09ZC51cmwucmVwbGFjZSh2LFwiJDFfPVwiK0wpO2QudXJsPU0rKE09PT1kLnVybD8oci50ZXN0KGQudXJsKT9cIiZcIjpcIj9cIikrXCJfPVwiK0w6XCJcIil9fWlmKGQuZGF0YSYmZC5oYXNDb250ZW50JiZkLmNvbnRlbnRUeXBlIT09ZmFsc2V8fGMuY29udGVudFR5cGUpe0ouc2V0UmVxdWVzdEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLGQuY29udGVudFR5cGUpfWlmKGQuaWZNb2RpZmllZCl7az1rfHxkLnVybDtpZihmLmxhc3RNb2RpZmllZFtrXSl7Si5zZXRSZXF1ZXN0SGVhZGVyKFwiSWYtTW9kaWZpZWQtU2luY2VcIixmLmxhc3RNb2RpZmllZFtrXSl9aWYoZi5ldGFnW2tdKXtKLnNldFJlcXVlc3RIZWFkZXIoXCJJZi1Ob25lLU1hdGNoXCIsZi5ldGFnW2tdKX19Si5zZXRSZXF1ZXN0SGVhZGVyKFwiQWNjZXB0XCIsZC5kYXRhVHlwZXNbMF0mJmQuYWNjZXB0c1tkLmRhdGFUeXBlc1swXV0/ZC5hY2NlcHRzW2QuZGF0YVR5cGVzWzBdXSsoZC5kYXRhVHlwZXNbMF0hPT1cIipcIj9cIiwgKi8qOyBxPTAuMDFcIjpcIlwiKTpkLmFjY2VwdHNbXCIqXCJdKTtmb3IoRyBpbiBkLmhlYWRlcnMpe0ouc2V0UmVxdWVzdEhlYWRlcihHLGQuaGVhZGVyc1tHXSl9aWYoZC5iZWZvcmVTZW5kJiYoZC5iZWZvcmVTZW5kLmNhbGwoZSxKLGQpPT09ZmFsc2V8fEQ9PT0yKSl7Si5hYm9ydCgpO3JldHVybiBmYWxzZX1mb3IoRyBpbntzdWNjZXNzOjEsZXJyb3I6MSxjb21wbGV0ZToxfSl7SltHXShkW0ddKX14PUUoeixkLGMsSik7aWYoIXgpe0soLTEsXCJObyBUcmFuc3BvcnRcIil9ZWxzZXtKLnJlYWR5U3RhdGU9MTtpZihGKXtnLnRyaWdnZXIoXCJhamF4U2VuZFwiLFtKLGRdKX1pZihkLmFzeW5jJiZkLnRpbWVvdXQ+MCl7QT1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7Si5hYm9ydChcInRpbWVvdXRcIil9LGQudGltZW91dCl9dHJ5e0Q9MTt4LnNlbmQobixLKX1jYXRjaChOKXtpZihEPDIpe0soLTEsTil9ZWxzZXtmLmVycm9yKE4pfX19cmV0dXJuIEp9LHBhcmFtOmZ1bmN0aW9uKGEsYyl7dmFyIGQ9W10sZT1mdW5jdGlvbihhLGIpe2I9Zi5pc0Z1bmN0aW9uKGIpP2IoKTpiO2RbZC5sZW5ndGhdPWVuY29kZVVSSUNvbXBvbmVudChhKStcIj1cIitlbmNvZGVVUklDb21wb25lbnQoYil9O2lmKGM9PT1iKXtjPWYuYWpheFNldHRpbmdzLnRyYWRpdGlvbmFsfWlmKGYuaXNBcnJheShhKXx8YS5qcXVlcnkmJiFmLmlzUGxhaW5PYmplY3QoYSkpe2YuZWFjaChhLGZ1bmN0aW9uKCl7ZSh0aGlzLm5hbWUsdGhpcy52YWx1ZSl9KX1lbHNle2Zvcih2YXIgZyBpbiBhKXtHKGcsYVtnXSxjLGUpfX1yZXR1cm4gZC5qb2luKFwiJlwiKS5yZXBsYWNlKGksXCIrXCIpfX0pO2YuZXh0ZW5kKHthY3RpdmU6MCxsYXN0TW9kaWZpZWQ6e30sZXRhZzp7fX0pO3ZhciBKPWEuQWN0aXZlWE9iamVjdD9mdW5jdGlvbigpe2Zvcih2YXIgYSBpbiBMKXtMW2FdKDAsMSl9fTpmYWxzZSxLPTAsTDtmLmFqYXhTZXR0aW5ncy54aHI9YS5BY3RpdmVYT2JqZWN0P2Z1bmN0aW9uKCl7cmV0dXJuIXRoaXMuaXNMb2NhbCYmTSgpfHxOKCl9Ok07KGZ1bmN0aW9uKGEpe2YuZXh0ZW5kKGYuc3VwcG9ydCx7YWpheDohIWEsY29yczohIWEmJlwid2l0aENyZWRlbnRpYWxzXCJpbiBhfSl9KShmLmFqYXhTZXR0aW5ncy54aHIoKSk7aWYoZi5zdXBwb3J0LmFqYXgpe2YuYWpheFRyYW5zcG9ydChmdW5jdGlvbihjKXtpZighYy5jcm9zc0RvbWFpbnx8Zi5zdXBwb3J0LmNvcnMpe3ZhciBkO3JldHVybntzZW5kOmZ1bmN0aW9uKGUsZyl7dmFyIGg9Yy54aHIoKSxpLGo7aWYoYy51c2VybmFtZSl7aC5vcGVuKGMudHlwZSxjLnVybCxjLmFzeW5jLGMudXNlcm5hbWUsYy5wYXNzd29yZCl9ZWxzZXtoLm9wZW4oYy50eXBlLGMudXJsLGMuYXN5bmMpfWlmKGMueGhyRmllbGRzKXtmb3IoaiBpbiBjLnhockZpZWxkcyl7aFtqXT1jLnhockZpZWxkc1tqXX19aWYoYy5taW1lVHlwZSYmaC5vdmVycmlkZU1pbWVUeXBlKXtoLm92ZXJyaWRlTWltZVR5cGUoYy5taW1lVHlwZSl9aWYoIWMuY3Jvc3NEb21haW4mJiFlW1wiWC1SZXF1ZXN0ZWQtV2l0aFwiXSl7ZVtcIlgtUmVxdWVzdGVkLVdpdGhcIl09XCJYTUxIdHRwUmVxdWVzdFwifXRyeXtmb3IoaiBpbiBlKXtoLnNldFJlcXVlc3RIZWFkZXIoaixlW2pdKX19Y2F0Y2goayl7fWguc2VuZChjLmhhc0NvbnRlbnQmJmMuZGF0YXx8bnVsbCk7ZD1mdW5jdGlvbihhLGUpe3ZhciBqLGssbCxtLG47dHJ5e2lmKGQmJihlfHxoLnJlYWR5U3RhdGU9PT00KSl7ZD1iO2lmKGkpe2gub25yZWFkeXN0YXRlY2hhbmdlPWYubm9vcDtpZihKKXtkZWxldGUgTFtpXX19aWYoZSl7aWYoaC5yZWFkeVN0YXRlIT09NCl7aC5hYm9ydCgpfX1lbHNle2o9aC5zdGF0dXM7bD1oLmdldEFsbFJlc3BvbnNlSGVhZGVycygpO209e307bj1oLnJlc3BvbnNlWE1MO2lmKG4mJm4uZG9jdW1lbnRFbGVtZW50KXttLnhtbD1ufW0udGV4dD1oLnJlc3BvbnNlVGV4dDt0cnl7az1oLnN0YXR1c1RleHR9Y2F0Y2gobyl7az1cIlwifWlmKCFqJiZjLmlzTG9jYWwmJiFjLmNyb3NzRG9tYWluKXtqPW0udGV4dD8yMDA6NDA0fWVsc2UgaWYoaj09PTEyMjMpe2o9MjA0fX19fWNhdGNoKHApe2lmKCFlKXtnKC0xLHApfX1pZihtKXtnKGosayxtLGwpfX07aWYoIWMuYXN5bmN8fGgucmVhZHlTdGF0ZT09PTQpe2QoKX1lbHNle2k9KytLO2lmKEope2lmKCFMKXtMPXt9O2YoYSkudW5sb2FkKEopfUxbaV09ZH1oLm9ucmVhZHlzdGF0ZWNoYW5nZT1kfX0sYWJvcnQ6ZnVuY3Rpb24oKXtpZihkKXtkKDAsMSl9fX19fSl9Zi5hamF4U2V0dGluZ3MuZ2xvYmFsPWZhbHNlO2EualF1ZXJ5PWEuJD1mfSkoZ2xvYmFsKX0iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBCQU0gZm9ybWF0OiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgZGVlcENsb25lID0gdXRpbHMuZGVlcENsb25lO1xudmFyIFBhaXJlZEludGVydmFsVHJlZSA9IHJlcXVpcmUoJy4vdXRpbHMvUGFpcmVkSW50ZXJ2YWxUcmVlLmpzJykuUGFpcmVkSW50ZXJ2YWxUcmVlO1xudmFyIFJlbW90ZVRyYWNrID0gcmVxdWlyZSgnLi91dGlscy9SZW1vdGVUcmFjay5qcycpLlJlbW90ZVRyYWNrO1xuXG52YXIgQmFtRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvcjogJzE4OCwxODgsMTg4JyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdmlld0xpbWl0czogJycsICAvLyBhbmFsb2dvdXMgdG8gdmlld0xpbWl0cyBpbiB3aWdnbGVfMCwgYXBwbGljYWJsZSBoZXJlIHRvIHRoZSBjb3ZlcmFnZSBzdWJ0cmFja1xuICAgIHVybDogJycsXG4gICAgaHRtbFVybDogJycsXG4gICAgZHJhd0xpbWl0OiB7c3F1aXNoOiAyMDAwLCBwYWNrOiAyMDAwfSxcbiAgICBjb3ZIZWlnaHQ6IHtkZW5zZTogMjQsIHNxdWlzaDogMzgsIHBhY2s6IDM4fSxcbiAgICAvLyBJZiBhIG51Y2xlb3RpZGUgZGlmZmVycyBmcm9tIHRoZSByZWZlcmVuY2Ugc2VxdWVuY2UgaW4gZ3JlYXRlciB0aGFuIDIwJSBvZiBxdWFsaXR5IHdlaWdodGVkIHJlYWRzLCBcbiAgICAvLyBJR1YgY29sb3JzIHRoZSBiYXIgaW4gcHJvcG9ydGlvbiB0byB0aGUgcmVhZCBjb3VudCBvZiBlYWNoIGJhc2U7IHRoZSBmb2xsb3dpbmcgY2hhbmdlcyB0aGF0IHRocmVzaG9sZCBmb3IgY2hyb21vem9vbVxuICAgIGFsbGVsZUZyZXFUaHJlc2hvbGQ6IDAuMixcbiAgICAvLyBEYXRhIGZvciBob3cgbWFueSBudHMgc2hvdWxkIGJlIGZldGNoZWQgaW4gb25lIGdvP1xuICAgIG9wdGltYWxGZXRjaFdpbmRvdzogMCxcbiAgICAvLyBBYm92ZSB3aGF0IHRpbGUgd2lkdGggKGluIG50cykgZG8gd2UgYXZvaWQgZmV0Y2hpbmcgZGF0YSBhbHRvZ2V0aGVyP1xuICAgIG1heEZldGNoV2luZG93OiAwLFxuICAgIC8vIFRoZSBmb2xsb3dpbmcgY2FuIGJlIFwiZW5zZW1ibF91Y3NjXCIgb3IgXCJ1Y3NjX2Vuc2VtYmxcIiB0byBhdHRlbXB0IGF1dG8tY3Jvc3NtYXBwaW5nIG9mIHJlZmVyZW5jZSBjb250aWcgbmFtZXNcbiAgICAvLyBiZXR3ZWVuIHRoZSB0d28gc2NoZW1lcywgd2hpY2ggSUdWIGRvZXMsIGJ1dCBpcyBhIHBlcmVubmlhbCBpc3N1ZTogaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTAwNjIvXG4gICAgLy8gSSBob3BlIG5vdCB0byBuZWVkIGFsbCB0aGUgbWFwcGluZ3MgaW4gaGVyZSBodHRwczovL2dpdGh1Yi5jb20vZHByeWFuNzkvQ2hyb21vc29tZU1hcHBpbmdzIGJ1dCBpdCBtYXkgYmUgbmVjZXNzYXJ5XG4gICAgY29udmVydENoclNjaGVtZTogXCJhdXRvXCIsXG4gICAgLy8gRHJhdyBwYWlyZWQgZW5kcyB3aXRoaW4gYSByYW5nZSBvZiBleHBlY3RlZCBpbnNlcnQgc2l6ZXMgYXMgYSBjb250aW51b3VzIGZlYXR1cmU/XG4gICAgLy8gU2VlIGh0dHBzOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvQWxpZ25tZW50RGF0YSNwYWlyZWQgZm9yIGhvdyB0aGlzIHdvcmtzXG4gICAgdmlld0FzUGFpcnM6IGZhbHNlLFxuICAgIGV4cGVjdGVkSW5zZXJ0U2l6ZVBlcmNlbnRpbGVzOiBbMC4wMDUsIDAuOTk1XVxuICB9LFxuICBcbiAgLy8gVGhlIEZMQUcgY29sdW1uIGZvciBCQU0vU0FNIGlzIGEgY29tYmluYXRpb24gb2YgYml0d2lzZSBmbGFnc1xuICBmbGFnczoge1xuICAgIGlzUmVhZFBhaXJlZDogMHgxLFxuICAgIGlzUmVhZFByb3Blcmx5QWxpZ25lZDogMHgyLFxuICAgIGlzUmVhZFVubWFwcGVkOiAweDQsXG4gICAgaXNNYXRlVW5tYXBwZWQ6IDB4OCxcbiAgICByZWFkU3RyYW5kUmV2ZXJzZTogMHgxMCxcbiAgICBtYXRlU3RyYW5kUmV2ZXJzZTogMHgyMCxcbiAgICBpc1JlYWRGaXJzdE9mUGFpcjogMHg0MCxcbiAgICBpc1JlYWRMYXN0T2ZQYWlyOiAweDgwLFxuICAgIGlzU2Vjb25kYXJ5QWxpZ25tZW50OiAweDEwMCxcbiAgICBpc1JlYWRGYWlsaW5nVmVuZG9yUUM6IDB4MjAwLFxuICAgIGlzRHVwbGljYXRlUmVhZDogMHg0MDAsXG4gICAgaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50OiAweDgwMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBicm93c2VyQ2hycyA9IF8ua2V5cyh0aGlzLmJyb3dzZXJPcHRzKTtcbiAgICBpZiAoIXRoaXMub3B0cy5iaWdEYXRhVXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1aXJlZCBwYXJhbWV0ZXIgYmlnRGF0YVVybCBub3QgZm91bmQgZm9yIEJBTSB0cmFjayBhdCBcIiArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gICAgdGhpcy50eXBlKCkuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgICB0aGlzLmJyb3dzZXJDaHJTY2hlbWUgPSB0aGlzLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoXy5rZXlzKHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zKSk7XG4gIH0sXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHM7XG4gICAgby52aWV3QXNQYWlycyA9IHRoaXMuaXNPbihvLnZpZXdBc1BhaXJzKTtcbiAgICBpZiAoIV8uaXNBcnJheShvLnZpZXdMaW1pdHMpKSB7XG4gICAgICBvLnZpZXdMaW1pdHMgPSBfLm1hcChvLnZpZXdMaW1pdHMuc3BsaXQoJzonKSwgcGFyc2VGbG9hdCk7XG4gICAgfVxuICB9LFxuICBcbiAgLy8gVE9ETzogSWYgdGhlIHBhaXJpbmcgaW50ZXJ2YWwgY2hhbmdlZCwgd2Ugc2hvdWxkIHRvc3MgdGhlIGVudGlyZSBjYWNoZSBhbmQgcmVzZXQgdGhlIFJlbW90ZVRyYWNrIGJpbnMsXG4gIC8vICAgICAgICAgKmFuZCogYmxvdyB1cCB0aGUgYXJlYUluZGV4LlxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSB0aGlzLm9wdHM7XG4gICAgLy8gV2hlbiB3ZSBjaGFuZ2Ugb3B0cy52aWV3QXNQYWlycywgd2UgKm5lZWQqIHRvIHRocm93IG91dCB0aGlzLmRhdGEucGlsZXVwLlxuICAgIGlmIChvLnZpZXdBc1BhaXJzICE9IHRoaXMucHJldk9wdHMudmlld0FzUGFpcnMgJiYgdGhpcy5kYXRhICYmIHRoaXMuZGF0YS5waWxldXApIHsgXG4gICAgICB0aGlzLmRhdGEucGlsZXVwID0ge307XG4gICAgfVxuICAgIHRoaXMuZHJhd1JhbmdlID0gby5hdXRvU2NhbGUgfHwgby52aWV3TGltaXRzLmxlbmd0aCA8IDIgPyB0aGlzLmNvdmVyYWdlUmFuZ2UgOiBvLnZpZXdMaW1pdHM7XG4gICAgdGhpcy5zY2FsZXMgPSBfLm1hcE9iamVjdCh7ZGVuc2U6IDAsIHNxdWlzaDogMCwgcGFjazogMH0sIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIHJldHVybiBbe2xpbWl0czogc2VsZi5kcmF3UmFuZ2UsIHRvcDogMCwgaGVpZ2h0OiBvLmNvdkhlaWdodFtrXSB8fCAyNH1dO1xuICAgIH0pO1xuICAgIC8vIFRPRE86IFNldHVwIHRoaXMuc2NhbGVzIGhlcmVcbiAgICBcbiAgICAvLyBFbnN1cmVzIHRoYXQgb3B0aW9ucyBhbmQgZGVyaXZlZCBwcm9wZXJ0aWVzIHNldCBieSB0aGUgYWJvdmUgYXJlIGVxdWFsIGFjcm9zcyBXZWIgV29ya2VyIGFuZCBET00gY29udGV4dHNcbiAgICB0aGlzLnN5bmNQcm9wcyhbJ29wdHMnLCAnZHJhd1JhbmdlJywgJ2NvdmVyYWdlUmFuZ2UnLCAnc2NhbGVzJ10pO1xuICAgIFxuICAgIHRoaXMucHJldk9wdHMgPSBkZWVwQ2xvbmUodGhpcy5vcHRzKTtcbiAgfSxcbiAgXG4gIGd1ZXNzQ2hyU2NoZW1lOiBmdW5jdGlvbihjaHJzKSB7XG4gICAgbGltaXQgPSBNYXRoLm1pbihjaHJzLmxlbmd0aCAqIDAuOCwgMjApO1xuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXmNoci8pLnRlc3QoY2hyKTsgfSkubGVuZ3RoID4gbGltaXQpIHsgcmV0dXJuICd1Y3NjJzsgfVxuICAgIGlmIChfLmZpbHRlcihjaHJzLCBmdW5jdGlvbihjaHIpIHsgcmV0dXJuICgvXlxcZFxcZD8kLykudGVzdChjaHIpOyB9KS5sZW5ndGggPiBsaW1pdCkgeyByZXR1cm4gJ2Vuc2VtYmwnOyB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGNhY2hlID0gbmV3IFBhaXJlZEludGVydmFsVHJlZShmbG9vckhhY2sobWlkZGxlaXNoUG9zKSwge3N0YXJ0S2V5OiAnc3RhcnQnLCBlbmRLZXk6ICdlbmQnfSwgXG4gICAgICAgICAge3N0YXJ0S2V5OiAndGVtcGxhdGVTdGFydCcsIGVuZEtleTogJ3RlbXBsYXRlRW5kJywgcGFpcmVkTGVuZ3RoS2V5OiAndGxlbicsIHBhaXJpbmdLZXk6ICdxbmFtZSd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiYW0ucGhwJyxcbiAgICAgIGluZm9DaHJSYW5nZSA9IHNlbGYuY2hyUmFuZ2UoTWF0aC5yb3VuZChzZWxmLmJyb3dzZXJPcHRzLnBvcyksIE1hdGgucm91bmQoc2VsZi5icm93c2VyT3B0cy5wb3MgKyAxMDAwMCkpLFxuICAgICAgcmVtb3RlO1xuICAgIFxuICAgIHJlbW90ZSA9IG5ldyBSZW1vdGVUcmFjayhjYWNoZSwgZnVuY3Rpb24oc3RhcnQsIGVuZCwgc3RvcmVJbnRlcnZhbHMpIHtcbiAgICAgIHJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICAgIC8vIENvbnZlcnQgYXV0b21hdGljYWxseSBiZXR3ZWVuIEVuc2VtYmwgc3R5bGUgMSwgMiwgMywgWCA8LS0+IFVDU0Mgc3R5bGUgY2hyMSwgY2hyMiwgY2hyMywgY2hyWCBhcyBjb25maWd1cmVkL2F1dG9kZXRlY3RlZFxuICAgICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICAgIHN3aXRjaCAoby5jb252ZXJ0Q2hyU2NoZW1lID09IFwiYXV0b1wiID8gc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA6IG8uY29udmVydENoclNjaGVtZSkge1xuICAgICAgICBjYXNlICdlbnNlbWJsX3Vjc2MnOiByYW5nZSA9IF8ubWFwKHJhbmdlLCBmdW5jdGlvbihyKSB7IHJldHVybiByLnJlcGxhY2UoL15jaHIvLCAnJyk7IH0pOyBicmVhaztcbiAgICAgICAgY2FzZSAndWNzY19lbnNlbWJsJzogcmFuZ2UgPSBfLm1hcChyYW5nZSwgZnVuY3Rpb24ocikgeyByZXR1cm4gci5yZXBsYWNlKC9eKFxcZFxcZD98WCk6LywgJ2NociQxOicpOyB9KTsgYnJlYWs7XG4gICAgICB9XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHZhciBsaW5lcyA9IF8uZmlsdGVyKGRhdGEuc3BsaXQoJ1xcbicpLCBmdW5jdGlvbihsKSB7IHZhciBtID0gbC5tYXRjaCgvXFx0L2cpOyByZXR1cm4gbSAmJiBtLmxlbmd0aCA+PSAyOyB9KTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBQYXJzZSB0aGUgU0FNIGZvcm1hdCBpbnRvIGludGVydmFscyB0aGF0IGNhbiBiZSBpbnNlcnRlZCBpbnRvIHRoZSBJbnRlcnZhbFRyZWUgY2FjaGVcbiAgICAgICAgICB2YXIgaW50ZXJ2YWxzID0gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbCk7IH0pO1xuICAgICAgICAgIHN0b3JlSW50ZXJ2YWxzKGludGVydmFscyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIHNlbGYuZGF0YSA9IHtjYWNoZTogY2FjaGUsIHJlbW90ZTogcmVtb3RlLCBwaWxldXA6IHt9LCBpbmZvOiB7fX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAyNCwgc3RhcnQ6IDI0fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBzZWxmLm5vQXJlYUxhYmVscyA9IHRydWU7XG4gICAgc2VsZi5leHBlY3RzU2VxdWVuY2UgPSB0cnVlO1xuICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3MgPSB7fTtcbiAgICBzZWxmLmNvdmVyYWdlUmFuZ2UgPSBbMCwgMF07XG4gICAgc2VsZi5wcmV2T3B0cyA9IGRlZXBDbG9uZShvKTsgIC8vIHVzZWQgdG8gZGV0ZWN0IHdoaWNoIGRyYXdpbmcgb3B0aW9ucyBoYXZlIGJlZW4gY2hhbmdlZCBieSB0aGUgdXNlclxuICAgIFxuICAgIC8vIEdldCBnZW5lcmFsIGluZm8gb24gdGhlIGJhbSAoZS5nLiBgc2FtdG9vbHMgaWR4c3RhdHNgKSwgdXNlIG1hcHBlZCByZWFkcyBwZXIgcmVmZXJlbmNlIHNlcXVlbmNlXG4gICAgLy8gdG8gZXN0aW1hdGUgbWF4RmV0Y2hXaW5kb3cgYW5kIG9wdGltYWxGZXRjaFdpbmRvdywgYW5kIHNldHVwIGJpbm5pbmcgb24gdGhlIFJlbW90ZVRyYWNrLlxuICAgIC8vIFdlIGFsc28gZmV0Y2ggYSBidW5jaCBvZiByZWFkcyBmcm9tIGFyb3VuZCBpbmZvQ2hyUmFuZ2UgKGJ5IGRlZmF1bHQsIHdoZXJlIHRoZSBicm93c2VyIGlzIHdoZW5cbiAgICAvLyBpdCBmaXJzdCBsb2FkcyB0aGlzIHRyYWNrKSB0byBlc3RpbWF0ZSBtZWFuSXRlbUxlbmd0aCwgbWF0ZSBwYWlyaW5nLCBhbmQgdGhlIGluc2VydCBzaXplIGRpc3RyaWJ1dGlvbi5cbiAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgZGF0YToge2luZm86IDEsIHJhbmdlOiBpbmZvQ2hyUmFuZ2UsIHVybDogby5iaWdEYXRhVXJsfSxcbiAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICAgICAgdmFyIG1hcHBlZFJlYWRzID0gMCxcbiAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKG8uZHJhd0xpbWl0KSksXG4gICAgICAgICAgYmFtQ2hycyA9IFtdLFxuICAgICAgICAgIGluZm9QYXJ0cyA9IGRhdGEuc3BsaXQoXCJcXG5cXG5cIiksXG4gICAgICAgICAgZXN0aW1hdGVkSW5zZXJ0U2l6ZXMgPSBbXSxcbiAgICAgICAgICBwY3RpbGVzID0gby5leHBlY3RlZEluc2VydFNpemVQZXJjZW50aWxlcyxcbiAgICAgICAgICBsb3dlckJvdW5kID0gMTAsIFxuICAgICAgICAgIHVwcGVyQm91bmQgPSA1MDAwLCBcbiAgICAgICAgICBzYW1wbGVJbnRlcnZhbHMsIG1lYW5JdGVtTGVuZ3RoLCBoYXNBTWF0ZVBhaXIsIGNoclNjaGVtZSwgbWVhbkl0ZW1zUGVyQnA7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goaW5mb1BhcnRzWzBdLnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgdmFyIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICAgICAgICByZWFkc01hcHBlZFRvQ29udGlnID0gcGFyc2VJbnQoZmllbGRzWzJdLCAxMCk7XG4gICAgICAgICAgaWYgKGZpZWxkcy5sZW5ndGggPT0gMSAmJiBmaWVsZHNbMF0gPT0gJycpIHsgcmV0dXJuOyB9IC8vIGJsYW5rIGxpbmVcbiAgICAgICAgICBiYW1DaHJzLnB1c2goZmllbGRzWzBdKTtcbiAgICAgICAgICBpZiAoXy5pc05hTihyZWFkc01hcHBlZFRvQ29udGlnKSkgeyB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG91dHB1dCBmb3Igc2FtdG9vbHMgaWR4c3RhdHMgb24gdGhpcyBCQU0gdHJhY2suXCIpOyB9XG4gICAgICAgICAgbWFwcGVkUmVhZHMgKz0gcmVhZHNNYXBwZWRUb0NvbnRpZztcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBzZWxmLmRhdGEuaW5mby5jaHJTY2hlbWUgPSBjaHJTY2hlbWUgPSBzZWxmLnR5cGUoXCJiYW1cIikuZ3Vlc3NDaHJTY2hlbWUoYmFtQ2hycyk7XG4gICAgICAgIGlmIChjaHJTY2hlbWUgJiYgc2VsZi5icm93c2VyQ2hyU2NoZW1lKSB7XG4gICAgICAgICAgc2VsZi5kYXRhLmluZm8uY29udmVydENoclNjaGVtZSA9IGNoclNjaGVtZSAhPSBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgPyBjaHJTY2hlbWUgKyAnXycgKyBzZWxmLmJyb3dzZXJDaHJTY2hlbWUgOiBudWxsO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBzYW1wbGVJbnRlcnZhbHMgPSBfLmNvbXBhY3QoXy5tYXAoaW5mb1BhcnRzWzFdLnNwbGl0KFwiXFxuXCIpLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgcmV0dXJuIHNlbGYudHlwZSgnYmFtJykucGFyc2VMaW5lLmNhbGwoc2VsZiwgbGluZSk7XG4gICAgICAgIH0pKTtcbiAgICAgICAgaWYgKHNhbXBsZUludGVydmFscy5sZW5ndGgpIHtcbiAgICAgICAgICBtZWFuSXRlbUxlbmd0aCA9IF8ucmVkdWNlKHNhbXBsZUludGVydmFscywgZnVuY3Rpb24obWVtbywgbmV4dCkgeyByZXR1cm4gbWVtbyArIChuZXh0LmVuZCAtIG5leHQuc3RhcnQpOyB9LCAwKTtcbiAgICAgICAgICBtZWFuSXRlbUxlbmd0aCA9IE1hdGgucm91bmQobWVhbkl0ZW1MZW5ndGggLyBzYW1wbGVJbnRlcnZhbHMubGVuZ3RoKTtcbiAgICAgICAgICBoYXNBTWF0ZVBhaXIgPSBfLnNvbWUoc2FtcGxlSW50ZXJ2YWxzLCBmdW5jdGlvbihpdHZsKSB7IFxuICAgICAgICAgICAgcmV0dXJuIGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIgfHwgaXR2bC5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGVzdGltYXRlZEluc2VydFNpemVzID0gXy5jb21wYWN0KF8ubWFwKHNhbXBsZUludGVydmFscywgZnVuY3Rpb24oaXR2bCkgeyBcbiAgICAgICAgICAgIHJldHVybiBpdHZsLnRsZW4gPyBNYXRoLmFicyhpdHZsLnRsZW4pIDogMDsgXG4gICAgICAgICAgfSkpO1xuICAgICAgICAgIGVzdGltYXRlZEluc2VydFNpemVzLnNvcnQoZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gYSAtIGI7IH0pOyAgLy8gTk9URTogSmF2YVNjcmlwdCBkb2VzIHN0cmluZyBzb3J0aW5nIGJ5IGRlZmF1bHQgLV8tXG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHNlbGYuZGF0YS5pbmZvLm1lYW5JdGVtc1BlckJwID0gbWVhbkl0ZW1zUGVyQnAgPSBtYXBwZWRSZWFkcyAvIHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZTtcbiAgICAgICAgc2VsZi5kYXRhLmluZm8ubWVhbkl0ZW1MZW5ndGggPSBtZWFuSXRlbUxlbmd0aCA9IF8uaXNVbmRlZmluZWQobWVhbkl0ZW1MZW5ndGgpID8gMTAwIDogbWVhbkl0ZW1MZW5ndGg7XG4gICAgICAgIGlmICghby5vcHRpbWFsRmV0Y2hXaW5kb3cgfHwgIW8ubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgICAgICBvLm9wdGltYWxGZXRjaFdpbmRvdyA9IE1hdGguZmxvb3IobWF4SXRlbXNUb0RyYXcgLyBtZWFuSXRlbXNQZXJCcCAvIChNYXRoLm1heChtZWFuSXRlbUxlbmd0aCwgMTAwKSAvIDEwMCkgKiAwLjUpO1xuICAgICAgICAgIG8ubWF4RmV0Y2hXaW5kb3cgPSBvLm9wdGltYWxGZXRjaFdpbmRvdyAqIDI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFzZWxmLmNvdmVyYWdlUmFuZ2VbMV0pIHsgc2VsZi5jb3ZlcmFnZVJhbmdlWzFdID0gTWF0aC5jZWlsKG1lYW5JdGVtc1BlckJwICogbWVhbkl0ZW1MZW5ndGggKiAyKTsgfVxuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmFwcGx5T3B0cy5jYWxsKHNlbGYpO1xuICAgICAgICBcbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgcGFpcmluZywgd2UgbmVlZCB0byB0ZWxsIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgd2hhdCByYW5nZSBvZiBpbnNlcnQgc2l6ZXMgc2hvdWxkIHRyaWdnZXIgcGFpcmluZy5cbiAgICAgICAgaWYgKGhhc0FNYXRlUGFpcikge1xuICAgICAgICAgIGlmIChlc3RpbWF0ZWRJbnNlcnRTaXplcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGxvd2VyQm91bmQgPSBlc3RpbWF0ZWRJbnNlcnRTaXplc1tNYXRoLmZsb29yKGVzdGltYXRlZEluc2VydFNpemVzLmxlbmd0aCAqIHBjdGlsZXNbMF0pXTtcbiAgICAgICAgICAgIHVwcGVyQm91bmQgPSBlc3RpbWF0ZWRJbnNlcnRTaXplc1tNYXRoLmZsb29yKGVzdGltYXRlZEluc2VydFNpemVzLmxlbmd0aCAqIHBjdGlsZXNbMV0pXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VsZi5kYXRhLmNhY2hlLnNldFBhaXJpbmdJbnRlcnZhbChsb3dlckJvdW5kLCB1cHBlckJvdW5kKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBJZiB3ZSBkb24ndCBzZWUgYW55IHBhaXJlZCByZWFkcyBpbiB0aGlzIEJBTSwgZGVhY3RpdmF0ZSB0aGUgcGFpcmluZyBmdW5jdGlvbmFsaXR5IG9mIHRoZSBQYWlyZWRJbnRlcnZhbFRyZWUgXG4gICAgICAgICAgc2VsZi5kYXRhLmNhY2hlLmRpc2FibGVQYWlyaW5nKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmVtb3RlLnNldHVwQmlucyhzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsIG8ub3B0aW1hbEZldGNoV2luZG93LCBvLm1heEZldGNoV2luZG93KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIFNldHMgZmVhdHVyZS5mbGFnc1suLi5dIHRvIGEgaHVtYW4gaW50ZXJwcmV0YWJsZSB2ZXJzaW9uIG9mIGZlYXR1cmUuZmxhZyAoZXhwYW5kaW5nIHRoZSBiaXR3aXNlIGZsYWdzKVxuICBwYXJzZUZsYWdzOiBmdW5jdGlvbihmZWF0dXJlLCBsaW5lbm8pIHtcbiAgICBmZWF0dXJlLmZsYWdzID0ge307XG4gICAgXy5lYWNoKHRoaXMudHlwZSgnYmFtJykuZmxhZ3MsIGZ1bmN0aW9uKGJpdCwgZmxhZykge1xuICAgICAgZmVhdHVyZS5mbGFnc1tmbGFnXSA9ICEhKGZlYXR1cmUuZmxhZyAmIGJpdCk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICAvLyBTZXRzIGZlYXR1cmUuYmxvY2tzIGFuZCBmZWF0dXJlLmVuZCBiYXNlZCBvbiBmZWF0dXJlLmNpZ2FyXG4gIC8vIFNlZSBzZWN0aW9uIDEuNCBvZiBodHRwczovL3NhbXRvb2xzLmdpdGh1Yi5pby9odHMtc3BlY3MvU0FNdjEucGRmIGZvciBhbiBleHBsYW5hdGlvbiBvZiBDSUdBUiBcbiAgcGFyc2VDaWdhcjogZnVuY3Rpb24oZmVhdHVyZSwgbGluZW5vKSB7ICAgICAgICBcbiAgICB2YXIgY2lnYXIgPSBmZWF0dXJlLmNpZ2FyLFxuICAgICAgc2VxID0gKCFmZWF0dXJlLnNlcSB8fCBmZWF0dXJlLnNlcSA9PSAnKicpID8gXCJcIiA6IGZlYXR1cmUuc2VxLFxuICAgICAgcmVmTGVuID0gMCxcbiAgICAgIHNlcVBvcyA9IDAsXG4gICAgICBvcGVyYXRpb25zLCBsZW5ndGhzO1xuICAgIFxuICAgIGZlYXR1cmUuYmxvY2tzID0gW107XG4gICAgZmVhdHVyZS5pbnNlcnRpb25zID0gW107XG4gICAgXG4gICAgb3BzID0gY2lnYXIuc3BsaXQoL1xcZCsvKS5zbGljZSgxKTtcbiAgICBsZW5ndGhzID0gY2lnYXIuc3BsaXQoL1tBLVo9XS8pLnNsaWNlKDAsIC0xKTtcbiAgICBpZiAob3BzLmxlbmd0aCAhPSBsZW5ndGhzLmxlbmd0aCkgeyB0aGlzLndhcm4oXCJJbnZhbGlkIENJR0FSICdcIiArIGNpZ2FyICsgXCInIGZvciBcIiArIGZlYXR1cmUuZGVzYyk7IHJldHVybjsgfVxuICAgIGxlbmd0aHMgPSBfLm1hcChsZW5ndGhzLCBwYXJzZUludDEwKTtcbiAgICBcbiAgICBfLmVhY2gob3BzLCBmdW5jdGlvbihvcCwgaSkge1xuICAgICAgdmFyIGxlbiA9IGxlbmd0aHNbaV0sXG4gICAgICAgIGJsb2NrLCBpbnNlcnRpb247XG4gICAgICBpZiAoL15bTVg9XSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIEFsaWdubWVudCBtYXRjaCwgc2VxdWVuY2UgbWF0Y2gsIHNlcXVlbmNlIG1pc21hdGNoXG4gICAgICAgIGJsb2NrID0ge3N0YXJ0OiBmZWF0dXJlLnN0YXJ0ICsgcmVmTGVufTtcbiAgICAgICAgYmxvY2suZW5kID0gYmxvY2suc3RhcnQgKyBsZW47XG4gICAgICAgIGJsb2NrLnR5cGUgPSBvcDtcbiAgICAgICAgYmxvY2suc2VxID0gc2VxLnNsaWNlKHNlcVBvcywgc2VxUG9zICsgbGVuKTtcbiAgICAgICAgZmVhdHVyZS5ibG9ja3MucHVzaChibG9jayk7XG4gICAgICAgIHJlZkxlbiArPSBsZW47XG4gICAgICAgIHNlcVBvcyArPSBsZW47XG4gICAgICB9IGVsc2UgaWYgKC9eW05EXSQvLnRlc3Qob3ApKSB7XG4gICAgICAgIC8vIFNraXBwZWQgcmVmZXJlbmNlIHJlZ2lvbiwgZGVsZXRpb24gZnJvbSByZWZlcmVuY2VcbiAgICAgICAgcmVmTGVuICs9IGxlbjtcbiAgICAgIH0gZWxzZSBpZiAob3AgPT0gJ0knKSB7XG4gICAgICAgIC8vIEluc2VydGlvblxuICAgICAgICBpbnNlcnRpb24gPSB7c3RhcnQ6IGZlYXR1cmUuc3RhcnQgKyByZWZMZW4sIGVuZDogZmVhdHVyZS5zdGFydCArIHJlZkxlbn07XG4gICAgICAgIGluc2VydGlvbi5zZXEgPSBzZXEuc2xpY2Uoc2VxUG9zLCBzZXFQb3MgKyBsZW4pO1xuICAgICAgICBmZWF0dXJlLmluc2VydGlvbnMucHVzaChpbnNlcnRpb24pO1xuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PSAnUycpIHtcbiAgICAgICAgLy8gU29mdCBjbGlwcGluZzsgc2ltcGx5IHNraXAgdGhlc2UgYmFzZXMgaW4gU0VRLCBwb3NpdGlvbiBvbiByZWZlcmVuY2UgaXMgdW5jaGFuZ2VkLlxuICAgICAgICBzZXFQb3MgKz0gbGVuO1xuICAgICAgfVxuICAgICAgLy8gVGhlIG90aGVyIHR3byBDSUdBUiBvcHMsIEggYW5kIFAsIGFyZSBub3QgcmVsZXZhbnQgdG8gZHJhd2luZyBhbGlnbm1lbnRzLlxuICAgIH0pO1xuICAgIFxuICAgIGZlYXR1cmUuZW5kID0gZmVhdHVyZS5zdGFydCArIHJlZkxlbjtcbiAgfSxcbiAgXG4gIHBhcnNlTGluZTogZnVuY3Rpb24obGluZSwgbGluZW5vKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xzID0gWydxbmFtZScsICdmbGFnJywgJ3JuYW1lJywgJ3BvcycsICdtYXBxJywgJ2NpZ2FyJywgJ3JuZXh0JywgJ3BuZXh0JywgJ3RsZW4nLCAnc2VxJywgJ3F1YWwnXSxcbiAgICAgIGZlYXR1cmUgPSB7fSxcbiAgICAgIGZpZWxkcyA9IGxpbmUuc3BsaXQoXCJcXHRcIiksXG4gICAgICBhdmFpbEZsYWdzID0gdGhpcy50eXBlKCdiYW0nKS5mbGFncyxcbiAgICAgIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBfLmVhY2goXy5maXJzdChmaWVsZHMsIGNvbHMubGVuZ3RoKSwgZnVuY3Rpb24odiwgaSkgeyBmZWF0dXJlW2NvbHNbaV1dID0gdjsgfSk7XG4gICAgLy8gQ29udmVydCBhdXRvbWF0aWNhbGx5IGJldHdlZW4gRW5zZW1ibCBzdHlsZSAxLCAyLCAzLCBYIDwtLT4gVUNTQyBzdHlsZSBjaHIxLCBjaHIyLCBjaHIzLCBjaHJYIGFzIGNvbmZpZ3VyZWQvYXV0b2RldGVjdGVkXG4gICAgLy8gTm90ZSB0aGF0IGNock0gaXMgTk9UIGVxdWl2YWxlbnQgdG8gTVQgaHR0cHM6Ly93d3cuYmlvc3RhcnMub3JnL3AvMTIwMDQyLyMxMjAwNThcbiAgICBzd2l0Y2ggKG8uY29udmVydENoclNjaGVtZSA9PSBcImF1dG9cIiA/IHRoaXMuZGF0YS5pbmZvLmNvbnZlcnRDaHJTY2hlbWUgOiBvLmNvbnZlcnRDaHJTY2hlbWUpIHtcbiAgICAgIGNhc2UgJ3Vjc2NfZW5zZW1ibCc6IGZlYXR1cmUucm5hbWUgPSBmZWF0dXJlLnJuYW1lLnJlcGxhY2UoL15jaHIvLCAnJyk7IGJyZWFrO1xuICAgICAgY2FzZSAnZW5zZW1ibF91Y3NjJzogZmVhdHVyZS5ybmFtZSA9ICgvXihcXGRcXGQ/fFgpJC8udGVzdChmZWF0dXJlLnJuYW1lKSA/ICdjaHInIDogJycpICsgZmVhdHVyZS5ybmFtZTsgYnJlYWs7XG4gICAgfVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucW5hbWU7XG4gICAgZmVhdHVyZS5mbGFnID0gcGFyc2VJbnQxMChmZWF0dXJlLmZsYWcpO1xuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2ZlYXR1cmUucm5hbWVdO1xuICAgIGxpbmVubyA9IGxpbmVubyB8fCAwO1xuICAgIFxuICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgIHRoaXMud2FybihcIkludmFsaWQgUk5BTUUgJ1wiK2ZlYXR1cmUucm5hbWUrXCInIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGVsc2UgaWYgKGZlYXR1cmUucG9zID09PSAnMCcgfHwgIWZlYXR1cmUuY2lnYXIgfHwgZmVhdHVyZS5jaWdhciA9PSAnKicgfHwgZmVhdHVyZS5mbGFnICYgYXZhaWxGbGFncy5pc1JlYWRVbm1hcHBlZCkge1xuICAgICAgLy8gVW5tYXBwZWQgcmVhZC4gU2luY2Ugd2UgY2FuJ3QgZHJhdyB0aGVzZSBhdCBhbGwsIHdlIGRvbid0IGJvdGhlciBwYXJzaW5nIHRoZW0gZnVydGhlci5cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICBmZWF0dXJlLnNjb3JlID0gXy5pc1VuZGVmaW5lZChmZWF0dXJlLnNjb3JlKSA/ICc/JyA6IGZlYXR1cmUuc2NvcmU7XG4gICAgICBmZWF0dXJlLnN0YXJ0ID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnBvcyk7ICAgICAgICAvLyBQT1MgaXMgMS1iYXNlZCwgaGVuY2Ugbm8gaW5jcmVtZW50IGFzIGZvciBwYXJzaW5nIEJFRFxuICAgICAgZmVhdHVyZS5kZXNjID0gZmVhdHVyZS5xbmFtZSArICcgYXQgJyArIGZlYXR1cmUucm5hbWUgKyAnOicgKyBmZWF0dXJlLnBvcztcbiAgICAgIGZlYXR1cmUudGxlbiA9IHBhcnNlSW50MTAoZmVhdHVyZS50bGVuKTtcbiAgICAgIHRoaXMudHlwZSgnYmFtJykucGFyc2VGbGFncy5jYWxsKHRoaXMsIGZlYXR1cmUsIGxpbmVubyk7XG4gICAgICBmZWF0dXJlLnN0cmFuZCA9IGZlYXR1cmUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgPyAnLScgOiAnKyc7XG4gICAgICB0aGlzLnR5cGUoJ2JhbScpLnBhcnNlQ2lnYXIuY2FsbCh0aGlzLCBmZWF0dXJlLCBsaW5lbm8pOyAvLyBUaGlzIGFsc28gc2V0cyAuZW5kIGFwcHJvcHJpYXRlbHlcbiAgICB9XG4gICAgLy8gV2UgaGF2ZSB0byBjb21lIHVwIHdpdGggc29tZXRoaW5nIHRoYXQgaXMgYSB1bmlxdWUgbGFiZWwgZm9yIGV2ZXJ5IGxpbmUgdG8gZGVkdXBlIHJvd3MuXG4gICAgLy8gVGhlIGZvbGxvd2luZyBpcyB0ZWNobmljYWxseSBub3QgZ3VhcmFudGVlZCBieSBhIHZhbGlkIEJBTSAoZXZlbiBhdCBHQVRLIHN0YW5kYXJkcyksIGJ1dCBpdCdzIHRoZSBiZXN0IEkgZ290LlxuICAgIGZlYXR1cmUuaWQgPSBbZmVhdHVyZS5xbmFtZSwgZmVhdHVyZS5mbGFnLCBmZWF0dXJlLnJuYW1lLCBmZWF0dXJlLnBvcywgZmVhdHVyZS5jaWdhcl0uam9pbihcIlxcdFwiKTtcbiAgICBcbiAgICByZXR1cm4gZmVhdHVyZTtcbiAgfSxcbiAgXG4gIHBpbGV1cDogZnVuY3Rpb24oaW50ZXJ2YWxzLCBzdGFydCwgZW5kKSB7XG4gICAgdmFyIHBpbGV1cCA9IHRoaXMuZGF0YS5waWxldXAsXG4gICAgICBwb3NpdGlvbnNUb0NhbGN1bGF0ZSA9IHt9LFxuICAgICAgbnVtUG9zaXRpb25zVG9DYWxjdWxhdGUgPSAwLFxuICAgICAgaTtcbiAgICBcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICAvLyBObyBuZWVkIHRvIHBpbGV1cCBhZ2FpbiBvbiBhbHJlYWR5LXBpbGVkLXVwIG51Y2xlb3RpZGUgcG9zaXRpb25zXG4gICAgICBpZiAoIXBpbGV1cFtpXSkgeyBwb3NpdGlvbnNUb0NhbGN1bGF0ZVtpXSA9IHRydWU7IG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlKys7IH1cbiAgICB9XG4gICAgaWYgKG51bVBvc2l0aW9uc1RvQ2FsY3VsYXRlID09PSAwKSB7IHJldHVybjsgfSAvLyBBbGwgcG9zaXRpb25zIGFscmVhZHkgcGlsZWQgdXAhXG4gICAgXG4gICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24oaW50ZXJ2YWwpIHtcbiAgICAgIHZhciBibG9ja1NldHMgPSBbaW50ZXJ2YWwuZGF0YS5ibG9ja3NdO1xuICAgICAgaWYgKGludGVydmFsLmRhdGEuZHJhd0FzTWF0ZXMgJiYgaW50ZXJ2YWwuZGF0YS5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKGludGVydmFsLmRhdGEubWF0ZS5ibG9ja3MpOyB9XG4gICAgICBfLmVhY2goYmxvY2tTZXRzLCBmdW5jdGlvbihibG9ja3MpIHtcbiAgICAgICAgXy5lYWNoKGJsb2NrcywgZnVuY3Rpb24oYmxvY2spIHtcbiAgICAgICAgICB2YXIgbnQsIGk7XG4gICAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgZW5kKTsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoIXBvc2l0aW9uc1RvQ2FsY3VsYXRlW2ldKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgIHBpbGV1cFtpXSA9IHBpbGV1cFtpXSB8fCB7QTogMCwgQzogMCwgRzogMCwgVDogMCwgTjogMCwgY292OiAwfTtcbiAgICAgICAgICAgIHBpbGV1cFtpXVsoL1tBQ1RHXS8pLnRlc3QobnQpID8gbnQgOiAnTiddICs9IDE7XG4gICAgICAgICAgICBwaWxldXBbaV0uY292ICs9IDE7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgY292ZXJhZ2U6IGZ1bmN0aW9uKHN0YXJ0LCB3aWR0aCwgYnBwcCkge1xuICAgIC8vIENvbXBhcmUgd2l0aCBiaW5uaW5nIG9uIHRoZSBmbHkgaW4gLnR5cGUoJ3dpZ2dsZV8wJykucHJlcmVuZGVyKC4uLilcbiAgICB2YXIgaiA9IHN0YXJ0LFxuICAgICAgY3VyciA9IHRoaXMuZGF0YS5waWxldXBbal0sXG4gICAgICBiYXJzID0gW10sXG4gICAgICBuZXh0LCBiaW4sIGk7XG4gICAgZm9yIChpID0gMDsgaSA8IHdpZHRoOyBpKyspIHtcbiAgICAgIGJpbiA9IGN1cnIgJiYgKGogKyAxID49IGkgKiBicHBwICsgc3RhcnQpID8gW2N1cnIuY292XSA6IFtdO1xuICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgd2hpbGUgKGogKyAxIDwgKGkgKyAxKSAqIGJwcHAgKyBzdGFydCAmJiBqICsgMiA+PSBpICogYnBwcCArIHN0YXJ0KSB7IFxuICAgICAgICBpZiAobmV4dCkgeyBiaW4ucHVzaChuZXh0LmNvdik7IH1cbiAgICAgICAgKytqO1xuICAgICAgICBjdXJyID0gbmV4dDtcbiAgICAgICAgbmV4dCA9IHRoaXMuZGF0YS5waWxldXBbaiArIDFdO1xuICAgICAgfVxuICAgICAgYmFycy5wdXNoKHV0aWxzLndpZ0JpbkZ1bmN0aW9ucy5tYXhpbXVtKGJpbikpO1xuICAgIH1cbiAgICByZXR1cm4gYmFycztcbiAgfSxcbiAgXG4gIGFsbGVsZXM6IGZ1bmN0aW9uKHN0YXJ0LCBzZXF1ZW5jZSwgYnBwcCkge1xuICAgIHZhciBwaWxldXAgPSB0aGlzLmRhdGEucGlsZXVwLFxuICAgICAgYWxsZWxlRnJlcVRocmVzaG9sZCA9IHRoaXMub3B0cy5hbGxlbGVGcmVxVGhyZXNob2xkLFxuICAgICAgYWxsZWxlU3BsaXRzID0gW10sXG4gICAgICBzcGxpdCwgcmVmTnQsIGksIHBpbGU7XG4gICAgICBcbiAgICBmb3IgKGkgPSAwOyBpIDwgc2VxdWVuY2UubGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlZk50ID0gc2VxdWVuY2VbaV0udG9VcHBlckNhc2UoKTtcbiAgICAgIHBpbGUgPSBwaWxldXBbc3RhcnQgKyBpXTtcbiAgICAgIGlmIChwaWxlICYmIHBpbGUuY292ICYmIHBpbGVbcmVmTnRdIC8gKHBpbGUuY292IC0gcGlsZS5OKSA8ICgxIC0gYWxsZWxlRnJlcVRocmVzaG9sZCkpIHtcbiAgICAgICAgc3BsaXQgPSB7XG4gICAgICAgICAgeDogaSAvIGJwcHAsXG4gICAgICAgICAgc3BsaXRzOiBbXVxuICAgICAgICB9O1xuICAgICAgICBfLmVhY2goWydBJywgJ0MnLCAnRycsICdUJ10sIGZ1bmN0aW9uKG50KSB7XG4gICAgICAgICAgaWYgKHBpbGVbbnRdID4gMCkgeyBzcGxpdC5zcGxpdHMucHVzaCh7bnQ6IG50LCBoOiBwaWxlW250XX0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBhbGxlbGVTcGxpdHMucHVzaChzcGxpdCk7XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBhbGxlbGVTcGxpdHM7XG4gIH0sXG4gIFxuICBtaXNtYXRjaGVzOiBmdW5jdGlvbihzdGFydCwgc2VxdWVuY2UsIGJwcHAsIGludGVydmFscywgd2lkdGgsIGxpbmVOdW0sIHZpZXdBc1BhaXJzKSB7XG4gICAgdmFyIG1pc21hdGNoZXMgPSBbXSxcbiAgICAgIHZpZXdBc1BhaXJzID0gdGhpcy5vcHRzLnZpZXdBc1BhaXJzO1xuICAgIHNlcXVlbmNlID0gc2VxdWVuY2UudG9VcHBlckNhc2UoKTtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgdmFyIGJsb2NrU2V0cyA9IFtpbnRlcnZhbC5kYXRhLmJsb2Nrc107XG4gICAgICBpZiAodmlld0FzUGFpcnMgJiYgaW50ZXJ2YWwuZGF0YS5kcmF3QXNNYXRlcyAmJiBpbnRlcnZhbC5kYXRhLm1hdGUpIHsgXG4gICAgICAgIGJsb2NrU2V0cy5wdXNoKGludGVydmFsLmRhdGEubWF0ZS5ibG9ja3MpO1xuICAgICAgfVxuICAgICAgXy5lYWNoKGJsb2NrU2V0cywgZnVuY3Rpb24oYmxvY2tzKSB7XG4gICAgICAgIF8uZWFjaChibG9ja3MsIGZ1bmN0aW9uKGJsb2NrKSB7XG4gICAgICAgICAgdmFyIGxpbmUgPSBsaW5lTnVtKGludGVydmFsLmRhdGEpLFxuICAgICAgICAgICAgbnQsIGksIHg7XG4gICAgICAgICAgZm9yIChpID0gTWF0aC5tYXgoYmxvY2suc3RhcnQsIHN0YXJ0KTsgaSA8IE1hdGgubWluKGJsb2NrLmVuZCwgc3RhcnQgKyB3aWR0aCAqIGJwcHApOyBpKyspIHtcbiAgICAgICAgICAgIHggPSAoaSAtIHN0YXJ0KSAvIGJwcHA7XG4gICAgICAgICAgICBudCA9IChibG9jay5zZXFbaSAtIGJsb2NrLnN0YXJ0XSB8fCAnJykudG9VcHBlckNhc2UoKTtcbiAgICAgICAgICAgIGlmIChudCAmJiBudCAhPSBzZXF1ZW5jZVtpIC0gc3RhcnRdICYmIGxpbmUpIHsgbWlzbWF0Y2hlcy5wdXNoKHt4OiB4LCBudDogbnQsIGxpbmU6IGxpbmV9KTsgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gbWlzbWF0Y2hlcztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgd2lkdGggPSBwcmVjYWxjLndpZHRoLFxuICAgICAgc2VxdWVuY2UgPSBwcmVjYWxjLnNlcXVlbmNlLFxuICAgICAgZGF0YSA9IHNlbGYuZGF0YSxcbiAgICAgIHZpZXdBc1BhaXJzID0gc2VsZi5vcHRzLnZpZXdBc1BhaXJzLFxuICAgICAgc3RhcnRLZXkgPSB2aWV3QXNQYWlycyA/ICd0ZW1wbGF0ZVN0YXJ0JyA6ICdzdGFydCcsXG4gICAgICBlbmRLZXkgPSB2aWV3QXNQYWlycyA/ICd0ZW1wbGF0ZUVuZCcgOiAnZW5kJyxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGg7XG4gICAgXG4gICAgZnVuY3Rpb24gbGluZU51bShkLCBzZXRUbykge1xuICAgICAgdmFyIGtleSA9IGJwcHAgKyAnXycgKyBkZW5zaXR5ICsgJ18nICsgKHZpZXdBc1BhaXJzID8gJ3AnIDogJ3UnKTtcbiAgICAgIGlmICghXy5pc1VuZGVmaW5lZChzZXRUbykpIHsgXG4gICAgICAgIGlmICghZC5saW5lKSB7IGQubGluZSA9IHt9OyB9XG4gICAgICAgIHJldHVybiAoZC5saW5lW2tleV0gPSBzZXRUbyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIHdlIGNhbiByZWFzb25hYmx5IGVzdGltYXRlIHRoYXQgd2Ugd2lsbCBmZXRjaCBhbiBpbnNhbmUgYW1vdW50IG9mIHJvd3MgXG4gICAgLy8gKD41MDAgYWxpZ25tZW50cyksIGFzIHRoaXMgd2lsbCBvbmx5IGhvbGQgdXAgb3RoZXIgcmVxdWVzdHMuXG4gICAgaWYgKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAmJiAoZW5kIC0gc3RhcnQpID4gc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICBjYWxsYmFjayh7dG9vTWFueTogdHJ1ZX0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGZXRjaCBmcm9tIHRoZSBSZW1vdGVUcmFjayBhbmQgY2FsbCB0aGUgYWJvdmUgd2hlbiB0aGUgZGF0YSBpcyBhdmFpbGFibGUuXG4gICAgICBzZWxmLmRhdGEucmVtb3RlLmZldGNoQXN5bmMoc3RhcnQsIGVuZCwgdmlld0FzUGFpcnMsIGZ1bmN0aW9uKGludGVydmFscykge1xuICAgICAgICB2YXIgZHJhd1NwZWMgPSB7c2VxdWVuY2U6ICEhc2VxdWVuY2UsIHdpZHRoOiB3aWR0aH0sXG4gICAgICAgICAgY2FsY1BpeEludGVydmFsTWF0ZWQgPSBuZXcgdXRpbHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yKHN0YXJ0LCB3aWR0aCwgYnBwcCwgNCwgZmFsc2UsIHN0YXJ0S2V5LCBlbmRLZXkpLFxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCA0KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuXG4gICAgICAgIGlmICghc2VxdWVuY2UpIHtcbiAgICAgICAgICAvLyBGaXJzdCBkcmF3aW5nIHBhc3MsIHdpdGggZmVhdHVyZXMgdGhhdCBkb24ndCBkZXBlbmQgb24gc2VxdWVuY2UuXG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5waWxldXAuY2FsbChzZWxmLCBpbnRlcnZhbHMsIHN0YXJ0LCBlbmQpO1xuICAgICAgICAgIGRyYXdTcGVjLmxheW91dCA9IHNlbGYudHlwZSgnYmVkJykuc3RhY2tlZExheW91dC5jYWxsKHNlbGYsIGludGVydmFscywgd2lkdGgsIGNhbGNQaXhJbnRlcnZhbE1hdGVkLCBsaW5lTnVtKTtcbiAgICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsaW5lcykge1xuICAgICAgICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgICAgICAgICBpbnRlcnZhbC5pbnNlcnRpb25QdHMgPSBfLm1hcChpbnRlcnZhbC5kLmluc2VydGlvbnMsIGNhbGNQaXhJbnRlcnZhbCk7XG4gICAgICAgICAgICAgIGlmICghdmlld0FzUGFpcnMpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgIGlmIChpbnRlcnZhbC5kLmRyYXdBc01hdGVzICYmIGludGVydmFsLmQubWF0ZSkge1xuICAgICAgICAgICAgICAgIGludGVydmFsLm1hdGVJbnRzID0gXy5tYXAoW2ludGVydmFsLmQsIGludGVydmFsLmQubWF0ZV0sIGNhbGNQaXhJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUJsb2NrSW50cyA9IF8ubWFwKGludGVydmFsLmQubWF0ZS5ibG9ja3MsIGNhbGNQaXhJbnRlcnZhbCk7XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUluc2VydGlvblB0cyA9IF8ubWFwKGludGVydmFsLmQubWF0ZS5pbnNlcnRpb25QdHMsIGNhbGNQaXhJbnRlcnZhbCk7XG4gICAgICAgICAgICAgIH0gZWxzZSBpZiAoaW50ZXJ2YWwuZC5tYXRlRXhwZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlSW50cyA9IFtjYWxjUGl4SW50ZXJ2YWwoaW50ZXJ2YWwpXTtcbiAgICAgICAgICAgICAgICBpbnRlcnZhbC5tYXRlQmxvY2tJbnRzID0gW107XG4gICAgICAgICAgICAgICAgaW50ZXJ2YWwubWF0ZUluc2VydGlvblB0cyA9IFtdO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBkcmF3U3BlYy5jb3ZlcmFnZSA9IHNlbGYudHlwZSgnYmFtJykuY292ZXJhZ2UuY2FsbChzZWxmLCBzdGFydCwgd2lkdGgsIGJwcHApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFNlY29uZCBkcmF3aW5nIHBhc3MsIHRvIGRyYXcgdGhpbmdzIHRoYXQgYXJlIGRlcGVuZGVudCBvbiBzZXF1ZW5jZSwgbGlrZSBtaXNtYXRjaGVzIChwb3RlbnRpYWwgU05QcykuXG4gICAgICAgICAgZHJhd1NwZWMuYnBwcCA9IGJwcHA7ICBcbiAgICAgICAgICAvLyBGaW5kIGFsbGVsZSBzcGxpdHMgd2l0aGluIHRoZSBjb3ZlcmFnZSBncmFwaC5cbiAgICAgICAgICBkcmF3U3BlYy5hbGxlbGVzID0gc2VsZi50eXBlKCdiYW0nKS5hbGxlbGVzLmNhbGwoc2VsZiwgc3RhcnQsIHNlcXVlbmNlLCBicHBwKTtcbiAgICAgICAgICAvLyBGaW5kIG1pc21hdGNoZXMgd2l0aGluIGVhY2ggYWxpZ25lZCBibG9jay5cbiAgICAgICAgICBkcmF3U3BlYy5taXNtYXRjaGVzID0gc2VsZi50eXBlKCdiYW0nKS5taXNtYXRjaGVzLmNhbGwoc2VsZiwgc3RhcnQsIHNlcXVlbmNlLCBicHBwLCBpbnRlcnZhbHMsIHdpZHRoLCBsaW5lTnVtKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY2FsbGJhY2soZHJhd1NwZWMpO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBcbiAgLy8gc3BlY2lhbCBmb3JtYXR0ZXIgZm9yIGNvbnRlbnQgaW4gdG9vbHRpcHMgZm9yIGZlYXR1cmVzXG4gIHRpcFRpcERhdGE6IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICB2YXIgbyA9IHRoaXMub3B0cyxcbiAgICAgIGNvbnRlbnQgPSB7fSxcbiAgICAgIGZpcnN0TWF0ZSA9IGRhdGEuZCxcbiAgICAgIHNlY29uZE1hdGUgPSBkYXRhLmQubWF0ZSxcbiAgICAgIG1hdGVIZWFkZXJzID0gW1widGhpcyBhbGlnbm1lbnRcIiwgXCJtYXRlIHBhaXIgYWxpZ25tZW50XCJdLFxuICAgICAgbGVmdE1hdGUsIHJpZ2h0TWF0ZSwgcGFpck9yaWVudGF0aW9uO1xuICAgIGZ1bmN0aW9uIHllc05vKGJvb2wpIHsgcmV0dXJuIGJvb2wgPyBcInllc1wiIDogXCJub1wiOyB9XG4gICAgZnVuY3Rpb24gYWRkQWxpZ25lZFNlZ21lbnRJbmZvKGNvbnRlbnQsIHNlZywgcHJlZml4KSB7XG4gICAgICB2YXIgY2lnYXJBYmJyZXYgPSBzZWcuY2lnYXIgJiYgc2VnLmNpZ2FyLmxlbmd0aCA+IDI1ID8gc2VnLmNpZ2FyLnN1YnN0cigwLCAyNCkgKyAnLi4uJyA6IHNlZy5jaWdhcjtcbiAgICAgIHByZWZpeCA9IHByZWZpeCB8fCBcIlwiO1xuICAgICAgXG4gICAgICBfLmVhY2goe1xuICAgICAgICBcInBvc2l0aW9uXCI6IHNlZy5ybmFtZSArICc6JyArIHNlZy5wb3MsXG4gICAgICAgIFwiY2lnYXJcIjogY2lnYXJBYmJyZXYsXG4gICAgICAgIFwicmVhZCBzdHJhbmRcIjogc2VnLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gJygtKScgOiAnKCspJyxcbiAgICAgICAgXCJtYXBwZWRcIjogeWVzTm8oIXNlZy5mbGFncy5pc1JlYWRVbm1hcHBlZCksXG4gICAgICAgIFwibWFwIHF1YWxpdHlcIjogc2VnLm1hcHEsXG4gICAgICAgIFwic2Vjb25kYXJ5XCI6IHllc05vKHNlZy5mbGFncy5pc1NlY29uZGFyeUFsaWdubWVudCksXG4gICAgICAgIFwic3VwcGxlbWVudGFyeVwiOiB5ZXNObyhzZWcuZmxhZ3MuaXNTdXBwbGVtZW50YXJ5QWxpZ25tZW50KSxcbiAgICAgICAgXCJkdXBsaWNhdGVcIjogeWVzTm8oc2VnLmZsYWdzLmlzRHVwbGljYXRlUmVhZCksXG4gICAgICAgIFwiZmFpbGVkIFFDXCI6IHllc05vKHNlZy5mbGFncy5pc1JlYWRGYWlsaW5nVmVuZG9yUUMpXG4gICAgICB9LCBmdW5jdGlvbih2LCBrKSB7IGNvbnRlbnRbcHJlZml4ICsga10gPSB2OyB9KTtcbiAgICB9XG4gICAgXG4gICAgaWYgKGRhdGEuZC5tYXRlICYmIGRhdGEuZC5tYXRlLmZsYWdzKSB7XG4gICAgICBsZWZ0TWF0ZSA9IGRhdGEuZC5zdGFydCA8IGRhdGEuZC5tYXRlLnN0YXJ0ID8gZGF0YS5kIDogZGF0YS5kLm1hdGU7XG4gICAgICByaWdodE1hdGUgPSBkYXRhLmQuc3RhcnQgPCBkYXRhLmQubWF0ZS5zdGFydCA/IGRhdGEuZC5tYXRlIDogZGF0YS5kO1xuICAgICAgcGFpck9yaWVudGF0aW9uID0gKGxlZnRNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gXCJSXCIgOiBcIkZcIikgKyAobGVmdE1hdGUuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIgPyBcIjFcIiA6IFwiMlwiKTtcbiAgICAgIHBhaXJPcmllbnRhdGlvbiArPSAocmlnaHRNYXRlLmZsYWdzLnJlYWRTdHJhbmRSZXZlcnNlID8gXCJSXCIgOiBcIkZcIikgKyAocmlnaHRNYXRlLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIgPyBcIjJcIiA6IFwiMVwiKTtcbiAgICB9XG4gICAgXG4gICAgaWYgKG8udmlld0FzUGFpcnMgJiYgZGF0YS5kLmRyYXdBc01hdGVzICYmIGRhdGEuZC5tYXRlKSB7XG4gICAgICBmaXJzdE1hdGUgPSBsZWZ0TWF0ZTtcbiAgICAgIHNlY29uZE1hdGUgPSByaWdodE1hdGU7XG4gICAgICBtYXRlSGVhZGVycyA9IFtcImxlZnQgYWxpZ25tZW50XCIsIFwicmlnaHQgYWxpZ25tZW50XCJdO1xuICAgIH1cbiAgICBpZiAoc2Vjb25kTWF0ZSkge1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5pbnNlcnRTaXplKSkgeyBjb250ZW50W1wiaW5zZXJ0IHNpemVcIl0gPSBkYXRhLmQuaW5zZXJ0U2l6ZTsgfVxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKHBhaXJPcmllbnRhdGlvbikpIHsgY29udGVudFtcInBhaXIgb3JpZW50YXRpb25cIl0gPSBwYWlyT3JpZW50YXRpb247IH1cbiAgICAgIGNvbnRlbnRbbWF0ZUhlYWRlcnNbMF1dID0gXCItLS1cIjtcbiAgICAgIGFkZEFsaWduZWRTZWdtZW50SW5mbyhjb250ZW50LCBmaXJzdE1hdGUpO1xuICAgICAgY29udGVudFttYXRlSGVhZGVyc1sxXV0gPSBcIi0tLVwiO1xuICAgICAgYWRkQWxpZ25lZFNlZ21lbnRJbmZvKGNvbnRlbnQsIHNlY29uZE1hdGUsIFwiIFwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWRkQWxpZ25lZFNlZ21lbnRJbmZvKGNvbnRlbnQsIGRhdGEuZCk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBjb250ZW50O1xuICB9LFxuICBcbiAgLy8gU2VlIGh0dHBzOi8vd3d3LmJyb2FkaW5zdGl0dXRlLm9yZy9pZ3YvQWxpZ25tZW50RGF0YSNjb3ZlcmFnZSBmb3IgYW4gaWRlYSBvZiB3aGF0IHdlJ3JlIGltaXRhdGluZ1xuICBkcmF3Q292ZXJhZ2U6IGZ1bmN0aW9uKGN0eCwgY292ZXJhZ2UsIGhlaWdodCkge1xuICAgIHZhciB2U2NhbGUgPSB0aGlzLmRyYXdSYW5nZVsxXTtcbiAgICBfLmVhY2goY292ZXJhZ2UsIGZ1bmN0aW9uKGQsIHgpIHtcbiAgICAgIGlmIChkID09PSBudWxsKSB7IHJldHVybjsgfVxuICAgICAgdmFyIGggPSBkICogaGVpZ2h0IC8gdlNjYWxlO1xuICAgICAgY3R4LmZpbGxSZWN0KHgsIE1hdGgubWF4KGhlaWdodCAtIGgsIDApLCAxLCBNYXRoLm1pbihoLCBoZWlnaHQpKTtcbiAgICB9KTtcbiAgfSxcbiAgXG4gIGRyYXdTdHJhbmRJbmRpY2F0b3I6IGZ1bmN0aW9uKGN0eCwgeCwgYmxvY2tZLCBibG9ja0hlaWdodCwgeFNjYWxlLCBiaWdTdHlsZSkge1xuICAgIHZhciBwcmV2RmlsbFN0eWxlID0gY3R4LmZpbGxTdHlsZTtcbiAgICBpZiAoYmlnU3R5bGUpIHtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oeCAtICgyICogeFNjYWxlKSwgYmxvY2tZKTtcbiAgICAgIGN0eC5saW5lVG8oeCArICgzICogeFNjYWxlKSwgYmxvY2tZICsgYmxvY2tIZWlnaHQvMik7XG4gICAgICBjdHgubGluZVRvKHggLSAoMiAqIHhTY2FsZSksIGJsb2NrWSArIGJsb2NrSGVpZ2h0KTtcbiAgICAgIGN0eC5jbG9zZVBhdGgoKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKDE0MCwxNDAsMTQwKSc7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTIgOiAxKSwgYmxvY2tZLCAxLCBibG9ja0hlaWdodCk7XG4gICAgICBjdHguZmlsbFJlY3QoeCArICh4U2NhbGUgPiAwID8gLTEgOiAwKSwgYmxvY2tZICsgMSwgMSwgYmxvY2tIZWlnaHQgLSAyKTtcbiAgICAgIGN0eC5maWxsU3R5bGUgPSBwcmV2RmlsbFN0eWxlO1xuICAgIH1cbiAgfSxcbiAgXG4gIGRyYXdBbGlnbm1lbnQ6IGZ1bmN0aW9uKGN0eCwgd2lkdGgsIGRhdGEsIGksIGxpbmVIZWlnaHQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBkcmF3TWF0ZXMgPSBkYXRhLm1hdGVJbnRzLFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBsaW5lR2FwID0gbGluZUhlaWdodCA+IDYgPyAyIDogMCxcbiAgICAgIGJsb2NrWSA9IGkgKiBsaW5lSGVpZ2h0ICsgbGluZUdhcC8yLFxuICAgICAgYmxvY2tIZWlnaHQgPSBsaW5lSGVpZ2h0IC0gbGluZUdhcCxcbiAgICAgIGRlbGV0aW9uTGluZVdpZHRoID0gMixcbiAgICAgIGluc2VydGlvbkNhcmV0TGluZVdpZHRoID0gbGluZUhlaWdodCA+IDYgPyAyIDogMSxcbiAgICAgIGhhbGZIZWlnaHQgPSBNYXRoLnJvdW5kKDAuNSAqIGxpbmVIZWlnaHQpIC0gZGVsZXRpb25MaW5lV2lkdGggKiAwLjUsXG4gICAgICBibG9ja1NldHMgPSBbe2Jsb2NrSW50czogZGF0YS5ibG9ja0ludHMsIHN0cmFuZDogZGF0YS5kLnN0cmFuZH1dO1xuICAgIFxuICAgIC8vIEZvciBtYXRlIHBhaXJzLCB0aGUgZnVsbCBwaXhlbCBpbnRlcnZhbCByZXByZXNlbnRzIHRoZSBsaW5lIGxpbmtpbmcgdGhlIG1hdGVzXG4gICAgaWYgKGRyYXdNYXRlcykge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiICsgY29sb3IgKyBcIilcIjtcbiAgICAgIGN0eC5maWxsUmVjdChkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgZGVsZXRpb25MaW5lV2lkdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyBEcmF3IHRoZSBsaW5lcyB0aGF0IHNob3cgdGhlIGZ1bGwgYWxpZ25tZW50IGZvciBlYWNoIHNlZ21lbnQsIGluY2x1ZGluZyBkZWxldGlvbnNcbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gJ3JnYigwLDAsMCknO1xuICAgIF8uZWFjaChkcmF3TWF0ZXMgfHwgW2RhdGEucEludF0sIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgIGlmIChwSW50LncgPD0gMCkgeyByZXR1cm47IH1cbiAgICAgIC8vIE5vdGUgdGhhdCB0aGUgXCItIDFcIiBiZWxvdyBmaXhlcyByb3VuZGluZyBpc3N1ZXMgYnV0IGdhbWJsZXMgb24gdGhlcmUgbmV2ZXIgYmVpbmcgYSBkZWxldGlvbiBhdCB0aGUgcmlnaHQgZWRnZVxuICAgICAgY3R4LmZpbGxSZWN0KHBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyBoYWxmSGVpZ2h0LCBwSW50LncgLSAxLCBkZWxldGlvbkxpbmVXaWR0aCk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRmlyc3QsIGRldGVybWluZSBhbmQgc2V0IHRoZSBjb2xvciB3ZSB3aWxsIGJlIHVzaW5nXG4gICAgLy8gTm90ZSB0aGF0IHRoZSBkZWZhdWx0IGNvbG9yIHdhcyBhbHJlYWR5IHNldCBpbiBkcmF3U3BlY1xuICAgIGlmIChzZWxmLm9wdHMuYWx0Q29sb3IgJiYgZGF0YS5kLnN0cmFuZCA9PSAnLScpIHsgY29sb3IgPSBzZWxmLm9wdHMuYWx0Q29sb3I7IH1cbiAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiO1xuICAgIFxuICAgIC8vIERyYXcgdGhlIFttaXNdbWF0Y2ggKE0vWC89KSBibG9ja3NcbiAgICBpZiAoZHJhd01hdGVzICYmIGRhdGEuZC5tYXRlKSB7IGJsb2NrU2V0cy5wdXNoKHtibG9ja0ludHM6IGRhdGEubWF0ZUJsb2NrSW50cywgc3RyYW5kOiBkYXRhLmQubWF0ZS5zdHJhbmR9KTsgfVxuICAgIF8uZWFjaChibG9ja1NldHMsIGZ1bmN0aW9uKGJsb2NrU2V0KSB7XG4gICAgICB2YXIgc3RyYW5kID0gYmxvY2tTZXQuc3RyYW5kO1xuICAgICAgXy5lYWNoKGJsb2NrU2V0LmJsb2NrSW50cywgZnVuY3Rpb24oYkludCwgYmxvY2tOdW0pIHtcbiAgICAgIFxuICAgICAgICAvLyBTa2lwIGRyYXdpbmcgYmxvY2tzIHRoYXQgYXJlbid0IGluc2lkZSB0aGUgY2FudmFzXG4gICAgICAgIGlmIChiSW50LnggKyBiSW50LncgPCAwIHx8IGJJbnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgXG4gICAgICAgIGlmIChibG9ja051bSA9PSAwICYmIGJsb2NrU2V0LnN0cmFuZCA9PSAnLScgJiYgIWJJbnQub1ByZXYpIHtcbiAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54ICsgMiwgYmxvY2tZLCBiSW50LncgLSAyLCBibG9ja0hlaWdodCk7XG4gICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3RyYW5kSW5kaWNhdG9yLmNhbGwoc2VsZiwgY3R4LCBiSW50LngsIGJsb2NrWSwgYmxvY2tIZWlnaHQsIC0xLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSBpZiAoYmxvY2tOdW0gPT0gYmxvY2tTZXQuYmxvY2tJbnRzLmxlbmd0aCAtIDEgJiYgYmxvY2tTZXQuc3RyYW5kID09ICcrJyAmJiAhYkludC5vTmV4dCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChiSW50LngsIGJsb2NrWSwgYkludC53IC0gMiwgYmxvY2tIZWlnaHQpO1xuICAgICAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd1N0cmFuZEluZGljYXRvci5jYWxsKHNlbGYsIGN0eCwgYkludC54ICsgYkludC53LCBibG9ja1ksIGJsb2NrSGVpZ2h0LCAxLCBsaW5lSGVpZ2h0ID4gNik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3R4LmZpbGxSZWN0KGJJbnQueCwgYmxvY2tZLCBiSW50LncsIGJsb2NrSGVpZ2h0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgXG4gICAgLy8gRHJhdyBpbnNlcnRpb25zXG4gICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKDExNCw0MSwyMTgpXCI7XG4gICAgXy5lYWNoKGRyYXdNYXRlcyA/IFtkYXRhLmluc2VydGlvblB0cywgZGF0YS5tYXRlSW5zZXJ0aW9uUHRzXSA6IFtkYXRhLmluc2VydGlvblB0c10sIGZ1bmN0aW9uKGluc2VydGlvblB0cykge1xuICAgICAgXy5lYWNoKGluc2VydGlvblB0cywgZnVuY3Rpb24oaW5zZXJ0KSB7XG4gICAgICAgIGlmIChpbnNlcnQueCArIGluc2VydC53IDwgMCB8fCBpbnNlcnQueCA+IHdpZHRoKSB7IHJldHVybjsgfVxuICAgICAgICBjdHguZmlsbFJlY3QoaW5zZXJ0LnggLSAxLCBpICogbGluZUhlaWdodCwgMiwgbGluZUhlaWdodCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIGkgKiBsaW5lSGVpZ2h0LCA0LCBpbnNlcnRpb25DYXJldExpbmVXaWR0aCk7XG4gICAgICAgIGN0eC5maWxsUmVjdChpbnNlcnQueCAtIDIsIChpICsgMSkgKiBsaW5lSGVpZ2h0IC0gaW5zZXJ0aW9uQ2FyZXRMaW5lV2lkdGgsIDQsIGluc2VydGlvbkNhcmV0TGluZVdpZHRoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBcbiAgZHJhd0FsbGVsZXM6IGZ1bmN0aW9uKGN0eCwgYWxsZWxlcywgaGVpZ2h0LCBiYXJXaWR0aCkge1xuICAgIC8vIFNhbWUgY29sb3JzIGFzICQudWkuZ2Vub3RyYWNrLl9udFNlcXVlbmNlTG9hZCguLi4pIGJ1dCBjb3VsZCBiZSBjb25maWd1cmFibGU/XG4gICAgdmFyIGNvbG9ycyA9IHtBOiAnMjU1LDAsMCcsIFQ6ICcyNTUsMCwyNTUnLCBDOiAnMCwwLDI1NScsIEc6ICcwLDE4MCwwJ30sXG4gICAgICB2U2NhbGUgPSB0aGlzLmRyYXdSYW5nZVsxXSxcbiAgICAgIHlQb3M7XG4gICAgXy5lYWNoKGFsbGVsZXMsIGZ1bmN0aW9uKGFsbGVsZXNGb3JQb3NpdGlvbikge1xuICAgICAgeVBvcyA9IGhlaWdodDtcbiAgICAgIF8uZWFjaChhbGxlbGVzRm9yUG9zaXRpb24uc3BsaXRzLCBmdW5jdGlvbihzcGxpdCkge1xuICAgICAgICB2YXIgaCA9IHNwbGl0LmggKiBoZWlnaHQgLyB2U2NhbGU7XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSAncmdiKCcrY29sb3JzW3NwbGl0Lm50XSsnKSc7XG4gICAgICAgIGN0eC5maWxsUmVjdChhbGxlbGVzRm9yUG9zaXRpb24ueCwgeVBvcyAtPSBoLCBNYXRoLm1heChiYXJXaWR0aCwgMSksIGgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG4gIFxuICBkcmF3TWlzbWF0Y2g6IGZ1bmN0aW9uKGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIHBwYnApIHtcbiAgICAvLyBwcGJwID09IHBpeGVscyBwZXIgYmFzZSBwYWlyIChpbnZlcnNlIG9mIGJwcHApXG4gICAgLy8gU2FtZSBjb2xvcnMgYXMgJC51aS5nZW5vdHJhY2suX250U2VxdWVuY2VMb2FkKC4uLikgYnV0IGNvdWxkIGJlIGNvbmZpZ3VyYWJsZT9cbiAgICB2YXIgY29sb3JzID0ge0E6ICcyNTUsMCwwJywgVDogJzI1NSwwLDI1NScsIEM6ICcwLDAsMjU1JywgRzogJzAsMTgwLDAnfSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAwLFxuICAgICAgeVBvcztcbiAgICBjdHguZmlsbFN0eWxlID0gJ3JnYignK2NvbG9yc1ttaXNtYXRjaC5udF0rJyknO1xuICAgIGN0eC5maWxsUmVjdChtaXNtYXRjaC54LCAobWlzbWF0Y2gubGluZSArIGxpbmVPZmZzZXQpICogbGluZUhlaWdodCArIGxpbmVHYXAgLyAyLCBNYXRoLm1heChwcGJwLCAxKSwgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgIC8vIERvIHdlIGhhdmUgcm9vbSB0byBwcmludCBhIHdob2xlIGxldHRlcj9cbiAgICBpZiAocHBicCA+IDcgJiYgbGluZUhlaWdodCA+IDEwKSB7XG4gICAgICBjdHguZmlsbFN0eWxlID0gJ3JnYigyNTUsMjU1LDI1NSknO1xuICAgICAgY3R4LmZpbGxUZXh0KG1pc21hdGNoLm50LCBtaXNtYXRjaC54ICsgcHBicCAqIDAuNSwgKG1pc21hdGNoLmxpbmUgKyBsaW5lT2Zmc2V0ICsgMSkgKiBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgfVxuICB9LFxuICBcbiAgZHJhd1NwZWM6IGZ1bmN0aW9uKGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSxcbiAgICAgIHVybFRlbXBsYXRlID0gJ2phdmFzY3JpcHQ6dm9pZChcIicrc2VsZi5vcHRzLm5hbWUrJzokJFwiKScsXG4gICAgICBkcmF3TGltaXQgPSBzZWxmLm9wdHMuZHJhd0xpbWl0ICYmIHNlbGYub3B0cy5kcmF3TGltaXRbZGVuc2l0eV0sXG4gICAgICBsaW5lSGVpZ2h0ID0gZGVuc2l0eSA9PSAncGFjaycgPyAxNCA6IDQsXG4gICAgICBjb3ZIZWlnaHQgPSBzZWxmLm9wdHMuY292SGVpZ2h0W2RlbnNpdHldIHx8IDM4LFxuICAgICAgY292TWFyZ2luID0gNyxcbiAgICAgIGxpbmVPZmZzZXQgPSAoKGNvdkhlaWdodCArIGNvdk1hcmdpbikgLyBsaW5lSGVpZ2h0KSwgXG4gICAgICBjb2xvciA9IHNlbGYub3B0cy5jb2xvcixcbiAgICAgIGFyZWFzID0gbnVsbDtcbiAgICAgICAgICAgIFxuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIFxuICAgIGlmICghZHJhd1NwZWMuc2VxdWVuY2UpIHtcbiAgICAgIC8vIEZpcnN0IGRyYXdpbmcgcGFzcywgd2l0aCBmZWF0dXJlcyB0aGF0IGRvbid0IGRlcGVuZCBvbiBzZXF1ZW5jZS5cbiAgICAgIFxuICAgICAgLy8gSWYgbmVjZXNzYXJ5LCBpbmRpY2F0ZSB0aGVyZSB3YXMgdG9vIG11Y2ggZGF0YSB0byBsb2FkL2RyYXcgYW5kIHRoYXQgdGhlIHVzZXIgbmVlZHMgdG8gem9vbSB0byBzZWUgbW9yZVxuICAgICAgaWYgKGRyYXdTcGVjLnRvb01hbnkgfHwgKGRyYXdMaW1pdCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gT25seSBzdG9yZSBhcmVhcyBmb3IgdGhlIFwicGFja1wiIGRlbnNpdHkuXG4gICAgICAvLyBXZSBoYXZlIHRvIGVtcHR5IHRoaXMgZm9yIGV2ZXJ5IHJlbmRlciwgYmVjYXVzZSBhcmVhcyBjYW4gY2hhbmdlIGlmIEJBTSBkaXNwbGF5IG9wdGlvbnMgY2hhbmdlLlxuICAgICAgaWYgKGRlbnNpdHkgPT0gJ3BhY2snICYmICFzZWxmLmFyZWFzW2NhbnZhcy5pZF0pIHsgYXJlYXMgPSBzZWxmLmFyZWFzW2NhbnZhcy5pZF0gPSBbXTsgfVxuICAgICAgLy8gU2V0IHRoZSBleHBlY3RlZCBoZWlnaHQgZm9yIHRoZSBjYW52YXMgKHRoaXMgYWxzbyBlcmFzZXMgaXQpLlxuICAgICAgY2FudmFzLmhlaWdodCA9IGNvdkhlaWdodCArICgoZGVuc2l0eSA9PSAnZGVuc2UnKSA/IDAgOiBjb3ZNYXJnaW4gKyBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodCk7XG4gICAgICBcbiAgICAgIC8vIEZpcnN0IGRyYXcgdGhlIGNvdmVyYWdlIGdyYXBoXG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTU5LDE1OSwxNTkpXCI7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdDb3ZlcmFnZS5jYWxsKHNlbGYsIGN0eCwgZHJhd1NwZWMuY292ZXJhZ2UsIGNvdkhlaWdodCk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAvLyBOb3csIGRyYXcgYWxpZ25tZW50cyBiZWxvdyBpdFxuICAgICAgaWYgKGRlbnNpdHkgIT0gJ2RlbnNlJykge1xuICAgICAgICAvLyBCb3JkZXIgYmV0d2VlbiBjb3ZlcmFnZVxuICAgICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoMTA5LDEwOSwxMDkpXCI7XG4gICAgICAgIGN0eC5maWxsUmVjdCgwLCBjb3ZIZWlnaHQgKyAxLCBkcmF3U3BlYy53aWR0aCwgMSk7IFxuICAgICAgICBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICAgIFxuICAgICAgICBfLmVhY2goZHJhd1NwZWMubGF5b3V0LCBmdW5jdGlvbihsLCBpKSB7XG4gICAgICAgICAgaSArPSBsaW5lT2Zmc2V0OyAvLyBoYWNraXNoIG1ldGhvZCBmb3IgbGVhdmluZyBzcGFjZSBhdCB0aGUgdG9wIGZvciB0aGUgY292ZXJhZ2UgZ3JhcGhcbiAgICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3QWxpZ25tZW50LmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYy53aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCwgZHJhd1NwZWMudmlld0FzUGFpcnMpO1xuICAgICAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5hZGRBcmVhLmNhbGwoc2VsZiwgYXJlYXMsIGRhdGEsIGksIGxpbmVIZWlnaHQsIHVybFRlbXBsYXRlKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNlY29uZCBkcmF3aW5nIHBhc3MsIHRvIGRyYXcgdGhpbmdzIHRoYXQgYXJlIGRlcGVuZGVudCBvbiBzZXF1ZW5jZTpcbiAgICAgIC8vICgxKSBhbGxlbGUgc3BsaXRzIG92ZXIgY292ZXJhZ2VcbiAgICAgIHNlbGYudHlwZSgnYmFtJykuZHJhd0FsbGVsZXMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLmFsbGVsZXMsIGNvdkhlaWdodCwgMSAvIGRyYXdTcGVjLmJwcHApO1xuICAgICAgLy8gKDIpIG1pc21hdGNoZXMgb3ZlciB0aGUgYWxpZ25tZW50c1xuICAgICAgY3R4LmZvbnQgPSBcIjEycHggJ01lbmxvJywnQml0c3RyZWFtIFZlcmEgU2FucyBNb25vJywnQ29uc29sYXMnLCdMdWNpZGEgQ29uc29sZScsbW9ub3NwYWNlXCI7XG4gICAgICBjdHgudGV4dEFsaWduID0gJ2NlbnRlcic7XG4gICAgICBjdHgudGV4dEJhc2VsaW5lID0gJ2Jhc2VsaW5lJztcbiAgICAgIF8uZWFjaChkcmF3U3BlYy5taXNtYXRjaGVzLCBmdW5jdGlvbihtaXNtYXRjaCkge1xuICAgICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdNaXNtYXRjaC5jYWxsKHNlbGYsIGN0eCwgbWlzbWF0Y2gsIGxpbmVPZmZzZXQsIGxpbmVIZWlnaHQsIDEgLyBkcmF3U3BlYy5icHBwKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICB2YXIgY2FsbGJhY2tLZXkgPSBzdGFydCArICctJyArIGVuZCArICctJyArIGRlbnNpdHk7XG4gICAgICBzZWxmLnR5cGUoJ2JhbScpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBcbiAgICAgIC8vIEhhdmUgd2UgYmVlbiB3YWl0aW5nIHRvIGRyYXcgc2VxdWVuY2UgZGF0YSB0b28/IElmIHNvLCBkbyB0aGF0IG5vdywgdG9vLlxuICAgICAgaWYgKF8uaXNGdW5jdGlvbihzZWxmLnJlbmRlclNlcXVlbmNlQ2FsbGJhY2tzW2NhbGxiYWNrS2V5XSkpIHtcbiAgICAgICAgc2VsZi5yZW5kZXJTZXF1ZW5jZUNhbGxiYWNrc1tjYWxsYmFja0tleV0oKTtcbiAgICAgICAgZGVsZXRlIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3NbY2FsbGJhY2tLZXldO1xuICAgICAgfVxuICAgICAgXG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICByZW5kZXJTZXF1ZW5jZTogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBzZXF1ZW5jZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgXG4gICAgLy8gSWYgd2Ugd2VyZW4ndCBhYmxlIHRvIGZldGNoIHNlcXVlbmNlIGZvciBzb21lIHJlYXNvbiwgdGhlcmUgaXMgbm8gcmVhc29uIHRvIHByb2NlZWQuXG4gICAgaWYgKCFzZXF1ZW5jZSkgeyByZXR1cm4gZmFsc2U7IH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKSB7XG4gICAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aCwgc2VxdWVuY2U6IHNlcXVlbmNlfSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgICAgc2VsZi50eXBlKCdiYW0nKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgdGhlIGNhbnZhcyB3YXMgYWxyZWFkeSByZW5kZXJlZCAoYnkgbGFjayBvZiB0aGUgY2xhc3MgJ3VucmVuZGVyZWQnKS5cbiAgICAvLyBJZiB5ZXMsIGdvIGFoZWFkIGFuZCBleGVjdXRlIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTsgaWYgbm90LCBzYXZlIGl0IGZvciBsYXRlci5cbiAgICBpZiAoKCcgJyArIGNhbnZhcy5jbGFzc05hbWUgKyAnICcpLmluZGV4T2YoJyB1bnJlbmRlcmVkICcpID4gLTEpIHtcbiAgICAgIHNlbGYucmVuZGVyU2VxdWVuY2VDYWxsYmFja3Nbc3RhcnQgKyAnLScgKyBlbmQgKyAnLScgKyBkZW5zaXR5XSA9IHJlbmRlclNlcXVlbmNlQ2FsbGJhY2s7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlbmRlclNlcXVlbmNlQ2FsbGJhY2soKTtcbiAgICB9XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0FzUGFpcnNdJykuYXR0cignY2hlY2tlZCcsICEhby52aWV3QXNQYWlycyk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb252ZXJ0Q2hyU2NoZW1lXScpLnZhbChvLmNvbnZlcnRDaHJTY2hlbWUpLmNoYW5nZSgpO1xuICB9LFxuXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHM7XG4gICAgby52aWV3QXNQYWlycyA9ICRkaWFsb2cuZmluZCgnW25hbWU9dmlld0FzUGFpcnNdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby5jb252ZXJ0Q2hyU2NoZW1lID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb252ZXJ0Q2hyU2NoZW1lXScpLnZhbCgpO1xuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgXG4gICAgLy8gSWYgby52aWV3QXNQYWlycyB3YXMgY2hhbmdlZCwgd2UgKm5lZWQqIHRvIGJsb3cgYXdheSB0aGUgZ2Vub2Jyb3dzZXIncyBhcmVhSW5kZXggXG4gICAgLy8gYW5kIG91ciBsb2NhbGx5IGNhY2hlZCBhcmVhcywgYXMgYWxsIHRoZSBhcmVhcyB3aWxsIGNoYW5nZS5cbiAgICBpZiAoby52aWV3QXNQYWlycyAhPSB0aGlzLnByZXZPcHRzLnZpZXdBc1BhaXJzKSB7XG4gICAgICB0aGlzLmFyZWFzID0ge307XG4gICAgICBkZWxldGUgJGRpYWxvZy5kYXRhKCdnZW5vYnJvd3NlcicpLmdlbm9icm93c2VyKCdhcmVhSW5kZXgnKVskZGlhbG9nLmRhdGEoJ3RyYWNrJykubl07XG4gICAgfVxuICB9XG4gIFxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCYW1Gb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gQkVEIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9GQVEvRkFRZm9ybWF0Lmh0bWwjZm9ybWF0MSA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIGJlZERldGFpbCBpcyBhIHRyaXZpYWwgZXh0ZW5zaW9uIG9mIEJFRCB0aGF0IGlzIGRlZmluZWQgc2VwYXJhdGVseSxcbi8vIGFsdGhvdWdoIGEgQkVEIGZpbGUgd2l0aCA+MTIgY29sdW1ucyBpcyBhc3N1bWVkIHRvIGJlIGJlZERldGFpbCB0cmFjayByZWdhcmRsZXNzIG9mIHR5cGUuXG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgZmxvb3JIYWNrID0gdXRpbHMuZmxvb3JIYWNrLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBMaW5lTWFzayA9IHJlcXVpcmUoJy4vdXRpbHMvTGluZU1hc2suanMnKS5MaW5lTWFzaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkXG52YXIgQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgZGV0YWlsOiBmYWxzZSxcbiAgICB1cmw6ICcnLFxuICAgIGh0bWxVcmw6ICcnLFxuICAgIGRyYXdMaW1pdDoge3NxdWlzaDogbnVsbCwgcGFjazogbnVsbH1cbiAgfSxcbiAgXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH0sXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYWx0Q29sb3JzID0gc2VsZi5vcHRzLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKSxcbiAgICAgIHZhbGlkQ29sb3JCeVN0cmFuZCA9IGFsdENvbG9ycy5sZW5ndGggPiAxICYmIF8uYWxsKGFsdENvbG9ycywgc2VsZi52YWxpZGF0ZUNvbG9yKTtcbiAgICBzZWxmLm9wdHMudXNlU2NvcmUgPSBzZWxmLmlzT24oc2VsZi5vcHRzLnVzZVNjb3JlKTtcbiAgICBzZWxmLm9wdHMuaXRlbVJnYiA9IHNlbGYuaXNPbihzZWxmLm9wdHMuaXRlbVJnYik7XG4gICAgaWYgKCF2YWxpZENvbG9yQnlTdHJhbmQpIHsgc2VsZi5vcHRzLmNvbG9yQnlTdHJhbmQgPSAnJzsgc2VsZi5vcHRzLmFsdENvbG9yID0gbnVsbDsgfVxuICAgIGVsc2UgeyBzZWxmLm9wdHMuYWx0Q29sb3IgPSBhbHRDb2xvcnNbMV07IH1cbiAgfSxcblxuICBwYXJzZUxpbmU6IGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgIHZhciBjb2xzID0gWydjaHJvbScsICdjaHJvbVN0YXJ0JywgJ2Nocm9tRW5kJywgJ25hbWUnLCAnc2NvcmUnLCAnc3RyYW5kJywgJ3RoaWNrU3RhcnQnLCAndGhpY2tFbmQnLCAnaXRlbVJnYicsXG4gICAgICAnYmxvY2tDb3VudCcsICdibG9ja1NpemVzJywgJ2Jsb2NrU3RhcnRzJywgJ2lkJywgJ2Rlc2NyaXB0aW9uJ10sXG4gICAgICBmZWF0dXJlID0ge30sXG4gICAgICBmaWVsZHMgPSAvXFx0Ly50ZXN0KGxpbmUpID8gbGluZS5zcGxpdChcIlxcdFwiKSA6IGxpbmUuc3BsaXQoL1xccysvKSxcbiAgICAgIGNoclBvcywgYmxvY2tTaXplcztcbiAgICBcbiAgICBpZiAodGhpcy5vcHRzLmRldGFpbCkge1xuICAgICAgY29sc1tmaWVsZHMubGVuZ3RoIC0gMl0gPSAnaWQnO1xuICAgICAgY29sc1tmaWVsZHMubGVuZ3RoIC0gMV0gPSAnZGVzY3JpcHRpb24nO1xuICAgIH1cbiAgICBfLmVhY2goZmllbGRzLCBmdW5jdGlvbih2LCBpKSB7IGZlYXR1cmVbY29sc1tpXV0gPSB2OyB9KTtcbiAgICBjaHJQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmNoclBvc1tmZWF0dXJlLmNocm9tXTtcbiAgICBsaW5lbm8gPSBsaW5lbm8gfHwgMDtcbiAgICBcbiAgICBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7IFxuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lICdcIitmZWF0dXJlLmNocm9tK1wiJyBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyB0aGlzLm9wdHMubGluZU51bSkpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZlYXR1cmUuc2NvcmUgPSBfLmlzVW5kZWZpbmVkKGZlYXR1cmUuc2NvcmUpID8gJz8nIDogZmVhdHVyZS5zY29yZTtcbiAgICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUuY2hyb21TdGFydCkgKyAxO1xuICAgICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUuY2hyb21FbmQpICsgMTtcbiAgICAgIGZlYXR1cmUuYmxvY2tzID0gbnVsbDtcbiAgICAgIC8vIGZhbmNpZXIgQkVEIGZlYXR1cmVzIHRvIGV4cHJlc3MgY29kaW5nIHJlZ2lvbnMgYW5kIGV4b25zL2ludHJvbnNcbiAgICAgIGlmICgvXlxcZCskLy50ZXN0KGZlYXR1cmUudGhpY2tTdGFydCkgJiYgL15cXGQrJC8udGVzdChmZWF0dXJlLnRoaWNrRW5kKSkge1xuICAgICAgICBmZWF0dXJlLnRoaWNrU3RhcnQgPSBjaHJQb3MgKyBwYXJzZUludDEwKGZlYXR1cmUudGhpY2tTdGFydCkgKyAxO1xuICAgICAgICBmZWF0dXJlLnRoaWNrRW5kID0gY2hyUG9zICsgcGFyc2VJbnQxMChmZWF0dXJlLnRoaWNrRW5kKSArIDE7XG4gICAgICAgIGlmICgvXlxcZCsoLFxcZCopKiQvLnRlc3QoZmVhdHVyZS5ibG9ja1NpemVzKSAmJiAvXlxcZCsoLFxcZCopKiQvLnRlc3QoZmVhdHVyZS5ibG9ja1N0YXJ0cykpIHtcbiAgICAgICAgICBmZWF0dXJlLmJsb2NrcyA9IFtdO1xuICAgICAgICAgIGJsb2NrU2l6ZXMgPSBmZWF0dXJlLmJsb2NrU2l6ZXMuc3BsaXQoLywvKTtcbiAgICAgICAgICBfLmVhY2goZmVhdHVyZS5ibG9ja1N0YXJ0cy5zcGxpdCgvLC8pLCBmdW5jdGlvbihzdGFydCwgaSkge1xuICAgICAgICAgICAgaWYgKHN0YXJ0ID09PSAnJykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciBibG9jayA9IHtzdGFydDogZmVhdHVyZS5zdGFydCArIHBhcnNlSW50MTAoc3RhcnQpfTtcbiAgICAgICAgICAgIGJsb2NrLmVuZCA9IGJsb2NrLnN0YXJ0ICsgcGFyc2VJbnQxMChibG9ja1NpemVzW2ldKTtcbiAgICAgICAgICAgIGZlYXR1cmUuYmxvY2tzLnB1c2goYmxvY2spO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmZWF0dXJlLnRoaWNrU3RhcnQgPSBmZWF0dXJlLnRoaWNrRW5kID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG5cbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgbWlkZGxlaXNoUG9zID0gc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplIC8gMixcbiAgICAgIGRhdGEgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KTtcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGZlYXR1cmUgPSBzZWxmLnR5cGUoKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsaW5lLCBsaW5lbm8pO1xuICAgICAgaWYgKGZlYXR1cmUpIHsgZGF0YS5hZGQoZmVhdHVyZSk7IH1cbiAgICB9KTtcbiAgICBzZWxmLmRhdGEgPSBkYXRhO1xuICAgIHNlbGYuaGVpZ2h0cyA9IHttYXg6IG51bGwsIG1pbjogMTUsIHN0YXJ0OiAxNX07XG4gICAgc2VsZi5zaXplcyA9IFsnZGVuc2UnLCAnc3F1aXNoJywgJ3BhY2snXTtcbiAgICBzZWxmLm1hcFNpemVzID0gWydwYWNrJ107XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG4gIFxuICBzdGFja2VkTGF5b3V0OiBmdW5jdGlvbihpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pIHtcbiAgICAvLyBBIGxpbmVOdW0gZnVuY3Rpb24gY2FuIGJlIHByb3ZpZGVkIHdoaWNoIGNhbiBzZXQvcmV0cmlldmUgdGhlIGxpbmUgb2YgYWxyZWFkeSByZW5kZXJlZCBkYXRhcG9pbnRzXG4gICAgLy8gc28gYXMgdG8gbm90IGJyZWFrIGEgcmFuZ2VkIGZlYXR1cmUgdGhhdCBleHRlbmRzIG92ZXIgbXVsdGlwbGUgdGlsZXMuXG4gICAgbGluZU51bSA9IF8uaXNGdW5jdGlvbihsaW5lTnVtKSA/IGxpbmVOdW0gOiBmdW5jdGlvbigpIHsgcmV0dXJuOyB9O1xuICAgIHZhciBsaW5lcyA9IFtdLFxuICAgICAgbWF4RXhpc3RpbmdMaW5lID0gXy5tYXgoXy5tYXAoaW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7IHJldHVybiBsaW5lTnVtKHYuZGF0YSkgfHwgMDsgfSkpICsgMSxcbiAgICAgIHNvcnRlZEludGVydmFscyA9IF8uc29ydEJ5KGludGVydmFscywgZnVuY3Rpb24odikgeyB2YXIgbG4gPSBsaW5lTnVtKHYuZGF0YSk7IHJldHVybiBfLmlzVW5kZWZpbmVkKGxuKSA/IDEgOiAtbG47IH0pO1xuICAgIFxuICAgIHdoaWxlIChtYXhFeGlzdGluZ0xpbmUtLT4wKSB7IGxpbmVzLnB1c2gobmV3IExpbmVNYXNrKHdpZHRoLCA1KSk7IH1cbiAgICBfLmVhY2goc29ydGVkSW50ZXJ2YWxzLCBmdW5jdGlvbih2KSB7XG4gICAgICB2YXIgZCA9IHYuZGF0YSxcbiAgICAgICAgbG4gPSBsaW5lTnVtKGQpLFxuICAgICAgICBwSW50ID0gY2FsY1BpeEludGVydmFsKGQpLFxuICAgICAgICB0aGlja0ludCA9IGQudGhpY2tTdGFydCAhPT0gbnVsbCAmJiBjYWxjUGl4SW50ZXJ2YWwoe3N0YXJ0OiBkLnRoaWNrU3RhcnQsIGVuZDogZC50aGlja0VuZH0pLFxuICAgICAgICBibG9ja0ludHMgPSBkLmJsb2NrcyAhPT0gbnVsbCAmJiAgXy5tYXAoZC5ibG9ja3MsIGNhbGNQaXhJbnRlcnZhbCksXG4gICAgICAgIGkgPSAwLFxuICAgICAgICBsID0gbGluZXMubGVuZ3RoO1xuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGxuKSkge1xuICAgICAgICBpZiAobGluZXNbbG5dLmNvbmZsaWN0KHBJbnQudHgsIHBJbnQudHcpKSB7IGNvbnNvbGUubG9nKFwiVW5yZXNvbHZhYmxlIExpbmVNYXNrIGNvbmZsaWN0IVwiKTsgfVxuICAgICAgICBsaW5lc1tsbl0uYWRkKHBJbnQudHgsIHBJbnQudHcsIHtwSW50OiBwSW50LCB0aGlja0ludDogdGhpY2tJbnQsIGJsb2NrSW50czogYmxvY2tJbnRzLCBkOiBkfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3aGlsZSAoaSA8IGwgJiYgbGluZXNbaV0uY29uZmxpY3QocEludC50eCwgcEludC50dykpIHsgKytpOyB9XG4gICAgICAgIGlmIChpID09IGwpIHsgbGluZXMucHVzaChuZXcgTGluZU1hc2sod2lkdGgsIDUpKTsgfVxuICAgICAgICBsaW5lTnVtKGQsIGkpO1xuICAgICAgICBsaW5lc1tpXS5hZGQocEludC50eCwgcEludC50dywge3BJbnQ6IHBJbnQsIHRoaWNrSW50OiB0aGlja0ludCwgYmxvY2tJbnRzOiBibG9ja0ludHMsIGQ6IGR9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gXy5tYXAobGluZXMsIGZ1bmN0aW9uKGwpIHsgcmV0dXJuIF8ucGx1Y2sobC5pdGVtcywgJ2RhdGEnKTsgfSk7XG4gIH0sXG4gIFxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGJwcHAgPSAoZW5kIC0gc3RhcnQpIC8gd2lkdGgsXG4gICAgICBpbnRlcnZhbHMgPSB0aGlzLmRhdGEuc2VhcmNoKHN0YXJ0LCBlbmQpLFxuICAgICAgZHJhd1NwZWMgPSBbXSxcbiAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5PT0ncGFjaycpO1xuICAgIFxuICAgIGZ1bmN0aW9uIGxpbmVOdW0oZCwgc2V0KSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0KSkgeyBcbiAgICAgICAgaWYgKCFkLmxpbmUpIHsgZC5saW5lID0ge307IH1cbiAgICAgICAgcmV0dXJuIChkLmxpbmVba2V5XSA9IHNldCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZC5saW5lICYmIGQubGluZVtrZXldOyBcbiAgICB9XG4gICAgXG4gICAgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgXy5lYWNoKGludGVydmFscywgZnVuY3Rpb24odikge1xuICAgICAgICB2YXIgcEludCA9IGNhbGNQaXhJbnRlcnZhbCh2LmRhdGEpO1xuICAgICAgICBwSW50LnYgPSB2LmRhdGEuc2NvcmU7XG4gICAgICAgIGRyYXdTcGVjLnB1c2gocEludCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZHJhd1NwZWMgPSB7bGF5b3V0OiB0aGlzLnR5cGUoJ2JlZCcpLnN0YWNrZWRMYXlvdXQuY2FsbCh0aGlzLCBpbnRlcnZhbHMsIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwsIGxpbmVOdW0pfTtcbiAgICAgIGRyYXdTcGVjLndpZHRoID0gd2lkdGg7XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soZHJhd1NwZWMpIDogZHJhd1NwZWM7XG4gIH0sXG4gIFxuICBhZGRBcmVhOiBmdW5jdGlvbihhcmVhcywgZGF0YSwgaSwgbGluZUhlaWdodCwgdXJsVGVtcGxhdGUpIHtcbiAgICB2YXIgdGlwVGlwRGF0YSA9IHt9LFxuICAgICAgdGlwVGlwRGF0YUNhbGxiYWNrID0gdGhpcy50eXBlKCkudGlwVGlwRGF0YTtcbiAgICBpZiAoIWFyZWFzKSB7IHJldHVybjsgfVxuICAgIGlmIChfLmlzRnVuY3Rpb24odGlwVGlwRGF0YUNhbGxiYWNrKSkge1xuICAgICAgdGlwVGlwRGF0YSA9IHRpcFRpcERhdGFDYWxsYmFjay5jYWxsKHRoaXMsIGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLmRlc2NyaXB0aW9uKSkgeyB0aXBUaXBEYXRhLmRlc2NyaXB0aW9uID0gZGF0YS5kLmRlc2NyaXB0aW9uOyB9XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoZGF0YS5kLnNjb3JlKSkgeyB0aXBUaXBEYXRhLnNjb3JlID0gZGF0YS5kLnNjb3JlOyB9XG4gICAgICBfLmV4dGVuZCh0aXBUaXBEYXRhLCB7XG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9KTtcbiAgICAgIC8vIERpc3BsYXkgdGhlIElEIGNvbHVtbiAoZnJvbSBiZWREZXRhaWwpLCB1bmxlc3MgaXQgY29udGFpbnMgYSB0YWIgY2hhcmFjdGVyLCB3aGljaCBtZWFucyBpdCB3YXMgYXV0b2dlbmVyYXRlZFxuICAgICAgaWYgKCFfLmlzVW5kZWZpbmVkKGRhdGEuZC5pZCkgJiYgISgvXFx0LykudGVzdChkYXRhLmQuaWQpKSB7IHRpcFRpcERhdGEuaWQgPSBkYXRhLmQuaWQ7IH1cbiAgICB9XG4gICAgYXJlYXMucHVzaChbXG4gICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy8geDEsIHgyLCB5MSwgeTJcbiAgICAgIGRhdGEuZC5uYW1lIHx8IGRhdGEuZC5pZCB8fCAnJywgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBuYW1lXG4gICAgICB1cmxUZW1wbGF0ZS5yZXBsYWNlKCckJCcsIF8uaXNVbmRlZmluZWQoZGF0YS5kLmlkKSA/IGRhdGEuZC5uYW1lIDogZGF0YS5kLmlkKSwgICAgLy8gaHJlZlxuICAgICAgZGF0YS5wSW50Lm9QcmV2LCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNvbnRpbnVhdGlvbiBmcm9tIHByZXZpb3VzIHRpbGU/XG4gICAgICBudWxsLFxuICAgICAgbnVsbCxcbiAgICAgIHRpcFRpcERhdGFcbiAgICBdKTtcbiAgfSxcbiAgXG4gIC8vIFNjYWxlcyBhIHNjb3JlIGZyb20gMC0xMDAwIGludG8gYW4gYWxwaGEgdmFsdWUgYmV0d2VlbiAwLjIgYW5kIDEuMFxuICBjYWxjQWxwaGE6IGZ1bmN0aW9uKHZhbHVlKSB7IHJldHVybiBNYXRoLm1heCh2YWx1ZSwgMTY2KS8xMDAwOyB9LFxuICBcbiAgLy8gU2NhbGVzIGEgc2NvcmUgZnJvbSAwLTEwMDAgaW50byBhIGNvbG9yIHNjYWxlZCBiZXR3ZWVuICNjY2NjY2MgYW5kIG1heCBDb2xvclxuICBjYWxjR3JhZGllbnQ6IGZ1bmN0aW9uKG1heENvbG9yLCB2YWx1ZSkge1xuICAgIHZhciBtaW5Db2xvciA9IFsyMzAsMjMwLDIzMF0sXG4gICAgICB2YWx1ZUNvbG9yID0gW107XG4gICAgaWYgKCFfLmlzQXJyYXkobWF4Q29sb3IpKSB7IG1heENvbG9yID0gXy5tYXAobWF4Q29sb3Iuc3BsaXQoJywnKSwgcGFyc2VJbnQxMCk7IH1cbiAgICBfLmVhY2gobWluQ29sb3IsIGZ1bmN0aW9uKHYsIGkpIHsgdmFsdWVDb2xvcltpXSA9ICh2IC0gbWF4Q29sb3JbaV0pICogKCgxMDAwIC0gdmFsdWUpIC8gMTAwMC4wKSArIG1heENvbG9yW2ldOyB9KTtcbiAgICByZXR1cm4gXy5tYXAodmFsdWVDb2xvciwgcGFyc2VJbnQxMCkuam9pbignLCcpO1xuICB9LFxuICBcbiAgZHJhd0Fycm93czogZnVuY3Rpb24oY3R4LCBjYW52YXNXaWR0aCwgbGluZVksIGhhbGZIZWlnaHQsIHN0YXJ0WCwgZW5kWCwgZGlyZWN0aW9uKSB7XG4gICAgdmFyIGFycm93SGVpZ2h0ID0gTWF0aC5taW4oaGFsZkhlaWdodCwgMyksXG4gICAgICBYMSwgWDI7XG4gICAgc3RhcnRYID0gTWF0aC5tYXgoc3RhcnRYLCAwKTtcbiAgICBlbmRYID0gTWF0aC5taW4oZW5kWCwgY2FudmFzV2lkdGgpO1xuICAgIGlmIChlbmRYIC0gc3RhcnRYIDwgNSkgeyByZXR1cm47IH0gLy8gY2FuJ3QgZHJhdyBhcnJvd3MgaW4gdGhhdCBuYXJyb3cgb2YgYSBzcGFjZVxuICAgIGlmIChkaXJlY3Rpb24gIT09ICcrJyAmJiBkaXJlY3Rpb24gIT09ICctJykgeyByZXR1cm47IH0gLy8gaW52YWxpZCBkaXJlY3Rpb25cbiAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgLy8gQWxsIHRoZSAwLjUncyBoZXJlIGFyZSBkdWUgdG8gPGNhbnZhcz4ncyBzb21ld2hhdCBzaWxseSBjb29yZGluYXRlIHN5c3RlbSBcbiAgICAvLyBodHRwOi8vZGl2ZWludG9odG1sNS5pbmZvL2NhbnZhcy5odG1sI3BpeGVsLW1hZG5lc3NcbiAgICBYMSA9IGRpcmVjdGlvbiA9PSAnKycgPyAwLjUgOiBhcnJvd0hlaWdodCArIDAuNTtcbiAgICBYMiA9IGRpcmVjdGlvbiA9PSAnKycgPyBhcnJvd0hlaWdodCArIDAuNSA6IDAuNTtcbiAgICBmb3IgKHZhciBpID0gTWF0aC5mbG9vcihzdGFydFgpICsgMjsgaSA8IGVuZFggLSBhcnJvd0hlaWdodDsgaSArPSA3KSB7XG4gICAgICBjdHgubW92ZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0IC0gYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgICAgY3R4LmxpbmVUbyhpICsgWDIsIGxpbmVZICsgaGFsZkhlaWdodCArIDAuNSk7XG4gICAgICBjdHgubGluZVRvKGkgKyBYMSwgbGluZVkgKyBoYWxmSGVpZ2h0ICsgYXJyb3dIZWlnaHQgKyAwLjUpO1xuICAgIH1cbiAgICBjdHguc3Ryb2tlKCk7XG4gIH0sXG4gIFxuICBkcmF3RmVhdHVyZTogZnVuY3Rpb24oY3R4LCB3aWR0aCwgZGF0YSwgaSwgbGluZUhlaWdodCkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGNvbG9yID0gc2VsZi5vcHRzLmNvbG9yLFxuICAgICAgeSA9IGkgKiBsaW5lSGVpZ2h0LFxuICAgICAgaGFsZkhlaWdodCA9IE1hdGgucm91bmQoMC41ICogKGxpbmVIZWlnaHQgLSAxKSksXG4gICAgICBxdWFydGVySGVpZ2h0ID0gTWF0aC5jZWlsKDAuMjUgKiAobGluZUhlaWdodCAtIDEpKSxcbiAgICAgIGxpbmVHYXAgPSBsaW5lSGVpZ2h0ID4gNiA/IDIgOiAxLFxuICAgICAgdGhpY2tPdmVybGFwID0gbnVsbCxcbiAgICAgIHByZXZCSW50ID0gbnVsbDtcbiAgICBcbiAgICAvLyBGaXJzdCwgZGV0ZXJtaW5lIGFuZCBzZXQgdGhlIGNvbG9yIHdlIHdpbGwgYmUgdXNpbmdcbiAgICAvLyBOb3RlIHRoYXQgdGhlIGRlZmF1bHQgY29sb3Igd2FzIGFscmVhZHkgc2V0IGluIGRyYXdTcGVjXG4gICAgaWYgKHNlbGYub3B0cy5hbHRDb2xvciAmJiBkYXRhLmQuc3RyYW5kID09ICctJykgeyBjb2xvciA9IHNlbGYub3B0cy5hbHRDb2xvcjsgfVxuICAgIFxuICAgIGlmIChzZWxmLm9wdHMuaXRlbVJnYiAmJiBkYXRhLmQuaXRlbVJnYiAmJiB0aGlzLnZhbGlkYXRlQ29sb3IoZGF0YS5kLml0ZW1SZ2IpKSB7IGNvbG9yID0gZGF0YS5kLml0ZW1SZ2I7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLnVzZVNjb3JlKSB7IGNvbG9yID0gc2VsZi50eXBlKCdiZWQnKS5jYWxjR3JhZGllbnQoY29sb3IsIGRhdGEuZC5zY29yZSk7IH1cbiAgICBcbiAgICBpZiAoc2VsZi5vcHRzLml0ZW1SZ2IgfHwgc2VsZi5vcHRzLmFsdENvbG9yIHx8IHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gY3R4LnN0cm9rZVN0eWxlID0gXCJyZ2IoXCIgKyBjb2xvciArIFwiKVwiOyB9XG4gICAgXG4gICAgaWYgKGRhdGEudGhpY2tJbnQpIHtcbiAgICAgIC8vIFRoZSBjb2RpbmcgcmVnaW9uIGlzIGRyYXduIGFzIGEgdGhpY2tlciBsaW5lIHdpdGhpbiB0aGUgZ2VuZVxuICAgICAgaWYgKGRhdGEuYmxvY2tJbnRzKSB7XG4gICAgICAgIC8vIElmIHRoZXJlIGFyZSBleG9ucyBhbmQgaW50cm9ucywgZHJhdyB0aGUgaW50cm9ucyB3aXRoIGEgMXB4IGxpbmVcbiAgICAgICAgcHJldkJJbnQgPSBudWxsO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0LCBkYXRhLnBJbnQudywgMSk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yO1xuICAgICAgICBfLmVhY2goZGF0YS5ibG9ja0ludHMsIGZ1bmN0aW9uKGJJbnQpIHtcbiAgICAgICAgICBpZiAoYkludC54ICsgYkludC53IDw9IHdpZHRoICYmIGJJbnQueCA+PSAwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoYkludC54LCB5ICsgaGFsZkhlaWdodCAtIHF1YXJ0ZXJIZWlnaHQgKyAxLCBiSW50LncsIHF1YXJ0ZXJIZWlnaHQgKiAyIC0gMSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaWNrT3ZlcmxhcCA9IHV0aWxzLnBpeEludGVydmFsT3ZlcmxhcChiSW50LCBkYXRhLnRoaWNrSW50KTtcbiAgICAgICAgICBpZiAodGhpY2tPdmVybGFwKSB7XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QodGhpY2tPdmVybGFwLngsIHkgKyAxLCB0aGlja092ZXJsYXAudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgaW50cm9ucywgYXJyb3dzIGFyZSBkcmF3biBvbiB0aGUgaW50cm9ucywgbm90IHRoZSBleG9ucy4uLlxuICAgICAgICAgIGlmIChkYXRhLmQuc3RyYW5kICYmIHByZXZCSW50KSB7XG4gICAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBcInJnYihcIiArIGNvbG9yICsgXCIpXCI7XG4gICAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgcHJldkJJbnQueCArIHByZXZCSW50LncsIGJJbnQueCwgZGF0YS5kLnN0cmFuZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHByZXZCSW50ID0gYkludDtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIC4uLnVubGVzcyB0aGVyZSB3ZXJlIG5vIGludHJvbnMuIFRoZW4gaXQgaXMgZHJhd24gb24gdGhlIGNvZGluZyByZWdpb24uXG4gICAgICAgIGlmIChkYXRhLmJsb2NrSW50cy5sZW5ndGggPT0gMSkge1xuICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdBcnJvd3MoY3R4LCB3aWR0aCwgeSwgaGFsZkhlaWdodCwgZGF0YS50aGlja0ludC54LCBkYXRhLnRoaWNrSW50LnggKyBkYXRhLnRoaWNrSW50LncsIGRhdGEuZC5zdHJhbmQpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBXZSBoYXZlIGEgY29kaW5nIHJlZ2lvbiBidXQgbm8gaW50cm9ucy9leG9uc1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyBoYWxmSGVpZ2h0IC0gcXVhcnRlckhlaWdodCArIDEsIGRhdGEucEludC53LCBxdWFydGVySGVpZ2h0ICogMiAtIDEpO1xuICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS50aGlja0ludC54LCB5ICsgMSwgZGF0YS50aGlja0ludC53LCBsaW5lSGVpZ2h0IC0gbGluZUdhcCk7XG4gICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IFwid2hpdGVcIjtcbiAgICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEudGhpY2tJbnQueCwgZGF0YS50aGlja0ludC54ICsgZGF0YS50aGlja0ludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm90aGluZyBmYW5jeS4gIEl0J3MgYSBib3guXG4gICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIHkgKyAxLCBkYXRhLnBJbnQudywgbGluZUhlaWdodCAtIGxpbmVHYXApO1xuICAgICAgY3R4LnN0cm9rZVN0eWxlID0gXCJ3aGl0ZVwiO1xuICAgICAgc2VsZi50eXBlKCdiZWQnKS5kcmF3QXJyb3dzKGN0eCwgd2lkdGgsIHksIGhhbGZIZWlnaHQsIGRhdGEucEludC54LCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCBkYXRhLmQuc3RyYW5kKTtcbiAgICB9XG4gIH0sXG4gIFxuICBkcmF3U3BlYzogZnVuY3Rpb24oY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSkge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSBzZWxmLm9wdHMudXJsID8gc2VsZi5vcHRzLnVybCA6ICdqYXZhc2NyaXB0OnZvaWQoXCInK3NlbGYub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgZHJhd0xpbWl0ID0gc2VsZi5vcHRzLmRyYXdMaW1pdCAmJiBzZWxmLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMTUgOiA2LFxuICAgICAgY29sb3IgPSBzZWxmLm9wdHMuY29sb3IsXG4gICAgICBhcmVhcyA9IG51bGw7XG4gICAgXG4gICAgaWYgKCFjdHgpIHsgdGhyb3cgXCJDYW52YXMgbm90IHN1cHBvcnRlZFwiOyB9XG4gICAgLy8gVE9ETzogSSBkaXNhYmxlZCByZWdlbmVyYXRpbmcgYXJlYXMgaGVyZSwgd2hpY2ggYXNzdW1lcyB0aGF0IGxpbmVOdW0gcmVtYWlucyBzdGFibGUgYWNyb3NzIHJlLXJlbmRlcnMuIFNob3VsZCBjaGVjayBvbiB0aGlzLlxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJyAmJiAhc2VsZi5hcmVhc1tjYW52YXMuaWRdKSB7IGFyZWFzID0gc2VsZi5hcmVhc1tjYW52YXMuaWRdID0gW107IH1cbiAgICBcbiAgICBpZiAoZGVuc2l0eSA9PSAnZGVuc2UnKSB7XG4gICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICBjdHguZmlsbFN0eWxlID0gXCJyZ2IoXCIrY29sb3IrXCIpXCI7XG4gICAgICBfLmVhY2goZHJhd1NwZWMsIGZ1bmN0aW9uKHBJbnQpIHtcbiAgICAgICAgaWYgKHNlbGYub3B0cy51c2VTY29yZSkgeyBjdHguZmlsbFN0eWxlID0gXCJyZ2JhKFwiK3NlbGYudHlwZSgnYmVkJykuY2FsY0dyYWRpZW50KGNvbG9yLCBwSW50LnYpK1wiKVwiOyB9XG4gICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxheW91dCAmJiBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoID4gZHJhd0xpbWl0KSB8fCBkcmF3U3BlYy50b29NYW55KSB7IFxuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMDtcbiAgICAgICAgLy8gVGhpcyBhcHBsaWVzIHN0eWxpbmcgdGhhdCBpbmRpY2F0ZXMgdGhlcmUgd2FzIHRvbyBtdWNoIGRhdGEgdG8gbG9hZC9kcmF3IGFuZCB0aGF0IHRoZSB1c2VyIG5lZWRzIHRvIHpvb20gdG8gc2VlIG1vcmVcbiAgICAgICAgY2FudmFzLmNsYXNzTmFtZSA9IGNhbnZhcy5jbGFzc05hbWUgKyAnIHRvby1tYW55JztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FudmFzLmhlaWdodCA9IGRyYXdTcGVjLmxheW91dC5sZW5ndGggKiBsaW5lSGVpZ2h0O1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IGN0eC5zdHJva2VTdHlsZSA9IFwicmdiKFwiK2NvbG9yK1wiKVwiO1xuICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICBfLmVhY2gobCwgZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuZHJhd0ZlYXR1cmUuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLndpZHRoLCBkYXRhLCBpLCBsaW5lSGVpZ2h0KTsgICAgICAgICAgICAgIFxuICAgICAgICAgIHNlbGYudHlwZSgnYmVkJykuYWRkQXJlYS5jYWxsKHNlbGYsIGFyZWFzLCBkYXRhLCBpLCBsaW5lSGVpZ2h0LCB1cmxUZW1wbGF0ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoKS5kcmF3U3BlYy5jYWxsKHNlbGYsIGNhbnZhcywgZHJhd1NwZWMsIGRlbnNpdHkpO1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgY2FsbGJhY2soKTsgfVxuICAgIH0pO1xuICB9LFxuXG4gIGxvYWRPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBjb2xvckJ5U3RyYW5kT24gPSAvXFxkKyxcXGQrLFxcZCtcXHMrXFxkKyxcXGQrLFxcZCsvLnRlc3Qoby5jb2xvckJ5U3RyYW5kKSxcbiAgICAgIGNvbG9yQnlTdHJhbmQgPSBjb2xvckJ5U3RyYW5kT24gPyBvLmNvbG9yQnlTdHJhbmQuc3BsaXQoL1xccysvKVsxXSA6ICcwLDAsMCc7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuYXR0cignY2hlY2tlZCcsICEhY29sb3JCeVN0cmFuZE9uKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPWNvbG9yQnlTdHJhbmRdJykudmFsKGNvbG9yQnlTdHJhbmQpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXNlU2NvcmVdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnVzZVNjb3JlKSk7ICAgIFxuICAgICRkaWFsb2cuZmluZCgnW25hbWU9dXJsXScpLnZhbChvLnVybCk7XG4gIH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgY29sb3JCeVN0cmFuZE9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kT25dJykuaXMoJzpjaGVja2VkJyksXG4gICAgICBjb2xvckJ5U3RyYW5kID0gJGRpYWxvZy5maW5kKCdbbmFtZT1jb2xvckJ5U3RyYW5kXScpLnZhbCgpLFxuICAgICAgdmFsaWRDb2xvckJ5U3RyYW5kID0gdGhpcy52YWxpZGF0ZUNvbG9yKGNvbG9yQnlTdHJhbmQpO1xuICAgIG8uY29sb3JCeVN0cmFuZCA9IGNvbG9yQnlTdHJhbmRPbiAmJiB2YWxpZENvbG9yQnlTdHJhbmQgPyBvLmNvbG9yICsgJyAnICsgY29sb3JCeVN0cmFuZCA6ICcnO1xuICAgIG8udXNlU2NvcmUgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVzZVNjb3JlXScpLmlzKCc6Y2hlY2tlZCcpID8gMSA6IDA7XG4gICAgby51cmwgPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPXVybF0nKS52YWwoKTtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkRm9ybWF0OyIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmVkR3JhcGggZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC9iZWRncmFwaC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmVkZ3JhcGhcbnZhciBCZWRHcmFwaEZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBhbHRDb2xvcjogJycsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdC5jYWxsKHRoaXMpOyB9LFxuICBcbiAgX2JpbkZ1bmN0aW9uczogdXRpbHMud2lnQmluRnVuY3Rpb25zLFxuICBcbiAgaW5pdE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7IH0sXG4gIFxuICBhcHBseU9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmFwcGx5T3B0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9LFxuICBcbiAgcGFyc2U6IGZ1bmN0aW9uKGxpbmVzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgZ2Vub21lU2l6ZSA9IHRoaXMuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSxcbiAgICAgIGRhdGEgPSB7YWxsOiBbXX0sXG4gICAgICBtb2RlLCBtb2RlT3B0cywgY2hyUG9zLCBtO1xuICAgIHNlbGYucmFuZ2UgPSBzZWxmLmlzT24odGhpcy5vcHRzLmFsd2F5c1plcm8pID8gWzAsIDBdIDogW0luZmluaXR5LCAtSW5maW5pdHldO1xuICBcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGNvbHMgPSBbJ2Nocm9tJywgJ2Nocm9tU3RhcnQnLCAnY2hyb21FbmQnLCAnZGF0YVZhbHVlJ10sXG4gICAgICAgIGRhdHVtID0ge30sXG4gICAgICAgIGNoclBvcywgc3RhcnQsIGVuZCwgdmFsO1xuICAgICAgXy5lYWNoKGxpbmUuc3BsaXQoL1xccysvKSwgZnVuY3Rpb24odiwgaSkgeyBkYXR1bVtjb2xzW2ldXSA9IHY7IH0pO1xuICAgICAgY2hyUG9zID0gc2VsZi5icm93c2VyT3B0cy5jaHJQb3NbZGF0dW0uY2hyb21dO1xuICAgICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgIH1cbiAgICAgIHN0YXJ0ID0gcGFyc2VJbnQxMChkYXR1bS5jaHJvbVN0YXJ0KTtcbiAgICAgIGVuZCA9IHBhcnNlSW50MTAoZGF0dW0uY2hyb21FbmQpO1xuICAgICAgdmFsID0gcGFyc2VGbG9hdChkYXR1bS5kYXRhVmFsdWUpO1xuICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIGVuZCwgdmFsOiB2YWx9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGluaXREcmF3U3BlYzogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5wcmVyZW5kZXIuY2FsbCh0aGlzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjayk7XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLnJlbmRlci5jYWxsKHRoaXMsIGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spO1xuICB9LFxuICBcbiAgbG9hZE9wdHM6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy50eXBlKCd3aWdnbGVfMCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxuICBcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmVkR3JhcGhGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA9IGJpZ0JlZCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL2JpZ0JlZC5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL3V0aWxzL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTtcbnZhciBSZW1vdGVUcmFjayA9IHJlcXVpcmUoJy4vdXRpbHMvUmVtb3RlVHJhY2suanMnKS5SZW1vdGVUcmFjaztcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMuYmlnYmVkXG52YXIgQmlnQmVkRm9ybWF0ID0ge1xuICBkZWZhdWx0czoge1xuICAgIGNocm9tb3NvbWVzOiAnJyxcbiAgICBpdGVtUmdiOiAnb2ZmJyxcbiAgICBjb2xvckJ5U3RyYW5kOiAnJyxcbiAgICB1c2VTY29yZTogMCxcbiAgICBncm91cDogJ3VzZXInLFxuICAgIHByaW9yaXR5OiAndXNlcicsXG4gICAgb2Zmc2V0OiAwLFxuICAgIGRldGFpbDogZmFsc2UsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMFxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgYmlnQmVkIHRyYWNrIGF0IFwiICsgSlNPTi5zdHJpbmdpZnkodGhpcy5vcHRzKSArICh0aGlzLm9wdHMubGluZU51bSArIDEpKTtcbiAgICB9XG4gIH0sXG4gIFxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgY2FjaGUgPSBuZXcgSW50ZXJ2YWxUcmVlKGZsb29ySGFjayhtaWRkbGVpc2hQb3MpLCB7c3RhcnRLZXk6ICdzdGFydCcsIGVuZEtleTogJ2VuZCd9KSxcbiAgICAgIGFqYXhVcmwgPSBzZWxmLmFqYXhEaXIoKSArICdiaWdiZWQucGhwJyxcbiAgICAgIHJlbW90ZTtcbiAgICBcbiAgICByZW1vdGUgPSBuZXcgUmVtb3RlVHJhY2soY2FjaGUsIGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIHN0b3JlSW50ZXJ2YWxzKSB7XG4gICAgICByYW5nZSA9IHNlbGYuY2hyUmFuZ2Uoc3RhcnQsIGVuZCk7XG4gICAgICAkLmFqYXgoYWpheFVybCwge1xuICAgICAgICBkYXRhOiB7cmFuZ2U6IHJhbmdlLCB1cmw6IHNlbGYub3B0cy5iaWdEYXRhVXJsLCBkZW5zaXR5OiAncGFjayd9LFxuICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgdmFyIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID49IDI7IH0pO1xuICAgICAgICAgIHZhciBpbnRlcnZhbHMgPSBfLm1hcChsaW5lcywgZnVuY3Rpb24obCkgeyBcbiAgICAgICAgICAgIHZhciBpdHZsID0gc2VsZi50eXBlKCdiZWQnKS5wYXJzZUxpbmUuY2FsbChzZWxmLCBsKTsgXG4gICAgICAgICAgICAvLyBVc2UgQmlvUGVybCdzIEJpbzo6REI6QmlnQmVkIHN0cmF0ZWd5IGZvciBkZWR1cGxpY2F0aW5nIHJlLWZldGNoZWQgaW50ZXJ2YWxzOlxuICAgICAgICAgICAgLy8gXCJCZWNhdXNlIEJFRCBmaWxlcyBkb24ndCBhY3R1YWxseSB1c2UgSURzLCB0aGUgSUQgaXMgY29uc3RydWN0ZWQgZnJvbSB0aGUgZmVhdHVyZSdzIG5hbWUgKGlmIGFueSksIGNocm9tb3NvbWUgY29vcmRpbmF0ZXMsIHN0cmFuZCBhbmQgYmxvY2sgY291bnQuXCJcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGl0dmwuaWQpKSB7XG4gICAgICAgICAgICAgIGl0dmwuaWQgPSBbaXR2bC5uYW1lLCBpdHZsLmNocm9tLCBpdHZsLmNocm9tU3RhcnQsIGl0dmwuY2hyb21FbmQsIGl0dmwuc3RyYW5kLCBpdHZsLmJsb2NrQ291bnRdLmpvaW4oXCJcXHRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaXR2bDtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICBzZWxmLmRhdGEgPSB7Y2FjaGU6IGNhY2hlLCByZW1vdGU6IHJlbW90ZX07XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICBcbiAgICAvLyBHZXQgZ2VuZXJhbCBpbmZvIG9uIHRoZSBiaWdCZWQgYW5kIHNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhlIFJlbW90ZVRyYWNrXG4gICAgJC5hamF4KGFqYXhVcmwsIHtcbiAgICAgIGRhdGE6IHsgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCB9LFxuICAgICAgc3VjY2VzczogZnVuY3Rpb24oZGF0YSkge1xuICAgICAgICAvLyBTZXQgbWF4RmV0Y2hXaW5kb3cgdG8gYXZvaWQgb3ZlcmZldGNoaW5nIGRhdGEuXG4gICAgICAgIGlmICghc2VsZi5vcHRzLm1heEZldGNoV2luZG93KSB7XG4gICAgICAgICAgdmFyIG1lYW5JdGVtc1BlckJwID0gZGF0YS5pdGVtQ291bnQgLyBzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICAgICAgICBtYXhJdGVtc1RvRHJhdyA9IF8ubWF4KF8udmFsdWVzKHNlbGYub3B0cy5kcmF3TGltaXQpKTtcbiAgICAgICAgICBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cgPSBtYXhJdGVtc1RvRHJhdyAvIG1lYW5JdGVtc1BlckJwO1xuICAgICAgICAgIHNlbGYub3B0cy5vcHRpbWFsRmV0Y2hXaW5kb3cgPSBNYXRoLmZsb29yKHNlbGYub3B0cy5tYXhGZXRjaFdpbmRvdyAvIDMpO1xuICAgICAgICB9XG4gICAgICAgIHJlbW90ZS5zZXR1cEJpbnMoc2VsZi5icm93c2VyT3B0cy5nZW5vbWVTaXplLCBzZWxmLm9wdHMub3B0aW1hbEZldGNoV2luZG93LCBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lTnVtKGQsIHNldFRvKSB7XG4gICAgICB2YXIga2V5ID0gYnBwcCArICdfJyArIGRlbnNpdHk7XG4gICAgICBpZiAoIV8uaXNVbmRlZmluZWQoc2V0VG8pKSB7IFxuICAgICAgICBpZiAoIWQubGluZSkgeyBkLmxpbmUgPSB7fTsgfVxuICAgICAgICByZXR1cm4gKGQubGluZVtrZXldID0gc2V0VG8pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGQubGluZSAmJiBkLmxpbmVba2V5XTsgXG4gICAgfVxuICAgIFxuICAgIGZ1bmN0aW9uIHBhcnNlRGVuc2VEYXRhKGRhdGEpIHtcbiAgICAgIHZhciBkcmF3U3BlYyA9IFtdLCBcbiAgICAgICAgbGluZXM7XG4gICAgICBsaW5lcyA9IGRhdGEuc3BsaXQoL1xccysvZyk7XG4gICAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIHgpIHsgXG4gICAgICAgIGlmIChsaW5lICE9ICduL2EnICYmIGxpbmUubGVuZ3RoKSB7IGRyYXdTcGVjLnB1c2goe3g6IHgsIHc6IDEsIHY6IHBhcnNlRmxvYXQobGluZSkgKiAxMDAwfSk7IH0gXG4gICAgICB9KTtcbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRG9uJ3QgZXZlbiBhdHRlbXB0IHRvIGZldGNoIHRoZSBkYXRhIGlmIGRlbnNpdHkgaXMgbm90ICdkZW5zZScgYW5kIHdlIGNhbiByZWFzb25hYmx5XG4gICAgLy8gZXN0aW1hdGUgdGhhdCB3ZSB3aWxsIGZldGNoIHRvbyBtYW55IHJvd3MgKD41MDAgZmVhdHVyZXMpLCBhcyB0aGlzIHdpbGwgb25seSBkZWxheSBvdGhlciByZXF1ZXN0cy5cbiAgICBpZiAoZGVuc2l0eSAhPSAnZGVuc2UnICYmIChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgJC5hamF4KHNlbGYuYWpheERpcigpICsgJ2JpZ2JlZC5waHAnLCB7XG4gICAgICAgICAgZGF0YToge3JhbmdlOiByYW5nZSwgdXJsOiBzZWxmLm9wdHMuYmlnRGF0YVVybCwgd2lkdGg6IHdpZHRoLCBkZW5zaXR5OiBkZW5zaXR5fSxcbiAgICAgICAgICBzdWNjZXNzOiBwYXJzZURlbnNlRGF0YVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYuZGF0YS5yZW1vdGUuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBmdW5jdGlvbihpbnRlcnZhbHMpIHtcbiAgICAgICAgICB2YXIgY2FsY1BpeEludGVydmFsLCBkcmF3U3BlYyA9IHt9O1xuICAgICAgICAgIGlmIChpbnRlcnZhbHMudG9vTWFueSkgeyByZXR1cm4gY2FsbGJhY2soaW50ZXJ2YWxzKTsgfVxuICAgICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5ID09ICdwYWNrJyk7XG4gICAgICAgICAgZHJhd1NwZWMubGF5b3V0ID0gc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0LmNhbGwoc2VsZiwgaW50ZXJ2YWxzLCB3aWR0aCwgY2FsY1BpeEludGVydmFsLCBsaW5lTnVtKTtcbiAgICAgICAgICBkcmF3U3BlYy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IGNhbnZhcy53aWR0aH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ2JlZCcpLmRyYXdTcGVjLmNhbGwoc2VsZiwgY2FudmFzLCBkcmF3U3BlYywgZGVuc2l0eSk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQmlnQmVkRm9ybWF0OyIsIlxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gYmlnV2lnIGZvcm1hdDogaHR0cDovL2dlbm9tZS51Y3NjLmVkdS9nb2xkZW5QYXRoL2hlbHAvYmlnV2lnLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciBCaWdXaWdGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcxMjgsMTI4LDEyOCcsXG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBhdXRvU2NhbGU6ICdvbicsXG4gICAgYWx3YXlzWmVybzogJ29mZicsXG4gICAgZ3JpZERlZmF1bHQ6ICdvZmYnLFxuICAgIG1heEhlaWdodFBpeGVsczogJzEyODoxMjg6MTUnLFxuICAgIGdyYXBoVHlwZTogJ2JhcicsXG4gICAgdmlld0xpbWl0czogJycsXG4gICAgeUxpbmVNYXJrOiAwLjAsXG4gICAgeUxpbmVPbk9mZjogJ29mZicsXG4gICAgd2luZG93aW5nRnVuY3Rpb246ICdtYXhpbXVtJyxcbiAgICBzbW9vdGhpbmdXaW5kb3c6ICdvZmYnXG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLm9wdHMuYmlnRGF0YVVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWlyZWQgcGFyYW1ldGVyIGJpZ0RhdGFVcmwgbm90IGZvdW5kIGZvciBiaWdXaWcgdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgICB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdE9wdHMuY2FsbCh0aGlzKTtcbiAgfSxcbiAgXG4gIF9iaW5GdW5jdGlvbnM6IHsnbWluaW11bSc6MSwgJ21heGltdW0nOjEsICdtZWFuJzoxLCAnbWluJzoxLCAnbWF4JzoxLCAnc3RkJzoxLCAnY292ZXJhZ2UnOjF9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHNlbGYub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtpbmZvOiAxLCB1cmw6IHRoaXMub3B0cy5iaWdEYXRhVXJsfSxcbiAgICAgIGFzeW5jOiBmYWxzZSwgIC8vIFRoaXMgaXMgY29vbCBzaW5jZSBwYXJzaW5nIG5vcm1hbGx5IGhhcHBlbnMgaW4gYSBXZWIgV29ya2VyXG4gICAgICBzdWNjZXNzOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgIHZhciByb3dzID0gZGF0YS5zcGxpdChcIlxcblwiKTtcbiAgICAgICAgXy5lYWNoKHJvd3MsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICB2YXIga2V5dmFsID0gci5zcGxpdCgnOiAnKTtcbiAgICAgICAgICBpZiAoa2V5dmFsWzBdPT0nbWluJykgeyBzZWxmLnJhbmdlWzBdID0gTWF0aC5taW4ocGFyc2VGbG9hdChrZXl2YWxbMV0pLCBzZWxmLnJhbmdlWzBdKTsgfVxuICAgICAgICAgIGlmIChrZXl2YWxbMF09PSdtYXgnKSB7IHNlbGYucmFuZ2VbMV0gPSBNYXRoLm1heChwYXJzZUZsb2F0KGtleXZhbFsxXSksIHNlbGYucmFuZ2VbMV0pOyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYudHlwZSgnd2lnZ2xlXzAnKS5hcHBseU9wdHMuYXBwbHkoc2VsZik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIHdpZHRoID0gcHJlY2FsYy53aWR0aCxcbiAgICAgIGNoclJhbmdlID0gc2VsZi5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgXG4gICAgZnVuY3Rpb24gc3VjY2VzcyhkYXRhKSB7XG4gICAgICB2YXIgZHJhd1NwZWMgPSBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuaW5pdERyYXdTcGVjLmNhbGwoc2VsZiwgcHJlY2FsYyksXG4gICAgICAgIGxpbmVzID0gZGF0YS5zcGxpdCgvXFxzKy9nKTtcbiAgICAgIF8uZWFjaChsaW5lcywgZnVuY3Rpb24obGluZSkge1xuICAgICAgICBpZiAobGluZSA9PSAnbi9hJykgeyBkcmF3U3BlYy5iYXJzLnB1c2gobnVsbCk7IH1cbiAgICAgICAgZWxzZSBpZiAobGluZS5sZW5ndGgpIHsgZHJhd1NwZWMuYmFycy5wdXNoKChwYXJzZUZsb2F0KGxpbmUpIC0gc2VsZi5kcmF3UmFuZ2VbMF0pIC8gZHJhd1NwZWMudlNjYWxlKTsgfVxuICAgICAgfSk7XG4gICAgICBjYWxsYmFjayhkcmF3U3BlYyk7XG4gICAgfVxuICBcbiAgICAkLmFqYXgoc2VsZi5hamF4RGlyKCkgKyAnYmlnd2lnLnBocCcsIHtcbiAgICAgIGRhdGE6IHtyYW5nZTogY2hyUmFuZ2UsIHVybDogc2VsZi5vcHRzLmJpZ0RhdGFVcmwsIHdpZHRoOiB3aWR0aCwgd2luRnVuYzogc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9ufSxcbiAgICAgIHN1Y2Nlc3M6IHN1Y2Nlc3NcbiAgICB9KTtcbiAgfSxcblxuICByZW5kZXI6IGZ1bmN0aW9uKGNhbnZhcywgc3RhcnQsIGVuZCwgZGVuc2l0eSwgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBoZWlnaHQgPSBjYW52YXMuaGVpZ2h0LFxuICAgICAgd2lkdGggPSBjYW52YXMud2lkdGgsXG4gICAgICBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCAmJiBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBpZiAoIWN0eCkgeyB0aHJvdyBcIkNhbnZhcyBub3Qgc3VwcG9ydGVkXCI7IH1cbiAgICBzZWxmLnByZXJlbmRlcihzdGFydCwgZW5kLCBkZW5zaXR5LCB7d2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodH0sIGZ1bmN0aW9uKGRyYXdTcGVjKSB7XG4gICAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuZHJhd0JhcnMuY2FsbChzZWxmLCBjdHgsIGRyYXdTcGVjLCBoZWlnaHQsIHdpZHRoKTtcbiAgICAgIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcblxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykubG9hZE9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcblxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ3dpZ2dsZV8wJykuc2F2ZU9wdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBCaWdXaWdGb3JtYXQ7IiwiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBmZWF0dXJlVGFibGUgZm9ybWF0OiBodHRwOi8vd3d3Lmluc2RjLm9yZy9maWxlcy9mZWF0dXJlX3RhYmxlLmh0bWwgPVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG52YXIgSW50ZXJ2YWxUcmVlID0gcmVxdWlyZSgnLi91dGlscy9JbnRlcnZhbFRyZWUuanMnKS5JbnRlcnZhbFRyZWU7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWxzLmpzJyksXG4gIHN0cmlwID0gdXRpbHMuc3RyaXAsXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjayxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLmZlYXR1cmV0YWJsZVxudmFyIEZlYXR1cmVUYWJsZUZvcm1hdCA9IHtcbiAgZGVmYXVsdHM6IHtcbiAgICBjb2xsYXBzZUJ5R2VuZTogJ29mZicsXG4gICAga2V5Q29sdW1uV2lkdGg6IDIxLFxuICAgIGl0ZW1SZ2I6ICdvZmYnLFxuICAgIGNvbG9yQnlTdHJhbmQ6ICcnLFxuICAgIHVzZVNjb3JlOiAwLFxuICAgIGdyb3VwOiAndXNlcicsXG4gICAgcHJpb3JpdHk6ICd1c2VyJyxcbiAgICBvZmZzZXQ6IDAsXG4gICAgdXJsOiAnJyxcbiAgICBodG1sVXJsOiAnJyxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IG51bGwsIHBhY2s6IG51bGx9XG4gIH0sXG4gIFxuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnR5cGUoJ2JlZCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gICAgdGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lID0gdGhpcy5pc09uKHRoaXMub3B0cy5jb2xsYXBzZUJ5R2VuZSk7XG4gICAgdGhpcy5mZWF0dXJlVHlwZUNvdW50cyA9IHt9O1xuICB9LFxuICBcbiAgLy8gcGFyc2VzIG9uZSBmZWF0dXJlIGtleSArIGxvY2F0aW9uL3F1YWxpZmllcnMgcm93IGZyb20gdGhlIGZlYXR1cmUgdGFibGVcbiAgcGFyc2VFbnRyeTogZnVuY3Rpb24oY2hyb20sIGxpbmVzLCBzdGFydExpbmVObykge1xuICAgIHZhciBmZWF0dXJlID0ge1xuICAgICAgICBjaHJvbTogY2hyb20sXG4gICAgICAgIHNjb3JlOiAnPycsXG4gICAgICAgIGJsb2NrczogbnVsbCxcbiAgICAgICAgcXVhbGlmaWVyczoge31cbiAgICAgIH0sXG4gICAgICBrZXlDb2x1bW5XaWR0aCA9IHRoaXMub3B0cy5rZXlDb2x1bW5XaWR0aCxcbiAgICAgIHF1YWxpZmllciA9IG51bGwsXG4gICAgICBmdWxsTG9jYXRpb24gPSBbXSxcbiAgICAgIGNvbGxhcHNlS2V5UXVhbGlmaWVycyA9IFsnbG9jdXNfdGFnJywgJ2dlbmUnLCAnZGJfeHJlZiddLFxuICAgICAgcXVhbGlmaWVyc1RoYXRBcmVOYW1lcyA9IFsnZ2VuZScsICdsb2N1c190YWcnLCAnZGJfeHJlZiddLFxuICAgICAgUk5BVHlwZXMgPSBbJ3JybmEnLCAndHJuYSddLFxuICAgICAgYWxzb1RyeUZvclJOQVR5cGVzID0gWydwcm9kdWN0J10sXG4gICAgICBsb2NhdGlvblBvc2l0aW9ucywgY2hyUG9zLCBibG9ja1NpemVzO1xuICAgIFxuICAgIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zW2Nocm9tXTtcbiAgICBzdGFydExpbmVObyA9IHN0YXJ0TGluZU5vIHx8IDA7XG4gICAgaWYgKF8uaXNVbmRlZmluZWQoY2hyUG9zKSkge1xuICAgICAgdGhpcy53YXJuKFwiSW52YWxpZCBjaHJvbW9zb21lIGF0IGxpbmUgXCIgKyAobGluZW5vICsgMSArIHRoaXMub3B0cy5saW5lTnVtKSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgXG4gICAgLy8gZmlsbCBvdXQgZmVhdHVyZSdzIGtleXMgd2l0aCBpbmZvIGZyb20gdGhlc2UgbGluZXNcbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgdmFyIGtleSA9IGxpbmUuc3Vic3RyKDAsIGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcmVzdE9mTGluZSA9IGxpbmUuc3Vic3RyKGtleUNvbHVtbldpZHRoKSxcbiAgICAgICAgcXVhbGlmaWVyTWF0Y2ggPSByZXN0T2ZMaW5lLm1hdGNoKC9eXFwvKFxcdyspKD0/KSguKikvKTtcbiAgICAgIGlmIChrZXkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGZlYXR1cmUudHlwZSA9IHN0cmlwKGtleSk7XG4gICAgICAgIHF1YWxpZmllciA9IG51bGw7XG4gICAgICAgIGZ1bGxMb2NhdGlvbi5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHF1YWxpZmllck1hdGNoKSB7XG4gICAgICAgICAgcXVhbGlmaWVyID0gcXVhbGlmaWVyTWF0Y2hbMV07XG4gICAgICAgICAgaWYgKCFmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSkgeyBmZWF0dXJlLnF1YWxpZmllcnNbcXVhbGlmaWVyXSA9IFtdOyB9XG4gICAgICAgICAgZmVhdHVyZS5xdWFsaWZpZXJzW3F1YWxpZmllcl0ucHVzaChbcXVhbGlmaWVyTWF0Y2hbMl0gPyBxdWFsaWZpZXJNYXRjaFszXSA6IHRydWVdKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAocXVhbGlmaWVyICE9PSBudWxsKSB7IFxuICAgICAgICAgICAgXy5sYXN0KGZlYXR1cmUucXVhbGlmaWVyc1txdWFsaWZpZXJdKS5wdXNoKHJlc3RPZkxpbmUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmdWxsTG9jYXRpb24ucHVzaChyZXN0T2ZMaW5lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICBmZWF0dXJlLmZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbiA9IGZ1bGxMb2NhdGlvbi5qb2luKCcnKTtcbiAgICBsb2NhdGlvblBvc2l0aW9ucyA9IF8ubWFwKF8uZmlsdGVyKGZ1bGxMb2NhdGlvbi5zcGxpdCgvXFxEKy8pLCBfLmlkZW50aXR5KSwgcGFyc2VJbnQxMCk7XG4gICAgZmVhdHVyZS5jaHJvbVN0YXJ0ID0gIF8ubWluKGxvY2F0aW9uUG9zaXRpb25zKTtcbiAgICBmZWF0dXJlLmNocm9tRW5kID0gXy5tYXgobG9jYXRpb25Qb3NpdGlvbnMpICsgMTsgLy8gRmVhdHVyZSB0YWJsZSByYW5nZXMgYXJlICppbmNsdXNpdmUqIG9mIHRoZSBlbmQgYmFzZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjaHJvbUVuZCBjb2x1bW5zIGluIEJFRCBmb3JtYXQgYXJlICpub3QqLlxuICAgIGZlYXR1cmUuc3RhcnQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tU3RhcnQ7XG4gICAgZmVhdHVyZS5lbmQgPSBjaHJQb3MgKyBmZWF0dXJlLmNocm9tRW5kOyBcbiAgICBmZWF0dXJlLnN0cmFuZCA9IC9jb21wbGVtZW50Ly50ZXN0KGZ1bGxMb2NhdGlvbikgPyBcIi1cIiA6IFwiK1wiO1xuICAgIFxuICAgIC8vIFVudGlsIHdlIG1lcmdlIGJ5IGdlbmUgbmFtZSwgd2UgZG9uJ3QgY2FyZSBhYm91dCB0aGVzZVxuICAgIGZlYXR1cmUudGhpY2tTdGFydCA9IGZlYXR1cmUudGhpY2tFbmQgPSBudWxsO1xuICAgIGZlYXR1cmUuYmxvY2tzID0gbnVsbDtcbiAgICBcbiAgICAvLyBQYXJzZSB0aGUgcXVhbGlmaWVycyBwcm9wZXJseVxuICAgIF8uZWFjaChmZWF0dXJlLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIF8uZWFjaCh2LCBmdW5jdGlvbihlbnRyeUxpbmVzLCBpKSB7XG4gICAgICAgIHZbaV0gPSBzdHJpcChlbnRyeUxpbmVzLmpvaW4oJyAnKSk7XG4gICAgICAgIGlmICgvXlwiW1xcc1xcU10qXCIkLy50ZXN0KHZbaV0pKSB7XG4gICAgICAgICAgLy8gRGVxdW90ZSBmcmVlIHRleHRcbiAgICAgICAgICB2W2ldID0gdltpXS5yZXBsYWNlKC9eXCJ8XCIkL2csICcnKS5yZXBsYWNlKC9cIlwiL2csICdcIicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vaWYgKHYubGVuZ3RoID09IDEpIHsgZmVhdHVyZS5xdWFsaWZpZXJzW2tdID0gdlswXTsgfVxuICAgIH0pO1xuICAgIFxuICAgIC8vIEZpbmQgc29tZXRoaW5nIHRoYXQgY2FuIHNlcnZlIGFzIGEgbmFtZVxuICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUudHlwZTtcbiAgICBpZiAoXy5jb250YWlucyhSTkFUeXBlcywgZmVhdHVyZS50eXBlLnRvTG93ZXJDYXNlKCkpKSB7IFxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkocXVhbGlmaWVyc1RoYXRBcmVOYW1lcywgYWxzb1RyeUZvclJOQVR5cGVzKTsgXG4gICAgfVxuICAgIF8uZmluZChxdWFsaWZpZXJzVGhhdEFyZU5hbWVzLCBmdW5jdGlvbihrKSB7XG4gICAgICBpZiAoZmVhdHVyZS5xdWFsaWZpZXJzW2tdICYmIGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSkgeyByZXR1cm4gKGZlYXR1cmUubmFtZSA9IGZlYXR1cmUucXVhbGlmaWVyc1trXVswXSk7IH1cbiAgICB9KTtcbiAgICAvLyBJbiB0aGUgd29yc3QgY2FzZSwgYWRkIGEgY291bnRlciB0byBkaXNhbWJpZ3VhdGUgZmVhdHVyZXMgbmFtZWQgb25seSBieSB0eXBlXG4gICAgaWYgKGZlYXR1cmUubmFtZSA9PSBmZWF0dXJlLnR5cGUpIHtcbiAgICAgIGlmICghdGhpcy5mZWF0dXJlVHlwZUNvdW50c1tmZWF0dXJlLnR5cGVdKSB7IHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSA9IDE7IH1cbiAgICAgIGZlYXR1cmUubmFtZSA9IGZlYXR1cmUubmFtZSArICdfJyArIHRoaXMuZmVhdHVyZVR5cGVDb3VudHNbZmVhdHVyZS50eXBlXSsrO1xuICAgIH1cbiAgICBcbiAgICAvLyBGaW5kIGEga2V5IHRoYXQgaXMgYXBwcm9wcmlhdGUgZm9yIGNvbGxhcHNpbmdcbiAgICBpZiAodGhpcy5vcHRzLmNvbGxhcHNlQnlHZW5lKSB7XG4gICAgICBfLmZpbmQoY29sbGFwc2VLZXlRdWFsaWZpZXJzLCBmdW5jdGlvbihrKSB7XG4gICAgICAgIGlmIChmZWF0dXJlLnF1YWxpZmllcnNba10gJiYgZmVhdHVyZS5xdWFsaWZpZXJzW2tdWzBdKSB7IFxuICAgICAgICAgIHJldHVybiAoZmVhdHVyZS5fY29sbGFwc2VLZXkgPSBmZWF0dXJlLnF1YWxpZmllcnNba11bMF0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZlYXR1cmU7XG4gIH0sXG4gIFxuICAvLyBjb2xsYXBzZXMgbXVsdGlwbGUgZmVhdHVyZXMgdGhhdCBhcmUgYWJvdXQgdGhlIHNhbWUgZ2VuZSBpbnRvIG9uZSBkcmF3YWJsZSBmZWF0dXJlXG4gIGNvbGxhcHNlRmVhdHVyZXM6IGZ1bmN0aW9uKGZlYXR1cmVzKSB7XG4gICAgdmFyIGNoclBvcyA9IHRoaXMuYnJvd3Nlck9wdHMuY2hyUG9zLFxuICAgICAgcHJlZmVycmVkVHlwZVRvTWVyZ2VJbnRvID0gWydtcm5hJywgJ2dlbmUnLCAnY2RzJ10sXG4gICAgICBwcmVmZXJyZWRUeXBlRm9yRXhvbnMgPSBbJ2V4b24nLCAnY2RzJ10sXG4gICAgICBtZXJnZUludG8gPSBmZWF0dXJlc1swXSxcbiAgICAgIGJsb2NrcyA9IFtdLFxuICAgICAgZm91bmRUeXBlLCBjZHMsIGV4b25zO1xuICAgIGZvdW5kVHlwZSA9IF8uZmluZChwcmVmZXJyZWRUeXBlVG9NZXJnZUludG8sIGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBmb3VuZCA9IF8uZmluZChmZWF0dXJlcywgZnVuY3Rpb24oZmVhdCkgeyByZXR1cm4gZmVhdC50eXBlLnRvTG93ZXJDYXNlKCkgPT0gdHlwZTsgfSk7XG4gICAgICBpZiAoZm91bmQpIHsgbWVyZ2VJbnRvID0gZm91bmQ7IHJldHVybiB0cnVlOyB9XG4gICAgfSk7XG4gICAgXG4gICAgLy8gTG9vayBmb3IgZXhvbnMgKGV1a2FyeW90aWMpIG9yIGEgQ0RTIChwcm9rYXJ5b3RpYylcbiAgICBfLmZpbmQocHJlZmVycmVkVHlwZUZvckV4b25zLCBmdW5jdGlvbih0eXBlKSB7XG4gICAgICBleG9ucyA9IF8uc2VsZWN0KGZlYXR1cmVzLCBmdW5jdGlvbihmZWF0KSB7IHJldHVybiBmZWF0LnR5cGUudG9Mb3dlckNhc2UoKSA9PSB0eXBlOyB9KTtcbiAgICAgIGlmIChleG9ucy5sZW5ndGgpIHsgcmV0dXJuIHRydWU7IH1cbiAgICB9KTtcbiAgICBjZHMgPSBfLmZpbmQoZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHsgcmV0dXJuIGZlYXQudHlwZS50b0xvd2VyQ2FzZSgpID09IFwiY2RzXCI7IH0pO1xuICAgIFxuICAgIF8uZWFjaChleG9ucywgZnVuY3Rpb24oZXhvbkZlYXR1cmUpIHtcbiAgICAgIGV4b25GZWF0dXJlLmZ1bGxMb2NhdGlvbi5yZXBsYWNlKC8oXFxkKylcXC5cXC5bPjxdPyhcXGQrKS9nLCBmdW5jdGlvbihmdWxsTWF0Y2gsIHN0YXJ0LCBlbmQpIHtcbiAgICAgICAgYmxvY2tzLnB1c2goe1xuICAgICAgICAgIHN0YXJ0OiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgTWF0aC5taW4oc3RhcnQsIGVuZCksIFxuICAgICAgICAgIC8vIEZlYXR1cmUgdGFibGUgcmFuZ2VzIGFyZSAqaW5jbHVzaXZlKiBvZiB0aGUgZW5kIGJhc2UuXG4gICAgICAgICAgZW5kOiBjaHJQb3NbZXhvbkZlYXR1cmUuY2hyb21dICsgIE1hdGgubWF4KHN0YXJ0LCBlbmQpICsgMVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIFxuICAgIC8vIENvbnZlcnQgZXhvbnMgYW5kIENEUyBpbnRvIGJsb2NrcywgdGhpY2tTdGFydCBhbmQgdGhpY2tFbmQgKGluIEJFRCB0ZXJtaW5vbG9neSlcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCkgeyBcbiAgICAgIG1lcmdlSW50by5ibG9ja3MgPSBfLnNvcnRCeShibG9ja3MsIGZ1bmN0aW9uKGIpIHsgcmV0dXJuIGIuc3RhcnQ7IH0pO1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrU3RhcnQgPSBjZHMgPyBjZHMuc3RhcnQgOiBmZWF0dXJlLnN0YXJ0O1xuICAgICAgbWVyZ2VJbnRvLnRoaWNrRW5kID0gY2RzID8gY2RzLmVuZCA6IGZlYXR1cmUuZW5kO1xuICAgIH1cbiAgICBcbiAgICAvLyBmaW5hbGx5LCBtZXJnZSBhbGwgdGhlIHF1YWxpZmllcnNcbiAgICBfLmVhY2goZmVhdHVyZXMsIGZ1bmN0aW9uKGZlYXQpIHtcbiAgICAgIGlmIChmZWF0ID09PSBtZXJnZUludG8pIHsgcmV0dXJuOyB9XG4gICAgICBfLmVhY2goZmVhdC5xdWFsaWZpZXJzLCBmdW5jdGlvbih2YWx1ZXMsIGspIHtcbiAgICAgICAgaWYgKCFtZXJnZUludG8ucXVhbGlmaWVyc1trXSkgeyBtZXJnZUludG8ucXVhbGlmaWVyc1trXSA9IFtdOyB9XG4gICAgICAgIF8uZWFjaCh2YWx1ZXMsIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICBpZiAoIV8uY29udGFpbnMobWVyZ2VJbnRvLnF1YWxpZmllcnNba10sIHYpKSB7IG1lcmdlSW50by5xdWFsaWZpZXJzW2tdLnB1c2godik7IH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VJbnRvO1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIG8gPSBzZWxmLm9wdHMsXG4gICAgICBtaWRkbGVpc2hQb3MgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyAyLFxuICAgICAgZGF0YSA9IG5ldyBJbnRlcnZhbFRyZWUoZmxvb3JIYWNrKG1pZGRsZWlzaFBvcyksIHtzdGFydEtleTogJ3N0YXJ0JywgZW5kS2V5OiAnZW5kJ30pLFxuICAgICAgbnVtTGluZXMgPSBsaW5lcy5sZW5ndGgsXG4gICAgICBjaHJvbSA9IG51bGwsXG4gICAgICBsYXN0RW50cnlTdGFydCA9IG51bGwsXG4gICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXkgPSB7fSxcbiAgICAgIGZlYXR1cmU7XG4gICAgXG4gICAgZnVuY3Rpb24gY29sbGVjdExhc3RFbnRyeShsaW5lbm8pIHtcbiAgICAgIGlmIChsYXN0RW50cnlTdGFydCAhPT0gbnVsbCkge1xuICAgICAgICBmZWF0dXJlID0gc2VsZi50eXBlKCkucGFyc2VFbnRyeS5jYWxsKHNlbGYsIGNocm9tLCBsaW5lcy5zbGljZShsYXN0RW50cnlTdGFydCwgbGluZW5vKSwgbGFzdEVudHJ5U3RhcnQpO1xuICAgICAgICBpZiAoZmVhdHVyZSkgeyBcbiAgICAgICAgICBpZiAoby5jb2xsYXBzZUJ5R2VuZSkge1xuICAgICAgICAgICAgZmVhdHVyZXNCeUNvbGxhcHNlS2V5W2ZlYXR1cmUuX2NvbGxhcHNlS2V5XSA9IGZlYXR1cmVzQnlDb2xsYXBzZUtleVtmZWF0dXJlLl9jb2xsYXBzZUtleV0gfHwgW107XG4gICAgICAgICAgICBmZWF0dXJlc0J5Q29sbGFwc2VLZXlbZmVhdHVyZS5fY29sbGFwc2VLZXldLnB1c2goZmVhdHVyZSk7XG4gICAgICAgICAgfSBlbHNlIHsgZGF0YS5hZGQoZmVhdHVyZSk7IH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBDaHVuayB0aGUgbGluZXMgaW50byBlbnRyaWVzIGFuZCBwYXJzZSBlYWNoIG9mIHRoZW1cbiAgICBfLmVhY2gobGluZXMsIGZ1bmN0aW9uKGxpbmUsIGxpbmVubykge1xuICAgICAgaWYgKGxpbmUuc3Vic3RyKDAsIDEyKSA9PSBcIkFDQ0VTU0lPTiAgIFwiKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgY2hyb20gPSBsaW5lLnN1YnN0cigxMik7XG4gICAgICAgIGxhc3RFbnRyeVN0YXJ0ID0gbnVsbDtcbiAgICAgIH0gZWxzZSBpZiAoY2hyb20gIT09IG51bGwgJiYgbGluZS5zdWJzdHIoNSwgMSkubWF0Y2goL1xcdy8pKSB7XG4gICAgICAgIGNvbGxlY3RMYXN0RW50cnkobGluZW5vKTtcbiAgICAgICAgbGFzdEVudHJ5U3RhcnQgPSBsaW5lbm87XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gcGFyc2UgdGhlIGxhc3QgZW50cnlcbiAgICBpZiAoY2hyb20gIT09IG51bGwpIHsgY29sbGVjdExhc3RFbnRyeShsaW5lcy5sZW5ndGgpOyB9XG4gICAgXG4gICAgaWYgKG8uY29sbGFwc2VCeUdlbmUpIHtcbiAgICAgIF8uZWFjaChmZWF0dXJlc0J5Q29sbGFwc2VLZXksIGZ1bmN0aW9uKGZlYXR1cmVzLCBnZW5lKSB7XG4gICAgICAgIGRhdGEuYWRkKHNlbGYudHlwZSgpLmNvbGxhcHNlRmVhdHVyZXMuY2FsbChzZWxmLCBmZWF0dXJlcykpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIFxuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcbiAgXG4gIC8vIHNwZWNpYWwgZm9ybWF0dGVyIGZvciBjb250ZW50IGluIHRvb2x0aXBzIGZvciBmZWF0dXJlc1xuICB0aXBUaXBEYXRhOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHF1YWxpZmllcnNUb0FiYnJldmlhdGUgPSB7dHJhbnNsYXRpb246IDF9LFxuICAgICAgY29udGVudCA9IHtcbiAgICAgICAgdHlwZTogZGF0YS5kLnR5cGUsXG4gICAgICAgIHBvc2l0aW9uOiBkYXRhLmQuY2hyb20gKyAnOicgKyBkYXRhLmQuY2hyb21TdGFydCwgXG4gICAgICAgIHNpemU6IGRhdGEuZC5jaHJvbUVuZCAtIGRhdGEuZC5jaHJvbVN0YXJ0XG4gICAgICB9O1xuICAgIGlmIChkYXRhLmQucXVhbGlmaWVycy5ub3RlICYmIGRhdGEuZC5xdWFsaWZpZXJzLm5vdGVbMF0pIHsgIH1cbiAgICBfLmVhY2goZGF0YS5kLnF1YWxpZmllcnMsIGZ1bmN0aW9uKHYsIGspIHtcbiAgICAgIGlmIChrID09ICdub3RlJykgeyBjb250ZW50LmRlc2NyaXB0aW9uID0gdi5qb2luKCc7ICcpOyByZXR1cm47IH1cbiAgICAgIGNvbnRlbnRba10gPSB2LmpvaW4oJzsgJyk7XG4gICAgICBpZiAocXVhbGlmaWVyc1RvQWJicmV2aWF0ZVtrXSAmJiBjb250ZW50W2tdLmxlbmd0aCA+IDI1KSB7IGNvbnRlbnRba10gPSBjb250ZW50W2tdLnN1YnN0cigwLCAyNSkgKyAnLi4uJzsgfVxuICAgIH0pO1xuICAgIHJldHVybiBjb250ZW50O1xuICB9LFxuICBcbiAgcHJlcmVuZGVyOiBmdW5jdGlvbihzdGFydCwgZW5kLCBkZW5zaXR5LCBwcmVjYWxjLCBjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnByZXJlbmRlci5jYWxsKHRoaXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKTtcbiAgfSxcbiAgXG4gIGRyYXdTcGVjOiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudHlwZSgnYmVkJykuZHJhd1NwZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfSxcbiAgXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMudHlwZSgnYmVkJykucmVuZGVyLmNhbGwodGhpcywgY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjayk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLmxvYWRPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH0sXG4gIFxuICBzYXZlT3B0czogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnR5cGUoJ2JlZCcpLnNhdmVPcHRzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7IH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gRmVhdHVyZVRhYmxlRm9ybWF0OyIsIihmdW5jdGlvbihleHBvcnRzKXtcbiAgXG52YXIgU29ydGVkTGlzdCA9IHJlcXVpcmUoJy4vU29ydGVkTGlzdC5qcycpLlNvcnRlZExpc3Q7ICBcblxuLy8gVE9ETzogYmFja3BvcnQgdGhpcyBjb2RlIGZvciBKYXZhU2NyaXB0IDEuNT8gdXNpbmcgdW5kZXJzY29yZS5qc1xuLyoqXG4gKiBCeSBTaGluIFN1enVraSwgTUlUIGxpY2Vuc2VcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGlub3V0L2ludGVydmFsLXRyZWVcbiAqIEludGVydmFsVHJlZVxuICpcbiAqIEBwYXJhbSAob2JqZWN0KSBkYXRhOlxuICogQHBhcmFtIChudW1iZXIpIGNlbnRlcjpcbiAqIEBwYXJhbSAob2JqZWN0KSBvcHRpb25zOlxuICogICBjZW50ZXI6XG4gKlxuICoqL1xuZnVuY3Rpb24gSW50ZXJ2YWxUcmVlKGNlbnRlciwgb3B0aW9ucykge1xuICBvcHRpb25zIHx8IChvcHRpb25zID0ge30pO1xuXG4gIHRoaXMuc3RhcnRLZXkgICAgID0gb3B0aW9ucy5zdGFydEtleSB8fCAwOyAvLyBzdGFydCBrZXlcbiAgdGhpcy5lbmRLZXkgICAgICAgPSBvcHRpb25zLmVuZEtleSAgIHx8IDE7IC8vIGVuZCBrZXlcbiAgdGhpcy5pbnRlcnZhbEhhc2ggPSB7fTsgICAgICAgICAgICAgICAgICAgIC8vIGlkID0+IGludGVydmFsIG9iamVjdFxuICB0aGlzLnBvaW50VHJlZSA9IG5ldyBTb3J0ZWRMaXN0KHsgICAgICAgICAgLy8gYi10cmVlIG9mIHN0YXJ0LCBlbmQgcG9pbnRzIFxuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYVswXS0gYlswXTtcbiAgICAgIHJldHVybiAoYyA+IDApID8gMSA6IChjID09IDApICA/IDAgOiAtMTtcbiAgICB9XG4gIH0pO1xuXG4gIHRoaXMuX2F1dG9JbmNyZW1lbnQgPSAwO1xuXG4gIC8vIGluZGV4IG9mIHRoZSByb290IG5vZGVcbiAgaWYgKCFjZW50ZXIgfHwgdHlwZW9mIGNlbnRlciAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBjZW50ZXIgaW5kZXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTtcbiAgfVxuXG4gIHRoaXMucm9vdCA9IG5ldyBOb2RlKGNlbnRlciwgdGhpcyk7XG59XG5cblxuLyoqXG4gKiBwdWJsaWMgbWV0aG9kc1xuICoqL1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZVxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBmdW5jdGlvbihkYXRhLCBpZCkge1xuICBpZiAodGhpcy5jb250YWlucyhpZCkpIHtcbiAgICB0aHJvdyBuZXcgRHVwbGljYXRlRXJyb3IoJ2lkICcgKyBpZCArICcgaXMgYWxyZWFkeSByZWdpc3RlcmVkLicpO1xuICB9XG5cbiAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgIHdoaWxlICh0aGlzLmludGVydmFsSGFzaFt0aGlzLl9hdXRvSW5jcmVtZW50XSkge1xuICAgICAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICAgIH1cbiAgICBpZCA9IHRoaXMuX2F1dG9JbmNyZW1lbnQ7XG4gIH1cblxuICB2YXIgaXR2bCA9IG5ldyBJbnRlcnZhbChkYXRhLCBpZCwgdGhpcy5zdGFydEtleSwgdGhpcy5lbmRLZXkpO1xuICB0aGlzLnBvaW50VHJlZS5pbnNlcnQoW2l0dmwuc3RhcnQsIGlkXSk7XG4gIHRoaXMucG9pbnRUcmVlLmluc2VydChbaXR2bC5lbmQsICAgaWRdKTtcbiAgdGhpcy5pbnRlcnZhbEhhc2hbaWRdID0gaXR2bDtcbiAgdGhpcy5fYXV0b0luY3JlbWVudCsrO1xuICBcbiAgX2luc2VydC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgaXR2bCk7XG59O1xuXG5cbi8qKlxuICogY2hlY2sgaWYgcmFuZ2UgaXMgYWxyZWFkeSBwcmVzZW50LCBiYXNlZCBvbiBpdHMgaWRcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUuY29udGFpbnMgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gISF0aGlzLmdldChpZCk7XG59XG5cblxuLyoqXG4gKiByZXRyaWV2ZSBhbiBpbnRlcnZhbCBieSBpdHMgaWQ7IHJldHVybnMgbnVsbCBpZiBpdCBkb2VzIG5vdCBleGlzdFxuICoqL1xuSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbihpZCkge1xuICByZXR1cm4gdGhpcy5pbnRlcnZhbEhhc2hbaWRdIHx8IG51bGw7XG59XG5cblxuLyoqXG4gKiBhZGQgbmV3IHJhbmdlIG9ubHkgaWYgaXQgaXMgbmV3LCBiYXNlZCBvbiB3aGV0aGVyIHRoZSBpZCB3YXMgYWxyZWFkeSByZWdpc3RlcmVkXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3ID0gZnVuY3Rpb24oZGF0YSwgaWQpIHtcbiAgdHJ5IHtcbiAgICB0aGlzLmFkZChkYXRhLCBpZCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIER1cGxpY2F0ZUVycm9yKSB7IHJldHVybjsgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cblxuXG4vKipcbiAqIHNlYXJjaFxuICpcbiAqIEBwYXJhbSAoaW50ZWdlcikgdmFsOlxuICogQHJldHVybiAoYXJyYXkpXG4gKiovXG5JbnRlcnZhbFRyZWUucHJvdG90eXBlLnNlYXJjaCA9IGZ1bmN0aW9uKHZhbDEsIHZhbDIpIHtcbiAgdmFyIHJldCA9IFtdO1xuICBpZiAodHlwZW9mIHZhbDEgIT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IodmFsMSArICc6IGludmFsaWQgaW5wdXQnKTtcbiAgfVxuXG4gIGlmICh2YWwyID09IHVuZGVmaW5lZCkge1xuICAgIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgdmFsMSwgcmV0KTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2YgdmFsMiA9PSAnbnVtYmVyJykge1xuICAgIF9yYW5nZVNlYXJjaC5jYWxsKHRoaXMsIHZhbDEsIHZhbDIsIHJldCk7XG4gIH1cbiAgZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHZhbDEgKyAnLCcgKyB2YWwyICsgJzogaW52YWxpZCBpbnB1dCcpO1xuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbi8qKlxuICogcmVtb3ZlOiBcbiAqKi9cbkludGVydmFsVHJlZS5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24oaW50ZXJ2YWxfaWQpIHtcbiAgdGhyb3cgXCIucmVtb3ZlKCkgaXMgY3VycmVudGx5IHVuaW1wbGVtZW50ZWRcIjtcbn07XG5cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyB0aGUgc2hpZnQtcmlnaHQtYW5kLWZpbGwgb3BlcmF0b3IsIGV4dGVuZGVkIGJleW9uZCB0aGUgcmFuZ2Ugb2YgYW4gaW50MzJcbmZ1bmN0aW9uIF9iaXRTaGlmdFJpZ2h0KG51bSkge1xuICBpZiAobnVtID4gMjE0NzQ4MzY0NyB8fCBudW0gPCAtMjE0NzQ4MzY0OCkgeyByZXR1cm4gTWF0aC5mbG9vcihudW0gLyAyKTsgfVxuICByZXR1cm4gbnVtID4+PiAxO1xufVxuXG4vKipcbiAqIF9pbnNlcnRcbiAqKi9cbmZ1bmN0aW9uIF9pbnNlcnQobm9kZSwgaXR2bCkge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChpdHZsLmVuZCA8IG5vZGUuaWR4KSB7XG4gICAgICBpZiAoIW5vZGUubGVmdCkge1xuICAgICAgICBub2RlLmxlZnQgPSBuZXcgTm9kZShfYml0U2hpZnRSaWdodChpdHZsLnN0YXJ0ICsgaXR2bC5lbmQpLCB0aGlzKTtcbiAgICAgIH1cbiAgICAgIG5vZGUgPSBub2RlLmxlZnQ7XG4gICAgfSBlbHNlIGlmIChub2RlLmlkeCA8IGl0dmwuc3RhcnQpIHtcbiAgICAgIGlmICghbm9kZS5yaWdodCkge1xuICAgICAgICBub2RlLnJpZ2h0ID0gbmV3IE5vZGUoX2JpdFNoaWZ0UmlnaHQoaXR2bC5zdGFydCArIGl0dmwuZW5kKSwgdGhpcyk7XG4gICAgICB9XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG5vZGUuaW5zZXJ0KGl0dmwpO1xuICAgIH1cbiAgfVxufVxuXG5cbi8qKlxuICogX3BvaW50U2VhcmNoXG4gKiBAcGFyYW0gKE5vZGUpIG5vZGVcbiAqIEBwYXJhbSAoaW50ZWdlcikgaWR4IFxuICogQHBhcmFtIChBcnJheSkgYXJyXG4gKiovXG5mdW5jdGlvbiBfcG9pbnRTZWFyY2gobm9kZSwgaWR4LCBhcnIpIHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAoIW5vZGUpIGJyZWFrO1xuICAgIGlmIChpZHggPCBub2RlLmlkeCkge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLmV2ZXJ5KGZ1bmN0aW9uKGl0dmwpIHtcbiAgICAgICAgdmFyIGJvb2wgPSAoaXR2bC5zdGFydCA8PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5sZWZ0O1xuICAgIH0gZWxzZSBpZiAoaWR4ID4gbm9kZS5pZHgpIHtcbiAgICAgIG5vZGUuZW5kcy5hcnIuZXZlcnkoZnVuY3Rpb24oaXR2bCkge1xuICAgICAgICB2YXIgYm9vbCA9IChpdHZsLmVuZCA+PSBpZHgpO1xuICAgICAgICBpZiAoYm9vbCkgYXJyLnB1c2goaXR2bC5yZXN1bHQoKSk7XG4gICAgICAgIHJldHVybiBib29sO1xuICAgICAgfSk7XG4gICAgICBub2RlID0gbm9kZS5yaWdodDtcbiAgICB9IGVsc2Uge1xuICAgICAgbm9kZS5zdGFydHMuYXJyLm1hcChmdW5jdGlvbihpdHZsKSB7IGFyci5wdXNoKGl0dmwucmVzdWx0KCkpIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG59XG5cblxuXG4vKipcbiAqIF9yYW5nZVNlYXJjaFxuICogQHBhcmFtIChpbnRlZ2VyKSBzdGFydFxuICogQHBhcmFtIChpbnRlZ2VyKSBlbmRcbiAqIEBwYXJhbSAoQXJyYXkpIGFyclxuICoqL1xuZnVuY3Rpb24gX3JhbmdlU2VhcmNoKHN0YXJ0LCBlbmQsIGFycikge1xuICBpZiAoZW5kIC0gc3RhcnQgPD0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcignZW5kIG11c3QgYmUgZ3JlYXRlciB0aGFuIHN0YXJ0LiBzdGFydDogJyArIHN0YXJ0ICsgJywgZW5kOiAnICsgZW5kKTtcbiAgfVxuICB2YXIgcmVzdWx0SGFzaCA9IHt9O1xuXG4gIHZhciB3aG9sZVdyYXBzID0gW107XG4gIF9wb2ludFNlYXJjaC5jYWxsKHRoaXMsIHRoaXMucm9vdCwgX2JpdFNoaWZ0UmlnaHQoc3RhcnQgKyBlbmQpLCB3aG9sZVdyYXBzLCB0cnVlKTtcblxuICB3aG9sZVdyYXBzLmZvckVhY2goZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgcmVzdWx0SGFzaFtyZXN1bHQuaWRdID0gdHJ1ZTtcbiAgfSk7XG5cblxuICB2YXIgaWR4MSA9IHRoaXMucG9pbnRUcmVlLmJzZWFyY2goW3N0YXJ0LCBudWxsXSk7XG4gIHdoaWxlIChpZHgxID49IDAgJiYgdGhpcy5wb2ludFRyZWUuYXJyW2lkeDFdWzBdID09IHN0YXJ0KSB7XG4gICAgaWR4MS0tO1xuICB9XG5cbiAgdmFyIGlkeDIgPSB0aGlzLnBvaW50VHJlZS5ic2VhcmNoKFtlbmQsICAgbnVsbF0pO1xuICB2YXIgbGVuID0gdGhpcy5wb2ludFRyZWUuYXJyLmxlbmd0aCAtIDE7XG4gIHdoaWxlIChpZHgyID09IC0xIHx8IChpZHgyIDw9IGxlbiAmJiB0aGlzLnBvaW50VHJlZS5hcnJbaWR4Ml1bMF0gPD0gZW5kKSkge1xuICAgIGlkeDIrKztcbiAgfVxuXG4gIHRoaXMucG9pbnRUcmVlLmFyci5zbGljZShpZHgxICsgMSwgaWR4MikuZm9yRWFjaChmdW5jdGlvbihwb2ludCkge1xuICAgIHZhciBpZCA9IHBvaW50WzFdO1xuICAgIHJlc3VsdEhhc2hbaWRdID0gdHJ1ZTtcbiAgfSwgdGhpcyk7XG5cbiAgT2JqZWN0LmtleXMocmVzdWx0SGFzaCkuZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgIHZhciBpdHZsID0gdGhpcy5pbnRlcnZhbEhhc2hbaWRdO1xuICAgIGFyci5wdXNoKGl0dmwucmVzdWx0KHN0YXJ0LCBlbmQpKTtcbiAgfSwgdGhpcyk7XG5cbn1cblxuXG5cbi8qKlxuICogc3ViY2xhc3Nlc1xuICogXG4gKiovXG5cblxuLyoqXG4gKiBOb2RlIDogcHJvdG90eXBlIG9mIGVhY2ggbm9kZSBpbiBhIGludGVydmFsIHRyZWVcbiAqIFxuICoqL1xuZnVuY3Rpb24gTm9kZShpZHgpIHtcbiAgdGhpcy5pZHggPSBpZHg7XG4gIHRoaXMuc3RhcnRzID0gbmV3IFNvcnRlZExpc3Qoe1xuICAgIGNvbXBhcmU6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgIGlmIChhID09IG51bGwpIHJldHVybiAtMTtcbiAgICAgIGlmIChiID09IG51bGwpIHJldHVybiAgMTtcbiAgICAgIHZhciBjID0gYS5zdGFydCAtIGIuc3RhcnQ7XG4gICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gICAgfVxuICB9KTtcblxuICB0aGlzLmVuZHMgPSBuZXcgU29ydGVkTGlzdCh7XG4gICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgaWYgKGEgPT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgaWYgKGIgPT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgdmFyIGMgPSBhLmVuZCAtIGIuZW5kO1xuICAgICAgcmV0dXJuIChjIDwgMCkgPyAxIDogKGMgPT0gMCkgID8gMCA6IC0xO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIGluc2VydCBhbiBJbnRlcnZhbCBvYmplY3QgdG8gdGhpcyBub2RlXG4gKiovXG5Ob2RlLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihpbnRlcnZhbCkge1xuICB0aGlzLnN0YXJ0cy5pbnNlcnQoaW50ZXJ2YWwpO1xuICB0aGlzLmVuZHMuaW5zZXJ0KGludGVydmFsKTtcbn07XG5cblxuXG4vKipcbiAqIEludGVydmFsIDogcHJvdG90eXBlIG9mIGludGVydmFsIGluZm9cbiAqKi9cbmZ1bmN0aW9uIEludGVydmFsKGRhdGEsIGlkLCBzLCBlKSB7XG4gIHRoaXMuaWQgICAgID0gaWQ7XG4gIHRoaXMuc3RhcnQgID0gZGF0YVtzXTtcbiAgdGhpcy5lbmQgICAgPSBkYXRhW2VdO1xuICB0aGlzLmRhdGEgICA9IGRhdGE7XG5cbiAgaWYgKHR5cGVvZiB0aGlzLnN0YXJ0ICE9ICdudW1iZXInIHx8IHR5cGVvZiB0aGlzLmVuZCAhPSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignc3RhcnQsIGVuZCBtdXN0IGJlIG51bWJlci4gc3RhcnQ6ICcgKyB0aGlzLnN0YXJ0ICsgJywgZW5kOiAnICsgdGhpcy5lbmQpO1xuICB9XG5cbiAgaWYgKCB0aGlzLnN0YXJ0ID49IHRoaXMuZW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdzdGFydCBtdXN0IGJlIHNtYWxsZXIgdGhhbiBlbmQuIHN0YXJ0OiAnICsgdGhpcy5zdGFydCArICcsIGVuZDogJyArIHRoaXMuZW5kKTtcbiAgfVxufVxuXG4vKipcbiAqIGdldCByZXN1bHQgb2JqZWN0XG4gKiovXG5JbnRlcnZhbC5wcm90b3R5cGUucmVzdWx0ID0gZnVuY3Rpb24oc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0ge1xuICAgIGlkICAgOiB0aGlzLmlkLFxuICAgIGRhdGEgOiB0aGlzLmRhdGFcbiAgfTtcbiAgaWYgKHR5cGVvZiBzdGFydCA9PSAnbnVtYmVyJyAmJiB0eXBlb2YgZW5kID09ICdudW1iZXInKSB7XG4gICAgLyoqXG4gICAgICogY2FsYyBvdmVybGFwcGluZyByYXRlXG4gICAgICoqL1xuICAgIHZhciBsZWZ0ICA9IE1hdGgubWF4KHRoaXMuc3RhcnQsIHN0YXJ0KTtcbiAgICB2YXIgcmlnaHQgPSBNYXRoLm1pbih0aGlzLmVuZCwgICBlbmQpO1xuICAgIHZhciBsYXBMbiA9IHJpZ2h0IC0gbGVmdDtcbiAgICByZXQucmF0ZTEgPSBsYXBMbiAvIChlbmQgLSBzdGFydCk7XG4gICAgcmV0LnJhdGUyID0gbGFwTG4gLyAodGhpcy5lbmQgLSB0aGlzLnN0YXJ0KTtcbiAgfVxuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gRHVwbGljYXRlRXJyb3IobWVzc2FnZSkge1xuICAgIHRoaXMubmFtZSA9ICdEdXBsaWNhdGVFcnJvcic7XG4gICAgdGhpcy5tZXNzYWdlID0gbWVzc2FnZTtcbiAgICB0aGlzLnN0YWNrID0gKG5ldyBFcnJvcigpKS5zdGFjaztcbn1cbkR1cGxpY2F0ZUVycm9yLnByb3RvdHlwZSA9IG5ldyBFcnJvcjtcblxuZXhwb3J0cy5JbnRlcnZhbFRyZWUgPSBJbnRlcnZhbFRyZWU7XG5cbn0pKG1vZHVsZSAmJiBtb2R1bGUuZXhwb3J0cyB8fCB0aGlzKTsiLCIoZnVuY3Rpb24oZXhwb3J0cyl7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vID0gTGluZU1hc2s6IEEgKHZlcnkgY2hlYXApIGFsdGVybmF0aXZlIHRvIEludGVydmFsVHJlZTogYSBzbWFsbCwgMUQgcGl4ZWwgYnVmZmVyIG9mIG9iamVjdHMuID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzLmpzJyksXG4gIGZsb29ySGFjayA9IHV0aWxzLmZsb29ySGFjaztcblxuZnVuY3Rpb24gTGluZU1hc2sod2lkdGgsIGZ1ZGdlKSB7XG4gIHRoaXMuZnVkZ2UgPSBmdWRnZSA9IChmdWRnZSB8fCAxKTtcbiAgdGhpcy5pdGVtcyA9IFtdO1xuICB0aGlzLmxlbmd0aCA9IE1hdGguY2VpbCh3aWR0aCAvIGZ1ZGdlKTtcbiAgdGhpcy5tYXNrID0gZ2xvYmFsLlVpbnQ4QXJyYXkgPyBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aCkgOiBuZXcgQXJyYXkodGhpcy5sZW5ndGgpO1xufVxuXG5MaW5lTWFzay5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24oeCwgdywgZGF0YSkge1xuICB2YXIgdXBUbyA9IE1hdGguY2VpbCgoeCArIHcpIC8gdGhpcy5mdWRnZSk7XG4gIHRoaXMuaXRlbXMucHVzaCh7eDogeCwgdzogdywgZGF0YTogZGF0YX0pO1xuICBmb3IgKHZhciBpID0gTWF0aC5tYXgoZmxvb3JIYWNrKHggLyB0aGlzLmZ1ZGdlKSwgMCk7IGkgPCBNYXRoLm1pbih1cFRvLCB0aGlzLmxlbmd0aCk7IGkrKykgeyB0aGlzLm1hc2tbaV0gPSAxOyB9XG59O1xuXG5MaW5lTWFzay5wcm90b3R5cGUuY29uZmxpY3QgPSBmdW5jdGlvbih4LCB3KSB7XG4gIHZhciB1cFRvID0gTWF0aC5jZWlsKCh4ICsgdykgLyB0aGlzLmZ1ZGdlKTtcbiAgZm9yICh2YXIgaSA9IE1hdGgubWF4KGZsb29ySGFjayh4IC8gdGhpcy5mdWRnZSksIDApOyBpIDwgTWF0aC5taW4odXBUbywgdGhpcy5sZW5ndGgpOyBpKyspIHsgaWYgKHRoaXMubWFza1tpXSkgcmV0dXJuIHRydWU7IH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuZXhwb3J0cy5MaW5lTWFzayA9IExpbmVNYXNrO1xuXG59KShtb2R1bGUgJiYgbW9kdWxlLmV4cG9ydHMgfHwgdGhpcyk7IiwiKGZ1bmN0aW9uKGV4cG9ydHMpe1xuICBcbnZhciBJbnRlcnZhbFRyZWUgPSByZXF1aXJlKCcuL0ludGVydmFsVHJlZS5qcycpLkludGVydmFsVHJlZTsgIFxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xudmFyIHBhcnNlSW50MTAgPSByZXF1aXJlKCcuL3V0aWxzLmpzJykucGFyc2VJbnQxMDtcblxudmFyIFBBSVJJTkdfQ0FOTk9UX01BVEUgPSAwLFxuICBQQUlSSU5HX01BVEVfT05MWSA9IDEsXG4gIFBBSVJJTkdfRFJBV19BU19NQVRFUyA9IDI7XG5cbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogV3JhcHMgdHdvIG9mIFNoaW4gU3V6dWtpJ3MgSW50ZXJ2YWxUcmVlcyB0byBzdG9yZSBpbnRlcnZhbHMgdGhhdCAqbWF5KlxuICogYmUgcGFpcmVkLlxuICpcbiAqIEBzZWUgSW50ZXJ2YWxUcmVlKClcbiAqKi9cbmZ1bmN0aW9uIFBhaXJlZEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucywgcGFpcmVkT3B0aW9ucykge1xuICB2YXIgZGVmYXVsdE9wdGlvbnMgPSB7c3RhcnRLZXk6IDAsIGVuZEtleTogMX07XG4gIFxuICB0aGlzLnVucGFpcmVkID0gbmV3IEludGVydmFsVHJlZShjZW50ZXIsIHVucGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMudW5wYWlyZWRPcHRpb25zID0gXy5leHRlbmQoe30sIGRlZmF1bHRPcHRpb25zLCB1bnBhaXJlZE9wdGlvbnMpO1xuICBcbiAgdGhpcy5wYWlyZWQgPSBuZXcgSW50ZXJ2YWxUcmVlKGNlbnRlciwgcGFpcmVkT3B0aW9ucyk7XG4gIHRoaXMucGFpcmVkT3B0aW9ucyA9IF8uZXh0ZW5kKHtwYWlyaW5nS2V5OiAncW5hbWUnLCBwYWlyZWRMZW5ndGhLZXk6ICd0bGVuJ30sIGRlZmF1bHRPcHRpb25zLCBwYWlyZWRPcHRpb25zKTtcbiAgaWYgKHRoaXMucGFpcmVkT3B0aW9ucy5zdGFydEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuc3RhcnRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3N0YXJ0S2V5IGZvciB1bnBhaXJlZE9wdGlvbnMgYW5kIHBhaXJlZE9wdGlvbnMgbXVzdCBiZSBkaWZmZXJlbnQgaW4gYSBQYWlyZWRJbnRlcnZhbFRyZWUnKTtcbiAgfVxuICBpZiAodGhpcy5wYWlyZWRPcHRpb25zLmVuZEtleSA9PT0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdlbmRLZXkgZm9yIHVucGFpcmVkT3B0aW9ucyBhbmQgcGFpcmVkT3B0aW9ucyBtdXN0IGJlIGRpZmZlcmVudCBpbiBhIFBhaXJlZEludGVydmFsVHJlZScpO1xuICB9XG4gIFxuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IGZhbHNlO1xuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IHRoaXMucGFpcmluZ01heERpc3RhbmNlID0gbnVsbDtcbn1cblxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cblxuLyoqXG4gKiBEaXNhYmxlcyBwYWlyaW5nLiBFZmZlY3RpdmVseSBtYWtlcyB0aGlzIGVxdWl2YWxlbnQsIGV4dGVybmFsbHksIHRvIGFuIEludGVydmFsVHJlZS5cbiAqIFRoaXMgaXMgdXNlZnVsIGlmIHdlIGRpc2NvdmVyIHRoYXQgdGhpcyBkYXRhIHNvdXJjZSBkb2Vzbid0IGNvbnRhaW4gcGFpcmVkIHJlYWRzLlxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5kaXNhYmxlUGFpcmluZyA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLnBhaXJpbmdEaXNhYmxlZCA9IHRydWU7XG4gIHRoaXMucGFpcmVkID0gdGhpcy51bnBhaXJlZDtcbn07XG5cblxuLyoqXG4gKiBTZXQgYW4gaW50ZXJ2YWwgd2l0aGluIHdoaWNoIHBhaXJlZCBtYXRlcyB3aWxsIGJlIHNhdmVkIGFzIGEgY29udGludW91cyBmZWF0dXJlIGluIC5wYWlyZWRcbiAqXG4gKiBAcGFyYW0gKG51bWJlcikgbWluOiBNaW5pbXVtIGRpc3RhbmNlLCBpbiBicFxuICogQHBhcmFtIChudW1iZXIpIG1heDogTWF4aW11bSBkaXN0YW5jZSwgaW4gYnBcbiAqKi9cblBhaXJlZEludGVydmFsVHJlZS5wcm90b3R5cGUuc2V0UGFpcmluZ0ludGVydmFsID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgaWYgKHR5cGVvZiBtaW4gIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1pbiBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4ICE9ICdudW1iZXInKSB7IHRocm93IG5ldyBFcnJvcigneW91IG11c3Qgc3BlY2lmeSBtYXggYXMgdGhlIDJuZCBhcmd1bWVudC4nKTsgfVxuICBpZiAodGhpcy5wYWlyaW5nTWluRGlzdGFuY2UgIT09IG51bGwpIHsgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBiZSBjYWxsZWQgb25jZS4gWW91IGNhblxcJ3QgY2hhbmdlIHRoZSBwYWlyaW5nIGludGVydmFsLicpOyB9XG4gIFxuICB0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9IG1pbjtcbiAgdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgPSBtYXg7XG59O1xuXG5cbi8qKlxuICogYWRkIG5ldyByYW5nZSBvbmx5IGlmIGl0IGlzIG5ldywgYmFzZWQgb24gd2hldGhlciB0aGUgaWQgd2FzIGFscmVhZHkgcmVnaXN0ZXJlZFxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGRJZk5ldyA9IGZ1bmN0aW9uKGRhdGEsIGlkKSB7XG4gIHZhciBtYXRlZCA9IGZhbHNlLFxuICAgIGluY3JlbWVudCA9IDAsXG4gICAgdW5wYWlyZWRTdGFydCA9IHRoaXMudW5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHVucGFpcmVkRW5kID0gdGhpcy51bnBhaXJlZE9wdGlvbnMuZW5kS2V5LFxuICAgIHBhaXJlZFN0YXJ0ID0gdGhpcy5wYWlyZWRPcHRpb25zLnN0YXJ0S2V5LFxuICAgIHBhaXJlZEVuZCA9IHRoaXMucGFpcmVkT3B0aW9ucy5lbmRLZXksXG4gICAgcGFpcmVkTGVuZ3RoID0gZGF0YVt0aGlzLnBhaXJlZE9wdGlvbnMucGFpcmVkTGVuZ3RoS2V5XSxcbiAgICBwYWlyaW5nU3RhdGUgPSBQQUlSSU5HX0NBTk5PVF9NQVRFLFxuICAgIG5ld0lkLCBwb3RlbnRpYWxNYXRlO1xuICBcbiAgLy8gLnVucGFpcmVkIGNvbnRhaW5zIGV2ZXJ5IGFsaWdubWVudCBhcyBhIHNlcGFyYXRlIGludGVydmFsLlxuICAvLyBJZiBpdCBhbHJlYWR5IGNvbnRhaW5zIHRoaXMgaWQsIHdlJ3ZlIHNlZW4gdGhpcyByZWFkIGJlZm9yZSBhbmQgc2hvdWxkIGRpc3JlZ2FyZC5cbiAgaWYgKHRoaXMudW5wYWlyZWQuY29udGFpbnMoaWQpKSB7IHJldHVybjsgfVxuICB0aGlzLnVucGFpcmVkLmFkZChkYXRhLCBpZCk7XG4gIFxuICAvLyAucGFpcmVkIGNvbnRhaW5zIGFsaWdubWVudHMgdGhhdCBtYXkgYmUgbWF0ZWQgaW50byBvbmUgaW50ZXJ2YWwgaWYgdGhleSBhcmUgd2l0aGluIHRoZSBwYWlyaW5nIHJhbmdlXG4gIGlmICghdGhpcy5wYWlyaW5nRGlzYWJsZWQgJiYgX2VsaWdpYmxlRm9yUGFpcmluZyh0aGlzLCBkYXRhKSkge1xuICAgIGlmICh0aGlzLnBhaXJpbmdNaW5EaXN0YW5jZSA9PT0gbnVsbCkgeyBcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgYWRkIHBhaXJlZCBkYXRhIGFmdGVyIHRoZSBwYWlyaW5nIGludGVydmFsIGhhcyBiZWVuIHNldCEnKTtcbiAgICB9XG4gICAgXG4gICAgLy8gaW5zdGVhZCBvZiBzdG9yaW5nIHRoZW0gd2l0aCB0aGUgZ2l2ZW4gaWQsIHRoZSBwYWlyaW5nS2V5IChmb3IgQkFNLCBRTkFNRSkgaXMgdXNlZCBhcyB0aGUgaWQuXG4gICAgLy8gQXMgaW50ZXJ2YWxzIGFyZSBhZGRlZCwgd2UgY2hlY2sgaWYgYSByZWFkIHdpdGggdGhlIHNhbWUgcGFpcmluZ0tleSBhbHJlYWR5IGV4aXN0cyBpbiB0aGUgLnBhaXJlZCBJbnRlcnZhbFRyZWUuXG4gICAgbmV3SWQgPSBkYXRhW3RoaXMucGFpcmVkT3B0aW9ucy5wYWlyaW5nS2V5XTtcbiAgICBwb3RlbnRpYWxNYXRlID0gdGhpcy5wYWlyZWQuZ2V0KG5ld0lkKTtcbiAgICBcbiAgICBpZiAocG90ZW50aWFsTWF0ZSAhPT0gbnVsbCkge1xuICAgICAgcG90ZW50aWFsTWF0ZSA9IHBvdGVudGlhbE1hdGUuZGF0YTtcbiAgICAgIHBhaXJpbmdTdGF0ZSA9IF9wYWlyaW5nU3RhdGUodGhpcywgZGF0YSwgcG90ZW50aWFsTWF0ZSk7XG4gICAgICAvLyBBcmUgdGhlIHJlYWRzIHN1aXRhYmxlIGZvciBtYXRpbmc/XG4gICAgICBpZiAocGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX0RSQVdfQVNfTUFURVMgfHwgcGFpcmluZ1N0YXRlID09PSBQQUlSSU5HX01BVEVfT05MWSkge1xuICAgICAgICAvLyBJZiB5ZXM6IG1hdGUgdGhlIHJlYWRzXG4gICAgICAgIHBvdGVudGlhbE1hdGUubWF0ZSA9IGRhdGE7XG4gICAgICAgIC8vIEluIHRoZSBvdGhlciBkaXJlY3Rpb24sIGhhcyB0byBiZSBhIHNlbGVjdGl2ZSBzaGFsbG93IGNvcHkgdG8gYXZvaWQgY2lyY3VsYXIgcmVmZXJlbmNlcy5cbiAgICAgICAgZGF0YS5tYXRlID0gXy5leHRlbmQoe30sIF8ub21pdChwb3RlbnRpYWxNYXRlLCBmdW5jdGlvbih2LCBrKSB7IHJldHVybiBfLmlzT2JqZWN0KHYpfSkpO1xuICAgICAgICBkYXRhLm1hdGUuZmxhZ3MgPSBfLmNsb25lKHBvdGVudGlhbE1hdGUuZmxhZ3MpO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBBcmUgdGhlIG1hdGVkIHJlYWRzIHdpdGhpbiBkcmF3YWJsZSByYW5nZT8gSWYgc28sIHNpbXBseSBmbGFnIHRoYXQgdGhleSBzaG91bGQgYmUgZHJhd24gdG9nZXRoZXIsIGFuZCB0aGV5IHdpbGwuXG4gICAgLy8gQWx0ZXJuYXRpdmVseSwgaWYgdGhlIHBvdGVudGlhbE1hdGUgZXhwZWN0ZWQgYSBtYXRlLCB3ZSBzaG91bGQgbWF0ZSB0aGVtIGFueXdheS5cbiAgICAvLyBUaGUgb25seSByZWFzb24gd2Ugd291bGRuJ3QgZ2V0IC5kcmF3QXNNYXRlcyBpcyBpZiB0aGUgbWF0ZSB3YXMgb24gdGhlIHRocmVzaG9sZCBvZiB0aGUgaW5zZXJ0IHNpemUgcmFuZ2UuXG4gICAgaWYgKHBhaXJpbmdTdGF0ZSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTIHx8IChwYWlyaW5nU3RhdGUgPT09IFBBSVJJTkdfTUFURV9PTkxZICYmIHBvdGVudGlhbE1hdGUubWF0ZUV4cGVjdGVkKSkge1xuICAgICAgZGF0YS5kcmF3QXNNYXRlcyA9IHBvdGVudGlhbE1hdGUuZHJhd0FzTWF0ZXMgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPdGhlcndpc2UsIG5lZWQgdG8gaW5zZXJ0IHRoaXMgcmVhZCBpbnRvIHRoaXMucGFpcmVkIGFzIGEgc2VwYXJhdGUgcmVhZC5cbiAgICAgIC8vIEVuc3VyZSB0aGUgaWQgaXMgdW5pcXVlIGZpcnN0LlxuICAgICAgd2hpbGUgKHRoaXMucGFpcmVkLmNvbnRhaW5zKG5ld0lkKSkge1xuICAgICAgICBuZXdJZCA9IG5ld0lkLnJlcGxhY2UoL1xcdC4qLywgJycpICsgXCJcXHRcIiArICgrK2luY3JlbWVudCk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGRhdGEubWF0ZUV4cGVjdGVkID0gX3BhaXJpbmdTdGF0ZSh0aGlzLCBkYXRhKSA9PT0gUEFJUklOR19EUkFXX0FTX01BVEVTO1xuICAgICAgLy8gRklYTUU6IFRoZSBmb2xsb3dpbmcgaXMgcGVyaGFwcyBhIGJpdCB0b28gc3BlY2lmaWMgdG8gaG93IFRMRU4gZm9yIEJBTSBmaWxlcyB3b3JrczsgY291bGQgZ2VuZXJhbGl6ZSBsYXRlclxuICAgICAgLy8gV2hlbiBpbnNlcnRpbmcgaW50byAucGFpcmVkLCB0aGUgaW50ZXJ2YWwncyAuc3RhcnQgYW5kIC5lbmQgc2hvdWxkbid0IGJlIGJhc2VkIG9uIFBPUyBhbmQgdGhlIENJR0FSIHN0cmluZztcbiAgICAgIC8vIHdlIG11c3QgYWRqdXN0IHRoZW0gZm9yIFRMRU4sIGlmIGl0IGlzIG5vbnplcm8sIGRlcGVuZGluZyBvbiBpdHMgc2lnbiwgYW5kIHNldCBuZXcgYm91bmRzIGZvciB0aGUgaW50ZXJ2YWwuXG4gICAgICBpZiAoZGF0YS5tYXRlRXhwZWN0ZWQgJiYgcGFpcmVkTGVuZ3RoID4gMCkge1xuICAgICAgICBkYXRhW3BhaXJlZFN0YXJ0XSA9IGRhdGFbdW5wYWlyZWRTdGFydF07XG4gICAgICAgIGRhdGFbcGFpcmVkRW5kXSA9IGRhdGFbdW5wYWlyZWRTdGFydF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEubWF0ZUV4cGVjdGVkICYmIHBhaXJlZExlbmd0aCA8IDApIHtcbiAgICAgICAgZGF0YVtwYWlyZWRFbmRdID0gZGF0YVt1bnBhaXJlZEVuZF07XG4gICAgICAgIGRhdGFbcGFpcmVkU3RhcnRdID0gZGF0YVt1bnBhaXJlZEVuZF0gKyBwYWlyZWRMZW5ndGg7XG4gICAgICB9IGVsc2UgeyAvLyAhZGF0YS5tYXRlRXhwZWN0ZWQgfHwgcGFpcmVkTGVuZ3RoID09IDBcbiAgICAgICAgZGF0YVtwYWlyZWRTdGFydF0gPSBkYXRhW3VucGFpcmVkU3RhcnRdO1xuICAgICAgICBkYXRhW3BhaXJlZEVuZF0gPSBkYXRhW3VucGFpcmVkRW5kXTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdGhpcy5wYWlyZWQuYWRkKGRhdGEsIG5ld0lkKTtcbiAgICB9XG4gIH1cblxufTtcblxuXG4vKipcbiAqIGFsaWFzIC5hZGQoKSB0byAuYWRkSWZOZXcoKVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5hZGQgPSBQYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLmFkZElmTmV3O1xuXG5cbi8qKlxuICogc2VhcmNoXG4gKlxuICogQHBhcmFtIChudW1iZXIpIHZhbDpcbiAqIEByZXR1cm4gKGFycmF5KVxuICoqL1xuUGFpcmVkSW50ZXJ2YWxUcmVlLnByb3RvdHlwZS5zZWFyY2ggPSBmdW5jdGlvbih2YWwxLCB2YWwyLCBwYWlyZWQpIHtcbiAgaWYgKHBhaXJlZCAmJiAhdGhpcy5wYWlyaW5nRGlzYWJsZWQpIHtcbiAgICByZXR1cm4gdGhpcy5wYWlyZWQuc2VhcmNoKHZhbDEsIHZhbDIpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB0aGlzLnVucGFpcmVkLnNlYXJjaCh2YWwxLCB2YWwyKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIHJlbW92ZTogdW5pbXBsZW1lbnRlZCBmb3Igbm93XG4gKiovXG5QYWlyZWRJbnRlcnZhbFRyZWUucHJvdG90eXBlLnJlbW92ZSA9IGZ1bmN0aW9uKGludGVydmFsX2lkKSB7XG4gIHRocm93IFwiLnJlbW92ZSgpIGlzIGN1cnJlbnRseSB1bmltcGxlbWVudGVkXCI7XG59O1xuXG5cbi8qKlxuICogcHJpdmF0ZSBtZXRob2RzXG4gKiovXG5cbi8vIENoZWNrIGlmIGFuIGl0dmwgaXMgZWxpZ2libGUgZm9yIHBhaXJpbmcuIFxuLy8gRm9yIG5vdywgdGhpcyBtZWFucyB0aGF0IGlmIGFueSBGTEFHJ3MgMHgxMDAgb3IgaGlnaGVyIGFyZSBzZXQsIHdlIHRvdGFsbHkgZGlzY2FyZCB0aGlzIGFsaWdubWVudCBhbmQgaW50ZXJ2YWwuXG4vLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBlbnRhbmdsZWQgd2l0aCBiYW0uanMgaW50ZXJuYWxzOyBwZXJoYXBzIGFsbG93IHRoaXMgdG8gYmUgZ2VuZXJhbGl6ZWQsIG92ZXJyaWRkZW4sXG4vLyAgICAgICAgb3Igc2V0IGFsb25nc2lkZSAuc2V0UGFpcmluZ0ludGVydmFsKClcbi8vXG4vLyBAcmV0dXJuIChib29sZWFuKVxuZnVuY3Rpb24gX2VsaWdpYmxlRm9yUGFpcmluZyhwYWlyZWRJdHZsVHJlZSwgaXR2bCkge1xuICB2YXIgZmxhZ3MgPSBpdHZsLmZsYWdzO1xuICBpZiAoZmxhZ3MuaXNTZWNvbmRhcnlBbGlnbm1lbnQgfHwgZmxhZ3MuaXNSZWFkRmFpbGluZ1ZlbmRvclFDIHx8IGZsYWdzLmlzRHVwbGljYXRlUmVhZCB8fCBmbGFncy5pc1N1cHBsZW1lbnRhcnlBbGlnbm1lbnQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIENoZWNrIGlmIGFuIGl0dmwgYW5kIGl0cyBwb3RlbnRpYWxNYXRlIGFyZSB3aXRoaW4gdGhlIHJpZ2h0IGRpc3RhbmNlLCBhbmQgb3JpZW50YXRpb24sIHRvIGJlIG1hdGVkLlxuLy8gSWYgcG90ZW50aWFsTWF0ZSBpc24ndCBnaXZlbiwgdGFrZXMgYSBiZXN0IGd1ZXNzIGlmIGEgbWF0ZSBpcyBleHBlY3RlZCwgZ2l2ZW4gdGhlIGluZm9ybWF0aW9uIGluIGl0dmwgYWxvbmUuXG4vLyBGSVhNRTogVGhlIGZvbGxvd2luZyBpcyBlbnRhbmdsZWQgd2l0aCBiYW0uanMgaW50ZXJuYWxzOyBwZXJoYXBzIGFsbG93IHRoaXMgdG8gYmUgZ2VuZXJhbGl6ZWQsIG92ZXJyaWRkZW4sXG4vLyAgICAgICAgb3Igc2V0IGFsb25nc2lkZSAuc2V0UGFpcmluZ0ludGVydmFsKClcbi8vIFxuLy8gQHJldHVybiAobnVtYmVyKVxuZnVuY3Rpb24gX3BhaXJpbmdTdGF0ZShwYWlyZWRJdHZsVHJlZSwgaXR2bCwgcG90ZW50aWFsTWF0ZSkge1xuICB2YXIgdGxlbiA9IGl0dmxbcGFpcmVkSXR2bFRyZWUucGFpcmVkT3B0aW9ucy5wYWlyZWRMZW5ndGhLZXldLFxuICAgIGl0dmxMZW5ndGggPSBpdHZsLmVuZCAtIGl0dmwuc3RhcnQsXG4gICAgaXR2bElzTGF0ZXIsIGluZmVycmVkSW5zZXJ0U2l6ZTtcblxuICBpZiAoXy5pc1VuZGVmaW5lZChwb3RlbnRpYWxNYXRlKSkge1xuICAgIC8vIENyZWF0ZSB0aGUgbW9zdCByZWNlcHRpdmUgaHlwb3RoZXRpY2FsIG1hdGUsIGdpdmVuIHRoZSBpbmZvcm1hdGlvbiBpbiBpdHZsLlxuICAgIHBvdGVudGlhbE1hdGUgPSB7XG4gICAgICBfbW9ja2VkOiB0cnVlLFxuICAgICAgZmxhZ3M6IHtcbiAgICAgICAgaXNSZWFkUGFpcmVkOiB0cnVlLFxuICAgICAgICBpc1JlYWRQcm9wZXJseUFsaWduZWQ6IHRydWUsXG4gICAgICAgIGlzUmVhZEZpcnN0T2ZQYWlyOiBpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIsXG4gICAgICAgIGlzUmVhZExhc3RPZlBhaXI6IGl0dmwuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXJcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gRmlyc3QgY2hlY2sgYSB3aG9sZSBob3N0IG9mIEZMQUcncy4gVG8gbWFrZSBhIGxvbmcgc3Rvcnkgc2hvcnQsIHdlIGV4cGVjdCBwYWlyZWQgZW5kcyB0byBiZSBlaXRoZXJcbiAgLy8gOTktMTQ3IG9yIDE2My04MywgZGVwZW5kaW5nIG9uIHdoZXRoZXIgdGhlIHJpZ2h0bW9zdCBvciBsZWZ0bW9zdCBzZWdtZW50IGlzIHByaW1hcnkuXG4gIGlmICghaXR2bC5mbGFncy5pc1JlYWRQYWlyZWQgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkUGFpcmVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmICghaXR2bC5mbGFncy5pc1JlYWRQcm9wZXJseUFsaWduZWQgfHwgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkUHJvcGVybHlBbGlnbmVkKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZFVubWFwcGVkIHx8IHBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkVW5tYXBwZWQpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgaWYgKGl0dmwuZmxhZ3MuaXNNYXRlVW5tYXBwZWQgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5pc01hdGVVbm1hcHBlZCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICBpZiAoaXR2bC5mbGFncy5pc1JlYWRGaXJzdE9mUGFpciAmJiAhcG90ZW50aWFsTWF0ZS5mbGFncy5pc1JlYWRMYXN0T2ZQYWlyKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gIGlmIChpdHZsLmZsYWdzLmlzUmVhZExhc3RPZlBhaXIgJiYgIXBvdGVudGlhbE1hdGUuZmxhZ3MuaXNSZWFkRmlyc3RPZlBhaXIpIHsgcmV0dXJuIFBBSVJJTkdfQ0FOTk9UX01BVEU7IH1cbiAgICBcbiAgaWYgKHBvdGVudGlhbE1hdGUuX21vY2tlZCkge1xuICAgIF8uZXh0ZW5kKHBvdGVudGlhbE1hdGUsIHtcbiAgICAgIHJuYW1lOiBpdHZsLnJuZXh0ID09ICc9JyA/IGl0dmwucm5hbWUgOiBpdHZsLnJuZXh0LFxuICAgICAgcG9zOiBpdHZsLnBuZXh0LFxuICAgICAgc3RhcnQ6IGl0dmwucm5leHQgPT0gJz0nID8gcGFyc2VJbnQxMChpdHZsLnBuZXh0KSArIChpdHZsLnN0YXJ0IC0gcGFyc2VJbnQxMChpdHZsLnBvcykpIDogMCxcbiAgICAgIGVuZDogdGxlbiA+IDAgPyBpdHZsLnN0YXJ0ICsgdGxlbiA6ICh0bGVuIDwgMCA/IGl0dmwuZW5kICsgdGxlbiArIGl0dmxMZW5ndGggOiAwKSxcbiAgICAgIHJuZXh0OiBpdHZsLnJuZXh0ID09ICc9JyA/ICc9JyA6IGl0dmwucm5hbWUsXG4gICAgICBwbmV4dDogaXR2bC5wb3NcbiAgICB9KTtcbiAgfVxuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgb24gdGhlIHNhbWUgcmVmZXJlbmNlIHNlcXVlbmNlXG4gIGlmIChpdHZsLnJuZXh0ICE9ICc9JyB8fCBwb3RlbnRpYWxNYXRlLnJuZXh0ICE9ICc9JykgeyBcbiAgICAvLyBhbmQgaWYgbm90LCBkbyB0aGUgY29vcmRpbmF0ZXMgbWF0Y2ggYXQgYWxsP1xuICAgIGlmIChpdHZsLnJuZXh0ICE9IHBvdGVudGlhbE1hdGUucm5hbWUgfHwgaXR2bC5ybmV4dCAhPSBwb3RlbnRpYWxNYXRlLnJuYW1lKSB7IHJldHVybiBQQUlSSU5HX0NBTk5PVF9NQVRFOyB9XG4gICAgaWYgKGl0dmwucG5leHQgIT0gcG90ZW50aWFsTWF0ZS5wb3MgfHwgaXR2bC5wb3MgIT0gcG90ZW50aWFsTWF0ZS5wbmV4dCkgeyByZXR1cm4gUEFJUklOR19DQU5OT1RfTUFURTsgfVxuICAgIHJldHVybiBQQUlSSU5HX01BVEVfT05MWTtcbiAgfVxuICBcbiAgaWYgKHBvdGVudGlhbE1hdGUuX21vY2tlZCkge1xuICAgIF8uZXh0ZW5kKHBvdGVudGlhbE1hdGUuZmxhZ3MsIHtcbiAgICAgIHJlYWRTdHJhbmRSZXZlcnNlOiBpdHZsLmZsYWdzLm1hdGVTdHJhbmRSZXZlcnNlLFxuICAgICAgbWF0ZVN0cmFuZFJldmVyc2U6IGl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2VcbiAgICB9KTtcbiAgfSBcbiAgXG4gIGl0dmxJc0xhdGVyID0gaXR2bC5zdGFydCA+IHBvdGVudGlhbE1hdGUuc3RhcnQ7XG4gIGluZmVycmVkSW5zZXJ0U2l6ZSA9IE1hdGguYWJzKHRsZW4pO1xuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgYWxpZ25tZW50cyBhcmUgLS0+IDwtLVxuICBpZiAoaXR2bElzTGF0ZXIpIHtcbiAgICBpZiAoIWl0dmwuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAocG90ZW50aWFsTWF0ZS5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoaXR2bC5mbGFncy5yZWFkU3RyYW5kUmV2ZXJzZSB8fCAhaXR2bC5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgICBpZiAoIXBvdGVudGlhbE1hdGUuZmxhZ3MucmVhZFN0cmFuZFJldmVyc2UgfHwgcG90ZW50aWFsTWF0ZS5mbGFncy5tYXRlU3RyYW5kUmV2ZXJzZSkgeyByZXR1cm4gUEFJUklOR19NQVRFX09OTFk7IH1cbiAgfVxuICBcbiAgLy8gQ2hlY2sgdGhhdCB0aGUgaW5mZXJyZWRJbnNlcnRTaXplIGlzIHdpdGhpbiB0aGUgYWNjZXB0YWJsZSByYW5nZS5cbiAgaXR2bC5pbnNlcnRTaXplID0gcG90ZW50aWFsTWF0ZS5pbnNlcnRTaXplID0gaW5mZXJyZWRJbnNlcnRTaXplO1xuICBpZiAoaW5mZXJyZWRJbnNlcnRTaXplID4gdGhpcy5wYWlyaW5nTWF4RGlzdGFuY2UgfHwgaW5mZXJyZWRJbnNlcnRTaXplIDwgdGhpcy5wYWlyaW5nTWluRGlzdGFuY2UpIHsgcmV0dXJuIFBBSVJJTkdfTUFURV9PTkxZOyB9XG4gIFxuICByZXR1cm4gUEFJUklOR19EUkFXX0FTX01BVEVTO1xufVxuXG5leHBvcnRzLlBhaXJlZEludGVydmFsVHJlZSA9IFBhaXJlZEludGVydmFsVHJlZTtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcblxudmFyIF8gPSByZXF1aXJlKCcuLi8uLi8uLi91bmRlcnNjb3JlLm1pbi5qcycpO1xuXG4vKipcbiAgKiBSZW1vdGVUcmFja1xuICAqXG4gICogQSBoZWxwZXIgY2xhc3MgYnVpbHQgZm9yIGNhY2hpbmcgZGF0YSBmZXRjaGVkIGZyb20gYSByZW1vdGUgdHJhY2sgKGRhdGEgYWxpZ25lZCB0byBhIGdlbm9tZSkuXG4gICogVGhlIGdlbm9tZSBpcyBkaXZpZGVkIGludG8gYmlucyBvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgbnRzLCBmb3IgZWFjaCBvZiB3aGljaCBkYXRhIHdpbGwgb25seSBiZSBmZXRjaGVkIG9uY2UuXG4gICogVG8gc2V0dXAgdGhlIGJpbnMsIGNhbGwgLnNldHVwQmlucyguLi4pIGFmdGVyIGluaXRpYWxpemluZyB0aGUgY2xhc3MuXG4gICpcbiAgKiBUaGVyZSBpcyBvbmUgbWFpbiBwdWJsaWMgbWV0aG9kIGZvciB0aGlzIGNsYXNzOiAuZmV0Y2hBc3luYyhzdGFydCwgZW5kLCBjYWxsYmFjaylcbiAgKiAoRm9yIGNvbnNpc3RlbmN5IHdpdGggQ3VzdG9tVHJhY2tzLmpzLCBhbGwgYHN0YXJ0YCBhbmQgYGVuZGAgcG9zaXRpb25zIGFyZSAxLWJhc2VkLCBvcmllbnRlZCB0b1xuICAqIHRoZSBzdGFydCBvZiB0aGUgZ2Vub21lLCBhbmQgaW50ZXJ2YWxzIGFyZSByaWdodC1vcGVuLilcbiAgKlxuICAqIFRoaXMgbWV0aG9kIHdpbGwgcmVxdWVzdCBhbmQgY2FjaGUgZGF0YSBmb3IgdGhlIGdpdmVuIGludGVydmFsIHRoYXQgaXMgbm90IGFscmVhZHkgY2FjaGVkLCBhbmQgY2FsbCBcbiAgKiBjYWxsYmFjayhpbnRlcnZhbHMpIGFzIHNvb24gYXMgZGF0YSBmb3IgYWxsIGludGVydmFscyBpcyBhdmFpbGFibGUuIChJZiB0aGUgZGF0YSBpcyBhbHJlYWR5IGF2YWlsYWJsZSwgXG4gICogaXQgd2lsbCBjYWxsIHRoZSBjYWxsYmFjayBpbW1lZGlhdGVseS4pXG4gICoqL1xuXG52YXIgQklOX0xPQURJTkcgPSAxLFxuICBCSU5fTE9BREVEID0gMjtcblxuLyoqXG4gICogUmVtb3RlVHJhY2sgY29uc3RydWN0b3IuXG4gICpcbiAgKiBOb3RlIHlvdSBzdGlsbCBtdXN0IGNhbGwgYC5zZXR1cEJpbnMoLi4uKWAgYmVmb3JlIHRoZSBSZW1vdGVUcmFjayBpcyByZWFkeSB0byBmZXRjaCBkYXRhLlxuICAqXG4gICogQHBhcmFtIChJbnRlcnZhbFRyZWUpIGNhY2hlOiBBbiBjYWNoZSBzdG9yZSB0aGF0IHdpbGwgcmVjZWl2ZSBpbnRlcnZhbHMgZmV0Y2hlZCBmb3IgZWFjaCBiaW4uXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBTaG91bGQgYmUgYW4gSW50ZXJ2YWxUcmVlIG9yIGVxdWl2YWxlbnQsIHRoYXQgaW1wbGVtZW50cyBgLmFkZElmTmV3KC4uLilgIGFuZCBcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAuc2VhcmNoKHN0YXJ0LCBlbmQpYCBtZXRob2RzLiBJZiBpdCBpcyBhbiAqZXh0ZW5zaW9uKiBvZiBhbiBJbnRlcnZhbFRyZWUsIG5vdGUgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgYGV4dHJhQXJnc2AgcGFyYW0gcGVybWl0dGVkIGZvciBgLmZldGNoQXN5bmMoKWAsIHdoaWNoIGFyZSBwYXNzZWQgYWxvbmcgYXMgXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHRyYSBhcmd1bWVudHMgdG8gYC5zZWFyY2goKWAuXG4gICogQHBhcmFtIChmdW5jdGlvbikgZmV0Y2hlcjogQSBmdW5jdGlvbiB0aGF0IHdpbGwgYmUgY2FsbGVkIHRvIGZldGNoIGRhdGEgZm9yIGVhY2ggYmluLlxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgZnVuY3Rpb24gc2hvdWxkIHRha2UgdGhyZWUgYXJndW1lbnRzLCBgc3RhcnRgLCBgZW5kYCwgYW5kIGBzdG9yZUludGVydmFsc2AuXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlcyBmb3JtaW5nIGEgcmlnaHQtb3BlbiBpbnRlcnZhbC5cbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgc3RvcmVJbnRlcnZhbHNgIGlzIGEgY2FsbGJhY2sgdGhhdCBgZmV0Y2hlcmAgTVVTVCBjYWxsIG9uIHRoZSBhcnJheSBvZiBpbnRlcnZhbHNcbiAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbmNlIHRoZXkgaGF2ZSBiZWVuIGZldGNoZWQgZnJvbSB0aGUgcmVtb3RlIGRhdGEgc291cmNlIGFuZCBwYXJzZWQuXG4gICogQHNlZSBfZmV0Y2hCaW4gZm9yIGhvdyBgZmV0Y2hlcmAgaXMgdXRpbGl6ZWQuXG4gICoqL1xuZnVuY3Rpb24gUmVtb3RlVHJhY2soY2FjaGUsIGZldGNoZXIpIHtcbiAgaWYgKHR5cGVvZiBjYWNoZSAhPSAnb2JqZWN0JyB8fCAoIWNhY2hlLmFkZElmTmV3ICYmICghXy5rZXlzKGNhY2hlKS5sZW5ndGggfHwgY2FjaGVbXy5rZXlzKGNhY2hlKVswXV0uYWRkSWZOZXcpKSkgeyBcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYW4gSW50ZXJ2YWxUcmVlIGNhY2hlLCBvciBhbiBvYmplY3QvYXJyYXkgY29udGFpbmluZyBJbnRlcnZhbFRyZWVzLCBhcyB0aGUgMXN0IGFyZ3VtZW50LicpOyBcbiAgfVxuICBpZiAodHlwZW9mIGZldGNoZXIgIT0gJ2Z1bmN0aW9uJykgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBtdXN0IHNwZWNpZnkgYSBmZXRjaGVyIGZ1bmN0aW9uIGFzIHRoZSAybmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHRoaXMuY2FjaGUgPSBjYWNoZTtcbiAgdGhpcy5mZXRjaGVyID0gZmV0Y2hlcjtcbiAgXG4gIHRoaXMuY2FsbGJhY2tzID0gW107XG4gIHRoaXMuYWZ0ZXJCaW5TZXR1cCA9IFtdO1xuICB0aGlzLmJpbnNMb2FkZWQgPSBudWxsO1xufVxuXG4vKipcbiAqIHB1YmxpYyBtZXRob2RzXG4gKiovXG5cbi8vIFNldHVwIHRoZSBiaW5uaW5nIHNjaGVtZSBmb3IgdGhpcyBSZW1vdGVUcmFjay4gVGhpcyBjYW4gb2NjdXIgYW55dGltZSBhZnRlciBpbml0aWFsaXphdGlvbiwgYW5kIGluIGZhY3QsXG4vLyBjYW4gb2NjdXIgYWZ0ZXIgY2FsbHMgdG8gYC5mZXRjaEFzeW5jKClgIGhhdmUgYmVlbiBtYWRlLCBpbiB3aGljaCBjYXNlIHRoZXkgd2lsbCBiZSB3YWl0aW5nIG9uIHRoaXMgbWV0aG9kXG4vLyB0byBiZSBjYWxsZWQgdG8gcHJvY2VlZC4gQnV0IGl0IE1VU1QgYmUgY2FsbGVkIGJlZm9yZSBkYXRhIHdpbGwgYmUgcmVjZWl2ZWQgYnkgY2FsbGJhY2tzIHBhc3NlZCB0byBcbi8vIGAuZmV0Y2hBc3luYygpYC5cblJlbW90ZVRyYWNrLnByb3RvdHlwZS5zZXR1cEJpbnMgPSBmdW5jdGlvbihnZW5vbWVTaXplLCBvcHRpbWFsRmV0Y2hXaW5kb3csIG1heEZldGNoV2luZG93KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHNlbGYuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgcnVuIHNldHVwQmlucyBtb3JlIHRoYW4gb25jZS4nKTsgfVxuICBpZiAodHlwZW9mIGdlbm9tZVNpemUgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IHRoZSBnZW5vbWVTaXplIGFzIHRoZSAxc3QgYXJndW1lbnQuJyk7IH1cbiAgaWYgKHR5cGVvZiBvcHRpbWFsRmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG9wdGltYWxGZXRjaFdpbmRvdyBhcyB0aGUgMm5kIGFyZ3VtZW50LicpOyB9XG4gIGlmICh0eXBlb2YgbWF4RmV0Y2hXaW5kb3cgIT0gJ251bWJlcicpIHsgdGhyb3cgbmV3IEVycm9yKCd5b3UgbXVzdCBzcGVjaWZ5IG1heEZldGNoV2luZG93IGFzIHRoZSAzcmQgYXJndW1lbnQuJyk7IH1cbiAgXG4gIHNlbGYuZ2Vub21lU2l6ZSA9IGdlbm9tZVNpemU7XG4gIHNlbGYub3B0aW1hbEZldGNoV2luZG93ID0gb3B0aW1hbEZldGNoV2luZG93O1xuICBzZWxmLm1heEZldGNoV2luZG93ID0gbWF4RmV0Y2hXaW5kb3c7XG4gIFxuICBzZWxmLm51bUJpbnMgPSBNYXRoLmNlaWwoZ2Vub21lU2l6ZSAvIG9wdGltYWxGZXRjaFdpbmRvdyk7XG4gIHNlbGYuYmluc0xvYWRlZCA9IHt9O1xuICBcbiAgLy8gRmlyZSBvZmYgcmFuZ2VzIHNhdmVkIHRvIGFmdGVyQmluU2V0dXBcbiAgXy5lYWNoKHRoaXMuYWZ0ZXJCaW5TZXR1cCwgZnVuY3Rpb24ocmFuZ2UpIHtcbiAgICBzZWxmLmZldGNoQXN5bmMocmFuZ2Uuc3RhcnQsIHJhbmdlLmVuZCwgcmFuZ2UuZXh0cmFBcmdzKTtcbiAgfSk7XG4gIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhzZWxmKTtcbn1cblxuXG4vLyBGZXRjaGVzIGRhdGEgKGlmIG5lY2Vzc2FyeSkgZm9yIHVuZmV0Y2hlZCBiaW5zIG92ZXJsYXBwaW5nIHdpdGggdGhlIGludGVydmFsIGZyb20gYHN0YXJ0YCB0byBgZW5kYC5cbi8vIFRoZW4sIHJ1biBgY2FsbGJhY2tgIG9uIGFsbCBzdG9yZWQgc3ViaW50ZXJ2YWxzIHRoYXQgb3ZlcmxhcCB3aXRoIHRoZSBpbnRlcnZhbCBmcm9tIGBzdGFydGAgdG8gYGVuZGAuXG4vLyBgZXh0cmFBcmdzYCBpcyBhbiAqb3B0aW9uYWwqIHBhcmFtZXRlciB0aGF0IGNhbiBjb250YWluIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIGAuc2VhcmNoKClgIGZ1bmN0aW9uIG9mIHRoZSBjYWNoZS5cbi8vXG4vLyBAcGFyYW0gKG51bWJlcikgc3RhcnQ6ICAgICAgIDEtYmFzZWQgZ2Vub21pYyBjb29yZGluYXRlIHRvIHN0YXJ0IGZldGNoaW5nIGZyb21cbi8vIEBwYXJhbSAobnVtYmVyKSBlbmQ6ICAgICAgICAgMS1iYXNlZCBnZW5vbWljIGNvb3JkaW5hdGUgKHJpZ2h0LW9wZW4pIHRvIHN0YXJ0IGZldGNoaW5nICp1bnRpbCpcbi8vIEBwYXJhbSAoQXJyYXkpIFtleHRyYUFyZ3NdOiAgb3B0aW9uYWwsIHBhc3NlZCBhbG9uZyB0byB0aGUgYC5zZWFyY2goKWAgY2FsbHMgb24gdGhlIC5jYWNoZSBhcyBhcmd1bWVudHMgMyBhbmQgdXA7IFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwZXJoYXBzIHVzZWZ1bCBpZiB0aGUgLmNhY2hlIGhhcyBvdmVycmlkZGVuIHRoaXMgbWV0aG9kXG4vLyBAcGFyYW0gKGZ1bmN0aW9uKSBjYWxsYmFjazogIEEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGNhbGxlZCBvbmNlIGRhdGEgaXMgcmVhZHkgZm9yIHRoaXMgaW50ZXJ2YWwuIFdpbGwgYmUgcGFzc2VkXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsbCBpbnRlcnZhbCBmZWF0dXJlcyB0aGF0IGhhdmUgYmVlbiBmZXRjaGVkIGZvciB0aGlzIGludGVydmFsLCBvciB7dG9vTWFueTogdHJ1ZX1cbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgbW9yZSBkYXRhIHdhcyByZXF1ZXN0ZWQgdGhhbiBjb3VsZCBiZSByZWFzb25hYmx5IGZldGNoZWQuXG5SZW1vdGVUcmFjay5wcm90b3R5cGUuZmV0Y2hBc3luYyA9IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGV4dHJhQXJncywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoXy5pc0Z1bmN0aW9uKGV4dHJhQXJncykgJiYgXy5pc1VuZGVmaW5lZChjYWxsYmFjaykpIHsgY2FsbGJhY2sgPSBleHRyYUFyZ3M7IGV4dHJhQXJncyA9IHVuZGVmaW5lZDsgfVxuICBpZiAoIXNlbGYuYmluc0xvYWRlZCkge1xuICAgIC8vIElmIGJpbnMgKmFyZW4ndCogc2V0dXAgeWV0OlxuICAgIC8vIFNhdmUgdGhlIGNhbGxiYWNrIG9udG8gdGhlIHF1ZXVlXG4gICAgaWYgKF8uaXNGdW5jdGlvbihjYWxsYmFjaykpIHsgXG4gICAgICBzZWxmLmNhbGxiYWNrcy5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJncywgY2FsbGJhY2s6IGNhbGxiYWNrfSk7IFxuICAgIH1cbiAgICBcbiAgICAvLyBTYXZlIHRoaXMgZmV0Y2ggZm9yIHdoZW4gdGhlIGJpbnMgYXJlIGxvYWRlZFxuICAgIHNlbGYuYWZ0ZXJCaW5TZXR1cC5wdXNoKHtzdGFydDogc3RhcnQsIGVuZDogZW5kLCBleHRyYUFyZ3M6IGV4dHJhQXJnc30pO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGJpbnMgKmFyZSogc2V0dXAsIGZpcnN0IGNhbGN1bGF0ZSB3aGljaCBiaW5zIGNvcnJlc3BvbmQgdG8gdGhpcyBpbnRlcnZhbCwgXG4gICAgLy8gYW5kIHdoYXQgc3RhdGUgdGhvc2UgYmlucyBhcmUgaW5cbiAgICB2YXIgYmlucyA9IF9iaW5PdmVybGFwKHNlbGYsIHN0YXJ0LCBlbmQpLFxuICAgICAgbG9hZGVkQmlucyA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuIHNlbGYuYmluc0xvYWRlZFtpXSA9PT0gQklOX0xPQURFRDsgfSksXG4gICAgICBiaW5zVG9GZXRjaCA9IF8uZmlsdGVyKGJpbnMsIGZ1bmN0aW9uKGkpIHsgcmV0dXJuICFzZWxmLmJpbnNMb2FkZWRbaV07IH0pO1xuICAgIFxuICAgIGlmIChsb2FkZWRCaW5zLmxlbmd0aCA9PSBiaW5zLmxlbmd0aCkge1xuICAgICAgLy8gSWYgd2UndmUgYWxyZWFkeSBsb2FkZWQgZGF0YSBmb3IgYWxsIHRoZSBiaW5zIGluIHF1ZXN0aW9uLCBzaG9ydC1jaXJjdWl0IGFuZCBydW4gdGhlIGNhbGxiYWNrIG5vd1xuICAgICAgZXh0cmFBcmdzID0gXy5pc1VuZGVmaW5lZChleHRyYUFyZ3MpID8gW10gOiBleHRyYUFyZ3M7XG4gICAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjayhzZWxmLmNhY2hlLnNlYXJjaC5hcHBseShzZWxmLmNhY2hlLCBbc3RhcnQsIGVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICB9IGVsc2UgaWYgKGVuZCAtIHN0YXJ0ID4gc2VsZi5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgLy8gZWxzZSwgaWYgdGhpcyBpbnRlcnZhbCBpcyB0b28gYmlnICg+IG1heEZldGNoV2luZG93KSwgZmlyZSB0aGUgY2FsbGJhY2sgcmlnaHQgYXdheSB3aXRoIHt0b29NYW55OiB0cnVlfVxuICAgICAgcmV0dXJuIF8uaXNGdW5jdGlvbihjYWxsYmFjaykgJiYgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gZWxzZSwgcHVzaCB0aGUgY2FsbGJhY2sgb250byB0aGUgcXVldWVcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnB1c2goe3N0YXJ0OiBzdGFydCwgZW5kOiBlbmQsIGV4dHJhQXJnczogZXh0cmFBcmdzLCBjYWxsYmFjazogY2FsbGJhY2t9KTsgXG4gICAgfVxuICAgIFxuICAgIC8vIHRoZW4gcnVuIGZldGNoZXMgZm9yIHRoZSB1bmZldGNoZWQgYmlucywgd2hpY2ggc2hvdWxkIGNhbGwgX2ZpcmVDYWxsYmFja3MgYWZ0ZXIgdGhleSBjb21wbGV0ZSxcbiAgICAvLyB3aGljaCB3aWxsIGF1dG9tYXRpY2FsbHkgZmlyZSBjYWxsYmFja3MgZnJvbSB0aGUgYWJvdmUgcXVldWUgYXMgdGhleSBhY3F1aXJlIGFsbCBuZWVkZWQgZGF0YS5cbiAgICBfLmVhY2goYmluc1RvRmV0Y2gsIGZ1bmN0aW9uKGJpbkluZGV4KSB7XG4gICAgICBfZmV0Y2hCaW4oc2VsZiwgYmluSW5kZXgsIGZ1bmN0aW9uKCkgeyBfZmlyZUNhbGxiYWNrcyhzZWxmKTsgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuXG4vKipcbiAqIHByaXZhdGUgbWV0aG9kc1xuICoqL1xuXG4vLyBDYWxjdWxhdGVzIHdoaWNoIGJpbnMgb3ZlcmxhcCB3aXRoIGFuIGludGVydmFsIGdpdmVuIGJ5IGBzdGFydGAgYW5kIGBlbmRgLlxuLy8gYHN0YXJ0YCBhbmQgYGVuZGAgYXJlIDEtYmFzZWQgY29vcmRpbmF0ZXMgZm9ybWluZyBhIHJpZ2h0LW9wZW4gaW50ZXJ2YWwuXG5mdW5jdGlvbiBfYmluT3ZlcmxhcChyZW1vdGVUcmssIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFyZW1vdGVUcmsuYmluc0xvYWRlZCkgeyB0aHJvdyBuZXcgRXJyb3IoJ3lvdSBjYW5ub3QgY2FsY3VsYXRlIGJpbiBvdmVybGFwIGJlZm9yZSBzZXR1cEJpbnMgaXMgY2FsbGVkLicpOyB9XG4gIC8vIEludGVybmFsbHksIGZvciBhc3NpZ25pbmcgY29vcmRpbmF0ZXMgdG8gYmlucywgd2UgdXNlIDAtYmFzZWQgY29vcmRpbmF0ZXMgZm9yIGVhc2llciBjYWxjdWxhdGlvbnMuXG4gIHZhciBzdGFydEJpbiA9IE1hdGguZmxvb3IoKHN0YXJ0IC0gMSkgLyByZW1vdGVUcmsub3B0aW1hbEZldGNoV2luZG93KSxcbiAgICBlbmRCaW4gPSBNYXRoLmZsb29yKChlbmQgLSAxKSAvIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cpO1xuICByZXR1cm4gXy5yYW5nZShzdGFydEJpbiwgZW5kQmluICsgMSk7XG59XG5cbi8vIFJ1bnMgdGhlIGZldGNoZXIgZnVuY3Rpb24gb24gYSBnaXZlbiBiaW4uXG4vLyBUaGUgZmV0Y2hlciBmdW5jdGlvbiBpcyBvYmxpZ2F0ZWQgdG8gcnVuIGEgY2FsbGJhY2sgZnVuY3Rpb24gYHN0b3JlSW50ZXJ2YWxzYCwgXG4vLyAgICBwYXNzZWQgYXMgaXRzIHRoaXJkIGFyZ3VtZW50LCBvbiBhIHNldCBvZiBpbnRlcnZhbHMgdGhhdCB3aWxsIGJlIGluc2VydGVkIGludG8gdGhlIFxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIEludGVydmFsVHJlZS5cbi8vIFRoZSBgc3RvcmVJbnRlcnZhbHNgIGZ1bmN0aW9uIG1heSBhY2NlcHQgYSBzZWNvbmQgYXJndW1lbnQgY2FsbGVkIGBjYWNoZUluZGV4YCwgaW4gY2FzZVxuLy8gICAgcmVtb3RlVHJrLmNhY2hlIGlzIGFjdHVhbGx5IGEgY29udGFpbmVyIGZvciBtdWx0aXBsZSBJbnRlcnZhbFRyZWVzLCBpbmRpY2F0aW5nIHdoaWNoIFxuLy8gICAgb25lIHRvIHN0b3JlIGl0IGluLlxuLy8gV2UgdGhlbiBjYWxsIHRoZSBgY2FsbGJhY2tgIGdpdmVuIGhlcmUgYWZ0ZXIgdGhhdCBpcyBjb21wbGV0ZS5cbmZ1bmN0aW9uIF9mZXRjaEJpbihyZW1vdGVUcmssIGJpbkluZGV4LCBjYWxsYmFjaykge1xuICB2YXIgc3RhcnQgPSBiaW5JbmRleCAqIHJlbW90ZVRyay5vcHRpbWFsRmV0Y2hXaW5kb3cgKyAxLFxuICAgIGVuZCA9IChiaW5JbmRleCArIDEpICogcmVtb3RlVHJrLm9wdGltYWxGZXRjaFdpbmRvdyArIDE7XG4gIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FESU5HO1xuICByZW1vdGVUcmsuZmV0Y2hlcihzdGFydCwgZW5kLCBmdW5jdGlvbiBzdG9yZUludGVydmFscyhpbnRlcnZhbHMpIHtcbiAgICBfLmVhY2goaW50ZXJ2YWxzLCBmdW5jdGlvbihpbnRlcnZhbCkge1xuICAgICAgaWYgKCFpbnRlcnZhbCkgeyByZXR1cm47IH1cbiAgICAgIHJlbW90ZVRyay5jYWNoZS5hZGRJZk5ldyhpbnRlcnZhbCwgaW50ZXJ2YWwuaWQpO1xuICAgIH0pO1xuICAgIHJlbW90ZVRyay5iaW5zTG9hZGVkW2JpbkluZGV4XSA9IEJJTl9MT0FERUQ7XG4gICAgXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSAmJiBjYWxsYmFjaygpO1xuICB9KTtcbn1cblxuLy8gUnVucyB0aHJvdWdoIGFsbCBzYXZlZCBjYWxsYmFja3MgYW5kIGZpcmVzIGFueSBjYWxsYmFja3Mgd2hlcmUgYWxsIHRoZSByZXF1aXJlZCBkYXRhIGlzIHJlYWR5XG4vLyBDYWxsYmFja3MgdGhhdCBhcmUgZmlyZWQgYXJlIHJlbW92ZWQgZnJvbSB0aGUgcXVldWUuXG5mdW5jdGlvbiBfZmlyZUNhbGxiYWNrcyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjayxcbiAgICAgIGV4dHJhQXJncyA9IF8uaXNVbmRlZmluZWQoYWZ0ZXJMb2FkLmV4dHJhQXJncykgPyBbXSA6IGFmdGVyTG9hZC5leHRyYUFyZ3MsXG4gICAgICBiaW5zLCBzdGlsbExvYWRpbmdCaW5zO1xuICAgICAgICBcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgXG4gICAgYmlucyA9IF9iaW5PdmVybGFwKHJlbW90ZVRyaywgYWZ0ZXJMb2FkLnN0YXJ0LCBhZnRlckxvYWQuZW5kKTtcbiAgICBzdGlsbExvYWRpbmdCaW5zID0gXy5maWx0ZXIoYmlucywgZnVuY3Rpb24oaSkgeyByZXR1cm4gcmVtb3RlVHJrLmJpbnNMb2FkZWRbaV0gIT09IEJJTl9MT0FERUQ7IH0pLmxlbmd0aCA+IDA7XG4gICAgaWYgKCFzdGlsbExvYWRpbmdCaW5zKSB7XG4gICAgICBjYWxsYmFjayhyZW1vdGVUcmsuY2FjaGUuc2VhcmNoLmFwcGx5KHJlbW90ZVRyay5jYWNoZSwgW2FmdGVyTG9hZC5zdGFydCwgYWZ0ZXJMb2FkLmVuZF0uY29uY2F0KGV4dHJhQXJncykpKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG4vLyBSdW5zIHRocm91Z2ggYWxsIHNhdmVkIGNhbGxiYWNrcyBhbmQgZmlyZXMgYW55IGNhbGxiYWNrcyBmb3Igd2hpY2ggd2Ugd29uJ3QgbG9hZCBkYXRhIHNpbmNlIHRoZSBhbW91bnRcbi8vIHJlcXVlc3RlZCBpcyB0b28gbGFyZ2UuIENhbGxiYWNrcyB0aGF0IGFyZSBmaXJlZCBhcmUgcmVtb3ZlZCBmcm9tIHRoZSBxdWV1ZS5cbmZ1bmN0aW9uIF9jbGVhckNhbGxiYWNrc0ZvclRvb0JpZ0ludGVydmFscyhyZW1vdGVUcmspIHtcbiAgcmVtb3RlVHJrLmNhbGxiYWNrcyA9IF8uZmlsdGVyKHJlbW90ZVRyay5jYWxsYmFja3MsIGZ1bmN0aW9uKGFmdGVyTG9hZCkge1xuICAgIHZhciBjYWxsYmFjayA9IGFmdGVyTG9hZC5jYWxsYmFjaztcbiAgICBpZiAoYWZ0ZXJMb2FkLmVuZCAtIGFmdGVyTG9hZC5zdGFydCA+IHJlbW90ZVRyay5tYXhGZXRjaFdpbmRvdykge1xuICAgICAgY2FsbGJhY2soe3Rvb01hbnk6IHRydWV9KTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH0pO1xufVxuXG5cbmV4cG9ydHMuUmVtb3RlVHJhY2sgPSBSZW1vdGVUcmFjaztcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsIihmdW5jdGlvbihleHBvcnRzKXtcbi8vIFRPRE86IGJhY2twb3J0IHRoaXMgY29kZSBmb3IgSmF2YVNjcmlwdCAxLjU/IHVzaW5nIHVuZGVyc2NvcmUuanNcbi8qKlxuICogQnkgU2hpbiBTdXp1a2ksIE1JVCBsaWNlbnNlXG4gKiBodHRwczovL2dpdGh1Yi5jb20vc2hpbm91dC9Tb3J0ZWRMaXN0XG4gKlxuICogU29ydGVkTGlzdCA6IGNvbnN0cnVjdG9yXG4gKiBcbiAqIEBwYXJhbSBhcnIgOiBBcnJheSBvciBudWxsIDogYW4gYXJyYXkgdG8gc2V0XG4gKlxuICogQHBhcmFtIG9wdGlvbnMgOiBvYmplY3QgIG9yIG51bGxcbiAqICAgICAgICAgKGZ1bmN0aW9uKSBmaWx0ZXIgIDogZmlsdGVyIGZ1bmN0aW9uIGNhbGxlZCBiZWZvcmUgaW5zZXJ0aW5nIGRhdGEuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgcmVjZWl2ZXMgYSB2YWx1ZSBhbmQgcmV0dXJucyB0cnVlIGlmIHRoZSB2YWx1ZSBpcyB2YWxpZC5cbiAqXG4gKiAgICAgICAgIChmdW5jdGlvbikgY29tcGFyZSA6IGZ1bmN0aW9uIHRvIGNvbXBhcmUgdHdvIHZhbHVlcywgXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdoaWNoIGlzIHVzZWQgZm9yIHNvcnRpbmcgb3JkZXIuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBzYW1lIHNpZ25hdHVyZSBhcyBBcnJheS5wcm90b3R5cGUuc29ydChmbikuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICogICAgICAgICAoc3RyaW5nKSAgIGNvbXBhcmUgOiBpZiB5b3UnZCBsaWtlIHRvIHNldCBhIGNvbW1vbiBjb21wYXJpc29uIGZ1bmN0aW9uLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5b3UgY2FuIHNwZWNpZnkgaXQgYnkgc3RyaW5nOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcIm51bWJlclwiIDogY29tcGFyZXMgbnVtYmVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwic3RyaW5nXCIgOiBjb21wYXJlcyBzdHJpbmdcbiAqL1xuZnVuY3Rpb24gU29ydGVkTGlzdCgpIHtcbiAgdmFyIGFyciAgICAgPSBudWxsLFxuICAgICAgb3B0aW9ucyA9IHt9LFxuICAgICAgYXJncyAgICA9IGFyZ3VtZW50cztcblxuICBbXCIwXCIsXCIxXCJdLmZvckVhY2goZnVuY3Rpb24obikge1xuICAgIHZhciB2YWwgPSBhcmdzW25dO1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHtcbiAgICAgIGFyciA9IHZhbDtcbiAgICB9XG4gICAgZWxzZSBpZiAodmFsICYmIHR5cGVvZiB2YWwgPT0gXCJvYmplY3RcIikge1xuICAgICAgb3B0aW9ucyA9IHZhbDtcbiAgICB9XG4gIH0pO1xuICB0aGlzLmFyciA9IFtdO1xuXG4gIFtcImZpbHRlclwiLCBcImNvbXBhcmVcIl0uZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgaWYgKHR5cGVvZiBvcHRpb25zW2tdID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpc1trXSA9IG9wdGlvbnNba107XG4gICAgfVxuICAgIGVsc2UgaWYgKG9wdGlvbnNba10gJiYgU29ydGVkTGlzdFtrXVtvcHRpb25zW2tdXSkge1xuICAgICAgdGhpc1trXSA9IFNvcnRlZExpc3Rba11bb3B0aW9uc1trXV07XG4gICAgfVxuICB9LCB0aGlzKTtcbiAgaWYgKGFycikgdGhpcy5tYXNzSW5zZXJ0KGFycik7XG59O1xuXG4vLyBCaW5hcnkgc2VhcmNoIGZvciB0aGUgaW5kZXggb2YgdGhlIGl0ZW0gZXF1YWwgdG8gYHZhbGAsIG9yIGlmIG5vIHN1Y2ggaXRlbSBleGlzdHMsIHRoZSBuZXh0IGxvd2VyIGl0ZW1cbi8vIFRoaXMgY2FuIGJlIC0xIGlmIGB2YWxgIGlzIGxvd2VyIHRoYW4gdGhlIGxvd2VzdCBpdGVtIGluIHRoZSBTb3J0ZWRMaXN0XG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5ic2VhcmNoID0gZnVuY3Rpb24odmFsKSB7XG4gIHZhciBtcG9zLFxuICAgICAgc3BvcyA9IDAsXG4gICAgICBlcG9zID0gdGhpcy5hcnIubGVuZ3RoO1xuICB3aGlsZSAoZXBvcyAtIHNwb3MgPiAxKSB7XG4gICAgbXBvcyA9IE1hdGguZmxvb3IoKHNwb3MgKyBlcG9zKS8yKTtcbiAgICBtdmFsID0gdGhpcy5hcnJbbXBvc107XG4gICAgc3dpdGNoICh0aGlzLmNvbXBhcmUodmFsLCBtdmFsKSkge1xuICAgIGNhc2UgMSAgOlxuICAgIGRlZmF1bHQgOlxuICAgICAgc3BvcyA9IG1wb3M7XG4gICAgICBicmVhaztcbiAgICBjYXNlIC0xIDpcbiAgICAgIGVwb3MgPSBtcG9zO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAwICA6XG4gICAgICByZXR1cm4gbXBvcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh0aGlzLmFyclswXSA9PSBudWxsIHx8IHNwb3MgPT0gMCAmJiB0aGlzLmFyclswXSAhPSBudWxsICYmIHRoaXMuY29tcGFyZSh0aGlzLmFyclswXSwgdmFsKSA9PSAxKSA/IC0xIDogc3Bvcztcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gdGhpcy5hcnJbcG9zXTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnRvQXJyYXkgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLnNsaWNlKCk7XG59O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5hcnIuc2xpY2UuYXBwbHkodGhpcy5hcnIsIGFyZ3VtZW50cyk7XG59XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnNpemUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyLmxlbmd0aDtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmhlYWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuYXJyWzBdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gKHRoaXMuYXJyLmxlbmd0aCA9PSAwKSA/IG51bGwgOiB0aGlzLmFyclt0aGlzLmFyci5sZW5ndGggLTFdO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUubWFzc0luc2VydCA9IGZ1bmN0aW9uKGl0ZW1zKSB7XG4gIC8vIFRoaXMgbG9vcCBhdm9pZHMgY2FsbCBzdGFjayBvdmVyZmxvdyBiZWNhdXNlIG9mIHRvbyBtYW55IGFyZ3VtZW50c1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSArPSA0MDk2KSB7XG4gICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkodGhpcy5hcnIsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGl0ZW1zLCBpLCBpICsgNDA5NikpO1xuICB9XG4gIHRoaXMuYXJyLnNvcnQodGhpcy5jb21wYXJlKTtcbn1cblxuU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24oKSB7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMTAwKSB7XG4gICAgLy8gLmJzZWFyY2ggKyAuc3BsaWNlIGlzIHRvbyBleHBlbnNpdmUgdG8gcmVwZWF0IGZvciBzbyBtYW55IGVsZW1lbnRzLlxuICAgIC8vIExldCdzIGp1c3QgYXBwZW5kIHRoZW0gYWxsIHRvIHRoaXMuYXJyIGFuZCByZXNvcnQuXG4gICAgdGhpcy5tYXNzSW5zZXJ0KGFyZ3VtZW50cyk7XG4gIH0gZWxzZSB7XG4gICAgQXJyYXkucHJvdG90eXBlLmZvckVhY2guY2FsbChhcmd1bWVudHMsIGZ1bmN0aW9uKHZhbCkge1xuICAgICAgdmFyIHBvcyA9IHRoaXMuYnNlYXJjaCh2YWwpO1xuICAgICAgaWYgKHRoaXMuZmlsdGVyKHZhbCwgcG9zKSkge1xuICAgICAgICB0aGlzLmFyci5zcGxpY2UocG9zKzEsIDAsIHZhbCk7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG4gIH1cbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLmZpbHRlciA9IGZ1bmN0aW9uKHZhbCwgcG9zKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuYWRkID0gU29ydGVkTGlzdC5wcm90b3R5cGUuaW5zZXJ0O1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZVtcImRlbGV0ZVwiXSA9IGZ1bmN0aW9uKHBvcykge1xuICB0aGlzLmFyci5zcGxpY2UocG9zLCAxKTtcbn07XG5cblNvcnRlZExpc3QucHJvdG90eXBlLnJlbW92ZSA9IFNvcnRlZExpc3QucHJvdG90eXBlW1wiZGVsZXRlXCJdO1xuXG5Tb3J0ZWRMaXN0LnByb3RvdHlwZS5tYXNzUmVtb3ZlID0gZnVuY3Rpb24oc3RhcnRQb3MsIGNvdW50KSB7XG4gIHRoaXMuYXJyLnNwbGljZShzdGFydFBvcywgY291bnQpO1xufTtcblxuLyoqXG4gKiBkZWZhdWx0IGNvbXBhcmUgZnVuY3Rpb25zIFxuICoqL1xuU29ydGVkTGlzdC5jb21wYXJlID0ge1xuICBcIm51bWJlclwiOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIGMgPSBhIC0gYjtcbiAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PSAwKSAgPyAwIDogLTE7XG4gIH0sXG5cbiAgXCJzdHJpbmdcIjogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiAoYSA+IGIpID8gMSA6IChhID09IGIpICA/IDAgOiAtMTtcbiAgfVxufTtcblxuU29ydGVkTGlzdC5wcm90b3R5cGUuY29tcGFyZSA9IFNvcnRlZExpc3QuY29tcGFyZVtcIm51bWJlclwiXTtcblxuZXhwb3J0cy5Tb3J0ZWRMaXN0ID0gU29ydGVkTGlzdDtcblxufSkobW9kdWxlICYmIG1vZHVsZS5leHBvcnRzIHx8IHRoaXMpOyIsInZhciBfID0gcmVxdWlyZSgnLi4vLi4vLi4vdW5kZXJzY29yZS5taW4uanMnKTtcblxuLy8gUGFyc2UgYSB0cmFjayBkZWNsYXJhdGlvbiBsaW5lLCB3aGljaCBpcyBpbiB0aGUgZm9ybWF0IG9mOlxuLy8gdHJhY2sgbmFtZT1cImJsYWhcIiBvcHRuYW1lMT1cInZhbHVlMVwiIG9wdG5hbWUyPVwidmFsdWUyXCIgLi4uXG4vLyBpbnRvIGEgaGFzaCBvZiBvcHRpb25zXG5tb2R1bGUuZXhwb3J0cy5wYXJzZURlY2xhcmF0aW9uTGluZSA9IGZ1bmN0aW9uKGxpbmUsIHN0YXJ0KSB7XG4gIHZhciBvcHRzID0ge30sIG9wdG5hbWUgPSAnJywgdmFsdWUgPSAnJywgc3RhdGUgPSAnb3B0bmFtZSc7XG4gIGZ1bmN0aW9uIHB1c2hWYWx1ZShxdW90aW5nKSB7XG4gICAgc3RhdGUgPSAnb3B0bmFtZSc7XG4gICAgb3B0c1tvcHRuYW1lLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKV0gPSB2YWx1ZTtcbiAgICBvcHRuYW1lID0gdmFsdWUgPSAnJztcbiAgfVxuICBmb3IgKGkgPSBsaW5lLm1hdGNoKHN0YXJ0KVswXS5sZW5ndGg7IGkgPCBsaW5lLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IGxpbmVbaV07XG4gICAgaWYgKHN0YXRlID09ICdvcHRuYW1lJykge1xuICAgICAgaWYgKGMgPT0gJz0nKSB7IHN0YXRlID0gJ3N0YXJ0dmFsdWUnOyB9XG4gICAgICBlbHNlIHsgb3B0bmFtZSArPSBjOyB9XG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PSAnc3RhcnR2YWx1ZScpIHtcbiAgICAgIGlmICgvJ3xcIi8udGVzdChjKSkgeyBzdGF0ZSA9IGM7IH1cbiAgICAgIGVsc2UgeyB2YWx1ZSArPSBjOyBzdGF0ZSA9ICd2YWx1ZSc7IH1cbiAgICB9IGVsc2UgaWYgKHN0YXRlID09ICd2YWx1ZScpIHtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7IHB1c2hWYWx1ZSgpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH0gZWxzZSBpZiAoLyd8XCIvLnRlc3Qoc3RhdGUpKSB7XG4gICAgICBpZiAoYyA9PSBzdGF0ZSkgeyBwdXNoVmFsdWUoc3RhdGUpOyB9XG4gICAgICBlbHNlIHsgdmFsdWUgKz0gYzsgfVxuICAgIH1cbiAgfVxuICBpZiAoc3RhdGUgPT0gJ3ZhbHVlJykgeyBwdXNoVmFsdWUoKTsgfVxuICBpZiAoc3RhdGUgIT0gJ29wdG5hbWUnKSB7IHJldHVybiBmYWxzZTsgfVxuICByZXR1cm4gb3B0cztcbn1cblxuLy8gQ29uc3RydWN0cyBhIG1hcHBpbmcgZnVuY3Rpb24gdGhhdCBjb252ZXJ0cyBicCBpbnRlcnZhbHMgaW50byBwaXhlbCBpbnRlcnZhbHMsIHdpdGggb3B0aW9uYWwgY2FsY3VsYXRpb25zIGZvciB0ZXh0IHRvb1xubW9kdWxlLmV4cG9ydHMucGl4SW50ZXJ2YWxDYWxjdWxhdG9yID0gZnVuY3Rpb24oc3RhcnQsIHdpZHRoLCBicHBwLCB3aXRoVGV4dCwgbmFtZUZ1bmMsIHN0YXJ0a2V5LCBlbmRrZXkpIHtcbiAgaWYgKCFfLmlzRnVuY3Rpb24obmFtZUZ1bmMpKSB7IG5hbWVGdW5jID0gZnVuY3Rpb24oZCkgeyByZXR1cm4gZC5uYW1lIHx8ICcnOyB9OyB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKHN0YXJ0a2V5KSkgeyBzdGFydGtleSA9ICdzdGFydCc7IH1cbiAgaWYgKF8uaXNVbmRlZmluZWQoZW5ka2V5KSkgeyBlbmRrZXkgPSAnZW5kJzsgfVxuICByZXR1cm4gZnVuY3Rpb24oZCkge1xuICAgIHZhciBpdHZsU3RhcnQgPSBfLmlzVW5kZWZpbmVkKGRbc3RhcnRrZXldKSA/IGQuc3RhcnQgOiBkW3N0YXJ0a2V5XSxcbiAgICAgIGl0dmxFbmQgPSBfLmlzVW5kZWZpbmVkKGRbZW5ka2V5XSkgPyBkLmVuZCA6IGRbZW5ka2V5XTtcbiAgICB2YXIgcEludCA9IHtcbiAgICAgIHg6IE1hdGgucm91bmQoKGl0dmxTdGFydCAtIHN0YXJ0KSAvIGJwcHApLFxuICAgICAgdzogTWF0aC5yb3VuZCgoaXR2bEVuZCAtIGl0dmxTdGFydCkgLyBicHBwKSArIDEsXG4gICAgICB0OiAwLCAgICAgICAgICAvLyBjYWxjdWxhdGVkIHdpZHRoIG9mIHRleHRcbiAgICAgIG9QcmV2OiBmYWxzZSwgIC8vIG92ZXJmbG93cyBpbnRvIHByZXZpb3VzIHRpbGU/XG4gICAgICBvTmV4dDogZmFsc2UgICAvLyBvdmVyZmxvd3MgaW50byBuZXh0IHRpbGU/XG4gICAgfTtcbiAgICBwSW50LnR4ID0gcEludC54O1xuICAgIHBJbnQudHcgPSBwSW50Lnc7XG4gICAgaWYgKHBJbnQueCA8IDApIHsgcEludC53ICs9IHBJbnQueDsgcEludC54ID0gMDsgcEludC5vUHJldiA9IHRydWU7IH1cbiAgICBlbHNlIGlmICh3aXRoVGV4dCkge1xuICAgICAgcEludC50ID0gXy5pc051bWJlcih3aXRoVGV4dCkgPyB3aXRoVGV4dCA6IE1hdGgubWluKG5hbWVGdW5jKGQpLmxlbmd0aCAqIDEwICsgMiwgcEludC54KTtcbiAgICAgIHBJbnQudHggLT0gcEludC50O1xuICAgICAgcEludC50dyArPSBwSW50LnQ7ICBcbiAgICB9XG4gICAgaWYgKHBJbnQueCArIHBJbnQudyA+IHdpZHRoKSB7IHBJbnQudyA9IHdpZHRoIC0gcEludC54OyBwSW50Lm9OZXh0ID0gdHJ1ZTsgfVxuICAgIHJldHVybiBwSW50O1xuICB9O1xufTtcblxuLy8gRm9yIHR3byBnaXZlbiBvYmplY3RzIG9mIHRoZSBmb3JtIHt4OiAxLCB3OiAyfSAocGl4ZWwgaW50ZXJ2YWxzKSwgZGVzY3JpYmUgdGhlIG92ZXJsYXAuXG4vLyBSZXR1cm5zIG51bGwgaWYgdGhlcmUgaXMgbm8gb3ZlcmxhcC5cbm1vZHVsZS5leHBvcnRzLnBpeEludGVydmFsT3ZlcmxhcCA9IGZ1bmN0aW9uKHBJbnQxLCBwSW50Mikge1xuICB2YXIgb3ZlcmxhcCA9IHt9LFxuICAgIHRtcDtcbiAgaWYgKHBJbnQxLnggPiBwSW50Mi54KSB7IHRtcCA9IHBJbnQyOyBwSW50MiA9IHBJbnQxOyBwSW50MSA9IHRtcDsgfSAgICAgICAvLyBzd2FwIHNvIHRoYXQgcEludDEgaXMgYWx3YXlzIGxvd2VyXG4gIGlmICghcEludDEudyB8fCAhcEludDIudyB8fCBwSW50MS54ICsgcEludDEudyA8IHBJbnQyLngpIHsgcmV0dXJuIG51bGw7IH0gLy8gZGV0ZWN0IG5vLW92ZXJsYXAgY29uZGl0aW9uc1xuICBvdmVybGFwLnggPSBwSW50Mi54O1xuICBvdmVybGFwLncgPSBNYXRoLm1pbihwSW50MS53IC0gcEludDIueCArIHBJbnQxLngsIHBJbnQyLncpO1xuICByZXR1cm4gb3ZlcmxhcDtcbn07XG5cbi8vIENvbW1vbiBmdW5jdGlvbnMgZm9yIHN1bW1hcml6aW5nIGRhdGEgaW4gYmlucyB3aGlsZSBwbG90dGluZyB3aWdnbGUgdHJhY2tzXG5tb2R1bGUuZXhwb3J0cy53aWdCaW5GdW5jdGlvbnMgPSB7XG4gIG1pbmltdW06IGZ1bmN0aW9uKGJpbikgeyByZXR1cm4gYmluLmxlbmd0aCA/IE1hdGgubWluLmFwcGx5KE1hdGgsIGJpbikgOiAwOyB9LFxuICBtZWFuOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIF8ucmVkdWNlKGJpbiwgZnVuY3Rpb24oYSxiKSB7IHJldHVybiBhICsgYjsgfSwgMCkgLyBiaW4ubGVuZ3RoOyB9LFxuICBtYXhpbXVtOiBmdW5jdGlvbihiaW4pIHsgcmV0dXJuIGJpbi5sZW5ndGggPyBNYXRoLm1heC5hcHBseShNYXRoLCBiaW4pIDogMDsgfVxufTtcblxuLy8gRmFzdGVyIHRoYW4gTWF0aC5mbG9vciAoaHR0cDovL3dlYmRvb2QuY29tLz9wPTIxOSlcbm1vZHVsZS5leHBvcnRzLmZsb29ySGFjayA9IGZ1bmN0aW9uKG51bSkgeyByZXR1cm4gKG51bSA8PCAwKSAtIChudW0gPCAwID8gMSA6IDApOyB9XG5cbi8vIE90aGVyIHRpbnkgZnVuY3Rpb25zIHRoYXQgd2UgbmVlZCBmb3Igb2RkcyBhbmQgZW5kcy4uLlxubW9kdWxlLmV4cG9ydHMuc3RyaXAgPSBmdW5jdGlvbihzdHIpIHsgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJyk7IH1cbm1vZHVsZS5leHBvcnRzLnBhcnNlSW50MTAgPSBmdW5jdGlvbih2YWwpIHsgcmV0dXJuIHBhcnNlSW50KHZhbCwgMTApOyB9XG5tb2R1bGUuZXhwb3J0cy5kZWVwQ2xvbmUgPSBmdW5jdGlvbihvYmopIHsgcmV0dXJuIEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkob2JqKSk7IH0iLCIvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSB2Y2ZUYWJpeCBmb3JtYXQ6IGh0dHA6Ly9nZW5vbWUudWNzYy5lZHUvZ29sZGVuUGF0aC9oZWxwL3ZjZi5odG1sID1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbHMuanMnKSxcbiAgcGFyc2VJbnQxMCA9IHV0aWxzLnBhcnNlSW50MTA7XG5cbi8vIEludGVuZGVkIHRvIGJlIGxvYWRlZCBpbnRvIEN1c3RvbVRyYWNrLnR5cGVzLnZjZnRhYml4XG52YXIgVmNmVGFiaXhGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgcHJpb3JpdHk6IDEwMCxcbiAgICBkcmF3TGltaXQ6IHtzcXVpc2g6IDUwMCwgcGFjazogMTAwfSxcbiAgICBtYXhGZXRjaFdpbmRvdzogMTAwMDAwLFxuICAgIGNocm9tb3NvbWVzOiAnJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5vcHRzLmJpZ0RhdGFVcmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVpcmVkIHBhcmFtZXRlciBiaWdEYXRhVXJsIG5vdCBmb3VuZCBmb3IgdmNmVGFiaXggdHJhY2sgYXQgXCIgKyBKU09OLnN0cmluZ2lmeSh0aGlzLm9wdHMpICsgKHRoaXMub3B0cy5saW5lTnVtICsgMSkpO1xuICAgIH1cbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obGluZXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5oZWlnaHRzID0ge21heDogbnVsbCwgbWluOiAxNSwgc3RhcnQ6IDE1fTtcbiAgICBzZWxmLnNpemVzID0gWydkZW5zZScsICdzcXVpc2gnLCAncGFjayddO1xuICAgIHNlbGYubWFwU2l6ZXMgPSBbJ3BhY2snXTtcbiAgICAvLyBUT0RPOiBTZXQgbWF4RmV0Y2hXaW5kb3cgdXNpbmcgc29tZSBoZXVyaXN0aWMgYmFzZWQgb24gaG93IG1hbnkgaXRlbXMgYXJlIGluIHRoZSB0YWJpeCBpbmRleFxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHByZXJlbmRlcjogZnVuY3Rpb24oc3RhcnQsIGVuZCwgZGVuc2l0eSwgcHJlY2FsYywgY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICB3aWR0aCA9IHByZWNhbGMud2lkdGgsXG4gICAgICBkYXRhID0gc2VsZi5kYXRhLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyB3aWR0aCxcbiAgICAgIHJhbmdlID0gdGhpcy5jaHJSYW5nZShzdGFydCwgZW5kKTtcbiAgICBcbiAgICBmdW5jdGlvbiBsaW5lVG9JbnRlcnZhbChsaW5lKSB7XG4gICAgICB2YXIgZmllbGRzID0gbGluZS5zcGxpdCgnXFx0JyksIGRhdGEgPSB7fSwgaW5mbyA9IHt9O1xuICAgICAgaWYgKGZpZWxkc1s3XSkge1xuICAgICAgICBfLmVhY2goZmllbGRzWzddLnNwbGl0KCc7JyksIGZ1bmN0aW9uKGwpIHsgbCA9IGwuc3BsaXQoJz0nKTsgaWYgKGwubGVuZ3RoID4gMSkgeyBpbmZvW2xbMF1dID0gbFsxXTsgfSB9KTtcbiAgICAgIH1cbiAgICAgIGRhdGEuc3RhcnQgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1tmaWVsZHNbMF1dICsgcGFyc2VJbnQxMChmaWVsZHNbMV0pO1xuICAgICAgZGF0YS5pZCA9IGZpZWxkc1syXT09Jy4nID8gJ3ZjZi0nICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMTAwMDAwMDAwKSA6IGZpZWxkc1syXTtcbiAgICAgIGRhdGEuZW5kID0gZGF0YS5zdGFydCArIDE7XG4gICAgICBkYXRhLnJlZiA9IGZpZWxkc1szXTtcbiAgICAgIGRhdGEuYWx0ID0gZmllbGRzWzRdO1xuICAgICAgZGF0YS5xdWFsID0gcGFyc2VGbG9hdChmaWVsZHNbNV0pO1xuICAgICAgZGF0YS5pbmZvID0gaW5mbztcbiAgICAgIHJldHVybiB7ZGF0YTogZGF0YX07XG4gICAgfVxuICAgIGZ1bmN0aW9uIG5hbWVGdW5jKGZpZWxkcykge1xuICAgICAgdmFyIHJlZiA9IGZpZWxkcy5yZWYgfHwgJycsXG4gICAgICAgIGFsdCA9IGZpZWxkcy5hbHQgfHwgJyc7XG4gICAgICByZXR1cm4gKHJlZi5sZW5ndGggPiBhbHQubGVuZ3RoID8gcmVmIDogYWx0KSB8fCAnJztcbiAgICB9XG4gIFxuICAgIGZ1bmN0aW9uIHN1Y2Nlc3MoZGF0YSkge1xuICAgICAgdmFyIGRyYXdTcGVjID0gW10sXG4gICAgICAgIGxpbmVzID0gXy5maWx0ZXIoZGF0YS5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGwpIHsgdmFyIG0gPSBsLm1hdGNoKC9cXHQvZyk7IHJldHVybiBtICYmIG0ubGVuZ3RoID4gODsgfSksXG4gICAgICAgIGNhbGNQaXhJbnRlcnZhbCA9IG5ldyB1dGlscy5waXhJbnRlcnZhbENhbGN1bGF0b3Ioc3RhcnQsIHdpZHRoLCBicHBwLCBkZW5zaXR5PT0ncGFjaycsIG5hbWVGdW5jKTtcbiAgICAgIGlmIChkZW5zaXR5ID09ICdkZW5zZScpIHtcbiAgICAgICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lKSB7XG4gICAgICAgICAgZHJhd1NwZWMucHVzaChjYWxjUGl4SW50ZXJ2YWwobGluZVRvSW50ZXJ2YWwobGluZSkuZGF0YSkpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRyYXdTcGVjID0ge2xheW91dDogc2VsZi50eXBlKCdiZWQnKS5zdGFja2VkTGF5b3V0KF8ubWFwKGxpbmVzLCBsaW5lVG9JbnRlcnZhbCksIHdpZHRoLCBjYWxjUGl4SW50ZXJ2YWwpfTtcbiAgICAgICAgZHJhd1NwZWMud2lkdGggPSB3aWR0aDtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKGRyYXdTcGVjKTtcbiAgICB9XG4gIFxuICAgIC8vIERvbid0IGV2ZW4gYXR0ZW1wdCB0byBmZXRjaCB0aGUgZGF0YSBpZiB3ZSBjYW4gcmVhc29uYWJseSBlc3RpbWF0ZSB0aGF0IHdlIHdpbGwgZmV0Y2ggdG9vIG11Y2ggZGF0YSwgYXMgdGhpcyB3aWxsIG9ubHkgZGVsYXkgb3RoZXIgcmVxdWVzdHMuXG4gICAgLy8gVE9ETzogY2FjaGUgcmVzdWx0cyBzbyB3ZSBhcmVuJ3QgcmVmZXRjaGluZyB0aGUgc2FtZSByZWdpb25zIG92ZXIgYW5kIG92ZXIgYWdhaW4uXG4gICAgaWYgKChlbmQgLSBzdGFydCkgPiBzZWxmLm9wdHMubWF4RmV0Y2hXaW5kb3cpIHtcbiAgICAgIGNhbGxiYWNrKHt0b29NYW55OiB0cnVlfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICQuYWpheCh0aGlzLmFqYXhEaXIoKSArICd0YWJpeC5waHAnLCB7XG4gICAgICAgIGRhdGE6IHtyYW5nZTogcmFuZ2UsIHVybDogdGhpcy5vcHRzLmJpZ0RhdGFVcmx9LFxuICAgICAgICBzdWNjZXNzOiBzdWNjZXNzXG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgcmVuZGVyOiBmdW5jdGlvbihjYW52YXMsIHN0YXJ0LCBlbmQsIGRlbnNpdHksIGNhbGxiYWNrKSB7XG4gICAgdmFyIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpLFxuICAgICAgdXJsVGVtcGxhdGUgPSB0aGlzLm9wdHMudXJsID8gdGhpcy5vcHRzLnVybCA6ICdqYXZhc2NyaXB0OnZvaWQoXCInK3RoaXMub3B0cy5uYW1lKyc6JCRcIiknLFxuICAgICAgbGluZUhlaWdodCA9IGRlbnNpdHkgPT0gJ3BhY2snID8gMjcgOiA2LFxuICAgICAgY29sb3JzID0ge2E6JzI1NSwwLDAnLCB0OicyNTUsMCwyNTUnLCBjOicwLDAsMjU1JywgZzonMCwyNTUsMCd9LFxuICAgICAgZHJhd0xpbWl0ID0gdGhpcy5vcHRzLmRyYXdMaW1pdCAmJiB0aGlzLm9wdHMuZHJhd0xpbWl0W2RlbnNpdHldLFxuICAgICAgYXJlYXMgPSBudWxsO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIGlmIChkZW5zaXR5ID09ICdwYWNrJykgeyBhcmVhcyA9IHRoaXMuYXJlYXNbY2FudmFzLmlkXSA9IFtdOyB9XG4gICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgIHRoaXMucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogY2FudmFzLndpZHRofSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIGlmICgoZHJhd0xpbWl0ICYmIGRyYXdTcGVjLmxlbmd0aCA+IGRyYXdMaW1pdCkgfHwgZHJhd1NwZWMudG9vTWFueSkgeyBcbiAgICAgICAgY2FudmFzLmhlaWdodCA9IDA7XG4gICAgICAgIC8vIFRoaXMgYXBwbGllcyBzdHlsaW5nIHRoYXQgaW5kaWNhdGVzIHRoZXJlIHdhcyB0b28gbXVjaCBkYXRhIHRvIGxvYWQvZHJhdyBhbmQgdGhhdCB0aGUgdXNlciBuZWVkcyB0byB6b29tIHRvIHNlZSBtb3JlXG4gICAgICAgIGNhbnZhcy5jbGFzc05hbWUgPSBjYW52YXMuY2xhc3NOYW1lICsgJyB0b28tbWFueSc7XG4gICAgICB9IGVsc2UgaWYgKGRlbnNpdHkgPT0gJ2RlbnNlJykge1xuICAgICAgICBjYW52YXMuaGVpZ2h0ID0gMTU7XG4gICAgICAgIF8uZWFjaChkcmF3U3BlYywgZnVuY3Rpb24ocEludCkge1xuICAgICAgICAgIGN0eC5maWxsUmVjdChwSW50LngsIDEsIHBJbnQudywgMTMpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNhbnZhcy5oZWlnaHQgPSBkcmF3U3BlYy5sYXlvdXQubGVuZ3RoICogbGluZUhlaWdodDtcbiAgICAgICAgXy5lYWNoKGRyYXdTcGVjLmxheW91dCwgZnVuY3Rpb24obCwgaSkge1xuICAgICAgICAgIF8uZWFjaChsLCBmdW5jdGlvbihkYXRhKSB7XG4gICAgICAgICAgICB2YXIgYWx0Q29sb3IsIHJlZkNvbG9yO1xuICAgICAgICAgICAgaWYgKGFyZWFzKSB7XG4gICAgICAgICAgICAgIHJlZkNvbG9yID0gY29sb3JzW2RhdGEuZC5yZWYudG9Mb3dlckNhc2UoKV0gfHwgJzI1NSwwLDAnO1xuICAgICAgICAgICAgICBhbHRDb2xvciA9IGNvbG9yc1tkYXRhLmQuYWx0LnRvTG93ZXJDYXNlKCldIHx8ICcyNTUsMCwwJztcbiAgICAgICAgICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKFwiICsgYWx0Q29sb3IgKyBcIilcIjsgXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjdHguZmlsbFJlY3QoZGF0YS5wSW50LngsIGkgKiBsaW5lSGVpZ2h0ICsgMSwgZGF0YS5wSW50LncsIGxpbmVIZWlnaHQgLSAxKTtcbiAgICAgICAgICAgIGlmIChhcmVhcykge1xuICAgICAgICAgICAgICBhcmVhcy5wdXNoKFtcbiAgICAgICAgICAgICAgICBkYXRhLnBJbnQueCwgaSAqIGxpbmVIZWlnaHQgKyAxLCBkYXRhLnBJbnQueCArIGRhdGEucEludC53LCAoaSArIDEpICogbGluZUhlaWdodCwgLy94MSwgeDIsIHkxLCB5MlxuICAgICAgICAgICAgICAgIGRhdGEuZC5yZWYgKyAnID4gJyArIGRhdGEuZC5hbHQsIC8vIHRpdGxlXG4gICAgICAgICAgICAgICAgdXJsVGVtcGxhdGUucmVwbGFjZSgnJCQnLCBkYXRhLmQuaWQpLCAvLyBocmVmXG4gICAgICAgICAgICAgICAgZGF0YS5wSW50Lm9QcmV2LCAvLyBjb250aW51YXRpb24gZnJvbSBwcmV2aW91cyB0aWxlP1xuICAgICAgICAgICAgICAgIGFsdENvbG9yLCAvLyBsYWJlbCBjb2xvclxuICAgICAgICAgICAgICAgICc8c3BhbiBzdHlsZT1cImNvbG9yOiByZ2IoJyArIHJlZkNvbG9yICsgJylcIj4nICsgZGF0YS5kLnJlZiArICc8L3NwYW4+PGJyLz4nICsgZGF0YS5kLmFsdCwgLy8gbGFiZWxcbiAgICAgICAgICAgICAgICBkYXRhLmQuaW5mb1xuICAgICAgICAgICAgICBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gVmNmVGFiaXhGb3JtYXQ7XG5cbiIsIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gPSBXSUcgZm9ybWF0OiBodHRwOi8vZ2Vub21lLnVjc2MuZWR1L2dvbGRlblBhdGgvaGVscC93aWdnbGUuaHRtbCA9XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscy91dGlscy5qcycpLFxuICBwYXJzZUludDEwID0gdXRpbHMucGFyc2VJbnQxMCxcbiAgcGFyc2VEZWNsYXJhdGlvbkxpbmUgPSB1dGlscy5wYXJzZURlY2xhcmF0aW9uTGluZTtcbnZhciBTb3J0ZWRMaXN0ID0gcmVxdWlyZSgnLi91dGlscy9Tb3J0ZWRMaXN0LmpzJykuU29ydGVkTGlzdDtcblxuLy8gSW50ZW5kZWQgdG8gYmUgbG9hZGVkIGludG8gQ3VzdG9tVHJhY2sudHlwZXMud2lnZ2xlXzBcbnZhciBXaWdnbGVGb3JtYXQgPSB7XG4gIGRlZmF1bHRzOiB7XG4gICAgYWx0Q29sb3I6ICcnLFxuICAgIHByaW9yaXR5OiAxMDAsXG4gICAgYXV0b1NjYWxlOiAnb24nLFxuICAgIGFsd2F5c1plcm86ICdvZmYnLFxuICAgIGdyaWREZWZhdWx0OiAnb2ZmJyxcbiAgICBtYXhIZWlnaHRQaXhlbHM6ICcxMjg6MTI4OjE1JyxcbiAgICBncmFwaFR5cGU6ICdiYXInLFxuICAgIHZpZXdMaW1pdHM6ICcnLFxuICAgIHlMaW5lTWFyazogMC4wLFxuICAgIHlMaW5lT25PZmY6ICdvZmYnLFxuICAgIHdpbmRvd2luZ0Z1bmN0aW9uOiAnbWF4aW11bScsXG4gICAgc21vb3RoaW5nV2luZG93OiAnb2ZmJ1xuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHlwZSgpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH0sXG4gIFxuICBfYmluRnVuY3Rpb25zOiB1dGlscy53aWdCaW5GdW5jdGlvbnMsXG4gIFxuICBpbml0T3B0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBfYmluRnVuY3Rpb25zID0gdGhpcy50eXBlKCkuX2JpbkZ1bmN0aW9ucztcbiAgICBpZiAoIXRoaXMudmFsaWRhdGVDb2xvcihvLmFsdENvbG9yKSkgeyBvLmFsdENvbG9yID0gJyc7IH1cbiAgICBvLnZpZXdMaW1pdHMgPSBfLm1hcChvLnZpZXdMaW1pdHMuc3BsaXQoJzonKSwgcGFyc2VGbG9hdCk7XG4gICAgby5tYXhIZWlnaHRQaXhlbHMgPSBfLm1hcChvLm1heEhlaWdodFBpeGVscy5zcGxpdCgnOicpLCBwYXJzZUludDEwKTtcbiAgICBvLnlMaW5lT25PZmYgPSB0aGlzLmlzT24oby55TGluZU9uT2ZmKTtcbiAgICBvLnlMaW5lTWFyayA9IHBhcnNlRmxvYXQoby55TGluZU1hcmspO1xuICAgIG8uYXV0b1NjYWxlID0gdGhpcy5pc09uKG8uYXV0b1NjYWxlKTtcbiAgICBpZiAoX2JpbkZ1bmN0aW9ucyAmJiAhX2JpbkZ1bmN0aW9uc1tvLndpbmRvd2luZ0Z1bmN0aW9uXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCB3aW5kb3dpbmdGdW5jdGlvbiBhdCBsaW5lIFwiICsgby5saW5lTnVtKTsgXG4gICAgfVxuICAgIGlmIChfLmlzTmFOKG8ueUxpbmVNYXJrKSkgeyBvLnlMaW5lTWFyayA9IDAuMDsgfVxuICB9LFxuICBcbiAgYXBwbHlPcHRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXMsXG4gICAgICBvID0gc2VsZi5vcHRzO1xuICAgIHNlbGYuZHJhd1JhbmdlID0gby5hdXRvU2NhbGUgfHwgby52aWV3TGltaXRzLmxlbmd0aCA8IDIgPyBzZWxmLnJhbmdlIDogby52aWV3TGltaXRzO1xuICAgIF8uZWFjaCh7bWF4OiAwLCBtaW46IDIsIHN0YXJ0OiAxfSwgZnVuY3Rpb24odiwgaykgeyBzZWxmLmhlaWdodHNba10gPSBvLm1heEhlaWdodFBpeGVsc1t2XTsgfSk7XG4gICAgaWYgKCFvLmFsdENvbG9yKSB7XG4gICAgICB2YXIgaHNsID0gdGhpcy5yZ2JUb0hzbC5hcHBseSh0aGlzLCBvLmNvbG9yLnNwbGl0KC8sXFxzKi9nKSk7XG4gICAgICBoc2xbMF0gPSBoc2xbMF0gKyAwLjAyICUgMTtcbiAgICAgIGhzbFsxXSA9IGhzbFsxXSAqIDAuNztcbiAgICAgIGhzbFsyXSA9IDEgLSAoMSAtIGhzbFsyXSkgKiAwLjc7XG4gICAgICBzZWxmLmFsdENvbG9yID0gXy5tYXAodGhpcy5oc2xUb1JnYi5hcHBseSh0aGlzLCBoc2wpLCBwYXJzZUludDEwKS5qb2luKCcsJyk7XG4gICAgfVxuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbihsaW5lcykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGdlbm9tZVNpemUgPSB0aGlzLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUsXG4gICAgICBkYXRhID0ge2FsbDogW119LFxuICAgICAgbW9kZSwgbW9kZU9wdHMsIGNoclBvcywgbTtcbiAgICBzZWxmLnJhbmdlID0gc2VsZi5pc09uKHRoaXMub3B0cy5hbHdheXNaZXJvKSA/IFswLCAwXSA6IFtJbmZpbml0eSwgLUluZmluaXR5XTtcbiAgXG4gICAgXy5lYWNoKGxpbmVzLCBmdW5jdGlvbihsaW5lLCBsaW5lbm8pIHtcbiAgICAgIHZhciB2YWwsIHN0YXJ0O1xuICAgICAgXG4gICAgICBtID0gbGluZS5tYXRjaCgvXih2YXJpYWJsZXxmaXhlZClTdGVwXFxzKy9pKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIG1vZGUgPSBtWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIG1vZGVPcHRzID0gcGFyc2VEZWNsYXJhdGlvbkxpbmUobGluZSwgL14odmFyaWFibGV8Zml4ZWQpU3RlcFxccysvaSk7XG4gICAgICAgIG1vZGVPcHRzLnN0YXJ0ID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zdGFydCk7XG4gICAgICAgIGlmIChtb2RlID09ICdmaXhlZCcgJiYgKF8uaXNOYU4obW9kZU9wdHMuc3RhcnQpIHx8ICFtb2RlT3B0cy5zdGFydCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmaXhlZFN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZSBub24temVybyBzdGFydCBwYXJhbWV0ZXJcIik7IFxuICAgICAgICB9XG4gICAgICAgIG1vZGVPcHRzLnN0ZXAgPSBwYXJzZUludDEwKG1vZGVPcHRzLnN0ZXApO1xuICAgICAgICBpZiAobW9kZSA9PSAnZml4ZWQnICYmIChfLmlzTmFOKG1vZGVPcHRzLnN0ZXApIHx8ICFtb2RlT3B0cy5zdGVwKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImZpeGVkU3RlcCBhdCBsaW5lIFwiICsgKGxpbmVubyArIDEgKyBzZWxmLm9wdHMubGluZU51bSkgKyBcIiByZXF1aXJlIG5vbi16ZXJvIHN0ZXAgcGFyYW1ldGVyXCIpOyBcbiAgICAgICAgfVxuICAgICAgICBtb2RlT3B0cy5zcGFuID0gcGFyc2VJbnQxMChtb2RlT3B0cy5zcGFuKSB8fCAxO1xuICAgICAgICBjaHJQb3MgPSBzZWxmLmJyb3dzZXJPcHRzLmNoclBvc1ttb2RlT3B0cy5jaHJvbV07XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKGNoclBvcykpIHtcbiAgICAgICAgICBzZWxmLndhcm4oXCJJbnZhbGlkIGNocm9tb3NvbWUgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFtb2RlKSB7IFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIldpZ2dsZSBmb3JtYXQgYXQgXCIgKyAobGluZW5vICsgMSArIHNlbGYub3B0cy5saW5lTnVtKSArIFwiIGhhcyBubyBwcmVjZWRpbmcgbW9kZSBkZWNsYXJhdGlvblwiKTsgXG4gICAgICAgIH0gZWxzZSBpZiAoXy5pc1VuZGVmaW5lZChjaHJQb3MpKSB7XG4gICAgICAgICAgLy8gaW52YWxpZCBjaHJvbW9zb21lXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKG1vZGUgPT0gJ2ZpeGVkJykge1xuICAgICAgICAgICAgdmFsID0gcGFyc2VGbG9hdChsaW5lKTtcbiAgICAgICAgICAgIGRhdGEuYWxsLnB1c2goe3N0YXJ0OiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCwgZW5kOiBjaHJQb3MgKyBtb2RlT3B0cy5zdGFydCArIG1vZGVPcHRzLnNwYW4sIHZhbDogdmFsfSk7XG4gICAgICAgICAgICBtb2RlT3B0cy5zdGFydCArPSBtb2RlT3B0cy5zdGVwO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsaW5lID0gbGluZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICAgICAgaWYgKGxpbmUubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZVN0ZXAgYXQgbGluZSBcIiArIChsaW5lbm8gKyAxICsgc2VsZi5vcHRzLmxpbmVOdW0pICsgXCIgcmVxdWlyZXMgdHdvIHZhbHVlcyBwZXIgbGluZVwiKTsgXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGFydCA9IHBhcnNlSW50MTAobGluZVswXSk7XG4gICAgICAgICAgICB2YWwgPSBwYXJzZUZsb2F0KGxpbmVbMV0pO1xuICAgICAgICAgICAgZGF0YS5hbGwucHVzaCh7c3RhcnQ6IGNoclBvcyArIHN0YXJ0LCBlbmQ6IGNoclBvcyArIHN0YXJ0ICsgbW9kZU9wdHMuc3BhbiwgdmFsOiB2YWx9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gc2VsZi50eXBlKCkuZmluaXNoUGFyc2UuY2FsbChzZWxmLCBkYXRhKTtcbiAgfSxcbiAgXG4gIGZpbmlzaFBhcnNlOiBmdW5jdGlvbihkYXRhKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYmluRnVuY3Rpb24gPSBzZWxmLnR5cGUoKS5fYmluRnVuY3Rpb25zW3NlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbl07XG4gICAgaWYgKGRhdGEuYWxsLmxlbmd0aCA+IDApIHtcbiAgICAgIHNlbGYucmFuZ2VbMF0gPSBfLm1pbihkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICAgIHNlbGYucmFuZ2VbMV0gPSBfLm1heChkYXRhLmFsbCwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC52YWw7IH0pLnZhbDtcbiAgICB9XG4gICAgZGF0YS5hbGwgPSBuZXcgU29ydGVkTGlzdChkYXRhLmFsbCwge1xuICAgICAgY29tcGFyZTogZnVuY3Rpb24oYSwgYikge1xuICAgICAgICBpZiAoYSA9PT0gbnVsbCkgcmV0dXJuIC0xO1xuICAgICAgICBpZiAoYiA9PT0gbnVsbCkgcmV0dXJuICAxO1xuICAgICAgICB2YXIgYyA9IGEuc3RhcnQgLSBiLnN0YXJ0O1xuICAgICAgICByZXR1cm4gKGMgPiAwKSA/IDEgOiAoYyA9PT0gMCkgID8gMCA6IC0xO1xuICAgICAgfVxuICAgIH0pO1xuICBcbiAgICAvLyBQcmUtb3B0aW1pemUgZGF0YSBmb3IgaGlnaCBicHBwcyBieSBkb3duc2FtcGxpbmdcbiAgICBfLmVhY2goc2VsZi5icm93c2VyT3B0cy5icHBwcywgZnVuY3Rpb24oYnBwcCkge1xuICAgICAgaWYgKHNlbGYuYnJvd3Nlck9wdHMuZ2Vub21lU2l6ZSAvIGJwcHAgPiAxMDAwMDAwKSB7IHJldHVybjsgfVxuICAgICAgdmFyIHBpeExlbiA9IE1hdGguY2VpbChzZWxmLmJyb3dzZXJPcHRzLmdlbm9tZVNpemUgLyBicHBwKSxcbiAgICAgICAgZG93bnNhbXBsZWREYXRhID0gKGRhdGFbYnBwcF0gPSAoZ2xvYmFsLkZsb2F0MzJBcnJheSA/IG5ldyBGbG9hdDMyQXJyYXkocGl4TGVuKSA6IG5ldyBBcnJheShwaXhMZW4pKSksXG4gICAgICAgIGogPSAwLFxuICAgICAgICBjdXJyID0gZGF0YS5hbGwuZ2V0KDApLFxuICAgICAgICBiaW4sIG5leHQ7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBpeExlbjsgaSsrKSB7XG4gICAgICAgIGJpbiA9IGN1cnIgJiYgKGN1cnIuc3RhcnQgPD0gaSAqIGJwcHAgJiYgY3Vyci5lbmQgPiBpICogYnBwcCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IGRhdGEuYWxsLmdldChqICsgMSkpICYmIG5leHQuc3RhcnQgPCAoaSArIDEpICogYnBwcCAmJiBuZXh0LmVuZCA+IGkgKiBicHBwKSB7IFxuICAgICAgICAgIGJpbi5wdXNoKG5leHQudmFsKTsgKytqOyBjdXJyID0gbmV4dDsgXG4gICAgICAgIH1cbiAgICAgICAgZG93bnNhbXBsZWREYXRhW2ldID0gYmluRnVuY3Rpb24oYmluKTtcbiAgICAgIH1cbiAgICAgIGRhdGEuX2JpbkZ1bmN0aW9uID0gc2VsZi5vcHRzLndpbmRvd2luZ0Z1bmN0aW9uO1xuICAgIH0pO1xuICAgIHNlbGYuZGF0YSA9IGRhdGE7XG4gICAgc2VsZi5zdHJldGNoSGVpZ2h0ID0gdHJ1ZTtcbiAgICBzZWxmLnR5cGUoJ3dpZ2dsZV8wJykuYXBwbHlPcHRzLmFwcGx5KHNlbGYpO1xuICAgIHJldHVybiB0cnVlOyAvLyBzdWNjZXNzIVxuICB9LFxuICBcbiAgaW5pdERyYXdTcGVjOiBmdW5jdGlvbihwcmVjYWxjKSB7XG4gICAgdmFyIHZTY2FsZSA9ICh0aGlzLmRyYXdSYW5nZVsxXSAtIHRoaXMuZHJhd1JhbmdlWzBdKSAvIHByZWNhbGMuaGVpZ2h0LFxuICAgICAgZHJhd1NwZWMgPSB7XG4gICAgICAgIGJhcnM6IFtdLFxuICAgICAgICB2U2NhbGU6IHZTY2FsZSxcbiAgICAgICAgeUxpbmU6IHRoaXMuaXNPbih0aGlzLm9wdHMueUxpbmVPbk9mZikgPyBNYXRoLnJvdW5kKCh0aGlzLm9wdHMueUxpbmVNYXJrIC0gdGhpcy5kcmF3UmFuZ2VbMF0pIC8gdlNjYWxlKSA6IG51bGwsIFxuICAgICAgICB6ZXJvTGluZTogLXRoaXMuZHJhd1JhbmdlWzBdIC8gdlNjYWxlXG4gICAgICB9O1xuICAgIHJldHVybiBkcmF3U3BlYztcbiAgfSxcblxuICBwcmVyZW5kZXI6IGZ1bmN0aW9uKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHByZWNhbGMsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzLFxuICAgICAgYnBwcCA9IChlbmQgLSBzdGFydCkgLyBwcmVjYWxjLndpZHRoLFxuICAgICAgZHJhd1NwZWMgPSBzZWxmLnR5cGUoKS5pbml0RHJhd1NwZWMuY2FsbChzZWxmLCBwcmVjYWxjKSxcbiAgICAgIGJpbkZ1bmN0aW9uID0gc2VsZi50eXBlKCkuX2JpbkZ1bmN0aW9uc1tzZWxmLm9wdHMud2luZG93aW5nRnVuY3Rpb25dLFxuICAgICAgZG93bnNhbXBsZWREYXRhO1xuICAgIGlmIChzZWxmLmRhdGEuX2JpbkZ1bmN0aW9uID09IHNlbGYub3B0cy53aW5kb3dpbmdGdW5jdGlvbiAmJiAoZG93bnNhbXBsZWREYXRhID0gc2VsZi5kYXRhW2JwcHBdKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBwcmUtb3B0aW1pemVkIGZvciB0aGlzIGJwcHBcbiAgICAgIGRyYXdTcGVjLmJhcnMgPSBfLm1hcChfLnJhbmdlKChzdGFydCAtIDEpIC8gYnBwcCwgKGVuZCAtIDEpIC8gYnBwcCksIGZ1bmN0aW9uKHhGcm9tT3JpZ2luLCB4KSB7XG4gICAgICAgIHJldHVybiAoKGRvd25zYW1wbGVkRGF0YVt4RnJvbU9yaWdpbl0gfHwgMCkgLSBzZWxmLmRyYXdSYW5nZVswXSkgLyBkcmF3U3BlYy52U2NhbGU7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2UgaGF2ZSB0byBkbyB0aGUgYmlubmluZyBvbiB0aGUgZmx5XG4gICAgICB2YXIgaiA9IHNlbGYuZGF0YS5hbGwuYnNlYXJjaCh7c3RhcnQ6IHN0YXJ0fSksXG4gICAgICAgIGN1cnIgPSBzZWxmLmRhdGEuYWxsLmdldChqKSwgbmV4dCwgYmluO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjYWxjLndpZHRoOyBpKyspIHtcbiAgICAgICAgYmluID0gY3VyciAmJiAoY3Vyci5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgPyBbY3Vyci52YWxdIDogW107XG4gICAgICAgIHdoaWxlICgobmV4dCA9IHNlbGYuZGF0YS5hbGwuZ2V0KGogKyAxKSkgJiYgbmV4dC5zdGFydCA8IChpICsgMSkgKiBicHBwICsgc3RhcnQgJiYgbmV4dC5lbmQgPj0gaSAqIGJwcHAgKyBzdGFydCkgeyBcbiAgICAgICAgICBiaW4ucHVzaChuZXh0LnZhbCk7ICsrajsgY3VyciA9IG5leHQ7IFxuICAgICAgICB9XG4gICAgICAgIGRyYXdTcGVjLmJhcnMucHVzaCgoYmluRnVuY3Rpb24oYmluKSAtIHNlbGYuZHJhd1JhbmdlWzBdKSAvIGRyYXdTcGVjLnZTY2FsZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24oY2FsbGJhY2spID8gY2FsbGJhY2soZHJhd1NwZWMpIDogZHJhd1NwZWM7XG4gIH0sXG4gIFxuICBkcmF3QmFyczogZnVuY3Rpb24oY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCkge1xuICAgIHZhciB6ZXJvTGluZSA9IGRyYXdTcGVjLnplcm9MaW5lLCAvLyBwaXhlbCBwb3NpdGlvbiBvZiB0aGUgZGF0YSB2YWx1ZSAwXG4gICAgICBjb2xvciA9IFwicmdiKFwiK3RoaXMub3B0cy5jb2xvcitcIilcIixcbiAgICAgIGFsdENvbG9yID0gXCJyZ2IoXCIrKHRoaXMub3B0cy5hbHRDb2xvciB8fCB0aGlzLmFsdENvbG9yKStcIilcIixcbiAgICAgIHBvaW50R3JhcGggPSB0aGlzLm9wdHMuZ3JhcGhUeXBlPT09J3BvaW50cyc7XG4gICAgXG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgIF8uZWFjaChkcmF3U3BlYy5iYXJzLCBmdW5jdGlvbihkLCB4KSB7XG4gICAgICBpZiAoZCA9PT0gbnVsbCkgeyByZXR1cm47IH1cbiAgICAgIGVsc2UgaWYgKGQgPiB6ZXJvTGluZSkgeyBcbiAgICAgICAgaWYgKHBvaW50R3JhcGgpIHsgY3R4LmZpbGxSZWN0KHgsIGhlaWdodCAtIGQsIDEsIDEpOyB9XG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gZCwgMSwgemVyb0xpbmUgPiAwID8gKGQgLSB6ZXJvTGluZSkgOiBkKTsgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGFsdENvbG9yO1xuICAgICAgICBpZiAocG9pbnRHcmFwaCkgeyBjdHguZmlsbFJlY3QoeCwgemVyb0xpbmUgLSBkIC0gMSwgMSwgMSk7IH0gXG4gICAgICAgIGVsc2UgeyBjdHguZmlsbFJlY3QoeCwgaGVpZ2h0IC0gemVyb0xpbmUsIDEsIHplcm9MaW5lIC0gZCk7IH1cbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChkcmF3U3BlYy55TGluZSAhPT0gbnVsbCkge1xuICAgICAgY3R4LmZpbGxTdHlsZSA9IFwicmdiKDAsMCwwKVwiO1xuICAgICAgY3R4LmZpbGxSZWN0KDAsIGhlaWdodCAtIGRyYXdTcGVjLnlMaW5lLCB3aWR0aCwgMSk7XG4gICAgfVxuICB9LFxuXG4gIHJlbmRlcjogZnVuY3Rpb24oY2FudmFzLCBzdGFydCwgZW5kLCBkZW5zaXR5LCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcyxcbiAgICAgIGhlaWdodCA9IGNhbnZhcy5oZWlnaHQsXG4gICAgICB3aWR0aCA9IGNhbnZhcy53aWR0aCxcbiAgICAgIGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0ICYmIGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGlmICghY3R4KSB7IHRocm93IFwiQ2FudmFzIG5vdCBzdXBwb3J0ZWRcIjsgfVxuICAgIHNlbGYucHJlcmVuZGVyKHN0YXJ0LCBlbmQsIGRlbnNpdHksIHt3aWR0aDogd2lkdGgsIGhlaWdodDogaGVpZ2h0fSwgZnVuY3Rpb24oZHJhd1NwZWMpIHtcbiAgICAgIHNlbGYudHlwZSgpLmRyYXdCYXJzLmNhbGwoc2VsZiwgY3R4LCBkcmF3U3BlYywgaGVpZ2h0LCB3aWR0aCk7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKGNhbGxiYWNrKSkgeyBjYWxsYmFjaygpOyB9XG4gICAgfSk7XG4gIH0sXG4gIFxuICBsb2FkT3B0czogZnVuY3Rpb24oJGRpYWxvZykge1xuICAgIHZhciBvID0gdGhpcy5vcHRzLFxuICAgICAgJHZpZXdMaW1pdHMgPSAkZGlhbG9nLmZpbmQoJy52aWV3LWxpbWl0cycpLFxuICAgICAgJG1heEhlaWdodFBpeGVscyA9ICRkaWFsb2cuZmluZCgnLm1heC1oZWlnaHQtcGl4ZWxzJyksXG4gICAgICBhbHRDb2xvck9uID0gdGhpcy52YWxpZGF0ZUNvbG9yKG8uYWx0Q29sb3IpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YWx0Q29sb3JPbl0nKS5hdHRyKCdjaGVja2VkJywgYWx0Q29sb3JPbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvcl0nKS52YWwoYWx0Q29sb3JPbiA/IG8uYWx0Q29sb3IgOicxMjgsMTI4LDEyOCcpLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9YXV0b1NjYWxlXScpLmF0dHIoJ2NoZWNrZWQnLCAhdGhpcy5pc09uKG8uYXV0b1NjYWxlKSkuY2hhbmdlKCk7XG4gICAgJHZpZXdMaW1pdHMuc2xpZGVyKFwib3B0aW9uXCIsIFwibWluXCIsIHRoaXMucmFuZ2VbMF0pO1xuICAgICR2aWV3TGltaXRzLnNsaWRlcihcIm9wdGlvblwiLCBcIm1heFwiLCB0aGlzLnJhbmdlWzFdKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNaW5dJykudmFsKHRoaXMuZHJhd1JhbmdlWzBdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXZpZXdMaW1pdHNNYXhdJykudmFsKHRoaXMuZHJhd1JhbmdlWzFdKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lT25PZmZdJykuYXR0cignY2hlY2tlZCcsIHRoaXMuaXNPbihvLnlMaW5lT25PZmYpKS5jaGFuZ2UoKTtcbiAgICAkZGlhbG9nLmZpbmQoJ1tuYW1lPXlMaW5lTWFya10nKS52YWwoby55TGluZU1hcmspLmNoYW5nZSgpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9Z3JhcGhUeXBlXScpLnZhbChvLmdyYXBoVHlwZSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT13aW5kb3dpbmdGdW5jdGlvbl0nKS52YWwoby53aW5kb3dpbmdGdW5jdGlvbikuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNPbl0nKS5hdHRyKCdjaGVja2VkJywgby5tYXhIZWlnaHRQaXhlbHMubGVuZ3RoID49IDMpO1xuICAgICRkaWFsb2cuZmluZCgnW25hbWU9bWF4SGVpZ2h0UGl4ZWxzTWluXScpLnZhbChvLm1heEhlaWdodFBpeGVsc1syXSkuY2hhbmdlKCk7XG4gICAgJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKG8ubWF4SGVpZ2h0UGl4ZWxzWzBdKS5jaGFuZ2UoKTtcbiAgfSxcbiAgXG4gIHNhdmVPcHRzOiBmdW5jdGlvbigkZGlhbG9nKSB7XG4gICAgdmFyIG8gPSB0aGlzLm9wdHMsXG4gICAgICBhbHRDb2xvck9uID0gJGRpYWxvZy5maW5kKCdbbmFtZT1hbHRDb2xvck9uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzT24gPSAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc09uXScpLmlzKCc6Y2hlY2tlZCcpLFxuICAgICAgbWF4SGVpZ2h0UGl4ZWxzTWF4ID0gJGRpYWxvZy5maW5kKCdbbmFtZT1tYXhIZWlnaHRQaXhlbHNNYXhdJykudmFsKCk7XG4gICAgby5hbHRDb2xvciA9IGFsdENvbG9yT24gPyAkZGlhbG9nLmZpbmQoJ1tuYW1lPWFsdENvbG9yXScpLnZhbCgpIDogJyc7XG4gICAgby5hdXRvU2NhbGUgPSAhJGRpYWxvZy5maW5kKCdbbmFtZT1hdXRvU2NhbGVdJykuaXMoJzpjaGVja2VkJyk7XG4gICAgby52aWV3TGltaXRzID0gJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWluXScpLnZhbCgpICsgJzonICsgJGRpYWxvZy5maW5kKCdbbmFtZT12aWV3TGltaXRzTWF4XScpLnZhbCgpO1xuICAgIG8ueUxpbmVPbk9mZiA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVPbk9mZl0nKS5pcygnOmNoZWNrZWQnKTtcbiAgICBvLnlMaW5lTWFyayA9ICRkaWFsb2cuZmluZCgnW25hbWU9eUxpbmVNYXJrXScpLnZhbCgpO1xuICAgIG8uZ3JhcGhUeXBlID0gJGRpYWxvZy5maW5kKCdbbmFtZT1ncmFwaFR5cGVdJykudmFsKCk7XG4gICAgby53aW5kb3dpbmdGdW5jdGlvbiA9ICRkaWFsb2cuZmluZCgnW25hbWU9d2luZG93aW5nRnVuY3Rpb25dJykudmFsKCk7XG4gICAgby5tYXhIZWlnaHRQaXhlbHMgPSBtYXhIZWlnaHRQaXhlbHNPbiA/IFxuICAgICAgW21heEhlaWdodFBpeGVsc01heCwgbWF4SGVpZ2h0UGl4ZWxzTWF4LCAkZGlhbG9nLmZpbmQoJ1tuYW1lPW1heEhlaWdodFBpeGVsc01pbl0nKS52YWwoKV0uam9pbignOicpIDogJyc7XG4gICAgdGhpcy50eXBlKCd3aWdnbGVfMCcpLmluaXRPcHRzLmNhbGwodGhpcyk7XG4gIH1cbiAgXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFdpZ2dsZUZvcm1hdDsiLCIvLyAgICAgVW5kZXJzY29yZS5qcyAxLjguM1xuLy8gICAgIGh0dHA6Ly91bmRlcnNjb3JlanMub3JnXG4vLyAgICAgKGMpIDIwMDktMjAxNSBKZXJlbXkgQXNoa2VuYXMsIERvY3VtZW50Q2xvdWQgYW5kIEludmVzdGlnYXRpdmUgUmVwb3J0ZXJzICYgRWRpdG9yc1xuLy8gICAgIFVuZGVyc2NvcmUgbWF5IGJlIGZyZWVseSBkaXN0cmlidXRlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG4oZnVuY3Rpb24oKXtmdW5jdGlvbiBuKG4pe2Z1bmN0aW9uIHQodCxyLGUsdSxpLG8pe2Zvcig7aT49MCYmbz5pO2krPW4pe3ZhciBhPXU/dVtpXTppO2U9cihlLHRbYV0sYSx0KX1yZXR1cm4gZX1yZXR1cm4gZnVuY3Rpb24ocixlLHUsaSl7ZT1iKGUsaSw0KTt2YXIgbz0hayhyKSYmbS5rZXlzKHIpLGE9KG98fHIpLmxlbmd0aCxjPW4+MD8wOmEtMTtyZXR1cm4gYXJndW1lbnRzLmxlbmd0aDwzJiYodT1yW28/b1tjXTpjXSxjKz1uKSx0KHIsZSx1LG8sYyxhKX19ZnVuY3Rpb24gdChuKXtyZXR1cm4gZnVuY3Rpb24odCxyLGUpe3I9eChyLGUpO2Zvcih2YXIgdT1PKHQpLGk9bj4wPzA6dS0xO2k+PTAmJnU+aTtpKz1uKWlmKHIodFtpXSxpLHQpKXJldHVybiBpO3JldHVybi0xfX1mdW5jdGlvbiByKG4sdCxyKXtyZXR1cm4gZnVuY3Rpb24oZSx1LGkpe3ZhciBvPTAsYT1PKGUpO2lmKFwibnVtYmVyXCI9PXR5cGVvZiBpKW4+MD9vPWk+PTA/aTpNYXRoLm1heChpK2Esbyk6YT1pPj0wP01hdGgubWluKGkrMSxhKTppK2ErMTtlbHNlIGlmKHImJmkmJmEpcmV0dXJuIGk9cihlLHUpLGVbaV09PT11P2k6LTE7aWYodSE9PXUpcmV0dXJuIGk9dChsLmNhbGwoZSxvLGEpLG0uaXNOYU4pLGk+PTA/aStvOi0xO2ZvcihpPW4+MD9vOmEtMTtpPj0wJiZhPmk7aSs9bilpZihlW2ldPT09dSlyZXR1cm4gaTtyZXR1cm4tMX19ZnVuY3Rpb24gZShuLHQpe3ZhciByPUkubGVuZ3RoLGU9bi5jb25zdHJ1Y3Rvcix1PW0uaXNGdW5jdGlvbihlKSYmZS5wcm90b3R5cGV8fGEsaT1cImNvbnN0cnVjdG9yXCI7Zm9yKG0uaGFzKG4saSkmJiFtLmNvbnRhaW5zKHQsaSkmJnQucHVzaChpKTtyLS07KWk9SVtyXSxpIGluIG4mJm5baV0hPT11W2ldJiYhbS5jb250YWlucyh0LGkpJiZ0LnB1c2goaSl9dmFyIHU9dGhpcyxpPXUuXyxvPUFycmF5LnByb3RvdHlwZSxhPU9iamVjdC5wcm90b3R5cGUsYz1GdW5jdGlvbi5wcm90b3R5cGUsZj1vLnB1c2gsbD1vLnNsaWNlLHM9YS50b1N0cmluZyxwPWEuaGFzT3duUHJvcGVydHksaD1BcnJheS5pc0FycmF5LHY9T2JqZWN0LmtleXMsZz1jLmJpbmQseT1PYmplY3QuY3JlYXRlLGQ9ZnVuY3Rpb24oKXt9LG09ZnVuY3Rpb24obil7cmV0dXJuIG4gaW5zdGFuY2VvZiBtP246dGhpcyBpbnN0YW5jZW9mIG0/dm9pZCh0aGlzLl93cmFwcGVkPW4pOm5ldyBtKG4pfTtcInVuZGVmaW5lZFwiIT10eXBlb2YgZXhwb3J0cz8oXCJ1bmRlZmluZWRcIiE9dHlwZW9mIG1vZHVsZSYmbW9kdWxlLmV4cG9ydHMmJihleHBvcnRzPW1vZHVsZS5leHBvcnRzPW0pLGV4cG9ydHMuXz1tKTp1Ll89bSxtLlZFUlNJT049XCIxLjguM1wiO3ZhciBiPWZ1bmN0aW9uKG4sdCxyKXtpZih0PT09dm9pZCAwKXJldHVybiBuO3N3aXRjaChudWxsPT1yPzM6cil7Y2FzZSAxOnJldHVybiBmdW5jdGlvbihyKXtyZXR1cm4gbi5jYWxsKHQscil9O2Nhc2UgMjpyZXR1cm4gZnVuY3Rpb24ocixlKXtyZXR1cm4gbi5jYWxsKHQscixlKX07Y2FzZSAzOnJldHVybiBmdW5jdGlvbihyLGUsdSl7cmV0dXJuIG4uY2FsbCh0LHIsZSx1KX07Y2FzZSA0OnJldHVybiBmdW5jdGlvbihyLGUsdSxpKXtyZXR1cm4gbi5jYWxsKHQscixlLHUsaSl9fXJldHVybiBmdW5jdGlvbigpe3JldHVybiBuLmFwcGx5KHQsYXJndW1lbnRzKX19LHg9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT1uP20uaWRlbnRpdHk6bS5pc0Z1bmN0aW9uKG4pP2Iobix0LHIpOm0uaXNPYmplY3Qobik/bS5tYXRjaGVyKG4pOm0ucHJvcGVydHkobil9O20uaXRlcmF0ZWU9ZnVuY3Rpb24obix0KXtyZXR1cm4geChuLHQsMS8wKX07dmFyIF89ZnVuY3Rpb24obix0KXtyZXR1cm4gZnVuY3Rpb24ocil7dmFyIGU9YXJndW1lbnRzLmxlbmd0aDtpZigyPmV8fG51bGw9PXIpcmV0dXJuIHI7Zm9yKHZhciB1PTE7ZT51O3UrKylmb3IodmFyIGk9YXJndW1lbnRzW3VdLG89bihpKSxhPW8ubGVuZ3RoLGM9MDthPmM7YysrKXt2YXIgZj1vW2NdO3QmJnJbZl0hPT12b2lkIDB8fChyW2ZdPWlbZl0pfXJldHVybiByfX0saj1mdW5jdGlvbihuKXtpZighbS5pc09iamVjdChuKSlyZXR1cm57fTtpZih5KXJldHVybiB5KG4pO2QucHJvdG90eXBlPW47dmFyIHQ9bmV3IGQ7cmV0dXJuIGQucHJvdG90eXBlPW51bGwsdH0sdz1mdW5jdGlvbihuKXtyZXR1cm4gZnVuY3Rpb24odCl7cmV0dXJuIG51bGw9PXQ/dm9pZCAwOnRbbl19fSxBPU1hdGgucG93KDIsNTMpLTEsTz13KFwibGVuZ3RoXCIpLGs9ZnVuY3Rpb24obil7dmFyIHQ9TyhuKTtyZXR1cm5cIm51bWJlclwiPT10eXBlb2YgdCYmdD49MCYmQT49dH07bS5lYWNoPW0uZm9yRWFjaD1mdW5jdGlvbihuLHQscil7dD1iKHQscik7dmFyIGUsdTtpZihrKG4pKWZvcihlPTAsdT1uLmxlbmd0aDt1PmU7ZSsrKXQobltlXSxlLG4pO2Vsc2V7dmFyIGk9bS5rZXlzKG4pO2ZvcihlPTAsdT1pLmxlbmd0aDt1PmU7ZSsrKXQobltpW2VdXSxpW2VdLG4pfXJldHVybiBufSxtLm1hcD1tLmNvbGxlY3Q9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPUFycmF5KHUpLG89MDt1Pm87bysrKXt2YXIgYT1lP2Vbb106bztpW29dPXQoblthXSxhLG4pfXJldHVybiBpfSxtLnJlZHVjZT1tLmZvbGRsPW0uaW5qZWN0PW4oMSksbS5yZWR1Y2VSaWdodD1tLmZvbGRyPW4oLTEpLG0uZmluZD1tLmRldGVjdD1mdW5jdGlvbihuLHQscil7dmFyIGU7cmV0dXJuIGU9ayhuKT9tLmZpbmRJbmRleChuLHQscik6bS5maW5kS2V5KG4sdCxyKSxlIT09dm9pZCAwJiZlIT09LTE/bltlXTp2b2lkIDB9LG0uZmlsdGVyPW0uc2VsZWN0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1bXTtyZXR1cm4gdD14KHQsciksbS5lYWNoKG4sZnVuY3Rpb24obixyLHUpe3QobixyLHUpJiZlLnB1c2gobil9KSxlfSxtLnJlamVjdD1mdW5jdGlvbihuLHQscil7cmV0dXJuIG0uZmlsdGVyKG4sbS5uZWdhdGUoeCh0KSkscil9LG0uZXZlcnk9bS5hbGw9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPTA7dT5pO2krKyl7dmFyIG89ZT9lW2ldOmk7aWYoIXQobltvXSxvLG4pKXJldHVybiExfXJldHVybiEwfSxtLnNvbWU9bS5hbnk9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZT0hayhuKSYmbS5rZXlzKG4pLHU9KGV8fG4pLmxlbmd0aCxpPTA7dT5pO2krKyl7dmFyIG89ZT9lW2ldOmk7aWYodChuW29dLG8sbikpcmV0dXJuITB9cmV0dXJuITF9LG0uY29udGFpbnM9bS5pbmNsdWRlcz1tLmluY2x1ZGU9ZnVuY3Rpb24obix0LHIsZSl7cmV0dXJuIGsobil8fChuPW0udmFsdWVzKG4pKSwoXCJudW1iZXJcIiE9dHlwZW9mIHJ8fGUpJiYocj0wKSxtLmluZGV4T2Yobix0LHIpPj0wfSxtLmludm9rZT1mdW5jdGlvbihuLHQpe3ZhciByPWwuY2FsbChhcmd1bWVudHMsMiksZT1tLmlzRnVuY3Rpb24odCk7cmV0dXJuIG0ubWFwKG4sZnVuY3Rpb24obil7dmFyIHU9ZT90Om5bdF07cmV0dXJuIG51bGw9PXU/dTp1LmFwcGx5KG4scil9KX0sbS5wbHVjaz1mdW5jdGlvbihuLHQpe3JldHVybiBtLm1hcChuLG0ucHJvcGVydHkodCkpfSxtLndoZXJlPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIG0uZmlsdGVyKG4sbS5tYXRjaGVyKHQpKX0sbS5maW5kV2hlcmU9ZnVuY3Rpb24obix0KXtyZXR1cm4gbS5maW5kKG4sbS5tYXRjaGVyKHQpKX0sbS5tYXg9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT0tMS8wLG89LTEvMDtpZihudWxsPT10JiZudWxsIT1uKXtuPWsobik/bjptLnZhbHVlcyhuKTtmb3IodmFyIGE9MCxjPW4ubGVuZ3RoO2M+YTthKyspZT1uW2FdLGU+aSYmKGk9ZSl9ZWxzZSB0PXgodCxyKSxtLmVhY2gobixmdW5jdGlvbihuLHIsZSl7dT10KG4scixlKSwodT5vfHx1PT09LTEvMCYmaT09PS0xLzApJiYoaT1uLG89dSl9KTtyZXR1cm4gaX0sbS5taW49ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT0xLzAsbz0xLzA7aWYobnVsbD09dCYmbnVsbCE9bil7bj1rKG4pP246bS52YWx1ZXMobik7Zm9yKHZhciBhPTAsYz1uLmxlbmd0aDtjPmE7YSsrKWU9blthXSxpPmUmJihpPWUpfWVsc2UgdD14KHQsciksbS5lYWNoKG4sZnVuY3Rpb24obixyLGUpe3U9dChuLHIsZSksKG8+dXx8MS8wPT09dSYmMS8wPT09aSkmJihpPW4sbz11KX0pO3JldHVybiBpfSxtLnNodWZmbGU9ZnVuY3Rpb24obil7Zm9yKHZhciB0LHI9ayhuKT9uOm0udmFsdWVzKG4pLGU9ci5sZW5ndGgsdT1BcnJheShlKSxpPTA7ZT5pO2krKyl0PW0ucmFuZG9tKDAsaSksdCE9PWkmJih1W2ldPXVbdF0pLHVbdF09cltpXTtyZXR1cm4gdX0sbS5zYW1wbGU9ZnVuY3Rpb24obix0LHIpe3JldHVybiBudWxsPT10fHxyPyhrKG4pfHwobj1tLnZhbHVlcyhuKSksblttLnJhbmRvbShuLmxlbmd0aC0xKV0pOm0uc2h1ZmZsZShuKS5zbGljZSgwLE1hdGgubWF4KDAsdCkpfSxtLnNvcnRCeT1mdW5jdGlvbihuLHQscil7cmV0dXJuIHQ9eCh0LHIpLG0ucGx1Y2sobS5tYXAobixmdW5jdGlvbihuLHIsZSl7cmV0dXJue3ZhbHVlOm4saW5kZXg6cixjcml0ZXJpYTp0KG4scixlKX19KS5zb3J0KGZ1bmN0aW9uKG4sdCl7dmFyIHI9bi5jcml0ZXJpYSxlPXQuY3JpdGVyaWE7aWYociE9PWUpe2lmKHI+ZXx8cj09PXZvaWQgMClyZXR1cm4gMTtpZihlPnJ8fGU9PT12b2lkIDApcmV0dXJuLTF9cmV0dXJuIG4uaW5kZXgtdC5pbmRleH0pLFwidmFsdWVcIil9O3ZhciBGPWZ1bmN0aW9uKG4pe3JldHVybiBmdW5jdGlvbih0LHIsZSl7dmFyIHU9e307cmV0dXJuIHI9eChyLGUpLG0uZWFjaCh0LGZ1bmN0aW9uKGUsaSl7dmFyIG89cihlLGksdCk7bih1LGUsbyl9KSx1fX07bS5ncm91cEJ5PUYoZnVuY3Rpb24obix0LHIpe20uaGFzKG4scik/bltyXS5wdXNoKHQpOm5bcl09W3RdfSksbS5pbmRleEJ5PUYoZnVuY3Rpb24obix0LHIpe25bcl09dH0pLG0uY291bnRCeT1GKGZ1bmN0aW9uKG4sdCxyKXttLmhhcyhuLHIpP25bcl0rKzpuW3JdPTF9KSxtLnRvQXJyYXk9ZnVuY3Rpb24obil7cmV0dXJuIG4/bS5pc0FycmF5KG4pP2wuY2FsbChuKTprKG4pP20ubWFwKG4sbS5pZGVudGl0eSk6bS52YWx1ZXMobik6W119LG0uc2l6ZT1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj8wOmsobik/bi5sZW5ndGg6bS5rZXlzKG4pLmxlbmd0aH0sbS5wYXJ0aXRpb249ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO3ZhciBlPVtdLHU9W107cmV0dXJuIG0uZWFjaChuLGZ1bmN0aW9uKG4scixpKXsodChuLHIsaSk/ZTp1KS5wdXNoKG4pfSksW2UsdV19LG0uZmlyc3Q9bS5oZWFkPW0udGFrZT1mdW5jdGlvbihuLHQscil7cmV0dXJuIG51bGw9PW4/dm9pZCAwOm51bGw9PXR8fHI/blswXTptLmluaXRpYWwobixuLmxlbmd0aC10KX0sbS5pbml0aWFsPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbC5jYWxsKG4sMCxNYXRoLm1heCgwLG4ubGVuZ3RoLShudWxsPT10fHxyPzE6dCkpKX0sbS5sYXN0PWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gbnVsbD09bj92b2lkIDA6bnVsbD09dHx8cj9uW24ubGVuZ3RoLTFdOm0ucmVzdChuLE1hdGgubWF4KDAsbi5sZW5ndGgtdCkpfSxtLnJlc3Q9bS50YWlsPW0uZHJvcD1mdW5jdGlvbihuLHQscil7cmV0dXJuIGwuY2FsbChuLG51bGw9PXR8fHI/MTp0KX0sbS5jb21wYWN0PWZ1bmN0aW9uKG4pe3JldHVybiBtLmZpbHRlcihuLG0uaWRlbnRpdHkpfTt2YXIgUz1mdW5jdGlvbihuLHQscixlKXtmb3IodmFyIHU9W10saT0wLG89ZXx8MCxhPU8obik7YT5vO28rKyl7dmFyIGM9bltvXTtpZihrKGMpJiYobS5pc0FycmF5KGMpfHxtLmlzQXJndW1lbnRzKGMpKSl7dHx8KGM9UyhjLHQscikpO3ZhciBmPTAsbD1jLmxlbmd0aDtmb3IodS5sZW5ndGgrPWw7bD5mOyl1W2krK109Y1tmKytdfWVsc2Ugcnx8KHVbaSsrXT1jKX1yZXR1cm4gdX07bS5mbGF0dGVuPWZ1bmN0aW9uKG4sdCl7cmV0dXJuIFMobix0LCExKX0sbS53aXRob3V0PWZ1bmN0aW9uKG4pe3JldHVybiBtLmRpZmZlcmVuY2UobixsLmNhbGwoYXJndW1lbnRzLDEpKX0sbS51bmlxPW0udW5pcXVlPWZ1bmN0aW9uKG4sdCxyLGUpe20uaXNCb29sZWFuKHQpfHwoZT1yLHI9dCx0PSExKSxudWxsIT1yJiYocj14KHIsZSkpO2Zvcih2YXIgdT1bXSxpPVtdLG89MCxhPU8obik7YT5vO28rKyl7dmFyIGM9bltvXSxmPXI/cihjLG8sbik6Yzt0PyhvJiZpPT09Znx8dS5wdXNoKGMpLGk9Zik6cj9tLmNvbnRhaW5zKGksZil8fChpLnB1c2goZiksdS5wdXNoKGMpKTptLmNvbnRhaW5zKHUsYyl8fHUucHVzaChjKX1yZXR1cm4gdX0sbS51bmlvbj1mdW5jdGlvbigpe3JldHVybiBtLnVuaXEoUyhhcmd1bWVudHMsITAsITApKX0sbS5pbnRlcnNlY3Rpb249ZnVuY3Rpb24obil7Zm9yKHZhciB0PVtdLHI9YXJndW1lbnRzLmxlbmd0aCxlPTAsdT1PKG4pO3U+ZTtlKyspe3ZhciBpPW5bZV07aWYoIW0uY29udGFpbnModCxpKSl7Zm9yKHZhciBvPTE7cj5vJiZtLmNvbnRhaW5zKGFyZ3VtZW50c1tvXSxpKTtvKyspO289PT1yJiZ0LnB1c2goaSl9fXJldHVybiB0fSxtLmRpZmZlcmVuY2U9ZnVuY3Rpb24obil7dmFyIHQ9Uyhhcmd1bWVudHMsITAsITAsMSk7cmV0dXJuIG0uZmlsdGVyKG4sZnVuY3Rpb24obil7cmV0dXJuIW0uY29udGFpbnModCxuKX0pfSxtLnppcD1mdW5jdGlvbigpe3JldHVybiBtLnVuemlwKGFyZ3VtZW50cyl9LG0udW56aXA9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW4mJm0ubWF4KG4sTykubGVuZ3RofHwwLHI9QXJyYXkodCksZT0wO3Q+ZTtlKyspcltlXT1tLnBsdWNrKG4sZSk7cmV0dXJuIHJ9LG0ub2JqZWN0PWZ1bmN0aW9uKG4sdCl7Zm9yKHZhciByPXt9LGU9MCx1PU8obik7dT5lO2UrKyl0P3JbbltlXV09dFtlXTpyW25bZV1bMF1dPW5bZV1bMV07cmV0dXJuIHJ9LG0uZmluZEluZGV4PXQoMSksbS5maW5kTGFzdEluZGV4PXQoLTEpLG0uc29ydGVkSW5kZXg9ZnVuY3Rpb24obix0LHIsZSl7cj14KHIsZSwxKTtmb3IodmFyIHU9cih0KSxpPTAsbz1PKG4pO28+aTspe3ZhciBhPU1hdGguZmxvb3IoKGkrbykvMik7cihuW2FdKTx1P2k9YSsxOm89YX1yZXR1cm4gaX0sbS5pbmRleE9mPXIoMSxtLmZpbmRJbmRleCxtLnNvcnRlZEluZGV4KSxtLmxhc3RJbmRleE9mPXIoLTEsbS5maW5kTGFzdEluZGV4KSxtLnJhbmdlPWZ1bmN0aW9uKG4sdCxyKXtudWxsPT10JiYodD1ufHwwLG49MCkscj1yfHwxO2Zvcih2YXIgZT1NYXRoLm1heChNYXRoLmNlaWwoKHQtbikvciksMCksdT1BcnJheShlKSxpPTA7ZT5pO2krKyxuKz1yKXVbaV09bjtyZXR1cm4gdX07dmFyIEU9ZnVuY3Rpb24obix0LHIsZSx1KXtpZighKGUgaW5zdGFuY2VvZiB0KSlyZXR1cm4gbi5hcHBseShyLHUpO3ZhciBpPWoobi5wcm90b3R5cGUpLG89bi5hcHBseShpLHUpO3JldHVybiBtLmlzT2JqZWN0KG8pP286aX07bS5iaW5kPWZ1bmN0aW9uKG4sdCl7aWYoZyYmbi5iaW5kPT09ZylyZXR1cm4gZy5hcHBseShuLGwuY2FsbChhcmd1bWVudHMsMSkpO2lmKCFtLmlzRnVuY3Rpb24obikpdGhyb3cgbmV3IFR5cGVFcnJvcihcIkJpbmQgbXVzdCBiZSBjYWxsZWQgb24gYSBmdW5jdGlvblwiKTt2YXIgcj1sLmNhbGwoYXJndW1lbnRzLDIpLGU9ZnVuY3Rpb24oKXtyZXR1cm4gRShuLGUsdCx0aGlzLHIuY29uY2F0KGwuY2FsbChhcmd1bWVudHMpKSl9O3JldHVybiBlfSxtLnBhcnRpYWw9ZnVuY3Rpb24obil7dmFyIHQ9bC5jYWxsKGFyZ3VtZW50cywxKSxyPWZ1bmN0aW9uKCl7Zm9yKHZhciBlPTAsdT10Lmxlbmd0aCxpPUFycmF5KHUpLG89MDt1Pm87bysrKWlbb109dFtvXT09PW0/YXJndW1lbnRzW2UrK106dFtvXTtmb3IoO2U8YXJndW1lbnRzLmxlbmd0aDspaS5wdXNoKGFyZ3VtZW50c1tlKytdKTtyZXR1cm4gRShuLHIsdGhpcyx0aGlzLGkpfTtyZXR1cm4gcn0sbS5iaW5kQWxsPWZ1bmN0aW9uKG4pe3ZhciB0LHIsZT1hcmd1bWVudHMubGVuZ3RoO2lmKDE+PWUpdGhyb3cgbmV3IEVycm9yKFwiYmluZEFsbCBtdXN0IGJlIHBhc3NlZCBmdW5jdGlvbiBuYW1lc1wiKTtmb3IodD0xO2U+dDt0Kyspcj1hcmd1bWVudHNbdF0sbltyXT1tLmJpbmQobltyXSxuKTtyZXR1cm4gbn0sbS5tZW1vaXplPWZ1bmN0aW9uKG4sdCl7dmFyIHI9ZnVuY3Rpb24oZSl7dmFyIHU9ci5jYWNoZSxpPVwiXCIrKHQ/dC5hcHBseSh0aGlzLGFyZ3VtZW50cyk6ZSk7cmV0dXJuIG0uaGFzKHUsaSl8fCh1W2ldPW4uYXBwbHkodGhpcyxhcmd1bWVudHMpKSx1W2ldfTtyZXR1cm4gci5jYWNoZT17fSxyfSxtLmRlbGF5PWZ1bmN0aW9uKG4sdCl7dmFyIHI9bC5jYWxsKGFyZ3VtZW50cywyKTtyZXR1cm4gc2V0VGltZW91dChmdW5jdGlvbigpe3JldHVybiBuLmFwcGx5KG51bGwscil9LHQpfSxtLmRlZmVyPW0ucGFydGlhbChtLmRlbGF5LG0sMSksbS50aHJvdHRsZT1mdW5jdGlvbihuLHQscil7dmFyIGUsdSxpLG89bnVsbCxhPTA7cnx8KHI9e30pO3ZhciBjPWZ1bmN0aW9uKCl7YT1yLmxlYWRpbmc9PT0hMT8wOm0ubm93KCksbz1udWxsLGk9bi5hcHBseShlLHUpLG98fChlPXU9bnVsbCl9O3JldHVybiBmdW5jdGlvbigpe3ZhciBmPW0ubm93KCk7YXx8ci5sZWFkaW5nIT09ITF8fChhPWYpO3ZhciBsPXQtKGYtYSk7cmV0dXJuIGU9dGhpcyx1PWFyZ3VtZW50cywwPj1sfHxsPnQ/KG8mJihjbGVhclRpbWVvdXQobyksbz1udWxsKSxhPWYsaT1uLmFwcGx5KGUsdSksb3x8KGU9dT1udWxsKSk6b3x8ci50cmFpbGluZz09PSExfHwobz1zZXRUaW1lb3V0KGMsbCkpLGl9fSxtLmRlYm91bmNlPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZSx1LGksbyxhLGM9ZnVuY3Rpb24oKXt2YXIgZj1tLm5vdygpLW87dD5mJiZmPj0wP2U9c2V0VGltZW91dChjLHQtZik6KGU9bnVsbCxyfHwoYT1uLmFwcGx5KGksdSksZXx8KGk9dT1udWxsKSkpfTtyZXR1cm4gZnVuY3Rpb24oKXtpPXRoaXMsdT1hcmd1bWVudHMsbz1tLm5vdygpO3ZhciBmPXImJiFlO3JldHVybiBlfHwoZT1zZXRUaW1lb3V0KGMsdCkpLGYmJihhPW4uYXBwbHkoaSx1KSxpPXU9bnVsbCksYX19LG0ud3JhcD1mdW5jdGlvbihuLHQpe3JldHVybiBtLnBhcnRpYWwodCxuKX0sbS5uZWdhdGU9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIW4uYXBwbHkodGhpcyxhcmd1bWVudHMpfX0sbS5jb21wb3NlPWZ1bmN0aW9uKCl7dmFyIG49YXJndW1lbnRzLHQ9bi5sZW5ndGgtMTtyZXR1cm4gZnVuY3Rpb24oKXtmb3IodmFyIHI9dCxlPW5bdF0uYXBwbHkodGhpcyxhcmd1bWVudHMpO3ItLTspZT1uW3JdLmNhbGwodGhpcyxlKTtyZXR1cm4gZX19LG0uYWZ0ZXI9ZnVuY3Rpb24obix0KXtyZXR1cm4gZnVuY3Rpb24oKXtyZXR1cm4tLW48MT90LmFwcGx5KHRoaXMsYXJndW1lbnRzKTp2b2lkIDB9fSxtLmJlZm9yZT1mdW5jdGlvbihuLHQpe3ZhciByO3JldHVybiBmdW5jdGlvbigpe3JldHVybi0tbj4wJiYocj10LmFwcGx5KHRoaXMsYXJndW1lbnRzKSksMT49biYmKHQ9bnVsbCkscn19LG0ub25jZT1tLnBhcnRpYWwobS5iZWZvcmUsMik7dmFyIE09IXt0b1N0cmluZzpudWxsfS5wcm9wZXJ0eUlzRW51bWVyYWJsZShcInRvU3RyaW5nXCIpLEk9W1widmFsdWVPZlwiLFwiaXNQcm90b3R5cGVPZlwiLFwidG9TdHJpbmdcIixcInByb3BlcnR5SXNFbnVtZXJhYmxlXCIsXCJoYXNPd25Qcm9wZXJ0eVwiLFwidG9Mb2NhbGVTdHJpbmdcIl07bS5rZXlzPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybltdO2lmKHYpcmV0dXJuIHYobik7dmFyIHQ9W107Zm9yKHZhciByIGluIG4pbS5oYXMobixyKSYmdC5wdXNoKHIpO3JldHVybiBNJiZlKG4sdCksdH0sbS5hbGxLZXlzPWZ1bmN0aW9uKG4pe2lmKCFtLmlzT2JqZWN0KG4pKXJldHVybltdO3ZhciB0PVtdO2Zvcih2YXIgciBpbiBuKXQucHVzaChyKTtyZXR1cm4gTSYmZShuLHQpLHR9LG0udmFsdWVzPWZ1bmN0aW9uKG4pe2Zvcih2YXIgdD1tLmtleXMobikscj10Lmxlbmd0aCxlPUFycmF5KHIpLHU9MDtyPnU7dSsrKWVbdV09blt0W3VdXTtyZXR1cm4gZX0sbS5tYXBPYmplY3Q9ZnVuY3Rpb24obix0LHIpe3Q9eCh0LHIpO2Zvcih2YXIgZSx1PW0ua2V5cyhuKSxpPXUubGVuZ3RoLG89e30sYT0wO2k+YTthKyspZT11W2FdLG9bZV09dChuW2VdLGUsbik7cmV0dXJuIG99LG0ucGFpcnM9ZnVuY3Rpb24obil7Zm9yKHZhciB0PW0ua2V5cyhuKSxyPXQubGVuZ3RoLGU9QXJyYXkociksdT0wO3I+dTt1KyspZVt1XT1bdFt1XSxuW3RbdV1dXTtyZXR1cm4gZX0sbS5pbnZlcnQ9ZnVuY3Rpb24obil7Zm9yKHZhciB0PXt9LHI9bS5rZXlzKG4pLGU9MCx1PXIubGVuZ3RoO3U+ZTtlKyspdFtuW3JbZV1dXT1yW2VdO3JldHVybiB0fSxtLmZ1bmN0aW9ucz1tLm1ldGhvZHM9ZnVuY3Rpb24obil7dmFyIHQ9W107Zm9yKHZhciByIGluIG4pbS5pc0Z1bmN0aW9uKG5bcl0pJiZ0LnB1c2gocik7cmV0dXJuIHQuc29ydCgpfSxtLmV4dGVuZD1fKG0uYWxsS2V5cyksbS5leHRlbmRPd249bS5hc3NpZ249XyhtLmtleXMpLG0uZmluZEtleT1mdW5jdGlvbihuLHQscil7dD14KHQscik7Zm9yKHZhciBlLHU9bS5rZXlzKG4pLGk9MCxvPXUubGVuZ3RoO28+aTtpKyspaWYoZT11W2ldLHQobltlXSxlLG4pKXJldHVybiBlfSxtLnBpY2s9ZnVuY3Rpb24obix0LHIpe3ZhciBlLHUsaT17fSxvPW47aWYobnVsbD09bylyZXR1cm4gaTttLmlzRnVuY3Rpb24odCk/KHU9bS5hbGxLZXlzKG8pLGU9Yih0LHIpKToodT1TKGFyZ3VtZW50cywhMSwhMSwxKSxlPWZ1bmN0aW9uKG4sdCxyKXtyZXR1cm4gdCBpbiByfSxvPU9iamVjdChvKSk7Zm9yKHZhciBhPTAsYz11Lmxlbmd0aDtjPmE7YSsrKXt2YXIgZj11W2FdLGw9b1tmXTtlKGwsZixvKSYmKGlbZl09bCl9cmV0dXJuIGl9LG0ub21pdD1mdW5jdGlvbihuLHQscil7aWYobS5pc0Z1bmN0aW9uKHQpKXQ9bS5uZWdhdGUodCk7ZWxzZXt2YXIgZT1tLm1hcChTKGFyZ3VtZW50cywhMSwhMSwxKSxTdHJpbmcpO3Q9ZnVuY3Rpb24obix0KXtyZXR1cm4hbS5jb250YWlucyhlLHQpfX1yZXR1cm4gbS5waWNrKG4sdCxyKX0sbS5kZWZhdWx0cz1fKG0uYWxsS2V5cywhMCksbS5jcmVhdGU9ZnVuY3Rpb24obix0KXt2YXIgcj1qKG4pO3JldHVybiB0JiZtLmV4dGVuZE93bihyLHQpLHJ9LG0uY2xvbmU9ZnVuY3Rpb24obil7cmV0dXJuIG0uaXNPYmplY3Qobik/bS5pc0FycmF5KG4pP24uc2xpY2UoKTptLmV4dGVuZCh7fSxuKTpufSxtLnRhcD1mdW5jdGlvbihuLHQpe3JldHVybiB0KG4pLG59LG0uaXNNYXRjaD1mdW5jdGlvbihuLHQpe3ZhciByPW0ua2V5cyh0KSxlPXIubGVuZ3RoO2lmKG51bGw9PW4pcmV0dXJuIWU7Zm9yKHZhciB1PU9iamVjdChuKSxpPTA7ZT5pO2krKyl7dmFyIG89cltpXTtpZih0W29dIT09dVtvXXx8IShvIGluIHUpKXJldHVybiExfXJldHVybiEwfTt2YXIgTj1mdW5jdGlvbihuLHQscixlKXtpZihuPT09dClyZXR1cm4gMCE9PW58fDEvbj09PTEvdDtpZihudWxsPT1ufHxudWxsPT10KXJldHVybiBuPT09dDtuIGluc3RhbmNlb2YgbSYmKG49bi5fd3JhcHBlZCksdCBpbnN0YW5jZW9mIG0mJih0PXQuX3dyYXBwZWQpO3ZhciB1PXMuY2FsbChuKTtpZih1IT09cy5jYWxsKHQpKXJldHVybiExO3N3aXRjaCh1KXtjYXNlXCJbb2JqZWN0IFJlZ0V4cF1cIjpjYXNlXCJbb2JqZWN0IFN0cmluZ11cIjpyZXR1cm5cIlwiK249PVwiXCIrdDtjYXNlXCJbb2JqZWN0IE51bWJlcl1cIjpyZXR1cm4rbiE9PStuPyt0IT09K3Q6MD09PStuPzEvK249PT0xL3Q6K249PT0rdDtjYXNlXCJbb2JqZWN0IERhdGVdXCI6Y2FzZVwiW29iamVjdCBCb29sZWFuXVwiOnJldHVybituPT09K3R9dmFyIGk9XCJbb2JqZWN0IEFycmF5XVwiPT09dTtpZighaSl7aWYoXCJvYmplY3RcIiE9dHlwZW9mIG58fFwib2JqZWN0XCIhPXR5cGVvZiB0KXJldHVybiExO3ZhciBvPW4uY29uc3RydWN0b3IsYT10LmNvbnN0cnVjdG9yO2lmKG8hPT1hJiYhKG0uaXNGdW5jdGlvbihvKSYmbyBpbnN0YW5jZW9mIG8mJm0uaXNGdW5jdGlvbihhKSYmYSBpbnN0YW5jZW9mIGEpJiZcImNvbnN0cnVjdG9yXCJpbiBuJiZcImNvbnN0cnVjdG9yXCJpbiB0KXJldHVybiExfXI9cnx8W10sZT1lfHxbXTtmb3IodmFyIGM9ci5sZW5ndGg7Yy0tOylpZihyW2NdPT09bilyZXR1cm4gZVtjXT09PXQ7aWYoci5wdXNoKG4pLGUucHVzaCh0KSxpKXtpZihjPW4ubGVuZ3RoLGMhPT10Lmxlbmd0aClyZXR1cm4hMTtmb3IoO2MtLTspaWYoIU4obltjXSx0W2NdLHIsZSkpcmV0dXJuITF9ZWxzZXt2YXIgZixsPW0ua2V5cyhuKTtpZihjPWwubGVuZ3RoLG0ua2V5cyh0KS5sZW5ndGghPT1jKXJldHVybiExO2Zvcig7Yy0tOylpZihmPWxbY10sIW0uaGFzKHQsZil8fCFOKG5bZl0sdFtmXSxyLGUpKXJldHVybiExfXJldHVybiByLnBvcCgpLGUucG9wKCksITB9O20uaXNFcXVhbD1mdW5jdGlvbihuLHQpe3JldHVybiBOKG4sdCl9LG0uaXNFbXB0eT1mdW5jdGlvbihuKXtyZXR1cm4gbnVsbD09bj8hMDprKG4pJiYobS5pc0FycmF5KG4pfHxtLmlzU3RyaW5nKG4pfHxtLmlzQXJndW1lbnRzKG4pKT8wPT09bi5sZW5ndGg6MD09PW0ua2V5cyhuKS5sZW5ndGh9LG0uaXNFbGVtZW50PWZ1bmN0aW9uKG4pe3JldHVybiEoIW58fDEhPT1uLm5vZGVUeXBlKX0sbS5pc0FycmF5PWh8fGZ1bmN0aW9uKG4pe3JldHVyblwiW29iamVjdCBBcnJheV1cIj09PXMuY2FsbChuKX0sbS5pc09iamVjdD1mdW5jdGlvbihuKXt2YXIgdD10eXBlb2YgbjtyZXR1cm5cImZ1bmN0aW9uXCI9PT10fHxcIm9iamVjdFwiPT09dCYmISFufSxtLmVhY2goW1wiQXJndW1lbnRzXCIsXCJGdW5jdGlvblwiLFwiU3RyaW5nXCIsXCJOdW1iZXJcIixcIkRhdGVcIixcIlJlZ0V4cFwiLFwiRXJyb3JcIl0sZnVuY3Rpb24obil7bVtcImlzXCIrbl09ZnVuY3Rpb24odCl7cmV0dXJuIHMuY2FsbCh0KT09PVwiW29iamVjdCBcIituK1wiXVwifX0pLG0uaXNBcmd1bWVudHMoYXJndW1lbnRzKXx8KG0uaXNBcmd1bWVudHM9ZnVuY3Rpb24obil7cmV0dXJuIG0uaGFzKG4sXCJjYWxsZWVcIil9KSxcImZ1bmN0aW9uXCIhPXR5cGVvZi8uLyYmXCJvYmplY3RcIiE9dHlwZW9mIEludDhBcnJheSYmKG0uaXNGdW5jdGlvbj1mdW5jdGlvbihuKXtyZXR1cm5cImZ1bmN0aW9uXCI9PXR5cGVvZiBufHwhMX0pLG0uaXNGaW5pdGU9ZnVuY3Rpb24obil7cmV0dXJuIGlzRmluaXRlKG4pJiYhaXNOYU4ocGFyc2VGbG9hdChuKSl9LG0uaXNOYU49ZnVuY3Rpb24obil7cmV0dXJuIG0uaXNOdW1iZXIobikmJm4hPT0rbn0sbS5pc0Jvb2xlYW49ZnVuY3Rpb24obil7cmV0dXJuIG49PT0hMHx8bj09PSExfHxcIltvYmplY3QgQm9vbGVhbl1cIj09PXMuY2FsbChuKX0sbS5pc051bGw9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PT1ufSxtLmlzVW5kZWZpbmVkPWZ1bmN0aW9uKG4pe3JldHVybiBuPT09dm9pZCAwfSxtLmhhcz1mdW5jdGlvbihuLHQpe3JldHVybiBudWxsIT1uJiZwLmNhbGwobix0KX0sbS5ub0NvbmZsaWN0PWZ1bmN0aW9uKCl7cmV0dXJuIHUuXz1pLHRoaXN9LG0uaWRlbnRpdHk9ZnVuY3Rpb24obil7cmV0dXJuIG59LG0uY29uc3RhbnQ9ZnVuY3Rpb24obil7cmV0dXJuIGZ1bmN0aW9uKCl7cmV0dXJuIG59fSxtLm5vb3A9ZnVuY3Rpb24oKXt9LG0ucHJvcGVydHk9dyxtLnByb3BlcnR5T2Y9ZnVuY3Rpb24obil7cmV0dXJuIG51bGw9PW4/ZnVuY3Rpb24oKXt9OmZ1bmN0aW9uKHQpe3JldHVybiBuW3RdfX0sbS5tYXRjaGVyPW0ubWF0Y2hlcz1mdW5jdGlvbihuKXtyZXR1cm4gbj1tLmV4dGVuZE93bih7fSxuKSxmdW5jdGlvbih0KXtyZXR1cm4gbS5pc01hdGNoKHQsbil9fSxtLnRpbWVzPWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1BcnJheShNYXRoLm1heCgwLG4pKTt0PWIodCxyLDEpO2Zvcih2YXIgdT0wO24+dTt1KyspZVt1XT10KHUpO3JldHVybiBlfSxtLnJhbmRvbT1mdW5jdGlvbihuLHQpe3JldHVybiBudWxsPT10JiYodD1uLG49MCksbitNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkqKHQtbisxKSl9LG0ubm93PURhdGUubm93fHxmdW5jdGlvbigpe3JldHVybihuZXcgRGF0ZSkuZ2V0VGltZSgpfTt2YXIgQj17XCImXCI6XCImYW1wO1wiLFwiPFwiOlwiJmx0O1wiLFwiPlwiOlwiJmd0O1wiLCdcIic6XCImcXVvdDtcIixcIidcIjpcIiYjeDI3O1wiLFwiYFwiOlwiJiN4NjA7XCJ9LFQ9bS5pbnZlcnQoQiksUj1mdW5jdGlvbihuKXt2YXIgdD1mdW5jdGlvbih0KXtyZXR1cm4gblt0XX0scj1cIig/OlwiK20ua2V5cyhuKS5qb2luKFwifFwiKStcIilcIixlPVJlZ0V4cChyKSx1PVJlZ0V4cChyLFwiZ1wiKTtyZXR1cm4gZnVuY3Rpb24obil7cmV0dXJuIG49bnVsbD09bj9cIlwiOlwiXCIrbixlLnRlc3Qobik/bi5yZXBsYWNlKHUsdCk6bn19O20uZXNjYXBlPVIoQiksbS51bmVzY2FwZT1SKFQpLG0ucmVzdWx0PWZ1bmN0aW9uKG4sdCxyKXt2YXIgZT1udWxsPT1uP3ZvaWQgMDpuW3RdO3JldHVybiBlPT09dm9pZCAwJiYoZT1yKSxtLmlzRnVuY3Rpb24oZSk/ZS5jYWxsKG4pOmV9O3ZhciBxPTA7bS51bmlxdWVJZD1mdW5jdGlvbihuKXt2YXIgdD0rK3ErXCJcIjtyZXR1cm4gbj9uK3Q6dH0sbS50ZW1wbGF0ZVNldHRpbmdzPXtldmFsdWF0ZTovPCUoW1xcc1xcU10rPyklPi9nLGludGVycG9sYXRlOi88JT0oW1xcc1xcU10rPyklPi9nLGVzY2FwZTovPCUtKFtcXHNcXFNdKz8pJT4vZ307dmFyIEs9LyguKV4vLHo9e1wiJ1wiOlwiJ1wiLFwiXFxcXFwiOlwiXFxcXFwiLFwiXFxyXCI6XCJyXCIsXCJcXG5cIjpcIm5cIixcIlxcdTIwMjhcIjpcInUyMDI4XCIsXCJcXHUyMDI5XCI6XCJ1MjAyOVwifSxEPS9cXFxcfCd8XFxyfFxcbnxcXHUyMDI4fFxcdTIwMjkvZyxMPWZ1bmN0aW9uKG4pe3JldHVyblwiXFxcXFwiK3pbbl19O20udGVtcGxhdGU9ZnVuY3Rpb24obix0LHIpeyF0JiZyJiYodD1yKSx0PW0uZGVmYXVsdHMoe30sdCxtLnRlbXBsYXRlU2V0dGluZ3MpO3ZhciBlPVJlZ0V4cChbKHQuZXNjYXBlfHxLKS5zb3VyY2UsKHQuaW50ZXJwb2xhdGV8fEspLnNvdXJjZSwodC5ldmFsdWF0ZXx8Sykuc291cmNlXS5qb2luKFwifFwiKStcInwkXCIsXCJnXCIpLHU9MCxpPVwiX19wKz0nXCI7bi5yZXBsYWNlKGUsZnVuY3Rpb24odCxyLGUsbyxhKXtyZXR1cm4gaSs9bi5zbGljZSh1LGEpLnJlcGxhY2UoRCxMKSx1PWErdC5sZW5ndGgscj9pKz1cIicrXFxuKChfX3Q9KFwiK3IrXCIpKT09bnVsbD8nJzpfLmVzY2FwZShfX3QpKStcXG4nXCI6ZT9pKz1cIicrXFxuKChfX3Q9KFwiK2UrXCIpKT09bnVsbD8nJzpfX3QpK1xcbidcIjpvJiYoaSs9XCInO1xcblwiK28rXCJcXG5fX3ArPSdcIiksdH0pLGkrPVwiJztcXG5cIix0LnZhcmlhYmxlfHwoaT1cIndpdGgob2JqfHx7fSl7XFxuXCIraStcIn1cXG5cIiksaT1cInZhciBfX3QsX19wPScnLF9faj1BcnJheS5wcm90b3R5cGUuam9pbixcIitcInByaW50PWZ1bmN0aW9uKCl7X19wKz1fX2ouY2FsbChhcmd1bWVudHMsJycpO307XFxuXCIraStcInJldHVybiBfX3A7XFxuXCI7dHJ5e3ZhciBvPW5ldyBGdW5jdGlvbih0LnZhcmlhYmxlfHxcIm9ialwiLFwiX1wiLGkpfWNhdGNoKGEpe3Rocm93IGEuc291cmNlPWksYX12YXIgYz1mdW5jdGlvbihuKXtyZXR1cm4gby5jYWxsKHRoaXMsbixtKX0sZj10LnZhcmlhYmxlfHxcIm9ialwiO3JldHVybiBjLnNvdXJjZT1cImZ1bmN0aW9uKFwiK2YrXCIpe1xcblwiK2krXCJ9XCIsY30sbS5jaGFpbj1mdW5jdGlvbihuKXt2YXIgdD1tKG4pO3JldHVybiB0Ll9jaGFpbj0hMCx0fTt2YXIgUD1mdW5jdGlvbihuLHQpe3JldHVybiBuLl9jaGFpbj9tKHQpLmNoYWluKCk6dH07bS5taXhpbj1mdW5jdGlvbihuKXttLmVhY2gobS5mdW5jdGlvbnMobiksZnVuY3Rpb24odCl7dmFyIHI9bVt0XT1uW3RdO20ucHJvdG90eXBlW3RdPWZ1bmN0aW9uKCl7dmFyIG49W3RoaXMuX3dyYXBwZWRdO3JldHVybiBmLmFwcGx5KG4sYXJndW1lbnRzKSxQKHRoaXMsci5hcHBseShtLG4pKX19KX0sbS5taXhpbihtKSxtLmVhY2goW1wicG9wXCIsXCJwdXNoXCIsXCJyZXZlcnNlXCIsXCJzaGlmdFwiLFwic29ydFwiLFwic3BsaWNlXCIsXCJ1bnNoaWZ0XCJdLGZ1bmN0aW9uKG4pe3ZhciB0PW9bbl07bS5wcm90b3R5cGVbbl09ZnVuY3Rpb24oKXt2YXIgcj10aGlzLl93cmFwcGVkO3JldHVybiB0LmFwcGx5KHIsYXJndW1lbnRzKSxcInNoaWZ0XCIhPT1uJiZcInNwbGljZVwiIT09bnx8MCE9PXIubGVuZ3RofHxkZWxldGUgclswXSxQKHRoaXMscil9fSksbS5lYWNoKFtcImNvbmNhdFwiLFwiam9pblwiLFwic2xpY2VcIl0sZnVuY3Rpb24obil7dmFyIHQ9b1tuXTttLnByb3RvdHlwZVtuXT1mdW5jdGlvbigpe3JldHVybiBQKHRoaXMsdC5hcHBseSh0aGlzLl93cmFwcGVkLGFyZ3VtZW50cykpfX0pLG0ucHJvdG90eXBlLnZhbHVlPWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMuX3dyYXBwZWR9LG0ucHJvdG90eXBlLnZhbHVlT2Y9bS5wcm90b3R5cGUudG9KU09OPW0ucHJvdG90eXBlLnZhbHVlLG0ucHJvdG90eXBlLnRvU3RyaW5nPWZ1bmN0aW9uKCl7cmV0dXJuXCJcIit0aGlzLl93cmFwcGVkfSxcImZ1bmN0aW9uXCI9PXR5cGVvZiBkZWZpbmUmJmRlZmluZS5hbWQmJmRlZmluZShcInVuZGVyc2NvcmVcIixbXSxmdW5jdGlvbigpe3JldHVybiBtfSl9KS5jYWxsKHRoaXMpOyJdfQ==
