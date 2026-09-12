// ACCÈS D'UNE COURSE — public / privé / mixte (docs/01 §2.12).
//
// CE QUE CES TESTS PROTÈGENT. « Privé » n'était pas une donnée mais une
// DÉDUCTION : `nature === 'special'`. Un spécial était donc forcément privé,
// et un privé forcément spécial — deux affirmations que l'exploitation
// dément :
//
//  1. un spécial PARTIELLEMENT ouvert (une partie de la rame réservée, le
//     reste en vente) était annoncé « Privé » en gare et retiré du guichet.
//     Des places invendues, et un voyageur à qui l'écran dit de ne pas
//     monter ;
//  2. la privatisation d'un TRAIN DE GRILLE était IMPOSSIBLE — la contrainte
//     `circulations_nature_numero` borne `special` aux numéros ≥ 201, et
//     cette plage porte le sens depuis le 11/09/2026. Le TRAIN 11 affrété de
//     ce mercredi ne pouvait se dire nulle part.
//
// Les deux se voient le JOUR DE LA COURSE, sur le quai. D'où une colonne, et
// des tests qui vérifient qu'elle traverse le moteur SANS SE PERDRE : c'est
// exactement là que `nature` et `libelle` s'étaient perdus, deux lots de
// suite, entre la Circulation et le PassageGare.
//
// Non prouvé ici : le refus réel de PostgreSQL, qui est le cœur du lot et se
// joue dans `supabase/tests/roles-rls.sql`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { construitCourse } from '../core/train-sup';
import { passagesPourGare, trainsDuJour } from '../core/horaires';
import { aLeDroit } from '../core/roles';
import { accesValide, courseFermee, ACCES_COURSE } from '../core/types';
import { champsFormulaireCourse } from './supervision-logique';
import type { AccesCourse, Circulation, GareId, Grille, Jour, Role } from '../core/types';

