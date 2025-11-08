import {UnicodeBinaryProperties, UnicodeCategories} from './unicode.js';
import * as common from './common.js';
import Grammar from './Grammar.js';
import Interval from './Interval.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

// General stuff

export default class PExpr {
  constructor() {
    if (this.constructor === PExpr) {
      throw new Error("PExpr cannot be instantiated -- it's abstract");
    }
  }

  // Set the `source` property to the interval containing the source for this expression.
  withSource(interval:Interval) {
    if (interval) {
      this.source = interval.trimmed();
    }
    return this;
  }
}

// Any

export const any = Object.create(PExpr.prototype);

// End

export const end = Object.create(PExpr.prototype);

// Terminals

export class Terminal extends PExpr {
  constructor(obj:any) {
    super();
    this.obj = obj;
  }
  obj:any; // ???
}

// Ranges

export class Range extends PExpr {
  constructor(from:number, to:number) {
    super();
    this.from = from;
    this.to = to;
    // If either `from` or `to` is made up of multiple code units, then
    // the range should consume a full code point, not a single code unit.
    this.matchCodePoint = from.length > 1 || to.length > 1;
  }
  to:number;
  from:number;
  matchCodePoint:boolean; // ???
}

// Parameters

export class Param extends PExpr {
  constructor(index:number) {
    super();
    this.index = index;
  }
  index:number; // ???
}

// Alternation

export class Alt extends PExpr {
  constructor(terms:PExpr[]) {
    super();
    this.terms = terms;
  }
  terms:PExpr[];
}

// Extend is an implementation detail of rule extension

export class Extend extends Alt {
  constructor(superGrammar:Grammar, name:string, body) {
    const origBody = superGrammar.rules[name].body;
    super([body, origBody]);

    this.superGrammar = superGrammar;
    this.name = name;
    this.body = body;
  }
  superGrammar:Grammar;
  name:string;
  body;
}

// Splice is an implementation detail of rule overriding with the `...` operator.
export class Splice extends Alt {
  constructor(superGrammar:Grammar, ruleName:string, beforeTerms, afterTerms) {
    const origBody = superGrammar.rules[ruleName].body;
    super([...beforeTerms, origBody, ...afterTerms]);

    this.superGrammar = superGrammar;
    this.ruleName = ruleName;
    this.expansionPos = beforeTerms.length;
  }
}

// Sequences

export class Seq extends PExpr {
  constructor(factors:PExpr[]) {
    super();
    this.factors = factors;
  }
  factors:PExpr[];
}

// Iterators and optionals

export class Iter extends PExpr {
  constructor(expr:PExpr) {
    super();
    this.expr = expr;
  }
  expr:PExpr;
}

export class Star extends Iter {}
export class Plus extends Iter {}
export class Opt extends Iter {}

Star.prototype.operator = '*';
Plus.prototype.operator = '+';
Opt.prototype.operator = '?';

Star.prototype.minNumMatches = 0;
Plus.prototype.minNumMatches = 1;
Opt.prototype.minNumMatches = 0;

Star.prototype.maxNumMatches = Number.POSITIVE_INFINITY;
Plus.prototype.maxNumMatches = Number.POSITIVE_INFINITY;
Opt.prototype.maxNumMatches = 1;

// Predicates

export class Not extends PExpr {
  constructor(expr) {
    super();
    this.expr = expr;
  }
}

export class Lookahead extends PExpr {
  constructor(expr) {
    super();
    this.expr = expr;
  }
}

// "Lexification"

export class Lex extends PExpr {
  constructor(expr) {
    super();
    this.expr = expr;
  }
}

// Rule application

export class Apply extends PExpr {
  constructor(ruleName:string, args = []) {
    super();
    this.ruleName = ruleName;
    this.args = args;
  }
  ruleName:string;

  isSyntactic() {
    return common.isSyntactic(this.ruleName);
  }

  // This method just caches the result of `this.toString()` in a non-enumerable property.
  toMemoKey() {
    if (!this._memoKey) {
      Object.defineProperty(this, '_memoKey', {value: this.toString()});
    }
    return this._memoKey;
  }
}

// Unicode character

export class UnicodeChar extends PExpr {
  constructor(categoryOrProp) {
    super();
    this.categoryOrProp = categoryOrProp;
    if (categoryOrProp in UnicodeCategories) {
      this.pattern = UnicodeCategories[categoryOrProp];
    } else if (categoryOrProp in UnicodeBinaryProperties) {
      this.pattern = UnicodeBinaryProperties[categoryOrProp];
    } else {
      throw new Error(
        `Invalid Unicode category or property name: ${JSON.stringify(categoryOrProp)}`
      );
    }
  }
}
