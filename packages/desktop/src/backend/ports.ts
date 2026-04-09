import { createServer } from 'node:net';

export async function isTcpPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

export async function assertTcpPortAvailable(port: number, host = '127.0.0.1'): Promise<void> {
  if (!(await isTcpPortAvailable(port, host))) {
    throw new Error(`Port ${String(port)} on ${host} is already in use.`);
  }
}

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
