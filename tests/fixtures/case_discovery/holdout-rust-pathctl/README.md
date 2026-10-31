# pathctl

`pathctl --config settings.txt [--root PATH]` prints the selected root directory.
The environment variable is `PATHCTL_ROOT`; the settings file contains the path as plain text.

Tests: `cargo test`. Optional ignored tests: `cargo test -- --ignored`.
