/**
 * Pertenencia a una enumeración, con un conjunto calculado una vez por lista de valores. El
 * límite `enumValues` ya acota las listas; el conjunto evita además que comparar dos listas cueste
 * O(n·m).
 */
const sets = new WeakMap<readonly string[], ReadonlySet<string>>();

export function enumValueSet(values: readonly string[]): ReadonlySet<string> {
  let set = sets.get(values);
  if (set === undefined) {
    set = new Set(values);
    sets.set(values, set);
  }
  return set;
}
