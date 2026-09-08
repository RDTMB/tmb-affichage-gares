// §E — deux colonnes d'horodatage qui mentaient.
//
// `params.maj` et `circulations.maj` sont déclarées `default now()`, or un
// défaut ne s'applique qu'à l'INSERT. `saveParams` fait un upsert sans jamais
// toucher `maj`, et aucun déclencheur du schéma ne la remontait : les deux
// restaient FIGÉES à la date de création de la ligne, alors que leur nom
// promet la dernière écriture.
//
// Ce n'est pas cosmétique. Mesuré en production le 07/09/2026 : `params.maj`
// de la clé `meteo_sommet` valait le 24/08 alors que la météo avait été saisie
// le matin même, et la conclusion tirée de cette lecture — « météo de quatorze
// jours » — a été annoncée à tort en gare.
//
// DÉTERMINATION : un déclencheur, pas une suppression. Le geste est ADDITIF et
// réversible, là où `drop column` ne l'est pas en production ; `params` a une
// ligne par clé, donc `params.maj` de la ligne `meteo_sommet` date réellement
// la météo, ce que `heure_releve` (saisi à la main, sans date) ne dira jamais
// seul ; et le journal d'exploitation ne rend PAS ces colonnes redondantes,
// puisqu'il ne consigne que les valeurs changées — une ligne réécrite à
// l'identique n'y laisse aucune trace, là où `maj` la datera.
//
// Le SQL est la frontière : on le teste sur le TEXTE, comme securite.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'migrations/2026-09-maj-honnete.sql';

function sql(fichier: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../supabase/${fichier}`, import.meta.url)),
    'utf-8',
  ).replace(/\r\n/g, '\n');
}

/** Le SQL sans ses commentaires : seules les instructions réelles comptent. */
function instructions(texte: string): string {
  return texte
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
}

/**
 * Le bloc « fonction + deux déclencheurs », de la création de la fonction à la
 * dernière ligne du second déclencheur. C'est CE fragment qui doit être
 * identique dans les deux fichiers.
 */
function blocMaj(fichier: string): string {
  const code = instructions(sql(fichier));
  const debut = code.indexOf('create or replace function private.remonte_maj()');
  const marqueurFin = 'create trigger trg_maj_circulations before update on circulations';
  const fin = code.indexOf(marqueurFin);
  if (debut === -1 || fin === -1) throw new Error(`${fichier} : bloc « maj » introuvable`);
  return code.slice(debut, code.indexOf(';', fin) + 1).trim();
}

describe('les deux copies du correctif sont identiques', () => {
  it('schema.sql et la migration portent le MÊME bloc', () => {
    // Règle du projet : une migration et son entrée dans schema.sql ne doivent
    // jamais diverger, sinon une nouvelle installation et une base existante
    // n'ont pas le même comportement — et personne ne s'en aperçoit avant des
    // mois.
    expect(blocMaj(MIGRATION)).toBe(blocMaj('schema.sql'));
  });
});

describe('le déclencheur remonte bien les deux colonnes', () => {
  const code = instructions(sql('schema.sql'));

  it('une seule fonction, `before update`, sur les DEUX tables', () => {
    expect(code).toContain('new.maj := now();');
    expect(code).toContain('create trigger trg_maj_params before update on params');
    expect(code).toContain('create trigger trg_maj_circulations before update on circulations');
  });

  it('`before` et non `after` : un `after` ne peut plus modifier NEW', () => {
    // Une erreur classique, et silencieuse : le déclencheur s'installerait
    // sans broncher et ne changerait rien.
    for (const nom of ['trg_maj_params', 'trg_maj_circulations']) {
      const ligne = code.split('\n').find((l) => l.includes(`create trigger ${nom}`));
      expect(ligne, nom).toBeDefined();
      expect(ligne, nom).toContain('before update');
      expect(ligne, nom).not.toContain('after');
    }
  });

  it('rejouable : chaque déclencheur est supprimé avant d’être recréé', () => {
    for (const nom of ['trg_maj_params', 'trg_maj_circulations']) {
      expect(code, nom).toContain(`drop trigger if exists ${nom} on`);
    }
    expect(code).toContain('create or replace function private.remonte_maj()');
  });

  it('`search_path` verrouillé à vide, et la fonction retirée de `public`', () => {
    // Même exigence que toutes les fonctions du schéma. `now()` s'y résout
    // quand même : il vit dans `pg_catalog`, toujours implicite.
    expect(code).toContain(
      "create or replace function private.remonte_maj()\nreturns trigger language plpgsql set search_path = '' as $fn$",
    );
    expect(code).toContain('revoke all on function private.remonte_maj() from public;');
  });

  it('PAS `security definer` : la fonction ne touche que NEW', () => {
    // La leçon du 07/09 : une fonction `security definer` écrit « sans
    // visage ». Ici c'est inutile, donc c'est interdit.
    const fonction = code.slice(
      code.indexOf('create or replace function private.remonte_maj()'),
      code.indexOf('revoke all on function private.remonte_maj()'),
    );
    expect(fonction).not.toContain('security definer');
  });
});

describe('aucun bruit au journal d’exploitation', () => {
  const code = instructions(sql('schema.sql'));

  it('les deux traceurs surveillent une LISTE de colonnes, sans `maj`', () => {
    // Un traceur sans liste explicite surveille toutes les colonnes sauf
    // `id` et `maj` ; avec liste, il ne surveille que celles-là. Dans les deux
    // cas `maj` est dehors — sinon chaque écriture produirait une ligne de
    // journal « maj : hier → maintenant », illisible et inutile.
    for (const [table, colonnes] of [
      ['circulations', ["'statut'", "'terminus'"]],
      ['params', ["'valeur'"]],
    ] as const) {
      const debut = code.indexOf(`create trigger trg_journal_${table}`);
      expect(debut, table).toBeGreaterThan(0);
      const bloc = code.slice(debut, code.indexOf(';', debut));
      for (const colonne of colonnes) expect(bloc, table).toContain(colonne);
      expect(bloc, table).not.toContain("'maj'");
    }
    // Et le repli sans liste exclut `maj` explicitement.
    expect(code).toContain("where k not in ('id', 'maj')");
  });
});

describe('la migration se relit sans risque', () => {
  const brut = sql(MIGRATION);

  it('le contrôle préalable est en LECTURE SEULE', () => {
    // Il précède la modification et ne doit rien changer : c'est un constat de
    // l'écart entre `maj` et la dernière écriture datée par le journal.
    const avant = brut.slice(0, brut.indexOf('create or replace function'));
    const code = instructions(avant);
    expect(code).toContain('from params p');
    expect(code).toContain('left join journal_exploitation j');
    for (const verbe of ['update ', 'insert ', 'delete ', 'alter ', 'drop ']) {
      expect(code.toLowerCase(), verbe).not.toContain(verbe);
    }
  });

  it('l’essai de fin est COMMENTÉ : il écrit, et seulement sur le test', () => {
    // Découpe au DÉBUT de la ligne : couper au milieu laisserait le premier
    // fragment sans son « -- », et le contrôle se plaindrait de lui-même.
    const apres = brut.slice(brut.lastIndexOf('\n', brut.indexOf('4. ESSAI')) + 1);
    for (const ligne of apres.split('\n')) {
      if (ligne.trim() === '') continue;
      expect(ligne.trimStart().startsWith('--'), ligne).toBe(true);
    }
    expect(apres).toContain('projet de TEST uniquement');
  });

  it('elle dit qu’elle est rejouable et où est sa copie', () => {
    expect(brut).toContain('Rejouable');
    expect(brut).toContain('supabase/schema.sql');
  });
});
