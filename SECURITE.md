# immo – dossier de sécurité

CTB – Cabinet Tahar Bakir · https://immo.cabinet-tb.tn · GitHub Pages + Supabase · novembre 2026

## 1. Objectif

Seuls l'administrateur du cabinet et les clients invités, avec leur propre adresse e-mail, peuvent accéder à l'application. Aucun accès n'est possible sans **validation de l'adresse e-mail**. Chaque connexion se fait en **deux étapes** : le mot de passe, puis un code envoyé par e-mail. Chaque client ne voit que sa société. Personne ne peut lire un mot de passe, et seul l'administrateur peut déclencher la réinitialisation de celui d'un client.

## 2. Architecture

- **GitHub Pages** sert uniquement des fichiers statiques. Le site ne contient aucun secret et aucune donnée : la clé publique Supabase de `config.js` est publique par nature.
- **Supabase Auth** gère :
  - les comptes et les invitations ;
  - la validation des adresses ;
  - les mots de passe, conservés sous forme d'empreintes bcrypt ;
  - l'envoi du code de validation par e-mail à chaque connexion ;
  - l'application d'authentification facultative (TOTP).
- **PostgreSQL (Supabase)** conserve les données dans la table `docs`. Des **règles d'accès** (Row Level Security, RLS) sont vérifiées à **chaque requête** par la base elle-même. L'application n'est pas la barrière : même un utilisateur qui écrit ses propres requêtes depuis la console du navigateur est soumis aux mêmes règles.
- **La fonction `invite-client`** (Edge Function) est la seule à utiliser la clé de service. Elle vérifie que l'appelant est l'administrateur connecté en deux étapes et que la demande vient de `https://immo.cabinet-tb.tn`. Ensuite seulement, elle envoie l'invitation ou le lien de réinitialisation et rattache le compte à sa société.

## 3. Règles d'accès

