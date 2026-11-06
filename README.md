# immo – CTB – Cabinet Tahar Bakir

Application de gestion des immobilisations corporelles et incorporelles (NC 05, NC 06, fiscalité tunisienne).
Propriété de CTB – Cabinet Tahar Bakir.

**Adresse cible : https://immo.cabinet-tb.tn**

| Élément | Rôle |
|---|---|
| **GitHub** (dépôt `bakirtahar/immo` + GitHub Pages) | héberge et publie les fichiers du site, gratuitement, en HTTPS |
| **Sous-domaine `immo.cabinet-tb.tn`** | pointe vers GitHub Pages (un enregistrement DNS) |
| **Supabase** | comptes, mots de passe, envoi des codes par e-mail, base de données protégée |

## Comment la connexion est protégée

1. **Accès sur invitation uniquement.**
   - Les inscriptions libres sont fermées.
   - Seuls l'administrateur et les clients invités par lui peuvent se connecter.
2. **Validation de l'adresse e-mail.**
   - Un client invité doit ouvrir le lien reçu par e-mail avant toute connexion.
3. **Connexion en deux étapes, à chaque fois.**
   - Le mot de passe d'abord, puis **un code à 6 chiffres envoyé par e-mail**, valable 10 minutes.
   - Ce n'est pas seulement l'écran qui l'exige : **la base de données vérifie elle-même les deux étapes.**
   - Un mot de passe seul ne donne accès à aucune donnée, même si quelqu'un le connaît.
   - Un code seul non plus, même si quelqu'un a piraté la boîte e-mail.
4. **Mots de passe.**
   - Personne ne peut les lire, pas même l'administrateur : ils sont conservés sous forme chiffrée irréversible (bcrypt). Rendre un mot de passe lisible serait une faille.
   - **Seul l'administrateur gère les mots de passe des clients** : il envoie un lien personnel de réinitialisation avec le bouton « Réinitialiser le mot de passe ». Il n'y a pas de « mot de passe oublié » en libre-service : le client contacte le cabinet.
5. **Cloisonnement.**
   - Un client ne voit que sa société, même en contournant l'application.
   - Un client désactivé perd l'accès immédiatement.
6. **Journaux.**
   - Toutes les connexions (réussies, échouées, codes erronés) et toutes les modifications sont enregistrées.
   - Ces journaux sont consultables par l'administrateur seul.

Détails et contrôles réalisés : [SECURITE.md](SECURITE.md).

---

## Ce qu'il vous faut

