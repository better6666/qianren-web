/** 前任本地档案加密：浏览器端 PBKDF2 + AES-GCM，不向服务端发送口令或明文档案。 */
import type { ArchiveState } from "@/lib/archive";

const ITERATIONS = 310_000;
const FORMAT = "qianren-encrypted-archive-v1";

export type EncryptedArchive = {
  format: typeof FORMAT;
  exportedAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string; ciphertext: string };
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations = ITERATIONS) {
  if (!crypto?.subtle) throw new Error("当前浏览器不支持 Web Crypto，无法创建加密备份。");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedArchive(value: unknown): value is EncryptedArchive {
  return Boolean(value && typeof value === "object" && (value as EncryptedArchive).format === FORMAT);
}

export async function encryptArchive(archive: ArchiveState, passphrase: string) {
  if (passphrase.length < 12) throw new Error("请使用至少 12 位的备份口令。");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(archive));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const envelope: EncryptedArchive = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) },
  };
  return JSON.stringify(envelope, null, 2);
}

export async function decryptArchive(envelope: EncryptedArchive, passphrase: string): Promise<ArchiveState> {
  if (!passphrase) throw new Error("请输入加密备份的口令。");
  try {
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    const key = await deriveKey(passphrase, salt, envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(envelope.cipher.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as ArchiveState;
  } catch {
    throw new Error("无法解锁备份：请确认口令与文件正确。 ");
  }
}
