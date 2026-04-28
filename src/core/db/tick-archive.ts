import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface ArchivedPriceTick {
  id: number;
  tokenId: string;
  marketId: string;
  timestamp: number;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
}

export interface TickArchiveMonthResult {
  monthKey: string;
  filePath: string;
  selected: number;
  inserted: number;
  skipped: number;
  aggregateRows: number;
}

export interface ArchivePriceTickBatchOptions {
  archiveDir: string;
  ticks: ArchivedPriceTick[];
}

export interface ArchivePriceTickBatchResult {
  inserted: number;
  skipped: number;
  aggregateRows: number;
  months: TickArchiveMonthResult[];
}

export const CURRENT_ARCHIVE_DB_SCHEMA_VERSION = 1;

type AggregateTableName = 'price_ticks_1m' | 'price_ticks_5m' | 'price_ticks_1h' | 'price_ticks_1d';

interface AggregateInterval {
  tableName: AggregateTableName;
  bucketMs: number;
}

interface MetricAggregateState {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

interface AggregateState {
  bucketStart: number;
  tokenId: string;
  marketId: string;
  tickCount: number;
  openTimestamp: number;
  openSourceTickId: number;
  closeTimestamp: number;
  closeSourceTickId: number;
  lastTradePrice: MetricAggregateState;
  bestBid: MetricAggregateState;
  bestAsk: MetricAggregateState;
  spread: MetricAggregateState;
}

interface AggregateRow {
  bucket_start: number;
  token_id: string;
  market_id: string;
  tick_count: number;
  open_timestamp: number;
  open_source_tick_id: number;
  close_timestamp: number;
  close_source_tick_id: number;
  last_trade_open: number | null;
  last_trade_high: number | null;
  last_trade_low: number | null;
  last_trade_close: number | null;
  best_bid_open: number | null;
  best_bid_high: number | null;
  best_bid_low: number | null;
  best_bid_close: number | null;
  best_ask_open: number | null;
  best_ask_high: number | null;
  best_ask_low: number | null;
  best_ask_close: number | null;
  spread_open: number | null;
  spread_high: number | null;
  spread_low: number | null;
  spread_close: number | null;
}

interface ArchivePriceTickRow {
  source_tick_id: number;
  token_id: string;
  market_id: string;
  timestamp: number;
  last_trade_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
}

interface ArchiveDbMigration {
  version: number;
  up: (db: Database.Database) => void;
}

const ARCHIVE_INTERVALS: readonly AggregateInterval[] = [
  { tableName: 'price_ticks_1m', bucketMs: 60_000 },
  { tableName: 'price_ticks_5m', bucketMs: 5 * 60_000 },
  { tableName: 'price_ticks_1h', bucketMs: 60 * 60_000 },
  { tableName: 'price_ticks_1d', bucketMs: 24 * 60 * 60_000 },
] as const;

const ARCHIVE_DB_MIGRATIONS: readonly ArchiveDbMigration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS price_ticks (
          source_tick_id INTEGER PRIMARY KEY,
          token_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          last_trade_price REAL,
          best_bid REAL,
          best_ask REAL,
          spread REAL
        );
        CREATE INDEX IF NOT EXISTS archive_price_ticks_token_time_idx
          ON price_ticks(token_id, timestamp);
        CREATE INDEX IF NOT EXISTS archive_price_ticks_market_time_idx
          ON price_ticks(market_id, timestamp);
      `);

      for (const interval of ARCHIVE_INTERVALS) {
        db.exec(createAggregateTableSql(interval.tableName));
      }

      backfillArchiveAggregateTables(db);
    },
  },
] as const;

export const archivePriceTickBatch = (
  options: ArchivePriceTickBatchOptions,
): ArchivePriceTickBatchResult => {
  if (options.ticks.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      aggregateRows: 0,
      months: [],
    };
  }

  ensureDirectory(options.archiveDir);

  const ticksByMonth = new Map<string, ArchivedPriceTick[]>();
  for (const tick of options.ticks) {
    const monthKey = getArchiveMonthKey(tick.timestamp);
    const rows = ticksByMonth.get(monthKey) ?? [];
    rows.push(tick);
    ticksByMonth.set(monthKey, rows);
  }

  let inserted = 0;
  let skipped = 0;
  let aggregateRows = 0;
  const months: TickArchiveMonthResult[] = [];

  const monthKeys = [...ticksByMonth.keys()].sort();
  for (const monthKey of monthKeys) {
    const ticks = ticksByMonth.get(monthKey) ?? [];
    const filePath = resolveArchiveDbPath(options.archiveDir, monthKey);
    const result = archiveMonthTicks(filePath, ticks);
    inserted += result.inserted;
    skipped += result.skipped;
    aggregateRows += result.aggregateRows;
    months.push({
      monthKey,
      filePath,
      selected: ticks.length,
      inserted: result.inserted,
      skipped: result.skipped,
      aggregateRows: result.aggregateRows,
    });
  }

  return {
    inserted,
    skipped,
    aggregateRows,
    months,
  };
};

export const getArchiveMonthKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export const resolveArchiveDbPath = (archiveDir: string, monthKey: string): string =>
  path.join(archiveDir, `price-ticks-${monthKey}.sqlite`);

const archiveMonthTicks = (
  filePath: string,
  ticks: readonly ArchivedPriceTick[],
): { inserted: number; skipped: number; aggregateRows: number } => {
  const db = createArchiveDatabase(filePath);

  try {
    const insertRawTick = db.prepare(`
      INSERT OR IGNORE INTO price_ticks (
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

    const aggregateSelectors = new Map<AggregateTableName, Database.Statement>();
    const aggregateUpserts = new Map<AggregateTableName, Database.Statement>();
    for (const interval of ARCHIVE_INTERVALS) {
      aggregateSelectors.set(interval.tableName, prepareAggregateSelector(db, interval.tableName));
      aggregateUpserts.set(interval.tableName, prepareAggregateUpsert(db, interval.tableName));
    }

    const archiveTransaction = db.transaction((rows: readonly ArchivedPriceTick[]) => {
      const insertedTicks: ArchivedPriceTick[] = [];
      let skippedCount = 0;
      let aggregateRowCount = 0;

      for (const tick of rows) {
        const result = insertRawTick.run(
          tick.id,
          tick.tokenId,
          tick.marketId,
          tick.timestamp,
          tick.lastTradePrice,
          tick.bestBid,
          tick.bestAsk,
          tick.spread,
        );

        if (Number(result.changes ?? 0) > 0) {
          insertedTicks.push(tick);
        } else {
          skippedCount += 1;
        }
      }

      if (insertedTicks.length > 0) {
        for (const interval of ARCHIVE_INTERVALS) {
          const aggregateStates = buildAggregateStates(insertedTicks, interval.bucketMs);
          aggregateRowCount += aggregateStates.size;
          const selectAggregate = aggregateSelectors.get(interval.tableName);
          const upsertAggregate = aggregateUpserts.get(interval.tableName);

          if (!selectAggregate || !upsertAggregate) {
            throw new Error(`Missing aggregate statements for ${interval.tableName}`);
          }

          for (const state of aggregateStates.values()) {
            const existingRow = selectAggregate.get(
              state.bucketStart,
              state.tokenId,
              state.marketId,
            ) as AggregateRow | undefined;
            const mergedState = existingRow
              ? mergeAggregateStates(fromAggregateRow(existingRow), state)
              : state;
            upsertAggregate.run(toAggregateRecord(mergedState));
          }
        }
      }

      return {
        inserted: insertedTicks.length,
        skipped: skippedCount,
        aggregateRows: aggregateRowCount,
      };
    });

    return archiveTransaction(ticks);
  } finally {
    db.close();
  }
};

