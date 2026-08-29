import { hashSource } from '@/lib/tikz/document/source-hash';

export const GEOGEBRA_LIVE_COMMAND_SNAPSHOT_SCHEMA_VERSION =
  'geogebra-live-command-snapshot/v1' as const;

const LABEL = /^[A-Za-z_][\w']*$/u;
const MAX_COMMANDS = 512;
const MAX_COMMAND_CHARS = 4_096;
const MAX_SOURCE_CHARS = 256 * 1024;

export interface GeogebraLiveCommandReader {
  getAllObjectNames: () => string[];
  getObjectType?: (name: string) => string;
  getCommandString?: (name: string, useLocalizedInput?: boolean) => string;
  getXcoord?: (name: string) => number;
  getYcoord?: (name: string) => number;
  getValue?: (name: string) => number;
  getColor?: (name: string) => string;
  getLineThickness?: (name: string) => number;
  getLineStyle?: (name: string) => number;
  getPointSize?: (name: string) => number;
  getVisible?: (name: string) => boolean;
  getCaption?: (name: string) => string;
  getLabelVisible?: (name: string) => boolean;
  exists?: (name: string) => boolean;
}

export type GeogebraLiveSnapshotExclusionReason =
  | 'unsupported-label'
  | 'missing-definition'
  | 'definition-label-mismatch'
  | 'unreadable-object'
  | 'command-bound-exceeded';

export interface GeogebraLiveSnapshotExclusion {
  readonly objectName: string;
  readonly objectType: string;
  readonly reason: GeogebraLiveSnapshotExclusionReason;
  readonly detail?: string;
}

export interface GeogebraLiveCommandSnapshot {
  readonly schemaVersion: typeof GEOGEBRA_LIVE_COMMAND_SNAPSHOT_SCHEMA_VERSION;
  readonly complete: boolean;
  readonly objectCount: number;
  readonly definitionCount: number;
  readonly presentationCommandCount: number;
  readonly commands: readonly string[];
  readonly sourceHash: string;
  readonly exclusions: readonly GeogebraLiveSnapshotExclusion[];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberLiteral(value: number): string {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function quoted(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

/** GeoGebra returns square brackets for non-localized commands. Our command
 * projector and assistant protocol use parentheses, so normalize only the
 * outer command delimiter and preserve nested list/index syntax byte-for-byte. */
function normalizeOuterCommandDelimiter(expression: string): string {
  const match = expression.match(/^([A-Za-z]+)\s*\[([\s\S]*)\]$/u);
  return match ? `${match[1]}(${match[2]})` : expression;
}

function normalizeDefinition(name: string, rawCommand: string): string | null {
  const command = rawCommand.trim();
  if (!command) return null;
  const assignment = command.match(/^([A-Za-z_][\w']*)\s*=(?!=)\s*([\s\S]+)$/u);
  if (assignment) {
    if (assignment[1] !== name) return null;
    return `${name}=${normalizeOuterCommandDelimiter(assignment[2].trim())}`;
  }
  return `${name}=${normalizeOuterCommandDelimiter(command)}`;
}

function presentationCommands(
  reader: GeogebraLiveCommandReader,
  name: string,
  type: string,
): string[] {
  const commands: string[] = [];
  const color = reader.getColor?.(name)?.trim();
  if (color && /^#[0-9a-f]{6}$/iu.test(color)) {
    commands.push(`SetColor(${name},${quoted(color.toUpperCase())})`);
  }
  const visible = reader.getVisible?.(name);
  if (visible === false) commands.push(`SetVisibleInView(${name},1,false)`);
  const caption = reader.getCaption?.(name)?.trim();
  if (caption && caption !== name) commands.push(`SetCaption(${name},${quoted(caption)})`);
  const labelVisible = reader.getLabelVisible?.(name);
  if (typeof labelVisible === 'boolean') commands.push(`ShowLabel(${name},${labelVisible})`);
  const thickness = reader.getLineThickness?.(name);
  if (finite(thickness)) commands.push(`SetLineThickness(${name},${numberLiteral(thickness)})`);
  const lineStyle = reader.getLineStyle?.(name);
  if (finite(lineStyle)) commands.push(`SetLineStyle(${name},${numberLiteral(lineStyle)})`);
  const pointSize = type === 'point' ? reader.getPointSize?.(name) : undefined;
  if (finite(pointSize)) commands.push(`SetPointSize(${name},${numberLiteral(pointSize)})`);
  return commands;
}

function validCommand(command: string): boolean {
  return command.length > 0
    && command.length <= MAX_COMMAND_CHARS
    && !/[\r\n\u0000]/u.test(command);
}

/**
 * Capture a deterministic, replayable command view of the live applet.
 *
 * Missing derived definitions are never replaced by evaluated coordinates.
 * Only genuinely free points/numerics receive literal fallbacks; otherwise the
 * snapshot is incomplete and must not become durable source truth.
 */
export function captureGeogebraLiveCommandSnapshot(
  reader: GeogebraLiveCommandReader,
): GeogebraLiveCommandSnapshot {
  const definitions: string[] = [];
  const presentation: string[] = [];
  const exclusions: GeogebraLiveSnapshotExclusion[] = [];
  const names = reader.getAllObjectNames() ?? [];

  for (const name of names) {
    const type = reader.getObjectType?.(name) ?? 'unknown';
    try {
      if (reader.exists && !reader.exists(name)) continue;
      if (!LABEL.test(name)) {
        exclusions.push({ objectName: name, objectType: type, reason: 'unsupported-label' });
        continue;
      }
      const raw = reader.getCommandString?.(name, false) ?? '';
      let definition = normalizeDefinition(name, raw);
      if (!definition && raw.trim()) {
        exclusions.push({
          objectName: name,
          objectType: type,
          reason: 'definition-label-mismatch',
          detail: raw.slice(0, 256),
        });
        continue;
      }
      if (!definition && type === 'point') {
        const x = reader.getXcoord?.(name);
        const y = reader.getYcoord?.(name);
        if (finite(x) && finite(y)) definition = `${name}=(${numberLiteral(x)},${numberLiteral(y)})`;
      }
      if (!definition && (type === 'numeric' || type === 'boolean')) {
        const value = reader.getValue?.(name);
        if (finite(value)) definition = `${name}=${numberLiteral(value)}`;
      }
      if (!definition) {
        exclusions.push({ objectName: name, objectType: type, reason: 'missing-definition' });
        continue;
      }
      definitions.push(definition);
      presentation.push(...presentationCommands(reader, name, type));
    } catch (error) {
      exclusions.push({
        objectName: name,
        objectType: type,
        reason: 'unreadable-object',
        detail: error instanceof Error ? error.message.slice(0, 256) : undefined,
      });
    }
  }

  let commands = [...definitions, ...presentation];
  const sourceChars = commands.reduce((sum, command) => sum + command.length, 0)
    + Math.max(0, commands.length - 1);
  if (
    commands.length > MAX_COMMANDS
    || sourceChars > MAX_SOURCE_CHARS
    || commands.some((command) => !validCommand(command))
  ) {
    exclusions.push({
      objectName: '*',
      objectType: 'construction',
      reason: 'command-bound-exceeded',
      detail: `${commands.length} commands / ${sourceChars} chars`,
    });
    commands = [];
  }

  return {
    schemaVersion: GEOGEBRA_LIVE_COMMAND_SNAPSHOT_SCHEMA_VERSION,
    complete: exclusions.length === 0,
    objectCount: names.length,
    definitionCount: definitions.length,
    presentationCommandCount: presentation.length,
    commands,
    sourceHash: hashSource(commands.join('\n')),
    exclusions,
  };
}
