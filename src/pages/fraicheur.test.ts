// Preuve de mise à jour par écran : « la machine répond » (derniere_vue) ne
// prouve PAS que ce qui est affiché est frais (donnees_maj). Ces tests
// verrouillent les trois états attendus par l'exploitant.
import { describe, expect, it } from 'vitest';

import { INTERVALLE_HEARTBEAT_MS } from './affichage-commun';
import { etatFraicheurEcran, resumeApplication, SEUIL_HORS_LIGNE_MS } from './supervision-logique';

const MAINTENANT = new Date('2026-08-28T10:00:00Z').getTime();
const ilYA = (ms: number): string => new Date(MAINTENANT - ms).toISOString();

describe('etatFraicheurEcran', () => {
  it('écran à jour → vert : ses données sont postérieures à la publication', () => {
    const publication = MAINTENANT - 5 * 60_000; // publié il y a 5 min
    const etat = etatFraicheurEcran(
      { derniere_vue: ilYA(10_000), donnees_maj: ilYA(60_000) }, // synchro il y a 1 min
      publication,
      MAINTENANT,
    );
    expect(etat.statut).toBe('a-jour');
    expect(etat.retard_min).toBe(0);
    expect(etat.libelle).toBe('à jour');
  });

  it('écran figé sur d’anciennes données → orange, avec le bon écart', () => {
    const publication = MAINTENANT - 2 * 60_000; // publié il y a 2 min
    const etat = etatFraicheurEcran(
      // La machine bat toujours (12 s), mais ses données datent de 20 min
      { derniere_vue: ilYA(12_000), donnees_maj: ilYA(20 * 60_000) },
      publication,
      MAINTENANT,
    );
    expect(etat.statut).toBe('en-retard');
    expect(etat.retard_min).toBe(18); // 20 min de données − 2 min de publication
    expect(etat.libelle).toBe('en retard de 18 min');
  });

  it('juste après une modification : « application en cours… », pas un faux retard', () => {
    // Publication il y a 10 s : les écrans ont jusqu'à 30 s pour se resynchroniser
    const publication = MAINTENANT - 10_000;
    const etat = etatFraicheurEcran(
      { derniere_vue: ilYA(5000), donnees_maj: ilYA(40_000) },
      publication,
      MAINTENANT,
    );
    expect(etat.statut).toBe('en-retard'); // orange, mais libellé non alarmant
    expect(etat.libelle).toBe('application en cours…');
  });

  it('passé le délai de propagation, le vrai retard est nommé', () => {
    const publication = MAINTENANT - 3 * 60_000; // publié il y a 3 min
    const etat = etatFraicheurEcran(
      { derniere_vue: ilYA(5000), donnees_maj: ilYA(11 * 60_000) },
      publication,
      MAINTENANT,
    );
    expect(etat.libelle).toBe('en retard de 8 min'); // 11 min de données - 3 min de publication
  });

  it('écran silencieux → rouge, même si ses dernières données étaient fraîches', () => {
    const etat = etatFraicheurEcran(
      { derniere_vue: ilYA(5 * 60_000), donnees_maj: ilYA(5 * 60_000) },
      MAINTENANT - 60_000,
      MAINTENANT,
    );
    expect(etat.statut).toBe('hors-ligne');
    expect(etat.libelle).toBe('hors ligne');
  });

  it('le seuil hors ligne vaut deux cycles et demi de signal de vie', () => {
    expect(SEUIL_HORS_LIGNE_MS).toBe(150_000);
    expect(SEUIL_HORS_LIGNE_MS).toBe(2.5 * INTERVALLE_HEARTBEAT_MS);
  });

  it('un écran juste sous le seuil reste en ligne, juste au-dessus il tombe', () => {
    const juste = etatFraicheurEcran(
      { derniere_vue: ilYA(SEUIL_HORS_LIGNE_MS - 1000), donnees_maj: ilYA(1000) },
      null,
      MAINTENANT,
    );
    const depasse = etatFraicheurEcran(
      { derniere_vue: ilYA(SEUIL_HORS_LIGNE_MS + 1000), donnees_maj: ilYA(1000) },
      null,
      MAINTENANT,
    );
    expect(juste.statut).toBe('a-jour');
    expect(depasse.statut).toBe('hors-ligne');
  });

  it('sans signal de vie du tout → hors ligne', () => {
    expect(etatFraicheurEcran({}, null, MAINTENANT).statut).toBe('hors-ligne');
    expect(etatFraicheurEcran({ derniere_vue: null }, null, MAINTENANT).statut).toBe('hors-ligne');
  });

  it('aucune publication de référence, ou écran d’une version antérieure : pas de faux retard', () => {
    expect(
      etatFraicheurEcran(
        { derniere_vue: ilYA(5000), donnees_maj: ilYA(3_600_000) },
        null,
        MAINTENANT,
      ).statut,
    ).toBe('a-jour');
    // Écran qui ne sait pas dater ses données : on ne prétend pas qu'il est en retard
    expect(
      etatFraicheurEcran({ derniere_vue: ilYA(5000) }, MAINTENANT - 60_000, MAINTENANT).statut,
    ).toBe('a-jour');
  });

  it('données exactement contemporaines de la publication → à jour', () => {
    const publication = MAINTENANT - 30_000;
    expect(
      etatFraicheurEcran(
        { derniere_vue: ilYA(5000), donnees_maj: new Date(publication).toISOString() },
        publication,
        MAINTENANT,
      ).statut,
    ).toBe('a-jour');
  });
});

