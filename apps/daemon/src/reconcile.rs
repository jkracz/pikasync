//! The reconcile engine: push local file changes, pull remote changes, resolve
//! conflicts with sibling `.conflict-remote.md` copies, and link git commits.

use anyhow::Result;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::client::Client;
use crate::fm;
use crate::store::{EntityRow, RepoConfig, Store};

#[derive(Default)]
pub struct SyncSummary {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: usize,
    pub deleted: usize,
}

fn rel_path(pikadir: &Path, path: &Path) -> String {
    path.strip_prefix(pikadir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Convex serializes numbers as f64, so integer-valued fields can arrive as JSON
/// floats; `as_i64()` alone returns None for those.
fn num(v: Option<&Value>) -> i64 {
    v.and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

/// Scan `.pikasync/{issues,docs}` for *.md files that declare a frontmatter
/// `type`, ensuring each has an `id`. Files without a `type` are skipped (we
/// never auto-wrap arbitrary notes — that would create unsyncable entities).
/// Returns ulid -> (path, content).
pub fn scan_local(pikadir: &Path) -> Result<HashMap<String, (PathBuf, String)>> {
    let mut local = HashMap::new();
    for sub in ["issues", "docs"] {
        let dir = pikadir.join(sub);
        if !dir.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
            let p = entry.path();
            if !p.is_file() || p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if p.to_string_lossy().contains(".conflict-remote") {
                continue;
            }
            let content = fs::read_to_string(p)?;
            if fm::read_meta(&content).kind.is_none() {
                eprintln!("skipping {} (no frontmatter `type`)", p.display());
                continue;
            }
            let new_id = ulid::Ulid::new().to_string();
            let (content2, id) = fm::ensure_id(&content, &new_id);
            if content2 != content {
                fs::write(p, &content2)?;
            }
            local.insert(id, (p.to_path_buf(), content2));
        }
    }
    Ok(local)
}

pub fn reconcile(store: &Store, repo: &RepoConfig, root: &Path) -> Result<SyncSummary> {
    let client = Client::new(&repo.convex_url, &repo.token);
    let pikadir = root.join(".pikasync");
    let mut summary = SyncSummary::default();

    let local = scan_local(&pikadir)?;
    // Mutable so push results update rel-paths the pull pass then reuses
    // (otherwise a freshly-created entity gets written twice under two names).
    let mut state: HashMap<String, EntityRow> = store
        .entities(&repo.path)?
        .into_iter()
        .map(|e| (e.ulid.clone(), e))
        .collect();
    // Entities that just hit a push conflict — the pull pass must NOT touch them
    // this run (their remote change would otherwise clobber the local edit).
    let mut conflicted: HashSet<String> = HashSet::new();

    // Build upserts (new/changed) and deletes (tracked but gone from disk).
    let mut upserts = vec![];
    let mut upsert_ulids = vec![];
    for (ulid, (_p, content)) in &local {
        match state.get(ulid) {
            Some(e) if &e.synced_content == content => {}
            Some(e) => {
                upserts.push(json!({ "content": content, "baseVersion": e.version }));
                upsert_ulids.push(ulid.clone());
            }
            None => {
                upserts.push(json!({ "content": content }));
                upsert_ulids.push(ulid.clone());
            }
        }
    }
    let deletes: Vec<String> = state
        .keys()
        .filter(|u| !local.contains_key(*u))
        .cloned()
        .collect();

    // Push.
    if !upserts.is_empty() || !deletes.is_empty() {
        let resp = client.push(json!(upserts), deletes.clone())?;
        if let Some(results) = resp.get("results").and_then(Value::as_array) {
            for (i, r) in results.iter().enumerate() {
                let ulid = &upsert_ulids[i];
                let (path, local_content) = &local[ulid];
                let rel = rel_path(&pikadir, path);
                let kind = if rel.starts_with("issues/") {
                    "issue"
                } else {
                    "document"
                };
                match r.get("status").and_then(Value::as_str).unwrap_or("") {
                    "created" | "applied" => {
                        let content =
                            r.get("content").and_then(Value::as_str).unwrap_or("").to_string();
                        fs::write(path, &content)?;
                        let row = EntityRow {
                            ulid: ulid.clone(),
                            kind: kind.into(),
                            rel_path: rel,
                            version: num(r.get("version")),
                            synced_content: content,
                        };
                        store.upsert_entity(&repo.path, &row)?;
                        state.insert(ulid.clone(), row);
                        summary.pushed += 1;
                    }
                    "conflict" => {
                        let content =
                            r.get("content").and_then(Value::as_str).unwrap_or("").to_string();
                        let cpath = path.with_extension("conflict-remote.md");
                        fs::write(&cpath, &content)?;
                        // Adopt the remote version but keep local content; don't
                        // re-push until the local file changes again, and don't let
                        // the pull pass overwrite it this run.
                        let row = EntityRow {
                            ulid: ulid.clone(),
                            kind: kind.into(),
                            rel_path: rel,
                            version: num(r.get("version")),
                            synced_content: local_content.clone(),
                        };
                        store.upsert_entity(&repo.path, &row)?;
                        state.insert(ulid.clone(), row);
                        conflicted.insert(ulid.clone());
                        summary.conflicts += 1;
                        eprintln!("conflict: {ulid} → wrote {}", cpath.display());
                    }
                    _ => eprintln!(
                        "push error for {ulid}: {}",
                        r.get("error").and_then(Value::as_str).unwrap_or("unknown")
                    ),
                }
            }
        }
        // Only drop local tracking for deletes the server actually accepted;
        // a rejected delete (e.g. out of scope) is left to retry.
        let del_status: HashMap<String, String> = resp
            .get("deleted")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|d| {
                        Some((
                            d.get("ulid").and_then(Value::as_str)?.to_string(),
                            d.get("status")
                                .and_then(Value::as_str)
                                .unwrap_or("error")
                                .to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        for ulid in &deletes {
            match del_status.get(ulid).map(String::as_str).unwrap_or("error") {
                "deleted" | "not_found" => {
                    store.delete_entity(&repo.path, ulid)?;
                    state.remove(ulid);
                    summary.deleted += 1;
                }
                other => eprintln!("delete rejected for {ulid}: {other}"),
            }
        }
    }

    // Pull. Overlap by 1ms (the server uses `updatedAt > since`) so a write that
    // landed at exactly the previous cursor millisecond isn't missed.
    let pulled = client.pull((repo.cursor - 1).max(0))?;
    if let Some(entities) = pulled.get("entities").and_then(Value::as_array) {
        for e in entities {
            let ulid = e.get("ulid").and_then(Value::as_str).unwrap_or("").to_string();
            if ulid.is_empty() || conflicted.contains(&ulid) {
                continue;
            }
            let kind = e
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("document")
                .to_string();
            let content = e.get("content").and_then(Value::as_str).unwrap_or("").to_string();
            let version = num(e.get("version"));
            let deleted = e.get("deleted").and_then(Value::as_bool).unwrap_or(false);
            let identifier = e.get("identifier").and_then(Value::as_str);

            let rel = state.get(&ulid).map(|x| x.rel_path.clone()).unwrap_or_else(|| {
                if kind == "issue" {
                    format!("issues/{}.md", identifier.unwrap_or(&ulid))
                } else {
                    format!("docs/{ulid}.md")
                }
            });
            let abs = pikadir.join(&rel);

            if deleted {
                if abs.exists() {
                    let _ = fs::remove_file(&abs);
                }
                store.delete_entity(&repo.path, &ulid)?;
                state.remove(&ulid);
                summary.pulled += 1;
                continue;
            }

            // Never clobber a divergent local file — tracked OR untracked. Write a
            // conflict copy unless the file is absent or already matches what we
            // last synced (i.e. no local edit) or already equals the remote.
            if abs.exists() {
                let on_disk = fs::read_to_string(&abs).unwrap_or_default();
                let known = state.get(&ulid).map(|ex| ex.synced_content.clone());
                if on_disk != content && known.as_deref() != Some(on_disk.as_str()) {
                    let cpath = abs.with_extension("conflict-remote.md");
                    fs::write(&cpath, &content)?;
                    summary.conflicts += 1;
                    eprintln!("conflict (pull): {ulid} → wrote {}", cpath.display());
                    continue;
                }
            }

            if let Some(parent) = abs.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&abs, &content)?;
            let row = EntityRow {
                ulid: ulid.clone(),
                kind,
                rel_path: rel,
                version,
                synced_content: content,
            };
            store.upsert_entity(&repo.path, &row)?;
            state.insert(ulid, row);
            summary.pulled += 1;
        }
    }
    if pulled.get("cursor").is_some() {
        store.set_cursor(&repo.path, num(pulled.get("cursor")))?;
    }

    Ok(summary)
}

/// Parse recent git commits and link new ones to issues (git-awareness slice).
/// Commit linking is at-least-once: a crash between the call and `mark_linked`
/// can re-send a commit (the server re-logs the event but won't double-close).
pub fn link_commits(store: &Store, repo: &RepoConfig, root: &Path) -> Result<usize> {
    // A generous window so bursts (imports, merges, long watch gaps) aren't
    // dropped; a `<last-linked>..HEAD` range scan is the exhaustive future fix.
    let commits = crate::git::recent_commits(root, 500)?;
    let seen = store.linked_shas(&repo.path)?;
    let fresh: Vec<_> = commits.into_iter().filter(|c| !seen.contains(&c.sha)).collect();
    if fresh.is_empty() {
        return Ok(0);
    }
    let payload: Vec<Value> = fresh
        .iter()
        .map(|c| json!({ "sha": c.sha, "message": c.message, "branch": c.branch }))
        .collect();
    let client = Client::new(&repo.convex_url, &repo.token);
    client.link_commits(json!(payload))?;
    for c in &fresh {
        store.mark_linked(&repo.path, &c.sha)?;
    }
    Ok(fresh.len())
}
