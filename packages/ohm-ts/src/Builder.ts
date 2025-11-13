import Grammar from './Grammar.js';
import GrammarDecl, {Rule, Rules} from './GrammarDecl.js';
import PExpr from './pexprs-main.js';
import * as pexprs from './pexprs.js';

// --------------------------------------------------------------------
// Private stuff
// --------------------------------------------------------------------

export default class Builder {
  constructor() {
    this.currentDecl = null;
    this.currentRuleName = null;
  }

  currentDecl:GrammarDecl | null;
  currentRuleName:string|null;

  newGrammar(name:string) {
    return new GrammarDecl(name);
  }

  grammar(metaInfo, name:string, superGrammar:Grammar, defaultStartRule:string, rules:Rules):Grammar {
    const gDecl = new GrammarDecl(name);
    if (superGrammar) {
      // `superGrammar` may be a recipe (i.e. an Array), or an actual grammar instance.
      gDecl.withSuperGrammar(
        superGrammar instanceof Grammar ? superGrammar : this.fromRecipe(superGrammar)
      );
    }
    if (defaultStartRule) {
      gDecl.withDefaultStartRule(defaultStartRule);
    }
    if (metaInfo && metaInfo.source) {
      gDecl.withSource(metaInfo.source);
    }

    this.currentDecl = gDecl;
    Object.keys(rules).forEach(ruleName => {
      this.currentRuleName = ruleName;
      const ruleRecipe = rules[ruleName];

      const action:string = ruleRecipe[0]; // define/extend/override
      const metaInfo = ruleRecipe[1];
      const description = ruleRecipe[2];
      const formals = ruleRecipe[3];
      const body = this.fromRecipe(ruleRecipe[4]);

      let source;
      if (gDecl.source && metaInfo && metaInfo.sourceInterval) {
        source = gDecl.source.subInterval(
          metaInfo.sourceInterval[0],
          metaInfo.sourceInterval[1] - metaInfo.sourceInterval[0]
        );
      }
      (gDecl[action] as Function)(ruleName, formals, body, description, source);
    });
    this.currentRuleName = this.currentDecl = null;
    return gDecl.build();
  }

  terminal(x:string):pexprs.Terminal {
    return new pexprs.Terminal(x);
  }

  range(from:string, to:string):pexprs.Range {
    return new pexprs.Range(from, to);
  }

  param(index:number):pexprs.Param {
    return new pexprs.Param(index);
  }

  alt(...termArgs:PExpr[]):pexprs.Alt {   // ??? !!!
    let terms = [];
    for (let arg of termArgs) {
      arg = arg instanceof PExpr ? arg : this.fromRecipe(arg);
      if (arg instanceof pexprs.Alt) {
        terms = terms.concat(arg.terms);
      } else {
        terms.push(arg);
      }
    }
    return terms.length === 1 ? terms[0] : new pexprs.Alt(terms);
  }

  seq(...factorArgs:PExpr[]):pexprs.Seq | PExpr {  // ??? !!!
    let factors:PExpr[] = [];
    for (let arg of factorArgs) {
      arg = arg instanceof PExpr ? arg : this.fromRecipe(arg);
      if (arg instanceof pexprs.Seq) {
        factors = factors.concat(arg.factors);
      } else {
        factors.push(arg);
      }
    }
    return factors.length === 1 ? factors[0] : new pexprs.Seq(factors);
  }

  star(expr:string | PExpr):pexprs.Star {
    expr = expr instanceof PExpr ? expr : this.fromRecipe(expr);
    return new pexprs.Star(expr);
  }

  plus(expr:string | PExpr):pexprs.Plus {
    expr = expr instanceof PExpr ? expr : this.fromRecipe(expr);
    return new pexprs.Plus(expr);
  }

  opt(expr:string | PExpr):pexprs.Opt {
    expr = expr instanceof PExpr ? expr : this.fromRecipe(expr);
    return new pexprs.Opt(expr);
  }

  not(expr:string | PExpr):pexprs.Not {
    expr = expr instanceof PExpr ? expr : this.fromRecipe(expr);
    return new pexprs.Not(expr);
  }

  lookahead(expr:string | PExpr) {
    if (!(expr instanceof PExpr)) {
      expr = this.fromRecipe(expr);
    }
    return new pexprs.Lookahead(expr);
  }

  lex(expr:string | PExpr):pexprs.Lex {
    if (!(expr instanceof PExpr)) {
      expr = this.fromRecipe(expr);
    }
    return new pexprs.Lex(expr);
  }

  app(ruleName:string, optParams?:PExpr[]):pexprs.Apply {
    if (optParams && optParams.length > 0) {
      optParams = optParams.map(function (param) {
        return param instanceof PExpr ? param : this.fromRecipe(param);
      }, this);
    }
    return new pexprs.Apply(ruleName, optParams);
  }

  // Note that unlike other methods in this class, this method cannot be used as a
  // convenience constructor. It only works with recipes, because it relies on
  // `this.currentDecl` and `this.currentRuleName` being set.
  splice(beforeTerms:PExpr[], afterTerms:PExpr[]):pexprs.Splice {
    return new pexprs.Splice(
      this.currentDecl.superGrammar,
      this.currentRuleName,
      beforeTerms.map(term => this.fromRecipe(term)),
      afterTerms.map(term => this.fromRecipe(term))
    );
  }

  fromRecipe(recipe:string[]|any):PExpr {
    // the meta-info of 'grammar' is processed in Builder.grammar
    const args = recipe[0] === 'grammar' ? recipe.slice(1) : recipe.slice(2);
    const result = this[recipe[0]](...args);    // !!! SOLVE: bad dispatch 

    const metaInfo = recipe[1];
    if (metaInfo) {
      if (metaInfo.sourceInterval && this.currentDecl) {
        result.withSource(this.currentDecl.sourceInterval(...metaInfo.sourceInterval));
      }
    }
    return result;
  }
}
