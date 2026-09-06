// Matrice des rôles multiples : union des droits, attribution, garde-fous.
// Ce module est le miroir de confort de la RLS ; les mêmes cas sont rejoués
// EN BASE par supabase/tests/roles-rls.sql.
import { describe, expect, it } from 'vitest';

import {
  ATTRIBUABLE_PAR,
  DROITS,
  ROLES,
  ROLES_PROTEGES,
  aLeDroit,
  droits,
  estDernierDetenteur,
  motifCaseVerrouillee,
  motifCompteVerrouille,
  ongletsVisibles,
  peutAttribuer,
  peutGererProfil,
  rolesAttribuables,
  rolesDemoDepuisEmail,
  rolesDontIlEstLeDernier,
  type Role,
} from './roles';

const compte = (user_id: string, roles: Role[], actif = true) => ({ user_id, roles, actif });

describe('Union des droits (jamais de hiérarchie)', () => {
  it('un rôle seul ne donne que ses propres droits', () => {
    expect(aLeDroit(['technique'], 'circulations')).toBe(false);
    expect(aLeDroit(['technique'], 'bandeau')).toBe(false);
    expect(aLeDroit(['admin'], 'circulations')).toBe(false);
    expect(aLeDroit(['supervision'], 'comptes.gerer')).toBe(false);
    // `medias` a rejoint la caisse le 06/09/2026 ; l'exemple qui tenait ici
    // est remplacé par un droit qu'elle n'a toujours pas.
    expect(aLeDroit(['caisse'], 'circulations')).toBe(false);
  });

  it('le cumul additionne, sans rien retirer', () => {
    const cumul: Role[] = ['technique', 'admin'];
    expect(aLeDroit(cumul, 'parametres.technique')).toBe(true);
    expect(aLeDroit(cumul, 'parametres.exploitation')).toBe(true);
    expect(aLeDroit(cumul, 'grilles')).toBe(true);
    // …mais le cumul technique+admin ne donne toujours PAS l'exploitation.
    expect(aLeDroit(cumul, 'circulations')).toBe(false);
  });

  it('droits() retourne bien l’union des ensembles', () => {
    const seuls = new Set([...droits(['admin']), ...droits(['supervision'])]);
    expect([...droits(['admin', 'supervision'])].sort()).toEqual([...seuls].sort());
  });

  it('aucun rôle = aucun droit', () => {
    expect(droits([]).size).toBe(0);
    for (const droit of DROITS) expect(aLeDroit([], droit)).toBe(false);
  });
});

describe('Périmètre validé par l’exploitant le 05/09/2026', () => {
  it('l’exploitation n’attend jamais l’informatique : grilles, rechargement, réinitialisation sont PARTAGÉS', () => {
    expect(aLeDroit(['supervision'], 'grilles')).toBe(true);
    expect(aLeDroit(['admin'], 'grilles')).toBe(true);
    expect(aLeDroit(['technique'], 'grilles')).toBe(true);

    expect(aLeDroit(['supervision'], 'ecrans.commander')).toBe(true);
    expect(aLeDroit(['technique'], 'ecrans.commander')).toBe(true);

    expect(aLeDroit(['supervision'], 'journee.reinitialiser')).toBe(true);
    expect(aLeDroit(['technique'], 'journee.reinitialiser')).toBe(true);
  });

  it('les réglages d’infrastructure restent exclusifs au technique', () => {
    for (const role of ['admin', 'supervision', 'caisse'] as Role[]) {
      expect(aLeDroit([role], 'ecrans.declarer')).toBe(false);
      expect(aLeDroit([role], 'parametres.technique')).toBe(false);
      expect(aLeDroit([role], 'journal.purger')).toBe(false);
    }
    expect(aLeDroit(['technique'], 'ecrans.declarer')).toBe(true);
    expect(aLeDroit(['technique'], 'parametres.technique')).toBe(true);
    expect(aLeDroit(['technique'], 'journal.purger')).toBe(true);
  });

  it('les lignes de rôles du journal ne sont lisibles que par admin et technique', () => {
    expect(aLeDroit(['technique'], 'journal.roles')).toBe(true);
    expect(aLeDroit(['admin'], 'journal.roles')).toBe(true);
    expect(aLeDroit(['supervision'], 'journal.roles')).toBe(false);
    expect(aLeDroit(['caisse'], 'journal.roles')).toBe(false);
    // …mais tout le monde lit le journal d'exploitation courant.
    for (const role of ROLES) expect(aLeDroit([role], 'journal')).toBe(true);
  });

  it('le bandeau reste ouvert à la caisse, jamais au technique seul', () => {
    expect(aLeDroit(['caisse'], 'bandeau')).toBe(true);
    expect(aLeDroit(['technique'], 'bandeau')).toBe(false);
  });
});

