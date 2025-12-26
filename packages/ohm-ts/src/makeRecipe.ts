import Builder from './Builder.js';
import Recipe from './pexprs-main.js';
import Grammar from './Grammar.js';

export function makeRecipe(recipe:any):Grammar {    // !!! type "(recipe:any)"
  if (typeof recipe === 'function') {
    return recipe.call(new Builder());
  } else {
    if (typeof recipe === 'string') {
      // stringified JSON recipe
      recipe = JSON.parse(recipe);
    }
    return new Builder().fromRecipe(recipe) as Grammar;
  }
}
