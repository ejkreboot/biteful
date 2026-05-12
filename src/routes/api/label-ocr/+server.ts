import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY } from '$env/static/private';
import labelOcrPrompt from '../../../../anthropic/label_ocr_prompt.txt?raw';

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export async function POST({ request }) {
	const { imageBase64, mediaType } = await request.json();

	if (!imageBase64 || typeof imageBase64 !== 'string') {
		error(400, 'imageBase64 is required');
	}

	const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
	const resolvedType = validTypes.includes(mediaType) ? mediaType : 'image/jpeg';

	const message = await client.messages.create({
		model: 'claude-opus-4-5',
		max_tokens: 512,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: resolvedType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
							data: imageBase64
						}
					},
					{
						type: 'text',
						text: labelOcrPrompt.trim()
					}
				]
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
		console.error('[/api/label-ocr] JSON parse failed');
		console.error('Raw response:', raw);
		console.error('Parse error:', e);
		error(502, `Failed to parse nutrition response from AI. Raw: ${raw}`);
	}
}
