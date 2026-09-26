// Isolated DEV-only live Web-root -> Web-child probe. Never loads production configuration.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultConfig } from '../src/config';
import { augmentNativeModelCatalog } from '../src/model-catalog';
import { startServer } from '../src/server';
import { TurnBroker, closeTurnBrokers } from '../src/adapters/chatgpt-web/turn-broker';
import { closeChatGptBrowserWorkers } from '../src/adapters/chatgpt-web/browser-worker';
import { fetchNativeCodex } from '../src/native-network';

const testDir = mkdtempSync(join(tmpdir(), 'dev-mixed-live-'));
const nativeRoot = process.argv.slice(2).includes('--native-root');
const automaticChild = process.argv.slice(2).includes('--automatic-child');
if (process.argv.slice(2).some(arg => !['--native-root', '--automatic-child'].includes(arg))) {
  throw new Error('Unknown live smoke option');
}
if (automaticChild && !nativeRoot) throw new Error('Automatic-child smoke requires a native root');
const normalizedMarker = (value: unknown): string => typeof value === 'string'
  // The child result appears both as plain Markdown and as JSON-escaped text in
  // wait_agent output. Decode either representation before checking the marker.
  ? value.replace(/\\+_/g, '_').trim() : '';
const devHome = join(homedir(), '.codex-chatgpt-web-dev');
const devCfg = JSON.parse(readFileSync(join(devHome, 'config.json'), 'utf8'));
if (devCfg.purpose !== 'dev-harness' || devCfg.mode !== 'full' ||
    devCfg.appName !== 'Codex Native2 DEV' || devCfg.automaticAppName !== 'Codex Native2 DEV' ||
    !devCfg.brokerSocketPath || !devCfg.browserHostDescriptorPath || !devCfg.tunnel) {
  throw new Error('DEV-only full-harness connector configuration not verified; refusing live test');
}
const descriptor = JSON.parse(readFileSync(devCfg.browserHostDescriptorPath, 'utf8'));
if (descriptor.profile !== 'development' || !descriptor.pid) throw new Error('DEV launcher descriptor does not identify the isolated browser');
const exe = process.env.CODEX_MIXED_ROOT_SMOKE_EXE?.trim()
  || join(tmpdir(), 'codex-web-worker-proof-dc02c43b25d44e58a3ad39121f7c689d', 'codex.exe');
if (!existsSync(exe)) throw new Error('Official Codex executable for mixed-root smoke was not found');
const home = join(testDir, 'codex-home'); mkdirSync(home);
process.env.CODEX_HOME = home;
process.env.CODEX_CHATGPT_WEB_HOME = devHome;
const bundled = spawnSync(exe, ['debug', 'models', '--bundled'], { encoding: 'utf8', timeout: 15000 });
if (bundled.status !== 0) throw new Error('Cannot read official model catalog for isolated live test');
const bundledCatalog = JSON.parse(bundled.stdout) as { models?: Array<{ slug?: unknown }> };
const nativeRootModel = ['gpt-6-sol', 'gpt-5.6-sol'].find(slug =>
  bundledCatalog.models?.some(model => model.slug === slug));
