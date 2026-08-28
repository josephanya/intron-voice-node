import { writeFile } from 'node:fs/promises';

import { IntronClient } from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const speech = await client.generateSpeech({
  text: 'Your appointment is confirmed for 10 AM.',
  voiceLanguage: 'en',
  voiceAccent: 'hausa',
  voiceGender: 'female',
  outputAudioFormat: 'wav',
  downloadAudio: true,
});

if (speech.audio !== undefined) {
  await writeFile('./appointment-confirmation.wav', speech.audio);
}

console.log(speech.audioPath);
