import type { DailyLog, FoodEntry } from './types';

const STORAGE_KEY = 'killacal_log';

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

export function getRecentDays(n: number): { date: string; total: number }[] {
	const log = getLog();
	const results: { date: string; total: number }[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const key = dateKey(d);
		const entries = log[key]?.entries ?? [];
		results.push({
			date: key,
			total: entries.reduce((sum, e) => sum + e.calories, 0)
		});
	}
	return results;
}
