/**
 * Django Styleguide Pre-Tool-Use Hook (Plugin Format)
 *
 * Validates code changes against HackSoft Django Styleguide before tool execution.
 * Reads CLAUDE_TOOL_INPUT env var (JSON with tool_name and tool_input).
 * Exit 0 = allow, Exit 2 = block (feedback printed to stdout).
 *
 * Every finding cites a stable rule_id from .claude/RULE_CATALOG.json and is
 * rendered as: [SEVERITY][RULE-ID] message
 *
 * Semantic service/selector rules (SVC-001 keyword-only, SVC-002 full_clean)
 * are enforced by the Python AST helper (hooks/ast_check.py) against the full
 * post-edit file content. Edit reconstruction + interpreter discovery fail open.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AST_HELPER = path.resolve(__dirname, 'ast_check.py');
const AST_TIMEOUT_MS = 2000;

const toolInput = process.env.CLAUDE_TOOL_INPUT;

if (!toolInput) {
    process.exit(0);
}

let parsed;
try {
    parsed = JSON.parse(toolInput);
} catch {
    process.exit(0);
}

const tool = parsed.tool_name;
const parameters = parsed.tool_input || {};

// Only check Edit and Write operations on Python files
if (!['Edit', 'Write'].includes(tool)) {
    process.exit(0);
}

const filePath = parameters.file_path;

// Only validate Python files
if (!filePath || !filePath.endsWith('.py')) {
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Content reconstruction
// ---------------------------------------------------------------------------

/**
 * Build the full post-edit content for validation.
 * Write → tool_input.content
 * Edit  → read file, apply old_string->new_string (exact one match, or replace_all)
 * On failure → { ok: false } so AST is skipped (fail-open); regex still runs on
 * the raw new_string/content snippet for non-semantic rules.
 *
 * Also returns:
 *   preContent  — file content before the edit (null for Write / missing file)
 *   pathExisted — whether the target path existed on disk before the tool call
 *                 (used by TEST-001 newness detection)
 */
function reconstructContent(toolName, toolInputParams) {
    const pathExisted = fs.existsSync(toolInputParams.file_path);

    if (toolName === 'Write') {
        const content = toolInputParams.content;
        if (typeof content !== 'string') {
            return { content: '', ok: false, preContent: null, pathExisted };
        }
        return { content, ok: true, preContent: null, pathExisted };
    }

    // Edit
    const oldString = toolInputParams.old_string;
    const newString = toolInputParams.new_string;
    const replaceAll = toolInputParams.replace_all;
    if (typeof oldString !== 'string' || typeof newString !== 'string') {
        return {
            content: typeof newString === 'string' ? newString : '',
            ok: false,
            preContent: null,
            pathExisted,
        };
    }

    let original;
    try {
        original = fs.readFileSync(toolInputParams.file_path, 'utf8');
    } catch {
        // Missing file → fail-open for AST
        return { content: newString, ok: false, preContent: null, pathExisted: false };
    }

    if (replaceAll) {
        if (!original.includes(oldString)) {
            return { content: newString, ok: false, preContent: original, pathExisted };
        }
        // Global replace of every occurrence
        const content = original.split(oldString).join(newString);
        return { content, ok: true, preContent: original, pathExisted };
    }

    // Exact one-match required
    const first = original.indexOf(oldString);
    if (first === -1) {
        return { content: newString, ok: false, preContent: original, pathExisted };
    }
    const second = original.indexOf(oldString, first + oldString.length);
    if (second !== -1) {
        // Multiple matches without replace_all → fail-open
        return { content: newString, ok: false, preContent: original, pathExisted };
    }

    const content =
        original.slice(0, first) + newString + original.slice(first + oldString.length);
    return { content, ok: true, preContent: original, pathExisted };
}

const reconstruction = reconstructContent(tool, parameters);
// newContent is what remaining regex rules inspect. Prefer full reconstructed
// content when available; otherwise fall back to the raw snippet so non-AST
// rules still have something to look at (matches prior behavior).
const newContent = reconstruction.ok
    ? reconstruction.content
    : (parameters.content || parameters.new_string || '');

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

// Normalize path separators for cross-platform matching
const normalizedPath = filePath.replace(/\\/g, '/');

