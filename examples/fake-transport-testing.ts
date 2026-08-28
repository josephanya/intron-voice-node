import {
  IntronClient,
  type IntronHttpRequest,
  type IntronHttpTransport,
} from 'intron-voice-node';

const encoder = new TextEncoder();

const fakeTransport: IntronHttpTransport = {
  send(request: IntronHttpRequest) {
    if (request.url.pathname === '/file/v1/upload-sync') {
      return Promise.resolve({
        status: 200,
        headers: new Headers({ 'x-request-id': 'test-request' }),
        body: encoder.encode(
          JSON.stringify({
            file_id: 'file-test',
            status: 'FILE_TRANSCRIBED',
            transcript: 'hello from a fake transport',
          }),
        ),
      });
    }

    return Promise.reject(
      new Error(`unexpected request path: ${request.url.pathname}`),
    );
  },
  close() {
    return Promise.resolve();
  },
};

const client = new IntronClient({
  apiKey: 'test-key',
  httpTransport: fakeTransport,
});

const result = await client.transcribeAudioFileSync({
  source: {
    kind: 'buffer',
    filename: 'test.wav',
    data: new Uint8Array([1, 2, 3, 4]),
  },
  audioDurationSeconds: 10,
  language: 'en',
});

console.log(result.transcript);
