/**
 * Framework-agnostic command and shortcut registry for TikZ Studio.
 *
 * The registry intentionally has no React/DOM side effects.  UI surfaces can
 * pass a KeyboardEvent-like value to resolve/dispatch, while tests and
 * command palettes can use the same API with a string (`Mod+K`, `Escape`, …).
 * All shortcut matching is performed against the canonical representation
 * produced by `normalizeShortcut`.
 */

export type ShortcutPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

/** Scopes are labels, with `global` matching every requested scope. */
export type CommandScope =
  | 'global'
  | 'studio'
  | 'canvas'
  | 'editor'
  | 'palette'
  | 'selection'
  | 'dialog'
  | (string & {});

export type ScopeInput = CommandScope | readonly CommandScope[];

export type ShortcutInput = string | KeyboardShortcutEventLike;

/** The subset of KeyboardEvent used by the registry. */
export interface KeyboardShortcutEventLike {
  key?: string | null;
  code?: string | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
  preventDefault?: () => void;
}

export interface CommandEvaluationContext<Context = Record<string, unknown>> {
  context: Context;
  scope: CommandScope | undefined;
  editable: boolean;
  platform: ShortcutPlatform;
  event?: KeyboardShortcutEventLike;
}

export interface CommandCondition<Context = Record<string, unknown>> {
  /** Stable identity used by conflict detection. */
  key: string;
  test: (evaluation: CommandEvaluationContext<Context>) => boolean;
}

export type CommandWhen<Context = Record<string, unknown>> =
  | boolean
  | CommandCondition<Context>
  | ((evaluation: CommandEvaluationContext<Context>) => boolean);

export interface ShortcutBinding<Context = Record<string, unknown>> {
  shortcut: string;
  scope?: ScopeInput;
  priority?: number;
  when?: CommandWhen<Context>;
  /** Optional stable condition identity when `when` is a function. */
  whenKey?: string;
  allowInEditable?: boolean;
}

export type ShortcutDeclaration<Context = Record<string, unknown>> =
  | string
  | ShortcutBinding<Context>;

export interface CommandInvocation<Context = Record<string, unknown>> {
  commandId: string;
  shortcut: string;
  scope: CommandScope | undefined;
  platform: ShortcutPlatform;
  editable: boolean;
  event?: KeyboardShortcutEventLike;
  context: Context;
}

export type CommandExecutor<Context = Record<string, unknown>> = (
  context: Context,
  invocation: CommandInvocation<Context>,
) => unknown;

export interface CommandDefinition<Context = Record<string, unknown>> {
  id: string;
  title?: string;
  description?: string;
  /** Command-level defaults; a binding may override each property. */
  scope?: ScopeInput;
  priority?: number;
  when?: CommandWhen<Context>;
  whenKey?: string;
  allowInEditable?: boolean;
  shortcuts?: readonly ShortcutDeclaration<Context>[];
  /** Convenience for a command with exactly one shortcut. */
  shortcut?: string;
  execute: CommandExecutor<Context>;
}

export interface ResolveOptions<Context = Record<string, unknown>> {
  shortcut: ShortcutInput;
  scope?: CommandScope;
  context?: Context;
  editable?: boolean;
  platform?: ShortcutPlatform;
  event?: KeyboardShortcutEventLike;
}

export interface NormalizedBinding<Context = Record<string, unknown>> {
  shortcut: string;
  scope: readonly CommandScope[];
  priority: number;
  when?: CommandWhen<Context>;
  conditionKey: string;
  allowInEditable: boolean;
}

export interface RegisteredCommand<Context = Record<string, unknown>>
  extends CommandDefinition<Context> {
  readonly registrationOrder: number;
  readonly bindings: readonly NormalizedBinding<Context>[];
}

export type CommandDiagnosticSeverity = 'warning' | 'error';

