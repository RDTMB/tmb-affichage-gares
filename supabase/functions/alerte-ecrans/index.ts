// Edge Function « alerte-ecrans » (Deno) — LE GUETTEUR.
//
// CE QU'ELLE RÉPARE. Le samedi 19/09/2026, l'écran de Saint-Gervais a affiché
// « Informations momentanément indisponibles » pendant plus de trois heures :
// la clé du Wi-Fi de la gare avait changé, le Raspberry n'a pas pu se
// réassocier. La base SAVAIT — plus aucun `derniere_vue` sur
// `saint-gervais-ecran-1` à partir de 10 h 40 — et rien ne la regardait. C'est
// un agent en gare qui l'a découvert.
//
// QUI L'APPELLE. `pg_cron`, toutes les cinq minutes, par `pg_net`, depuis la
// base elle-même (migration `2026-09-alerte-ecrans.sql`). Pas GitHub Actions :
// aucune clé puissante à déposer ailleurs, et le mécanisme part avec la base
// au transfert du chantier 3.
//
// CE QU'ELLE ÉCRIT. `alertes_ecran` (un épisode de panne par poste) et
// `surveillance_etat` (l'heure de son dernier passage, que la supervision
// affiche — c'est ce qui distingue un guetteur qui dort d'un guetteur qui
// n'a rien à dire).
//
// CE QU'ELLE DIT QUAND ELLE N'A PAS PU REGARDER. Toute lecture ou écriture
// refusée par la base est lue (`base()`), journalisée, et se termine par un
// résultat qui commence par « ÉCHEC » et un statut 500 : la supervision
// affiche alors « Surveillance EN ÉCHEC », en rouge. Jusqu'à septembre 2026,
// une lecture refusée donnait « 0 surveillés, aucun défaut » et un 200 — le
// guetteur annonçait que tout allait bien sans avoir rien lu (R-02).
//
// Déploiement : outils\deployer-edge-functions.cmd -Projet test
//               supabase secrets set CLE_GUETTEUR=... BREVO_API_KEY=... BREVO_EXPEDITEUR=...
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Clés d'API — BLOC IDENTIQUE dans les trois fonctions (début) ────────────
// Recopié tel quel dans `inviter-utilisateur`, `supprimer-utilisateur` et
// `traduire`. La duplication est VOULUE : le tableau de bord déploie une
// fonction en collant UN fichier, et un module partagé `_shared/` ne s'y colle
// pas. Elle est vérifiée plutôt que promise — `src/data/cles-edge-functions.test.ts`
// compare les trois copies caractère par caractère, puis exécute celle-ci.
// C'est justement une divergence entre les trois qui avait produit l'état de
// septembre : deux fonctions portaient un repli de clé publiable, la troisième
// non. `traduire` n'utilise pas `clePubliable()` et garde pourtant le bloc
// entier, pour que les trois copies restent comparables d'un simple égal.
//
// Supabase injecte les clés dans deux variables au PLURIEL, qui contiennent un
// objet JSON indexé par NOM de clé :
//   SUPABASE_SECRET_KEYS       → {"default":"sb_secret_…"}
//   SUPABASE_PUBLISHABLE_KEYS  → {"default":"sb_publishable_…"}
//
// PLUS AUCUN REPLI sur SUPABASE_SERVICE_ROLE_KEY ni SUPABASE_ANON_KEY. Les clés
// « legacy » ont été désactivées en production le 07/09/2026, et la recette a
// confirmé que les trois fonctions lisent bien le trousseau — aucune ligne
// `[cles]` dans leurs journaux. Ces deux variables existent toujours dans
// l'environnement, mais elles gardent un JWT périmé que Supabase refuse
// (« Legacy API keys are disabled ») : un repli sur elles ne protégerait plus
// rien et MASQUERAIT une régression. Si le trousseau cessait d'être lu, la
// fonction replierait en silence sur une clé morte, et l'échec surviendrait au
// premier appel au lieu du démarrage — la panne muette qu'on refuse partout
// ailleurs. Refuser franchement vaut mieux.

/** Nom de la clé lue dans le trousseau : renommer la clé côté Supabase casse tout. */
const NOM_CLE = 'default';

/**
 * Clé d'API lue dans le trousseau JSON, ou refus EXPLICITE.
 *
 * Refuse au lieu de renvoyer `undefined`, qui produirait trois appels plus loin
 * une erreur d'authentification que personne ne sait relier à un réglage
 * manquant. Journalise TOUJOURS avant de lever : l'appelant a le droit de
 * transformer l'échec en réponse neutre — c'est le cas de `traduire` — et la
 * trace doit rester dans les journaux de la fonction. Rien vaut mieux que faux,
 * et une panne muette se répète.
 */
