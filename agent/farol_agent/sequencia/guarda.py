"""Guardar a sequência no computador da loja, com teto e rodízio.

A grade que foi a juízo fica guardada ao lado das análises: é o que deixa
alguém conferir, depois, o que o juiz viu ("acertou / errou" — onda 2). Cada
sequência são dois arquivos com o mesmo nome:

- `<nome>.jpg`  — a grade;
- `<nome>.json` — o instante de cada número, e o que quem guardou quis anotar
  (a janela, os passos da busca, o veredito).

## O teto

A pasta tem um **teto em bytes**. Passou do teto, saem as sequências mais
antigas, uma a uma, até caber — a que acabou de entrar nunca sai. É rodízio,
não prazo: o disco de um computador de loja não cresce para sempre, e o que
importa conferir é o recente.

O teto de fábrica é escolha do produto (não medida de loja): cabe umas
centenas de sequências do tamanho estimado no plano (≈ 0,3 MB cada). Quem
instala pode dar outro.

**Dorme:** nada no agente chama este módulo ainda.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2

from farol_agent import imagens
from farol_agent.sequencia.grade import Grade

_log = logging.getLogger(__name__)

TETO_PADRAO = 200 * 1024 * 1024
QUALIDADE_DO_JPEG = 80

# O nome é dado por quem guarda (a chave da análise). Só o que não sai da pasta.
_NOME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")


class Guarda:
    def __init__(self, pasta: str | Path, *, teto: int = TETO_PADRAO) -> None:
        if teto < 1:
            raise ValueError("o teto da guarda é de pelo menos um byte")
        self.pasta = Path(pasta)
        self.teto = teto

    def _arquivos(self, nome: str) -> tuple[Path, Path]:
        if not _NOME.match(nome) or nome.endswith("."):
            raise ValueError("nome de sequência: letras, números, ponto, hífen e sublinhado, sem pasta")
        return self.pasta / f"{nome}.jpg", self.pasta / f"{nome}.json"

    def guardar(self, nome: str, grade: Grade, anotacoes: dict[str, Any] | None = None) -> Path:
        """Guarda a grade com esse nome (trocando a que houver) e faz o rodízio. Devolve o arquivo da imagem."""
        imagem, ficha = self._arquivos(nome)
        dados = {
            **(anotacoes or {}),
            # O que é da grade vem por último: anotação não troca o instante de quadro nenhum.
            "instantes": [t.isoformat() for t in grade.instantes],
            "colunas": grade.colunas,
            "celula": list(grade.celula),
            "guardada_em": datetime.now().isoformat(timespec="seconds"),
        }
        # A ficha primeiro, por troca de arquivo; a imagem depois. Imagem sem ficha não tem como ser lida de volta.
        texto = json.dumps(dados, ensure_ascii=False)
        self.pasta.mkdir(parents=True, exist_ok=True)
        temporario = ficha.with_name(ficha.name + ".tmp")
        temporario.write_text(texto, encoding="utf-8")
        os.replace(temporario, ficha)
        if not imagens.escrever(imagem, grade.imagem, [cv2.IMWRITE_JPEG_QUALITY, QUALIDADE_DO_JPEG]):
            ficha.unlink(missing_ok=True)
            raise OSError(f"não consegui gravar a imagem da sequência {nome}")
        self._rodizio(poupar=nome)
        return imagem

    def ler(self, nome: str) -> dict[str, Any] | None:
        """A ficha da sequência, com os instantes de volta em data e hora. `None` = não há (ou não se lê)."""
        imagem, ficha = self._arquivos(nome)
        if not imagem.is_file():
            return None
        try:
            dados = json.loads(ficha.read_text(encoding="utf-8"))
            dados["instantes"] = [datetime.fromisoformat(t) for t in dados["instantes"]]
        except (OSError, ValueError, KeyError, TypeError):
            return None
        return dados

    def imagem_de(self, nome: str) -> Path | None:
        """O arquivo da grade guardada, ou `None`."""
        imagem, _ = self._arquivos(nome)
        return imagem if imagem.is_file() else None

    def _sequencias(self) -> dict[str, list[Path]]:
        """Os arquivos de cada sequência que está na pasta, pelo nome dela."""
        por_nome: dict[str, list[Path]] = {}
        if not self.pasta.is_dir():
            return por_nome
        for arq in self.pasta.iterdir():
            if arq.is_file() and arq.suffix in (".jpg", ".json"):
                por_nome.setdefault(arq.stem, []).append(arq)
        return por_nome

    def tamanho(self) -> int:
        """Quantos bytes a guarda ocupa."""
        return sum(a.stat().st_size for arquivos in self._sequencias().values() for a in arquivos)

    def nomes(self) -> list[str]:
        """As sequências guardadas, da mais antiga para a mais nova."""
        por_nome = self._sequencias()
        return sorted(por_nome, key=lambda n: (min(a.stat().st_mtime_ns for a in por_nome[n]), n))

    def _rodizio(self, *, poupar: str) -> None:
        """Passou do teto: saem as mais antigas, até caber. A que acabou de entrar fica."""
        por_nome = self._sequencias()
        ocupado = sum(a.stat().st_size for arquivos in por_nome.values() for a in arquivos)
        for nome in self.nomes():
            if ocupado <= self.teto:
                return
            if nome == poupar:
                continue
            for arq in por_nome[nome]:
                try:
                    tamanho = arq.stat().st_size
                    arq.unlink()
                    ocupado -= tamanho
                except OSError as e:
                    _log.warning("não apaguei %s do rodízio das sequências: %s", arq.name, e)
        if ocupado > self.teto:
            _log.warning(
                "a guarda das sequências continua acima do teto (%d de %d bytes) depois do rodízio: a última, %s, fica",
                ocupado, self.teto, poupar,
            )
