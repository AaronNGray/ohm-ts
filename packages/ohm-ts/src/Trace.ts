import Interval from './Interval.js';
import * as common from './common.js';
import PExpr from './pexprs-main.js';
import Node from './nodes.js';
import MatchResult from './MatchResult.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

// Unicode characters that are used in the `toString` output.
const BALLOT_X = '\u2717';
const CHECK_MARK = '\u2713';
const DOT_OPERATOR = '\u22C5';
const RIGHTWARDS_DOUBLE_ARROW = '\u21D2';
const SYMBOL_FOR_HORIZONTAL_TABULATION = '\u2409';
const SYMBOL_FOR_LINE_FEED = '\u240A';
const SYMBOL_FOR_CARRIAGE_RETURN = '\u240D';

const Flags = {
  none: 0,
  succeeded: 1 << 0,
  isRootNode: 1 << 1,
  isImplicitSpaces: 1 << 2,
  isMemoized: 1 << 3,
  isHeadOfLeftRecursion: 1 << 4,
  terminatesLR: 1 << 5,
};

function spaces(n:number) {
  return common.repeat(' ', n).join('');
}

// Return a string representation of a portion of `input` at offset `pos`.
// The result will contain exactly `len` characters.
function getInputExcerpt(input:string, pos:number, len:number) {
  const excerpt = asEscapedString(input.slice(pos, pos + len));

  // Pad the output if necessary.
  if (excerpt.length < len) {
    return excerpt + common.repeat(' ', len - excerpt.length).join('');
  }
  return excerpt;
}

function asEscapedString(obj:any) {
  if (typeof obj === 'string') {
    // Replace non-printable characters with visible symbols.
    return obj
      .replace(/ /g, DOT_OPERATOR)
      .replace(/\t/g, SYMBOL_FOR_HORIZONTAL_TABULATION)
      .replace(/\n/g, SYMBOL_FOR_LINE_FEED)
      .replace(/\r/g, SYMBOL_FOR_CARRIAGE_RETURN);
  }
  return String(obj);
}

// ----------------- Trace -----------------

export default class Trace {
  constructor(input:string, pos1:number, pos2:number, expr:PExpr, succeeded:boolean, bindings:any[], optChildren:Trace[]) {
    this.input = input;
    this.pos = pos1; // ??? this.pos1
    this.pos2 = pos2;
    this.source = new Interval(input, pos1, pos2);
    this.expr = expr;
    this.bindings = bindings;   // !!! TODO introduce Bindings type
    this.children = optChildren || [];
    this.terminatingLREntry = null;

    this._flags = succeeded ? Flags.succeeded : Flags.none;
  }

  input:string;
  pos:number;
  pos2:number;
  source:Interval;
  expr:PExpr;
  bindings:any; // ???
  children:Trace[]; // ???

  isHeadOfLeftRecursion:boolean;
  isImplicitSpaces:boolean;
  isMemoized:boolean;
  isRootNode:boolean;
  
  terminatesLR:any; /// ???
  terminatingLREntry:any; // ???

  _flags:number;

  result:MatchResult; // ???

  get displayString():string {
    return this.expr.toDisplayString();
  }

  clone():Trace {
    return this.cloneWithExpr(this.expr);
  }

  cloneWithExpr(expr:PExpr):Trace {
    const ans = new Trace(
      this.input,
      this.pos,
      this.pos2,
      expr,
      this._flags == Flags.succeeded, // this.succeeded,   // !!! bug
      this.bindings,
      this.children
    );

    ans.isHeadOfLeftRecursion = this.isHeadOfLeftRecursion;
    ans.isImplicitSpaces = this.isImplicitSpaces;
    ans.isMemoized = this.isMemoized;
    ans.isRootNode = this.isRootNode;
    ans.terminatesLR = this.terminatesLR;
    ans.terminatingLREntry = this.terminatingLREntry;
    return ans;
  }

  // Record the trace information for the terminating condition of the LR loop.
  recordLRTermination(ruleBodyTrace:Trace, value:any):void {
    this.terminatingLREntry = new Trace(
      this.input,
      this.pos,
      this.pos2,
      this.expr,
      false,
      [value],
      [ruleBodyTrace]
    );
    this.terminatingLREntry.terminatesLR = true;
  }

  // Recursively traverse this trace node and all its descendents, calling a visitor function
  // for each node that is visited. If `vistorObjOrFn` is an object, then its 'enter' property
  // is a function to call before visiting the children of a node, and its 'exit' property is
  // a function to call afterwards. If `visitorObjOrFn` is a function, it represents the 'enter'
  // function.
  //
  // The functions are called with three arguments: the Trace node, its parent Trace, and a number
  // representing the depth of the node in the tree. (The root node has depth 0.) `optThisArg`, if
  // specified, is the value to use for `this` when executing the visitor functions.
  walk(visitorObjOrFn:(node:Node, parent:Node, depth:number) => string, optThisArg?:Trace):void {
    let visitor:any = visitorObjOrFn;  // ??? any ???
    if (typeof visitor === 'function') {
      visitor = {enter: visitor};
    }

    function _walk(node, parent, depth) {
      let recurse = true;
      if (visitor.enter) {
        if (visitor.enter.call(optThisArg, node, parent, depth) === Trace.prototype.SKIP) {
          recurse = false;
        }
      }
      if (recurse) {
        node.children.forEach(child => {
          _walk(child, node, depth + 1);
        });
        if (visitor.exit) {
          visitor.exit.call(optThisArg, node, parent, depth);
        }
      }
    }
    if (this.isRootNode) {
      // Don't visit the root node itself, only its children.
      this.children.forEach(c => {
        _walk(c, null, 0);
      });
    } else {
      _walk(this, null, 0);
    }
  }

  // Return a string representation of the trace.
  // Sample:
  //     12⋅+⋅2⋅*⋅3 ✓ exp ⇒  "12"
  //     12⋅+⋅2⋅*⋅3   ✓ addExp (LR) ⇒  "12"
  //     12⋅+⋅2⋅*⋅3       ✗ addExp_plus
  toString():string {
    const sb = new common.StringBuffer();
    this.walk((node:Node, parent:Node, depth:number):string => {
      if (!node) {
        return this.SKIP;
      }
      const ctorName = node.expr.constructor.name;
      // Don't print anything for Alt nodes.
      if (ctorName === 'Alt') {
        return;
      }
      sb.append(getInputExcerpt(node.input, node.pos, 10) + spaces(depth * 2 + 1));
      sb.append((node.succeeded ? CHECK_MARK : BALLOT_X) + ' ' + node.displayString);
      if (node.isHeadOfLeftRecursion) {
        sb.append(' (LR)');
      }
      if (node.succeeded) {
        const contents = asEscapedString(node.source.contents);
        sb.append(' ' + RIGHTWARDS_DOUBLE_ARROW + '  ');
        sb.append(typeof contents === 'string' ? '"' + contents + '"' : contents);
      }
      sb.append('\n');
    });
    return sb.contents();
  }
  SKIP:any = {};  // ???
}

// A value that can be returned from visitor functions to indicate that a
// node should not be recursed into.
Trace.prototype.SKIP = {};

// For convenience, create a getter and setter for the boolean flags in `Flags`.
Object.keys(Flags).forEach(name => {
  const mask = (Flags as any)[name];
  Object.defineProperty(Trace.prototype, name, {
    get() {
      return (this._flags & mask) !== 0;
    },
    set(val) {
      if (val) {
        this._flags |= mask;
      } else {
        this._flags &= ~mask;
      }
    },
  });
});

