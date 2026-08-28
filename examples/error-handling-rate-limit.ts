import {
  IntronApiError,
  IntronClient,
  IntronRateLimitError,
} from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
  retryPolicy: {
    maxRetries: 2,
  },
});

try {
  await client.generateSpeech({
    text: 'Your lab results are ready for review.',
    voiceLanguage: 'en',
    voiceAccent: 'ghanaian',
    voiceGender: 'female',
  });
} catch (error) {
  if (error instanceof IntronRateLimitError) {
    console.error('rate limited', {
      status: error.status,
      retryAfter: error.retryAfter,
      requestId: error.requestId,
    });
  } else if (error instanceof IntronApiError) {
    console.error('service error', {
      status: error.status,
      code: error.code,
      requestId: error.requestId,
    });
  } else {
    throw error;
  }
}
