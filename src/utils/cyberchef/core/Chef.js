/**
 * Chef.js
 * Master orchestrator for baking recipes, supporting breakpoints, debugging, and step-through.
 */

import { Dish } from './Dish.js';
import { Recipe } from './Recipe.js';

export class Chef {
  /**
   * Bake input through a recipe pipeline.
   * @param {string|ArrayBuffer|Dish} input
   * @param {Array<Object>} recipeConfig
   * @param {Object} [options={}] - Debugging options: { breakpoints, maxSteps, startStep, context }
   * @returns {Promise<Dish>}
   */
  async bake(input, recipeConfig = [], options = {}) {
    const dish = input instanceof Dish ? input : new Dish(input);
    const recipe = new Recipe(recipeConfig);
    return await recipe.execute(dish, options);
  }

  /**
   * Static helper to bake directly.
   * @param {string|ArrayBuffer|Dish} input
   * @param {Array<Object>} recipeConfig
   * @param {Object} [options={}]
   * @returns {Promise<Dish>}
   */
  static async bake(input, recipeConfig = [], options = {}) {
    const chef = new Chef();
    return await chef.bake(input, recipeConfig, options);
  }
}

export default Chef;
