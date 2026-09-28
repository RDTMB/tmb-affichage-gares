# Relecture adversariale — zone 4 : couche données `src/data/`, SQL, Edge Functions

Worktree `wt-data` au commit 0739500 (= `main`), 26/09/2026. Aucune base, aucun réseau. Toute mutation a été restaurée par `git checkout -- <fichier>` ; `git status --porcelain` est vide à la fin (section 6).

## 1. Périmètre couvert

**Lus en entier** : `src/data/provider.ts`, `supabase.ts`, `mock.test.ts`, `config.ts`, `index.ts` ; `supabase/schema.sql` ; les 22 migrations ; les 4 Edge Functions ; `supabase/tests/roles-rls.sql`, `verification-roles.sql`, `securite-advisors.sql`, `diagnostic-roles.sql`, `mesure-droits-proprietaire.sql`, `seed.sql`, `ajout-bandeau-veille`, `ajout-ciels`, `ajout-journal-exploitation`, `ajout-modeles`, `ajout-preuve-maj`, `ajout-sans-voyageurs`, `ajout-grilles` (hors JSON), `INFOS-PROJET.md` ; `outils/deployer-edge-functions.ps1` / `.cmd` ; `.github/workflows/deploy.yml` ; les 13 tests `src/data/*.test.ts` ; `src/core/roles.ts`, `src/core/surveillance-ecrans.ts` ; `docs/securite.md`, `docs/02` §1 §2 §5 §6 §7, `docs/mise-en-service.md` (entier), CLAUDE.md. Lu partiellement : `src/pages/ecran.ts` (démarrage, cadence, heartbeat), `src/pages/resilience.ts` (garde de `resynchronise`), `src/core/params.ts` (assainissement).

