import { TIKZ_RECIPES, type TikzRecipe } from './tikz-recipes';

export function buildTikzContextForProblem(problem: string): string {
  const normalized = problem.toLowerCase();
  const hits: TikzRecipe[] = TIKZ_RECIPES
    .filter((recipe) => recipe.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
    .slice(0, 3);

  if (hits.length === 0) return '';
  return hits.map((recipe) => `### ${recipe.title}\n${recipe.snippet}`).join('\n\n');
}

