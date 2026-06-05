### 2026-06-03
- 🟡 **When** replicating a function's behaviour inline instead of importing it: make sure to capture all secondary operations in the original (normalization, validation, transformation) — not just the primary logic path.

### 2026-06-03
- 🟡 **When** introducing a flag or setting that disables a category of behavior (e.g. `--no-X`, `disable_plugins=true`): make sure you understand its full scope — such options often suppress both global and project-local sources of that behavior, which may be broader than intended.