function cleApi(nomTrousseau: string): string {
  const trousseau = Deno.env.get(nomTrousseau);
  if (!trousseau) {
    console.error(`[cles] ${nomTrousseau} est absent de l’environnement de la fonction.`);
    throw new Error(`Configuration incomplète : ${nomTrousseau} absent.`);
  }
  let clefs: Record<string, unknown> | null = null;
  try {
    clefs = JSON.parse(trousseau) as Record<string, unknown> | null;
  } catch {
    console.error(`[cles] ${nomTrousseau} n’est pas du JSON valide.`);
    throw new Error(`Configuration incomplète : ${nomTrousseau} illisible.`);
  }
  const cle = clefs?.[NOM_CLE];
  if (typeof cle === 'string' && cle !== '') return cle;
  // Dire les noms réellement présents est la seule information qui permette de
  // corriger le réglage. `Object.keys(null)` lève : d'où le garde.
  const noms =
    clefs && typeof clefs === 'object' ? Object.keys(clefs).join(', ') || '(aucun)' : '(pas un objet)';
  console.error(`[cles] ${nomTrousseau} n’a pas de clé « ${NOM_CLE} » ; noms présents : ${noms}.`);
  throw new Error(`Configuration incomplète : clé « ${NOM_CLE} » absente de ${nomTrousseau}.`);
}

/** Clé SECRÈTE (ex-`service_role`) : contourne RLS, ne sort jamais de la fonction. */
function cleSecrete(): string {
  return cleApi('SUPABASE_SECRET_KEYS');
}

/** Clé PUBLIABLE (ex-`anon`) : le client qui agit AU NOM de l'agent, sous RLS. */
function clePubliable(): string {
  return cleApi('SUPABASE_PUBLISHABLE_KEYS');
}
// ─── Clés d'API — BLOC IDENTIQUE dans les trois fonctions (fin) ──────────────

// `clePubliable` n'est pas appelée ici : le guetteur n'agit au nom de personne.
// Elle reste dans le bloc pour que les copies restent comparables d'un égal.
void clePubliable;

// ─── BLOC DE DÉCISION — copie vérifiée de src/core (début) ───────────────────
// POURQUOI UNE COPIE, ET NON UN IMPORT. La règle vit dans
// `src/core/surveillance-ecrans.ts` et `src/core/horaires.ts`, en TypeScript
// pur et testé. L'importer ici serait évidemment mieux. C'est impossible, et
// ce n'est pas une opinion :
//
//   1. `surveillance-ecrans.ts` importe `./horaires`, qui importe `./types`,
//      qui importe `./roles` — SANS extension de fichier, comme les 30 imports
//      relatifs de `src/core/`. Deno exige l'extension `.ts` explicite : la
//      résolution échoue dès le premier saut. Les corriger tous serait un
//      chantier à part, qui touche douze fichiers du cœur et demande
//      `allowImportingTsExtensions` côté `tsc` ;
//   2. le déploiement de secours passe par le tableau de bord Supabase, qui
//      prend UN fichier collé. C'est la raison déjà écrite plus haut pour le
//      bloc des clés, et elle vaut ici à l'identique.
//
// Alors la copie est ÉPROUVÉE plutôt que promise, et bien plus qu'à l'œil :
// `src/data/alerte-ecrans.test.ts` découpe ce bloc, le COMPILE, l'EXÉCUTE, et
// confronte ses réponses à celles de `src/core/surveillance-ecrans.ts` sur
// plusieurs milliers de combinaisons engendrées. Ce n'est pas une
// ressemblance de texte qui est vérifiée, c'est une identité de RÉPONSES —
// une divergence d'un signe de comparaison la fait rougir.

const SEUIL_DEFAUT_MS = 10 * 60_000;

interface VeilleNuit {
  debut: string;
  fin: string;
}

interface PosteSurveille {
  id: string;
  gare: string;
  surveille?: boolean | null;
  derniere_vue?: string | null;
  veille_debut?: string | null;
  veille_fin?: string | null;
}

type MotifRepos = 'hors-service' | 'jamais-vu' | 'en-veille' | 'vivant';

interface EtatSurveillance {
  defaut: boolean;
  motif: MotifRepos | null;
  silence_ms: number | null;
}

