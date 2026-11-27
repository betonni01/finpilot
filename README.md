# FINPILOT, pilotage financier personnel et de projets

Application PWA en local d'abord : toutes les données restent sur l'appareil (IndexedDB), l'application fonctionne hors connexion et s'installe sur ordinateur et smartphone.

## Démarrer

```bash
npm install
npm run dev          # développement : http://localhost:5173
npm test             # tests du moteur financier (Vitest)
npm run build        # version PWA dans dist/ (hors ligne, installable)
npm run build:single # version fichier unique dans dist-single/index.html
```

## Mettre en ligne

- **Tout-en-un avec synchronisation et notifications** : voir `deploy/DEPLOIEMENT.md` (Docker Compose : Caddy HTTPS + Django + PostgreSQL + envoi des rappels + sauvegarde quotidienne).
- **Application seule** (sans synchro) : le dossier `dist/` est un site statique (Firebase Hosting avec le `firebase.json` fourni, Netlify, GitHub Pages).
- **Hors ligne sur un ordinateur** : `npm run build:single` produit un fichier HTML unique à ouvrir dans Chrome ou Edge.

## Comptes et partage

- **Profils locaux** : plusieurs personnes sur un même appareil, chacune avec sa base, son PIN, son coffre et son compte (sélecteur « Qui utilise FINPILOT ? »).
- **Comptes en ligne** : inscription libre, sur invitation (par défaut) ou fermée ; le premier compte est administrateur. Page Administration : invitations, comptes, désactivation, codes de réinitialisation, volumes. L'administrateur ne peut pas lire les données des autres (chiffrement de bout en bout).
- **Mot de passe oublié** : code par e-mail si un serveur SMTP est configuré, sinon code généré par l'administrateur. Quotas de stockage par compte.

## Assistant vocal

- Bouton micro (en haut sur mobile, à droite sur ordinateur) ou touche **V**. Dicte des opérations (« J'ai payé 12 euros 50 de courses chez Lidl en espèces », « J'ai remboursé 50 euros à Koffi », « J'ai retiré 60 euros »), pose des questions, lance une simulation ou ouvre une page. Toute opération dictée est confirmée (« oui » / « non » ou bouton) avant d'être enregistrée.
- Trois modes : **automatique** (par défaut), **navigateur** (Web Speech API : rapide, mais l'audio passe en général par les serveurs du fournisseur du navigateur) et **privé sur l'appareil** (Whisper exécuté en WebAssembly dans un worker : l'audio ne quitte jamais l'appareil, hors connexion après le premier téléchargement).
- Le modèle Whisper est servi par ton serveur (`scripts/fetch-whisper.mjs`, lancé automatiquement par l'image Docker) ; à défaut, il peut être téléchargé une fois depuis Hugging Face. Les réponses sont lues avec les voix intégrées à l'appareil.
- La compréhension des phrases (`src/engine/voice.ts`) est un moteur de règles local : nombres dits en lettres, francs CFA, dates (« hier », « le 3 »), catégories, comptes (espèces, MoMo, carte), personnes.

## Sécurité et synchronisation

- **Coffre chiffré** (optionnel, Paramètres › Sécurité) : tout ce qui est stocké dans le navigateur est chiffré en AES-256-GCM, documents compris. La clé n'existe en mémoire qu'après saisie de la phrase secrète (PBKDF2-SHA256, 600 000 itérations).
- **Synchronisation chiffrée de bout en bout** : chaque enregistrement est chiffré sur l'appareil avant l'envoi. Le serveur ne voit ni montants ni libellés. Conflits : la modification la plus récente l'emporte, enregistrement par enregistrement, et chaque résolution est journalisée.
- **Rappels en arrière-plan** : Web Push (VAPID). Par défaut, le serveur ne reçoit que la date et le nombre de paiements à venir.
- **Taux de change** : mis à jour automatiquement toutes les 12 h en ligne (Frankfurter, banques centrales dont la BCE), historisés ; francs CFA à parité fixe.

## Architecture

```
src/engine/   moteur financier pur, indépendant de l'interface et testé
  money.ts       montants en entiers (unités mineures), devises, conversions datées
  date.ts        dates AAAA-MM-JJ calculées en UTC
  recurrence.ts  règles récurrentes → occurrences (planifiée, due, en retard, partielle, payée, annulée)
  ledger.ts      soldes, classification des flux, disponible réel, reste à vivre, projets, budgets
  projection.ts  projection jour par jour, scénarios, simulateurs, capacité d'achat, centre de décision
  debts.ts       boule de neige / avalanche, objectifs d'épargne
  insights.ts    alertes, détection des récurrences et des doublons
  assistant.ts   questions en français → appels au moteur (aucune donnée inventée)
src/db/       Dexie (IndexedDB), écritures tracées, coffre chiffré (secure.ts, vault.ts), taux (rates.ts), sauvegardes
src/sync/     synchronisation chiffrée de bout en bout et notifications push
server/       Django REST + JWT + PostgreSQL : stockage chiffré opaque, conflits, Web Push (tests : pytest)
deploy/       Docker Compose, Caddyfile, guide de déploiement
src/pages/    un écran par module
```

### Règles de calcul clés

- **Disponible réel** = liquidités personnelles − épargne affectée − engagements dus avant le prochain revenu certain − réserve de sécurité.
- **Reste à vivre** = revenus certains mensualisés − charges, remboursements, cotisations, épargne et apports programmés.
- Un **transfert** entre comptes personnels est neutre ; vers un compte projet, c'est un **apport**, pas une consommation.
- Une **simulation** n'écrit jamais dans le grand livre : c'est un calque d'opérations virtuelles posé sur la projection.
- Le **verdict** d'un achat repose sur le point le plus bas du disponible projeté (pas sur le solde de fin de mois) : rouge sous le seuil de sécurité, orange sous seuil + 50 % des dépenses essentielles mensuelles.
- Une dette soldée ne génère plus de remboursements dans les prévisions, même si l'échéancier continue.

## Tests

`npm test` (moteur, coffre, file de synchro, rappels, taux) et `cd server && pytest` (authentification, synchro, conflits, isolation, notifications).