export interface CommandConflict<Context = Record<string, unknown>> {
  kind: 'shortcut-conflict';
  severity: CommandDiagnosticSeverity;
  shortcut: string;
  commandIds: readonly [string, string];
  scopes: readonly [readonly CommandScope[], readonly CommandScope[]];
  conditionKeys: readonly [string, string];
  /** `ambiguous` means equal priority; `priority` records a deterministic winner. */
  resolution: 'ambiguous' | 'priority';
  winnerId?: string;
  /** True when at least one condition was an unlabelled predicate. */
  conditionOverlapIsConservative: boolean;
  commands?: readonly [RegisteredCommand<Context>, RegisteredCommand<Context>];
}

export interface CommandCandidate<Context = Record<string, unknown>> {
  command: RegisteredCommand<Context>;
  binding: NormalizedBinding<Context>;
}

export interface CommandResolution<Context = Record<string, unknown>> {
  status: 'resolved' | 'ambiguous';
  normalizedShortcut: string;
  candidates: readonly CommandCandidate<Context>[];
  command?: RegisteredCommand<Context>;
  binding?: NormalizedBinding<Context>;
  diagnostics: readonly CommandConflict<Context>[];
}

export interface DispatchResult<Context = Record<string, unknown>> {
  handled: boolean;
  commandId?: string;
  result?: unknown;
  error?: unknown;
  reason?: 'unhandled' | 'ambiguous' | 'editable' | 'condition';
  resolution?: CommandResolution<Context> | null;
}

export interface CommandRegistration {
  readonly id: string;
  unregister(): boolean;
}

export interface RegisterOptions {
  /** Explicitly replace an existing id while preserving normal diagnostics. */
  replace?: boolean;
}

export class CommandRegistryError extends Error {
  readonly code: 'duplicate-id' | 'invalid-command' | 'invalid-shortcut';

  constructor(
    code: CommandRegistryError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CommandRegistryError';
    this.code = code;
  }
}

const MODIFIER_ORDER = ['Control', 'Meta', 'Alt', 'Shift'] as const;
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  spacebar: 'Space',
  ' ': 'Space',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  bksp: 'Backspace',
  tab: 'Tab',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  plus: '+',
  minus: '-',
};

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  ctrl: 'Control',
  control: 'Control',
  ctl: 'Control',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  super: 'Meta',
  win: 'Meta',
  windows: 'Meta',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  mod: 'Mod',
  primary: 'Mod',
};

const MODIFIER_ONLY_EVENT_KEYS = new Set([
  'alt',
  'altgraph',
  'control',
  'fn',
  'fnlock',
  'hyper',
  'meta',
  'os',
  'shift',
  'super',
  'symbol',
  'symbollock',
]);

function keyboardEventHasCommandKey(event: KeyboardShortcutEventLike): boolean {
  const rawKey = event.key || event.code || '';
  const normalized = rawKey.trim().toLocaleLowerCase();
  return normalized.length > 0
    && normalized !== 'unidentified'
    && !MODIFIER_ONLY_EVENT_KEYS.has(normalized);
}

function detectPlatformFromUserAgent(userAgent: string): ShortcutPlatform {
  if (/macintosh|mac os x|iphone|ipad|ipod/i.test(userAgent)) return 'macos';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/linux|x11|android/i.test(userAgent)) return 'linux';
  return 'unknown';
}

export function detectShortcutPlatform(userAgent?: string): ShortcutPlatform {
  if (userAgent !== undefined) return detectPlatformFromUserAgent(userAgent);
  if (typeof navigator !== 'undefined') {
    return detectPlatformFromUserAgent(navigator.userAgent);
  }
  return 'unknown';
}

function effectivePlatform(platform?: ShortcutPlatform): ShortcutPlatform {
  return platform && platform !== 'unknown'
    ? platform
    : detectShortcutPlatform();
}

function splitShortcut(shortcut: string): string[] {
  const trimmed = shortcut.trim();
  if (!trimmed) return [];
  if (trimmed === '+') return ['+'];
  // `+` may itself be the key.  Treat a final `++` as the Plus key while
  // retaining ordinary Ctrl+K style chords.
  if (trimmed.endsWith('++')) {
    const beforePlus = trimmed.slice(0, -2);
    return beforePlus ? [...beforePlus.split('+'), '+'] : ['+'];
  }
  return trimmed.split('+').map((part) => part.trim()).filter(Boolean);
}

