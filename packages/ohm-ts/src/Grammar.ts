import Interval from './Interval.js';
import Matcher from './Matcher.js';
import MatchResult from './MatchResult.js';
import Trace from './Trace.js';
import Semantics from './Semantics.js';
import {Rule, Rules} from './GrammarDecl.js';
import * as common from './common.js';
import * as errors from './errors.js';
import {SyntaxError} from './errors.js';
import * as pexprs from './pexprs.js';
import Recipe from './pexprs-main.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

const SPECIAL_ACTION_NAMES = ['_iter', '_terminal', '_nonterminal', '_default'];

function getSortedRuleValues(grammar:Grammar):Rule[] {
  return Object.keys(grammar.rules)
    .sort()
    .map(name => grammar.rules[name]);
}

// Until ES2019, JSON was not a valid subset of JavaScript because U+2028 (line separator)
// and U+2029 (paragraph separator) are allowed in JSON string literals, but not in JS.
// This function properly encodes those two characters so that the resulting string is
// represents both valid JSON, and valid JavaScript (for ES2018 and below).
// See https://v8.dev/features/subsume-json for more details.
const jsonToJS = (str:string) => str.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

let ohmGrammar:Grammar;
let buildGrammar;

export default class Grammar {
  constructor(name:string, superGrammar:Grammar, rules:Rules, optDefaultStartRule:Rule, source?:Interval) {
    this.name = name;
    this.superGrammar = superGrammar;
    this.rules = rules;
    if (optDefaultStartRule) {
      if (!(optDefaultStartRule in rules)) {    // ??? needs [unit] test 
        throw new Error(
          "Invalid start rule: '" +
            optDefaultStartRule +
            "' is not a rule in grammar '" +
            name +
            "'"
        );
      }
      this.defaultStartRule = optDefaultStartRule;
    }
    this._matchStateInitializer = undefined;
    this.supportsIncrementalParsing = true;
  }

  name:string;
  source?:Interval; // ??? - never assigned 
  superGrammar:Grammar;
  rules:Rules;
  defaultStartRule:Rule; // ??? string ???
  _matchStateInitializer:any|undefined;
  supportsIncrementalParsing:boolean;

  static ProtoBuiltInRules:Rules;   // ??? Rules ???
  static BuiltInRules:Rules;

  matcher():Matcher {
    return new Matcher(this);
  }

  // Return true if the grammar is a built-in grammar, otherwise false.
  // NOTE: This might give an unexpected result if called before BuiltInRules is defined!
  isBuiltIn():boolean {
    return this.rules === Grammar.ProtoBuiltInRules || this.rules === Grammar.BuiltInRules;  // ??? .rules
  }

  equals(g:Grammar):boolean {
    if (this === g) {
      return true;
    }
    // Do the cheapest comparisons first.
    if (
      g == null ||
      this.name !== g.name ||
      this.defaultStartRule !== g.defaultStartRule ||
      !(this.superGrammar === g.superGrammar || this.superGrammar.equals(g.superGrammar))
    ) {
      return false;
    }
    const myRules = getSortedRuleValues(this);
    const otherRules = getSortedRuleValues(g);
    return (
      myRules.length === otherRules.length &&
      myRules.every((rule:Rule, i:number) => {
        return (
          rule.description === otherRules[i].description &&
          rule.formals.join(',') === otherRules[i].formals.join(',') &&
          rule.body.toString() === otherRules[i].body.toString()
        );
      })
    );
  }

  match(input:string, optStartApplication?:string):MatchResult {
    const m = this.matcher();
    m.replaceInputRange(0, 0, input);
    return m.match(optStartApplication);
  }

  trace(input:string, optStartApplication):MatchResult {
    const m = this.matcher();
    m.replaceInputRange(0, 0, input);
    return m.trace(optStartApplication);
  }

  createSemantics():Semantics {
    return Semantics.createSemantics(this);
  }

  extendSemantics(superSemantics:Semantics):Semantics {
    return Semantics.createSemantics(this, superSemantics._getSemantics());
  }

