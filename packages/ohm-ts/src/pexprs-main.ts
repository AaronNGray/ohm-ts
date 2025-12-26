import {UnicodeBinaryProperties, UnicodeCategories} from './unicode.js';
import * as common from './common.js';
import {checkNotNull, copyWithoutDuplicates} from './common.js';
import {isSyntactic} from './common.js';
import * as errors from './errors.js';
import Grammar from './Grammar.js';
import * as pexprs from './pexprs-main.js';
import Node, {TerminalNode, NonterminalNode, IterationNode} from './nodes.js';
import State from './MatchState.js';
import MatchState from './MatchState.js';
import {MemoRec} from './PosInfo.js';
import Interval from './Interval.js';
import Failure from './Failure.js';
import Trace from './Trace.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

export function getMetaInfo(expr:PExpr, grammarInterval:Interval) {
  const metaInfo:{ sourceInterval?:number[] } = {};
  if (expr.source && grammarInterval) {
    const adjusted = expr.source.relativeTo(grammarInterval);
    metaInfo.sourceInterval = [adjusted.startIdx, adjusted.endIdx];
  }
  return metaInfo;
}

function isRestrictedJSIdentifier(str:string):boolean {
  return /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(str);
}

function resolveDuplicatedNames(argumentNameList:string[]):void {
  // `count` is used to record the number of times each argument name occurs in the list,
  // this is useful for checking duplicated argument name. It maps argument names to ints.
  const count = Object.create(null);
  argumentNameList.forEach((argName:string) => {
    count[argName] = (count[argName] || 0) + 1;
  });

  // Append subscripts ('_1', '_2', ...) to duplicate argument names.
  Object.keys(count).forEach((dupArgName:string) => {
    if (count[dupArgName] <= 1) {
      return;
    }

    // This name shows up more than once, so add subscripts.
    let subscript = 1;
    argumentNameList.forEach((argName:string, idx:number) => {
      if (argName === dupArgName) {
        argumentNameList[idx] = argName + '_' + subscript++;
      }
    });
  });
}

/*
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[]

  Returns a list of strings that will be used as the default argument names for its receiver
  (a pexpr) in a semantic action. This is used exclusively by the Semantics Editor.

  `firstArgIndex` is the 1-based index of the first argument name that will be generated for this
  pexpr. It enables us to name arguments positionally, e.g., if the second argument is a
  non-alphanumeric terminal like "+", it will be named '$2'.

  `noDupCheck` is true if the caller of `toArgumentNameList` is not a top level caller. It enables
  us to avoid nested duplication subscripts appending, e.g., '_1_1', '_1_2', by only checking
  duplicates at the top level.

  Here is a more elaborate example that illustrates how this method works:
  `(a "+" b).toArgumentNameList(1)` evaluates to `['a', '$2', 'b']` with the following recursive
  calls:

    (a).toArgumentNameList(1) -> ['a'],
    ("+").toArgumentNameList(2) -> ['$2'],
    (b).toArgumentNameList(3) -> ['b']

  Notes:
  * This method must only be called on well-formed expressions, e.g., the receiver must
    not have any Alt sub-expressions with inconsistent arities.
  * e.getArity() === e.toArgumentNameList(1).length
*/

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

// General stuff

export type Formals = string[];
export type Recipe = any[];   // TODO: move to makeRecipe.ts rename to Recipe.ts 

export default abstract class PExpr {
  constructor() {
    if (this.constructor === PExpr) {
      throw new Error("PExpr cannot be instantiated -- it's abstract");
    }
  }

  source?:Interval;
  static lexifyCount:number;

  // Set the `source` property to the interval containing the source for this expression.
  withSource(interval:Interval) {
    if (interval) {
      this.source = interval.trimmed();
    }
    return this;
  }

  abstract allowsSkippingPrecedingSpace():boolean;
  abstract assertChoicesHaveUniformArity(ruleName:string):void;
  assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {
    PExpr.lexifyCount = 0;
    this._assertAllApplicationsAreValid(ruleName, grammar);
  }
  abstract _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void;
  abstract assertIteratedExprsAreNotNullable(grammar:Grammar):void;
  abstract eval(state:MatchState):boolean;
  abstract getArity():number;
  introduceParams(formals:Formals):PExpr { return this; }
  isNullable(grammar:Grammar) {
    return this._isNullable(grammar, Object.create(null));
  }
  abstract _isNullable(grammar:Grammar, memo:any):boolean;
  abstract outputRecipe(formals:Formals, grammarInterval:Interval):Recipe;
  abstract substituteParams(actuals:number[]):PExpr;
  abstract toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[];
  abstract toDisplayString():string
  abstract toFailure(grammar:Grammar):Failure;
  abstract toString();
}

// Any

export class Any extends PExpr {
  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertChoicesHaveUniformArity(ruleName:string) {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    const cp = inputStream.nextCodePoint();
    if (cp !== undefined) {
      state.pushBinding(new TerminalNode(String.fromCodePoint(cp).length), origPos);
      return true;
    } else {
      state.processFailure(origPos, this);
      return false;
    }
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return false;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['any', getMetaInfo(this, grammarInterval)];
  }
  substituteParams(actuals:number[]):PExpr {
    return this;
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return ['any'];
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    return new Failure(this, 'any object', 'description');
  }
  toString() {
    return 'any';
  }
}
export const any = new Any();

