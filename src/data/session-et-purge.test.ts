// §C — session et comptes : trois points du lot 3.
//
// C.1 (E-01) — « Quitter » ne déconnectait PAS. Le gestionnaire existait, mais
// il n'y avait aucun `signOut` dans tout `src/` : le bouton vidait
// `sessionStorage` et rechargeait la page, or le jeton de rafraîchissement de
// Supabase vit dans `localStorage`. La session survivait donc à la sortie, sur
// un poste de gare éventuellement partagé, et un simple rechargement y rentrait.
//
// C.2 (E-02) — `detectSessionInUrl` était actif PARTOUT, écrans de gare
// compris : un lien d'invitation ouvert par erreur sur un écran en kiosque y
// ouvrait une session, sans que personne s'en aperçoive.
//
// C.3 (F-01) — la purge du journal. Une moitié du constat était déjà corrigée,
// l'autre non : voir le describe correspondant.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(chemin: string): string {
  const url = new URL(`../../${chemin}`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\r\n/g, '\n');
}

/** Le SQL sans ses commentaires : seules les instructions réelles comptent. */
function instructions(texte: string): string {
  return texte
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

const MIGRATION = 'supabase/migrations/2026-09-purge-journal-bornee.sql';

describe('C.1 — « Quitter » déconnecte pour de vrai', () => {
  it('`signOut` existe dans l’interface et dans les DEUX fournisseurs', () => {
    // Il n'existait nulle part dans `src/` : c'est tout le défaut.
    expect(source('src/data/provider.ts')).toContain('signOut(): Promise<void>;');
    expect(source('src/data/supabase.ts')).toContain('async signOut(): Promise<void> {');
    expect(source('src/data/mock.ts')).toContain('async signOut(): Promise<void> {');
  });

  it('le bouton appelle la déconnexion AVANT de nettoyer et de recharger', () => {
    // L'ordre compte : un rechargement anticipé interromprait l'appel réseau
    // et laisserait la session ouverte.
    const src = source('src/pages/supervision.ts');
    const appel = src.indexOf('provider\n      .signOut()');
    const nettoyage = src.indexOf('sessionStorage.clear();', appel);
    const rechargement = src.indexOf('window.location.reload();', appel);
    expect(appel, 'appel à signOut() introuvable').toBeGreaterThan(0);
    expect(nettoyage).toBeGreaterThan(appel);
    expect(rechargement).toBeGreaterThan(nettoyage);
  });

  it('un échec de déconnexion ne retient pas l’agent devant un écran connecté', () => {
    // Réseau coupé : on nettoie et on recharge quand même. Le fournisseur a
    // de son côté déjà oublié le profil qu'il gardait en mémoire.
    const src = source('src/pages/supervision.ts');
    expect(src).toContain('.catch(() => undefined)');
    expect(src).toContain('.finally(() => {');
  });

  it('le fournisseur oublie le profil AVANT l’appel réseau', () => {
    // C'était le défaut I-10, corrigé pour `signIn` et jamais pour la sortie :
    // un cache de rôle qui survit à la déconnexion laisse les droits du compte
    // précédent en mémoire.
    const src = source('src/data/supabase.ts');
    const bloc = src.slice(
      src.indexOf('async signOut(): Promise<void> {'),
      src.indexOf('async getProfil()'),
    );
    const oubli = bloc.indexOf('this.profilCache = null;');
    const appel = bloc.indexOf('this.client.auth.signOut(');
    expect(oubli, 'oubli du cache introuvable').toBeGreaterThan(-1);
    expect(appel, 'appel signOut introuvable').toBeGreaterThan(oubli);
  });

  it('la portée est LOCALE : on ne déconnecte pas les collègues', () => {
    // Un agent qui quitte la supervision d'une gare ne doit pas fermer la
    // session de son collègue ailleurs sur la ligne.
    expect(source('src/data/supabase.ts')).toContain(
      "this.client.auth.signOut({ scope: 'local' })",
    );
  });
});

describe('C.2 — `detectSessionInUrl` coupé pour les seules pages d’affichage', () => {
  it('les pages d’affichage passent par la fabrique qui le coupe', () => {
    // Elles n'ont aucune session à ouvrir : elles lisent, elles n'écrivent
    // jamais.
    expect(source('src/data/index.ts')).toContain('return new SupabaseProvider(url, cle, true);');
    for (const chemin of ['src/pages/ecran.ts', 'src/pages/grille.ts']) {
      expect(source(chemin), chemin).toContain('creeProviderReel(');
    }
  });

  it('la SUPERVISION garde le comportement : elle en a besoin', () => {
    // C'est `detectSessionInUrl` qui consomme le fragment des liens
    // d'invitation et de réinitialisation, et qui donne à
    // `definirMotDePasse` la session sur laquelle il travaille. Le couper
    // partout casserait le parcours « choisir son mot de passe », corrigé le
    // 04/09 et jamais éprouvé en réel — donc on ne s'en apercevrait pas tout
    // de suite.
    const index = source('src/data/index.ts');
    expect(index).toContain('return new SupabaseProvider(config.supabaseUrl, config.supabaseKey);');
    expect(source('src/pages/supervision.ts')).toContain('creeProvider({ echecSimule })');
    expect(source('src/data/supabase.ts')).toContain('definirMotDePasse');
  });

  it('le DÉFAUT du paramètre est l’ancien comportement, à l’inverse de creerSiAbsent', () => {
    // Choix opposé à celui de `creerSiAbsent`, et pour une raison : ici le
    // défaut protège un parcours FRAGILE et jamais éprouvé, alors que là-bas
    // il empêchait une écriture. On ne met pas le mot de passe à la merci
    // d'un appelant qui oublierait une option.
    expect(source('src/data/supabase.ts')).toContain(
      'constructor(url: string, clePubliable: string, sansSession = false) {',
    );
  });

  it('les trois réglages de session sont coupés ENSEMBLE', () => {
    // `persistSession` avec `detectSessionInUrl` : sans lui, une session déjà
    // écrite dans `localStorage` par une version antérieure resterait relue à
    // chaque démarrage de l'écran. `autoRefreshToken` n'a alors plus d'objet.
    const src = source('src/data/supabase.ts');
    const bloc = src.slice(src.indexOf('...(sansSession'), src.indexOf('global: {'));
    for (const reglage of [
      'detectSessionInUrl: false',
      'persistSession: false',
      'autoRefreshToken: false',
    ]) {
      expect(bloc, reglage).toContain(reglage);
    }
  });
});

describe('C.3 — la purge du journal : ce qui était ouvert, et ce qui ne l’était pas', () => {
  const schema = instructions(source('supabase/schema.sql'));
  const fonction = schema.slice(
    schema.indexOf('create or replace function private.purge_journal_exploitation'),
    schema.indexOf('revoke all on function private.purge_journal_exploitation'),
  );

  it('le contrôle de RÔLE existait déjà : rien n’est ajouté en double', () => {
    // Le constat F-01 annonçait « n'importe quel compte connecté peut effacer
    // le journal ». Ce n'est plus vrai depuis le commit des rôles multiples :
    // le corps refuse tout appelant connecté qui n'est pas technique. Et le
    // schéma `private` n'est pas exposé par PostgREST, donc la fonction n'est
    // appelable depuis aucun front. Ajouter un second contrôle aurait fait
    // doublon avec le premier.
    expect(fonction).toContain("private.a_le_role('technique')");
    expect(fonction).toContain("errcode = 'insufficient_privilege'");
    // Un seul contrôle de rôle, pas deux.
    expect(fonction.match(/a_le_role\('technique'\)/g) ?? []).toHaveLength(1);
  });

  it('le PARAMÈTRE est désormais borné : zéro, négatif et null sont refusés', () => {
    // La moitié réellement ouverte. `make_interval(months => 0)` donne un
    // intervalle nul, donc `quand < now()` efface le journal ENTIER — la
    // trace de toutes les écritures depuis l'installation, sans retour.
    expect(fonction).toContain('if mois is null or mois < 1 then');
    expect(fonction).toContain("errcode = 'invalid_parameter_value'");
    expect(fonction).toContain('Purge refusée');
  });

  it('la borne est testée AVANT la suppression', () => {
    // Une borne posée après le `delete` ne protégerait de rien.
    const borne = fonction.indexOf('if mois is null or mois < 1 then');
    const suppression = fonction.indexOf('delete from public.journal_exploitation');
    expect(borne).toBeGreaterThan(0);
    expect(suppression).toBeGreaterThan(borne);
  });

  it('le message de refus DIT la valeur reçue et la valeur normale', () => {
    // Un refus qui ne dit pas ce qu'il attendait se contourne au hasard.
    expect(fonction).toContain('(reçu : %)');
    expect(fonction).toContain('purge_journal_exploitation(12)');
  });
});

describe('C.3 — la migration et sa copie dans le schéma', () => {
  it('les deux copies de la fonction sont identiques', () => {
    // Règle du projet : une migration et son entrée dans schema.sql ne
    // doivent jamais diverger, sinon une nouvelle installation et une base
    // existante n'ont pas le même comportement.
    const extrait = (fichier: string): string => {
      const code = instructions(source(fichier));
      const debut = code.indexOf('create or replace function private.purge_journal_exploitation');
      const fin = code.indexOf('grant execute on function private.purge_journal_exploitation');
      if (debut === -1 || fin === -1) throw new Error(`${fichier} : fonction introuvable`);
      return code.slice(debut, fin).trim();
    };
    expect(extrait(MIGRATION)).toBe(extrait('supabase/schema.sql'));
  });

  it('le contrôle préalable est en LECTURE SEULE', () => {
    const brut = source(MIGRATION);
    const avant = instructions(brut.slice(0, brut.indexOf('create or replace function')));
    expect(avant).toContain('from journal_exploitation');
    for (const verbe of ['update ', 'insert ', 'delete ', 'alter ', 'drop ']) {
      expect(avant.toLowerCase(), verbe).not.toContain(verbe);
    }
  });

  it('la purge elle-même et les trois refus sont COMMENTÉS', () => {
    // Un script de migration ne doit jamais effacer douze mois de traces
    // parce qu'on l'a collé en entier.
    const brut = source(MIGRATION);
    const apres = brut.slice(brut.lastIndexOf('\n', brut.indexOf('3. VÉRIFICATION APRÈS')) + 1);
    for (const ligne of apres.split('\n')) {
      if (ligne.trim() === '') continue;
      expect(ligne.trimStart().startsWith('--'), ligne).toBe(true);
    }
    expect(apres).toContain('purge_journal_exploitation(0)');
    expect(apres).toContain('purge_journal_exploitation(12)');
  });

  it('elle dit ce qu’elle NE corrige pas, et pourquoi', () => {
    // Sans cela, la prochaine lecture du constat F-01 rouvrirait le sujet et
    // ajouterait le contrôle de rôle en double.
    const brut = source(MIGRATION);
    expect(brut).toContain('034b798');
    expect(brut).toContain("n'est de toute façon PAS");
    expect(brut).toContain('Rejouable');
  });
});
