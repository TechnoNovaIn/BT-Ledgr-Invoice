/**
 * Ledgr Network Relay
 * Bridges incoming LAN / Wi-Fi connections (0.0.0.0:3002) to WSL2 (127.0.0.1:3002).
 * Enables devices across the local network to access Ledgr seamlessly.
 */
const net = require('net');

const LISTEN_PORT = process.env.PORT || 3002;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3002;

const server = net.createServer({ pauseOnConnect: false }, (clientSocket) => {
  const targetSocket = net.connect(TARGET_PORT, TARGET_HOST);

  clientSocket.pipe(targetSocket);
  targetSocket.pipe(clientSocket);

  targetSocket.on('error', (err) => {
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    targetSocket.destroy();
  });

  clientSocket.on('close', () => {
    targetSocket.destroy();
  });

  targetSocket.on('close', () => {
    clientSocket.destroy();
  });
});

server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Server error:`, err.message);
  // Retry if address is in use during restart
  if (err.code === 'EADDRINUSE') {
    setTimeout(() => {
      server.close();
      server.listen(LISTEN_PORT, '0.0.0.0');
    }, 2000);
  }
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Ledgr LAN Relay active on 0.0.0.0:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
});
