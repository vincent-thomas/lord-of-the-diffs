/**
 * github-app-auth.ts — GitHub App authentication helpers.
 *
 * Generates installation access tokens by signing a JWT with the app's
 * private key, then exchanging it via GitHub's API. Writes the token to a
 * rendezvous file that the custom git credential helper reads.
 *
 * No pi imports — importable from any extension's logic module.
 */

import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** JWT is valid for at most 10 minutes per GitHub's limit. */
const JWT_TTL_SEC = 600;

/** Installation tokens expire in 1 hour; refresh with 5 min of headroom. */
const TOKEN_REFRESH_BUFFER_SEC = 60 * 5;

const GITHUB_API_BASE = "https://api.github.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubAppConfig {
	appId: string;
	installationId: string;
	privateKey: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config (cached after first read-and-scrub)
// ---------------------------------------------------------------------------

let cachedConfig: GitHubAppConfig | null = null;

/**
 * Read GitHub App config from environment variables, then scrub them from
 * the process environment so child processes (git, gh, etc.) cannot see them.
 *
 * The config is cached in memory after the first successful read, so
 * subsequent calls don't need the env vars and will not scrub again.
 *
 * Expects:
 *   GITHUB_APP_ID              — numeric app ID (e.g. "4200307")
 *   GITHUB_APP_INSTALLATION_ID — numeric installation ID
 *   GITHUB_APP_PRIVATE_KEY     — PEM-encoded private key (a full
 *                                -----BEGIN RSA PRIVATE KEY-----
 *                                block).  If the value starts with "/" it
 *                                is treated as a file path and read.
 *
 * Throws if any are missing.
 */
export function readConfigFromEnv(): GitHubAppConfig {
	if (cachedConfig) return cachedConfig;

	const appId = process.env.GITHUB_APP_ID;
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
	const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;

	if (!appId) throw new Error("GITHUB_APP_ID is not set");
	if (!installationId) throw new Error("GITHUB_APP_INSTALLATION_ID is not set");
	if (!rawKey) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");

	// Scrub secrets from the process environment immediately so child
	// processes (git, gh spawned via execAsync) cannot access them.
	delete process.env.GITHUB_APP_PRIVATE_KEY;
	delete process.env.GITHUB_APP_ID;
	delete process.env.GITHUB_APP_INSTALLATION_ID;

	// If the value looks like a PEM string, use it directly.
	// Otherwise treat it as a file path.
	let privateKey: string;
	if (rawKey.startsWith("-----BEGIN ")) {
		privateKey = rawKey;
	} else {
		privateKey = readFileSync(rawKey, "utf8");
	}

	cachedConfig = { appId, installationId, privateKey };
	return cachedConfig;
}

/**
 * Reset cached config (for testing).
 */
export function resetConfigCache(): void {
	cachedConfig = null;
}

/**
 * Resolve the token file path.
 * Respects PI_GITHUB_TOKEN_FILE env var, falls back to
 * ~/.config/pi/github-app-token.
 */
export function tokenFilePath(): string {
	return (
		process.env.PI_GITHUB_TOKEN_FILE ??
		join(homedir(), ".config", "pi", "github-app-token")
	);
}

// ---------------------------------------------------------------------------
// JWT generation
// ---------------------------------------------------------------------------

function base64UrlEncode(data: Buffer): string {
	return data
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Create a JWT signed with the app's private key.
 * The JWT is valid for JWT_TTL_SEC seconds (max 600 per GitHub).
 */
export function createAppJwt(privateKey: string, appId: string): string {
	const header = { alg: "RS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iat: now - 60, // 60s leeway for clock drift
		exp: now + JWT_TTL_SEC,
		iss: appId,
	};

	const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
	const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));

	const signer = createSign("RSA-SHA256");
	signer.update(`${headerB64}.${payloadB64}`);
	const signatureB64 = base64UrlEncode(signer.sign(privateKey));

	return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface InstallationTokenResult {
	token: string;
	expiresAt: string; // ISO 8601
}

/**
 * Exchange a JWT for an installation access token via the GitHub API.
 */
export async function exchangeJwtForToken(
	jwt: string,
	installationId: string,
	signal?: AbortSignal,
): Promise<InstallationTokenResult> {
	const url = `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "vt-pi-coding-agent",
		},
		signal,
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "(no body)");
		throw new Error(
			`GitHub API error ${response.status}: ${body}`,
		);
	}

	const data = (await response.json()) as {
		token: string;
		expires_at: string;
	};

	return {
		token: data.token,
		expiresAt: data.expires_at,
	};
}

// ---------------------------------------------------------------------------
// Token file I/O
// ---------------------------------------------------------------------------

/**
 * Write the installation token to the rendezvous file.
 * Creates parent directories if they don't exist.
 */
export function writeTokenFile(token: string, filePath: string): void {
	// Ensure parent directory exists with restricted permissions.
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	} catch {
		// Best-effort — ignore if it exists.
	}
	writeFileSync(filePath, token, { encoding: "utf8", mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Cached accessor
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let cachedExpiresAt: number = 0; // epoch ms

/**
 * Get a valid installation token, refreshing from GitHub if the cached
 * token is expired or close to expiry.
 *
 * Reads config from environment variables on first call. Subsequent calls
 * re-read the config (so changing env vars takes effect on next refresh).
 */
export async function getInstallationToken(
	signal?: AbortSignal,
): Promise<string> {
	const now = Date.now();

	// Return cached token if still fresh.
	if (cachedToken && cachedExpiresAt > now + TOKEN_REFRESH_BUFFER_SEC * 1000) {
		return cachedToken;
	}

	const config = readConfigFromEnv();
	const jwt = createAppJwt(config.privateKey, config.appId);
	const result = await exchangeJwtForToken(jwt, config.installationId, signal);

	cachedToken = result.token;
	cachedExpiresAt = new Date(result.expiresAt).getTime();

	return cachedToken;
}

/**
 * Refresh the installation token and write it to the rendezvous file.
 * Returns the token. Call this before any git/gh operation that needs auth.
 */
export async function refreshAndWriteToken(
	signal?: AbortSignal,
): Promise<string> {
	const token = await getInstallationToken(signal);
	const filePath = tokenFilePath();
	writeTokenFile(token, filePath);
	return token;
}