- un accès à la **zone DNS** de `cabinet-tb.tn` : chez OVHcloud, ou chez le prestataire qui gère le domaine ;
- un **compte GitHub** (`bakirtahar`) ;
- un **compte Supabase** (gratuit pour commencer ; l'offre Pro est recommandée en production) ;
- un **serveur d'envoi d'e-mails** (SMTP). Au choix :
  - celui de la messagerie du cabinet ;
  - un service comme Brevo, Mailjet ou Amazon SES.

Ce serveur est indispensable : chaque connexion envoie un code par e-mail.

Comptez environ 1 h 30, plus le délai de propagation DNS (de quelques minutes à quelques heures).

---

## Étape 1 – Sécuriser vos comptes (10 min)

1. Sur **github.com** :
   1. ouvrez *Settings → Password and authentication* ;
   2. activez la **double authentification** (*Two-factor authentication*).
2. Sur **supabase.com**, après la création du compte : *Account → Security → Multi-Factor Authentication*.
3. Utilisez des mots de passe **nouveaux** et différents pour GitHub, Supabase et immo. **N'utilisez plus « Azerty1510 »** : il a circulé par écrit.

## Étape 2 – Créer le dépôt GitHub et y déposer les fichiers (10 min)

1. Sur github.com, cliquez sur **+ → New repository** :
   - *Repository name* : `immo` ;
   - *Public*. Le code ne contient aucun secret ni aucune donnée. GitHub Pages est gratuit sur un dépôt public ; un dépôt privé avec Pages demande l'offre GitHub Pro, environ 4 $/mois ;
   - **ne cochez rien** (pas de README, de .gitignore ni de licence) ;
   - cliquez sur **Create repository**.
2. Dézippez `immo-github.zip` sur votre ordinateur.
3. Dans le dépôt vide, cliquez sur **uploading an existing file**.
4. Faites glisser **le contenu** du dossier `immo`, c'est-à-dire tous les fichiers et dossiers qu'il contient, et non le dossier lui-même.
5. Vérifiez que `index.html`, `CNAME`, `config.js` et les dossiers `js`, `vendor`, `fonts` et `supabase` sont à la racine.
6. Cliquez sur **Commit changes**.

Le fichier `CNAME` contient `immo.cabinet-tb.tn` : c'est lui qui indique à GitHub le sous-domaine à servir.

> Si vous me donnez accès au dépôt une fois créé, je peux y déposer les fichiers moi-même.

## Étape 3 – Créer le projet Supabase (10 min)

1. Sur supabase.com, cliquez sur **New project** :
   - *Name* : `immo` ;
   - *Database password* : générez-le et conservez-le dans un gestionnaire de mots de passe ;
   - *Region* : **Central EU (Frankfurt)** ou **West EU (Paris)**, les plus proches de la Tunisie.
2. Une fois le projet prêt, ouvrez **SQL Editor → New query**.
3. Collez **tout** le fichier `supabase/schema.sql`, puis cliquez sur **Run**. Le résultat attendu est « Success. No rows returned ».
   - L'adresse de l'administrateur (`t.bakir@tb.tn`) est réglée au début du fichier.
   - Le réglage `admin_totp_required` vaut `false`. Mettez `true` si vous voulez imposer en plus, à l'administrateur, une application d'authentification sur téléphone (troisième protection, recommandée).
   - Le script peut être relancé sans perte de données.

## Étape 4 – Régler l'authentification Supabase (15 min)

Ouvrez le menu **Authentication**. Les noms des menus peuvent légèrement varier.

### 4.1 Sign In / Providers → Email

| Réglage | Valeur |
|---|---|
| Enable Email provider | **activé** |
| Allow new users to sign up | **désactivé** |
| Confirm email | **activé** |
| Secure email change | **activé** |
| Secure password change | **activé** |
| Minimum password length | **10** |
| Password requirements | **Lowercase, uppercase letters and digits** |
| Email OTP Expiration | **600** secondes (10 minutes) |
| Email OTP Length | **6** |

Désactivez aussi les connexions anonymes (*Anonymous sign-ins*) et tous les autres fournisseurs : Google, Apple, téléphone, etc.

### 4.2 Multi-Factor

*TOTP (App Authenticator)* : **Enabled**. Ce réglage sert à l'application d'authentification facultative.

### 4.3 URL Configuration

| Réglage | Valeur |
|---|---|
| Site URL | `https://immo.cabinet-tb.tn/` |
| Redirect URLs | `https://immo.cabinet-tb.tn/` |

### 4.4 Emails → Templates

Pour chaque modèle, remplacez le contenu (onglet *Source*) par le fichier indiqué :

| Modèle Supabase | Fichier | Objet |
|---|---|---|
| **Magic Link** | `supabase/templates/magic_link.html` | immo – votre code de validation |
| Invite user | `supabase/templates/invite.html` | Votre accès à immo – CTB |
| Reset password | `supabase/templates/recovery.html` | immo – réinitialisation du mot de passe |
| Reauthentication | `supabase/templates/reauthentication.html` | immo – code de confirmation |
| Change email address | `supabase/templates/email_change.html` | immo – confirmez votre nouvelle adresse |

Le modèle **Magic Link** est celui du **code de validation envoyé à chaque connexion** : il doit contenir `{{ .Token }}`, ce qui est le cas du fichier fourni.

### 4.5 Emails → SMTP Settings (obligatoire)

Sans votre propre serveur, Supabase n'envoie des e-mails qu'aux membres de l'équipe du projet, avec quelques envois par heure seulement. Vos clients ne recevraient ni invitation ni code.

1. Activez **Enable Custom SMTP**.
2. *Sender email* : par exemple `immo@cabinet-tb.tn`.
3. *Sender name* : `CTB – immo`.
4. *Host*, *Port* (587), *Username*, *Password* : ceux fournis par votre messagerie ou par Brevo, Mailjet, etc.

Ensuite, dans **Rate Limits**, réglez *Rate limit for sending emails* sur au moins **100 par heure**. Chaque connexion envoie un e-mail : avec la valeur par défaut, des clients pourraient être bloqués.

### 4.6 Authentification de l'expéditeur (DNS)

Pour que les codes n'arrivent pas dans les courriers indésirables, ajoutez dans la zone DNS de `cabinet-tb.tn` les enregistrements **SPF** et **DKIM** fournis par votre service d'envoi. Ajoutez aussi un enregistrement **DMARC**, par exemple :

| Type | Nom | Valeur |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:t.bakir@tb.tn` |

## Étape 5 – Déployer la fonction d'invitation (10 min)

Cette fonction envoie les invitations et les liens de réinitialisation. Seul l'administrateur connecté peut l'utiliser.

1. Ouvrez **Edge Functions → Deploy a new function → Via Editor**.
2. Nommez-la exactement `invite-client`.
3. Remplacez le code d'exemple par tout le contenu de `supabase/functions/invite-client/index.ts`, puis cliquez sur **Deploy**.
4. Dans **Edge Functions → Secrets**, ajoutez les deux réglages suivants :

| Nom | Valeur |
|---|---|
| `SITE_URL` | `https://immo.cabinet-tb.tn/` |
| `ALLOWED_ORIGINS` | `https://immo.cabinet-tb.tn` |

`ALLOWED_ORIGINS` ne prend pas de barre oblique à la fin.

5. Laissez *Verify JWT* activé. Si l'envoi d'une invitation échoue avec le message « Invalid JWT », désactivez-le : la fonction vérifie elle-même, auprès de la base, que l'appelant est l'administrateur.

## Étape 6 – Relier l'application à Supabase (5 min)

1. Dans Supabase, ouvrez **Project Settings → API Keys** (ou **API**). Copiez :
   - le **Project URL**, par exemple `https://abcdefghijkl.supabase.co` ;
   - la clé **publique** : *anon public* ou *publishable*.
2. Dans GitHub, ouvrez `config.js`, cliquez sur le crayon (*Edit*), puis remplacez :
   - `https://VOTRE-PROJET.supabase.co` par le Project URL ;
   - `VOTRE-CLE-PUBLIQUE-ANON` par la clé publique.
3. Cliquez sur **Commit changes**.

⚠️ Ne mettez **jamais** dans ce fichier la clé `service_role` ou `secret` : elle donnerait tous les droits sur la base.

## Étape 7 – Le sous-domaine immo.cabinet-tb.tn (15 min + propagation)

### 7.1 Faire vérifier le domaine par GitHub (protection contre le détournement)

1. Sur GitHub, cliquez sur votre photo → **Settings → Pages**, puis sur **Add a domain**.
2. Saisissez `cabinet-tb.tn`. GitHub affiche un enregistrement TXT, de la forme `_github-pages-challenge-bakirtahar`, avec une valeur.
3. Ajoutez cet enregistrement dans la zone DNS (voir 7.2), attendez quelques minutes, puis cliquez sur **Verify**.

Ainsi, personne d'autre ne peut publier un site GitHub sur un sous-domaine de `cabinet-tb.tn`.

### 7.2 Créer le sous-domaine dans la zone DNS

**Chez OVHcloud** :

1. Ouvrez *Web Cloud → Noms de domaine → cabinet-tb.tn → Zone DNS → Ajouter une entrée*.
2. Choisissez le type **CNAME** :
   - *Sous-domaine* : `immo` ;
   - *Cible* : `bakirtahar.github.io.` (avec le point final).
3. Validez.

Chez un autre prestataire, le principe est le même :

| Type | Nom | Valeur | TTL |
|---|---|---|---|
| CNAME | `immo` | `bakirtahar.github.io.` | 3600 |

Vérifiez qu'il n'existe pas déjà une autre entrée pour `immo` (A, AAAA ou CNAME) ; supprimez-la si c'est le cas. Le site principal `cabinet-tb.tn` n'est pas modifié.

### 7.3 Activer GitHub Pages sur le sous-domaine

1. Dans le dépôt `immo`, ouvrez **Settings → Pages** :
   - *Source* : **Deploy from a branch** ;
   - *Branch* : `main`, dossier `/ (root)`, puis **Save**.
2. Dans *Custom domain*, vérifiez que `immo.cabinet-tb.tn` est affiché (il vient du fichier `CNAME`), sinon saisissez-le, puis cliquez sur **Save**.
3. Attendez la coche verte **DNS check successful**, puis cochez **Enforce HTTPS**. Le certificat est fourni gratuitement par GitHub ; son émission peut prendre jusqu'à 24 h.
4. Ouvrez https://immo.cabinet-tb.tn : l'écran de connexion immo s'affiche.

## Étape 8 – Créer le compte administrateur (5 min)

1. Dans Supabase, ouvrez **Authentication → Users → Add user → Send invitation**, puis saisissez `t.bakir@tb.tn`.
2. Ouvrez l'e-mail « Votre accès à immo – CTB », puis cliquez sur **Valider mon adresse et choisir mon mot de passe**.
3. Choisissez un mot de passe **nouveau** : 10 caractères minimum, avec majuscules, minuscules et chiffres.
4. L'application revient à l'écran de connexion, avec votre adresse déjà remplie.
5. Saisissez votre mot de passe → vous recevez **un code à 6 chiffres par e-mail** → saisissez-le.
6. Vous êtes dans l'espace administrateur.
7. Recommandé : dans **Sécurité**, ajoutez une application d'authentification (Google ou Microsoft Authenticator) comme troisième protection.

## Étape 9 – Clients

1. Dans **Paramétrage → Identité visuelle**, chargez le logo officiel CTB.
2. **Reprendre les données de la version claude.ai** :
   1. là-bas, exportez avec *Sauvegarde → Exporter* ;
   2. ici, importez avec *Sauvegarde → Restaurer* ;
   3. dans **Clients**, cliquez sur **Inviter** pour chaque client.
3. **Nouveau client** :
   1. saisissez la raison sociale, le code société et l'adresse e-mail ;
   2. l'invitation part automatiquement ;
   3. le client ouvre le lien, choisit son mot de passe, puis se connecte : mot de passe, puis code reçu par e-mail ;
   4. la colonne **Accès** passe à « Actif » quand l'adresse est validée.
4. **Mot de passe oublié par un client** : cliquez sur **Réinitialiser le mot de passe** sur sa ligne. Il reçoit un lien personnel ; son ancien mot de passe reste valable jusqu'à ce qu'il en choisisse un nouveau.
5. **Fin de mission** : **Désactiver** coupe l'accès immédiatement, et les données sont conservées. **Supprimer** efface les données et le compte : exportez d'abord une sauvegarde.

## Étape 10 – Vérifier (10 min)

1. **Invitation** : créez un client de test avec une adresse que vous consultez. Avant d'ouvrir l'invitation, vérifiez qu'aucune connexion n'est possible.
2. **Code obligatoire** : saisissez le bon mot de passe, puis fermez l'onglet sans saisir le code. En rouvrant le site, vous êtes déconnecté : le mot de passe seul ne suffit pas.
3. **Cloisonnement** : connecté comme client de test, vous ne voyez que cette société.
4. **Désactivation** : désactivez-le. L'accès est coupé immédiatement.
5. **Accès anonyme** : dans **SQL Editor**, exécutez la requête suivante. Le résultat attendu est une erreur *permission denied*.

   ```sql
   set role anon; select * from public.docs; reset role;
   ```

6. **Alertes Supabase** : dans **Advisors → Security Advisor**, vérifiez qu'aucune alerte ne concerne les tables `docs`, `profiles`, `audit_log` et `auth_log`.
7. **Navigateur** : vérifiez que le cadenas HTTPS s'affiche sur https://immo.cabinet-tb.tn.

---

## Exploitation

- **Sauvegardes** :
  - utilisez *Sauvegarde → Exporter* au moins une fois par mois, et avant toute suppression ;
  - conservez le fichier chiffré, car il contient toutes les données comptables ;
  - l'offre Supabase Pro ajoute des sauvegardes quotidiennes.
- **Journaux** : consultez *Sécurité* chaque mois (échecs répétés, codes erronés, connexions inhabituelles).
- **Mot de passe administrateur oublié** : dans Supabase, ouvrez *Authentication → Users*, puis, sur votre ligne, *Send password recovery*.
- **Téléphone d'authentification perdu** (si l'application d'authentification est activée) : dans *SQL Editor*, exécutez :

  ```sql
  delete from auth.mfa_factors where user_id = (select id from auth.users where email = 't.bakir@tb.tn');
  ```

- **Mettre à jour l'application** : remplacez les fichiers dans le dépôt GitHub. Le site est republié en une à deux minutes. Les données, qui sont dans Supabase, ne sont pas touchées.
- **Projet Supabase gratuit** : il est mis en pause après une semaine sans activité. Pour un usage professionnel, l'offre **Pro** est recommandée.

## Propriété et licences

immo est la propriété de CTB – Cabinet Tahar Bakir. Les composants tiers restent soumis à leurs licences :

- jsPDF : MIT ;
- jspdf-autotable : MIT ;
- SheetJS : Apache 2.0 ;
- JsBarcode : MIT ;
- supabase-js : MIT ;
- polices IBM Plex et Mozilla Headline : SIL OFL.