// Determine file type based on path
const isServiceFile = normalizedPath.includes('/services') || normalizedPath.endsWith('/services.py');
const isSelectorFile = normalizedPath.includes('/selectors') || normalizedPath.endsWith('/selectors.py');
const isApiFile = (normalizedPath.includes('/apis/') || normalizedPath.endsWith('/apis.py'));
const isViewFile = (normalizedPath.includes('/views/') || normalizedPath.endsWith('/views.py'));
const isModelFile = normalizedPath.includes('/models') || normalizedPath.endsWith('/models.py');
const isTaskFile = normalizedPath.includes('/tasks') || normalizedPath.endsWith('/tasks.py');
const isGlobalSettingsFile = normalizedPath.includes('/config/') && normalizedPath.endsWith('.py') && !normalizedPath.endsWith('urls.py') && !normalizedPath.endsWith('wsgi.py');
const isAppSettingsFile = normalizedPath.includes('/apps/') && normalizedPath.endsWith('/settings.py');

// Determine if this is a Django app file worth checking
const isDjangoFile =
    isServiceFile ||
    isSelectorFile ||
    isApiFile ||
    isViewFile ||
    isModelFile ||
    isTaskFile ||
    isGlobalSettingsFile;

if (!isDjangoFile) {
    process.exit(0);
}

// ---------------------------------------------------------------------------
// Interpreter discovery + AST helper
// ---------------------------------------------------------------------------

/**
 * Discover a Python interpreter in order:
 *   DRETECH_DJANGO_PYTHON -> python3 -> python -> py -3
 * Returns the command string (may contain spaces, e.g. "py -3") or null.
 */
