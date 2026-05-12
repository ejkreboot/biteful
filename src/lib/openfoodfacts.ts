import type { NutritionResult } from './types';

export async function lookupUPC(barcode: string): Promise<NutritionResult | null> {
	const res = await fetch(
		`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,nutriments,serving_size`
	);
	if (!res.ok) return null;
	const data = await res.json();
	if (data.status !== 1 || !data.product) return null;

	const p = data.product;
	const n = p.nutriments ?? {};

	const calories =
		Math.round(n['energy-kcal_serving'] ?? n['energy-kcal_100g'] ?? 0);
	const protein = Math.round(((n['proteins_serving'] ?? n['proteins_100g'] ?? 0) as number) * 10) / 10;
	const fat = Math.round(((n['fat_serving'] ?? n['fat_100g'] ?? 0) as number) * 10) / 10;
	const carbs = Math.round(((n['carbohydrates_serving'] ?? n['carbohydrates_100g'] ?? 0) as number) * 10) / 10;
	const fiber = Math.round(((n['fiber_serving'] ?? n['fiber_100g'] ?? 0) as number) * 10) / 10;

	return {
		description: p.product_name ?? 'Unknown product',
		calories,
		protein_g: protein,
		fat_g: fat,
		carbs_g: carbs,
		fiber_g: fiber,
		confidence: 'high',
		notes: p.serving_size ? `Per serving: ${p.serving_size}` : undefined
	};
}