describe('Onglets visibles', () => {
  it('technique : horaires, écrans, utilisateurs, journal', () => {
    expect(ongletsVisibles(['technique'])).toEqual([
      'horaires',
      'ecrans',
      'utilisateurs',
      'journal',
    ]);
  });

  it('technique n’a PLUS « Paramètres » : il n’y reste que de l’exploitation', () => {
    // Machines, motifs, états du ciel, délai « à quai » relèvent de
    // `parametres.exploitation`, que l'informatique ne porte pas. Ses propres
    // réglages (veille globale, cache) vivent dans l'onglet Écrans.
    expect(ongletsVisibles(['technique'])).not.toContain('parametres');
  });

  it('admin : horaires, bandeau, médias, paramètres, utilisateurs, journal', () => {
    expect(ongletsVisibles(['admin'])).toEqual([
      'horaires',
      'bandeau',
      'medias',
      'parametres',
      'utilisateurs',
      'journal',
    ]);
  });

  it('supervision : tout sauf paramètres et utilisateurs', () => {
    expect(ongletsVisibles(['supervision'])).toEqual([
      'circulations',
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'journal',
    ]);
  });

  it('caisse : cinq onglets sur huit depuis l’élargissement du 06/09', () => {
    // Correctif antérieur : l'onglet « Paramètres » exigeait `comptes.lire` ou
    // `journal.purger`, que la caisse n'a pas — son droit `journal` ne menait
    // donc à AUCUN écran. Un onglet dédié le rend accessible.
    // 06/09/2026 : `medias` et `ecrans.commander` ouvrent deux onglets de plus.
    expect(ongletsVisibles(['caisse'])).toEqual([
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'journal',
    ]);
  });

  it('…et la caisse n’atteint TOUJOURS PAS les trois onglets sensibles', () => {
    // L'élargissement ne doit pas se faire de proche en proche : ce qu'il
    // laisse fermé compte autant que ce qu'il ouvre.
    const vus = ongletsVisibles(['caisse']);
    expect(vus).not.toContain('circulations');
    expect(vus).not.toContain('parametres');
    expect(vus).not.toContain('utilisateurs');
  });

  it('les droits gagnés par la caisse sont ceux d’un rôle EXISTANT, pas des nouveaux', () => {
    // Aucun droit n'a été créé pour l'occasion : la caisse rejoint des droits
    // que d'autres rôles portaient déjà. Un droit fabriqué pour un seul rôle
    // serait le début d'une matrice illisible.
    for (const droit of ['medias', 'ecrans.commander'] as const) {
      expect(aLeDroit(['caisse'], droit)).toBe(true);
      const autresPorteurs = (['technique', 'admin', 'supervision'] as Role[]).filter((r) =>
        aLeDroit([r], droit),
      );
      expect(autresPorteurs.length).toBeGreaterThan(0);
    }
  });

  it('la caisse ne gagne rien sur l’exploitation ni sur les comptes', () => {
    for (const droit of [
      'circulations',
      'journee.reinitialiser',
      'parametres.exploitation',
      'parametres.technique',
      'grilles',
      'modeles',
      'ecrans.declarer',
      'comptes.lire',
      'comptes.gerer',
      'journal.roles',
      'journal.purger',
    ] as const) {
      expect(aLeDroit(['caisse'], droit), `caisse ne doit pas porter ${droit}`).toBe(false);
    }
  });

  it('le cumul réunit les onglets, dans l’ordre de la barre', () => {
    expect(ongletsVisibles(['technique', 'admin'])).toEqual([
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'parametres',
      'utilisateurs',
      'journal',
    ]);
    expect(ongletsVisibles(['admin', 'supervision'])).toEqual([
      'circulations',
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'parametres',
      'utilisateurs',
      'journal',
    ]);
  });

  it('aucun rôle : aucun onglet', () => {
    expect(ongletsVisibles([])).toEqual([]);
  });
});

