// Edge Function « supprimer-utilisateur » (Deno) — suppression définitive
// d'un compte (docs/02 §5).
//
// DEUX TEMPS, VOULUS :
//   1. le compte est DÉSACTIVÉ avec le JETON de l'agent. Cette écriture
//      traverse RLS (`peut_gerer_profil` : il faut pouvoir attribuer TOUS les
//      rôles de la cible) et le garde-fou du dernier détenteur. Elle prouve
//      donc le droit, elle libère le quorum, et son message d'erreur est
//      lisible — au lieu du « Database error deleting user » générique que
//      renverrait GoTrue si la cascade heurtait un déclencheur ;
//   2. le compte Auth est supprimé avec la clé secrète, `on delete cascade`
//      emportant `profils` puis `profils_roles`.
// Si la seconde étape échoue, le compte reste désactivé : un état sûr et
// réversible, jamais un compte à demi supprimé.
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
// C'est justement une divergence entre les trois qui a produit l'état d'avant :
// deux fonctions avaient un repli de clé publiable, la troisième non.
// `traduire` n'utilise pas `clePubliable()` et garde pourtant le bloc entier,
// pour que les trois copies restent comparables d'un simple égal.
//
// Supabase injecte les nouvelles clés dans deux variables au PLURIEL, qui
// contiennent un objet JSON indexé par NOM de clé :
//   SUPABASE_SECRET_KEYS       → {"default":"sb_secret_…"}
//   SUPABASE_PUBLISHABLE_KEYS  → {"default":"sb_publishable_…"}
// L'ancien repli `SUPABASE_ANON_KEY ?? SUPABASE_PUBLISHABLE_KEY` visait un nom
// au SINGULIER qui n'existe pas : il n'a jamais pu servir, et personne ne l'a
// vu parce que la branche de gauche a toujours répondu.
//
// ⚠ REPLI TEMPORAIRE. Après la désactivation des clés « legacy », les anciennes
// variables ne disparaissent pas : elles gardent leur JWT périmé, que Supabase
// refuse (« Legacy API keys are disabled »). Le repli ne protège donc de RIEN
// après la coupure — il ne couvre que la fenêtre entre le déploiement de ce
// code et la coupure elle-même. À RETIRER une fois la coupure faite en
// production (docs/mise-en-service.md §E, étape 6).

/** Nom de la clé lue dans le trousseau : renommer la clé côté Supabase casse tout. */
const NOM_CLE = 'default';

/**
 * Clé d'API : le trousseau JSON d'abord, l'ancienne variable ensuite.
 *
 * Refuse franchement au lieu de renvoyer `undefined`, qui produirait trois
 * appels plus loin une erreur d'authentification que personne ne sait relier à
 * un réglage manquant. Journalise TOUJOURS avant de lever : l'appelant a le
 * droit de transformer l'échec en réponse neutre, la trace doit rester dans les
 * journaux de la fonction. Rien vaut mieux que faux, et une panne muette se
 * répète.
 */
function cleApi(nomTrousseau: string, nomLegacy: string): string {
  const trousseau = Deno.env.get(nomTrousseau);
  if (trousseau) {
    let clefs: Record<string, unknown> | null = null;
    try {
      clefs = JSON.parse(trousseau) as Record<string, unknown> | null;
    } catch {
      console.error(`[cles] ${nomTrousseau} n’est pas du JSON valide.`);
    }
    const cle = clefs?.[NOM_CLE];
    if (typeof cle === 'string' && cle !== '') return cle;
    if (clefs) {
      // Trousseau lisible mais sans clé « default » : la seule information qui
      // permette de corriger le réglage est la liste des noms réellement là.
      console.error(
        `[cles] ${nomTrousseau} n’a pas de clé « ${NOM_CLE} » ; noms présents : ` +
          `${Object.keys(clefs).join(', ') || '(aucun)'}.`,
      );
    }
  }
  const ancienne = Deno.env.get(nomLegacy);
  if (ancienne) {
    // REPLI TEMPORAIRE — et cette ligne EST le contrôle d'avant-coupure.
    // Tant qu'elle apparaît dans les journaux de la fonction, le trousseau
    // n'est pas lu : désactiver les clés legacy casserait tout. Sans elle, le
    // repli réussirait en silence, un essai complet passerait, et la coupure
    // casserait ensuite ce que l'essai venait de déclarer bon.
    console.warn(
      `[cles] ${nomTrousseau} indisponible : repli sur ${nomLegacy}. Ne pas ` +
        `désactiver les clés legacy tant que cette ligne apparaît.`,
    );
    return ancienne;
  }
  console.error(`[cles] Ni ${nomTrousseau} ni ${nomLegacy} ne fournissent de clé.`);
  throw new Error(`Configuration incomplète : aucune clé d’API utilisable (${nomTrousseau}).`);
}

/** Clé SECRÈTE (ex-`service_role`) : contourne RLS, ne sort jamais de la fonction. */
function cleSecrete(): string {
  return cleApi('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
}

/** Clé PUBLIABLE (ex-`anon`) : le client qui agit AU NOM de l'agent, sous RLS. */
function clePubliable(): string {
  return cleApi('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
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
