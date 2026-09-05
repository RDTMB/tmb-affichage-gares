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

    // Client agissant AU NOM de l'agent : la désactivation traverse RLS.
    const appelant = createClient(
      url,
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
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
