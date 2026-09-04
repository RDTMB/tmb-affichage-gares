// Edge Function « inviter-utilisateur » (Deno) — création de compte par
// invitation email (docs/02 §5). Utilise la clé service_role côté serveur
// UNIQUEMENT ; l'appelant doit être un admin actif (vérifié via son JWT).
// Déploiement : supabase functions deploy inviter-utilisateur
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

    const { email, nom, role, redirectTo } = (await req.json()) as {
      email: string;
      nom: string;
      role: 'admin' | 'supervision' | 'caisse';
      /** Page de supervision qui accueillera la personne pour choisir son mot de passe. */
      redirectTo?: string;
    };
    // Le lien de l'e-mail doit ramener sur NOTRE page de supervision (et non
    // sur la « Site URL » du projet) : on ne relaie l'adresse demandée que si
    // elle appartient à une origine connue — jamais de redirection ouverte.
    const retour = urlRetourAutorisee(redirectTo);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      retour ? { redirectTo: retour } : undefined,
    );
    if (error || !data.user) {
      return new Response(error?.message ?? 'Invitation impossible', { status: 400, headers: entetes });
    }
    await admin.from('profils').upsert({ user_id: data.user.id, nom, email, role, actif: true });
    return new Response(JSON.stringify({ ok: true }), { headers: entetes });
  } catch (erreur) {
    return new Response(String(erreur), { status: 500, headers: entetes });
  }
});
