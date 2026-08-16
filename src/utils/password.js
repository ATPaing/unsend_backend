import { hash, verify, Algorithm } from '@node-rs/argon2';

export async function hashPassword(password) {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
  });
}

export async function verifyPassword(password, storedHash) {
  return verify(storedHash, password);
}