// End

export class End extends PExpr {
  constructor() {
    super();
  }
  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  assertChoicesHaveUniformArity(ruleName:string) {}
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    if (inputStream.atEnd()) {
      state.pushBinding(new TerminalNode(0), origPos);
      return true;
    } else {
      state.processFailure(origPos, this);
      return false;
    }
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return true;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['end', getMetaInfo(this, grammarInterval)];
  }
  substituteParams(actuals:number[]):PExpr {
    return this;
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return ['end'];
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    return new Failure(this, 'end of input', 'description');
  }
  toString() {
    return 'end';
  }
}
export const end = new End();

// Terminals

export class Terminal extends PExpr {
  constructor(obj:string|number|Param) {
    super();
    this.obj = obj;
  }
  obj:string|number|Param;

  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  assertChoicesHaveUniformArity(ruleName:string) {}
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    if (typeof this.obj === 'string') {
      // This is an over-simplification: it's only correct if the input is a string. If it's an array
      // or an object, then the empty string parsing expression is not nullable.
      return this.obj === '';
    } else {
      return false;
    }
  }
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    if (!inputStream.matchString(this.obj as string)) { // ???
      state.processFailure(origPos, this);
      return false;
    } else {
      state.pushBinding(new TerminalNode(this.obj as number), origPos); // ???
      return true;
    }
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['terminal', getMetaInfo(this, grammarInterval), this.obj];
  }
  substituteParams(actuals:number[]):PExpr {
    return this;
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    if (typeof this.obj === 'string' && /^[_a-zA-Z0-9]+$/.test(this.obj)) {
      // If this terminal is a valid suffix for a JS identifier, just prepend it with '_'
      return ['_' + this.obj];
    } else {
      // Otherwise, name it positionally.
      return ['$' + firstArgIndex];
    }
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    return new Failure(this, this.obj, 'string');
  }
  toString() {
    return JSON.stringify(this.obj);
  }
}

// Ranges

export class Range extends PExpr {
  constructor(from:string, to:string) {
    super();
    this.from = from;
    this.to = to;
    // If either `from` or `to` is made up of multiple code units, then
    // the range should consume a full code point, not a single code unit.
    this.matchCodePoint = from.length > 1 || to.length > 1;
  }
  to:string;
  from:string;
  matchCodePoint:boolean; // ???

  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertChoicesHaveUniformArity(ruleName:string) {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;

    // A range can operate in one of two modes: matching a single, 16-bit _code unit_,
    // or matching a _code point_. (Code points over 0xFFFF take up two 16-bit code units.)
    const cp = this.matchCodePoint ? inputStream.nextCodePoint() : inputStream.nextCharCode();

    // Always compare by code point value to get the correct result in all scenarios.
    // Note that for strings of length 1, codePointAt(0) and charPointAt(0) are equivalent.
    if (cp !== undefined && this.from.codePointAt(0) <= cp && cp <= this.to.codePointAt(0)) {
      state.pushBinding(new TerminalNode(String.fromCodePoint(cp).length), origPos);
      return true;
    } else {
      state.processFailure(origPos, this);
      return false;
    }
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return false;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['range', getMetaInfo(this, grammarInterval), this.from, this.to];
  }
  substituteParams(actuals:number[]):PExpr {
    return this;
  }
  toArgumentNameList = function (firstArgIndex:number, noDupCheck:boolean):string[] {
    let argName = this.from + '_to_' + this.to;
    // If the `argName` is not valid then try to prepend a `_`.
    if (!isRestrictedJSIdentifier(argName)) {
      argName = '_' + argName;
    }
    // If the `argName` still not valid after prepending a `_`, then name it positionally.
    if (!isRestrictedJSIdentifier(argName)) {
      argName = '$' + firstArgIndex;
    }
    return [argName];
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    // TODO: come up with something better
    return new Failure(this, JSON.stringify(this.from) + '..' + JSON.stringify(this.to), 'code');
  }
  toString() {
    return JSON.stringify(this.from) + '..' + JSON.stringify(this.to);
  }
}

// Parameters

export class Param extends PExpr {
  constructor(index:number) {
    super();
    this.index = index;
  }
  index:number; // ???

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  assertChoicesHaveUniformArity(ruleName:string) {}
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  eval(state:MatchState):boolean {
    return state.eval(state.currentApplication().args[this.index]);
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return false;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['param', getMetaInfo(this, grammarInterval), this.index];
  }
  substituteParams(actuals:number[]):this {     // !!! should we be returning this rather than PExpr's or Param ???
    return checkNotNull(actuals[this.index]);
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return ['param' + this.index];
  }
  toDisplayString():string {
    return this.toString();
  }
  // toFailure() missing !
  toFailure(grammar:Grammar):Failure {
    // TODO: come up with something better
    return new Failure(this, JSON.stringify(this), 'param');
  }
  toString() {
    return '$' + this.index;
  }
}

// Alternation

