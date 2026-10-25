# Upstream

This directory is a copy of `Macro-Deck/ui/runtime/src`, taken from commit:

```
1f1e1bf5e4e266bd8e78f4c48224c8504fa0dd75
```

It is copied rather than consumed as a package because the runtime is framework-free TypeScript with
no build step of its own, so the Angular compiler consumes it directly. Re-copy with
`tools/sync-runtime.ps1` after the upstream runtime changes, and update the SHA above.

Spec files are stripped during the copy; they are not part of the app build.