| Règle | Où elle est appliquée |
|---|---|
| Aucune donnée sans connexion (rôle `anon` sans aucun droit sur les tables). | Base (droits SQL) |
| Inscriptions libres fermées. | Supabase Auth |
| Aucune connexion tant que l'adresse n'est pas validée. | Supabase Auth |
| La base refuse aussi un jeton valide dont l'adresse n'est pas validée. | Base (`private.email_ok`) |
| **Connexion en deux étapes** : la session doit avoir été ouverte par le code reçu par e-mail, **et** le mot de passe du même compte doit avoir été validé dans les 10 minutes précédentes. Un mot de passe seul, ou un code seul, ne donne accès à aucune donnée. Une session issue d'un lien d'invitation ou de réinitialisation ne donne pas non plus accès aux données : il faut ensuite se connecter normalement. | Base (`private.login_ok`, `mark_password_step`) |
| Les mots de passe ne sont lisibles par personne (empreintes bcrypt dans `auth.users`, inaccessibles par l'API). Seul l'administrateur peut envoyer un lien de réinitialisation à un client. | Supabase Auth et fonction `invite-client` |
| Administrateur : profil `admin`, connexion en deux étapes ; application d'authentification en plus si `admin_totp_required = true`. | Base (`private.is_admin`) |
| Client : profil `client` rattaché à une société, accès actif dans le registre, adresse validée. | Base (`private.my_tenant`) |
| Utilisateur ayant ajouté une application d'authentification : son code est exigé en plus. | Base (`private.aal_ok`) |
| Lecture et écriture limitées aux documents `tenants/<sa société>/…`, plus sa fiche du registre et le paramétrage, en lecture seule. | Base (politiques RLS) |
| Un client ne peut ni modifier le registre des clients, ni le paramétrage, ni son code société, ni supprimer son environnement. | Base (RLS et déclencheur `docs_guard`) |
| Les profils (rôle, société) ne sont modifiables par aucun utilisateur ; seule la fonction d'invitation les écrit. | Base (droits SQL) |
| Désactiver un client coupe l'accès immédiatement, même pour une session déjà ouverte. | Base (`private.my_tenant`) |
| Toute création, modification ou suppression est inscrite au journal, que personne ne peut effacer depuis l'application. | Base (déclencheur `docs_audit`) |
| Connexions, échecs, codes 2FA erronés et déconnexions sont journalisés. | Base (`log_auth_event`) |

## 4. Protections dans le navigateur

- **Politique de sécurité du contenu (CSP)** :
  - seuls les scripts du site s'exécutent : aucun script en ligne, aucun CDN externe ;
  - les seules connexions réseau autorisées vont vers `*.supabase.co`.
- **Polices et bibliothèques** servies par le site : aucun appel à Google Fonts ni à jsDelivr.
- **Clickjacking** : la page refuse de s'afficher dans le cadre d'un autre site.
- **Textes saisis** : toujours échappés. Un texte piégé (`<img onerror=…>`, `<script>`) s'affiche comme du texte et ne s'exécute jamais.
- **Session** :
  - conservée dans l'onglet uniquement (`sessionStorage`) : fermer l'onglet ferme la session ;
  - déconnexion après 30 minutes d'inactivité (réglable dans `config.js`) ;
  - bouton « Fermer toutes mes sessions » (tous appareils).
- **Entre les deux étapes**, aucune session n'est conservée : la session du mot de passe est fermée avant l'envoi du code.
- **Liens d'invitation et de réinitialisation** :
  - ils ne servent qu'une fois et expirent ;
  - le jeton est retiré de la barre d'adresse dès son utilisation.
- **Mot de passe oublié** : pas de libre-service. Le client contacte le cabinet, et l'administrateur lui envoie un lien depuis la liste des clients.
- **Mots de passe** :
  - 10 caractères minimum, avec majuscules, minuscules et chiffres ;
  - les changements sont confirmés par un code envoyé par e-mail si la connexion est ancienne (*Secure password change*).
- **Aucune empreinte de mot de passe dans le site** : le mot de passe de démonstration de la version claude.ai n'existe plus dans cette version. Les empreintes éventuellement présentes dans une ancienne sauvegarde restaurée sont supprimées par la base.

## 5. Contrôles réalisés avant livraison

Tous les contrôles ont été réalisés sur une copie locale complète de Supabase :

- base PostgreSQL 17 ;
- Supabase Auth 2.197 ;
- fonctions Edge ;
- serveur d'e-mails de test qui reçoit les vrais e-mails d'invitation et de code.

La copie avait les mêmes réglages que ceux du README.

### 73 contrôles techniques (attaques par l'API), tous réussis

- **Visiteur anonyme** :
  - il ne lit et n'écrit aucune donnée ;
  - il ne peut ni s'inscrire, ni créer un compte par code e-mail ;
  - il ne peut pas se déclarer « mot de passe saisi » ;
  - il ne peut pas inscrire de faux événement au journal ;
  - la fonction d'invitation lui répond 401.
- **Administrateur** :
  - aucune connexion avant validation de l'e-mail ;
  - la session issue du lien d'invitation n'a aucun droit ;
  - **le mot de passe seul ne donne ni données, ni écriture, ni invitation** ;
  - un code inventé est refusé ;
  - mot de passe puis code donnent les droits.
- **Boîte e-mail piratée** : un code e-mail obtenu sans mot de passe récent ne donne aucune donnée. Impossible aussi de se déclarer « mot de passe saisi » avec une session ouverte par code.
- **Réglage `admin_totp_required`** :
  - une fois activé, le mot de passe et le code e-mail ne suffisent plus ;
  - avec l'application d'authentification, les droits sont rétablis ;
  - un appareil enregistré reste exigé.
- **Compte non validé muni d'un jeton forgé** : aucune donnée, aucune écriture.
- **Client A contre client B** :
  - A ne lit, ne modifie et ne supprime aucune donnée de B ;
  - A ne modifie ni le registre, ni le paramétrage, ni son code société ;
  - A ne peut pas se donner le rôle d'administrateur ;
  - A ne lit pas les journaux ;
  - A ne peut ni inviter, ni réinitialiser le mot de passe d'un autre ;
  - aucune empreinte de mot de passe n'est lisible par l'API.
- **Réinitialisation par l'administrateur** :
  - impossible tant que le client n'a pas validé son adresse ;
  - le lien est reçu ;
  - la session du lien seule ne donne aucune donnée ;
  - l'ancien mot de passe est refusé, le nouveau mot de passe suivi du code fonctionne.
- **Désactivation et suppression** : coupure immédiate, même pour une session ouverte.
- **Journaux** :
  - les modifications et les réinitialisations sont tracées, et le journal ne peut pas être effacé ;
  - les codes erronés sont tracés.

### 37 étapes dans un vrai navigateur (Chromium), toutes réussies

Le parcours couvre :

- l'écran de connexion :
  - mention des deux étapes ;
  - « Mot de passe oublié ? » renvoie vers le cabinet ;
- l'invitation de l'administrateur :
  - le jeton est retiré de la barre d'adresse ;
  - après le choix du mot de passe, retour à la connexion ;
- la connexion en deux étapes :
  - un mauvais mot de passe est refusé, sans code envoyé ;
  - un e-mail contenant le code est reçu ;
  - **aucune session n'est conservée entre les deux étapes** ;
  - un code erroné est refusé, le bon code ouvre l'espace ;
- la création d'un client et du client de démonstration ;
- les dix écrans de gestion ;
- un texte piégé affiché sans exécution ;
- les rapports PDF et Excel ;
- le client :
  - invitation, mot de passe, code e-mail ;
  - accès limité à sa société, y compris depuis la console du navigateur ;
- la colonne « Accès » mise à jour ;
- la réinitialisation du mot de passe par l'administrateur, puis la connexion avec le nouveau mot de passe ;
- les journaux ;
- l'affichage mobile ;
- l'absence de toute erreur JavaScript et de toute violation CSP.

### Défauts trouvés pendant les tests et corrigés

- La colonne « Accès » de la liste des clients ne se mettait à jour qu'au rechargement de la page.
- Une demande de réinitialisation envoyée moins d'une minute après un autre e-mail renvoyait un message technique. Elle affiche maintenant « réessayez dans une minute ».

## 6. Points d'attention et recommandations

1. **Le mot de passe « Azerty1510 » a circulé** dans des échanges écrits. N'utilisez-le pour aucun compte : ni Supabase, ni GitHub, ni immo.
2. **Comptes Supabase et GitHub** : ce sont les clés du royaume.
   - **Supabase** : le compte donne un accès complet aux données. Activez-y la double authentification et limitez l'équipe du projet aux personnes indispensables.
   - **GitHub** : le compte permet de modifier le code publié. Activez-y la double authentification et protégez la branche `main`.
3. **Clé de service** (`service_role` / `secret`) : elle ne doit exister que dans Supabase. Ne la copiez jamais dans `config.js`, dans un e-mail ou dans le dépôt.
4. **Serveur d'envoi d'e-mails** : utilisez un expéditeur du domaine du cabinet avec SPF et DKIM. Un e-mail d'invitation usurpé est le principal risque d'hameçonnage pour vos clients. Dites-leur que le cabinet ne demande jamais leur mot de passe.
5. **Sous-domaine** :
   - faites **vérifier le domaine `cabinet-tb.tn` dans GitHub** (étape 7.1 du README) : sinon, si le dépôt était un jour supprimé, un tiers pourrait publier un site sur `immo.cabinet-tb.tn` ;
   - si vous abandonnez le site, supprimez aussi l'enregistrement DNS `immo` ;
   - cochez **Enforce HTTPS**.
6. **Hébergement de GitHub Pages** :
   - il ne permet pas d'ajouter des en-têtes HTTP de sécurité ; la CSP est donc placée dans la page, ce qui couvre l'essentiel ;
   - un hébergement avec en-têtes (Cloudflare Pages, Netlify, OVH) permettrait d'ajouter `frame-ancestors`, HSTS et `Permissions-Policy`.
7. **Dépôt public ou privé** : un dépôt public est sûr, car il ne contient aucun secret. Le code y est cependant lisible. GitHub Pages sur un dépôt privé demande une offre GitHub payante.
8. **Bibliothèque Excel** :
   - `vendor/xlsx.full.min.js` est la version 0.20.3 de SheetJS, qui corrige les failles connues des versions 0.19.2 et antérieures ;
   - elle provient de la republication npm `@e965/xlsx`, car SheetJS ne publie plus sur npm ;
   - pour utiliser le fichier officiel, téléchargez `xlsx.full.min.js` (version 0.20.3 ou plus récente) depuis `https://cdn.sheetjs.com/` et remplacez le fichier du dossier `vendor/`.
9. **Données personnelles** : les adresses e-mail et raisons sociales relèvent de la loi organique n° 2004-63. Supabase héberge les données hors de Tunisie. Vérifiez les formalités auprès de l'INPDP (déclaration, transfert à l'étranger) et informez vos clients.
10. **Sauvegardes** :
   - exportez régulièrement depuis *Sauvegarde* ;
   - le fichier exporté contient toutes les données comptables de tous les clients : conservez-le chiffré ;
   - envisagez l'offre Supabase Pro pour les sauvegardes quotidiennes.
11. **Revue périodique** : consultez chaque mois le journal des connexions (échecs répétés, connexions inhabituelles) et la liste des clients actifs.
12. **Boîte e-mail** : comme l'e-mail est la seconde étape de connexion, la messagerie de chaque utilisateur doit être protégée (mot de passe distinct, double authentification de la messagerie). Pour le compte administrateur, activez en plus l'application d'authentification (`admin_totp_required = true`).
13. **Hameçonnage** : prévenez vos clients que le cabinet ne leur demandera jamais leur mot de passe ni leur code, ni par téléphone, ni par e-mail.
