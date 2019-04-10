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
          const data = {slug: 'node-1', name: 'Node 1'};
          Node.create(data, (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.root();
            store.node1 = node;
            done();
          });
        });

        it('Should create child node with parent instance', (done) => {
          const data = {slug: 'node-1-1', name: 'Node 1.1'};
          Node.addNode(store.node1, data, (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.childOf(store.node1);
            store.node1_1 = node;
            done();
          });
        });

        it('Should create child node through the parent id', (done) => {
          const data = {slug: 'node-1-2', name: 'Node 1.2'};
          Node.addNode(store.node1.getId(), data, (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.childOf(store.node1);
            store.node1_2 = node;
            done();
          });
        });

        it('Should create child node through a parent criteria', (done) => {
          const data = {slug: 'node-1-3', name: 'Node 1.3'};
          Node.addNode({slug: store.node1.slug}, data, (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.childOf(store.node1);
            store.node1_3 = node;
            done();
          });
        });

        it('Should create child node of a child node', (done) => {
          const data = {slug: 'node-1-1-1', name: 'Node 1.1.1'};
          Node.addNode(store.node1_1, data, (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.childOf(store.node1_1);
            store.node1_1_1 = node;
            done();
          });
        });

      });

      describe('Tree retrieval', () => {

        const slugsTree = {
          'node-1': {
            'node-1-1': {
              'node-1-1-1': true,
            },
            'node-1-2': true,
            'node-1-3': true,
          },
        };

        it('Should retrieve the whole tree', (done) => {
          Node.allTrees((err, roots) => {
            roots = _.filter(roots, {slug: store.node1.slug});
            roots.should.be.treeLevel();
            roots.should.be.treeLevelLike(_.pick(slugsTree, ['node-1']));
            done();
          });
        });

        it('Should retrieve a subtree from parent instance', (done) => {
          Node.asTree(store.node1, (err, roots) => {
            if (err) return done(err);
            roots.should.be.treeLevel(store.node1).and.treeLevelLike(slugsTree['node-1']);
            done();
          });
        });

        it('Should retrieve a subtree from parent id', (done) => {
          Node.asTree(store.node1.getId(), (err, roots) => {
            if (err) return done(err);
            roots.should.be.treeLevel(store.node1).and.treeLevelLike(slugsTree['node-1']);
            done();
          });
        });

        it('Should retrieve a subtree from a parent criteria', (done) => {
          Node.asTree({slug: store.node1.slug}, (err, roots) => {
            if (err) return done(err);
            roots.should.be.treeLevel(store.node1).and.treeLevelLike(slugsTree['node-1']);
            done();
          });
        });

        it('Should retrieve a subtree including the parent', (done) => {
          Node.asTree(store.node1, {withParent: true}, (err, root) => {
            if (err) return done(err);
            root.should.be.node().and.root();
            root.getId().should.equals(store.node1.getId());
            root.children.should.be.treeLevel(store.node1).and.treeLevelLike(slugsTree['node-1']);
            done();
          });
        });

        it('Should retrieve a subtree in both structure and flat formats', (done) => {
          Node.asTree(store.node1.getId(), {returnEverything: true}, (err, result) => {
            if (err) return done(err);
            result.should.have.properties(['tree', 'flat']);
            result.tree.should.be.treeLevel(store.node1).and.treeLevelLike(slugsTree['node-1']);
            _.map(result.flat, 'slug').should.be.eql(['node-1-1', 'node-1-2', 'node-1-3', 'node-1-1-1']);
            done();
          });
        });

      });

      describe('Rearrange tree json', () => {

        it('Should rearrange a tree json', (done) => {
          const tree = [{
            [idName]: store.node1.getId(),
            children: [{
              [idName]: store.node1_1_1.getId(),
              children: [{
                [idName]: store.node1_3.getId(),
              }, {
                [idName]: store.node1_2.getId(),
                children: [{
                  [idName]: store.node1_1.getId(),
                }],
              }],
            }],
          }];
          Node.saveJsonTree(_.cloneDeep(tree), (err) => {
            if (err) return done(err);
            Node.asTree((err, roots) => {
              if (err) return done(err);
              _.filter(roots, {slug: 'node-1'}).should.be.treeJsonLike(tree);
              done();
            });
          });
        });

        it('Should rearrange a tree json with prependRoot option', (done) => {
          const subtree = [{
            [idName]: store.node1_1.getId(),
            children: [{
              [idName]: store.node1_1_1.getId(),
            }],
          }, {
            [idName]: store.node1_2.getId(),
          }, {
            [idName]: store.node1_3.getId(),
          }];
          Node.saveJsonTree(_.cloneDeep(subtree), {prependRoot: store.node1.getId()}, (err) => {
            if (err) return done(err);
            Node.asTree((err, roots) => {
              if (err) return done(err);
              _.filter(roots, {slug: 'node-1'}).should.be.treeJsonLike([{
                [idName]: store.node1.getId(),
                children: roots,
              }]);
              done();
            });
          });
        });
      });

      describe('Node movement', () => {

        it('Should move a node', (done) => {
          Node.moveNode(store.node1_3, store.node1_2.getId(), (err, node) => {
            if (err) return done(err);
            node.should.be.node().and.childOf(store.node1_2);
            done();
          });
        });

      });

      describe('Node removal', () => {

        it('Should remove a node and set the children orphan', (done) => {
          Node.deleteNode(store.node1_1, (err, success) => {
            if (err) return done(err);
            success.should.be.True();
            Node.findById(store.node1_1.getId(), (err, deletedNode) => {
              if (err) return done(err);
              should.not.exist(deletedNode);
              Node.findById(store.node1_1_1.getId(), (err, orphanNode) => {
                if (err) return done(err);
                orphanNode.should.be.root();
                done();
              });
            });
          });
        });

        it('Should remove a node and its children enabling withChildren option', (done) => {
          Node.deleteNode(store.node1, {withChildren: true}, (err, success) => {
            if (err) return done(err);
            success.should.be.True();
            Node.find({
              where: {slug: {inq: ['node-1', 'node-1-1', 'node-1-2', 'node-1-3', 'node-1-1-1']}},
            }, (err, remainingNodes) => {
              if (err) return done(err);
              // Only Node 1.1.1 survived because it left orphan
              remainingNodes.should.be.length(1);
              remainingNodes[0].getId().should.be.eql(store.node1_1_1.getId());
              done();
            });
          });
        });

      });

    });

  });

});