const backfillArchiveAggregateTables = (db: Database.Database): void => {
  const rows = db
    .prepare(
      `SELECT
        source_tick_id,
        token_id,
        market_id,
        timestamp,
        last_trade_price,
        best_bid,
        best_ask,
        spread
      FROM price_ticks
      ORDER BY timestamp ASC, source_tick_id ASC`,
    )
    .all() as ArchivePriceTickRow[];

  if (rows.length === 0) {
    return;
  }

  const ticks = rows.map(fromArchivePriceTickRow);
  for (const interval of ARCHIVE_INTERVALS) {
    const aggregateStates = buildAggregateStates(ticks, interval.bucketMs);
    const upsertAggregate = prepareAggregateUpsert(db, interval.tableName);

    for (const state of aggregateStates.values()) {
      upsertAggregate.run(toAggregateRecord(state));
    }
  }
};

const prepareAggregateSelector = (
  db: Database.Database,
  tableName: AggregateTableName,
): Database.Statement =>
  db.prepare(`
    SELECT *
    FROM ${tableName}
    WHERE bucket_start = ? AND token_id = ? AND market_id = ?
  `);

const prepareAggregateUpsert = (
  db: Database.Database,
  tableName: AggregateTableName,
): Database.Statement =>
  db.prepare(`
    INSERT INTO ${tableName} (
      bucket_start,
      token_id,
      market_id,
      tick_count,
      open_timestamp,
      open_source_tick_id,
      close_timestamp,
      close_source_tick_id,
      last_trade_open,
      last_trade_high,
      last_trade_low,
      last_trade_close,
      best_bid_open,
      best_bid_high,
      best_bid_low,
      best_bid_close,
      best_ask_open,
      best_ask_high,
      best_ask_low,
      best_ask_close,
      spread_open,
      spread_high,
      spread_low,
      spread_close
    ) VALUES (
      @bucketStart,
      @tokenId,
      @marketId,
      @tickCount,
      @openTimestamp,
      @openSourceTickId,
      @closeTimestamp,
      @closeSourceTickId,
      @lastTradeOpen,
      @lastTradeHigh,
      @lastTradeLow,
      @lastTradeClose,
      @bestBidOpen,
      @bestBidHigh,
      @bestBidLow,
      @bestBidClose,
      @bestAskOpen,
      @bestAskHigh,
      @bestAskLow,
      @bestAskClose,
      @spreadOpen,
      @spreadHigh,
      @spreadLow,
      @spreadClose
    )
    ON CONFLICT(bucket_start, token_id, market_id) DO UPDATE SET
      tick_count = excluded.tick_count,
      open_timestamp = excluded.open_timestamp,
      open_source_tick_id = excluded.open_source_tick_id,
      close_timestamp = excluded.close_timestamp,
      close_source_tick_id = excluded.close_source_tick_id,
      last_trade_open = excluded.last_trade_open,
      last_trade_high = excluded.last_trade_high,
      last_trade_low = excluded.last_trade_low,
      last_trade_close = excluded.last_trade_close,
      best_bid_open = excluded.best_bid_open,
      best_bid_high = excluded.best_bid_high,
      best_bid_low = excluded.best_bid_low,
      best_bid_close = excluded.best_bid_close,
      best_ask_open = excluded.best_ask_open,
      best_ask_high = excluded.best_ask_high,
      best_ask_low = excluded.best_ask_low,
      best_ask_close = excluded.best_ask_close,
      spread_open = excluded.spread_open,
      spread_high = excluded.spread_high,
      spread_low = excluded.spread_low,
      spread_close = excluded.spread_close
  `);

