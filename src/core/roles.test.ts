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
  motifOngletVerrouille,
  ONGLETS,
  ONGLET_DE_SECOURS,
  ROLES_QUI_ROUVRENT,
  ongletsVisibles,
  peutAttribuer,
  plafondOnglets,
  type Onglet,
  type VisibiliteOnglets,
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

  it('l’affluence est ouverte au guichet et à l’exploitation, pas au technique', () => {
    // Elle existe comme droit DISTINCT de `circulations` précisément pour ça :
    // la caisse constate le remplissage au comptoir sans qu'on lui ouvre la
    // table d'où sortent tous les horaires affichés en gare.
    expect(aLeDroit(['caisse'], 'affluence')).toBe(true);
    expect(aLeDroit(['supervision'], 'affluence')).toBe(true);
    expect(aLeDroit(['admin'], 'affluence')).toBe(true);
    expect(aLeDroit(['technique'], 'affluence')).toBe(false);
  });

  it('déclarer un train complet ne donne AUCUN droit sur les circulations', () => {
    // Le piège serait d'accorder `circulations` « puisque c'est le même
    // tableau » : la caisse pourrait alors changer un terminus ou un retard.
    expect(aLeDroit(['caisse'], 'circulations')).toBe(false);
    // …et réciproquement, `affluence` ne se déduit pas de `circulations` :
    // le technique ne l'a pas, alors qu'il réinitialise des journées.
    expect(aLeDroit(['technique'], 'journee.reinitialiser')).toBe(true);
    expect(aLeDroit(['technique'], 'affluence')).toBe(false);
  });

  it('l’affluence n’ouvre AUCUN onglet à elle seule', () => {
    // Elle vit dans des onglets déjà ouverts (Circulations, Bandeau) : si
    // elle en ouvrait un, un rôle gagnerait un écran sans qu'on l'ait voulu.
    expect(ongletsVisibles(['caisse'])).not.toContain('circulations');
    expect(plafondOnglets('caisse')).not.toContain('circulations');
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

  it('admin : places, horaires, bandeau, médias, paramètres, utilisateurs, journal', () => {
    expect(ongletsVisibles(['admin'])).toEqual([
      'affluence',
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
      'affluence',
      'horaires',
      'bandeau',
      'medias',
      'ecrans',
      'journal',
    ]);
  });

  it('caisse : six onglets sur neuf depuis l’ouverture de « Places »', () => {
    // Correctif antérieur : l'onglet « Paramètres » exigeait `comptes.lire` ou
    // `journal.purger`, que la caisse n'a pas — son droit `journal` ne menait
    // donc à AUCUN écran. Un onglet dédié le rend accessible.
    // 06/09/2026 : `medias` et `ecrans.commander` ouvrent deux onglets de plus.
    // ⚠ C'est le PLAFOND, pas ce que la caisse voit en service : le seed livré
    // lui masque Horaires (voir « Lot 2 » plus bas). Les deux cohabitent —
    // le plafond dit ce qui est permis, le réglage ce qui est affiché.
    expect(ongletsVisibles(['caisse'])).toEqual([
      'affluence',
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
      'affluence',
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
      'affluence',
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

// ---------------------------------------------------------------------------
// Visibilité des onglets réglable en supervision (table `onglets_par_role`).
//
// L'INVARIANT est ici, et rien d'autre ne compte autant : ce réglage ne peut
// que RETRANCHER. Il n'est pas une barrière de sécurité — RLS l'est — c'est du
// rangement d'interface.
// ---------------------------------------------------------------------------

describe('Onglets par rôle : le réglage ne peut que RETRANCHER', () => {
  it('un réglage qui ACCORDE hors plafond ne produit RIEN', () => {
    // Le cas d'attaque : une ligne écrite à la main en base, ou une réponse
    // d'API falsifiée, qui donnerait Circulations et Utilisateurs à la caisse.
    const forge: VisibiliteOnglets = {
      caisse: ['circulations', 'parametres', 'utilisateurs', 'bandeau'],
    };
    // Seul « bandeau » survit : c'est le seul des quatre que ses droits ouvrent.
    expect(ongletsVisibles(['caisse'], forge)).toEqual(['bandeau']);
  });

  it('AUCUN rôle ne peut gagner un onglet hors de son plafond, quoi qu’on écrive', () => {
    // Balayage exhaustif : on donne TOUT à chaque rôle et on vérifie que le
    // résultat ne dépasse jamais ce que ses droits ouvraient déjà.
    for (const role of ROLES) {
      const tout: VisibiliteOnglets = { [role]: [...ONGLETS] };
      expect(ongletsVisibles([role], tout)).toEqual(plafondOnglets(role));
    }
  });

  it('il RETRANCHE, en revanche, bel et bien', () => {
    const sansHoraires: VisibiliteOnglets = { caisse: ['bandeau', 'medias', 'ecrans', 'journal'] };
    expect(ongletsVisibles(['caisse'])).toContain('horaires');
    expect(ongletsVisibles(['caisse'], sansHoraires)).not.toContain('horaires');
  });

  it('l’ordre de la barre est conservé, quel que soit l’ordre des lignes', () => {
    const desordre: VisibiliteOnglets = { supervision: ['journal', 'bandeau', 'circulations'] };
    expect(ongletsVisibles(['supervision'], desordre)).toEqual([
      'circulations',
      'bandeau',
      'journal',
    ]);
  });

  it('le CUMUL de rôles réunit les visibilités', () => {
    // Horaires masqué à la caisse, mais pas à la supervision : un agent qui
    // porte les deux le voit. Les droits s'additionnent, la visibilité aussi.
    const v: VisibiliteOnglets = {
      caisse: ['bandeau'],
      supervision: ['horaires', 'circulations'],
    };
    expect(ongletsVisibles(['caisse', 'supervision'], v)).toEqual([
      'circulations',
      'horaires',
      'bandeau',
    ]);
  });
});

describe('Onglets par rôle : les deux replis vont vers la matrice, jamais vers « rien »', () => {
  it('réglage INDISPONIBLE (null) : chacun voit ce que ses droits ouvrent', () => {
    // Base injoignable, table absente, table vide. L'exploitation ne doit
    // jamais attendre l'informatique un matin de service : une supervision
    // aveugle parce qu'une table manque serait pire que pas de réglage.
    for (const role of ROLES) {
      expect(ongletsVisibles([role], null)).toEqual(plafondOnglets(role));
      expect(ongletsVisibles([role])).toEqual(plafondOnglets(role));
    }
  });

  it('un rôle SANS AUCUNE LIGNE suit la matrice, il ne devient pas aveugle', () => {
    // Cas réel : un rôle créé après la migration, que personne n'a réglé.
    // Le traiter comme « réglé à zéro onglet » l'enfermerait dehors — et la
    // personne capable de le rouvrir pourrait être justement celle qui le porte.
    const seulementLaCaisse: VisibiliteOnglets = { caisse: ['bandeau'] };
    expect(ongletsVisibles(['supervision'], seulementLaCaisse)).toEqual(
      plafondOnglets('supervision'),
    );
    expect(ongletsVisibles(['caisse'], seulementLaCaisse)).toEqual(['bandeau']);
  });

  it('une liste VIDE pour un rôle est traitée comme une absence de réglage', () => {
    // `{ caisse: [] }` peut venir d'une requête filtrée, pas d'une décision.
    expect(ongletsVisibles(['caisse'], { caisse: [] })).toEqual(plafondOnglets('caisse'));
  });

  it('aucun rôle ne donne aucun onglet, réglage ou pas', () => {
    expect(ongletsVisibles([], null)).toEqual([]);
    expect(ongletsVisibles([], { caisse: ['bandeau'] })).toEqual([]);
  });
});

describe('Onglets par rôle : on ne s’enferme pas dehors', () => {
  it('le rôle qui rouvre la porte est celui qui porte `parametres.technique`', () => {
    expect(ROLES_QUI_ROUVRENT.length).toBeGreaterThan(0);
    for (const role of ROLES_QUI_ROUVRENT)
      expect(aLeDroit([role], 'parametres.technique')).toBe(true);
    for (const role of ROLES) {
      if (aLeDroit([role], 'parametres.technique')) expect(ROLES_QUI_ROUVRENT).toContain(role);
    }
  });

  it('l’onglet de secours est bien celui qui héberge la carte de réglage', () => {
    expect(ONGLET_DE_SECOURS).toBe('utilisateurs');
    for (const role of ROLES_QUI_ROUVRENT) {
      expect(plafondOnglets(role)).toContain(ONGLET_DE_SECOURS);
    }
  });

  it('masquer le DERNIER accès à Utilisateurs est refusé', () => {
    const apres: VisibiliteOnglets = Object.fromEntries(
      ROLES_QUI_ROUVRENT.map((r) => [r, plafondOnglets(r).filter((o) => o !== 'utilisateurs')]),
    );
    for (const role of ROLES_QUI_ROUVRENT) {
      expect(motifOngletVerrouille(role, 'utilisateurs', apres)).toContain('rouvrir');
    }
  });

  it('…mais le masquer à un rôle qui n’en est pas le dernier accès reste permis', () => {
    // L'admin voit Utilisateurs sans pouvoir régler cette carte : le lui
    // masquer ne ferme aucune porte.
    expect(motifOngletVerrouille('admin', 'utilisateurs', null)).toBeNull();
  });

  it('un onglet HORS PLAFOND est verrouillé, et le dit clairement', () => {
    const motif = motifOngletVerrouille('caisse', 'circulations', null);
    expect(motif).toContain('aucun droit');
    // Le message nomme le rôle : l'exploitant règle quatre rôles à la fois.
    expect(motif).toContain('Caisse');
  });

  it('les autres onglets ne sont jamais verrouillés sans raison', () => {
    for (const role of ROLES) {
      for (const onglet of plafondOnglets(role)) {
        if (onglet === ONGLET_DE_SECOURS && ROLES_QUI_ROUVRENT.includes(role)) continue;
        expect(motifOngletVerrouille(role, onglet, null)).toBeNull();
      }
    }
  });
});

describe('Onglets par rôle : ce n’est PAS un mécanisme de permissions', () => {
  it('masquer un onglet ne retire AUCUN droit', () => {
    // La démonstration de l'invariant, côté droits cette fois : les onglets
    // sont un rangement d'écran, `aLeDroit()` ne les regarde même pas.
    const toutMasque: VisibiliteOnglets = Object.fromEntries(ROLES.map((r) => [r, ['journal']]));
    for (const role of ROLES) {
      for (const droit of DROITS) {
        const avant = aLeDroit([role], droit);
        expect(ongletsVisibles([role], toutMasque).length).toBeLessThanOrEqual(
          plafondOnglets(role).length,
        );
        expect(aLeDroit([role], droit)).toBe(avant);
      }
    }
  });

  it('accorder un onglet hors plafond ne donne AUCUN droit non plus', () => {
    const forge: VisibiliteOnglets = { caisse: [...ONGLETS] };
    void ongletsVisibles(['caisse'], forge);
    expect(aLeDroit(['caisse'], 'circulations')).toBe(false);
    expect(aLeDroit(['caisse'], 'comptes.gerer')).toBe(false);
    expect(aLeDroit(['caisse'], 'parametres.exploitation')).toBe(false);
  });
});

describe('Lot 2 : Horaires masqué pour la caisse', () => {
  /** Le réglage livré en seed (supabase/schema.sql et le mock de démo). */
  const SEED: VisibiliteOnglets = Object.fromEntries(
    ROLES.map((r) => [r, plafondOnglets(r).filter((o) => !(r === 'caisse' && o === 'horaires'))]),
  ) as Record<Role, Onglet[]>;

  it('la caisse ne voit plus Horaires', () => {
    // « Places » s'y est ajouté le 10/09/2026 : le guichet déclare le
    // remplissage, et c'est le seul onglet du lot. Horaires reste masqué.
    expect(ongletsVisibles(['caisse'], SEED)).toEqual([
      'affluence',
      'bandeau',
      'medias',
      'ecrans',
      'journal',
    ]);
  });

  it('elle garde le DROIT sous-jacent : c’est un masquage, pas un retrait', () => {
    // `bandeau` est ce qui lui ouvrait Horaires. Le retirer aurait cassé son
    // métier ; c'est pourquoi la décision passe par la table et non par la
    // ligne `horaires:` de DROITS_DE_L_ONGLET.
    expect(aLeDroit(['caisse'], 'bandeau')).toBe(true);
    expect(ongletsVisibles(['caisse'], SEED)).toContain('bandeau');
  });

  it('les trois autres rôles ne changent PAS d’un onglet', () => {
    // Le seed est une photographie : le jour de la bascule ne doit rien
    // changer pour qui que ce soit d'autre.
    for (const role of ['technique', 'admin', 'supervision'] as Role[]) {
      expect(ongletsVisibles([role], SEED)).toEqual(ongletsVisibles([role], null));
    }
  });

  it('l’exploitant peut revenir en arrière sans livraison', () => {
    const rendu: VisibiliteOnglets = { ...SEED, caisse: [...(SEED?.caisse ?? []), 'horaires'] };
    expect(ongletsVisibles(['caisse'], rendu)).toContain('horaires');
  });
});
