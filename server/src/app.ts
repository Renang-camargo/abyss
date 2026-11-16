import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@abyss/shared';
import { loadConfig, type AppConfig } from './config.js';
import { QuestionBank } from './questions/bank.js';
import { AnswerValidator } from './validation/validator.js';
import { ValidationService } from './validation/service.js';
import { AnthropicJudge, type SemanticJudge } from './validation/semantic.js';
import { RarityModel } from './scoring/rarity.js';
import { RoomManager } from './rooms/RoomManager.js';
import { attachRealtime, type RealtimeOptions } from './realtime/socket.js';
import { MemoryRepository, type Repository } from './persistence/repository.js';
import { PostgresRepository, SqliteRepository } from './persistence/sql.js';
import { KeyedWindowLimiter } from './realtime/rateLimit.js';

export interface AppOverrides {
  config?: Partial<AppConfig>;
  repo?: Repository;
  bank?: QuestionBank;
  judge?: SemanticJudge | null;
  realtime?: Partial<RealtimeOptions>;
  quiet?: boolean;
}

export interface AbyssApp {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
  repo: Repository;
  bank: QuestionBank;
  config: AppConfig;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export async function createApp(over: AppOverrides = {}): Promise<AbyssApp> {
  const config: AppConfig = { ...loadConfig(), ...over.config } as AppConfig;
  const log = over.quiet ? () => undefined : (msg: string, extra?: object) => console.log(`[abyss] ${msg}`, extra ? JSON.stringify(extra) : '');

  // ── Banco de perguntas (falha cedo se houver erro de curadoria) ──
  const bank = over.bank ?? QuestionBank.fromDirectory(config.questionsDir);
  const errors = bank.check().filter((i) => i.level === 'error');
  if (errors.length) throw new Error(`Banco de perguntas inválido:\n${errors.map((e) => `${e.question}: ${e.message}`).join('\n')}`);

  // ── Persistência ──
  const repo: Repository =
    over.repo ?? (config.databaseUrl ? new PostgresRepository(config.databaseUrl) : new SqliteRepository(config.sqliteFile));
  await repo.init();

  // ── Validação + raridade ──
  const lexicon = existsSync(config.lexiconFile)
    ? readFileSync(config.lexiconFile, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : [];
  const validator = new AnswerValidator(bank, lexicon);
  const judge = over.judge !== undefined ? over.judge : config.anthropicKey ? new AnthropicJudge(config.anthropicKey, config.aiModel) : null;
  const validation = new ValidationService(validator, (id) => bank.get(id), {
    judge,
    onUnmatched: (q, n, raw, ai) => void repo.recordUnmatched(q, n, raw, ai).catch(() => undefined),
  });
  const rarity = new RarityModel((id) => bank.get(id), { priorStrength: config.priorStrength });
  rarity.load(await repo.loadAnswerStats());

  // ── HTTP ──
  const app = express();
  app.set('trust proxy', 1); // atrás do proxy do Render/Railway: IP real para o rate limit
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  const httpLimiter = new KeyedWindowLimiter(120, 60_000);
  // Cliente hospedado em outro domínio (ex.: Vercel): libera só as origens configuradas.
  const allowed = config.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });
  app.use('/api', (req, res, next) => (httpLimiter.allow(req.ip ?? 'x') ? next() : res.status(429).json({ error: 'RATE_LIMITED' })));
  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, rooms: manager.rooms.size, persistence: repo.kind, ai: validation.aiEnabled, ...(await repo.stats().catch(() => ({}))) });
  });
  app.get('/api/categories', (_req, res) => res.json(bank.categories()));

  if (existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }

  const http = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    maxHttpBufferSize: 8 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    cors: allowed.length ? { origin: allowed } : undefined,
    connectionStateRecovery: undefined,
  });

  const manager = new RoomManager({
    timings: config.timings,
    bank,
    validation,
    rarity,
    repo,
    log,
    emitToRoom: (code, event, payload) => (io as unknown as Server).to(code).emit(event, payload),
    emitToSocket: (id, event, payload) => (io as unknown as Server).to(id).emit(event, payload),
    joinChannel: (id, code) => io.sockets.sockets.get(id)?.join(code),
    leaveChannel: (id, code) => io.sockets.sockets.get(id)?.leave(code),
    disconnectSocket: (id) => io.sockets.sockets.get(id)?.disconnect(true),
  });
  attachRealtime(io, manager, { log, ...over.realtime });

  log('pronto', {
    perguntas: bank.questions.length,
    respostas: bank.questions.reduce((s, q) => s + q.answers.length, 0),
    persistencia: repo.kind,
    ia: judge ? judge.name : 'desligada',
  });

  return {
    http,
    io,
    manager,
    repo,
    bank,
    config,
    listen(port = config.port) {
      return new Promise((resolve) => {
        http.listen(port, config.host, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    async close() {
      manager.shutdown();
      io.close();
      await new Promise<void>((r) => http.close(() => r()));
      await repo.close();
    },
  };
}

export { MemoryRepository };
