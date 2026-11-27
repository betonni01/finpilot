# Déployer FINPILOT avec synchronisation et notifications

Une seule commande installe tout sur un serveur : l'application (PWA), le serveur de synchronisation Django, PostgreSQL, l'envoi des rappels et une sauvegarde quotidienne de la base. Caddy obtient et renouvelle seul le certificat HTTPS.

## Ce qu'il faut

- Un petit serveur Linux (1 vCPU, 1 Go de RAM suffisent) avec Docker et Docker Compose.
- Un nom de domaine (ou sous-domaine) dont l'enregistrement DNS A pointe vers l'IP du serveur.
- Les ports 80 et 443 ouverts.

## Installation (10 minutes)

```bash
git clone <ton dépôt> finpilot   # ou copie du dossier par scp
cd finpilot/deploy
cp .env.example .env
nano .env                         # DOMAIN, POSTGRES_PASSWORD, DJANGO_SECRET_KEY

# clés des notifications, à coller dans .env
docker compose run --rm api python manage.py generate_vapid

docker compose up -d --build
```

Ouvre ensuite `https://ton-domaine` :

1. Sur le premier appareil : Paramètres › Synchronisation › « Premier appareil : créer le compte ». Choisis un mot de passe de compte et une **phrase secrète de synchronisation** différente. Note la phrase : elle seule permet de déchiffrer tes données sur un autre appareil.
2. Sur chaque autre appareil : à l'accueil, « Connecter à mon compte » (ou Paramètres › Synchronisation › « Ajouter cet appareil »).
3. Sur le téléphone : installe l'application (Android : menu › Installer ; iPhone : Safari › Partager › Sur l'écran d'accueil), puis Paramètres › Synchronisation › Rappels en arrière-plan › Activer.

## Partager FINPILOT avec d'autres personnes

1. **Le premier compte créé sur le serveur devient administrateur** : crée le tien en premier.
2. Par défaut, l'inscription se fait **sur invitation**. Dans l'application : menu Serveur › Administration › « Créer un code d'invitation », puis « Copier le message » et envoie-le (WhatsApp, SMS, e-mail). Le code peut servir une ou plusieurs fois, avec une date d'expiration.
   En ligne de commande : `docker compose exec api python manage.py create_invite --uses 5 --days 30`.
3. La personne ouvre l'adresse de l'application, choisit « Créer mon compte », saisit le code et choisit sa propre phrase secrète.
4. Chacun a ses données, chiffrées avec sa propre clé : **même l'administrateur ne peut pas les lire**. La page Administration n'affiche que les comptes, leurs volumes et leur dernière connexion.
5. Mot de passe oublié : avec un serveur e-mail configuré (`EMAIL_HOST`…), la personne reçoit un code. Sinon, l'administrateur génère un code depuis la page Administration et le lui transmet. **Une phrase secrète oubliée, en revanche, ne se récupère pas** : les données synchronisées deviennent illisibles (celles restées sur ses appareils restent utilisables).
6. Pour désactiver ou supprimer un compte : page Administration. Pour ouvrir ou fermer les inscriptions : `FINPILOT_REGISTRATION` dans `.env`, puis `docker compose up -d`.

Sur un appareil partagé (ordinateur familial), chaque personne crée son **profil** (bouton du profil en haut du menu › « Qui utilise FINPILOT ? »). Chaque profil a sa propre base, son code PIN, son coffre et son compte.

## Assistant vocal privé

L'image `web` télécharge pendant sa construction le modèle de reconnaissance vocale (Whisper « base », environ 80 Mo) et le sert depuis `/models`. Pour un autre modèle : `docker compose build --build-arg WHISPER_MODEL=onnx-community/whisper-small web`. Le serveur ne reçoit jamais d'audio : la transcription se fait dans le navigateur de chaque utilisateur.

## Ce que voit le serveur

Le serveur ne stocke que des enregistrements chiffrés sur tes appareils (AES-256-GCM). Il connaît ton e-mail, le nombre d'enregistrements, leurs dates de modification et, pour les rappels, la date et le nombre de paiements à venir. En mode « rappels détaillés » (désactivé par défaut), il reçoit aussi le libellé et le montant des échéances notifiées.

## Exploitation

| Action | Commande |
|---|---|
| Mettre à jour | `git pull && docker compose up -d --build` |
| Journaux | `docker compose logs -f api worker web` |
| Sauvegardes de la base | dossier `deploy/backups/` (une par jour, 30 jours conservés) |
| Restaurer la base | `gunzip -c backups/finpilot-AAAA-MM-JJ.sql.gz \| docker compose exec -T db psql -U finpilot finpilot` |
| Arrêter | `docker compose down` (les données restent dans les volumes) |

Copie régulièrement `deploy/backups/` hors du serveur. Ces sauvegardes sont chiffrées de bout en bout : elles ne sont utilisables qu'avec ta phrase secrète.

## Variante : application sur Firebase Hosting, serveur ailleurs

1. `npm run build && firebase deploy` (le `firebase.json` est fourni).
2. Sur le serveur, ajoute dans `.env` : `FINPILOT_CORS_ORIGINS=https://ton-projet.web.app`.
3. Dans l'application, indique l'adresse du serveur (`https://api.ton-domaine`) au moment de la connexion.

## Tester en local sans domaine

```bash
cd server && pip install -r requirements-dev.txt
DJANGO_DEBUG=1 python manage.py migrate && DJANGO_DEBUG=1 python manage.py runserver 8000
# autre terminal, à la racine :
npm run build && npx vite preview     # http://localhost:4173, /api est relayé vers le port 8000
pytest                                # dans server/ : tests du serveur
```
