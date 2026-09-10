# Architecture — Pesce Studio

## Vue d’ensemble

```text
Pesce
  │
  ▼
@PesceStudioBot
  │
  ├── Mini App publique
  │
  └── Studio créatrice
          │
          ▼
   Telegram Serverless
          │
       SQLite
          │
     ┌────┴────┐
     ▼         ▼
 Telegram    YouTube
 contenu      vidéos
     │
     ▼
  Étoiles ⭐
```

## Responsabilités

### Telegram

- identité et authentification de l’utilisateur ;
- bot ;
- interface Mini App ;
- distribution des contenus Telegram ;
- interactions communautaires ;
- mécanismes natifs liés aux Étoiles.

### Telegram Serverless

- logique applicative légère ;
- configuration ;
- métadonnées ;
- correspondances entre contenus ;
- préférences de la créatrice ;
- statistiques applicatives nécessaires au produit.

La base SQLite ne doit pas devenir un entrepôt de médias.

### YouTube

Les vidéos restent hébergées sur YouTube. Pesce publie sur YouTube et Pesce Studio référence et présente les vidéos pertinentes.

## Données minimales envisagées

### creator_settings

- id
- nom_affiché
- bio
- photo_url
- telegram_user_id
- bot_username
- youtube_channel_id
- langue
- created_at
- updated_at

### content_mapping

- id
- telegram_message_id
- type
- youtube_video_id
- titre
- featured
- published_at

Cette structure pourra évoluer uniquement lorsqu’un besoin réel le justifie.

## Sécurité

Le token du bot est un secret d’environnement. Il ne doit jamais être placé dans le dépôt, le frontend ou une URL publique.

Le frontend ne doit pas contenir de secret serveur.

## Contraintes

- Pas de nouveau backend lourd.
- Pas de stockage vidéo local.
- Pas de système de paiement propriétaire.
- Pas de CMS complexe pour V1.
- Pas de duplication inutile de contenu Telegram.
