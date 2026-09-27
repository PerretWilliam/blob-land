# Security

## Reporting a vulnerability

If you find a security problem in Blob Land (the app, the garden's server, or how accounts are handled), please **don't open a public issue**. Report it privately instead:

1. Go to the repository's [Security tab](https://github.com/PerretWilliam/blob-land/security) and choose **Report a vulnerability**.
2. Say what the problem is, how to reproduce it, and what someone could do with it.

The aim is to answer within a week. Once it's fixed, the fix is released and, if you'd like, you're credited for finding it.

## What's in scope

- The desktop app (`apps/desktop`), including how it stores the account's token.
- The garden's API (`apps/api`): accounts, passwords, sessions, and anything that lets one player see or change what they shouldn't.
- The simulation (`packages/sim`), where it could be abused to break the garden for others.

## Supported versions

Only the latest release is supported: fixes land there, not in older versions.
