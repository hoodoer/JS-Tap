
export async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function importKey(keyData: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    usage
  );
}

export async function encrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
  return await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
}

export async function decrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
  return await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
}