function heureVersSecondes(heure: string): number {
  const [hh = '0', mm = '0', ss = '0'] = heure.split(':');
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function enVeille(debut: string, fin: string, maintenant_s: number): boolean {
  const d = heureVersSecondes(debut);
  const f = heureVersSecondes(fin);
  if (d === f) return false; // fenêtre vide : jamais en veille
  return d < f ? maintenant_s >= d && maintenant_s < f : maintenant_s >= d || maintenant_s < f;
}

function veilleEffective(
  globale: VeilleNuit,
  propre?: { debut?: string | null; fin?: string | null } | null,
): { fenetre: VeilleNuit; propre: boolean } {
  if (propre?.debut && propre.fin) {
    return { fenetre: { debut: propre.debut, fin: propre.fin }, propre: true };
  }
  return { fenetre: globale, propre: false };
}

function estAuRepos(
  poste: Pick<PosteSurveille, 'veille_debut' | 'veille_fin'>,
  veilleGlobale: VeilleNuit,
  maintenant_s: number,
): boolean {
  const { fenetre } = veilleEffective(veilleGlobale, {
    debut: poste.veille_debut,
    fin: poste.veille_fin,
  });
  return enVeille(fenetre.debut, fenetre.fin, maintenant_s);
}

function etatSurveillance(
  poste: PosteSurveille,
  veilleGlobale: VeilleNuit,
  maintenant_ms: number,
  maintenant_s: number,
): EtatSurveillance {
  if (poste.surveille === false) {
    return { defaut: false, motif: 'hors-service', silence_ms: null };
  }
  const vue_ms = poste.derniere_vue ? new Date(poste.derniere_vue).getTime() : Number.NaN;
  if (!Number.isFinite(vue_ms)) {
    return { defaut: false, motif: 'jamais-vu', silence_ms: null };
  }
  if (estAuRepos(poste, veilleGlobale, maintenant_s)) {
    return { defaut: false, motif: 'en-veille', silence_ms: maintenant_ms - vue_ms };
  }
  const silence_ms = maintenant_ms - vue_ms;
  if (silence_ms >= SEUIL_DEFAUT_MS) return { defaut: true, motif: null, silence_ms };
  return { defaut: false, motif: 'vivant', silence_ms };
}

interface PosteEnDefaut {
  id: string;
  gare: string;
  silence_ms: number;
  derniere_vue: string;
}

interface BilanSurveillance {
  enDefaut: PosteEnDefaut[];
  surveilles: number;
  globale: boolean;
}

function bilanSurveillance(
  postes: readonly PosteSurveille[],
  veilleGlobale: VeilleNuit,
  maintenant_ms: number,
  maintenant_s: number,
): BilanSurveillance {
  const enDefaut: PosteEnDefaut[] = [];
  let surveilles = 0;
  for (const poste of postes) {
    const etat = etatSurveillance(poste, veilleGlobale, maintenant_ms, maintenant_s);
    if (etat.motif === 'hors-service' || etat.motif === 'jamais-vu' || etat.motif === 'en-veille') {
      continue;
    }
    surveilles++;
    if (etat.defaut) {
      enDefaut.push({
        id: poste.id,
        gare: poste.gare,
        silence_ms: etat.silence_ms ?? 0,
        derniere_vue: poste.derniere_vue ?? '',
      });
    }
  }
  enDefaut.sort((a, b) => b.silence_ms - a.silence_ms);
  return {
    enDefaut,
    surveilles,
    globale: surveilles >= 2 && enDefaut.length === surveilles,
  };
}

function silenceLisible(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j`;
}

/**
 * Secondes écoulées depuis minuit À PARIS.
 *
 * La fonction tourne sur un serveur en UTC ; la veille de nuit est exprimée en
 * heures locales et franchit minuit. Convertir par un décalage fixe serait
 * faux deux fois par an, pendant les semaines qui séparent les changements
 * d'heure français des autres. `Intl` porte la base de fuseaux et s'en charge.
 *
 * `hourCycle: 'h23'` est EXPLICITE et non indispensable : `fr-FR` formate déjà
 * minuit « 00 » par défaut, et le retirer ne change rien aujourd'hui — une
 * mutation l'a vérifié le 19/09/2026. Il reste écrit parce que la réponse
 * juste ne doit pas dépendre du réglage par défaut d'une locale : en « h24 »,
 * minuit se formate « 24 », 24 × 3600 = 86 400 ne tombe dans AUCUNE fenêtre
 * de veille, et la nuit entière alerterait.
 */
function secondesParis(d: Date): number {
  const [h = 0, m = 0, s = 0] = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .split(':')
    .map(Number);
  return h * 3600 + m * 60 + s;
}
// ─── BLOC DE DÉCISION — copie vérifiée de src/core (fin) ─────────────────────

/** Nombre d'envois tentés pour un même épisode avant d'abandonner. */
const MAX_TENTATIVES = 3;

// Intervalle entre deux passages : la planification `pg_cron` « toutes les
// cinq minutes » de `migrations/2026-09-alerte-ecrans.sql`. Il ne sert qu'à
// une chose ici — reconnaître, quand l'historique des alertes est illisible,
// le poste qui vient de franchir le seuil DEPUIS LE PASSAGE PRÉCÉDENT. Le lien
// avec la planification est éprouvé par `src/data/alerte-ecrans.test.ts`, et
// le seuil « À L'ARRÊT » de la supervision en est dérivé.
const CADENCE_MS = 5 * 60_000;

/**
 * Premier mot de `surveillance_etat.dernier_resultat` quand un passage n'a pas
 * pu faire son travail. La supervision le reconnaît (`MARQUE_ECHEC_GUETTEUR`,
 * `src/pages/supervision-logique.ts`) et rougit au lieu d'afficher
 * « Surveillance active ». Le banc passe le résultat ÉCRIT par cette fonction
 * dans la décision de la page : la correspondance est éprouvée, pas promise.
 */
const MARQUE_ECHEC = 'ÉCHEC';

/**
 * Raison COURTE d'un refus de la base, pour `surveillance_etat` et les
 * journaux. PostgREST ne renvoie pas de secret dans ses messages ; on masque
 * malgré tout tout ce qui ressemble à une clé ou à un jeton, parce que ce
 * texte est affiché en supervision.
 */
function raisonBase(erreur: unknown): string {
  const brut =
    erreur && typeof erreur === 'object' && 'message' in erreur
      ? String((erreur as { message: unknown }).message)
      : String(erreur);
  const propre = brut
    .replace(/sb_(secret|publishable)_\S+/g, '…')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  if (!propre) return 'erreur sans message';
  return propre.length > 120 ? `${propre.slice(0, 119)}…` : propre;
}

/**
 * Une requête à la base, ramenée à `{ data, echec }`.
 *
 * LE DÉFAUT QUE CECI RÉPARE (R-02, relecture de septembre 2026). Les trois
 * lectures étaient déstructurées en `{ data }`, sans jamais regarder
 * `error` : une clé révoquée ou une table renommée donnait `data: null`, lu
 * comme « aucun écran » — puis « 0 surveillés, aucun défaut », statut 200, et
 * « Surveillance active » en vert dans la supervision. Le guetteur, construit
 * pour qu'un silence ne passe plus inaperçu, devenait lui-même silencieux, et
 * son témoin disait que tout allait bien.
 *
 * Deux façons d'échouer, un seul chemin : `supabase-js` rend `error` pour un
 * refus de PostgREST, et peut LEVER sur une coupure réseau. Les deux sont
 * journalisées ici, une fois, avec le nom de la table.
 */
async function base<T>(
  quoi: string,
  requete: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; echec: string | null }> {
  try {
    const { data, error } = await requete;
    if (!error) return { data, echec: null };
    const echec = `${quoi} : ${raisonBase(error)}`;
    console.error(`[guetteur] ${echec}`);
    return { data: null, echec };
  } catch (e) {
    const echec = `${quoi} : ${raisonBase(e)}`;
    console.error(`[guetteur] ${echec} (exception)`);
    return { data: null, echec };
  }
}

/** Noms de gare pour le courriel : l'identifiant technique ne se lit pas. */
const NOM_GARE: Record<string, string> = {
  'le-fayet': 'Le Fayet',
  'saint-gervais': 'Saint-Gervais',
  motivon: 'Motivon',
  'col-de-voza': 'Col de Voza',
  bellevue: 'Bellevue',
  'nid-daigle': 'Nid d’Aigle',
};

interface LigneAlerte {
  ecran_id: string;
  depuis: string;
  detectee_at: string;
  envois_tentes: number;
  envoyee_at: string | null;
  dernier_echec: string | null;
}

/**
 * Envoi d'un courriel par Brevo.
 *
 * Brevo est le fournisseur retenu le 07/09/2026 (Microsoft retire
 * l'authentification basique pour SMTP AUTH fin décembre 2026). La
 * configuration SMTP de Supabase ne pouvait pas servir : elle ne s'applique
 * qu'aux courriels d'AUTHENTIFICATION.
 *
 * MÊME MOTIF QUE `DEEPL_API_KEY` : le secret peut être absent, et ce n'est pas
 * une panne. Le guetteur trace et rend la main — la pastille de la
 * supervision, elle, fonctionne dès le premier jour et ne dépend d'aucun
 * fournisseur. Ce lot ne doit pas attendre après Brevo.
 *
 * Rend `null` en cas de succès, une raison COURTE sinon (elle est stockée en
 * base et affichée en supervision : jamais de corps de réponse brut, qui
 * pourrait contenir un jeton).
 */
async function envoyer(
  destinataires: string[],
  sujet: string,
  corps: string,
): Promise<string | null> {
  const cle = Deno.env.get('BREVO_API_KEY');
  const expediteur = Deno.env.get('BREVO_EXPEDITEUR');
  if (!cle || !expediteur) {
    const manquant = !cle ? 'BREVO_API_KEY' : 'BREVO_EXPEDITEUR';
    console.error(`[brevo] ${manquant} absent : courriel NON envoyé — ${sujet}`);
    return `${manquant} absent`;
  }
  if (!destinataires.length) {
    console.error('[brevo] aucun destinataire : params.alertes_destinataires est vide.');
    return 'aucun destinataire';
  }
  try {
    const reponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cle },
      body: JSON.stringify({
        sender: { name: 'Supervision TMB', email: expediteur },
        to: destinataires.map((email) => ({ email })),
        subject: sujet,
        textContent: corps,
      }),
    });
    if (!reponse.ok) {
      console.error(`[brevo] refus ${reponse.status} — ${sujet}`);
      return `Brevo ${reponse.status}`;
    }
    return null;
  } catch (e) {
    // Jamais le détail : une trace réseau peut porter l'en-tête `api-key`.
    console.error('[brevo] envoi impossible (réseau)', e instanceof Error ? e.name : '');
    return 'réseau';
  }
}

/** Une ligne de courriel par poste : gare, identifiant, silence, dernière vue. */
function ligneCourriel(p: PosteEnDefaut): string {
  const vue = p.derniere_vue
    ? new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(p.derniere_vue))
    : '—';
  return `• ${NOM_GARE[p.gare] ?? p.gare} (${p.id}) — muet depuis ${silenceLisible(p.silence_ms)}, dernier signal ${vue}`;
}

Deno.serve(async (req) => {
  // LE GUETTEUR N'EST PAS UNE PAGE. Aucun CORS, aucune origine autorisée :
  // seul `pg_cron` l'appelle, avec un secret partagé. La fonction est déployée
  // sans vérification de jeton (`--no-verify-jwt`) parce que la base n'a pas
  // de session utilisateur à présenter ; ce secret EST donc le seul verrou, et
  // il est comparé avant toute lecture de la base.
  const attendu = Deno.env.get('CLE_GUETTEUR');
  if (!attendu) {
    // Refus FRANC. Sans ce garde, une fonction déployée avant son secret
    // s'ouvrirait à tout l'internet — et rien ne le dirait.
    console.error('[guetteur] CLE_GUETTEUR absent : la fonction refuse tout appel.');
    return new Response('Configuration incomplète', { status: 500 });
  }
  if (req.headers.get('x-cle-guetteur') !== attendu) {
    return new Response('Non autorisé', { status: 401 });
  }

  let secrete: string;
  try {
    secrete = cleSecrete();
  } catch {
    return new Response('Configuration incomplète : clé d’API Supabase absente.', { status: 500 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secrete);
  const maintenant = new Date();
  const maintenant_ms = maintenant.getTime();
  const maintenant_s = secondesParis(maintenant);

  // ── Ce qu'on lit ──────────────────────────────────────────────────────────
  const [lectureEcrans, lectureParams, lectureAlertes] = await Promise.all([
    base(
      'ecrans',
      admin.from('ecrans').select('id, gare, surveille, derniere_vue, veille_debut, veille_fin'),
    ),
    base(
      'params',
      admin
        .from('params')
        .select('cle, valeur')
        .in('cle', ['veille_nuit', 'alertes_destinataires']),
    ),
    base('alertes_ecran', admin.from('alertes_ecran').select('*')),
  ]);

  // LA PREUVE QUE LE GUETTEUR A TOURNÉ. Sans cette ligne, un `pg_cron` inerte
  // ressemblerait trait pour trait à une flotte en bonne santé : aucun
  // courriel, aucune pastille, rien. La supervision affiche cet horodatage et
  // rougit s'il vieillit — un contrôle qui ne s'exécute pas doit se voir.
  //
  // Elle est écrite à CHAQUE passage, y compris celui qui échoue : c'est le
  // résultat, et non l'heure, qui dit « je n'ai pas pu regarder ». Un passage
  // qui ne parvient même pas à l'écrire (clé révoquée : la base refuse tout)
  // laisse l'horodatage vieillir, et la supervision passe « À L'ARRÊT » au
  // bout de trois passages manqués — rouge dans les deux cas, jamais vert.
  const maintenantISO = maintenant.toISOString();
  const consigner = (resume: string) =>
    base(
      'surveillance_etat',
      admin
        .from('surveillance_etat')
        .update({ derniere_execution: maintenantISO, dernier_resultat: resume })
        .eq('id', true),
    );

  // OÙ ATTERRIT UN ÉCHEC, ET QUI LE LIT. Trois traces, par ordre d'utilité :
  //   1. `surveillance_etat.dernier_resultat`, qui commence alors par
  //      « ÉCHEC » : la supervision affiche « Surveillance EN ÉCHEC » en
  //      rouge, avec ce texte — c'est la seule qu'un exploitant regarde ;
  //   2. `console.error`, dans les journaux de la fonction (tableau de bord
  //      Supabase → Edge Functions → alerte-ecrans → Logs) : pour qui cherche
  //      la cause, pas pour qui surveille ;
  //   3. le statut 500 — vu par `pg_net` seulement (`net._http_response`,
  //      purgée au bout de quelques heures) et par le graphique d'appels du
  //      tableau de bord. Personne ne le lit en service : il n'est là que pour
  //      qu'une recette (section 9.b de la migration) ne lise pas « 200 » sur
  //      un passage qui n'a rien vu.
  const repondre = (echec: boolean, corps: Record<string, unknown>) =>
    new Response(JSON.stringify(corps), {
      status: echec ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });

  // ── Un passage qui n'a pas pu lire le parc ne conclut RIEN ───────────────
  // Les trois lectures n'ont pas le même poids.
  //
  // `ecrans` illisible : le guetteur ne sait rien du parc. Il ne peut ni
  // alerter ni rassurer ; « 0 surveillés, aucun défaut » était un mensonge.
  //
  // `params` illisible : il ne sait ni QUI prévenir, ni QUAND les postes
  // dorment. Juger le parc sur la veille par défaut pourrait taire un écran
  // muet à 21 h 30 si l'exploitant a réglé 22 h ; tenter un envoi sans
  // destinataire userait les trois tentatives de l'épisode pour rien — et
  // l'alerte ne partirait plus quand le réglage redeviendrait lisible.
  //
  // Dans les deux cas, le passage est ABANDONNÉ sans toucher à
  // `alertes_ecran` : les épisodes en cours restent tels quels, et le passage
  // suivant (cinq minutes plus tard) reprend là où la base en était.
  const vitales = [lectureEcrans.echec, lectureParams.echec].filter(
    (e): e is string => e !== null,
  );
  if (vitales.length) {
    const illisibles = lectureAlertes.echec ? [...vitales, lectureAlertes.echec] : vitales;
    const resume = `${MARQUE_ECHEC} — lecture impossible (${illisibles.join(' ; ')}) : passage abandonné, aucun écran n'a été jugé, personne n'a été prévenu.`;
    console.error(`[guetteur] ${resume}`);
    await consigner(resume);
    return repondre(true, { surveilles: null, en_defaut: null, echec: resume });
  }

  const params = (lectureParams.data ?? []) as { cle: string; valeur: unknown }[];
  const valeur = (cle: string): unknown => params.find((p) => p.cle === cle)?.valeur;
  const veilleLue = valeur('veille_nuit') as VeilleNuit | undefined;
  // REPLI EXPLICITE et non silencieux : sans réglage lisible, on prend la
  // fenêtre par défaut de l'application plutôt que « jamais de veille », qui
  // ferait alerter toute la nuit dès la première ligne manquante.
  const veilleGlobale: VeilleNuit =
    veilleLue && typeof veilleLue.debut === 'string' && typeof veilleLue.fin === 'string'
      ? veilleLue
      : { debut: '21:00', fin: '06:00' };
  const destinataires = Array.isArray(valeur('alertes_destinataires'))
    ? (valeur('alertes_destinataires') as unknown[]).filter(
        (a): a is string => typeof a === 'string' && a.includes('@'),
      )
    : [];

  // `alertes_ecran` illisible : le guetteur sait QUI est muet, mais pas s'il
  // l'a déjà dit. Annoncer tous les muets referait un courriel par passage —
  // douze par heure, et un courriel qui se répète est un courriel qu'on cesse
  // de lire. N'en annoncer aucun referait le 19/09. Voir `sansMemoire` plus
  // bas : au plus UN courriel par épisode, sans rétablissement.
  const sansMemoire = lectureAlertes.echec !== null;

  const postes = (lectureEcrans.data ?? []) as PosteSurveille[];
  const connues = new Map<string, LigneAlerte>(
    ((lectureAlertes.data ?? []) as LigneAlerte[]).map((l) => [l.ecran_id, l]),
  );
  const bilan = bilanSurveillance(postes, veilleGlobale, maintenant_ms, maintenant_s);

  // ── Ce qu'on décide ───────────────────────────────────────────────────────
  const aAnnoncer: PosteEnDefaut[] = []; // première annonce, ou réessai d'envoi
  const aRetablir: LigneAlerte[] = []; // le signal est revenu
  const aOublier: string[] = []; // poste retiré du service pendant l'épisode

  // ON PARCOURT LE BILAN, PAS LA TABLE. `bilanSurveillance` a trié les postes
  // du plus ancien silence au plus récent, et c'est cet ordre que le courriel
  // doit porter : on commence à chercher par le poste qui s'est tu le premier.
  // Reparcourir `postes` rendait l'ordre de la base, c'est-à-dire l'ordre
  // alphabétique des gares — le tri était fait et jeté.
  for (const defaut of bilan.enDefaut) {
    if (sansMemoire) {
      // SANS MÉMOIRE, ON N'ANNONCE QUE CE QUI VIENT D'ARRIVER. Un poste
      // franchit le seuil pendant UN SEUL intervalle entre deux passages :
      // celui où son silence est compris entre le seuil et le seuil plus une
      // cadence. C'est une mémoire qui ne demande aucune lecture. Le prix est
      // connu : un poste tombé pendant un passage perdu n'est pas annoncé
      // avant que l'historique redevienne lisible — la supervision, elle,
      // affiche l'échec en rouge pendant tout ce temps.
      if (defaut.silence_ms < SEUIL_DEFAUT_MS + CADENCE_MS) aAnnoncer.push(defaut);
      continue;
    }
    const ligne = connues.get(defaut.id);
    // NE PAS RÉPÉTER. Une tâche qui tourne toutes les cinq minutes aurait
    // envoyé trente-six courriels pendant la panne de samedi. La ligne en
    // base EST la mémoire de l'épisode ; on n'y revient que si l'envoi a
    // échoué, et trois fois au plus — un échec qui se rejoue indéfiniment est
    // un journal qui déborde, pas une alerte.
    if (!ligne || (!ligne.envoyee_at && ligne.envois_tentes < MAX_TENTATIVES)) {
      aAnnoncer.push(defaut);
    }
  }

  // Sans mémoire, `connues` est vide : aucun rétablissement, aucun oubli. On
  // ne dit pas « c'est réparé » d'une panne dont on ne sait pas si elle a été
  // dite ; la ligne restée en base sera traitée au premier passage lisible.
  const muets = new Set(bilan.enDefaut.map((p) => p.id));
  for (const poste of postes) {
    const ligne = connues.get(poste.id);
    if (!ligne || muets.has(poste.id)) continue;
    const etat = etatSurveillance(poste, veilleGlobale, maintenant_ms, maintenant_s);
    if (etat.motif === 'vivant') aRetablir.push(ligne);
    // `hors-service` : on retire l'épisode sans rien annoncer, l'exploitant
    // vient de décocher le poste — ce n'est plus une panne, c'est une décision.
    else if (etat.motif === 'hors-service') aOublier.push(poste.id);
    // `en-veille` et `jamais-vu` : la ligne RESTE. Un poste qui entre en
    // veille pendant sa panne n'est pas rétabli ; l'annoncer serait faux, et
    // supprimer la ligne ferait repartir l'alerte au matin comme si c'était
    // une nouvelle panne.
  }

  // ── Ce qu'on envoie ───────────────────────────────────────────────────────
  // UN seul courriel par catégorie, même pour six postes. Si toute la flotte
  // se tait, la cause est en amont et six messages ne disent rien de plus.
  let echecAnnonce: string | null = null;
  if (aAnnoncer.length) {
    const sujet = bilan.globale
      ? `[TMB] PANNE GÉNÉRALE — ${aAnnoncer.length} écrans muets`
      : aAnnoncer.length === 1
        ? `[TMB] Écran muet — ${NOM_GARE[aAnnoncer[0]!.gare] ?? aAnnoncer[0]!.gare}`
        : `[TMB] ${aAnnoncer.length} écrans muets`;
    const entete = bilan.globale
      ? `Les ${bilan.surveilles} écrans surveillés se taisent en même temps : la cause est probablement en amont (réseau de la Régie, Supabase injoignable) plutôt que sur chaque poste.`
      : `Un écran ne donne plus signe de vie depuis plus de ${SEUIL_DEFAUT_MS / 60_000} minutes.`;
    echecAnnonce = await envoyer(
      destinataires,
      sujet,
      [
        entete,
        '',
        ...aAnnoncer.map(ligneCourriel),
        '',
        'Un écran muet affiche « Informations momentanément indisponibles » après quinze minutes de cache, puis un écran neutre.',
        'À vérifier sur place : alimentation, réseau de la gare, puis docs/kiosque.md §10 (vérifier un poste en cinq commandes).',
        '',
        // Le destinataire doit savoir que la promesse habituelle ne tient pas.
        sansMemoire
          ? 'ATTENTION : le guetteur n’a pas pu relire son historique d’alertes. Il n’annonce que les écrans tombés depuis son passage précédent, et le retour du signal NE SERA PAS annoncé : vérifiez en supervision.'
          : 'Vous recevrez un second message quand le signal reviendra.',
      ].join('\n'),
    );
  }

  let echecRetour: string | null = null;
  // On n'annonce le retour que de ce qui a été ANNONCÉ. Une panne détectée
  // mais jamais dite (clé Brevo absente) n'a pas de rétablissement à dire.
  const retablisDits = aRetablir.filter((l) => l.envoyee_at);
  if (retablisDits.length) {
    echecRetour = await envoyer(
      destinataires,
      retablisDits.length === 1
        ? `[TMB] Écran rétabli — ${retablisDits[0]!.ecran_id}`
        : `[TMB] ${retablisDits.length} écrans rétablis`,
      [
        'Le signal de vie est revenu.',
        '',
        ...retablisDits.map(
          (l) =>
            `• ${l.ecran_id} — muet depuis ${new Intl.DateTimeFormat('fr-FR', {
              timeZone: 'Europe/Paris',
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(l.depuis))}`,
        ),
      ].join('\n'),
    );
  }

  // ── Ce qu'on écrit ────────────────────────────────────────────────────────
  // Chaque écriture est CONTRÔLÉE. Une mémoire d'épisode qui ne s'écrit pas
  // est un courriel qui se répétera au passage suivant — ce qui se voit, et
  // vite. Mais il faut que la supervision le dise AVANT que les destinataires
  // ne s'en plaignent, et qu'elle dise pourquoi.
  const echecsEcriture: string[] = [];
  if (aAnnoncer.length) {
    const { echec } = await base(
      'alertes_ecran (enregistrement)',
      admin.from('alertes_ecran').upsert(
        aAnnoncer.map((p) => {
          const ligne = connues.get(p.id);
          return {
            ecran_id: p.id,
            depuis: p.derniere_vue || maintenantISO,
            detectee_at: ligne?.detectee_at ?? maintenantISO,
            envois_tentes: (ligne?.envois_tentes ?? 0) + 1,
            envoyee_at: echecAnnonce ? null : maintenantISO,
            dernier_echec: echecAnnonce,
          };
        }),
        { onConflict: 'ecran_id' },
      ),
    );
    if (echec) echecsEcriture.push(echec);
  }
  // Le rétablissement referme l'épisode : la ligne disparaît, la prochaine
  // panne du même poste sera une NOUVELLE alerte. Les lignes dont l'envoi
  // avait échoué partent aussi — le poste va bien, il n'y a plus rien à dire.
  const aSupprimer = [...aRetablir.map((l) => l.ecran_id), ...aOublier];
  if (aSupprimer.length) {
    const { echec } = await base(
      'alertes_ecran (clôture)',
      admin.from('alertes_ecran').delete().in('ecran_id', aSupprimer),
    );
    if (echec) echecsEcriture.push(echec);
  }

  // ── Ce qu'on dit ──────────────────────────────────────────────────────────
  const constat = bilan.enDefaut.length
    ? `${bilan.enDefaut.length}/${bilan.surveilles} en défaut${echecAnnonce ? ` (envoi : ${echecAnnonce})` : ''}`
    : `${bilan.surveilles} surveillés, aucun défaut`;
  const problemes: string[] = [];
  if (lectureAlertes.echec) {
    problemes.push(
      `historique illisible (${lectureAlertes.echec}) : ${aAnnoncer.length} annonce(s) sans mémoire, aucun rétablissement annoncé`,
    );
  }
  if (echecsEcriture.length) {
    problemes.push(
      `écriture impossible (${echecsEcriture.join(' ; ')}) : la mémoire des alertes n'est pas à jour, un courriel peut se répéter au prochain passage`,
    );
  }
  // « ÉCHEC » EN TÊTE, ET LE CONSTAT QUAND MÊME. Ce qui a été vu reste dit :
  // « 1/1 en défaut » est une information juste même quand l'historique est
  // illisible. Mais la supervision doit rougir, et c'est le premier mot qui
  // l'y oblige.
  const resume = problemes.length
    ? `${MARQUE_ECHEC} — ${problemes.join(' · ')} — ${constat}`
    : constat;
  if (problemes.length) console.error(`[guetteur] ${resume}`);
  const consigne = await consigner(resume);

  return repondre(problemes.length > 0 || consigne.echec !== null, {
    surveilles: bilan.surveilles,
    en_defaut: bilan.enDefaut.length,
    globale: bilan.globale,
    annonces: aAnnoncer.length,
    retablissements: retablisDits.length,
    echec_envoi: echecAnnonce ?? echecRetour,
    echec: problemes.length ? resume : consigne.echec,
  });
});
