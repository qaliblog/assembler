import { describe, expect, it } from 'vitest';
import { hasErrors, validateField, validateFields } from './validation';

describe('validateField', () => {
  it('enforces required fields', () => {
    expect(validateField('   ', { required: true })).toBe('This field is required');
    expect(validateField('value', { required: true })).toBeNull();
  });

  it('enforces length and email rules', () => {
    expect(validateField('ab', { minLength: 3 })).toContain('at least 3');
    expect(validateField('abcdef', { maxLength: 4 })).toContain('at most 4');
    expect(validateField('not-an-email', { email: true })).toBe('Enter a valid email address');
    expect(validateField('user@example.com', { email: true })).toBeNull();
  });

  it('uses a custom message when provided', () => {
    expect(validateField('', { required: true, message: 'Email is required' })).toBe('Email is required');
  });

  it('allows empty optional values', () => {
    expect(validateField('', { minLength: 3 })).toBeNull();
  });
});

describe('validateFields', () => {
  it('returns one message per invalid field', () => {
    const errors = validateFields(
      { email: 'nope', password: 'short' },
      { email: { required: true, email: true }, password: { required: true, minLength: 8 } },
    );
    expect(hasErrors(errors)).toBe(true);
    expect(Object.keys(errors).sort()).toEqual(['email', 'password']);
  });

  it('returns an empty record when everything is valid', () => {
    const errors = validateFields(
      { email: 'user@example.com', password: 'longenough' },
      { email: { required: true, email: true }, password: { required: true, minLength: 8 } },
    );
    expect(errors).toEqual({});
  });
});
