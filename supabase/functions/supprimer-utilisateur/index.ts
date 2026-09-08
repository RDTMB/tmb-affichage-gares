// Edge Function « supprimer-utilisateur » (Deno) — suppression définitive
// d'un compte (docs/02 §5).
//
// TROIS TEMPS, VOULUS :
//   1. le compte est DÉSACTIVÉ avec le JETON de l'agent. Cette écriture
//      traverse RLS (`peut_gerer_profil` : il faut pouvoir attribuer TOUS les
//      rôles de la cible) et le garde-fou du dernier détenteur. Elle prouve
//      donc le droit, elle libère le quorum, et son message d'erreur est
//      lisible — au lieu du « Database error deleting user » générique que
//      renverrait GoTrue si la cascade heurtait un déclencheur ;
//   1 bis. ses RÔLES sont retirés, toujours avec le jeton de l'agent, puis
//      relus avec la clé secrète pour vérifier qu'il n'en reste aucun. Cette
//      étape n'est pas un ornement : sans elle la 2 échoue toujours, la
//      cascade réveillant un déclencheur qui refuse les écritures de rôle
//      « sans visage » (détail au-dessus du code) ;
//   2. le compte Auth est supprimé avec la clé secrète, `on delete cascade`
//      emportant `profils` — qui n'a alors plus aucune liaison à emporter.
// Si une étape échoue, le compte reste désactivé : un état sûr et réversible,
// jamais un compte à demi supprimé. Conséquence utile : la fonction est
// REJOUABLE sur un compte déjà désactivé, ce qui est l'état dans lequel les
// tentatives d'avant le correctif ont laissé des comptes.
//
// Déploiement : supabase functions deploy supprimer-utilisateur
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Origines autorisées (CORS) : le site public et le serveur de dév local.
const ORIGINES_AUTORISEES = ['https://rdtmb.github.io', 'http://localhost:5173'];

// N'expose l'en-tête Access-Control-Allow-Origin que si l'origine est connue.
function entetesCors(req: Request): Record<string, string> {
  const origine = req.headers.get('Origin') ?? '';
  const entetes: Record<string, string> = { 'Content-Type': 'application/json', Vary: 'Origin' };
  if (ORIGINES_AUTORISEES.includes(origine)) {
    entetes['Access-Control-Allow-Origin'] = origine;
  }
  return entetes;
}

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