export class Alt extends PExpr {
  constructor(terms:PExpr[]) {
    super();
    this.terms = terms;
  }
  terms:PExpr[];

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  assertChoicesHaveUniformArity(ruleName:string) {
    if (this.terms.length === 0) {
      return;
    }
    const arity = this.terms[0].getArity();
    for (let idx = 0; idx < this.terms.length; idx++) {
      const term = this.terms[idx];
      term.assertChoicesHaveUniformArity(ruleName);   // ??? ruleName ???
      const otherArity = term.getArity();
      if (arity !== otherArity) {
        throw errors.inconsistentArity(ruleName, arity, otherArity, term);
      }
    }
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar) {
    for (let idx = 0; idx < this.terms.length; idx++) {
      this.terms[idx]._assertAllApplicationsAreValid(ruleName, grammar);
    }
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    for (let idx = 0; idx < this.terms.length; idx++) {
      this.terms[idx].assertIteratedExprsAreNotNullable(grammar);
    }
  }   
  eval(state) {
    for (let idx = 0; idx < this.terms.length; idx++) {
      if (state.eval(this.terms[idx])) {
        return true;
      }
    }
    return false;
  }
  getArity():number {
    // This is ok b/c all terms must have the same arity -- this property is
    // checked by the Grammar constructor.
    return this.terms.length === 0 ? 0 : this.terms[0].getArity();
  }
  introduceParams(formals:Formals):PExpr {
    this.terms.forEach((term:PExpr, idx:number, terms:PExpr[]) => {
      terms[idx] = term.introduceParams(formals);
    });
    return this;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return this.terms.length === 0 || this.terms.some(term => term._isNullable(grammar, memo));
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      'alt',
      getMetaInfo(this, grammarInterval),
      this.terms.map((term:PExpr) => term.outputRecipe(formals, grammarInterval))
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new pexprs.Alt(this.terms.map(term => term.substituteParams(actuals)));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    // `termArgNameLists` is an array of arrays where each row is the
    // argument name list that corresponds to a term in this alternation.
    const termArgNameLists = this.terms.map((term:PExpr) =>
      term.toArgumentNameList(firstArgIndex, true)
    );

    const argumentNameList = [];
    const numArgs = termArgNameLists[0].length;
    for (let colIdx = 0; colIdx < numArgs; colIdx++) {
      const col = [];
      for (let rowIdx = 0; rowIdx < this.terms.length; rowIdx++) {
        col.push(termArgNameLists[rowIdx][colIdx]);
      }
      const uniqueNames = copyWithoutDuplicates(col);
      argumentNameList.push(uniqueNames.join('_or_'));
    }

    if (!noDupCheck) {
      resolveDuplicatedNames(argumentNameList);
    }
    return argumentNameList;
  }
  toDisplayString():string {
    if (this.source) {
      return this.source.trimmed().contents;
    }
    return '[' + this.constructor.name + ']';
  }
  toFailure(grammar:Grammar):Failure {
    const fs = this.terms.map(t => t.toFailure(grammar));
    const description = '(' + fs.join(' or ') + ')';
    return new Failure(this, description, 'description');
  }
  toString():string {
    return this.terms.length === 1
      ? this.terms[0].toString()
      : '(' + this.terms.map(term => term.toString()).join(' | ') + ')';
  }
}

// Extend is an implementation detail of rule extension

export class Extend extends Alt {
  constructor(superGrammar:Grammar, name:string, body:PExpr) {
    const origBody = superGrammar.rules[name].body;
    super([body, origBody]);

    this.superGrammar = superGrammar;
    this.name = name;
    this.body = body;
  }
  superGrammar:Grammar;
  name:string;
  body:PExpr;

  assertChoicesHaveUniformArity(ruleName:string) {
    // Extend is a special case of Alt that's guaranteed to have exactly two
    // cases: [extensions, origBody].
    const actualArity = this.terms[0].getArity();
    const expectedArity = this.terms[1].getArity();
    if (actualArity !== expectedArity) {
      throw errors.inconsistentArity(ruleName, expectedArity, actualArity, this.terms[0]);
    }
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    const extension = this.terms[0]; // [extension, original]
    return extension.outputRecipe(formals, grammarInterval);
  }
}

// Splice is an implementation detail of rule overriding with the `...` operator.
export class Splice extends Alt {
  constructor(superGrammar:Grammar, ruleName:string, beforeTerms:PExpr[], afterTerms:PExpr[]) {
    const origBody = superGrammar.rules[ruleName].body;
    super([...beforeTerms, origBody, ...afterTerms]);

    this.superGrammar = superGrammar;
    this.ruleName = ruleName;
    this.expansionPos = beforeTerms.length;
  }
  superGrammar:Grammar;
  ruleName:string;
  expansionPos:number;

  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    const beforeTerms = this.terms.slice(0, this.expansionPos);
    const afterTerms = this.terms.slice(this.expansionPos + 1);
    return [
      'splice',
      getMetaInfo(this, grammarInterval),
      beforeTerms.map(term => term.outputRecipe(formals, grammarInterval)),
      afterTerms.map(term => term.outputRecipe(formals, grammarInterval)),
    ];
  }  
}

// Sequences

