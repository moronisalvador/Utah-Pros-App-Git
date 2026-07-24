/**
 * ════════════════════════════════════════════════
 * FILE: block-network.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns off real network connections before credential-free Vitest lanes load test code. Tests
 *   can still inject their own fake request functions, but an unmocked connection fails immediately.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The local database lane does not load this file because it has its own exact-target runner.
 *   - Creating Request, Response, URL, or mocked fetch objects remains allowed.
 * ════════════════════════════════════════════════
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

function blockedNetwork() {
  throw new Error('Credential-free test lane blocked an unmocked network call');
}

globalThis.fetch = blockedNetwork;
globalThis.WebSocket = class BlockedWebSocket {
  constructor() {
    blockedNetwork();
  }
};

http.get = blockedNetwork;
http.request = blockedNetwork;
https.get = blockedNetwork;
https.request = blockedNetwork;
net.connect = blockedNetwork;
net.createConnection = blockedNetwork;
tls.connect = blockedNetwork;
