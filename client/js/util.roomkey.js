// Room secret derivation shared by the client
// 客户端共用的房间密钥派生
//
// 唯一的秘密来自分享链接本身，服务器任何时刻都看不到它：链接里的片段不会随
// 请求发出。房间标识由秘密经 PBKDF2 派生后交给服务器路由，掩码用另一个盐派生
// 且只留在本地，两者不能是同一个值。

import {
	hmac
} from 'js-sha256';

// 默认生成的房间码长度。用户有时发不了链接，只能口头或手动报码，因此取 6 位
// （约 30 位熵）；抗服务器枚举由部署侧的访问控制兜底，而不是靠码长。
export const SECRET_LENGTH = 6;
// 规整时保留的上限：代码继续接受更长的码，只是不再默认生成那么长。
export const SECRET_MAX_LENGTH = 26;
export const SECRET_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

// 派生迭代次数。房间标识与掩码必须用同一个次数，改动会让新旧客户端
// 派生出不同的房间标识，从而互相找不到房间。
export const PBKDF2_ITERATIONS = 100000;

// 两个用途各用一个固定盐。房间标识会明文送给服务器，掩码必须留在本地：
// 若共用一个盐，服务器拿到房间标识就等于拿到掩码。
const ROOM_ID_SALT = 'nodecrypt:room-id:v1';
const PEER_MASK_SALT = 'nodecrypt:peer-mask:v1';

// 会话密钥派生的盐与上下文串，双方一致即可，本身不是秘密。
const PEER_SESSION_SALT = 'nodecrypt:peer-session:v1';
const PEER_SESSION_INFO = 'nodecrypt:peer-key:v1';

const textEncoder = new TextEncoder();

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (typeof value === 'string') return textEncoder.encode(value);
	return new Uint8Array(value);
}

function fromHex(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes;
}

function toHex(bytes) {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, '0');
	}
	return hex;
}

// Generate a new room secret, using a cryptographically secure random source
// 用加密安全的随机源生成新的房间密钥
export function generateRoomSecret() {
	const bytes = new Uint8Array(SECRET_LENGTH);
	crypto.getRandomValues(bytes);
	let secret = '';
	for (let i = 0; i < bytes.length; i++) {
		// 字符集长度是 32，256 % 32 === 0，取模不会引入偏斜
		secret += SECRET_ALPHABET.charAt(bytes[i] % SECRET_ALPHABET.length);
	}
	return secret;
}

// Clean up a secret coming from the link fragment or from user input
// 规整来自链接片段或用户输入的秘密
// 字符集保留 [a-z0-9]：Crockford 字符集是它的子集，手动输入带 i、l、o、u 的码
// 不会被改坏，代价只是这些字符不会被默认生成。
export function normalizeRoomSecret(value) {
	return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, SECRET_MAX_LENGTH);
}

// PBKDF2-SHA256, available in both browsers and Node
// PBKDF2-SHA256，浏览器与 Node 都支持
export async function pbkdf2Bytes(secret, salt, iterations = PBKDF2_ITERATIONS) {
	const subtle = globalThis.crypto && globalThis.crypto.subtle;
	if (!subtle) {
		throw new Error('WebCrypto is unavailable, refusing to fall back to a weaker derivation');
	}
	const key = await subtle.importKey('raw', textEncoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
	const bits = await subtle.deriveBits({
		name: 'PBKDF2',
		salt: textEncoder.encode(salt),
		iterations: iterations,
		hash: 'SHA-256'
	}, key, 256);
	return new Uint8Array(bits);
}

// Room identifier: handed to the server so it can route messages
// 房间标识：交给服务器用于路由
export async function deriveRoomId(secret, iterations = PBKDF2_ITERATIONS) {
	return toHex(await pbkdf2Bytes(normalizeRoomSecret(secret), ROOM_ID_SALT, iterations));
}

// Peer key mask: stays on this device, never sent anywhere
// 对端密钥掩码：只留在本机，不发给任何一方
export async function derivePeerMask(secret, iterations = PBKDF2_ITERATIONS) {
	return await pbkdf2Bytes(normalizeRoomSecret(secret), PEER_MASK_SALT, iterations);
}

// HKDF-SHA256 (RFC 5869), implemented on js-sha256 so it stays synchronous
// HKDF-SHA256（RFC 5869），基于 js-sha256 实现，因此保持同步
export function hkdfSha256(ikm, salt, info, length) {
	const prk = fromHex(hmac(toBytes(salt), toBytes(ikm)));
	const infoBytes = toBytes(info);
	const out = new Uint8Array(length);
	let previous = new Uint8Array(0);
	let offset = 0;
	let counter = 1;
	while (offset < length) {
		const block = new Uint8Array(previous.length + infoBytes.length + 1);
		block.set(previous, 0);
		block.set(infoBytes, previous.length);
		block[block.length - 1] = counter;
		previous = fromHex(hmac(prk, block));
		const take = Math.min(previous.length, length - offset);
		out.set(previous.subarray(0, take), offset);
		offset += take;
		counter++;
	}
	return out;
}

// Final peer session key: the ECDH result alone is not enough, because whoever
// relays the public keys could substitute them and learn the ECDH result. The
// secret-derived mask is mixed in through HKDF, so a relay cannot compute it.
// 最终的对端会话密钥：只有 ECDH 结果是不够的，转发公钥的一方替换公钥后就能
// 拿到 ECDH 结果；这里用 HKDF 把只存在于链接里的掩码混进去，中转端算不出来。
export function derivePeerSessionKey(ecdhShared, mask) {
	const ecdh = toBytes(ecdhShared);
	const maskBytes = toBytes(mask);
	const ikm = new Uint8Array(ecdh.length + maskBytes.length);
	ikm.set(ecdh, 0);
	ikm.set(maskBytes, ecdh.length);
	return hkdfSha256(ikm, PEER_SESSION_SALT, PEER_SESSION_INFO, 32);
}