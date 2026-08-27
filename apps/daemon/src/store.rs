//! Per-machine local state (outside the synced tree), in SQLite.

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::PathBuf;

pub struct Store {
    conn: Connection,
}

#[derive(Clone)]
pub struct RepoConfig {
    pub path: String,
    pub convex_url: String,
    pub token: String,
    pub workspace_id: String,
    pub cursor: i64,
}

#[derive(Clone)]
pub struct EntityRow {
    pub ulid: String,
    pub kind: String,
    pub rel_path: String,
    pub version: i64,
    pub synced_content: String,
}

pub fn state_dir() -> Result<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| anyhow!("could not resolve a data directory"))?;
    Ok(base.join("PikaSync"))
}

impl Store {
    pub fn open() -> Result<Self> {
        let dir = state_dir()?;
        std::fs::create_dir_all(&dir)?;
        let conn = Connection::open(dir.join("state.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS repos (
                 path TEXT PRIMARY KEY, convex_url TEXT NOT NULL, token TEXT NOT NULL,
                 workspace_id TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE IF NOT EXISTS entities (
                 repo_path TEXT NOT NULL, ulid TEXT NOT NULL, kind TEXT NOT NULL,
                 rel_path TEXT NOT NULL, version INTEGER NOT NULL, synced_content TEXT NOT NULL,
                 PRIMARY KEY (repo_path, ulid));
             CREATE TABLE IF NOT EXISTS linked_commits (
                 repo_path TEXT NOT NULL, sha TEXT NOT NULL, PRIMARY KEY (repo_path, sha));",
        )?;
        Ok(Self { conn })
    }

    pub fn save_repo(&self, c: &RepoConfig) -> Result<()> {
        self.conn.execute(
            "INSERT INTO repos (path, convex_url, token, workspace_id, cursor)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET convex_url=?2, token=?3, workspace_id=?4",
            params![c.path, c.convex_url, c.token, c.workspace_id, c.cursor],
        )?;
        Ok(())
    }

    pub fn get_repo(&self, path: &str) -> Result<Option<RepoConfig>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, convex_url, token, workspace_id, cursor FROM repos WHERE path=?1",
        )?;
        let mut rows = stmt.query(params![path])?;
        match rows.next()? {
            Some(r) => Ok(Some(RepoConfig {
                path: r.get(0)?,
                convex_url: r.get(1)?,
                token: r.get(2)?,
                workspace_id: r.get(3)?,
                cursor: r.get(4)?,
            })),
            None => Ok(None),
        }
    }

    pub fn set_cursor(&self, path: &str, cursor: i64) -> Result<()> {
        self.conn
            .execute("UPDATE repos SET cursor=?2 WHERE path=?1", params![path, cursor])?;
        Ok(())
    }

    pub fn entities(&self, repo: &str) -> Result<Vec<EntityRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT ulid, kind, rel_path, version, synced_content FROM entities WHERE repo_path=?1",
        )?;
        let rows = stmt.query_map(params![repo], |r| {
            Ok(EntityRow {
                ulid: r.get(0)?,
                kind: r.get(1)?,
                rel_path: r.get(2)?,
                version: r.get(3)?,
                synced_content: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn upsert_entity(&self, repo: &str, e: &EntityRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO entities (repo_path, ulid, kind, rel_path, version, synced_content)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(repo_path, ulid) DO UPDATE SET kind=?3, rel_path=?4, version=?5, synced_content=?6",
            params![repo, e.ulid, e.kind, e.rel_path, e.version, e.synced_content],
        )?;
        Ok(())
    }

    pub fn delete_entity(&self, repo: &str, ulid: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM entities WHERE repo_path=?1 AND ulid=?2",
            params![repo, ulid],
        )?;
        Ok(())
    }

    pub fn linked_shas(&self, repo: &str) -> Result<HashSet<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT sha FROM linked_commits WHERE repo_path=?1")?;
        let rows = stmt.query_map(params![repo], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<std::result::Result<HashSet<_>, _>>()?)
    }

    pub fn mark_linked(&self, repo: &str, sha: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO linked_commits (repo_path, sha) VALUES (?1, ?2)",
            params![repo, sha],
        )?;
        Ok(())
    }
}
