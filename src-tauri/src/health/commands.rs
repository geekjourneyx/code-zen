use tauri::command;
use rusqlite::params;

use super::runtime::{open_db, record_event, prune};
use super::storage::{ensure_health_schema, set_pref, get_prefs};

#[command]
pub async fn health_set_prefs(app: tauri::AppHandle, prefs: serde_json::Value) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_health_schema(&conn).map_err(|e| e.to_string())?;
    if let Some(obj) = prefs.as_object() {
        let json = serde_json::to_string(obj).map_err(|e| e.to_string())?;
        set_pref(&conn, "prefs", &json).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("prefs must be an object".into())
    }
}

#[command]
pub async fn health_get_prefs(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let conn = open_db(&app)?;
    ensure_health_schema(&conn).map_err(|e| e.to_string())?;
    get_prefs(&conn).map_err(|e| e.to_string())
}

// Generic recorder
#[command]
pub async fn health_record_action(
    app: tauri::AppHandle,
    event: String,              // nudge|done|snooze|skip|notice
    kind: String,               // activity|eye|nightly
    trigger_source: Option<String>, // breakpoint|flow|periodic|manual|nightly
    duration_sec: Option<f64>,
    value: Option<f64>,
    meta: Option<serde_json::Value>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    let meta_json = meta.map(|m| m.to_string());
    record_event(
        &conn,
        &event,
        &kind,
        trigger_source.as_deref(),
        duration_sec,
        value,
        meta_json.as_deref(),
    )
}

#[derive(serde::Serialize)]
pub struct NextDue {
    pub activity_ms: i64,
    pub eye_ms: i64,
}

#[command]
pub async fn health_next_due(app: tauri::AppHandle) -> Result<NextDue, String> {
    use chrono::{DateTime, Utc};
    let conn = open_db(&app)?;

    let prefs_root = get_prefs(&conn).unwrap_or(serde_json::json!({}));
    let prefs_val = prefs_root.get("prefs").cloned().unwrap_or(serde_json::json!({}));
    let def_activity = prefs_val
        .get("intervals").and_then(|i| i.get("activity"))
        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
        .unwrap_or(45.0); // minutes (now supports decimals)
    let def_eye = prefs_val
        .get("intervals").and_then(|i| i.get("eye"))
        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
        .unwrap_or(20.0); // minutes (now supports decimals)

    let now = Utc::now();

    fn last_done(conn: &rusqlite::Connection, kind: &str) -> Option<DateTime<Utc>> {
        conn.query_row(
            "SELECT ts FROM health_events WHERE event='done' AND kind=?1 ORDER BY id DESC LIMIT 1",
            params![kind],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc)))
    }

    // 最近一次 snooze 结束时间（ts + value_min）
    fn last_snooze_end(
        conn: &rusqlite::Connection,
        kind: &str,
    ) -> Option<DateTime<Utc>> {
        // 只看该类型的最近一次snooze
        let result = conn.query_row(
            "SELECT ts, value FROM health_events \
             WHERE event='snooze' AND kind=?1 ORDER BY id DESC LIMIT 1",
            params![kind],
            |row| {
                let ts: String = row.get(0)?;
                let val: Option<f64> = row.get(1).ok();
                Ok((ts, val))
            },
        );
        if let Ok((ts, val_opt)) = result {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&ts) {
                let minutes = val_opt.unwrap_or(0.0);
                let dur_ms = (minutes * 60_000.0).round() as i64;
                let end = dt.with_timezone(&Utc) + chrono::Duration::milliseconds(dur_ms);
                return Some(end);
            }
        }
        None
    }

    // 基于 done 与 snooze 共同决定下次到期时间：
    // 原始到期：last_done + period；若无done则为完整周期
    // 若存在snooze，则将下一次到期不早于 snooze_end
    fn remaining_ms(
        conn: &rusqlite::Connection,
        now: DateTime<Utc>,
        kind: &str,
        period_min: f64,
    ) -> i64 {
        let period_ms = (period_min * 60.0 * 1000.0).round() as i64;
        let last_done_ts = last_done(conn, kind);
        // 原始due剩余
        let original_due_ms = match last_done_ts {
            Some(l) => {
                let elapsed = (now - l).num_milliseconds();
                (period_ms - elapsed).max(0)
            }
            None => period_ms, // 首次默认一个完整周期，避免立即提醒
        };

        // snooze窗口：到 snooze_end 之前不应提醒
        let snooze_end = last_snooze_end(conn, kind);
        if let Some(se) = snooze_end {
            let to_snooze_end = (se - now).num_milliseconds();
            // 下一次到期时间 = max(原始到期时刻, snooze_end)
            // => 剩余毫秒 = max(original_due_ms, to_snooze_end)
            return original_due_ms.max(to_snooze_end.max(0));
        }

        original_due_ms
    }

    let activity_ms = remaining_ms(&conn, now, "activity", def_activity);
    let eye_ms = remaining_ms(&conn, now, "eye", def_eye);

    Ok(NextDue { activity_ms, eye_ms })
}

