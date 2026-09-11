// Authentification du Studio créatrice WEB (/studio) : Google Sign-In + session serveur.
//   GET  /api/studio-auth/config  → identifiant OAuth public (pour le bouton Google) ou null
//   GET  /api/studio-auth/session → 200 { authenticated, email } ou 401
//   POST /api/studio-auth/login   → { credential } : vérifie le jeton Google (signature + audience),
//                                    autorise UNIQUEMENT les adresses de PESCE_WEB_ADMIN_EMAILS,
//                                    puis pose le cookie de session HttpOnly/Secure/SameSite
//   POST /api/studio-auth/logout  → détruit la session et efface le cookie
// Variables d'environnement requises (noms uniquement, jamais leurs valeurs) :
//   GOOGLE_OAUTH_CLIENT_ID  — identifiant public du client OAuth Web Google (audience du jeton)
//   PESCE_WEB_ADMIN_EMAILS  — liste d'adresses autorisées (défaut : pescestudio8@gmail.com)
// Le secret client OAuth n'est PAS utilisé par ce flux (jeton d'identité, vérification JWKS).
import { isWebAdminEmail, verifyGoogleIdToken } from '../lib/google-auth.js';
import { clearSessionCookieHeader, createWebSession, destroyWebSession, sessionCookieHeader, webSessionEmailFromRequest } from '../lib/web-session.js';

function secureFlag() {
  // Cookie Secure en production (HTTPS). En développement local (http), le drapeau est omis.
  return process.env.NODE_ENV === 'production';
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.url?.includes('/config')) {
      return res.status(200).json({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null });
    }

    if (req.method === 'GET') {
      const email = await webSessionEmailFromRequest(req);
      if (!email) return res.status(401).json({ authenticated: false, message: 'Session absente ou expirée.' });
      return res.status(200).json({ authenticated: true, email });
    }

    if (req.method === 'POST' && req.url?.includes('/logout')) {
      // Le cookie est effacé quoi qu'il arrive ; la suppression de la ligne peut échouer sans bloquer.
      await destroyWebSession(req).catch((error) => console.error('web session destroy failed', error));
      res.setHeader('Set-Cookie', clearSessionCookieHeader(secureFlag()));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: 'Connexion Google non configurée : GOOGLE_OAUTH_CLIENT_ID est requis.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const credential = typeof body.credential === 'string' ? body.credential : '';
      if (!credential) return res.status(400).json({ message: 'Jeton Google manquant.' });

      const email = await verifyGoogleIdToken(credential, { clientId });
      if (!email) return res.status(401).json({ message: 'Jeton Google invalide ou expiré.' });
      if (!isWebAdminEmail(email)) {
        return res.status(403).json({ message: 'Ce compte Google n’est pas autorisé à accéder au Studio.' });
      }

      const { token } = await createWebSession(email);
      res.setHeader('Set-Cookie', sessionCookieHeader(token, { secure: secureFlag() }));
      return res.status(200).json({ ok: true, email });
    }

    return res.status(405).json({ message: 'Méthode non autorisée.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Authentification indisponible.' });
  }
}
