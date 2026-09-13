// Deux dettes nommées — lot du 14/09/2026.
//
// CE QUE CES TESTS PROTÈGENT.
//
//  §1 — LA TRACE. `service_role` a été essayé comme propriétaire de
//       `definir_acces` le 13/09 et ne convient pas : il n'a pas `CREATE` sur
//       le schéma `public`, droit que PostgreSQL exige du NOUVEAU
//       propriétaire. Le raisonnement qui y mène reste séduisant — NOLOGIN,
//       sans objets, plus étroit que `postgres` — et sans cette trace une
//       prochaine session referait la tentative CONTRE UNE BASE. Le coût d'un
//       commentaire perdu se paie en déploiement raté.
//
//  §2 — LA TOLÉRANCE sur `acces`. Elle est datée et bornée, mais sa
//       justification repose sur trois plafonds du code. Si l'un d'eux était
//       relevé, la tolérance cesserait d'être auto-refermante sans que
//       personne ne s'en aperçoive — et un reste silencieux est une dette qui
//       grossit.
//
// ⚠ LE PIRE RÉSULTAT POSSIBLE de ce lot serait un voyageur devant un panneau
//   qui a perdu la moitié de ses départs. Le test « une circulation sans
//   `acces` arrive à l'écran sans disparaître » est celui qui l'interdit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { passagesPourGare, trainsDuJour } from '../core/horaires';
import { accesValide, courseFermee } from '../core/types';
import type { Circulation, Grille, Jour } from '../core/types';
import { CACHE_MAX_MINUTES, CACHE_MIN_MINUTES } from './affichage-commun';
import { SEUIL_BADGE_MS } from './resilience';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const GRAND = grandServiceJson as unknown as Grille;

/**
 * Une journée dont le TRAIN 11 vient d'un instantané ÉCRIT AVANT le
 * déploiement du 13/09 : l'objet n'a pas la clé `acces`. C'est exactement ce
 * que `JSON.parse` rend d'un `localStorage` écrit par l'ancien bundle — le
 * type le déclare obligatoire, mais la conversion d'un instantané ne le
 * vérifie pas.
 */
function jourDInstantaneAncien(): Jour {
  const sansAcces: Record<string, unknown> = {
    date: '2026-07-15',
    numero: 11,
    sens: 'montee',
    express: false,
    facultatif: false,
    facultatif_actif: false,
    velos: false,
    rame: 'Anne',
    terminus: 'nid-daigle',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    sans_voyageurs: false,
    nature: 'grille',
    depart_reel: null,
    commanditaire: null,
    libelle: null,
    // PAS de clé `acces` : c'est tout l'objet du test.
  };
  return {
    date: '2026-07-15',
    grille_version: GRAND.version,
    terminus_bellevue: false,
    gare_debut: 'le-fayet',
    gare_fin: 'nid-daigle',
    message_troncon_fr: null,
    message_troncon_en: null,
    enregistre: true,
    circulations: [sansAcces as unknown as Circulation],
  };
}