  // Check that every key in `actionDict` corresponds to a semantic action, and that it maps to
  // a function of the correct arity. If not, throw an exception.
  _checkTopDownActionDict(what:string, name:string, actionDict:any) {
    const problems = [];

    for (const k in actionDict) {
      const v = actionDict[k];
      const isSpecialAction = SPECIAL_ACTION_NAMES.includes(k);

      if (!isSpecialAction && !(k in this.rules)) {
        problems.push(`'${k}' is not a valid semantic action for '${this.name}'`);
        continue;
      }
      if (typeof v !== 'function') {
        problems.push(`'${k}' must be a function in an action dictionary for '${this.name}'`);
        continue;
      }
      const actual = v.length;
      const expected = this._topDownActionArity(k);
      if (actual !== expected) {
        let details:string;
        if (k === '_iter' || k === '_nonterminal') {
          details =
            `it should use a rest parameter, e.g. \`${k}(...children) {}\`. ` +
            'NOTE: this is new in Ohm v16 — see https://ohmjs.org/d/ati for details.';
        } else {
          details = `expected ${expected}, got ${actual}`;
        }
        problems.push(`Semantic action '${k}' has the wrong arity: ${details}`);
      }
    }
    if (problems.length > 0) {
      const prettyProblems = problems.map(problem => '- ' + problem);
      const error = new SyntaxError(
        [
          `Found errors in the action dictionary of the '${name}' ${what}:`,
          ...prettyProblems,
        ].join('\n')
      );
      error.problems = problems;
      throw error;
    }
  }

  // Return the expected arity for a semantic action named `actionName`, which
  // is either a rule name or a special action name like '_nonterminal'.
  _topDownActionArity(actionName:string) {
    // All special actions have an expected arity of 0, though all but _terminal
    // are expected to use the rest parameter syntax (e.g. `_iter(...children)`).
    // This is considered to have arity 0, i.e. `((...args) => {}).length` is 0.
    return SPECIAL_ACTION_NAMES.includes(actionName)
      ? 0
      : this.rules[actionName].body.getArity();
  }

  _inheritsFrom(grammar):boolean {
    let g = this.superGrammar;
    while (g) {
      if (g.equals(grammar)) {    // !!! BUG - g.equals(grammar, true)
        return true;
      }
      g = g.superGrammar;
    }
    return false;
  }

  toRecipe(superGrammarExpr = undefined):string {
    const metaInfo:{source?:string;} = {};
    // Include the grammar source if it is available.
    if (this.source) {
      metaInfo.source = this.source.contents;
    }

    let startRule = null;
    if (this.defaultStartRule) {
      startRule = this.defaultStartRule;
    }

    const rules = []; // ???
    Object.keys(this.rules).forEach(ruleName => {
      const ruleInfo = this.rules[ruleName];
      const {body} = ruleInfo;
      const isDefinition = !this.superGrammar || !this.superGrammar.rules[ruleName];

      let operation;
      if (isDefinition) {
        operation = 'define';
      } else {
        operation = body instanceof pexprs.Extend ? 'extend' : 'override';
      }

      const metaInfo:{sourceInterval:number[]} = {};
      if (ruleInfo.source && this.source) {
        const adjusted = ruleInfo.source.relativeTo(this.source);
        metaInfo.sourceInterval = [adjusted.startIdx, adjusted.endIdx];
      }

      const description = isDefinition ? ruleInfo.description : null;
      const bodyRecipe = body.outputRecipe(ruleInfo.formals, this.source);

      rules[ruleName] = [
        operation, // "define"/"extend"/"override"
        metaInfo,
        description,
        ruleInfo.formals,
        bodyRecipe
      ];
    });

    // If the caller provided an expression to use for the supergrammar, use that.
    // Otherwise, if the supergrammar is a user grammar, use its recipe inline.
    let superGrammarOutput = 'null';
    if (superGrammarExpr) {
      superGrammarOutput = superGrammarExpr;
    } else if (this.superGrammar && !this.superGrammar.isBuiltIn()) {
      superGrammarOutput = this.superGrammar.toRecipe();
    }

    const recipeElements = [
      ...['grammar', metaInfo, this.name].map((element:any) => JSON.stringify(element)),
      superGrammarOutput,
      ...[startRule, rules].map((element:any) => JSON.stringify(element)),
    ];
    return jsonToJS(`[${recipeElements.join(',')}]`);
  }

