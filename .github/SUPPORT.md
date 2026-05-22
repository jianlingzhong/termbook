# Getting help with Termbook

## Where to ask what

| Question type | Where to go |
|---|---|
| "How do I…?", "Is this expected?", "Why does X behave like Y?" | [GitHub Discussions](https://github.com/jianlingzhong/termbook/discussions) |
| "I think this is a bug" / "X is broken" | [GitHub Issues](https://github.com/jianlingzhong/termbook/issues) — include the output of `__tbDebug()` from the browser console for UI bugs, or `tail ssr_debug.log` for backend bugs |
| "I want a new feature" | [GitHub Issues](https://github.com/jianlingzhong/termbook/issues/new?template=feature_request.yml) using the feature template |
| Security vulnerability | [Private vulnerability advisory](https://github.com/jianlingzhong/termbook/security/advisories/new) — do not open a public issue |

## Before asking

1. Search [open and closed issues](https://github.com/jianlingzhong/termbook/issues?q=is%3Aissue).
2. Skim [`docs/known-issues.md`](../docs/known-issues.md) — many "bugs" are documented limitations or deliberate trade-offs.
3. Try to reproduce with `bash -i` if you're using a customized zsh — shell-specific quirks (especially Powerlevel10k or atuin) interact with the SSH integration in ways that are hard to debug.

## What helps a maintainer help you

- The output of `__tbDebug()` from your browser's DevTools console (UI bugs)
- `tail -100 ssr_debug.log` after truncating + reproducing the bug (backend bugs)
- Your shell + version (`bash --version` or `zsh --version`)
- Your OS + Node version (`uname -a && node --version`)
- A minimal reproducer if you can extract one

For non-trivial bug reports, the bug-report issue template asks for all
of this automatically.
