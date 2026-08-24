// Edge Function « inviter-utilisateur » (Deno) — création de compte par
// invitation email (docs/02 §5). Utilise la clé service_role côté serveur
// UNIQUEMENT ; l'appelant doit être un admin actif (vérifié via son JWT).
// Déploiement : supabase functions deploy inviter-utilisateur
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const entetes = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
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

    const { email, nom, role } = (await req.json()) as {
      email: string;
      nom: string;
      role: 'admin' | 'supervision' | 'caisse';
    };
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error || !data.user) {
      return new Response(error?.message ?? 'Invitation impossible', { status: 400, headers: entetes });
    }
    await admin.from('profils').upsert({ user_id: data.user.id, nom, email, role, actif: true });
    return new Response(JSON.stringify({ ok: true }), { headers: entetes });
  } catch (erreur) {
    return new Response(String(erreur), { status: 500, headers: entetes });
  }
});