function findPythonInterpreter() {
    function probe(command, args) {
        try {
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

/**
 * Run hooks/ast_check.py against *content* for the given *role*.
 * Fail-open: returns [] on missing interpreter, timeout, non-zero exit,
 * malformed JSON, or any unexpected error.
 */
function runAstCheck(options) {
    const role = options.role;
    const content = options.content;
    const timeoutMs = options.timeoutMs || AST_TIMEOUT_MS;

    const interpreter = findPythonInterpreter();
    if (!interpreter) {
        return [];
    }

    if (!fs.existsSync(AST_HELPER)) {
        return [];
    }

    const parts = interpreter.split(' ');
    const cmd = parts[0];
    const baseArgs = parts.slice(1);
    const args = [...baseArgs, AST_HELPER, '--role', role, '--file', '-'];

    let result;
    try {
        result = spawnSync(cmd, args, {
            input: content,
            encoding: 'utf-8',
            timeout: timeoutMs,
            env: process.env,
            maxBuffer: 1024 * 1024,
        });
    } catch {
        return [];
    }

    // timeout -> status null + error.code === 'ETIMEDOUT' (or killed)
    if (result.error || result.status !== 0) {
        return [];
    }

    const stdout = (result.stdout || '').trim();
    if (!stdout) {
        return [];
    }

    let payload;
    try {
        payload = JSON.parse(stdout);
    } catch {
        return [];
    }

    if (!payload || !Array.isArray(payload.findings)) {
        return [];
    }

    return payload.findings;
}

function roleForPath() {
    if (isServiceFile) return 'service';
    if (isSelectorFile) return 'selector';
    if (isApiFile) return 'api';
    if (isViewFile) return 'view';
    if (isTaskFile) return 'task';
    if (isModelFile) return 'model';
    return null;
}

// ---------------------------------------------------------------------------
// TEST-001: new service/selector code without corresponding tests
// (IMPORTANT only — never blocks). See .claude/RULE_CATALOG.json.
// ---------------------------------------------------------------------------

/**
 * Determine {appRoot, layer, packageMode} for a service/selector file path,
 * or null if the path doesn't match a recognizable apps/<app>/... layout.
 *
 * Monolithic: apps/<app>/services.py or apps/<app>/selectors.py
 * Package:    apps/<app>/services/<name>.py or apps/<app>/selectors/<name>.py
 */
function classifyTestMapping(normPath) {
    const appsMatch = normPath.match(/^(.*\/apps\/[^/]+)\//);
    if (!appsMatch) {
        return null;
    }
    const appRoot = appsMatch[1];
    const relative = normPath.slice(appRoot.length + 1);
    const segments = relative.split('/');

    if (segments.length === 1) {
        if (segments[0] === 'services.py') {
            return { appRoot, layer: 'services', packageMode: false };
        }
        if (segments[0] === 'selectors.py') {
            return { appRoot, layer: 'selectors', packageMode: false };
        }
        return null;
    }

    if (segments.length === 2 && (segments[0] === 'services' || segments[0] === 'selectors')) {
        if (!segments[1].endsWith('.py') || segments[1] === '__init__.py') {
            return null;
        }
        return { appRoot, layer: segments[0], packageMode: true };
    }

    return null;
}

/** True if *dir* exists and contains at least one file named test_*.py */
function hasTestFilesIn(dir) {
    if (!dir || !fs.existsSync(dir)) {
        return false;
    }
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    return entries.some((e) => e.isFile() && /^test_.*\.py$/.test(e.name));
}

/**
 * Resolve whether tests exist for *layer* ('services' | 'selectors') under
 * *appRoot*, per the Task 4 mapping:
 *   - apps/<app>/tests/<layer>/ containing any test_*.py → covered
 *   - apps/<app>/tests/test_<layer>*.py → covered
 */
function layerTestsExist(appRoot, layer) {
    if (hasTestFilesIn(`${appRoot}/tests/${layer}`)) {
        return true;
    }
    const appTestsDir = `${appRoot}/tests`;
    if (!fs.existsSync(appTestsDir)) {
        return false;
    }
    let entries;
    try {
        entries = fs.readdirSync(appTestsDir, { withFileTypes: true });
    } catch {
        return false;
    }
    const pattern = new RegExp(`^test_${layer}.*\\.py$`);
    return entries.some((e) => e.isFile() && pattern.test(e.name));
}

/** Extract public (non-underscore-prefixed) top-level `def` names from source. */
function extractPublicDefNames(content) {
    const names = new Set();
    const regex = /^\s*def\s+([A-Za-z_]\w*)\s*\(/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!name.startsWith('_')) {
            names.add(name);
        }
    }
    return names;
}

/**
 * Determine whether this change introduces new public service/selector code:
 *   Write: the path did not exist before the tool call.
 *   Edit:  reconstruction succeeded AND a public def name appears in the new
 *          content that was not present in the pre-edit content.
 */
function introducesNewPublicCode() {
    if (tool === 'Write') {
        return !reconstruction.pathExisted;
    }
    // Edit
    if (!reconstruction.ok || reconstruction.preContent === null) {
        return false;
    }
    const before = extractPublicDefNames(reconstruction.preContent);
    const after = extractPublicDefNames(reconstruction.content);
    for (const name of after) {
        if (!before.has(name)) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const violations = [];

// ==============================================================================
// AST SEMANTIC CHECKS (service / selector only)
// Owns SVC-001 (keyword-only) and SVC-002 (full_clean before save).
// Only runs when reconstruction succeeded (fail-open otherwise).
// ==============================================================================

if (reconstruction.ok && (isServiceFile || isSelectorFile)) {
    const role = roleForPath();
    const findings = runAstCheck({
        role,
        content: reconstruction.content,
        timeoutMs: AST_TIMEOUT_MS,
    });

    for (const finding of findings) {
        const severity = (finding.severity || 'CRITICAL').toUpperCase();
        const ruleId = finding.rule_id || 'UNKNOWN';
        violations.push({
            type: severity === 'IMPORTANT' ? 'IMPORTANT' : 'CRITICAL',
            rule_id: ruleId,
            rule: finding.message || ruleId,
            message: finding.message || ruleId,
            location: finding.line ? ('line ' + finding.line) : undefined,
        });
    }
}

// ==============================================================================
// TEST-001: new service/selector code without corresponding tests
// IMPORTANT only — never blocks (never counted toward exit 2).
// ==============================================================================

if (isServiceFile || isSelectorFile) {
    const mapping = classifyTestMapping(normalizedPath);
    if (mapping && introducesNewPublicCode()) {
        const covered = layerTestsExist(mapping.appRoot, mapping.layer);
        if (!covered) {
            const preferredPath = mapping.packageMode
                ? `${mapping.appRoot}/tests/${mapping.layer}/test_<name>.py`
                : `${mapping.appRoot}/tests/${mapping.layer}/ or ${mapping.appRoot}/tests/test_${mapping.layer}*.py`;
            violations.push({
                type: 'IMPORTANT',
                rule_id: 'TEST-001',
                rule: 'New service/selector code without tests',
                message: `New public code was added with no corresponding tests. Add tests under ${preferredPath}.`,
                example: `# ${mapping.appRoot}/tests/${mapping.layer}/test_<name>.py\ndef test_<function>_...():\n    ...`,
            });
        }
    }
}

// ==============================================================================
// BUSINESS LOGIC SEPARATION (remaining regex rules)
// NOTE: The old file-global regex keyword-only (SVC-001) and full_clean
// (SVC-002) checks have been removed -- AST owns those for service/selector.
// ==============================================================================

// Check 2b: Services should use .save(update_fields=[...]) on updates (SVC-003)
// Still a regex heuristic (not yet moved to AST).
if (isServiceFile) {
    const hasBareUpdateSave = /\.\w+\s*=\s*[^=].*\n.*\.save\(\)/.test(newContent);
    const hasUpdateFields = /\.save\(update_fields=/.test(newContent);

    if (hasBareUpdateSave && !hasUpdateFields) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'SVC-003',
            rule: 'Use .save(update_fields=[...]) for updates',
            message: 'When updating existing objects, specify update_fields to avoid overwriting concurrent changes and improve performance.',
            example: 'user.theme_preference = theme\nuser.full_clean()\nuser.save(update_fields=["theme_preference"])'
        });
    }
}

// Check 3: Views and APIs should not contain business logic (VIEW-001)
if (isApiFile || isViewFile) {
    const businessLogicPatterns = [
        /\.save\(\)/,
        /\.objects\.create\(/,
        /\.objects\.update\(/,
        /\.objects\.filter\(/,
        /\.delete\(\)/,
        /\.full_clean\(/,
    ];

    for (const pattern of businessLogicPatterns) {
        if (pattern.test(newContent)) {
            const layer = isApiFile ? 'APIs' : 'Views';
            violations.push({
                type: 'CRITICAL',
                rule_id: 'VIEW-001',
                rule: `${layer} must not contain business logic`,
                message: `${layer} should only validate input and call services/selectors. Move business logic to services.`,
                example: 'Instead of: user.save()\nUse: user_create(...) or user_update(...)'
            });
            break;
        }
    }
}

// Check 3a: Enforce DRF APIView, not ViewSets (only in API files) (API-001)
if (isApiFile) {
    const hasViewSet = /class\s+\w+\(.*ViewSet.*\)/.test(newContent);
    const hasModelViewSet = /ModelViewSet|ReadOnlyModelViewSet/.test(newContent);

    if (hasViewSet || hasModelViewSet) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'API-001',
            rule: 'Use APIView instead of ViewSets for HackSoft pattern',
            message: 'The HackSoft pattern prefers explicit APIView classes (one per operation) over ViewSets. Use: from rest_framework.views import APIView',
            example: 'class UserCreateApi(APIView):\n    def post(self, request):\n        user_create(**request.data)\n        return Response(status=201)'
        });
    }
}

// Check 3b: Ensure API files use DRF APIView, not plain Django View (API-002)
if (isApiFile) {
    const hasPlainDjangoView = /from django\.views import View/.test(newContent);
    const hasGenericView = /from django\.views\.generic/.test(newContent);

    if (hasPlainDjangoView || hasGenericView) {
        violations.push({
            type: 'CRITICAL',
            rule_id: 'API-002',
            rule: 'API files must use Django REST Framework APIView, not plain Django Views',
            message: 'APIs must use Django REST Framework. Import: from rest_framework.views import APIView',
            example: 'from rest_framework.views import APIView\nfrom rest_framework.response import Response'
        });
    }
}

// Check 3c: Verify DRF imports are present for API classes (API-003 / API-004)
if (isApiFile && newContent.includes('class ') && newContent.includes('Api(')) {
    const hasDrfApiView = /from rest_framework\.views import APIView/.test(newContent);
    const hasDrfResponse = /from rest_framework\.response import Response/.test(newContent);

    if (!hasDrfApiView) {
        violations.push({
            type: 'CRITICAL',
            rule_id: 'API-003',
            rule: 'API classes must import from Django REST Framework',
            message: 'Missing DRF APIView import. Add: from rest_framework.views import APIView',
            example: 'from rest_framework.views import APIView\nfrom rest_framework.response import Response\nfrom rest_framework import serializers, status'
        });
    }

    if (!hasDrfResponse && (newContent.includes('def get(') || newContent.includes('def post('))) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'API-004',
            rule: 'API methods should use DRF Response',
            message: 'Import DRF Response: from rest_framework.response import Response',
            example: 'return Response(data, status=status.HTTP_200_OK)'
        });
    }
}

// Check for missing InputSerializer/OutputSerializer (API-005 / API-006)
if (isApiFile && newContent.includes('class ') && newContent.includes('Api(')) {
    if (!newContent.includes('InputSerializer') && (newContent.includes('def post(') || newContent.includes('def put(') || newContent.includes('def patch('))) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'API-005',
            rule: 'APIs should use nested InputSerializer',
            message: 'Create/Update APIs should define an InputSerializer inner class',
            example: 'class InputSerializer(serializers.Serializer):\n    field = serializers.CharField()'
        });
    }

    if (!newContent.includes('OutputSerializer') && newContent.includes('def get(')) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'API-006',
            rule: 'APIs should use nested OutputSerializer',
            message: 'List/Detail APIs should define an OutputSerializer inner class',
            example: 'class OutputSerializer(serializers.Serializer):\n    id = serializers.IntegerField()'
        });
    }
}

