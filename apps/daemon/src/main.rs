//! PikaSync daemon + CLI (`pika`). Keeps `.pikasync/` files in sync with the
//! cloud over a token-authenticated API, and links git commits to issues.

mod client;
mod fm;
mod git;
mod reconcile;
mod store;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use store::{RepoConfig, Store};

const SKILL: &str = include_str!("../assets/pikasync-skill.md");

#[derive(Parser)]
#[command(name = "pika", version, about = "PikaSync — project context that syncs with your code")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Link this repo to a workspace using a device token.
    Init {
        #[arg(long)]
        url: String,
        #[arg(long)]
        token: String,
    },
    /// Show sync status for this repo.
    Status,
    /// Run a one-shot sync (push, pull, link commits).
    Sync,
    /// Continuously sync on an interval (seconds).
    Watch {
        #[arg(long, default_value_t = 5)]
        interval: u64,
    },
    /// Issue commands.
    Issue {
        #[command(subcommand)]
        sub: IssueCmd,
    },
    /// Install the PikaSync agent skill into a repo.
    Skill {
        #[command(subcommand)]
        sub: SkillCmd,
    },
}

#[derive(Subcommand)]
enum SkillCmd {
    /// Write the agent skill to .claude/skills/pikasync/SKILL.md.
    Install {
        #[arg(long)]
        dir: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum IssueCmd {
    /// Create a new issue and sync it (the cloud assigns the identifier).
    New {
        title: String,
        #[arg(long)]
        team: Option<String>,
        #[arg(long, default_value = "backlog")]
        status: String,
        #[arg(long, default_value = "none")]
        priority: String,
    },
}

#[derive(Serialize, Deserialize)]
struct TeamJson {
    id: String,
    key: String,
    name: String,
}

#[derive(Serialize, Deserialize)]
struct WorkspaceJson {
    version: u32,
    convex_url: String,
    workspace_id: String,
    workspace_name: String,
    teams: Vec<TeamJson>,
}

fn find_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir()?;
    loop {
        if dir.join(".pikasync").is_dir() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err(anyhow!("no .pikasync found here — run `pika init` first"));
        }
    }
}

fn load_repo(store: &Store) -> Result<(RepoConfig, PathBuf)> {
    let root = find_root()?;
    let repo = store
        .get_repo(&root.to_string_lossy())?
        .ok_or_else(|| anyhow!("this repo isn't initialized — run `pika init`"))?;
    Ok((repo, root))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let store = Store::open()?;
    match cli.cmd {
        Cmd::Init { url, token } => cmd_init(&store, &url, &token),
        Cmd::Status => cmd_status(&store),
        Cmd::Sync => cmd_sync(&store),
        Cmd::Watch { interval } => cmd_watch(&store, interval),
        Cmd::Issue { sub } => match sub {
            IssueCmd::New {
                title,
                team,
                status,
                priority,
            } => cmd_issue_new(&store, title, team, status, priority),
        },
        Cmd::Skill { sub } => match sub {
            SkillCmd::Install { dir } => cmd_skill_install(dir),
        },
    }
}

fn cmd_skill_install(dir: Option<PathBuf>) -> Result<()> {
    let base = match dir {
        Some(d) => d,
        None => std::env::current_dir()?,
    };
    let dest = base.join(".claude").join("skills").join("pikasync");
    fs::create_dir_all(&dest)?;
    let file = dest.join("SKILL.md");
    fs::write(&file, SKILL)?;
    println!("Installed PikaSync agent skill → {}", file.display());
    Ok(())
}

