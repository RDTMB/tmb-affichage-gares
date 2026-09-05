<#
.SYNOPSIS
    Déploie les Edge Functions du projet TMB sur un projet Supabase donné.

.DESCRIPTION
    Reproduit, sans passer par le tableau de bord, le déploiement des trois
    fonctions « traduire », « inviter-utilisateur » et « supprimer-utilisateur ».

    Le script :
      - retrouve node/npx même s'il n'est pas dans le PATH (installation portable) ;
      - impose TOUJOURS --project-ref, pour qu'un projet lié en cache ne puisse
        pas détourner le déploiement vers la production ;
      - exige une confirmation tapée à la main avant tout envoi en production ;
      - travaille sans Docker (--use-api) ;
      - n'affiche, ne journalise et ne stocke JAMAIS le jeton d'accès.

    L'authentification se fait une fois pour toutes par « -Connexion », qui ouvre
    le navigateur. Aucun secret n'est à taper dans le terminal.

.PARAMETER Projet
    « test » ou « prod ». Obligatoire : il n'y a pas de valeur par défaut, pour
    qu'un oubli ne parte jamais en production.

.PARAMETER Fonctions
    Les fonctions à déployer. Par défaut les trois du projet.

.PARAMETER VersionCli
    Version de la CLI Supabase. Figée pour être reproductible ; « latest » est
    accepté pour un dépannage ponctuel.

.PARAMETER Connexion
    Ouvre le navigateur pour autoriser ce poste, puis s'arrête. À faire une fois.

.PARAMETER Simulation
    Vérifie tout (npx, dossiers, autorisation, projet joignable) et affiche
    l'état actuel des fonctions déployées, mais ne déploie rien.

.NOTES
    Windows refuse par défaut d'exécuter un fichier .ps1. Passer par le lanceur
    outils\deployer-edge-functions.cmd, qui accepte exactement les mêmes
    paramètres et ne demande aucun droit particulier.

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Connexion

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test -Simulation

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet test

.EXAMPLE
    .\outils\deployer-edge-functions.cmd -Projet prod
#>
[CmdletBinding()]
param(
    [ValidateSet('test', 'prod')]
    [string] $Projet,

    [string[]] $Fonctions = @('traduire', 'inviter-utilisateur', 'supprimer-utilisateur'),

    [string] $VersionCli = '2.116.0',

    [switch] $Connexion,

    [switch] $Simulation
)

$ErrorActionPreference = 'Stop'

# --- Références des projets Supabase -----------------------------------------
# Écrites en dur A DESSEIN : un ref saisi à la main est un ref qu'on peut se
# tromper de taper, et se tromper ici veut dire déployer en production.
$REFS = @{
    test = 'wyltzhggbyfteojbfoup'
    prod = 'csstkdcqdzaiibfqrscv'
}

function Ecrire-Titre($texte) {
    Write-Host ''
    Write-Host "== $texte" -ForegroundColor Cyan
}

function Ecrire-Ok($texte) {
    Write-Host "   OK   $texte" -ForegroundColor Green
}

function Ecrire-Info($texte) {
    Write-Host "        $texte" -ForegroundColor DarkGray
}

# --- 1. Retrouver npx ---------------------------------------------------------
function Trouver-Npx {
    $trouve = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
    if ($null -ne $trouve) { return $trouve.Source }

    $candidats = @(
        (Join-Path $env:LOCALAPPDATA 'nodejs-portable\node-v24.19.0-win-x64'),
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
        (Join-Path $env:APPDATA 'npm')
    )

    foreach ($dossier in $candidats) {
        if ([string]::IsNullOrWhiteSpace($dossier)) { continue }
        $chemin = Join-Path $dossier 'npx.cmd'
        try {
            if (Test-Path -LiteralPath $chemin) { return $chemin }
        } catch {
            # Test-Path répond aussi False quand l'accès est refusé : on passe.
        }
    }
    return $null
}

# --- 2. Appel de la CLI -------------------------------------------------------
function Invoquer-Cli {
    param(
        [Parameter(Mandatory = $true)] [string] $Npx,
        [Parameter(Mandatory = $true)] [string[]] $Arguments,
        [switch] $ToleranteALEchec
    )

    $complets = @('--yes', "supabase@$VersionCli") + $Arguments
    Ecrire-Info "npx $($complets -join ' ')"
    & $Npx @complets
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $ToleranteALEchec) {
        throw "La CLI Supabase a échoué (code $code)."
    }
    return $code
}

# =============================================================================
Ecrire-Titre 'Poste de travail'

$npx = Trouver-Npx
if ($null -eq $npx) {
    Write-Host ''
    Write-Host 'node/npx est introuvable depuis cette fenêtre.' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Deux causes possibles :'
    Write-Host '  1. Node n''est pas installé sur ce poste.'
    Write-Host '  2. Il est installé en portable, mais CE terminal n''a pas le droit'
    Write-Host '     de lire le dossier (Test-Path y répond False sans le dire).'
    Write-Host ''
    Write-Host 'Sans node, ce script ne peut rien faire. Repli : déployer les'
    Write-Host 'fonctions depuis le tableau de bord Supabase (voir docs/mise-en-service.md,'
    Write-Host 'section E).'
    exit 2
}
Ecrire-Ok "npx : $npx"

