import { createServer } from 'node:net';

export async function getAvailableTcpPort(host = '127.0.0.1'): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve an available TCP port.')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });

    server.listen(0, host);
  });
}