if (!nativeRootModel) throw new Error('Official Codex model catalog has no supported native root model');
const codexVersion = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 15000 }).stdout.trim();
const nativeAuth = nativeRoot ? JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf8')) : undefined;
if (nativeRoot && (!nativeAuth?.tokens?.access_token || !nativeAuth?.tokens?.account_id)) {
  throw new Error('Existing native Codex authentication is not available for the isolated root test');
}
const cfg = defaultConfig('full');
cfg.host = '127.0.0.1'; cfg.port = 0;
cfg.subagentProtocol = 'compatibility-v1';
cfg.browserHost = 'launcher';
cfg.browserHostDescriptorPath = devCfg.browserHostDescriptorPath;
cfg.browserInteractionMode = devCfg.browserInteractionMode;
// Only this disposable smoke instance may approve one-shot DEV connector prompts;
// do not persist or change the existing DEV/production launcher preferences.
cfg.autoApproveToolCalls = true;
cfg.automaticAppName = devCfg.automaticAppName;
cfg.appName = devCfg.appName;
cfg.solAvailable = devCfg.solAvailable;
cfg.brokerSocketPath = devCfg.brokerSocketPath;
cfg.tunnel = devCfg.tunnel;
cfg.automaticTunnel = devCfg.automaticTunnel;
let unexpectedNativeForward = 0;
let authorizedNativeRootForward = 0;
const nativeUpstreamStatuses: number[] = [];
const server = startServer(cfg, { fetchUpstream: async (request) => {
  if (new URL(request.url).pathname.endsWith('/models')) return Response.json(JSON.parse(bundled.stdout));
  if (nativeRoot && new URL(request.url).pathname.endsWith('/responses')) {
    const upstreamBody = await request.clone().json() as { model?: unknown };
    if (upstreamBody.model === nativeRootModel) {
      authorizedNativeRootForward++;
      const headers = new Headers(request.headers);
      headers.set('authorization', `Bearer ${nativeAuth.tokens.access_token}`);
      headers.set('chatgpt-account-id', nativeAuth.tokens.account_id);
      const upstream = await fetchNativeCodex(new Request(request, { headers }));
      nativeUpstreamStatuses.push(upstream.status);
      return upstream;
    }
  }
  unexpectedNativeForward++;
  return new Response('unexpected native forwarding forbidden in isolated live probe', { status: 599 });
} });
try {
  await TurnBroker.forSocket(cfg.brokerSocketPath).listen(); // Same DEV socket selected by Codex Native2 DEV.
  const models = join(testDir, 'models.json');
  writeFileSync(models, JSON.stringify(augmentNativeModelCatalog(bundledCatalog, cfg)));
  const webChildModel = 'chatgpt-web/gpt-5.6-sol';
  writeFileSync(join(home, 'config.toml'), [
    `model = ${JSON.stringify(nativeRoot ? nativeRootModel : 'chatgpt-web/high')}`, 'model_provider = "proof"', `model_catalog_json = ${JSON.stringify(models)}`,
    '[model_providers.proof]', 'name = "DEV mixed-root live probe"',
    `base_url = "http://127.0.0.1:${server.port}/mixed-root/v1"`,
    'env_key = "PROOF_KEY"', 'wire_api = "responses"', 'supports_websockets = false',
    '[agents]', 'max_depth = 2',
    ...(automaticChild ? [`default_subagent_model = ${JSON.stringify(webChildModel)}`] : []),
    '[features]', 'multi_agent = true', 'multi_agent_v2 = false',
  ].join('\n'));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '',
    TEMP: testDir, TMP: testDir, USERPROFILE: testDir, CODEX_HOME: home,
    PROOF_KEY: 'isolated-local-test',
  };
  const childSelection = automaticChild
    ? 'Create exactly one subagent using the configured default subagent model. Do not specify a model in the spawn tool arguments.'
    : `Create exactly one subagent with model ${webChildModel}.`;
  const prompt = `This is one isolated delegation smoke test. You MUST use the native Compatibility V1 spawn_agent tool. ${childSelection} Ask it to reply exactly CHILD_DEV_LIVE_OK. Use wait_agent to obtain its result. After the child result arrives, reply exactly PARENT_RECEIVED_CHILD_DEV_LIVE_OK. Do not create further agents. Do not use shell commands, modify files, or access external services unrelated to this task.`;
  const proc = Bun.spawn([exe, 'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', prompt],
    { cwd: testDir, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), 300_000);
  const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  writeFileSync(join(testDir, 'stdout.jsonl'), stdout);
  writeFileSync(join(testDir, 'stderr.txt'), stderr);
  const sessionsDir = join(home, 'sessions');
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir, { recursive: true }).filter(f => String(f).endsWith('.jsonl')) : [];
  const sessions = files.map(file => {
    const lines = readFileSync(join(sessionsDir, String(file)), 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x));
    const metadata = lines.find(x => x.type === 'session_meta')?.payload ?? {};
    const parent = metadata.source?.subagent?.thread_spawn?.parent_thread_id ?? metadata.parent_thread_id ?? null;
    const items = lines.filter(x => x.type === 'response_item').map(x => x.payload ?? {});
    const completion = lines.find(x => x.type === 'event_msg' && x.payload?.type === 'task_complete')?.payload;
    return { id: metadata.id ?? null, parent, provider: metadata.model_provider ?? null,
      models: lines.filter(x => x.type === 'turn_context').map(x => x.payload?.model),
      // Recent stock Code Mode dispatches multi_agent_v1 through exec; older runtimes log
      // ordinary function_call items. Both are first-party rollout evidence.
      spawnCalled: items.some(x => (x.type === 'function_call' && x.name === 'spawn_agent')
        || (x.type === 'custom_tool_call' && x.name === 'exec'
          && typeof x.input === 'string' && x.input.includes('multi_agent_v1__spawn_agent('))),
      waitCalled: items.some(x => (x.type === 'function_call' && x.name === 'wait_agent')
        || (x.type === 'custom_tool_call' && x.name === 'exec'
          && typeof x.input === 'string' && x.input.includes('multi_agent_v1__wait_agent('))),
      waitReceivedChild: items.some(x => (x.type === 'function_call_output' || x.type === 'custom_tool_call_output')
        && normalizedMarker(typeof x.output === 'string' ? x.output : JSON.stringify(x.output)).includes('CHILD_DEV_LIVE_OK')),
      completed: Boolean(completion && !completion.error),
      childResult: normalizedMarker(completion?.last_agent_message) === 'CHILD_DEV_LIVE_OK',
      parentResult: normalizedMarker(completion?.last_agent_message) === 'PARENT_RECEIVED_CHILD_DEV_LIVE_OK' };
  });
  const root = sessions.find(x => x.parent === null);
  const child = sessions.find(x => x.parent === root?.id && x.id !== root?.id);
  const passed = exit === 0 && sessions.length === 2 && unexpectedNativeForward === 0
    && (nativeRoot ? authorizedNativeRootForward > 0 && nativeUpstreamStatuses.every(status => status >= 200 && status < 300) : authorizedNativeRootForward === 0)
    && root?.provider === 'proof' && root.models.includes(nativeRoot ? nativeRootModel : 'chatgpt-web/high') && root.spawnCalled
    && root.waitCalled && root.waitReceivedChild && root.completed && root.parentResult
    && child?.provider === 'proof' && child.models.includes(webChildModel)
    && child.completed && child.childResult;
  const evidence = { testDir, codexVersion, nativeRootModel, nativeRoot, automaticChild, exit, sessionCount: sessions.length, sessions,
    nativeRootForwarded: authorizedNativeRootForward, nativeUpstreamStatuses, unintendedNativeForwarded: unexpectedNativeForward,
    passed,
    errorTypes: stdout.split('\n').filter(x => x.includes('"type":"error"')).map(x => { try { return JSON.parse(x).msg?.split(':')[0] ?? 'codex_error'; } catch { return 'codex_error'; } }).slice(-3),
  };
  writeFileSync(join(testDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await closeChatGptBrowserWorkers();
  await closeTurnBrokers();
  await server.stop(true);
}
