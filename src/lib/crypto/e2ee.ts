// WebCrypto E2EE Utilities using native browser SubtleCrypto (AES-256-GCM)
// Hardware-accelerated, zero-dependency, and byte-for-byte compatible with RustCrypto aes-gcm

// Convert Uint8Array to Base64 (URL-safe without padding for easy sharing in invite links)
export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	const len = bytes.byteLength;
	const chunkSize = 0x8000;
	for (let i = 0; i < len; i += chunkSize) {
		const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// Convert Base64 (or URL-safe Base64) to Uint8Array
export function base64UrlToBytes(base64url: string): Uint8Array {
	let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	while (base64.length % 4 !== 0) {
		base64 += "=";
	}
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// Generate a random 256-bit AES-GCM CryptoKey
export async function generateE2eeKey(): Promise<CryptoKey> {
	return window.crypto.subtle.generateKey(
		{
			name: "AES-GCM",
			length: 256,
		},
		true, // exportable
		["encrypt", "decrypt"],
	);
}

// Export a CryptoKey to raw 32-byte Uint8Array
export async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
	const rawBuffer = await window.crypto.subtle.exportKey("raw", key);
	return new Uint8Array(rawBuffer);
}

// Import a raw 32-byte Uint8Array as an AES-GCM CryptoKey
export async function importRawKey(rawKey: Uint8Array): Promise<CryptoKey> {
	return window.crypto.subtle.importKey(
		"raw",
		rawKey as unknown as BufferSource,
		{
			name: "AES-GCM",
		},
		true,
		["encrypt", "decrypt"],
	);
}

// Encrypt payload (Uint8Array or string) using AES-256-GCM with a random 12-byte IV.
// Output format: `iv (12 bytes) || ciphertext + tag (16 bytes)`
export async function encryptPayload(
	data: Uint8Array | string,
	key: CryptoKey,
): Promise<Uint8Array> {
	const iv = window.crypto.getRandomValues(new Uint8Array(12));
	const dataBuffer =
		typeof data === "string" ? new TextEncoder().encode(data) : data;

	const ciphertextBuffer = await window.crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: iv as unknown as BufferSource,
		},
		key,
		dataBuffer as unknown as BufferSource,
	);

	const ciphertext = new Uint8Array(ciphertextBuffer);
	const result = new Uint8Array(iv.length + ciphertext.length);
	result.set(iv, 0);
	result.set(ciphertext, iv.length);
	return result;
}

// Decrypt encrypted payload formatted as `iv (12 bytes) || ciphertext + tag (16 bytes)`.
export async function decryptPayload(
	encryptedData: Uint8Array,
	key: CryptoKey,
): Promise<Uint8Array> {
	if (encryptedData.byteLength < 12 + 16) {
		throw new Error("Encrypted payload too short (minimum 28 bytes required).");
	}

	const iv = encryptedData.subarray(0, 12);
	const ciphertext = encryptedData.subarray(12);

	const decryptedBuffer = await window.crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: iv as unknown as BufferSource,
		},
		key,
		ciphertext as unknown as BufferSource,
	);

	return new Uint8Array(decryptedBuffer);
}

// Decrypt helper returning a UTF-8 string
export async function decryptPayloadToString(
	encryptedData: Uint8Array,
	key: CryptoKey,
): Promise<string> {
	const decryptedBytes = await decryptPayload(encryptedData, key);
	return new TextDecoder().decode(decryptedBytes);
}

// ────────────────────────────
// Short-Code Derivation (v2)
// ────────────────────────────
// IMPORTANT: The short code is NEVER used directly as the transport encryption
// key anymore. Doing so meant that anyone who guessed or brute-forced the code
// (a 9,000-value space in the old scheme) could decrypt an entire session
// offline with no interaction. Now the code only does two things:
//   1. Deterministically derives the PeerJS rendezvous ID, so a guest can dial
//      the host without out-of-band signaling.
//   2. Derives a one-time HMAC "auth key" used ONLY to prove, during the live
//      handshake, that both sides know the code. It never touches payload data.
// The actual AES-256-GCM session key is a fresh ECDH-derived, forward-secret
// key established during that same handshake (see P2PPeerConnection).

function normalizeShortCode(shortCode: string): string {
	return shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Deterministic (but not guessable-in-bulk) PeerJS ID so a guest can dial the
// host directly. Domain-separated from the auth key below so leaking one
// derived value never reveals the other.
export async function deriveHostRendezvousId(shortCode: string): Promise<string> {
	const normalized = normalizeShortCode(shortCode);
	const encoder = new TextEncoder();
	const hashBuffer = await window.crypto.subtle.digest(
		"SHA-256",
		encoder.encode(`nexsync-peerid-v2-${normalized}`) as unknown as BufferSource,
	);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return "nx-" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// HMAC-SHA256 key used solely to authenticate the handshake ("do both sides
// know the code?"). Never used to encrypt or decrypt application data.
export async function deriveCodeAuthKey(shortCode: string): Promise<CryptoKey> {
	const normalized = normalizeShortCode(shortCode);
	const encoder = new TextEncoder();
	const keyMaterial = await window.crypto.subtle.digest(
		"SHA-256",
		encoder.encode(`nexsync-auth-v2-${normalized}`) as unknown as BufferSource,
	);
	return window.crypto.subtle.importKey(
		"raw",
		keyMaterial,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

// Signs `data` with the code-derived auth key; used in the handshake HELLO.
export async function signWithAuthKey(authKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const sig = await window.crypto.subtle.sign("HMAC", authKey, data as unknown as BufferSource);
	return new Uint8Array(sig);
}

// Verifies a handshake HELLO signature against the code-derived auth key.
export async function verifyWithAuthKey(
	authKey: CryptoKey,
	data: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	return window.crypto.subtle.verify(
		"HMAC",
		authKey,
		signature as unknown as BufferSource,
		data as unknown as BufferSource,
	);
}

// Alphabet with visually ambiguous characters (0/O, 1/I/L) removed, so codes
// read cleanly out loud or off a screen. 32^8 ≈ 1.1 * 10^12 combinations —
// large enough that pre-registering guesses against the public PeerJS broker
// ahead of a real host picking that ID is not practically feasible.
const SHORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Generates a new high-entropy, human-shareable short code (e.g. NX-7F3K-9QRT)
export function generateShortCode(): string {
	const bytes = window.crypto.getRandomValues(new Uint8Array(8));
	let chars = "";
	for (const b of bytes) {
		chars += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
	}
	return `NX-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

// ────────────────────────────
// HKDF: turns raw ECDH shared-secret bytes into a session key
// ────────────────────────────

// Derives an AES-256-GCM CryptoKey from raw key material (e.g. X25519 ECDH
// output) using HKDF-SHA256. `info` domain-separates keys derived from the
// same shared secret for different purposes; `salt` should mix in per-session
// randomness (e.g. both peers' handshake nonces) so every session gets a
// distinct key even if the same two devices reconnect.
export async function hkdfDeriveAesKey(
	rawKeyMaterial: Uint8Array,
	salt: Uint8Array,
	info: string,
): Promise<CryptoKey> {
	const ikm = await window.crypto.subtle.importKey(
		"raw",
		rawKeyMaterial as unknown as BufferSource,
		"HKDF",
		false,
		["deriveKey"],
	);

	return window.crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: salt as unknown as BufferSource,
			info: new TextEncoder().encode(info) as unknown as BufferSource,
		},
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

