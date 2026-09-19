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
  const [{ data: ecrans }, { data: params }, { data: alertes }] = await Promise.all([
    admin
      .from('ecrans')
      .select('id, gare, surveille, derniere_vue, veille_debut, veille_fin'),
    admin.from('params').select('cle, valeur').in('cle', ['veille_nuit', 'alertes_destinataires']),
    admin.from('alertes_ecran').select('*'),
  ]);

  const valeur = (cle: string): unknown => params?.find((p) => p.cle === cle)?.valeur;
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

  const postes = (ecrans ?? []) as PosteSurveille[];
  const connues = new Map<string, LigneAlerte>(
    ((alertes ?? []) as LigneAlerte[]).map((l) => [l.ecran_id, l]),
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
        'Vous recevrez un second message quand le signal reviendra.',
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
  const maintenantISO = maintenant.toISOString();
  if (aAnnoncer.length) {
    await admin.from('alertes_ecran').upsert(
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
    );
  }
  // Le rétablissement referme l'épisode : la ligne disparaît, la prochaine
  // panne du même poste sera une NOUVELLE alerte. Les lignes dont l'envoi
  // avait échoué partent aussi — le poste va bien, il n'y a plus rien à dire.
  const aSupprimer = [...aRetablir.map((l) => l.ecran_id), ...aOublier];
  if (aSupprimer.length) {
    await admin.from('alertes_ecran').delete().in('ecran_id', aSupprimer);
  }

  // LA PREUVE QUE LE GUETTEUR A TOURNÉ. Sans cette ligne, un `pg_cron` inerte
  // ressemblerait trait pour trait à une flotte en bonne santé : aucun
  // courriel, aucune pastille, rien. La supervision affiche cet horodatage et
  // rougit s'il vieillit — un contrôle qui ne s'exécute pas doit se voir.
  const resume = bilan.enDefaut.length
    ? `${bilan.enDefaut.length}/${bilan.surveilles} en défaut${echecAnnonce ? ` (envoi : ${echecAnnonce})` : ''}`
    : `${bilan.surveilles} surveillés, aucun défaut`;
  await admin
    .from('surveillance_etat')
    .update({ derniere_execution: maintenantISO, dernier_resultat: resume })
    .eq('id', true);

  return new Response(
    JSON.stringify({
      surveilles: bilan.surveilles,
      en_defaut: bilan.enDefaut.length,
      globale: bilan.globale,
      annonces: aAnnoncer.length,
      retablissements: retablisDits.length,
      echec_envoi: echecAnnonce ?? echecRetour,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
