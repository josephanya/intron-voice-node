import { describe, expect, it } from 'vitest';

import { IntronClient } from '../src/index.js';

const liveApiKey = process.env.INTRON_API_KEY?.trim();
const runLiveTests =
  process.env.INTRON_RUN_LIVE_TESTS === 'true' && liveApiKey !== undefined;
const describeLive = runLiveTests ? describe : describe.skip;

describeLive('live smoke tests', () => {
  it('can submit a short synthetic queued TTS request', async () => {
    const client = liveClient();

    const result = await client.enqueueSpeech({
      text: 'This is an SDK smoke test.',
      voiceLanguage: 'en',
      voiceAccent: 'hausa',
      voiceGender: 'female',
      outputAudioFormat: 'wav',
    });

    expect(result.textId).toBeTypeOf('string');
    expect(result.request.status).toBeGreaterThanOrEqual(200);
    expect(result.request.status).toBeLessThan(300);
  }, 30_000);

  it('can submit a short synthetic STT upload request', async () => {
    const client = liveClient();

    const result = await client.uploadAudioFile({
      source: {
        kind: 'buffer',
        filename: 'synthetic-silence.wav',
        data: syntheticWavSilence(),
        contentType: 'audio/wav',
      },
      language: 'en',
    });

    expect(result.fileId).toBeTypeOf('string');
    expect(result.request.status).toBeGreaterThanOrEqual(200);
    expect(result.request.status).toBeLessThan(300);
  }, 30_000);
});

function liveClient(): IntronClient {
  if (liveApiKey === undefined) {
    throw new Error('INTRON_API_KEY is required for live smoke tests.');
  }

  return new IntronClient({ apiKey: liveApiKey });
}

function syntheticWavSilence(): Uint8Array {
  const sampleRate = 16_000;
  const durationSeconds = 1;
  const channelCount = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channelCount * bitsPerSample) / 8;
  const blockAlign = (channelCount * bitsPerSample) / 8;
  const dataSize = sampleRate * durationSeconds * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
