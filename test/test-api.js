'use strict';

const _ = require('lodash');
const should = require('should');
const request = require('request');
require('./helpers/shouldjs-tree')(should);
const app = require('./fixtures/get-app')('simple-app');

describe('Tree mixin features through API', () => {

  before((done) => {
    app.once('started', done);
  });

  const apiUrl = getApiUrl();

  ['Category', 'CategoryCustomId'].forEach((modelName) => {

    const Node = app.models[modelName];
    const idName = Node.getIdName();
    const nodeUrl = `${apiUrl}${Node.http.path}`;
    const store = {};

    describe(Node.definition.settings.description, () => {

      describe('Node creation', () => {

        it('Should create root node', (done) => {
          request.post({
            url: nodeUrl,
            form: {slug: 'node-a', name: 'Node A'},
          }, (err, res, body) => {
            if (err) return done(err);
            const node = assert200(res, body);
            node.should.be.node().and.root();
            store.node_a = node;
            done();
          });
        });

        it('Should create child node through the parent id', (done) => {
          request.put({
            url: `${nodeUrl}/addNode`,
            form: {
              parent: store.node_a[idName],
              node: {slug: 'node-a-a', name: 'Node A.A'},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const node = assert200(res, body);
            node.should.be.node().and.childOf(store.node_a, idName);
            store.node_a_a = node;
            done();
          });
        });

        it('Should create child node through a parent criteria', (done) => {
          request.put({
            url: `${nodeUrl}/addNode`,
            form: {
              parent: {slug: store.node_a.slug},
              node: {slug: 'node-a-b', name: 'Node A.B'},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const node = assert200(res, body);
            node.should.be.node().and.childOf(store.node_a, idName);
            store.node_a_b = node;
            done();
          });
        });

        it('Should create child node of a child node', (done) => {
          request.put({
            url: `${nodeUrl}/addNode`,
            form: {
              parent: store.node_a_b[idName],
              node: {slug: 'node-a-b-a', name: 'Node A.B.A'},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const node = assert200(res, body);
            node.should.be.node().and.childOf(store.node_a_b, idName);
            store.node_a_b_a = node;
            done();
          });
        });

      });

      describe('Node retrieval', () => {

        const slugsTree = {
          'node-a': {
            'node-a-a': true,
            'node-a-b': {
              'node-a-b-a': true,
            },
          },
        };

        it('Should retrieve a subtree from parent id', (done) => {
          request.get(`${nodeUrl}/asTree`, {
            qs: {parent: store.node_a[idName]},
          }, (err, res, body) => {
            if (err) return done(err);
            const roots = assert200(res, body);
            roots.should.be.treeLevel(store.node_a, idName).and.treeLevelLike(slugsTree['node-a']);
            done();
          });
        });

        it('Should retrieve a subtree from a parent criteria', (done) => {
          request.get(`${nodeUrl}/asTree`, {
            qs: {parent: {slug: store.node_a.slug}},
          }, (err, res, body) => {
            if (err) return done(err);
            const roots = assert200(res, body);
            roots.should.be.treeLevel(store.node_a, idName).and.treeLevelLike(slugsTree['node-a']);
            done();
          });
        });

        it('Should retrieve a subtree including the parent', (done) => {
          request.get(`${nodeUrl}/asTree`, {
            qs: {
              parent: {slug: store.node_a.slug},
              options: {withParent: true},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const root = assert200(res, body);
            root.should.be.node().and.root();
            root[idName].should.equals(store.node_a[idName]);
            root.children.should.be.treeLevel(store.node_a, idName).and.treeLevelLike(slugsTree['node-a']);
            done();
          });
        });

        it('Should retrieve a subtree in both structure and flat formats', (done) => {
          request.get(`${nodeUrl}/asTree`, {
            qs: {
              parent: store.node_a[idName],
              options: {returnEverything: true},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const result = assert200(res, body);
            result.should.have.properties(['tree', 'flat']);
            result.tree.should.be.treeLevel(store.node_a, idName).and.treeLevelLike(slugsTree['node-a']);
            _.map(result.flat, 'slug').should.be.eql(['node-a-a', 'node-a-b', 'node-a-b-a']);
            done();
          });
        });

        it('Should retrieve children through a built-in remote with filter', (done) => {
          request.get(`${nodeUrl}`, {
            qs: {filter: {where: {parent: store.node_a[idName]}}},
          }, (err, res, body) => {
            if (err) return done(err);
            const children = assert200(res, body);
            _.map(children, 'slug').should.be.eql(['node-a-a', 'node-a-b']);
            done();
          });
        });

        it('Should retrieve descendants through a built-in remote with filter', (done) => {
          request.get(`${nodeUrl}`, {
            qs: {filter: {where: {ancestors: store.node_a[idName]}}},
          }, (err, res, body) => {
            if (err) return done(err);
            const children = assert200(res, body);
            _.map(children, 'slug').should.be.eql(['node-a-a', 'node-a-b', 'node-a-b-a']);
            done();
          });
        });

      });

      describe('Rearrange tree json', () => {

        it('Should rearrange a tree json', (done) => {
          const tree = [{
            [idName]: store.node_a[idName],
            children: [{
              [idName]: store.node_a_b_a[idName],
              children: [{
                [idName]: store.node_a_b[idName],
              }, {
                [idName]: store.node_a_a[idName],
              }],
            }],
          }];
          request.post(`${nodeUrl}/saveJsonTree`, {
            form: {tree: tree},
          }, (err, res, body) => {
            if (err) return done(err);
            assert200(res, body);
            Node.asTree().then((roots) => {
              _.filter(roots, {slug: 'node-a'}).should.be.treeJsonLike(tree);
              done();
            }).catch(done);
          });
        });

        it('Should rearrange a tree json with prependRoot option', (done) => {
          const subtree = [{
            [idName]: store.node_a_a[idName],
          }, {
            [idName]: store.node_a_b[idName],
            children: [{
              [idName]: store.node_a_b_a[idName],
            }],
          }];
          request.post(`${nodeUrl}/saveJsonTree`, {
            form: {
              tree: subtree,
              options: {prependRoot: {[idName]: store.node_a[idName]}},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            assert200(res, body);
            Node.asTree().then((roots) => {
              _.filter(roots, {slug: 'node-a'}).should.be.treeJsonLike([{
                [idName]: store.node_a[idName],
                children: roots,
              }]);
              done();
            }).catch(done);
          });
        });

      });

      describe('Node movement', () => {

        it('Should move a node', (done) => {
          request.post({
            url: `${nodeUrl}/moveNode`,
            form: {
              node: store.node_a_b_a[idName],
              parent: {slug: store.node_a_a.slug},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const node = assert200(res, body);
            node.should.be.node().and.childOf(store.node_a_a, idName);
            done();
          });
        });

      });

      describe('Node removal', () => {

        it('Should remove a node and set the children orphan', (done) => {
          request.delete({
            url: `${nodeUrl}/deleteNode`,
            form: {node: store.node_a_a[idName]},
          }, (err, res, body) => {
            if (err) return done(err);
            const success = assert200(res, body);
            success.should.be.True();
            Node.findById(store.node_a_a[idName]).then((deletedNode) => {
              should.not.exist(deletedNode);
              Node.findById(store.node_a_b_a[idName]).then((orphanNode) => {
                orphanNode.should.be.root();
                done();
              }).catch(done);
            }).catch(done);
          });
        });

        it('Should remove a node and its children enabling withChildren option', (done) => {
          request.delete({
            url: `${nodeUrl}/deleteNode`,
            form: {
              node: {slug: store.node_a.slug},
              options: {withChildren: true},
            },
          }, (err, res, body) => {
            if (err) return done(err);
            const success = assert200(res, body);
            success.should.be.True();
            Node.find({
              where: {slug: {inq: ['node-a', 'node-a-a', 'node-a-b', 'node-a-b-a']}},
            }).then((remainingNodes) => {
              // Only Node a.b.a survived because it left orphan
              remainingNodes.should.be.length(1);
              remainingNodes[0].getId().toString().should.be.eql(store.node_a_b_a[idName]);
              done();
            }).catch(done);
          });
        });

      });

    });

  });

  function assert200 (res, body) {
    should.exist(res);
    res.statusCode.should.be.eql(200);
    should.exist(body);
    return JSON.parse(body);
  }

  function getApiUrl () {
    const protocol = app.get('protocol');
    const host = app.get('host');
    const port = app.get('port');
    const apiRoot = app.get('restApiRoot');
    return `${protocol}://${host}:${port}${apiRoot}`;
  }

});
