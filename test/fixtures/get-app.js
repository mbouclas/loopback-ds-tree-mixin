'use strict';

const path = require('path');

const apps = {};

module.exports = (appName) => {
  if (!apps[appName]) {
    const appDir = path.join(__dirname, appName);
    apps[appName] = require(path.join(appDir, 'server/server.js'));
  }
  return apps[appName];
};
