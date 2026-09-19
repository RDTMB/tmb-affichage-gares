# TMB — Affichage voyageurs en gare (v2)

Application web d'information voyageurs pour le Tramway du Mont-Blanc (Régie
Départementale, Haute-Savoie) : écrans dynamiques dans 6 gares + poste de
supervision. Ligne à crémaillère, voie unique, 12,8 km, Le Fayet (580 m) →
Nid d'Aigle (été seulement), 4 rames : Marie, Anne, Jeanne, Marguerite.

## Quoi lire, et quand

Ce fichier est un AIGUILLAGE, pas un cours. Il ne garde que ce qui est vrai
pour TOUT lot ; le reste vit à côté et s'ouvre quand la question se pose.
N'ouvre pas ces fichiers « pour voir » : chacun coûte ce qu'il pèse, à chaque
session, et une session qui corrige un bandeau CSS n'a rien à faire des
règles d'appariement des rames.

Les colonnes de gauche décrivent CE QUE TU T'APPRÊTES À FAIRE, pas le nom
d'un sujet : si tu dois déjà savoir que tu « fais des horaires », l'aiguillage
n'aiguille rien.

| Tu t'apprêtes à… | Ouvre |
| --- | --- |
| calculer ou déplacer une heure, limiter un terminus, retirer une desserte, numéroter ou nommer un train, choisir la grille d'une journée | `.claude/regles-horaires.md` |
| changer ce qu'un écran de gare ou la grille du jour MONTRE : colonnes, pastilles de remplissage, compte à rebours, train barré, mode dégradé, messages | `.claude/regles-affichage.md` |
| créer ou modifier une course qui ne vient pas de la grille : spécial affrété, libellé libre, accès public / privé / mixte | `.claude/regles-courses-libres.md` |
| toucher une couleur, une police, un logo, un espacement — ou reproduire une maquette | `.claude/charte-graphique.md` |

Les documents longs se lisent de la même façon : à la QUESTION, jamais « avant
de coder ». `docs/01` et `docs/02` pèsent à eux deux ~33 000 tokens — les
ouvrir par principe coûte plus que tout le reste réuni.

| Tu te demandes… | Ouvre |
| --- | --- |
| ce que l'exploitant a demandé exactement : règles métier détaillées, cas limites, matrice des droits (§5.5) | `docs/01-spec-fonctionnelle.md` |
| comment c'est bâti : architecture, schéma de données, RLS, déploiement, surveillance | `docs/02-spec-technique.md` |
| ce qui reste à faire, et à quoi on reconnaît qu'une étape est finie | `docs/03-plan-de-developpement.md` |
| comment l'exploitation charge une grille, et ce qu'un Excel doit contenir | `docs/import-grilles.md`, `docs/format-excel-horaires.md` |
| qui a le droit de quoi, et comment RLS le tient | `docs/securite.md` |
| comment on met en ligne, et comment on recette à la main | `docs/mise-en-service.md`, `docs/tests-manuels.md` |
| comment un écran de gare démarre sur son Raspberry Pi | `docs/kiosque.md` |

## Stack et contraintes

- **Vite + TypeScript, sans framework** (vanilla). Cibles : Raspberry Pi en
  navigateur kiosque (écrans) + navigateurs récents (supervision).
- Multi-pages : `index.html` (portail de test), `ecran.html`, `grille.html`,
  `supervision.html`.
- **Couche d'accès aux données interchangeable** : interface `DataProvider`
  (`src/data/provider.ts`). Phase 1 `SupabaseProvider`, phase 2 `ApiProvider`
  (micro-serveur Windows). AUCUN appel Supabase hors de `src/data/`.
