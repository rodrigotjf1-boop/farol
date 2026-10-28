"""Conversa do agente com a nuvem — só biblioteca padrão.

Três chamadas, todas de dentro para fora:

    heartbeat()      → sinal de vida, versão da config e comandos pendentes
    configuracao()   → a configuração da loja, quando a versão mudou
    responder()      → o resultado de um comando

Nenhuma delas exige porta aberta na loja, e é de propósito: o produto
promete não pedir mudança de rede. O caminho "de volta" da nuvem para o
agente é a **resposta do heartbeat**, não uma conexão nova.

Sem `requests`: o agente roda em PC de loja, e cada dependência a mais é
uma coisa a mais para quebrar numa instalação que ninguém vai depurar
presencialmente.
"""

from __future__ import annotations

import http.client
import json
import logging
import urllib.error
import urllib.request
from typing import Any

_log = logging.getLogger(__name__)

TIMEOUT_PADRAO = 15.0

# O que sobe CRU quando a conexão abre e cai no meio: a nuvem fecha sem
# responder (reinício, borda), a resposta vem cortada, a rede solta. O
# `urllib` só embrulha em `URLError` o que acontece ao ENVIAR o pedido; o
# que acontece ao LER a resposta passa direto. Quem lê resposta pela rede
# traduz os dois — e põe este ramo DEPOIS dos de `URLError` e de
# `TimeoutError`, que também são `OSError` e têm frase própria (ERR-114).
CAIU_NO_MEIO = (http.client.HTTPException, OSError)

# O agente se IDENTIFICA. Não é cortesia: `urllib` anuncia
# `Python-urllib/3.x` por padrão, e a Cloudflare bloqueia essa assinatura
# com **403 e corpo "error code: 1010"** — antes de o pedido chegar à API.
#
# O erro resultante aponta para o lugar errado: parece token recusado ou
# agente não aprovado, e manda quem diagnostica mexer em credencial e
# estado enquanto o problema está na borda. Em 06/10/2026 custou uma
# investigação inteira (ERR-011).
#
# Sinal que desmascara: token FALSO devolvia o mesmo 403 que o token bom.
# Quando credencial inválida e credencial válida dão o mesmo erro, o erro
# não é sobre a credencial.
USER_AGENT = "farol-agent/{versao} (+https://monitorfarol.com.br)"


class ErroDaNuvem(Exception):
    """Falha ao falar com a nuvem.

    `recuperavel` separa o que vale tentar de novo (rede caiu, 5xx) do
    que não vale (token recusado, loja apagada). Sem a distinção, o
    agente ou martela para sempre um 401 que nunca vai passar, ou desiste
    de uma oscilação de rede que passaria em trinta segundos.
    """

    def __init__(self, mensagem: str, *, recuperavel: bool = True, status: int = 0):
        super().__init__(mensagem)
        self.recuperavel = recuperavel
        self.status = status


# O que este agente SABE fazer, dito à nuvem ao pedir a configuração. Há
# coisas que a nuvem só pode mandar para quem sabe lidar com elas: um
# critério em ensaio, na mão de um agente que nunca ouviu falar de estado,
# viraria aviso. Quem não declara recebe só o que sempre recebeu.
#
#   estados  o estado do critério: observando não julga, ensaio e medido não avisam.
#   estudo   o estudo do critério: o contexto e o gatilho que a loja confere sozinha.
#   bancada  o quadro de bancada: a imagem espera as mãos saírem.
#   fichas   a base de fichas da loja: o agente baixa a cópia e a guarda.
#   treino   a gravação de treino (A21): o agente busca no gravador, lê a
#            bancada e manda os lanches para a conferência.
#   planta   a planta viva com o rastreio firme (A26, 28/10/2026): usa os
#            móveis da planta, a altura e a área calibrada de cada câmera, e
#            manda as pessoas ao vivo.
#
# A nuvem GUARDA a declaração (é como o console sabe o que já vale na loja).
# "bancada", "fichas", "treino" e "planta" não mudam o que desce — o papel do
# quadro, a marca da base e a planta descem para todos —, só informam
# ("treino" é o que tira o aviso "o computador da loja ainda não sabe gravar"
# da tela). E fazem o agente que acabou de aprender pedir a configuração de
# novo ("planta" foi posto para isto: a configuração guardada antes da planta
# descer, com a mesma versão, era usada sem ela). A lista é a de
# `contratos/o-que-o-agente-sabe.json`.
SABE: tuple[str, ...] = ("estados", "estudo", "bancada", "fichas", "treino", "planta")


