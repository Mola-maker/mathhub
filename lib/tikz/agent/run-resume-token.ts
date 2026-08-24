import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 'v1';
const MIN_SECRET_BYTES = 32;
const developmentSecret = randomBytes(MIN_SECRET_BYTES);

function configuredSecret(): Buffer | null {
  const value = process.env.AGENT_RUN_RESUME_SECRET?.trim();
  if (!value) return process.env.NODE_ENV === 'production' ? null : developmentSecret;
  const bytes = Buffer.from(value, 'utf8');
  return bytes.byteLength >= MIN_SECRET_BYTES ? bytes : null;
}

export function tikzAgentResumeTokenConfigured(): boolean {
  return configuredSecret() !== null;
}

function tokenDigest(runId: string, secret: Buffer): string {
  return createHmac('sha256', secret)
    .update(`tikz-agent-run-resume/v1\0${runId}`, 'utf8')
    .digest('base64url');
}

export function createTikzAgentRunResumeToken(runId: string): string {
  const secret = configuredSecret();
  if (!secret) throw new TypeError('AGENT_RUN_RESUME_SECRET is not configured');
  return `${TOKEN_VERSION}.${tokenDigest(runId, secret)}`;
}

export function verifyTikzAgentRunResumeToken(runId: string, token: string): boolean {
  const secret = configuredSecret();
  if (!secret || !token.startsWith(`${TOKEN_VERSION}.`)) return false;
  const expected = Buffer.from(createTikzAgentRunResumeToken(runId), 'utf8');
  const observed = Buffer.from(token, 'utf8');
  return expected.byteLength === observed.byteLength
    && timingSafeEqual(expected, observed);
}
