export type FoodEntry = {
	id: string;
	timestamp: number;
	description: string;
	calories: number;
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
	source: 'ai' | 'upc' | 'manual' | 'ocr';
};

export type DailyLog = {
	[dateStr: string]: {
		entries: FoodEntry[];
	};
};

export type Favorite = {
	id: string;
	description: string;
	calories: number;
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
	source: FoodEntry['source'];
	savedAt: number;
};

export type NutritionResult = {
	description: string;
	calories: number;
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
	confidence?: 'high' | 'medium' | 'low';
	notes?: string;
};
