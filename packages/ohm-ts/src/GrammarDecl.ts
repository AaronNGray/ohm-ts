import Grammar from './Grammar.js';
import InputStream from './InputStream.js';
import Interval from './Interval.js';
import {getDuplicates} from './common.js';
import * as errors from './errors.js';
import * as pexprs from './pexprs.js';
import PExpr, {type Formals} from './pexprs-main.js';

// --------------------------------------------------------------------
// Private Stuff
// --------------------------------------------------------------------

export interface Rule {   // !!! introduced
  body:PExpr;
  formals:Formals;  //
  description:string;
  source:Interval;
  primitive:boolean;
}

export type Rules = { [key:string]: Rule; };

// Constructors

export default class GrammarDecl {
  constructor(name:string) {
    this.name = name;
  }

  name:string;
  source?:Interval;
  superGrammar?:Grammar;
  rules:{[key: string]: Rule} = {};
  defaultStartRule?:string;

  // Helpers

  sourceInterval(startIdx:number, endIdx:number):Interval {
    return this.source!.subInterval(startIdx, endIdx - startIdx); // ??? !
  }

  ensureSuperGrammar():Grammar {
    if (!this.superGrammar) {
      this.withSuperGrammar(
        // TODO: The conditional expression below is an ugly hack. It's kind of ok because
        // I doubt anyone will ever try to declare a grammar called `BuiltInRules`. Still,
        // we should try to find a better way to do this.
        this.name === 'BuiltInRules' ? Grammar.ProtoBuiltInRules : Grammar.BuiltInRules
      );
    }
    return this.superGrammar!;    // ??? !
  }

  ensureSuperGrammarRuleForOverriding(name:string, source:Interval) {
    const ruleInfo = this.ensureSuperGrammar().rules[name];
    if (!ruleInfo) {
      throw errors.cannotOverrideUndeclaredRule(name, this.superGrammar!.name, source); // ??? !
    }
    return ruleInfo;
  }

  installOverriddenOrExtendedRule(name:string, formals:Formals, body:PExpr, source:Interval) {
    const duplicateParameterNames = getDuplicates(formals);
    if (duplicateParameterNames.length > 0) {
      throw errors.duplicateParameterNames(name, duplicateParameterNames, source);
    }
    const ruleInfo = this.ensureSuperGrammar().rules[name];
    const expectedFormals = ruleInfo.formals;
    const expectedNumFormals = expectedFormals ? expectedFormals.length : 0;
    if (formals.length !== expectedNumFormals) {
      throw errors.wrongNumberOfParameters(name, expectedNumFormals, formals.length, source);
    }
    return this.install(name, formals, body, ruleInfo.description, source);
  }

  install(name:string, formals:Formals, body:PExpr, description, source:Interval, primitive:boolean = false) {
    this.rules[name] = {
      body: body.introduceParams(formals),
      formals,
      description,
      source,
      primitive,
    };
    return this;
  }

  // Stuff that you should only do once

  withSuperGrammar(superGrammar:Grammar) {
    if (this.superGrammar) {
      throw new Error('the super grammar of a GrammarDecl cannot be set more than once');
    }
    this.superGrammar = superGrammar;
    this.rules = Object.create(superGrammar.rules);

    // Grammars with an explicit supergrammar inherit a default start rule.
    if (!superGrammar.isBuiltIn()) {
      this.defaultStartRule = superGrammar.defaultStartRule;
    }
    return this;
  }

  withDefaultStartRule(ruleName:string) {
    this.defaultStartRule = ruleName;
    return this;
  }

  withSource(source:string) {
    this.source = new InputStream(source).interval(0, source.length);
    return this;
  }

  // Creates a Grammar instance, and if it passes the sanity checks, returns it.
  build():Grammar {
    const grammar = new Grammar(
      this.name,
      this.ensureSuperGrammar(),
      this.rules,
      this.defaultStartRule
    );
    // Initialize internal props that are inherited from the super grammar.
    grammar._matchStateInitializer = grammar.superGrammar._matchStateInitializer;
    grammar.supportsIncrementalParsing = grammar.superGrammar.supportsIncrementalParsing;

    // TODO: change the pexpr.prototype.assert... methods to make them add
    // exceptions to an array that's provided as an arg. Then we'll be able to
    // show more than one error of the same type at a time.
    // TODO: include the offending pexpr in the errors, that way we can show
    // the part of the source that caused it.
    const grammarErrors = [];
    let grammarHasInvalidApplications = false;
    Object.keys(grammar.rules).forEach(ruleName => {
      const {body} = grammar.rules[ruleName];
      try {
        body.assertChoicesHaveUniformArity(ruleName);
      } catch (e) {
        grammarErrors.push(e);
      }
      try {
        body.assertAllApplicationsAreValid(ruleName, grammar);
      } catch (e) {
        grammarErrors.push(e);
        grammarHasInvalidApplications = true;
      }
    });
    if (!grammarHasInvalidApplications) {
      // The following check can only be done if the grammar has no invalid applications.
      Object.keys(grammar.rules).forEach(ruleName => {
        const {body} = grammar.rules[ruleName];
        try {
          body.assertIteratedExprsAreNotNullable(grammar, []);
        } catch (e) {
          grammarErrors.push(e);
        }
      });
    }
    if (grammarErrors.length > 0) {
      errors.throwErrors(grammarErrors);
    }
    if (this.source) {
      grammar.source = this.source;
    }

    return grammar;
  }

  // Rule declarations

  define(name:string, formals:Formals, body:PExpr, description, source:Interval, primitive?:boolean) {
    this.ensureSuperGrammar();
    if (this.superGrammar!.rules[name]) { // ??? !
      throw errors.duplicateRuleDeclaration(name, this.name, this.superGrammar!.name, source); // ??? !
    } else if (this.rules[name]) {
      throw errors.duplicateRuleDeclaration(name, this.name, this.name, source);
    }
    const duplicateParameterNames = getDuplicates(formals);
    if (duplicateParameterNames.length > 0) {
      throw errors.duplicateParameterNames(name, duplicateParameterNames, source);
    }
    return this.install(name, formals, body, description, source, primitive);
  }

  override(name:string, formals:Formals, body:PExpr, descIgnored, source:Interval) {
    this.ensureSuperGrammarRuleForOverriding(name, source);
    this.installOverriddenOrExtendedRule(name, formals, body, source);
    return this;
  }

  extend(name:string, formals:Formals, fragment:PExpr, descIgnored, source:Interval) {
    const ruleInfo = this.ensureSuperGrammar().rules[name];
    if (!ruleInfo) {
      throw errors.cannotExtendUndeclaredRule(name, this.superGrammar!.name, source); // ??? !
    }
    const body = new pexprs.Extend(this.superGrammar!, name, fragment); // ??? !
    body.source = fragment.source;
    this.installOverriddenOrExtendedRule(name, formals, body, source);
    return this;
  }
}