describe('resumeApplication (bandeau de publication)', () => {
  const aJour = { gare: 'le-fayet', derniere_vue: ilYA(5000), donnees_maj: ilYA(5000) };
  const enRetard = {
    gare: 'bellevue',
    derniere_vue: ilYA(5000),
    donnees_maj: ilYA(30 * 60_000),
  };
  const horsLigne = { gare: 'nid-daigle', derniere_vue: ilYA(10 * 60_000), donnees_maj: null };
  const publication = MAINTENANT - 60_000;

  it('tous les écrans à jour : « Appliqué sur N/N écrans »', () => {
    const r = resumeApplication([aJour, { ...aJour, gare: 'motivon' }], publication, MAINTENANT);
    expect(r.aJour).toBe(2);
    expect(r.total).toBe(2);
    expect(r.enAttente).toEqual([]);
    expect(r.libelle).toBe('Appliqué sur 2/2 écrans');
  });

  it('écrans en retard ou muets : liste des gares en attente, avec leur nom', () => {
    const noms: Record<string, string> = { bellevue: 'Bellevue', 'nid-daigle': "Nid d'Aigle" };
    const r = resumeApplication(
      [aJour, enRetard, horsLigne],
      publication,
      MAINTENANT,
      (g) => noms[g] ?? g,
    );
    expect(r.aJour).toBe(1);
    expect(r.total).toBe(3);
    // Le Nid d'Aigle est muet depuis 10 min : on précise DEPUIS QUAND, sans
    // quoi rien ne distingue une synchro en cours d'un poste mort.
    expect(r.libelle).toBe(
      "Appliqué sur 1/3 écrans — en attente sur : Bellevue, Nid d'Aigle (hors ligne depuis 10 min)",
    );
  });

  it('un silence bref ne mérite pas de précision', () => {
    // Écran vivant (vu il y a 5 s) mais figé sur d'anciennes données : c'est
    // une synchro en retard, pas un poste mort — aucune durée à afficher.
    const r = resumeApplication([enRetard], publication, MAINTENANT, (g) => g);
    expect(r.libelle).toBe('Appliqué sur 0/1 écrans — en attente sur : bellevue');
  });

  it('un poste jamais vu est nommé comme tel', () => {
    const jamais = { gare: 'motivon', derniere_vue: null, donnees_maj: null };
    const r = resumeApplication([jamais], publication, MAINTENANT, (g) => g);
    expect(r.libelle).toContain('motivon (jamais vu)');
  });

  it('aucun écran connecté : message explicite plutôt que « 0/0 »', () => {
    expect(resumeApplication([], publication, MAINTENANT).libelle).toBe('aucun écran connecté');
  });
});
