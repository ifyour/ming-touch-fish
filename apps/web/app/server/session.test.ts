import { afterEach, describe, expect, it } from 'vitest';
import { getAdminLogin, isAdminLogin } from './session';

describe('admin login matching', () => {
  const original = process.env.ADMIN_GITHUB_LOGIN;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_GITHUB_LOGIN;
    else process.env.ADMIN_GITHUB_LOGIN = original;
  });

  it('defaults to ifyour when env not set', () => {
    delete process.env.ADMIN_GITHUB_LOGIN;
    expect(getAdminLogin()).toBe('ifyour');
  });

  it('uses ADMIN_GITHUB_LOGIN when provided', () => {
    process.env.ADMIN_GITHUB_LOGIN = 'someoneelse';
    expect(getAdminLogin()).toBe('someoneelse');
  });

  it('matches the configured admin login', () => {
    process.env.ADMIN_GITHUB_LOGIN = 'ifyour';
    expect(isAdminLogin('ifyour')).toBe(true);
  });

  it('rejects a different github login', () => {
    process.env.ADMIN_GITHUB_LOGIN = 'ifyour';
    expect(isAdminLogin('attacker')).toBe(false);
  });

  it('rejects missing/empty name', () => {
    expect(isAdminLogin(undefined)).toBe(false);
    expect(isAdminLogin('')).toBe(false);
  });

  it('honors a custom admin login override', () => {
    process.env.ADMIN_GITHUB_LOGIN = 'boss';
    expect(isAdminLogin('boss')).toBe(true);
    expect(isAdminLogin('ifyour')).toBe(false);
  });
});
