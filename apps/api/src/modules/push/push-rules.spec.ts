import {
  base64url,
  fcmMessage,
  isDeadTokenError,
  isStaleDevice,
  jwtClaims,
  normalizeToken,
  serviceAccountFrom,
  shouldPush,
} from './push-rules';

describe('push rules', () => {
  it('switches off devices that have not checked in for ninety days', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    expect(isStaleDevice(new Date('2026-09-01T00:00:00Z'), now)).toBe(false);
    expect(isStaleDevice(new Date('2026-07-01T00:00:00Z'), now)).toBe(true);
  });

  it('accepts plausible tokens only', () => {
    expect(normalizeToken('  abcdefghijklmnopqrstuvwxyz0123456789  ')).toBe(
      'abcdefghijklmnopqrstuvwxyz0123456789',
    );
    expect(normalizeToken('short')).toBeNull();
    expect(
      normalizeToken('has a space in the middle of the token value'),
    ).toBeNull();
  });

  it('pushes only what the user left on in app and on push, unless forced', () => {
    expect(shouldPush(null)).toBe(true);
    expect(shouldPush({ inApp: true, push: true })).toBe(true);
    expect(shouldPush({ inApp: true, push: false })).toBe(false);
    expect(shouldPush({ inApp: false, push: true })).toBe(false);
    expect(shouldPush({ inApp: false, push: false }, true)).toBe(true);
  });

  it('shapes a Firebase message with a deep link into the web app', () => {
    const m = fcmMessage(
      'tok',
      {
        title: 'Grade posted',
        body: 'Essay: 92%',
        link: '/grades',
        category: 'grade',
        notificationId: 'n1',
      },
      'https://school.example/',
    );
    expect(m).toMatchObject({
      token: 'tok',
      notification: { title: 'Grade posted', body: 'Essay: 92%' },
      data: {
        link: 'https://school.example/grades',
        category: 'grade',
        notificationId: 'n1',
      },
      android: { notification: { channel_id: 'grade' } },
      webpush: { fcm_options: { link: 'https://school.example/grades' } },
    });
    expect(
      fcmMessage('tok', { title: 'Hi' }, 'https://x').notification,
    ).toEqual({ title: 'Hi' });
  });

  it('reads a service account and builds the token claims', () => {
    expect(serviceAccountFrom('')).toBeNull();
    expect(serviceAccountFrom('{"project_id":"p"}')).toBeNull();
    expect(serviceAccountFrom('not json')).toBeNull();
    const sa = serviceAccountFrom(
      '{"project_id":"demo","client_email":"a@b.iam","private_key":"-----BEGIN\\nKEY\\n-----END"}',
    );
    expect(sa).toEqual({
      projectId: 'demo',
      clientEmail: 'a@b.iam',
      privateKey: '-----BEGIN\nKEY\n-----END',
    });
    expect(jwtClaims(sa!, 1000)).toMatchObject({
      iss: 'a@b.iam',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
    expect(isDeadTokenError('UNREGISTERED')).toBe(true);
    expect(isDeadTokenError('UNAVAILABLE')).toBe(false);
    expect(base64url('hello??')).toBe('aGVsbG8_Pw');
  });
});
