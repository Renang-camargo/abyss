import { createApp } from './app.js';

const app = await createApp();
const port = await app.listen();
console.log(`[abyss] servidor ouvindo em http://localhost:${port}`);

const shutdown = async (sig: string) => {
  console.log(`[abyss] ${sig} recebido, encerrando…`);
  await app.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