/** Fins de ligne normalisées : poste en CRLF, coureur d'intégration en LF. */
function source(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${chemin}`, import.meta.url)), 'utf-8').replace(
    /\r\n/g,
    '\n',
  );
}

const GRAND = grandServiceJson as unknown as Grille;
const MONTEE: GareId[] = ['le-fayet', 'saint-gervais', 'motivon', 'col-de-voza', 'nid-daigle'];

/**
 * Journée de référence : les 26 trains de grille, plus un spécial 201 dont
 * l'accès est réglable. C'est bien la grille RÉELLE — le TRAIN 11 existe et
 * passe à Saint-Gervais, ce qui est tout l'objet du cas nº 2.
 */
function jour(options: { special?: AccesCourse; train11?: AccesCourse } = {}): Jour {
  const base: Jour = {
    date: '2026-07-15',
    grille_version: GRAND.version,
    terminus_bellevue: false,
    gare_debut: 'le-fayet',
    gare_fin: 'nid-daigle',
    message_troncon_fr: null,
    message_troncon_en: null,
    enregistre: true,
    circulations: [],
  };
  const circulations: Circulation[] = [];
  if (options.special !== undefined) {
    circulations.push({
      date: base.date,
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
      acces: options.special,
      passages: construitCourse(GRAND, { heureDepart_s: 9 * 3600, garesMontee: MONTEE }).montee,
    });
  }
  if (options.train11 !== undefined) {
    // Une circulation de GRILLE : ni `passages`, ni `nature` hors grille.
    circulations.push({
      date: base.date,
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
      acces: options.train11,
    });
  }
  return { ...base, circulations };
}

const trainDe = (j: Jour, numero: number): ReturnType<typeof trainsDuJour>[number] | undefined =>
  trainsDuJour(GRAND, j).find((t) => t.numero === numero);

// ===========================================================================
// §7.1 — l'onglet Places suit l'ACCÈS, plus la NATURE
// ===========================================================================
describe('le guichet voit ce qui se vend, et rien d’autre', () => {
  // `lignesAffluence()` n'est pas exportable (elle lit l'état du module) : on
  // éprouve ici le PRÉDICAT qu'elle applique, et le test de source
  // (train-special.test.ts) vérifie qu'elle l'applique bien. Les deux
  // ensemble tiennent la règle ; l'un des deux seul ne tiendrait rien.
  it('un spécial MIXTE reste au guichet — une partie de sa rame se vend', () => {
    const t = trainDe(jour({ special: 'mixte' }), 201);
    expect(t?.acces, 'l’accès s’est perdu entre la circulation et le train').toBe('mixte');
    expect(courseFermee(t ?? { acces: 'public' })).toBe(false);
  });

  it('un spécial PRIVÉ en sort', () => {
    expect(courseFermee(trainDe(jour({ special: 'prive' }), 201) ?? {})).toBe(true);
  });

  it('un train de GRILLE privatisé en sort AUSSI — c’est le cas impossible d’avant', () => {
    const t = trainDe(jour({ train11: 'prive' }), 11);
    expect(t, 'le TRAIN 11 est absent de la journée').toBeDefined();
    expect(t?.nature, 'ce n’est plus un train de grille').toBe('grille');
    expect(courseFermee(t ?? {})).toBe(true);
  });

  it('…et le même train PUBLIC y reste', () => {
    expect(courseFermee(trainDe(jour({ train11: 'public' }), 11) ?? {})).toBe(false);
  });

  it('sans aucune déclaration, un train de grille est PUBLIC', () => {
    // Le défaut de la colonne. Des milliers de lignes existantes en dépendent.
    expect(courseFermee(trainDe(jour(), 11) ?? {})).toBe(false);
    expect(trainDe(jour(), 11)?.acces).toBe('public');
  });
});

// ===========================================================================
// §7.2 — la pastille « Privé » suit l'ACCÈS, plus la NATURE
// ===========================================================================
describe('l’accès traverse le moteur jusqu’à la ligne d’affichage', () => {
  // C'est ICI que `nature` (11/09) et `libelle` (12/09) se sont perdus, deux
  // lots de suite : tous les tests regardaient la Circulation, aucun le
  // PassageGare qui alimente réellement l'écran.
  it('un spécial MIXTE ne porte PAS la pastille', () => {
    const p = passagesPourGare(GRAND, jour({ special: 'mixte' }), 'saint-gervais').find(
      (x) => x.numero === 201,
    );
    expect(p, 'le spécial ne passe pas à Saint-Gervais').toBeDefined();
    expect(p?.acces, 'l’accès se perd entre le train et le passage').toBe('mixte');
    expect(courseFermee(p ?? {})).toBe(false);
  });

  it('un train de GRILLE privatisé la porte', () => {
    const p = passagesPourGare(GRAND, jour({ train11: 'prive' }), 'saint-gervais').find(
      (x) => x.numero === 11,
    );
    expect(p, 'le TRAIN 11 ne passe pas à Saint-Gervais').toBeDefined();
    expect(p?.acces).toBe('prive');
    expect(courseFermee(p ?? {})).toBe(true);
  });

  it('l’écran lit `courseFermee`, et non la nature', () => {
    const ecran = source('src/pages/ecran.ts');
    // Les DEUX endroits : la pastille de la ligne de destination, et la
    // mention de la note. Le lot du 11/09 n'en tenait qu'un des deux.
    expect(ecran).toContain('const prive = courseFermee(p)');
    expect(ecran).toContain('supprime || !courseFermee(p)');
    expect(ecran, 'la déduction par la nature est revenue').not.toMatch(
      /p\.nature [!=]== 'special'/,
    );
  });

  it('`mixte` garde sa pastille de remplissage : le voyageur peut monter', () => {
    // Décision de l'exploitant : rien de particulier à l'écran pour `mixte`.
    // La collision mesurée le 11/09 (privé + « DERNIÈRES PLACES » + picto =
    // 140 px de débordement à 1920×1080) reste impossible, puisque les deux
    // pastilles sont commandées par le MÊME critère, en sens inverse.
    const ecran = source('src/pages/ecran.ts');
    const bloc = /const affluenceHtml =[\s\S]*?;\n/.exec(ecran)?.[0] ?? '';
    expect(bloc, 'affluenceHtml introuvable').not.toBe('');
    expect(bloc).toContain('courseFermee(p)');
    expect(bloc, 'la pastille de remplissage exclut encore les spéciaux').not.toContain('nature');
  });
});

// ===========================================================================
// §7.3 — le choix d'accès est OBLIGATOIRE à la création d'un spécial
// ===========================================================================
describe('aucun spécial ne part avec un accès que personne n’a décidé', () => {
  const ts = source('src/pages/supervision.ts');

  it('le sélecteur s’ouvre sur une option VIDE', () => {
    // Un défaut à « public » ferait partir au guichet un train affrété ; un
    // défaut à « privé » retirerait de la vente des places qui se vendent.
    // Aucune des deux erreurs ne se voit avant le jour même.
    const html = source('supervision.html');
    const bloc = /<select id="sup-acces">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? '';
    expect(bloc, 'le sélecteur d’accès est absent du formulaire').not.toBe('');
    expect(bloc, 'la première option n’est pas vide').toMatch(/^\s*<option value="">/);
    for (const valeur of ACCES_COURSE) {
      expect(bloc, `l’option « ${valeur} » manque`).toContain(`value="${valeur}"`);
    }
  });

  it('la validation REFUSE, et le message dit quoi faire', () => {
    expect(ts).toContain("if (nature === 'special' && acces === null)");
    const message = /toast\('Choisissez l’accès[^']*'\)/.exec(ts)?.[0] ?? '';
    expect(message, 'le refus est muet').not.toBe('');
    // Il nomme les trois possibilités : « choisissez » sans dire quoi laisse
    // l'agent chercher le champ.
    for (const mot of ['public', 'privé', 'mixte']) {
      expect(message.toLocaleLowerCase('fr'), `le message ne nomme pas « ${mot} »`).toContain(mot);
    }
  });

  it('`accesChoisi()` rend `null` sur une valeur inconnue, jamais un repli', () => {
    // Le `null` EST la valeur utile : retomber sur « public » rendrait le
    // choix obligatoire impossible à tenir, le formulaire validerait en
    // silence. C'est une mutation qui ne fait rougir que ce test.
    const corps = /const accesChoisi = \(\)[\s\S]*?\n  \};/.exec(ts)?.[0] ?? '';
    expect(corps, 'accesChoisi introuvable').not.toBe('');
    expect(corps).toContain('?? null');
    expect(corps, 'un repli a été introduit').not.toMatch(/\?\?\s*'public'/);
  });

  it('un RENFORT ne se voit pas proposer le choix : il est créé pour vendre', () => {
    expect(champsFormulaireCourse('special', 'rotation').acces).toBe(true);
    expect(champsFormulaireCourse('supplementaire', 'rotation').acces).toBe(false);
    // …et il naît public, sans que l'agent ait à le dire.
    expect(ts).toContain("acces: nature === 'special' ? (acces ?? 'public') : 'public',");
  });
});

// ===========================================================================
// §7.4 — LES DROITS. Le test le plus important du lot.
// ===========================================================================
describe('qui peut privatiser une course, et ce qu’il ne gagne pas d’autre', () => {
  it('admin et supervision l’ont ; la caisse et le technique, non', () => {
    expect(aLeDroit(['admin'], 'circulations.acces')).toBe(true);
    expect(aLeDroit(['supervision'], 'circulations.acces')).toBe(true);
    for (const role of ['caisse', 'technique'] as const) {
      expect(aLeDroit([role], 'circulations.acces'), role).toBe(false);
    }
  });

  it('admin ne gagne toujours PAS `circulations` — c’est tout le sujet', () => {
    // Le droit de privatiser aurait pu s'obtenir en donnant `circulations` à
    // l'admin : trois caractères de moins à écrire, et la séparation
    // « admin gère les comptes et l'exploitation, l'exploitation gère les
    // circulations » (docs/01 §5.5) disparue.
    expect(aLeDroit(['admin'], 'circulations')).toBe(false);
  });

  it('…et il ne peut rien écrire d’autre : AUCUNE politique RLS ne lui est ouverte', () => {
    // LE point du lot, côté base. Une politique RLS filtre des LIGNES et
    // jamais des COLONNES : « admin peut modifier une circulation de grille »
    // lui ouvrirait `statut`, `retard_min`, `terminus` et `passages`,
    // c'est-à-dire les horaires des six gares.
    const schema = source('supabase/schema.sql');
    const politiques = [...schema.matchAll(/create policy "([^"]+)" on circulations/g)].map(
      (m) => m[1] ?? '',
    );
    // Les cinq d'avant ce lot, ni une de plus.
    expect(politiques).toEqual([
      'lecture publique',
      'roles: circulations ecriture',
      'roles: circulations regeneration',
      'roles: circulations special',
      'roles: circulations special maj',
      'roles: circulations special retrait',
    ]);
    // Les trois politiques de l'admin restent bornées au spécial.
    for (const nom of [
      'roles: circulations special',
      'roles: circulations special maj',
      'roles: circulations special retrait',
    ]) {
      const bloc =
        new RegExp(`create policy "${nom}" on circulations[\\s\\S]*?;`).exec(schema)?.[0] ?? '';
      expect(bloc, `${nom} : bloc introuvable`).not.toBe('');
      expect(bloc, `${nom} : n’est plus bornée à nature = 'special'`).toContain(
        "nature = 'special'",
      );
    }
  });

  it('la fonction vérifie le rôle DANS son corps, et n’écrit que deux colonnes', () => {
    // Elle est SECURITY DEFINER : elle s'exécute avec les droits de son
    // propriétaire, donc RLS ne la protège plus. Sans le contrôle interne,
    // tout agent connecté — la caisse comprise — écrirait par elle.
    for (const fichier of [
      'supabase/schema.sql',
      'supabase/migrations/2026-09-acces-course.sql',
    ] as const) {
      const sql = source(fichier);
      // Les COMMENTAIRES sont retirés : ils parlent de ce que la fonction ne
      // fait pas (« jamais numero + 1 »), et les lire reviendrait à mesurer
      // une intention au lieu d'une instruction.
      const corps = (
        /create or replace function public\.definir_acces[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? ''
      )
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');
      expect(corps, `${fichier} : definir_acces introuvable`).not.toBe('');
      expect(corps, `${fichier} : aucun contrôle de rôle`).toContain(
        "private.a_un_des_roles(array['admin', 'supervision'])",
      );
      expect(corps, `${fichier} : ne refuse rien`).toContain('raise exception');
      // Les colonnes écrites, au mot près. Une troisième ici, c'est la borne
      // qui saute sans que personne ne s'en aperçoive.
      const set = /set acces = p_acces,\s*\n\s*commanditaire = p_commanditaire\s*\n\s*where/.exec(
        corps,
      );
      expect(
        set,
        `${fichier} : l’UPDATE n’écrit pas exactement acces + commanditaire`,
      ).not.toBeNull();
      // UNE seule ligne : jamais la course appariée.
      expect(corps, `${fichier} : propage à la course appariée`).not.toContain('numero + 1');
      expect(corps).toContain('where date = p_date and numero = p_numero');
      // Fermée à la clé publiable.
      expect(sql, `${fichier} : definir_acces exécutable par anon`).toContain(
        'revoke all on function public.definir_acces(date, int, text, text) from anon;',
      );
    }
  });

  it('la recette RLS éprouve les refus, pas seulement les succès', () => {
    const recette = source('supabase/tests/roles-rls.sql');
    for (const attendu of [
      'OK — admin : privatise le TRAIN 11 de grille par definir_acces',
      // Les refus. Ce sont eux qui tombent si la borne saute.
      "ÉCHEC — admin : privatiser lui a ouvert le STATUT d''un train de grille",
      "ÉCHEC — admin : a pu réécrire les PASSAGES d''un train de grille",
      'ÉCHEC — admin : a écrit `acces` en direct, une politique RLS a été ajoutée',
      'ÉCHEC — caisse : a pu privatiser une course',
      'ÉCHEC — technique : a pu privatiser une course',
      'ÉCHEC — definir_acces a propagé à la course appariée',
    ]) {
      expect(recette, `recette : « ${attendu} » absent`).toContain(attendu);
    }
  });

  it('le mock REJOUE le refus, il ne l’invente pas', () => {
    // Un mock qui accepterait tout ferait croire la commande ouverte à tous —
    // c'est le piège qui avait fait passer `getJour` pour une fonction que
    // n'importe quelle session pouvait appeler (10/09/2026).
    const mock = source('src/data/mock.ts');
    const corps = /async setAccesCourse\([\s\S]*?\n  \}/.exec(mock)?.[0] ?? '';
    expect(corps, 'setAccesCourse introuvable dans le mock').not.toBe('');
    expect(corps).toContain("aLeDroit(this.rolesDeLaSession(), 'circulations.acces')");
  });

  it('la caisse n’écrit toujours RIEN dans `circulations`', () => {
    // §3 du lot : c'est la raison d'être de la table `affluence`. Si ce test
    // tombe, le problème est mal posé, pas mal codé.
    const droitsCaisse: Role[] = ['caisse'];
    for (const droit of ['circulations', 'circulations.special', 'circulations.acces'] as const) {
      expect(aLeDroit(droitsCaisse, droit), droit).toBe(false);
    }
  });
});

// ===========================================================================
// §7.5 — la déclaration d'affluence SURVIT à la privatisation
// ===========================================================================
describe('privatiser masque le remplissage, ne l’efface pas', () => {
  it('la commande n’écrit que `acces` et `commanditaire` : `affluence` n’est pas touchée', () => {
    // La déclaration vit dans une AUTRE TABLE, et la seule porte d'écriture
    // du lot n'y touche pas — c'est la garantie structurelle, et elle vaut
    // mieux qu'un test qui vérifierait qu'on ne l'a pas fait exprès.
    const schema = source('supabase/schema.sql');
    const corps =
      /create or replace function public\.definir_acces[\s\S]*?\$fn\$;/.exec(schema)?.[0] ?? '';
    expect(corps, 'definir_acces introuvable').not.toBe('');
    expect(corps, 'la fonction touche à l’affluence').not.toContain('affluence');
    expect(corps).toContain('update public.circulations');
  });

  it('le front non plus : `changeAcces` ne supprime aucune déclaration', () => {
    const ts = source('src/pages/supervision.ts');
    const corps = /async function changeAcces\([\s\S]*?\n}\n/.exec(ts)?.[0] ?? '';
    expect(corps, 'changeAcces introuvable').not.toBe('');
    expect(corps, 'changeAcces efface une déclaration d’affluence').not.toContain('setAffluence');
  });

  it('rendue publique, la course revient au guichet avec sa déclaration', () => {
    // Le masquage est un FILTRE de liste, rien de plus : `lignesAffluence()`
    // écarte la course fermée, et la déclaration l'attend en base.
    const prive = trainDe(jour({ train11: 'prive' }), 11);
    const publique = trainDe(jour({ train11: 'public' }), 11);
    expect(courseFermee(prive ?? {})).toBe(true);
    expect(courseFermee(publique ?? {})).toBe(false);
    // …et rien dans le moteur ne dépend de l'affluence pour calculer l'accès,
    // ni l'inverse : les deux axes ne se parlent pas.
    expect(source('src/core/horaires.ts'), 'le moteur mêle accès et affluence').not.toMatch(
      /acces[\s\S]{0,80}affluence/,
    );
  });

  it('l’ÉCART avec la réinitialisation d’une journée est ÉCRIT, pas subi', () => {
    // Le schéma dit l'inverse pour la réinitialisation (« reconduire un
    // complet affirmerait un fait que personne n'a constaté depuis »). La
    // différence est le temps écoulé, et elle mérite d'être lisible à côté du
    // code plutôt que d'être prise un jour pour un oubli.
    const corps =
      /function lignesAffluence\([\s\S]*?\n}/.exec(source('src/pages/supervision.ts'))?.[0] ?? '';
    expect(corps).toContain('ÉCART ASSUMÉ');
    expect(corps).toContain('réinitialisation');
  });
});

// ===========================================================================
// §7.6 — montée et descente, séparément
// ===========================================================================
describe('privatiser la montée ne touche pas la descente appariée', () => {
  it('le front n’écrit qu’UN numéro', () => {
    const ts = source('src/pages/supervision.ts');
    const corps = /async function changeAcces\([\s\S]*?\n}\n/.exec(ts)?.[0] ?? '';
    expect(corps, 'changeAcces introuvable').not.toBe('');
    expect(corps).toContain('provider.setAccesCourse(date, numero, acces');
    // La rame, elle, se propage (numero + 1). L'accès, non : c'est la
    // différence qui justifie deux lignes par rotation.
    expect(corps, 'l’accès se propage à la course appariée').not.toContain('numero + 1');
  });

  it('le mock non plus', () => {
    const corps =
      /async setAccesCourse\([\s\S]*?\n  \}/.exec(source('src/data/mock.ts'))?.[0] ?? '';
    expect(corps, 'setAccesCourse introuvable').not.toBe('');
    expect(corps, 'le mock propage à la course appariée').not.toContain('numero + 1');
  });

  it('deux lignes de la même rotation portent des accès DIFFÉRENTS sans se gêner', () => {
    const j = jour();
    const avec: Jour = {
      ...j,
      circulations: [
        { ...jour({ train11: 'prive' }).circulations[0]!, numero: 11, sens: 'montee' },
        {
          ...jour({ train11: 'public' }).circulations[0]!,
          numero: 12,
          sens: 'descente',
          acces: 'public',
        },
      ],
    };
    expect(trainDe(avec, 11)?.acces).toBe('prive');
    expect(trainDe(avec, 12)?.acces).toBe('public');
  });
});

// ===========================================================================
// §7.7 — un train de grille privatisé garde « TRAIN 11 »
// ===========================================================================
describe('le libellé libre reste réservé aux courses HORS GRILLE', () => {
  it('privatiser ne renomme rien', () => {
    const t = trainDe(jour({ train11: 'prive' }), 11);
    expect(t?.libelle ?? null, 'un libellé est apparu sur un train de grille').toBeNull();
  });

  it('le bouton « Nommer » ne s’ouvre qu’aux courses hors grille', () => {
    const ts = source('src/pages/supervision.ts');
    // Il vit dans la branche `horsGrille(c)` de la cellule Train, et le lot
    // ne l'en a pas sorti.
    expect(ts).toMatch(/horsGrille\(c\)[\s\S]{0,400}data-action="renommer"/);
  });

  it('la colonne Accès, elle, s’ouvre à TOUTES les lignes', () => {
    // C'est la différence entre les deux : le libellé dit d'où vient le
    // train, l'accès dit à qui il est vendu. Le premier n'a de sens que hors
    // grille, le second sur n'importe quelle course.
    const ts = source('src/pages/supervision.ts');
    const cellule = /const celluleAcces = `[\s\S]*?;\n/.exec(ts)?.[0] ?? '';
    expect(cellule, 'celluleAcces introuvable').not.toBe('');
    expect(cellule, 'la colonne Accès s’est bornée aux courses hors grille').not.toContain(
      'horsGrille',
    );
    expect(cellule, 'la colonne Accès s’est bornée aux spéciaux').not.toContain('nature');
  });
});

