import type { DailyLog, FoodEntry, Favorite } from './types';

const STORAGE_KEY = 'biteful_log';
const GOAL_KEY = 'biteful_goal';
const FAVORITES_KEY = 'biteful_favorites';

export type GoalInputs = {
	sex: 'male' | 'female';
	age: string;
	heightFt: string;
	heightIn: string;
	weightLbs: string;
	activity: string;
	goalWeightLbs: string;
	weeksToGoal: string;
};

export type GoalData = {
	dailyGoal: number;
	inputs?: GoalInputs;
};

export function getSavedGoal(): GoalData {
	if (typeof localStorage === 'undefined') return { dailyGoal: 2000 };
	try {
		return JSON.parse(localStorage.getItem(GOAL_KEY) ?? '{"dailyGoal":2000}');
	} catch {
		return { dailyGoal: 2000 };
	}
}

export function saveGoalData(data: GoalData): void {
	localStorage.setItem(GOAL_KEY, JSON.stringify(data));
}

function getLog(): DailyLog {
	if (typeof localStorage === 'undefined') return {};
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

function saveLog(log: DailyLog): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

function dateKey(date = new Date()): string {
	return date.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

export function getTodayEntries(): FoodEntry[] {
	const log = getLog();
	return log[dateKey()]?.entries ?? [];
}

export function addEntry(entry: FoodEntry): void {
	const log = getLog();
	const key = dateKey();
	if (!log[key]) log[key] = { entries: [] };
	log[key].entries.push(entry);
	saveLog(log);
}

export function removeEntry(id: string): void {
	const log = getLog();
	const key = dateKey();
	if (!log[key]) return;
	log[key].entries = log[key].entries.filter((e) => e.id !== id);
	saveLog(log);
}

export function getFavorites(): Favorite[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
	} catch {
		return [];
	}
}

export function addFavorite(entry: FoodEntry): void {
	const favs = getFavorites();
	if (favs.some((f) => f.description === entry.description)) return;
	favs.unshift({
		id: crypto.randomUUID(),
		description: entry.description,
		calories: entry.calories,
		protein_g: entry.protein_g,
		fat_g: entry.fat_g,
		carbs_g: entry.carbs_g,
		fiber_g: entry.fiber_g,
		source: entry.source,
		savedAt: Date.now()
	});
	localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

export function removeFavoriteByDesc(description: string): void {
	const favs = getFavorites().filter((f) => f.description !== description);
	localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

export function getRecentDays(n: number): { date: string; total: number; protein_g: number; fat_g: number; carbs_g: number }[] {
	const log = getLog();
	const results: { date: string; total: number; protein_g: number; fat_g: number; carbs_g: number }[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const key = dateKey(d);
		const entries = log[key]?.entries ?? [];
		results.push({
			date:      key,
			total:     entries.reduce((sum, e) => sum + e.calories,          0),
			protein_g: entries.reduce((sum, e) => sum + (e.protein_g ?? 0),  0),
			fat_g:     entries.reduce((sum, e) => sum + (e.fat_g     ?? 0),  0),
			carbs_g:   entries.reduce((sum, e) => sum + (e.carbs_g   ?? 0),  0),
		});
	}
	return results;
}
