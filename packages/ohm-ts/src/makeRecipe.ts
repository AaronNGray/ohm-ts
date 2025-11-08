import Builder from './Builder.js';

export function makeRecipe(recipe:any) {
  if (typeof recipe === 'function') {
    return recipe.call(new Builder());
  } else {
    if (typeof recipe === 'string') {
      // stringified JSON recipe
      recipe = JSON.parse(recipe);
    }
    return new Builder().fromRecipe(recipe);
  }
}
