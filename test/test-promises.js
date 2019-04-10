'use strict';

const _ = require('lodash');
const should = require('should');
require('./helpers/shouldjs-tree')(should);
const app = require('./fixtures/get-app')('simple-app');

describe('Tree mixin features', () => {

  ['Category', 'CategoryCustomId'].forEach((modelName) => {

    const Node = app.models[modelName];
    const idName = Node.getIdName();
    const store = {};

    describe(Node.definition.settings.description, () => {

      describe('Node creation', () => {

        it('Should create root node', (done) => {
          const data = {slug: 'node-x', name: 'Node x'};
          Node.create(data).then((node) => {
            node.should.be.node().and.root();
            store.node_x = node;
            done();
          }).catch(done);
        });

        it('Should create child node with parent instance', (done) => {
          const data = {slug: 'node-x-x', name: 'Node x.x'};
          Node.addNode(store.node_x, data).then((node) => {
            node.should.be.node().and.childOf(store.node_x);
            store.node_x_x = node;
            done();
          }).catch(done);
        });

        it('Should create child node through the parent id', (done) => {
          const data = {slug: 'node-x-y', name: 'Node x.y'};
          Node.addNode(store.node_x.getId(), data).then((node) => {
            node.should.be.node().and.childOf(store.node_x);
            store.node_x_y = node;
            done();
          }).catch(done);
        });

        it('Should create child node through a parent criteria', (done) => {
          const data = {slug: 'node-x-z', name: 'Node x.z'};
          Node.addNode({slug: store.node_x.slug}, data).then((node) => {
            node.should.be.node().and.childOf(store.node_x);
            store.node_x_z = node;
            done();
          }).catch(done);
        });

        it('Should create child node of a child node', (done) => {
          const data = {slug: 'node-x-x-x', name: 'Node x.x.x'};
          Node.addNode(store.node_x_x, data).then((node) => {
            node.should.be.node().and.childOf(store.node_x_x);
            store.node_x_x_x = node;
            done();
          }).catch(done);
        });

      });

      describe('Tree retrieval', () => {

        const slugsTree = {
          'node-x': {
            'node-x-x': {
              'node-x-x-x': true,
            },
            'node-x-y': true,
            'node-x-z': true,
          },
        };

        it('Should retrieve the whole tree', (done) => {
          Node.allTrees().then((roots) => {
            roots = _.filter(roots, {slug: store.node_x.slug});
            roots.should.be.treeLevel();
            roots.should.be.treeLevelLike(_.pick(slugsTree, ['node-x']));
            done();
          }).catch(done);
        });

        it('Should retrieve a subtree from parent instance', (done) => {
          Node.asTree(store.node_x).then((roots) => {
            roots.should.be.treeLevel(store.node_x).and.treeLevelLike(slugsTree['node-x']);
            done();
          }).catch(done);
        });

        it('Should retrieve a subtree from parent id', (done) => {
          Node.asTree(store.node_x.getId()).then((roots) => {
            roots.should.be.treeLevel(store.node_x).and.treeLevelLike(slugsTree['node-x']);
            done();
          }).catch(done);
        });

        it('Should retrieve a subtree from a parent criteria', (done) => {
          Node.asTree({slug: store.node_x.slug}).then((roots) => {
            roots.should.be.treeLevel(store.node_x).and.treeLevelLike(slugsTree['node-x']);
            done();
          }).catch(done);
        });

        it('Should retrieve a subtree including the parent', (done) => {
          Node.asTree(store.node_x, {withParent: true}).then((root) => {
            root.should.be.node().and.root();
            root.getId().should.equals(store.node_x.getId());
            root.children.should.be.treeLevel(store.node_x).and.treeLevelLike(slugsTree['node-x']);
            done();
          }).catch(done);
        });

        it('Should retrieve a subtree in both structure and flat formats', (done) => {
          Node.asTree(store.node_x.getId(), {returnEverything: true}).then((result) => {
            result.should.have.properties(['tree', 'flat']);
            result.tree.should.be.treeLevel(store.node_x).and.treeLevelLike(slugsTree['node-x']);
            _.map(result.flat, 'slug').should.be.eql(['node-x-x', 'node-x-y', 'node-x-z', 'node-x-x-x']);
            done();
          }).catch(done);
        });

      });

      describe('Rearrange tree json', () => {

        it('Should rearrange a tree json', (done) => {
          const tree = [{
            [idName]: store.node_x.getId(),
            children: [{
              [idName]: store.node_x_x_x.getId(),
              children: [{
                [idName]: store.node_x_z.getId(),
              }, {
                [idName]: store.node_x_y.getId(),
                children: [{
                  [idName]: store.node_x_x.getId(),
                }],
              }],
            }],
          }];
          Node.saveJsonTree(_.cloneDeep(tree)).then(() => {
            Node.asTree().then((roots) => {
              _.filter(roots, {slug: 'node-x'}).should.be.treeJsonLike(tree);
              done();
            }).catch(done);
          }).catch(done);
        });

        it('Should rearrange a tree json with prependRoot option', (done) => {
          const subtree = [{
            [idName]: store.node_x_x.getId(),
            children: [{
              [idName]: store.node_x_x_x.getId(),
            }],
          }, {
            [idName]: store.node_x_y.getId(),
          }, {
            [idName]: store.node_x_z.getId(),
          }];
          Node.saveJsonTree(_.cloneDeep(subtree), {prependRoot: store.node_x.getId()}).then(() => {
            Node.asTree().then((roots) => {
              _.filter(roots, {slug: 'node-x'}).should.be.treeJsonLike([{
                [idName]: store.node_x.getId(),
                children: roots,
              }]);
              done();
            }).catch(done);
          }).catch(done);
        });
      });

      describe('Node movement', () => {

        it('Should move a node', (done) => {
          Node.moveNode(store.node_x_z, store.node_x_y.getId()).then((node) => {
            node.should.be.node().and.childOf(store.node_x_y);
            done();
          }).catch(done);
        });

      });

      describe('Node removal', () => {

        it('Should remove a node and set the children orphan', (done) => {
          Node.deleteNode(store.node_x_x).then((success) => {
            success.should.be.True();
            Node.findById(store.node_x_x.getId()).then((deletedNode) => {
              should.not.exist(deletedNode);
              Node.findById(store.node_x_x_x.getId()).then((orphanNode) => {
                orphanNode.should.be.root();
                done();
              }).catch(done);
            }).catch(done);
          }).catch(done);
        });

        it('Should remove a node and its children enabling withChildren option', (done) => {
          Node.deleteNode(store.node_x, {withChildren: true}).then((success) => {
            success.should.be.True();
            Node.find({
              where: {slug: {inq: ['node-x', 'node-x-x', 'node-x-y', 'node-x-z', 'node-x-x-x']}},
            }).then((remainingNodes) => {
              // Only Node x.x.x survived because it left orphan
              remainingNodes.should.be.length(1);
              remainingNodes[0].getId().should.be.eql(store.node_x_x_x.getId());
              done();
            }).catch(done);
          }).catch(done);
        });

      });

    });

  });

});
