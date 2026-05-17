<script lang="ts">
	import { onMount } from 'svelte';
	import { getTodayEntries, addEntry, removeEntry, getRecentDays, getSavedGoal, getFavorites, addFavorite, removeFavoriteByDesc } from '$lib/storage';
	import { lookupUPC } from '$lib/openfoodfacts';
	import type { FoodEntry, Favorite, NutritionResult } from '$lib/types';
	import GoalModal from '$lib/GoalModal.svelte';

	// ── State ──────────────────────────────────────────────────────────────────
	let entries = $state<FoodEntry[]>([]);
	let recentDays = $state<{ date: string; total: number; protein_g: number; fat_g: number; carbs_g: number }[]>([]);
	let activeTab = $state<'ai' | 'scan' | 'manual' | 'favorites'>('ai');
	let favorites = $state<Favorite[]>([]);

	// AI tab
	let aiMode = $state<'text' | 'photo'>('text');
	let aiText = $state('');
	let aiPhotoFile = $state<File | null>(null);
	let aiPhotoPreviewUrl = $state('');
	let aiLoading = $state(false);
	let aiError = $state('');
	let aiPreview = $state<NutritionResult | null>(null);
	let aiServings = $state(1);

	// Scan tab
	let scanError = $state('');
	let scanLoading = $state(false);
	let scanPreview = $state<NutritionResult | null>(null);
	let showLabelCapture = $state(false);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let scannerActive = $state(false);
	let scanControls: { stop: () => void } | null = null;
	let scanServings = $state(1);

	// Manual tab
	let manualDescription = $state('');
	let manualCalories = $state('');
	let manualProtein = $state('');
	let manualFat = $state('');
	let manualCarbs = $state('');
	let manualFiber = $state('');

	let goal = $state(2000);
	let showGoalModal = $state(false);

	// ── Derived ───────────────────────────────────────────────────────────────
	const todayTotal = $derived(entries.reduce((sum, e) => sum + e.calories, 0));
	const goalPct = $derived(Math.min((todayTotal / goal) * 100, 100));
	const chartMax = $derived(Math.max(...recentDays.map((d) => d.total), goal, 100));

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMount(() => {
		entries = getTodayEntries();
		recentDays = getRecentDays(7);
		goal = getSavedGoal().dailyGoal;
		favorites = getFavorites();
	});

	// ── Helpers ───────────────────────────────────────────────────────────────
	function commitEntry(result: NutritionResult, source: FoodEntry['source']) {
		const entry: FoodEntry = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			description: result.description,
			calories: result.calories,
			protein_g: result.protein_g,
			fat_g: result.fat_g,
			carbs_g: result.carbs_g,
			fiber_g: result.fiber_g,
			source
		};
		addEntry(entry);
		entries = getTodayEntries();
		recentDays = getRecentDays(7);
	}

	function handleRemove(id: string) {
		removeEntry(id);
		entries = getTodayEntries();
		recentDays = getRecentDays(7);
	}

	function toggleFavorite(entry: FoodEntry) {
		if (favorites.some((f) => f.description === entry.description)) {
			removeFavoriteByDesc(entry.description);
		} else {
			addFavorite(entry);
		}
		favorites = getFavorites();
	}

	function logFavorite(fav: Favorite) {
		commitEntry({
			description: fav.description,
			calories: fav.calories,
			protein_g: fav.protein_g,
			fat_g: fav.fat_g,
			carbs_g: fav.carbs_g,
			fiber_g: fav.fiber_g
		}, fav.source);
	}

	function unfavorite(fav: Favorite) {
		removeFavoriteByDesc(fav.description);
		favorites = getFavorites();
	}

	function isToday(dateStr: string) {
		return dateStr === new Date().toLocaleDateString('en-CA');
	}

	// ── AI tab ────────────────────────────────────────────────────────────────
	function handleAiPhotoSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		aiPhotoFile = file;
		if (aiPhotoPreviewUrl) URL.revokeObjectURL(aiPhotoPreviewUrl);
		aiPhotoPreviewUrl = URL.createObjectURL(file);
	}

	async function handleAiEstimate() {
		aiLoading = true;
		aiError = '';
		aiPreview = null;
		try {
			let body: Record<string, string>;
			if (aiMode === 'photo' && aiPhotoFile) {
				const base64 = await fileToBase64(aiPhotoFile);
				body = { imageBase64: base64, mediaType: aiPhotoFile.type };
			} else {
				if (!aiText.trim()) return;
				body = { description: aiText };
			}
			const res = await fetch('/api/calories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(await res.text());
			aiPreview = await res.json();
		} catch (e: unknown) {
			aiError = e instanceof Error ? e.message : 'Something went wrong.';
		} finally {
			aiLoading = false;
		}
	}

	function confirmAi() {
		if (!aiPreview) return;
		const s = aiServings > 0 ? aiServings : 1;
		commitEntry({
			...aiPreview,
			calories: Math.round(aiPreview.calories * s),
			protein_g: Math.round(aiPreview.protein_g * s * 10) / 10,
			fat_g: Math.round(aiPreview.fat_g * s * 10) / 10,
			carbs_g: Math.round(aiPreview.carbs_g * s * 10) / 10,
			fiber_g: Math.round(aiPreview.fiber_g * s * 10) / 10
		}, 'ai');
		aiText = '';
		aiPhotoFile = null;
		if (aiPhotoPreviewUrl) { URL.revokeObjectURL(aiPhotoPreviewUrl); aiPhotoPreviewUrl = ''; }
		aiPreview = null;
		aiServings = 1;
	}

	// ── Scan tab ──────────────────────────────────────────────────────────────
	async function startScanner() {
		scanError = '';
		scanPreview = null;
		showLabelCapture = false;
		scannerActive = true;

		const { BrowserMultiFormatReader } = await import('@zxing/browser');
		const codeReader = new BrowserMultiFormatReader();
		try {
			scanControls = await codeReader.decodeFromVideoDevice(undefined, videoEl!, async (result) => {
				if (result) {
					stopScanner();
					await handleBarcode(result.getText());
				}
			});
		} catch {
			scanError = 'Camera access denied or unavailable.';
			scannerActive = false;
		}
	}

	function stopScanner() {
		scanControls?.stop();
		scanControls = null;
		scannerActive = false;
	}

	async function handleBarcode(code: string) {
		scanLoading = true;
		scanError = '';
		try {
			const result = await lookupUPC(code);
			if (result) {
				scanPreview = result;
			} else {
				showLabelCapture = true;
			}
		} catch {
			scanError = 'Failed to look up barcode.';
		} finally {
			scanLoading = false;
		}
	}

	function confirmScan() {
		if (!scanPreview) return;
		const s = scanServings > 0 ? scanServings : 1;
		commitEntry({
			...scanPreview,
			calories: Math.round(scanPreview.calories * s),
			protein_g: Math.round(scanPreview.protein_g * s * 10) / 10,
			fat_g: Math.round(scanPreview.fat_g * s * 10) / 10,
			carbs_g: Math.round(scanPreview.carbs_g * s * 10) / 10,
			fiber_g: Math.round(scanPreview.fiber_g * s * 10) / 10
		}, 'upc');
		scanPreview = null;
		showLabelCapture = false;
		scanServings = 1;
	}

	async function handleLabelPhoto(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		scanLoading = true;
		scanError = '';
		try {
			const base64 = await fileToBase64(file);
			const res = await fetch('/api/label-ocr', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageBase64: base64, mediaType: file.type })
			});
			if (!res.ok) throw new Error(await res.text());
			scanPreview = await res.json();
			showLabelCapture = false;
		} catch (e: unknown) {
			scanError = e instanceof Error ? e.message : 'OCR failed.';
		} finally {
			scanLoading = false;
			input.value = '';
		}
	}

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve((reader.result as string).split(',')[1]);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	// ── Manual tab ────────────────────────────────────────────────────────────
	function handleManualAdd() {
		const cal = parseInt(manualCalories);
		if (!manualDescription.trim() || isNaN(cal) || cal <= 0) return;
		commitEntry(
			{
				description: manualDescription.trim(),
				calories: cal,
				protein_g: parseFloat(manualProtein) || 0,
				fat_g: parseFloat(manualFat) || 0,
				carbs_g: parseFloat(manualCarbs) || 0,
				fiber_g: parseFloat(manualFiber) || 0
			},
			'manual'
		);
		manualDescription = '';
		manualCalories = '';
		manualProtein = '';
		manualFat = '';
		manualCarbs = '';
		manualFiber = '';
	}