export class Seq extends PExpr {
  constructor(factors:PExpr[]) {
    super();
    this.factors = factors;
  }
  factors:PExpr[];

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  assertChoicesHaveUniformArity(ruleName:string) {
    for (let idx = 0; idx < this.factors.length; idx++) {
      this.factors[idx].assertChoicesHaveUniformArity(ruleName);
    }
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar) {
    for (let idx = 0; idx < this.factors.length; idx++) {
      this.factors[idx]._assertAllApplicationsAreValid(ruleName, grammar);
    }
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    for (let idx = 0; idx < this.factors.length; idx++) {
      this.factors[idx].assertIteratedExprsAreNotNullable(grammar);
    }
  }
  eval(state:MatchState):boolean {
    for (let idx = 0; idx < this.factors.length; idx++) {
      const factor = this.factors[idx];
      if (!state.eval(factor)) {
        return false;
      }
    }
    return true;
  }
  getArity():number {
    let arity = 0;
    for (let idx = 0; idx < this.factors.length; idx++) {
      arity += this.factors[idx].getArity();
    }
    return arity;
  }
  introduceParams(formals:Formals):PExpr {
    this.factors.forEach((factor:PExpr, idx:number, factors:PExpr[]) => {
      factors[idx] = factor.introduceParams(formals);
    });
    return this;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return this.factors.every(factor => factor._isNullable(grammar, memo));
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      'seq',
      getMetaInfo(this, grammarInterval),
      ...this.factors.map(factor => factor.outputRecipe(formals, grammarInterval))
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new Seq(this.factors.map(factor => factor.substituteParams(actuals)));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    // Generate the argument name list, without worrying about duplicates.
    let argumentNameList = [];
    this.factors.forEach(factor => {
      const factorArgumentNameList = factor.toArgumentNameList(firstArgIndex, true);
      argumentNameList = argumentNameList.concat(factorArgumentNameList);

      // Shift the firstArgIndex to take this factor's argument names into account.
      firstArgIndex += factorArgumentNameList.length;
    });
    if (!noDupCheck) {
      resolveDuplicatedNames(argumentNameList);
    }
    return argumentNameList;
  }  
  toDisplayString():string {
    if (this.source) {
      return this.source.trimmed().contents;
    }
    return '[' + this.constructor.name + ']';
  }
  toFailure(grammar:Grammar):Failure {
    const fs = this.factors.map(f => f.toFailure(grammar));
    const description = '(' + fs.join(' ') + ')';
    return new Failure(this, description, 'description');
  }
  toString():string {
    return this.factors.length === 1
      ? this.factors[0].toString()
      : '(' + this.factors.map(factor => factor.toString()).join(' ') + ')';
  }
}

// Iterators and optionals

export abstract class Iter extends PExpr {
  constructor(expr:PExpr) {
    super();
    this.expr = expr;
  }
  expr:PExpr;
  abstract operator:string;
  minNumMatches:number;
  maxNumMatches:number;

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {
    this.expr._assertAllApplicationsAreValid(ruleName, grammar);
  }
  assertChoicesHaveUniformArity(ruleName:string) {
    this.expr.assertChoicesHaveUniformArity(ruleName);
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    // Note: this is the implementation of this method for `Star` and `Plus` expressions.
    // It is overridden for `Opt` below.
    this.expr.assertIteratedExprsAreNotNullable(grammar);
    if (this.expr.isNullable(grammar)) {
      throw errors.kleeneExprHasNullableOperand(this, []);
    }
  }
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    const arity = this.getArity();
    const cols = [];
    const colOffsets = [];
    while (cols.length < arity) {
      cols.push([]);
      colOffsets.push([]);
    }

    let numMatches = 0;
    let prevPos = origPos;
    let idx;
    while (numMatches < this.maxNumMatches && state.eval(this.expr)) {
      if (inputStream.pos === prevPos) {
        throw errors.kleeneExprHasNullableOperand(this, state._applicationStack);
      }
      prevPos = inputStream.pos;
      numMatches++;
      const row = state._bindings.splice(state._bindings.length - arity, arity);
      const rowOffsets = state._bindingOffsets.splice(
        state._bindingOffsets.length - arity,
        arity
      );
      for (idx = 0; idx < row.length; idx++) {
        cols[idx].push(row[idx]);
        colOffsets[idx].push(rowOffsets[idx]);
      }
    }
    if (numMatches < this.minNumMatches) {
      return false;
    }
    let offset = state.posToOffset(origPos);
    let matchLength = 0;
    if (numMatches > 0) {
      const lastCol = cols[arity - 1];
      const lastColOffsets = colOffsets[arity - 1];

      const endOffset =
        lastColOffsets[lastColOffsets.length - 1] + lastCol[lastCol.length - 1].matchLength;
      offset = colOffsets[0][0];
      matchLength = endOffset - offset;
    }
    const isOptional = this instanceof pexprs.Opt;
    for (idx = 0; idx < cols.length; idx++) {
      state._bindings.push(
        new IterationNode(cols[idx], colOffsets[idx], matchLength, isOptional)
      );
      state._bindingOffsets.push(offset);
    }
    return true;
  }
  getArity():number {
    return this.expr.getArity();
  }
  introduceParams(formals:Formals):PExpr {
    this.expr = this.expr.introduceParams(formals);
    return this;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return this.expr._isNullable(grammar, memo);    // !!! not in ohm-js
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      this.constructor.name.toLowerCase(),
      getMetaInfo(this, grammarInterval),
      this.expr.outputRecipe(formals, grammarInterval),
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new Any();
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    const argumentNameList = this.expr
      .toArgumentNameList(firstArgIndex, noDupCheck)
      .map((exprArgumentString:string) =>
        exprArgumentString[exprArgumentString.length - 1] === 's'
          ? exprArgumentString + 'es'
          : exprArgumentString + 's'
      );
    if (!noDupCheck) {
      resolveDuplicatedNames(argumentNameList);
    }
    return argumentNameList;
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    const description = '(' + this.expr.toFailure(grammar) + this.operator + ')';
    return new Failure(this, description, 'description');
  }
  toString():string {
    return this.expr + this.operator;
  }
}

