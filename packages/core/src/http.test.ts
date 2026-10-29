import { describe, expect, it } from 'vitest';
import { HttpClient, assertPublicUrl } from './http.js';

describe('assertPublicUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(assertPublicUrl('https://react.dev/reference/react').hostname).toBe('react.dev');
    expect(assertPublicUrl('http://example.com/a').protocol).toBe('http:');
  });

  it('rejects non-http protocols', () => {
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow(/protocol/i);
    expect(() => assertPublicUrl('ftp://example.com')).toThrow(/protocol/i);
  });

  it('rejects loopback and private-network destinations', () => {
    for (const url of [
      'http://localhost:8080/',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.20.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://printer.local/',
    ]) {
      expect(() => assertPublicUrl(url)).toThrow(/private|loopback/i);
    }
  });

  it('allows private destinations only when explicitly authorised', () => {
    expect(assertPublicUrl('http://127.0.0.1:3000/api', true).hostname).toBe('127.0.0.1');
  });
});

describe('HttpClient offline behaviour', () => {
  it('fails with a capability error when the network is disabled', async () => {
    const client = new HttpClient({ enabled: false });
    await expect(client.get('https://example.com')).rejects.toMatchObject({
      code: 'CAPABILITY_UNSATISFIED',
    });
  });
});
