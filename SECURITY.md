# Security Policy

## Supported Versions

This is a personal/hobby project under active development; only the latest
`main` branch / most recent tagged release is supported with fixes.

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting for this repository
(Security tab → "Report a vulnerability"), or contact the maintainer
directly via their GitHub profile ([@Nurulaev](https://github.com/Nurulaev)).

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (minimal repro if possible)
- Any relevant logs/screenshots (redact secrets, tokens, IPs, file paths)

We'll acknowledge reports as soon as possible and work on a fix. Since this
project runs entirely locally (no cloud backend, no user accounts), the most
relevant risks are: arbitrary code execution via a malicious `.vrm`/asset
file, or local server endpoints (`:8765`) being exposed beyond `127.0.0.1`.
