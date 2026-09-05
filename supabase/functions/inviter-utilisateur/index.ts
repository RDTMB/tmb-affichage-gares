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
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: appelantAuth } = await admin.auth.getUser(jwt);
    if (!appelantAuth.user) return new Response('Non connecté', { status: 401, headers: entetes });

    // Client agissant AU NOM de l'agent : ses écritures traversent RLS.
    const appelant = createClient(
      url,
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
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