export class Star extends Iter {
  operator = '*';
  minNumMatches = 0;
  maxNumMatches = Number.POSITIVE_INFINITY;
  _isNullable(grammar:Grammar, memo:any):boolean {
    return true;
  }
  substituteParams(actuals:number[]):PExpr {
    return new Star(this.expr.substituteParams(actuals));
  }
}
export class Plus extends Iter {
  operator = '+';
  minNumMatches = 1;
  maxNumMatches = Number.POSITIVE_INFINITY;
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return false;
  }
  substituteParams(actuals:number[]):PExpr {
    return new Plus(this.expr.substituteParams(actuals));
  }
}
export class Opt extends Iter {
  operator = '?';
  minNumMatches = 0;
  maxNumMatches = 1;

  _isNullable(grammar:Grammar, memo:any):boolean {
    return true;
  }
  substituteParams(actuals:number[]):PExpr {
    return new Opt(this.expr.substituteParams(actuals));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return this.expr.toArgumentNameList(firstArgIndex, noDupCheck).map(argName => {
      return 'opt' + argName[0].toUpperCase() + argName.slice(1);
    });
  }
}

// Predicates

export class Not extends PExpr {
  constructor(expr:PExpr) {
    super();
    this.expr = expr;
  }
  expr:PExpr;

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {
    this.expr._assertAllApplicationsAreValid(ruleName, grammar);
  }
  assertChoicesHaveUniformArity(ruleName:string) {
    // no-op (not required b/c the nested expr doesn't show up in the CST)
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    this.expr.assertIteratedExprsAreNotNullable(grammar);
  }
  eval(state:MatchState):boolean {
    /*
      TODO:
      - Right now we're just throwing away all of the failures that happen inside a `not`, and
        recording `this` as a failed expression.
      - Double negation should be equivalent to lookahead, but that's not the case right now wrt
        failures. E.g., ~~'foo' produces a failure for ~~'foo', but maybe it should produce
        a failure for 'foo' instead.
    */

    const {inputStream} = state;
    const origPos = inputStream.pos;
    state.pushFailuresInfo();

    const ans = state.eval(this.expr);

    state.popFailuresInfo();
    if (ans) {
      state.processFailure(origPos, this);
      return false;
    }

    inputStream.pos = origPos;
    return true;
  }
  getArity():number {
    return 0;
  }
  introduceParams(formals:Formals):PExpr {
    this.expr = this.expr.introduceParams(formals);
    return this;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return true;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      this.constructor.name.toLowerCase(),
      getMetaInfo(this, grammarInterval),
      this.expr.outputRecipe(formals, grammarInterval),
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new Not(this.expr.substituteParams(actuals));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return [];
  }
  toDisplayString():string {
    return this.toString();
  }
  toFailure = function (grammar:Grammar):Failure {
    const description =
      this.expr === pexprs.any ? 'nothing' : 'not ' + this.expr.toFailure(grammar);
    return new Failure(this, description, 'description');
  }
  // !!! toString missing
  toString():string {
    return this.expr + "!";
  }
}

export class Lookahead extends PExpr {
  constructor(expr:PExpr) {
    super();
    this.expr = expr;
  }
  expr:PExpr;

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {
    this.expr._assertAllApplicationsAreValid(ruleName, grammar);
  }
  assertChoicesHaveUniformArity(ruleName:string) {
    this.expr.assertChoicesHaveUniformArity(ruleName);
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    this.expr.assertIteratedExprsAreNotNullable(grammar);
  }
  eval(state:MatchState):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    if (state.eval(this.expr)) {
      inputStream.pos = origPos;
      return true;
    } else {
      return false;
    }
  }
  getArity():number {
    return this.expr.getArity();
  }
  introduceParams(formals:Formals):PExpr {
    this.expr = this.expr.introduceParams(formals);
    return this;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return true;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      this.constructor.name.toLowerCase(),
      getMetaInfo(this, grammarInterval),
      this.expr.outputRecipe(formals, grammarInterval),
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new Lookahead(this.expr.substituteParams(actuals));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return this.expr.toArgumentNameList(firstArgIndex, noDupCheck);
  };
  toDisplayString():string {
    return this.toString();
  }
  toFailure(grammar:Grammar):Failure {
    return this.expr.toFailure(grammar);
  }
  toString():string {
    return '&' + this.expr;
  }
}

