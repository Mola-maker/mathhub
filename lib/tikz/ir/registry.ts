import {
  GEOMETRY_SEMANTIC_PLUGIN_API_VERSION,
  type SemanticPluginResolutionRequest,
} from './capabilities';
import type { GeometrySemanticPlugin } from './plugin';

export interface RegisterSemanticPluginOptions {
  replace?: boolean;
}

function comparePlugins(a: GeometrySemanticPlugin, b: GeometrySemanticPlugin): number {
  const priorityDelta = (b.descriptor.priority ?? 0) - (a.descriptor.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return a.descriptor.id === b.descriptor.id
    ? 0
    : a.descriptor.id < b.descriptor.id ? -1 : 1;
}

function supports(
  plugin: GeometrySemanticPlugin,
  request: SemanticPluginResolutionRequest,
): boolean {
  const descriptor = plugin.descriptor;
  const capabilities = descriptor.capabilities;

  if (request.pluginId && descriptor.id !== request.pluginId) return false;
  if (
    request.sourceLanguageId
    && !capabilities.sourceLanguages.includes(request.sourceLanguageId)
  ) return false;
  if (
    request.truth
    && capabilities.truthSupport[request.truth] === 'unsupported'
  ) return false;
  if (
    request.operation
    && !capabilities.operationKinds.includes(request.operation)
  ) return false;
  if (
    request.projectionTarget
    && !capabilities.projectionTargets.includes(request.projectionTarget)
  ) return false;
  if (
    request.renderTarget
    && !(capabilities.renderTargets ?? []).includes(request.renderTarget)
  ) return false;
  if (request.ioChannel) {
    const io = capabilities.io.find(({ channel }) => channel === request.ioChannel);
    if (!io) return false;
    if (request.ioDirection === 'input' && !io.input) return false;
    if (request.ioDirection === 'output' && !io.output) return false;
  }
  return true;
}

function assertPlugin(plugin: GeometrySemanticPlugin): void {
  const { descriptor } = plugin;
  if (!descriptor.id.trim()) throw new TypeError('Semantic plugin id must not be empty');
  if (!descriptor.version.trim()) {
    throw new TypeError(`Semantic plugin "${descriptor.id}" version must not be empty`);
  }
  if (descriptor.apiVersion !== GEOMETRY_SEMANTIC_PLUGIN_API_VERSION) {
    throw new RangeError(
      `Semantic plugin "${descriptor.id}" uses unsupported API version ${descriptor.apiVersion}`,
    );
  }
  if (typeof plugin.project !== 'function') {
    throw new TypeError(`Semantic plugin "${descriptor.id}" must implement project()`);
  }
}

/**
 * Deterministic, lifecycle-neutral registry. Callers own registry instances so
 * tests, documents and workers do not share hidden global plugin state.
 */
export class SemanticPluginRegistry {
  private readonly plugins = new Map<string, GeometrySemanticPlugin>();

  constructor(initialPlugins: readonly GeometrySemanticPlugin[] = []) {
    for (const plugin of initialPlugins) this.register(plugin);
  }

  register(
    plugin: GeometrySemanticPlugin,
    options: RegisterSemanticPluginOptions = {},
  ): () => boolean {
    assertPlugin(plugin);
    const id = plugin.descriptor.id;
    const existing = this.plugins.get(id);
    if (existing && !options.replace) {
      throw new Error(`Semantic plugin "${id}" is already registered`);
    }
    this.plugins.set(id, plugin);

    return () => {
      if (this.plugins.get(id) !== plugin) return false;
      return this.plugins.delete(id);
    };
  }

  unregister(pluginId: string): GeometrySemanticPlugin | undefined {
    const plugin = this.plugins.get(pluginId);
    if (plugin) this.plugins.delete(pluginId);
    return plugin;
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  get(pluginId: string): GeometrySemanticPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  require(pluginId: string): GeometrySemanticPlugin {
    const plugin = this.get(pluginId);
    if (!plugin) throw new Error(`Semantic plugin "${pluginId}" is not registered`);
    return plugin;
  }

  list(): readonly GeometrySemanticPlugin[] {
    return [...this.plugins.values()].sort(comparePlugins);
  }

  resolveAll(request: SemanticPluginResolutionRequest): readonly GeometrySemanticPlugin[] {
    return this.list().filter((plugin) => supports(plugin, request));
  }

  resolve(request: SemanticPluginResolutionRequest): GeometrySemanticPlugin | undefined {
    return this.resolveAll(request)[0];
  }

  get size(): number {
    return this.plugins.size;
  }
}

export function createSemanticPluginRegistry(
  plugins: readonly GeometrySemanticPlugin[] = [],
): SemanticPluginRegistry {
  return new SemanticPluginRegistry(plugins);
}