describe('Attribution : qui donne quoi', () => {
  it('technique n’attribue que technique', () => {
    expect(rolesAttribuables(['technique'])).toEqual(['technique']);
  });

  it('admin attribue admin, supervision et caisse — jamais technique', () => {
    expect(rolesAttribuables(['admin'])).toEqual(['admin', 'supervision', 'caisse']);
    expect(peutAttribuer(['admin'], 'technique')).toBe(false);
  });

  it('supervision et caisse n’attribuent rien', () => {
    expect(rolesAttribuables(['supervision'])).toEqual([]);
    expect(rolesAttribuables(['caisse'])).toEqual([]);
    for (const role of ROLES) {
      expect(peutAttribuer(['supervision'], role)).toBe(false);
      expect(peutAttribuer(['caisse'], role)).toBe(false);
      expect(peutAttribuer([], role)).toBe(false);
    }
  });

  it('le cumul technique+admin attribue les quatre rôles', () => {
    expect(rolesAttribuables(['technique', 'admin'])).toEqual([...ROLES]);
  });

  it('la matrice ne laisse aucun rôle orphelin ni auto-attribuable en cascade', () => {
    for (const role of ROLES) expect(ATTRIBUABLE_PAR[role].length).toBeGreaterThan(0);
    // Un admin ne peut pas fabriquer un technique, même en passant par un tiers.
    expect(ATTRIBUABLE_PAR.technique).toEqual(['technique']);
  });
});

describe('Gestion d’un compte : règle STRICTE (tous les rôles de la cible)', () => {
  it('un admin ne gère pas un compte portant technique', () => {
    expect(peutGererProfil(['admin'], ['technique'])).toBe(false);
    expect(peutGererProfil(['admin'], ['technique', 'admin'])).toBe(false);
  });

  it('un technique ne gère pas un compte d’exploitation', () => {
    expect(peutGererProfil(['technique'], ['supervision'])).toBe(false);
    expect(peutGererProfil(['technique'], ['admin'])).toBe(false);
  });

  it('un admin gère les comptes admin, supervision et caisse', () => {
    expect(peutGererProfil(['admin'], ['supervision'])).toBe(true);
    expect(peutGererProfil(['admin'], ['admin', 'caisse'])).toBe(true);
  });

  it('seul un compte cumulant technique+admin gère un compte cumulant technique+admin', () => {
    expect(peutGererProfil(['technique', 'admin'], ['technique', 'admin'])).toBe(true);
  });

  it('un compte sans rôle est gérable par quiconque attribue au moins un rôle', () => {
    expect(peutGererProfil(['admin'], [])).toBe(true);
    expect(peutGererProfil(['technique'], [])).toBe(true);
    // …mais pas par un rôle qui n'attribue rien : le compte ne serait pas orphelin, il serait ouvert à tous.
    expect(peutGererProfil(['supervision'], [])).toBe(false);
    expect(peutGererProfil(['caisse'], [])).toBe(false);
    expect(peutGererProfil([], [])).toBe(false);
  });
});

describe('Garde-fou : dernier détenteur d’un rôle protégé', () => {
  const equipe = [
    compte('thomas', ['technique', 'admin', 'supervision']),
    compte('myosotis', ['technique']),
    compte('chef', ['admin', 'supervision']),
    compte('agent', ['supervision']),
    compte('guichet', ['caisse']),
    compte('parti', ['admin', 'technique'], false),
  ];

  it('deux détenteurs actifs : personne n’est le dernier', () => {
    expect(estDernierDetenteur(equipe, 'thomas', 'technique')).toBe(false);
    expect(estDernierDetenteur(equipe, 'myosotis', 'technique')).toBe(false);
    expect(estDernierDetenteur(equipe, 'thomas', 'admin')).toBe(false);
  });

  it('un seul détenteur actif : il est le dernier', () => {
    const seul = [compte('thomas', ['technique', 'admin']), compte('agent', ['supervision'])];
    expect(estDernierDetenteur(seul, 'thomas', 'technique')).toBe(true);
    expect(estDernierDetenteur(seul, 'thomas', 'admin')).toBe(true);
    expect(rolesDontIlEstLeDernier(seul, 'thomas')).toEqual(['technique', 'admin']);
  });

  it('un compte INACTIF ne compte pas comme détenteur', () => {
    const avecInactif = [compte('myosotis', ['technique']), compte('parti', ['technique'], false)];
    expect(estDernierDetenteur(avecInactif, 'myosotis', 'technique')).toBe(true);
  });

  it('les rôles non protégés n’ont jamais de « dernier »', () => {
    const seul = [compte('agent', ['supervision', 'caisse'])];
    expect(estDernierDetenteur(seul, 'agent', 'supervision')).toBe(false);
    expect(estDernierDetenteur(seul, 'agent', 'caisse')).toBe(false);
    expect(ROLES_PROTEGES).toEqual(['technique', 'admin']);
  });
});