// "Lexification"

export class Lex extends PExpr {
  constructor(expr:PExpr) {
    super();
    this.expr = expr;
  }
  expr:PExpr;

  allowsSkippingPrecedingSpace():boolean {
    return true;
  }
  assertChoicesHaveUniformArity(ruleName:string):void {}
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {
    PExpr.lexifyCount++;
    this.expr._assertAllApplicationsAreValid(ruleName, grammar);
    PExpr.lexifyCount--;
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    this.expr.assertIteratedExprsAreNotNullable(grammar);
  }
  eval(state:MatchState):boolean {
    state.enterLexifiedContext();
    const ans = state.eval(this.expr);
    state.exitLexifiedContext();
    return ans;
  }
  getArity():number {
    return this.expr.getArity();
  }
  introduceParams(formals:Formals):PExpr {
    this.expr = this.expr.introduceParams(formals);
    return this;
  }
  _isNullable(grammar:Grammar, memo:any) {
    return this.expr._isNullable(grammar, memo);
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      this.constructor.name.toLowerCase(),
      getMetaInfo(this, grammarInterval),
      this.expr.outputRecipe(formals, grammarInterval),
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    return new Lex(this.expr.substituteParams(actuals));
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return this.expr.toArgumentNameList(firstArgIndex, noDupCheck);
  }
  toDisplayString():string {
    return this.toString();
  }
  // !!! tofailure missing
  toFailure(grammar:Grammar):Failure {
    return this.expr.toFailure(grammar);
  }
  toString() {
    return '#(' + this.expr.toString() + ')';
  }
}

// Rule application

export class Apply extends PExpr {
  constructor(ruleName:string, args:any[] = []) {
    super();
    this.ruleName = ruleName;
    this.args = args;
  }
  ruleName:string;
  args:any[];
  _memoKey?:string;

  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  _assertAllApplicationsAreValid(
    ruleName:string,
    grammar:Grammar,
    skipSyntacticCheck:boolean = false
  ):void {
    const ruleInfo = grammar.rules[this.ruleName];
    const isContextSyntactic = isSyntactic(ruleName) && Apply.lexifyCount === 0;  // !!! check logic

    // Make sure that the rule exists...
    if (!ruleInfo) {
      throw errors.undeclaredRule(this.ruleName, grammar.name, this.source);
    }

    // ...and that this application is allowed
    if (!skipSyntacticCheck && isSyntactic(this.ruleName) && !isContextSyntactic) {
      throw errors.applicationOfSyntacticRuleFromLexicalContext(this.ruleName, this);
    }

    // ...and that this application has the correct number of arguments.
    const actual = this.args.length;
    const expected = ruleInfo.formals.length;
    if (actual !== expected) {
      throw errors.wrongNumberOfArguments(this.ruleName, expected, actual, this.source);
    }

    const isBuiltInApplySyntactic =
      Grammar.BuiltInRules && ruleInfo === Grammar.BuiltInRules.rules.applySyntactic;
    const isBuiltInCaseInsensitive =
      Grammar.BuiltInRules && ruleInfo === Grammar.BuiltInRules.rules.caseInsensitive;

    // If it's an application of 'caseInsensitive', ensure that the argument is a Terminal.
    if (isBuiltInCaseInsensitive) {
      if (!(this.args[0] instanceof pexprs.Terminal)) {
        throw errors.incorrectArgumentType('a Terminal (e.g. "abc")', this.args[0]);
      }
    }

    if (isBuiltInApplySyntactic) {
      const arg = this.args[0];
      if (!(arg instanceof pexprs.Apply)) {
        throw errors.incorrectArgumentType('a syntactic rule application', arg);
      }
      if (!isSyntactic(arg.ruleName)) {
        throw errors.applySyntacticWithLexicalRuleApplication(arg);
      }
      if (isContextSyntactic) {
        throw errors.unnecessaryExperimentalApplySyntactic(this);
      }
    }

    // ...and that all of the argument expressions only have valid applications and have arity 1.
    // If `this` is an application of the built-in applySyntactic rule, then its arg is
    // allowed (and expected) to be a syntactic rule, even if we're in a lexical context.
    this.args.forEach(arg => {
      arg._assertAllApplicationsAreValid(ruleName, grammar, isBuiltInApplySyntactic);
      if (arg.getArity() !== 1) {
        throw errors.invalidParameter(this.ruleName, arg);
      }
    });
  }
  assertChoicesHaveUniformArity(ruleName:string):void {
    // The arities of the parameter expressions is required to be 1 by
    // `assertAllApplicationsAreValid()`.
  }
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {
    this.args.forEach(arg => {
      arg.assertIteratedExprsAreNotNullable(grammar);
    });
  }  
  eval(state:MatchState):boolean {
    const caller = state.currentApplication();
    const actuals = caller ? caller.args : [];
    const app:Apply = this.substituteParams(actuals) as Apply;

    const posInfo = state.getCurrentPosInfo();
    if (posInfo.isActive(app)) {
      // This rule is already active at this position, i.e., it is left-recursive.
      return app.handleCycle(state);
    }

    const memoKey = app.toMemoKey();
    const memoRec = posInfo.memo[memoKey];

    if (memoRec && posInfo.shouldUseMemoizedResult(memoRec)) {
      if (state.hasNecessaryInfo(memoRec)) {
        return state.useMemoizedResult(state.inputStream.pos, memoRec);
      }
      delete posInfo.memo[memoKey];
    }
    return app.reallyEval(state);
  }
  handleCycle(state:State):boolean {
    const posInfo = state.getCurrentPosInfo();
    const {currentLeftRecursion} = posInfo;
    const memoKey = this.toMemoKey();
    let memoRec = posInfo.memo[memoKey];

    if (currentLeftRecursion && currentLeftRecursion.headApplication.toMemoKey() === memoKey) {
      // We already know about this left recursion, but it's possible there are "involved
      // applications" that we don't already know about, so...
      memoRec.updateInvolvedApplicationMemoKeys();
    } else if (!memoRec) {
      // New left recursion detected! Memoize a failure to try to get a seed parse.
      memoRec = posInfo.memoize(memoKey, {
        matchLength: 0,
        examinedLength: 0,
        value: false,
        rightmostFailureOffset: -1,
      });
      posInfo.startLeftRecursion(this, memoRec);
    }
    return state.useMemoizedResult(state.inputStream.pos, memoRec);
  }
  reallyEval(state:State):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    const origPosInfo = state.getCurrentPosInfo();
    const ruleInfo = state.grammar.rules[this.ruleName];
    const {body} = ruleInfo;
    const {description} = ruleInfo;

