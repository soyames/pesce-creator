# Backend Telegram Serverless

Cet espace contient la logique backend légère de Pesce Studio.

## Règle importante

Ne pas implémenter ici un serveur traditionnel ou une base média.

Le runtime exact et les conventions de déploiement Telegram Serverless doivent être confirmés avec l’environnement réellement disponible avant d’ajouter les handlers de production.

## Responsabilités prévues

- authentification et validation de l’utilisateur Telegram ;
- configuration de Pesce ;
- métadonnées minimales ;
- publications et brouillons ;
- intégration YouTube ;
- statistiques utiles ;
- orchestration des fonctionnalités Telegram autorisées.

## Secrets

Le token de `@PesceStudioBot` doit être configuré comme secret dans l’environnement Serverless. Il ne doit jamais apparaître dans le frontend ni dans Git.
