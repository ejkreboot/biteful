<script lang="ts">
	import { onMount } from 'svelte';
	import { getSavedGoal, saveGoalData } from '$lib/storage';
	import type { GoalInputs } from '$lib/storage';

	let {
		open = $bindable(),
		onSave
	}: { open: boolean; onSave: (goal: number) => void } = $props();

	// ── Form state ────────────────────────────────────────────────────────────
	let sex = $state<'male' | 'female'>('male');
	let age = $state('');
	let heightFt = $state('');
	let heightIn = $state('0');
	let weightLbs = $state('');
	let activity = $state('1.55');
	let goalWeightLbs = $state('');
	let weeksToGoal = $state('12');
	let customGoal = $state('');

	const activityOptions = [
		{ value: '1.2',   label: 'Sedentary',       desc: 'Little or no exercise' },
		{ value: '1.375', label: 'Lightly active',   desc: '1–3 days/week' },
		{ value: '1.55',  label: 'Moderately active',desc: '3–5 days/week' },
		{ value: '1.725', label: 'Very active',      desc: '6–7 days/week' },
		{ value: '1.9',   label: 'Extra active',     desc: 'Hard daily exercise or physical job' },
	] as const;

	onMount(() => {
		const saved = getSavedGoal();
		if (saved.inputs) {
			const i = saved.inputs;
			sex = i.sex;
			age = i.age;
			heightFt = i.heightFt;
			heightIn = i.heightIn;
			weightLbs = i.weightLbs;
			activity = i.activity;
			goalWeightLbs = i.goalWeightLbs;
			weeksToGoal = i.weeksToGoal;
		}
	});

	// ── Derived ───────────────────────────────────────────────────────────────
	const heightInches = $derived(
		(parseFloat(heightFt) || 0) * 12 + (parseFloat(heightIn) || 0)
	);

	const bmr = $derived.by(() => {
		const w = parseFloat(weightLbs);
		const h = heightInches;
		const a = parseFloat(age);
		if (!w || !h || !a) return null;
		const wKg = w * 0.453592;
		const hCm = h * 2.54;
		return sex === 'male'
			? 10 * wKg + 6.25 * hCm - 5 * a + 5
			: 10 * wKg + 6.25 * hCm - 5 * a - 161;
	});

	const tdee = $derived(bmr !== null ? Math.round(bmr * parseFloat(activity)) : null);

	const goalCalc = $derived.by(() => {
		if (tdee === null) return null;
		const cw = parseFloat(weightLbs);
		const gw = parseFloat(goalWeightLbs);
		const wks = parseFloat(weeksToGoal) || 12;
		const floor = sex === 'male' ? 1500 : 1200;

		if (!gw || !cw || gw === cw) {
			return { goal: tdee, lbsPerWeek: 0, isLoss: false, warning: null, floorCapped: false, rawGoal: tdee };
		}

		const totalCalDiff = (cw - gw) * 3500; // positive = loss deficit
		const dailyDelta = totalCalDiff / (wks * 7);
		const rawGoal = Math.round(tdee - dailyDelta);
		const lbsPerWeek = Math.abs(dailyDelta) / 500;
		const isLoss = gw < cw;

		let warning: string | null = null;
		if (isLoss && lbsPerWeek > 1.5) {
			const safeWeeks = Math.ceil((cw - gw) * 3500 / (1.5 * 500 * 7));
			warning = `${lbsPerWeek.toFixed(1)} lbs/week is aggressive. Consider ${safeWeeks}+ weeks for a safer pace.`;
		}

		let goal = rawGoal;
		let floorCapped = false;
		if (isLoss && goal < floor) {
			goal = floor;
			floorCapped = true;
		}

		return { goal, lbsPerWeek, isLoss, warning, floorCapped, rawGoal };
	});

	const suggestedGoal = $derived(goalCalc?.goal ?? tdee ?? null);

	const finalGoal = $derived.by(() => {
		const custom = parseInt(customGoal);
		if (!isNaN(custom) && custom > 0) return custom;
		return suggestedGoal;
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	function save() {
		if (!finalGoal) return;
		const inputs: GoalInputs = { sex, age, heightFt, heightIn, weightLbs, activity, goalWeightLbs, weeksToGoal };
		saveGoalData({ dailyGoal: finalGoal, inputs });
		onSave(finalGoal);
		open = false;
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) open = false;
	}
</script>

{#if open}
	<div
		role="presentation"
		class="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
		onclick={handleBackdrop}
		onkeydown={(e) => e.key === 'Escape' && handleBackdrop(e)}
	>
		<div
			class="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-label="Set daily goal"
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<h2 class="text-base font-semibold text-gray-900 font-display">Set daily goal</h2>
				<button onclick={() => { open = false; }} class="text-gray-300 hover:text-gray-500 text-2xl leading-none transition-colors">×</button>
			</div>

			<div class="p-6 space-y-7">

				<!-- ── About you ──────────────────────────────────────────── -->
				<div class="space-y-3">
					<p class="text-xs font-medium uppercase tracking-widest text-gray-400 font-display">About you</p>

					<div class="grid grid-cols-2 gap-2">
						{#each (['male', 'female'] as const) as s}
							<button
								onclick={() => sex = s}
								class="py-2.5 rounded-xl border text-sm font-medium transition-colors"
								class:border-brand={sex === s}
								class:bg-brand-light={sex === s}
								class:text-brand-text={sex === s}
								class:border-gray-200={sex !== s}
								class:text-gray-500={sex !== s}
							>{s === 'male' ? 'Male' : 'Female'}</button>
						{/each}
					</div>

					<div class="grid grid-cols-3 gap-2">
						<div>
						<label for="goal-age" class="text-[11px] text-gray-400 mb-1 block">Age</label>
						<input id="goal-age" bind:value={age} type="number" min="10" max="100" placeholder="—"
								class="w-full text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
						</div>
						<div>
						<label for="goal-height-ft" class="text-[11px] text-gray-400 mb-1 block">Height</label>
						<div class="flex gap-1">
							<input id="goal-height-ft" bind:value={heightFt} type="number" min="3" max="8" placeholder="ft"
									class="w-full text-sm rounded-xl border border-gray-200 px-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
								<input bind:value={heightIn} type="number" min="0" max="11" placeholder="in"
									class="w-full text-sm rounded-xl border border-gray-200 px-2 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
							</div>
						</div>
						<div>
						<label for="goal-weight" class="text-[11px] text-gray-400 mb-1 block">Weight (lbs)</label>
						<input id="goal-weight" bind:value={weightLbs} type="number" min="50" max="800" placeholder="—"
								class="w-full text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
						</div>
					</div>
				</div>

				<!-- ── Activity level ─────────────────────────────────────── -->
				<div class="space-y-3">
					<p class="text-xs font-medium uppercase tracking-widest text-gray-400 font-display">Activity level</p>
					<div class="space-y-1.5">
						{#each activityOptions as opt}
							<button
								onclick={() => activity = opt.value}
								class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm transition-colors text-left"
								class:border-brand={activity === opt.value}
								class:bg-brand-light={activity === opt.value}
								class:text-brand-text={activity === opt.value}
								class:border-gray-100={activity !== opt.value}
								class:text-gray-700={activity !== opt.value}
							>
								<span class="font-medium">{opt.label}</span>
								<span class="text-xs opacity-50">{opt.desc}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- ── Weight goal ────────────────────────────────────────── -->
				<div class="space-y-3">
					<p class="text-xs font-medium uppercase tracking-widest text-gray-400 font-display">
						Weight goal <span class="normal-case font-normal text-gray-300">(optional)</span>
					</p>
					<div class="grid grid-cols-2 gap-2">
						<div>
						<label for="goal-target-weight" class="text-[11px] text-gray-400 mb-1 block">Goal weight (lbs)</label>
						<input id="goal-target-weight" bind:value={goalWeightLbs} type="number" min="50" max="800" placeholder="—"
								class="w-full text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
						</div>
						<div>
						<label for="goal-weeks" class="text-[11px] text-gray-400 mb-1 block">Timeline (weeks)</label>
						<input id="goal-weeks" bind:value={weeksToGoal} type="number" min="1" max="260" placeholder="12"
								class="w-full text-sm rounded-xl border border-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-300" />
						</div>
					</div>
				</div>

				<!-- ── Calculation result ─────────────────────────────────── -->
				{#if tdee !== null}
					<div class="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2.5">
						<div class="flex justify-between text-sm">
							<span class="text-gray-500">Maintenance (TDEE)</span>
							<span class="font-medium text-gray-800">{tdee.toLocaleString()} cal/day</span>
						</div>
						{#if goalCalc && goalCalc.lbsPerWeek > 0}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">{goalCalc.isLoss ? 'Loss rate' : 'Gain rate'}</span>
								<span class="font-medium text-gray-800">{goalCalc.lbsPerWeek.toFixed(1)} lbs/week</span>
							</div>
						{/if}
						{#if goalCalc?.floorCapped}
							<div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
								Your calculated goal ({goalCalc.rawGoal.toLocaleString()} cal) is below the minimum safe intake for {sex === 'male' ? 'men' : 'women'}.
								Adjusted to <b>{sex === 'male' ? '1,500' : '1,200'} cal/day</b>.
							</div>
						{/if}
						{#if goalCalc?.warning}
							<div class="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
								⚠ {goalCalc.warning}
							</div>
						{/if}
					</div>
				{/if}

				<!-- ── Final goal ─────────────────────────────────────────── -->
				<div class="space-y-2">
					<label for="goal-custom" class="text-xs font-medium uppercase tracking-widest text-gray-400 block">Daily goal</label>
					<div class="flex items-center gap-3">
						<input
							id="goal-custom"
							bind:value={customGoal}
							type="number"
							min="500"
							placeholder={suggestedGoal ? String(suggestedGoal) : '2000'}
							class="flex-1 text-3xl font-semibold rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand placeholder-gray-200 tabular-nums"
						/>
						<span class="text-sm text-gray-400 shrink-0">cal/day</span>
					</div>
					{#if suggestedGoal && !customGoal}
						<p class="text-[11px] text-gray-400">
							Calculated: <b>{suggestedGoal.toLocaleString()}</b> cal/day. Edit above to override.
						</p>
					{/if}
				</div>

				<button
					onclick={save}
					disabled={!finalGoal}
					class="w-full bg-brand hover:bg-brand-dark disabled:bg-gray-100 disabled:text-gray-300 text-white text-sm font-medium rounded-xl py-3 transition-colors"
				>
					Save goal
				</button>

			</div>
		</div>
	</div>
{/if}
