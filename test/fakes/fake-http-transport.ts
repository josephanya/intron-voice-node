import type {
  IntronHttpRequest,
  IntronHttpResponse,
  IntronHttpTransport,
} from '../../src/index.js';

/** Test HTTP transport that records requests without network access. */
export class FakeHttpTransport implements IntronHttpTransport {
  public readonly requests: IntronHttpRequest[] = [];
  private closed = false;

  public send(request: IntronHttpRequest): Promise<IntronHttpResponse> {
    this.requests.push(request);

    return Promise.resolve({
      status: 200,
      headers: new Headers(),
      body: new Uint8Array(),
    });
  }

  public close(): Promise<void> {
    this.closed = true;

    return Promise.resolve();
  }

  public isClosed(): boolean {
    return this.closed;
  }
}