function normalizeKeyToken(token: string): string {
  const lowered = token.trim().toLocaleLowerCase();
  const alias = KEY_ALIASES[lowered];
  if (alias) return alias;
  if (/^f(?:[1-9]|1[0-2])$/i.test(token.trim())) return token.trim().toUpperCase();
  if (token.length === 1) return token.toUpperCase();
  const trimmed = token.trim();
  return trimmed.length > 0
    ? `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`
    : trimmed;
}

/** Convert a string/event to a canonical `Control+Shift+K` representation. */
export function normalizeShortcut(
  input: ShortcutInput,
  platform?: ShortcutPlatform,
): string {
  const targetPlatform = effectivePlatform(platform);
  if (typeof input !== 'string') return normalizeKeyboardShortcut(input, targetPlatform);

  const tokens = splitShortcut(input);
  if (tokens.length === 0) {
    throw new CommandRegistryError('invalid-shortcut', 'Shortcut cannot be empty');
  }
  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLocaleLowerCase()];
    if (modifier) {
      modifiers.add(modifier === 'Mod'
        ? (targetPlatform === 'macos' ? 'Meta' : 'Control')
        : modifier);
      continue;
    }
    if (key !== null) {
      throw new CommandRegistryError(
        'invalid-shortcut',
        `Shortcut '${input}' contains more than one non-modifier key`,
      );
    }
    key = normalizeKeyToken(token);
  }
  if (!key) {
    throw new CommandRegistryError(
      'invalid-shortcut',
      `Shortcut '${input}' does not contain a non-modifier key`,
    );
  }
  return canonicalShortcut(modifiers, key);
}

function normalizeKeyboardShortcut(
  event: KeyboardShortcutEventLike,
  platform: ShortcutPlatform,
): string {
  const rawKey = event.key || event.code || '';
  const lowered = rawKey.toLocaleLowerCase();
  if (MODIFIER_ALIASES[lowered] && !event.key?.startsWith('F')) {
    throw new CommandRegistryError('invalid-shortcut', 'Keyboard event is a modifier-only key');
  }
  const key = normalizeKeyToken(rawKey.replace(/^Key/, '').replace(/^Digit/, ''));
  if (!key) throw new CommandRegistryError('invalid-shortcut', 'Keyboard event has no key');
  const modifiers = new Set<string>();
  if (event.ctrlKey) modifiers.add('Control');
  if (event.metaKey) modifiers.add('Meta');
  if (event.altKey) modifiers.add('Alt');
  if (event.shiftKey) modifiers.add('Shift');
  // `platform` is intentionally read here to make the conversion explicit;
  // physical event modifiers remain authoritative (Ctrl is not remapped).
  void platform;
  return canonicalShortcut(modifiers, key);
}

function canonicalShortcut(modifiers: Set<string>, key: string): string {
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].join('+');
}

/** Keep `Mod` symbolic inside a registered binding for cross-platform matching. */
function normalizeBindingShortcut(input: string): string {
  const canonical = normalizeShortcut(input, 'windows');
  const hasMod = splitShortcut(input).some(
    (token) => MODIFIER_ALIASES[token.toLocaleLowerCase()] === 'Mod',
  );
  return hasMod ? canonical.replace(/^Control(?=\+)/, 'Mod') : canonical;
}

function materializeBindingShortcut(
  bindingShortcut: string,
  platform: ShortcutPlatform,
): string {
  if (!bindingShortcut.startsWith('Mod+')) return bindingShortcut;
  return normalizeShortcut(bindingShortcut, platform);
}

function bindingMatchesEvent(
  bindingShortcut: string,
  eventShortcut: string,
  platform: ShortcutPlatform,
): boolean {
  if (materializeBindingShortcut(bindingShortcut, platform) === eventShortcut) return true;
  // SSR and embedded webviews may not expose a user agent.  In that case a
  // symbolic Mod binding accepts either physical primary modifier; callers
  // that need strictness can pass an explicit platform to resolve/dispatch.
  return platform === 'unknown'
    && bindingShortcut.startsWith('Mod+')
    && (eventShortcut === normalizeShortcut(bindingShortcut, 'windows')
      || eventShortcut === normalizeShortcut(bindingShortcut, 'macos'));
}

