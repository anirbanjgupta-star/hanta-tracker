#!/usr/bin/env node
import { buildServer } from './server.js';

const PORT = 5182;
const cwd = process.cwd();

const app = await buildServer(cwd);
await app.listen({ port: PORT });
console.log(`Relay daemon listening on http://localhost:${PORT} (watching ${cwd}/.relay)`);
