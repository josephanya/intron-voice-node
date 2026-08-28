import { writeFile } from 'node:fs/promises';

import { IntronClient } from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const session = await client.startStreamingSpeech({
  voiceLanguage: 'en',
  voiceAccent: 'hausa',
  voiceGender: 'female',
  outputAudioFormat: 'wav',
});

const audio: Uint8Array[] = [];

try {
  await session.sendText('Please take your medication after breakfast.');
  await session.fetchAudioChunk();
  await session.commit();

  for await (const chunk of session.audioChunks) {
    audio.push(chunk.audio);
  }
} finally {
  await session.close();
}

await writeFile('./streamed-speech.wav', Buffer.concat(audio));