function shortcutBindingsOverlap(first: string, second: string): boolean {
  if (first === second) return true;
  return (['windows', 'macos', 'linux'] as const).some((platform) => (
    materializeBindingShortcut(first, platform)
      === materializeBindingShortcut(second, platform)
  ));
}

/** Render a canonical/string shortcut for a target platform. */
export function formatShortcut(
  input: ShortcutInput,
  platform?: ShortcutPlatform,
): string {
  const targetPlatform = effectivePlatform(platform);
  const canonical = normalizeShortcut(input, targetPlatform);
  const tokens = canonical.split('+');
  const key = tokens.pop() ?? '';
  if (targetPlatform === 'macos') {
    const symbols: Record<string, string> = {
      Control: '⌃',
      Meta: '⌘',
      Alt: '⌥',
      Shift: '⇧',
    };
    return `${tokens.map((token) => symbols[token] ?? token).join('')}${displayKey(key)}`;
  }
  const labels: Record<string, string> = {
    Control: 'Ctrl',
    Meta: 'Win',
    Alt: 'Alt',
    Shift: 'Shift',
  };
  return [...tokens.map((token) => labels[token] ?? token), displayKey(key)].join('+');
}

function displayKey(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Backspace: 'Backspace',
    Delete: 'Delete',
  };
  return labels[key] ?? key;
}

function asScopes(scope: ScopeInput | undefined): readonly CommandScope[] {
  if (!scope) return ['global'];
  const scopes = Array.isArray(scope) ? scope : [scope];
  return scopes.length > 0 ? [...new Set(scopes)] : ['global'];
}

function conditionKey<Context>(
  when: CommandWhen<Context> | undefined,
  explicitKey?: string,
): string {
  if (explicitKey) return explicitKey;
  if (when === undefined || when === true) return 'always';
  if (when === false) return 'never';
  if (typeof when === 'object') return when.key;
  return 'predicate:unknown';
}

function evaluateWhen<Context>(
  when: CommandWhen<Context> | undefined,
  evaluation: CommandEvaluationContext<Context>,
): boolean {
  if (when === undefined || when === true) return true;
  if (when === false) return false;
  if (typeof when === 'object') return when.test(evaluation);
  return when(evaluation);
}

function scopeMatches(
  bindingScopes: readonly CommandScope[],
  requestedScope: CommandScope | undefined,
): boolean {
  if (bindingScopes.includes('global')) return true;
  if (!requestedScope) return false;
  return bindingScopes.includes(requestedScope);
}

function scopesOverlap(
  first: readonly CommandScope[],
  second: readonly CommandScope[],
): boolean {
  if (first.includes('global') || second.includes('global')) return true;
  return first.some((scope) => second.includes(scope));
}

function conditionsOverlap(first: string, second: string): {
  overlap: boolean;
  conservative: boolean;
} {
  if (first === 'never' || second === 'never') return { overlap: false, conservative: false };
  if (first === second) {
    return { overlap: true, conservative: first === 'predicate:unknown' };
  }
  // We cannot prove arbitrary predicates disjoint, so surface a warning rather
  // than silently allowing a runtime first-match winner.
  if (first === 'predicate:unknown' || second === 'predicate:unknown') {
    return { overlap: true, conservative: true };
  }
  return { overlap: false, conservative: false };
}

function editableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLocaleLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return element.getAttribute?.('contenteditable') === 'true';
}

export class CommandRegistry<Context = Record<string, unknown>> {
  private readonly commands = new Map<string, RegisteredCommand<Context>>();

  private registrationCounter = 0;