// ===========================================================================
// §2 — LE CHEMIN COMPLET : rien ne disparaît
// ===========================================================================
describe('une circulation sans `acces` arrive à l’écran sans disparaître', () => {
  it('la clé est bien ABSENTE de la fixture — sinon le test ne prouve rien', () => {
    const c = jourDInstantaneAncien().circulations[0];
    expect(Object.prototype.hasOwnProperty.call(c ?? {}, 'acces')).toBe(false);
  });

  it('le train traverse `trainsDuJour()` et y garde sa place', () => {
    const t = trainsDuJour(GRAND, jourDInstantaneAncien()).find((x) => x.numero === 11);
    expect(t, 'le TRAIN 11 a disparu de la journée').toBeDefined();
    expect(t?.acces, 'l’absence n’a pas été comblée').toBe('public');
  });

  it('…et arrive au PASSAGE DE GARE, qui alimente l’écran', () => {
    const p = passagesPourGare(GRAND, jourDInstantaneAncien(), 'saint-gervais').find(
      (x) => x.numero === 11,
    );
    expect(p, 'le TRAIN 11 a disparu de l’écran de Saint-Gervais').toBeDefined();
    expect(p?.acces).toBe('public');
  });

  it('il n’est PAS pris pour une course fermée — ni pastille, ni sortie du guichet', () => {
    // Le pire résultat possible : un train affiché « Privé » à tort, ou retiré
    // de l'onglet Places, parce qu'une colonne manquait.
    const p = passagesPourGare(GRAND, jourDInstantaneAncien(), 'saint-gervais').find(
      (x) => x.numero === 11,
    );
    expect(courseFermee(p ?? {})).toBe(false);
    const t = trainsDuJour(GRAND, jourDInstantaneAncien()).find((x) => x.numero === 11);
    expect(courseFermee(t ?? {})).toBe(false);
  });

  it('la journée ENTIÈRE reste affichée, pas seulement le train témoin', () => {
    // Un panneau qui perd la moitié de ses départs est le défaut que ce lot
    // doit rendre impossible.
    //
    // COMPARAISON À TÉMOIN : la MÊME journée, au seul `acces` près. C'est la
    // seule façon d'isoler la variable — comparer à une journée vide ne
    // prouvait rien (`trainsDuJour()` construit les trains depuis la grille
    // quoi qu'il arrive), et comparer au nombre de trains de la grille non
    // plus (les facultatifs non activés en sont écartés : 18 sur 26).
    const ancien = jourDInstantaneAncien();
    const temoin: Jour = {
      ...ancien,
      circulations: ancien.circulations.map((c) => ({ ...c, acces: 'public' as const })),
    };
    const trains = trainsDuJour(GRAND, ancien);
    expect(trains.length, 'des trains ont disparu').toBe(trainsDuJour(GRAND, temoin).length);
    expect(trains.map((t) => t.numero)).toEqual(trainsDuJour(GRAND, temoin).map((t) => t.numero));

    // …et les passages de gare aussi : c'est eux que le voyageur lit.
    const passages = passagesPourGare(GRAND, ancien, 'saint-gervais');
    const passagesTemoin = passagesPourGare(GRAND, temoin, 'saint-gervais');
    expect(passages.length, 'des départs ont disparu de l’écran').toBe(passagesTemoin.length);
    expect(
      passages.length,
      'aucun départ à Saint-Gervais : le test ne prouve rien',
    ).toBeGreaterThan(0);
  });

  it('`accesValide()` ramène toute absence à `public`, jamais à une valeur fermée', () => {
    for (const v of [undefined, null, '', 'gratuit', 0, {}, []]) {
      expect(accesValide(v), String(v)).toBe('public');
      expect(courseFermee({ acces: accesValide(v) }), String(v)).toBe(false);
    }
  });
});

// ===========================================================================
// §2 — la tolérance repose sur des plafonds qui la REFERMENT
// ===========================================================================
describe('la tolérance sur `acces` est datée, et ses plafonds la referment', () => {
  it('les trois plafonds qui la bornent existent et sont FINIS', () => {
    // Si l'un d'eux était relevé — ou retiré — la tolérance cesserait d'être
    // auto-refermante, et la décision du 14/09 devrait être reprise.
    const resilience = source('src/pages/resilience.ts');
    const ageMax = /const AGE_MAX_INSTANTANE_MS = ([^;]+);/.exec(resilience)?.[1] ?? '';
    expect(ageMax, 'AGE_MAX_INSTANTANE_MS a disparu').not.toBe('');
    // 24 h : au-delà, l'instantané est REJETÉ, donc plus aucune circulation
    // d'avant le déploiement ne peut être relue.
    expect(ageMax.replace(/\s/g, '')).toBe('24*60*60_000');
    // Le badge annonce la péremption bien avant, et l'écran neutre prend la
    // main au plus tard au bout de CACHE_MAX_MINUTES.
    expect(SEUIL_BADGE_MS).toBeLessThan(CACHE_MIN_MINUTES * 60_000);
    expect(CACHE_MAX_MINUTES * 60_000).toBeLessThan(24 * 60 * 60_000);
  });

  it('seuls les ÉCRANS ont un instantané : l’absence ne peut venir que de là', () => {
    // C'est ce qui rend un signal « à la paramsAvecCorrections » incapable
    // d'atteindre : la supervision, qui seule pourrait l'afficher, n'a pas de
    // cache et rapporterait toujours zéro.
    const pagesAvecCache = ['src/pages/ecran.ts', 'src/pages/grille.ts'] as const;
    for (const p of pagesAvecCache) {
      expect(source(p), `${p} ne met plus en cache`).toContain('creeSynchronisation<');
    }
    expect(
      source('src/pages/supervision.ts'),
      'la supervision s’est mise à garder un instantané : revoir la décision du 14/09',
    ).not.toContain('creeSynchronisation');
  });

  it('le RÉSEAU ne peut pas rendre une circulation sans `acces`', () => {
    // Les deux `select` la nomment, et la colonne est `not null` en base.
    const selects = [
      ...source('src/data/supabase.ts').matchAll(/\.select\(\s*\n?\s*'(date, numero, sens[^']*)'/g),
    ].map((m) => (m[1] ?? '').split(',').map((c) => c.trim()));
    expect(selects.length, 'les deux select de getJour sont introuvables').toBe(2);
    for (const colonnes of selects) expect(colonnes).toContain('acces');
    expect(source('supabase/schema.sql')).toContain("acces text not null default 'public',");
  });

  it('la décision est ÉCRITE et datée, avec sa condition de levée', () => {
    // Une tolérance sans date ni condition est un reste ; un reste silencieux
    // est une dette qui grossit.
    const types = source('src/core/types.ts');
    expect(types).toContain('TOLÉRANCE DATÉE');
    expect(types).toContain('AGE_MAX_INSTANTANE_MS');
    expect(types).toContain('CE QUI ROUVRIRAIT LA QUESTION');
  });
});

