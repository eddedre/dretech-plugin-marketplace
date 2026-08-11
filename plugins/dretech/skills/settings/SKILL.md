---
name: settings
description: Configure the listed OpenCode model and optional agent profile for a DreTech role.
---

# DreTech settings

Use `/dretech:settings [role]` for `worker` or `peer-review`.

The canonical settings file is `~/.claude/dretech/settings.json` (the path returned by the role-workflow runtime's `resolveGlobalSettingsPath` helper). All reads and writes must use that path; do not use a project settings file.

The command must run these preflights in the foreground:

1. Run `opencode --version` and stop if the command is unavailable.
2. Run `opencode models` and parse the live model catalog.
3. Show the current resolution for each role, including its source and optional profile.
4. Ask the user to select one exact model from the displayed catalog. A profile is optional and must be confirmed separately; an omitted profile dispatches through OpenCode's `build` agent.

Write settings only after explicit confirmation. Save the selected catalog model and, when supplied, the confirmed profile through the role-workflow runtime, omitting the path only when allowing the runtime to resolve the canonical global path. Preserve other roles and never save arbitrary text as a model. A failed preflight or a model absent from the live catalog must leave settings unchanged.

Do not store credentials, tokens, or command output in settings. Settings are local user configuration and are not part of the public plugin payload.
