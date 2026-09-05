// Edge Function « traduire » (Deno) — traduction FR → EN des messages via
// DeepL Free. La clé DEEPL_API_KEY est un secret Supabase : elle ne transite
// JAMAIS côté front. En cas d'échec, le front replie sur son dictionnaire local.
// Accès réservé aux profils ACTIFS portant au moins un rôle (n'importe lequel :
// la caisse rédige des messages) :
// l'URL de la fonction est dans le bundle public, sans ce contrôle n'importe qui
// pourrait épuiser le quota DeepL de la Régie.
// Déploiement : supabase functions deploy traduire
//               supabase secrets set DEEPL_API_KEY=...
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Origines autorisées (CORS) : le site public et le serveur de dév local.
const ORIGINES_AUTORISEES = ['https://rdtmb.github.io', 'http://localhost:5173'];
// L'interface borne déjà les messages à 200 caractères ; 500 laisse une marge.
const LONGUEUR_MAX = 500;

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

    // L'appelant doit être un profil ACTIF portant AU MOINS UN rôle (peu
    // importe lequel : la caisse aussi rédige des messages). Le rôle compte,
    // et pas seulement `actif` : une personne dont on a retiré tous les rôles
    // — départ, fin de mission — garderait sinon l'accès au quota DeepL.
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: appelant } = await admin.auth.getUser(jwt);
    if (!appelant.user) return new Response('Non connecté', { status: 401, headers: entetes });
    const { data: profil } = await admin
      .from('profils')
      .select('actif')
      .eq('user_id', appelant.user.id)
      .maybeSingle();
    const { count: nbRoles } = await admin
      .from('profils_roles')
      .select('role', { count: 'exact', head: true })
      .eq('user_id', appelant.user.id);
    if (!profil?.actif || !nbRoles) {
      return new Response('Réservé aux agents actifs', { status: 403, headers: entetes });
    }

    const { texte } = (await req.json()) as { texte?: string };
    if (texte && texte.length > LONGUEUR_MAX) {
      return new Response('Texte trop long', { status: 400, headers: entetes });
    }
    const cle = Deno.env.get('DEEPL_API_KEY');
    if (!texte || !cle) return new Response(JSON.stringify({ texte_en: null }), { headers: entetes });
    const reponse = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${cle}` },
      body: JSON.stringify({ text: [texte], source_lang: 'FR', target_lang: 'EN-GB' }),
    });
    if (!reponse.ok) return new Response(JSON.stringify({ texte_en: null }), { headers: entetes });
    const donnees = (await reponse.json()) as { translations?: { text: string }[] };
    return new Response(JSON.stringify({ texte_en: donnees.translations?.[0]?.text ?? null }), {
      headers: entetes,
    });
  } catch {
    // Ne jamais renvoyer le détail de l'erreur : une trace pourrait contenir la clé DeepL.
    return new Response(JSON.stringify({ texte_en: null }), { headers: entetes });
  }
});
