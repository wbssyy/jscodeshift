/*
 *  Copyright (c) 2015-present, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 *
 */

'use strict';

const recast = require('recast');

const builders = recast.types.builders;
const types = recast.types.namedTypes;

function splice(arr, element, replacement) {
  arr.splice.apply(arr, [arr.indexOf(element), 1].concat(replacement));
}

function cleanLocation(node) {
  delete node.start;
  delete node.end;
  delete node.loc;
  return node;
}

function ensureStatement(node) {
  return types.Statement.check(node) ?
    // Removing the location information seems to ensure that the node is
    // correctly reprinted with a trailing semicolon
    cleanLocation(node) :
    builders.expressionStatement(node);
}

function getVistor(varName, nodes) {
  let counter = 0;
  return {
    visitIdentifier: function(path) {
      this.traverse(path);
      const node = path.node;
      const parent = path.parent.node;

      // If this identifier is not one of our generated ones, do nothing
      if (node.name !== varName) {
        return;
      }

      let replacement = nodes[counter++];

      // If the replacement is an array, we need to explode the nodes in context
      if (Array.isArray(replacement)) {

        if (types.Function.check(parent) &&
            parent.params.indexOf(node) > -1) {
          // Function parameters: function foo(${bar}) {}
          splice(parent.params, node, replacement);
        } else if (types.VariableDeclarator.check(parent)) {
          // Variable declarations: var foo = ${bar}, baz = 42;
          splice(
            path.parent.parent.node.declarations,
            parent,
            replacement
          );
        } else if (types.ArrayExpression.check(parent)) {
          // Arrays: var foo = [${bar}, baz];
          splice(parent.elements, node, replacement);
        } else if (types.Property.check(parent) && parent.shorthand) {
          // Objects: var foo = {${bar}, baz: 42};
          splice(
            path.parent.parent.node.properties,
            parent,
            replacement
          );
        } else if (types.CallExpression.check(parent) &&
            parent.arguments.indexOf(node) > -1) {
          // Function call arguments: foo(${bar}, baz)
          splice(parent.arguments, node, replacement);
        } else if (types.ExpressionStatement.check(parent)) {
          // Generic sequence of statements: { ${foo}; bar; }
          path.parent.replace.apply(
            path.parent,
            replacement.map(ensureStatement)
          );
        } else {
          // Every else, let recast take care of it
          path.replace.apply(path, replacement);
        }
      } else if (types.ExpressionStatement.check(parent)) {
        path.parent.replace(ensureStatement(replacement));
      } else {
        path.replace(replacement);
      }
    }
  };
}

function replaceNodes(src, varName, nodes, parser) {
  const ast = recast.parse(src, {parser});
  recast.visit(ast, getVistor(varName, nodes));
  return ast;
}

function getRandomVarName() {
  return `$jscodeshift${Math.floor(Math.random() * 1000)}$`;
}


module.exports = function withParser(parser) {
  function statements(template/*, ...nodes*/) {
    template = Array.from(template);
    let varName = getRandomVarName();
    let src = template.join(varName);
    return replaceNodes(
      src,
      varName,
      Array.from(arguments).slice(1),
      parser
    ).program.body;
  }

  function statement(/*template, ...nodes*/) {
    return statements.apply(null, arguments)[0];
  }

  function expression(template/*, ...nodes*/) {
    // wrap code in `(...)` to force evaluation as expression
    template = Array.from(template);
    if (template.length > 1) {
      template[0] = '(' + template[0];
      template[template.length - 1] += ')';
    } else if (template.length === 0) {
      template[0] = '(' + template[0] + ')';
    }

    return statement.apply(
      null,
      [template].concat(Array.from(arguments).slice(1))
    ).expression;
  }

  return {statements, statement, expression};
}