  register(
    definition: CommandDefinition<Context>,
    options: RegisterOptions = {},
  ): CommandRegistration {
    if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) {
      throw new CommandRegistryError('invalid-command', 'A command id is required');
    }
    if (typeof definition.execute !== 'function') {
      throw new CommandRegistryError(
        'invalid-command',
        `Command '${definition.id}' must provide an execute function`,
      );
    }
    if (this.commands.has(definition.id) && !options.replace) {
      throw new CommandRegistryError(
        'duplicate-id',
        `Command '${definition.id}' is already registered`,
      );
    }
    const order = this.commands.get(definition.id)?.registrationOrder ?? this.registrationCounter++;
    const declarations = [
      ...(definition.shortcuts ?? []),
      ...(definition.shortcut ? [definition.shortcut] : []),
    ];
    const bindings = declarations.map((declaration) => {
      const value = typeof declaration === 'string'
        ? { shortcut: declaration }
        : declaration;
      const canonical = normalizeBindingShortcut(value.shortcut);
      const when = value.when ?? definition.when;
      return {
        shortcut: canonical,
        scope: asScopes(value.scope ?? definition.scope),
        priority: value.priority ?? definition.priority ?? 0,
        when,
        conditionKey: conditionKey(when, value.whenKey ?? definition.whenKey),
        allowInEditable: value.allowInEditable ?? definition.allowInEditable ?? false,
      } satisfies NormalizedBinding<Context>;
    });
    const registered: RegisteredCommand<Context> = {
      ...definition,
      registrationOrder: order,
      bindings,
    };
    this.commands.set(definition.id, registered);
    return {
      id: definition.id,
      unregister: () => this.unregister(definition.id),
    };
  }

  registerMany(
    definitions: readonly CommandDefinition<Context>[],
    options: RegisterOptions = {},
  ): readonly CommandRegistration[] {
    return definitions.map((definition) => this.register(definition, options));
  }

  unregister(id: string): boolean {
    return this.commands.delete(id);
  }

  get(id: string): RegisteredCommand<Context> | undefined {
    return this.commands.get(id);
  }

  list(): readonly RegisteredCommand<Context>[] {
    return [...this.commands.values()].sort((a, b) => a.registrationOrder - b.registrationOrder);
  }

  clear(): void {
    this.commands.clear();
  }

  /** All potential collisions, independent of the current UI context. */
  detectConflicts(): readonly CommandConflict<Context>[] {
    const entries: Array<{
      command: RegisteredCommand<Context>;
      binding: NormalizedBinding<Context>;
    }> = [];
    for (const command of this.commands.values()) {
      for (const binding of command.bindings) entries.push({ command, binding });
    }
    const conflicts: CommandConflict<Context>[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const first = entries[index];
      for (let next = index + 1; next < entries.length; next += 1) {
        const second = entries[next];
        if (!shortcutBindingsOverlap(first.binding.shortcut, second.binding.shortcut)) continue;
        if (!scopesOverlap(first.binding.scope, second.binding.scope)) continue;
        const condition = conditionsOverlap(
          first.binding.conditionKey,
          second.binding.conditionKey,
        );
        if (!condition.overlap) continue;
        const samePriority = first.binding.priority === second.binding.priority;
        const winner = first.binding.priority > second.binding.priority
          ? first.command.id
          : second.binding.priority > first.binding.priority
            ? second.command.id
            : undefined;
        conflicts.push({
          kind: 'shortcut-conflict',
          severity: samePriority ? 'error' : 'warning',
          shortcut: first.binding.shortcut,
          commandIds: [first.command.id, second.command.id],
          scopes: [first.binding.scope, second.binding.scope],
          conditionKeys: [first.binding.conditionKey, second.binding.conditionKey],
          resolution: samePriority ? 'ambiguous' : 'priority',
          winnerId: winner,
          conditionOverlapIsConservative: condition.conservative,
          commands: [first.command, second.command],
        });
      }
    }
    return conflicts;
  }

  getDiagnostics(): readonly CommandConflict<Context>[] {
    return this.detectConflicts();
  }

  resolve(
    optionsOrShortcut: ResolveOptions<Context> | ShortcutInput,
    options: Omit<ResolveOptions<Context>, 'shortcut'> = {},
  ): CommandResolution<Context> | null {
    const resolveOptions: ResolveOptions<Context> = typeof optionsOrShortcut === 'object'
      && optionsOrShortcut !== null
      && ('shortcut' in optionsOrShortcut)
      ? optionsOrShortcut as ResolveOptions<Context>
      : { ...options, shortcut: optionsOrShortcut as ShortcutInput };
    const platform = effectivePlatform(resolveOptions.platform);
    const event = typeof resolveOptions.shortcut === 'string'
      ? resolveOptions.event
      : resolveOptions.shortcut;
    // Browsers dispatch their own keydown for Control/Meta/Alt/Shift before
    // the actual chord key. That event is valid browser input, but it is not a
    // command candidate and must not be surfaced as a registry error.
    if (
      typeof resolveOptions.shortcut !== 'string'
      && !keyboardEventHasCommandKey(resolveOptions.shortcut)
    ) {
      return null;
    }
    const normalizedShortcut = normalizeShortcut(resolveOptions.shortcut, platform);
    const editable = resolveOptions.editable
      ?? (event ? editableTarget(event.target) : false);
    const context = (resolveOptions.context ?? {}) as Context;
    const evaluation: CommandEvaluationContext<Context> = {
      context,
      scope: resolveOptions.scope,
      editable,
      platform,
      event,
    };
    const candidates: CommandCandidate<Context>[] = [];
    for (const command of this.commands.values()) {
      for (const binding of command.bindings) {
        if (!bindingMatchesEvent(binding.shortcut, normalizedShortcut, platform)) continue;
        if (!scopeMatches(binding.scope, resolveOptions.scope)) continue;
        if (editable && !binding.allowInEditable) continue;
        if (!evaluateWhen(binding.when, evaluation)) continue;
        candidates.push({ command, binding });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (
      b.binding.priority - a.binding.priority
      || a.command.registrationOrder - b.command.registrationOrder
    ));
    const diagnostics = this.detectConflicts().filter((diagnostic) => (
      shortcutBindingsOverlap(diagnostic.shortcut, normalizedShortcut)
      && candidates.some((candidate) => diagnostic.commandIds.includes(candidate.command.id))
    ));
    const highestPriority = candidates[0].binding.priority;
    const highest = candidates.filter((candidate) => candidate.binding.priority === highestPriority);
    if (highest.length > 1) {
      return {
        status: 'ambiguous',
        normalizedShortcut,
        candidates,
        diagnostics,
      };
    }
    return {
      status: 'resolved',
      normalizedShortcut,
      candidates,
      command: candidates[0].command,
      binding: candidates[0].binding,
      diagnostics,
    };
  }

  dispatch(
    optionsOrShortcut: ResolveOptions<Context> | ShortcutInput,
    options: Omit<ResolveOptions<Context>, 'shortcut'> = {},
  ): DispatchResult<Context> {
    const resolution = this.resolve(optionsOrShortcut, options);
    if (!resolution) return { handled: false, reason: 'unhandled', resolution: null };
    if (resolution.status === 'ambiguous' || !resolution.command || !resolution.binding) {
      return { handled: false, reason: 'ambiguous', resolution };
    }
    const event = typeof optionsOrShortcut === 'string'
      ? options.event
      : optionsOrShortcut.event ?? options.event;
    const platform = typeof optionsOrShortcut === 'string'
      ? effectivePlatform(options.platform)
      : effectivePlatform(optionsOrShortcut.platform);
    const editable = typeof optionsOrShortcut === 'string'
      ? options.editable ?? (event ? editableTarget(event.target) : false)
      : optionsOrShortcut.editable ?? (event ? editableTarget(event.target) : false);
    event?.preventDefault?.();
    const context = (typeof optionsOrShortcut === 'string'
      ? options.context
      : optionsOrShortcut.context) as Context ?? ({} as Context);
    const invocation: CommandInvocation<Context> = {
      commandId: resolution.command.id,
      shortcut: resolution.normalizedShortcut,
      scope: typeof optionsOrShortcut === 'string' ? options.scope : optionsOrShortcut.scope,
      platform,
      editable,
      event,
      context,
    };
    try {
      return {
        handled: true,
        commandId: resolution.command.id,
        result: resolution.command.execute(context, invocation),
        resolution,
      };
    } catch (error) {
      return {
        handled: true,
        commandId: resolution.command.id,
        error,
        resolution,
      };
    }
  }
}
