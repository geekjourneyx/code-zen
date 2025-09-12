use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use super::storage::ensure_health_schema;

fn day_of(ts: &DateTime<Utc>) -> String { ts.date_naive().to_string() }

pub fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = crate::commands::agents::init_database(app).map_err(|e| e.to_string())?;
    ensure_health_schema(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn record_event(
    conn: &Connection,
    event: &str,
    kind: &str,
    trigger_source: Option<&str>,
    duration_sec: Option<f64>,
    value: Option<f64>,
    meta_json: Option<&str>,
) -> Result<(), String> {
    let now = Utc::now();
    let ts = now.to_rfc3339();
    let day = day_of(&now);
    conn.execute(
        "INSERT INTO health_events(ts, day, event, kind, trigger_source, duration_sec, value, meta_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            ts,
            day,
            event,
            kind,
            trigger_source.unwrap_or("") ,
            duration_sec,
            value,
            meta_json.unwrap_or("{}")
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn prune(conn: &Connection, day: Option<&str>, max_per_day: i64, ttl_days: i64) -> Result<(), String> {
    // TTL: delete activity older than ttl_days, and any events older than ttl_days for now
    conn.execute(
        "DELETE FROM health_events WHERE ts < datetime('now', ?1)",
        params![format!("-{} days", ttl_days)],
    ).map_err(|e| e.to_string())?;

    // Cap per-day rows: prefer keeping non-activity
    let target_day = if let Some(d) = day { d.to_string() } else { Utc::now().date_naive().to_string() };
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM health_events WHERE day=?1",
        params![&target_day],
        |row| row.get(0),
    ).unwrap_or(0);
    if count > max_per_day {
        let to_delete = count - max_per_day;
        // delete oldest activity first
        let _ = conn.execute(
            "DELETE FROM health_events WHERE id IN (
               SELECT id FROM health_events WHERE day=?1 AND event!='notice' ORDER BY id ASC LIMIT ?2
             )",
            params![&target_day, to_delete],
        );
    }
    Ok(())
}