class ClienteNuvem:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = TIMEOUT_PADRAO,
        versao: str = "0",
        sabe: tuple[str, ...] = SABE,
    ):
        if not base_url:
            raise ErroDaNuvem("endereço da nuvem não configurado", recuperavel=False)
        if not token:
            raise ErroDaNuvem("token do agente não configurado", recuperavel=False)
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = timeout
        self.user_agent = USER_AGENT.format(versao=versao)
        # O que ESTE agente declara: o serviço ligado sem a gravação de treino (`--sem-treino`) não diz "treino".
        self.sabe = tuple(sabe)

    # ───────────────────────────── público ─────────────────────────────

    def ativar(self, fingerprint: str, versao: str | None = None) -> dict[str, Any]:
        """Apresenta esta máquina à nuvem.

        Chamada a cada partida, não só na primeira: a rota aceita
        reativação com o MESMO fingerprint de propósito — o agente
        reinicia, o serviço sobe de novo, a loja reinstala no mesmo PC.
        Tratar isso como anomalia criaria chamado onde não há problema.

        Com fingerprint DIFERENTE a nuvem recusa com 409, e é o certo:
        token válido em máquina que não é a dele pode ser troca legítima
        de equipamento ou pode ser clone, e quem decide é uma pessoa.
        """
        return self._pedir(
            "POST", "/v1/agentes/ativar",
            {"fingerprint": fingerprint, "versao": versao},
        )

    def heartbeat(self, versao: str | None = None) -> dict[str, Any]:
        """Sinal de vida. Devolve `configVersao` e os comandos pendentes."""
        return self._pedir("POST", "/v1/agentes/heartbeat", {"versao": versao})

    def configuracao(self) -> dict[str, Any]:
        return self._pedir("GET", "/v1/agentes/configuracao?sabe=" + ",".join(self.sabe))

    def baixar_padrao(self, foto_id: str) -> bytes:
        """A imagem de uma foto padrão desta loja, para comparar aqui."""
        return self._buscar("GET", f"/v1/agentes/padroes/{foto_id}", None, aceita="image/*")

    def baixar_fichas(self) -> dict[str, Any]:
        """A base de fichas desta loja: `{impressao, base}`. 404 = a loja não tem base."""
        return self._pedir("GET", "/v1/agentes/fichas")

    def baixar_foto_do_inventario(self, foto_id: str) -> bytes:
        """A imagem de uma foto de equipamento desta loja, para a análise única dela."""
        return self._buscar("GET", f"/v1/agentes/inventario/fotos/{foto_id}", None, aceita="image/*")

    def base_da_loja(self) -> dict[str, Any]:
        """A lista da base de conhecimento desta loja: `{impressao, itens}` (A21, T5; `contratos/base-de-conhecimento.json`)."""
        return self._pedir("GET", "/v1/agentes/base")

    def quadro_da_base(self, quadro_id: str) -> bytes:
        """A imagem de um quadro da base desta loja (o quadro de um id nunca muda de imagem). 404 = saiu da base."""
        return self._buscar("GET", f"/v1/agentes/base/quadros/{quadro_id}", None, aceita="image/*")

    def gravacoes_de_treino(self) -> dict[str, Any]:
        """O que a loja tem de ler e o que ela já pode apagar: `{gravacoes, apagar}` (A21, T3)."""
        return self._pedir("GET", "/v1/agentes/treino/gravacoes")

    def andamento_da_gravacao(self, gravacao_id: str, corpo: dict[str, Any]) -> dict[str, Any]:
        """Conta o andamento de uma gravação de treino: lendo (com a porcentagem), pronta ou falhou (com o motivo)."""
        return self._pedir("POST", f"/v1/agentes/treino/gravacoes/{gravacao_id}/andamento", corpo)

    def lanche_de_treino(self, corpo: dict[str, Any]) -> dict[str, Any]:
        """Manda um lanche lido numa gravação de treino, com os quadros reduzidos das etapas (A21, T3)."""
        return self._pedir("POST", "/v1/agentes/treino/lanches", corpo)

    def recortes_para_marcar(self, corpo: dict[str, Any]) -> dict[str, Any]:
        """Manda os recortes da noite que a loja escolheu para marcar, até 25 por envio (A24 F3, migration 055)."""
        return self._pedir("POST", "/v1/agentes/treino/recortes", corpo)

    def responder(
        self,
        comando_id: str,
        *,
        resultado: dict[str, Any] | None = None,
        erro: str | None = None,
    ) -> dict[str, Any]:
        """Conta à nuvem o que aconteceu com um comando.

        **Falha também se responde.** Comando que fracassa em silêncio
        deixa a tela do console girando para sempre, e quem está lá não
        tem como saber se a câmera caiu ou se o agente nem recebeu.
        """
        corpo = dict(resultado or {})
        if erro is not None:
            corpo["erro"] = erro
        return self._pedir(
            "POST", f"/v1/agentes/comandos/{comando_id}/resultado", corpo
        )

    # ───────────────────────────── interno ─────────────────────────────

    def _pedir(self, metodo: str, caminho: str, corpo: Any = None) -> dict[str, Any]:
        bruto = self._buscar(metodo, caminho, corpo)
        if not bruto:
            return {}
        try:
            return json.loads(bruto)
        except json.JSONDecodeError as e:
            # Resposta que não é JSON quase sempre é portal de rede ou
            # proxy devolvendo HTML. Tratar como "deu certo e veio vazio"
            # esconderia isso (ERR-002).
            raise ErroDaNuvem(f"resposta de {caminho} não é JSON: {e}") from None

    def _buscar(self, metodo: str, caminho: str, corpo: Any = None, *, aceita: str = "application/json") -> bytes:
        """O pedido em si, com os erros traduzidos. Devolve os bytes da resposta."""
        dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
        req = urllib.request.Request(
            f"{self.base_url}{caminho}",
            data=dados,
            method=metodo,
            headers={
                "authorization": f"Bearer {self._token}",
                "content-type": "application/json",
                "accept": aceita,
                "user-agent": self.user_agent,
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                bruto = r.read()
        except urllib.error.HTTPError as e:
            # 401/403 não melhoram repetindo: token errado, agente
            # desativado ou ligado a outra máquina. 4xx em geral é pedido
            # malformado — repetir só gasta.
            recuperavel = e.code >= 500 or e.code == 429
            detalhe = self._detalhe(e)
            if e.code == 403 and not detalhe:
                # 403 sem corpo JSON quase nunca é a API: ela sempre
                # explica. É a borda (Cloudflare, WAF, proxy) barrando
                # antes. Dizer isso evita horas procurando no lugar errado.
                detalhe = (
                    " — 403 sem resposta da API: provavelmente a borda "
                    "(Cloudflare/WAF) barrou o pedido antes de chegar lá"
                )
            raise ErroDaNuvem(
                f"{e.code} em {caminho}{detalhe}", recuperavel=recuperavel, status=e.code
            ) from None
        except urllib.error.URLError as e:
            # Rede caída, DNS fora, nuvem reiniciando. Passa.
            raise ErroDaNuvem(f"não cheguei na nuvem: {e.reason}") from None
        except TimeoutError:
            raise ErroDaNuvem(f"a nuvem não respondeu em {self.timeout:g}s") from None
        except CAIU_NO_MEIO as e:
            # Medido na loja em 13/10/2026: duas vezes num dia a nuvem
            # fechou a conexão sem responder, e isto chegava a quem chama
            # como erro inesperado. Passa, como a rede caída. A frase leva
            # só o NOME do erro: com número que muda (quantos bytes
            # faltaram) ela viraria uma linha de registro a cada volta
            # (ERR-014).
            raise ErroDaNuvem(
                f"a conexão com a nuvem caiu no meio da resposta ({type(e).__name__})"
            ) from None
        return bruto

    @staticmethod
    def _detalhe(e: urllib.error.HTTPError) -> str:
        """A mensagem da API, quando houver. Sem ela, 401 é só um número."""
        try:
            corpo = json.loads(e.read())
        except Exception:
            return ""
        msg = corpo.get("mensagem") or corpo.get("erro")
        return f" — {msg}" if msg else ""