const createArchiveDatabase = (filePath: string): Database.Database => {
  ensureDirectory(path.dirname(filePath));

  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_size_limit = 0');

  applyArchiveDbMigrations(db);
  return db;
};

const applyArchiveDbMigrations = (db: Database.Database): number[] => {
  const currentVersion = readArchiveUserVersion(db);
  if (currentVersion >= CURRENT_ARCHIVE_DB_SCHEMA_VERSION) {
    return [];
  }

  const pendingMigrations = ARCHIVE_DB_MIGRATIONS.filter(
    (migration) => migration.version > currentVersion,
  );
  const appliedVersions: number[] = [];

  for (const migration of pendingMigrations) {
    const runMigration = db.transaction(() => {
      migration.up(db);
      writeArchiveUserVersion(db, migration.version);
    });
    runMigration();
    appliedVersions.push(migration.version);
  }

  return appliedVersions;
};

const readArchiveUserVersion = (db: Database.Database): number => {
  const row = db.pragma('user_version', { simple: true }) as number;
  return Number.isFinite(row) ? row : 0;
};

const writeArchiveUserVersion = (db: Database.Database, version: number): void => {
  db.pragma(`user_version = ${version}`);
};

const createAggregateTableSql = (tableName: AggregateTableName): string => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    bucket_start INTEGER NOT NULL,
    token_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    tick_count INTEGER NOT NULL,
    open_timestamp INTEGER NOT NULL,
    open_source_tick_id INTEGER NOT NULL,
    close_timestamp INTEGER NOT NULL,
    close_source_tick_id INTEGER NOT NULL,
    last_trade_open REAL,
    last_trade_high REAL,
    last_trade_low REAL,
    last_trade_close REAL,
    best_bid_open REAL,
    best_bid_high REAL,
    best_bid_low REAL,
    best_bid_close REAL,
    best_ask_open REAL,
    best_ask_high REAL,
    best_ask_low REAL,
    best_ask_close REAL,
    spread_open REAL,
    spread_high REAL,
    spread_low REAL,
    spread_close REAL,
    PRIMARY KEY(bucket_start, token_id, market_id)
  );
  CREATE INDEX IF NOT EXISTS ${tableName}_token_bucket_idx
    ON ${tableName}(token_id, bucket_start);
  CREATE INDEX IF NOT EXISTS ${tableName}_market_bucket_idx
    ON ${tableName}(market_id, bucket_start);
