import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function assert(value, message, status = 400) {
  if (!value) throw new AppError(message, status);
}

export const digest = value => createHash('sha256').update(value).digest('hex');
export const sessionToken = () => randomBytes(32).toString('base64url');

export async function passwordHash(password) {
  assert(typeof password === 'string' && password.length >= 10 && password.length <= 200,
    'Use uma senha com 10 a 200 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [algorithm, salt, hash] = String(stored).split(':');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const result = await scrypt(password, salt, 64);
  return expected.length === result.length && timingSafeEqual(expected, result);
}

export function secretBox(keyMaterial) {
  const key = createHash('sha256').update('flowsuite-credentials-v1\0').update(keyMaterial).digest();
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
    },
    decrypt(value) {
      try {
        const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url'));
        const cipher = createDecipheriv('aes-256-gcm', key, iv);
        cipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8'));
      } catch {
        throw new AppError('Não foi possível abrir a credencial. Cadastre-a novamente no painel master.', 503);
      }
    },
  };
}

export function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function phone(value) {
  const raw = text(value, 30);
  assert(/^\+?[\d ().-]+$/.test(raw), 'Informe um telefone válido com DDI.');
  let number = raw.replace(/\D/g, '');
  if (!raw.startsWith('+') && [10, 11].includes(number.length)) number = '55' + number;
  assert(/^[1-9]\d{10,14}$/.test(number), 'Informe o telefone completo com DDI.');
  return '+' + number;
}

export function uuid(value) {
  assert(typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value),
    'Identificador inválido.');
  return value;
}