  // TODO: Come up with better names for these methods.
  // TODO: Write the analog of these methods for inherited attributes.
  toOperationActionDictionaryTemplate() {
    return this._toOperationOrAttributeActionDictionaryTemplate();
  }
  toAttributeActionDictionaryTemplate() {
    return this._toOperationOrAttributeActionDictionaryTemplate();
  }

  _toOperationOrAttributeActionDictionaryTemplate() {
    // TODO: add the super-grammar's templates at the right place, e.g., a case for AddExpr_plus
    // should appear next to other cases of AddExpr.

    const sb = new common.StringBuffer();
    sb.append('{');

    let first = true;

    for (const ruleName in this.rules) {
      const {body} = this.rules[ruleName];
      if (first) {
        first = false;
      } else {
        sb.append(',');
      }
      sb.append('\n');
      sb.append('  ');
      this.addSemanticActionTemplate(ruleName, body, sb);
    }

    sb.append('\n}');
    return sb.contents();
  }

  addSemanticActionTemplate(ruleName:string, body, sb:StringBuffer) {
    sb.append(ruleName);
    sb.append(': function(');
    const arity = this._topDownActionArity(ruleName);
    sb.append(common.repeat('_', arity).join(', '));
    sb.append(') {\n');
    sb.append('  }');
  }

  // Parse a string which expresses a rule application in this grammar, and return the
  // resulting Apply node.
  parseApplication(str:string) {
    let app;
    if (str.indexOf('<') === -1) {
      // simple application
      app = new pexprs.Apply(str);
    } else {
      // parameterized application
      const cst = ohmGrammar.match(str, 'Base_application');
      app = buildGrammar(cst, {});
    }

    // Ensure that the application is valid.
    if (!(app.ruleName in this.rules)) {
      throw errors.undeclaredRule(app.ruleName, this.name);
    }
    const {formals} = this.rules[app.ruleName];
    if (formals.length !== app.args.length) {
      const {source} = this.rules[app.ruleName];
      throw errors.wrongNumberOfParameters(
        app.ruleName,
        formals.length,
        app.args.length,
        source
      );
    }
    return app;
  }

  _setUpMatchState(state) {
    if (this._matchStateInitializer) {
      this._matchStateInitializer(state);
    }
  }
}

// The following grammar contains a few rules that couldn't be written  in "userland".
// At the bottom of src/main.js, we create a sub-grammar of this grammar that's called
// `BuiltInRules`. That grammar contains several convenience rules, e.g., `letter` and
// `digit`, and is implicitly the super-grammar of any grammar whose super-grammar
// isn't specified.
Grammar.ProtoBuiltInRules = new Grammar(      /// !!! TODO: Grammer .v. Rules
  'ProtoBuiltInRules', // name
  undefined, // supergrammar
  {
    any: {
      body: pexprs.any,
      formals: [],
      description: 'any character',
      primitive: true,
    },
    end: {
      body: pexprs.end,
      formals: [],
      description: 'end of input',
      primitive: true,
    },

    caseInsensitive: {
      body: new pexprs.CaseInsensitiveTerminal(new pexprs.Param(0)),
      formals: ['str'],
      primitive: true,
    },
    lower: {
      body: new pexprs.UnicodeChar('Ll'),
      formals: [],
      description: 'a lowercase letter',
      primitive: true,
    },
    upper: {
      body: new pexprs.UnicodeChar('Lu'),
      formals: [],
      description: 'an uppercase letter',
      primitive: true,
    },
    // Union of Lt (titlecase), Lm (modifier), and Lo (other), i.e. any letter not in Ll or Lu.
    unicodeLtmo: {
      body: new pexprs.UnicodeChar('Ltmo'),
      formals: [],
      description: 'a Unicode character in Lt, Lm, or Lo',
      primitive: true,
    },

    // These rules are not truly primitive (they could be written in userland) but are defined
    // here for bootstrapping purposes.
    spaces: {
      body: new pexprs.Star(new pexprs.Apply('space')),
      formals: [],
    },
    space: {
      body: new pexprs.Range('\x00', ' '),
      formals: [],
      description: 'a space',
    },
  }
);

// This method is called from main.js once Ohm has loaded.
Grammar.initApplicationParser = function (grammar, builderFn) {
  ohmGrammar = grammar;
  buildGrammar = builderFn;
};
