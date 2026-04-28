import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { WeatherMonitorRepository } from '../../src/core/db/repository';
import {
  archivePriceTickBatch,
  CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
  resolveArchiveDbPath,
} from '../../src/core/db/tick-archive';

const tempRoots: string[] = [];
const repositories: WeatherMonitorRepository[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.close();
  }

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('WeatherMonitorRepository archivePriceTicks', () => {
  it('archives old ticks into monthly sqlite files and maintains aggregate tables', () => {
    const { repository, dbPath, archiveDir } = createRepository();
    repository.insertPriceTicks([
      {
        tokenId: 'token-jan',
        marketId: 'market-jan',
        timestamp: Date.UTC(2026, 0, 5, 12, 0, 5),
        lastTradePrice: 0.4,
        bestBid: 0.38,
        bestAsk: 0.42,
        spread: 0.04,
      },
      {
        tokenId: 'token-jan',
        marketId: 'market-jan',
        timestamp: Date.UTC(2026, 0, 5, 12, 0, 30),
        lastTradePrice: 0.45,
        bestBid: 0.43,
        bestAsk: 0.46,
        spread: 0.03,
      },
      {
        tokenId: 'token-feb',
        marketId: 'market-feb',
        timestamp: Date.UTC(2026, 1, 10, 8, 2, 0),
        lastTradePrice: 0.5,
        bestBid: 0.48,
        bestAsk: 0.52,
        spread: 0.04,
      },
      {
        tokenId: 'token-feb',
        marketId: 'market-feb',
        timestamp: Date.UTC(2026, 1, 10, 8, 9, 0),
        lastTradePrice: 0.48,
        bestBid: 0.46,
        bestAsk: 0.5,
        spread: 0.04,
      },
      {
        tokenId: 'token-hot',
        marketId: 'market-hot',
        timestamp: Date.UTC(2026, 2, 1, 12, 0, 0),
        lastTradePrice: 0.61,
        bestBid: 0.6,
        bestAsk: 0.62,
        spread: 0.02,
      },
    ]);

    const result = repository.archivePriceTicks({
      cutoffTimestamp: Date.UTC(2026, 1, 15, 0, 0, 0),
      batchSize: 10,
    });

    expect(result).toMatchObject({
      selected: 4,
      inserted: 4,
      skipped: 0,
      deleted: 4,
      hasMore: false,
    });
    expect(result.months.map((item) => item.monthKey)).toEqual(['2026-01', '2026-02']);
    expect(readMainTickCount(dbPath)).toBe(1);

    const januaryArchivePath = resolveArchiveDbPath(archiveDir, '2026-01');
    const februaryArchivePath = resolveArchiveDbPath(archiveDir, '2026-02');
    expect(fs.existsSync(januaryArchivePath)).toBe(true);
    expect(fs.existsSync(februaryArchivePath)).toBe(true);

    const januaryDb = new Database(januaryArchivePath, { readonly: true });
    const februaryDb = new Database(februaryArchivePath, { readonly: true });

    try {
      expect(januaryDb.pragma('user_version', { simple: true })).toBe(
        CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
      );
      expect(readCount(januaryDb, 'price_ticks')).toBe(2);
      expect(readCount(januaryDb, 'price_ticks_1m')).toBe(1);
      expect(readCount(januaryDb, 'price_ticks_5m')).toBe(1);
      expect(readCount(januaryDb, 'price_ticks_1h')).toBe(1);
      expect(readCount(januaryDb, 'price_ticks_1d')).toBe(1);

      const january1m = januaryDb
        .prepare(
          'SELECT tick_count, last_trade_open, last_trade_high, last_trade_low, last_trade_close FROM price_ticks_1m',
        )
        .get() as {
        tick_count: number;
        last_trade_open: number;
        last_trade_high: number;
        last_trade_low: number;
        last_trade_close: number;
      };
      expect(january1m).toEqual({
        tick_count: 2,
        last_trade_open: 0.4,
        last_trade_high: 0.45,
        last_trade_low: 0.4,
        last_trade_close: 0.45,
      });

      expect(februaryDb.pragma('user_version', { simple: true })).toBe(
        CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
      );
      expect(readCount(februaryDb, 'price_ticks')).toBe(2);
      expect(readCount(februaryDb, 'price_ticks_1m')).toBe(2);
      expect(readCount(februaryDb, 'price_ticks_5m')).toBe(2);
      expect(readCount(februaryDb, 'price_ticks_1h')).toBe(1);
      expect(readCount(februaryDb, 'price_ticks_1d')).toBe(1);

      const february1h = februaryDb
        .prepare(
          'SELECT tick_count, last_trade_open, last_trade_high, last_trade_low, last_trade_close FROM price_ticks_1h',
        )
        .get() as {
        tick_count: number;
        last_trade_open: number;
        last_trade_high: number;
        last_trade_low: number;
        last_trade_close: number;
      };
      expect(february1h).toEqual({
        tick_count: 2,
        last_trade_open: 0.5,
        last_trade_high: 0.5,
        last_trade_low: 0.48,
        last_trade_close: 0.48,
      });
    } finally {
      januaryDb.close();
      februaryDb.close();
    }
  });

  it('upgrades legacy archive files to schema version 1 before writing new aggregates', () => {
    const { repository, archiveDir } = createRepository();
    const archivePath = resolveArchiveDbPath(archiveDir, '2026-01');
    fs.mkdirSync(archiveDir, { recursive: true });

    const legacyArchiveDb = new Database(archivePath);
    legacyArchiveDb.exec(`
      CREATE TABLE IF NOT EXISTS price_ticks (
        source_tick_id INTEGER PRIMARY KEY,
        token_id TEXT NOT NULL,
        market_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        last_trade_price REAL,
        best_bid REAL,
        best_ask REAL,
        spread REAL
      )
    `);
    legacyArchiveDb.pragma('user_version = 0');
    legacyArchiveDb.close();

    repository.insertPriceTicks([
      {
        tokenId: 'token-upgrade',
        marketId: 'market-upgrade',
        timestamp: Date.UTC(2026, 0, 20, 10, 0, 0),
        lastTradePrice: 0.44,
        bestBid: 0.43,
        bestAsk: 0.45,
        spread: 0.02,
      },
    ]);

    const result = repository.archivePriceTicks({
      cutoffTimestamp: Date.UTC(2026, 0, 31, 23, 59, 59),
      batchSize: 10,
    });

    expect(result).toMatchObject({
      inserted: 1,
      skipped: 0,
      deleted: 1,
      hasMore: false,
    });

    const upgradedArchiveDb = new Database(archivePath, { readonly: true });
    try {
      expect(upgradedArchiveDb.pragma('user_version', { simple: true })).toBe(
        CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
      );
      expect(readCount(upgradedArchiveDb, 'price_ticks')).toBe(1);
      expect(readCount(upgradedArchiveDb, 'price_ticks_1m')).toBe(1);
      expect(readCount(upgradedArchiveDb, 'price_ticks_5m')).toBe(1);
      expect(readCount(upgradedArchiveDb, 'price_ticks_1h')).toBe(1);
      expect(readCount(upgradedArchiveDb, 'price_ticks_1d')).toBe(1);
    } finally {
      upgradedArchiveDb.close();
    }
  });

  it('backfills aggregates for legacy archive raw rows before skipped rows are deleted from main', () => {
    const { repository, dbPath, archiveDir } = createRepository();
    repository.insertPriceTicks([
      {
        tokenId: 'token-legacy-backfill',
        marketId: 'market-legacy-backfill',
        timestamp: Date.UTC(2026, 0, 18, 10, 0, 40),
        lastTradePrice: 0.41,
        bestBid: 0.4,
        bestAsk: 0.43,
        spread: 0.03,
      },
      {
        tokenId: 'token-legacy-backfill',
        marketId: 'market-legacy-backfill',
        timestamp: Date.UTC(2026, 0, 18, 10, 0, 5),
        lastTradePrice: 0.37,
        bestBid: 0.36,
        bestAsk: 0.39,
        spread: 0.03,
      },
    ]);

    const rows = readMainTickRows(dbPath);
    const archivePath = resolveArchiveDbPath(archiveDir, '2026-01');
    fs.mkdirSync(archiveDir, { recursive: true });

    const legacyArchiveDb = new Database(archivePath);
    try {
      legacyArchiveDb.exec(`
        CREATE TABLE IF NOT EXISTS price_ticks (
          source_tick_id INTEGER PRIMARY KEY,
          token_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          last_trade_price REAL,
          best_bid REAL,
          best_ask REAL,
          spread REAL
        )
      `);
      const insertLegacyRawTick = legacyArchiveDb.prepare(`
        INSERT INTO price_ticks (
          source_tick_id,
          token_id,
          market_id,
          timestamp,
          last_trade_price,
          best_bid,
          best_ask,
          spread
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insertLegacyRawTick.run(
          row.id,
          row.token_id,
          row.market_id,
          row.timestamp,
          row.last_trade_price,
          row.best_bid,
          row.best_ask,
          row.spread,
        );
      }
      legacyArchiveDb.pragma('user_version = 0');
    } finally {
      legacyArchiveDb.close();
    }

    const result = repository.archivePriceTicks({
      cutoffTimestamp: Date.UTC(2026, 0, 31, 23, 59, 59),
      batchSize: 10,
    });

    expect(result).toMatchObject({
      selected: 2,
      inserted: 0,
      skipped: 2,
      deleted: 2,
      hasMore: false,
    });
    expect(readMainTickCount(dbPath)).toBe(0);

    const archiveDb = new Database(archivePath, { readonly: true });
    try {
      expect(archiveDb.pragma('user_version', { simple: true })).toBe(
        CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
      );
      expect(readCount(archiveDb, 'price_ticks')).toBe(2);
      expect(readCount(archiveDb, 'price_ticks_1m')).toBe(1);
      expect(readCount(archiveDb, 'price_ticks_5m')).toBe(1);
      expect(readCount(archiveDb, 'price_ticks_1h')).toBe(1);
      expect(readCount(archiveDb, 'price_ticks_1d')).toBe(1);

      const aggregate = archiveDb
        .prepare(
          `SELECT
            tick_count,
            open_source_tick_id,
            close_source_tick_id,
            last_trade_open,
            last_trade_high,
            last_trade_low,
            last_trade_close
          FROM price_ticks_1m`,
        )
        .get() as {
        tick_count: number;
        open_source_tick_id: number;
        close_source_tick_id: number;
        last_trade_open: number;
        last_trade_high: number;
        last_trade_low: number;
        last_trade_close: number;
      };
      expect(aggregate).toEqual({
        tick_count: 2,
        open_source_tick_id: rows[0].id,
        close_source_tick_id: rows[1].id,
        last_trade_open: 0.37,
        last_trade_high: 0.41,
        last_trade_low: 0.37,
        last_trade_close: 0.41,
      });
    } finally {
      archiveDb.close();
    }
  });

  it('treats previously archived rows as skipped and still removes them from the main database', () => {
    const { repository, dbPath, archiveDir } = createRepository();
    repository.insertPriceTicks([
      {
        tokenId: 'token-idempotent',
        marketId: 'market-idempotent',
        timestamp: Date.UTC(2026, 0, 12, 9, 15, 0),
        lastTradePrice: 0.32,
        bestBid: 0.31,
        bestAsk: 0.33,
        spread: 0.02,
      },
      {
        tokenId: 'token-idempotent',
        marketId: 'market-idempotent',
        timestamp: Date.UTC(2026, 0, 12, 9, 16, 0),
        lastTradePrice: 0.35,
        bestBid: 0.34,
        bestAsk: 0.36,
        spread: 0.02,
      },
    ]);

    const mainDb = new Database(dbPath, { readonly: true });
    const rows = mainDb
      .prepare(
        `SELECT
          id,
          token_id,
          market_id,
          timestamp,
          last_trade_price,
          best_bid,
          best_ask,
          spread
        FROM price_ticks
        ORDER BY timestamp ASC, id ASC`,
      )
      .all() as Array<{
      id: number;
      token_id: string;
      market_id: string;
      timestamp: number;
      last_trade_price: number | null;
      best_bid: number | null;
      best_ask: number | null;
      spread: number | null;
    }>;
    mainDb.close();

    const preArchive = archivePriceTickBatch({
      archiveDir,
      ticks: rows.map((row) => ({
        id: row.id,
        tokenId: row.token_id,
        marketId: row.market_id,
        timestamp: row.timestamp,
        lastTradePrice: row.last_trade_price,
        bestBid: row.best_bid,
        bestAsk: row.best_ask,
        spread: row.spread,
      })),
    });
    expect(preArchive).toMatchObject({
      inserted: 2,
      skipped: 0,
    });

    const result = repository.archivePriceTicks({
      cutoffTimestamp: Date.UTC(2026, 0, 31, 23, 59, 59),
      batchSize: 10,
    });

    expect(result).toMatchObject({
      selected: 2,
      inserted: 0,
      skipped: 2,
      deleted: 2,
      hasMore: false,
    });
    expect(readMainTickCount(dbPath)).toBe(0);

    const archiveDb = new Database(resolveArchiveDbPath(archiveDir, '2026-01'), { readonly: true });
    try {
      expect(archiveDb.pragma('user_version', { simple: true })).toBe(
        CURRENT_ARCHIVE_DB_SCHEMA_VERSION,
      );
      expect(readCount(archiveDb, 'price_ticks')).toBe(2);
      expect(readCount(archiveDb, 'price_ticks_1m')).toBe(2);
      expect(readCount(archiveDb, 'price_ticks_5m')).toBe(1);
      expect(readCount(archiveDb, 'price_ticks_1h')).toBe(1);
      expect(readCount(archiveDb, 'price_ticks_1d')).toBe(1);
    } finally {
      archiveDb.close();
    }
  });
});

const createRepository = () => {
  const root = path.join(tmpdir(), `warning-app-archive-${randomUUID()}`);
  const dbPath = path.join(root, 'main.sqlite');
  const archiveDir = path.join(root, 'archive');
  tempRoots.push(root);

  const repository = new WeatherMonitorRepository({
    dbPath,
    archiveDir,
  });
  repositories.push(repository);
  repository.init();

  return {
    repository,
    dbPath,
    archiveDir,
  };
};

const readMainTickCount = (dbPath: string): number => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return readCount(db, 'price_ticks');
  } finally {
    db.close();
  }
};

const readMainTickRows = (
  dbPath: string,
): Array<{
  id: number;
  token_id: string;
  market_id: string;
  timestamp: number;
  last_trade_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
}> => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT
          id,
          token_id,
          market_id,
          timestamp,
          last_trade_price,
          best_bid,
          best_ask,
          spread
        FROM price_ticks
        ORDER BY timestamp ASC, id ASC`,
      )
      .all() as Array<{
      id: number;
      token_id: string;
      market_id: string;
      timestamp: number;
      last_trade_price: number | null;
      best_bid: number | null;
      best_ask: number | null;
      spread: number | null;
    }>;
  } finally {
    db.close();
  }
};

const readCount = (db: Database.Database, tableName: string): number => {
  const row = db.prepare(`SELECT COUNT(*) AS value FROM ${tableName}`).get() as { value: number };
  return row.value;
};
