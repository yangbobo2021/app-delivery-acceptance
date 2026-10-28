use std::{env, fs};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--help") {
        println!("Configuration precedence: --root > PATHCTL_ROOT > settings file");
        return;
    }
    let mut config = None;
    let mut root = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--config" => config = args.get(index + 1).cloned(),
            "--root" => root = args.get(index + 1).cloned(),
            _ => { eprintln!("unknown argument"); std::process::exit(2); }
        }
        index += 2;
    }
    let chosen = root
        .or_else(|| env::var("PATHCTL_ROOT").ok())
        .or_else(|| config.and_then(|path| fs::read_to_string(path).ok()))
        .unwrap_or_else(|| ".".to_string());
    println!("{}", chosen.trim());
}
