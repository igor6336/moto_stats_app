// Isolated browser modules with injected I/O; no network, timers or real storage.
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

export async function loadModule(path, mocks = {}, globals = {}) {
  const base = new URL('../../', import.meta.url);
  const context = createContext({
    EventTarget, Event, CustomEvent: globalThis.CustomEvent || class extends Event {
      constructor(type, options = {}) { super(type); this.detail = options.detail; }
    }, performance, structuredClone,
    console: { warn() {}, error() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    document: new EventTarget(), window: Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) }),
    navigator: { userAgent: 'test', platform: 'test' }, screen: { width: 400, height: 800 }, devicePixelRatio: 1,
    ...globals,
  });
  const dependencies = new Map(Object.entries(mocks).map(([p, value]) => [new URL(p, base).href, value]));
  const cache = new Map();
  async function get(url) {
    if (cache.has(url)) return cache.get(url);
    const mock = dependencies.get(url);
    const module = mock
      ? new SyntheticModule(Object.keys(mock), function () {
        for (const [key, value] of Object.entries(mock)) this.setExport(key, value);
      }, { context, identifier: url })
      : new SourceTextModule(await readFile(new URL(url), 'utf8'), { context, identifier: url });
    cache.set(url, module);
    return module;
  }
  const module = await get(new URL(path, base).href);
  await module.link((specifier, parent) => get(new URL(specifier, parent.identifier).href));
  await module.evaluate();
  return module.namespace;
}
