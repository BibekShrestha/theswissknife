import { describe, expect, it } from 'vitest'
import { matchesHostname, normalizeHost } from './x509'

describe('SSL hostname validation', () => {
  it('normalizes URLs, ports, case, and trailing dots', () => {
    expect(normalizeHost('HTTPS://WWW.Example.com:8443/a')).toBe('www.example.com')
    expect(normalizeHost('api.example.com:443')).toBe('api.example.com')
    expect(normalizeHost('example.com.')).toBe('example.com')
    expect(normalizeHost('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeHost('[2001:db8::1]:443')).toBe('2001:db8::1')
  })

  it('matches exact DNS names and one-label wildcards', () => {
    expect(matchesHostname('example.com', ['example.com'])).toBe(true)
    expect(matchesHostname('api.example.com', ['*.example.com'])).toBe(true)
    expect(matchesHostname('deep.api.example.com', ['*.example.com'])).toBe(false)
    expect(matchesHostname('example.com', ['*.example.com'])).toBe(false)
  })

  it('does not apply DNS wildcards to IP addresses', () => {
    expect(matchesHostname('192.0.2.1', ['192.0.2.1'], ['192.0.2.1'])).toBe(true)
    expect(matchesHostname('192.0.2.2', ['*.0.2.2'], ['192.0.2.1'])).toBe(false)
    expect(matchesHostname('dead.beef', ['dead.beef'])).toBe(true)
    expect(matchesHostname('2001:db8::1', [], ['2001:db8::1'])).toBe(true)
  })
})
