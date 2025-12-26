import ohmGrammar from '../dist/ohm-grammar.js';
import Builder from './Builder.js';
import MatchResult from './Matcher.js';
import Matcher from './Matcher.js';
import * as common from './common.js';
import * as errors from './errors.js';
import Grammar from './Grammar.js';
import GrammarDecl from './GrammarDecl.js';
import Interval from './Interval.js';
import {Wrapper} from './Semantics.js';
import PExpr, {Formals} from './pexprs-main.js';
import * as pexprs from './pexprs.js';

export type Namespace = { [key: string]:Grammar};

const superSplicePlaceholder = Object.create(PExpr.prototype);  // ???

function namespaceHas(ns:Namespace, name:string):boolean {
  // Look for an enumerable property, anywhere in the prototype chain.
  for (const prop in ns) {
    if (prop === name) return true;
  }
  return false;
}

abstract class Visitor {
  abstract visit(...params:any[]):any;
  source:Interval;
};

class Visitors { children:Visitor[]; };


// Returns a Grammar instance (i.e., an object with a `match` method) for
// `tree`, which is the concrete syntax tree of a user-written grammar.
// The grammar will be assigned into `namespace` under the name of the grammar
// as specified in the source.
export function buildGrammar(match:MatchResult, namespace:Namespace, optOhmGrammarForTesting?:Grammar):any {
  const builder = new Builder();
  let decl:GrammarDecl;
  let currentRuleName:string;
  let currentRuleFormals:Formals;
  let overriding = false;
  const metaGrammar:Grammar = optOhmGrammarForTesting || ohmGrammar;

  // A visitor that produces a Grammar instance from the CST.
  const helpers = metaGrammar.createSemantics().addOperation('visit', {
    Grammars(grammarIter:Visitors):Grammar[] {
      return grammarIter.children.map(c => c.visit());
    },
    Grammar(id:Visitor, s:Wrapper, _open, rules:Visitors, _close):Grammar {
      const grammarName = id.visit();
      decl = builder.newGrammar(grammarName);
      s.child(0) && s.child(0).visit();
      rules.children.map(c => c.visit());
      const g = decl.build();
      g.source = this.source.trimmed();
      if (namespaceHas(namespace, grammarName)) {
        throw errors.duplicateGrammarDeclaration(g, namespace);
      }
      namespace[grammarName] = g;
      return g;
    },

    SuperGrammar(_, n:Visitor) {
      const superGrammarName = n.visit();
      if (superGrammarName === 'null') {
        decl.withSuperGrammar(null);
      } else {
        if (!namespace || !namespaceHas(namespace, superGrammarName)) {
          throw errors.undeclaredGrammar(superGrammarName, namespace, n.source);
        }
        decl.withSuperGrammar(namespace[superGrammarName]);
      }
    },

    Rule_define(n:Visitor, fs:Visitors, d:Visitors, _, b) {
      currentRuleName = n.visit();
      currentRuleFormals = fs.children.map(c => c.visit())[0] || [];
      // If there is no default start rule yet, set it now. This must be done before visiting
      // the body, because it might contain an inline rule definition.
      if (!decl.defaultStartRule && decl.ensureSuperGrammar() !== Grammar.ProtoBuiltInRules) {
        decl.withDefaultStartRule(currentRuleName);
      }
      const body = b.visit();
      const description = d.children.map(c => c.visit())[0];
      const source = this.source.trimmed();
      return decl.define(currentRuleName, currentRuleFormals, body, description, source);
    },
    Rule_override(n:Visitor, fs, _, b) {
      currentRuleName = n.visit();
      currentRuleFormals = fs.children.map(c => c.visit())[0] || [];

      const source = this.source.trimmed();
      decl.ensureSuperGrammarRuleForOverriding(currentRuleName, source);

      overriding = true;
      const body = b.visit();
      overriding = false;
      return decl.override(currentRuleName, currentRuleFormals, body, null, source);
    },
    Rule_extend(n:Visitor, fs:Visitors, _, b:Visitor) {
      currentRuleName = n.visit();
      currentRuleFormals = fs.children.map(c => c.visit())[0] || [];
      const body = b.visit();
      const source = this.source.trimmed();
      return decl.extend(currentRuleName, currentRuleFormals, body, null, source);
    },
    RuleBody(_, terms:Visitor) {
      return builder.alt(...terms.visit()).withSource(this.source);
    },
    OverrideRuleBody(_, terms:Visitor) {
      const args = terms.visit();

      // Check if the super-splice operator (`...`) appears in the terms.
      const expansionPos = args.indexOf(superSplicePlaceholder);
      if (expansionPos >= 0) {
        const beforeTerms = args.slice(0, expansionPos);
        const afterTerms = args.slice(expansionPos + 1);

        // Ensure it appears no more than once.
        afterTerms.forEach(t => {
          if (t === superSplicePlaceholder) throw errors.multipleSuperSplices(t);
        });

        return new pexprs.Splice(
          decl.superGrammar,
          currentRuleName,
          beforeTerms,
          afterTerms
        ).withSource(this.source);
      } else {
        return builder.alt(...args).withSource(this.source);
      }
    },
    Formals(opointy, fs:Visitor, cpointy) {
      return fs.visit();
    },

    Params(opointy, ps:Visitor, cpointy) {
      return ps.visit();
    },

    Alt(seqs:Visitor) {
      return builder.alt(...seqs.visit()).withSource(this.source);
    },

    TopLevelTerm_inline(b, n:Visitor) {
      const inlineRuleName = currentRuleName + '_' + n.visit();
      const body = b.visit();
      const source = this.source.trimmed();
      const isNewRuleDeclaration = !(
        decl.superGrammar && decl.superGrammar.rules[inlineRuleName]
      );
      if (overriding && !isNewRuleDeclaration) {
        decl.override(inlineRuleName, currentRuleFormals, body, null, source);
      } else {
        decl.define(inlineRuleName, currentRuleFormals, body, null, source);
      }
      const params = currentRuleFormals.map((formal:string) => builder.app(formal)); // ??? formal:string ??? PExpr .v. PExpr.Apply
      return builder.app(inlineRuleName, params).withSource(body.source);
    },
    OverrideTopLevelTerm_superSplice(_) {
      return superSplicePlaceholder;
    },

    Seq(expr:Visitors) {
      return builder.seq(...expr.children.map(c => c.visit())).withSource(this.source);
    },

    Iter_star(x:Visitor, _) {
      return builder.star(x.visit()).withSource(this.source);
    },
    Iter_plus(x:Visitor, _) {
      return builder.plus(x.visit()).withSource(this.source);
    },
    Iter_opt(x:Visitor, _) {
      return builder.opt(x.visit()).withSource(this.source);
    },

    Pred_not(_, x:Visitor) {
      return builder.not(x.visit()).withSource(this.source);
    },
    Pred_lookahead(_, x:Visitor) {
      return builder.lookahead(x.visit()).withSource(this.source);
    },

    Lex_lex(_, x:Visitor) {
      return builder.lex(x.visit()).withSource(this.source);
    },

    Base_application(rule:Visitor, ps) {
      const params = ps.children.map(c => c.visit())[0] || [];
      return builder.app(rule.visit(), params).withSource(this.source);
    },
    Base_range(from:Visitor, _, to:Visitor) {
      return builder.range(from.visit(), to.visit()).withSource(this.source);
    },
    Base_terminal(expr:Visitor) {
      return builder.terminal(expr.visit()).withSource(this.source);
    },
    Base_paren(open, x:Visitor, close) {
      return x.visit();
    },

    ruleDescr(open, t:Visitor, close) {
      return t.visit();
    },
    ruleDescrText(_) {
      return this.sourceString.trim();
    },

    caseName(_, space1, n:Visitor, space2, end) {
      return n.visit();
    },

    name(_, rest) {
      return this.sourceString;
    },
    nameFirst(_) {},
    nameRest(_) {},

    terminal(_, cs:Visitors, __) {
      return cs.children.map(c => c.visit()).join('');
    },

    oneCharTerminal(open, c:Visitor, close) {
      return c.visit();
    },

    escapeChar(c:string):string|never {
      try {
        return common.unescapeCodePoint(this.sourceString);
      } catch (err) {
        if (err instanceof RangeError && err.message.startsWith('Invalid code point ')) {
          throw errors.invalidCodePoint(c);
        }
        throw err; // Rethrow
      }
    },

    NonemptyListOf(x:Visitor, _, xs:Visitors) {
      return [x.visit()].concat(xs.children.map(c => c.visit()));
    },
    EmptyListOf():any[] {
      return [];
    },

    _terminal():string {
      return this.sourceString;
    }
  });

  return helpers(match).visit();
}
