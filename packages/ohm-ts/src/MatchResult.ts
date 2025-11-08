import * as common from './common.js';
import * as util from './util.js';
import Interval from './Interval.js';
import Matcher from './Matcher.js';
import PExpr from './pexprs-main.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

export default class MatchResult {
  constructor(
    matcher:Matcher,
    input:string, // ???
    startExpr:PExpr,
    cst,
    cstOffset,
    rightmostFailurePosition,
    optRecordedFailures
  ) {
    this.matcher = matcher;
    this.input = input;
    this.startExpr = startExpr;
    this._cst = cst;
    this._cstOffset = cstOffset;
    this._rightmostFailurePosition = rightmostFailurePosition;
    this._rightmostFailures = optRecordedFailures;

    if (this.failed()) {
      common.defineLazyProperty(this, 'message', function () {
        const detail = 'Expected ' + this.getExpectedText();
        return (
          util.getLineAndColumnMessage(this.input, this.getRightmostFailurePosition()) + detail
        );
      });
      common.defineLazyProperty(this, 'shortMessage', function () {
        const detail = 'expected ' + this.getExpectedText();
        const errorInfo = util.getLineAndColumn(
          this.input,
          this.getRightmostFailurePosition()
        );
        return 'Line ' + errorInfo.lineNum + ', col ' + errorInfo.colNum + ': ' + detail;
      });
    }
  }

  matcher:Matcher;
  input;
  startExpr;
  _cst;
  _cstOffset;
  _rightmostFailurePosition;
  _rightmostFailures;

  succeeded() {
    return !!this._cst;
  }

  failed() {
    return !this.succeeded();
  }

  getRightmostFailurePosition() {
    return this._rightmostFailurePosition;
  }

  getRightmostFailures() {
    if (!this._rightmostFailures) {
      this.matcher.setInput(this.input);
      const matchResultWithFailures = this.matcher._match(this.startExpr, {
        tracing: false,
        positionToRecordFailures: this.getRightmostFailurePosition(),
      });
      this._rightmostFailures = matchResultWithFailures.getRightmostFailures();
    }
    return this._rightmostFailures;
  }

  toString() {
    return this.succeeded()
      ? '[match succeeded]'
      : '[match failed at position ' + this.getRightmostFailurePosition() + ']';
  }

  // Return a string summarizing the expected contents of the input stream when
  // the match failure occurred.
  getExpectedText() {
    if (this.succeeded()) {
      throw new Error('cannot get expected text of a successful MatchResult');
    }

    const sb = new common.StringBuffer();
    let failures = this.getRightmostFailures();

    // Filter out the fluffy failures to make the default error messages more useful
    failures = failures.filter(failure => !failure.isFluffy());

    for (let idx = 0; idx < failures.length; idx++) {
      if (idx > 0) {
        if (idx === failures.length - 1) {
          sb.append(failures.length > 2 ? ', or ' : ' or ');
        } else {
          sb.append(', ');
        }
      }
      sb.append(failures[idx].toString());
    }
    return sb.contents();
  }

  getInterval():Interval {
    const pos = this.getRightmostFailurePosition();
    return new Interval(this.input, pos, pos);
  }
}
