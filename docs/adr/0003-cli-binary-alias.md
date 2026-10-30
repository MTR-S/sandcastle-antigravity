# CLI Binary Alias (`sc-agy`) in Parity with Canonical `sandcastle-agy`

Sandcastle Antigravity provides an official shorthand binary alias (`sc-agy`) in absolute 100% behavioral parity with the canonical binary executable (`sandcastle-agy`). Operators frequently run multi-agent orchestration pipelines, diagnostics (`doctor`), container builds (`build-image`), and rescue routines (`rescue`) across several terminal tabs. Repeatedly typing the 14-character canonical binary creates keystroke fatigue and increases typographical errors in high-frequency CLI workflows.

Both `sandcastle-agy` and `sc-agy` point to the identical entrypoint script (`./main.mts`) in the package distribution manifest (`package.json` `"bin"` map). The CLI argument parser normalizes input vectors by stripping runtime runners and platform-specific shims (`sc-agy`, `sandcastle-agy`, `.cmd`, `.ps1`, `.exe`) so positional commands and flags are evaluated identically across POSIX shells and Windows environments.

## Considered Options

1. **Shell-Specific Wrapper or Shell Aliases (`~/.bashrc`, PowerShell profiles)**: Rejected because user-level aliases require manual workstation configuration, fail in non-interactive CI scripts or subshells, and lack cross-platform consistency.
2. **Short Single-Letter Alias (e.g., `sc`)**: Rejected due to high risk of naming collisions in system `PATH` on Linux and Windows (e.g., Windows Service Controller `sc.exe`).
3. **Dual Binary Registry with Normalization Seam (chosen)**: Exports both `sandcastle-agy` and `sc-agy` in `package.json` `bin` mapping, sharing a single entrypoint and test suite with zero divergence in subcommands, flags, or container orchestration logic.