    state.enterApplication(origPosInfo, this);

    if (description) {
      state.pushFailuresInfo();
    }

    // Reset the input stream's examinedLength property so that we can track
    // the examined length of this particular application.
    const origInputStreamExaminedLength = inputStream.examinedLength;
    inputStream.examinedLength = 0;

    let value:Node|false = this.evalOnce(body, state);
    const currentLR = origPosInfo.currentLeftRecursion;
    const memoKey = this.toMemoKey();
    const isHeadOfLeftRecursion = currentLR && currentLR.headApplication.toMemoKey() === memoKey;
    let memoRec:Partial<MemoRec>;

    if (state.doNotMemoize) {
      state.doNotMemoize = false;
    } else if (isHeadOfLeftRecursion) {
      value = this.growSeedResult(body, state, origPos, currentLR, value);
      origPosInfo.endLeftRecursion();
      memoRec = currentLR;
      memoRec.examinedLength = inputStream.examinedLength - origPos;
      memoRec.rightmostFailureOffset = state._getRightmostFailureOffset();
      origPosInfo.memoize(memoKey, memoRec); // updates origPosInfo's maxExaminedLength
    } else if (!currentLR || !currentLR.isInvolved(memoKey)) {
      // This application is not involved in left recursion, so it's ok to memoize it.
      memoRec = origPosInfo.memoize(memoKey, {
        matchLength: inputStream.pos - origPos,
        examinedLength: inputStream.examinedLength - origPos,
        value,
        failuresAtRightmostPosition: state.cloneRecordedFailures(),
        rightmostFailureOffset: state._getRightmostFailureOffset(),
      });
    }
    const succeeded = !!value;

    if (description) {
      state.popFailuresInfo();
      if (!succeeded) {
        state.processFailure(origPos, this);
      }
      if (memoRec) {
        memoRec.failuresAtRightmostPosition = state.cloneRecordedFailures();
      }
    }

    // Record trace information in the memo table, so that it is available if the memoized result
    // is used later.
    if (state.isTracing() && memoRec) {
      const entry = state.getTraceEntry(origPos, this, succeeded, succeeded ? [value] : []);
      if (isHeadOfLeftRecursion) {
        common.assert(entry.terminatingLREntry != null || !succeeded);
        entry.isHeadOfLeftRecursion = true;
      }
      memoRec.traceEntry = entry;
    }

    // Fix the input stream's examinedLength -- it should be the maximum examined length
    // across all applications, not just this one.
    inputStream.examinedLength = Math.max(
      inputStream.examinedLength,
      origInputStreamExaminedLength
    );

    state.exitApplication(origPosInfo, value);

