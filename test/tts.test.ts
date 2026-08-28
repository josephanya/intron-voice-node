import { describe, expect, it } from 'vitest';

import {
  IntronClient,
  IntronProtocolError,
  IntronRequestCancelledError,
  type IntronClock,
  type IntronTimerHandle,
} from '../src/index.js';
import { FakeHttpTransport } from './fakes/fake-http-transport.js';

class ImmediateClock implements IntronClock {
  public readonly delays: number[] = [];
  private time = 0;

  public now(): number {
    return this.time;
  }

  public setTimeout(callback: () => void, delayMs: number): IntronTimerHandle {
    let cleared = false;
    this.delays.push(delayMs);
    this.time += delayMs;
    queueMicrotask(() => {
      if (!cleared) {
        callback();
      }
    });

    return {
      clear: () => {
        cleared = true;
      },
    };
  }
}

class ManualClock implements IntronClock {
  public readonly delays: number[] = [];
  private callback: (() => void) | undefined;

  public now(): number {
    return 0;
  }

  public setTimeout(callback: () => void, delayMs: number): IntronTimerHandle {
    let cleared = false;
    this.delays.push(delayMs);
    this.callback = () => {
      if (!cleared) {
        callback();
      }
    };

    return {
      clear: () => {
        cleared = true;
      },
    };
  }

  public runNext(): void {
    this.callback?.();
  }
}

