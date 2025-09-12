use rusqlite::{params, Connection, Result as SqliteResult};

pub fn ensure_health_schema(conn: &Connection) -> SqliteResult<()> {
    // One-time cleanup for legacy VibeGuard tables (safe no-op if absent)
    let _ = conn.execute("DROP TABLE IF EXISTS wellness_events", []);
    let _ = conn.execute("DROP TABLE IF EXISTS wellness_settings", []);
    let _ = conn.execute("DROP TABLE IF EXISTS wellness_sessions", []);
    let _ = conn.execute("DROP TABLE IF EXISTS wellness_achievements", []);

    // Unified events table: only two break kinds + nightly notice
    // event: nudge|done|snooze|skip|notice
    // kind: activity|eye|nightly
    conn.execute(
        "CREATE TABLE IF NOT EXISTS health_events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            day TEXT NOT NULL,
            event TEXT NOT NULL,
            kind TEXT NOT NULL,
            trigger_source TEXT,       -- breakpoint|flow|periodic|manual|nightly
            duration_sec REAL,         -- only for done (actual)
            value REAL,                -- optional (e.g., snooze minutes)
            meta_json TEXT
        )",
        [],
    )?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_health_events_ts ON health_events(ts)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_health_events_day ON health_events(day)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_health_events_kind ON health_events(kind)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_health_events_event ON health_events(event)", [])?;

    // Preferences as single-row key-value (store JSON under key 'prefs')
    conn.execute(
        "CREATE TABLE IF NOT EXISTS health_prefs(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

pub fn set_pref(conn: &Connection, key: &str, json_value: &str) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO health_prefs(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, json_value],
    )?;
    Ok(())
}

pub fn get_prefs(conn: &Connection) -> SqliteResult<serde_json::Value> {
    let mut stmt = conn.prepare("SELECT key, value FROM health_prefs")?;
    let rows = stmt.query_map([], |row| {
        let k: String = row.get(0)?;
        let v: String = row.get(1)?;
        Ok((k, v))
    })?;
    let mut out = serde_json::Map::new();
    for r in rows {
        let (k, v) = r?;
        let parsed = serde_json::from_str::<serde_json::Value>(&v)
            .unwrap_or_else(|_| serde_json::Value::String(v));
        out.insert(k, parsed);
    }
    Ok(serde_json::Value::Object(out))
}
