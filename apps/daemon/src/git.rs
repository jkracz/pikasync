//! Git-awareness (P1 thin slice): read recent commits so the cloud can link them
//! to issues by identifier and nudge status from reality.

use anyhow::Result;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Commit {
    pub sha: String,
    pub message: String,
    pub branch: Option<String>,
}

pub fn current_branch(repo_dir: &Path) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    if out.status.success() {
        let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if b.is_empty() {
            None
        } else {
            Some(b)
        }
    } else {
        None
    }
}

/// Recent commits, newest first. Returns empty if not a git repo.
pub fn recent_commits(repo_dir: &Path, limit: usize) -> Result<Vec<Commit>> {
    let branch = current_branch(repo_dir);
    let out = Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .args([
            "log",
            &format!("-{limit}"),
            // Unit separator between sha/message, record separator between commits.
            "--pretty=format:%H%x1f%s%x1e",
        ])
        .output()?;
    if !out.status.success() {
        return Ok(vec![]);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_log(&text, branch))
}

fn parse_log(text: &str, branch: Option<String>) -> Vec<Commit> {
    let mut commits = vec![];
    for record in text.split('\u{1e}') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let mut parts = record.splitn(2, '\u{1f}');
        let sha = parts.next().unwrap_or("").trim().to_string();
        let message = parts.next().unwrap_or("").to_string();
        if !sha.is_empty() {
            commits.push(Commit {
                sha,
                message,
                branch: branch.clone(),
            });
        }
    }
    commits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let text = "abc123\u{1f}fix ENG-1: thing\u{1e}def456\u{1f}chore: stuff\u{1e}";
        let commits = parse_log(text, Some("main".into()));
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "abc123");
        assert_eq!(commits[0].message, "fix ENG-1: thing");
        assert_eq!(commits[0].branch.as_deref(), Some("main"));
    }
}