describe('TTS speech generation', () => {
  it('posts the documented synchronous TTS JSON body', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse(
        {
          data: {
            processing_status: 'TTS_TEXT_AUDIO_GENERATED',
            audio_path: 'https://cdn.example.test/audio/text-1.wav',
            audio_duration_in_seconds: 2.4,
          },
        },
        200,
        { 'x-request-id': 'request-tts-1' },
      ),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.generateSpeech({
        text: 'Hello patient',
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'female',
        outputAudioFormat: 'wav',
      }),
    ).resolves.toEqual({
      status: 'TTS_TEXT_AUDIO_GENERATED',
      audioPath: 'https://cdn.example.test/audio/text-1.wav',
      audioDurationSeconds: 2.4,
      request: { status: 200, requestId: 'request-tts-1' },
      raw: {
        data: {
          processing_status: 'TTS_TEXT_AUDIO_GENERATED',
          audio_path: 'https://cdn.example.test/audio/text-1.wav',
          audio_duration_in_seconds: 2.4,
        },
      },
    });

    expect(httpTransport.requests).toHaveLength(1);
    const request = httpTransport.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url.toString()).toBe(
      'https://infer.voice.intron.io/tts/v1/generate',
    );
    expect(request?.headers.authorization).toBe('Bearer server-key');
    expect(request?.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(parseJsonBody(request?.body)).toEqual({
      text: 'Hello patient',
      voice_language: 'en',
      voice_accent: 'gh',
      voice_gender: 'female',
      output_audio_format: 'wav',
    });
  });

  it('downloads generated audio bytes only when requested', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({
        data: {
          processing_status: 'TTS_TEXT_AUDIO_GENERATED',
          audio_path: 'https://cdn.example.test/audio/text-1.opus',
        },
      }),
    );
    httpTransport.enqueueResponse({
      status: 200,
      headers: new Headers({ 'content-type': 'audio/opus' }),
      body: new Uint8Array([1, 2, 3]),
    });
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.generateSpeech({
        text: 'Hello patient',
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'male',
        outputAudioFormat: 'opus',
        downloadAudio: true,
      }),
    ).resolves.toMatchObject({
      status: 'TTS_TEXT_AUDIO_GENERATED',
      audio: new Uint8Array([1, 2, 3]),
    });
    expect(httpTransport.requests[1]?.url.toString()).toBe(
      'https://cdn.example.test/audio/text-1.opus',
    );
    expect(httpTransport.requests[1]?.headers.accept).toBe('audio/*');
  });

  it('validates required voice fields before sending requests', async () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.generateSpeech({
        text: 'Hello',
        voiceLanguage: 'en',
        voiceAccent: '',
        voiceGender: 'female',
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    await expect(
      client.generateSpeech({
        text: 'Hello',
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'neutral' as 'female',
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    expect(httpTransport.requests).toHaveLength(0);
  });

  it('validates language accent and output format values', async () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.enqueueSpeech({
        text: 'Hello',
        voiceLanguage: 'en us',
        voiceAccent: 'gh',
        voiceGender: 'female',
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    await expect(
      client.enqueueSpeech({
        text: 'Hello',
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'female',
        outputAudioFormat: 'mp3' as 'wav',
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    expect(httpTransport.requests).toHaveLength(0);
  });

  it('validates the documented 4096 character text limit', async () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.generateSpeech({
        text: 'a'.repeat(4097),
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'female',
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    expect(httpTransport.requests).toHaveLength(0);
  });
});

describe('queued TTS speech generation', () => {
  it('queues speech and parses text IDs', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({ data: { text_id: 'text-1' } }, 202),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.enqueueSpeech({
        text: 'Hello patient',
        voiceLanguage: 'en',
        voiceAccent: 'gh',
        voiceGender: 'female',
        outputAudioFormat: 'opus',
      }),
    ).resolves.toEqual({ textId: 'text-1', request: { status: 202 } });

    const request = httpTransport.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url.toString()).toBe(
      'https://infer.voice.intron.io/tts/v1/enqueue',
    );
    expect(parseJsonBody(request?.body)).toEqual({
      text: 'Hello patient',
      voice_language: 'en',
      voice_accent: 'gh',
      voice_gender: 'female',
      output_audio_format: 'opus',
    });
  });

  it('gets queued speech status', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({
        data: {
          text_id: 'text-1',
          processing_status: 'TTS_TEXT_AUDIO_PROCESSING',
        },
      }),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(client.getSpeechStatus('text 1')).resolves.toMatchObject({
      textId: 'text-1',
      status: 'TTS_TEXT_AUDIO_PROCESSING',
    });
    expect(httpTransport.requests[0]?.url.toString()).toBe(
      'https://infer.voice.intron.io/tts/v1/status/text%201',
    );
  });

  it('polls until queued speech is generated', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    httpTransport.enqueueResponse(
      jsonResponse({
        data: {
          text_id: 'text-1',
          processing_status: 'TTS_TEXT_AUDIO_PROCESSING',
        },
      }),
    );
    httpTransport.enqueueResponse(
      jsonResponse({
        data: {
          text_id: 'text-1',
          processing_status: 'TTS_TEXT_AUDIO_GENERATED',
          audio_path: 'https://cdn.example.test/audio/text-1.wav',
          audio_duration_in_seconds: 1.2,
        },
      }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });
    const statuses: string[] = [];

    await expect(
      client.waitForSpeech({
        textId: 'text-1',
        pollingIntervalMs: 25,
        onStatus: (status) => {
          if (status.status !== undefined) {
            statuses.push(status.status);
          }
        },
      }),
    ).resolves.toMatchObject({
      textId: 'text-1',
      status: 'TTS_TEXT_AUDIO_GENERATED',
      audioPath: 'https://cdn.example.test/audio/text-1.wav',
      audioDurationSeconds: 1.2,
    });
    expect(clock.delays).toEqual([25]);
    expect(statuses).toEqual([
      'TTS_TEXT_AUDIO_PROCESSING',
      'TTS_TEXT_AUDIO_GENERATED',
    ]);
  });

  it('supports aborting during the polling delay', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ManualClock();
    const controller = new AbortController();
    httpTransport.enqueueResponse(
      jsonResponse({
        data: {
          text_id: 'text-1',
          processing_status: 'TTS_TEXT_AUDIO_PENDING',
        },
      }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });

    const pending = client.waitForSpeech({
      textId: 'text-1',
      pollingIntervalMs: 50,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    clock.runNext();

    await expect(pending).rejects.toBeInstanceOf(IntronRequestCancelledError);
  });

  it('maps TTS HTTP errors through the typed error layer', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({ message: 'bad output format' }, 400),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.getSpeechStatus('text-1', { retry: false }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
  });
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
} {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: new TextEncoder().encode(JSON.stringify(body)),
  };
}

function parseJsonBody(body: unknown): unknown {
  if (!(body instanceof Uint8Array)) {
    return body;
  }

  return JSON.parse(new TextDecoder().decode(body));
}
