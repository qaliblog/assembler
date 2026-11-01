import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createContentRepository } from '../src/services/content.js';
import { silentLogger } from '../src/lib/logger.js';

export interface TestServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** Start the real application (same pipeline as production) on port 0. */
export async function startTestServer(): Promise<TestServer> {
  const server: Server = createServer(
    createApp({ content: createContentRepository(), logger: silentLogger }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

export function get(
  server: TestServer,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${server.baseUrl}${path}`, { redirect: 'manual', ...init });
}
