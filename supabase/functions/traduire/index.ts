// Edge Function « traduire » (Deno) — traduction FR → EN des messages via
// DeepL Free. La clé DEEPL_API_KEY est un secret Supabase : elle ne transite
// JAMAIS côté front. En cas d'échec, le front replie sur son dictionnaire local.
// Déploiement : supabase functions deploy traduire
//               supabase secrets set DEEPL_API_KEY=...
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
    const { texte } = (await req.json()) as { texte?: string };
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
    return new Response(JSON.stringify({ texte_en: null }), { headers: entetes });
  }
});
