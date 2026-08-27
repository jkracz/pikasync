//! Thin Convex HTTP client. Calls the token-authenticated `sync:*` actions via
//! Convex's HTTP action API (`POST {url}/api/action`).

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

pub struct Client {
    url: String,
    token: String,
    http: reqwest::blocking::Client,
}

impl Client {
    pub fn new(url: &str, token: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            http: reqwest::blocking::Client::new(),
        }
    }

    fn action(&self, path: &str, mut args: Value) -> Result<Value> {
        if let Value::Object(ref mut map) = args {
            map.insert("token".to_string(), Value::String(self.token.clone()));
        }
        let body = json!({ "path": path, "args": args, "format": "json" });
        let resp = self
            .http
            .post(format!("{}/api/action", self.url))
            .json(&body)
            .send()?;
        let v: Value = resp.json()?;
        match v.get("status").and_then(Value::as_str) {
            Some("success") => Ok(v.get("value").cloned().unwrap_or(Value::Null)),
            _ => Err(anyhow!(
                "convex error: {}",
                v.get("errorMessage")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown error")
            )),
        }
    }

    pub fn hello(&self) -> Result<Value> {
        self.action("sync:hello", json!({}))
    }

    pub fn pull(&self, since: i64) -> Result<Value> {
        self.action("sync:pull", json!({ "since": since }))
    }

    pub fn push(&self, upserts: Value, deletes: Vec<String>) -> Result<Value> {
        self.action("sync:push", json!({ "upserts": upserts, "deletes": deletes }))
    }

    pub fn link_commits(&self, commits: Value) -> Result<Value> {
        self.action("sync:linkCommits", json!({ "commits": commits }))
    }
}
