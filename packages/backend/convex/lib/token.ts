/** Hashing for device tokens. Plaintext is shown once; only the hash is stored. */
export async function sha256Hex(s: string): Promise<string> {
	const data = new TextEncoder().encode(s);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Identifiers like ENG-123 referenced in commit messages / branch names. */
export function extractIdentifiers(text: string): string[] {
	const matches = text.match(/\b[A-Z][A-Z0-9]{0,9}-\d+\b/g) ?? [];
	return [...new Set(matches)];
}

/** Whether a commit message asks to close a given identifier. */
export function closesIdentifier(message: string, identifier: string): boolean {
	const re = new RegExp(
		`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b[^\\n]*?\\b${identifier}\\b`,
		"i",
	);
	return re.test(message);
}