    return succeeded;
  }
  evalOnce(expr:PExpr, state:State):Node|false {
    const {inputStream} = state;
    const origPos = inputStream.pos;

    if (state.eval(expr)) {
      const arity = expr.getArity();
      const bindings = state._bindings.splice(state._bindings.length - arity, arity);
      const offsets = state._bindingOffsets.splice(state._bindingOffsets.length - arity, arity);
      const matchLength = inputStream.pos - origPos;
      return new NonterminalNode(this.ruleName, bindings, offsets, matchLength);
    } else {
      return false;
    }
  }
  growSeedResult(body:PExpr, state:State, origPos:number, lrMemoRec:MemoRec, newValue:Node|false):Node|false {
    if (!newValue) {
      return false;
    }

    const {inputStream} = state;

    while (true) {
      lrMemoRec.matchLength = inputStream.pos - origPos;
      lrMemoRec.value = newValue;
      lrMemoRec.failuresAtRightmostPosition = state.cloneRecordedFailures();

      if (state.isTracing()) {
        // Before evaluating the body again, add a trace node for this application to the memo entry.
        // Its only child is a copy of the trace node from `newValue`, which will always be the last
        // element in `state.trace`.
        const seedTrace = state.trace[state.trace.length - 1];
        lrMemoRec.traceEntry = new Trace(
          state.input,
          origPos,
          inputStream.pos,
          this,
          true,
          [newValue],
          [seedTrace.clone()]
        );
      }
      inputStream.pos = origPos;
      newValue = this.evalOnce(body, state);
      if (inputStream.pos - origPos <= lrMemoRec.matchLength) {
        break;
      }
      if (state.isTracing()) {
        state.trace.splice(-2, 1); // Drop the trace for the old seed.
      }
    }
    if (state.isTracing()) {
      // The last entry is for an unused result -- pop it and save it in the "real" entry.
      lrMemoRec.traceEntry.recordLRTermination(state.trace.pop(), newValue);
    }
    inputStream.pos = origPos + lrMemoRec.matchLength;
    return lrMemoRec.value;
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    const index = formals.indexOf(this.ruleName);
    if (index >= 0) {
      if (this.args.length > 0) {
        // TODO: Should this be supported? See issue #64.
        throw new Error('Parameterized rules cannot be passed as arguments to another rule.');
      }
      return new pexprs.Param(index).withSource(this.source);
    } else {
      this.args.forEach((arg, idx, args) => {
        args[idx] = arg.introduceParams(formals);
      });
      return this;
    }
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    const key = this.toMemoKey()!;    // ??? !
    if (!Object.prototype.hasOwnProperty.call(memo, key)) {
      const {body} = grammar.rules[this.ruleName];
      const inlined = body.substituteParams(this.args);
      memo[key] = false; // Prevent infinite recursion for recursive rules.
      memo[key] = inlined._isNullable(grammar, memo);
    }
    return memo[key];
  }
  isSyntactic():boolean {
    return common.isSyntactic(this.ruleName);
  }

  // This method just caches the result of `this.toString()` in a non-enumerable property.
  toMemoKey():string {
    if (!this._memoKey) {
      Object.defineProperty(this, '_memoKey', {value: this.toString()});
    }
    return this._memoKey;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return [
      'app',
      getMetaInfo(this, grammarInterval),
      this.ruleName,
      this.args.map(arg => arg.outputRecipe(formals, grammarInterval)),
    ];
  }
  substituteParams(actuals:number[]):PExpr {
    if (this.args.length === 0) {
      // Avoid making a copy of this application, as an optimization
      return this;
    } else {
      const args = this.args.map(arg => arg.substituteParams(actuals));
      return new Apply(this.ruleName, args);
    }
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return [this.ruleName];
  }  
  toDisplayString():string {
    if (this.args.length > 0) {
      const ps = this.args.map(arg => arg.toDisplayString());
      return this.ruleName + '<' + ps.join(',') + '>';
    } else {
      return this.ruleName;
    }
  }
  toFailure(grammar:Grammar):Failure {
    let {description} = grammar.rules[this.ruleName];
    if (!description) {
      const article = /^[aeiouAEIOU]/.test(this.ruleName) ? 'an' : 'a';
      description = article + ' ' + this.ruleName;
    }
    return new Failure(this, description, 'description');
  }
  toString():string {
    if (this.args.length > 0) {
      const ps = this.args.map(arg => arg.toString());
      return this.ruleName + '<' + ps.join(',') + '>';
    } else {
      return this.ruleName;
    }
  }
}

// Unicode character

export class UnicodeChar extends PExpr {
  constructor(categoryOrProp:string) {
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
  categoryOrProp:any; // ???
  pattern:RegExp;
  
  allowsSkippingPrecedingSpace():boolean {
    return false;
  }
  assertChoicesHaveUniformArity(ruleName:string) {}
  _assertAllApplicationsAreValid(ruleName:string, grammar:Grammar):void {}
  assertIteratedExprsAreNotNullable(grammar:Grammar):void {}
  eval(state:State):boolean {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    const ch = inputStream.next();
    if (ch && this.pattern.test(ch)) {
      state.pushBinding(new TerminalNode(ch.length), origPos);
      return true;
    } else {
      state.processFailure(origPos, this);
      return false;
    }
  }
  getArity():number {
    return 1;
  }
  introduceParams(formals:Formals):PExpr {
    return this as PExpr;
  }
  _isNullable(grammar:Grammar, memo:any):boolean {
    return false;
  }
  outputRecipe(formals:Formals, grammarInterval:Interval):Recipe {
    return ['unicodeChar', getMetaInfo(this, grammarInterval), this.categoryOrProp];
  }
  substituteParams(actuals:number[]):PExpr {
    return this;
  }
  toArgumentNameList(firstArgIndex:number, noDupCheck:boolean):string[] {
    return ['$' + firstArgIndex];
  }
  toDisplayString():string {
    return 'Unicode [' + this.categoryOrProp + '] character';
  }
  toFailure(grammar:Grammar):Failure {
    return new Failure(this, 'a Unicode [' + this.categoryOrProp + '] character', 'description');
  }
  toString():string {
    return '\\p{' + this.categoryOrProp + '}';
  }
}