</script>

<main class="max-w-lg mx-auto px-4 py-8 space-y-8">

	<!-- ── Header ─────────────────────────────────────────────────────────── -->
	<header class="text-center space-y-1">
		<div class="flex items-center justify-center gap-2.5">
			<img src="/logo_64.webp" alt="Biteful logo" width="36" height="36" class="rounded-xl" />
			<h1 class="text-2xl font-semibold tracking-tight text-gray-900 font-display">Biteful</h1>
		</div>
		<p class="text-sm text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
	</header>

	<!-- ── Today's total ──────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
		<div class="flex items-end justify-between">
			<div>
				<p class="text-xs font-medium uppercase tracking-widest text-gray-400 font-display">Today</p>
				<p class="text-5xl font-semibold tabular-nums text-gray-900 mt-1 font-display">
					{todayTotal.toLocaleString()}
					<span class="text-lg font-normal text-gray-400">cal</span>
				</p>
			</div>
			<button
					onclick={() => showGoalModal = true}
					class="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 pb-1 transition-colors group"
					title="Edit goal"
				>
					{goal.toLocaleString()} goal
					<svg class="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487a2.1 2.1 0 112.97 2.97L8.19 19.1a4 4 0 01-1.65.998l-2.675.669.669-2.675a4 4 0 01.998-1.65L16.862 4.487z"/></svg>
				</button>
		</div>
		<!-- Progress bar -->
		<div class="h-2 bg-gray-100 rounded-full overflow-hidden">
			<div
				class="h-full rounded-full transition-all duration-500"
				class:bg-green-500={todayTotal <= goal}
				class:bg-amber-400={todayTotal > goal && todayTotal <= goal * 1.15}
				class:bg-red-400={todayTotal > goal * 1.15}
				style="width: {goalPct}%"
			></div>
		</div>
	</section>

	<!-- ── 7-day chart ────────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
		<p class="text-xs font-medium uppercase tracking-widest text-gray-400 mb-4 font-display">Last 7 days</p>
		<div class="flex items-end gap-2 h-20">
			{#each recentDays as day}
				{@const barPct    = chartMax > 0 ? (day.total / chartMax) * 100 : 0}
				{@const today     = isToday(day.date)}
				{@const pKcal     = day.protein_g * 4}
				{@const cKcal     = day.carbs_g   * 4}
				{@const hasMacros = (pKcal + cKcal) > 0 && day.total > 0}
				{@const pPct      = hasMacros ? Math.min((pKcal / day.total) * 100, 100)          : 0}
				{@const cPct      = hasMacros ? Math.min((cKcal / day.total) * 100, 100 - pPct)   : 0}
				{@const fPct      = hasMacros ? Math.max(100 - pPct - cPct, 0)                    : 100}
				{@const tip       = hasMacros
					? `${day.date}\n${day.total} cal\nProtein ${Math.round(day.protein_g)}g  Carbs ${Math.round(day.carbs_g)}g  Fat ${Math.round(day.fat_g)}g`
					: day.total > 0 ? `${day.date}: ${day.total} cal` : day.date}
				<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
					<div
						class="w-full rounded-t overflow-hidden flex flex-col transition-all duration-500"
						style="height: {Math.max(barPct, day.total > 0 ? 4 : 0)}%"
						title={tip}
					>
						{#if !hasMacros}
							<div class="w-full h-full"
								class:bg-green-500={today}
								class:bg-gray-200={!today && day.total > 0}
								class:bg-gray-100={day.total === 0}
							></div>
						{:else}
							<div class="w-full shrink-0" class:bg-sky-400={today} class:bg-sky-200={!today}   style="height:{pPct}%"></div>
							<div class="w-full shrink-0" class:bg-gray-300={today} class:bg-gray-200={!today} style="height:{fPct}%"></div>
							<div class="w-full shrink-0" class:bg-amber-300={today} class:bg-amber-200={!today} style="height:{cPct}%"></div>
						{/if}
					</div>
					<span class="text-[10px] text-gray-400">{new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}</span>
				</div>
			{/each}
		</div>
		<div class="flex items-center justify-center gap-4 mt-3">
			<span class="flex items-center gap-1.5 text-[10px] text-gray-400"><span class="w-2 h-2 rounded-full bg-sky-300 inline-block"></span>Protein</span>
			<span class="flex items-center gap-1.5 text-[10px] text-gray-400"><span class="w-2 h-2 rounded-full bg-amber-200 inline-block"></span>Carbs</span>
			<span class="flex items-center gap-1.5 text-[10px] text-gray-400"><span class="w-2 h-2 rounded-full bg-gray-300 inline-block"></span>Fat</span>
		</div>
		<p class="text-[10px] text-gray-300 mt-1 text-right">goal: {goal.toLocaleString()} cal</p>
	</section>

	<!-- ── Entry tabs ─────────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
		<!-- Tab bar -->
		<div class="grid grid-cols-4 border-b border-gray-100">
			{#each (['ai', 'scan', 'manual', 'favorites'] as const) as tab}
				<button
					onclick={() => { activeTab = tab; stopScanner(); }}
					class="py-3 text-sm font-medium transition-colors font-display relative"
					class:text-brand={activeTab === tab}
					class:border-b-2={activeTab === tab}
					class:border-brand={activeTab === tab}
					class:text-gray-400={activeTab !== tab}
				>
					{tab === 'ai' ? '✦ AI' : tab === 'scan' ? '⊡ Scan' : tab === 'manual' ? '+ Manual' : '★ Saved'}
					{#if tab === 'favorites' && favorites.length > 0}
						<span class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-brand"></span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- ── AI panel ───────────────────────────────────────────────── -->
		{#if activeTab === 'ai'}
			<div class="p-5 space-y-3">
				<!-- mode toggle -->
				<div class="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
					<button
						onclick={() => { aiMode = 'text'; aiPhotoFile = null; if (aiPhotoPreviewUrl) { URL.revokeObjectURL(aiPhotoPreviewUrl); aiPhotoPreviewUrl = ''; } aiPreview = null; aiError = ''; }}
						class="flex-1 py-2 transition-colors {aiMode === 'text' ? 'bg-brand text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}"
					>
						Describe
					</button>
					<button
						onclick={() => { aiMode = 'photo'; aiText = ''; aiPreview = null; aiError = ''; }}
						class="flex-1 py-2 transition-colors {aiMode === 'photo' ? 'bg-brand text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}"
					>
						Photo
					</button>
				</div>

				{#if aiMode === 'text'}
					<textarea
						bind:value={aiText}
						placeholder="Describe what you ate — e.g. 'two scrambled eggs and toast with butter'"
						rows={3}
						class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300"
					></textarea>
				{:else}
					<label class="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-brand transition-colors overflow-hidden {aiPhotoPreviewUrl ? 'p-0' : 'p-6'}">
						{#if aiPhotoPreviewUrl}
							<img src={aiPhotoPreviewUrl} alt="Food photo preview" class="w-full max-h-56 object-cover" />
							<span class="text-xs text-gray-400 py-2">Tap to change photo</span>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
							</svg>
							<span class="text-sm text-gray-400">Tap to add a photo of your food</span>
						{/if}
						<input type="file" accept="image/*" class="hidden" onchange={handleAiPhotoSelect} />
					</label>
				{/if}

				{#if aiError}
					<p class="text-xs text-red-500">{aiError}</p>
				{/if}

				{#if aiPreview}
				{@const s = aiServings > 0 ? aiServings : 1}
				<div class="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
					<p class="text-sm font-medium text-gray-800">{aiPreview.description}</p>
					<p class="text-[11px] text-gray-400">Per serving</p>
					<div class="flex gap-4 text-xs text-gray-500">
						<span><b class="text-gray-800">{aiPreview.calories}</b> cal</span>
						<span>{aiPreview.protein_g}g protein</span>
						<span>{aiPreview.fat_g}g fat</span>
						<span>{aiPreview.carbs_g}g carbs</span>
					</div>
					{#if aiPreview.notes}
						<p class="text-[11px] text-gray-400 italic">{aiPreview.notes}</p>
					{/if}
					<div class="flex items-center gap-3 pt-1">
						<label for="ai-servings" class="text-xs text-gray-500 whitespace-nowrap">Servings</label>
						<input
							id="ai-servings"
							bind:value={aiServings}
							type="number"
							min="0.25"
							step="0.25"
							class="w-20 text-sm rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand text-center"
						/>
						<span class="text-xs text-gray-400">= <b class="text-gray-700">{Math.round(aiPreview.calories * s)}</b> cal</span>
					</div>
					<div class="flex gap-2 pt-1">
						<button onclick={confirmAi} class="flex-1 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg py-2 transition-colors">
							Add to log
						</button>
						<button onclick={() => { aiPreview = null; aiServings = 1; }} class="px-4 text-sm text-gray-400 hover:text-gray-600 transition-colors">
							Edit
						</button>
					</div>
				</div>
				{/if}

				{#if !aiPreview}
					<button
						onclick={handleAiEstimate}
						disabled={aiLoading || (aiMode === 'text' ? !aiText.trim() : !aiPhotoFile)}
						class="w-full bg-brand hover:bg-brand-dark disabled:bg-gray-100 disabled:text-gray-300 text-white text-sm font-medium rounded-xl py-3 transition-colors flex items-center justify-center gap-2"
					>
						{#if aiLoading}
							<svg class="animate-spin h-5 w-5" style="color: #6bcc3c" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Estimating…
						{:else}
							Estimate calories
						{/if}
					</button>
				{/if}
			</div>

		<!-- ── Scan panel ─────────────────────────────────────────────── -->
		{:else if activeTab === 'scan'}
			<div class="p-5 space-y-4">
				{#if !scannerActive && !scanPreview && !showLabelCapture}
					<button
						onclick={startScanner}
						class="w-full bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-xl py-3 transition-colors"
					>
						Start camera scan
					</button>
				{/if}

				<!-- Video viewfinder -->
				<div class="relative overflow-hidden rounded-xl bg-black" class:hidden={!scannerActive}>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video bind:this={videoEl} class="w-full aspect-video object-cover"></video>
					<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
						<div class="w-48 h-32 border-2 border-white/60 rounded-lg"></div>
					</div>
					<button
						onclick={stopScanner}
						class="absolute top-3 right-3 bg-black/50 text-white text-xs rounded-lg px-3 py-1"
					>Cancel</button>
				</div>

				{#if scanLoading}
					<p class="text-sm text-gray-400 text-center">Looking up barcode…</p>
				{/if}

				{#if scanError}
					<p class="text-xs text-red-500">{scanError}</p>
				{/if}

				<!-- Not found → offer OCR -->
				{#if showLabelCapture}
					<div class="rounded-xl bg-amber-50 border border-amber-100 p-4 space-y-3">
						<p class="text-sm font-medium text-amber-800">Product not found in database</p>
						<p class="text-xs text-amber-600">Photograph the nutrition facts label and we'll read it for you.</p>
						<label class="block w-full">
							<span class="block w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg py-2 text-center cursor-pointer transition-colors">
								{scanLoading ? 'Reading label…' : 'Take photo of label'}
							</span>
							<input
								type="file"
								accept="image/*"
								capture="environment"
								class="hidden"
								onchange={handleLabelPhoto}
							/>
						</label>
					</div>
				{/if}

				<!-- Scan result preview -->
				{#if scanPreview}
					{@const s = scanServings > 0 ? scanServings : 1}
					<div class="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
						<p class="text-sm font-medium text-gray-800">{scanPreview.description}</p>
						<p class="text-[11px] text-gray-400">Per serving</p>
						<div class="flex gap-4 text-xs text-gray-500">
							<span><b class="text-gray-800">{scanPreview.calories}</b> cal</span>
							<span>{scanPreview.protein_g}g protein</span>
							<span>{scanPreview.fat_g}g fat</span>
							<span>{scanPreview.carbs_g}g carbs</span>
						</div>
						{#if scanPreview.notes}
							<p class="text-[11px] text-gray-400 italic">{scanPreview.notes}</p>
						{/if}
						<div class="flex items-center gap-3 pt-1">
							<label for="scan-servings" class="text-xs text-gray-500 whitespace-nowrap">Servings</label>
							<input
								id="scan-servings"
								bind:value={scanServings}
								type="number"
								min="0.25"
								step="0.25"
								class="w-20 text-sm rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand text-center"
							/>
							<span class="text-xs text-gray-400">= <b class="text-gray-700">{Math.round(scanPreview.calories * s)}</b> cal</span>
						</div>
						<div class="flex gap-2 pt-1">
							<button onclick={confirmScan} class="flex-1 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg py-2 transition-colors">
								Add to log
							</button>
							<button onclick={() => { scanPreview = null; scanServings = 1; }} class="px-4 text-sm text-gray-400 hover:text-gray-600 transition-colors">
								Discard
							</button>
						</div>
					</div>
				{/if}
			</div>

		<!-- ── Manual panel ───────────────────────────────────────────── -->
		{:else if activeTab === 'manual'}
			<div class="p-5 space-y-3">
				<input
					bind:value={manualDescription}
					type="text"
					placeholder="Description"
					class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300"
				/>
				<input
					bind:value={manualCalories}
					type="number"
					placeholder="Calories *"
					min="0"
					class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300"
				/>
				<div class="grid grid-cols-3 gap-2">
					<input bind:value={manualProtein} type="number" placeholder="Protein (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300 w-full" />
					<input bind:value={manualFat} type="number" placeholder="Fat (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300 w-full" />
					<input bind:value={manualCarbs} type="number" placeholder="Carbs (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300 w-full" />
				</div>
				<button
					onclick={handleManualAdd}
					disabled={!manualDescription.trim() || !manualCalories}
					class="w-full bg-brand hover:bg-brand-dark disabled:bg-gray-100 disabled:text-gray-300 text-white text-sm font-medium rounded-xl py-3 transition-colors"
				>
					Add to log
				</button>
			</div>

		<!-- ── Saved panel ────────────────────────────────────────────── -->
		{:else if activeTab === 'favorites'}
			<div class="p-5">
				{#if favorites.length === 0}
					<p class="text-sm text-gray-400 text-center py-6">No saved items yet.<br/>Tap ☆ on any log entry to save it.</p>
				{:else}
					<ul class="space-y-2">
						{#each favorites as fav (fav.id)}
							<li class="flex items-center gap-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium text-gray-800 truncate">{fav.description}</p>
									<p class="text-xs text-gray-400 mt-0.5">{fav.calories} cal
										{#if fav.protein_g > 0}· {fav.protein_g}g protein{/if}
									</p>
								</div>
								<button
									onclick={() => logFavorite(fav)}
									class="shrink-0 bg-brand hover:bg-brand-dark text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
								>Add</button>
								<button
									onclick={() => unfavorite(fav)}
									class="shrink-0 text-brand hover:text-gray-400 transition-colors text-base leading-none"
									aria-label="Remove from saved"
								>★</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── Today's entries ────────────────────────────────────────────────── -->
	{#if entries.length > 0}
		<section class="space-y-2">
			<p class="text-xs font-medium uppercase tracking-widest text-gray-400 px-1 font-display">Today's log</p>
			{#each [...entries].reverse() as entry (entry.id)}
				<div class="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center gap-3">
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-gray-800 truncate">{entry.description}</p>
						<p class="text-xs text-gray-400 mt-0.5">
							{entry.calories} cal
							{#if entry.protein_g > 0}· {entry.protein_g}g protein{/if}
							{#if entry.fat_g > 0}· {entry.fat_g}g fat{/if}
							{#if entry.carbs_g > 0}· {entry.carbs_g}g carbs{/if}
						</p>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<span class="text-[10px] uppercase tracking-wide text-gray-300">{entry.source}</span>
						<button
							onclick={() => toggleFavorite(entry)}
							class="transition-colors text-base leading-none"
							class:text-brand={favorites.some(f => f.description === entry.description)}
							class:text-gray-200={!favorites.some(f => f.description === entry.description)}
							aria-label="Save to favorites"
						>{favorites.some(f => f.description === entry.description) ? '★' : '☆'}</button>
						<button
							onclick={() => handleRemove(entry.id)}
							class="text-gray-200 hover:text-red-400 transition-colors text-lg leading-none"
							aria-label="Remove entry"
						>×</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}

</main>

<GoalModal bind:open={showGoalModal} onSave={(g) => { goal = g; }} />
