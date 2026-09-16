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

// Derives a 256-bit AES-GCM CryptoKey from a human-readable short code (e.g. NX-48291)
export async function deriveKeyFromShortCode(shortCode: string): Promise<CryptoKey> {
	const normalized = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
	const encoder = new TextEncoder();
	const keyMaterial = await window.crypto.subtle.digest(
		"SHA-256",
		encoder.encode(`nexsync-key-v1-${normalized}`) as unknown as BufferSource,
	);
	return window.crypto.subtle.importKey(
		"raw",
		keyMaterial,
		{ name: "AES-GCM" },
		true,
		["encrypt", "decrypt"],
	);
}

// Deterministic topic room hash for signaling rendezvous
export async function hashShortCodeToRoom(shortCode: string): Promise<string> {
	const normalized = shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
	const encoder = new TextEncoder();
	const hashBuffer = await window.crypto.subtle.digest(
		"SHA-256",
		encoder.encode(`nexsync-room-v1-${normalized}`) as unknown as BufferSource,
	);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 20);
}

