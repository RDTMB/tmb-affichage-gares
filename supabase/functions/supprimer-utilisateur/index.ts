// Edge Function « supprimer-utilisateur » (Deno) — suppression définitive
// d'un compte (docs/02 §5). Utilise la clé service_role côté serveur
// UNIQUEMENT ; l'appelant doit être un admin actif (vérifié via son JWT).
// `on delete cascade` sur profils.user_id supprime le profil automatiquement.
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

    // L'appelant doit être un profil admin actif
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: appelant } = await admin.auth.getUser(jwt);
    if (!appelant.user) return new Response('Non connecté', { status: 401, headers: entetes });
    const { data: profil } = await admin
      .from('profils')
      .select('role, actif')
      .eq('user_id', appelant.user.id)
      .maybeSingle();
    if (profil?.role !== 'admin' || !profil.actif) {
      return new Response('Réservé aux administrateurs', { status: 403, headers: entetes });
    }

    const { user_id } = (await req.json()) as { user_id: string };
    if (!user_id) return new Response('user_id requis', { status: 400, headers: entetes });
    if (user_id === appelant.user.id) {
      return new Response('Impossible de supprimer votre propre compte connecté', {
        status: 400,
        headers: entetes,
      });
    }

    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) return new Response(error.message, { status: 400, headers: entetes });
    return new Response(JSON.stringify({ ok: true }), { headers: entetes });
  } catch (erreur) {
    return new Response(String(erreur), { status: 500, headers: entetes });
  }
});
