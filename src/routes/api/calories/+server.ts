import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import caloriePrompt from '../../../../anthropic/calorie_prompt.txt?raw';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export async function POST({ request }) {
	const { description } = await request.json();

	if (!description || typeof description !== 'string' || description.trim().length === 0) {
		error(400, 'description is required');
	}

	const message = await client.messages.create({
		model: 'claude-opus-4-5',
		max_tokens: 512,
		messages: [
			{
				role: 'user',
				content: `${caloriePrompt.trim()}\n\nFood description: ${description.trim()}`
			}
		]
	});

	const raw = message.content[0].type === 'text' ? message.content[0].text : '';

	// Strip markdown code fences if the model wrapped the JSON
	const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

	try {
		const result = JSON.parse(cleaned);
		return json(result);
	} catch (e) {
		console.error('[/api/calories] JSON parse failed');
		console.error('Raw response:', raw);
		console.error('Parse error:', e);
		error(502, `Failed to parse nutrition response from AI. Raw: ${raw}`);
	}
}
