import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import caloriePrompt from '../../../../anthropic/calorie_prompt.txt?raw';
import caloriePhotoPrompt from '../../../../anthropic/calorie_photo_prompt.txt?raw';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ValidImageType = (typeof validImageTypes)[number];

export async function POST({ request }) {
	const body = await request.json();
	const { description, imageBase64, mediaType } = body;

	const hasText = description && typeof description === 'string' && description.trim().length > 0;
	const hasImage = imageBase64 && typeof imageBase64 === 'string';

	if (!hasText && !hasImage) {
		error(400, 'Either description or imageBase64 is required');
	}

	let content: Anthropic.MessageParam['content'];

	if (hasImage) {
		const resolvedType: ValidImageType = validImageTypes.includes(mediaType) ? mediaType : 'image/jpeg';
		content = [
			{
				type: 'image',
				source: { type: 'base64', media_type: resolvedType, data: imageBase64 }
			},
			{ type: 'text', text: caloriePhotoPrompt.trim() }
		];
	} else {
		content = `${caloriePrompt.trim()}\n\nFood description: ${description.trim()}`;
	}

	const message = await client.messages.create({
		model: 'claude-opus-4-5',
		max_tokens: 512,
		messages: [{ role: 'user', content }]
	});

	const raw = message.content[0].type === 'text' ? message.content[0].text : '';
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