describe('Cases à cocher : motifs de verrouillage', () => {
  const equipe = [
    compte('thomas', ['technique', 'admin']),
    compte('chef', ['admin', 'supervision']),
    compte('agent', ['supervision']),
  ];
  const cible = (id: string) => equipe.find((c) => c.user_id === id)!;

  it('personne ne modifie ses propres rôles', () => {
    const motif = motifCaseVerrouillee(
      ['technique', 'admin'],
      'thomas',
      cible('thomas'),
      'admin',
      equipe,
    );
    expect(motif).toMatch(/propres rôles/);
  });

  it('un admin ne coche pas la case « technique »', () => {
    const motif = motifCaseVerrouillee(['admin'], 'chef', cible('agent'), 'technique', equipe);
    expect(motif).toMatch(/Technique/);
  });

  it('la case du dernier détenteur est verrouillée', () => {
    const duo = [compte('thomas', ['technique']), compte('chef', ['admin'])];
    const motif = motifCaseVerrouillee(['technique', 'admin'], 'chef', duo[0]!, 'technique', duo);
    expect(motif).toMatch(/Dernier compte actif/);
  });

  it('une case attribuable sur un tiers non protégé est libre', () => {
    expect(motifCaseVerrouillee(['admin'], 'chef', cible('agent'), 'caisse', equipe)).toBeNull();
  });
});

describe('Désactivation et suppression : motifs de verrouillage', () => {
  const equipe = [
    compte('thomas', ['technique', 'admin']),
    compte('chef', ['admin', 'supervision']),
    compte('agent', ['supervision']),
    compte('myosotis', ['technique']),
  ];

  it('on ne se désactive jamais soi-même', () => {
    expect(motifCompteVerrouille(['admin'], 'chef', equipe[1]!, equipe)).toMatch(/propre compte/);
  });

  it('un admin ne désactive pas un compte technique', () => {
    expect(motifCompteVerrouille(['admin'], 'chef', equipe[3]!, equipe)).toMatch(/rôle que vous n/);
  });

  it('le dernier détenteur d’un rôle protégé est verrouillé', () => {
    const duo = [compte('thomas', ['technique', 'admin']), compte('agent', ['supervision'])];
    expect(motifCompteVerrouille(['technique', 'admin'], 'agent', duo[0]!, duo)).toMatch(
      /Dernier compte actif/,
    );
  });

  it('un compte d’exploitation ordinaire est gérable par un admin', () => {
    expect(motifCompteVerrouille(['admin'], 'chef', equipe[2]!, equipe)).toBeNull();
  });
});

describe('Rôles de démonstration déduits de l’e-mail (mock)', () => {
  it('reconnaît un rôle simple', () => {
    expect(rolesDemoDepuisEmail('admin@demo')).toEqual(['admin']);
    expect(rolesDemoDepuisEmail('caisse@demo')).toEqual(['caisse']);
    expect(rolesDemoDepuisEmail('technique@demo')).toEqual(['technique']);
  });

  it('reconnaît le CUMUL par « + »', () => {
    expect(rolesDemoDepuisEmail('technique+admin@demo')).toEqual(['technique', 'admin']);
    expect(rolesDemoDepuisEmail('admin+supervision@tmb.fr')).toEqual(['admin', 'supervision']);
  });

  it('retombe sur supervision quand rien n’est reconnu', () => {
    expect(rolesDemoDepuisEmail('marie.dupond@exemple.fr')).toEqual(['supervision']);
    expect(rolesDemoDepuisEmail('')).toEqual(['supervision']);
  });

  it('ignore la casse et l’ordre de saisie', () => {
    expect(rolesDemoDepuisEmail('Admin+Technique@demo')).toEqual(['technique', 'admin']);
  });
});
