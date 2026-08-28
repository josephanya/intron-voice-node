import type {
  IntronHttpRequest,
  IntronHttpResponse,
  IntronHttpTransport,
} from '../../src/index.js';

/** Test HTTP transport that records requests without network access. */
export class FakeHttpTransport implements IntronHttpTransport {
  public readonly requests: IntronHttpRequest[] = [];
  private readonly results: (IntronHttpResponse | Error)[] = [];
  private closed = false;

  public enqueueResponse(response: Partial<IntronHttpResponse> = {}): void {
    this.results.push({
      status: response.status ?? 200,
      headers: response.headers ?? new Headers(),
      body: response.body ?? new Uint8Array(),
    });
  }

  public enqueueError(error: Error): void {
    this.results.push(error);
  }

  public send(request: IntronHttpRequest): Promise<IntronHttpResponse> {
    this.requests.push(request);
    const result = this.results.shift();

    if (result instanceof Error) {
      return Promise.reject(result);
    }

    return Promise.resolve(
      result ?? {
        status: 200,
        headers: new Headers(),
        body: new Uint8Array(),
      },
    );
  }

  public close(): Promise<void> {
    this.closed = true;

    return Promise.resolve();
  }

  public isClosed(): boolean {
    return this.closed;
  }
}
