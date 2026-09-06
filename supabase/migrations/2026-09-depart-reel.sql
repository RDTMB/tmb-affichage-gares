-- Départ RÉEL d'une descente supplémentaire depuis son terminus.
--
-- À la création d'un train de renfort, le temps de stationnement en haut est
-- ESTIMÉ (battement) et les horaires de la descente en découlent. Ce temps
-- change en réalité : les heures affichées en gare deviennent fausses. Cette
-- colonne porte l'heure constatée — NULL = horaire estimé, renseignée =
-- départ réel, les passages de la descente ayant été recalculés depuis elle.
--
-- Déjà appliquée en base ; ce fichier la consigne pour tout autre projet.
alter table circulations add column if not exists depart_reel time;
