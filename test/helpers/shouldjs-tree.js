'use strict';

const _ = require('lodash');

module.exports = function (should) {

  should.Assertion.add('node', function () {
    this.obj.should.have.property('ancestors').which.is.Array();
  });

  should.Assertion.add('root', function () {
    should.not.exist(this.obj.parent);
    Array.from(this.obj.ancestors).should.eql([]);
  });

  should.Assertion.add('childOf', function (parent, idName = 'id') {
    this.obj.should.have.property('parent');
    const parentId = _.invoke(parent, 'getId') || parent[idName];
    this.obj.parent.should.eql(parentId);
    Array.from(this.obj.ancestors).should.eql(parent.ancestors.concat([parentId]));
  });

  should.Assertion.add('treeLevel', function (parentNode = null, idName = 'id') {
    this.obj.should.be.an.Array();
    this.obj.forEach((node) => {
      node.should.be.node();
      if (!parentNode) {
        node.should.be.root();
      } else {
        node.should.be.childOf(parentNode, idName);
      }
      if (!_.isNil(node.depth) || node.ancestors.length) {
        node.should.have.property('depth').which.equals(node.ancestors.length);
      }
      node.should.have.property('children').which.is.an.Array();
      node.children.should.be.treeLevel(node, idName);
    });
  });

  should.Assertion.add('treeLevelLike', function (level) {
    _.keys(level).should.eql(_.map(this.obj, 'slug'));
    _.each(level, (children, slug) => {
      const node = _.find(this.obj, {slug});
      node.children.should.be.treeLevelLike(children);
    });
  });

  should.Assertion.add('treeJsonLike', function (jsonLevel) {
    this.obj.should.be.an.Array();
    if (!_.isEmpty(this.obj)) {
      const idName = this.obj[0].getIdName();
      _.invokeMap(this.obj, `${idName}.toString`)
        .should.eql(_.invokeMap(jsonLevel, `${idName}.toString`));
      _.each(this.obj, (node, i) => {
        node.children.should.be.treeJsonLike(jsonLevel[i].children);
      });
    }
  });

};
