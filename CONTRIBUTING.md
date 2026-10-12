# Contributing to Hermes Avatar

Thanks for considering a contribution.

## Getting started

1. Fork the repo and clone your fork.
2. Follow [Quick start](README.md#quick-start) to get a working dev setup.
3. Create a branch: `git checkout -b feat/my-change`.

## Development

- Python code lives in `server.py`, `lipsync.py`, `tools/`; frontend in
  `static/`, `index.html` / `toon.html` / `index3d.html`; Electron shell in
  `electron/`.
- Keep commits focused and use
  [Conventional Commits](https://www.conventionalcommits.org/) style
  messages (`feat:`, `fix:`, `docs:`, `chore:`...).
- No formal test suite yet — CI runs basic linting
  (`python -m py_compile`, `node --check`). Please sanity-check your change
  manually (the app needs a GPU to fully exercise STT/rendering) and
  describe how you tested it in the PR description.

## Pull requests

- Keep PRs scoped to one change.
- Update `README.md` / `README.ru.md` if you change user-facing behaviour.
- Never commit secrets, API keys, personal file paths, or server
  IPs/hostnames — this repo is public.
- Large binary assets (VRM models, voice models) should be fetched via a
  `scripts/download-*.sh` script, not committed directly, unless you've
  confirmed the license explicitly permits redistribution (document it like
  `proofs/stage1/LICENSE-hermes.vrm.txt`).

## Reporting bugs / proposing features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. Include your OS,
GPU, Python/Node versions and logs where relevant.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
