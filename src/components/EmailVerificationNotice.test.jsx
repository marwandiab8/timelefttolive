import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import EmailVerificationNotice from './EmailVerificationNotice.jsx';

describe('EmailVerificationNotice', () => {
  it('tells the user which address to verify and offers both actions', () => {
    const markup = renderToStaticMarkup(
      <EmailVerificationNotice email="viewer@example.com" onVerified={vi.fn()} />
    );

    expect(markup).toContain('Verify your email');
    expect(markup).toContain('viewer@example.com');
    expect(markup).toContain('I have verified');
    expect(markup).toContain('Resend email');
  });
});
