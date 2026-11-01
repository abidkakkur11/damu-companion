# Security Policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/abidkakkur11/damu-companion/security/advisories/new).

Include what you found, how to reproduce it and, if you can, what you think the impact is. You can expect an
acknowledgement within a few days. Once a fix is released, you'll be credited unless you prefer not to be.

## What counts

Damu is a local desktop app that makes no network connections, so the realistic issues are things like the
overlay or Settings window exposing more than intended, unsafe handling of `assets/content.json`, or problems in
the installer or release pipeline.