// ==============================================================================
// SELECTORS
// ==============================================================================

// Check 4: Selectors should use query optimizations (SEL-001)
if (isSelectorFile) {
    const hasQueryset = /QuerySet/.test(newContent);
    const hasSelectRelated = /select_related/.test(newContent);
    const hasPrefetchRelated = /prefetch_related/.test(newContent);

    if (hasQueryset && !hasSelectRelated && !hasPrefetchRelated) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'SEL-001',
            rule: 'Selectors should optimize queries',
            message: 'Use select_related() for ForeignKey/OneToOne and prefetch_related() for ManyToMany to avoid N+1 queries',
            example: '.select_related("user", "category").prefetch_related("tags")'
        });
    }
}

// ==============================================================================
// TYPE ANNOTATIONS
// ==============================================================================

// Check 4b: Services/selectors should use from __future__ import annotations (QUAL-001)
if (isServiceFile || isSelectorFile) {
    const hasFutureAnnotations = /from __future__ import annotations/.test(newContent);
    const hasFunctionDefs = /def\s+\w+/.test(newContent);

    if (hasFunctionDefs && !hasFutureAnnotations) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'QUAL-001',
            rule: 'Services and selectors should use from __future__ import annotations',
            message: 'Add "from __future__ import annotations" at the top of the file for forward reference support',
            example: 'from __future__ import annotations\n\nfrom django.db.models import QuerySet'
        });
    }
}

