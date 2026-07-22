'use strict';

const net = require('node:net');
const { once } = require('node:events');

class BufferedReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.failure = null;
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    };
    this.onError = (error) => {
      this.failure = error;
      this.flush();
    };
    this.onClose = () => {
      if (!this.failure) this.failure = new Error('SOCKS connection closed during handshake');
      this.flush();
    };
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  read(size) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.buffer.length >= size) {
      const value = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      return Promise.resolve(value);
    }
    return new Promise((resolve, reject) => this.waiters.push({ size, resolve, reject }));
  }

  flush() {
    while (this.waiters.length) {
      const waiter = this.waiters[0];
      if (this.failure) {
        this.waiters.shift().reject(this.failure);
        continue;
      }
      if (this.buffer.length < waiter.size) break;
      this.waiters.shift();
      const value = this.buffer.subarray(0, waiter.size);
      this.buffer = this.buffer.subarray(waiter.size);
      waiter.resolve(value);
    }
  }

  release() {
    this.socket.pause();
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    if (this.buffer.length) this.socket.unshift(this.buffer);
    this.buffer = Buffer.alloc(0);
  }
}

function addressPacket(host) {
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return Buffer.from([0x01, ...host.split('.').map(Number)]);
  }
  if (ipVersion === 6) {
    throw new Error('IPv6 literals are not supported by the local bridge yet');
  }
  const domain = Buffer.from(host, 'utf8');
  if (!domain.length || domain.length > 255) throw new Error('Invalid destination hostname');
  return Buffer.concat([Buffer.from([0x03, domain.length]), domain]);
}

async function connectThroughTor({ socksPort, host, port }) {
  const socket = net.connect({ host: '127.0.0.1', port: socksPort });
  await once(socket, 'connect');
  const reader = new BufferedReader(socket);

  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const method = await reader.read(2);
  if (method[0] !== 0x05 || method[1] !== 0x00) {
    socket.destroy();
    throw new Error('Tor SOCKS server rejected the connection method');
  }

  const address = addressPacket(host);
  const portBuffer = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), address, portBuffer]));

  const header = await reader.read(4);
  if (header[0] !== 0x05 || header[1] !== 0x00) {
    socket.destroy();
    throw new Error(`Tor SOCKS connection failed with code ${header[1]}`);
  }

  if (header[3] === 0x01) await reader.read(4);
  else if (header[3] === 0x04) await reader.read(16);
  else if (header[3] === 0x03) {
    const length = (await reader.read(1))[0];
    await reader.read(length);
  } else {
    socket.destroy();
    throw new Error('Tor returned an unknown SOCKS address type');
  }
  await reader.read(2);
  reader.release();
  return socket;
}

function parseAuthority(value, fallbackPort) {
  const input = String(value || '').trim();
  if (input.startsWith('[')) {
    const end = input.indexOf(']');
    if (end < 0) throw new Error('Invalid IPv6 authority');
    return {
      host: input.slice(1, end),
      port: Number(input.slice(end + 2)) || fallbackPort,
    };
  }
  const split = input.lastIndexOf(':');
  if (split > 0 && input.indexOf(':') === split) {
    return { host: input.slice(0, split), port: Number(input.slice(split + 1)) || fallbackPort };
  }
  return { host: input, port: fallbackPort };
}

function connectPipes(client, upstream) {
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    if (!client.destroyed) client.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
  client.on('close', () => !upstream.destroyed && upstream.destroy());
  upstream.on('close', () => !client.destroyed && client.destroy());
  client.resume();
  upstream.resume();
}

function startTorHttpBridge({ socksPort, listenPort = 0 }) {
  const server = net.createServer((client) => {
    client.pause();
    let buffer = Buffer.alloc(0);
    const fail = (status, message) => {
      if (!client.destroyed) client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n${message || ''}`);
    };

    const onData = async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker < 0) {
        if (buffer.length > 65536) fail('431 Request Header Fields Too Large');
        return;
      }
      client.off('data', onData);
      const headerBuffer = buffer.subarray(0, marker + 4);
      const remainder = buffer.subarray(marker + 4);
      const headerText = headerBuffer.toString('latin1');
      const lines = headerText.split('\r\n');
      const [method, target, version] = lines[0].split(' ');

      try {
        if (method === 'CONNECT') {
          const destination = parseAuthority(target, 443);
          const upstream = await connectThroughTor({ socksPort, ...destination });
          client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Relay\r\n\r\n');
          if (remainder.length) upstream.write(remainder);
          connectPipes(client, upstream);
          return;
        }

        let url;
        try {
          url = new URL(target);
        } catch {
          const hostHeader = lines.find((line) => /^host:/i.test(line));
          if (!hostHeader) throw new Error('HTTP request has no Host header');
          url = new URL(`http://${hostHeader.slice(hostHeader.indexOf(':') + 1).trim()}${target}`);
        }
        if (url.protocol !== 'http:') throw new Error('Unsupported proxy request scheme');
        const destination = { host: url.hostname, port: Number(url.port) || 80 };
        const upstream = await connectThroughTor({ socksPort, ...destination });
        lines[0] = `${method} ${url.pathname}${url.search} ${version}`;
        upstream.write(Buffer.concat([Buffer.from(lines.join('\r\n'), 'latin1'), remainder]));
        connectPipes(client, upstream);
      } catch (error) {
        fail('502 Bad Gateway', error.message);
      }
    };

    client.on('data', onData);
    client.on('error', () => {});
    client.resume();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        port: address.port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { connectThroughTor, startTorHttpBridge };