- Bundle JS < 400 Ko gzippé hors polices ; re-rendu 1×/s max ; pas de fuite
  mémoire (18 h/jour d'affichage).
- Import Excel : `src/core/lecture-xlsx.ts` (lecteur .xlsx maison sur
  `fflate`, chargé à la demande par la supervision UNIQUEMENT — jamais dans
  les bundles des écrans) et `src/core/import-grille.ts` (cellules → Grille,
  validation, PUR et testé sur les cellules du document réel en
  `src/core/__fixtures__/`).

## Conventions

- UI voyageurs bilingue FR + EN ; code en anglais ; commentaires en français.
- TypeScript `strict`, Prettier. Fuseau Europe/Paris, format `HH:MM`
  (les secondes des horaires officiels — ex. 07:27:30 — sont tronquées à
  l'affichage mais conservées dans les calculs).
- Gares (ordre de la ligne) : `le-fayet`, `saint-gervais`, `motivon`,
  `col-de-voza`, `bellevue`, `nid-daigle`.
- Toute logique horaire vit dans `src/core/horaires.ts`, PURE et testée
  (Vitest) ; l'heure y est toujours injectée (jamais `Date.now()` dans
  `src/core/`) pour permettre l'heure simulée `?simule=HH:MM[:SS]`
  (les secondes servent aux états « À QUAI » / « DÉPART IMMINENT », qui se
  jouent sur une fenêtre de 30 s).

## Sécurité — règles absolues

Cette section ne sort PAS, et c'est une exception assumée au principe
d'économie qui gouverne le reste du fichier : une règle qu'on ne doit jamais
manquer ne peut pas vivre derrière une lecture conditionnelle. Une session
qui n'ouvre pas le bon fichier ne doit jamais pouvoir committer un secret.

- Jamais de secret dans le code (dépôt public) : URL/clé Supabase via
  variables de dépôt → `config.js` généré au build. Le projet utilise la
  nouvelle génération de clés Supabase : la clé « publishable »
  (`sb_publishable_…`, voir `supabase/INFOS-PROJET.md`) est PUBLIQUE par
  conception — la sécurité repose sur RLS ; la clé « secret »
  (`sb_secret_…`) ne doit JAMAIS apparaître nulle part côté front.
- Écrans en lecture seule ; écritures réservées aux sessions authentifiées
  (RLS) ; rôles MULTIPLES et CUMULABLES — technique, admin, supervision,
  caisse — dont les droits s'additionnent sans qu'aucun n'implique un autre
  (table `profils_roles`, `private.a_le_role()` ; matrice docs/01 §5.5,
  docs/02 §5, docs/securite.md §2). Miroir de confort du front dans
  `src/core/roles.ts` ; recette RLS dans `supabase/tests/roles-rls.sql`.
- Supervision derrière connexion obligatoire.
- **Content-Security-Policy** en `<meta>` dans les QUATRE pages, identique
  partout (GitHub Pages n'autorise aucune en-tête HTTP). C'est un SECOND
  verrou : l'échappement (`echapper()`) reste la première défense. Elle
  interdit tout script injecté (`script-src 'self'`, sans `unsafe-inline` ni
  `unsafe-eval`) et n'autorise que ce que le code utilise vraiment —
  `img-src data:` (logos inlinés au build), `font-src data:` (Vite inline les
  `.woff` de repli), `style-src 'unsafe-inline'` (71 attributs `style=""` en
  supervision), Supabase en `https:` ET `wss:` sur le DOMAINE `*.supabase.co`
  et non une référence de projet (prod et base de test diffèrent).
  `frame-ancestors` est absente car ignorée dans un `<meta>`. Toute origine
  ajoutée doit être RELEVÉE dans le code, jamais supposée, et VÉRIFIÉE au
  navigateur console ouverte : une CSP qui casse l'affichage en gare serait
  pire que son absence. Verrouillée par `src/pages/demarrage-ecrans.test.ts`.
- **Guetteur d'écrans muets** (`alerte-ecrans`, docs/02 §6) : `pg_cron` +
  `pg_net` appellent l'Edge Function toutes les 5 min ; elle applique
  `src/core/surveillance-ecrans.ts` (10 min de silence, hors veille, hors
  postes décochés ou jamais vus) et envoie UN courriel par épisode via Brevo.
  Elle est déployée **sans vérification de jeton** — la base n'a pas de
  session à présenter — et son SEUL verrou est le secret partagé
  `CLE_GUETTEUR`, comparé avant toute lecture ; ne JAMAIS étendre
  `--no-verify-jwt` aux trois autres fonctions. La règle n'est énoncée qu'en
  TypeScript : le SQL ne sait rien de la veille, et la copie que porte la
  fonction Deno est compilée, exécutée et confrontée à l'originale
  (`src/data/alerte-ecrans.test.ts`). `surveillance_etat` porte l'heure du
  dernier passage, que la supervision affiche : une tâche planifiée inerte
  ressemble sinon à une flotte en bonne santé.
- Contraintes de FORME sur `params` (`schema.sql`, et
  `migrations/2026-08-params-forme.sql` pour une base existante) : la base
  refuse la valeur aberrante, ce que le front ne peut pas faire. Les deux
  copies doivent rester identiques (`src/data/securite.test.ts`).
- **Onglets visibles par rôle** (`onglets_par_role`, réglable en supervision) :
  la matrice droit × rôle et RLS restent le PLAFOND — cette table ne peut que
  RETRANCHER. `ongletsVisibles()` intersecte ce qu'elle lit avec ce que les
  droits ouvrent : une ligne forgée n'accorde RIEN. Ce n'est pas un mécanisme
  de permissions, c'est du rangement d'interface, et il ne doit jamais en
  devenir un. Deux replis vers la matrice du code (réglage indisponible, rôle
  sans ligne), jamais vers « aucun onglet ». Garde-fou d'enfermement en base :
  au moins un rôle portant `parametres.technique` garde l'onglet Utilisateurs
  (`trg_onglets_quorum`, différé + verrou consultatif) ; la liste y est écrite
  en dur et `securite.test.ts` la compare à `ROLES_QUI_ROUVRENT`.

## Commandes

```bash
npm run dev / build / test / preview
```

Deux commandes de session, dans `.claude/commands/` : `/lot` sort le squelette
d'un prompt de lot, `/verif` lance les quatre contrôles séparément et n'en
rapporte que le verdict.

## Definition of done (chaque étape)

1. `npm run build` (c'est lui qui lance `tsc` — `npm test` ne type-vérifie
   pas) et `npm run test` sans erreur ni warning TS.
2. Critères d'acceptation de l'étape (docs/03) vérifiés, y compris avec
   `?simule=` et en coupant le réseau quand c'est pertinent.
3. Rendu conforme aux maquettes (couleurs charte, colonnes alignées).
