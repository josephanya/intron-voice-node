import { IntronClient, INTRON_TTS_LANGUAGES } from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

console.log(INTRON_TTS_LANGUAGES.map((language) => language.code));
console.log(client.getConfig().apiBaseUrl.toString());
