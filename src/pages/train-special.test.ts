// TRAIN SPÉCIAL — la troisième nature (docs/01 §2.9).
//
// CE QUE CES TESTS PROTÈGENT. Le lot ouvre trois choses à la fois, et chacune
// peut se casser en silence :
//
//  1. UNE NATURE, pas deux booléens. « sup ET spécial » n'existe pas en
//     exploitation ; si le type le rend représentable, la base finira par le
//     contenir et personne ne saura lequel des deux affichages est le bon.
//  2. TROIS FORMES. L'aller simple n'a pas de descente, le stationnement long
//     a une heure de départ SAISIE. Les deux étaient impossibles à exprimer,
//     et le contrôle « le train ne repart pas avant d'être arrivé » n'existait
//     pas — personne ne pouvait le déclencher tant que le champ demandait une
//     durée.
//  3. LES DROITS. L'admin gagne la création d'un spécial, et RIEN d'autre.
//     Le test qui compte est celui qui ÉCHOUE s'il peut écrire une
//     circulation de grille, pas celui qui vérifie qu'il crée un spécial.
//
// Non prouvé ici : le refus réel de PostgreSQL (recette
// supabase/tests/roles-rls.sql) et le rendu (mesuré au navigateur, chiffres
// dans la PR).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { construitCourse, NUMERO_SPECIAL_MIN, prochainNumeroHorsGrille } from '../core/train-sup';
import { libelleTrain, libelleTrainCourt, passagesPourGare, trainsDuJour } from '../core/horaires';
import { aLeDroit, ongletsVisibles } from '../core/roles';
import {
  avertissementTerminusCourse,
  departOrigine,
  ordreRotations,
  champsFormulaireCourse,
  formesPossibles,
} from './supervision-logique';
import type { GareId, Grille, Jour } from '../core/types';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const GRAND = grandServiceJson as unknown as Grille;

const MONTEE: GareId[] = ['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza', 'nid-daigle'];
const DESCENTE: GareId[] = [...MONTEE].reverse();
const h = (hhmm: string): number => {
  const [a = 0, b = 0] = hhmm.split(':').map(Number);
  return a * 3600 + b * 60;
};

/** Une journée qui porte UN train spécial, servie aux deux blocs de rendu. */
const jourAvecSpecial = (): Jour => ({
  date: '2026-07-15',
  grille_version: GRAND.version,
  terminus_bellevue: false,
  gare_debut: 'le-fayet',
  gare_fin: 'nid-daigle',
  message_troncon_fr: null,
  message_troncon_en: null,
  enregistre: true,
  circulations: [
    {
      date: '2026-07-15',
      numero: 201,
      sens: 'montee',
      express: false,
      facultatif: false,
      facultatif_actif: false,
      velos: false,
      rame: 'Marie',
      terminus: 'nid-daigle',
      statut: 'ok',
      retard_min: 0,
      motif: null,
      sans_voyageurs: false,
      nature: 'special',
      commanditaire: 'Comité d’entreprise',
      passages: construitCourse(GRAND, { heureDepart_s: h('09:00'), garesMontee: MONTEE }).montee,
    },
  ],
});

// ============================================================================
// 1. L'enum interdit la combinaison impossible
// ============================================================================
describe('une seule NATURE, jamais deux booléens', () => {
  it('le type n’a plus de champ `supplementaire`', () => {
    const types = source('src/core/types.ts');
    expect(types).toContain("export type NatureCirculation = 'grille' | 'supplementaire'");
    // `supplementaire` ne subsiste que dans des COMMENTAIRES (la colonne SQL
    // de compatibilité). Une déclaration de champ le rendrait à nouveau
    // possible de porter deux vérités à la fois.
    expect(types).not.toMatch(/^\s*supplementaire\??: boolean;/m);
  });

  it('aucun booléen `special` n’a été ajouté à côté', () => {
    // C'est l'erreur que la nature existe pour éviter : deux booléens rendent
    // « sup ET spécial » représentable, et rien ne l'empêcherait en base.
    for (const chemin of ['src/core/types.ts', 'supabase/schema.sql']) {
      expect(source(chemin), chemin).not.toMatch(/\bspecial\s+boolean/);
      expect(source(chemin), chemin).not.toMatch(/^\s*special\??: boolean;/m);
    }
  });

  it('la base tient la contrainte, pas seulement le type', () => {
    const schema = source('supabase/schema.sql');
    expect(schema).toContain("check (nature in ('grille', 'supplementaire', 'special'))");
    // La colonne de compatibilité ne peut plus diverger de la nature.
    expect(schema).toContain("check (supplementaire = (nature <> 'grille'))");
  });
});

