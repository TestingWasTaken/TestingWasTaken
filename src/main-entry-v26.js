'use strict';

const Module = require('node:module');

require('./fresh-start-v23');
require('./main-v26-sync');
require('./main-v25-ip-fallback');

const originalLoad = Module._load;
Module._load = function conduitV26ModuleRedirect(request, parent, isMain) {
  if (request === './main-v18' && /main-entry-v18\.js$/.test(parent?.filename || '')) {
    return originalLoad('./main-v26-shell', parent, isMain);
  }
  return originalLoad(request, parent, isMain);
};

try {
  require('./main-entry-v18');
} finally {
  Module._load = originalLoad;
}
