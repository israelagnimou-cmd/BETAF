# API BETAF Studio — FastAPI et MySQL

FastAPI fournit l’API et peut servir l’interface web compilée dans `dist/`. Il conserve les routes de données BETAF, gère les comptes et rôles, et journalise les actions. SQLite convient au test local; utilisez MySQL pour une installation hébergée avec plusieurs utilisateurs.

## Base de données hébergée

1. Créez une base MySQL nommée `betaf_studio` et un utilisateur dédié chez votre hébergeur MySQL.
2. Autorisez les connexions depuis le serveur qui hébergera l’API. Ne publiez pas le port MySQL sur tout Internet si l’hébergeur propose un réseau privé.
3. Configurez la chaîne de connexion `BETAF_DATABASE_URL` avec l’hôte, le nom de base et les identifiants fournis par l’hébergeur. Les tables `users`, `app_state`, `api_sessions` et `audit_entries` sont créées au premier démarrage.
4. Le fichier `database/schema.sql` décrit le schéma MySQL. Le serveur ne sauvegarde pas de fichier `.sqlite` local.

## Importer les données existantes

Avant de connecter les postes à la nouvelle API, arrêtez l’ancien serveur Node/SQLite et faites une copie de sauvegarde de `server/data/betaf.sqlite` (avec ses éventuelles sauvegardes). Configurez `api/.env` vers la nouvelle base MySQL, puis lancez depuis la racine :

```powershell
python -m api.migrate_sqlite
```

Le script importe l’état de l’application, les comptes et l’historique d’audit; les mots de passe existants restent vérifiables. Il refuse de remplacer un état MySQL déjà rempli. N’utilisez `python -m api.migrate_sqlite --replace-state` que si vous voulez explicitement écraser l’état MySQL courant. Gardez la copie SQLite comme sauvegarde jusqu’à validation de la nouvelle API.

## Lancer la version web en local avec SQLite

Depuis la racine du projet, dans PowerShell :

```powershell
$env:BETAF_DATABASE_URL = "sqlite:///./api/betaf-local.sqlite"
$env:BETAF_ADMIN_USERNAME = "admin"
$env:BETAF_ADMIN_FULLNAME = "Administrateur BETAF"
$env:BETAF_ADMIN_PASSWORD = "Remplacez-par-un-secret-unique-de-12-caracteres"
npm run build
npm run api:dev
```

Ouvrez `http://localhost:3001`; FastAPI sert la page web et l’API sur la même adresse. La documentation technique se trouve sur `/docs`. Le fichier SQLite local est `api/betaf-local.sqlite` et il est exclu du contrôle de version.

Pour le rechargement à chaud de l’interface, lancez `npm run dev` dans une seconde fenêtre et ouvrez `http://localhost:5173`; Vite transmet les appels `/api` à FastAPI sur le port `3001`. Les variables PowerShell restent actives dans leur fenêtre; réexécutez-les après l’avoir fermée.

Au premier démarrage, le compte `admin` est créé à partir de `BETAF_ADMIN_USERNAME` et `BETAF_ADMIN_PASSWORD`. Le mot de passe doit contenir au moins 12 caractères. Après connexion, l’administrateur peut importer une seule fois les données et comptes de ce navigateur. Les anciens comptes « Consultation » sont conservés comme Gestionnaires suspendus et peuvent être réattribués par un admin.

Les rôles disponibles sont **Administrateur** et **Gestionnaire**. Les Paramètres sont organisés en pages distinctes, accessibles par une navigation latérale sur ordinateur et une liste déroulante sur mobile. Seuls les admins peuvent gérer les comptes et consulter le journal d’activité; un compte créé ou réinitialisé doit changer son mot de passe provisoire à la prochaine connexion. Chaque membre peut modifier son nom, son e-mail, son téléphone et son propre mot de passe.

## Lancer avec MySQL hébergé

```powershell
Copy-Item api/.env.example api/.env
# Configurez BETAF_DATABASE_URL et un mot de passe administrateur unique dans api/.env.
npm run api:install
npm run api:dev
```

Le service écoute sur `http://localhost:3000`.

Le mot de passe administrateur initial doit contenir au moins 12 caractères et doit être défini dans `BETAF_ADMIN_PASSWORD`. Il n’est utilisé que pour créer le compte `admin` lors de la toute première initialisation; les mots de passe sont stockés sous forme de hachages scrypt.

## Déployer sur un hébergement

Compilez l’interface avec `npm run build`, puis déployez les dossiers `api` et `dist` comme service Python. Configurez MySQL et les secrets depuis le panneau sécurisé de l’hébergeur. Lancez Uvicorn sur `0.0.0.0` avec le port fourni par l’hébergeur (ou `3000` par défaut), puis configurez HTTPS. FastAPI sert l’interface web et l’API depuis la même origine.

`BETAF_CORS_ORIGINS` vaut `*` par défaut, sans cookies ni identifiants d’origine. Pour un hébergement à accès restreint, définissez la liste d’origines autorisées, séparées par des virgules; conservez `*` si les clients Electron utilisent une origine locale `file://`.

Pour héberger uniquement l’interface sur Cloudflare Pages, définissez `VITE_API_BASE_URL` avec l’URL HTTPS de l’API avant `npm run build`, puis téléversez le dossier `dist`. Sur l’API, définissez `BETAF_CORS_ORIGINS` avec l’origine exacte de Pages. Sans API déployée, la page est une prévisualisation : la connexion et les données ne fonctionneront pas.

## Connecter l’application BETAF

La version web n’a plus de bouton « Connecter à l’API » : elle appelle automatiquement l’API Python sur la même origine. Ouvrez l’URL HTTPS du site et connectez-vous avec un compte BETAF.

Les modifications des clients, documents, paramètres et comptes sont attribuées au membre connecté. Le journal conserve les événements sans enregistrer les mots de passe ni les valeurs de profil.

## Tests

Depuis la racine :

```powershell
python -m pytest api/tests
```

Les tests utilisent une base SQLite en mémoire. L’API en local peut utiliser le fichier SQLite configuré par `BETAF_DATABASE_URL`; l’API hébergée utilise MySQL.
