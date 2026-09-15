// Authentification du Studio créatrice WEB (/studio) : mot de passe OU Google Sign-In, puis
// UNE SEULE session serveur (lib/web-session.js) — aucun système d'authentification parallèle.
//   GET  /api/studio-auth?action=config  → identifiant OAuth public (bouton Google) ou null,
//            et si la connexion par mot de passe est configurée (booléen — jamais l'empreinte)
//   GET  /api/studio-auth?action=session → 200 { authenticated, email } ou 401
//   POST /api/studio-auth { action: 'login', credential } → vérifie le jeton Google (signature +
//            audience), autorise UNIQUEMENT les adresses de PESCE_WEB_ADMIN_EMAILS, puis pose le
//            cookie de session HttpOnly/Secure/SameSite
//   POST /api/studio-auth { action: 'password_login', email, password } → vérifie l'adresse
//            (liste d'autorisation) ET le mot de passe (scrypt, PESCE_STUDIO_PASSWORD_HASH),
//            avec limitation des tentatives ; pose exactement le même cookie de session
//   POST /api/studio-auth { action: 'logout' } → détruit la session et efface le cookie
// Une seule route (pas de sous-chemins) : le routeur de fichiers Vercel ne mappe que le chemin exact.
// Variables d'environnement requises (noms uniquement, jamais leurs valeurs) :
//   GOOGLE_OAUTH_CLIENT_ID       — identifiant public du client OAuth Web Google (audience du jeton)
//   PESCE_WEB_ADMIN_EMAILS       — liste d'adresses autorisées (défaut : l'administrateur du Studio)
//   PESCE_STUDIO_PASSWORD_HASH   — empreinte scrypt du mot de passe (jamais le mot de passe)
// Le secret client OAuth n'est PAS utilisé par ce flux (jeton d'identité, vérification JWKS).
import { isWebAdminEmail, verifyGoogleIdToken } from '../lib/google-auth.js';
import { clearLoginFailures, isPasswordLoginConfigured, LOGIN_MAX_FAILURES, loginFailureCount, loginScope, normalizeEmail, recordLoginFailure, studioPasswordHash, verifyPassword } from '../lib/password-auth.js';
import { clearSessionCookieHeader, createWebSession, destroyWebSession, sessionCookieHeader, webSessionEmailFromRequest } from '../lib/web-session.js';

// Message unique de refus : ne révèle jamais laquelle des deux entrées est fausse, ni si
// l'adresse existe. Toute divergence de formulation serait un oracle d'énumération.
const GENERIC_REFUSAL = 'Adresse ou mot de passe incorrect.';

// Politique de connexion par mot de passe, séparée de la plomberie HTTP et de la base : c'est
// ELLE qui décide, et elle est vérifiable de bout en bout (dépendances injectables pour les tests).
// L'adresse ET le mot de passe sont toujours évalués tous les deux — même pour une adresse non
// autorisée, la dérivation scrypt est effectuée : la durée de réponse ne trahit pas l'allowlist.
export async function passwordLoginDecision(
  { email, password, encoded },
  { authorize = isWebAdminEmail, verify = verifyPassword, failures = 0, maxFailures = LOGIN_MAX_FAILURES } = {}
) {
  if (!encoded) return { status: 503, message: 'La connexion par mot de passe n’est pas encore configurée sur ce Studio.' };
  if (!email || !password) return { status: 400, message: GENERIC_REFUSAL };
  if (failures >= maxFailures) return { status: 429, message: 'Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.' };
  const authorized = authorize(email);
  const valid = await verify(password, encoded);
  if (!authorized || !valid) return { status: 401, message: GENERIC_REFUSAL, recordFailure: true };
  return { status: 200, email };
}

function secureFlag() {
  // Cookie Secure en production (HTTPS). En développement local (http), le drapeau est omis.
  return process.env.NODE_ENV === 'production';
}

function actionOf(req) {
  if (typeof req.query?.action === 'string') return req.query.action;
  if (req.body && typeof req.body.action === 'string') return req.body.action;
  return '';
}

function bodyOf(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

export default async function handler(req, res) {
  try {
    const action = actionOf(req);

    if (req.method === 'GET' && action === 'config') {
      // `passwordLogin` est un simple indicateur de disponibilité : l'empreinte, ses paramètres
      // et le mot de passe ne quittent JAMAIS le serveur.
      return res.status(200).json({
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null,
        passwordLogin: isPasswordLoginConfigured(),
      });
    }

    if (req.method === 'GET' && action === 'session') {
      const email = await webSessionEmailFromRequest(req);
      if (!email) return res.status(401).json({ authenticated: false, message: 'Session absente ou expirée.' });
      return res.status(200).json({ authenticated: true, email });
    }

    if (req.method === 'POST' && action === 'logout') {
      // Le cookie est effacé quoi qu'il arrive ; la suppression de la ligne peut échouer sans bloquer.
      await destroyWebSession(req).catch((error) => console.error('web session destroy failed', error));
      res.setHeader('Set-Cookie', clearSessionCookieHeader(secureFlag()));
      return res.status(200).json({ ok: true });
    }

    // — Connexion par mot de passe : adresse autorisée ET empreinte scrypt vérifiée côté serveur.
    // L'ordre est volontaire : la limitation des tentatives précède toute dérivation coûteuse,
    // et le mot de passe est TOUJOURS vérifié (même pour une adresse non autorisée) afin que la
    // durée de réponse ne révèle pas l'existence de l'adresse.
    if (req.method === 'POST' && action === 'password_login') {
      const encoded = isPasswordLoginConfigured() ? studioPasswordHash() : '';
      const body = bodyOf(req);
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';
      const scope = loginScope(req);

      // Le décompte des tentatives n'est consulté que si la requête est structurellement
      // recevable. Fail-closed : si la base est indisponible, l'exception remonte et la
      // connexion échoue de la même façon pour toute saisie — jamais d'ouverture par défaut,
      // et aucun écart de réponse ne révèle si le mot de passe était bon.
      const failures = encoded && email && password ? await loginFailureCount(scope) : 0;
      const decision = await passwordLoginDecision({ email, password, encoded }, { failures });
      if (decision.recordFailure) {
        await recordLoginFailure(scope).catch((error) => console.error('login attempt record failed', error.message));
      }
      if (decision.status !== 200) return res.status(decision.status).json({ message: decision.message });

      const { token } = await createWebSession(decision.email);
      await clearLoginFailures(scope).catch((error) => console.error('login attempt reset failed', error.message));
      res.setHeader('Set-Cookie', sessionCookieHeader(token, { secure: secureFlag() }));
      return res.status(200).json({ ok: true, email: decision.email });
    }

    if (req.method === 'POST' && action === 'login') {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: 'Connexion Google non configurée : GOOGLE_OAUTH_CLIENT_ID est requis.' });
      const body = bodyOf(req);
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

    if (req.method === 'GET' || req.method === 'POST') {
      return res.status(400).json({ message: 'Action d’authentification inconnue.' });
    }
    return res.status(405).json({ message: 'Méthode non autorisée.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Authentification indisponible.' });
  }
}
