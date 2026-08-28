import { Readable } from 'node:stream';

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

describe('asynchronous STT file transcription', () => {
  it('uploads audio as documented multipart fields', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse(
        { file_id: 'file-1', processing_status: 'FILE_QUEUED' },
        202,
      ),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.uploadAudioFile({
        source: {
          kind: 'buffer',
          filename: 'consult.wav',
          data: new Uint8Array([1, 2, 3]),
          contentType: 'audio/wav',
        },
        language: 'en',
        diarization: true,
        category: 'file_category_telehealth',
        disableLlmCorrections: false,
        postProcessing: { summary: true, answer: false },
      }),
    ).resolves.toEqual({
      fileId: 'file-1',
      status: 'FILE_QUEUED',
      request: { status: 202 },
    });

    expect(httpTransport.requests).toHaveLength(1);
    const request = httpTransport.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url.toString()).toBe(
      'https://infer.voice.intron.io/file/v1/upload',
    );
    expect(request?.headers.authorization).toBe('Bearer server-key');
    expect(request?.headers['content-type']).toBeUndefined();
    expect(request?.body).toBeInstanceOf(FormData);

    const formData = request?.body as FormData;
    expect(formData.get('audio_file_name')).toBe('consult.wav');
    expect(formData.get('audio_file_blob')).toBeInstanceOf(File);
    expect(formData.get('use_language_asr_input')).toBe('en');
    expect(formData.get('use_diarization')).toBe('TRUE');
    expect(formData.get('use_category')).toBe('file_category_telehealth');
    expect(formData.get('use_disable_llm_corrections')).toBe('FALSE');
    expect(formData.get('get_summary')).toBe('TRUE');
    expect(formData.get('get_answer')).toBe('FALSE');
  });

  it('supports streams and async iterables without destroying caller-owned streams', async () => {
    const stream = Readable.from([new Uint8Array([1]), new Uint8Array([2])], {
      autoDestroy: false,
    });
    const streamClient = clientWithUploadResponse();

    await streamClient.client.uploadAudioFile({
      source: { kind: 'stream', filename: 'stream.mp3', stream },
    });

    expect(stream.destroyed).toBe(false);
    expect(streamClient.httpTransport.requests[0]?.body).toBeInstanceOf(
      FormData,
    );

    const asyncIterableClient = clientWithUploadResponse();
    await asyncIterableClient.client.uploadAudioFile({
      source: {
        kind: 'asyncIterable',
        filename: 'chunks.flac',
        data: asyncIterable([new Uint8Array([3]), new Uint8Array([4])]),
      },
    });

    const body = asyncIterableClient.httpTransport.requests[0]
      ?.body as FormData;
    expect(body.get('audio_file_name')).toBe('chunks.flac');
  });

  it('rejects unsupported audio formats before sending an upload request', async () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.uploadAudioFile({
        source: {
          kind: 'buffer',
          filename: 'notes.txt',
          data: new Uint8Array([1]),
        },
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    expect(httpTransport.requests).toHaveLength(0);
  });

  it('gets file status with structured post-processing query flag', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse(
        {
          file_id: 'file-1',
          processing_status: 'FILE_TRANSCRIBED',
          transcript: 'hello patient',
          processed_duration: 12.5,
          structured_post_processing: { summary: 'short' },
        },
        200,
        { 'x-request-id': 'request-1' },
      ),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.getFileStatus('file 1', { structuredPostProcessing: true }),
    ).resolves.toEqual({
      fileId: 'file-1',
      status: 'FILE_TRANSCRIBED',
      transcript: 'hello patient',
      processedDuration: 12.5,
      postProcessing: { summary: 'short' },
      request: { status: 200, requestId: 'request-1' },
      raw: {
        file_id: 'file-1',
        processing_status: 'FILE_TRANSCRIBED',
        transcript: 'hello patient',
        processed_duration: 12.5,
        structured_post_processing: { summary: 'short' },
      },
    });
    expect(httpTransport.requests[0]?.url.toString()).toBe(
      'https://infer.voice.intron.io/file/v1/status/file%201?get_structured_post_processing=t',
    );
  });

  it('polls until transcription completes', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_PROCESSING' }),
    );
    httpTransport.enqueueResponse(
      jsonResponse({
        file_id: 'file-1',
        processing_status: 'FILE_TRANSCRIBED',
        transcript: 'done',
      }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });
    const statuses: string[] = [];

    await expect(
      client.waitForTranscription({
        fileId: 'file-1',
        pollingIntervalMs: 25,
        onStatus: (status) => {
          if (status.status !== undefined) {
            statuses.push(status.status);
          }
        },
      }),
    ).resolves.toMatchObject({
      fileId: 'file-1',
      status: 'FILE_TRANSCRIBED',
      transcript: 'done',
    });

    expect(clock.delays).toEqual([25]);
    expect(statuses).toEqual(['FILE_PROCESSING', 'FILE_TRANSCRIBED']);
  });

  it('fails when asynchronous processing reaches a failed terminal status', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({
        file_id: 'file-1',
        processing_status: 'FILE_PROCESSING_FAILED',
      }),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.waitForTranscription({ fileId: 'file-1' }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
  });

  it('times out while polling', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_PROCESSING' }),
    );
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_PROCESSING' }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });

    await expect(
      client.waitForTranscription({
        fileId: 'file-1',
        pollingIntervalMs: 10,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
  });

  it('supports aborting during the polling delay', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ManualClock();
    const controller = new AbortController();
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_PENDING' }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });

    const pending = client.waitForTranscription({
      fileId: 'file-1',
      pollingIntervalMs: 50,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    clock.runNext();

    await expect(pending).rejects.toBeInstanceOf(IntronRequestCancelledError);
  });

  it('uses existing retry behavior for rate-limited status requests', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    httpTransport.enqueueResponse({
      status: 429,
      headers: new Headers({ 'retry-after': '1' }),
    });
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_PROCESSING' }),
    );
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
    });

    await expect(client.getFileStatus('file-1')).resolves.toMatchObject({
      fileId: 'file-1',
      status: 'FILE_PROCESSING',
    });
    expect(httpTransport.requests).toHaveLength(2);
    expect(clock.delays).toEqual([1000]);
  });
});

function clientWithUploadResponse(): {
  readonly client: IntronClient;
  readonly httpTransport: FakeHttpTransport;
} {
  const httpTransport = new FakeHttpTransport();
  httpTransport.enqueueResponse(jsonResponse({ file_id: 'file-1' }));

  return {
    client: new IntronClient({ apiKey: 'server-key', httpTransport }),
    httpTransport,
  };
}

function asyncIterable(
  chunks: readonly Uint8Array[],
): AsyncIterable<Uint8Array> {
  let index = 0;
  const iterator: AsyncIterableIterator<Uint8Array> = {
    [Symbol.asyncIterator]: () => iterator,
    next: () => {
      const chunk = chunks[index];
      index += 1;

      return Promise.resolve(
        chunk === undefined
          ? { done: true, value: undefined }
          : { done: false, value: chunk },
      );
    },
  };

  return iterator;
}

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
