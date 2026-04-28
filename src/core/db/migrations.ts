import type Database from 'better-sqlite3';

export const CURRENT_DB_SCHEMA_VERSION = 4;

export interface DbMigration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrationV1 = (db: Database.Database): void => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS city_config (
      city_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      series_slug TEXT NOT NULL UNIQUE,
      airport_code TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      resolution_source_override TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS city_config_series_slug_idx ON city_config(series_slug)`,
    `CREATE TABLE IF NOT EXISTS tracked_events (
      event_id TEXT PRIMARY KEY,
      city_key TEXT NOT NULL,
      series_slug TEXT NOT NULL,
      event_date TEXT NOT NULL,
      title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      closed INTEGER NOT NULL DEFAULT 0,
      end_date TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS tracked_events_city_date_idx ON tracked_events(city_key, event_date)`,
    `CREATE INDEX IF NOT EXISTS tracked_events_series_slug_idx ON tracked_events(series_slug)`,
    `CREATE TABLE IF NOT EXISTS tracked_markets (
      market_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      city_key TEXT NOT NULL,
      series_slug TEXT NOT NULL,
      event_date TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      group_item_title TEXT NOT NULL,
      token_yes_id TEXT NOT NULL,
      token_no_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      closed INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS tracked_markets_event_idx ON tracked_markets(event_id)`,
    `CREATE INDEX IF NOT EXISTS tracked_markets_city_date_idx ON tracked_markets(city_key, event_date)`,
    `CREATE INDEX IF NOT EXISTS tracked_markets_token_yes_idx ON tracked_markets(token_yes_id)`,
    `CREATE INDEX IF NOT EXISTS tracked_markets_token_no_idx ON tracked_markets(token_no_id)`,
    `CREATE TABLE IF NOT EXISTS latest_token_state (
      token_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL,
      last_trade_price REAL,
      best_bid REAL,
      best_ask REAL,
      spread REAL,
      last_message_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS latest_token_state_market_idx ON latest_token_state(market_id)`,
    `CREATE TABLE IF NOT EXISTS price_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      last_trade_price REAL,
      best_bid REAL,
      best_ask REAL,
      spread REAL
    )`,
    `CREATE INDEX IF NOT EXISTS price_ticks_token_time_idx ON price_ticks(token_id, timestamp)`,
    `CREATE INDEX IF NOT EXISTS price_ticks_market_time_idx ON price_ticks(market_id, timestamp)`,
    `CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      window_sec INTEGER NOT NULL DEFAULT 60,
      cooldown_sec INTEGER NOT NULL DEFAULT 300,
      dedupe_window_sec INTEGER NOT NULL DEFAULT 60,
      severity TEXT NOT NULL,
      sound_profile_id TEXT,
      scope_city_key TEXT,
      scope_series_slug TEXT,
      scope_event_date TEXT,
      scope_market_id TEXT,
      scope_token_id TEXT,
      scope_side TEXT,
      quiet_start_minute INTEGER,
      quiet_end_minute INTEGER,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS alert_rules_enabled_idx ON alert_rules(enabled)`,
    `CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      city_key TEXT,
      event_id TEXT,
      market_id TEXT,
      token_id TEXT,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS alert_events_rule_time_idx ON alert_events(rule_id, triggered_at)`,
    `CREATE INDEX IF NOT EXISTS alert_events_ack_idx ON alert_events(acknowledged)`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sound_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      volume REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS sound_profiles_default_idx ON sound_profiles(is_default)`,
    `CREATE TABLE IF NOT EXISTS feed_health (
      feed_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      last_ok_at INTEGER,
      last_message_at INTEGER NOT NULL,
      last_error TEXT,
      reconnect_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      updated_at INTEGER NOT NULL
    )`,
  ];

  execStatements(db, statements);
};

const migrationV2 = (db: Database.Database): void => {
  ensureColumn(db, 'alert_rules', 'is_builtin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'alert_rules', 'builtin_key', 'TEXT');
  ensureColumn(db, 'alert_rules', 'bubble_weight', 'REAL NOT NULL DEFAULT 60');
  ensureColumn(db, 'alert_events', 'builtin_key', 'TEXT');
};

const migrationV3 = (db: Database.Database): void => {
  ensureColumn(db, 'alert_rules', 'scope_temperature_band', 'TEXT');
  ensureColumn(db, 'alert_events', 'message_key', 'TEXT');
  ensureColumn(db, 'alert_events', 'message_params', 'TEXT');
  ensureColumn(db, 'alert_events', 'market_snapshot', 'TEXT');
  ensureColumn(db, 'sound_profiles', 'is_builtin', 'INTEGER NOT NULL DEFAULT 0');
};

const migrationV4 = (_db: Database.Database): void => {
  // Version 4 is intentionally reserved so newer builds keep user_version stable
  // without creating the unused experimental price_bars table in fresh databases.
};

export const DB_MIGRATIONS: readonly DbMigration[] = [
  {
    version: 1,
    name: 'initial-core-schema',
    up: migrationV1,
  },
  {
    version: 2,
    name: 'builtin-rule-metadata',
    up: migrationV2,
  },
  {
    version: 3,
    name: 'alert-payload-and-sound-metadata',
    up: migrationV3,
  },
  {
    version: 4,
    name: 'reserved-schema-version-4',
    up: migrationV4,
  },
] as const;

export const applyDbMigrations = (db: Database.Database): number[] => {
  const currentVersion = readUserVersion(db);
  const pendingMigrations = DB_MIGRATIONS.filter(
    (migration) => migration.version > currentVersion,
  );

  if (pendingMigrations.length === 0) {
    return [];
  }

  const appliedVersions: number[] = [];
  for (const migration of pendingMigrations) {
    const runMigration = db.transaction(() => {
      migration.up(db);
      writeUserVersion(db, migration.version);
    });
    runMigration();
    appliedVersions.push(migration.version);
  }

  return appliedVersions;
};

const readUserVersion = (db: Database.Database): number => {
  const row = db.pragma('user_version', { simple: true }) as number;
  return Number.isFinite(row) ? row : 0;
};

const writeUserVersion = (db: Database.Database, version: number): void => {
  db.pragma(`user_version = ${version}`);
};

const execStatements = (db: Database.Database, statements: readonly string[]): void => {
  for (const statement of statements) {
    db.exec(statement);
  }
};

const ensureColumn = (
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};
