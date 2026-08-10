#!/usr/bin/env node
/**
 * Cross-platform Python interpreter discovery.
 *
 * Discovery order:
 *   1. DRETECH_DJANGO_PYTHON env var (used verbatim as the command)
 *   2. python3
 *   3. python
 *   4. py -3
 *
 * Each candidate is probed with `--version` via spawnSync; the first one that
 * exits 0 wins. Prints the resolved command to stdout so npm scripts and CI
 * can shell out to it (e.g. `execSync(resolvedCmd + ' -m unittest ...')`).
 * Exits non-zero with a clear message on stderr if none is found.
 */

const { spawnSync } = require('child_process');

function probe(command, args) {
    try {
        // Pass env explicitly so PATH / DRETECH_DJANGO_PYTHON mutations
        // (and Jest test spoofing) are honored. spawnSync without `env`
        // can ignore process.env mutations under some runners.
        const result = spawnSync(command, args, {
            stdio: 'ignore',
            env: process.env,
            timeout: 3000,
        });
        return result.status === 0;
    } catch {
        return false;
    }
}

function findPythonInterpreter() {
    const envOverride = process.env.DRETECH_DJANGO_PYTHON;
    if (envOverride) {
        const parts = envOverride.split(' ');
        const cmd = parts[0];
        const baseArgs = parts.slice(1);
        if (probe(cmd, [...baseArgs, '--version'])) {
            return envOverride;
        }
    }

    const candidates = [
        { command: 'python3', args: ['--version'], resolved: 'python3' },
        { command: 'python', args: ['--version'], resolved: 'python' },
        { command: 'py', args: ['-3', '--version'], resolved: 'py -3' },
    ];

    for (const candidate of candidates) {
        if (probe(candidate.command, candidate.args)) {
            return candidate.resolved;
        }
    }

    return null;
}

function main() {
    const resolved = findPythonInterpreter();
    if (!resolved) {
        process.stderr.write(
            'find-python: no Python interpreter found. Tried DRETECH_DJANGO_PYTHON, python3, python, py -3.\n'
        );
        process.exit(1);
    }
    process.stdout.write(resolved + '\n');
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { findPythonInterpreter };
