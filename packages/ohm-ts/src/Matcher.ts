import {grammarDoesNotSupportIncrementalParsing} from './errors.js';
import Grammar from './Grammar.js';
import PExpr from './pexprs-main.js';
import MatchState from './MatchState.js';
import MatchResult from './MatchResult.js';
import Trace from './Trace.js';
import * as pexprs from './pexprs.js';
import InputStream from './InputStream.js';

export default class Matcher {
  constructor(grammar:Grammar) {
    this.grammar = grammar;
    this._memoTable = [];
    this._input = "";
    this._isMemoTableStale = false;
  }

  _input:string;
  grammar:Grammar;
  _memoTable:any[]; // ???
  _isMemoTableStale:boolean;

  _resetMemoTable() {
    this._memoTable = [];
    this._isMemoTableStale = false;
  }

  getInput():string {
    return this._input;
  }

  setInput(str:string) {
    if (this._input !== str) {
      this.replaceInputRange(0, this._input.length, str);
    }
    return this;
  }

  replaceInputRange(startIdx:number, endIdx:number, str:string) {
    const prevInput = this._input;
    const memoTable = this._memoTable;
    if (
      startIdx < 0 ||
      startIdx > prevInput.length ||
      endIdx < 0 ||
      endIdx > prevInput.length ||
      startIdx > endIdx
    ) {
      throw new Error('Invalid indices: ' + startIdx + ' and ' + endIdx);
    }

    // update input
    this._input = prevInput.slice(0, startIdx) + str + prevInput.slice(endIdx);
    if (this._input !== prevInput && memoTable.length > 0) {
      this._isMemoTableStale = true;
    }

    // update memo table (similar to the above)
    const restOfMemoTable = memoTable.slice(endIdx);
    memoTable.length = startIdx;
    for (let idx = 0; idx < str.length; idx++) {
      memoTable.push(undefined);
    }
    for (const posInfo of restOfMemoTable) {
      memoTable.push(posInfo);
    }

    // Invalidate memoRecs
    for (let pos = 0; pos < startIdx; pos++) {
      const posInfo = memoTable[pos];
      if (posInfo) {
        posInfo.clearObsoleteEntries(pos, startIdx);
      }
    }

    return this;
  }

  match(optStartApplicationStr:string, options = {incremental: true}):MatchResult {
    return this._match(this._getStartExpr(optStartApplicationStr), {
      incremental: options.incremental,
      tracing: false,
    }) as MatchResult;
  }

  trace(optStartApplicationStr:string, options = {incremental: true}):Trace {
    return this._match(this._getStartExpr(optStartApplicationStr), {
      incremental: options.incremental,
      tracing: true,
    }) as Trace;
  }

  _match(startExpr:PExpr, options = {}):MatchResult|Trace {
    const opts = {
      tracing: false,
      incremental: true,
      positionToRecordFailures: undefined,
      ...options,
    };
    if (!opts.incremental) {
      this._resetMemoTable();
    } else if (this._isMemoTableStale && !this.grammar.supportsIncrementalParsing) {
      throw grammarDoesNotSupportIncrementalParsing(this.grammar);
    }

    const state = new MatchState(this, startExpr, opts.positionToRecordFailures);
    return opts.tracing ? state.getTrace() : state.getMatchResult();
  }

  /*
    Returns the starting expression for this Matcher's associated grammar. If
    `optStartApplicationStr` is specified, it is a string expressing a rule application in the
    grammar. If not specified, the grammar's default start rule will be used.
  */
  _getStartExpr(optStartApplicationStr:string):PExpr {
    const applicationStr = optStartApplicationStr || this.grammar.defaultStartRule; // ??? string or Rule ?
    if (!applicationStr) {
      throw new Error('Missing start rule argument -- the grammar has no default start rule.');
    }

    const startApp = this.grammar.parseApplication(applicationStr);
    return new pexprs.Seq([startApp, pexprs.end]);  // Augment the grammar, with start rule.
  }
}
