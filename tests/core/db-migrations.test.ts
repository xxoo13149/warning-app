import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import {
  applyDbMigrations,
  CURRENT_DB_SCHEMA_VERSION,
  DB_MIGRATIONS,
} from '../../src/core/db/migrations';

interface FakeDbState {
  userVersion: number;
  statements: string[];
  tableColumns: Map<string, Set<string>>;
  transactionRuns: number;
}

const createFakeDb = (options?: {
  userVersion?: number;
  tableColumns?: Record<string, string[]>;
}) => {
  const state: FakeDbState = {
    userVersion: options?.userVersion ?? 0,
    statements: [],
    tableColumns: new Map(
      Object.entries(options?.tableColumns ?? {}).map(([tableName, columns]) => [
        tableName,
        new Set(columns),
      ]),
    ),
    transactionRuns: 0,
  };

  const db = {
    pragma: (statement: string, options?: { simple?: boolean }) => {
      state.statements.push(`PRAGMA ${statement}`);
      if (statement === 'user_version' && options?.simple) {
        return state.userVersion;
      }

      const writeMatch = statement.match(/^user_version\s*=\s*(\d+)$/);
      if (writeMatch) {
        state.userVersion = Number(writeMatch[1]);
      }

      return undefined;
    },
    exec: (statement: string) => {
      state.statements.push(statement);

      const createTableMatch = statement.match(/CREATE TABLE IF NOT EXISTS ([^( ]+)/i);
      if (createTableMatch) {
        const tableName = createTableMatch[1];
        if (!state.tableColumns.has(tableName)) {
          state.tableColumns.set(tableName, new Set());
        }
      }

      const alterTableMatch = statement.match(
        /ALTER TABLE ([^ ]+) ADD COLUMN ([^ ]+)/i,
      );
      if (alterTableMatch) {
        const tableName = alterTableMatch[1];
        const columnName = alterTableMatch[2];
        const columns = state.tableColumns.get(tableName) ?? new Set<string>();
        columns.add(columnName);
        state.tableColumns.set(tableName, columns);
      }
    },
    prepare: (statement: string) => ({
      all: () => {
        state.statements.push(statement);
        const pragmaMatch = statement.match(/^PRAGMA table_info\(([^)]+)\)$/i);
        if (!pragmaMatch) {
          return [];
        }

        const columns = state.tableColumns.get(pragmaMatch[1]) ?? new Set<string>();
        return [...columns].map((name) => ({ name }));
      },
    }),
    transaction: (callback: () => void) => () => {
      state.transactionRuns += 1;
      callback();
    },
  };

  return {
    db: db as unknown as Database.Database,
    state,
  };
};

describe('applyDbMigrations', () => {
  it('runs all pending migrations in order and bumps user_version', () => {
    const { db, state } = createFakeDb();

    const appliedVersions = applyDbMigrations(db);

    expect(appliedVersions).toEqual(DB_MIGRATIONS.map((migration) => migration.version));
    expect(state.userVersion).toBe(CURRENT_DB_SCHEMA_VERSION);
    expect(state.transactionRuns).toBe(DB_MIGRATIONS.length);
    expect(
      state.statements.some((statement) => statement.toLowerCase().includes('price_bars')),
    ).toBe(false);
  });

  it('skips migrations that are already covered by user_version', () => {
    const { db, state } = createFakeDb({
      userVersion: CURRENT_DB_SCHEMA_VERSION,
    });

    const appliedVersions = applyDbMigrations(db);

    expect(appliedVersions).toEqual([]);
    expect(state.transactionRuns).toBe(0);
  });

  it('keeps ensureColumn migrations idempotent for legacy databases that already have newer columns', () => {
    const { db, state } = createFakeDb({
      tableColumns: {
        alert_rules: [
          'id',
          'name',
          'enabled',
          'metric',
          'operator',
          'threshold',
          'window_sec',
          'cooldown_sec',
          'dedupe_window_sec',
          'severity',
          'sound_profile_id',
          'scope_city_key',
          'scope_series_slug',
          'scope_event_date',
          'scope_market_id',
          'scope_token_id',
          'scope_side',
          'quiet_start_minute',
          'quiet_end_minute',
          'updated_at',
          'is_builtin',
          'builtin_key',
          'bubble_weight',
          'scope_temperature_band',
        ],
        alert_events: [
          'id',
          'rule_id',
          'triggered_at',
          'city_key',
          'event_id',
          'market_id',
          'token_id',
          'message',
          'severity',
          'dedupe_key',
          'acknowledged',
          'builtin_key',
          'message_key',
          'message_params',
          'market_snapshot',
        ],
        sound_profiles: [
          'id',
          'name',
          'file_path',
          'volume',
          'enabled',
          'is_default',
          'updated_at',
          'is_builtin',
        ],
      },
    });

    const appliedVersions = applyDbMigrations(db);

    expect(appliedVersions).toEqual(DB_MIGRATIONS.map((migration) => migration.version));
    expect(
      state.statements.some((statement) =>
        statement.includes('ALTER TABLE alert_rules ADD COLUMN is_builtin'),
      ),
    ).toBe(false);
    expect(
      state.statements.some((statement) =>
        statement.includes('ALTER TABLE alert_events ADD COLUMN message_key'),
      ),
    ).toBe(false);
    expect(
      state.statements.some((statement) =>
        statement.includes('ALTER TABLE sound_profiles ADD COLUMN is_builtin'),
      ),
    ).toBe(false);
  });
});