Deno.serve(async (req) => {
  const entetes = entetesCors(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...entetes,
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      },
    });
  }
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, cleSecrete());

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: appelantAuth } = await admin.auth.getUser(jwt);
    if (!appelantAuth.user) return new Response('Non connecté', { status: 401, headers: entetes });

    // Client agissant AU NOM de l'agent : la désactivation traverse RLS.
    const appelant = createClient(
      url,
      clePubliable(),
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    const { data: profilAppelant } = await admin
      .from('profils')
      .select('actif')
      .eq('user_id', appelantAuth.user.id)
      .maybeSingle();
    if (!profilAppelant?.actif) {
      return new Response('Compte inactif ou inconnu', { status: 403, headers: entetes });
    }

    const { user_id } = (await req.json()) as { user_id?: string };
    if (!user_id) return new Response('user_id requis', { status: 400, headers: entetes });
    if (user_id === appelantAuth.user.id) {
      return new Response('Impossible de supprimer votre propre compte connecté', {
        status: 400,
        headers: entetes,
      });
    }

    // ÉTAPE 1 — désactivation par l'agent lui-même : c'est elle qui fait
    // trancher la base (droits ET garde-fou du dernier technique / admin).
    const desactivation = await appelant
      .from('profils')
      .update({ actif: false })
      .eq('user_id', user_id)
      .select();
    if (desactivation.error) {
      // Message du déclencheur (dernier détenteur d'un rôle protégé, par ex.).
      return new Response(desactivation.error.message, { status: 409, headers: entetes });
    }
    if ((desactivation.data ?? []).length === 0) {
      // Aucune ligne touchée : RLS a filtré. Le compte porte un rôle que
      // l'appelant n'attribue pas — ou il n'existe plus.
      return new Response(
        'Ce compte porte un rôle que vous n’attribuez pas : sa suppression revient au rôle correspondant.',
        { status: 403, headers: entetes },
      );
    }

    // ÉTAPE 1 bis — RETRAIT DES RÔLES, par le JETON de l'agent.
    //
    // Sans elle, l'étape 2 échoue. `deleteUser` passe par GoTrue SANS jeton ;
    // la cascade `auth.users → profils → profils_roles` réveille
    // `trg_roles_proteger`, qui refuse toute écriture de rôle dont
    // `auth.uid()` est NULL (« Attribution de rôle sans utilisateur connecté
    // refusée. », que GoTrue enveloppe en « Database error deleting user »).
    // Deux garde-fous corrects et incompatibles : l'un veut qu'aucune écriture
    // de rôle ne soit sans visage, l'autre supprime avec une clé qui, par
    // construction, n'en a pas.
    //
    // Retirer AVANT, avec `appelant`, lève les deux : `auth.uid()` est
    // renseigné, donc plus d'écriture sans visage ; et
    // `private.peut_attribuer(role)` est réellement vérifié POUR CHAQUE rôle
    // retiré, ce qui n'avait jamais lieu jusqu'ici — le correctif RESSERRE le
    // contrôle au lieu de le contourner. La cascade n'a plus rien à emporter.
    //
    // Ne PAS remplacer par un retrait avec `admin` : ce serait rendre la clé
    // secrète capable de retirer n'importe quel rôle sans visage, exactement
    // ce que le garde-fou interdit.
    //
    // Le quorum ne s'y oppose pas : `verifier_quorum_roles` compte les
    // détenteurs ACTIFS, et l'étape 1 vient de désactiver la cible.
    const retrait = await appelant.from('profils_roles').delete().eq('user_id', user_id);
    if (retrait.error) {
      return new Response(`${retrait.error.message} — le compte a été désactivé mais pas supprimé.`, {
        status: 409,
        headers: entetes,
      });
    }

    // On ne SUPPOSE pas que le retrait a tout emporté : on relit avec la clé
    // secrète, qui voit tout. Une ligne retenue par RLS ne lève AUCUNE erreur,
    // elle est simplement absente du DELETE — enchaîner sur l'étape 2 en
    // supposant, ce serait retomber dans le « Database error deleting user »
    // d'aujourd'hui, mais après avoir cru le contraire. Relire vaut mieux que
    // compter les lignes rendues : c'est l'invariant qui compte vraiment (plus
    // aucune liaison), et il tient même si un rôle est attribué entre-temps.
    // Zéro rôle est un cas NORMAL : une ligne `profils` peut exister sans
    // aucune liaison, et zéro retiré sur zéro attendu doit passer.
    const restants = await admin
      .from('profils_roles')
      .select('role, source')
      .eq('user_id', user_id);
    if (restants.error) {
      return new Response(
        `${restants.error.message} — le compte a été désactivé mais pas supprimé.`,
        { status: 409, headers: entetes },
      );
    }
    const bloquants = (restants.data ?? []) as { role: string; source: string }[];
    if (bloquants.length > 0) {
      // L'étape 1 a DÉJÀ prouvé que l'agent peut attribuer tous les rôles de
      // la cible : `peut_gerer_profil` l'exige, sinon l'UPDATE n'aurait touché
      // aucune ligne. Le seul filtre qui puisse encore retenir une liaison est
      // donc le `source = 'manuel'` de la politique de retrait, c'est-à-dire
      // un rôle venu de l'annuaire. On le DIT : rien ne vaut mieux que faux, et
      // une panne muette se répète — c'est précisément ce qui a laissé la
      // suppression cassée deux jours.
      const noms = bloquants.map((r) => r.role).join(', ');
      const tousSso = bloquants.every((r) => r.source === 'entra');
      const explication = tousSso
        ? 'Ce compte tient ce ou ces rôles de l’annuaire (SSO) : ils ne se retirent pas depuis la ' +
          'supervision. Retirez la personne du groupe correspondant dans l’annuaire, laissez la ' +
          'synchronisation passer, puis recommencez.'
        : 'Ils n’ont pas pu être retirés avec votre jeton : la suppression revient au rôle ' +
          'correspondant.';
      return new Response(
        `Rôles encore attachés à ce compte : ${noms}. ${explication} Le compte est désactivé, ` +
          `il n’est pas supprimé.`,
        { status: 409, headers: entetes },
      );
    }

    // ÉTAPE 2 — suppression définitive du compte Auth.
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) {
      return new Response(
        `${error.message} — le compte a été désactivé mais pas supprimé.`,
        { status: 409, headers: entetes },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { headers: entetes });
  } catch (erreur) {
    return new Response(String(erreur), { status: 500, headers: entetes });
  }
});
