// GET /auth/google/callback
export async function googleAuthCallback(req, res) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent(String(error))}`);
    }

    if (!code) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Missing authorization code')}`);
    }

    cleanupExpiredOAuthState();
    if (!state || !oauthState.has(String(state))) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Invalid OAuth state')}`);
    }
    oauthState.delete(String(state));

    const client = getOAuthClient();
    const { tokens } = await client.getToken(String(code));

    if (!tokens?.id_token) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Missing id_token from Google')}`);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;

    if (!email) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Google account has no email')}`);
    }

    const firstName = payload?.given_name || email.split('@')[0] || 'User';
    const lastName = payload?.family_name || 'Google';

    let user = await findUserByEmail(email);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashed = await bcrypt.hash(randomPassword, saltRound);
      user = await createUser({ firstName, lastName, email, password: hashed });
    }

    const token = signToken(user);

    return res.redirect(
      `${env.CLIENT_URL}/oauth/google/callback?token=${encodeURIComponent(token)}`
    );
  } catch (err) {
    console.error('Google auth callback error:', err);
    return res.redirect(
      `${env.CLIENT_URL}/auth?error=${encodeURIComponent('Google login failed')}`
    );
  }
}