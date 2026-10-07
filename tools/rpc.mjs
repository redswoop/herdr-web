#!/usr/bin/env node
// One-shot herdr RPC from the shell: node tools/rpc.mjs <method> ['<json params>']
import { rpc } from '../lib/herdr.js';

const [method, params] = process.argv.slice(2);
if (!method) {
  console.error('usage: rpc.mjs <method> [json-params]');
  process.exit(2);
}
try {
  console.log(JSON.stringify(await rpc(method, params ? JSON.parse(params) : {}), null, 1));
} catch (e) {
  console.error(`error: ${e.message ?? e}`);
  process.exit(1);
}
