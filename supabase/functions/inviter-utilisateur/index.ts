// Edge Function « inviter-utilisateur » (Deno) — création de compte par
// invitation email (docs/02 §5).
//
// DEUX CLIENTS, DEUX RÔLES BIEN SÉPARÉS :
//   - `admin` (clé secrète) ne sert QU'À l'appel Auth `inviteUserByEmail`, qui
//     ne peut pas se faire autrement ;
//   - `appelant` porte le JETON de l'agent : TOUTE écriture dans `profils` et
//     `profils_roles` passe par lui, de sorte que RLS, les déclencheurs et le
//     journal d'exploitation s'appliquent comme depuis la supervision. La
//     vérification faite ici en TypeScript n'est donc qu'un premier filtre, la
//     base reste la frontière (docs/securite.md).
//
// Si l'écriture du profil échoue après l'invitation, le compte Auth est
// SUPPRIMÉ : sans cela, il resterait un compte fantôme, invisible de la
// supervision (qui liste `profils`) et impossible à réinviter.
//
// Déploiement : supabase functions deploy inviter-utilisateur
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Origines autorisées (CORS) : le site public et le serveur de dév local.
const ORIGINES_AUTORISEES = ['https://rdtmb.github.io', 'http://localhost:5173'];

/** Les quatre rôles ; la matrice « qui attribue quoi » vit en base (table `roles`). */
const ROLES_CONNUS = ['technique', 'admin', 'supervision', 'caisse'];

// N'expose l'en-tête Access-Control-Allow-Origin que si l'origine est connue.
function entetesCors(req: Request): Record<string, string> {
  const origine = req.headers.get('Origin') ?? '';
  const entetes: Record<string, string> = { 'Content-Type': 'application/json', Vary: 'Origin' };
  if (ORIGINES_AUTORISEES.includes(origine)) {
    entetes['Access-Control-Allow-Origin'] = origine;
  }
  return entetes;
}

/** Adresse de retour acceptée seulement sur une origine connue, sinon undefined. */
function urlRetourAutorisee(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return ORIGINES_AUTORISEES.includes(u.origin) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rôles demandés, quel que soit le contrat d'appel. L'ANCIENNE supervision
 * envoie `role` (une chaîne) ; la nouvelle envoie `roles` (un tableau). Les
 * deux sont acceptés le temps de la fenêtre de déploiement : le SQL est
 * exécuté avant la fusion du code, les deux versions du front coexistent donc
 * quelques minutes (docs/mise-en-service.md §I).
 */
function rolesDemandes(corps: { role?: unknown; roles?: unknown }): string[] {
  const brut = Array.isArray(corps.roles)
    ? corps.roles
    : typeof corps.role === 'string'
      ? [corps.role]
      : [];
  const propres = brut.filter((r): r is string => typeof r === 'string' && ROLES_CONNUS.includes(r));
  return [...new Set(propres)];
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

    // Client agissant AU NOM de l'agent : ses écritures traversent RLS.
    const appelant = createClient(
      url,
      clePubliable(),
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // L'appelant doit être ACTIF et porter au moins un rôle.
    const { data: profilAppelant } = await admin
      .from('profils')
      .select('actif')
      .eq('user_id', appelantAuth.user.id)
      .maybeSingle();
    if (!profilAppelant?.actif) {
      return new Response('Compte inactif ou inconnu', { status: 403, headers: entetes });
    }
    const { data: sesRoles } = await admin
      .from('profils_roles')
      .select('role')
      .eq('user_id', appelantAuth.user.id);
    const rolesAppelant = (sesRoles ?? []).map((r: { role: string }) => r.role);

    const corps = (await req.json()) as {
      email?: unknown;
      nom?: unknown;
      role?: unknown;
      roles?: unknown;
      /** Page de supervision qui accueillera la personne pour choisir son mot de passe. */
      redirectTo?: string;
    };
    const email = typeof corps.email === 'string' ? corps.email.trim() : '';
    const nom = typeof corps.nom === 'string' ? corps.nom.trim() : '';
    const roles = rolesDemandes(corps);
    if (!email || !nom) {
      return new Response('Nom et adresse e-mail requis', { status: 400, headers: entetes });
    }
    if (roles.length === 0) {
      return new Response('Au moins un rôle est requis', { status: 400, headers: entetes });
    }

    // La matrice est une DONNÉE lue en base, jamais une constante recopiée ici :
    // une seule source de vérité, celle qu'appliquent aussi les politiques RLS.
    const { data: catalogue } = await admin.from('roles').select('code, attribuable_par');
    const attribuables = new Set(
      (catalogue ?? [])
        .filter((r: { code: string; attribuable_par: string[] }) =>
          (r.attribuable_par ?? []).some((code) => rolesAppelant.includes(code)),
        )
        .map((r: { code: string }) => r.code),
    );
    const refuses = roles.filter((r) => !attribuables.has(r));
    if (refuses.length > 0) {
      return new Response(
        `Vous n’êtes pas habilité à attribuer : ${refuses.join(', ')}.`,
        { status: 403, headers: entetes },
      );
    }

    // Le lien de l'e-mail doit ramener sur NOTRE page de supervision (et non
    // sur la « Site URL » du projet) : on ne relaie l'adresse demandée que si
    // elle appartient à une origine connue — jamais de redirection ouverte.
    const retour = urlRetourAutorisee(corps.redirectTo);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      retour ? { redirectTo: retour } : undefined,
    );
    if (error || !data.user) {
      return new Response(error?.message ?? 'Invitation impossible', {
        status: 400,
        headers: entetes,
      });
    }

    // À partir d'ici, tout échec doit défaire l'invitation.
    const annuler = async (message: string, statut = 400) => {
      await admin.auth.admin.deleteUser(data.user!.id);
      return new Response(message, { status: statut, headers: entetes });
    };

    const profil = await appelant
      .from('profils')
      .insert({ user_id: data.user.id, nom, email, actif: true })
      .select();
    if (profil.error || (profil.data ?? []).length === 0) {
      return annuler(profil.error?.message ?? 'Création du profil refusée', 403);
    }

    const liaison = await appelant
      .from('profils_roles')
      .insert(roles.map((role) => ({ user_id: data.user!.id, role })))
      .select();
    if (liaison.error || (liaison.data ?? []).length !== roles.length) {
      return annuler(liaison.error?.message ?? 'Attribution des rôles refusée', 403);
    }

    return new Response(JSON.stringify({ ok: true, roles }), { headers: entetes });
  } catch (erreur) {
    return new Response(String(erreur), { status: 500, headers: entetes });
  }
});