#[command]
pub async fn health_timeline(
    app: tauri::AppHandle,
    day: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = open_db(&app)?;
    let day = day.unwrap_or_else(|| chrono::Utc::now().date_naive().to_string());
    let lim = limit.unwrap_or(200).clamp(1, 1000);
    let mut stmt = conn.prepare(
        "SELECT ts, event, kind, trigger_source, duration_sec, value, COALESCE(meta_json,'{}')
         FROM health_events WHERE day=?1 ORDER BY id ASC LIMIT ?2",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![day, lim], |row| {
            let ts: String = row.get(0)?;
            let event: String = row.get(1)?;
            let kind: String = row.get(2)?;
            let source: String = row.get(3).unwrap_or_default();
            let dur: Option<f64> = row.get(4)?;
            let val: Option<f64> = row.get(5)?;
            let meta: String = row.get(6)?;
            Ok(serde_json::json!({
                "ts": ts, "event": event, "kind": kind, "trigger_source": source,
                "duration_sec": dur, "value": val, "meta": meta
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[command]
pub async fn health_daily_summary(app: tauri::AppHandle, day: Option<String>) -> Result<serde_json::Value, String> {
    use chrono::DateTime;
    let conn = open_db(&app)?;
    let day = day.unwrap_or_else(|| chrono::Utc::now().date_naive().to_string());

    let mut stmt = conn.prepare(
        "SELECT ts, event, kind, trigger_source FROM health_events WHERE day=?1 ORDER BY id ASC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&day], |row| {
            let ts: String = row.get(0)?;
            let event: String = row.get(1)?;
            let kind: String = row.get(2)?;
            let source: String = row.get(3).unwrap_or_default();
            Ok((ts, event, kind, source))
        })
        .map_err(|e| e.to_string())?;

    let mut nudges: Vec<(i64, String, String)> = Vec::new(); // (ms, kind, source)
    let mut dones: Vec<(i64, String)> = Vec::new(); // (ms, kind)

    for r in rows {
        let (ts, event, kind, source) = r.map_err(|e| e.to_string())?;
        if let Ok(dt) = DateTime::parse_from_rfc3339(&ts) {
            let ms = dt.timestamp_millis();
            if event == "nudge" { nudges.push((ms, kind.clone(), source)); }
            if event == "done" { dones.push((ms, kind.clone())); }
        }
    }

    // Compliance within 20 min
    let mut complied = 0;
    for (ms, kind, _) in &nudges {
        if dones.iter().any(|(t, k)| k == kind && *t >= *ms && *t <= *ms + 20*60*1000) {
            complied += 1;
        }
    }
    let compliance = if nudges.is_empty() { 100 } else { (complied as f64 / nudges.len() as f64 * 100.0).round() as i64 };

    // TTD median
    let mut deltas: Vec<i64> = Vec::new();
    for (ms, kind, _) in &nudges {
        if let Some((t,_)) = dones.iter().filter(|(_,k)| k==kind).min_by_key(|(t,_)| (*t - *ms).abs()) {
            if *t >= *ms { deltas.push(*t - *ms); }
        }
    }
    deltas.sort();
    let ttd_median_ms = if deltas.is_empty() { 0 } else { deltas[deltas.len()/2] };

    // Flow protection avoided count (nudges with source='flow')
    let flow_avoided = nudges.iter().filter(|(_,_,s)| s == "flow").count() as i64;

    // Breakpoint completion rate
    let bp_nudges = nudges.iter().filter(|(_,_,s)| s == "breakpoint").count() as i64;
    let mut bp_complied = 0;
    for (ms, kind, src) in &nudges {
        if src == "breakpoint" && dones.iter().any(|(t, k)| k == kind && *t >= *ms && *t <= *ms + 20*60*1000) {
            bp_complied += 1;
        }
    }
    let breakpoint_completion_rate = if bp_nudges == 0 { 0 } else { (bp_complied as f64 / bp_nudges as f64 * 100.0).round() as i64 };

    // Activity/Eye done counts
    let activity_done = dones.iter().filter(|(_,k)| k == "activity").count() as i64;
    let eye_done = dones.iter().filter(|(_,k)| k == "eye").count() as i64;

    Ok(serde_json::json!({
        "day": day,
        "activity_done": activity_done,
        "eye_done": eye_done,
        "compliance": compliance,
        "ttd_median_ms": ttd_median_ms,
        "flow_avoided": flow_avoided,
        "breakpoint_completion_rate": breakpoint_completion_rate
    }))
}

#[command]
pub async fn health_prune(app: tauri::AppHandle, day: Option<String>, max_per_day: Option<i64>, ttl_days: Option<i64>) -> Result<(), String> {
    let conn = open_db(&app)?;
    prune(&conn, day.as_deref(), max_per_day.unwrap_or(200), ttl_days.unwrap_or(90))
}
