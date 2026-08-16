const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_PATTERN = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}={0,2}|[A-Za-z0-9_-]{3}={0,1})?$/;

export function isValidBase64(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  return BASE64_PATTERN.test(value) || BASE64URL_PATTERN.test(value);
}

export function decodeBase64(value) {
  if (!isValidBase64(value)) {
    throw new Error('Invalid Base64 value');
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(normalized + padding, 'base64');
}

export function encodeBase64(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error('Value must be a Buffer or Uint8Array');
  }

  return Buffer.from(value).toString('base64');
}
