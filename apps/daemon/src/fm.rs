//! Minimal frontmatter helpers. The cloud is the canonicalization authority, so
//! these only need to read identity fields and inject an `id` into new files —
//! the daemon writes back the canonical content the cloud returns.

use serde_yaml::{Mapping, Value};

#[derive(Debug, Default, Clone)]
pub struct Meta {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub team: Option<String>,
    pub identifier: Option<String>,
}

/// Split a file into (frontmatter_yaml, body). Normalizes CRLF to LF.
pub fn split(content: &str) -> (Option<String>, String) {
    let normalized = content.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let fm = rest[..end].to_string();
            let body = rest[end + 5..].trim_start_matches('\n').to_string();
            return (Some(fm), body);
        }
        // Frontmatter with no body (closing fence at EOF).
        if let Some(end) = rest.find("\n---") {
            return (Some(rest[..end].to_string()), String::new());
        }
    }
    (None, normalized)
}

fn get_str(map: &Mapping, key: &str) -> Option<String> {
    map.get(Value::String(key.to_string()))
        .and_then(|v| v.as_str().map(str::to_string))
}

pub fn read_meta(content: &str) -> Meta {
    let mut meta = Meta::default();
    let (fm, _) = split(content);
    if let Some(fm) = fm {
        if let Ok(Value::Mapping(map)) = serde_yaml::from_str::<Value>(&fm) {
            meta.id = get_str(&map, "id");
            meta.kind = get_str(&map, "type");
            meta.team = get_str(&map, "team");
            meta.identifier = get_str(&map, "identifier");
        }
    }
    meta
}

/// Ensure the content has an `id`. Returns (content, id). If absent, injects
/// `new_id` and returns rewritten content (the cloud re-canonicalizes on push).
pub fn ensure_id(content: &str, new_id: &str) -> (String, String) {
    let (fm, body) = split(content);
    if let Some(fm) = fm {
        if let Ok(Value::Mapping(mut map)) = serde_yaml::from_str::<Value>(&fm) {
            if let Some(existing) = get_str(&map, "id") {
                return (content.to_string(), existing);
            }
            map.insert(
                Value::String("id".to_string()),
                Value::String(new_id.to_string()),
            );
            let new_fm = serde_yaml::to_string(&Value::Mapping(map)).unwrap_or_default();
            let rebuilt = format!("---\n{}---\n\n{}\n", new_fm, body.trim_end());
            return (rebuilt, new_id.to_string());
        }
    }
    // No (or invalid) frontmatter: wrap as a minimal issue.
    let rebuilt = format!(
        "---\nid: {}\ntype: issue\n---\n\n{}\n",
        new_id,
        content.trim_end()
    );
    (rebuilt, new_id.to_string())
}

/// Build a new issue file's content from structured fields (used by `pika issue new`).
pub fn new_issue(id: &str, title: &str, status: &str, team: &str, priority: &str) -> String {
    let mut map = Mapping::new();
    let mut put = |k: &str, v: &str| {
        map.insert(Value::String(k.to_string()), Value::String(v.to_string()));
    };
    put("id", id);
    put("type", "issue");
    put("title", title);
    put("status", status);
    put("team", team);
    put("priority", priority);
    let fm = serde_yaml::to_string(&Value::Mapping(map)).unwrap_or_default();
    format!("---\n{}---\n\n", fm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_meta() {
        let c = "---\nid: 01ABC\ntype: issue\nidentifier: ENG-1\nteam: ENG\n---\n\nBody";
        let m = read_meta(c);
        assert_eq!(m.id.as_deref(), Some("01ABC"));
        assert_eq!(m.kind.as_deref(), Some("issue"));
        assert_eq!(m.identifier.as_deref(), Some("ENG-1"));
        assert_eq!(m.team.as_deref(), Some("ENG"));
    }

    #[test]
    fn injects_missing_id() {
        let c = "---\ntype: issue\ntitle: T\n---\n\nBody";
        let (out, id) = ensure_id(c, "01NEW");
        assert_eq!(id, "01NEW");
        assert_eq!(read_meta(&out).id.as_deref(), Some("01NEW"));
    }

    #[test]
    fn keeps_existing_id() {
        let c = "---\nid: 01KEEP\ntype: issue\n---\n\nB";
        let (out, id) = ensure_id(c, "01NEW");
        assert_eq!(id, "01KEEP");
        assert_eq!(out, c);
    }

    #[test]
    fn new_issue_has_fields() {
        let c = new_issue("01X", "Hello", "todo", "ENG", "high");
        let m = read_meta(&c);
        assert_eq!(m.id.as_deref(), Some("01X"));
        assert_eq!(m.kind.as_deref(), Some("issue"));
    }
}
