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
  // La clé se lit AVANT le `try` : son `catch` répond « pas de traduction »
  // sans rien dire, ce qui est juste pour un échec de DeepL (le front replie sur
  // son dictionnaire) mais masquerait un défaut de configuration. Ici la panne
  // est dite franchement — 500 — et `cleApi()` l'a déjà écrite dans les
  // journaux. Le message reste FIXE : la règle du `catch` ci-dessous, ne jamais
  // laisser sortir un détail d'erreur, vaut aussi pour celui-ci.
  let secrete: string;
  try {
    secrete = cleSecrete();
  } catch {
    return new Response('Configuration incomplète : clé d’API Supabase absente.', {
      status: 500,
      headers: entetes,
    });
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, secrete);

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
