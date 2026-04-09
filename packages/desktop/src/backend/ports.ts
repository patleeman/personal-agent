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
