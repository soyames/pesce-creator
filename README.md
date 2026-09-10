# Pesce Studio

**L’espace Telegram de Pesce Hounyo**

Pesce Studio est une expérience Telegram native destinée à permettre à Pesce Hounyo de publier, échanger avec son audience et recevoir directement son soutien via les Étoiles Telegram.

## Vision

Construire un espace simple, francophone et centré sur Pesce, sans créer une plateforme média indépendante inutilement complexe.

Telegram fournit l’infrastructure de conversation, de distribution et de monétisation. YouTube reste l’hébergeur des vidéos. Telegram Serverless sert à la logique légère et aux métadonnées.

## Principes

- 🇫🇷 Toute l’expérience utilisateur est en français.
- 📱 Telegram est le point d’entrée principal.
- ⭐ Les Étoiles Telegram sont le mécanisme de soutien prioritaire.
- 🎥 Les vidéos restent hébergées sur YouTube.
- 📝 Le contenu Telegram reste géré dans l’écosystème Telegram.
- 🗄️ La base de données reste minimale.
- 🤖 L’IA assiste Pesce mais ne remplace jamais son jugement journalistique.
- 🔐 Les secrets Telegram ne sont jamais commités dans Git.

## État du projet

Phase 1 — fondations et prototype de l’interface.

## Structure

```text
pesce-creator/
├── app/
│   ├── frontend/
│   └── serverless/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRODUIT.md
│   └── GUIDE-PESCE.md
├── public/
├── .gitignore
└── README.md
```

## Bot Telegram

**Pesce Studio — @PesceStudioBot**

Le jeton du bot doit rester dans les secrets de l’environnement Telegram Serverless et ne doit jamais être ajouté au dépôt.

## Prochaine étape

Connecter le Mini App au runtime Telegram Serverless réellement disponible pour le projet, puis implémenter l’authentification, les publications et le soutien en Étoiles.
