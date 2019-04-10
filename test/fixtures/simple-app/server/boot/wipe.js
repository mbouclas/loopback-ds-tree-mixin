'use strict';

const _ = require('lodash');
const Promise = require('bluebird');

module.exports = function (app, done) {
  Promise.all(_.map(app.models, (Model) => {
    return Model.destroyAll();
  })).then(() => done())
    .catch(done);
};
