// GET /api/fearAndGreed — RapidAPI Fear & Greed proxy.
// Returns { fgi: { now: { value: null } } } whenever the upstream is
// unavailable or the API key is missing, so callers never have to handle errors.

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const NULL_BODY = { fgi: { now: { value: null } } };

export const GET: RequestHandler = async () => {
	try {
		const apiKey = env.FEAR_AND_GREED_API_KEY;
		if (!apiKey) {
			return json(NULL_BODY);
		}

		const response = await fetch('https://fear-and-greed-index.p.rapidapi.com/v1/fgi', {
			method: 'GET',
			headers: {
				'X-RapidAPI-Key': apiKey,
				'X-RapidAPI-Host': 'fear-and-greed-index.p.rapidapi.com'
			}
		});
		const data = await response.json();

		if (data.error) {
			return json(NULL_BODY);
		}
		return json(data);
	} catch {
		return json(NULL_BODY);
	}
};
