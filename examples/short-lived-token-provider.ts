import { IntronClient, type IntronTokenProvider } from '@intron-voice-node';

const tokenProvider: IntronTokenProvider = {
  resolveToken: async (signal) => {
    const response = await fetch('https://internal.example.com/intron-token', {
      ...(signal === undefined ? {} : { signal }),
    });

    if (!response.ok) {
      throw new Error('failed to fetch Intron token');
    }

    const payload = (await response.json()) as { readonly token: string };

    return payload.token;
  },
};

const client = new IntronClient({ tokenProvider });

const result = await client.transcribeAudioFileSync({
  source: { kind: 'path', path: './audio/short-note.wav' },
  audioDurationSeconds: 30,
  language: 'en',
});

console.log(result.transcript);