# npx.cmd n'est qu'un lanceur : il appelle « node » et le cherche dans le PATH.
# Trouver le .cmd ne suffit donc pas, il faut aussi rendre node visible.
$dossierNode = Split-Path -Parent $npx
$env:Path = "$dossierNode;$env:Path"
if ($null -eq (Get-Command 'node.exe' -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host "node.exe est absent de $dossierNode." -ForegroundColor Red
    Write-Host 'L''installation Node de ce poste est incomplète.'
    exit 2
}

$racine = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $racine
Ecrire-Ok "Dépôt : $racine"

$version = & $npx --yes "supabase@$VersionCli" --version | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Impossible de lancer la CLI Supabase.' -ForegroundColor Red
    exit 2
}
Ecrire-Ok "CLI Supabase : $version"

# --- Autorisation du poste ----------------------------------------------------
if ($Connexion) {
    Ecrire-Titre 'Autorisation de ce poste'
    Ecrire-Info 'Le navigateur va s''ouvrir. Rien à taper ici.'
    Invoquer-Cli -Npx $npx -Arguments @('login') | Out-Null
    Write-Host ''
    Ecrire-Ok 'Poste autorisé. Relancer avec -Projet test ou -Projet prod.'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Projet)) {
    Write-Host ''
    Write-Host 'Préciser -Projet test ou -Projet prod (ou -Connexion la première fois).' -ForegroundColor Yellow
    exit 1
}

$ref = $REFS[$Projet]

# --- 3. Les sources sont-elles là ? ------------------------------------------
Ecrire-Titre 'Fonctions à déployer'
$manquantes = @()
foreach ($f in $Fonctions) {
    $index = Join-Path $racine "supabase\functions\$f\index.ts"
    if (Test-Path -LiteralPath $index) {
        Ecrire-Ok $f
    } else {
        $manquantes += $f
        Write-Host "   !!   $f — supabase\functions\$f\index.ts introuvable" -ForegroundColor Red
    }
}
if ($manquantes.Count -gt 0) {
    Write-Host ''
    Write-Host 'Déploiement annulé : sources manquantes.' -ForegroundColor Red
    Write-Host 'Vérifier que la branche du chantier est bien celle qui est extraite.'
    exit 1
}

# --- 4. Le projet visé --------------------------------------------------------
Ecrire-Titre "Projet visé : $($Projet.ToUpper()) ($ref)"
if ($Projet -eq 'prod') {
    Write-Host '   ATTENTION : ceci est la PRODUCTION.' -ForegroundColor Yellow
}
Ecrire-Info 'Le ref est passé explicitement à chaque commande : un projet lié'
Ecrire-Info 'en cache (supabase\.temp) ne peut pas détourner le déploiement.'

Ecrire-Titre 'État actuel des fonctions déployées'
$code = Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec
if ($code -ne 0) {
    Write-Host ''
    Write-Host 'Lecture impossible. Le plus souvent, ce poste n''est pas encore autorisé.' -ForegroundColor Yellow
    Write-Host 'Lancer une fois :' -ForegroundColor Yellow
    Write-Host '    .\outils\deployer-edge-functions.cmd -Connexion' -ForegroundColor Yellow
    exit 3
}

if ($Simulation) {
    Ecrire-Titre 'Simulation'
    Ecrire-Ok 'Tout est en place. Rien n''a été déployé.'
    Ecrire-Info "Pour déployer : .\outils\deployer-edge-functions.cmd -Projet $Projet"
    exit 0
}

# --- 5. Garde-fou production --------------------------------------------------
if ($Projet -eq 'prod') {
    Write-Host ''
    $reponse = Read-Host 'Déploiement en PRODUCTION. Taper PRODUCTION pour confirmer'
    if ($reponse -cne 'PRODUCTION') {
        Write-Host 'Annulé.' -ForegroundColor Yellow
        exit 1
    }
}

# --- 6. Déploiement -----------------------------------------------------------
Ecrire-Titre 'Déploiement'
$arguments = @('functions', 'deploy') + $Fonctions + @('--project-ref', $ref, '--use-api')
Invoquer-Cli -Npx $npx -Arguments $arguments | Out-Null

Ecrire-Titre 'État après déploiement'
Invoquer-Cli -Npx $npx -Arguments @('functions', 'list', '--project-ref', $ref) -ToleranteALEchec | Out-Null

Write-Host ''
Ecrire-Ok "Déploiement terminé sur $($Projet.ToUpper()) ($ref)."
Write-Host ''
Write-Host 'Reste à vérifier, une seule fois par projet, que le secret DEEPL_API_KEY'
Write-Host 'y est bien posé (Tableau de bord > Edge Functions > Secrets), sans quoi'
Write-Host '« traduire » répondra en erreur.'