// ===========================================================================
// §1 — la TRACE, pour que la tentative ne se refasse pas contre une base
// ===========================================================================
describe('le propriétaire de `definir_acces` : la tentative reste écrite', () => {
  const migration = source('supabase/migrations/2026-09-acces-course.sql');

  it('la mesure du 13/09 est conservée, chiffrée', () => {
    expect(migration).toContain('service_role_peut_creer_dans_public : false');
    expect(migration).toContain('NE PAS ACCORDER `CREATE` SUR `public` À `service_role`');
  });

  it('le rôle DÉDIÉ est instruit, pas seulement mentionné', () => {
    // Sans cela, « un rôle dédié serait plus étroit » reste une bonne idée
    // qu'on retrouvera dans six mois, et qu'on réessaiera.
    expect(migration).toContain('ET UN RÔLE DÉDIÉ');
    expect(migration).toContain('BYPASSRLS');
    expect(migration).toContain('SUPERUTILISATEUR');
    // Les trois chemins interdits sont nommés : c'est ce qui empêche de
    // « débloquer » la situation en la rendant moins sûre.
    expect(migration).toContain('create role … superuser');
    expect(migration).toContain('désactiver RLS sur `circulations`');
    expect(migration).toContain('ajouter une politique « en attendant »');
  });

  it('la mesure qui tranche EXISTE, et elle est en lecture seule', () => {
    const mesure = source('supabase/mesure-droits-proprietaire.sql');
    expect(mesure).toContain('rolsuper');
    expect(mesure).toContain('LECTURE SEULE');
    // Un script de mesure qui écrirait ne serait pas une mesure.
    expect(mesure, 'le script de mesure écrit').not.toMatch(
      /^\s*(create|alter|drop|insert|update|delete)\s/im,
    );
    // Et la migration y renvoie, sinon personne ne saura qu'il existe.
    expect(migration).toContain('supabase/mesure-droits-proprietaire.sql');
  });

  it('docs/02 porte la contrainte, pas seulement la migration', () => {
    // La migration se lit quand on la joue ; docs/02 se lit quand on reprend
    // le projet — c'est le second lecteur qu'il faut atteindre.
    const doc = source('docs/02-spec-technique.md');
    expect(doc).toContain('mesure-droits-proprietaire.sql');
    expect(doc).toContain('BYPASSRLS');
    // Espaces normalisés : Prettier peut redécouper les lignes du Markdown
    // sans que la phrase change, et un test qui tomberait là-dessus mesurerait
    // la mise en forme au lieu du contenu.
    expect(doc.replace(/\s+/g, ' ')).toContain('contrainte de plateforme');
  });
});
