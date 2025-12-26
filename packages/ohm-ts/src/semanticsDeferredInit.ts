import operationsAndAttributesGrammar from '../dist/operations-and-attributes.js';
import Grammar from './Grammar.js';
import Semantics from './Semantics.js';
import type Formals from './pexprs-main.js';
import * as pexprs from './pexprs.js';

initBuiltInSemantics(Grammar.BuiltInRules);
initPrototypeParser(operationsAndAttributesGrammar); // requires BuiltInSemantics

function initBuiltInSemantics(builtInRules) {
}

function initPrototypeParser(grammar:Grammar) {
  Semantics.prototypeGrammarSemantics = grammar.createSemantics().addOperation('parse', {
    AttributeSignature(name) {
      return {
        name: name.parse(),
        formals: [],
      };
    },
    OperationSignature(name, optFormals?:any) {   // ??? any ???
      return {
        name: name.parse(),
        formals: optFormals!.children.map(c => c.parse())[0] || [],
      };
    },
    Formals(oparen, fs, cparen) {
      return fs.asIteration().children.map(c => c.parse());
    },
    name(first, rest) {
      return this.sourceString;
    },
  });
  Semantics.prototypeGrammar = grammar;
}
