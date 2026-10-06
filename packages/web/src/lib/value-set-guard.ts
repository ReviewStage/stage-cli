/** Builds a type guard for the values of an `as const` enum-like object. */
export function createValueSetGuard<T extends string>(values: Record<string, T>) {
	const valueSet = new Set<string>(Object.values(values));
	return (value: string): value is T => valueSet.has(value);
}
