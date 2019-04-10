var lo = require('lodash'),
    Promise = require('bluebird'),
    pg = require('polygoat');

function Tree(Model, config) {
    var _this = this;
    var DS = Model.getDataSource();
    var idName = Model.getIdName();
    var idType = Model.definition.properties[idName].type;
    _this.toObjectID = idType === DS.ObjectID;

    Model.defineProperty('parent', {type: idType, required: false});
    Model.defineProperty('ancestors', {type: [{type: idType}], default : []});
    Model.defineProperty('children', {type: [{type: Object}], required: false});
    Model.defineProperty('depth', {type: Number, required: false});
    Model.defineProperty('orderBy', {type: Number, required: false});

    Model.belongsTo(Model.modelName, {
        as: 'parentObject',
        foreignKey: 'parent'
    });

    Model.referencesMany(Model.modelName, {
        as: 'ancestorObjects',
        foreignKey: 'ancestors'
    });

    /**
     * Return all the trees from the database table
     * @param filter
     * @param {function} callback
     * @returns {*}
     */
    Model.allTrees=function (filter,callback) {
        if (typeof filter!=="object"){
            if (typeof filter === 'function'){
              callback = filter;
            }
            filter={};
        }
        if (typeof filter.where !=='object'){
            filter.where={};
        }
        filter.where.parent = idType.name === 'ObjectID' ? {exists: false} : {nlike:''};
        return pg(function(done) {
            Model.find(filter, function (err, rootNodes) {
                Promise.all(rootNodes.map(function (rootNode) {
                    return Model.asTree(rootNode, {withParent: true, order: filter.order});
                })).then(function (trees) {
                    done(null, trees);
                    return trees;
                }).catch(done);
            });
        }, callback, Promise);
    };
    /**
     * Create a tree from the database table
     * @param {object} parent
     * @param {object} options
     * @param {function} callback
     * @returns {*}
     */
    Model.asTree = function (parent, options, callback) {
        if (arguments.length === 3 && typeof arguments[1] === 'object') {
            callback = arguments[2];
        } else if (arguments.length === 3) {
            callback = arguments[2];
            options = arguments[1] = {};
        } else if (arguments.length === 2 && typeof arguments[1] === 'function') {
            callback = arguments[1];
        } else if (arguments.length === 1 || arguments.length === 0) {
            if (typeof parent === 'function'){
                callback = parent;
            }
            options = {};
        }
        if(!options.order){
            options.order='orderBy ASC';
        }

        return pg(function(done) {
            locateNode(parent)
                .then(function (Parent) {
                    Model.find({where: {ancestors: Parent[idName]}, order: options.order})
                        .then(function (docs) {
                            var tree = toTree(docs, options);
                            if (options.withParent) {
                                Parent.children = tree;
                                done(null, Parent);
                                return Parent;
                            }

                            done(null, tree);
                            return tree;
                        })
                        .catch(done);
                })
                .catch(done);
        }, callback, Promise);
    };

    Model.addNode = function (parent, node, callback) {
        return pg(function(done) {
            locateNode(parent)
                .then(function (Parent) {
                    return create(node, Parent).then(function (res) {
                        Model.emit('lbTree.add.success', res);
                        done(null, res);

                        return res;
                    });
                })
                .catch(done)
        }, callback, Promise);
    };

    Model.moveNode = function (node, newParent, callback) {
        /*
         * 1. locate the node
         * 2. locate the parent
         * 3. attach node to the parent
         * 4. re-arrange the ancestors for the node's children
         * */
        if (arguments.length === 3 && typeof arguments[1] === 'object') {
            callback = arguments[2];
        } else if (arguments.length === 3) {
            callback = arguments[2];
        } else if (arguments.length === 2 && typeof arguments[1] === 'function') {
            callback = arguments[1];
        }
        var tasks = {
            child: locateNode(node),
            parent: locateNode(newParent)
        };

        var moveEventData={};
        return pg(function(done) {
            return Promise.props(tasks)
                .then(function (results) {
                    if (results.child){
                        moveEventData.oldParent=results.child.parent;
                    }
                    moveEventData.node=results.child;
                    moveEventData.newParent=results.parent.getId();
                    Model.emit('lbTree.move.before', moveEventData);
                    if(results.parent){
                        results.child.parent = results.parent.getId();
                    }else{
                        delete results.child.parent;
                    }
                    results.child.ancestors=createAncestorsArray(results.parent);
                    return results;
                })
                .then(function (results) {
                    //find the children
                    return Model.find({where: {ancestors: results.child.getId()}})
                        .then(function (children) {
                            if (children.length === 0) {
                                return results;
                            }
                            Model.emit('lbTree.move.childrenFound', children);

                            var tasks = [];
                            lo.forEach(children, function (child) {
                                child.ancestors = results.child.ancestors;
                                child.ancestors.push(results.child.getId());
                                tasks.push(child.save());
                            });

                            return Promise.all(tasks)
                                .then(function () {
                                    Model.emit('lbTree.move.parent', results);
                                    return results;
                                });
                        });
                })
                .then(function (results) {
                    return results.child
                        .save()
                        .then(function (updatedItem) {
                            Model.emit('lbTree.move.newPath', updatedItem);
                            Model.emit('lbTree.move.after', moveEventData);
                            done(null, updatedItem);
                        });
                })
                .catch(done);
        }, callback, Promise);
    };

    Model.deleteNode = function (node, options, callback) {
        if (arguments.length === 3 && typeof arguments[1] === 'object') {
            callback = arguments[2];
        } else if (arguments.length === 3) {
            callback = arguments[2];
            options = arguments[1] = {};
        } else if (arguments.length === 2 && typeof arguments[1] === 'function') {
            callback = arguments[1];
        }
        options = lo.merge({withChildren: false}, options);
        /*
         Things to consider :
         1. Before deleting the node, we need to orphan any children it might have
         2. If the option deleteWithChildren is provided then delete everything
         */
        return pg(function(done){
            locateNode(node)
                .then(function (nodeToDelete) {
                    var myId = lo.invoke(nodeToDelete, 'getId');
                    //find all children that belong to this node
                    Model.find({where: {ancestors: myId}})
                        .then(orphanChildren)
                        .then(deleteNode.bind(null, myId))
                        .then(function () {
                            Model.emit('lbTree.delete', {success : true});
                            done(null, true);

                            return true;
                        })
                      .catch(done);
                })
                .catch(function (err) {
                    Model.emit('lbTree.delete', {success : false});
                    done(err);
                });
        }, callback, Promise);

        function orphanChildren(children) {
            var tasks = [];

            lo.each(children, function(child) {
                tasks.push((function (child) {
                    if (options.withChildren) {
                        return Model.destroyById(child.getId());
                    }

                    child.ancestors = [];//orphan it
                    child.parent = null;
                    return child.save();
                })(child));
            });

            return Promise.all(tasks);
        }
    };

    /**
     * Grab a tree as an array (maybe coming from a frontend) and format it correctly
     * Assume (and hope) that the tree is NOT a loopback model
     * @param {array} tree
     * @param {object} options
     * @param {function} callback
     */
    Model.saveJsonTree = function (tree, options, callback) {
        if (arguments.length === 3 && typeof arguments[1] === 'object') {
            callback = arguments[2];
        } else if (arguments.length === 3) {
            callback = arguments[2];
            options = arguments[1] = {};
        } else if (arguments.length === 2 && typeof arguments[1] === 'function') {
            callback = arguments[1];
        } else if (arguments.length === 1 || arguments.length === 0) {
            options = {};
        }
        //flatten the tree
        if (!options) {
            options = {};
        }
        var flat = walk(tree),
            tasks = [],
            _this = this;

        return pg(function(done) {
            if (options.prependRoot) {
                return locateNode(options.prependRoot)
                     .then(function (rootNode) {
                        options.prependRoot = rootNode;
                        process(flat,options).then(function (result) {
                            done(null,result);
                        }).catch(done);
                    })
                    .catch(done);
            }
            process(flat,options).then(function (result) {
                done(null,result);
            }).catch(done);
        }, callback, Promise);

        function process(flat, options) {
            lo.each(flat, function(node) {
                //now clean it up a bit
                delete node.children;
                //save it
                tasks.push(saveNode(node, options));
            });

            return Promise.all(tasks).then(function () {
                return flat;
            })
                .catch(function (err) {
                    console.log(err)
                });
        }

        function walk(nodes, level, parent, flat) {
            if (!flat) {
                flat = [];
            }

            if (!level) {
                level = 0;
            }

            if (typeof parent === 'undefined') {
                parent = null;
            }

            lo.each(nodes, function(node, i) {
                node.ancestors = [];

                if (parent) {
                    var parentId = parent[idName];
                    node.parent = parentId;

                    lo.each(parent.ancestors, function(ancestor) {
                        node.ancestors.push(ancestor);
                    });
                    node.ancestors.push(parentId);
                    node.orderBy = i;
                }

                flat.push(node);

                if (node.children) {
                    walk(node.children, level + 1, node, flat);
                }
            });

            return flat;
        }

        function saveNode(node, options) {
            var nodeId = node[idName];
            if (!nodeId) {
                return Promise.reject('no id');
            }

            //first find the actual item in the DB
            return new Promise(function(resolve, reject) {
                Model.findById(nodeId)
                    .then(function (item) {
                          item.ancestors = [];
                          //use this when your tree only came in a partial form
                          if (options.prependRoot) {
                              lo.each(options.prependRoot.ancestors, function(rootAncestor) {
                                  item.ancestors.push(rootAncestor);
                              });
                              item.ancestors.push(options.prependRoot[idName]);
                          }

                          item.parent = (_this.toObjectID) ? _this.toObjectID(node.parent) : node.parent;
                          lo.each(node.ancestors, function (ancestor) {
                              item.ancestors.push((_this.toObjectID) ?
                                _this.toObjectID(ancestor) : ancestor);
                          });

                          item.orderBy = node.orderBy;


                          return item.save()
                            .then(function (result) {
                                Model.emit('lbTree.saveJsTree', result);
                                resolve(result);
                                return result;
                            })
                            .catch(reject);
                    })
                    .catch(reject)
            });
        }
    };

    function locateNode(node) {
        var where = {};
        if (typeof node === 'string' || node instanceof DS.ObjectID) {//Hoping on an id
            where[idName] = node;
        }
        else if (typeof node === 'undefined' || (typeof node === 'object' && lo.isEmpty(node))) {
            return Promise.resolve({});
        }
        else if (node instanceof Model) {//this is the actual node model
            return Promise.resolve(node);
        } else if (typeof node === 'object' && typeof node[idName] === 'undefined') {//this is a query
            where = node;
        }
        else if (typeof node === 'object' && typeof node[idName] !== 'undefined' && typeof node[idName] === 'string') {//this is a query by ID
            where = node;
        }

        return Model.findOne({where: where});
    }

    function create(node, Parent) {
        node = new Model(node);
        node.parentObject(Parent);
        node.ancestors = createAncestorsArray(Parent);
        return node.save();
    }

    function toTree(docs, options) {
        if (typeof options === 'undefined') {
            options = {};
        }

        var tree = lo.clone(docs),
            newTree = [],
            treeDepth = [];

        lo.each(tree, function(node) {
            if (!node.ancestors) {
                node.depth = 0;
                node.ancestors = [];
                return;
            }

            if (!node.children){
                node.children = [];
            }

            node.depth = node.ancestors.length;
            treeDepth.push(node.depth);
        });

        //this is not a valid tree
        if (treeDepth.length === 0) {
            return docs;
        }

        tree = lo.sortBy(tree, 'depth');

        var maxDepth = lo.max(treeDepth),
            minDepth = lo.min(treeDepth);

        for (var i = 0; (maxDepth) >= i; i++) {
            var found = lo.filter(tree, {depth: i});

            if ((i) === minDepth) {
                lo.each(found, function(node) {
                  node.children = [];
                  newTree.push(node);
                });
                continue;
            }

            lo.each(found, function(childNode) {
                var itemCriteria = {};
                itemCriteria[idName] = childNode.parent;
                var item = lo.find(tree, itemCriteria);
                //format this item, add - remove - change properties
                if (typeof options.formatter === 'function') {
                    item = options.formatter(item);
                }

                if (item) {
                    if (!item.children) {
                        item.children = [];
                    }
                    item.children.push(childNode);
                    item.children = lo.sortBy(item.children, 'orderBy');
                }
            });
        }

        return (options.returnEverything) ? {tree: newTree, flat: tree} : newTree;
    }

    function deleteNode(nodeID) {
        return Model.destroyById(nodeID);
    }

    function createAncestorsArray(Parent) {
        var ancestors = [];
        //add existing ancestors first

        if (Parent.ancestors) {
            lo.each(Parent.ancestors, function(ancestorId) {
                ancestors.push(ancestorId);
            });
        }
        if(Parent[idName]){
            ancestors.push(Parent[idName]);
        }
        return ancestors
    }

    /*    Model.observe('after delete', function event(ctx, next) {
     //orphan children cause the parent is gone
     //add ancestors + parent if not there
     if (ctx.instance) { //update
     if (ctx.instance.id) {

     }
     }
     //create
     });*/
    Model.remoteMethod('allTrees', {
        accepts: [
            {arg: 'filter', type: 'object', description:
                'Filter defining fields, where, include, order, offset, and limit on the roots node'},
        ],
        returns: {
            arg: 'result',
            type: 'object',
            root: true
        },
        http: {
            path: '/allTrees',
            verb: 'get'
        },
        description: "Returns all the trees for this model"
    });
    Model.remoteMethod('asTree', {
        accepts: [{
            arg: 'parent',
            type: 'any',
            http: {
                source: 'query'
            }
        },
            {
                arg: 'options',
                type: 'object',
                required: false,
                http: {
                    source: 'query'
                }
            }],
        returns: {
            arg: 'result',
            type: 'object',
            root: true
        },
        http: {
            path: '/asTree',
            verb: 'get'
        },
        description: "Returns a tree for this model"
    });

    Model.remoteMethod('addNode', {
        accepts: [{
            arg: 'parent',
            type: 'any',
            required: true,
            http: {
                source: 'form'
            }
        },
            {
                arg: 'node',
                type: 'object',
                required: true,
                http: {
                    source: 'form'
                }
            }],
        returns: {
            arg: 'result',
            type: 'string',
            root: true
        },
        http: {
            path: '/addNode',
            verb: 'put'
        },
        description: "Add a node to the tree model"
    });

    Model.remoteMethod('moveNode', {
        accepts: [{
            arg: 'node',
            type: 'any',
            required: true,
            http: {
                source: 'form'
            }
        },
            {
                arg: 'parent',
                type: 'any',
                required: false,
                http: {
                    source: 'form'
                }
            }],
        returns: {
            arg: 'result',
            type: 'string',
            root: true
        },
        http: {
            path: '/moveNode',
            verb: 'post'
        },
        description: "Move a tree node"
    });

    Model.remoteMethod('deleteNode', {
        accepts: [{
            arg: 'node',
            type: 'any',
            required: true,
            http: {
                source: 'form'
            }
        },
            {
                arg: 'options',
                type: 'object',
                required: false,
                http: {
                    source: 'form'
                }
            }],
        returns: {
            arg: 'result',
            type: 'string',
            root: true
        },
        http: {
            path: '/deleteNode',
            verb: 'delete'
        },
        description: "Delete a tree node"
    });

    Model.remoteMethod('saveJsonTree', {
        accepts: [{
            arg: 'tree',
            type: 'any',
            required: true,
            http: {
                source: 'form'
            }
        },
            {
                arg: 'options',
                type: 'object',
                required: false,
                http: {
                    source: 'form'
                }
            }],
        returns: {
            arg: 'result',
            type: 'string',
            root: true
        },
        http: {
            path: '/saveJsonTree',
            verb: 'post'
        },
        description: "Save a json tree"
    });
}

module.exports = function mixin(app) {
    app.loopback.modelBuilder.mixins.define('Tree', Tree);
};
