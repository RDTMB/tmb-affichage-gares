// DataProvider factice (étape 2) : rejoue la grille active avec l'état du
// jour de la maquette validée — facultatifs 3/4/9/10/17/18 activés, retard
// +10 min (Météo) sur le TRAIN 11, descente 16 supprimée (Météo).
// Paramètre d'URL de démo : ?terminus=N applique la bascule Terminus
// Bellevue « à partir du TRAIN N » (1 = journée entière).
import { appliqueTerminusBellevue, generationJour, serviceActif } from '../core/horaires';
import type { Grille, Jour, Media, Message, Params, Session, User } from '../core/types';
import type { DataProvider } from './provider';

const FACULTATIFS_ACTIVES = [3, 4, 9, 10, 17, 18];

const MESSAGES: Message[] = [
  {
    id: 'demo-1',
    texte_fr: 'Réservation obligatoire pour tous les trajets — pensez à réserver votre descente.',
    texte_en: 'Booking is compulsory for all journeys — remember to book your descent.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
  {
    id: 'demo-2',
    texte_fr: 'Restez derrière la ligne jaune à l’approche du train.',
    texte_en: 'Please stand behind the yellow line when the tram approaches.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
  {
    id: 'demo-3',
    texte_fr: 'Trains vélos : transport limité à 5 vélos, selon affluence.',
    texte_en: 'Bike trains: limited to 5 bikes, subject to capacity.',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  },
];

const PARAMS: Params = {
  meteo_sommet: { t: 9, ciel_fr: 'Dégagé', ciel_en: 'Clear' },
  veille_nuit: { debut: '21:00', fin: '06:00' },
  duree_horaires_s: 20,
  duree_cache_min: 15,
  machines: [
    { nom: 'Marie', couleur: '#2E74B5', en_service: true },
    { nom: 'Anne', couleur: '#7FA51E', en_service: true },
    { nom: 'Jeanne', couleur: '#C2447A', en_service: true },
    { nom: 'Marguerite', couleur: '#FFFFFF', cercle: '#E52A23', en_service: true },
  ],
  motifs: [
    { fr: 'Météo', en: 'Weather' },
    { fr: 'Croisement', en: 'Crossing' },
    { fr: 'Technique', en: 'Technical issue' },
    { fr: 'Affluence', en: 'High demand' },
    { fr: 'Exploitation', en: 'Operations' },
  ],
};

export interface OptionsMock {
  /** Bascule Terminus Bellevue « à partir du TRAIN N » appliquée au jour. */
  terminusAPartirDuTrain?: number;
}

function indisponible(): never {
  throw new Error('Fonction de supervision indisponible en mode mock (étape 5+).');
}

export class MockProvider implements DataProvider {
  private grilles: Promise<Grille[]> | null = null;

  constructor(private readonly options: OptionsMock = {}) {}

  getGrilles(): Promise<Grille[]> {
    // Les grilles officielles restent des fichiers versionnés servis par
    // l'application elle-même : aucune requête externe.
    this.grilles ??= Promise.all(
      ['2026-ete-grand-service', '2026-ete-petit-service'].map(async (nom) => {
        const reponse = await fetch(`/grilles/${nom}.json`);
        if (!reponse.ok) throw new Error(`Grille ${nom} introuvable (${reponse.status})`);
        return (await reponse.json()) as Grille;
      }),
    );
    return this.grilles;
  }

  async getJour(date: string): Promise<Jour> {
    const grilles = await this.getGrilles();
    // Hors saison, la démo rejoue le grand service pour rester utilisable.
    const grille = serviceActif(grilles, date) ?? grilles[0];
    if (!grille) throw new Error('Aucune grille disponible');

    let jour = generationJour(grille, date);
    for (const numero of FACULTATIFS_ACTIVES) {
      const c = jour.circulations.find((x) => x.numero === numero);
      if (c) c.facultatif_actif = true;
    }
    const t11 = jour.circulations.find((x) => x.numero === 11);
    if (t11) Object.assign(t11, { statut: 'retard', retard_min: 10, motif: 'Météo' });
    const t16 = jour.circulations.find((x) => x.numero === 16);
    if (t16) Object.assign(t16, { statut: 'supprime', motif: 'Météo' });

    if (this.options.terminusAPartirDuTrain !== undefined) {
      jour = appliqueTerminusBellevue(grille, jour, this.options.terminusAPartirDuTrain).jour;
    }
    return jour;
  }

  async getMessages(): Promise<Message[]> {
    return MESSAGES;
  }

  async getMedias(): Promise<Media[]> {
    return [];
  }

  async getParams(): Promise<Params> {
    return PARAMS;
  }

  onChange(): () => void {
    return () => {}; // pas de temps réel en mode mock
  }

  async heartbeat(): Promise<void> {}

  // — supervision : indisponible en mode mock —
  async signIn(): Promise<Session> {
    return indisponible();
  }
  async getRole(): Promise<never> {
    return indisponible();
  }
  async genererJour(): Promise<void> {
    indisponible();
  }
  async saveCirculation(): Promise<void> {
    indisponible();
  }
  async setTerminusBellevue(): Promise<void> {
    indisponible();
  }
  async saveMessage(): Promise<void> {
    indisponible();
  }
  async deleteMessage(): Promise<void> {
    indisponible();
  }
  async uploadMedia(): Promise<void> {
    indisponible();
  }
  async saveMedia(): Promise<void> {
    indisponible();
  }
  async deleteMedia(): Promise<void> {
    indisponible();
  }
  async saveParams(): Promise<void> {
    indisponible();
  }
  async saveMachine(): Promise<void> {
    indisponible();
  }
  async saveMotif(): Promise<void> {
    indisponible();
  }
  async listUsers(): Promise<User[]> {
    return indisponible();
  }
  async saveUser(): Promise<void> {
    indisponible();
  }
  async logPublication(): Promise<void> {
    indisponible();
  }
  async listEcrans(): Promise<never> {
    return indisponible();
  }
  async demanderRechargement(): Promise<void> {
    indisponible();
  }
}
