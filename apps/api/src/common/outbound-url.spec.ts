import { checkOutboundUrl, isPrivateAddress } from './outbound-url';

describe('outbound URL rules', () => {
  it('knows the private, loopback, link-local, carrier and metadata ranges', () => {
    for (const ip of [
      '10.1.2.3',
      '172.16.0.9',
      '172.31.255.1',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '[::1]',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of [
      '8.8.8.8',
      '203.0.113.9',
      '172.32.0.1',
      '2606:4700::1111',
      '::ffff:93.184.216.34',
    ]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it('requires https, refuses credentials, internal names and literal private addresses', () => {
    expect(checkOutboundUrl('https://hooks.example.com/x')).toEqual({
      ok: true,
      hostname: 'hooks.example.com',
    });
    expect(checkOutboundUrl('http://hooks.example.com/x').ok).toBe(false);
    expect(checkOutboundUrl('https://user:pw@hooks.example.com/x').ok).toBe(
      false,
    );
    expect(checkOutboundUrl('https://10.0.0.5:8443/').ok).toBe(false);
    expect(checkOutboundUrl('https://[::1]/').ok).toBe(false);
    expect(
      checkOutboundUrl('https://169.254.169.254/latest/meta-data').ok,
    ).toBe(false);
    expect(checkOutboundUrl('https://db.internal/').ok).toBe(false);
    expect(checkOutboundUrl('https://localhost/').ok).toBe(false);
    expect(checkOutboundUrl('ftp://example.com/').ok).toBe(false);
    expect(checkOutboundUrl('not a url').ok).toBe(false);
  });

  it('allows plain http on the loopback host only when asked (development and tests)', () => {
    expect(
      checkOutboundUrl('http://localhost:4010/hook', { allowLoopback: true })
        .ok,
    ).toBe(true);
    expect(
      checkOutboundUrl('http://127.0.0.1:4010/hook', { allowLoopback: true })
        .ok,
    ).toBe(true);
    expect(checkOutboundUrl('http://localhost:4010/hook').ok).toBe(false);
    expect(
      checkOutboundUrl('http://10.0.0.5/hook', { allowLoopback: true }).ok,
    ).toBe(false);
  });
});
