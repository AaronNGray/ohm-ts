import {abstract} from './common.js';
import * as pexprs from './pexprs-main.js';
import PExpr from './pexprs-main.js';

// --------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------

/*
  e1.toString() === e2.toString() ==> e1 and e2 are semantically equivalent.
  Note that this is not an iff (<==>): e.g.,
  (~"b" "a").toString() !== ("a").toString(), even though
  ~"b" "a" and "a" are interchangeable in any grammar,
  both in terms of the languages they accept and their arities.
*/
PExpr.prototype.toString = abstract('toString');

pexprs.any.toString = function ():string {
  return 'any';
};

pexprs.end.toString = function ():string {
  return 'end';
};

pexprs.Terminal.prototype.toString = function ():string {
  return JSON.stringify(this.obj);
};

pexprs.Range.prototype.toString = function ():string {
  return JSON.stringify(this.from) + '..' + JSON.stringify(this.to);
};

pexprs.Param.prototype.toString = function ():string {
  return '$' + this.index;
};

pexprs.Lex.prototype.toString = function ():string {
  return '#(' + this.expr.toString() + ')';
};

pexprs.Alt.prototype.toString = function ():string {
  return this.terms.length === 1
    ? this.terms[0].toString()
    : '(' + this.terms.map(term => term.toString()).join(' | ') + ')';
};

pexprs.Seq.prototype.toString = function ():string {
  return this.factors.length === 1
    ? this.factors[0].toString()
    : '(' + this.factors.map(factor => factor.toString()).join(' ') + ')';
};

pexprs.Iter.prototype.toString = function ():string {
  return this.expr + this.operator;
};

pexprs.Not.prototype.toString = function ():string {
  return '~' + this.expr;
};

pexprs.Lookahead.prototype.toString = function ():string {
  return '&' + this.expr;
};

pexprs.Apply.prototype.toString = function ():string {
  if (this.args.length > 0) {
    const ps = this.args.map(arg => arg.toString());
    return this.ruleName + '<' + ps.join(',') + '>';
  } else {
    return this.ruleName;
  }
};

pexprs.UnicodeChar.prototype.toString = function ():string {
  return '\\p{' + this.categoryOrProp + '}';
};