`;

const buildAggregateStates = (
  ticks: readonly ArchivedPriceTick[],
  bucketMs: number,
): Map<string, AggregateState> => {
  const states = new Map<string, AggregateState>();

  for (const tick of ticks) {
    const bucketStart = Math.floor(tick.timestamp / bucketMs) * bucketMs;
    const key = `${bucketStart}:${tick.tokenId}:${tick.marketId}`;
    const current = states.get(key);

    if (!current) {
      states.set(key, createAggregateState(bucketStart, tick));
      continue;
    }

    current.tickCount += 1;
    updateExtrema(current.lastTradePrice, tick.lastTradePrice);
    updateExtrema(current.bestBid, tick.bestBid);
    updateExtrema(current.bestAsk, tick.bestAsk);
    updateExtrema(current.spread, tick.spread);

    if (compareTickOrder(tick.timestamp, tick.id, current.openTimestamp, current.openSourceTickId) < 0) {
      current.openTimestamp = tick.timestamp;
      current.openSourceTickId = tick.id;
      current.lastTradePrice.open = tick.lastTradePrice;
      current.bestBid.open = tick.bestBid;
      current.bestAsk.open = tick.bestAsk;
      current.spread.open = tick.spread;
    }

    if (compareTickOrder(tick.timestamp, tick.id, current.closeTimestamp, current.closeSourceTickId) > 0) {
      current.closeTimestamp = tick.timestamp;
      current.closeSourceTickId = tick.id;
      current.lastTradePrice.close = tick.lastTradePrice;
      current.bestBid.close = tick.bestBid;
      current.bestAsk.close = tick.bestAsk;
      current.spread.close = tick.spread;
    }
  }

  return states;
};

const createAggregateState = (bucketStart: number, tick: ArchivedPriceTick): AggregateState => ({
  bucketStart,
  tokenId: tick.tokenId,
  marketId: tick.marketId,
  tickCount: 1,
  openTimestamp: tick.timestamp,
  openSourceTickId: tick.id,
  closeTimestamp: tick.timestamp,
  closeSourceTickId: tick.id,
  lastTradePrice: {
    open: tick.lastTradePrice,
    high: tick.lastTradePrice,
    low: tick.lastTradePrice,
    close: tick.lastTradePrice,
  },
  bestBid: {
    open: tick.bestBid,
    high: tick.bestBid,
    low: tick.bestBid,
    close: tick.bestBid,
  },
  bestAsk: {
    open: tick.bestAsk,
    high: tick.bestAsk,
    low: tick.bestAsk,
    close: tick.bestAsk,
  },
  spread: {
    open: tick.spread,
    high: tick.spread,
    low: tick.spread,
    close: tick.spread,
  },
});

const fromArchivePriceTickRow = (row: ArchivePriceTickRow): ArchivedPriceTick => ({
  id: row.source_tick_id,
  tokenId: row.token_id,
  marketId: row.market_id,
  timestamp: row.timestamp,
  lastTradePrice: row.last_trade_price,
  bestBid: row.best_bid,
  bestAsk: row.best_ask,
  spread: row.spread,
});

const mergeAggregateStates = (left: AggregateState, right: AggregateState): AggregateState => {
  const useLeftOpen =
    compareTickOrder(left.openTimestamp, left.openSourceTickId, right.openTimestamp, right.openSourceTickId) <= 0;
  const useLeftClose =
    compareTickOrder(left.closeTimestamp, left.closeSourceTickId, right.closeTimestamp, right.closeSourceTickId) >= 0;

  return {
    bucketStart: left.bucketStart,
    tokenId: left.tokenId,
    marketId: left.marketId,
    tickCount: left.tickCount + right.tickCount,
    openTimestamp: useLeftOpen ? left.openTimestamp : right.openTimestamp,
    openSourceTickId: useLeftOpen ? left.openSourceTickId : right.openSourceTickId,
    closeTimestamp: useLeftClose ? left.closeTimestamp : right.closeTimestamp,
    closeSourceTickId: useLeftClose ? left.closeSourceTickId : right.closeSourceTickId,
    lastTradePrice: {
      open: useLeftOpen ? left.lastTradePrice.open : right.lastTradePrice.open,
      high: maxNullable(left.lastTradePrice.high, right.lastTradePrice.high),
      low: minNullable(left.lastTradePrice.low, right.lastTradePrice.low),
      close: useLeftClose ? left.lastTradePrice.close : right.lastTradePrice.close,
    },
    bestBid: {
      open: useLeftOpen ? left.bestBid.open : right.bestBid.open,
      high: maxNullable(left.bestBid.high, right.bestBid.high),
      low: minNullable(left.bestBid.low, right.bestBid.low),
      close: useLeftClose ? left.bestBid.close : right.bestBid.close,
    },
    bestAsk: {
      open: useLeftOpen ? left.bestAsk.open : right.bestAsk.open,
      high: maxNullable(left.bestAsk.high, right.bestAsk.high),
      low: minNullable(left.bestAsk.low, right.bestAsk.low),
      close: useLeftClose ? left.bestAsk.close : right.bestAsk.close,
    },
    spread: {
      open: useLeftOpen ? left.spread.open : right.spread.open,
      high: maxNullable(left.spread.high, right.spread.high),
      low: minNullable(left.spread.low, right.spread.low),
      close: useLeftClose ? left.spread.close : right.spread.close,
    },
  };
};

const fromAggregateRow = (row: AggregateRow): AggregateState => ({
  bucketStart: row.bucket_start,
  tokenId: row.token_id,
  marketId: row.market_id,
  tickCount: row.tick_count,
  openTimestamp: row.open_timestamp,
  openSourceTickId: row.open_source_tick_id,
  closeTimestamp: row.close_timestamp,
  closeSourceTickId: row.close_source_tick_id,
  lastTradePrice: {
    open: row.last_trade_open,
    high: row.last_trade_high,
    low: row.last_trade_low,
    close: row.last_trade_close,
  },
  bestBid: {
    open: row.best_bid_open,
    high: row.best_bid_high,
    low: row.best_bid_low,
    close: row.best_bid_close,
  },
  bestAsk: {
    open: row.best_ask_open,
    high: row.best_ask_high,
    low: row.best_ask_low,
    close: row.best_ask_close,
  },
  spread: {
    open: row.spread_open,
    high: row.spread_high,
    low: row.spread_low,
    close: row.spread_close,
  },
});

const toAggregateRecord = (state: AggregateState) => ({
  bucketStart: state.bucketStart,
  tokenId: state.tokenId,
  marketId: state.marketId,
  tickCount: state.tickCount,
  openTimestamp: state.openTimestamp,
  openSourceTickId: state.openSourceTickId,
  closeTimestamp: state.closeTimestamp,
  closeSourceTickId: state.closeSourceTickId,
  lastTradeOpen: state.lastTradePrice.open,
  lastTradeHigh: state.lastTradePrice.high,
  lastTradeLow: state.lastTradePrice.low,
  lastTradeClose: state.lastTradePrice.close,
  bestBidOpen: state.bestBid.open,
  bestBidHigh: state.bestBid.high,
  bestBidLow: state.bestBid.low,
  bestBidClose: state.bestBid.close,
  bestAskOpen: state.bestAsk.open,
  bestAskHigh: state.bestAsk.high,
  bestAskLow: state.bestAsk.low,
  bestAskClose: state.bestAsk.close,
  spreadOpen: state.spread.open,
  spreadHigh: state.spread.high,
  spreadLow: state.spread.low,
  spreadClose: state.spread.close,
});

const updateExtrema = (metric: MetricAggregateState, value: number | null): void => {
  metric.high = maxNullable(metric.high, value);
  metric.low = minNullable(metric.low, value);
};

const compareTickOrder = (
  leftTimestamp: number,
  leftId: number,
  rightTimestamp: number,
  rightId: number,
): number => {
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  return leftId - rightId;
};

const maxNullable = (left: number | null, right: number | null): number | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
};

const minNullable = (left: number | null, right: number | null): number | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.min(left, right);
};

const ensureDirectory = (directoryPath: string): void => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
};
