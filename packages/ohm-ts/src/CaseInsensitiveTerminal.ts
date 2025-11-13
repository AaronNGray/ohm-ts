import Failure from './Failure.js';
import {TerminalNode} from './nodes.js';
import {assert} from './common.js';
import MatchState from './MatchState.js';
import PExpr, {Terminal} from './pexprs-main.js';
import Grammar from './Grammar.js';

export class CaseInsensitiveTerminal extends Terminal /* PExpr */  {
  constructor(param:any) {
    super(param);
  }

  _getString(state:MatchState) {
    const terminal = state.currentApplication().args[this.obj.index];
    assert(terminal instanceof Terminal, 'expected a Terminal expression');
    return terminal.obj;
  }

  // Implementation of the PExpr API

  allowsSkippingPrecedingSpace() {
    return true;
  }

  eval(state:MatchState) {
    const {inputStream} = state;
    const origPos = inputStream.pos;
    const matchStr = this._getString(state);
    if (!inputStream.matchString(matchStr, true)) {
      state.processFailure(origPos, this);
      return false;
    } else {
      state.pushBinding(new TerminalNode(matchStr.length), origPos);
      return true;
    }
  }

  getArity() {
    return 1;
  }

  substituteParams(actuals:number[]):PExpr {
    return new CaseInsensitiveTerminal(this.obj.substituteParams(actuals));
  }

  toDisplayString() {
    return this.obj.toDisplayString() + ' (case-insensitive)';
  }

  toFailure(grammar:Grammar) {
    return new Failure(
      this,
      this.obj.toFailure(grammar) + ' (case-insensitive)',
      'description'
    );
  }

  _isNullable(grammar, memo):boolean {
    return this.obj._isNullable(grammar, memo);
  }
}