**Mock** : `mock.ts` (1 811 l.) n'a pas été lu ligne à ligne ; `mock.test.ts` l'a été. Verdict sur ce dernier : il exécute le `MockProvider` (localStorage et bus d'événements simulés) et teste des COMPORTEMENTS (création de journée, bascule Bellevue par différence, journal, rôles, affluence, commanditaire) — pas des mocks tautologiques. Il ne prouve rien du `SupabaseProvider`, ce que son en-tête dit.

**Mutations** : 24 mutations éprouvées (12 survivantes, 12 tombées) + 1 exécution de démonstration (test temporaire, supprimé). Build refait dans le worktree : `npm run build` OK ; suite de référence relancée une fois en entier : 79 fichiers / 2 334 tests verts (avec MUT-06 appliquée, voir Z4-03).

**Non couvert et pourquoi** : tout ce qui exige une base (RLS réelle, déclencheurs, `cron.job_run_details`, coffre, Brevo) — section 5 ; le rendu des pages (zone pages) ; `roles-multiples.sql` §5 (reprise) n'a été lu que pour sa logique.

## 2. Constats

### Z4-01 — Le guetteur ne lit jamais `error` : une lecture en échec devient « 0 surveillés, aucun défaut », réponse 200, aucune trace
- Famille : 2 (contrôle inerte)
- Où : `supabase/functions/alerte-ecrans/index.ts:408-414` (trois lectures déstructurées `{ data }` sans `error`) ; écritures l.531-545, 551, 561-564 jamais contrôlées non plus. Banc de test : `src/data/alerte-ecrans.test.ts:612-614` (`repond` rend toujours `error: null`).
- Preuve : test temporaire exécutant LA fonction réelle (compilée comme le banc) avec un client dont toutes les lectures rendent `{ data: null, error: { message: 'permission denied for table ecrans' } }` → `statut=200`, corps `{"surveilles":0,"en_defaut":0,…}`, écriture `surveillance_etat = { derniere_execution: <maintenant>, dernier_resultat: "0 surveillés, aucun défaut" }`, 0 courriel, `console.error` vide. Aucun test existant ne fait échouer une lecture.
- Coût : une clé secrète révoquée, une table renommée, une panne PostgREST → la supervision affiche « Surveillance active — dernier passage il y a N min » (vert) alors que plus personne ne regarde : le défaut du 19/09 revient, déguisé en bonne santé, sur le lot qui existe pour l'empêcher. Si c'est la lecture de `alertes_ecran` seule qui échoue, chaque passage renvoie un courriel (l.454 : `!ligne`) : 12 courriels par heure.
- Catégorie : Ouvert
- Pour : Myosotis (correctif : lire `error`, répondre 500 et écrire l'échec dans `dernier_resultat`) ; Thomas (savoir que la pastille verte ne prouve pas la lecture)
- Confiance : haute (exécution)

### Z4-02 — Les garde-fous SQL ne sont verrouillés que par des MOTS : quatre inversions de règle survivent aux tests
- Famille : 2
- Où : `src/data/securite.test.ts:432-441` (purge), `1208-1227` (identité écran), `303-310` (« Personne ne modifie ses propres rôles »), `324-355` (quorum) ; `src/data/session-et-purge.test.ts:142-153`.
- Preuve (mutations, chacune restaurée) :
  - MUT-03 `purge_journal_exploitation` : `if auth.uid() is not null and not a_le_role('technique')` → `is null` (le garde ne refuse plus aucun connecté), dans schema.sql:1778 ET migrations/2026-09-purge-journal-bornee.sql:50 → `securite` + `session-et-purge` : **388 verts**.
  - MUT-04 `proteger_identite_ecran` schema.sql:1398 même inversion → **371 verts**.
  - MUT-05 `proteger_profils_roles` schema.sql:1195 `if cible = auth.uid()` → `if false` → **371 verts** (le test cherche la chaîne du message, l.308).
  - MUT-08 `verifier_quorum_roles` schema.sql:1255 `= 0` → `< 0` (ne lève jamais) → **371 verts**.
- Coût : un lot qui affaiblit un garde-fou d'une ligne passe l'intégration verte ; seule `roles-rls.sql`, jouée à la main sur la base de test, le verrait. CLAUDE.md et docs/02 présentent ces garde-fous comme « verrouillés par securite.test.ts ».
- Catégorie : Ouvert (limite connue des tests de texte, que `securite.test.ts:1-5` énonce ; mais les intitulés promettent plus qu'ils ne tiennent)
- Pour : Myosotis
- Confiance : haute

### Z4-03 — L'horodatage serveur du signal de vie (garde-fou n° 3) n'a AUCUN test
- Famille : 2
- Où : `supabase/schema.sql:1118-1140` (`horodate_signal_de_vie`, `trg_signal_de_vie`) ; `migrations/2026-08-signal-de-vie-serveur.sql`. `grep -rl "horodate_signal_de_vie\|trg_signal_de_vie" src --include=*.test.ts` : aucun fichier.
- Preuve : MUT-06 schema.sql:1124 `new.derniere_vue := now();` → `new.derniere_vue := new.derniere_vue;` → suite ENTIÈRE `npx vitest run src` : **79 fichiers / 2 334 verts**.
- Coût : la promesse de CLAUDE.md / docs/securite.md §4 (« forcé côté serveur ») peut disparaître d'une base neuve sans qu'un seul test rougisse ; la migration et schema.sql ne sont pas comparés entre eux pour cette fonction.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-04 — La règle absolue « ne JAMAIS étendre `--no-verify-jwt` » n'est verrouillée par rien
- Famille : 2
- Où : `outils/deployer-edge-functions.ps1:476-488` (le drapeau est bien limité à `alerte-ecrans` aujourd'hui) ; `securite.test.ts:814-907` (14 tests sur le script, aucun sur ce drapeau) ; `grep -rl "no-verify-jwt" src --include=*.test.ts` : aucun.
- Preuve : MUT-07 ajout de `'--no-verify-jwt'` à l'appel commun l.481 → `npx vitest run src/data` : **13 fichiers / 664 verts**.
- Coût : une retouche « pour simplifier » ouvre invitation, suppression de compte et traduction à tout Internet, intégration verte.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-05 — « Les bornes de schema.sql sont celles de la migration, au chiffre près » est satisfait par du texte VOISIN
- Famille : 2
- Où : `securite.test.ts:1070-1082` (`toContain(borne)` sur chaque fichier entier) ; `schema.sql:305` (params) et `:472` (`ecrans_vitesse_ticker_valide`, même chaîne `between 20 and 400`) ; `migrations/2026-08-params-forme.sql` : les requêtes de vérification l.49, 128, 132, 136 portent les mêmes bornes que les contraintes l.80, 164, 173, 182.
- Preuve : MUT-01 schema.sql:305 `between 20 and 400` → `500` → **371 verts** ; MUT-02 migration l.80 `-50 and 50` → `-60 and 60` (contrainte seule) → **371 verts**.
- Coût : exactement ce que le test annonce prévenir — « une base neuve plus permissive que la production » — sans qu'il tombe.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-06 — `commanditaire.test.ts` lit le fichier BRUT : un `revoke` mis en commentaire le satisfait
- Famille : 2
- Où : `src/data/commanditaire.test.ts:25-30` (`source()` sans retrait des commentaires, contrairement à `instructions()` de `securite.test.ts`), `:92`, `:165-167` (`toContain('revoke all on circulations from anon;')`) ; `schema.sql:748`.
- Preuve : MUT-09 schema.sql:748 → `-- revoke all on circulations from anon;` → `commanditaire` + `securite` + `scripts-sql` : **402 verts**.
- Coût : sur une base neuve, `anon` garderait la lecture en bloc de `circulations` (commanditaire compris) pendant que les six tests « anon ne lit PAS le commanditaire » restent verts.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-07 — Le test « le déclencheur du journal garde TOUTES ses colonnes » ne lit pas la liste `update of`
- Famille : 2
- Où : `alerte-ecrans.test.ts:439-462` (ne collecte que les noms entre apostrophes = arguments du traceur) ; `schema.sql:1752-1760` ; le piège est nommé dans `migrations/2026-09-alerte-ecrans.sql:231-234`.
- Preuve : MUT-25 `surveille` retiré de la liste `update of` (gardé dans les arguments) → `alerte-ecrans` + `securite` : **423 verts**.
- Coût : le retrait d'un poste du service cesse d'être tracé au journal, en silence.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-08 — `traduire` et `inviter-utilisateur` ne sont exécutées par aucun test : deux règles de docs/securite.md §3 sont sans verrou
- Famille : 2
- Où : `supabase/functions/traduire/index.ts:147` (« profil actif portant au moins un rôle ») ; `inviter-utilisateur/index.ts:230-233` (« le compte Auth est supprimé si l'écriture du profil échoue ») ; `cles-edge-functions.test.ts:105-128` ne compile que le bloc des clés. `supprimer-utilisateur` et `alerte-ecrans` ont, eux, un banc complet.
- Preuve : MUT-29 (`|| !nbRoles` retiré) → **664 verts** ; MUT-30 (`deleteUser` retiré de `annuler`) → **664 verts**.
- Coût : régression possible sans rougir sur le quota DeepL et sur les comptes fantômes (« invisible de la supervision et impossible à réinviter », docs/securite.md l.137-138).
- Catégorie : Ouvert (le précédent — banc de `supprimer-utilisateur` — existe et se reproduit)
- Pour : Myosotis
- Confiance : haute

### Z4-09 — Rejouer `2026-09-roles-multiples.sql` (annoncé rejouable, prescrit sur base NEUVE par la doc) supprime CINQ politiques qu'il ne recrée pas
- Famille : 1 (régression)
- Où : `migrations/2026-09-roles-multiples.sql:313-327` (drop dynamique : `qual`/`with_check` contenant `a_le_role`, `a_un_des_roles`, `peut_*`, ou `policyname like 'roles: %'`) ; §6 l.600-792 ne recrée pas `roles: affluence`, `roles: alertes lecture`, `roles: surveillance lecture` (`comm -23` des `create policy "roles: …"` de schema.sql vs migration) ni `onglets: reglage` / `onglets: masquage` (schema.sql:1044-1047, `with check`/`using` sur `a_le_role`, donc visées par le motif) ; contrôle final §11 l.1222-1236 ne liste ni `affluence`, ni `onglets_par_role`, ni `alertes_ecran`, ni `surveillance_etat` ; `docs/mise-en-service.md:58-63` (« À passer en dernier » sur base neuve) et `:94-95` (« le rejeu est lui-même un contrôle »).
- Preuve : lecture croisée ci-dessus (motif de drop + liste recréée + liste contrôlée).
- Coût : après le rejeu — ou l'installation neuve telle que documentée — le guichet ne peut plus déclarer un train complet, la supervision perd la lecture du guetteur (tables refusées → « JAMAIS lancée »), le technique ne peut plus régler les onglets ; « Success. No rows returned ».
- Catégorie : Ouvert
- Pour : Thomas (ne pas rejouer ce script sur une base en service avant correctif ; vérifier la production, section 5) et Myosotis
- Confiance : haute (lecture sans ambiguïté)

### Z4-10 — Des scripts « rejouables » plus anciens que schema.sql régressent le journal et la purge quand on les rejoue — et la procédure d'installation les rejoue
- Famille : 1
- Où : `supabase/ajout-journal-exploitation.sql:175-181` (trg_journal_circulations sans `commanditaire`, `nature`, `libelle`, `acces`), `:224-231` (trg_journal_ecrans sans `vitesse_ticker_px_s`, `surveille`), `:244-257` (purge SANS la borne `mois >= 1`) — étape 8 de `docs/mise-en-service.md` §B, après `schema.sql` ; `migrations/2026-09-roles-multiples.sql:1177-1190` (§10, purge sans borne) — étape 14 ; `migrations/2026-09-vitesse-par-ecran.sql:26-35` (trg_journal_ecrans sans `surveille`) ; `2026-09-libelle-course.sql:71-78` et `2026-09-train-special-A.sql:124-131` (trg_journal_circulations sans `acces`, A aussi sans `libelle`). Tests : `securite.test.ts:432-441` ne vérifie que la présence du contrôle de rôle dans la purge ; `session-et-purge.test.ts:179-192` ne compare que schema ↔ migration purge-journal-bornee.
- Preuve : lecture ; chaque script est idempotent pris seul, aucun ne l'est dans l'ordre documenté.
- Coût : une base montée selon la doc naît avec six colonnes de journal en moins et une purge à `0` mois possible (F-01 rouvert) ; à la reprise, rejouer une migration « sûre » retire une colonne du journal sans message.
- Catégorie : Ouvert (une seule source d'installation : schema.sql + seed + textes ; ou faire porter la liste de colonnes par une fonction unique)
- Pour : Myosotis ; Thomas pour la doc §B
- Confiance : haute

### Z4-11 — `params.alertes_destinataires` (adresses du personnel) est lisible avec la clé publiable
- Famille : 1 (posture documentée non tenue)
- Où : `schema.sql:765` (`create policy "lecture publique" on params for select using (true)`), aucun `revoke select … from anon` ni droit de colonne sur `params` ; `migrations/2026-09-alerte-ecrans.sql:181-184` et `schema.sql:1904-1907` ne raisonnent que sur l'ÉCRITURE ; `src/data/supabase.ts:540` (`from('params').select('cle, valeur')` sans filtre : les six écrans reçoivent la liste toutes les 30 s ; `paramsValides` l'écarte ensuite, `src/core/params.ts:242`, donc pas dans l'instantané localStorage). Posture contraire prise trois écrans plus haut pour `affluence.maj_par` : `schema.sql:705-709` (« anon, c'est la clé publiable, donc tout Internet »).
- Preuve : lecture ; geste de vérification en section 5.
- Coût : `GET /rest/v1/params?cle=eq.alertes_destinataires` avec la clé du bundle rend la liste des destinataires d'alerte de la Régie.
- Catégorie : Ouvert
- Pour : Thomas (décision : accepter, ou sortir la clé de `params` / la lire par droit de colonne) ; Myosotis
- Confiance : haute

### Z4-12 — « roles: params technique » n'a aucun filtre de clé : le technique écrit météo, vitesse, mode médias, délai à quai — docs/securite.md dit « — »
- Famille : 1 (SQL ≠ doc)
- Où : `schema.sql:988-990` (`using ((select private.a_le_role('technique')))`, sans `cle in (…)`) ; `docs/securite.md:51-54` (technique « — » sur les trois premières lignes de `params`) ; `docs/02:195-205` (« tout le reste ») ; `src/core/roles.ts:174-186` (le technique n'a pas `bandeau` : l'interface masque ce que la base accorde) ; `roles-rls.sql:817-828` n'éprouve que « technique écrit la veille » et « pas le terminus », jamais « pas la météo ».
- Preuve : lecture.
- Coût : la frontière réelle (RLS) est plus large que celle que le document de reprise annonce ; un compte technique compromis réécrit le bandeau de six gares.
- Catégorie : Ouvert (décision : ajouter `cle not in (…)` ou corriger le tableau)
- Pour : Thomas
- Confiance : haute

### Z4-13 — Documentation périmée sur six points, dont le tableau des droits
- Famille : 1
- Où et preuve :
  - `docs/securite.md:49-60` : caisse marquée « — » sur `medias`, `params mode_medias/duree_horaires_s`, `ecrans (rechargement, veille)` alors que le SQL l'accorde depuis le 06/09 (`schema.sql:938-940, 976-984, 1104-1106`).
  - `docs/02:359-364` : « SEIZE colonnes » puis liste de 17 sans `acces` ; la base en accorde 18 (`schema.sql:749-753`).
  - `docs/02:313-316` : journal `ecrans` sur 5 colonnes ; le SQL en trace 7 (`schema.sql:1752-1760`).
  - `src/data/supabase.ts:58, 579` : « 6 écrans toutes les 30 s » ; le heartbeat bat toutes les 60 s (`src/pages/affichage-commun.ts:713`, docs/02:626).
  - `docs/mise-en-service.md:484-503, 526` : décrit un repli sur `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` et une mention « À RETIRER » que le code n'a plus et que `cles-edge-functions.test.ts:174-203` INTERDIT.
  - `docs/mise-en-service.md:561-562` : « roles-rls.sql (se termine par un rollback) » — faux, le script dit le contraire (`roles-rls.sql:11-15`).
  - `docs/securite.md §4` et CLAUDE.md : le résidu « un tiers peut faire paraître vivant un poste éteint » n'y figure pas ; il est nommé dans `securite-advisors.sql:450-460` seulement (voir section 3).
- Coût : Myosotis reprendra le modèle de droits et la procédure sur des documents faux ; la ligne « legacy » fait chercher un repli qui n'existe plus.
- Catégorie : Ouvert
- Pour : Myosotis (doc) ; Thomas relit le tableau §2
- Confiance : haute

### Z4-14 — `inviter-utilisateur` recopie la liste des rôles ; un cinquième rôle du catalogue serait filtré en silence
- Famille : 3 (double énonciation) — et docs/securite.md:127-128 promet « jamais recopiée »
- Où : `supabase/functions/inviter-utilisateur/index.ts:24` (`ROLES_CONNUS`), `:54-62` (`rolesDemandes` filtre sur cette liste), alors que le catalogue est déjà lu l.198. Un rôle inconnu de la liste disparaît de `roles` et la réponse `{ ok: true, roles }` (l.251) affiche la liste amputée.
- Preuve : lecture.
- Coût : à la première extension du catalogue (SSO, docs/02 §7), l'invitation « réussit » avec des rôles en moins, sans erreur.
- Catégorie : Ouvert (filtrer sur `catalogue.map(r => r.code)`)
- Pour : Myosotis
- Confiance : haute

### Z4-15 — Le sondage 30 s n'est pas un « repli » : il est inconditionnel et DOUBLÉ, à dix requêtes par passage
- Famille : 4
- Où : `src/data/supabase.ts:588-589` (`window.setInterval(() => this.notifie(), 30_000)` dès le premier `onChange`, jamais `clearInterval`, sans regarder l'état du canal ; commentaire l.4 « repli polling 30 s ») ; `src/pages/ecran.ts:893` (second `setInterval(() => sync?.resynchronise(), 30_000)`) ; une resynchronisation = `getGrilles` (1 requête métadonnées, cache invalidé à chaque `notifie`, l.600), `getParams` (4), `getMessages` (1), `getJour` (2), `getMedias` (1), `getAffluence` (1) = 10 requêtes REST (`ecran.ts:846-851`, `supabase.ts:539-544`) ; `src/pages/resilience.ts:90` ne dédoublonne que si la première est encore en vol quand la seconde arrive 300 ms plus tard. `docs/02:284-286` : « repli polling 30 s ».
- Mesure : 10 à 20 requêtes / 30 s / écran → 21 600 à 43 200 requêtes par écran et par jour de 18 h, 130 000 à 260 000 pour six gares, en plus du temps réel censé rendre le sondage inutile, et des 1 080 heartbeats/jour/écran.
- Coût : trafic 5G du Nid d'Aigle et quota Supabase consommés pour rien ; le canal temps réel n'a aucun rapport d'état (aucun `subscribe((status) => …)`, l.587) : s'il tombe, rien ne le dit, ce qui est sans doute la raison inavouée du sondage permanent.
- Catégorie : Ouvert (décision : sondage unique, conditionné à l'état du canal)
- Pour : Myosotis ; Thomas (coût réseau)
- Confiance : haute

### Z4-16 — Le mock de démonstration part en gare : `ecran.html` précharge un chunk qui le contient
- Famille : 4
- Où : `src/data/index.ts:10` (import statique de `./mock`) ; `src/pages/ecran.ts:55` (`import { creeProviderDemo, creeProviderReel } from '../data'`) ; build du worktree : `dist/ecran.html` porte `<link rel="modulepreload" href="/assets/supervision-logique-….js">`, chunk de 93 981 octets (29 798 gzip) qui contient `tmb-mock-etat`, `tmb-mock-ecrans`, `technique+admin@demo`. `ecran-….js` lui-même : 478 992 octets (223 478 gzip) ; total JS préchargé par un écran ≈ 328 Ko gzip (sous la limite CLAUDE.md de 400 Ko).
- Preuve : `grep -c` sur `dist/assets/supervision-logique-*.js` ; `grep modulepreload dist/ecran.html`.
- Coût : 30 Ko gzip téléchargés par chaque Raspberry à chaque rechargement pour du code que `modeDonnees()` interdit d'exécuter hors `?demo=1` ; le mock évolue à chaque lot et grossit ce chunk.
- Catégorie : Ouvert (`import()` dynamique dans `creeProvider*`)
- Pour : Myosotis
- Confiance : haute (mesuré)

### Z4-17 — `roles-rls.sql` ne rejoue pas les instructions que le front envoie vraiment, sur dix chemins
- Famille : 2
- Où (front → recette) : heartbeat anonyme `UPDATE ecrans … RETURNING recharger_demande_at, veille_debut, veille_fin, vitesse_ticker_px_s` (`supabase.ts:612-629`) → aucun cas anonyme sur `ecrans` (seulement la vérification manuelle (d) de `securite-advisors.sql:375-380`) ; `declareEcran`/`oublierEcran` par technique (INSERT/DELETE `.select()`) → seuls les refus supervision/caisse sont joués (l.307-319, 783-801) ; `genererJour` par technique (`INSERT circulations … on conflict do nothing`, l.769-771) → jamais joué (`roles: circulations regeneration`) ; `supprimerTrainSup` (DELETE circulations par supervision, l.887-895) → jamais ; `saveGrille` (INSERT grilles) → seul un `update commentaire` (l.297) ; `saveMessage` positif caisse/supervision (INSERT/UPDATE messages) → seul le refus technique (l.868) ; `logPublication` (INSERT publications) → jamais ; `saveParams`/`saveMachine`/`saveMotif`/`saveCiel` en UPSERT (`on conflict … do update set cle = …`, l.1093-1148) → la recette n'écrit que des `update` (l.280-297, 581-610).
- Preuve : lecture croisée ; la leçon du 10/09 (`roles-rls.sql:626-631`) n'a été appliquée qu'à `affluence` et au spécial.
- Coût : « recette verte, production refusée » peut se rejouer sur chacun de ces chemins.
- Catégorie : Ouvert
- Pour : Myosotis (compléter la recette, la jouer sur la base de test)
- Confiance : moyenne (sans base, on ne sait pas lesquels refuseraient vraiment)

### Z4-18 — Deux croyances contradictoires sur l'éditeur SQL de Supabase cohabitent dans le dépôt
- Famille : 3
- Où : « une table temporaire ne survit pas d'une instruction à l'autre » — `migrations/2026-09-roles-multiples.sql:75-81`, `securite.test.ts:682-688` (test qui l'impose), `docs/mise-en-service.md:97-109` ; « elle survit » — `diagnostic-roles.sql:31-38` puis `:491-493` (rapport lu par une instruction SÉPARÉE), `verification-roles.sql:19-26` puis `:226-228`, et `remise-a-zero.sql:39-47` (un `set local` posé par une instruction, lu par un `do` séparé). La migration cite elle-même un rapport du diagnostic (`:496-497`, « diagnostic §8 »), donc la seconde croyance a marché au moins une fois.
- Preuve : lecture.
- Coût : si la première est vraie, les deux recettes ne rendent jamais leur tableau et la remise à zéro refuse toujours ; si elle est fausse, la règle « aucune table temporaire » et son test contraignent pour rien. Dans les deux cas Myosotis héritera d'un faux savoir.
- Catégorie : Ouvert (trancher par le geste de la section 5)
- Pour : Thomas (geste de 30 s) ; Myosotis
- Confiance : moyenne

### Z4-19 — La contrainte de `nature` n'a pas le même nom sur une base neuve et sur une base migrée
- Famille : 3
- Où : `schema.sql:66-67` (contrainte en ligne, auto-nommée `circulations_nature_check`) ; `migrations/2026-09-train-special-A.sql:73-76` (`circulations_nature_valeurs`) ; vérification de `train-special-B.sql:171-179` attend trois noms → deux sur une base neuve ; aucun script ne cite `circulations_nature_check`.
- Coût : mineur ; une vérification de reprise donnera 2 lignes au lieu de 3 sans explication.
- Catégorie : Ouvert
- Pour : Myosotis
- Confiance : haute

### Z4-20 — Trois défauts mineurs de la couche données
- Famille : 3 / 1
- Où et preuve :
  - `supabase.ts:1350-1358` : `publications.qui` est fourni par le CLIENT (`auth.user?.email ?? 'inconnu'`), aucun déclencheur ne le force — l'auteur d'une publication est réécrivable par tout compte connecté, à l'inverse du journal d'exploitation (`docs/securite.md:87-89`).
  - `supabase.ts:1081` : `deleteMedia` ignore l'erreur du `select('chemin')` (`const { data }`) → la fiche est supprimée et le fichier reste orphelin dans le bucket.
  - `src/data/config.ts:99-120` + `src/pages/supervision.ts:1041` : une configuration PARTIELLE (URL présente, clé vide) fait tomber la supervision sur le mock (`index.ts:17`) pendant que la pastille, calculée sur l'URL seule, annonce « PRODUCTION » ; l'écran, lui, répond « aucune » (écran neutre), ce qui est juste. `refProjet` accepte tout hôte contenant « supabase » (`:82`).
- Catégorie : Ouvert (mineurs)
- Pour : Myosotis
- Confiance : haute (lecture) ; moyenne pour le rendu de la pastille (non exécuté)

### Z4-21 — Un anonyme peut tenir « vivant » un poste éteint : le guetteur du 19/09 est neutralisable par la clé publique, et la décision qui l'autorise lui est antérieure
- Famille : 1 (l'hypothèse de la décision a changé)
- Où : `schema.sql:1090-1091` (`"signal de vie" … using (true) with check (true)` : aucune liaison entre l'appelant et l'`id`), `:1059-1060` (`derniere_vue` accordée), `:1123-1125` (le serveur force `now()` — donc un `UPDATE` anonyme sur n'importe quel `id` REND le poste vivant) ; `alerte-ecrans/index.ts:411` ne lit que `derniere_vue` ; identifiants découvrables par `SELECT id FROM ecrans` anonyme (`schema.sql:766`). Décision assumée datée du 29/08/2026 (`securite-advisors.sql:440`) ; le résidu est reconnu `securite-advisors.sql:450-460` (« RENVOYÉ À LA RELECTURE GÉNÉRALE D'AVANT TRANSFERT »), absent de `docs/securite.md §4` et de CLAUDE.md, qui n'énoncent que les trois garde-fous.
- Preuve : lecture (surface détaillée en section 3).
- Coût : un `PATCH /rest/v1/ecrans?id=eq.<poste>` toutes les cinq minutes avec la clé du bundle supprime toute alerte pour ce poste, sans trace (le journal exclut ces colonnes) ; l'erreur va dans le sens du faux « tout va bien », l'inverse de ce que `schema.sql:1084-1087` promet pour `donnees_maj`.
- Catégorie : Ne se corrige pas en phase 1 (décision du 29/08/2026 ; « pas de correctif court », fermeture phase 2 par le micro-serveur) — MAIS la documentation du risque est Ouverte : docs/securite.md §4 doit le nommer maintenant que le guetteur existe
- Pour : Thomas (décision ré-actée en connaissance du guetteur) ; Myosotis (dossier de reprise)
- Confiance : haute

## 3. La surface exacte du signal de vie anonyme (`ecrans`, rôle `anon`)

**Lecture (SELECT)** — `schema.sql:766` `create policy "lecture publique" on ecrans for select using (true)` ; aucun `revoke select … from anon`, aucun droit de colonne : `anon` lit les **13 colonnes** — `id, gare, type, derniere_vue, donnees_maj, date_affichee, version_app, reseau, recharger_demande_at, veille_debut, veille_fin, vitesse_ticker_px_s, surveille`. Les identifiants déclarés se découvrent donc par `GET /rest/v1/ecrans?select=id` avec la clé publiable ; le heartbeat en dépend (`supabase.ts:629`, `RETURNING recharger_demande_at, veille_debut, veille_fin, vitesse_ticker_px_s`). Les migrations `vitesse-par-ecran` (l.19) et `alerte-ecrans` (l.95) ont AJOUTÉ deux colonnes lisibles sans le dire (`surveille` est ainsi public).

**Écriture (UPDATE)** — `schema.sql:1058` `revoke insert, update, delete, truncate on ecrans from anon` ; `:1059-1060` `grant update (derniere_vue, donnees_maj, date_affichee, version_app, reseau)` — les « cinq colonnes seulement » de docs/securite.md §4 sont toujours vraies ; `:1090-1091` `create policy "signal de vie" on ecrans for update to anon using (true) with check (true)` → **toute ligne**, aucun lien entre l'appelant et l'`id`. INSERT et DELETE : refusés (revoke + aucune politique). `caisse-medias-ecrans.sql` et `maj-honnete.sql` ne touchent pas à cette surface.

**Déclencheur `trg_signal_de_vie`** (`schema.sql:1118-1140`, BEFORE UPDATE, toutes colonnes) : si `derniere_vue` change → forcée à `now()` (une valeur envoyée ne compte pas, y compris NULL : `NULL is distinct from <valeur>` → `now()`) ; si `donnees_maj` change et n'est pas NULL → `least(valeur, now())` ; **NULL accepté** (efface la preuve de fraîcheur) ; `date_affichee` (date), `version_app`, `reseau` (texte libre, sans longueur) : libres, affichés en supervision (l'échappement relève de la zone pages). Le journal n'écrit rien pour ces colonnes (`trg_journal_ecrans`, `:1752-1760`) : un abus ne laisse **aucune trace**.

**Ce qu'un anonyme qui connaît l'`id` d'un AUTRE poste peut faire** :
1. le rendre **vivant** indéfiniment (`{"derniere_vue":"x"}` toutes les ≤ 10 min) → guetteur : jamais de défaut, jamais de courriel ; supervision : pastille verte (Z4-21) ;
2. le rendre **périmé** : `donnees_maj` ancienne ou NULL, `date_affichee` fausse → fausse alerte de fraîcheur (sens documenté comme acceptable, `schema.sql:1084-1087`) ;
3. écrire n'importe quoi dans `version_app` / `reseau` ;
4. cadence : aucune limite côté base (PostgREST/Supabase seuls) ; sans trace.

**Ce qu'il ne peut pas faire** : recharger (`recharger_demande_at` hors grant), déplacer (`gare`, `type`), déclarer, oublier, régler veille/vitesse/`surveille`. Ces cinq refus sont ceux que les tests de texte verrouillent (`securite.test.ts:454-472`, acquittement MUT-18 voisin sur `affluence`).

## 4. Suspects éprouvés et acquittés

| Test | Mutation (restaurée) | Verdict |
|---|---|---|
| alerte-ecrans.test.ts | MUT-10 : comparaison `CLE_GUETTEUR` déplacée APRÈS les trois lectures | rouge — 3 tests (refus « ne lit RIEN », l.319-325, 761-788) |
| alerte-ecrans.test.ts | MUT-11 : copie Deno `SEUIL_DEFAUT_MS = 11 * 60_000` | rouge — 3 tests |
| alerte-ecrans.test.ts | MUT-12 : copie Deno `estAuRepos` → `false` (exclusion veille retirée) | rouge — 2 tests (confrontation sur >5 000 combinaisons) |
| alerte-ecrans.test.ts | MUT-13 : refus Brevo (`!reponse.ok`) traité en succès, sans trace | rouge — 1 test |
| securite.test.ts | MUT-14 : `and (select private.peut_attribuer(role))` commenté dans « roles: liaison attribution » | rouge — 1 test |
| commanditaire.test.ts | MUT-15 : `commanditaire` ajoutée au grant `anon` de `circulations` | rouge — 4 tests |
| maj-honnete.test.ts | MUT-16 : `trg_maj_params before update` → `after update` | rouge — 3 tests |
| securite.test.ts | MUT-17 : « roles: params technique » élargie à `caisse` | rouge — 2 tests |
| securite.test.ts | MUT-18 : `maj_par` ajoutée au grant `anon` de `affluence` | rouge — 2 tests |
| cles-edge-functions.test.ts | MUT-19 : `NOM_CLE = 'defaut'` dans `traduire` (copies divergentes) | rouge — 1 test |
| suppression-compte.test.ts | MUT-20 : retrait des rôles par la clé secrète (`admin`) au lieu du jeton | rouge — 4 tests (trace + texte) |
| securite.test.ts | MUT-22 : `grant select, update on roles to authenticated` | rouge — 1 test |
| deploy.yml (hors mutation) | le `sed` de `REF_PROJET_PRODUCTION` exécuté sur `src/data/config.ts` | rend `csstkdcqdzaiibfqrscv` : motif conforme |

Taux de survie : 12 survivantes / 24 mutations (Z4-01 à Z4-08 en portent 12 : MUT-01, 02, 03, 04, 05, 06, 07, 08, 09, 25, 29, 30). Les suspects visés ont survécu ; les acquittés sont les contrôles que je pensais mordre et qui mordent.

## 5. Non vérifiable ici

- **Production : Z4-09 a-t-il déjà eu lieu ?** `select tablename, policyname from pg_policies where tablename in ('affluence','onglets_par_role','alertes_ecran','surveillance_etat') order by 1,2;` → 7 lignes attendues (`lecture publique` + `roles: affluence`, `onglets: lecture/reglage/masquage`, `roles: alertes lecture`, `roles: surveillance lecture`).
- **Purge bornée en production ?** `select prosrc like '%mois < 1%' from pg_proc where proname = 'purge_journal_exploitation';` → `true` attendu ; **journal complet ?** `select pg_get_triggerdef(oid) from pg_trigger where tgname in ('trg_journal_circulations','trg_journal_ecrans');` → doit citer `acces` et `surveille`.
- **Z4-11** : `curl -H "apikey: <sb_publishable>" "https://<ref>.supabase.co/rest/v1/params?cle=eq.alertes_destinataires&select=valeur"` → une réponse 200 avec la liste confirme.
- **Z4-21** : depuis un terminal, `curl -X PATCH -H "apikey: <sb_publishable>" -H "Content-Type: application/json" -d "{\"derniere_vue\":\"2000-01-01\"}" "https://<ref>.supabase.co/rest/v1/ecrans?id=eq.<un poste éteint>"` puis lire `derniere_vue` → `now()` attendu (c'est la surface décrite, pas une supposition).
- **Z4-18** : coller dans l'éditeur SQL, d'un bloc : `create temporary table t(x int); insert into t values (1); select * from t;` — une ligne rendue = la table survit ; sinon `diagnostic-roles.sql` et `verification-roles.sql` ne peuvent pas rendre leur rapport, et `remise-a-zero.sql` ne peut jamais s'exécuter.
- **Guetteur réellement armé** : `select jobname, schedule, active from cron.job;` ; `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` ; `select status_code, left(content::text,120) from net._http_response order by created desc limit 3;` ; `select name from vault.decrypted_secrets;` (deux noms attendus : `url_alerte_ecrans`, `cle_guetteur`) ; `select derniere_execution, now() - derniere_execution from surveillance_etat;`.
- **`--no-verify-jwt` réellement limité à `alerte-ecrans`** : `npx supabase@2.116.0 functions list --project-ref <ref>` → colonne VERIFY JWT : `false` pour la seule `alerte-ecrans`.
- **Z4-17** : ajouter les dix cas manquants à `roles-rls.sql` et la jouer sur la base de test.
- **Nettoyage joué ?** `select column_name from information_schema.columns where table_name = 'profils' and column_name = 'role';` → 0 ligne attendue (schema.sql n'a plus la colonne).
- **RLS réelle** de tout ce que Z4-02 et Z4-03 ne peuvent prouver en texte : `roles-rls.sql` sur la base de test (elle couvre le quorum §5, l'attribution §2, l'identité d'écran §4 ; pas l'horodatage).

## 6. Compte

- Constats : 21 — Famille 1 : 6 (Z4-09, 10, 11, 12, 13, 21) ; Famille 2 : 9 (Z4-01 à 08, 17) ; Famille 3 : 4 (Z4-14, 18, 19, 20) ; Famille 4 : 2 (Z4-15, 16).
- Catégories : Ouvert 20 ; Ne se corrige pas 1 (Z4-21, avec sa moitié documentaire Ouverte).
- Pour : Myosotis 21 (dont 8 aussi pour Thomas : Z4-09, 10, 11, 12, 13, 15, 18, 21).
- Confiance : haute 18, moyenne 3 (Z4-17, Z4-18, la moitié pastille de Z4-20).
- Mutations : 24 faites (+ 1 exécution de démonstration avec test temporaire supprimé) ; 12 survivantes ; 12 tombées ; suite complète relancée une fois (2 334 tests).
- `git status --porcelain` final dans `wt-data` : vide (`dist/` ignoré).
