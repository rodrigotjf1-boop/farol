#!/usr/bin/env bash
# =====================================================================
# O pacote compilado do agente (o primeiro passo da proteção)
# =====================================================================
# Compila `farol_agent` num módulo de máquina — um arquivo só, sem o texto
# do programa — e roda a suíte do agente contra ele, num espelho do
# repositório em que o texto do agente NÃO está.
#
#   bash agent/ferramentas/pacote_compilado.sh compilar <pasta-de-obra> [ref]
#   bash agent/ferramentas/pacote_compilado.sh testar   <pasta-de-obra> [ref]
#
# `<pasta-de-obra>` fica FORA do repositório (tudo ali pode ser apagado).
# `[ref]` é de onde sai o que se compila e o que se testa: um commit, um
# ramo ou `HEAD` (o padrão). Sai do git, e não da pasta de trabalho, para o
# pacote não levar arquivo solto da máquina de quem compila — é a mesma
# origem do pacote que vai para a loja.
#
# O que sai em `<pasta-de-obra>/pacote`:
#   farol_agent.cpXY-win_amd64.pyd   o agente, compilado
#   farol_agent/modelos/…            os arquivos de DADOS do pacote: o módulo
#                                    não os leva dentro, eles vão ao lado, no
#                                    mesmo caminho em que o programa os procura
#   pyproject.toml
#
# Precisa de: Windows, Git Bash, o Python da MESMA versão menor do
# computador da loja (o módulo só carrega nela: `cp314` = 3.14) e o
# compilador de C da Microsoft. O Nuitka é instalado numa pasta da própria
# obra, na versão fixada abaixo, sem tocar no Python da máquina.
#
# O que isto NÃO faz: assinar o arquivo, montar o zip da troca e trocar o
# pacote na loja. O módulo esconde o "como"; os textos fixos continuam
# legíveis dentro dele (docs/decisoes.md, "O pacote compilado, ensaiado").
# =====================================================================
set -uo pipefail

NUITKA="nuitka==4.3"

acao="${1:-}"
obra="${2:-}"
ref="${3:-HEAD}"
if [ -z "$acao" ] || [ -z "$obra" ] || { [ "$acao" != "compilar" ] && [ "$acao" != "testar" ]; }; then
  sed -n '2,12p' "$0"
  exit 2
fi

raiz="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 2
mkdir -p "$obra" || exit 2
obra="$(cd "$obra" && pwd)"
case "$obra/" in
  "$raiz"/*) echo "a pasta de obra tem de ficar FORA do repositório: $obra"; exit 2 ;;
esac
commit="$(git -C "$raiz" rev-parse --short "$ref")" || exit 2

if [ "$acao" = "compilar" ]; then
  rm -rf "$obra/src" "$obra/out" "$obra/pacote"
  mkdir -p "$obra/src" "$obra/out" "$obra/pacote" "$obra/libs"
  git -C "$raiz" archive "$ref:agent" farol_agent pyproject.toml | tar -x -C "$obra/src" || exit 3

  if ! PYTHONPATH="$(cygpath -w "$obra/libs")" python -m nuitka --version >/dev/null 2>&1; then
    python -m pip install --quiet --disable-pip-version-check --target "$obra/libs" "$NUITKA" 2>&1 | tail -2
  fi

  cd "$obra/src" || exit 2
  echo "commit $commit · $(python --version) · arquivos .py: $(find farol_agent -name '*.py' | wc -l) · começou $(date +%H:%M:%S)"
  PYTHONPATH="$(cygpath -w "$obra/libs")" python -m nuitka --module farol_agent --include-package=farol_agent \
    --output-dir="$(cygpath -w "$obra/out")" --assume-yes-for-downloads --msvc=latest --no-pyi-file --quiet 2>&1 | tail -15
  echo "terminou $(date +%H:%M:%S)"

  modulo="$(ls "$obra/out"/farol_agent*.pyd 2>/dev/null | head -1)"
  if [ -z "$modulo" ]; then
    echo "SEM MÓDULO COMPILADO"
    exit 4
  fi
  cp "$modulo" "$obra/pacote/" || exit 4
  cp "$obra/src/pyproject.toml" "$obra/pacote/" || exit 4
  # Os arquivos de dados: tudo o que o pacote tem e não é programa vai ao
  # lado do módulo, no mesmo caminho.
  (cd "$obra/src" && find farol_agent -type f ! -name '*.py' -print0 | xargs -0 -r cp --parents -t "$obra/pacote") || exit 4

  echo "o pacote:"
  (cd "$obra/pacote" && find . -type f | sort | while IFS= read -r f; do echo "  $(stat -c %s "$f") bytes  ${f#./}"; done)
  echo "sha256 do módulo: $(sha256sum "$obra/pacote/$(basename "$modulo")" | cut -c1-64)"
  sobrou="$(find "$obra/pacote" -name '*.py' | wc -l)"
  echo "texto de programa dentro do pacote: $sobrou arquivo(s) .py"
  [ "$sobrou" -eq 0 ] || exit 5
fi

if [ "$acao" = "testar" ]; then
  if ! ls "$obra/pacote"/farol_agent*.pyd >/dev/null 2>&1; then
    echo "não há pacote compilado em $obra/pacote: rode antes com «compilar»"
    exit 3
  fi
  espelho="$obra/espelho"
  rm -rf "$espelho"
  mkdir -p "$espelho/agent"
  cp -r "$obra/pacote"/. "$espelho/agent/" || exit 3
  git -C "$raiz" archive "$ref:agent" testes | tar -x -C "$espelho/agent" || exit 3
  # O que os testes leem fora da pasta do agente.
  git -C "$raiz" archive "$ref" contratos catalogo | tar -x -C "$espelho" || exit 3

  cd "$espelho/agent" || exit 2
  fora="$(find . -path ./testes -prune -o -name '*.py' -print | wc -l)"
  echo "commit $commit · $(python --version) · texto do agente no espelho: $fora arquivo(s) .py fora dos testes"
  [ "$fora" -eq 0 ] || exit 5
  # Diz aos poucos testes que conferem o TEXTO do programa que aqui não há
  # texto (testes/conftest.py, `texto_do_programa`): eles são pulados, com o
  # motivo. Todo o resto roda contra o módulo.
  FAROL_PACOTE_COMPILADO=1 python -m pytest -q -p no:cacheprovider -rs 2>&1 | tail -12
  exit "${PIPESTATUS[0]}"
fi