// ===========================================================================
// La valeur venue de la base — et l'instantané d'avant le déploiement
// ===========================================================================
describe('accesValide : l’absence vaut `public`', () => {
  it('les trois états passent', () => {
    for (const a of ACCES_COURSE) expect(accesValide(a)).toBe(a);
  });

  it('une valeur inconnue, `null` ou `undefined` retombent sur `public`', () => {
    // Un instantané en cache d'avant le déploiement n'a PAS la colonne. Faire
    // disparaître du guichet tous les trains d'une journée en cache serait
    // pire que de les y laisser : le guichet vendrait à l'aveugle.
    for (const v of [undefined, null, '', 'gratuit', 0, {}]) {
      expect(accesValide(v), String(v)).toBe('public');
    }
  });

  it('`courseFermee` ne ferme QUE sur `prive`', () => {
    expect(courseFermee({ acces: 'prive' })).toBe(true);
    expect(courseFermee({ acces: 'mixte' })).toBe(false);
    expect(courseFermee({ acces: 'public' })).toBe(false);
    expect(courseFermee({})).toBe(false);
    expect(courseFermee({ acces: null })).toBe(false);
  });
});

// ===========================================================================
// Le chemin de la colonne, de bout en bout
// ===========================================================================
describe('`acces` voyage jusqu’au guichet et jusqu’à l’écran', () => {
  it('les DEUX `select` de `getJour` la demandent', () => {
    // Une colonne oubliée à l'une de ces étapes donne soit
    // « permission denied » sur les six écrans, soit une valeur
    // silencieusement absente en supervision.
    const selects = [
      ...source('src/data/supabase.ts').matchAll(/\.select\(\s*\n?\s*'(date, numero, sens[^']*)'/g),
    ].map((m) => (m[1] ?? '').split(',').map((c) => c.trim()));
    expect(selects.length, 'les deux select de getJour sont introuvables').toBe(2);
    for (const colonnes of selects) expect(colonnes).toContain('acces');
    // La liste PRIVÉE est la publique plus `commanditaire`, et rien d'autre.
    const publique = selects.find((c) => !c.includes('commanditaire')) ?? [];
    const privee = selects.find((c) => c.includes('commanditaire')) ?? [];
    expect(privee).toEqual([...publique, 'commanditaire']);
  });

  it('le moteur la reporte sur les trains ET sur les passages', () => {
    const moteur = source('src/core/horaires.ts');
    // Les trois sites : train de grille, course hors grille, passage de gare.
    expect(moteur).toContain('acces: accesValide(circulation?.acces),');
    expect(moteur).toContain('acces: accesValide(circulation.acces),');
    expect(moteur).toContain('acces: train.acces,');
  });

  it('le journal d’exploitation la trace : privatiser est une décision', () => {
    for (const fichier of [
      'supabase/schema.sql',
      'supabase/migrations/2026-09-acces-course.sql',
    ] as const) {
      const bloc =
        /create trigger trg_journal_circulations[\s\S]*?\);/.exec(source(fichier))?.[0] ?? '';
      expect(bloc, `${fichier} : déclencheur introuvable`).not.toBe('');
      expect(bloc, `${fichier} : « acces » n’est pas surveillée`).toContain("'acces'");
    }
  });

  it('la migration REPREND les spéciaux déjà en base', () => {
    // Les laisser `public` changerait leur comportement sans que personne ne
    // l'ait demandé : un train annoncé « privé » en gare hier deviendrait
    // public aujourd'hui, et REPARAÎTRAIT au guichet — on y vendrait des
    // places sur une rame affrétée.
    const sql = source('supabase/migrations/2026-09-acces-course.sql');
    expect(sql).toContain(
      "update circulations set acces = 'prive'\n where nature = 'special' and acces = 'public';",
    );
  });
});