fn cmd_init(store: &Store, url: &str, token: &str) -> Result<()> {
    let root = std::env::current_dir()?;
    let pikadir = root.join(".pikasync");
    fs::create_dir_all(pikadir.join("issues"))?;
    fs::create_dir_all(pikadir.join("docs"))?;

    let client = client::Client::new(url, token);
    let info = client
        .hello()
        .context("could not authenticate — check the URL and device token")?;
    let ws = info
        .get("workspace")
        .ok_or_else(|| anyhow!("unexpected response from server"))?;
    let workspace_id = ws.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let workspace_name = ws
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let teams: Vec<TeamJson> = info
        .get("teams")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|t| TeamJson {
                    id: t.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
                    key: t.get("key").and_then(Value::as_str).unwrap_or("").to_string(),
                    name: t.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let wj = WorkspaceJson {
        version: 1,
        convex_url: url.to_string(),
        workspace_id: workspace_id.clone(),
        workspace_name: workspace_name.clone(),
        teams,
    };
    fs::write(
        pikadir.join("workspace.json"),
        serde_json::to_string_pretty(&wj)?,
    )?;
    fs::write(
        pikadir.join(".gitignore"),
        "# Don't commit synced project files by default.\n*\n!.gitignore\n",
    )?;
    ensure_root_gitignore(&root)?;

    store.save_repo(&RepoConfig {
        path: root.to_string_lossy().to_string(),
        convex_url: url.to_string(),
        token: token.to_string(),
        workspace_id,
        cursor: 0,
    })?;

    println!("Linked to workspace '{workspace_name}'.");
    let keys: Vec<&str> = wj.teams.iter().map(|t| t.key.as_str()).collect();
    println!("Teams in scope: {}", keys.join(", "));

    let repo = store
        .get_repo(&root.to_string_lossy())?
        .ok_or_else(|| anyhow!("failed to persist repo config"))?;
    let s = reconcile::reconcile(store, &repo, &root)?;
    println!("Synced: {} pulled, {} pushed.", s.pulled, s.pushed);
    Ok(())
}

fn ensure_root_gitignore(root: &Path) -> Result<()> {
    let gi = root.join(".gitignore");
    let existing = fs::read_to_string(&gi).unwrap_or_default();
    let already = existing
        .lines()
        .any(|l| matches!(l.trim(), ".pikasync/" | ".pikasync"));
    if !already {
        let mut out = existing;
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("\n# PikaSync local-first project context\n.pikasync/\n");
        fs::write(&gi, out)?;
    }
    Ok(())
}

fn cmd_status(store: &Store) -> Result<()> {
    let (repo, root) = load_repo(store)?;
    let pikadir = root.join(".pikasync");
    let state: HashMap<String, store::EntityRow> = store
        .entities(&repo.path)?
        .into_iter()
        .map(|e| (e.ulid.clone(), e))
        .collect();
    let local = reconcile::scan_local(&pikadir)?;
    let mut pending = 0;
    for (ulid, (_p, content)) in &local {
        match state.get(ulid) {
            Some(e) if &e.synced_content == content => {}
            _ => pending += 1,
        }
    }
    let deletes = state.keys().filter(|u| !local.contains_key(*u)).count();

    println!("repo:      {}", root.display());
    println!("workspace: {}", repo.workspace_id);
    println!("endpoint:  {}", repo.convex_url);
    println!("cursor:    {}", repo.cursor);
    println!("tracked:   {} entities", state.len());
    println!("pending:   {pending} change(s), {deletes} deletion(s) to push");
    Ok(())
}

fn cmd_sync(store: &Store) -> Result<()> {
    let (repo, root) = load_repo(store)?;
    // Link commits first so a "close ENG-1" commit's status change is pulled in
    // this same sync.
    let linked = reconcile::link_commits(store, &repo, &root).unwrap_or(0);
    let s = reconcile::reconcile(store, &repo, &root)?;
    println!(
        "pushed {}, pulled {}, conflicts {}, deleted {}, commits linked {linked}",
        s.pushed, s.pulled, s.conflicts, s.deleted
    );
    Ok(())
}

fn cmd_watch(store: &Store, interval: u64) -> Result<()> {
    let (_, root) = load_repo(store)?;
    let key = root.to_string_lossy().to_string();
    println!(
        "watching {} every {interval}s — Ctrl-C to stop",
        root.display()
    );
    loop {
        if let Some(repo) = store.get_repo(&key)? {
            let _ = reconcile::link_commits(store, &repo, &root);
            match reconcile::reconcile(store, &repo, &root) {
                Ok(s) if s.pushed + s.pulled + s.conflicts + s.deleted > 0 => println!(
                    "pushed {}, pulled {}, conflicts {}, deleted {}",
                    s.pushed, s.pulled, s.conflicts, s.deleted
                ),
                Ok(_) => {}
                Err(e) => eprintln!("sync error: {e}"),
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(interval));
    }
}

fn cmd_issue_new(
    store: &Store,
    title: String,
    team: Option<String>,
    status: String,
    priority: String,
) -> Result<()> {
    let (repo, root) = load_repo(store)?;
    let team_key = match team {
        Some(t) => t,
        None => default_team(&root)?,
    };
    let pikadir = root.join(".pikasync");
    fs::create_dir_all(pikadir.join("issues"))?;
    let ulid = ulid::Ulid::new().to_string();
    let content = fm::new_issue(&ulid, &title, &status, &team_key, &priority);
    let path = pikadir.join("issues").join(format!("{ulid}.md"));
    fs::write(&path, &content)?;

    reconcile::reconcile(store, &repo, &root)?;

    let after = fs::read_to_string(&path).unwrap_or_default();
    let identifier = fm::read_meta(&after).identifier.unwrap_or(ulid);
    println!("Created {identifier}: {title}");
    Ok(())
}

fn default_team(root: &Path) -> Result<String> {
    let wj: WorkspaceJson =
        serde_json::from_str(&fs::read_to_string(root.join(".pikasync/workspace.json"))?)?;
    wj.teams
        .first()
        .map(|t| t.key.clone())
        .ok_or_else(|| anyhow!("no teams available — pass --team"))
}
