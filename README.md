# DreTech Plugin Marketplace

Install plugins from the public marketplace:

`/plugin marketplace add eddedre/dretech-plugin-marketplace`

## dretech

Foreground, structured OpenCode dispatch for Claude Code skills.

Install with: `/plugin install dretech@dretech-plugin-marketplace`

Examples:

- `/dretech:opencode-dispatch [task]`

## dretech-django

Claude Code plugin for HackSoft Django Styleguide enforcement. 10 skills for generating services, selectors, APIs, views, tests, and linting setup. Pre-tool hook validates code against the rule catalog in .claude/RULE_CATALOG.json. Auditor agent for deep code analysis.

Install with: `/plugin install dretech-django@dretech-plugin-marketplace`

Examples:

- `/dretech-django:audit [target]`
