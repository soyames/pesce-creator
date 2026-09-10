# Produit — Pesce Studio

## Proposition

Pesce Studio est l’espace Telegram de Pesce Hounyo pour informer, publier du contenu, créer une relation directe avec sa communauté et recevoir son soutien.

## Public

- Audience actuelle de Pesce sur WhatsApp et les réseaux sociaux.
- Lecteurs et abonnés intéressés par ses publications, analyses et prises de parole.
- Public béninois et diaspora francophone.

## Première version

### Espace public (l’expérience par défaut)

- Identité de Pesce (portrait, bio, accueil à son image)
- Derniers articles, vidéos et audios dès l’accueil
- Publications (articles et posts du canal)
- Vidéos (chaîne YouTube + vidéos publiées sur le canal)
- Audios
- Photos
- Communauté (canal Telegram)
- Soutenir Pesce ⭐ (Étoiles Telegram)
- Support (formulaire + bot `@PesceStudioBot`)
- À propos

### Espace créatrice (studio masqué)

Le studio est **invisible pour le public** : aucune affordance, aucun bouton, aucun chargement du code studio pour un visiteur. Il s’ouvre uniquement pour la créatrice (bouton discret + lien profond `?startapp=studio` + commande privée `/studio` du bot).

- Composer (publication texte ou article Telegraph)
- Brouillons (enregistrer, reprendre)
- Publication directe sur le canal avec bouton ⭐ Soutenir
- Backfill du bouton de soutien sur les posts existants
- Indicateurs (contenus, vidéos, photos, audios, Étoiles)
- Demandes de support (répondre, résoudre)
- Derniers paiements
- Configuration Telegraph

**Règles produit**

1. L’application publique s’ouvre toujours normalement — y compris pour Pesce elle-même — même sans identifiant créatrice configuré ; le studio est alors simplement masqué.
2. Le public ne découvre jamais l’existence du studio : pas de popup « privé », pas de lien mort.
3. L’audience d’abord : toute évolution de l’espace public prime sur l’espace créatrice.
4. Toute l’expérience reste en français.
5. L’autorisation est toujours vérifiée côté serveur (`/api/studio`) ; le masquage côté client est une question d’UX, pas de sécurité.

## Monétisation initiale

Le premier objectif est volontairement simple : permettre à l’audience de soutenir Pesce avec les Étoiles Telegram.

Nous ne construisons pas de portefeuille, de passerelle de paiement ou de système de retrait personnalisé. Le projet utilise les mécanismes natifs de Telegram.

Avant de considérer les Étoiles comme une source de revenu fiable, il faudra tester le parcours complet pour Pesce : réception des Étoiles, éligibilité au retrait, retrait via le mécanisme Telegram/Fragment et accessibilité de la valeur au Bénin.

## Rôle de l’IA

L’IA peut aider à :

- transformer une note vocale en brouillon ;
- améliorer la clarté d’un texte ;
- proposer un titre ;
- produire un résumé ;
- adapter une publication pour différents formats ;
- préparer une description YouTube ;
- proposer des idées de contenu.

Pesce conserve toujours la validation finale avant publication.

## WhatsApp

WhatsApp reste son canal d’audience existant. Le projet ne cherche pas à le remplacer immédiatement.

La stratégie de lancement pourra utiliser WhatsApp pour inviter progressivement son audience à rejoindre son espace Telegram.
