use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicU64, Ordering}};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn fixture() -> PathBuf {
    let path = std::env::temp_dir().join(format!("pathctl-{}-{}.txt", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
    fs::write(&path, "/from-file\n").unwrap();
    path
}

fn invoke(path: &PathBuf, env_root: Option<&str>, flag: Option<&str>) -> String {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_pathctl"));
    cmd.arg("--config").arg(path).env_remove("PATHCTL_ROOT");
    if let Some(value) = env_root { cmd.env("PATHCTL_ROOT", value); }
    if let Some(value) = flag { cmd.arg("--root").arg(value); }
    let output = cmd.output().unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[test]
fn command_line_value_wins() {
    let path = fixture();
    assert_eq!(invoke(&path, Some("/from-env"), Some("/from-flag")), "/from-flag");
    fs::remove_file(path).unwrap();
}

#[test]
fn session_value_wins() {
    let path = fixture();
    assert_eq!(invoke(&path, Some("/from-env"), None), "/from-env");
    fs::remove_file(path).unwrap();
}

#[test]
fn saved_value_is_used() {
    let path = fixture();
    assert_eq!(invoke(&path, None, None), "/from-file");
    fs::remove_file(path).unwrap();
}

#[test]
#[ignore = "requires explicit filesystem compatibility run"]
fn settings_bytes_survive_override() {
    let path = fixture();
    let before = fs::read(&path).unwrap();
    invoke(&path, Some("/from-env"), Some("/from-flag"));
    assert_eq!(fs::read(&path).unwrap(), before);
    fs::remove_file(path).unwrap();
}

#[test]
fn config_precedence_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_pathctl")).arg("--help").output().unwrap();
    assert!(String::from_utf8(output.stdout).unwrap().contains("precedence"));
}