// Check 4c: Selectors must be pure reads -- no writes (SEL-002)
if (isSelectorFile) {
    const writePatterns = [
        /\.save\(\)/,
        /\.objects\.create\(/,
        /\.objects\.update\(/,
        /\.delete\(\)/,
    ];

    for (const pattern of writePatterns) {
        if (pattern.test(newContent)) {
            violations.push({
                type: 'CRITICAL',
                rule_id: 'SEL-002',
                rule: 'Selectors must be pure reads — no write operations',
                message: 'Selectors should only contain ORM queries. Move .save(), .create(), .delete(), .update() to services.',
                example: 'Selectors: return Queryset / objects\nServices: create, update, delete'
            });
            break;
        }
    }
}

// Check 5: Type annotations in services/selectors (QUAL-002)
if (isServiceFile || isSelectorFile) {
    const functionDefs = newContent.match(/def\s+\w+\s*\([^)]*\)[^:]*:/g) || [];
    for (const funcDef of functionDefs) {
        // Skip private and magic methods
        if (funcDef.includes('def _') || funcDef.includes('def __')) {
            continue;
        }

        // Check for return type annotation
        if (!funcDef.includes('->')) {
            violations.push({
                type: 'IMPORTANT',
                rule_id: 'QUAL-002',
                rule: 'Services and selectors must have type annotations',
                location: funcDef,
                message: 'Add return type annotation (e.g., -> User or -> QuerySet[User])',
                fix: funcDef.replace(/:$/, ' -> ReturnType:')
            });
        }
    }
}

// ==============================================================================
// CELERY TASKS
// ==============================================================================

// Check 6: Celery tasks should call services (TASK-001)
if (isTaskFile) {
    const hasSave = /\.save\(\)/.test(newContent);
    const hasCreate = /\.objects\.create/.test(newContent);

    if (hasSave || hasCreate) {
        violations.push({
            type: 'CRITICAL',
            rule_id: 'TASK-001',
            rule: 'Celery tasks must not contain business logic',
            message: 'Tasks should only fetch objects and call services. Move business logic to services.',
            example: '@shared_task\ndef process_user_task(user_id):\n    user = User.objects.get(id=user_id)\n    from apps.accounts.services import user_process\n    user_process(user)'
        });
    }
}

// Check 7: Transaction.on_commit for async tasks (.delay() and .enqueue()) (SVC-004)
if (isServiceFile) {
    const hasTaskDelay = /\.delay\(/.test(newContent);
    const hasTaskEnqueue = /\.enqueue\(/.test(newContent);
    const hasOnCommit = /transaction\.on_commit/.test(newContent);

    if ((hasTaskDelay || hasTaskEnqueue) && !hasOnCommit) {
        const method = hasTaskDelay ? '.delay()' : '.enqueue()';
        violations.push({
            type: 'CRITICAL',
            rule_id: 'SVC-004',
            rule: `Task dispatch (${method}) must use transaction.on_commit`,
            message: `Always wrap ${method} in transaction.on_commit() to ensure tasks run after successful commit. Never dispatch tasks against uncommitted data.`,
            example: `transaction.on_commit(lambda: my_task${hasTaskDelay ? '.delay' : '.enqueue'}(entity.id))`
        });
    }
}

// Check 7b: .enqueue()/.delay() in views/APIs -- should be in services (VIEW-002)
if (isViewFile || isApiFile) {
    const hasTaskDelay = /\.delay\(/.test(newContent);
    const hasTaskEnqueue = /\.enqueue\(/.test(newContent);

    if (hasTaskDelay || hasTaskEnqueue) {
        const method = hasTaskDelay ? '.delay()' : '.enqueue()';
        const layer = isApiFile ? 'APIs' : 'Views';
        violations.push({
            type: 'CRITICAL',
            rule_id: 'VIEW-002',
            rule: `${layer} must not dispatch tasks directly`,
            message: `Move ${method} calls to a service function and wrap in transaction.on_commit(). ${layer} should call services, not dispatch tasks.`,
            example: 'In service: transaction.on_commit(lambda: my_task.enqueue(entity.id))\nIn view: my_service(entity=entity)  # service handles task dispatch'
        });
    }
}

// ==============================================================================
// SETTINGS & SECURITY
// ==============================================================================

// Check 8: Global settings should not contain app-specific secrets (SET-001)
if (isGlobalSettingsFile) {
    const envCalls = newContent.match(/\w+\s*=\s*env\([^)]+\)/g) || [];
    const djangoCoreSettings = [
        'SECRET_KEY', 'DEBUG', 'ALLOWED_HOSTS', 'DATABASES', 'DATABASE_URL',
        'STATIC_URL', 'STATIC_ROOT', 'MEDIA_URL', 'MEDIA_ROOT',
        'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USE_TLS', 'EMAIL_HOST_USER', 'EMAIL_HOST_PASSWORD',
        'REDIS_URL', 'CELERY_BROKER_URL', 'SENTRY_DSN',
        'DEFAULT_FROM_EMAIL', 'SERVER_EMAIL',
    ];

    for (const envCall of envCalls) {
        const varName = envCall.split('=')[0].trim();
        if (!djangoCoreSettings.some(s => varName.includes(s))) {
            violations.push({
                type: 'IMPORTANT',
                rule_id: 'SET-001',
                rule: 'App-specific config should be in per-app settings.py',
                location: envCall,
                message: `Consider moving "${varName}" to the app that uses it (apps/<app>/settings.py). Global settings should only contain Django core and third-party config.`,
                example: '# apps/<app>/settings.py\nimport os\n\ndef get_' + varName.toLowerCase() + '() -> str:\n    return os.environ["' + varName + '"]'
            });
        }
    }
}

// Check 9: Services/selectors/views should not use django.conf.settings (SET-002)
if (isServiceFile || isSelectorFile || isViewFile) {
    const hasDjangoSettings = /from django\.conf import settings/.test(newContent);

    if (hasDjangoSettings) {
        violations.push({
            type: 'IMPORTANT',
            rule_id: 'SET-002',
            rule: 'Use per-app settings instead of django.conf.settings',
            message: 'Import app-specific config directly: from apps.<app>.settings import CONSTANT. Reserve django.conf.settings for Django core config only.',
            example: 'from apps.<app>.settings import DEFAULT_PAGE_SIZE, get_api_key'
        });
    }
}

// ==============================================================================
// SECURITY
// ==============================================================================

// Check 11: Never log sensitive data (SEC-001)
if (isServiceFile || isSelectorFile || isViewFile || isApiFile || isTaskFile) {
    const sensitiveLogPatterns = [
        /logger\.\w+\(.*password/i,
        /logger\.\w+\(.*secret/i,
        /logger\.\w+\(.*token(?!s?\s*=\s*\d)/i,
        /logger\.\w+\(.*api_key/i,
        /logger\.\w+\(.*credit_card/i,
        /logging\.\w+\(.*password/i,
        /print\(.*password/i,
        /print\(.*secret/i,
    ];

    for (const pattern of sensitiveLogPatterns) {
        if (pattern.test(newContent)) {
            violations.push({
                type: 'CRITICAL',
                rule_id: 'SEC-001',
                rule: 'Never log passwords, tokens, secrets, or PII',
                message: 'Sensitive data detected in log/print statement. Remove the sensitive value from the log output.',
                example: '# BAD: logger.info(f"Login: {password}")\n# GOOD: logger.info("User login successful", extra={"user_id": user.id})'
            });
            break;
        }
    }
}

// Check 12: Never expose raw exceptions in responses (SEC-002)
if (isViewFile || isApiFile) {
    const exposesException = /return\s+.*(?:Response|JsonResponse|HttpResponse)\s*\(.*str\s*\(\s*(?:e|exc|err|exception)\s*\)/.test(newContent);
    const exposesTraceback = /traceback\.\w+/.test(newContent) && /(?:Response|JsonResponse|HttpResponse)/.test(newContent);

    if (exposesException || exposesTraceback) {
        violations.push({
            type: 'CRITICAL',
            rule_id: 'SEC-002',
            rule: 'Never expose stack traces or error details in responses',
            message: 'Return a generic error message to clients. Log the full error server-side instead.',
            example: '# BAD: return Response({"error": str(e)})\n# GOOD: logger.exception("Unexpected error"); return Response({"message": "Server error"}, status=500)'
        });
    }
}

// ==============================================================================
// IMPORT NAMESPACE
// ==============================================================================

// Check 10: Import namespace should use apps.* prefix (IMP-001)
if (isServiceFile || isSelectorFile || isViewFile || isApiFile) {
    const importLines = newContent.match(/^from\s+\w+\.(models|services|selectors|views|forms|settings|tasks|factories)\s+import/gm) || [];
    const systemPrefixes = ['django', 'rest_framework', 'celery', 'allauth', 'crispy', 'factory', 'unittest'];

    for (const importLine of importLines) {
        const moduleName = importLine.match(/^from\s+(\w+)\./)[1];
        if (!systemPrefixes.includes(moduleName) && moduleName !== 'apps') {
            violations.push({
                type: 'IMPORTANT',
                rule_id: 'IMP-001',
                rule: 'Use apps.* namespace for app imports',
                location: importLine,
                message: `Change "${importLine}" to use "from apps.${moduleName}..." namespace`,
                fix: importLine.replace(`from ${moduleName}.`, `from apps.${moduleName}.`)
            });
        }
    }
}

// ==============================================================================
// REPORT RESULTS
// ==============================================================================

if (violations.length > 0) {
    const criticalCount = violations.filter(v => v.type === 'CRITICAL').length;
    const importantCount = violations.filter(v => v.type === 'IMPORTANT').length;

    let feedback = `\nDjango Styleguide Violations Found\n\n`;
    feedback += `Summary: ${criticalCount} Critical, ${importantCount} Important\n\n`;

    violations.forEach((v, idx) => {
        const ruleId = v.rule_id || 'UNKNOWN';
        feedback += `${idx + 1}. [${v.type}][${ruleId}] ${v.rule}\n`;
        if (v.location) {
            feedback += `   Location: ${v.location}\n`;
        }
        feedback += `   ${v.message}\n`;
        if (v.example) {
            feedback += `   Example:\n${v.example.split('\n').map(line => '   ' + line).join('\n')}\n`;
        }
        if (v.fix) {
            feedback += `   Suggested fix: ${v.fix}\n`;
        }
        feedback += `\n`;
    });

    feedback += `\nPlease fix these violations before proceeding.\n`;
    feedback += `See /dretech-django:styleguide for detailed guidance.\n`;
    feedback += `Rule IDs are defined in .claude/RULE_CATALOG.json.\n`;

    process.stdout.write(feedback);

    // Only block on CRITICAL violations
    if (criticalCount > 0) {
        process.exit(2);
    }
}

// All checks passed (or only IMPORTANT warnings)
process.exit(0);
