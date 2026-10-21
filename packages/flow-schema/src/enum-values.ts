/**
 * Pertenencia a enumeraciones durante una sola ejecución del validador. Cada validación crea su
 * propia instancia, así que el conjunto de una lista se calcula una vez por ejecución y nunca se
 * reutiliza en la siguiente: quien llama puede modificar la lista entre validaciones, y el
 * resultado tiene que reflejar sus valores de ese momento. El límite `enumValues` acota las
 * listas; el conjunto evita además que comparar dos listas cueste O(n·m).
 */
export class EnumValueSets {
  readonly #sets = new Map<readonly string[], ReadonlySet<string>>();

  has(values: readonly string[], value: string): boolean {
    let set = this.#sets.get(values);
    if (set === undefined) {
      set = new Set(values);
      this.#sets.set(values, set);
    }
    return set.has(value);
  }
}
