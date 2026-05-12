<script lang="ts">
	import { onMount } from 'svelte';
	import { getTodayEntries, addEntry, removeEntry, getRecentDays } from '$lib/storage';
	import { lookupUPC } from '$lib/openfoodfacts';
	import type { FoodEntry, NutritionResult } from '$lib/types';

	// ── State ──────────────────────────────────────────────────────────────────
	let entries = $state<FoodEntry[]>([]);
	let recentDays = $state<{ date: string; total: number }[]>([]);
	let activeTab = $state<'ai' | 'scan' | 'manual'>('ai');

	// AI tab
	let aiText = $state('');
	let aiLoading = $state(false);
	let aiError = $state('');
	let aiPreview = $state<NutritionResult | null>(null);

	// Scan tab
	let scanError = $state('');
	let scanLoading = $state(false);
	let scanPreview = $state<NutritionResult | null>(null);
	let showLabelCapture = $state(false);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let scannerActive = $state(false);
	let codeReader: import('@zxing/browser').BrowserMultiFormatReader | null = null;

	// Manual tab
	let manualDescription = $state('');
	let manualCalories = $state('');
	let manualProtein = $state('');
	let manualFat = $state('');
	let manualCarbs = $state('');
	let manualFiber = $state('');

	// ── Derived ───────────────────────────────────────────────────────────────
	const todayTotal = $derived(entries.reduce((sum, e) => sum + e.calories, 0));
	const GOAL = 2000;
	const goalPct = $derived(Math.min((todayTotal / GOAL) * 100, 100));
	const chartMax = $derived(Math.max(...recentDays.map((d) => d.total), GOAL, 100));

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMount(() => {
		entries = getTodayEntries();
		recentDays = getRecentDays(7);
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

	function isToday(dateStr: string) {
		return dateStr === new Date().toLocaleDateString('en-CA');
	}

	// ── AI tab ────────────────────────────────────────────────────────────────
	async function handleAiEstimate() {
		if (!aiText.trim()) return;
		aiLoading = true;
		aiError = '';
		aiPreview = null;
		try {
			const res = await fetch('/api/calories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: aiText })
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
		commitEntry(aiPreview, 'ai');
		aiText = '';
		aiPreview = null;
	}

	// ── Scan tab ──────────────────────────────────────────────────────────────
	async function startScanner() {
		scanError = '';
		scanPreview = null;
		showLabelCapture = false;
		scannerActive = true;

		const { BrowserMultiFormatReader } = await import('@zxing/browser');
		codeReader = new BrowserMultiFormatReader();
		try {
			await codeReader.decodeFromVideoDevice(undefined, videoEl!, async (result) => {
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
		codeReader?.reset();
		codeReader = null;
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
		commitEntry(scanPreview, 'upc');
		scanPreview = null;
		showLabelCapture = false;
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
		<h1 class="text-2xl font-semibold tracking-tight text-gray-900">KillaCal</h1>
		<p class="text-sm text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
	</header>

	<!-- ── Today's total ──────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
		<div class="flex items-end justify-between">
			<div>
				<p class="text-xs font-medium uppercase tracking-widest text-gray-400">Today</p>
				<p class="text-5xl font-semibold tabular-nums text-gray-900 mt-1">
					{todayTotal.toLocaleString()}
					<span class="text-lg font-normal text-gray-400">cal</span>
				</p>
			</div>
			<p class="text-sm text-gray-400 pb-1">{GOAL.toLocaleString()} goal</p>
		</div>
		<!-- Progress bar -->
		<div class="h-2 bg-gray-100 rounded-full overflow-hidden">
			<div
				class="h-full rounded-full transition-all duration-500"
				class:bg-green-500={todayTotal <= GOAL}
				class:bg-amber-400={todayTotal > GOAL && todayTotal <= GOAL * 1.15}
				class:bg-red-400={todayTotal > GOAL * 1.15}
				style="width: {goalPct}%"
			></div>
		</div>
	</section>

	<!-- ── 7-day chart ────────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
		<p class="text-xs font-medium uppercase tracking-widest text-gray-400 mb-4">Last 7 days</p>
		<div class="flex items-end gap-2 h-20">
			{#each recentDays as day}
				{@const barPct = chartMax > 0 ? (day.total / chartMax) * 100 : 0}
				{@const today = isToday(day.date)}
				<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
					<div
						class="w-full rounded-t transition-all duration-500"
						class:bg-green-500={today}
						class:bg-gray-200={!today && day.total > 0}
						class:bg-gray-100={!today && day.total === 0}
						style="height: {Math.max(barPct, day.total > 0 ? 4 : 0)}%"
						title="{day.date}: {day.total} cal"
					></div>
					<span class="text-[10px] text-gray-400">{new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}</span>
				</div>
			{/each}
		</div>
		<p class="text-[10px] text-gray-300 mt-1 text-right">goal: {GOAL.toLocaleString()} cal</p>
	</section>

	<!-- ── Entry tabs ─────────────────────────────────────────────────────── -->
	<section class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
		<!-- Tab bar -->
		<div class="grid grid-cols-3 border-b border-gray-100">
			{#each (['ai', 'scan', 'manual'] as const) as tab}
				<button
					onclick={() => { activeTab = tab; stopScanner(); }}
					class="py-3 text-sm font-medium transition-colors"
					class:text-green-600={activeTab === tab}
					class:border-b-2={activeTab === tab}
					class:border-green-500={activeTab === tab}
					class:text-gray-400={activeTab !== tab}
				>
					{tab === 'ai' ? '✦ AI' : tab === 'scan' ? '⊡ Scan' : '+ Manual'}
				</button>
			{/each}
		</div>

		<!-- ── AI panel ───────────────────────────────────────────────── -->
		{#if activeTab === 'ai'}
			<div class="p-5 space-y-3">
				<textarea
					bind:value={aiText}
					placeholder="Describe what you ate — e.g. 'two scrambled eggs and toast with butter'"
					rows={3}
					class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300"
				></textarea>

				{#if aiError}
					<p class="text-xs text-red-500">{aiError}</p>
				{/if}

				{#if aiPreview}
					<div class="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
						<p class="text-sm font-medium text-gray-800">{aiPreview.description}</p>
						<div class="flex gap-4 text-xs text-gray-500">
							<span><b class="text-gray-800">{aiPreview.calories}</b> cal</span>
							<span>{aiPreview.protein_g}g protein</span>
							<span>{aiPreview.fat_g}g fat</span>
							<span>{aiPreview.carbs_g}g carbs</span>
						</div>
						{#if aiPreview.notes}
							<p class="text-[11px] text-gray-400 italic">{aiPreview.notes}</p>
						{/if}
						<div class="flex gap-2 pt-1">
							<button onclick={confirmAi} class="flex-1 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg py-2 transition-colors">
								Add to log
							</button>
							<button onclick={() => { aiPreview = null; }} class="px-4 text-sm text-gray-400 hover:text-gray-600 transition-colors">
								Discard
							</button>
						</div>
					</div>
				{/if}

				{#if !aiPreview}
					<button
						onclick={handleAiEstimate}
						disabled={aiLoading || !aiText.trim()}
						class="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-100 disabled:text-gray-300 text-white text-sm font-medium rounded-xl py-3 transition-colors flex items-center justify-center gap-2"
					>
						{#if aiLoading}
							<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
						class="w-full bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-xl py-3 transition-colors"
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
					<div class="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
						<p class="text-sm font-medium text-gray-800">{scanPreview.description}</p>
						<div class="flex gap-4 text-xs text-gray-500">
							<span><b class="text-gray-800">{scanPreview.calories}</b> cal</span>
							<span>{scanPreview.protein_g}g protein</span>
							<span>{scanPreview.fat_g}g fat</span>
							<span>{scanPreview.carbs_g}g carbs</span>
						</div>
						{#if scanPreview.notes}
							<p class="text-[11px] text-gray-400 italic">{scanPreview.notes}</p>
						{/if}
						<div class="flex gap-2 pt-1">
							<button onclick={confirmScan} class="flex-1 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg py-2 transition-colors">
								Add to log
							</button>
							<button onclick={() => { scanPreview = null; }} class="px-4 text-sm text-gray-400 hover:text-gray-600 transition-colors">
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
					class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300"
				/>
				<input
					bind:value={manualCalories}
					type="number"
					placeholder="Calories *"
					min="0"
					class="w-full text-sm rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300"
				/>
				<div class="grid grid-cols-3 gap-2">
					<input bind:value={manualProtein} type="number" placeholder="Protein (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300 w-full" />
					<input bind:value={manualFat} type="number" placeholder="Fat (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300 w-full" />
					<input bind:value={manualCarbs} type="number" placeholder="Carbs (g)" min="0" class="text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-green-400 placeholder-gray-300 w-full" />
				</div>
				<button
					onclick={handleManualAdd}
					disabled={!manualDescription.trim() || !manualCalories}
					class="w-full bg-green-500 hover:bg-green-600 disabled:bg-gray-100 disabled:text-gray-300 text-white text-sm font-medium rounded-xl py-3 transition-colors"
				>
					Add to log
				</button>
			</div>
		{/if}
	</section>

	<!-- ── Today's entries ────────────────────────────────────────────────── -->
	{#if entries.length > 0}
		<section class="space-y-2">
			<p class="text-xs font-medium uppercase tracking-widest text-gray-400 px-1">Today's log</p>
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
