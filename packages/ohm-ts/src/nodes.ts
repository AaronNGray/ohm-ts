import * as common from './common.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

export default class Node {
  constructor(matchLength:number) {
    this.matchLength = matchLength;
  }

  matchLength:number;
  children:Node[] = [];
  [key: string]: any; // ???

  get ctorName():string {
    throw new Error('subclass responsibility');
  }

  numChildren() {
    return this.children ? this.children.length : 0;
  }

  childAt(idx:number) {
    if (this.children) {
      return this.children[idx];
    }
  }

  indexOfChild(arg:Node):number {
    return this.children.indexOf(arg);
  }

  hasChildren():boolean {
    return this.numChildren() > 0;
  }

  hasNoChildren():boolean {
    return !this.hasChildren();
  }

  onlyChild():Node|undefined|never {
    if (this.numChildren() !== 1) {
      throw new Error(
        'cannot get only child of a node of type ' +
          this.ctorName +
          ' (it has ' +
          this.numChildren() +
          ' children)'
      );
    } else {
      return this.firstChild();
    }
  }

  firstChild():Node|undefined|never {
    if (this.hasNoChildren()) {
      throw new Error(
        'cannot get first child of a ' + this.ctorName + ' node, which has no children'
      );
    } else {
      return this.childAt(0);
    }
  }

  lastChild():Node|undefined|never {
    if (this.hasNoChildren()) {
      throw new Error(
        'cannot get last child of a ' + this.ctorName + ' node, which has no children'
      );
    } else {
      return this.childAt(this.numChildren() - 1);
    }
  }

  childBefore(child:Node):Node|undefined|never {
    const childIdx = this.indexOfChild(child);
    if (childIdx < 0) {
      throw new Error('Node.childBefore() called w/ an argument that is not a child');
    } else if (childIdx === 0) {
      throw new Error('cannot get child before first child');
    } else {
      return this.childAt(childIdx - 1);
    }
  }

  childAfter(child:Node):Node|undefined|never {
    const childIdx = this.indexOfChild(child);
    if (childIdx < 0) {
      throw new Error('Node.childAfter() called w/ an argument that is not a child');
    } else if (childIdx === this.numChildren() - 1) {
      throw new Error('cannot get child after last child');
    } else {
      return this.childAt(childIdx + 1);
    }
  }

  isTerminal():boolean {
    return false;
  }

  isNonterminal():boolean {
    return false;
  }

  isIteration():boolean {
    return false;
  }

  isOptional():boolean {
    return false;
  }
}

// Terminals

export class TerminalNode extends Node {
  get ctorName():string {
    return '_terminal';
  }

  isTerminal():boolean {
    return true;
  }

  get primitiveValue():never {
    throw new Error('The `primitiveValue` property was removed in Ohm v17.');
  }
}

// Nonterminals

export class NonterminalNode extends Node {
  constructor(ruleName:string, children:Node[], childOffsets:number[], matchLength:number) {
    super(matchLength);
    this.ruleName = ruleName;
    this.children = children;
    this.childOffsets = childOffsets;
  }

  ruleName:string;
  childOffsets:number[];

  get ctorName():string {
    return this.ruleName;
  }

  isNonterminal() {
    return true;
  }

  isLexical() {
    return common.isLexical(this.ctorName);
  }

  isSyntactic() {
    return common.isSyntactic(this.ctorName);
  }
}

// Iterations

export class IterationNode extends Node {
  constructor(children:Node[], childOffsets:number[], matchLength:number, isOptional:boolean) {
    super(matchLength);
    this.children = children;
    this.childOffsets = childOffsets;
    this.optional = isOptional;
  }

  //children:Node[];
  childOffsets:number[]; // ???
  optional:boolean;

  get ctorName():string {
    return '_iter';
  }

  isIteration():boolean {
    return true;
  }

  isOptional():boolean {
    return this.optional;
  }
}
