@echo off
rem ---------------------------------------------------------------------------
rem Lanceur du script de deploiement des Edge Functions.
rem
rem Windows refuse par defaut d'executer un fichier .ps1 : "l'execution de
rem scripts est desactivee sur ce systeme". Un fichier .cmd, lui, n'est pas
rem soumis a cette regle. Il sert donc de porte d'entree et rouvre PowerShell
rem avec l'autorisation, POUR CE SEUL APPEL.
rem
rem Rien n'est modifie sur le poste : la strategie d'execution du systeme
rem reste telle quelle, et aucun droit administrateur n'est requis.
rem
rem Usage identique au script PowerShell :
rem   outils\deployer-edge-functions.cmd -Connexion
rem   outils\deployer-edge-functions.cmd -Projet test -Simulation
rem   outils\deployer-edge-functions.cmd -Projet test
rem   outils\deployer-edge-functions.cmd -Projet prod
rem ---------------------------------------------------------------------------
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deployer-edge-functions.ps1" %*
exit /b %ERRORLEVEL%
