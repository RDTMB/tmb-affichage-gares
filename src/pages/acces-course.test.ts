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
import { champsFormulaireCourse, commanditairePourAcces } from './supervision-logique';
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

  it('le champ est RÉELLEMENT montré — sans lui, le refus devient un blocage', () => {
    // Survivante de la campagne du 12/09 : remplacer `champs.acces` par
    // `false` dans l'appel à `montre()` ne faisait rougir personne. Le champ
    // disparaissait, l'agent ne pouvait plus choisir, et la validation
    // refusait indéfiniment un train qu'aucun geste ne permettait de créer.
    // Un choix obligatoire dont le champ est caché n'est pas une exigence,
    // c'est une impasse.
    expect(ts).toContain("montre('sup-champ-acces', champs.acces);");
    // La famille entière : chaque champ du formulaire suit `champs.*` et non
    // une constante. C'est la même mutation, sur n'importe lequel d'entre eux.
    const appels = [...ts.matchAll(/montre\('sup-champ-([\w-]+)', ([^)]+)\)/g)];
    expect(appels.length, 'les appels à montre() sont introuvables').toBeGreaterThan(4);
    for (const [, champ, valeur] of appels) {
      // `sup-champ-libelle` est le seul à `true` assumé : le libellé vaut
      // pour les deux natures (décision du 12/09/2026).
      if (champ === 'libelle') continue;
      expect(valeur, `sup-champ-${champ} : figé à « ${valeur} »`).toMatch(/^champs\./);
    }
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

  it('le refus est calculé UNE fois, et sert au rendu COMME à l’écriture', () => {
    // Deux survivantes de la campagne du 12/09, et c'est la même : retirer la
    // garde de `changeAcces`, ou celle du sélecteur, ne faisait rougir
    // personne. La base refuse dans les deux cas — mais `disabled` se retire
    // dans l'inspecteur, et la caisse recevrait alors un « permission denied »
    // brut de PostgREST là où une phrase dit quoi faire. C'est exactement la
    // règle déjà posée pour l'affluence (`saisieAffluence`, docs/01 §2.8) :
    // un seul calcul, deux usages.
    const ts = source('src/pages/supervision.ts');
    const ecriture = /async function changeAcces\([\s\S]*?\n}\n/.exec(ts)?.[0] ?? '';
    expect(ecriture, 'changeAcces introuvable').not.toBe('');
    expect(ecriture, 'l’écriture ne vérifie plus le droit').toContain('if (!peutChangerAcces())');
    expect(ts, 'le sélecteur ne verrouille plus sur le droit').toContain(
      "const verrouAcces = lectureSeule || !peutChangerAcces() ? ' disabled' : '';",
    );
    // …et le prédicat lit bien le droit du lot, pas un autre.
    const predicat = /function peutChangerAcces\(\)[\s\S]*?\n}/.exec(ts)?.[0] ?? '';
    expect(predicat, 'peutChangerAcces introuvable').not.toBe('');
    expect(predicat).toContain("aLeDroit(roles, 'circulations.acces')");
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
// Le COMMANDITAIRE ne s'efface pas par omission (relevé à la relecture)
// ===========================================================================
describe('privatiser une course ne perd jamais son commanditaire', () => {
  const ts = source('src/pages/supervision.ts');

  it('la colonne LUE est transmise telle quelle', () => {
    const d = commanditairePourAcces({ commanditaire: 'Comité d’entreprise' });
    expect(d.ok, d.ok ? '' : d.refus).toBe(true);
    expect(d.ok && d.valeur).toBe('Comité d’entreprise');
  });

  it('une course SANS commanditaire s’écrit bien `null` — l’effacement reste possible', () => {
    // On ne remplace pas une perte silencieuse par une valeur qu'on ne peut
    // plus corriger : un train qui cesse d'être affrété doit pouvoir perdre
    // son commanditaire. Un `coalesce(p_commanditaire, commanditaire)` côté
    // base l'aurait rendu ineffaçable, et une trace FAUSSE est pire qu'une
    // trace absente.
    const d = commanditairePourAcces({ commanditaire: null });
    expect(d.ok).toBe(true);
    expect(d.ok && d.valeur).toBeNull();
  });

  it('une colonne NON LUE fait REFUSER l’écriture, jamais écrire `null`', () => {
    // LE défaut. `c.commanditaire ?? null` était une OMISSION DÉGUISÉE EN
    // VALEUR : quand la journée n'a pas été lue avec `avecCommanditaire`, la
    // clé est absente (`undefined`) et le `??` la transformait en effacement.
    // Personne ne l'aurait vu — ni l'agent, qui voit l'accès changer, ni
    // l'écran, qui n'affiche jamais cette colonne. Le jour où l'on chercherait
    // qui a affrété la course, la réponse aurait disparu.
    //
    // Ce que le front calculait, reproduit ici pour que la comparaison soit
    // lisible plutôt que affirmée :
    const calculDAvant = (c: { commanditaire?: string | null }): string | null =>
      c.commanditaire ?? null;
    expect(calculDAvant({}), 'la perte silencieuse n’était pas celle-là').toBeNull();

    const d = commanditairePourAcces({});
    expect(d.ok, 'une colonne non lue passe encore pour un effacement voulu').toBe(false);
    expect(!d.ok && d.refus).toMatch(/commanditaire/i);
  });

  it('le front passe par cette décision, et n’écrit plus `?? null`', () => {
    const corps = /async function changeAcces\([\s\S]*?\n}\n/.exec(ts)?.[0] ?? '';
    expect(corps, 'changeAcces introuvable').not.toBe('');
    expect(corps).toContain('commanditairePourAcces(c)');
    expect(corps, 'l’omission déguisée en valeur est revenue').not.toContain(
      'c.commanditaire ?? null',
    );
  });

  it('la fonction SQL n’a plus de valeur par DÉFAUT sur `p_commanditaire`', () => {
    // Sans `default`, un appel à trois arguments n'existe plus : PostgreSQL
    // refuse « function does not exist », bruyamment et au premier essai. Avec
    // lui, le même appel réussissait et effaçait la colonne.
    for (const fichier of [
      'supabase/schema.sql',
      'supabase/migrations/2026-09-acces-course.sql',
    ] as const) {
      // Commentaires retirés : ils PARLENT du défaut supprimé (« avec
      // `default null`, … »). Les lire reviendrait à mesurer une explication
      // au lieu d'une signature.
      const entete = (
        /create or replace function public\.definir_acces\(([\s\S]*?)\)\s*\nreturns/.exec(
          source(fichier),
        )?.[1] ?? ''
      )
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');
      expect(entete, `${fichier} : en-tête de definir_acces introuvable`).not.toBe('');
      expect(entete, `${fichier} : p_commanditaire a repris une valeur par défaut`).not.toMatch(
        /default/i,
      );
      // …et les quatre paramètres sont toujours là, dans l'ordre.
      expect(entete.replace(/\s+/g, ' ').trim()).toBe(
        'p_date date, p_numero int, p_acces text, p_commanditaire text',
      );
    }
  });

  it('la recette éprouve les TROIS moitiés sur une vraie base', () => {
    // Survivantes de la campagne de relecture : `toContain('pronargdefaults')`
    // et un préfixe d'ÉCHEC partagé ne verrouillaient rien — on pouvait
    // neutraliser la condition ou retirer un `else raise` sans faire tomber
    // le test. Les chaînes sont donc EXACTES et DISCRIMINANTES.
    const recette = source('supabase/tests/roles-rls.sql');
    for (const attendu of [
      // (a) la valeur transmise survit ;
      "raise exception 'ÉCHEC — definir_acces a effacé le commanditaire qu''on lui a passé'",
      // (b) changer l'accès ne la perd pas ;
      "raise exception 'ÉCHEC — definir_acces a effacé le commanditaire en changeant l''accès'",
      // (c) l'effacement VOULU reste possible ;
      "raise exception 'ÉCHEC — le commanditaire est devenu ineffaçable'",
    ]) {
      expect(recette, `recette : « ${attendu.slice(0, 50)}… » absent`).toContain(attendu);
    }
    // (d) et la condition qui refuse le paramètre par défaut, telle quelle :
    // l'envelopper dans un `and` toujours faux la neutralisait en silence.
    expect(recette).toContain(
      "  if (select pronargdefaults from pg_proc\n       where oid = 'public.definir_acces(date, int, text, text)'::regprocedure) = 0",
    );
  });

  it('les DEUX copies portent le même jeu d’instructions pour `definir_acces`', () => {
    // Survivante : le `grant execute … to service_role` pouvait disparaître de
    // `schema.sql` sans rien faire tomber — la vérification ne lisait que la
    // migration. Sans lui, une installation NEUVE poserait une fonction dont
    // le propriétaire ne peut pas appeler `a_un_des_roles` : elle échouerait
    // au premier clic, et sur la base qui n'a pas d'historique pour aider à
    // comprendre.
    const lignes = (f: string): string[] =>
      source(f)
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            /definir_acces/.test(l) ||
            /to service_role;$/.test(l) ||
            /on circulations to service_role/.test(l),
        )
        .filter((l) => !l.startsWith('--'));
    const schema = lignes('supabase/schema.sql');
    const migration = lignes('supabase/migrations/2026-09-acces-course.sql');
    for (const instruction of [
      'revoke all on function public.definir_acces(date, int, text, text) from public;',
      'revoke all on function public.definir_acces(date, int, text, text) from anon;',
      'grant execute on function public.definir_acces(date, int, text, text) to authenticated;',
      'grant select, update on circulations to service_role;',
      'grant execute on function private.a_un_des_roles(text[]) to service_role;',
      'alter function public.definir_acces(date, int, text, text) owner to service_role;',
    ]) {
      expect(schema, `schema.sql : « ${instruction} » absent`).toContain(instruction);
      expect(migration, `migration : « ${instruction} » absent`).toContain(instruction);
    }
  });

  it('la MIGRATION porte les mêmes garanties que `schema.sql`', () => {
    // LE trou systématique relevé par la campagne : `securite.test.ts` ne lit
    // que `schema.sql`, `securite-advisors.sql` et la migration des rôles. La
    // migration de l'accès — celle que Thomas exécute réellement, et la SEULE
    // qui touche une base existante — n'était couverte par aucune des quatre
    // garanties. Trois mutations y ont survécu pour cette seule raison.
    const migration = source('supabase/migrations/2026-09-acces-course.sql');
    for (const [quoi, attendu] of [
      [
        'propriétaire nommé',
        'alter function public.definir_acces(date, int, text, text) owner to service_role;',
      ],
      [
        'exécution de la fonction d’habilitation pour ce propriétaire',
        'grant execute on function private.a_un_des_roles(text[]) to service_role;',
      ],
      ['droits de table du propriétaire', 'grant select, update on circulations to service_role;'],
      [
        'révocation à anon',
        'revoke all on function public.definir_acces(date, int, text, text) from anon;',
      ],
      [
        'révocation à public',
        'revoke all on function public.definir_acces(date, int, text, text) from public;',
      ],
      ['search_path verrouillé', "security definer set search_path = ''"],
      ['contrôle du rôle applicatif', "private.a_un_des_roles(array['admin', 'supervision'])"],
    ] as const) {
      expect(migration, `migration : ${quoi} absent`).toContain(attendu);
    }
    // Et son bloc VÉRIFICATION contrôle ce que le script vient de poser : le
    // propriétaire, l'hypothèse qui le justifie, et l'absence de défaut.
    for (const controle of [
      "select 'definir_acces appartient à service_role',",
      'rolbypassrls',
      'pronargdefaults',
    ]) {
      expect(migration, `migration : contrôle « ${controle} » absent`).toContain(controle);
    }
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

  it('la contrainte des TROIS ÉTATS est la même dans les deux copies', () => {
    // Survivante de la campagne du 12/09 : remplacer le `check (acces in …)`
    // de `schema.sql` par un `check (acces is not null)` ne faisait rougir
    // personne. La base d'une installation neuve aurait alors accepté
    // « gratuit », et le front serait retombé sur `public` sans rien dire —
    // une course affrétée vendue au guichet.
    //
    // Les deux copies doivent rester identiques, comme pour les contraintes
    // de forme de `params` (src/data/securite.test.ts).
    const etats = /check \(acces in \(([^)]*)\)\)/;
    const lues = ['supabase/schema.sql', 'supabase/migrations/2026-09-acces-course.sql'].map(
      (f) => etats.exec(source(f))?.[1]?.replace(/\s+/g, ' ').trim() ?? '',
    );
    for (const [i, v] of lues.entries()) {
      expect(v, `copie ${i} : contrainte des trois états absente`).not.toBe('');
    }
    expect(lues[0], 'les deux copies divergent').toBe(lues[1]);
    // …et ce sont bien les trois états du type, ni un de plus ni un de moins.
    const declares = (lues[0] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''));
    expect([...declares].sort()).toEqual([...ACCES_COURSE].sort());
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

// ===========================================================================
// La NUMÉROTATION des sections de docs/01 (relecture du 12/09/2026)
// ===========================================================================
describe('les renvois de la spécification pointent vers une section qui existe', () => {
  // Deux lots menés en parallèle ont réclamé le même §2.11, et RIEN ne l'aurait
  // dit : un numéro en double ne casse aucun rendu Markdown, et un renvoi vers
  // une section qui a changé de numéro envoie simplement le lecteur au mauvais
  // endroit. Le conflit a été résolu à la main à la fusion — ce test est ce
  // qui le rendra visible la prochaine fois, au lieu d'être remarqué par
  // quelqu'un qui suit un renvoi et ne trouve pas ce qu'il cherche.
  const spec = source('docs/01-spec-fonctionnelle.md');
  const titres = [...spec.matchAll(/^### (\d+\.\d+) (.+)$/gm)].map((m) => ({
    numero: m[1] ?? '',
    titre: m[2] ?? '',
  }));

  it('aucun numéro n’est utilisé deux fois', () => {
    const numeros = titres.map((t) => t.numero);
    expect(numeros.length, 'aucun sous-titre numéroté trouvé').toBeGreaterThan(5);
    expect([...new Set(numeros)], 'un numéro de section est en double').toEqual(numeros);
  });

  it('les sections du chapitre 2 se suivent sans trou', () => {
    const chapitre2 = titres
      .filter((t) => t.numero.startsWith('2.'))
      .map((t) => Number(t.numero.slice(2)));
    expect(chapitre2).toEqual(chapitre2.map((_, i) => i + 1));
  });

  it('chaque section est là où le CODE dit qu’elle est', () => {
    // Les renvois du code sont la raison d'être de la numérotation : un
    // commentaire qui dit « docs/01 §2.12 » doit tomber sur l'accès, pas sur
    // le bandeau.
    for (const [numero, debutDuTitre] of [
      ['2.9', 'Train spécial'],
      ['2.10', 'Libellé libre'],
      ['2.11', 'Cycle du bandeau'],
      ['2.12', 'Accès d’une course'],
    ] as const) {
      const trouve = titres.find((t) => t.numero === numero);
      expect(trouve, `§${numero} introuvable`).toBeDefined();
      expect(trouve?.titre.replace(/'/g, '’'), `§${numero} a changé de sujet`).toContain(
        debutDuTitre,
      );
    }
  });

  it('aucun renvoi §2.x du dépôt ne vise une section absente', () => {
    const numeros = new Set(titres.map((t) => t.numero));
    const fichiers = [
      'docs/01-spec-fonctionnelle.md',
      'docs/02-spec-technique.md',
      'CLAUDE.md',
      'src/core/types.ts',
      'src/core/roles.ts',
      'src/core/horaires.ts',
      'src/data/provider.ts',
      'src/pages/ecran.ts',
      'src/pages/supervision.ts',
      'src/pages/affichage-commun.ts',
      'supabase/schema.sql',
      'supabase/migrations/2026-09-acces-course.sql',
      'supabase/tests/roles-rls.sql',
    ];
    for (const f of fichiers) {
      for (const m of source(f).matchAll(/§(2\.\d+)/g)) {
        expect(numeros, `${f} : renvoi vers §${m[1]}, qui n’existe pas`).toContain(m[1]);
      }
    }
  });
});