// ============================================================================
// 2 et 3. Les trois formes
// ============================================================================
describe('trois formes, un seul chemin de construction', () => {
  it('un renfort n’a qu’une forme ; le spécial en a trois', () => {
    expect(formesPossibles('supplementaire')).toEqual(['rotation']);
    expect(formesPossibles('special')).toEqual(['rotation', 'aller-simple', 'stationnement']);
  });

  it('ALLER SIMPLE : aucune descente appariée', () => {
    const course = construitCourse(GRAND, {
      heureDepart_s: h('09:00'),
      garesMontee: MONTEE,
    });
    expect(course.descente, 'un aller simple a produit une descente').toBeNull();
    expect(course.montee.length).toBe(MONTEE.length);
  });

  it('STATIONNEMENT LONG : l’heure saisie est gardée, pas recalculée', () => {
    const course = construitCourse(GRAND, {
      heureDepart_s: h('09:00'),
      garesMontee: MONTEE,
      garesDescente: DESCENTE,
      departDescente_s: h('16:30'),
      // Un battement traîne dans le formulaire : l'heure saisie doit gagner,
      // sinon le train repartirait cinq minutes après son arrivée.
      battement_s: 300,
    });
    expect(course.descente?.[0]?.d).toBe('16:30:00');
  });

  it('ROTATION : l’heure de la descente vient du battement', () => {
    const court = construitCourse(GRAND, {
      heureDepart_s: h('09:00'),
      garesMontee: MONTEE,
      garesDescente: DESCENTE,
      battement_s: 300,
    });
    const long = construitCourse(GRAND, {
      heureDepart_s: h('09:00'),
      garesMontee: MONTEE,
      garesDescente: DESCENTE,
      battement_s: 1800,
    });
    const depart = (p: { d?: string }[] | null): string => p?.[0]?.d ?? '';
    expect(
      depart(long.descente) > depart(court.descente),
      'un battement plus long ne recule pas le départ',
    ).toBe(true);
  });

  it('le train ne repart JAMAIS avant d’être arrivé', () => {
    // Contrôle NEUF : un battement négatif produisait en silence une descente
    // partant avant l'arrivée. Personne ne pouvait le saisir tant que le champ
    // demandait une durée ; le stationnement long demande une HEURE.
    expect(() =>
      construitCourse(GRAND, {
        heureDepart_s: h('09:00'),
        garesMontee: MONTEE,
        garesDescente: DESCENTE,
        departDescente_s: h('09:30'), // la montée n'est pas encore arrivée
      }),
    ).toThrow(/avant d'être arrivé/);
  });

  it('le formulaire ne montre que les champs qui servent', () => {
    // Un champ visible et ignoré est rempli de bonne foi, puis perdu.
    const renfort = champsFormulaireCourse('supplementaire', 'rotation');
    expect(renfort.forme, 'le renfort propose un choix de forme').toBe(false);
    expect(renfort.commanditaire, 'le renfort demande un commanditaire').toBe(false);
    expect(renfort.battement).toBe(true);

    const allerSimple = champsFormulaireCourse('special', 'aller-simple');
    expect(allerSimple.garesDescente).toBe(false);
    expect(allerSimple.battement, 'un aller simple demande un battement').toBe(false);
    expect(allerSimple.departDescente).toBe(false);

    const stationnement = champsFormulaireCourse('special', 'stationnement');
    expect(stationnement.departDescente).toBe(true);
    expect(stationnement.battement, 'le stationnement demande AUSSI un battement').toBe(false);

    // Réglages gardés / retiré (décision du 10/09/2026).
    expect(champsFormulaireCourse('special', 'rotation').express).toBe(true);
    expect(champsFormulaireCourse('special', 'rotation').velos).toBe(true);
    expect(source('supervision.html'), 'un champ Facultatif est réapparu').not.toContain(
      'id="sup-facultatif"',
    );
  });
});

// ============================================================================
// 3. Numérotation et libellés
// ============================================================================
describe('deux séries, qui ne se mélangent pas', () => {
  it('le spécial part de 201, le renfort de 101', () => {
    expect(prochainNumeroHorsGrille([], 'special')).toBe(NUMERO_SPECIAL_MIN);
    expect(prochainNumeroHorsGrille([], 'supplementaire')).toBe(101);
    // Des renforts déjà créés ne poussent pas le premier spécial.
    expect(prochainNumeroHorsGrille([101, 102, 103, 104], 'special')).toBe(201);
  });

  it('le numéro PAIR est réservé même pour un aller simple', () => {
    // `private.sync_rame_descente()` recopie la rame de toute MONTÉE dans la
    // ligne `numero + 1`, sans vérifier qu'elle appartient au même train :
    // deux allers simples numérotés 201 et 202 verraient le premier écraser
    // la rame du second.
    expect(prochainNumeroHorsGrille([201], 'special')).toBe(203);
    expect(prochainNumeroHorsGrille([202], 'special')).toBe(203);
    expect(source('supabase/schema.sql')).toContain('private.sync_rame_descente()');
  });

  it('la parité reste liée au sens dans toutes les plages', () => {
    // Impair = montée. 201 est impair, la convention tient.
    for (const pris of [[], [201, 202], [201, 202, 203, 204]]) {
      expect(prochainNumeroHorsGrille(pris, 'special') % 2).toBe(1);
      expect(prochainNumeroHorsGrille(pris, 'supplementaire') % 2).toBe(1);
    }
  });

  it('la base tient les plages, pas seulement le front', () => {
    // `NUMERO_SUP_MIN` n'était qu'une convention du front tant que seule la
    // supervision écrivait la table. Elle devient porteuse dès qu'admin peut
    // y insérer des spéciaux : sans contrainte, un spécial numéroté 9
    // s'afficherait « TRAIN 9 » en gare.
    const schema = source('supabase/schema.sql');
    expect(schema).toContain("(nature = 'grille' and numero between 1 and 99)");
    expect(schema).toContain("(nature = 'supplementaire' and numero between 101 and 199)");
    expect(schema).toContain("(nature = 'special' and numero >= 201)");
  });

  it('« SPÉCIAL n » en toutes lettres, « SPÉ n » sur le badge', () => {
    const deux = [
      { numero: 201, nature: 'special' as const },
      { numero: 203, nature: 'special' as const },
    ];
    expect(libelleTrain(deux[0]!, deux)).toBe('SPÉCIAL 1');
    expect(libelleTrain(deux[1]!, deux)).toBe('SPÉCIAL 2');
    expect(libelleTrainCourt(deux[0]!, deux)).toBe('SPÉ 1');
    // Un seul spécial : pas de rang, comme « TRAIN SUP » sans numéro.
    const seul = [{ numero: 201, nature: 'special' as const }];
    expect(libelleTrain(seul[0]!, seul)).toBe('SPÉCIAL');
    expect(libelleTrainCourt(seul[0]!, seul)).toBe('SPÉ');
  });

  it('chaque série compte son propre rang', () => {
    // « SUP 2 » et « SPÉCIAL 2 » sont deux trains différents. Compter les deux
    // ensemble ferait sauter un rang dès que l'autre série gagne une rotation.
    const melange = [
      { numero: 101, nature: 'supplementaire' as const },
      { numero: 103, nature: 'supplementaire' as const },
      { numero: 201, nature: 'special' as const },
      { numero: 203, nature: 'special' as const },
    ];
    expect(libelleTrain(melange[1]!, melange)).toBe('TRAIN SUP 2');
    expect(libelleTrain(melange[3]!, melange)).toBe('SPÉCIAL 2');
  });
});

// ============================================================================
// 4. Terminus : avertir, jamais refuser
// ============================================================================
describe('terminus hors section : on le DIT, on laisse passer', () => {
  const nomGare = (g: GareId): string => g;

  it('hors de la section du jour : avertissement', () => {
    const message = avertissementTerminusCourse({
      terminus: 'nid-daigle',
      gareDebut: 'le-fayet',
      gareFin: 'bellevue',
      terminusBellevue: false,
      nomGare,
    });
    expect(message, 'aucun avertissement sur un terminus hors section').not.toBeNull();
    expect(message).toContain('Ligne fermée');
  });

  it('au-delà de Bellevue un jour de bascule : autre avertissement', () => {
    const message = avertissementTerminusCourse({
      terminus: 'nid-daigle',
      gareDebut: 'le-fayet',
      gareFin: 'nid-daigle',
      terminusBellevue: true,
      nomGare,
    });
    expect(message).toContain('à traiter');
  });

  it('dans la section : rien à dire', () => {
    expect(
      avertissementTerminusCourse({
        terminus: 'col-de-voza',
        gareDebut: 'le-fayet',
        gareFin: 'nid-daigle',
        terminusBellevue: false,
        nomGare,
      }),
    ).toBeNull();
  });

  it('l’avertissement ne BLOQUE pas : le formulaire l’affiche, il ne refuse rien', () => {
    const ts = source('src/pages/supervision.ts');
    const bloc = /const message = avertissementTerminusCourse\(\{[\s\S]*?avert\.hidden = /.exec(
      ts,
    )?.[0];
    expect(bloc, 'avertissement non câblé').toBeDefined();
    expect(bloc).not.toContain('return');
    // …et le terminus proposé au spécial n'est plafonné par rien.
    expect(ts).toContain("if (natureChoisie() === 'special') {");
  });
});

// ============================================================================
// 5. Les droits
// ============================================================================
describe('l’admin crée un spécial, et RIEN d’autre', () => {
  it('il a `circulations.special` et PAS `circulations`', () => {
    // ⚠ C'est cette seconde assertion qui protège la séparation de
    // docs/01 §5.5. La première ne protège rien.
    expect(aLeDroit(['admin'], 'circulations.special')).toBe(true);
    expect(aLeDroit(['admin'], 'circulations'), 'admin a gagné les circulations').toBe(false);
    expect(aLeDroit(['admin'], 'journee.reinitialiser')).toBe(false);
  });

  it('la caisse et le technique n’ont ni l’un ni l’autre', () => {
    for (const role of ['caisse', 'technique'] as const) {
      expect(aLeDroit([role], 'circulations.special'), role).toBe(false);
      expect(aLeDroit([role], 'circulations'), role).toBe(false);
    }
  });

  it('l’onglet Circulations s’ouvre à l’admin — sinon le bouton n’a nulle part où vivre', () => {
    expect(ongletsVisibles(['admin'])).toContain('circulations');
    // Le mapping onglet → droits n'est pas exporté : on le lit à la source,
    // qui est aussi ce qu'une relecture ira vérifier.
    expect(source('src/core/roles.ts')).toContain(
      "circulations: ['circulations', 'circulations.special'],",
    );
  });

  it('…mais tout le reste de l’onglet lui est en LECTURE SEULE', () => {
    const ts = source('src/pages/supervision.ts');
    expect(ts).toContain('function peutModifierCirculations()');
    // La lecture seule englobe le droit, et pas seulement l'état de la journée.
    expect(ts).toMatch(
      /const lectureSeule =\s*\n?\s*\(!horsSaison[\s\S]{0,80}peutModifierCirculations\(\)/,
    );
    // Et la SEULE commande qui échappe à `lectureSeule` est la création.
    expect(ts).toContain("!aLeDroit(roles, 'circulations.special')");
  });

  it('RLS dit la même chose, et par TROIS politiques bornées', () => {
    // Un `for all` appliquerait aussi son `using` au SELECT, ce qui
    // affirmerait quelque chose de faux sur l'objet de la politique.
    const schema = source('supabase/schema.sql');
    for (const bout of [
      `create policy "roles: circulations special" on circulations for insert to authenticated`,
      `create policy "roles: circulations special maj" on circulations for update to authenticated`,
      `create policy "roles: circulations special retrait" on circulations for delete to authenticated`,
    ]) {
      expect(schema, bout).toContain(bout);
    }
    // CHAQUE politique est bornée à `nature = 'special'`. Sans cette borne,
    // l'INSERT ouvrirait à l'admin la création de N'IMPORTE QUELLE
    // circulation — y compris une circulation de grille numérotée 9. C'est la
    // moitié que le seul contrôle d'existence laissait passer.
    for (const nom of [
      'roles: circulations special',
      'roles: circulations special maj',
      'roles: circulations special retrait',
    ]) {
      const politique = new RegExp('create policy "' + nom + '"[^;]*;').exec(schema)?.[0] ?? '';
      expect(politique, nom).not.toBe('');
      expect(politique, nom + ' n’est plus bornée au spécial').toContain("nature = 'special'");
    }

    // L'UPDATE porte les DEUX clauses : `using` tient l'admin à l'écart des
    // circulations de grille, `with check` l'empêche de convertir un spécial
    // en circulation de grille. Omettre la seconde laisse exactement ce trou.
    const maj =
      /create policy "roles: circulations special maj"([\s\S]*?);/.exec(schema)?.[0] ?? '';
    expect(maj).toContain('using (');
    expect(maj).toContain('with check (');
    expect([...maj.matchAll(/nature = 'special'/g)]).toHaveLength(2);
  });

  it('les QUATRE copies du SQL portent les mêmes politiques', () => {
    // Élargir ici sans élargir là-bas donne le pire résultat possible :
    // l'interface affiche le bouton, la base refuse l'écriture.
    for (const chemin of [
      'supabase/schema.sql',
      'supabase/migrations/2026-09-roles-multiples.sql',
      'supabase/migrations/2026-09-train-special-B.sql',
      'supabase/securite-advisors.sql',
    ]) {
      const sql = source(chemin);
      expect(sql, chemin).toContain('"roles: circulations special"');
      expect(sql, chemin).toContain('"roles: circulations special maj"');
      expect(sql, chemin).toContain('"roles: circulations special retrait"');
    }
    // …et la liste de contrôle du script caisse les connaît aussi.
    expect(source('supabase/migrations/2026-09-caisse-medias-ecrans.sql')).toContain(
      "('roles: circulations special')",
    );
  });

  it('la recette éprouve l’UPSERT, et le REFUS sur une circulation de grille', () => {
    const recette = source('supabase/tests/roles-rls.sql');
    // L'application n'envoie jamais un INSERT nu : la branche de conflit doit
    // être jouée, sinon la recette est verte pendant que le bouton échoue.
    expect(recette).toContain('on conflict (date, numero) do update');
    expect(recette).toContain('OK — admin : crée un train spécial (upsert du front)');
    expect(recette).toContain('REMODIFIE son train spécial (branche UPDATE)');
    // ⚠ LE cas qui compte.
    expect(recette).toContain('ÉCHEC — admin : a pu modifier une circulation de GRILLE');
    expect(recette).toContain('ÉCHEC — admin : a pu créer une circulation de grille');
    expect(recette).toContain('ÉCHEC — admin : a converti son spécial en circulation de grille');
  });
});

// ============================================================================
// 6 et 7. Commanditaire, et absence de Places
// ============================================================================
describe('le spécial n’entre pas au guichet', () => {
  it('la liste de l’onglet Places l’écarte', () => {
    const corps = /function lignesAffluence\([\s\S]*?\n}/.exec(
      source('src/pages/supervision.ts'),
    )?.[0];
    expect(corps, 'lignesAffluence introuvable').toBeDefined();
    expect(corps).toContain("if (train.nature === 'special') continue;");
  });

  it('et l’écran ne lui pose aucune pastille de remplissage', () => {
    // Mesuré : privé + « DERNIÈRES PLACES » + picto déborde de 140 px à
    // 1920×1080 et tronquerait le nom de la gare. L'interface ne peut pas
    // produire ce cas ; une ligne écrite à la main en base, si.
    const ecran = source('src/pages/ecran.ts');
    expect(ecran).toMatch(/const affluenceHtml =\s*\n?\s*supprime \|\| p\.nature === 'special'/);
  });

  it('le commanditaire est exigé à la création d’un spécial', () => {
    const ts = source('src/pages/supervision.ts');
    expect(ts).toContain("if (nature === 'special' && commanditaire === '')");
    // …et jamais posé sur un renfort : il ne roule pour personne en
    // particulier.
    expect(ts).toContain("commanditaire: nature === 'special' ? commanditaire : null,");
  });
});

// ============================================================================
// 8. `?jour=` — déjà couvert par jour-simule.test.ts, rappelé ici pour le lien
// ============================================================================
describe('le lot se vérifie avec `?jour=`', () => {
  it('les écrans savent afficher une autre journée', () => {
    // Sans lui, un spécial créé pour demain ne serait vérifiable que demain.
    expect(source('src/pages/ecran.ts')).toContain("url.get('jour')");
  });
});

// ============================================================================
// La NATURE survit jusqu'à l'écran
// ============================================================================
describe('la nature traverse le moteur sans se perdre', () => {
  // Mutation survivante au premier passage : remplacer `nature:
  // circulation.nature` par `'supplementaire'` dans `trainsDuJour()` faisait
  // afficher « TRAIN SUP » et retirait la pastille « privé » — sans qu'aucun
  // test ne tombe, parce que tous les autres regardent la Circulation et non
  // le TrainJour qui en sort.

  it('un spécial reste un spécial dans `trainsDuJour()`', () => {
    const train = trainsDuJour(GRAND, jourAvecSpecial()).find((t) => t.numero === 201);
    expect(train, 'le spécial est absent de la journée').toBeDefined();
    expect(train?.nature, 'la nature a été écrasée en cours de route').toBe('special');
  });

  it('…et jusque dans les passages de gare, qui alimentent l’écran', () => {
    const passages = passagesPourGare(GRAND, jourAvecSpecial(), 'saint-gervais');
    const p = passages.find((x) => x.numero === 201);
    expect(p, 'le spécial ne passe pas à Saint-Gervais').toBeDefined();
    expect(p?.nature, 'la nature se perd entre le train et le passage').toBe('special');
    // C'est cette valeur qui décide de la pastille « privé » et du libellé.
    expect(
      libelleTrainCourt({ numero: 201, nature: p?.nature ?? 'grille' }, [
        { numero: 201, nature: 'special' },
      ]),
    ).toBe('SPÉ');
  });

  it('un renfort, lui, ne devient pas un spécial', () => {
    const jour = jourAvecSpecial();
    const premiere = jour.circulations[0];
    if (!premiere) throw new Error('circulation absente');
    const renfort: Jour = {
      ...jour,
      circulations: [{ ...premiere, numero: 101, nature: 'supplementaire', commanditaire: null }],
    };
    expect(trainsDuJour(GRAND, renfort).find((t) => t.numero === 101)?.nature).toBe(
      'supplementaire',
    );
  });
});

// ============================================================================
// §5 — ce que l'écran montre, et ce qu'aucun test ne tenait
// ============================================================================
describe('la mention « privé » tient à l’écran', () => {
  // Trois mutations ont survécu à la première campagne, toutes ici : le rendu
  // n'était protégé que par l'ordre des pastilles, jamais par leur existence.
  const ecran = source('src/pages/ecran.ts');

  it('la pastille est POSÉE sur un spécial, et sur lui seul', () => {
    expect(ecran).toContain("supprime || p.nature !== 'special'");
    expect(ecran).toContain('<span class="pill-prive">Privé <small>Private</small></span>');
  });

  it('la note ne reprend « privé » que si la ligne est LIBRE', () => {
    // Mesuré à 1280×720 : privé + express remplissent la ligne à 456,5 px pour
    // 456,5 px disponibles. La pastille porte déjà l'information ; la mention
    // express, elle, n'a pas d'autre endroit où aller.
    expect(ecran).toContain("const noteLibre = !p.express && sansArret === '';");
    expect(ecran).toContain("if (prive !== '' && !supprime && noteLibre)");
  });

  it('un SPÉCIAL garde son express ; un RENFORT n’en a jamais', () => {
    // Le moteur forçait `express: false` sur tout train hors grille : la case
    // du formulaire n'avait aucun effet à l'écran (relevé au navigateur).
    const base = jourAvecSpecial();
    const premiere = base.circulations[0];
    if (!premiere) throw new Error('circulation absente');

    const special: Jour = {
      ...base,
      circulations: [{ ...premiere, express: true, velos: true }],
    };
    const t = trainsDuJour(GRAND, special).find((x) => x.numero === 201);
    expect(t?.express, 'le spécial a perdu son express').toBe(true);
    expect(t?.velos, 'le spécial a perdu ses vélos').toBe(true);

    const renfort: Jour = {
      ...base,
      circulations: [
        { ...premiere, numero: 101, nature: 'supplementaire', express: true, velos: true },
      ],
    };
    const r = trainsDuJour(GRAND, renfort).find((x) => x.numero === 101);
    expect(r?.express, 'un renfort est devenu express').toBe(false);
    expect(r?.velos, 'un renfort a gagné les vélos').toBe(false);
  });
});

// ============================================================================
// Ordre d'affichage des rotations (défaut relevé à la recette, 11/09/2026)
// ============================================================================
describe('les rotations se rangent à leur HEURE, pas après la grille', () => {
  // Le tableau était construit en DEUX blocs concaténés : toute la grille,
  // puis les trains hors grille. Un renfort de 17 h se rangeait donc après le
  // dernier train du soir, et un spécial de 10 h 30 aussi. Ce n'est pas le
  // train spécial qui l'a introduit — les renforts étaient affichés ainsi
  // depuis toujours, et le corriger les répare tous les deux.

  /** Une journée fictive : trois rotations de grille, à 10 h, 11 h et 17 h. */
  const GRILLE = [
    { numero: 1, depart_s: h('10:00') },
    { numero: 3, depart_s: h('11:00') },
    { numero: 5, depart_s: h('17:00') },
  ];

  it('un SPÉCIAL de 10:30 se place entre la rotation de 10:00 et celle de 11:00', () => {
    expect(ordreRotations([...GRILLE, { numero: 201, depart_s: h('10:30') }])).toEqual([
      1, 201, 3, 5,
    ]);
  });

  it('un RENFORT de 17:00 se place à 17:00, pas à la fin', () => {
    // À heure égale avec le train 5, le numéro départage : le renfort suit.
    expect(ordreRotations([...GRILLE, { numero: 101, depart_s: h('17:00') }])).toEqual([
      1, 3, 5, 101,
    ]);
    // …et une minute plus tôt, il passe devant.
    expect(ordreRotations([...GRILLE, { numero: 101, depart_s: h('16:59') }])).toEqual([
      1, 3, 101, 5,
    ]);
  });

  it('les trains de GRILLE gardent leur ordre relatif', () => {
    // Il est déjà chronologique, et les numéros croissent avec lui : la clé
    // (heure, numéro) le reproduit exactement, sans dépendre de la stabilité
    // du tri de la plateforme.
    expect(ordreRotations(GRILLE)).toEqual([1, 3, 5]);
    expect(ordreRotations([...GRILLE].reverse())).toEqual([1, 3, 5]);
  });

  it('une heure INDÉTERMINABLE va en fin de liste, sans rien casser', () => {
    // Journée non ouverte, passages absents : un tableau qui ne s'affiche pas
    // est pire qu'un train mal placé.
    expect(ordreRotations([...GRILLE, { numero: 201, depart_s: null }])).toEqual([1, 3, 5, 201]);
    expect(() => ordreRotations([{ numero: 201, depart_s: null }])).not.toThrow();
    // Plusieurs sans heure : elles restent entre elles, par numéro.
    expect(
      ordreRotations([
        { numero: 203, depart_s: null },
        { numero: 1, depart_s: h('10:00') },
        { numero: 201, depart_s: null },
      ]),
    ).toEqual([1, 201, 203]);
  });

  it('`departOrigine` lit le premier passage, et rend `null` quand il n’y a rien', () => {
    expect(departOrigine([{ gare: 'le-fayet', d: '10:30:00' }])).toBe(h('10:30'));
    // Sur une course ENTIÈRE, et pas seulement sur un passage isolé : lire le
    // dernier passage rendrait l'heure d'ARRIVÉE au terminus, et les rotations
    // se rangeraient par leur fin. Un train rapide passerait devant un train
    // parti plus tôt. (Mutation survivante au premier passage : tous les cas
    // ne portaient qu’un seul passage, où le premier EST le dernier.)
    expect(
      departOrigine([
        { gare: 'le-fayet', d: '09:00:00' },
        { gare: 'saint-gervais', a: '09:12:00', d: '09:13:00' },
        { gare: 'nid-daigle', a: '10:03:30' },
      ]),
    ).toBe(h('09:00'));
    // Une descente de renfort peut n'avoir qu'une arrivée au premier passage.
    expect(departOrigine([{ gare: 'nid-daigle', a: '11:05:00' }])).toBe(h('11:05'));
    expect(departOrigine([])).toBeNull();
    expect(departOrigine(null)).toBeNull();
    expect(departOrigine(undefined)).toBeNull();
    expect(departOrigine([{ gare: 'le-fayet' }])).toBeNull();
  });

  it('l’APPARIEMENT survit au tri : la descente suit sa montée', () => {
    // Le rang appartient à la ROTATION. Une descente qui se trierait pour
    // elle-même défairait la lecture même du tableau.
    const ts = source('src/pages/supervision.ts');
    const bloc = /const rotations = new Map<number[\s\S]*?\.join\(''\);/.exec(ts)?.[0] ?? '';
    expect(bloc, 'la liste unique de rotations est introuvable').not.toBe('');
    // Les descentes ne sont jamais rangées : elles sont portées par la montée.
    expect(bloc).toContain(
      'descente: grille.descentes.find((d) => d.numero === montee.numero + 1)',
    );
    expect(bloc).toContain('x.numero === c.numero + 1');
    expect(bloc).toContain('ligneCirculation(rotation.montee, ');
    expect(bloc).toContain('rotation.descente ? ligneCirculation(rotation.descente, ');
    // Et le tri porte bien sur la MONTÉE.
    expect(bloc).toContain('depart_s: departOrigine(montee.passages)');
  });

  it('plus DEUX blocs concaténés : c’est le défaut lui-même', () => {
    const ts = source('src/pages/supervision.ts');
    expect(ts, 'le tri par numéro des hors-grille est revenu').not.toContain(
      "filter((c) => horsGrille(c) && c.sens === 'montee')\n      .sort((a, b) => a.numero - b.numero)",
    );
    expect(ts).toContain('ordreRotations(');
  });

  it('la GRILLE DU JOUR souffrait du même défaut, et trie maintenant par l’heure', () => {
    // La consigne disait « la grille du jour trie par heure, vérifie-le » :
    // elle ne le faisait pas. `trainsDuJour()` rend les trains de grille PUIS
    // les hors grille, et `colonnesDuSens()` reprenait cet ordre tel quel —
    // un spécial de 10 h 30 finissait en dernière colonne.
    const ts = source('src/pages/grille.ts');
    const bloc = /function colonnesDuSens\([\s\S]*?\n}/.exec(ts)?.[0] ?? '';
    expect(bloc, 'colonnesDuSens introuvable').not.toBe('');
    expect(bloc, 'les colonnes ne sont pas triées par l’heure').toContain('.sort((a, b) => {');
    expect(bloc).toContain('a.passages[0]?.depart_s');
  });

  it('l’onglet Places et l’écran de gare, eux, triaient DÉJÀ — on n’y touche pas', () => {
    // Vérifié plutôt que supposé, comme pour la grille du jour.
    expect(source('src/pages/supervision.ts')).toContain(
      'return lignes.sort((a, b) => a.depart_s - b.depart_s);',
    );
    expect(source('src/core/horaires.ts')).toContain(
      'passages.sort((a, b) => (a.depart_s ?? a.arrivee_s ?? 0) - (b.depart_s ?? b.arrivee_s ?? 0));',
    );
  });
});
