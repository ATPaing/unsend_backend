/**
 * Server-side journal limits.
 * Keep aligned with frontend/src/utils/journal/constants.js.
 */
export const MAX_ENCRYPTED_JOURNAL_CONTENT_BYTES = 500 * 1024;
export const MAX_ENCRYPTED_JOURNAL_TITLE_BYTES = 2 * 1024;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_JOURNAL_IMAGES = 1;
export const AES_GCM_TAG_LENGTH = 16;
export const AES_GCM_NONCE_LENGTH = 12;
/** RSA-OAEP 2048 wraps a 32-byte AES key; ciphertext is 256 bytes. */
export const OWNER_WRAPPED_AES_KEY_BYTES = 256;
export const JSON_BODY_LIMIT = '2mb';
