import type { AppConfigService } from '../../config/app-config.service';
import { CaptchaService } from './captcha.service';

function configWith(secret: string, minScore = 0.5): AppConfigService {
  return {
    get: (key: string) =>
      key === 'RECAPTCHA_SECRET_KEY'
        ? secret
        : key === 'RECAPTCHA_MIN_SCORE'
          ? minScore
          : undefined,
    providers: { recaptcha: secret !== '' },
  } as unknown as AppConfigService;
}

const respond = (body: unknown) =>
  jest.fn().mockResolvedValue({
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;

describe('CaptchaService', () => {
  it('skips verification when not configured', async () => {
    const svc = new CaptchaService(configWith(''), respond({ success: false }));
    await expect(
      svc.assertHuman(undefined, null, 'register'),
    ).resolves.toBeUndefined();
  });

  it('requires a token and accepts a good score for the right action', async () => {
    const svc = new CaptchaService(
      configWith('secret'),
      respond({ success: true, score: 0.9, action: 'register' }),
    );
    await expect(
      svc.assertHuman(undefined, null, 'register'),
    ).rejects.toMatchObject({ response: { code: 'auth.captcha_required' } });
    await expect(
      svc.assertHuman('tok', '1.2.3.4', 'register'),
    ).resolves.toBeUndefined();
  });

  it('rejects low scores, wrong actions and failed verifications', async () => {
    await expect(
      new CaptchaService(
        configWith('s'),
        respond({ success: true, score: 0.1, action: 'register' }),
      ).assertHuman('t', null, 'register'),
    ).rejects.toMatchObject({ response: { code: 'auth.captcha_failed' } });
    await expect(
      new CaptchaService(
        configWith('s'),
        respond({ success: true, score: 0.9, action: 'login' }),
      ).assertHuman('t', null, 'register'),
    ).rejects.toMatchObject({ response: { code: 'auth.captcha_failed' } });
    await expect(
      new CaptchaService(
        configWith('s'),
        respond({ success: false }),
      ).assertHuman('t', null, 'register'),
    ).rejects.toMatchObject({ response: { code: 'auth.captcha_failed' } });
  });

  it('reports an unavailable verifier without accepting the request', async () => {
    const failing = jest
      .fn()
      .mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    await expect(
      new CaptchaService(configWith('s'), failing).assertHuman(
        't',
        null,
        'register',
      ),
    ).rejects.toMatchObject({ response: { code: 'auth.captcha_unavailable' } });
  });
});
